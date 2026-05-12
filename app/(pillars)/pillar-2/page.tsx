import type { Metadata } from "next"
import { getPillar } from "@/lib/data/pillars"
import { loadPillar2Data } from "@/lib/data/pillar-2"
import { PillarHero, PillarSection } from "@/components/pillars/pillar-shell"
import { MetricCard } from "@/components/pillars/pillar-2/metric-card"
import { MobilizationChart } from "@/components/pillars/pillar-2/mobilization-chart"
import { StateBarChart } from "@/components/pillars/pillar-2/state-bar-chart"
import { PrisonerBreakdown } from "@/components/pillars/pillar-2/prisoner-breakdown"

const pillar = getPillar("pillar-2")

export const metadata: Metadata = {
  title: `${pillar.title} — Venezuelan Transition Tracker`,
  description: pillar.description,
}

function formatDateRange(start: string, end: string): string {
  if (!start || !end) return ""
  const s = new Date(`${start}T00:00:00Z`)
  const e = new Date(`${end}T00:00:00Z`)
  const fmt = (d: Date) =>
    d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  return `${fmt(s)} – ${fmt(e)}`
}

export default async function Pillar2Page() {
  const data = await loadPillar2Data()
  const { metrics, daily, categoryTotals, states, prisonersByCategory, prisonerCumulative, prisonerCategories } = data
  const months = Array.from(new Set(daily.map((d) => d.date.slice(0, 7)))).sort()
  const windowLabel = formatDateRange(metrics.windowStart, metrics.windowEnd)

  return (
    <>
      <PillarHero pillar={pillar} />

      <PillarSection
        label="Headline metrics"
        description={`Top-level indicators on assembly, organizing, and government response. Window: ${windowLabel}.`}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Protests reported"
            value={metrics.protestDays}
            sub={`/ ${metrics.totalDays}d`}
            hint="Days in the window with at least one detected protest in the exiled-press dataset."
          />
          <MetricCard
            label="Political prisoners"
            value={metrics.politicalPrisonersCurrent ?? "—"}
            hint={
              metrics.politicalPrisonersCurrent != null
                ? `Foro Penal running total, as of ${metrics.politicalPrisonersAsOf ?? "latest figure"}.`
                : "Foro Penal running total — no canonical figure surfaced this window."
            }
          />
          <MetricCard
            label="Repressed protests"
            value={metrics.repressedProtestDays}
            hint="Days where reported state response reached arrests or worse (repression ≥ 2/5)."
          />
          <MetricCard
            label="States with activity"
            value={metrics.statesWithActivity}
            sub="/ 24"
            hint="Distinct Venezuelan states with reported protest activity in the window."
          />
        </div>
      </PillarSection>

      <PillarSection
        label="Protest activity over time"
        title="How often are Venezuelans mobilizing?"
        description="Daily protest reports by category (labor, services, political, …) with an overlay row showing state-response intensity. Each cell = one day; filled = that category was reported."
      >
        <MobilizationChart daily={daily} categoryTotals={categoryTotals} />
      </PillarSection>

      <PillarSection
        label="Geographic distribution"
        title="Which states are most active?"
        description="Protest-days per Venezuelan state in the window, segmented by month. Distrito Capital concentration partly reflects exiled-press coverage bias."
      >
        <StateBarChart states={states} months={months} />
      </PillarSection>

      <PillarSection
        label="Political prisoners"
        title="Who is detained and for what?"
        description="Mentions of political prisoners tracked by Foro Penal and other monitor sources, broken down by category (civilian, military, indigenous, journalist, politician, minor) and status."
      >
        <PrisonerBreakdown
          byCategory={prisonersByCategory}
          cumulative={prisonerCumulative}
          categories={prisonerCategories}
        />
      </PillarSection>

      <PillarSection
        label="Sources & methodology"
        title="How this index is built"
        description="15 banned/exiled X accounts (news outlets, exiled investigative journalists, criminalized human-rights NGOs, and Foro Penal leadership) crawled into per-day buckets, then classified by Claude Haiku across protest, repression and political-prisoner dimensions. Outputs are reconciled across sources into the per-day rollups behind these charts. Selection bias caveat: this measures what the exiled press reports — real activity may be higher or biased toward regions with stronger correspondent networks."
      >
        <p className="text-xs text-muted-foreground/70">
          Raw data: <code className="font-mono">data/{pillar.dataDir}/raw/</code> · Cleaned data:{" "}
          <code className="font-mono">data/{pillar.dataDir}/cleaned/</code> · Pipelines:{" "}
          <code className="font-mono">scripts/pillar2-crawl-banned-press.ts</code> +{" "}
          <code className="font-mono">scripts/pillar2-analyze-protests.ts</code>
        </p>
      </PillarSection>
    </>
  )
}
