import "dotenv/config"
import { execFile } from "child_process"
import { writeFileSync, mkdirSync } from "fs"
import path from "path"

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

const ENGLISH_MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 200 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${cmd} failed: ${error.message}\nstderr: ${stderr}`))
      else resolve(stdout)
    })
  })
}

interface ParsedTitle {
  contentDate: string
  language: "es" | "en"
}

function parseTitle(title: string): ParsedTitle | null {
  const COMBINING = /[̀-ͯ]/g
  const normalized = title.normalize("NFD").replace(COMBINING, "").toLowerCase()

  const es = normalized.match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/)
  if (es) {
    const month = SPANISH_MONTHS[es[2]]
    if (month) {
      return {
        contentDate: `${es[3]}-${String(month).padStart(2, "0")}-${String(parseInt(es[1], 10)).padStart(2, "0")}`,
        language: "es",
      }
    }
  }

  const en = normalized.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/)
  if (en) {
    const month = ENGLISH_MONTHS[en[1]]
    if (month) {
      return {
        contentDate: `${en[3]}-${String(month).padStart(2, "0")}-${String(parseInt(en[2], 10)).padStart(2, "0")}`,
        language: "en",
      }
    }
  }

  return null
}

type Edition = "estelar" | "matutina" | "midday" | "a-esta-hora" | "fin-de-semana" | "other"

function classifyEdition(title: string): Edition {
  const t = title.toLowerCase()
  if (/estelar|prime ?time/.test(t)) return "estelar"
  if (/matutina|morning/.test(t)) return "matutina"
  if (/midday/.test(t)) return "midday"
  if (/a esta hora|at this hour/.test(t)) return "a-esta-hora"
  if (/fin de semana|weekend/.test(t)) return "fin-de-semana"
  return "other"
}

const EDITION_PRIORITY: Edition[] = [
  "estelar",
  "fin-de-semana",
  "midday",
  "a-esta-hora",
  "matutina",
  "other",
]

interface ListEntry {
  videoId: string
  title: string
  contentDate: string
  edition: Edition
  language: "es" | "en"
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 3) {
    console.error("Usage: npx tsx press-freedom/build-list.ts <playlistId> <fromYYYY-MM-DD> <toYYYY-MM-DD> [outPath]")
    process.exit(1)
  }
  const [playlistId, fromDate, toDate, outPathArg] = args

  console.log(`[build-list] Flat-listing playlist: ${playlistId}`)
  const t0 = Date.now()
  const url = `https://www.youtube.com/playlist?list=${playlistId}`
  const output = await exec("yt-dlp", [
    "--flat-playlist",
    "--extractor-args", "youtubetab:approximate_date",
    "--print", "%(id)s\t%(title)s",
    "--no-warnings",
    url,
  ])
  console.log(`[build-list] Flat list complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const lines = output.trim().split("\n").filter(Boolean)
  console.log(`[build-list] Playlist contains ${lines.length} entries`)

  const inWindow: ListEntry[] = []
  let skippedNoDate = 0
  let skippedPrivate = 0
  let skippedOutOfWindow = 0

  for (const line of lines) {
    const tab = line.indexOf("\t")
    if (tab < 0) continue
    const videoId = line.slice(0, tab)
    const title = line.slice(tab + 1)
    if (/\[(Private|Deleted) video\]/i.test(title)) { skippedPrivate++; continue }
    const parsed = parseTitle(title)
    if (!parsed) { skippedNoDate++; continue }
    if (parsed.contentDate < fromDate || parsed.contentDate > toDate) { skippedOutOfWindow++; continue }
    inWindow.push({
      videoId,
      title,
      contentDate: parsed.contentDate,
      edition: classifyEdition(title),
      language: parsed.language,
    })
  }
  console.log(`[build-list] Window ${fromDate} → ${toDate}: ${inWindow.length} candidates`)
  console.log(`[build-list]   skipped: ${skippedPrivate} private/deleted, ${skippedNoDate} no parseable date, ${skippedOutOfWindow} out of window`)

  const byDate = new Map<string, ListEntry[]>()
  for (const e of inWindow) {
    const group = byDate.get(e.contentDate)
    if (group) group.push(e)
    else byDate.set(e.contentDate, [e])
  }

  const picked: ListEntry[] = []
  for (const group of byDate.values()) {
    for (const pref of EDITION_PRIORITY) {
      const candidates = group.filter(e => e.edition === pref)
      if (candidates.length === 0) continue
      const spanish = candidates.find(e => e.language === "es")
      picked.push(spanish ?? candidates[0])
      break
    }
  }
  picked.sort((a, b) => a.contentDate.localeCompare(b.contentDate))

  console.log(`\n[build-list] Picked ${picked.length} videos (one per day, prefer Estelar > Spanish):`)
  for (const e of picked) {
    console.log(`  ${e.contentDate}  [${e.edition.padEnd(13)}] [${e.language}]  ${e.videoId}  ${e.title}`)
  }

  const outPath = outPathArg ?? path.join(
    __dirname,
    "data",
    "lists",
    `${playlistId}_${fromDate}_${toDate}.json`,
  )
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify({ playlistId, fromDate, toDate, videos: picked }, null, 2))
  console.log(`\n[build-list] Wrote list (${picked.length} videos) to: ${outPath}`)
}

main().catch(err => {
  console.error("[build-list] Fatal error:", err)
  process.exit(1)
})
