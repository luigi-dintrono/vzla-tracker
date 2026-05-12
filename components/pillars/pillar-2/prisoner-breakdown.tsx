import { Card } from "@/components/ui/card"
import {
  PRISONER_CATEGORY_LABEL,
  PRISONER_CATEGORY_ORDER,
  type PrisonerCategoryRow,
  type PrisonerTimePoint,
} from "@/lib/data/pillar-2"

const CAT_COLOR: Record<string, string> = {
  civilian: "bg-sky-500/80 dark:bg-sky-400/70",
  journalist: "bg-amber-500/80 dark:bg-amber-400/70",
  military: "bg-zinc-600/80 dark:bg-zinc-300/70",
  politician: "bg-violet-500/80 dark:bg-violet-400/70",
  minor: "bg-rose-500/80 dark:bg-rose-400/70",
  indigenous: "bg-emerald-500/80 dark:bg-emerald-400/70",
  unknown: "bg-muted-foreground/40",
}

const STATUS_COLOR: Record<string, string> = {
  detained: "bg-foreground/85",
  released: "bg-emerald-600/70",
  missing: "bg-amber-500/80",
  sentenced: "bg-rose-500/80",
  other: "bg-muted-foreground/40",
}

interface Props {
  byCategory: PrisonerCategoryRow[]
  cumulative: PrisonerTimePoint[]
  categories: string[]
}

export function PrisonerBreakdown({ byCategory, cumulative, categories }: Props) {
  // Order categories per the canonical ordering so the legend stays stable
  // even if a category had zero rows for this window.
  const orderedCats = PRISONER_CATEGORY_ORDER.filter((c) => byCategory.some((r) => r.category === c))
  const total = byCategory.reduce((a, b) => a + b.total, 0)
  const maxRow = Math.max(1, ...byCategory.map((r) => r.total))

  // Cumulative stack: y-axis = total mentions; one stripe per category over time.
  const cumWidth = 720
  const cumHeight = 180
  const lastPoint = cumulative[cumulative.length - 1]?.byCategory ?? {}
  const maxCum = orderedCats.reduce((a, c) => a + (lastPoint[c] ?? 0), 0) || 1
  const dateToX = (idx: number) => (cumulative.length > 1 ? (idx / (cumulative.length - 1)) * cumWidth : 0)

  return (
    <div className="space-y-6">
      {/* Per-category bar chart + status breakdown */}
      <Card className="rounded-2xl overflow-hidden py-0">
        <div className="p-5 md:p-6 space-y-3">
          <p className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground">
            By category · status mix
          </p>
          {byCategory.map((row) => {
            const widthPct = (row.total / maxRow) * 100
            const segments = [
              { key: "detained", v: row.detained },
              { key: "missing", v: row.missing },
              { key: "sentenced", v: row.sentenced },
              { key: "released", v: row.released },
              { key: "other", v: row.other },
            ]
            return (
              <div key={row.category} className="grid grid-cols-[110px_1fr_70px] items-center gap-3">
                <div className="text-xs text-muted-foreground font-light flex items-center gap-2">
                  <span className={`inline-block w-3 h-3 rounded-sm ${CAT_COLOR[row.category] ?? "bg-foreground/60"}`} />
                  {PRISONER_CATEGORY_LABEL[row.category] ?? row.category}
                </div>
                <div className="relative h-5 bg-muted/30 rounded-sm overflow-hidden">
                  <div className="absolute inset-y-0 left-0 flex" style={{ width: `${widthPct}%` }}>
                    {segments.map((s) =>
                      s.v > 0 ? (
                        <div
                          key={`${row.category}-${s.key}`}
                          className={STATUS_COLOR[s.key] ?? "bg-foreground/60"}
                          style={{ width: `${(s.v / row.total) * 100}%` }}
                          title={`${PRISONER_CATEGORY_LABEL[row.category] ?? row.category} · ${s.key}: ${s.v}`}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
                <div className="text-xs tabular-nums text-right">
                  {row.total}
                  <span className="text-muted-foreground/60 text-[10px] ml-1">
                    {total > 0 ? `${Math.round((row.total / total) * 100)}%` : ""}
                  </span>
                </div>
              </div>
            )
          })}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-1">
            <span className="text-muted-foreground/70">Status:</span>
            {Object.entries(STATUS_COLOR).map(([k, c]) => (
              <div key={`leg-status-${k}`} className="flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded-sm ${c}`} />
                <span className="capitalize">{k}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Cumulative-over-time SVG line chart */}
      <Card className="rounded-2xl overflow-hidden py-0">
        <div className="p-5 md:p-6">
          <p className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground mb-3">
            Cumulative prisoner mentions over time
          </p>
          <svg viewBox={`0 0 ${cumWidth} ${cumHeight + 30}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            {/* Horizontal gridlines */}
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <line
                key={`grid-${p}`}
                x1={0}
                x2={cumWidth}
                y1={cumHeight - cumHeight * p}
                y2={cumHeight - cumHeight * p}
                className="stroke-border"
                strokeWidth={0.5}
                strokeDasharray="2 4"
              />
            ))}
            {/* Stacked area per category */}
            {(() => {
              const stacks: Record<string, number[]> = {}
              orderedCats.forEach((c) => (stacks[c] = cumulative.map((p) => p.byCategory[c] ?? 0)))
              const totals = cumulative.map((_, i) => orderedCats.reduce((a, c) => a + stacks[c][i], 0))
              let cum = cumulative.map(() => 0)
              return orderedCats.map((c, ci) => {
                const top = stacks[c].map((v, i) => cum[i] + v)
                const bot = [...cum]
                const path = [
                  ...top.map((v, i) => `${i === 0 ? "M" : "L"}${dateToX(i)},${cumHeight - (v / maxCum) * cumHeight}`),
                  ...bot
                    .map((v, i) => `L${dateToX(i)},${cumHeight - (v / maxCum) * cumHeight}`)
                    .reverse(),
                  "Z",
                ].join(" ")
                cum = top
                const fill = TAILWIND_FILL[c] ?? "rgba(120,120,140,0.5)"
                return (
                  <path key={`area-${c}`} d={path} fill={fill} opacity={0.85}>
                    <title>{`${PRISONER_CATEGORY_LABEL[c] ?? c}: ${top[top.length - 1]} cumulative`}</title>
                  </path>
                )
              })
            })()}
            {/* Date ticks */}
            {cumulative.map((p, idx) => {
              if (cumulative.length < 6 || idx % Math.ceil(cumulative.length / 6) !== 0) return null
              return (
                <text
                  key={`tick-${p.date}`}
                  x={dateToX(idx)}
                  y={cumHeight + 16}
                  className="fill-muted-foreground"
                  fontSize="10"
                  textAnchor="middle"
                >
                  {p.date.slice(5)}
                </text>
              )
            })}
            {/* Final total label */}
            <text
              x={cumWidth - 4}
              y={14}
              className="fill-muted-foreground"
              fontSize="10"
              textAnchor="end"
            >
              {maxCum} mentions
            </text>
          </svg>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {orderedCats.map((c) => (
              <div key={`leg-c-${c}`} className="flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded-sm ${CAT_COLOR[c]}`} />
                <span>{PRISONER_CATEGORY_LABEL[c] ?? c}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

// SVG fills — mirror CAT_COLOR but in raw rgba so the <path> renders without
// resolving CSS variables (the SVG is server-rendered).
const TAILWIND_FILL: Record<string, string> = {
  civilian: "rgba(14,165,233,0.7)", // sky-500
  journalist: "rgba(245,158,11,0.7)", // amber-500
  military: "rgba(82,82,91,0.7)", // zinc-600
  politician: "rgba(139,92,246,0.7)", // violet-500
  minor: "rgba(244,63,94,0.7)", // rose-500
  indigenous: "rgba(16,185,129,0.7)", // emerald-500
  unknown: "rgba(120,120,140,0.5)",
}
