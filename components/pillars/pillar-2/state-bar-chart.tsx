"use client"

import * as React from "react"
import { Card } from "@/components/ui/card"
import type { StateActivity } from "@/lib/data/pillar-2-types"

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
  const totalAll = states.reduce((a, s) => a + s.total, 0)

  const [hoverState, setHoverState] = React.useState<string | null>(null)
  const [hoverMonth, setHoverMonth] = React.useState<string | null>(null)

  function fmtMonthLabel(m: string) {
    return new Date(`${m}-01T00:00:00Z`).toLocaleString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
  }

  return (
    <Card className="rounded-2xl overflow-hidden py-0">
      <div className="p-5 md:p-6">
        <div className="space-y-2" onMouseLeave={() => setHoverState(null)}>
          {states.map((s) => {
            const widthPct = (s.total / max) * 100
            const isHover = hoverState === s.state
            const dim = hoverState !== null && !isHover
            return (
              <div
                key={s.state}
                className={`grid grid-cols-[140px_1fr_56px] items-center gap-3 rounded-sm px-1 -mx-1 py-0.5 -my-0.5 cursor-default transition-all duration-150 ${
                  isHover ? "bg-muted/40" : ""
                } ${dim ? "opacity-50" : ""}`}
                onMouseEnter={() => setHoverState(s.state)}
                title={`${s.state}: ${s.total} day${s.total === 1 ? "" : "s"} (${
                  totalAll > 0 ? Math.round((s.total / totalAll) * 100) : 0
                }% of total)`}
              >
                <div className="text-xs text-muted-foreground font-light truncate">{s.state}</div>
                <div className="relative h-5 bg-muted/30 rounded-sm overflow-hidden">
                  <div className="absolute inset-y-0 left-0 flex" style={{ width: `${widthPct}%` }}>
                    {months.map((m, idx) => {
                      const count = s.byMonth[m] ?? 0
                      if (count === 0) return null
                      const segPct = (count / s.total) * 100
                      const segDim = hoverMonth !== null && hoverMonth !== m
                      return (
                        <div
                          key={`${s.state}-${m}`}
                          className={`${monthColors[idx % monthColors.length]} transition-opacity duration-150 ${
                            segDim ? "opacity-30" : ""
                          }`}
                          style={{ width: `${segPct}%` }}
                          title={`${s.state} · ${fmtMonthLabel(m)}: ${count} day${count === 1 ? "" : "s"}`}
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

        <div
          className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground"
          onMouseLeave={() => setHoverMonth(null)}
        >
          <span className="text-muted-foreground/70">Months:</span>
          {months.map((m, idx) => {
            const dim = hoverMonth !== null && hoverMonth !== m
            return (
              <div
                key={`leg-${m}`}
                className={`flex items-center gap-1.5 cursor-default transition-opacity duration-150 ${
                  dim ? "opacity-40" : ""
                }`}
                onMouseEnter={() => setHoverMonth(m)}
              >
                <span className={`inline-block w-3 h-3 rounded-sm ${monthColors[idx % monthColors.length]}`} />
                <span>{fmtMonthLabel(m)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
