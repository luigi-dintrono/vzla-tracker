// Live client for gamaenlinea's SAP Commerce Cloud (Spartacus) OCC REST API.
// Returns today's prices in both VES and REF (= USD-at-BCV) for a search
// query. Used to fill in *today's* row when Wayback coverage is sparse.

const BASE = "https://api.cl94ncbhsi-excelsior1-p1-public.model-t.cc.commerce.ondemand.com/occ/v2/egb2c-spa"

// The OCC API silently rejects narrow field whitelists with NullPointerError —
// the upstream service expects the storefront's exact field preset, presumably
// because some downstream sort/facet computation reads fields it isn't asked
// to return. We use the literal preset captured from gamaenlinea's main
// bundle (see /tmp investigation in commit message).
const FULL_FIELDS =
  "products(score,baseProduct,taxWithDiscount(formattedValue,value),seoName," +
  "code,name,summary,configurable,configuratorType,multidimensional," +
  "price(FULL),images(FULL),stock(FULL),averageRating,variantOptions," +
  "vatAmountPrice(formattedValue),totalWithVatPrice(formattedValue,value)," +
  "totalPriceWithNoDiscount(formattedValue)," +
  "basePriceWithDiscount(formattedValue),categories(code,name)," +
  "promotions(code,name,message,promotionType,labelColor,labelTextColor))," +
  "facets,breadcrumbs,pagination(DEFAULT),sorts(DEFAULT)," +
  "freeTextSearch,currentQuery"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export type LiveProduct = {
  sku: string
  name: string
  slug: string
  priceBs: number
  priceRefUsd: number
}

/**
 * Run the same query twice — once in VES, once in REF — and align results by
 * SKU. The OCC API doesn't return both currencies in one response, so two
 * calls is the cleanest path.
 */
export async function searchProductsBothCurrencies(
  query: string,
  pageSize = 10
): Promise<LiveProduct[]> {
  const [ves, ref] = await Promise.all([
    fetchSearch(query, "VES", pageSize),
    fetchSearch(query, "REF", pageSize),
  ])
  const refBySku = new Map(ref.map(p => [p.code, p.price.value as number]))
  const out: LiveProduct[] = []
  for (const p of ves) {
    const refPrice = refBySku.get(p.code)
    if (refPrice == null) continue
    out.push({
      sku: String(p.code),
      name: stripHighlight(String(p.name ?? "")),
      slug: String(p.seoName ?? ""),
      priceBs: Number(p.price.value),
      priceRefUsd: Number(refPrice),
    })
  }
  return out
}

async function fetchSearch(query: string, currency: "VES" | "REF", pageSize: number) {
  const qs = new URLSearchParams({
    fields: FULL_FIELDS,
    query,
    pageSize: String(pageSize),
    currentPage: "0",
    lang: "es",
    curr: currency,
  })
  const res = await fetch(`${BASE}/products/search?${qs.toString()}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Origin: "https://gamaenlinea.com",
      Referer: "https://gamaenlinea.com/",
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} on gama OCC search`)
  const body = (await res.json()) as { products?: Array<Record<string, any>> }
  return body.products ?? []
}

function stripHighlight(s: string): string {
  return s.replace(/<\/?em[^>]*>/g, "").trim()
}
