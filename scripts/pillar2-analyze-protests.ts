import { config as loadDotenv } from "dotenv"
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PILLAR2_BANNED_ACCOUNTS, getBannedAccount } from "../lib/pillar-2-banned-accounts"

loadDotenv({ path: ".env.local" })
loadDotenv()

// =============================================================================
// Pillar 2 — Per-day protest + repression + political prisoner extraction
//
// Reads JSONL written by scripts/pillar2-crawl-banned-press.ts, groups tweets
// by Caracas day, and calls Claude Haiku once per (date × handle) to produce
// a structured per-day verdict. Then reconciles across handles into:
//
//   data/pillar-2-civic-liberty/cleaned/protests-daily.csv
//   data/pillar-2-civic-liberty/cleaned/political-prisoners.csv
//   data/pillar-2-civic-liberty/cleaned/banned-press-sources.csv
//
// Run with:  npx tsx scripts/pillar2-analyze-protests.ts [--start YYYY-MM-DD --end YYYY-MM-DD]
// Requires:  ANTHROPIC_API_KEY in .env.local
// =============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, "..")

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const HAIKU_MODEL = "claude-haiku-4-5-20251001"
const RAW_DIR = join(REPO_ROOT, "data/pillar-2-civic-liberty/raw")
const TWEETS_DIR = join(RAW_DIR, "tweets")
const CLEANED_DIR = join(REPO_ROOT, "data/pillar-2-civic-liberty/cleaned")
const CACHE_PATH = join(RAW_DIR, "_analysis-cache.json")

const DEFAULT_START = "2026-03-12"
const DEFAULT_END = "2026-04-12"

// ---------- Types ----------

interface TweetRecord {
  id: string
  handle: string
  category: "Outlet" | "Monitor"
  day_caracas: string
  created_at: string
  text: string
  lang?: string
  link: string
  metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number } | null
}

type Scale = "none" | "small" | "medium" | "large" | "mass"
type ProtestCategory = "labor" | "services" | "political" | "human_rights" | "education" | "indigenous" | "other"
type PrisonerCategory = "civilian" | "military" | "indigenous" | "journalist" | "politician" | "minor" | "unknown"

interface PrisonerMention {
  name: string
  status: "detained" | "released" | "transferred" | "missing" | "sentenced" | "other"
  category: PrisonerCategory
  location?: string
  date?: string
  charges?: string
}

interface RunningTotal {
  // Foro Penal-style cumulative figures like "690 presos políticos excarcelados desde el 8 enero 2026".
  metric: string // e.g., "total_political_prisoners", "released_since_2026-01-08", "detained_total"
  value: number
  as_of_date?: string
  context: string // verbatim short quote from the tweet for traceability
}

interface DayHandleVerdict {
  protest_occurred: boolean
  protest_categories: ProtestCategory[]
  locations: Array<{ state?: string; municipality?: string; city?: string; neighborhood?: string }>
  scale: Scale
  impact: number // 1–5
  repression_level: number // 0–5
  repression_types: string[]
  political_prisoners_mentioned: PrisonerMention[]
  running_prisoner_totals: RunningTotal[]
  source_tweet_ids: string[]
  confidence: number // 0–1
  notes?: string
}

interface CacheEntry {
  model: string
  verdict: DayHandleVerdict
  ran_at: string
}

// ---------- CLI ----------

interface CliArgs {
  start: string
  end: string
  only?: string
  force: boolean
  dryRun: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const out: CliArgs = { start: DEFAULT_START, end: DEFAULT_END, force: false, dryRun: false }
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--start":
        out.start = args[++i]
        break
      case "--end":
        out.end = args[++i]
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
        console.log(`Usage: tsx scripts/pillar2-analyze-protests.ts [--start YYYY-MM-DD --end YYYY-MM-DD --only HANDLE --force --dry-run]`)
        process.exit(0)
      default:
        console.error(`Unknown arg: ${args[i]}`)
        process.exit(1)
    }
  }
  return out
}

// ---------- I/O ----------

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

function readJsonl(path: string): TweetRecord[] {
  if (!existsSync(path)) return []
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean)
  return lines
    .map((line) => {
      try {
        return JSON.parse(line) as TweetRecord
      } catch {
        return null
      }
    })
    .filter((x): x is TweetRecord => x !== null)
}

function loadCache(): Record<string, CacheEntry> {
  if (!existsSync(CACHE_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"))
  } catch {
    return {}
  }
}

function saveCache(cache: Record<string, CacheEntry>) {
  ensureDir(dirname(CACHE_PATH))
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
}

function* iterateDays(startKey: string, endKey: string): Generator<string> {
  const start = new Date(`${startKey}T00:00:00Z`)
  const end = new Date(`${endKey}T00:00:00Z`)
  const cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    yield cur.toISOString().slice(0, 10)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
}

// ---------- LLM ----------

const SYSTEM_PROMPT = `You are an OSINT analyst classifying Venezuelan civic-liberty signal from exiled press tweets.

For the given day and the given set of tweets from a single source, return a strict JSON object with these fields:

PROTEST FIELDS
- protest_occurred: boolean. True iff at least one tweet describes a protest, march, demonstration, paro, cacerolazo, or street mobilization in Venezuela on or near the day.
- protest_categories: array of any of "labor" | "services" | "political" | "human_rights" | "education" | "indigenous" | "other". "labor" = wages/working conditions/pensions. "services" = utilities (water/electricity/gas/transport). "political" = elections/regime/amnesty/Maria Corina. "human_rights" = detentions/disappearances/asylum. "education" = teachers/universities/students. "indigenous" = indigenous community grievances. Empty array if no protest.
- locations: array of {state, municipality?, city?, neighborhood?}. Use Venezuelan place names (e.g., "Distrito Capital", "Zulia", "Táchira"). Empty array if none.
- scale: one of "none" | "small" (<50) | "medium" (50–500) | "large" (500–5000) | "mass" (>5000). Pick the largest claim across tweets.
- impact: integer 1–5 rating disruption (1 = symbolic, 5 = blocks major infrastructure / national reach).
- repression_level: integer 0–5 (0 = none described, 1 = verbal threats, 2 = arrests, 3 = tear gas/pellets, 4 = beatings/widespread arrests, 5 = lethal force / live ammunition).
- repression_types: array of short tags (e.g., "tear_gas", "arrests", "colectivos", "live_ammunition", "internet_throttle", "checkpoints", "raids").

PRISONER FIELDS
- political_prisoners_mentioned: array of {name, status: "detained"|"released"|"transferred"|"missing"|"sentenced"|"other", category: "civilian"|"military"|"indigenous"|"journalist"|"politician"|"minor"|"unknown", location?, date?, charges?}. Only include NAMED individuals. Infer category from context: opposition activists/regular citizens = "civilian"; armed forces members = "military"; named indigenous community members = "indigenous"; reporters/editors = "journalist"; party officials/candidates/legislators = "politician"; under-18 = "minor"; otherwise "unknown".
- running_prisoner_totals: array of {metric, value, as_of_date?, context}. Extract canonical Foro Penal-style cumulative figures with EXPLICIT numbers, e.g., "Hemos verificado 690 presos políticos excarcelados desde el 8 enero 2026" → {metric: "released_since_2026-01-08", value: 690, context: "<short quote>"}. Common metrics: "total_political_prisoners", "released_since_<YYYY-MM-DD>", "detained_total_<period>", "missing_total", "minors_detained". Only include if a specific integer is quoted; skip vague claims.

GENERAL
- source_tweet_ids: array of tweet IDs from the input that support the verdict. Always populate when protest_occurred=true OR prisoners mentioned.
- confidence: number 0–1. Lower when reporting is ambiguous, second-hand, or possibly recycled.
- notes: brief free-text caveat if the source content is thin or off-topic.

RULES
- If no tweets describe a protest, set protest_occurred=false, protest_categories=[], scale="none", impact=1, repression_level=0.
- Do not infer events not in the source text. If a tweet references a past or future event clearly outside the given day, ignore it for protest_occurred but DO extract any prisoner counts or named prisoner status changes (these are valid signal regardless of date).
- Output ONLY the JSON object, no preamble, no markdown fences.`

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string
}

async function callHaiku(messages: AnthropicMessage[]): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not set")
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API error (${res.status}): ${body}`)
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  const text = json.content?.find((b) => b.type === "text")?.text
  if (!text) throw new Error(`No text in Anthropic response: ${JSON.stringify(json)}`)
  return text
}

function parseVerdict(text: string): DayHandleVerdict {
  // Be permissive: strip markdown fences if any leaked through.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  const obj = JSON.parse(cleaned) as DayHandleVerdict
  // Normalize defensively for the case where the LLM omits a field.
  obj.protest_categories = obj.protest_categories ?? []
  obj.locations = obj.locations ?? []
  obj.repression_types = obj.repression_types ?? []
  obj.political_prisoners_mentioned = (obj.political_prisoners_mentioned ?? []).map((p) => ({
    ...p,
    category: p.category ?? "unknown",
  }))
  obj.running_prisoner_totals = obj.running_prisoner_totals ?? []
  obj.source_tweet_ids = obj.source_tweet_ids ?? []
  obj.scale = (obj.scale ?? "none") as Scale
  obj.impact = obj.impact ?? 1
  obj.repression_level = obj.repression_level ?? 0
  obj.confidence = obj.confidence ?? 0
  return obj
}

async function analyzeDayHandle(dayKey: string, handle: string, tweets: TweetRecord[]): Promise<DayHandleVerdict> {
  const acct = getBannedAccount(handle)
  const lines = tweets.map((t) => `[${t.id}] (${t.created_at}) ${t.text.replace(/\s+/g, " ")}`).join("\n")
  const user = `Source: @${handle} (${acct?.displayName ?? handle}, category=${acct?.category ?? "Outlet"})
Caracas day: ${dayKey}
Tweets (${tweets.length}):
${lines || "(none)"}`
  const text = await callHaiku([{ role: "user", content: user }])
  return parseVerdict(text)
}

// ---------- Reconciliation ----------

const SCALE_ORDER: Scale[] = ["none", "small", "medium", "large", "mass"]
function maxScale(a: Scale, b: Scale): Scale {
  return SCALE_ORDER.indexOf(a) >= SCALE_ORDER.indexOf(b) ? a : b
}

interface DayRollup {
  date: string
  protest_occurred: boolean
  protest_categories: ProtestCategory[]
  scale: Scale
  impact: number
  repression_level: number
  locations: Array<{ state?: string; municipality?: string; city?: string; neighborhood?: string }>
  repression_types: string[]
  political_prisoners: Array<{
    name: string
    status: string
    category: PrisonerCategory
    location?: string
    date?: string
    charges?: string
    source_handle: string
    source_tweet_id?: string
  }>
  running_prisoner_totals: Array<RunningTotal & { source_handle: string }>
  source_handles: string[]
  source_tweet_ids: string[]
  confidence: number
}

function reconcileDay(date: string, perHandle: Record<string, DayHandleVerdict>): DayRollup {
  const verdicts = Object.entries(perHandle)
  const protest_occurred = verdicts.some(([, v]) => v.protest_occurred)
  let scale: Scale = "none"
  let impact = 0
  let repression_level = 0
  const locKey = (l: DayRollup["locations"][number]) => `${l.state ?? ""}|${l.municipality ?? ""}|${l.city ?? ""}|${l.neighborhood ?? ""}`.toLowerCase()
  const seenLoc = new Set<string>()
  const locations: DayRollup["locations"] = []
  const repTypes = new Set<string>()
  const categories = new Set<ProtestCategory>()
  const prisoners: DayRollup["political_prisoners"] = []
  const seenPrisoner = new Set<string>()
  const runningTotals: DayRollup["running_prisoner_totals"] = []
  const seenTotal = new Set<string>()
  const source_handles: string[] = []
  const source_tweet_ids = new Set<string>()
  let confSum = 0
  let confN = 0

  for (const [handle, v] of verdicts) {
    scale = maxScale(scale, v.scale)
    impact = Math.max(impact, v.impact)
    repression_level = Math.max(repression_level, v.repression_level)
    for (const c of v.protest_categories ?? []) categories.add(c)
    for (const loc of v.locations ?? []) {
      const k = locKey(loc)
      if (!seenLoc.has(k)) {
        seenLoc.add(k)
        locations.push(loc)
      }
    }
    for (const t of v.repression_types ?? []) repTypes.add(t)
    for (const p of v.political_prisoners_mentioned ?? []) {
      // The LLM occasionally emits prisoner objects with null/missing fields. Drop those rather than crashing.
      if (!p || typeof p.name !== "string" || !p.name.trim()) continue
      const k = `${p.name.toLowerCase()}|${p.status ?? "other"}|${p.category ?? "unknown"}`
      if (!seenPrisoner.has(k)) {
        seenPrisoner.add(k)
        prisoners.push({
          ...p,
          status: p.status ?? "other",
          category: p.category ?? "unknown",
          source_handle: handle,
          source_tweet_id: v.source_tweet_ids?.[0],
        })
      }
    }
    for (const t of v.running_prisoner_totals ?? []) {
      const k = `${t.metric}|${t.value}`
      if (!seenTotal.has(k)) {
        seenTotal.add(k)
        runningTotals.push({ ...t, source_handle: handle })
      }
    }
    for (const id of v.source_tweet_ids ?? []) source_tweet_ids.add(id)
    if (v.protest_occurred) source_handles.push(handle)
    if (typeof v.confidence === "number") {
      confSum += v.confidence
      confN++
    }
  }

  return {
    date,
    protest_occurred,
    protest_categories: Array.from(categories).sort(),
    scale,
    impact,
    repression_level,
    locations,
    repression_types: Array.from(repTypes).sort(),
    political_prisoners: prisoners,
    running_prisoner_totals: runningTotals,
    source_handles,
    source_tweet_ids: Array.from(source_tweet_ids).sort(),
    confidence: confN === 0 ? 0 : Number((confSum / confN).toFixed(3)),
  }
}

// ---------- CSV ----------

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = typeof value === "string" ? value : JSON.stringify(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function writeProtestsDailyCsv(rollups: DayRollup[]) {
  const header = [
    "date",
    "protest_occurred",
    "protest_categories_json",
    "scale",
    "impact",
    "repression_level",
    "repression_types_json",
    "locations_json",
    "state_count",
    "source_count",
    "source_handles_json",
    "source_tweet_ids_json",
    "confidence",
  ]
  const rows = rollups.map((r) => {
    const distinctStates = new Set(r.locations.map((l) => l.state).filter(Boolean))
    return [
      r.date,
      r.protest_occurred ? "true" : "false",
      r.protest_categories,
      r.scale,
      r.impact,
      r.repression_level,
      r.repression_types,
      r.locations,
      distinctStates.size,
      r.source_handles.length,
      r.source_handles,
      r.source_tweet_ids,
      r.confidence,
    ]
  })
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
  ensureDir(CLEANED_DIR)
  writeFileSync(join(CLEANED_DIR, "protests-daily.csv"), csv)
}

function writePrisonersCsv(rollups: DayRollup[]) {
  const header = ["date_observed", "name", "status", "category", "location", "charges", "source_handle", "source_tweet_id"]
  const rows: unknown[][] = []
  for (const r of rollups) {
    for (const p of r.political_prisoners) {
      rows.push([
        r.date,
        p.name,
        p.status,
        p.category,
        p.location ?? "",
        p.charges ?? "",
        p.source_handle,
        p.source_tweet_id ?? "",
      ])
    }
  }
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
  ensureDir(CLEANED_DIR)
  writeFileSync(join(CLEANED_DIR, "political-prisoners.csv"), csv)
}

function writePrisonerTotalsCsv(rollups: DayRollup[]) {
  const header = ["date_observed", "metric", "value", "as_of_date", "context", "source_handle"]
  const rows: unknown[][] = []
  for (const r of rollups) {
    for (const t of r.running_prisoner_totals) {
      rows.push([r.date, t.metric, t.value, t.as_of_date ?? "", t.context, t.source_handle])
    }
  }
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
  ensureDir(CLEANED_DIR)
  writeFileSync(join(CLEANED_DIR, "prisoner-running-totals.csv"), csv)
}

function writeSourcesCsv(tweetCountByHandle: Record<string, number>) {
  const header = ["handle", "display_name", "category", "banned_since", "banned_reason", "tweet_count"]
  const rows = PILLAR2_BANNED_ACCOUNTS.map((a) => [
    a.handle,
    a.displayName,
    a.category,
    a.bannedSince,
    a.bannedReason,
    tweetCountByHandle[a.handle] ?? 0,
  ])
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
  ensureDir(CLEANED_DIR)
  writeFileSync(join(CLEANED_DIR, "banned-press-sources.csv"), csv)
}

// ---------- Main ----------

async function main() {
  const args = parseArgs()
  if (!ANTHROPIC_KEY || ANTHROPIC_KEY.startsWith("your-")) {
    console.error("[pillar2] ANTHROPIC_API_KEY is not set in .env.local. Aborting.")
    process.exit(1)
  }

  const accounts = args.only
    ? PILLAR2_BANNED_ACCOUNTS.filter((a) => a.handle.toLowerCase() === args.only!.toLowerCase())
    : PILLAR2_BANNED_ACCOUNTS

  const days: string[] = []
  for (const d of iterateDays(args.start, args.end)) days.push(d)

  // Load all tweets and group by (handle, day).
  const tweetsByHandleDay: Record<string, Record<string, TweetRecord[]>> = {}
  const tweetCountByHandle: Record<string, number> = {}
  for (const acct of accounts) {
    const path = join(TWEETS_DIR, `${acct.handle}.jsonl`)
    const rows = readJsonl(path)
    tweetCountByHandle[acct.handle] = rows.length
    tweetsByHandleDay[acct.handle] = {}
    for (const t of rows) {
      ;(tweetsByHandleDay[acct.handle][t.day_caracas] ??= []).push(t)
    }
  }

  console.log(`[pillar2-analyze] Window ${args.start} → ${args.end} across ${accounts.length} accounts.`)
  for (const acct of accounts) {
    console.log(`  @${acct.handle}: ${tweetCountByHandle[acct.handle]} tweets loaded`)
  }

  if (args.dryRun) {
    console.log("[pillar2-analyze] --dry-run: skipping LLM calls.")
    writeSourcesCsv(tweetCountByHandle)
    return
  }

  const cache = loadCache()
  const verdicts: Record<string, Record<string, DayHandleVerdict>> = {}

  let llmCalls = 0
  for (const day of days) {
    verdicts[day] = {}
    for (const acct of accounts) {
      const dayTweets = tweetsByHandleDay[acct.handle][day] ?? []
      if (dayTweets.length === 0) {
        // No tweets that day → skip the LLM call; treat as silent.
        verdicts[day][acct.handle] = {
          protest_occurred: false,
          protest_categories: [],
          locations: [],
          scale: "none",
          impact: 1,
          repression_level: 0,
          repression_types: [],
          political_prisoners_mentioned: [],
          running_prisoner_totals: [],
          source_tweet_ids: [],
          confidence: 0,
          notes: "no tweets",
        }
        continue
      }
      const cacheKey = `${acct.handle}|${day}`
      if (!args.force && cache[cacheKey]?.model === HAIKU_MODEL) {
        verdicts[day][acct.handle] = cache[cacheKey].verdict
        continue
      }
      try {
        const verdict = await analyzeDayHandle(day, acct.handle, dayTweets)
        verdicts[day][acct.handle] = verdict
        cache[cacheKey] = { model: HAIKU_MODEL, verdict, ran_at: new Date().toISOString() }
        llmCalls++
        if (llmCalls % 25 === 0) saveCache(cache)
      } catch (err) {
        console.error(`[pillar2-analyze] @${acct.handle} ${day}: ERROR ${(err as Error).message}`)
        verdicts[day][acct.handle] = {
          protest_occurred: false,
          protest_categories: [],
          locations: [],
          scale: "none",
          impact: 1,
          repression_level: 0,
          repression_types: [],
          political_prisoners_mentioned: [],
          running_prisoner_totals: [],
          source_tweet_ids: [],
          confidence: 0,
          notes: `LLM error: ${(err as Error).message}`,
        }
      }
    }
  }
  saveCache(cache)

  const rollups = days.map((d) => reconcileDay(d, verdicts[d]))
  writeProtestsDailyCsv(rollups)
  writePrisonersCsv(rollups)
  writePrisonerTotalsCsv(rollups)
  writeSourcesCsv(tweetCountByHandle)

  const protestDays = rollups.filter((r) => r.protest_occurred).length
  const prisoners = rollups.reduce((s, r) => s + r.political_prisoners.length, 0)
  const totalsRecorded = rollups.reduce((s, r) => s + r.running_prisoner_totals.length, 0)
  console.log(`\n[pillar2-analyze] === Summary ===`)
  console.log(`  LLM calls made: ${llmCalls}`)
  console.log(`  Days with detected protest: ${protestDays} / ${rollups.length}`)
  console.log(`  Political-prisoner mentions: ${prisoners}`)
  console.log(`  Running-total figures recorded: ${totalsRecorded}`)
  console.log(`  CSVs written to: ${CLEANED_DIR}`)
}

main().catch((err) => {
  console.error("[pillar2-analyze] Fatal error:", err)
  process.exit(1)
})
