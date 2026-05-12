// Pull Venezuelan FX history from the esjs-dolar-api project's committed
// SQLite snapshot. The repo (https://github.com/enzonotario/esjs-dolar-api)
// powers the live https://ve.dolarapi.com aggregator AND publishes a daily-
// updated `ve.sqlite` blob alongside the source. That gives us:
//
//   - Daily BCV (`oficial`) back to 2023-01-03
//   - Daily Paralelo back to ~2026-02-14 (when they started tracking)
//
// No API key, no auth, single 350 KB file. Best historical source we have.
//
// We shell out to the system `sqlite3` CLI to avoid adding a native
// dependency. Every recent macOS/Linux ships with it; if it's missing we
// fail loudly and the caller falls back to the BCV-XLS path.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const VE_SQLITE_URL =
  "https://github.com/enzonotario/esjs-dolar-api/raw/main/datos/ve/ve.sqlite"
const UA = "Mozilla/5.0 (compatible; vzla-transition-tracker/0.1)"

export type VeSqliteFx = {
  date: string // YYYY-MM-DD
  bcv: number | null
  paralelo: number | null
}

export type VeSqliteFxOptions = {
  cacheDir?: string
  /** Reuse the on-disk SQLite if present (don't re-download). */
  skipFetch?: boolean
  /** Optional window — defaults to "everything available". */
  from?: string // YYYYMMDD
  to?: string // YYYYMMDD
}

export async function fetchVeSqliteFx(
  opts: VeSqliteFxOptions = {}
): Promise<VeSqliteFx[]> {
  const cacheDir = opts.cacheDir ?? join(tmpdir(), "ve-dolar-sqlite")
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const dbPath = join(cacheDir, "ve.sqlite")

  if (!existsSync(dbPath) || !opts.skipFetch) {
    console.log("[ve-sqlite] downloading ve.sqlite from esjs-dolar-api")
    const res = await fetch(VE_SQLITE_URL, { headers: { "User-Agent": UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ve.sqlite`)
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(dbPath, buf)
    console.log(`[ve-sqlite] saved ${buf.byteLength} bytes`)
  }

  // Compose a single SQL query that buckets by date and emits the latest
  // (max(fechaActualizacion)) reading per (date, fuente). Multiple readings
  // a day collapse to one canonical value.
  const fromIso = opts.from ? formatIso(opts.from) : "0000-01-01"
  const toIso = opts.to ? formatIso(opts.to) : "9999-12-31"

  // One SQL statement; `.mode/.headers` are interactive commands that
  // sqlite3 silently rejects when piped via stdin.
  //
  // The schema has rows for both USD and EUR; we want USD only. Paralelo
  // typically has multiple readings per day (one per monitor: Bitcoin,
  // Binance, DolarToday, etc.) — we average them, since the value reported
  // by the press is the mean of monitors.
  const sql = `SELECT
      date(fechaActualizacion) AS d,
      fuente,
      printf('%.6f', AVG(promedio)) AS rate
    FROM cotizaciones
    WHERE moneda = 'USD'
      AND fuente IN ('oficial', 'paralelo')
      AND date(fechaActualizacion) >= '${fromIso}'
      AND date(fechaActualizacion) <= '${toIso}'
    GROUP BY d, fuente
    ORDER BY d ASC, fuente ASC;`

  const r = spawnSync(
    "sqlite3",
    ["-separator", "\t", "-noheader", dbPath, sql],
    { encoding: "utf8" }
  )
  if (r.status !== 0) {
    throw new Error(`sqlite3 exited ${r.status}: ${r.stderr.slice(0, 200)}`)
  }
  const byDate = new Map<string, VeSqliteFx>()
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const [d, fuente, rateStr] = line.split("\t")
    const rate = Number(rateStr)
    if (!d || !Number.isFinite(rate)) continue
    const existing = byDate.get(d) ?? { date: d, bcv: null, paralelo: null }
    if (fuente === "oficial") existing.bcv = rate
    if (fuente === "paralelo") existing.paralelo = rate
    byDate.set(d, existing)
  }
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const bcvN = out.filter(r => r.bcv != null).length
  const parN = out.filter(r => r.paralelo != null).length
  console.log(
    `[ve-sqlite] ${out.length} days · BCV=${bcvN} · Paralelo=${parN} · span ${out[0]?.date} … ${out.at(-1)?.date}`
  )
  return out
}

function formatIso(ymd: string): string {
  return ymd.includes("-") ? ymd : `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}
