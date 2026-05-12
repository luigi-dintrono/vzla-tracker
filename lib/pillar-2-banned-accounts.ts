// Pillar 2 — Banned Press accounts
// Curated X/Twitter accounts of news outlets and NGOs that are banned, blocked, or
// criminalized inside Venezuela but continue reporting on the situation from outside.
// Used by scripts/pillar2-crawl-banned-press.ts to backfill 90-day protest signal.

export type BannedAccountCategory = "Outlet" | "Monitor"

export interface BannedAccount {
  handle: string
  displayName: string
  category: BannedAccountCategory
  bannedSince: string
  bannedReason: string
  description: string
}

export const PILLAR2_BANNED_ACCOUNTS: BannedAccount[] = [
  {
    handle: "la_patilla",
    displayName: "La Patilla",
    category: "Outlet",
    bannedSince: "2017",
    bannedReason: "Domain blocked by CONATEL; operates from outside Venezuela.",
    description: "High-volume independent news aggregator.",
  },
  {
    handle: "elnacionalweb",
    displayName: "El Nacional",
    category: "Outlet",
    bannedSince: "2018",
    bannedReason: "Print edition shuttered after government lawsuits; website blocked; operates from Miami.",
    description: "Legacy newspaper, broad national coverage.",
  },
  {
    handle: "runrunesweb",
    displayName: "Runrun.es",
    category: "Outlet",
    bannedSince: "2017",
    bannedReason: "Investigative outlet repeatedly blocked by CONATEL.",
    description: "Investigative journalism on corruption and repression.",
  },
  {
    handle: "OVCSocial",
    displayName: "OVCS — Observatorio Venezolano de Conflictividad Social",
    category: "Monitor",
    bannedSince: "criminalized post-2024",
    bannedReason: "Civic-monitoring NGO targeted under the 2024 anti-NGO law.",
    description: "Canonical daily protest-event tracker for Venezuela.",
  },
  {
    handle: "ForoPenal",
    displayName: "Foro Penal Venezolano",
    category: "Monitor",
    bannedSince: "criminalized post-2024",
    bannedReason: "Legal-aid NGO tracking political detentions; criminalized under anti-NGO law.",
    description: "Canonical political-prisoner tracker.",
  },
  {
    handle: "alfredoromero",
    displayName: "Alfredo Romero",
    category: "Monitor",
    bannedSince: "criminalized post-2024",
    bannedReason: "Director of Foro Penal; criminalized under anti-NGO law.",
    description: "Daily political-prisoner case updates from the Foro Penal director.",
  },
  {
    handle: "HimiobSantome",
    displayName: "Gonzalo Himiob",
    category: "Monitor",
    bannedSince: "criminalized post-2024",
    bannedReason: "Deputy director of Foro Penal; criminalized under anti-NGO law.",
    description: "Case-by-case political-prisoner updates from the Foro Penal deputy director.",
  },
  {
    handle: "espaciopublico",
    displayName: "Espacio Público",
    category: "Monitor",
    bannedSince: "criminalized post-2024",
    bannedReason: "Press-freedom NGO; criminalized under the 2024 anti-NGO law.",
    description: "Tracks restrictions on press freedom, civic activity, and freedom of expression.",
  },
  {
    handle: "_Provea",
    displayName: "PROVEA",
    category: "Monitor",
    bannedSince: "raided 2024",
    bannedReason: "Human rights NGO; offices raided 2024 under the anti-NGO law.",
    description: "Human rights documentation, detentions and repression patterns.",
  },
  {
    handle: "robertodeniz",
    displayName: "Roberto Deniz",
    category: "Outlet",
    bannedSince: "exiled post-2018",
    bannedReason: "Armando.Info investigative reporter; relocated abroad after regime threats.",
    description: "Investigative reporting on corruption, regime networks, and repression.",
  },
  {
    handle: "maibortpetit",
    displayName: "Maibort Petit",
    category: "Outlet",
    bannedSince: "exiled",
    bannedReason: "Venezuelan investigative reporter based in New York; cannot operate inside Venezuela.",
    description: "Investigative reporting on regime corruption, narcotics networks, and political prisoners.",
  },
  {
    handle: "nelsonbocaranda",
    displayName: "Nelson Bocaranda",
    category: "Outlet",
    bannedSince: "exiled / blocked 2017",
    bannedReason: "Founder of Runrun.es; received threats and reports from Miami; site blocked by CONATEL.",
    description: "Investigative journalist; daily commentary on regime activity and repression.",
  },
  {
    handle: "ArmandoInfo",
    displayName: "Armando.Info",
    category: "Outlet",
    bannedSince: "exiled post-2018",
    bannedReason: "Investigative outlet; team relocated to Costa Rica/Colombia after regime lawsuits.",
    description: "Investigative reporting on regime corruption, networks, and human rights abuses.",
  },
  {
    handle: "NTN24ve",
    displayName: "NTN24 Venezuela",
    category: "Outlet",
    bannedSince: "2014",
    bannedReason: "Cable channel taken off Venezuelan cable for covering 2014 protests.",
    description: "International news channel; deep coverage of Venezuelan politics and protests.",
  },
  {
    handle: "DiarioTalCual",
    displayName: "TalCual",
    category: "Outlet",
    bannedSince: "2015",
    bannedReason: "Print edition shut down 2015; digital blocked; operates from outside.",
    description: "Independent news outlet, political coverage.",
  },
]

export function getAllBannedHandles(): string[] {
  return PILLAR2_BANNED_ACCOUNTS.map((a) => a.handle)
}

export function getBannedAccount(handle: string): BannedAccount | undefined {
  return PILLAR2_BANNED_ACCOUNTS.find((a) => a.handle.toLowerCase() === handle.toLowerCase())
}
