// One-shot crawler that pulls Venezuelan canasta-básica prices from several
// stores (gamaenlinea, Farmatodo, Automercados Plaza's), joins them with
// daily BCV + paralelo FX rates, and writes a unified set of CSVs:
//
//   raw/gama-wayback-cdx.json          cached gama CDX
//   raw/plazas-wayback-cdx.json        cached plaza CDX
//   raw/wayback/<sku>-<ts>.html        cached snapshot HTML
//   raw/plazas-wayback/*.html          cached plaza HTML
//   cleaned/basket-prices.csv          per-SKU rows (all stores)
//   cleaned/fx-rate-daily.csv          BCV + Paralelo per day
//   cleaned/basket-index.csv           per-(date, ingredient) median + FX
//
// Usage:
//   npx tsx economy/crawl.ts                            # last 90 days, all stores
//   npx tsx economy/crawl.ts --from 20240101 --to 20251231
//   npx tsx economy/crawl.ts --only arroz,harina_maiz
//   npx tsx economy/crawl.ts --stores gama,farmatodo    # subset of stores
//   npx tsx economy/crawl.ts --skip-fetch               # reuse caches
//   npx tsx economy/crawl.ts --skip-live                # don't hit OCC/Algolia

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { CANASTA_BASICA, classify, type BasketItem } from "./basket"
import { listSnapshots, fetchSnapshotHtml, type Snapshot } from "./lib/wayback"
import { parseGamaSnapshot, extractSlug } from "./lib/gama-parser"
import { fetchFxHistory, type FxRate } from "./lib/fx"
import { searchProductsBothCurrencies } from "./lib/gama-occ"
import { writeCsv } from "./lib/csv"
import type { PriceRow } from "./lib/sources/types"
import { fetchFarmatodoPrices } from "./lib/sources/farmatodo"
import { fetchPlazasPrices } from "./lib/sources/plazas"
import { fetchJodiVenezuelaCrude } from "./lib/sources/jodi-oil"
import { fetchOvfInflation } from "./lib/sources/ovf-inflation"
import { computeBasketInflation } from "./lib/sources/basket-inflation"

const ALL_STORES = ["gama", "farmatodo", "plazas"] as const
type StoreKey = (typeof ALL_STORES)[number]

const ALL_DATASETS = ["basket", "fx", "inflation", "oil"] as const
type DatasetKey = (typeof ALL_DATASETS)[number]

type Options = {
  from: string
  to: string
  skipFetch: boolean
  skipLive: boolean
  onlyKeys: Set<string> | null
  stores: Set<StoreKey>
  datasets: Set<DatasetKey>
  fetchConcurrency: number
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const today = new Date()
  const isoYmd = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
  const ninetyAgo = new Date(today)
  ninetyAgo.setDate(today.getDate() - 90)

  const opts: Options = {
    from: isoYmd(ninetyAgo),
    to: isoYmd(today),
    skipFetch: false,
    skipLive: false,
    onlyKeys: null,
    stores: new Set(ALL_STORES),
    datasets: new Set(ALL_DATASETS),
    fetchConcurrency: 4,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--from":
        opts.from = args[++i]
        break
      case "--to":
        opts.to = args[++i]
        break
      case "--skip-fetch":
        opts.skipFetch = true
        break
      case "--skip-live":
        opts.skipLive = true
        break
      case "--only":
        opts.onlyKeys = new Set(args[++i].split(",").map(s => s.trim()))
        break
      case "--stores":
        opts.stores = new Set(
          args[++i].split(",").map(s => s.trim()) as StoreKey[]
        )
        break
      case "--datasets":
        opts.datasets = new Set(
          args[++i].split(",").map(s => s.trim()) as DatasetKey[]
        )
        break
      case "--concurrency":
        opts.fetchConcurrency = Math.max(1, parseInt(args[++i], 10))
        break
      case "--help":
        console.log(`Usage: tsx economy/crawl.ts [options]

Options:
  --from YYYYMMDD     Window start (default: 90 days ago)
  --to YYYYMMDD       Window end (default: today)
  --only k1,k2        Restrict to specific ingredient keys (see basket.ts)
  --stores g,f,p      Restrict to specific stores: gama | farmatodo | plazas
  --datasets x,y,z    Restrict to specific datasets: basket | fx | inflation | oil
  --skip-fetch        Reuse cached CDX + HTML; don't hit Wayback again
  --skip-live         Don't supplement with today's live API prices
  --concurrency N     Parallel Wayback fetches (default 4)
`)
        process.exit(0)
      default:
        console.error(`Unknown argument: ${args[i]}`)
        process.exit(1)
    }
  }
  return opts
}

const ROOT = resolve(__dirname, "..")
const RAW_DIR = join(ROOT, "data/pillar-3-economy/raw")
const RAW_GAMA_WB_DIR = join(RAW_DIR, "wayback")
const RAW_GAMA_CDX = join(RAW_DIR, "wayback-cdx.json")
const RAW_PLAZAS_WB_DIR = join(RAW_DIR, "plazas-wayback")
const RAW_PLAZAS_CDX = join(RAW_DIR, "plazas-wayback-cdx.json")
const CLEAN_DIR = join(ROOT, "data/pillar-3-economy/cleaned")

async function main() {
  const opts = parseArgs()
  console.log(`[economy] Window: ${opts.from} .. ${opts.to}`)
  console.log(`[economy] Datasets: ${[...opts.datasets].join(",")}`)
  if (opts.datasets.has("basket")) {
    console.log(`[economy] Stores: ${[...opts.stores].join(",")}`)
    console.log(`[economy] Ingredients: ${opts.onlyKeys ? [...opts.onlyKeys].join(",") : "all 20"}`)
  }

  for (const d of [RAW_DIR, RAW_GAMA_WB_DIR, RAW_PLAZAS_WB_DIR, CLEAN_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }

  const allRows: PriceRow[] = []

  // ── FX history (used by Farmatodo for Bs→USD conversion + downstream join)
  let fxRows: FxRate[] = []
  if (opts.datasets.has("fx") || opts.datasets.has("basket")) {
    console.log("[economy] Fetching FX history (BCV + Paralelo)")
    try {
      fxRows = await fetchFxHistory(opts.from, opts.to)
      console.log(`[economy] FX: ${fxRows.length} daily rows`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[economy] FX history fetch failed: ${msg}`)
    }
  }
  const todayBcvRate =
    fxRows.find(r => r.bcv && r.date === new Date().toISOString().slice(0, 10))?.bcv ??
    fxRows.filter(r => r.bcv).at(-1)?.bcv ??
    0

  // ── Gama (Wayback + live OCC) ────────────────────────────────────────
  if (opts.datasets.has("basket") && opts.stores.has("gama")) {
    const gamaRows = await crawlGama(opts)
    console.log(`[economy] gama: +${gamaRows.length} rows`)
    allRows.push(...gamaRows)
  }

  // ── Farmatodo (live Algolia) ─────────────────────────────────────────
  if (opts.datasets.has("basket") && opts.stores.has("farmatodo") && !opts.skipLive) {
    if (todayBcvRate <= 0) {
      console.warn("[economy] farmatodo: no BCV rate available — USD column will be null")
    }
    const items = opts.onlyKeys
      ? CANASTA_BASICA.filter(i => opts.onlyKeys!.has(i.key))
      : CANASTA_BASICA
    const ftRows = await fetchFarmatodoPrices(items, { bcvRate: todayBcvRate, hitsPerPage: 6 })
    console.log(`[economy] farmatodo: +${ftRows.length} rows`)
    allRows.push(...ftRows)
  }

  // ── Plaza's (Wayback Magento) ─────────────────────────────────────────
  if (opts.datasets.has("basket") && opts.stores.has("plazas")) {
    const pz = await fetchPlazasPrices({
      from: opts.from,
      to: opts.to,
      onlyKeys: opts.onlyKeys,
      cacheDir: RAW_PLAZAS_WB_DIR,
      cdxCachePath: RAW_PLAZAS_CDX,
      skipFetch: opts.skipFetch,
      fetchConcurrency: opts.fetchConcurrency,
    })
    console.log(`[economy] plazas: +${pz.rows.length} rows`)
    allRows.push(...pz.rows)
  }

  // ── Inflation: OVF (independent) + basket-derived food inflation ─────
  //
  // The basket-derived series comes from our own basket-prices.csv: per
  // ingredient median USD price per month → geometric mean across the
  // canasta → MoM / YoY % changes. It sits next to OVF rows in the same
  // CSV (distinguished by `source` column) so a chart can plot both lines
  // and let the gap between them be the signal.
  if (opts.datasets.has("inflation")) {
    type Out = {
      date: string
      source: string
      mom_pct: number | "" | null
      ytd_pct: number | "" | null
      yoy_pct: number | "" | null
      article_date: string
      source_url: string
    }
    const out: Out[] = []
    try {
      const ovf = await fetchOvfInflation()
      for (const r of ovf) {
        out.push({
          date: r.date,
          source: r.source,
          mom_pct: r.mom_pct ?? "",
          ytd_pct: r.ytd_pct ?? "",
          yoy_pct: r.yoy_pct ?? "",
          article_date: r.article_date ?? "",
          source_url: r.source_url,
        })
      }
      console.log(`[economy] OVF inflation: ${ovf.length} rows`)
    } catch (err) {
      console.warn(`[economy] OVF fetch failed: ${(err as Error).message}`)
    }

    const basketCsv = join(CLEAN_DIR, "basket-prices.csv")
    const basketDerived = computeBasketInflation(basketCsv)
    for (const r of basketDerived) {
      out.push({
        date: r.date,
        source: r.source,
        mom_pct: r.mom_pct ?? "",
        ytd_pct: "",
        yoy_pct: r.yoy_pct ?? "",
        article_date: "",
        source_url: `local:basket-prices.csv (level=${r.basket_usd_level}, n=${r.n_ingredients})`,
      })
    }
    console.log(`[economy] Basket-derived inflation: ${basketDerived.length} rows`)

    out.sort((a, b) =>
      a.date === b.date ? a.source.localeCompare(b.source) : a.date.localeCompare(b.date)
    )
    writeCsv(join(CLEAN_DIR, "inflation-monthly.csv"), out)
    console.log(`[economy] inflation-monthly.csv: ${out.length} rows`)
  }

  // ── Oil production (monthly, JODI primary database) ──────────────────
  if (opts.datasets.has("oil")) {
    try {
      const oilRows = await fetchJodiVenezuelaCrude({
        skipFetch: opts.skipFetch,
        cacheDir: join(RAW_DIR, "jodi"),
      })
      writeCsv(
        join(CLEAN_DIR, "oil-production-monthly.csv"),
        oilRows.map(r => ({
          date: r.date,
          source: r.source,
          product: r.product,
          flow: r.flow,
          unit: r.unit,
          value_kbd: r.value,
          assessment_code: r.assessment_code,
        }))
      )
      console.log(`[economy] oil-production-monthly.csv: ${oilRows.length} rows`)
    } catch (err) {
      console.warn(`[economy] oil fetch failed: ${(err as Error).message}`)
    }
  }

  // ── De-dup: (date, store, sku) — keep latest snapshot per cell ──────
  const uniq = new Map<string, PriceRow>()
  for (const r of allRows) {
    const key = `${r.date}|${r.store}|${r.sku}`
    const prev = uniq.get(key)
    if (!prev || r.snapshotTs > prev.snapshotTs) uniq.set(key, r)
  }
  const priceRows = [...uniq.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    if (a.store !== b.store) return a.store.localeCompare(b.store)
    return a.ingredient.localeCompare(b.ingredient)
  })

  // FX fallback: derive BCV from gama snapshot conversion rates if needed.
  if (fxRows.length === 0 && priceRows.length > 0) {
    console.log("[economy] FX history empty — deriving BCV from gama snapshot conversions")
    const byDate = new Map<string, number[]>()
    for (const r of priceRows) {
      if (r.store !== "gama" || !r.bcvRateAtSnapshot) continue
      const arr = byDate.get(r.date) ?? []
      arr.push(r.bcvRateAtSnapshot)
      byDate.set(r.date, arr)
    }
    fxRows = [...byDate.entries()]
      .map(([date, rates]) => ({ date, bcv: median(rates), paralelo: null }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  // ── Write outputs ─────────────────────────────────────────────────────
  // FX is its own concern — write it whenever the user asked for it OR
  // when basket is in scope (basket-index joins to FX).
  const fxByDate = new Map(fxRows.map(r => [r.date, r]))
  if (opts.datasets.has("fx") || opts.datasets.has("basket")) {
    writeCsv(
      join(CLEAN_DIR, "fx-rate-daily.csv"),
      fxRows.map(r => ({
        date: r.date,
        bcv_bs_per_usd: r.bcv ?? "",
        paralelo_bs_per_usd: r.paralelo ?? "",
        paralelo_premium_pct:
          r.bcv && r.paralelo ? +(((r.paralelo - r.bcv) / r.bcv) * 100).toFixed(2) : "",
      }))
    )
  }

  if (opts.datasets.has("basket")) {
  writeCsv(
    join(CLEAN_DIR, "basket-prices.csv"),
    priceRows.map(r => ({
      date: r.date,
      ingredient: r.ingredient,
      store: r.store,
      source: r.source,
      sku: r.sku,
      product_name: r.name,
      brand: r.brand ?? "",
      price_bs: r.priceBs ?? "",
      price_ref_usd: r.priceRefUsd ?? "",
      bcv_rate_at_snapshot: r.bcvRateAtSnapshot != null ? +r.bcvRateAtSnapshot.toFixed(4) : "",
      availability: r.availability ?? "",
      snapshot_ts: r.snapshotTs,
      source_url: r.sourceUrl,
    }))
  )

  // basket-index: per-(date, ingredient) median across ALL stores, joined w/ FX.
  // Also include per-store sub-counts so consumers can see who contributed.
  const groups = new Map<string, PriceRow[]>()
  for (const r of priceRows) {
    const k = `${r.date}|${r.ingredient}`
    const arr = groups.get(k) ?? []
    arr.push(r)
    groups.set(k, arr)
  }
  const indexRows: Record<string, unknown>[] = []
  for (const [k, rows] of groups) {
    const [date, ingredient] = k.split("|")
    const fx = fxByDate.get(date)
    const bcv = fx?.bcv ?? null
    const paralelo = fx?.paralelo ?? null

    // Build a list of (priceBs, priceRefUsd) pairs, filling whichever is null
    // from the row's bcvRateAtSnapshot or today's FX.
    const pairs = rows.map(r => harmoniseRow(r, bcv))
    const bsList = pairs.map(p => p.priceBs).filter((x): x is number => x != null)
    const refList = pairs.map(p => p.priceRefUsd).filter((x): x is number => x != null)

    const storesContributing = new Set(rows.map(r => r.store))
    indexRows.push({
      date,
      ingredient,
      n_skus: rows.length,
      n_stores: storesContributing.size,
      stores: [...storesContributing].sort().join("|"),
      median_price_bs: bsList.length ? +median(bsList).toFixed(2) : "",
      median_price_ref_usd: refList.length ? +median(refList).toFixed(4) : "",
      bcv_bs_per_usd: bcv ?? "",
      paralelo_bs_per_usd: paralelo ?? "",
      implied_price_usd_paralelo:
        paralelo && bsList.length
          ? +(median(bsList) / paralelo).toFixed(4)
          : "",
    })
  }
  indexRows.sort((a, b) =>
    a.date === b.date
      ? String(a.ingredient).localeCompare(String(b.ingredient))
      : String(a.date).localeCompare(String(b.date))
  )
  writeCsv(join(CLEAN_DIR, "basket-index.csv"), indexRows)
  } // end of opts.datasets.has("basket") guard

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n[economy] === Summary ===")
  console.log(`[economy] Window: ${opts.from} .. ${opts.to}`)
  console.log(`[economy] Datasets: ${[...opts.datasets].join(",")}`)

  if (opts.datasets.has("basket")) {
    console.log(`[economy] Basket rows: ${priceRows.length}`)
    const byStore = countBy(priceRows, r => r.store)
    console.log(`[economy] Rows per store:`, byStore)
    console.log(`[economy] FX rows: ${fxRows.length}`)

    const coverage = new Map<string, Set<string>>()
    const stores = new Map<string, Set<string>>()
    for (const r of priceRows) {
      if (!coverage.has(r.ingredient)) coverage.set(r.ingredient, new Set())
      coverage.get(r.ingredient)!.add(r.date)
      if (!stores.has(r.ingredient)) stores.set(r.ingredient, new Set())
      stores.get(r.ingredient)!.add(r.store)
    }
    console.log(`[economy] Per-ingredient date / store coverage:`)
    for (const item of CANASTA_BASICA) {
      if (opts.onlyKeys && !opts.onlyKeys.has(item.key)) continue
      const days = coverage.get(item.key)?.size ?? 0
      const st = [...(stores.get(item.key) ?? new Set())].sort().join(",") || "-"
      console.log(`  ${item.key.padEnd(15)} ${String(days).padStart(3)} day(s)  stores=${st}  ${item.name}`)
    }
  }

  console.log(`[economy] Outputs:`)
  if (opts.datasets.has("basket")) {
    console.log(`  ${join(CLEAN_DIR, "basket-prices.csv")}`)
    console.log(`  ${join(CLEAN_DIR, "basket-index.csv")}`)
  }
  if (opts.datasets.has("fx") || opts.datasets.has("basket")) {
    console.log(`  ${join(CLEAN_DIR, "fx-rate-daily.csv")}`)
  }
  if (opts.datasets.has("inflation")) {
    console.log(`  ${join(CLEAN_DIR, "inflation-monthly.csv")}`)
  }
  if (opts.datasets.has("oil")) {
    console.log(`  ${join(CLEAN_DIR, "oil-production-monthly.csv")}`)
  }
}

// ── Gama-specific section ─────────────────────────────────────────────────
//
// Mirrors what the previous single-source crawler did: discover product page
// snapshots in CDX, drop SPA-shell captures, fetch+parse, then supplement
// with a live OCC API call for today. Returns PriceRow[].

async function crawlGama(opts: Options): Promise<PriceRow[]> {
  // 1. CDX
  let cdx: Snapshot[]
  if (opts.skipFetch && existsSync(RAW_GAMA_CDX)) {
    cdx = JSON.parse(readFileSync(RAW_GAMA_CDX, "utf8")) as Snapshot[]
    console.log(`[gama] CDX: ${cdx.length} snapshots from cache`)
  } else {
    console.log("[gama] Querying Wayback CDX for gamaenlinea.com/*")
    cdx = await listSnapshots({ url: "gamaenlinea.com/*", from: opts.from, to: opts.to })
    writeFileSync(RAW_GAMA_CDX, JSON.stringify(cdx, null, 2))
    console.log(`[gama] CDX: ${cdx.length} snapshots cached`)
  }

  // 2. Filter
  const MIN_USABLE_BYTES = 8000
  const matched: Array<{ item: BasketItem; snap: Snapshot }> = []
  for (const snap of cdx) {
    if (!snap.original.includes("/p/")) continue
    if (snap.length > 0 && snap.length < MIN_USABLE_BYTES) continue
    const slug = extractSlug(snap.original)
    if (!slug) continue
    const item = classify(slug)
    if (!item) continue
    if (opts.onlyKeys && !opts.onlyKeys.has(item.key)) continue
    matched.push({ item, snap })
  }
  console.log(`[gama] Canasta matches: ${matched.length} snapshots`)

  // 3. Fetch + parse
  const rows: PriceRow[] = []
  let nFetched = 0
  let nReused = 0
  let nFail = 0
  const queue = [...matched]
  await runPool(opts.fetchConcurrency, async () => {
    while (queue.length) {
      const { item, snap } = queue.shift()!
      const cachePath = join(RAW_GAMA_WB_DIR, `${snap.timestamp}_${slugify(snap.original)}.html`)
      let html: string
      if (existsSync(cachePath)) {
        html = readFileSync(cachePath, "utf8")
        nReused++
      } else if (opts.skipFetch) {
        continue
      } else {
        try {
          html = await fetchSnapshotHtml(snap)
          writeFileSync(cachePath, html)
          nFetched++
          await sleep(250)
        } catch {
          nFail++
          continue
        }
      }
      const res = parseGamaSnapshot(html, {
        date: snap.date,
        snapshotTs: snap.timestamp,
        originalUrl: snap.original,
      })
      if (!res.ok) { nFail++; continue }
      rows.push({
        date: res.record.date,
        ingredient: item.key,
        store: "gama",
        source: "wayback",
        sku: res.record.sku,
        name: res.record.name,
        brand: res.record.brand,
        priceBs: res.record.priceBs,
        priceRefUsd: res.record.priceRefUsd,
        bcvRateAtSnapshot: res.record.bcvRate,
        availability: res.record.availability,
        snapshotTs: res.record.snapshotTs,
        sourceUrl: `https://gamaenlinea.com/es/${res.record.slug}/p/${res.record.sku}`,
      })
    }
  })
  console.log(`[gama] HTML: ${nFetched} fetched, ${nReused} cached, ${nFail} failed`)

  // 4. Live OCC supplement for today
  if (!opts.skipLive) {
    const now = new Date()
    const liveDate = now.toISOString().slice(0, 10)
    const liveTs = now.toISOString().replace(/[-:T]/g, "").slice(0, 14)
    console.log(`[gama] Live OCC supplement for ${liveDate}`)
    const items = opts.onlyKeys
      ? CANASTA_BASICA.filter(i => opts.onlyKeys!.has(i.key))
      : CANASTA_BASICA
    let nLive = 0
    for (const item of items) {
      try {
        const live = await searchProductsBothCurrencies(item.query, 8)
        for (const p of live) {
          rows.push({
            date: liveDate,
            ingredient: item.key,
            store: "gama",
            source: "live",
            sku: p.sku,
            name: p.name,
            brand: null,
            priceBs: p.priceBs,
            priceRefUsd: p.priceRefUsd,
            bcvRateAtSnapshot: p.priceRefUsd > 0 ? p.priceBs / p.priceRefUsd : null,
            availability: null,
            snapshotTs: liveTs,
            sourceUrl: `https://gamaenlinea.com/es/${p.slug}/p/${p.sku}`,
          })
          nLive++
        }
      } catch (err) {
        console.warn(`[gama] live OCC failed for ${item.key}: ${(err as Error).message}`)
      }
      await sleep(200)
    }
    console.log(`[gama] Live OCC: +${nLive} rows`)
  }
  return rows
}

// ── Helpers ───────────────────────────────────────────────────────────────

function harmoniseRow(
  r: PriceRow,
  bcvToday: number | null
): { priceBs: number | null; priceRefUsd: number | null } {
  if (r.priceBs != null && r.priceRefUsd != null) {
    return { priceBs: r.priceBs, priceRefUsd: r.priceRefUsd }
  }
  const rate = r.bcvRateAtSnapshot ?? bcvToday ?? null
  if (rate && r.priceBs != null) {
    return { priceBs: r.priceBs, priceRefUsd: +(r.priceBs / rate).toFixed(4) }
  }
  if (rate && r.priceRefUsd != null) {
    return { priceBs: +(r.priceRefUsd * rate).toFixed(2), priceRefUsd: r.priceRefUsd }
  }
  return { priceBs: r.priceBs, priceRefUsd: r.priceRefUsd }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const m = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

function countBy<T>(rows: T[], k: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[k(r)] = (out[k(r)] ?? 0) + 1
  return out
}

function slugify(url: string): string {
  return url.replace(/[^a-z0-9]+/gi, "_").slice(-100)
}

async function runPool(concurrency: number, worker: () => Promise<void>): Promise<void> {
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

main().catch(err => {
  console.error("[economy] Fatal:", err)
  process.exit(1)
})
