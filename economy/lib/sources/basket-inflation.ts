// Derive a food-only inflation series from the canasta-básica prices we've
// already crawled. The series is intentionally simple so it sits next to
// official BCV / independent OVF figures on the same chart:
//
//   1. Group basket-prices.csv rows by (year-month, ingredient)
//   2. Median USD price per (month, ingredient) — robust to product mix
//   3. Geometric mean across the 20 ingredients → one number per month
//      (geometric mean avoids letting a single high-priced item like
//      `leche en polvo` dominate the index)
//   4. MoM % = level_t / level_{t-1} − 1
//   5. YoY % = level_t / level_{t-12} − 1
//
// We emit one row per month we observe, even if MoM / YoY can't be computed
// (gaps in the underlying basket coverage are the norm right now).

import { readFileSync, existsSync } from "node:fs"
import type { InflationRow } from "./ovf-inflation"

export type BasketInflationRow = {
  date: string // YYYY-MM-01
  source: "basket_canasta"
  /** Geometric-mean USD price across all canasta items observed that month. */
  basket_usd_level: number
  /** % vs prior month. Null if prior month wasn't observed. */
  mom_pct: number | null
  /** % vs 12 months prior. Null if not enough history. */
  yoy_pct: number | null
  /** Number of distinct ingredients that contributed. */
  n_ingredients: number
}

/** Read basket-prices.csv from disk and derive monthly food inflation. */
export function computeBasketInflation(basketCsvPath: string): BasketInflationRow[] {
  if (!existsSync(basketCsvPath)) return []
  const raw = readFileSync(basketCsvPath, "utf8")
  const lines = raw.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length < 2) return []
  const header = lines[0].split(",")
  const idx = {
    date: header.indexOf("date"),
    ingredient: header.indexOf("ingredient"),
    price_ref_usd: header.indexOf("price_ref_usd"),
  }
  if (idx.date < 0 || idx.ingredient < 0 || idx.price_ref_usd < 0) return []

  // Bucket: month → ingredient → list of USD prices observed that month
  const buckets = new Map<string, Map<string, number[]>>()
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const date = cells[idx.date]
    if (!date) continue
    const ym = date.slice(0, 7) // YYYY-MM
    const ingredient = cells[idx.ingredient]
    const usdStr = cells[idx.price_ref_usd]
    if (!ingredient || !usdStr) continue
    const usd = Number(usdStr)
    if (!Number.isFinite(usd) || usd <= 0) continue
    let perIngredient = buckets.get(ym)
    if (!perIngredient) {
      perIngredient = new Map()
      buckets.set(ym, perIngredient)
    }
    const arr = perIngredient.get(ingredient) ?? []
    arr.push(usd)
    perIngredient.set(ingredient, arr)
  }
  if (buckets.size === 0) return []

  // Per-month aggregation: geometric mean of per-ingredient medians.
  const monthlyLevel = new Map<string, { level: number; n: number }>()
  for (const [ym, perIngredient] of buckets) {
    const medians: number[] = []
    for (const prices of perIngredient.values()) {
      medians.push(median(prices))
    }
    if (medians.length === 0) continue
    monthlyLevel.set(ym, { level: geomean(medians), n: medians.length })
  }

  // Sort + compute MoM and YoY
  const months = [...monthlyLevel.keys()].sort()
  const rows: BasketInflationRow[] = []
  for (const ym of months) {
    const { level, n } = monthlyLevel.get(ym)!
    const prevYm = shiftMonth(ym, -1)
    const yoyYm = shiftMonth(ym, -12)
    const prev = monthlyLevel.get(prevYm)?.level
    const yoyBase = monthlyLevel.get(yoyYm)?.level
    rows.push({
      date: `${ym}-01`,
      source: "basket_canasta",
      basket_usd_level: +level.toFixed(4),
      mom_pct: prev ? +((level / prev - 1) * 100).toFixed(2) : null,
      yoy_pct: yoyBase ? +((level / yoyBase - 1) * 100).toFixed(2) : null,
      n_ingredients: n,
    })
  }
  return rows
}

/** Convert basket inflation rows to the same shape as InflationRow so they
 *  can sit in the unified `inflation-monthly.csv`. */
export function toInflationRows(rows: BasketInflationRow[]): InflationRow[] {
  return rows.map(r => ({
    date: r.date,
    source: "basket_canasta" as unknown as "ovf",
    mom_pct: r.mom_pct,
    ytd_pct: null,
    yoy_pct: r.yoy_pct,
    source_url: `local:basket-prices.csv (n_ingredients=${r.n_ingredients}, level=${r.basket_usd_level})`,
    article_date: null,
  }))
}

// ── helpers ──────────────────────────────────────────────────────────

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

function geomean(xs: number[]): number {
  // Σ log(x) / n, then exp
  let s = 0
  for (const x of xs) s += Math.log(x)
  return Math.exp(s / xs.length)
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Minimal CSV line parser sufficient for the basket-prices schema we write
 *  (no embedded newlines; only commas + quoted fields with escaped quotes). */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuote = false
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuote = true
    } else if (c === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}
