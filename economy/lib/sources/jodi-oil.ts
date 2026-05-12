// JODI (Joint Organisations Data Initiative) — World Oil Primary Database.
//
// Free, no API key. Monthly crude oil indicators for every country back to
// 2002. We download the full ZIP (~23 MB), unzip into a temp CSV (~280 MB),
// stream it line by line, and keep only Venezuela rows (REF_AREA=VE) where
// FLOW_BREAKDOWN=INDPROD (indigenous production = crude oil produced) and
// UNIT_MEASURE=KBD (thousand barrels per day).
//
// The result is a tight ~290-row time series we write to
// `data/pillar-3-economy/cleaned/oil-production-monthly.csv` with columns:
//   date (YYYY-MM-01), source (jodi), kbd (number), assessment_code

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs"
import { writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pipeline } from "node:stream/promises"
import { createUnzip } from "node:zlib"
import { spawnSync } from "node:child_process"

const JODI_URL =
  "https://www.jodidata.org/_resources/files/downloads/oil-data/world_Primary_CSV.zip"
const UA = "Mozilla/5.0 (vzla-transition-tracker)"

export type OilRow = {
  date: string // YYYY-MM-01 (first of month, since the file is monthly)
  source: "jodi"
  product: "crude"
  flow: "INDPROD"
  unit: "kbd"
  value: number
  assessment_code: string
}

export type JodiOptions = {
  /** Where to put the downloaded ZIP / extracted CSV. Defaults to a temp dir. */
  cacheDir?: string
  /** Skip the network download if the ZIP is already on disk. */
  skipFetch?: boolean
  /** Inclusive YYYY-MM lower bound. Defaults: no lower bound. */
  fromMonth?: string
}

export async function fetchJodiVenezuelaCrude(opts: JodiOptions = {}): Promise<OilRow[]> {
  const cacheDir = opts.cacheDir ?? join(tmpdir(), "jodi-cache")
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const zipPath = join(cacheDir, "world_Primary_CSV.zip")
  const csvPath = join(cacheDir, "NewProcedure_Primary_CSV.csv")

  // 1. Download (if needed)
  if (!existsSync(zipPath) || !opts.skipFetch) {
    console.log("[jodi] downloading primary database (~23 MB)…")
    const res = await fetch(JODI_URL, { headers: { "User-Agent": UA } })
    if (!res.ok) throw new Error(`JODI download HTTP ${res.status}`)
    await pipeline(res.body as any, createWriteStream(zipPath))
    console.log(`[jodi] saved ${statSync(zipPath).size} bytes → ${zipPath}`)
  }

  // 2. Unzip (uses system `unzip` to avoid adding a dependency; the JODI zip
  // is a standard pkzip archive and macOS / Linux both ship unzip in PATH).
  if (!existsSync(csvPath) || statSync(csvPath).size < 1_000_000) {
    console.log("[jodi] extracting CSV…")
    const r = spawnSync("unzip", ["-o", "-d", cacheDir, zipPath], { stdio: "inherit" })
    if (r.status !== 0) throw new Error("unzip failed (is `unzip` installed?)")
  }

  // 3. Stream-filter to Venezuela crude production
  console.log("[jodi] filtering Venezuela CRUDEOIL/INDPROD/KBD rows…")
  const rows: OilRow[] = []
  const stream = createReadStream(csvPath, { encoding: "utf8" })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let header: string[] | null = null
  for await (const line of rl) {
    if (!header) {
      header = line.split(",")
      continue
    }
    if (!line.startsWith("VE,")) continue
    // CSV columns: REF_AREA, TIME_PERIOD, ENERGY_PRODUCT, FLOW_BREAKDOWN,
    //              UNIT_MEASURE, OBS_VALUE, ASSESSMENT_CODE
    const parts = line.split(",")
    if (parts.length < 7) continue
    if (parts[2] !== "CRUDEOIL") continue
    if (parts[3] !== "INDPROD") continue
    if (parts[4] !== "KBD") continue
    const month = parts[1] // "YYYY-MM"
    if (opts.fromMonth && month < opts.fromMonth) continue
    const raw = parts[5]
    if (raw === "-" || raw === "x" || raw === "") continue
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    rows.push({
      date: `${month}-01`,
      source: "jodi",
      product: "crude",
      flow: "INDPROD",
      unit: "kbd",
      value,
      assessment_code: parts[6],
    })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date))
  console.log(`[jodi] ${rows.length} monthly rows (${rows[0]?.date} … ${rows.at(-1)?.date})`)
  return rows
}
