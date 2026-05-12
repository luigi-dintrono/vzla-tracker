// Pillar 2 types + constants shared between server data loader and client
// chart components. Keep this file dependency-free (no node:fs, no other
// server-only modules) so it can be imported into client components without
// dragging fs/promises into the browser bundle.

export interface DailyProtestPoint {
  date: string
  protestOccurred: boolean
  categories: string[]
  repressionLevel: number
  scale: string
  stateCount: number
}

export interface StateActivity {
  state: string
  total: number
  byMonth: Record<string, number> // "YYYY-MM" → count
}

export const PROTEST_CATEGORY_LABEL: Record<string, string> = {
  labor: "Labor",
  political: "Political",
  human_rights: "Human Rights",
  services: "Services",
  education: "Education",
  indigenous: "Indigenous",
  other: "Other",
}

export const PROTEST_CATEGORY_ORDER = [
  "labor",
  "political",
  "human_rights",
  "services",
  "education",
  "indigenous",
  "other",
]

export interface PrisonerCategoryRow {
  category: string
  detained: number
  released: number
  missing: number
  sentenced: number
  other: number
  total: number
}

export interface PrisonerTimePoint {
  date: string
  byCategory: Record<string, number> // category → cumulative count
}

export const PRISONER_CATEGORY_LABEL: Record<string, string> = {
  civilian: "Civilian",
  journalist: "Journalist",
  military: "Military",
  politician: "Politician",
  minor: "Minor",
  indigenous: "Indigenous",
  unknown: "Unknown",
}

export const PRISONER_CATEGORY_ORDER = [
  "civilian",
  "journalist",
  "military",
  "politician",
  "minor",
  "indigenous",
  "unknown",
]
