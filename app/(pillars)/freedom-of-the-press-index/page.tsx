import type { Metadata } from "next"
import { getPillar } from "@/lib/data/pillars"
import { readPillarCsv, type CsvRow } from "@/lib/data/csv"
import {
  PillarHero,
  PillarSection,
} from "@/components/pillars/pillar-shell"
import {
  MetricCard,
  RegimeVsOppositionChart,
  TopFiguresChart,
  PressIncidentsChart,
  TopicMixChart,
  CriticalCoverageTrendChart,
  FigureMentionsOverTimeChart,
  type AirtimeDayPoint,
  type FigureBar,
  type PressIncident,
  type TopicMixDayPoint,
  type CriticalCoveragePoint,
  type FigureMentionsOverTimePoint,
  type FigureSeries,
} from "@/components/pillars/pillar-1-charts"

const pillar = getPillar("freedom-of-the-press-index")

export const metadata: Metadata = {
  title: `${pillar.title} — Venezuelan Transition Tracker`,
  description: pillar.description,
}

// Server component — reads cleaned CSVs at request time. CSVs are produced by
// `npm run pillar1:analyze`. Missing files render placeholders.
export default async function Pillar1Page() {
  const [summary, airtime, figures, ledger, incidents, framing] = await Promise.all([
    safeRead("summary-metrics.csv"),
    safeRead("airtime-daily.csv"),
    safeRead("figures-mentions.csv"),
    safeRead("processed-transcripts.csv"),
    safeRead("press-incidents.csv"),
    safeRead("framing-by-outlet.csv"),
  ])

  const summaryMap = Object.fromEntries(summary.map((r) => [r.metric, r.value]))
  const dailyAirtime = aggregateAirtimeByDate(airtime)
  const topicMix = aggregateTopicMixByDate(airtime)
  const topFigures = aggregateTopFigures(figures, 12)
  const { points: figureTimePoints, series: figureSeries } = aggregateFigureMentionsOverTime(figures, 6)
  const pressIncidents = mapPressIncidents(incidents)
  const criticalCoverage = aggregateCriticalCoverageByDate(framing)
  const lastAnalyzedAt = pickLatest(ledger.map((r) => r.analyzed_at).filter(Boolean))

  return (
    <>
      <PillarHero pillar={pillar} />

      <PillarSection
        label="Headline metrics"
        description={
          ledger.length > 0
            ? `Derived from ${ledger.length} analyzed broadcasts across ${distinct(ledger.map((r) => r.outlet)).length} outlet(s). Last refresh: ${lastAnalyzedAt ?? "—"}.`
            : "Top-level indicators summarizing the state of press freedom in Venezuela. Run `npm run pillar1:analyze` to populate."
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Critical coverage"
            value={fmtNum(summaryMap["critical_coverage_pct"], 1)}
            unit="%"
            hint="% of segments critical of the regime"
          />
          <MetricCard
            label="Opposition airtime"
            value={fmtNum(summaryMap["opposition_minutes_per_broadcast_avg"], 1)}
            unit="min"
            hint="Avg minutes per broadcast on opposition coverage"
          />
          <MetricCard
            label="Regime airtime"
            value={fmtNum(summaryMap["regime_minutes_per_broadcast_avg"], 1)}
            unit="min"
            hint="Avg minutes per broadcast on regime coverage"
          />
          <MetricCard
            label="Press incidents"
            value={fmtNum(summaryMap["press_incidents_in_window"], 0)}
            hint="Reported violations across analyzed broadcasts"
          />
        </div>
      </PillarSection>

      <PillarSection
        label="Coverage balance"
        title="Regime vs opposition coverage over time"
        description="Daily airtime — in minutes per day across all analyzed broadcasts — devoted to coverage of the regime versus the opposition. Derived from broadcast transcripts."
      >
        <RegimeVsOppositionChart data={dailyAirtime} />
      </PillarSection>

      <PillarSection
        label="Topic mix"
        title="What broadcasts spend their time on"
        description="Daily airtime broken down by topic across all analyzed broadcasts. Useful for spotting whether broadcasts cover press-freedom issues directly, or how much oxygen economy or international coverage gets relative to domestic politics."
      >
        <TopicMixChart data={topicMix} />
      </PillarSection>

      <PillarSection
        label="Critical coverage"
        title="How often broadcasts criticize the regime"
        description="Daily share of news segments classified as plainly critical of the regime. The dashed line marks the in-window average."
      >
        <CriticalCoverageTrendChart data={criticalCoverage} />
      </PillarSection>

      <PillarSection
        label="Who's on screen"
        title="Who appears, where, and how often?"
        description="Top political figures by mention count across analyzed broadcasts, with mention-weighted sentiment in context."
      >
        <TopFiguresChart figures={topFigures} />
      </PillarSection>

      <PillarSection
        label="Figure attention over time"
        title="Which figures are gaining or losing airtime?"
        description="Cumulative mentions of the top six figures across all analyzed broadcasts. Steep slopes mark sustained coverage windows; flat lines mark periods of erasure."
      >
        <FigureMentionsOverTimeChart data={figureTimePoints} series={figureSeries} mode="cumulative" />
      </PillarSection>

      <PillarSection
        label="Press freedom incidents"
        title="Reported violations on air"
        description="Discrete press-freedom events surfaced from broadcast transcripts — arrests, attacks on journalists, censorship, bans, and related actions. The breakdown shows the mix; the list surfaces the most recent reports."
      >
        <PressIncidentsChart incidents={pressIncidents} />
      </PillarSection>

      <PillarSection
        label="Sources & methodology"
        title="How this index is built"
        description="Broadcast transcripts come from the press-freedom/ pipeline (yt-dlp + mlx-whisper). Semantic analysis runs via `scripts/pillar1-analyze-transcripts.ts`, which calls Claude Haiku to classify segments, score regime/opposition sentiment, count figure mentions, and flag press-freedom incidents. The script keeps a ledger of analyzed transcripts so future runs only process new files."
      >
        <p className="text-xs text-muted-foreground/70">
          Raw data: <code className="font-mono">data/{pillar.dataDir}/raw/</code> ·
          Cleaned data: <code className="font-mono">data/{pillar.dataDir}/cleaned/</code> ·
          Ledger: <code className="font-mono">processed-transcripts.csv</code>
        </p>
      </PillarSection>
    </>
  )
}

// ---------- Helpers ----------

async function safeRead(file: string): Promise<CsvRow[]> {
  try {
    return await readPillarCsv(pillar.dataDir, file)
  } catch {
    return []
  }
}

function aggregateAirtimeByDate(rows: CsvRow[]): AirtimeDayPoint[] {
  const byDate = new Map<string, AirtimeDayPoint>()
  for (const r of rows) {
    const date = r.date
    if (!date) continue
    const cur = byDate.get(date) ?? { date, regimeMinutes: 0, oppositionMinutes: 0 }
    cur.regimeMinutes += Number(r.regime_minutes ?? 0) || 0
    cur.oppositionMinutes += Number(r.opposition_minutes ?? 0) || 0
    byDate.set(date, cur)
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function aggregateTopicMixByDate(rows: CsvRow[]): TopicMixDayPoint[] {
  const byDate = new Map<string, TopicMixDayPoint>()
  for (const r of rows) {
    const date = r.date
    if (!date) continue
    const cur =
      byDate.get(date) ?? {
        date,
        regime: 0,
        opposition: 0,
        pressFreedom: 0,
        international: 0,
        economy: 0,
        other: 0,
      }
    cur.regime += Number(r.regime_minutes ?? 0) || 0
    cur.opposition += Number(r.opposition_minutes ?? 0) || 0
    cur.pressFreedom += Number(r.press_freedom_minutes ?? 0) || 0
    cur.international += Number(r.international_minutes ?? 0) || 0
    cur.economy += Number(r.economy_minutes ?? 0) || 0
    cur.other += Number(r.other_minutes ?? 0) || 0
    byDate.set(date, cur)
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function mapPressIncidents(rows: CsvRow[]): PressIncident[] {
  return rows
    .filter((r) => r.date_observed)
    .map((r) => ({
      date: r.date_observed,
      type: (r.type || "other").toLowerCase(),
      target: r.target || "—",
      location: r.location || "",
      description: r.description || "",
      outlet: r.source_outlet || "",
    }))
}

function aggregateCriticalCoverageByDate(rows: CsvRow[]): CriticalCoveragePoint[] {
  // framing-by-outlet.csv is per-outlet-per-day. Collapse to one point per date,
  // weighting critical_pct by segments_total so multi-outlet days don't bias.
  const byDate = new Map<string, { criticalSegs: number; total: number }>()
  for (const r of rows) {
    const date = r.date
    if (!date) continue
    const total = Number(r.segments_total ?? 0) || 0
    const critical = Number(r.critical_segments ?? 0) || 0
    const cur = byDate.get(date) ?? { criticalSegs: 0, total: 0 }
    cur.criticalSegs += critical
    cur.total += total
    byDate.set(date, cur)
  }
  return Array.from(byDate.entries())
    .map(([date, { criticalSegs, total }]) => ({
      date,
      criticalPct: total === 0 ? 0 : (criticalSegs / total) * 100,
      segmentsTotal: total,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Pivot figures-mentions.csv into a per-date timeline for the top N most-mentioned
 * figures. Returns a sparse `byFigure` map per date (omitted = 0), plus the series
 * metadata the chart needs for its legend / colors / end-of-line labels.
 */
function aggregateFigureMentionsOverTime(
  rows: CsvRow[],
  topN: number
): { points: FigureMentionsOverTimePoint[]; series: FigureSeries[] } {
  if (rows.length === 0) return { points: [], series: [] }

  // First pass: totals + side per figure.
  const totals = new Map<string, { side: string; mentions: number }>()
  for (const r of rows) {
    const name = r.figure
    if (!name) continue
    const mentions = Number(r.mentions ?? 0) || 0
    const cur = totals.get(name) ?? { side: r.side || "other", mentions: 0 }
    cur.mentions += mentions
    if (r.side) cur.side = r.side
    totals.set(name, cur)
  }
  const topNames = Array.from(totals.entries())
    .sort((a, b) => b[1].mentions - a[1].mentions)
    .slice(0, topN)
    .map(([name]) => name)
  const topSet = new Set(topNames)

  // Second pass: bucket by date, but only for top figures.
  const byDate = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const name = r.figure
    if (!name || !topSet.has(name)) continue
    const date = r.date
    if (!date) continue
    const mentions = Number(r.mentions ?? 0) || 0
    const bucket = byDate.get(date) ?? {}
    bucket[name] = (bucket[name] ?? 0) + mentions
    byDate.set(date, bucket)
  }

  const points: FigureMentionsOverTimePoint[] = Array.from(byDate.entries())
    .map(([date, byFigure]) => ({ date, byFigure }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const series: FigureSeries[] = topNames.map((name) => ({
    name,
    side: totals.get(name)!.side,
    total: totals.get(name)!.mentions,
  }))

  return { points, series }
}

function aggregateTopFigures(rows: CsvRow[], topN: number): FigureBar[] {
  const byFigure = new Map<string, FigureBar>()
  for (const r of rows) {
    const name = r.figure
    if (!name) continue
    const mentions = Number(r.mentions ?? 0) || 0
    const sentiment = Number(r.sentiment_avg ?? 0) || 0
    const cur = byFigure.get(name) ?? { name, side: r.side || "other", mentions: 0, sentiment: 0 }
    // Sentiment is a weighted average; recompute against running mentions total.
    const totalMentions = cur.mentions + mentions
    cur.sentiment = totalMentions === 0 ? 0 : (cur.sentiment * cur.mentions + sentiment * mentions) / totalMentions
    cur.mentions = totalMentions
    if (r.side) cur.side = r.side
    byFigure.set(name, cur)
  }
  return Array.from(byFigure.values())
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, topN)
}

function fmtNum(raw: string | undefined, digits: number): string | null {
  if (raw === undefined || raw === "") return null
  const n = Number(raw)
  if (Number.isNaN(n)) return null
  return n.toFixed(digits)
}

function distinct<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function pickLatest(isoStrings: string[]): string | null {
  if (isoStrings.length === 0) return null
  const sorted = [...isoStrings].sort()
  const iso = sorted[sorted.length - 1]
  return iso.slice(0, 10) + " " + iso.slice(11, 16) + "Z"
}
