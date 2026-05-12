// CENDA-inspired canasta básica alimentaria (Venezuelan basic food basket).
//
// Each entry is one ingredient we want to track. `slugPatterns` is matched
// case-insensitively against the URL slug segment of an archived gamaenlinea
// product page (the `/es/<slug>/p/<code>` part). `query` is used for the live
// OCC product search to capture today's snapshot when Wayback is sparse.

export type BasketItem = {
  key: string
  name: string
  query: string
  slugPatterns: RegExp[]
  // Hint about the canonical retail unit (kg / litre / docena / lata). Used
  // for display only — we don't normalise prices to a per-kg basis because
  // package sizes in the archive vary too much.
  unit: string
}

export const CANASTA_BASICA: BasketItem[] = [
  { key: "arroz", name: "Arroz", query: "arroz", unit: "kg",
    slugPatterns: [/(^|-)arroz(-|$)/i] },

  { key: "harina_maiz", name: "Harina de maíz precocida", query: "harina pan", unit: "kg",
    slugPatterns: [/harina[-_]?(de[-_]?)?ma[ií]z/i, /(^|-)harina-pan/i, /(^|-)pan-blanca/i] },

  { key: "pasta", name: "Pasta (spaghetti)", query: "spaghetti pasta", unit: "kg",
    slugPatterns: [/spaghetti/i, /(^|-)pasta(s|-larga|-corta)?/i, /fideo/i, /macarro/i] },

  { key: "pan", name: "Pan", query: "pan canilla", unit: "unidad",
    slugPatterns: [/(^|-)pan(-|$)/i, /(^|-)canilla(-|$)/i] },

  { key: "caraotas", name: "Caraotas negras", query: "caraotas negras", unit: "kg",
    slugPatterns: [/caraotas?/i, /frijoles?-negros/i] },

  { key: "lentejas", name: "Lentejas", query: "lentejas", unit: "kg",
    slugPatterns: [/lentejas?/i] },

  { key: "aceite", name: "Aceite vegetal", query: "aceite vegetal", unit: "litro",
    slugPatterns: [/aceite(?!-de-oliva)/i, /aceite-girasol/i, /aceite-soya/i, /aceite-maiz/i] },

  { key: "margarina", name: "Margarina", query: "margarina", unit: "kg",
    slugPatterns: [/margarina/i, /(^|-)mantequilla(-|$)/i] },

  { key: "azucar", name: "Azúcar", query: "azucar", unit: "kg",
    slugPatterns: [/az[uú]car/i] },

  { key: "cafe", name: "Café", query: "café molido", unit: "kg",
    slugPatterns: [/(^|-)caf[eé](-|$)/i] },

  { key: "leche", name: "Leche en polvo", query: "leche en polvo", unit: "kg",
    slugPatterns: [/leche-(en-)?polvo/i, /leche-completa/i, /leche-entera/i] },

  { key: "huevos", name: "Huevos", query: "huevos cartón", unit: "docena",
    slugPatterns: [/huevos?/i, /cart[oó]n-huevos/i] },

  { key: "pollo", name: "Pollo", query: "pollo entero", unit: "kg",
    slugPatterns: [/(^|-)pollo(-|$)/i, /pechuga-pollo/i, /muslo-pollo/i] },

  { key: "carne_res", name: "Carne de res", query: "carne molida", unit: "kg",
    slugPatterns: [/carne-(de-)?res/i, /(^|-)carne-molida(-|$)/i, /(^|-)bistec(-|$)/i, /(^|-)solomo(-|$)/i, /(^|-)punta-trasera(-|$)/i] },

  { key: "atun", name: "Atún enlatado", query: "atun lata", unit: "lata",
    slugPatterns: [/(^|-)at[uú]n(-|$)/i] },

  { key: "sardinas", name: "Sardinas enlatadas", query: "sardinas lata", unit: "lata",
    slugPatterns: [/sardinas?/i] },

  { key: "queso", name: "Queso blanco", query: "queso blanco", unit: "kg",
    slugPatterns: [/queso-(blanco|llanero|telita|guayan[eé]s|fresco|crema)/i] },

  { key: "mayonesa", name: "Mayonesa", query: "mayonesa", unit: "kg",
    slugPatterns: [/mayonesa/i] },

  { key: "sal", name: "Sal", query: "sal refinada", unit: "kg",
    slugPatterns: [/(^|-)sal(-|$)/i, /sal-refinada/i, /sal-marina/i] },

  { key: "salsa_tomate", name: "Pasta/salsa de tomate", query: "pasta de tomate", unit: "frasco",
    slugPatterns: [/pasta-de-tomate/i, /salsa-de-tomate/i, /ketchup/i] },
]

/** Match a product URL slug to a basket item.
 *
 * Gamaenlinea slugs lead with the product type ("arroz-dorado-mary-800-gr",
 * "atun-aceite-soya-palmo-170-gr"), so the regex that matches earliest in
 * the string is the most likely correct classification. This naturally
 * prevents "atún en aceite" from being filed under aceite. */
export function classify(slug: string): BasketItem | null {
  let best: { item: BasketItem; pos: number } | null = null
  for (const item of CANASTA_BASICA) {
    for (const rx of item.slugPatterns) {
      const m = slug.match(rx)
      if (m && m.index != null) {
        if (!best || m.index < best.pos) best = { item, pos: m.index }
        break
      }
    }
  }
  return best?.item ?? null
}
