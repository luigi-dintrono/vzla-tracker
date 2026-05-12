// Thin client over the Internet Archive's CDX + Memento APIs.
//
// Two operations:
//   listSnapshots — paged CDX search returning all archived URLs in a window.
//   fetchSnapshot — fetch the raw archived HTML for one snapshot.
//
// CDX has aggressive 504 timeouts on broad queries, so we always page in
// 1-month windows and back off / retry.

import { setTimeout as sleep } from "node:timers/promises"

const CDX_BASE = "https://web.archive.org/cdx/search/cdx"
const WB_BASE = "https://web.archive.org/web"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export type Snapshot = {
  timestamp: string // YYYYMMDDhhmmss
  date: string // YYYY-MM-DD
  original: string // archived URL (gamaenlinea.com/...)
  waybackUrl: string // https://web.archive.org/web/<ts>/<original>
  /** Size of the archived response in bytes. Useful for filtering out
   *  empty SPA shells (~1.6KB) from full SSR captures (~30-40KB). */
  length: number
}

export type CdxOptions = {
  /** URL pattern, e.g. "gamaenlinea.com/*" */
  url: string
  /** Inclusive YYYYMMDD */
  from: string
  /** Inclusive YYYYMMDD */
  to: string
  /** Max rows per page (CDX hard caps around 500–1000 in practice) */
  limit?: number
  /** Filters passed straight through to CDX. */
  filters?: string[]
}

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } })
      const body = await res.text()
      if (!res.ok || body.startsWith("<html>")) {
        throw new Error(`HTTP ${res.status}, body: ${body.slice(0, 120)}`)
      }
      return body
    } catch (err) {
      lastErr = err
      await sleep(2000 * (i + 1))
    }
  }
  throw lastErr
}

/**
 * Walk the CDX API across the [from..to] window in monthly chunks, returning
 * every archived URL once. Memoised by (url, from, to) on disk by the caller.
 */
export async function listSnapshots(opts: CdxOptions): Promise<Snapshot[]> {
  const months = splitMonths(opts.from, opts.to)
  const out: Snapshot[] = []
  const seen = new Set<string>()

  for (const [from, to] of months) {
    const qs = new URLSearchParams({
      url: opts.url,
      from,
      to,
      output: "json",
      fl: "timestamp,original,length",
      ...(opts.limit ? { limit: String(opts.limit) } : { limit: "5000" }),
    })
    for (const f of opts.filters ?? ["mimetype:text/html", "statuscode:200"]) {
      qs.append("filter", f)
    }
    const url = `${CDX_BASE}?${qs.toString()}`
    let body: string
    try {
      body = await fetchWithRetry(url)
    } catch (err) {
      console.warn(`[wayback] CDX failed for ${from}..${to}:`, err)
      continue
    }
    if (!body.trim()) continue
    let rows: string[][]
    try {
      rows = JSON.parse(body)
    } catch {
      console.warn(`[wayback] non-JSON CDX response for ${from}..${to}`)
      continue
    }
    if (rows.length < 2) continue
    for (const [timestamp, original, lengthRaw] of rows.slice(1)) {
      const key = `${timestamp}|${original}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        timestamp,
        date: `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`,
        original,
        waybackUrl: `${WB_BASE}/${timestamp}/${original}`,
        length: Number(lengthRaw) || 0,
      })
    }
    await sleep(800)
  }
  return out
}

/** Fetch the raw HTML of one archived page. We use the plain Wayback URL
 *  (not the `id_` variant) because the SSR-rendered HTML is preserved either
 *  way, and the regular variant resolves CSS/script paths consistently. */
export async function fetchSnapshotHtml(snap: Snapshot): Promise<string> {
  const url = `${WB_BASE}/${snap.timestamp}/${snap.original}`
  const res = await fetch(url, { headers: { "User-Agent": UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  return await res.text()
}

function splitMonths(from: string, to: string): [string, string][] {
  const out: [string, string][] = []
  const start = parseDate(from)
  const end = parseDate(to)
  let cur = new Date(start)
  while (cur <= end) {
    const next = new Date(cur)
    next.setMonth(next.getMonth() + 1)
    const lo = formatDate(cur)
    const hi = formatDate(next > end ? end : new Date(next.getTime() - 86_400_000))
    out.push([lo, hi])
    cur = next
  }
  return out
}

function parseDate(s: string): Date {
  return new Date(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)) - 1,
    Number(s.slice(6, 8))
  )
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}${m}${day}`
}
