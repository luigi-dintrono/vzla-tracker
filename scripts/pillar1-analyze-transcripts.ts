import { config as loadDotenv } from "dotenv"
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { YOUTUBE_SOURCES, type YouTubeSource } from "../press-freedom/channels"

loadDotenv({ path: ".env.local" })
loadDotenv()

// =============================================================================
// Pillar 1 — Semantic analysis of Venezuelan broadcast transcripts
//
// Reads .txt transcripts produced by the press-freedom crawl pipeline and
// calls Claude Haiku once per transcript to extract a structured verdict:
//   - figure mentions (canonical, with sentiment in context)
//   - per-segment classification (regime / opposition / press / etc.)
//   - regime + opposition framing sentiment
//   - press-incident flags (bans, arrests, censorship)
//
// Aggregates to:
//   data/pillar-1-press-freedom/cleaned/figures-mentions.csv
//   data/pillar-1-press-freedom/cleaned/framing-by-outlet.csv
//   data/pillar-1-press-freedom/cleaned/airtime-daily.csv
//   data/pillar-1-press-freedom/cleaned/press-incidents.csv
//   data/pillar-1-press-freedom/cleaned/summary-metrics.csv
//   data/pillar-1-press-freedom/cleaned/processed-transcripts.csv (ledger of
//       analyzed files; re-runs skip anything already present here unless
//       --force is passed)
//
// Run:  npx tsx scripts/pillar1-analyze-transcripts.ts [--start YYYY-MM-DD] [--end YYYY-MM-DD]
// Env:  ANTHROPIC_API_KEY required (in .env.local)
// =============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, "..")

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const HAIKU_MODEL = "claude-haiku-4-5-20251001"
const TRANSCRIPTS_DIR = join(REPO_ROOT, "press-freedom/data/transcripts")
const CLEANED_DIR = join(REPO_ROOT, "data/pillar-1-press-freedom/cleaned")
const RAW_DIR = join(REPO_ROOT, "data/pillar-1-press-freedom/raw")
const CACHE_PATH = join(RAW_DIR, "_analysis-cache.json")

// Average Spanish broadcast speech rate, words/minute. Used to estimate airtime
// from transcript word counts when timestamps aren't available.
const WORDS_PER_MINUTE = 150

// ---------- Canonical figures of interest ----------

type FigureSide = "regime" | "opposition" | "international-us" | "international-other" | "historical"

interface Figure {
  canonical: string
  aliases: string[]
  side: FigureSide
}

// 15 figures — covers the names the user named plus the most-mentioned others.
// "aliases" feed both the LLM prompt and the canonicalizer below.
const FIGURES: Figure[] = [
  { canonical: "María Corina Machado", aliases: ["maria corina machado", "maria corina", "mcm", "corina machado"], side: "opposition" },
  { canonical: "Edmundo González Urrutia", aliases: ["edmundo gonzález", "edmundo gonzalez", "edmundo"], side: "opposition" },
  { canonical: "Juan Pablo Guanipa", aliases: ["guanipa", "juan pablo guanipa"], side: "opposition" },
  { canonical: "Henrique Capriles", aliases: ["capriles", "henrique capriles", "capriles radonski"], side: "opposition" },
  { canonical: "Leopoldo López", aliases: ["leopoldo lopez", "leopoldo lópez", "leopoldo"], side: "opposition" },
  { canonical: "Nicolás Maduro", aliases: ["nicolás maduro", "nicolas maduro", "maduro"], side: "regime" },
  { canonical: "Delcy Rodríguez", aliases: ["delcy rodríguez", "delcy rodriguez", "delcy"], side: "regime" },
  { canonical: "Jorge Rodríguez", aliases: ["jorge rodríguez", "jorge rodriguez"], side: "regime" },
  { canonical: "Diosdado Cabello", aliases: ["diosdado cabello", "diosdado"], side: "regime" },
  { canonical: "Tarek William Saab", aliases: ["tarek william saab", "tarek saab", "saab"], side: "regime" },
  { canonical: "Vladimir Padrino López", aliases: ["vladimir padrino", "padrino lópez", "padrino lopez", "padrino"], side: "regime" },
  { canonical: "Cilia Flores", aliases: ["cilia flores", "cilia"], side: "regime" },
  { canonical: "Donald Trump", aliases: ["donald trump", "trump"], side: "international-us" },
  { canonical: "Marco Rubio", aliases: ["marco rubio", "rubio"], side: "international-us" },
  { canonical: "Hugo Chávez", aliases: ["hugo chávez", "hugo chavez", "chávez", "chavez"], side: "regime" },
]

const ALIAS_TO_CANONICAL = new Map<string, string>(
  FIGURES.flatMap((f) => [
    [f.canonical.toLowerCase(), f.canonical] as [string, string],
    ...f.aliases.map((a) => [a, f.canonical] as [string, string]),
  ])
)

function canonicalizeFigure(raw: string): string | null {
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ")
  if (ALIAS_TO_CANONICAL.has(k)) return ALIAS_TO_CANONICAL.get(k)!
  // Loose contains-match for "presidente Maduro", "Sr. Maduro", etc.
  for (const [alias, canonical] of ALIAS_TO_CANONICAL) {
    if (k.includes(alias)) return canonical
  }
  return null
}

// ---------- Outlet inference ----------

interface OutletInfo {
  outlet: string
  category: YouTubeSource["category"]
  sourceId: string
}

// Filename keyword → outlet name. First match wins.
// Extend this list as more sources are added to channels.ts.
const FILENAME_OUTLET_KEYWORDS: Array<{ pattern: RegExp; outlet: string }> = [
  { pattern: /venevision/i, outlet: "Venevisión" },
  { pattern: /globovision/i, outlet: "Globovisión" },
  { pattern: /telesur/i, outlet: "Telesur" },
  { pattern: /\bvtv\b/i, outlet: "VTV" },
  { pattern: /tves/i, outlet: "TVes" },
]

// Per-source fallback when filename gives no signal. All current files in this
// playlist are Venevisión broadcasts even though only some filenames mention it.
const SOURCE_DEFAULT_OUTLET: Record<string, string> = {
  PLyhdNAFV1DMJATESD8ItT1bgy8QlIXDQA: "Venevisión",
}

function inferOutlet(sourceId: string, filename: string): OutletInfo {
  const source = YOUTUBE_SOURCES.find((s) => s.id === sourceId)
  const category = source?.category ?? "state-media"
  const byKeyword = FILENAME_OUTLET_KEYWORDS.find((k) => k.pattern.test(filename))
  if (byKeyword) return { outlet: byKeyword.outlet, category, sourceId }
  if (SOURCE_DEFAULT_OUTLET[sourceId]) return { outlet: SOURCE_DEFAULT_OUTLET[sourceId], category, sourceId }
  return { outlet: source?.name ?? sourceId, category, sourceId }
}

// ---------- Verdict schema ----------

type Classification = "regime" | "opposition" | "press_freedom" | "international" | "economy" | "crime_sports_other"

interface SegmentVerdict {
  seq: number
  topic: string
  summary: string
  classification: Classification
  word_share_pct: number // 0–100, share of transcript word count
  regime_sentiment: number // -1..1; 0 if regime not discussed
  opposition_sentiment: number // -1..1; 0 if opposition not discussed
  critical_of_regime: boolean
  figures_mentioned: Array<{ name: string; sentiment: number; mentions: number }>
}

interface PressIncident {
  type: string
  target: string
  location?: string
  description: string
}

interface TranscriptVerdict {
  segments: SegmentVerdict[]
  press_incidents: PressIncident[]
  notes?: string
}

interface CacheEntry {
  model: string
  verdict: TranscriptVerdict
  ran_at: string
  // Cheap fingerprint to invalidate cache if the transcript changes.
  word_count: number
}

// ---------- CLI ----------

interface CliArgs {
  start?: string
  end?: string
  only?: string
  source?: string
  force: boolean
  dryRun: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const out: CliArgs = { force: false, dryRun: false }
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
      case "--source":
        out.source = args[++i]
        break
      case "--force":
        out.force = true
        break
      case "--dry-run":
        out.dryRun = true
        break
      case "--help":
        console.log(`Usage: tsx scripts/pillar1-analyze-transcripts.ts [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--source ID] [--only FILENAME] [--force] [--dry-run]`)
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

/**
 * Read the processed-transcripts ledger CSV (if it exists) as a fast lookup of
 * what's already analyzed. Used in dry-run and at startup to print "X new / Y
 * already processed" without touching the cache JSON.
 */
function loadLedgerKeys(): Set<string> {
  const path = join(CLEANED_DIR, "processed-transcripts.csv")
  if (!existsSync(path)) return new Set()
  const lines = readFileSync(path, "utf-8").split("\n").slice(1).filter(Boolean)
  const out = new Set<string>()
  for (const line of lines) {
    // Naive parse: date,outlet,source_id,filename,... — source_id is col 2, filename col 3.
    const cols = line.split(",")
    if (cols.length < 4) continue
    out.add(`${cols[2]}|${cols[3]}`)
  }
  return out
}

interface TranscriptFile {
  sourceId: string
  filename: string
  filepath: string
  uploadDateIso: string // YYYY-MM-DD parsed from filename prefix
  outlet: string
  category: YouTubeSource["category"]
  wordCount: number
  text: string
}

function listTranscripts(args: CliArgs): TranscriptFile[] {
  if (!existsSync(TRANSCRIPTS_DIR)) {
    console.error(`[pillar1] Transcripts dir not found: ${TRANSCRIPTS_DIR}`)
    return []
  }
  const sourceDirs = readdirSync(TRANSCRIPTS_DIR).filter((d) => {
    const p = join(TRANSCRIPTS_DIR, d)
    return statSync(p).isDirectory() && (!args.source || d === args.source)
  })

  const all: TranscriptFile[] = []
  for (const sourceId of sourceDirs) {
    const dir = join(TRANSCRIPTS_DIR, sourceId)
    const files = readdirSync(dir).filter((f) => f.endsWith(".txt"))
    for (const filename of files) {
      const datePrefix = filename.slice(0, 8) // YYYYMMDD
      if (!/^\d{8}$/.test(datePrefix)) continue
      const uploadDateIso = `${datePrefix.slice(0, 4)}-${datePrefix.slice(4, 6)}-${datePrefix.slice(6, 8)}`
      if (args.start && uploadDateIso < args.start) continue
      if (args.end && uploadDateIso > args.end) continue
      if (args.only && filename !== args.only && !filename.includes(args.only)) continue
      const filepath = join(dir, filename)
      const text = readFileSync(filepath, "utf-8")
      const wordCount = text.trim().split(/\s+/).length
      const { outlet, category } = inferOutlet(sourceId, filename)
      all.push({ sourceId, filename, filepath, uploadDateIso, outlet, category, wordCount, text })
    }
  }
  all.sort((a, b) => a.uploadDateIso.localeCompare(b.uploadDateIso))
  return all
}

// ---------- LLM ----------

const FIGURE_LIST_BULLETS = FIGURES.map(
  (f) => `  - ${f.canonical} (aliases: ${f.aliases.join(", ")}) [${f.side}]`
).join("\n")

const SYSTEM_PROMPT = `You are a media analyst classifying Venezuelan TV news transcripts for a press-freedom index.

You will receive a single broadcast transcript (Spanish). Break it into 5–15 coherent SEGMENTS (news items / stories), then return a strict JSON object with:

{
  "segments": [
    {
      "seq": 1,                                  // 1-based segment index
      "topic": "short label, ≤6 words",
      "summary": "one Spanish sentence summarizing the segment",
      "classification": "regime" | "opposition" | "press_freedom" | "international" | "economy" | "crime_sports_other",
      "word_share_pct": 12.5,                     // share of TRANSCRIPT word count, 0–100; segments must sum to ~100
      "regime_sentiment": -0.6,                   // -1=very critical of Maduro govt, 0=neutral/absent, +1=very favorable
      "opposition_sentiment": 0.3,                // -1=very critical of opposition, 0=neutral/absent, +1=very favorable
      "critical_of_regime": false,                // true iff this segment plainly criticizes the Maduro government
      "figures_mentioned": [
        { "name": "Nicolás Maduro", "sentiment": -0.4, "mentions": 2 }
      ]
    }
  ],
  "press_incidents": [
    {
      "type": "ban|arrest|censorship|threat|raid|license_revoked|website_blocked|journalist_attack|other",
      "target": "name of outlet, journalist, or platform affected",
      "location": "Venezuelan state or city if mentioned",
      "description": "one-sentence Spanish description"
    }
  ],
  "notes": "optional caveat if the transcript is short, repeats prior content, or is hard to classify"
}

CLASSIFICATION RULES:
- "regime": coverage centered on the Maduro government — its officials, decisions, ceremonies, military, PSUV, ministers, fiscal/judicial/AN, official propaganda. Use this even when the framing is critical, as long as the SUBJECT is the regime.
- "opposition": coverage centered on opposition figures, parties (Plataforma Unitaria, Vente Venezuela, Voluntad Popular, PJ, UNT…), exiled leaders, electoral grievances, opposition protests.
- "press_freedom": coverage of press bans, journalist arrests, blocked outlets, Conatel/SUSCERTE/SUNAVI actions on media, internet throttling, attacks on reporters.
- "international": foreign governments, sanctions, US (Trump/Rubio/State Dept), EU, OAS, UN, Colombia, Brazil, Russia, China, Iran, ICC, foreign migration policy.
- "economy": inflation, BCV/dollar, oil/PDVSA, fuel, salaries, remittances, sanctions impact on the economy.
- "crime_sports_other": local crime, weather, sports, entertainment, religion, lifestyle, anything else.

SENTIMENT RULES:
- regime_sentiment and opposition_sentiment must each be in [-1, 1].
- If the segment doesn't substantively cover that side, set its sentiment to 0 (neutral/absent).
- Anchor: state-media puff pieces about ministers = regime_sentiment ≥ +0.5. Denunciations by exiled press = regime_sentiment ≤ -0.5. Routine quoted statements without spin = around 0.
- "critical_of_regime" should be true only when the segment plainly criticizes the government (corruption, repression, failures). Routine coverage that reproduces official lines is not "critical".

FIGURES OF INTEREST — when these or their aliases appear, list them using the CANONICAL name on the left:
${FIGURE_LIST_BULLETS}

Also include any other clearly-named Venezuelan or international political/military figure who appears prominently; use the most complete Spanish form of their name. Do NOT list anchors, reporters, or generic civilians.

WORD-SHARE RULE: word_share_pct values must be reasonable estimates of how much of the broadcast each segment occupies, summing to approximately 100 (±5).

OUTPUT: return ONLY the JSON object. No preamble. No markdown fences.`

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
      // Headroom: a 15-segment verdict with figures + incidents averages ~3K
      // output tokens; long broadcasts with rich figure lists can exceed 5K.
      // Haiku 4.5 supports up to 64K output, so 16K is safe and avoids
      // truncated-JSON parse failures.
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API error (${res.status}): ${body}`)
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const text = json.content?.find((b) => b.type === "text")?.text
  if (!text) throw new Error(`No text in Anthropic response: ${JSON.stringify(json).slice(0, 500)}`)
  if (json.stop_reason === "max_tokens") {
    throw new Error(`Response truncated at max_tokens (output_tokens=${json.usage?.output_tokens}). Raise max_tokens.`)
  }
  return text
}

function parseVerdict(text: string): TranscriptVerdict {
  // Strip markdown fences, then locate the outermost JSON object. The model
  // occasionally prefaces with a sentence even when told not to — be lenient.
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  const first = cleaned.indexOf("{")
  const last = cleaned.lastIndexOf("}")
  if (first > 0 && last > first) cleaned = cleaned.slice(first, last + 1)
  let obj: TranscriptVerdict
  try {
    obj = JSON.parse(cleaned) as TranscriptVerdict
  } catch (err) {
    const preview = text.slice(0, 200).replace(/\s+/g, " ")
    const tailPreview = text.slice(-200).replace(/\s+/g, " ")
    throw new Error(`JSON parse failed: ${(err as Error).message}. Response head: "${preview}…" tail: "…${tailPreview}"`)
  }
  obj.segments = (obj.segments ?? []).map((s, i) => {
    const figures = (s.figures_mentioned ?? [])
      .map((f) => {
        const canonical = canonicalizeFigure(f.name)
        return canonical ? { name: canonical, sentiment: clamp(f.sentiment ?? 0, -1, 1), mentions: Math.max(1, f.mentions ?? 1) } : null
      })
      .filter((f): f is { name: string; sentiment: number; mentions: number } => f !== null)
    return {
      seq: s.seq ?? i + 1,
      topic: s.topic ?? "",
      summary: s.summary ?? "",
      classification: (s.classification ?? "crime_sports_other") as Classification,
      word_share_pct: clamp(s.word_share_pct ?? 0, 0, 100),
      regime_sentiment: clamp(s.regime_sentiment ?? 0, -1, 1),
      opposition_sentiment: clamp(s.opposition_sentiment ?? 0, -1, 1),
      critical_of_regime: Boolean(s.critical_of_regime),
      figures_mentioned: figures,
    }
  })
  obj.press_incidents = (obj.press_incidents ?? []).map((p) => ({
    type: p.type ?? "other",
    target: p.target ?? "",
    location: p.location,
    description: p.description ?? "",
  }))
  return obj
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(min, Math.min(max, n))
}

async function analyzeTranscript(t: TranscriptFile): Promise<TranscriptVerdict> {
  const user = `Outlet: ${t.outlet}
Category: ${t.category}
Broadcast date: ${t.uploadDateIso}
Filename: ${t.filename}
Transcript word count: ${t.wordCount}

--- TRANSCRIPT ---
${t.text}
--- END TRANSCRIPT ---`
  const text = await callHaiku([{ role: "user", content: user }])
  return parseVerdict(text)
}

// ---------- Aggregation ----------

interface DerivedSegment {
  date: string
  outlet: string
  sourceId: string
  filename: string
  category: YouTubeSource["category"]
  seq: number
  topic: string
  classification: Classification
  word_share_pct: number
  segment_words: number
  segment_minutes: number
  regime_sentiment: number
  opposition_sentiment: number
  critical_of_regime: boolean
  figures: Array<{ name: string; sentiment: number; mentions: number }>
}

function deriveSegments(t: TranscriptFile, v: TranscriptVerdict): DerivedSegment[] {
  return v.segments.map((s) => {
    const segment_words = Math.round((s.word_share_pct / 100) * t.wordCount)
    const segment_minutes = segment_words / WORDS_PER_MINUTE
    return {
      date: t.uploadDateIso,
      outlet: t.outlet,
      sourceId: t.sourceId,
      filename: t.filename,
      category: t.category,
      seq: s.seq,
      topic: s.topic,
      classification: s.classification,
      word_share_pct: s.word_share_pct,
      segment_words,
      segment_minutes,
      regime_sentiment: s.regime_sentiment,
      opposition_sentiment: s.opposition_sentiment,
      critical_of_regime: s.critical_of_regime,
      figures: s.figures_mentioned,
    }
  })
}

// ---------- CSV writers ----------

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = typeof value === "string" ? value : typeof value === "number" ? String(value) : JSON.stringify(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function writeCsv(filename: string, header: string[], rows: unknown[][]) {
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
  ensureDir(CLEANED_DIR)
  writeFileSync(join(CLEANED_DIR, filename), csv)
  console.log(`[pillar1] wrote ${rows.length} rows → ${filename}`)
}

function writeFiguresMentions(segments: DerivedSegment[]) {
  // Aggregate to (date, outlet, figure): mentions sum, avg sentiment weighted by mentions.
  type Key = string
  const agg = new Map<Key, { date: string; outlet: string; figure: string; mentions: number; sentimentNum: number; sentimentDen: number }>()
  for (const s of segments) {
    for (const f of s.figures) {
      const key = `${s.date}|${s.outlet}|${f.name}`
      const cur = agg.get(key) ?? { date: s.date, outlet: s.outlet, figure: f.name, mentions: 0, sentimentNum: 0, sentimentDen: 0 }
      cur.mentions += f.mentions
      cur.sentimentNum += f.sentiment * f.mentions
      cur.sentimentDen += f.mentions
      agg.set(key, cur)
    }
  }
  const figureMeta = new Map(FIGURES.map((f) => [f.canonical, f]))
  const rows = Array.from(agg.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.outlet.localeCompare(b.outlet) || b.mentions - a.mentions)
    .map((r) => [
      r.date,
      r.outlet,
      r.figure,
      figureMeta.get(r.figure)?.side ?? "other",
      r.mentions,
      r.sentimentDen === 0 ? 0 : Number((r.sentimentNum / r.sentimentDen).toFixed(3)),
    ])
  writeCsv(
    "figures-mentions.csv",
    ["date", "outlet", "figure", "side", "mentions", "sentiment_avg"],
    rows
  )
}

function writeFramingByOutlet(segments: DerivedSegment[]) {
  // Per (date, outlet): regime/opp sentiment weighted by segment_words (only segments that actually cover that side).
  type Key = string
  type Row = {
    date: string
    outlet: string
    segments: number
    regimeNum: number
    regimeDen: number
    oppNum: number
    oppDen: number
    criticalCount: number
    regimeCovered: number
    oppCovered: number
  }
  const agg = new Map<Key, Row>()
  for (const s of segments) {
    const key = `${s.date}|${s.outlet}`
    const cur = agg.get(key) ?? { date: s.date, outlet: s.outlet, segments: 0, regimeNum: 0, regimeDen: 0, oppNum: 0, oppDen: 0, criticalCount: 0, regimeCovered: 0, oppCovered: 0 }
    cur.segments += 1
    // Only weight segments that meaningfully cover that side (non-zero sentiment).
    if (s.regime_sentiment !== 0 || s.classification === "regime") {
      cur.regimeNum += s.regime_sentiment * s.segment_words
      cur.regimeDen += s.segment_words
      cur.regimeCovered += 1
    }
    if (s.opposition_sentiment !== 0 || s.classification === "opposition") {
      cur.oppNum += s.opposition_sentiment * s.segment_words
      cur.oppDen += s.segment_words
      cur.oppCovered += 1
    }
    if (s.critical_of_regime) cur.criticalCount += 1
    agg.set(key, cur)
  }
  const rows = Array.from(agg.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.outlet.localeCompare(b.outlet))
    .map((r) => [
      r.date,
      r.outlet,
      r.segments,
      r.regimeCovered,
      r.regimeDen === 0 ? 0 : Number((r.regimeNum / r.regimeDen).toFixed(3)),
      r.oppCovered,
      r.oppDen === 0 ? 0 : Number((r.oppNum / r.oppDen).toFixed(3)),
      r.criticalCount,
      r.segments === 0 ? 0 : Number(((r.criticalCount / r.segments) * 100).toFixed(1)),
    ])
  writeCsv(
    "framing-by-outlet.csv",
    [
      "date",
      "outlet",
      "segments_total",
      "regime_segments",
      "regime_sentiment_avg",
      "opposition_segments",
      "opposition_sentiment_avg",
      "critical_segments",
      "critical_pct",
    ],
    rows
  )
}

function writeAirtimeDaily(segments: DerivedSegment[]) {
  // Per (date, outlet): minutes broken out by classification.
  type Row = {
    date: string
    outlet: string
    regime: number
    opposition: number
    press_freedom: number
    international: number
    economy: number
    crime_sports_other: number
    total: number
  }
  const agg = new Map<string, Row>()
  for (const s of segments) {
    const key = `${s.date}|${s.outlet}`
    const cur = agg.get(key) ?? { date: s.date, outlet: s.outlet, regime: 0, opposition: 0, press_freedom: 0, international: 0, economy: 0, crime_sports_other: 0, total: 0 }
    cur[s.classification] += s.segment_minutes
    cur.total += s.segment_minutes
    agg.set(key, cur)
  }
  const rows = Array.from(agg.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.outlet.localeCompare(b.outlet))
    .map((r) => [
      r.date,
      r.outlet,
      r.regime.toFixed(2),
      r.opposition.toFixed(2),
      r.press_freedom.toFixed(2),
      r.international.toFixed(2),
      r.economy.toFixed(2),
      r.crime_sports_other.toFixed(2),
      r.total.toFixed(2),
    ])
  writeCsv(
    "airtime-daily.csv",
    [
      "date",
      "outlet",
      "regime_minutes",
      "opposition_minutes",
      "press_freedom_minutes",
      "international_minutes",
      "economy_minutes",
      "other_minutes",
      "total_minutes",
    ],
    rows
  )
}

interface FlatIncident extends PressIncident {
  date: string
  outlet: string
  filename: string
}

interface LedgerRow {
  date: string
  outlet: string
  source_id: string
  filename: string
  word_count: number
  segments: number
  press_incidents: number
  analyzed_at: string
  model: string
  status: "fresh" | "cached"
}

function writeProcessedLedger(rows: LedgerRow[]) {
  const sorted = rows.sort((a, b) => a.date.localeCompare(b.date) || a.outlet.localeCompare(b.outlet) || a.filename.localeCompare(b.filename))
  writeCsv(
    "processed-transcripts.csv",
    ["date", "outlet", "source_id", "filename", "word_count", "segments", "press_incidents", "analyzed_at", "model", "status"],
    sorted.map((r) => [r.date, r.outlet, r.source_id, r.filename, r.word_count, r.segments, r.press_incidents, r.analyzed_at, r.model, r.status])
  )
}

function writePressIncidents(incidents: FlatIncident[]) {
  const rows = incidents
    .sort((a, b) => a.date.localeCompare(b.date) || a.outlet.localeCompare(b.outlet))
    .map((p) => [p.date, p.type, p.target, p.location ?? "", p.description, p.outlet, p.filename])
  writeCsv(
    "press-incidents.csv",
    ["date_observed", "type", "target", "location", "description", "source_outlet", "source_transcript"],
    rows
  )
}

function writeSummaryMetrics(
  segments: DerivedSegment[],
  incidents: FlatIncident[],
  transcripts: TranscriptFile[]
) {
  const dates = Array.from(new Set(transcripts.map((t) => t.uploadDateIso))).sort()
  const days = Math.max(1, dates.length)

  const totalSegments = segments.length
  const criticalSegments = segments.filter((s) => s.critical_of_regime).length
  const criticalPct = totalSegments === 0 ? 0 : (criticalSegments / totalSegments) * 100

  // Avg minutes per (broadcast-day): sum minutes per (date,outlet) then average per outlet across days they appear.
  // To stay simple, report avg minutes per BROADCAST (one transcript = one broadcast).
  const broadcasts = new Map<string, { regime: number; opposition: number; total: number }>()
  for (const s of segments) {
    const key = `${s.date}|${s.outlet}|${s.filename}`
    const cur = broadcasts.get(key) ?? { regime: 0, opposition: 0, total: 0 }
    if (s.classification === "regime") cur.regime += s.segment_minutes
    if (s.classification === "opposition") cur.opposition += s.segment_minutes
    cur.total += s.segment_minutes
    broadcasts.set(key, cur)
  }
  const bArr = Array.from(broadcasts.values())
  const regimeAvg = bArr.length === 0 ? 0 : bArr.reduce((s, b) => s + b.regime, 0) / bArr.length
  const oppositionAvg = bArr.length === 0 ? 0 : bArr.reduce((s, b) => s + b.opposition, 0) / bArr.length

  // Active outlets touched in window; active independent outlets = subset with category !== state-media.
  const outletCategory = new Map<string, YouTubeSource["category"]>()
  for (const t of transcripts) outletCategory.set(t.outlet, t.category)
  const activeOutlets = outletCategory.size
  const activeIndependentOutlets = Array.from(outletCategory.values()).filter((c) => c !== "state-media").length

  const rows: unknown[][] = [
    ["broadcast_days_covered", days, "Unique broadcast dates analyzed"],
    ["broadcasts_analyzed", transcripts.length, "Total transcripts processed"],
    ["segments_total", totalSegments, "Total news segments classified"],
    ["critical_coverage_pct", Number(criticalPct.toFixed(2)), "% of segments plainly critical of the regime"],
    ["regime_minutes_per_broadcast_avg", Number(regimeAvg.toFixed(2)), `Avg minutes per broadcast classified as regime coverage (@${WORDS_PER_MINUTE} wpm)`],
    ["opposition_minutes_per_broadcast_avg", Number(oppositionAvg.toFixed(2)), `Avg minutes per broadcast classified as opposition coverage (@${WORDS_PER_MINUTE} wpm)`],
    ["press_incidents_in_window", incidents.length, "Reported press-freedom violations across all transcripts in window"],
    ["active_outlets", activeOutlets, "Distinct outlets with at least one analyzed broadcast"],
    ["active_independent_outlets", activeIndependentOutlets, "Active outlets NOT classified as state-media"],
  ]
  writeCsv("summary-metrics.csv", ["metric", "value", "description"], rows)
}

// ---------- Main ----------

async function main() {
  const args = parseArgs()
  if (!args.dryRun && (!ANTHROPIC_KEY || ANTHROPIC_KEY.startsWith("your-"))) {
    console.error("[pillar1] ANTHROPIC_API_KEY is not set in .env.local. Aborting.")
    console.error("[pillar1] Run with --dry-run to skip LLM calls and only write the sources CSV.")
    process.exit(1)
  }

  const transcripts = listTranscripts(args)
  const ledgerSeen = loadLedgerKeys()
  const cache = loadCache()
  const isProcessed = (t: TranscriptFile) => {
    const key = `${t.sourceId}|${t.filename}`
    if (args.force) return false
    if (ledgerSeen.has(key)) return true
    const c = cache[key]
    return Boolean(c && c.model === HAIKU_MODEL && c.word_count === t.wordCount)
  }
  const newOnes = transcripts.filter((t) => !isProcessed(t))
  const alreadyProcessed = transcripts.length - newOnes.length

  console.log(`[pillar1] Found ${transcripts.length} transcripts in window (${alreadyProcessed} already processed, ${newOnes.length} new)`)
  for (const t of newOnes.slice(0, 5)) {
    console.log(`  NEW    ${t.uploadDateIso} ${t.outlet.padEnd(12)} ${t.wordCount.toString().padStart(5)}w  ${t.filename}`)
  }
  if (newOnes.length > 5) console.log(`  …and ${newOnes.length - 5} more new`)

  if (args.dryRun) {
    console.log("[pillar1] --dry-run: skipping LLM calls. Done.")
    return
  }

  const allSegments: DerivedSegment[] = []
  const allIncidents: FlatIncident[] = []
  const ledger: LedgerRow[] = []
  let llmCalls = 0
  let errors = 0

  for (const t of transcripts) {
    const cacheKey = `${t.sourceId}|${t.filename}`
    let verdict: TranscriptVerdict | null = null
    let status: "fresh" | "cached" = "fresh"
    let analyzedAt: string

    const cached = cache[cacheKey]
    const cacheValid = cached?.model === HAIKU_MODEL && cached.word_count === t.wordCount
    if (!args.force && cacheValid) {
      verdict = cached.verdict
      analyzedAt = cached.ran_at
      status = "cached"
      console.log(`[pillar1] cache hit: ${t.filename}`)
    } else {
      try {
        console.log(`[pillar1] analyzing: ${t.filename} (${t.wordCount} words)`)
        verdict = await analyzeTranscript(t)
        analyzedAt = new Date().toISOString()
        cache[cacheKey] = { model: HAIKU_MODEL, verdict, ran_at: analyzedAt, word_count: t.wordCount }
        llmCalls++
        if (llmCalls % 5 === 0) saveCache(cache)
      } catch (err) {
        errors++
        console.error(`[pillar1] ERROR on ${t.filename}: ${(err as Error).message}`)
        continue
      }
    }

    if (!verdict) continue
    allSegments.push(...deriveSegments(t, verdict))
    for (const p of verdict.press_incidents) {
      allIncidents.push({ ...p, date: t.uploadDateIso, outlet: t.outlet, filename: t.filename })
    }
    ledger.push({
      date: t.uploadDateIso,
      outlet: t.outlet,
      source_id: t.sourceId,
      filename: t.filename,
      word_count: t.wordCount,
      segments: verdict.segments.length,
      press_incidents: verdict.press_incidents.length,
      analyzed_at: analyzedAt,
      model: HAIKU_MODEL,
      status,
    })
  }
  saveCache(cache)

  writeFiguresMentions(allSegments)
  writeFramingByOutlet(allSegments)
  writeAirtimeDaily(allSegments)
  writePressIncidents(allIncidents)
  writeSummaryMetrics(allSegments, allIncidents, transcripts)
  writeProcessedLedger(ledger)

  console.log(`\n[pillar1] === Summary ===`)
  console.log(`  Transcripts: ${transcripts.length} (${alreadyProcessed} reused from cache, ${llmCalls} new LLM calls)`)
  console.log(`  Errors:      ${errors}`)
  console.log(`  Segments:    ${allSegments.length}`)
  console.log(`  Incidents:   ${allIncidents.length}`)
  console.log(`  CSVs in:     ${CLEANED_DIR}`)
}

main().catch((err) => {
  console.error("[pillar1] Fatal error:", err)
  process.exit(1)
})
