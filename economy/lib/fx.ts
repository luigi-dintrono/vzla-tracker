// FX history client. Sources, in priority order:
//
//   1. esjs-dolar-api ve.sqlite (GitHub) — the canonical aggregator's own
//      committed SQLite snapshot. Daily BCV back to 2023-01-03, daily
//      Paralelo from ~2026-02-14. No DNS issues with pydolarve.org needed.
//   2. pydolarve.org /api/v1/dollar/history — original community endpoint.
//      Still wired as a fallback for the few networks where it does resolve.
//   3. BCV quarterly XLS — authoritative for the BCV side only; covers any
//      gap pre-2023 if needed.
//   4. ve.dolarapi.com — only returns today's rate; fills the trailing edge.

import { setTimeout as sleep } from "node:timers/promises"
import { fetchBcvDailyFx } from "./sources/bcv-fx"
import { fetchVeSqliteFx } from "./sources/ve-sqlite-fx"

const UA = "Mozilla/5.0 (compatible; vzla-transition-tracker/0.1)"

export type FxRate = {
  date: string // YYYY-MM-DD
  bcv: number | null
  paralelo: number | null
}

type PyDolarHistoryItem = {
  price: number
  last_update: string
}
type PyDolarHistoryResponse = {
  datetime?: string
  history: PyDolarHistoryItem[]
}

/** Fetch BCV + Paralelo history for an inclusive [from..to] date window. */
export async function fetchFxHistory(from: string, to: string): Promise<FxRate[]> {
  const byDate = new Map<string, FxRate>()

  // 1. Primary: esjs-dolar-api ve.sqlite (covers both BCV and Paralelo)
  try {
    const sqliteRows = await fetchVeSqliteFx({ from, to })
    for (const row of sqliteRows) {
      byDate.set(row.date, { date: row.date, bcv: row.bcv, paralelo: row.paralelo })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[fx] ve.sqlite primary failed: ${msg}`)
  }

  // 2. Pydolarve as a paralelo-history extender for the network paths where
  //    it resolves. Skipped silently if it's unreachable.
  for (const [monitor, key] of [
    ["usd", "bcv"],
    ["enparalelovzla", "paralelo"],
  ] as const) {
    try {
      const rows = await fetchPydolarHistory(monitor, from, to)
      for (const row of rows) {
        const date = row.last_update.slice(0, 10)
        const existing = byDate.get(date) ?? { date, bcv: null, paralelo: null }
        // Only fill empty slots; the sqlite data is canonical when both
        // exist.
        if (key === "bcv" && existing.bcv == null) existing.bcv = row.price
        if (key === "paralelo" && existing.paralelo == null) existing.paralelo = row.price
        byDate.set(date, existing)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Pydolarve is now optional — drop to a one-liner so the run output
      // stays readable.
      console.warn(`[fx] pydolarve fallback skipped (${monitor}): ${msg}`)
    }
    await sleep(500)
  }

  // Fallback for BCV side: hit BCV's own quarterly XLS publications if
  // pydolarve didn't fill the entire window. BCV publishes daily.
  const missingBcvDates = countMissingBcv(byDate, from, to)
  if (missingBcvDates > 5) {
    try {
      const bcvRows = await fetchBcvDailyFx({ from, to })
      for (const row of bcvRows) {
        const existing = byDate.get(row.date) ?? { date: row.date, bcv: null, paralelo: null }
        existing.bcv ??= row.bcv
        byDate.set(row.date, existing)
      }
    } catch (err) {
      console.warn(`[fx] BCV XLS fallback failed: ${(err as Error).message}`)
    }
  }

  // Best-effort fill for *today* via ve.dolarapi.com (single point — covers
  // both BCV and Paralelo).
  try {
    const today = await fetchVeDolarApi()
    if (today) {
      const existing = byDate.get(today.date) ?? { ...today }
      existing.bcv ??= today.bcv
      existing.paralelo ??= today.paralelo
      byDate.set(today.date, existing)
    }
  } catch (err) {
    console.warn("[fx] ve.dolarapi.com failed:", err)
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function countMissingBcv(byDate: Map<string, FxRate>, from: string, to: string): number {
  // Rough estimate: count business days in window that don't have a BCV
  // reading yet. We don't need to be exact; this is just to decide whether
  // hitting BCV is worth the network cost.
  const start = new Date(`${formatIso(from)}T12:00:00Z`)
  const end = new Date(`${formatIso(to)}T12:00:00Z`)
  let businessDays = 0
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    businessDays++
  }
  let withBcv = 0
  for (const r of byDate.values()) if (r.bcv != null) withBcv++
  return Math.max(0, businessDays - withBcv)
}

function formatIso(s: string): string {
  return s.includes("-") ? s : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

async function fetchPydolarHistory(
  monitor: string,
  from: string,
  to: string
): Promise<PyDolarHistoryItem[]> {
  // pydolarve dates are DD-MM-YYYY.
  const dmy = (s: string) => `${s.slice(6, 8)}-${s.slice(4, 6)}-${s.slice(0, 4)}`
  const qs = new URLSearchParams({
    page: monitor === "usd" ? "bcv" : "alcambio",
    monitor,
    start_date: dmy(from),
    end_date: dmy(to),
    format_date: "iso",
    rounded_price: "false",
    order: "asc",
  })
  const url = `https://pydolarve.org/api/v1/dollar/history?${qs.toString()}`
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } })
  if (!res.ok) throw new Error(`HTTP ${res.status} from pydolarve`)
  const body = (await res.json()) as PyDolarHistoryResponse
  return body.history ?? []
}

async function fetchVeDolarApi(): Promise<FxRate | null> {
  const res = await fetch("https://ve.dolarapi.com/v1/dolares", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as Array<{
    fuente: string
    promedio: number
    fechaActualizacion: string
  }>
  const out: FxRate = { date: "", bcv: null, paralelo: null }
  for (const row of body) {
    const date = row.fechaActualizacion.slice(0, 10)
    out.date = out.date || date
    if (row.fuente === "oficial") out.bcv = row.promedio
    if (row.fuente === "paralelo") out.paralelo = row.promedio
  }
  return out.date ? out : null
}
