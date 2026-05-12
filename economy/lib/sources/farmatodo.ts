// Farmatodo Venezuela — live prices via their public Algolia search index.
//
// The web app embeds an unauthenticated Algolia search-only API key in its
// HTML bundle (verified May 2026). The same index serves Farmatodo's COL/VE
// /ARG storefronts, so we filter to idStoreGroup=146 = Caracas.
//
// ⚠️ Reality caveat: the Caracas (idStoreGroup=146) inventory in Algolia has
// been observed to contain *stale pre-redenomination* prices (values like
// 68,700,000 Bs that should be 68.7 Bs.S after Venezuela's 2021 redenomi-
// nation that dropped 6 zeros). Algolia is apparently used only for search
// suggestions in the live web app, with the real prices fetched from a
// separate Google App Engine backend that this adapter cannot reach.
//
// As a result this adapter applies two guards:
//   1. Re-classify each hit by its NAME (not the search query) so we don't
//      file "Atún en aceite" under aceite, etc.
//   2. Reject any row whose USD-equivalent price exceeds MAX_PLAUSIBLE_USD —
//      stale-data rows blow past it by orders of magnitude.

import { setTimeout as sleep } from "node:timers/promises"
import type { BasketItem } from "../../basket"
import { classify } from "../../basket"
import type { PriceRow } from "./types"

/** Reject any row whose implied USD price exceeds this. Used to filter out
 *  stale pre-redenomination entries in Farmatodo's Algolia inventory. */
const MAX_PLAUSIBLE_USD = 200

const ALGOLIA_APP_ID = "VCOJEYD2PO"
const ALGOLIA_API_KEY = "869a91e98550dd668b8b1dc04bca9011"
const ALGOLIA_INDEX = "products"
const ALGOLIA_HOST = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`

const CARACAS_STORE_GROUP = 146

const UA =
  "Mozilla/5.0 (compatible; vzla-transition-tracker/0.1; canasta-tracker)"

type AlgoliaHit = {
  id: string | number
  item?: number
  description?: string
  mediaDescription?: string
  fullPrice?: number
  offerPrice?: number
  offer?: boolean
  stock?: number
  supplier?: string
  marca?: string
  categorie?: string
  subCategory?: string
}

export type FarmatodoOptions = {
  /** BCV rate used to convert prices into USD reference. */
  bcvRate: number
  hitsPerPage?: number
}

export async function fetchFarmatodoPrices(
  items: BasketItem[],
  opts: FarmatodoOptions
): Promise<PriceRow[]> {
  const today = new Date()
  const date = today.toISOString().slice(0, 10)
  const ts = today.toISOString().replace(/[-:T]/g, "").slice(0, 14)

  const out: PriceRow[] = []
  let droppedMisclassified = 0
  let droppedImplausible = 0
  for (const item of items) {
    try {
      const hits = await algoliaSearch(item.query, opts.hitsPerPage ?? 6)
      for (const h of hits) {
        const priceBs = pickPrice(h)
        if (priceBs == null) continue
        const sku = String(h.id)
        const name = (h.description ?? h.mediaDescription ?? "").trim()
        const brand = (h.marca || h.supplier || "").trim() || null

        // Guard 1: re-classify by name so cat food doesn't get filed as arroz.
        // Treat the lowercase name as a quasi-slug (works because our patterns
        // are tolerant of word breaks).
        const classified = classify(name.toLowerCase().replace(/\s+/g, "-"))
        if (classified?.key !== item.key) {
          droppedMisclassified++
          continue
        }

        const priceRefUsd =
          opts.bcvRate > 0 ? +(priceBs / opts.bcvRate).toFixed(4) : null

        // Guard 2: sanity check on implied USD price.
        if (priceRefUsd != null && priceRefUsd > MAX_PLAUSIBLE_USD) {
          droppedImplausible++
          continue
        }

        out.push({
          date,
          ingredient: item.key,
          store: "farmatodo",
          source: "algolia",
          sku,
          name,
          brand,
          priceBs,
          priceRefUsd,
          bcvRateAtSnapshot: opts.bcvRate || null,
          availability: typeof h.stock === "number" ? (h.stock > 0 ? "inStock" : "outOfStock") : null,
          snapshotTs: ts,
          sourceUrl: `https://www.farmatodo.com.ve/producto/${sku}`,
        })
      }
    } catch (err) {
      console.warn(`[farmatodo] ${item.key}: ${(err as Error).message}`)
    }
    await sleep(150) // gentle pacing
  }
  if (droppedMisclassified || droppedImplausible) {
    console.log(
      `[farmatodo] dropped ${droppedMisclassified} misclassified, ` +
        `${droppedImplausible} implausible (likely stale pre-redenomination)`
    )
  }
  return out
}

async function algoliaSearch(query: string, hitsPerPage: number): Promise<AlgoliaHit[]> {
  const url =
    `${ALGOLIA_HOST}/1/indexes/${ALGOLIA_INDEX}/query` +
    `?x-algolia-application-id=${ALGOLIA_APP_ID}` +
    `&x-algolia-api-key=${ALGOLIA_API_KEY}`
  const body = {
    params: new URLSearchParams({
      query,
      hitsPerPage: String(hitsPerPage),
      filters: `idStoreGroup=${CARACAS_STORE_GROUP}`,
    }).toString(),
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = (await res.json()) as { hits?: AlgoliaHit[]; message?: string }
  if (j.message) throw new Error(j.message)
  return j.hits ?? []
}

/** Prefer the live offer price if there is one; fall back to full price. */
function pickPrice(h: AlgoliaHit): number | null {
  if (h.offer && typeof h.offerPrice === "number" && h.offerPrice > 0) return h.offerPrice
  if (typeof h.fullPrice === "number" && h.fullPrice > 0) return h.fullPrice
  return null
}
