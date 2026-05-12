import type { Metadata } from "next"
import { getPillar } from "@/lib/data/pillars"
import { readPillarCsv, type CsvRow } from "@/lib/data/csv"
import { PillarHero, PillarSection } from "@/components/pillars/pillar-shell"
import { MetricCard } from "@/components/pillars/pillar-1-charts"
import {
  InflationTrendChart,
  FxDivergenceChart,
  OilProductionChart,
  BasketLatestChart,
  CanastaVsWageHero,
  type InflationPoint,
  type FxPoint,
  type OilPoint,
  type BasketRow,
  type WageRow,
} from "@/components/pillars/pillar-3-charts"

const pillar = getPillar("economic-activity-and-inflation")

export const metadata: Metadata = {
  title: `${pillar.title} — Venezuelan Transition Tracker`,
  description: pillar.description,
}

// Server component — reads cleaned CSVs at request time. CSVs are produced by
// `pnpm pillar3:crawl`. Missing files render placeholders.
export default async function Pillar3Page() {
  const [inflation, fx, oil, basketIndex, wage] = await Promise.all([
    safeRead("inflation-monthly.csv"),
    safeRead("fx-rate-daily.csv"),
    safeRead("oil-production-monthly.csv"),
    safeRead("basket-index.csv"),
    safeRead("minimum-wage-monthly.csv"),
  ])

  const inflationPoints = aggregateInflation(inflation)
  const fxPoints = mapFxRows(fx)
  const oilPoints = mapOilRows(oil)
  const basketRows = mapBasketIndex(basketIndex)
  const wageRows = mapWageRows(wage)
  const latestWage = wageRows[wageRows.length - 1] ?? null

  const headlines = computeHeadlines({ inflation, fx, oil, basketIndex, wage: latestWage })

  return (
    <>
      <PillarHero pillar={pillar} />

      <PillarSection
        label="Headline metrics"
        description="Top-line economic indicators — every inflation figure here is inferred, because Venezuela has no official one. The minimum wage is reported but its real value depends on which Bs/USD rate you use."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Monthly inflation"
            value={headlines.latestInflationMom ?? null}
            unit="%"
            hint={
              headlines.inflationAsOf
                ? `OVF (independent) · ${headlines.inflationAsOf}`
                : "Inferred, OVF independent estimate"
            }
          />
          <MetricCard
            label="USD/Bs (paralelo)"
            value={headlines.latestParalelo ?? null}
            hint={headlines.fxAsOf ? `As of ${headlines.fxAsOf}` : "Latest parallel rate"}
          />
          <MetricCard
            label="Oil output"
            value={headlines.latestOil ?? null}
            unit="kbd"
            hint={
              headlines.oilAsOf
                ? `JODI · ${headlines.oilAsOf}`
                : "Barrels/day, JODI primary database"
            }
          />
          <MetricCard
            label="Minimum wage (integral)"
            value={headlines.latestWageUsd ?? null}
            unit="USD/mo"
            hint={
              headlines.wageAsOf
                ? `Base Bs 130 + cestaticket + bono · ${headlines.wageAsOf}`
                : "Curated from Wikipedia + Cendas-FVM"
            }
          />
        </div>
      </PillarSection>

      <PillarSection
        label="Consumer basket"
        title="Where the canasta básica really lands"
        description="Venezuela's formal minimum wage has been frozen at Bs 130/month since March 2022 — at today's BCV rate, less than a dollar a month. Even with the cestaticket and Bono de Guerra bonuses included, one month of 'integral' minimum income buys only a fraction of the basic food basket."
      >
        <CanastaVsWageHero basket={basketRows} wage={latestWage} />
        <div className="mt-6">
          <BasketLatestChart rows={basketRows} />
        </div>
      </PillarSection>

      <PillarSection
        label="Inflation"
        title="What is the actual price level doing?"
        description="No 'official' inflation series exists — BCV deliberately stopped publishing it. Both lines below are inferred: OVF's monthly CPI estimate (broad) and a food-only series we compute from this crawler's own basket-prices.csv (geometric mean across canasta ingredients)."
      >
        <InflationTrendChart data={inflationPoints} mode="mom" />
      </PillarSection>

      <PillarSection
        label="Exchange rate"
        title="Official vs. parallel rate divergence"
        description="Daily Bs/USD across the BCV official rate (authoritative — they do publish FX, just not inflation) and the parallel market. The gap between them is itself a signal: a widening premium means devaluation expectations are running ahead of policy."
      >
        <FxDivergenceChart data={fxPoints} />
      </PillarSection>

      <PillarSection
        label="Oil & real activity"
        title="What is the productive economy doing?"
        description="Monthly Venezuelan crude production from JODI's primary database — the same secondary-source aggregation that feeds OPEC's MOMR. Nightlight composites (NOAA VIIRS) are documented as a future addition; raster + state-level aggregation is out of scope for this CSV pipeline."
      >
        <OilProductionChart data={oilPoints} />
      </PillarSection>

      <PillarSection
        label="Sources & methodology"
        title="How this index is built"
        description="Venezuela's central bank does not publish a reliable inflation series, so every CPI figure here is an inference. OVF's monthly estimate is the most-cited independent measure; the canasta line is our own crawl of supermarket prices. FX comes from BCV's own daily XLS publications. Oil uses JODI's primary database. Minimum wage is curated from Wikipedia and Cendas-FVM reports."
      >
        <p className="text-xs text-muted-foreground/70">
          Raw data: <code className="font-mono">data/{pillar.dataDir}/raw/</code> ·
          Cleaned data: <code className="font-mono">data/{pillar.dataDir}/cleaned/</code> ·
          Refresh: <code className="font-mono">pnpm pillar3:crawl</code>
        </p>
      </PillarSection>
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function safeRead(file: string): Promise<CsvRow[]> {
  try {
    return await readPillarCsv(pillar.dataDir, file)
  } catch {
    return []
  }
}

function aggregateInflation(rows: CsvRow[]): InflationPoint[] {
  // Inflation rows are long-form: (date, source) where source ∈ {ovf,
  // basket_canasta}. Pivot to one row per month with one column per series.
  const byDate = new Map<string, InflationPoint>()
  for (const r of rows) {
    const date = r.date
    if (!date) continue
    const mom = parseNumOrNull(r.mom_pct)
    const cur = byDate.get(date) ?? { date, ovf: null, basket: null }
    if (r.source === "ovf") cur.ovf = mom ?? cur.ovf
    else if (r.source === "basket_canasta") cur.basket = mom ?? cur.basket
    byDate.set(date, cur)
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function mapFxRows(rows: CsvRow[]): FxPoint[] {
  return rows
    .filter((r) => r.date)
    .map((r) => ({
      date: r.date,
      bcv: parseNumOrNull(r.bcv_bs_per_usd),
      paralelo: parseNumOrNull(r.paralelo_bs_per_usd),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function mapOilRows(rows: CsvRow[]): OilPoint[] {
  return rows
    .filter((r) => r.date && r.value_kbd)
    .map((r) => ({ date: r.date, kbd: Number(r.value_kbd) }))
    .filter((p) => Number.isFinite(p.kbd))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function mapWageRows(rows: CsvRow[]): WageRow[] {
  return rows
    .filter((r) => r.date && r.total_usd)
    .map((r) => ({
      date: r.date,
      base_wage_bs: Number(r.base_wage_bs) || 0,
      total_bs: Number(r.total_bs) || 0,
      total_usd: Number(r.total_usd) || 0,
      note: r.note || null,
    }))
    .filter((r) => Number.isFinite(r.total_usd) && r.total_usd > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function mapBasketIndex(rows: CsvRow[]): BasketRow[] {
  return rows
    .filter((r) => r.date && r.ingredient)
    .map((r) => ({
      date: r.date,
      ingredient: r.ingredient,
      n_skus: Number(r.n_skus) || 0,
      median_price_ref_usd: parseNumOrNull(r.median_price_ref_usd),
      implied_price_usd_paralelo: parseNumOrNull(r.implied_price_usd_paralelo),
    }))
}

function computeHeadlines(args: {
  inflation: CsvRow[]
  fx: CsvRow[]
  oil: CsvRow[]
  basketIndex: CsvRow[]
  wage: WageRow | null
}) {
  // Latest OVF MoM with a non-empty value.
  const ovfRows = args.inflation
    .filter((r) => r.source === "ovf" && r.mom_pct)
    .sort((a, b) => a.date.localeCompare(b.date))
  const latestOvf = ovfRows[ovfRows.length - 1]
  const latestInflationMom = latestOvf?.mom_pct ? formatPctNum(latestOvf.mom_pct) : null
  const inflationAsOf = latestOvf?.date ? formatMonthYear(latestOvf.date) : null

  // Latest paralelo.
  const fxRows = args.fx
    .filter((r) => r.paralelo_bs_per_usd)
    .sort((a, b) => a.date.localeCompare(b.date))
  const latestFx = fxRows[fxRows.length - 1]
  const latestParalelo = latestFx?.paralelo_bs_per_usd
    ? Number(latestFx.paralelo_bs_per_usd).toFixed(2)
    : null
  const fxAsOf = latestFx?.date ?? null

  // Latest oil.
  const oilRows = args.oil
    .filter((r) => r.value_kbd)
    .sort((a, b) => a.date.localeCompare(b.date))
  const latestOil = oilRows[oilRows.length - 1]
  const latestOilKbd = latestOil?.value_kbd ? Number(latestOil.value_kbd).toFixed(0) : null
  const oilAsOf = latestOil?.date ? formatMonthYear(latestOil.date) : null

  // Basket median across ingredients on the latest date present.
  const basketByDate = new Map<string, number[]>()
  for (const r of args.basketIndex) {
    if (!r.date || !r.median_price_ref_usd) continue
    const v = Number(r.median_price_ref_usd)
    if (!Number.isFinite(v)) continue
    const arr = basketByDate.get(r.date) ?? []
    arr.push(v)
    basketByDate.set(r.date, arr)
  }
  const basketDates = [...basketByDate.keys()].sort()
  const latestBasketDate = basketDates[basketDates.length - 1]
  const latestBasketValues = latestBasketDate ? basketByDate.get(latestBasketDate)! : null
  const latestBasketMedian =
    latestBasketValues && latestBasketValues.length > 0
      ? `$${median(latestBasketValues).toFixed(2)}`
      : null
  const basketAsOf = latestBasketDate ?? null

  // Latest minimum-wage USD value (curated CSV)
  const latestWageUsd = args.wage ? args.wage.total_usd.toFixed(2) : null
  const wageAsOf = args.wage ? formatMonthYear(args.wage.date) : null

  return {
    latestInflationMom,
    inflationAsOf,
    latestParalelo,
    fxAsOf,
    latestOil: latestOilKbd,
    oilAsOf,
    latestBasket: latestBasketMedian,
    basketAsOf,
    latestWageUsd,
    wageAsOf,
  }
}

function parseNumOrNull(s: string | undefined): number | null {
  if (s == null || s === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function formatPctNum(s: string): string {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

function formatMonthYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  if (!y || !m) return iso
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[m - 1]} ${y}`
}
