// BCV historical daily reference exchange rate.
//
// BCV publishes a per-quarter Excel workbook at
//   https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_2{a|b|c|d}{YY}_smc.xls
// where a/b/c/d = Q1/Q2/Q3/Q4. Each workbook has one *sheet per business
// day*, named DDMMYYYY. Inside each sheet, row 14 (1-indexed) carries the
// USD reference — column F (`Venta (ASK)` Bs./M.E.) is the canonical BCV
// rate that day.
//
// We fetch as many quarters as we need to cover the requested window, parse
// each sheet, and return one row per business day. Holidays and weekends
// are simply absent (BCV doesn't publish on those days).

import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as XLSX from "xlsx"
import { Agent } from "undici"

// BCV serves the SMC workbook over HTTPS with an incomplete certificate
// chain that fails default Node TLS verification. The page is publicly
// readable (no auth) and we never POST anything — accepting the cert is
// the pragmatic call here. Scoped to this one host.
const BCV_TLS_AGENT = new Agent({
  connect: { rejectUnauthorized: false },
})

const BCV_BASE = "https://www.bcv.org.ve/sites/default/files/EstadisticasGeneral"
const UA = "Mozilla/5.0 (compatible; vzla-transition-tracker/0.1)"

export type BcvDailyFx = {
  /** YYYY-MM-DD */
  date: string
  bcv: number
}

export type BcvFxOptions = {
  /** YYYYMMDD inclusive */
  from: string
  to: string
  cacheDir?: string
  skipFetch?: boolean
}

/** Fetch BCV daily USD rates spanning the [from..to] window (inclusive). */
export async function fetchBcvDailyFx(opts: BcvFxOptions): Promise<BcvDailyFx[]> {
  const cacheDir = opts.cacheDir ?? join(tmpdir(), "bcv-fx-cache")
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })

  const quarters = listQuartersInRange(opts.from, opts.to)
  const out: BcvDailyFx[] = []
  const seen = new Set<string>()

  for (const q of quarters) {
    const fname = `2_1_2${q.qLetter}${q.yy}_smc.xls`
    const path = join(cacheDir, fname)
    if (!existsSync(path) || !opts.skipFetch) {
      try {
        const url = `${BCV_BASE}/${fname}`
        const res = await fetch(url, {
          headers: { "User-Agent": UA },
          // @ts-ignore — undici-specific option; Node 18+ accepts it on fetch.
          dispatcher: BCV_TLS_AGENT,
        })
        if (!res.ok) {
          console.warn(`[bcv-fx] ${fname}: HTTP ${res.status}`)
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        writeFileSync(path, buf)
      } catch (err) {
        console.warn(`[bcv-fx] ${fname}: ${(err as Error).message}`)
        continue
      }
    }
    const buf = readFileSync(path)
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(buf, { type: "buffer", cellDates: false })
    } catch (err) {
      console.warn(`[bcv-fx] ${fname}: parse failed — ${(err as Error).message}`)
      continue
    }

    for (const sheetName of wb.SheetNames) {
      const ymd = ddmmyyyyToIso(sheetName)
      if (!ymd) continue
      if (ymd < formatYmd(opts.from) || ymd > formatYmd(opts.to)) continue
      if (seen.has(ymd)) continue
      const sheet = wb.Sheets[sheetName]
      const rate = extractUsdRate(sheet)
      if (rate == null) continue
      seen.add(ymd)
      out.push({ date: ymd, bcv: rate })
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  console.log(
    `[bcv-fx] ${out.length} daily rates (${out[0]?.date} … ${out.at(-1)?.date})`
  )
  return out
}

/** Each BCV workbook covers one calendar quarter. Build the list of
 *  `(qLetter, yy)` pairs that overlap the [from..to] window. */
function listQuartersInRange(from: string, to: string): Array<{ qLetter: "a" | "b" | "c" | "d"; yy: string }> {
  const start = parseYmd(from)
  const end = parseYmd(to)
  const out: Array<{ qLetter: "a" | "b" | "c" | "d"; yy: string }> = []
  const cur = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1)
  while (cur <= end) {
    const q = (Math.floor(cur.getMonth() / 3) + 1) as 1 | 2 | 3 | 4
    out.push({
      qLetter: (["a", "b", "c", "d"] as const)[q - 1],
      yy: String(cur.getFullYear()).slice(2),
    })
    cur.setMonth(cur.getMonth() + 3)
  }
  return out
}

function ddmmyyyyToIso(name: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(name)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function formatYmd(ymd: string): string {
  // accept YYYYMMDD or YYYY-MM-DD
  if (ymd.includes("-")) return ymd
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

function parseYmd(s: string): Date {
  const iso = formatYmd(s)
  return new Date(iso + "T12:00:00Z")
}

/** Find the USD reference row and return the BCV reference (ASK in Bs).
 *  BCV's layout is stable across the years we care about (2024-present):
 *  row 14 (1-indexed, header at row 13), columns B=USD, F=Venta (ASK). */
function extractUsdRate(sheet: XLSX.WorkSheet): number | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  })
  for (const r of rows) {
    if (!Array.isArray(r)) continue
    const code = String(r[0] ?? "").toUpperCase()
    if (code !== "USD") continue
    // Column 5 is the "Venta (ASK)" in Bs./M.E. — the canonical reference.
    const askRaw = r[5] != null ? String(r[5]).replace(",", ".") : ""
    const ask = Number(askRaw)
    if (Number.isFinite(ask) && ask > 0) return ask
    // Some sheets put BCV in col 4 (BID) when no ASK is published
    const bidRaw = r[4] != null ? String(r[4]).replace(",", ".") : ""
    const bid = Number(bidRaw)
    if (Number.isFinite(bid) && bid > 0) return bid
  }
  return null
}
