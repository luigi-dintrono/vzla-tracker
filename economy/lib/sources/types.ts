// Shared shape that every source adapter returns. The orchestrator stitches
// rows from all enabled sources into the same basket-prices.csv.

export type PriceRow = {
  date: string // YYYY-MM-DD
  ingredient: string // basket key
  store: string // gama | farmatodo | plazas
  source: string // how the row was obtained: live, wayback, algolia, magento
  sku: string
  name: string
  brand: string | null
  /** Price in Bolívares (null if the store only publishes USD). */
  priceBs: number | null
  /** Price in USD reference (null if the store only publishes Bs). */
  priceRefUsd: number | null
  /** If known: implied BCV rate at the moment of observation. */
  bcvRateAtSnapshot: number | null
  availability: string | null
  /** Wayback timestamp (YYYYMMDDhhmmss) or live ingestion time. */
  snapshotTs: string
  sourceUrl: string
}
