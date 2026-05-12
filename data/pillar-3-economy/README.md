# Pillar 3 — Economic Activity & Inflation

Measures the lived economy: inflation, exchange rate, the consumer basket, and
oil production. Designed to support these questions:

| Question | Backing data |
|---|---|
| What is the actual price level doing? | `inflation-monthly.csv` — OVF independent + our basket-derived food inflation, plus a column for BCV official inflation when it's wired in |
| Official vs. parallel rate divergence | `fx-rate-daily.csv` — BCV + paralelo with premium % |
| What is the productive economy doing? | `oil-production-monthly.csv` — JODI / OPEC secondary sources Venezuela crude production, kbd |
| How much do basic-basket items cost over time? | `basket-prices.csv` + `basket-index.csv` |

Everything is a CSV. There is no app, dashboard, or DB.

## Run

```
pnpm pillar3:crawl                                  # all datasets, last 90 days
pnpm pillar3:crawl --datasets oil                   # only OPEC/JODI oil
pnpm pillar3:crawl --datasets inflation             # only OVF + basket-derived
pnpm pillar3:crawl --datasets basket --stores gama  # subset
pnpm pillar3:crawl --skip-fetch                     # reuse all caches
```

`--datasets` accepts a comma-separated list of `basket | fx | inflation | oil`
(default: all). `--stores` accepts `gama | farmatodo | plazas` and only
matters when basket is enabled.

## Datasets

### `inflation-monthly.csv` — three series share one schema

Each row is one (date, source) pair. Columns:
`date, source, mom_pct, ytd_pct, yoy_pct, article_date, source_url`.

| `source` value | What it is | Method |
|---|---|---|
| `ovf` | [Observatorio Venezolano de Finanzas](https://observatoriodefinanzas.com/) monthly inflation report — independent | Sitemap discovery → article scrape → regex extraction of MoM / acumulada / anualizada percentages |
| `basket_canasta` | Food-only inflation derived from this repo's own `basket-prices.csv` | Per-(month, ingredient) median USD price → geometric mean across ingredients → MoM / YoY % |
| `bcv` *(planned)* | BCV official INPC | `bcv.org.ve/estadisticas/consumidor` publishes `.xls` files (`4_5_1.xls`, `4_5_3.xls`). Pending a BIFF parser — currently documented only |
| `ecoanalitica` *(skipped)* | Ecoanalítica monthly indicators | Proprietary, not publicly accessible. Press releases sometimes get republished — same scrape pattern as OVF would work |

The basket-derived row will look sparse for now because `basket-prices.csv`
itself only has data for the months we've crawled. As the crawler is rerun
on a cron the series fills out. Geometric mean is used so a single
high-priced item like `leche en polvo` doesn't dominate the index.

### `oil-production-monthly.csv` — Venezuela crude, monthly, kbd

One row per month, 2002 → present. Columns:
`date, source, product, flow, unit, value_kbd, assessment_code`.

| Field | Detail |
|---|---|
| `source` | Always `jodi` for now (JODI World Oil Database, free, no API key) |
| `flow` | Always `INDPROD` (indigenous production = crude oil produced) |
| `unit` | Always `kbd` (thousand barrels per day) |
| `assessment_code` | JODI quality flag — `1` = primary, `3` = secondary |

JODI's data comes from OPEC member countries' own submissions plus
"secondary sources" (S&P Platts, Argus, Reuters tracking) where direct data
is missing. The user wanted "OPEC report" specifically; the underlying
sources OPEC uses for its MOMR Table 5.6 (Crude Oil Production, secondary
sources) are largely the same as JODI's secondary-source flag. OPEC's own
MOMR Appendix XLSX is Cloudflare-protected and only available historically
via the Wayback Machine — wireable as a second `source` value later.

### `fx-rate-daily.csv`

Same as before. One row per day with `bcv_bs_per_usd`, `paralelo_bs_per_usd`,
`paralelo_premium_pct`. Primary source [pydolarve.org](https://pydolarve.org)
(both BCV and paralelo), today-only fallback
[ve.dolarapi.com](https://ve.dolarapi.com/v1/dolares).

### `basket-prices.csv` / `basket-index.csv`

Unchanged from previous work — per-SKU rows and per-(date, ingredient) medians
with FX joined in. Stores currently tracked: `gama` (working), `plazas`
(working but Wayback-bottlenecked), `farmatodo` (adapter wired with sanity
guards but their Algolia VE inventory has stale pre-redenomination prices).

## What's NOT in here

| Question / source | Status | Pointer |
|---|---|---|
| Nightlight composites for state-level economic activity | Documented only, not implemented. Needs raster + GIS aggregation (overlay Venezuelan state boundaries on monthly VIIRS rasters) — a separate engineering project. | [eogdata.mines.edu/products/vnl/](https://eogdata.mines.edu/products/vnl/) — monthly composites at `eogdata.mines.edu/nighttime_light/monthly/v10/`. NASA Earthdata also serves the underlying VIIRS DNB at lower-level granularity. |
| BCV official INPC | XLS files are listed at [bcv.org.ve/estadisticas/consumidor](https://www.bcv.org.ve/estadisticas/consumidor) but parsing legacy `.xls` (BIFF8) requires a heavy dependency. | URLs follow the pattern `bcv.org.ve/sites/default/files/precios_consumidor/4_5_{n}.xls` |
| Ecoanalítica monthly indicators | Proprietary; their detailed numbers go to subscribers. | Press releases sometimes get republished verbatim — scraping news outlets (Banca y Negocios, El Diario) is the realistic path |
| OPEC MOMR appendix tables | Live URLs Cloudflare-protected; historical archive available via Wayback CDX | `web.archive.org/cdx/search/cdx?url=opec.org/opec_web/static_files_project/media/downloads/publications/MOMR*` |

## Coverage caveats (read before charting)

1. **`basket-prices.csv` is sparse historically.** gamaenlinea only serves
   *today's* prices live; Wayback's headless-render captures are intermittent.
   Plaza's archive ends Aug 2025. Run the crawler on a cron to accumulate
   forward.
2. **`inflation-monthly.csv` has gaps.** OVF doesn't publish every single
   month and our regex parser is best-effort — when it can't confidently
   extract MoM / YoY from an article it drops the field rather than guess.
3. **`oil-production-monthly.csv` is JODI's own series.** OPEC's MOMR table
   for the same period sometimes differs by ~5-10 kbd for Venezuela because
   of methodology differences between secondary-source aggregators. The
   absolute level is the same to ±50 kbd; what matters more is the trend.
4. **`fx-rate-daily.csv` requires `pydolarve.org` to be reachable** for the
   full 90-day backfill. If only `ve.dolarapi.com` is reachable you'll only
   get today's row — the crawler falls back gracefully.

## Directory layout

```
data/pillar-3-economy/
├── raw/
│   ├── wayback-cdx.json                gama CDX cache (committed)
│   ├── plazas-wayback-cdx.json         plaza's CDX cache (committed)
│   ├── wayback/*.html                  gama snapshot HTML (gitignored)
│   ├── plazas-wayback/*.html           plaza's snapshot HTML (gitignored)
│   └── jodi/                           JODI ZIP + extracted CSV (gitignored)
└── cleaned/
    ├── basket-prices.csv               per-SKU per-store snapshots
    ├── basket-index.csv                per-(date, ingredient) median + FX
    ├── fx-rate-daily.csv               BCV + paralelo per day
    ├── inflation-monthly.csv           OVF + basket-derived (+ bcv pending)
    └── oil-production-monthly.csv      JODI Venezuela crude, kbd
```
