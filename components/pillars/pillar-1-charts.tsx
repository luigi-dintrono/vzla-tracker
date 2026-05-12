import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// =============================================================================
// Pillar 1 charts — server-rendered SVG, no client deps.
// All data is pre-aggregated by `scripts/pillar1-analyze-transcripts.ts`.
// =============================================================================

export function MetricCard({
  label,
  value,
  hint,
  unit,
}: {
  label: string
  value: string | number | null
  hint?: string
  unit?: string
}) {
  const empty = value === null || value === undefined || value === ""
  return (
    <Card className="gap-3 py-5 rounded-2xl">
      <CardHeader className="px-5">
        <CardDescription className="text-[10px] font-display tracking-[0.2em] uppercase">
          {label}
        </CardDescription>
        <CardTitle className={`text-3xl font-light tabular-nums ${empty ? "text-muted-foreground/40" : ""}`}>
          {empty ? "—" : (
            <>
              {value}
              {unit && <span className="text-base text-muted-foreground/60 ml-1">{unit}</span>}
            </>
          )}
        </CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="px-5">
          <p className="text-xs text-muted-foreground/70">{hint}</p>
        </CardContent>
      )}
    </Card>
  )
}

export function EmptyChart({ note }: { note: string }) {
  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="aspect-[16/7] w-full grid place-items-center bg-muted/30 border-b border-border">
        <div className="text-center px-6">
          <p className="text-[10px] font-display tracking-[0.25em] uppercase text-muted-foreground/60 mb-2">
            No data yet
          </p>
          <p className="text-sm text-muted-foreground/80">{note}</p>
        </div>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        Run <code className="font-mono text-[11px]">npm run pillar1:analyze</code> to populate this chart.
      </CardContent>
    </Card>
  )
}

// ---------- Regime vs Opposition airtime over time ----------

export interface AirtimeDayPoint {
  date: string
  regimeMinutes: number
  oppositionMinutes: number
}

export function RegimeVsOppositionChart({ data }: { data: AirtimeDayPoint[] }) {
  if (data.length === 0) {
    return <EmptyChart note="airtime-daily.csv is empty — analyze some transcripts first." />
  }

  const width = 960
  const height = 360
  const padding = { top: 24, right: 24, bottom: 40, left: 48 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxMinutes = Math.max(
    1,
    ...data.map((d) => Math.max(d.regimeMinutes, d.oppositionMinutes))
  )
  // Round up to a nice tick value.
  const yMax = niceCeil(maxMinutes)

  const xScale = (i: number) =>
    data.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (data.length - 1)) * innerW
  const yScale = (v: number) => padding.top + innerH - (v / yMax) * innerH

  const regimePath = buildLinePath(data.map((d, i) => [xScale(i), yScale(d.regimeMinutes)] as [number, number]))
  const oppositionPath = buildLinePath(data.map((d, i) => [xScale(i), yScale(d.oppositionMinutes)] as [number, number]))

  const totalRegime = data.reduce((s, d) => s + d.regimeMinutes, 0)
  const totalOpp = data.reduce((s, d) => s + d.oppositionMinutes, 0)

  // X tick labels: aim for 6–8 evenly-spaced labels.
  const xTicks = pickTickIndices(data.length, 7)
  const yTicks = 4

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <Legend swatch="bg-red-500/80" label="Regime coverage" minutes={totalRegime} />
        <Legend swatch="bg-emerald-500/80" label="Opposition coverage" minutes={totalOpp} />
      </div>
      <div className="px-2 pb-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Regime vs opposition airtime over time">
          {/* Y grid + labels */}
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = (yMax / yTicks) * i
            const y = yScale(v)
            return (
              <g key={`y-${i}`}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                  {v.toFixed(0)}
                </text>
              </g>
            )
          })}
          {/* X tick labels */}
          {xTicks.map((idx) => (
            <text
              key={`x-${idx}`}
              x={xScale(idx)}
              y={height - padding.bottom + 18}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {formatShortDate(data[idx].date)}
            </text>
          ))}
          {/* Axis label */}
          <text
            x={padding.left - 36}
            y={padding.top + innerH / 2}
            transform={`rotate(-90 ${padding.left - 36} ${padding.top + innerH / 2})`}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            minutes / day
          </text>

          {/* Regime line + dots */}
          <path d={regimePath} fill="none" stroke="rgb(239 68 68 / 0.85)" strokeWidth={2} />
          {data.map((d, i) => (
            <circle key={`r-${i}`} cx={xScale(i)} cy={yScale(d.regimeMinutes)} r={2.5} fill="rgb(239 68 68 / 0.95)" />
          ))}

          {/* Opposition line + dots */}
          <path d={oppositionPath} fill="none" stroke="rgb(16 185 129 / 0.85)" strokeWidth={2} />
          {data.map((d, i) => (
            <circle key={`o-${i}`} cx={xScale(i)} cy={yScale(d.oppositionMinutes)} r={2.5} fill="rgb(16 185 129 / 0.95)" />
          ))}
        </svg>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        Daily regime vs opposition minutes summed across all analyzed broadcasts. Estimated from transcript word counts at 150 words/min.
      </CardContent>
    </Card>
  )
}

function Legend({ swatch, label, minutes }: { swatch: string; label: string; minutes: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={`inline-block w-3 h-3 rounded-full ${swatch}`} aria-hidden />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground/70">· {minutes.toFixed(0)} min total</span>
    </div>
  )
}

// ---------- Top figures (horizontal bars) ----------

export interface FigureBar {
  name: string
  side: string
  mentions: number
  sentiment: number
}

export function TopFiguresChart({ figures }: { figures: FigureBar[] }) {
  if (figures.length === 0) {
    return <EmptyChart note="figures-mentions.csv is empty — analyze some transcripts first." />
  }
  const max = Math.max(...figures.map((f) => f.mentions))
  const sideColor: Record<string, string> = {
    regime: "bg-red-500/70",
    opposition: "bg-emerald-500/70",
    "international-us": "bg-blue-500/70",
    "international-other": "bg-blue-400/70",
    historical: "bg-amber-500/70",
    other: "bg-muted-foreground/30",
  }
  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="p-5 space-y-2.5">
        {figures.map((f) => (
          <div key={f.name} className="grid grid-cols-[180px_1fr_56px] items-center gap-3">
            <div className="text-sm text-foreground/90 truncate" title={f.name}>{f.name}</div>
            <div className="relative h-5 rounded-sm bg-muted/40 overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${sideColor[f.side] ?? sideColor.other}`}
                style={{ width: `${(f.mentions / max) * 100}%` }}
              />
            </div>
            <div className="text-xs tabular-nums text-muted-foreground text-right">
              {f.mentions}
              <span className="text-muted-foreground/50 ml-1">·</span>
              <span className={sentimentColor(f.sentiment)} title="Mention-weighted sentiment in context">
                {" "}
                {fmtSentiment(f.sentiment)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <CardContent className="border-t border-border py-4 text-xs text-muted-foreground/70 flex flex-wrap gap-x-4 gap-y-1">
        <LegendDot color="bg-red-500/70" label="Regime" />
        <LegendDot color="bg-emerald-500/70" label="Opposition" />
        <LegendDot color="bg-blue-500/70" label="International" />
        <LegendDot color="bg-amber-500/70" label="Historical" />
        <span className="ml-auto text-muted-foreground/60">
          Number = total mentions · signed value = mention-weighted sentiment ({"−1…+1"}).
        </span>
      </CardContent>
    </Card>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} aria-hidden />
      <span>{label}</span>
    </span>
  )
}

function fmtSentiment(v: number): string {
  if (Math.abs(v) < 0.05) return "0.0"
  return (v > 0 ? "+" : "") + v.toFixed(2)
}

function sentimentColor(v: number): string {
  if (v > 0.15) return "text-emerald-600 dark:text-emerald-400"
  if (v < -0.15) return "text-red-600 dark:text-red-400"
  return "text-muted-foreground"
}

// ---------- Press incidents (breakdown + recent list) ----------

export interface PressIncident {
  date: string
  type: string
  target: string
  location: string
  description: string
  outlet: string
}

const INCIDENT_TYPE_META: Record<string, { label: string; color: string; swatch: string }> = {
  arrest: { label: "Arrests / detentions", color: "rgb(239 68 68 / 0.85)", swatch: "bg-red-500/80" },
  journalist_attack: { label: "Attacks on journalists", color: "rgb(217 70 239 / 0.85)", swatch: "bg-fuchsia-500/80" },
  censorship: { label: "Censorship", color: "rgb(245 158 11 / 0.85)", swatch: "bg-amber-500/80" },
  ban: { label: "Bans / shutdowns", color: "rgb(249 115 22 / 0.85)", swatch: "bg-orange-500/80" },
  other: { label: "Other", color: "rgb(148 163 184 / 0.75)", swatch: "bg-slate-400/70" },
}

export function PressIncidentsChart({ incidents }: { incidents: PressIncident[] }) {
  if (incidents.length === 0) {
    return <EmptyChart note="press-incidents.csv is empty — analyze some transcripts first." />
  }

  const byType = new Map<string, number>()
  for (const inc of incidents) {
    const key = INCIDENT_TYPE_META[inc.type] ? inc.type : "other"
    byType.set(key, (byType.get(key) ?? 0) + 1)
  }
  const orderedTypes = Array.from(byType.entries()).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(...orderedTypes.map(([, n]) => n))

  const recent = [...incidents]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="grid md:grid-cols-[280px_1fr] gap-0 border-b border-border">
        {/* Left: bar breakdown by type */}
        <div className="p-5 space-y-2.5 md:border-r border-border">
          <p className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground/70 mb-3">
            By type
          </p>
          {orderedTypes.map(([type, count]) => {
            const meta = INCIDENT_TYPE_META[type] ?? INCIDENT_TYPE_META.other
            return (
              <div key={type} className="grid grid-cols-[1fr_28px] items-center gap-3">
                <div>
                  <div className="text-xs text-foreground/90 mb-1">{meta.label}</div>
                  <div className="relative h-2 rounded-sm bg-muted/40 overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 ${meta.swatch}`}
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-sm tabular-nums text-muted-foreground text-right">{count}</div>
              </div>
            )
          })}
        </div>

        {/* Right: recent incidents */}
        <div className="p-5">
          <p className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground/70 mb-3">
            Most recent
          </p>
          <ol className="space-y-3">
            {recent.map((inc, i) => {
              const meta = INCIDENT_TYPE_META[inc.type] ?? INCIDENT_TYPE_META.other
              return (
                <li key={`${inc.date}-${i}`} className="grid grid-cols-[64px_8px_1fr] items-baseline gap-3">
                  <div className="text-xs tabular-nums text-muted-foreground/70 whitespace-nowrap">
                    {formatShortDate(inc.date)}
                  </div>
                  <span
                    className="inline-block w-2 h-2 rounded-full mt-1.5"
                    style={{ backgroundColor: meta.color }}
                    aria-hidden
                    title={meta.label}
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-foreground/90 truncate" title={inc.target}>
                      {inc.target}
                    </div>
                    <div className="text-xs text-muted-foreground/80 line-clamp-2">
                      {inc.description}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        {incidents.length} incidents extracted from analyzed broadcast transcripts. Each row is a discrete event reported on air; duplicates across re-airings are kept to preserve coverage signal.
      </CardContent>
    </Card>
  )
}

// ---------- Topic mix stacked area ----------

export interface TopicMixDayPoint {
  date: string
  regime: number
  opposition: number
  pressFreedom: number
  international: number
  economy: number
  other: number
}

const TOPIC_SERIES: Array<{ key: keyof Omit<TopicMixDayPoint, "date">; label: string; color: string; swatch: string }> = [
  { key: "regime", label: "Regime", color: "rgb(239 68 68 / 0.75)", swatch: "bg-red-500/75" },
  { key: "opposition", label: "Opposition", color: "rgb(16 185 129 / 0.75)", swatch: "bg-emerald-500/75" },
  { key: "pressFreedom", label: "Press freedom", color: "rgb(217 70 239 / 0.75)", swatch: "bg-fuchsia-500/75" },
  { key: "international", label: "International", color: "rgb(59 130 246 / 0.75)", swatch: "bg-blue-500/75" },
  { key: "economy", label: "Economy", color: "rgb(245 158 11 / 0.75)", swatch: "bg-amber-500/75" },
  { key: "other", label: "Other", color: "rgb(148 163 184 / 0.55)", swatch: "bg-slate-400/55" },
]

export function TopicMixChart({ data }: { data: TopicMixDayPoint[] }) {
  if (data.length === 0) {
    return <EmptyChart note="airtime-daily.csv is empty — analyze some transcripts first." />
  }

  const width = 960
  const height = 360
  const padding = { top: 24, right: 24, bottom: 40, left: 48 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const totals = data.map((d) =>
    TOPIC_SERIES.reduce((s, ser) => s + (d[ser.key] || 0), 0)
  )
  const yMax = niceCeil(Math.max(1, ...totals))

  const xScale = (i: number) =>
    data.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (data.length - 1)) * innerW
  const yScale = (v: number) => padding.top + innerH - (v / yMax) * innerH

  // Build cumulative band paths bottom→top.
  const cumulative = new Array(data.length).fill(0)
  const bands = TOPIC_SERIES.map((ser) => {
    const below = cumulative.slice()
    const above = data.map((d, i) => below[i] + (d[ser.key] || 0))
    above.forEach((v, i) => (cumulative[i] = v))
    const top = above.map((v, i) => [xScale(i), yScale(v)] as [number, number])
    const bottom = below.map((v, i) => [xScale(i), yScale(v)] as [number, number]).reverse()
    const path = [...top, ...bottom]
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
      .join(" ") + " Z"
    return { ser, path }
  })

  const xTicks = pickTickIndices(data.length, 7)
  const yTicks = 4

  // Totals for legend.
  const seriesTotals: Record<string, number> = {}
  for (const ser of TOPIC_SERIES) {
    seriesTotals[ser.key] = data.reduce((s, d) => s + (d[ser.key] || 0), 0)
  }

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        {TOPIC_SERIES.map((ser) => (
          <div key={ser.key} className="flex items-baseline gap-2">
            <span className={`inline-block w-3 h-3 rounded-sm ${ser.swatch}`} aria-hidden />
            <span className="text-xs text-muted-foreground">{ser.label}</span>
            <span className="text-xs tabular-nums text-muted-foreground/70">
              · {seriesTotals[ser.key].toFixed(0)} min
            </span>
          </div>
        ))}
      </div>
      <div className="px-2 pb-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          role="img"
          aria-label="Topic mix of broadcast airtime over time"
        >
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = (yMax / yTicks) * i
            const y = yScale(v)
            return (
              <g key={`y-${i}`}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                  {v.toFixed(0)}
                </text>
              </g>
            )
          })}
          {xTicks.map((idx) => (
            <text
              key={`x-${idx}`}
              x={xScale(idx)}
              y={height - padding.bottom + 18}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {formatShortDate(data[idx].date)}
            </text>
          ))}
          <text
            x={padding.left - 36}
            y={padding.top + innerH / 2}
            transform={`rotate(-90 ${padding.left - 36} ${padding.top + innerH / 2})`}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            minutes / day
          </text>

          {bands.map(({ ser, path }) => (
            <path key={ser.key} d={path} fill={ser.color} stroke="none" />
          ))}
        </svg>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        How total daily airtime breaks down by topic. The press-freedom band shows how often broadcasts cover press-freedom issues directly — a self-referential signal worth watching.
      </CardContent>
    </Card>
  )
}

// ---------- Critical coverage trend ----------

export interface CriticalCoveragePoint {
  date: string
  criticalPct: number
  segmentsTotal: number
}

export function CriticalCoverageTrendChart({ data }: { data: CriticalCoveragePoint[] }) {
  if (data.length === 0) {
    return <EmptyChart note="framing-by-outlet.csv is empty — analyze some transcripts first." />
  }

  const width = 960
  const height = 280
  const padding = { top: 24, right: 24, bottom: 40, left: 48 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const yMax = Math.max(10, niceCeil(Math.max(...data.map((d) => d.criticalPct))))
  const xScale = (i: number) =>
    data.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (data.length - 1)) * innerW
  const yScale = (v: number) => padding.top + innerH - (v / yMax) * innerH

  const linePath = buildLinePath(data.map((d, i) => [xScale(i), yScale(d.criticalPct)] as [number, number]))
  const areaPath =
    linePath +
    ` L ${xScale(data.length - 1).toFixed(2)} ${yScale(0).toFixed(2)}` +
    ` L ${xScale(0).toFixed(2)} ${yScale(0).toFixed(2)} Z`

  const avg = data.reduce((s, d) => s + d.criticalPct, 0) / data.length
  const totalSegments = data.reduce((s, d) => s + d.segmentsTotal, 0)
  const xTicks = pickTickIndices(data.length, 7)
  const yTicks = 4

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-amber-500/80" aria-hidden />
          <span className="text-xs text-muted-foreground">% segments critical of regime</span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground/70">
          · {avg.toFixed(1)}% avg · {totalSegments} segments
        </span>
      </div>
      <div className="px-2 pb-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          role="img"
          aria-label="Critical coverage percentage over time"
        >
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = (yMax / yTicks) * i
            const y = yScale(v)
            return (
              <g key={`y-${i}`}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                  {v.toFixed(0)}%
                </text>
              </g>
            )
          })}
          {xTicks.map((idx) => (
            <text
              key={`x-${idx}`}
              x={xScale(idx)}
              y={height - padding.bottom + 18}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {formatShortDate(data[idx].date)}
            </text>
          ))}
          {/* Average reference line */}
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={yScale(avg)}
            y2={yScale(avg)}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeDasharray="4 4"
          />
          <text
            x={width - padding.right}
            y={yScale(avg) - 4}
            textAnchor="end"
            className="fill-muted-foreground/70"
            fontSize={10}
          >
            avg {avg.toFixed(1)}%
          </text>

          <path d={areaPath} fill="rgb(245 158 11 / 0.15)" stroke="none" />
          <path d={linePath} fill="none" stroke="rgb(245 158 11 / 0.9)" strokeWidth={2} />
          {data.map((d, i) => (
            <circle key={`c-${i}`} cx={xScale(i)} cy={yScale(d.criticalPct)} r={2.5} fill="rgb(245 158 11)" />
          ))}
        </svg>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        Share of news segments per day that are plainly critical of the regime. A rising line suggests broadcasts are becoming more willing to publish criticism; a flat low line suggests deference.
      </CardContent>
    </Card>
  )
}

// ---------- Top figures: mentions over time ----------

export interface FigureMentionsOverTimePoint {
  date: string
  // Sparse map: figure name → mentions on that date (omitted = 0).
  byFigure: Record<string, number>
}

export interface FigureSeries {
  name: string
  side: string
  total: number
}

// Categorical palette ordered by visual distinctness. We pick the first N entries
// for the top N figures so the highest-volume figure always gets the most-saturated
// hue. Side metadata stays available via the legend.
const FIGURE_PALETTE = [
  "rgb(239 68 68 / 0.9)",   // red
  "rgb(59 130 246 / 0.9)",  // blue
  "rgb(217 70 239 / 0.9)",  // fuchsia
  "rgb(245 158 11 / 0.9)",  // amber
  "rgb(16 185 129 / 0.9)",  // emerald
  "rgb(168 85 247 / 0.9)",  // violet
  "rgb(20 184 166 / 0.9)",  // teal
  "rgb(244 114 182 / 0.9)", // pink
]

export function FigureMentionsOverTimeChart({
  data,
  series,
  mode = "cumulative",
}: {
  data: FigureMentionsOverTimePoint[]
  series: FigureSeries[]
  mode?: "cumulative" | "daily"
}) {
  if (data.length === 0 || series.length === 0) {
    return <EmptyChart note="figures-mentions.csv is empty — analyze some transcripts first." />
  }

  const width = 960
  const height = 360
  const padding = { top: 24, right: 140, bottom: 40, left: 48 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  // Per-figure cumulative or daily values over the date axis.
  const lines = series.map((s, idx) => {
    let running = 0
    const values = data.map((d) => {
      const v = d.byFigure[s.name] ?? 0
      if (mode === "cumulative") {
        running += v
        return running
      }
      return v
    })
    return { name: s.name, side: s.side, color: FIGURE_PALETTE[idx % FIGURE_PALETTE.length], values, total: s.total }
  })

  const yMax = niceCeil(
    Math.max(1, ...lines.flatMap((l) => l.values))
  )

  const xScale = (i: number) =>
    data.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (data.length - 1)) * innerW
  const yScale = (v: number) => padding.top + innerH - (v / yMax) * innerH

  const xTicks = pickTickIndices(data.length, 7)
  const yTicks = 4

  // End-of-line label positions: stagger if multiple lines land near each other.
  const endPoints = lines
    .map((l) => ({ name: l.name, color: l.color, y: yScale(l.values[l.values.length - 1]) }))
    .sort((a, b) => a.y - b.y)
  // Spread crowded labels vertically.
  const MIN_GAP = 14
  for (let i = 1; i < endPoints.length; i++) {
    if (endPoints[i].y - endPoints[i - 1].y < MIN_GAP) {
      endPoints[i].y = endPoints[i - 1].y + MIN_GAP
    }
  }

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {lines.map((l) => (
          <div key={l.name} className="flex items-baseline gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: l.color }}
              aria-hidden
            />
            <span className="text-xs text-muted-foreground">{l.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground/70">
              · {l.total}
            </span>
          </div>
        ))}
      </div>
      <div className="px-2 pb-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          role="img"
          aria-label={`Top figure mentions over time (${mode})`}
        >
          {/* Y grid + labels */}
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = (yMax / yTicks) * i
            const y = yScale(v)
            return (
              <g key={`y-${i}`}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                  {v.toFixed(0)}
                </text>
              </g>
            )
          })}
          {/* X tick labels */}
          {xTicks.map((idx) => (
            <text
              key={`x-${idx}`}
              x={xScale(idx)}
              y={height - padding.bottom + 18}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {formatShortDate(data[idx].date)}
            </text>
          ))}
          {/* Y axis label */}
          <text
            x={padding.left - 36}
            y={padding.top + innerH / 2}
            transform={`rotate(-90 ${padding.left - 36} ${padding.top + innerH / 2})`}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {mode === "cumulative" ? "cumulative mentions" : "mentions / day"}
          </text>

          {/* Lines */}
          {lines.map((l) => {
            const points = l.values.map((v, i) => [xScale(i), yScale(v)] as [number, number])
            return (
              <g key={l.name}>
                <path d={buildLinePath(points)} fill="none" stroke={l.color} strokeWidth={2} />
                {points.map((p, i) => (
                  <circle key={`p-${i}`} cx={p[0]} cy={p[1]} r={2} fill={l.color} />
                ))}
              </g>
            )
          })}

          {/* End-of-line labels */}
          {endPoints.map((ep) => (
            <text
              key={`lbl-${ep.name}`}
              x={width - padding.right + 8}
              y={ep.y + 3}
              fontSize={10}
              fill={ep.color}
            >
              {ep.name}
            </text>
          ))}
        </svg>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        {mode === "cumulative"
          ? "Cumulative mentions per figure across all analyzed broadcasts. A steep slope means the figure was named heavily in a short window; a flat line means broadcasts stopped naming them."
          : "Daily mentions per figure across all analyzed broadcasts."}
      </CardContent>
    </Card>
  )
}

// ---------- Small utilities ----------

function buildLinePath(points: Array<[number, number]>): string {
  if (points.length === 0) return ""
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ")
}

function niceCeil(v: number): number {
  if (v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

function pickTickIndices(n: number, desired: number): number[] {
  if (n <= desired) return Array.from({ length: n }, (_, i) => i)
  const out: number[] = []
  for (let i = 0; i < desired; i++) {
    out.push(Math.round((i / (desired - 1)) * (n - 1)))
  }
  return Array.from(new Set(out))
}

function formatShortDate(iso: string): string {
  // YYYY-MM-DD → MMM D (English short)
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[m - 1]} ${d}`
}
