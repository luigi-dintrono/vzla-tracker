import { Newspaper, Users, TrendingUp, type LucideIcon } from "lucide-react"

export type PillarSlug =
  | "freedom-of-the-press-index"
  | "protests-and-liberty-to-organize"
  | "economic-activity-and-inflation"

export interface Pillar {
  slug: PillarSlug
  number: 1 | 2 | 3
  shortTitle: string
  title: string
  tagline: string
  description: string
  dataDir: string
  icon: LucideIcon
}

export const PILLARS: Pillar[] = [
  {
    slug: "freedom-of-the-press-index",
    number: 1,
    shortTitle: "Press Freedom",
    title: "Freedom of the Press Index",
    tagline: "How open is the Venezuelan media environment?",
    description:
      "Tracks criticism of the regime, presence of opposition voices, and topic diversity across major Venezuelan broadcasters and outlets.",
    dataDir: "pillar-1-press-freedom",
    icon: Newspaper,
  },
  {
    slug: "protests-and-liberty-to-organize",
    number: 2,
    shortTitle: "Protests & Liberty",
    title: "Protests & Liberty to Organize",
    tagline: "Can Venezuelans gather, protest, and organize without reprisal?",
    description:
      "Tracks protest counts, government response, political prisoners, and restrictions on civic activity.",
    dataDir: "pillar-2-civic-liberty",
    icon: Users,
  },
  {
    slug: "economic-activity-and-inflation",
    number: 3,
    shortTitle: "Economy & Inflation",
    title: "Economic Activity & Inflation",
    tagline: "What does the real economy look like on the ground?",
    description:
      "Tracks inflation, exchange rate, oil output, and on-the-ground proxies for economic activity.",
    dataDir: "pillar-3-economy",
    icon: TrendingUp,
  },
]

export function getPillar(slug: PillarSlug): Pillar {
  const p = PILLARS.find((p) => p.slug === slug)
  if (!p) throw new Error(`Unknown pillar: ${slug}`)
  return p
}
