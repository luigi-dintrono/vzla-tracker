import { Card } from "@/components/ui/card"
import type { StateActivity } from "@/lib/data/pillar-2"

interface Props {
  states: StateActivity[]
  months: string[] // sorted "YYYY-MM"
}

// Horizontal stacked bar per state, segmented by month, with absolute counts.
// Not a true choropleth (would need a Venezuela TopoJSON + a map lib) but it
// answers the same question: which states are most active and is the activity
// front-loaded or spread across the window.
export function StateBarChart({ states, months }: Props) {
  const max = Math.max(1, ...states.map((s) => s.total))
  const monthColors = ["bg-foreground/85", "bg-foreground/55", "bg-foreground/30"]

  return (
    <Card className="rounded-2xl overflow-hidden py-0">
      <div className="p-5 md:p-6">
        <div className="space-y-2">
          {states.map((s) => {
            const widthPct = (s.total / max) * 100
            return (
              <div key={s.state} className="grid grid-cols-[140px_1fr_56px] items-center gap-3">
                <div className="text-xs text-muted-foreground font-light truncate" title={s.state}>
                  {s.state}
                </div>
                <div className="relative h-5 bg-muted/30 rounded-sm overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 flex"
                    style={{ width: `${widthPct}%` }}
                  >
                    {months.map((m, idx) => {
                      const count = s.byMonth[m] ?? 0
                      if (count === 0) return null
                      const segPct = (count / s.total) * 100
                      return (
                        <div
                          key={`${s.state}-${m}`}
                          className={monthColors[idx % monthColors.length]}
                          style={{ width: `${segPct}%` }}
                          title={`${s.state} · ${m}: ${count} day${count === 1 ? "" : "s"}`}
                        />
                      )
                    })}
                  </div>
                </div>
                <div className="text-xs tabular-nums text-right">
                  {s.total}
                  <span className="text-muted-foreground/60 text-[10px]">d</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="text-muted-foreground/70">Months:</span>
          {months.map((m, idx) => (
            <div key={`leg-${m}`} className="flex items-center gap-1.5">
              <span className={`inline-block w-3 h-3 rounded-sm ${monthColors[idx % monthColors.length]}`} />
              <span>{new Date(`${m}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
