// OVF (Observatorio Venezolano de Finanzas) — independent monthly inflation.
//
// OVF publishes a WordPress site (observatoriodefinanzas.com) with a monthly
// "Informe de inflación" post. Each post contains the month-over-month and
// year-over-year rates in prose, like:
//
//     "En mayo de 2025, la tasa de inflación mensual registró un aumento
//      significativo al ubicarse en 26%, … la tasa de inflación acumulada
//      fue de 105,5%, … En términos anualizados, el alza de precios … 229%"
//
// We:
//   1. Pull the post sitemap (observatoriodefinanzas.com/post-sitemap.xml)
//   2. Filter to URLs that look like monthly inflation reports
//   3. Fetch each article, parse out (month, year, mom_pct, accumulated_pct,
//      yoy_pct) from the body text
//   4. Write `inflation-monthly.csv` with source=ovf
//
// We're deliberately tolerant: language varies article to article. If a
// number can't be confidently extracted we log a warning and skip the row
// rather than emit garbage.

import { setTimeout as sleep } from "node:timers/promises"

const SITEMAP_URL = "https://observatoriodefinanzas.com/post-sitemap.xml"
const UA = "Mozilla/5.0 (compatible; vzla-transition-tracker/0.1)"

const MONTHS_ES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

export type InflationRow = {
  /** First-of-month, e.g. "2025-05-01" */
  date: string
  source: "ovf"
  /** Month-over-month %. May be null if we can't extract confidently. */
  mom_pct: number | null
  /** Year-over-year (anualizada / interanual) %. */
  yoy_pct: number | null
  /** Year-to-date / acumulada %. */
  ytd_pct: number | null
  /** URL of the source article. */
  source_url: string
  /** Article publish date (YYYY-MM-DD) from the sitemap's <lastmod>. */
  article_date: string | null
}

/** Spanish month names used to detect "a monthly inflation post". */
const MONTH_NAMES_SLUG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]
const MONTH_NAMES_RE = new RegExp(`(${MONTH_NAMES_SLUG.join("|")})`, "i")

/** Heuristic: a post is a monthly inflation report if its URL contains both
 *  "inflacion" (in any form) AND a month name, OR contains "cifras de
 *  inflacion" / "se acelera la inflacion" type phrases. We then rely on the
 *  body parser to drop posts that don't actually yield numbers. */
function looksLikeInflationPost(slug: string): boolean {
  const lower = slug.toLowerCase()
  if (!/inflaci[oó]n|aumento-anual-de-precios|hiperinflaci/.test(lower)) return false
  // require a temporal anchor: month name OR 20YY
  return MONTH_NAMES_RE.test(lower) || /20\d{2}/.test(lower)
}

export async function fetchOvfInflation(): Promise<InflationRow[]> {
  console.log("[ovf] fetching sitemap")
  const smXml = await fetchText(SITEMAP_URL)
  const urls = extractSitemap(smXml)
  console.log(`[ovf] sitemap entries: ${urls.length}`)

  const candidates = urls.filter(u => looksLikeInflationPost(u.loc))
  console.log(`[ovf] inflation-report candidates: ${candidates.length}`)

  const rows: InflationRow[] = []
  for (const c of candidates) {
    try {
      const html = await fetchText(c.loc)
      const parsed = parseArticle(html)
      if (!parsed) continue
      // Month attribution priority:
      //   1. URL slug ("inflacion-de-marzo-2024") — most reliable
      //   2. Body text targetMonth detected during article parse
      //   3. Sitemap lastmod minus ~10 days (publish-date heuristic)
      const urlMonth = detectTargetMonthFromUrl(c.loc)
      const date = urlMonth ?? parsed.targetMonth ?? guessMonthFromLastmod(c.lastmod)
      if (!date) continue
      rows.push({
        date,
        source: "ovf",
        mom_pct: parsed.mom_pct,
        yoy_pct: parsed.yoy_pct,
        ytd_pct: parsed.ytd_pct,
        source_url: c.loc,
        article_date: c.lastmod ?? null,
      })
    } catch (err) {
      console.warn(`[ovf] ${c.loc}: ${(err as Error).message}`)
    }
    await sleep(200) // be polite to a small WP site
  }

  // De-dup: keep latest article per target month (newer correction supersedes).
  const byDate = new Map<string, InflationRow>()
  for (const r of rows) {
    const prev = byDate.get(r.date)
    if (!prev || (r.article_date ?? "") > (prev.article_date ?? "")) byDate.set(r.date, r)
  }
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  console.log(`[ovf] ${out.length} unique monthly rows`)
  return out
}

// ── Parsers ────────────────────────────────────────────────────────────

type SitemapUrl = { loc: string; lastmod: string | null }

function extractSitemap(xml: string): SitemapUrl[] {
  const out: SitemapUrl[] = []
  const rx = /<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(xml))) {
    out.push({ loc: m[1].trim(), lastmod: m[2]?.trim().slice(0, 10) ?? null })
  }
  return out
}

function parseArticle(html: string): {
  mom_pct: number | null
  yoy_pct: number | null
  ytd_pct: number | null
  targetMonth: string | null // YYYY-MM-01
} | null {
  // 1. Title + body text
  const title =
    /<h1[^>]*>([\s\S]+?)<\/h1>/.exec(html)?.[1] ??
    /<title>([\s\S]+?)<\/title>/.exec(html)?.[1] ??
    ""
  const body = stripHtml(extractArticleBody(html))
  const text = `${stripHtml(title)} ${body}`.toLowerCase()

  // 2. Find the target month — first month name that appears with a year
  // OR with phrasing like "en mayo", "la inflación de mayo".
  const targetMonth = detectTargetMonth(text)

  // 3. Extract percentages.
  // Heuristics by phrase, picking the first match per concept.
  const mom_pct =
    pickPct(text, [
      /inflaci[oó]n\s+mensual[^.]{0,120}?(\d+[,.]?\d*)\s*%/,
      /tasa\s+de\s+inflaci[oó]n\s+mensual[^.]{0,120}?(\d+[,.]?\d*)\s*%/,
      /inflaci[oó]n\s+de(?:l)?\s+mes\s+de\s+[a-z]+\s+fue\s+de\s+(\d+[,.]?\d*)\s*%/,
      /la\s+inflaci[oó]n\s+(?:en|de)\s+[a-z]+\s+(?:fue\s+de\s+|se\s+ubic[oó]\s+en\s+|alcanz[oó]\s+(?:a\s+)?)\s*(\d+[,.]?\d*)\s*%/,
      /se\s+ubic[oó]\s+en\s+(\d+[,.]?\d*)\s*%/,
    ])
  const yoy_pct = pickPct(text, [
    /(?:inflaci[oó]n\s+)?anualizada[^.]{0,160}?(\d+[,.]?\d*)\s*%/,
    /interanual[^.]{0,160}?(\d+[,.]?\d*)\s*%/,
    /alza\s+de\s+precios[^.]{0,160}?anualizada\s*(?:fue\s+de\s+|se\s+ubic[oó]\s+en\s+)?(\d+[,.]?\d*)\s*%/,
  ])
  const ytd_pct = pickPct(text, [
    /acumulada[^.]{0,160}?(\d+[,.]?\d*)\s*%/,
    /inflaci[oó]n\s+acumulada\s+(?:fue\s+de\s+|alcanz[oó]\s+(?:a\s+)?)(\d+[,.]?\d*)\s*%/,
  ])

  if (mom_pct == null && yoy_pct == null && ytd_pct == null) return null
  return { mom_pct, yoy_pct, ytd_pct, targetMonth }
}

function extractArticleBody(html: string): string {
  const m =
    /<article[^>]*>([\s\S]+?)<\/article>/.exec(html) ??
    /class="entry-content[^"]*"[^>]*>([\s\S]+?)(?=<footer|<aside|<\/main)/.exec(html)
  return m ? m[1] : html
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function detectTargetMonthFromUrl(url: string): string | null {
  const slug = decodeURIComponent(url.toLowerCase())
  // Pattern: "inflacion-de(l)-<month>(-<year>)"
  const monthYearRx = new RegExp(
    `(${Object.keys(MONTHS_ES).join("|")})[-/]?(?:de[-/])?(20\\d{2})?`
  )
  const m = monthYearRx.exec(slug)
  if (!m) return null
  const month = MONTHS_ES[m[1]]
  // Year preference: 4-digit year in URL → else year from lastmod-like
  // pattern in the URL (none) → else null.
  const yearM = /(20\d{2})/.exec(slug)
  if (m[2]) return ymdMonthStart(Number(m[2]), month)
  if (yearM) return ymdMonthStart(Number(yearM[1]), month)
  return null
}

function detectTargetMonth(text: string): string | null {
  // Match "<month> de <year>" first (more precise), then bare month names.
  const monthYear = new RegExp(
    `(${Object.keys(MONTHS_ES).join("|")})\\s+de\\s+(20\\d{2})`,
    "i"
  ).exec(text)
  if (monthYear) {
    const m = MONTHS_ES[monthYear[1].toLowerCase()]
    const y = Number(monthYear[2])
    return ymdMonthStart(y, m)
  }
  // Bare month name + nearby year somewhere in the text
  const bare = new RegExp(`(${Object.keys(MONTHS_ES).join("|")})`, "i").exec(text)
  const yearM = /(20\d{2})/.exec(text)
  if (bare && yearM) {
    return ymdMonthStart(Number(yearM[1]), MONTHS_ES[bare[1].toLowerCase()])
  }
  return null
}

function guessMonthFromLastmod(lastmod: string | null): string | null {
  if (!lastmod) return null
  // OVF typically publishes the report in the first half of month N+1 for
  // data of month N. Roll back by ~10 days then take month start.
  const d = new Date(`${lastmod}T12:00:00Z`)
  if (isNaN(+d)) return null
  d.setUTCDate(d.getUTCDate() - 10)
  return ymdMonthStart(d.getUTCFullYear(), d.getUTCMonth() + 1)
}

function ymdMonthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`
}

/** Try each regex in order; return the first match parsed as a number. */
function pickPct(text: string, regexes: RegExp[]): number | null {
  for (const rx of regexes) {
    const m = rx.exec(text)
    if (m && m[1]) {
      const n = parseEsPct(m[1])
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

/** Parse a Spanish-locale number used for inflation percents.
 *  Handles "33,4" → 33.4, "1.079,67" → 1079.67, "2.840" → 2840
 *  (dots are thousands separators when there are 3 digits after them). */
function parseEsPct(raw: string): number {
  if (raw.includes(",")) {
    // Comma is the decimal; dots (if any) are thousands separators.
    return Number(raw.replace(/\./g, "").replace(",", "."))
  }
  // No comma. A dot followed by exactly 3 digits is a thousands separator;
  // anything else is a decimal point.
  const m = /^(\d+)(?:\.(\d+))?$/.exec(raw)
  if (!m) return Number(raw)
  if (m[2] && m[2].length === 3) return Number(m[1] + m[2])
  return Number(raw)
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}
