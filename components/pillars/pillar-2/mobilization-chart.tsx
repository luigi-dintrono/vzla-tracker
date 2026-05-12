import { Card } from "@/components/ui/card"
import {
  PROTEST_CATEGORY_LABEL,
  PROTEST_CATEGORY_ORDER,
  type DailyProtestPoint,
} from "@/lib/data/pillar-2"

// Tailwind background tokens per category. Kept monochromatic with one accent each
// so the chart reads as a heatmap rather than a rainbow.
const CAT_COLOR: Record<string, string> = {
  labor: "bg-amber-500/80 dark:bg-amber-400/70",
  political: "bg-sky-500/80 dark:bg-sky-400/70",
  human_rights: "bg-rose-500/80 dark:bg-rose-400/70",
  services: "bg-emerald-500/80 dark:bg-emerald-400/70",
  education: "bg-indigo-500/80 dark:bg-indigo-400/70",
  indigenous: "bg-fuchsia-500/80 dark:bg-fuchsia-400/70",
  other: "bg-zinc-500/70 dark:bg-zinc-400/60",
}

const REPRESSION_COLOR: Record<number, string> = {
  0: "",
  1: "bg-red-300/60",
  2: "bg-red-400/80",
  3: "bg-red-500/90",
  4: "bg-red-600",
  5: "bg-red-700",
}

interface Props {
  daily: DailyProtestPoint[]
  categoryTotals: Array<{ category: string; days: number }>
}

export function MobilizationChart({ daily, categoryTotals }: Props) {
  const days = daily // 61 days expected
  const cats = PROTEST_CATEGORY_ORDER
  // Pre-build a (cat → date → bool) lookup so the SVG below is cheap to render.
  const cellOn = new Map<string, Set<string>>()
  for (const c of cats) cellOn.set(c, new Set())
  for (const d of days) {
    if (!d.protestOccurred) continue
    for (const c of d.categories) {
      const set = cellOn.get(c)
      if (set) set.add(d.date)
    }
  }

  const totalByCat = new Map(categoryTotals.map((c) => [c.category, c.days]))

  // Compute month boundaries for x-axis ticks.
  const monthTicks: Array<{ idx: number; label: string }> = []
  let lastMonth = ""
  days.forEach((d, idx) => {
    const m = d.date.slice(0, 7)
    if (m !== lastMonth) {
      monthTicks.push({ idx, label: new Date(`${m}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) })
      lastMonth = m
    }
  })

  return (
    <Card className="rounded-2xl overflow-hidden py-0">
      <div className="p-5 md:p-6">
        {/* Repression overlay row */}
        <div className="mb-3">
          <p className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground mb-1.5">
            State repression
          </p>
          <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d) => (
              <div
                key={`r-${d.date}`}
                title={`${d.date} · repression ${d.repressionLevel}/5${d.repressionLevel ? ` · ${d.scale}` : ""}`}
                className={`h-3 ${REPRESSION_COLOR[d.repressionLevel] ?? ""} ${
                  d.repressionLevel === 0 ? "bg-muted/30" : ""
                }`}
              />
            ))}
          </div>
        </div>

        {/* Category heatmap */}
        <div className="space-y-1.5">
          {cats.map((c) => (
            <div key={c} className="grid grid-cols-[110px_1fr_44px] items-center gap-3">
              <div className="text-xs text-muted-foreground font-light">{PROTEST_CATEGORY_LABEL[c] ?? c}</div>
              <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                {days.map((d) => {
                  const on = cellOn.get(c)?.has(d.date)
                  return (
                    <div
                      key={`${c}-${d.date}`}
                      title={`${d.date} · ${on ? PROTEST_CATEGORY_LABEL[c] ?? c : "no activity"}`}
                      className={`h-5 ${on ? CAT_COLOR[c] ?? "bg-foreground/60" : "bg-muted/30"}`}
                    />
                  )
                })}
              </div>
              <div className="text-xs tabular-nums text-right text-muted-foreground">
                {totalByCat.get(c) ?? 0}d
              </div>
            </div>
          ))}
        </div>

        {/* Month ticks */}
        <div
          className="grid gap-px mt-2 ml-[110px] mr-[44px] pl-3 pr-3"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((d, idx) => {
            const tick = monthTicks.find((t) => t.idx === idx)
            return (
              <div key={`t-${d.date}`} className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                {tick ? tick.label : ""}
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
          {cats.map((c) => (
            <div key={`leg-${c}`} className="flex items-center gap-1.5">
              <span className={`inline-block w-3 h-3 rounded-sm ${CAT_COLOR[c]}`} />
              <span>{PROTEST_CATEGORY_LABEL[c] ?? c}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-muted-foreground/70">State response:</span>
            {[1, 2, 3, 4, 5].map((lvl) => (
              <span key={`leg-r-${lvl}`} className={`inline-block w-3 h-3 rounded-sm ${REPRESSION_COLOR[lvl]}`} />
            ))}
            <span className="text-muted-foreground/70">→</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
