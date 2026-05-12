// Parse a Wayback-archived gamaenlinea product page into a normalised price
// record. Pulls structured data from two embedded <script> tags:
//
//   <script id="json-ld">        — schema.org Product (sku, name, offers)
//   <script id="ng-state">       — Angular TransferState, includes the
//                                  REF→VES conversion rate active on the
//                                  archive date (= the BCV rate that day).

export type GamaProductSnapshot = {
  /** Snapshot date (YYYY-MM-DD) — assigned by the caller from the timestamp. */
  date: string
  /** Wayback timestamp (YYYYMMDDhhmmss) — assigned by the caller. */
  snapshotTs: string
  /** Source URL slug, e.g. "chistorras-excelsior-gama-300-gr". */
  slug: string
  /** SKU (= internal product code). */
  sku: string
  name: string
  brand: string | null
  /** Price in Bs. */
  priceBs: number
  /** Price in REF (Ref. = USD-at-BCV-rate as gamaenlinea reports it). */
  priceRefUsd: number
  /** REF→VES conversion rate at the snapshot moment (the implied BCV rate). */
  bcvRate: number
  /** "inStock" / "outOfStock" / null if absent. */
  availability: string | null
}

export type ParseResult =
  | { ok: true; record: GamaProductSnapshot }
  | { ok: false; reason: string }

const JSON_LD_RX = /<script id="json-ld"[^>]*>([\s\S]+?)<\/script>/
const NG_STATE_RX = /<script id="ng-state"[^>]*>([\s\S]+?)<\/script>/

export function extractSlug(url: string): string | null {
  // Both URL shapes appear in Wayback:
  //   /es/<slug>/p/<code>                              ← current Spartacus
  //   /<CATEGORY>/<SUBCAT>/<...>/<SLUG>/p/<code>       ← legacy Hybris path
  const m = url.match(/\/([^/]+)\/p\/[^/?#]+/i)
  if (!m) return null
  return m[1].toLowerCase()
}

export function parseGamaSnapshot(
  html: string,
  meta: { date: string; snapshotTs: string; originalUrl: string }
): ParseResult {
  const slug = extractSlug(meta.originalUrl)
  if (!slug) return { ok: false, reason: "no slug in URL" }

  const ldMatch = html.match(JSON_LD_RX)
  if (!ldMatch) return { ok: false, reason: "no json-ld block" }
  let ld: unknown
  try {
    ld = JSON.parse(decodeHtmlEntities(ldMatch[1]))
  } catch (err) {
    return { ok: false, reason: `json-ld parse: ${(err as Error).message}` }
  }
  const product = findProduct(ld)
  if (!product) return { ok: false, reason: "no Product in json-ld" }

  const stateMatch = html.match(NG_STATE_RX)
  if (!stateMatch) return { ok: false, reason: "no ng-state block" }
  let state: any
  try {
    state = JSON.parse(decodeHtmlEntities(stateMatch[1]))
  } catch (err) {
    return { ok: false, reason: `ng-state parse: ${(err as Error).message}` }
  }
  const currencies = state?.["cx-state"]?.siteContext?.currencies?.entities
  if (!currencies?.REF || !currencies?.VES) {
    return { ok: false, reason: "currencies missing in ng-state" }
  }
  const refConversion = parseEsNumber(currencies.REF.conversion)
  if (!Number.isFinite(refConversion) || refConversion <= 0) {
    return { ok: false, reason: `bad REF conversion: ${currencies.REF.conversion}` }
  }

  const offer = product.offers
  if (!offer || typeof offer.price !== "number") {
    return { ok: false, reason: "no price in offers" }
  }
  const priceCurrency: string = String(offer.priceCurrency ?? "").toUpperCase()

  let priceBs: number
  let priceRefUsd: number
  if (priceCurrency === "REF") {
    priceRefUsd = offer.price
    priceBs = +(offer.price * refConversion).toFixed(2)
  } else if (priceCurrency === "VES") {
    priceBs = offer.price
    priceRefUsd = +(offer.price / refConversion).toFixed(4)
  } else {
    return { ok: false, reason: `unknown priceCurrency: ${priceCurrency}` }
  }

  return {
    ok: true,
    record: {
      date: meta.date,
      snapshotTs: meta.snapshotTs,
      slug,
      sku: String(product.sku ?? ""),
      name: String(product.name ?? "").trim(),
      brand: product.brand ? String(product.brand).trim() : null,
      priceBs,
      priceRefUsd,
      bcvRate: refConversion,
      availability: offer.availability ? String(offer.availability) : null,
    },
  }
}

function findProduct(ld: unknown): any | null {
  const arr = Array.isArray(ld) ? ld : [ld]
  for (const item of arr) {
    if (item && typeof item === "object" && (item as any)["@type"] === "Product") return item
  }
  return null
}

/** Spanish-locale numbers use "." as thousands and "," as decimal. */
function parseEsNumber(s: string): number {
  if (typeof s !== "string") return Number.NaN
  const cleaned = s.replace(/\./g, "").replace(",", ".")
  return Number(cleaned)
}

function decodeHtmlEntities(s: string): string {
  // ng-state and json-ld scripts get HTML-escaped by Angular Universal.
  // We only need to undo the handful that actually appear in JSON literals.
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}
