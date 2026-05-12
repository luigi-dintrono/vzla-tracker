import { readFile } from "node:fs/promises"
import path from "node:path"

export type CsvRow = Record<string, string>

const DATA_ROOT = path.join(process.cwd(), "data")

function parseCsv(text: string): CsvRow[] {
  // Minimal RFC-4180-ish parser: handles quoted fields with embedded commas,
  // doubled quotes ("") as escape, and CRLF or LF line endings. Good enough for
  // tidy CSVs produced from spreadsheets and pandas; not a substitute for
  // papaparse if you start handling messy real-world dumps.
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      field = ""
      row = []
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop trailing empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop()
  }
  if (rows.length === 0) return []

  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: CsvRow = {}
    header.forEach((key, idx) => {
      obj[key] = (r[idx] ?? "").trim()
    })
    return obj
  })
}

/**
 * Read a cleaned CSV for a pillar. Path is resolved as
 * `data/<pillarDir>/cleaned/<file>` relative to project root.
 *
 * Server-only — never import this into a client component.
 */
export async function readPillarCsv(pillarDir: string, file: string): Promise<CsvRow[]> {
  const full = path.join(DATA_ROOT, pillarDir, "cleaned", file)
  const text = await readFile(full, "utf8")
  return parseCsv(text)
}

export { parseCsv }
