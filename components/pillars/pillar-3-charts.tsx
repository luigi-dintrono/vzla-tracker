"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { SvgTooltip, useSvgHover } from "@/components/pillars/chart-hover"

// =============================================================================
// Pillar 3 charts — SVG-based, client-side hover crosshairs/tooltips.
// Mirrors the pillar-1 pattern: each chart is a pure render of a typed slice
// of data, with an EmptyChart fallback.
// =============================================================================

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
        Run <code className="font-mono text-[11px]">pnpm pillar3:crawl</code> to populate this chart.
      </CardContent>
    </Card>
  )
}

// ── Inflation: independent estimates ────────────────────────────────────────
//
// There is no "official" Venezuelan inflation series — BCV does not publish
// it (the government's own central bank deliberately stopped reliable
// reporting). The two series here are both *inferred* measures: OVF's
// independent monthly report and our own food-only series derived from
// `basket-prices.csv`.

export interface InflationPoint {
  date: string // YYYY-MM-01
  /** % MoM or YoY depending on `mode` */
  ovf: number | null
  basket: number | null
}

const INFLATION_SERIES = [
  { key: "ovf" as const, label: "OVF (independent)", color: "rgb(245 158 11)", swatch: "bg-amber-500/80" },
  { key: "basket" as const, label: "Canasta básica (this crawler, food only)", color: "rgb(217 70 239)", swatch: "bg-fuchsia-500/80" },
]

export function InflationTrendChart({
  data,
  mode,
}: {
  data: InflationPoint[]
  mode: "mom" | "yoy"
}) {
  if (data.length === 0) {
    return <EmptyChart note="inflation-monthly.csv is empty — run the crawler first." />
  }

  const width = 960
  const height = 320
  const padding = { top: 24, right: 24, bottom: 40, left: 56 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const values = data.flatMap((d) =>
    INFLATION_SERIES.map((s) => d[s.key]).filter((v): v is number => v != null)
  )
  if (values.length === 0) {
    return <EmptyChart note="inflation-monthly.csv has rows but no parsed percentages yet." />
  }
  const yMax = niceCeil(Math.max(1, ...values))
  const yMin = Math.min(0, ...values)
  const yRange = yMax - yMin || 1

  const xScale = (i: number) =>
    data.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (data.length - 1)) * innerW
  const yScale = (v: number) => padding.top + innerH - ((v - yMin) / yRange) * innerH

  const xTicks = pickTickIndices(data.length, 8)
  const yTicks = 5

  const seriesPaths = INFLATION_SERIES.map((s) => {
    // Build line segments only between consecutive non-null points.
    const pts: Array<[number, number]> = []
    const segments: string[] = []
    let path = ""
    data.forEach((d, i) => {
      const v = d[s.key]
      if (v == null) {
        if (path) segments.push(path)
        path = ""
        return
      }
      const pt: [number, number] = [xScale(i), yScale(v)]
      pts.push(pt)
      path += (path ? " L" : "M") + ` ${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`
    })
    if (path) segments.push(path)
    return { ...s, d: segments.join(" "), pts }
  })

  const { hover, onMove, onLeave } = useSvgHover(data.length)
  const [hoverKey, setHoverKey] = React.useState<"ovf" | "basket" | null>(null)
  const active = hover.idx !== null ? data[hover.idx] : null
  const activeX = hover.idx !== null ? xScale(hover.idx) : null

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div
        className="px-5 pt-5 pb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1"
        onMouseLeave={() => setHoverKey(null)}
      >
        {INFLATION_SERIES.map((s) => {
          const present = data.some((d) => d[s.key] != null)
          const dim = hoverKey !== null && hoverKey !== s.key
          return (
            <div
              key={s.key}
              className={`flex items-baseline gap-2 cursor-default transition-opacity duration-150 ${
                present ? "" : "opacity-40"
              } ${dim ? "opacity-30" : ""}`}
              onMouseEnter={() => present && setHoverKey(s.key)}
            >
              <span className={`inline-block w-3 h-3 rounded-full ${s.swatch}`} aria-hidden />
              <span className="text-xs text-muted-foreground">{s.label}</span>
              {!present && (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  not wired
                </span>
              )}
            </div>
          )
        })}
        <span className="ml-auto text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground/70">
          {mode === "mom" ? "Month-over-month" : "Year-over-year"} % · monthly
        </span>
      </div>
      <div className="px-2 pb-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Inflation trend">
          {/* Y grid + labels */}
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = yMin + (yRange / yTicks) * i
            const y = yScale(v)
            return (
              <g key={`y-${i}`}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                  {fmtPct(v)}
                </text>
              </g>
            )
          })}
          {/* Zero line if range crosses zero */}
          {yMin < 0 && (
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yScale(0)}
              y2={yScale(0)}
              stroke="currentColor"
              strokeOpacity={0.2}
            />
          )}
          {/* X labels */}
          {xTicks.map((idx) => (
            <text
              key={`x-${idx}`}
              x={xScale(idx)}
              y={height - padding.bottom + 18}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {formatMonth(data[idx].date)}
            </text>
          ))}
          {/* Lines + dots */}
          {seriesPaths.map((sp) => {
            const dim = hoverKey !== null && hoverKey !== sp.key
            return (
              <g key={sp.key} className="transition-opacity duration-150" opacity={dim ? 0.2 : 1}>
                <path
                  d={sp.d}
                  fill="none"
                  stroke={sp.color}
                  strokeWidth={hoverKey === sp.key ? 3 : 2}
                  strokeOpacity={0.85}
                />
                {data.map((d, i) => {
                  const v = d[sp.key]
                  if (v == null) return null
                  return (
                    <circle
                      key={`${sp.key}-${i}`}
                      cx={xScale(i)}
                      cy={yScale(v)}
                      r={hover.idx === i ? 4.5 : 2.5}
                      fill={sp.color}
                      className="transition-[r] duration-150"
                    />
                  )
                })}
              </g>
            )
          })}

          {active && activeX != null && (
            <g pointerEvents="none">
              <line
                x1={activeX}
                x2={activeX}
                y1={padding.top}
                y2={padding.top + innerH}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeDasharray="3 3"
              />
              <SvgTooltip
                x={activeX}
                y={padding.top + innerH * 0.4}
                chartWidth={width}
                width={228}
                height={78}
              >
                <div className="font-display tracking-[0.18em] uppercase text-[9px] text-muted-foreground mb-1">
                  {formatMonth(active.date)} · {mode === "mom" ? "MoM" : "YoY"}
                </div>
                {INFLATION_SERIES.map((s) => {
                  const v = active[s.key]
                  return (
                    <div
                      key={s.key}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-block w-2 h-2 rounded-full ${s.swatch}`} />
                        {s.label.split(" ")[0]}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {v == null ? "—" : fmtPct(v)}
                      </span>
                    </div>
                  )
                })}
              </SvgTooltip>
            </g>
          )}

          <rect
            x={padding.left}
            y={padding.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={(e) => onMove(e, padding, innerW)}
            onMouseLeave={onLeave}
          />
        </svg>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        Venezuela has no official inflation series — BCV deliberately stopped publishing it,
        so every number here is an <em>inferred</em> estimate. The amber line is{" "}
        <a href="https://observatoriodefinanzas.com/" className="underline">OVF</a>&apos;s
        broad CPI; the magenta line is food-only, derived locally from{" "}
        <code className="font-mono">basket-prices.csv</code> (geometric mean of per-ingredient
        median USD prices). When food inflation runs ahead of headline, real household pain
        is worse than the topline.
      </CardContent>
    </Card>
  )
}

// ── FX divergence: BCV vs Paralelo daily ────────────────────────────────────

export interface FxPoint {
  date: string
  bcv: number | null
  paralelo: number | null
}

export function FxDivergenceChart({ data }: { data: FxPoint[] }) {
  const usable = data.filter((d) => d.bcv != null || d.paralelo != null)
  if (usable.length === 0) {
    return <EmptyChart note="fx-rate-daily.csv is empty — pydolarve.org needs to be reachable." />
  }

  const width = 960
  const height = 320
  const padding = { top: 24, right: 56, bottom: 40, left: 56 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const allRates = usable.flatMap((d) => [d.bcv, d.paralelo].filter((v): v is number => v != null))
  const yMax = niceCeil(Math.max(...allRates))
  const yMin = 0

  const xScale = (i: number) =>
    usable.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (usable.length - 1)) * innerW
  const yScale = (v: number) => padding.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH

  const xTicks = pickTickIndices(usable.length, 7)
  const yTicks = 5

  const bcvSeries = lineWithGaps(usable.map((d, i) => (d.bcv != null ? [xScale(i), yScale(d.bcv)] : null)))
  const parSeries = lineWithGaps(usable.map((d, i) => (d.paralelo != null ? [xScale(i), yScale(d.paralelo)] : null)))

  const { hover, onMove, onLeave } = useSvgHover(usable.length)
  const active = hover.idx !== null ? usable[hover.idx] : null
  const activeX = hover.idx !== null ? xScale(hover.idx) : null
  const activePremium =
    active && active.bcv && active.paralelo ? ((active.paralelo - active.bcv) / active.bcv) * 100 : null

  // Build a fill polygon between BCV and Paralelo to highlight the gap.
  const gapBand: string[] = []
  for (let i = 0; i < usable.length; i++) {
    const d = usable[i]
    if (d.bcv != null && d.paralelo != null) {
      gapBand.push(
        `M ${xScale(i).toFixed(2)} ${yScale(d.bcv).toFixed(2)} L ${xScale(i).toFixed(2)} ${yScale(d.paralelo).toFixed(2)}`
      )
    }
  }

  const latest = usable[usable.length - 1]
  const premiumPct =
    latest && latest.bcv && latest.paralelo
      ? ((latest.paralelo - latest.bcv) / latest.bcv) * 100
      : null

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Legend swatch="bg-blue-500/80" label="BCV official" />
        <Legend swatch="bg-rose-500/80" label="Paralelo" />
        {premiumPct != null && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground/80">
            Latest premium: <strong className="text-foreground">{premiumPct.toFixed(1)}%</strong>
          </span>
        )}
      </div>
      <div className="px-2 pb-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="BCV vs paralelo daily">
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
              {formatShortDate(usable[idx].date)}
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
            Bs / USD
          </text>
          {/* Gap band */}
          {gapBand.map((d, i) => (
            <path key={`gap-${i}`} d={d} stroke="rgb(244 63 94 / 0.18)" strokeWidth={4} />
          ))}
          {/* BCV line */}
          <path d={bcvSeries} fill="none" stroke="rgb(59 130 246 / 0.9)" strokeWidth={2} />
          {/* Paralelo line */}
          <path d={parSeries} fill="none" stroke="rgb(244 63 94 / 0.9)" strokeWidth={2} />

          {/* Dots highlight */}
          {usable.map((d, i) => (
            <g key={`dots-${i}`}>
              {d.bcv != null && (
                <circle
                  cx={xScale(i)}
                  cy={yScale(d.bcv)}
                  r={hover.idx === i ? 4.5 : 0}
                  fill="rgb(59 130 246)"
                  className="transition-[r] duration-150"
                />
              )}
              {d.paralelo != null && (
                <circle
                  cx={xScale(i)}
                  cy={yScale(d.paralelo)}
                  r={hover.idx === i ? 4.5 : 0}
                  fill="rgb(244 63 94)"
                  className="transition-[r] duration-150"
                />
              )}
            </g>
          ))}

          {active && activeX != null && (
            <g pointerEvents="none">
              <line
                x1={activeX}
                x2={activeX}
                y1={padding.top}
                y2={padding.top + innerH}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeDasharray="3 3"
              />
              <SvgTooltip
                x={activeX}
                y={padding.top + innerH * 0.35}
                chartWidth={width}
                width={220}
                height={92}
              >
                <div className="font-display tracking-[0.18em] uppercase text-[9px] text-muted-foreground mb-1">
                  {formatShortDate(active.date)}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-500/90" />
                    BCV official
                  </span>
                  <span className="tabular-nums">{active.bcv != null ? active.bcv.toFixed(2) : "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-rose-500/90" />
                    Paralelo
                  </span>
                  <span className="tabular-nums">
                    {active.paralelo != null ? active.paralelo.toFixed(2) : "—"}
                  </span>
                </div>
                {activePremium != null && (
                  <div className="flex items-center justify-between gap-3 mt-1 pt-1 border-t border-border/60">
                    <span className="text-muted-foreground">Premium</span>
                    <span className="tabular-nums font-medium text-rose-600 dark:text-rose-400">
                      {activePremium.toFixed(1)}%
                    </span>
                  </div>
                )}
              </SvgTooltip>
            </g>
          )}

          <rect
            x={padding.left}
            y={padding.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={(e) => onMove(e, padding, innerW)}
            onMouseLeave={onLeave}
          />
        </svg>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        Daily Bs/USD. The shaded vertical bars are the gap between official and parallel rates —
        the wider it gets, the more aggressive the implicit devaluation expectation.
      </CardContent>
    </Card>
  )
}

// ── Oil production (monthly kbd, 2002 → present) ────────────────────────────

export interface OilPoint {
  date: string // YYYY-MM-01
  kbd: number
}

export function OilProductionChart({ data }: { data: OilPoint[] }) {
  if (data.length === 0) {
    return <EmptyChart note="oil-production-monthly.csv is empty — run --datasets oil." />
  }

  const width = 960
  const height = 320
  const padding = { top: 24, right: 24, bottom: 40, left: 56 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const yMax = niceCeil(Math.max(...data.map((d) => d.kbd)))
  const xScale = (i: number) =>
    data.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (data.length - 1)) * innerW
  const yScale = (v: number) => padding.top + innerH - (v / yMax) * innerH

  const linePath = buildLinePath(data.map((d, i) => [xScale(i), yScale(d.kbd)] as [number, number]))
  const areaPath =
    linePath +
    ` L ${xScale(data.length - 1).toFixed(2)} ${yScale(0).toFixed(2)}` +
    ` L ${xScale(0).toFixed(2)} ${yScale(0).toFixed(2)} Z`

  const xTicks = pickTickIndices(data.length, 8)
  const yTicks = 4

  const latest = data[data.length - 1]
  const oneYearAgoIdx = Math.max(0, data.length - 13)
  const yoyChange =
    data[oneYearAgoIdx].kbd > 0
      ? ((latest.kbd - data[oneYearAgoIdx].kbd) / data[oneYearAgoIdx].kbd) * 100
      : null

  const { hover, onMove, onLeave } = useSvgHover(data.length)
  const active = hover.idx !== null ? data[hover.idx] : null
  const activeX = hover.idx !== null ? xScale(hover.idx) : null
  const prev = hover.idx !== null && hover.idx > 0 ? data[hover.idx - 1] : null
  const activeMoM = active && prev && prev.kbd > 0 ? ((active.kbd - prev.kbd) / prev.kbd) * 100 : null

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Legend swatch="bg-amber-600/80" label="Crude production" />
        <span className="text-xs tabular-nums text-muted-foreground/80">
          Latest: <strong className="text-foreground">{latest.kbd.toFixed(0)} kbd</strong>{" "}
          ({formatMonth(latest.date)})
        </span>
        {yoyChange != null && (
          <span className="text-xs tabular-nums text-muted-foreground/70">
            · YoY {yoyChange >= 0 ? "+" : ""}{yoyChange.toFixed(1)}%
          </span>
        )}
      </div>
      <div className="px-2 pb-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Venezuela monthly crude production">
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
              {data[idx].date.slice(0, 7)}
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
            kbd
          </text>

          <path d={areaPath} fill="rgb(217 119 6 / 0.15)" />
          <path d={linePath} fill="none" stroke="rgb(217 119 6 / 0.95)" strokeWidth={2} />

          {/* Hover dots */}
          {data.map((d, i) => (
            <circle
              key={`oil-${i}`}
              cx={xScale(i)}
              cy={yScale(d.kbd)}
              r={hover.idx === i ? 4.5 : 0}
              fill="rgb(217 119 6)"
              className="transition-[r] duration-150"
            />
          ))}

          {active && activeX != null && (
            <g pointerEvents="none">
              <line
                x1={activeX}
                x2={activeX}
                y1={padding.top}
                y2={padding.top + innerH}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeDasharray="3 3"
              />
              <SvgTooltip
                x={activeX}
                y={yScale(active.kbd)}
                chartWidth={width}
                width={196}
                height={activeMoM != null ? 80 : 60}
              >
                <div className="font-display tracking-[0.18em] uppercase text-[9px] text-muted-foreground mb-1">
                  {formatMonth(active.date)}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-600/90" />
                    Production
                  </span>
                  <span className="tabular-nums">{active.kbd.toFixed(0)} kbd</span>
                </div>
                {activeMoM != null && (
                  <div className="flex items-center justify-between gap-3 mt-0.5 text-muted-foreground">
                    <span>MoM change</span>
                    <span className={`tabular-nums ${activeMoM >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {activeMoM >= 0 ? "+" : ""}
                      {activeMoM.toFixed(1)}%
                    </span>
                  </div>
                )}
              </SvgTooltip>
            </g>
          )}

          <rect
            x={padding.left}
            y={padding.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={(e) => onMove(e, padding, innerW)}
            onMouseLeave={onLeave}
          />
        </svg>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        Venezuela monthly crude oil indigenous production from the{" "}
        <a href="https://www.jodidata.org/oil/" className="underline">JODI</a> primary database
        — the same secondary-source tracking that feeds OPEC&apos;s MOMR. Values in thousand
        barrels per day (kbd). Hover the chart for monthly values and MoM change.
      </CardContent>
    </Card>
  )
}

// ── Canasta vs Minimum Wage (headline comparison) ──────────────────────────

export interface WageRow {
  date: string // YYYY-MM-DD
  base_wage_bs: number
  total_bs: number
  total_usd: number
  note: string | null
}

export function CanastaVsWageHero({
  basket,
  wage,
}: {
  /** Latest basket-index rows (one per ingredient) */
  basket: BasketRow[]
  /** Latest curated minimum-wage row */
  wage: WageRow | null
}) {
  if (basket.length === 0) return <EmptyChart note="basket-index.csv is empty." />
  if (!wage) {
    return <EmptyChart note="minimum-wage-monthly.csv is empty." />
  }

  // Latest basket date
  const latestDate = basket.reduce((b, r) => (r.date > b ? r.date : b), basket[0].date)
  const latest = basket.filter(r => r.date === latestDate && r.median_price_ref_usd != null)

  // Assemble the comparison: per-ingredient, how many *integral monthly
  // wages* (with bonuses) does it take to buy ONE unit of this product?
  const integralUsd = wage.total_usd
  const formalUsd = wage.base_wage_bs / approxBcvFromMonth(wage.date)

  // Also sum the basket: median price × 1 unit each = monthly "minimum food
  // basket" cost in USD. Crude (no household-weighting), but enough to size up.
  const basketSum = latest.reduce((s, r) => s + (r.median_price_ref_usd ?? 0), 0)
  const monthlyWageCanastaRatio = basketSum / integralUsd

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="grid md:grid-cols-3 gap-0 border-b border-border">
        <div
          className="p-5 md:border-r border-border transition-colors duration-200 hover:bg-muted/30 cursor-default"
          title={`Sum of ${latest.length} canasta items at median BCV USD prices`}
        >
          <p className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground/70 mb-3">
            One canasta básica
          </p>
          <p className="text-3xl font-light tabular-nums mb-1">
            ${basketSum.toFixed(2)}
            <span className="text-base text-muted-foreground/60 ml-1">USD</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Sum of median USD prices for {latest.length} canasta items · {formatShortDate(latestDate)}
          </p>
        </div>
        <div
          className="p-5 md:border-r border-border transition-colors duration-200 hover:bg-muted/30 cursor-default"
          title={`Base Bs ${wage.base_wage_bs.toFixed(0)} + cestaticket + bono = $${integralUsd.toFixed(2)} per month`}
        >
          <p className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground/70 mb-3">
            Minimum wage (integral)
          </p>
          <p className="text-3xl font-light tabular-nums mb-1">
            ${integralUsd.toFixed(2)}
            <span className="text-base text-muted-foreground/60 ml-1">USD/mo</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Base Bs {wage.base_wage_bs.toFixed(0)} + cestaticket + bono · {formatShortDate(wage.date)}
          </p>
        </div>
        <div
          className="p-5 transition-colors duration-200 hover:bg-muted/30 cursor-default"
          title={`Ratio of basket cost to monthly integral minimum wage`}
        >
          <p className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground/70 mb-3">
            How many wages to buy one basket
          </p>
          <p className="text-3xl font-light tabular-nums mb-1 text-rose-600 dark:text-rose-400">
            {monthlyWageCanastaRatio.toFixed(1)}×
          </p>
          <p className="text-xs text-muted-foreground">
            {monthlyWageCanastaRatio >= 1
              ? `Need ${monthlyWageCanastaRatio.toFixed(1)} months of integral minimum wage to buy one unit of each canasta item.`
              : `One month of integral minimum wage covers ${(1 / monthlyWageCanastaRatio).toFixed(1)}× the basket.`}
          </p>
        </div>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        Venezuela&apos;s formal monthly minimum wage has been frozen at <strong>Bs 130</strong>{" "}
        since March 2022 — at today&apos;s BCV rate that&apos;s about{" "}
        <strong>${formalUsd.toFixed(2)}</strong>. With cestaticket and bonus payments included
        the &quot;integral&quot; monthly income is{" "}
        <strong>${integralUsd.toFixed(2)}</strong>. Compare that to one canasta of basic
        ingredients above — and remember this only buys <em>one unit</em> of each ingredient,
        far less than a household consumes monthly.
      </CardContent>
    </Card>
  )
}

/** Coarse Bs/USD lookup for a wage CSV row's date. The wage CSV doesn't carry
 *  the rate it was measured against — `total_usd` is the authoritative number.
 *  This is only used for the *base_wage_bs → USD* conversion, where any plausible
 *  rate gives a near-zero answer (since base is still Bs 130). */
function approxBcvFromMonth(date: string): number {
  // 2022-03 ≈ 4.30, 2023-12 ≈ 35.7, 2024-12 ≈ 50, 2025-04 ≈ 70, 2026-05 ≈ 500
  const t = new Date(date).getTime()
  const anchors: Array<[number, number]> = [
    [+new Date("2022-03-15"), 4.30],
    [+new Date("2023-01-01"), 22],
    [+new Date("2024-01-01"), 35.7],
    [+new Date("2025-01-01"), 55],
    [+new Date("2026-01-01"), 350],
    [+new Date("2026-05-01"), 500],
  ]
  for (let i = 0; i < anchors.length - 1; i++) {
    const [t0, r0] = anchors[i]
    const [t1, r1] = anchors[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return r0 + (r1 - r0) * f
    }
  }
  return anchors[anchors.length - 1][1]
}

// ── Basket index per-ingredient (latest snapshot snapshot) ──────────────────

export interface BasketRow {
  date: string
  ingredient: string
  n_skus: number
  median_price_ref_usd: number | null
  implied_price_usd_paralelo: number | null
}

export function BasketLatestChart({ rows }: { rows: BasketRow[] }) {
  if (rows.length === 0) {
    return <EmptyChart note="basket-index.csv is empty — run --datasets basket." />
  }
  // Pick the latest date and show all ingredients there.
  const latestDate = rows.reduce(
    (best, r) => (r.date > best ? r.date : best),
    rows[0].date
  )
  const latest = rows
    .filter((r) => r.date === latestDate && r.median_price_ref_usd != null)
    .sort((a, b) => (b.median_price_ref_usd ?? 0) - (a.median_price_ref_usd ?? 0))
  if (latest.length === 0) return <EmptyChart note="No basket rows on latest date." />

  const maxUsd = Math.max(...latest.map((r) => r.median_price_ref_usd ?? 0))

  const [hoverIngredient, setHoverIngredient] = React.useState<string | null>(null)

  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Legend swatch="bg-emerald-500/80" label={`USD (BCV) — ${formatShortDate(latestDate)}`} />
        <Legend swatch="bg-rose-500/80" label="USD (paralelo)" />
      </div>
      <div className="p-5 space-y-2.5" onMouseLeave={() => setHoverIngredient(null)}>
        {latest.map((r) => {
          const bcv = r.median_price_ref_usd ?? 0
          const par = r.implied_price_usd_paralelo ?? null
          const premium = par != null && bcv > 0 ? ((par - bcv) / bcv) * 100 : null
          const isHover = hoverIngredient === r.ingredient
          const dim = hoverIngredient !== null && !isHover
          return (
            <div
              key={r.ingredient}
              className={`grid grid-cols-[140px_1fr_120px] items-center gap-3 rounded-sm px-1 -mx-1 py-1 -my-1 cursor-default transition-all duration-150 ${
                isHover ? "bg-muted/40" : ""
              } ${dim ? "opacity-50" : ""}`}
              onMouseEnter={() => setHoverIngredient(r.ingredient)}
              title={
                premium != null
                  ? `${prettyIngredient(r.ingredient)}: $${bcv.toFixed(2)} BCV · $${par!.toFixed(2)} paralelo (+${premium.toFixed(0)}% premium) · ${r.n_skus} SKUs`
                  : `${prettyIngredient(r.ingredient)}: $${bcv.toFixed(2)} BCV · ${r.n_skus} SKUs`
              }
            >
              <div className="text-sm text-foreground/90 truncate">{prettyIngredient(r.ingredient)}</div>
              <div className="relative h-5 rounded-sm bg-muted/40 overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 bg-emerald-500/70 transition-[filter] duration-150 ${
                    isHover ? "brightness-110" : ""
                  }`}
                  style={{ width: `${(bcv / maxUsd) * 100}%` }}
                />
                {par != null && (
                  <div
                    className="absolute inset-y-0 left-0 border-r-2 border-rose-500"
                    style={{ width: `${(par / maxUsd) * 100}%` }}
                  />
                )}
              </div>
              <div className="text-xs tabular-nums text-muted-foreground text-right">
                ${bcv.toFixed(2)}
                {par != null && (
                  <>
                    <span className="text-muted-foreground/40 mx-1">·</span>
                    <span className="text-rose-600 dark:text-rose-400">${par.toFixed(2)}</span>
                  </>
                )}
                <span className="text-muted-foreground/50"> · {r.n_skus} SKUs</span>
              </div>
            </div>
          )
        })}
      </div>
      <CardContent className="border-t border-border py-4 text-xs text-muted-foreground/70">
        Median USD price per canasta ingredient on the latest crawl day. The rose marker on each
        bar shows where the same Bs price lands at the paralelo rate — i.e. how much extra real
        purchasing-power cost households in the informal economy face. Hover a row for the premium and SKU count.
      </CardContent>
    </Card>
  )
}

// ── Shared utilities ────────────────────────────────────────────────────────

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block w-3 h-3 rounded-full ${swatch}`} aria-hidden />
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  )
}

function buildLinePath(points: Array<[number, number]>): string {
  if (points.length === 0) return ""
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ")
}

function lineWithGaps(points: Array<[number, number] | null>): string {
  let path = ""
  let segmentOpen = false
  for (const p of points) {
    if (!p) {
      segmentOpen = false
      continue
    }
    path += (segmentOpen ? " L" : (path ? " M" : "M")) + ` ${p[0].toFixed(2)} ${p[1].toFixed(2)}`
    segmentOpen = true
  }
  return path
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
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m) return iso
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return d ? `${months[m - 1]} ${d}` : `${months[m - 1]} ${y % 100}`
}

function formatMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  if (!y || !m) return iso
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[m - 1]} '${String(y).slice(2)}`
}

function fmtPct(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0) + "%"
  if (Math.abs(v) >= 10) return v.toFixed(1) + "%"
  return v.toFixed(2) + "%"
}

function prettyIngredient(key: string): string {
  const labels: Record<string, string> = {
    arroz: "Arroz",
    harina_maiz: "Harina de maíz",
    pasta: "Pasta",
    pan: "Pan",
    caraotas: "Caraotas",
    lentejas: "Lentejas",
    aceite: "Aceite",
    margarina: "Margarina",
    azucar: "Azúcar",
    cafe: "Café",
    leche: "Leche en polvo",
    huevos: "Huevos",
    pollo: "Pollo",
    carne_res: "Carne de res",
    atun: "Atún",
    sardinas: "Sardinas",
    queso: "Queso blanco",
    mayonesa: "Mayonesa",
    sal: "Sal",
    salsa_tomate: "Salsa de tomate",
  }
  return labels[key] ?? key
}
