import { readPillarCsv } from "./csv"

// =============================================================================
// Pillar 2 — server-side data layer
//
// Reads the three CSVs produced by `pnpm pillar2:analyze` and reshapes them
// into the metrics + chart-ready structures consumed by app/(pillars)/pillar-2.
// Server-only; never import into a client component.
// =============================================================================

const PILLAR_DIR = "pillar-2-civic-liberty"

// ---------- Raw row types ----------

export interface ProtestDailyRow {
  date: string
  protest_occurred: boolean
  protest_categories: string[]
  scale: string
  impact: number
  repression_level: number
  repression_types: string[]
  locations: Array<{ state?: string; municipality?: string; city?: string; neighborhood?: string }>
  state_count: number
  source_count: number
  source_handles: string[]
  source_tweet_ids: string[]
  confidence: number
}

export interface PrisonerRow {
  date_observed: string
  name: string
  status: string
  category: string
  location: string
  charges: string
  source_handle: string
  source_tweet_id: string
}

export interface RunningTotalRow {
  date_observed: string
  metric: string
  value: number
  as_of_date: string
  context: string
  source_handle: string
}

// ---------- Loaders ----------

function safeJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export async function loadProtestsDaily(): Promise<ProtestDailyRow[]> {
  const raw = await readPillarCsv(PILLAR_DIR, "protests-daily.csv")
  return raw.map((r) => ({
    date: r.date,
    protest_occurred: r.protest_occurred === "true",
    protest_categories: safeJson<string[]>(r.protest_categories_json, []),
    scale: r.scale,
    impact: Number(r.impact || 0),
    repression_level: Number(r.repression_level || 0),
    repression_types: safeJson<string[]>(r.repression_types_json, []),
    locations: safeJson<ProtestDailyRow["locations"]>(r.locations_json, []),
    state_count: Number(r.state_count || 0),
    source_count: Number(r.source_count || 0),
    source_handles: safeJson<string[]>(r.source_handles_json, []),
    source_tweet_ids: safeJson<string[]>(r.source_tweet_ids_json, []),
    confidence: Number(r.confidence || 0),
  }))
}

export async function loadPrisoners(): Promise<PrisonerRow[]> {
  const raw = await readPillarCsv(PILLAR_DIR, "political-prisoners.csv")
  return raw.map((r) => ({
    date_observed: r.date_observed,
    name: r.name,
    status: r.status,
    category: r.category || "unknown",
    location: r.location,
    charges: r.charges,
    source_handle: r.source_handle,
    source_tweet_id: r.source_tweet_id,
  }))
}

export async function loadRunningTotals(): Promise<RunningTotalRow[]> {
  const raw = await readPillarCsv(PILLAR_DIR, "prisoner-running-totals.csv")
  return raw.map((r) => ({
    date_observed: r.date_observed,
    metric: r.metric,
    value: Number(r.value || 0),
    as_of_date: r.as_of_date,
    context: r.context,
    source_handle: r.source_handle,
  }))
}

// ---------- Aggregations ----------

const STATE_BLACKLIST = new Set(["all_states", "Nacional", "Países Bajos", ""])

export interface HeadlineMetrics {
  protestDays: number
  totalDays: number
  windowStart: string
  windowEnd: string
  // Foro Penal current running total of political prisoners (latest extracted figure).
  politicalPrisonersCurrent: number | null
  politicalPrisonersAsOf: string | null
  politicalPrisonersSource: string | null
  // Days where reported repression reached at least arrests (level >= 2).
  repressedProtestDays: number
  // Number of distinct Venezuelan states with any protest activity in the window.
  statesWithActivity: number
}

// Types + label/order constants live in a fs-free file so client components
// can import them safely. Re-export here so existing internal imports keep
// working.
export type {
  DailyProtestPoint,
  StateActivity,
  PrisonerCategoryRow,
  PrisonerTimePoint,
} from "./pillar-2-types"
import type {
  DailyProtestPoint,
  StateActivity,
  PrisonerCategoryRow,
  PrisonerTimePoint,
} from "./pillar-2-types"

export interface Pillar2Data {
  metrics: HeadlineMetrics
  daily: DailyProtestPoint[]
  categoryTotals: Array<{ category: string; days: number }>
  states: StateActivity[]
  prisonersByCategory: PrisonerCategoryRow[]
  prisonerCumulative: PrisonerTimePoint[]
  prisonerCategories: string[]
  runningTotalsLatestForCharting: RunningTotalRow[]
}

const PRISONER_CATEGORIES = ["civilian", "journalist", "military", "politician", "minor", "indigenous", "unknown"] as const

export async function loadPillar2Data(): Promise<Pillar2Data> {
  const [daily, prisoners, totals] = await Promise.all([loadProtestsDaily(), loadPrisoners(), loadRunningTotals()])

  // --- Headline metrics ---
  const protestDays = daily.filter((d) => d.protest_occurred).length
  const repressedProtestDays = daily.filter((d) => d.repression_level >= 2).length
  const states = new Set<string>()
  for (const d of daily) {
    for (const l of d.locations) {
      const s = (l.state ?? "").trim()
      if (s && !STATE_BLACKLIST.has(s)) states.add(s)
    }
  }

  // Foro Penal headline running total: pick latest `total_political_prisoners`-style metric.
  // Acceptable metric names cover the various ways the LLM phrased the same idea.
  const HEADLINE_METRIC_PATTERNS = [/^total_political_prisoners$/i, /^political_prisoners_total$/i, /^political_prisoners_adults$/i]
  const headlineCandidates = totals
    .filter((t) => HEADLINE_METRIC_PATTERNS.some((re) => re.test(t.metric)))
    .sort((a, b) => (a.as_of_date || a.date_observed).localeCompare(b.as_of_date || b.date_observed))
  const latest = headlineCandidates[headlineCandidates.length - 1] ?? null

  const metrics: HeadlineMetrics = {
    protestDays,
    totalDays: daily.length,
    windowStart: daily[0]?.date ?? "",
    windowEnd: daily[daily.length - 1]?.date ?? "",
    politicalPrisonersCurrent: latest?.value ?? null,
    politicalPrisonersAsOf: latest?.as_of_date || latest?.date_observed || null,
    politicalPrisonersSource: latest?.source_handle ?? null,
    repressedProtestDays,
    statesWithActivity: states.size,
  }

  // --- Daily timeline (for Chart 1) ---
  const dailyPoints: DailyProtestPoint[] = daily.map((d) => ({
    date: d.date,
    protestOccurred: d.protest_occurred,
    categories: d.protest_categories,
    repressionLevel: d.repression_level,
    scale: d.scale,
    stateCount: d.state_count,
  }))

  // Category totals across the window (days that touched each category).
  const catCounts: Record<string, number> = {}
  for (const d of daily) {
    if (!d.protest_occurred) continue
    const seen = new Set<string>()
    for (const c of d.protest_categories) {
      if (seen.has(c)) continue
      seen.add(c)
      catCounts[c] = (catCounts[c] ?? 0) + 1
    }
  }
  const categoryTotals = Object.entries(catCounts)
    .map(([category, days]) => ({ category, days }))
    .sort((a, b) => b.days - a.days)

  // --- States (for Chart 2) ---
  const stateMap = new Map<string, StateActivity>()
  for (const d of daily) {
    if (!d.protest_occurred) continue
    const ym = d.date.slice(0, 7) // "YYYY-MM"
    const daySeen = new Set<string>()
    for (const l of d.locations) {
      const s = (l.state ?? "").trim()
      if (!s || STATE_BLACKLIST.has(s) || daySeen.has(s)) continue
      daySeen.add(s)
      let row = stateMap.get(s)
      if (!row) {
        row = { state: s, total: 0, byMonth: {} }
        stateMap.set(s, row)
      }
      row.total += 1
      row.byMonth[ym] = (row.byMonth[ym] ?? 0) + 1
    }
  }
  const statesList: StateActivity[] = Array.from(stateMap.values()).sort((a, b) => b.total - a.total)

  // --- Prisoners by category (Chart 3) ---
  const byCategoryStatus: Record<string, Record<string, number>> = {}
  for (const p of prisoners) {
    const cat = PRISONER_CATEGORIES.includes(p.category as (typeof PRISONER_CATEGORIES)[number])
      ? p.category
      : "unknown"
    if (!byCategoryStatus[cat]) byCategoryStatus[cat] = {}
    byCategoryStatus[cat][p.status] = (byCategoryStatus[cat][p.status] ?? 0) + 1
  }
  const prisonersByCategory: PrisonerCategoryRow[] = Object.entries(byCategoryStatus)
    .map(([category, s]) => ({
      category,
      detained: s.detained ?? 0,
      released: s.released ?? 0,
      missing: s.missing ?? 0,
      sentenced: s.sentenced ?? 0,
      other: (s.other ?? 0) + (s.transferred ?? 0),
      total: Object.values(s).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total)

  // Prisoner cumulative over time (by category). One point per observed date.
  const dateSeq = Array.from(new Set(prisoners.map((p) => p.date_observed))).sort()
  const cumulative: Record<string, number> = {}
  const prisonerCumulative: PrisonerTimePoint[] = []
  for (const date of dateSeq) {
    const todays = prisoners.filter((p) => p.date_observed === date)
    for (const p of todays) {
      const cat = PRISONER_CATEGORIES.includes(p.category as (typeof PRISONER_CATEGORIES)[number])
        ? p.category
        : "unknown"
      cumulative[cat] = (cumulative[cat] ?? 0) + 1
    }
    prisonerCumulative.push({ date, byCategory: { ...cumulative } })
  }
  const prisonerCategories = prisonersByCategory.map((r) => r.category)

  return {
    metrics,
    daily: dailyPoints,
    categoryTotals,
    states: statesList,
    prisonersByCategory,
    prisonerCumulative,
    prisonerCategories,
    runningTotalsLatestForCharting: totals.slice(-20),
  }
}

// Used by chart components for consistent ordering + label-friendly names.
// All four constants live in pillar-2-types.ts; re-exported for back-compat
// with existing imports inside this module.
export {
  PROTEST_CATEGORY_LABEL,
  PROTEST_CATEGORY_ORDER,
  PRISONER_CATEGORY_LABEL,
  PRISONER_CATEGORY_ORDER,
} from "./pillar-2-types"
