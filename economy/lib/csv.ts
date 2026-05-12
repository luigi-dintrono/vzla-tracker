import { writeFileSync } from "node:fs"

export function writeCsv<T extends Record<string, unknown>>(
  path: string,
  rows: T[],
  columns?: (keyof T)[]
): void {
  if (rows.length === 0) {
    writeFileSync(path, "")
    return
  }
  const cols = columns ?? (Object.keys(rows[0]) as (keyof T)[])
  const header = cols.map(String).map(esc).join(",")
  const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\n")
  writeFileSync(path, header + "\n" + body + "\n")
}

function esc(v: unknown): string {
  if (v == null) return ""
  const s = String(v)
  // Always quote if contains comma, quote, newline, or leading/trailing space.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
