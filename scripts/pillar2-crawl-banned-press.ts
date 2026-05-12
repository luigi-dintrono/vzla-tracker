import { config as loadDotenv } from "dotenv"
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PILLAR2_BANNED_ACCOUNTS } from "../lib/pillar-2-banned-accounts"

// Load .env.local (Next.js convention) then fall back to .env. dotenv does not
// override variables already set, so the order matters: load .env.local first.
loadDotenv({ path: ".env.local" })
loadDotenv()

// =============================================================================
// Pillar 2 — Banned Press X/Twitter crawler
//
// Crawls a fixed set of banned/exiled Venezuelan news + monitor accounts,
// fetching up to N tweets per account per day in a fixed UTC window. Writes
// JSONL per handle and a per-day state file so re-runs are idempotent.
//
// Why day-bucketed: the X API is pay-per-resource ($0.005/tweet returned).
// Bucketing by day with max_results=10 and no pagination puts a hard cap on
// resources returned (5 accounts × 10/day × 32 days = 1,600 tweets max ≈ $8).
// =============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, "..")

const X_BEARER = process.env.X_API_BEARER_TOKEN
const RAW_DIR = join(REPO_ROOT, "data/pillar-2-civic-liberty/raw")
const TWEETS_DIR = join(RAW_DIR, "tweets")
const USER_IDS_PATH = join(RAW_DIR, "_user-ids.json")
const STATE_PATH = join(RAW_DIR, "_state.json")
const SUMMARY_PATH = join(RAW_DIR, "_crawl-summary.json")

// Defaults match the locked-in scope (2026-03-12 → 2026-04-12, 10 tweets/day).
const DEFAULT_START = "2026-03-12"
const DEFAULT_END = "2026-04-12"
const DEFAULT_MAX_PER_DAY = 10

// Caracas is UTC-4. A "day in Caracas" runs 04:00Z → next-day 04:00Z.
const CARACAS_UTC_OFFSET_HOURS = 4

// Polite delay between requests (Basic-tier user-timeline limit is generous,
// but the crawler hits the same endpoint 5×32 = 160 times, so we sleep a bit).
const REQUEST_DELAY_MS = 250

interface XUser {
  id: string
  username: string
  name: string
  verified?: boolean
  profile_image_url?: string
}

interface XTweet {
  id: string
  text: string
  created_at: string
  author_id?: string
  lang?: string
  public_metrics?: {
    like_count: number
    retweet_count: number
    reply_count: number
    quote_count: number
  }
  attachments?: { media_keys?: string[] }
  referenced_tweets?: Array<{ type: "quoted" | "replied_to" | "retweeted"; id: string }>
  geo?: { place_id?: string }
}

interface XMedia {
  media_key: string
  type: "photo" | "video" | "animated_gif"
  url?: string
  preview_image_url?: string
}

interface CrawlState {
  // For each handle, the most recent tweet_id we've stored (used for diagnostics,
  // not for resumption — resumption is achieved via day-bucket idempotency below).
  newest_id_by_handle: Record<string, string | undefined>
  // For each (handle, dayKey), did we already fetch that day? If yes, skip.
  fetched_days: Record<string, string[]>
  last_run_at?: string
}

interface CliArgs {
  start: string
  end: string
  maxPerDay: number
  force: boolean
  dryRun: boolean
  only?: string
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const out: CliArgs = {
    start: DEFAULT_START,
    end: DEFAULT_END,
    maxPerDay: DEFAULT_MAX_PER_DAY,
    force: false,
    dryRun: false,
  }
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--start":
        out.start = args[++i]
        break
      case "--end":
        out.end = args[++i]
        break
      case "--max-per-day":
        out.maxPerDay = parseInt(args[++i], 10)
        break
      case "--only":
        out.only = args[++i]
        break
      case "--force":
        out.force = true
        break
      case "--dry-run":
        out.dryRun = true
        break
      case "--help":
        printHelp()
        process.exit(0)
      default:
        console.error(`Unknown argument: ${args[i]}`)
        printHelp()
        process.exit(1)
    }
  }
  return out
}

function printHelp() {
  console.log(`
Usage: npx tsx scripts/pillar2-crawl-banned-press.ts [options]

Options:
  --start YYYY-MM-DD     First Caracas-day to fetch (default ${DEFAULT_START})
  --end YYYY-MM-DD       Last Caracas-day to fetch, inclusive (default ${DEFAULT_END})
  --max-per-day N        Cap returned tweets per (account, day) (default ${DEFAULT_MAX_PER_DAY})
  --only HANDLE          Only crawl one account (e.g. --only OVCSvenezuela)
  --force                Re-fetch days even if state says we already did them
  --dry-run              Resolve user IDs and print the plan; make no day requests
  --help                 Show this help

Notes:
  • Each (account, day) is one HTTP request. With defaults that is 5 × 32 = 160 requests.
  • Cost ceiling at $0.005/tweet: 5 × ${DEFAULT_MAX_PER_DAY} × 32 = ${5 * DEFAULT_MAX_PER_DAY * 32} resources → \$${((5 * DEFAULT_MAX_PER_DAY * 32 * 0.005)).toFixed(2)} max.
  • Days where the account posted nothing return zero tweets at zero cost.
`)
}

// ---------- I/O helpers ----------

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T
  } catch (err) {
    console.warn(`[pillar2] Failed to parse ${path}, using fallback:`, err)
    return fallback
  }
}

function saveJson(path: string, data: unknown) {
  ensureDir(dirname(path))
  writeFileSync(path, JSON.stringify(data, null, 2))
}

// ---------- Date helpers ----------

// Returns the [start, end) UTC bounds for a Caracas calendar day "YYYY-MM-DD".
function caracasDayBounds(dayKey: string): { startISO: string; endISO: string } {
  const [y, m, d] = dayKey.split("-").map((n) => parseInt(n, 10))
  // Caracas is UTC-4, so the start of the Caracas day in UTC is 04:00Z.
  const startMs = Date.UTC(y, m - 1, d, CARACAS_UTC_OFFSET_HOURS, 0, 0)
  const endMs = startMs + 24 * 60 * 60 * 1000
  return {
    startISO: new Date(startMs).toISOString(),
    endISO: new Date(endMs).toISOString(),
  }
}

function* iterateDays(startKey: string, endKey: string): Generator<string> {
  // Iterates inclusive Caracas-day keys "YYYY-MM-DD".
  const start = new Date(`${startKey}T00:00:00Z`)
  const end = new Date(`${endKey}T00:00:00Z`)
  const cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    yield cur.toISOString().slice(0, 10)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------- X API ----------

async function xFetch(url: string, attempt = 1): Promise<Response> {
  if (!X_BEARER) throw new Error("X_API_BEARER_TOKEN is not set")
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${X_BEARER}` },
  })
  if (res.status === 429) {
    // Rate limited. Honor x-rate-limit-reset (seconds since epoch) if present.
    const resetHeader = res.headers.get("x-rate-limit-reset")
    const resetMs = resetHeader ? parseInt(resetHeader, 10) * 1000 : Date.now() + 60_000
    const waitMs = Math.max(1000, resetMs - Date.now()) + 1000
    if (attempt > 4) throw new Error(`Rate limited 4×, giving up on ${url}`)
    console.warn(`[pillar2] 429 — sleeping ${Math.round(waitMs / 1000)}s (attempt ${attempt})`)
    await sleep(waitMs)
    return xFetch(url, attempt + 1)
  }
  return res
}

async function resolveUser(handle: string): Promise<XUser> {
  const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=verified,profile_image_url,name`
  const res = await xFetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to resolve @${handle}: ${res.status} ${body}`)
  }
  const json = (await res.json()) as { data?: XUser; errors?: unknown }
  if (!json.data) throw new Error(`No user data for @${handle}: ${JSON.stringify(json)}`)
  return json.data
}

interface DayFetchResult {
  tweets: XTweet[]
  users: Map<string, XUser>
  media: Map<string, XMedia>
}

async function fetchDay(userId: string, startISO: string, endISO: string, maxPerDay: number): Promise<DayFetchResult> {
  // max_results must be 5–100 per X API docs. We cap at 10 (or higher if caller asks).
  const maxResults = Math.max(5, Math.min(100, maxPerDay))
  const params = new URLSearchParams({
    max_results: String(maxResults),
    exclude: "replies,retweets",
    start_time: startISO,
    end_time: endISO,
    "tweet.fields": "created_at,public_metrics,attachments,referenced_tweets,lang,geo,author_id",
    "media.fields": "url,preview_image_url,type",
    "user.fields": "username,name,verified,profile_image_url",
    expansions: "attachments.media_keys,author_id",
  })
  const url = `https://api.x.com/2/users/${userId}/tweets?${params.toString()}`
  const res = await xFetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`fetchDay failed (${res.status}): ${body}`)
  }
  const json = (await res.json()) as {
    data?: XTweet[]
    includes?: { users?: XUser[]; media?: XMedia[] }
    meta?: { result_count?: number; newest_id?: string; oldest_id?: string }
  }
  const tweets = (json.data ?? []).slice(0, maxPerDay)
  const users = new Map<string, XUser>()
  for (const u of json.includes?.users ?? []) users.set(u.id, u)
  const media = new Map<string, XMedia>()
  for (const m of json.includes?.media ?? []) media.set(m.media_key, m)
  return { tweets, users, media }
}

// ---------- Main ----------

interface AccountSummary {
  handle: string
  user_id?: string
  days_fetched: number
  days_skipped: number
  days_errored: number
  tweets_total: number
  errors: string[]
}

async function main() {
  const args = parseArgs()
  if (!X_BEARER || X_BEARER.startsWith("your-")) {
    console.error("[pillar2] X_API_BEARER_TOKEN is not set in .env.local. Aborting.")
    process.exit(1)
  }

  ensureDir(TWEETS_DIR)

  console.log(
    `[pillar2] Crawling banned-press feeds: ${args.start} → ${args.end} (Caracas), max ${args.maxPerDay} tweets/day per account`,
  )

  // Step 1: resolve user IDs (cached on disk).
  const userIdCache = loadJson<Record<string, XUser>>(USER_IDS_PATH, {})
  // --only accepts a comma-separated list of handles for batch-running a subset.
  const onlyHandles = args.only
    ? new Set(args.only.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null
  const accounts = onlyHandles
    ? PILLAR2_BANNED_ACCOUNTS.filter((a) => onlyHandles.has(a.handle.toLowerCase()))
    : PILLAR2_BANNED_ACCOUNTS

  if (accounts.length === 0) {
    console.error(`[pillar2] No accounts match --only ${args.only}`)
    process.exit(1)
  }

  for (const acct of accounts) {
    if (userIdCache[acct.handle]?.id) {
      console.log(`[pillar2] @${acct.handle} → ${userIdCache[acct.handle].id} (cached)`)
      continue
    }
    try {
      const user = await resolveUser(acct.handle)
      userIdCache[acct.handle] = user
      console.log(`[pillar2] @${acct.handle} → ${user.id} (${user.name})`)
      await sleep(REQUEST_DELAY_MS)
    } catch (err) {
      console.error(`[pillar2] FAILED to resolve @${acct.handle}: ${(err as Error).message}`)
      userIdCache[acct.handle] = { id: "", username: acct.handle, name: acct.displayName }
    }
  }
  saveJson(USER_IDS_PATH, userIdCache)

  if (args.dryRun) {
    console.log("[pillar2] --dry-run: stopping before day-bucket requests.")
    return
  }

  // Step 2: load state (which day-buckets we've already fetched).
  const state = loadJson<CrawlState>(STATE_PATH, {
    newest_id_by_handle: {},
    fetched_days: {},
  })

  // Step 3: iterate accounts × days.
  const summaries: AccountSummary[] = []

  const days: string[] = []
  for (const d of iterateDays(args.start, args.end)) days.push(d)

  for (const acct of accounts) {
    const user = userIdCache[acct.handle]
    const summary: AccountSummary = {
      handle: acct.handle,
      user_id: user?.id,
      days_fetched: 0,
      days_skipped: 0,
      days_errored: 0,
      tweets_total: 0,
      errors: [],
    }
    if (!user?.id) {
      summary.errors.push("user_id resolution failed")
      summaries.push(summary)
      continue
    }

    const handleJsonl = join(TWEETS_DIR, `${acct.handle}.jsonl`)
    const fetchedSet = new Set(state.fetched_days[acct.handle] ?? [])

    console.log(`\n[pillar2] === @${acct.handle} (${days.length} days) ===`)
    for (const dayKey of days) {
      if (!args.force && fetchedSet.has(dayKey)) {
        summary.days_skipped++
        continue
      }
      const { startISO, endISO } = caracasDayBounds(dayKey)
      try {
        const { tweets, media } = await fetchDay(user.id, startISO, endISO, args.maxPerDay)
        for (const t of tweets) {
          const images: string[] = []
          for (const key of t.attachments?.media_keys ?? []) {
            const m = media.get(key)
            const url = m?.url || m?.preview_image_url
            if (url) images.push(url)
          }
          const record = {
            id: t.id,
            handle: acct.handle,
            category: acct.category,
            user_id: user.id,
            author_name: user.name,
            author_verified: user.verified ?? false,
            day_caracas: dayKey,
            created_at: t.created_at,
            text: t.text,
            lang: t.lang,
            metrics: t.public_metrics ?? null,
            images,
            referenced_tweets: t.referenced_tweets ?? [],
            geo: t.geo ?? null,
            link: `https://x.com/${acct.handle}/status/${t.id}`,
          }
          appendFileSync(handleJsonl, JSON.stringify(record) + "\n")
          summary.tweets_total++
          if (!state.newest_id_by_handle[acct.handle] || t.id > (state.newest_id_by_handle[acct.handle] ?? "")) {
            state.newest_id_by_handle[acct.handle] = t.id
          }
        }
        fetchedSet.add(dayKey)
        summary.days_fetched++
        if (tweets.length > 0) {
          console.log(`[pillar2] @${acct.handle} ${dayKey}: ${tweets.length} tweet(s)`)
        }
      } catch (err) {
        const msg = (err as Error).message
        console.error(`[pillar2] @${acct.handle} ${dayKey}: ERROR ${msg}`)
        summary.days_errored++
        summary.errors.push(`${dayKey}: ${msg}`)
      }
      await sleep(REQUEST_DELAY_MS)
    }

    state.fetched_days[acct.handle] = Array.from(fetchedSet).sort()
    state.last_run_at = new Date().toISOString()
    saveJson(STATE_PATH, state)
    summaries.push(summary)
  }

  // Step 4: write summary.
  const totalTweets = summaries.reduce((s, r) => s + r.tweets_total, 0)
  const totalDayRequests = summaries.reduce((s, r) => s + r.days_fetched + r.days_errored, 0)
  const estimatedCost = (totalTweets * 0.005).toFixed(2)
  const summaryDoc = {
    ran_at: new Date().toISOString(),
    window: { start: args.start, end: args.end },
    max_per_day: args.maxPerDay,
    accounts: summaries,
    totals: {
      tweets: totalTweets,
      day_requests: totalDayRequests,
      estimated_x_api_cost_usd: estimatedCost,
    },
  }
  saveJson(SUMMARY_PATH, summaryDoc)

  console.log(`\n[pillar2] === Summary ===`)
  for (const s of summaries) {
    console.log(
      `  @${s.handle.padEnd(18)} tweets=${String(s.tweets_total).padStart(4)} fetched_days=${s.days_fetched} skipped=${s.days_skipped} errored=${s.days_errored}`,
    )
  }
  console.log(`  ---`)
  console.log(`  tweets total: ${totalTweets}`)
  console.log(`  day requests: ${totalDayRequests}`)
  console.log(`  estimated cost: $${estimatedCost}`)
  console.log(`  summary written: ${SUMMARY_PATH}`)
}

main().catch((err) => {
  console.error("[pillar2] Fatal error:", err)
  process.exit(1)
})
