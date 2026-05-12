// Automercados Plaza's — historical prices via Wayback Machine.
//
// Plaza's runs a Magento 2 storefront per branch (vallearriba.elplazas.com,
// chaguaramos.elplazas.com, etc.). Live access is gated by Cloudflare's
// JS challenge, but Wayback has rendered HTML snapshots — vallearriba in
// particular is heavily archived between Feb 2024 and Aug 2025.
//
// Magento category pages list ~12 products per page with prices in USD
// (Plaza's targets upper-middle class and displays USD directly). Each
// `<li class="product-item">` carries a SKU via `data-product-id` and a
// price under `<span class="price">$ X,YY</span>`. We discover archived
// product pages via CDX, parse each HTML, and emit one row per product.

import { setTimeout as sleep } from "node:timers/promises"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { BasketItem } from "../../basket"
import { classify } from "../../basket"
import { listSnapshots, fetchSnapshotHtml, type Snapshot } from "../wayback"
import type { PriceRow } from "./types"

// Only vallearriba.elplazas.com has meaningful Wayback coverage (~80
// SSR snapshots Feb 2024–Aug 2025). Other branches (chaguaramos, naranjos,
// centroplaza) yield 0-7 snapshots and burn minutes on CDX retries for
// negligible data — see commit 2026-05 for the probing notes.
const SUBDOMAINS = ["vallearriba"]

const MIN_USABLE_BYTES = 8000

export type PlazasOptions = {
  /** YYYYMMDD inclusive window for the CDX query. */
  from: string
  to: string
  /** Restrict to specific basket keys. */
  onlyKeys: Set<string> | null
  /** Directory for cached HTML, to avoid hammering archive.org on re-runs. */
  cacheDir: string
  /** Where to persist the CDX result. */
  cdxCachePath: string
  /** Skip network fetches and use only what's already cached. */
  skipFetch: boolean
  fetchConcurrency: number
}

export async function fetchPlazasPrices(
  opts: PlazasOptions
): Promise<{ rows: PriceRow[]; stats: { snapshots: number; parsed: number; failures: number } }> {
  if (!existsSync(opts.cacheDir)) mkdirSync(opts.cacheDir, { recursive: true })

  // ── 1. Discover snapshots across all branch subdomains ─────────────
  let cdx: Snapshot[]
  if (opts.skipFetch && existsSync(opts.cdxCachePath)) {
    cdx = JSON.parse(readFileSync(opts.cdxCachePath, "utf8")) as Snapshot[]
  } else {
    cdx = []
    for (const sub of SUBDOMAINS) {
      console.log(`[plazas] CDX scan for ${sub}.elplazas.com`)
      try {
        const snaps = await listSnapshots({
          url: `${sub}.elplazas.com/*`,
          from: opts.from,
          to: opts.to,
        })
        cdx.push(...snaps)
      } catch (err) {
        console.warn(`[plazas] CDX failed for ${sub}: ${(err as Error).message}`)
      }
      await sleep(1000)
    }
    writeFileSync(opts.cdxCachePath, JSON.stringify(cdx, null, 2))
  }

  // Magento exposes products in multiple page types: homepage + category
  // grids show <li class="product-item"> cards in cross-sell sections, PDPs
  // (URLs ending in `.html`) have a single product with itemprop="price".
  // We accept any page large enough to be SSR-rendered and skip obvious
  // non-product surfaces (contact, sucursales, catalogsearch).
  const SKIP_PATH_RX = /\/(contact|sucursales|customer|checkout|catalogsearch|account|review)\b/i
  const candidates = cdx.filter(
    s =>
      (s.length === 0 || s.length >= MIN_USABLE_BYTES) &&
      !SKIP_PATH_RX.test(s.original)
  )
  console.log(`[plazas] candidate snapshots: ${candidates.length} of ${cdx.length}`)

  // ── 2. Fetch + parse ────────────────────────────────────────────────
  const rows: PriceRow[] = []
  let parsed = 0
  let failures = 0
  let fetched = 0
  let cached = 0

  const queue = [...candidates]
  await runPool(opts.fetchConcurrency, async () => {
    while (queue.length) {
      const snap = queue.shift()!
      const cachePath = join(opts.cacheDir, `${snap.timestamp}_${slugify(snap.original)}.html`)
      let html: string
      if (existsSync(cachePath)) {
        html = readFileSync(cachePath, "utf8")
        cached++
      } else if (opts.skipFetch) {
        continue
      } else {
        try {
          html = await fetchSnapshotHtml(snap)
          writeFileSync(cachePath, html)
          fetched++
          await sleep(200)
        } catch (err) {
          failures++
          continue
        }
      }
      const items = parsePlazasPage(html, snap)
      for (const it of items) {
        // Classify by the product NAME — Plaza's URL slugs are opaque SKU
        // strings like `plz-20000602un`, useless for matching. Lowercase
        // the name and treat spaces as slug separators so our ingredient
        // patterns still work.
        const candidate = it.name.toLowerCase().replace(/\s+/g, "-")
        const item = classify(candidate)
        if (!item) continue
        if (opts.onlyKeys && !opts.onlyKeys.has(item.key)) continue
        rows.push({
          date: snap.date,
          ingredient: item.key,
          store: "plazas",
          source: "wayback",
          sku: it.sku,
          name: it.name,
          brand: null,
          priceBs: null, // Plaza's displays USD directly; no Bs at this layer
          priceRefUsd: it.priceUsd,
          bcvRateAtSnapshot: null,
          availability: null,
          snapshotTs: snap.timestamp,
          sourceUrl: it.canonicalUrl,
        })
        parsed++
      }
    }
  })

  console.log(`[plazas] HTML: ${fetched} fetched, ${cached} cached, ${failures} failed`)
  console.log(`[plazas] parsed ${parsed} product rows`)
  return { rows, stats: { snapshots: candidates.length, parsed, failures } }
}

// ── Magento parser ────────────────────────────────────────────────────
//
// Plaza's archived pages come in two flavours:
//   * Category / listing pages — multiple <li class="product-item"> cards
//   * Product detail pages (PDPs) — one product, marked up with
//     data-product-id="..." and <meta itemprop="price" content="..."/>
// Both yield rows; we parse each shape and union the results.

type ParsedItem = {
  sku: string
  name: string
  slug: string
  priceUsd: number
  canonicalUrl: string
}

// Category listing
const PRODUCT_LI_RX = /<li class="(?:item product[^"]*|product-item[^"]*)"[^>]*>([\s\S]+?)(?=<li class="(?:item product|product-item)"|<\/ol>|<\/ul>)/g
const LI_SKU_RX = /data-product-id="(\d+)"/
// Magento's anchor has attributes in any order — capture href + inner text
// from a single <a …class="product-item-link"…> tag.
const LI_HREF_RX = /<a\b[^>]*\bhref="([^"]+)"[^>]*\bclass="[^"]*\bproduct-item-link\b/
const LI_LINK_TEXT_RX = /<a\b[^>]*\bclass="[^"]*\bproduct-item-link\b[^>]*>\s*([^<]+?)\s*<\/a>/
const LI_PRICE_RX = /class="price">\$\s*([0-9.,]+)/

// PDP
const PDP_SKU_RX = /data-product-id="(\d+)"\s+data-price-box="product-id-\d+"/
const PDP_PRICE_META_RX = /<meta\s+itemprop="price"\s+content="([0-9.]+)"/
const PDP_NAME_RX = /<h1[^>]*class="[^"]*page-title[^"]*"[\s\S]*?<span[^>]*>([^<]+)<\/span>\s*<\/h1>/
const PDP_NAME_RX_ALT = /<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>\s*([^<\s][^<]*?)\s*<\/h1>/

function parsePlazasPage(html: string, snap: Snapshot): ParsedItem[] {
  const out: ParsedItem[] = []
  const seen = new Set<string>()

  // Pass 1 — category cards
  let m: RegExpExecArray | null
  PRODUCT_LI_RX.lastIndex = 0
  while ((m = PRODUCT_LI_RX.exec(html))) {
    const body = m[1]
    const sku = LI_SKU_RX.exec(body)?.[1]
    const hrefM = LI_HREF_RX.exec(body)
    const textM = LI_LINK_TEXT_RX.exec(body)
    const priceStr = LI_PRICE_RX.exec(body)?.[1]
    if (!sku || !hrefM || !textM || !priceStr) continue
    if (seen.has(sku)) continue
    seen.add(sku)
    const href = unwrapWaybackUrl(hrefM[1])
    const slug = extractPlazaSlug(href)
    if (!slug) continue
    const priceUsd = parseEsNumber(priceStr)
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue
    out.push({
      sku,
      name: textM[1].trim(),
      slug,
      priceUsd: +priceUsd.toFixed(4),
      canonicalUrl: href,
    })
  }

  // Pass 2 — single-product PDP (only if the URL itself is a product page,
  // i.e. ends in `.html` and isn't a category like `/quesos.html`).
  if (snap.original.endsWith(".html") && !snap.original.match(/\/(c|categoria|cat)\//i)) {
    const sku = PDP_SKU_RX.exec(html)?.[1]
    const priceStr = PDP_PRICE_META_RX.exec(html)?.[1]
    const name = (PDP_NAME_RX.exec(html)?.[1] || PDP_NAME_RX_ALT.exec(html)?.[1])?.trim()
    if (sku && priceStr && name && !seen.has(sku)) {
      const priceUsd = Number(priceStr)
      if (Number.isFinite(priceUsd) && priceUsd > 0) {
        const slug = extractPlazaSlug(snap.original) ?? ""
        out.push({
          sku,
          name,
          slug,
          priceUsd: +priceUsd.toFixed(4),
          canonicalUrl: snap.original,
        })
        seen.add(sku)
      }
    }
  }

  return out
}

function unwrapWaybackUrl(href: string): string {
  // Wayback rewrites links to `/web/<ts>/<original>`. Recover original.
  const m = href.match(/\/web\/\d+(?:id_|if_|im_)?\/(https?:\/\/.+)$/)
  return m ? m[1] : href
}

function extractPlazaSlug(url: string): string | null {
  // Plaza's product URLs look like `https://<branch>.elplazas.com/<slug>.html`
  // where slug is e.g. `plz-20000602un` or `harina-pan-blanca-1-kg`.
  // For categorisation we want the human-readable slug. Category-only URLs
  // (`/refrigerados-y-congelados/charcuteria/quesos.html`) get matched too
  // but those don't reach this function — they don't carry product info.
  const m = url.match(/elplazas\.com\/([^/]+)\.html$/)
  if (!m) return null
  return m[1].toLowerCase()
}

function parseEsNumber(s: string): number {
  // Plaza's uses Magento default es_VE format: "1.234,56" — dot thousands,
  // comma decimal. Strip dots, swap comma → dot.
  return Number(s.replace(/\./g, "").replace(",", "."))
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "_").slice(-100)
}

async function runPool(concurrency: number, worker: () => Promise<void>): Promise<void> {
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}
