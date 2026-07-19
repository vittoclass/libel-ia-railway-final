/**
 * Etiquetas visibles de ítems de desarrollo (solo presentación).
 * Las claves internas (P39, P1, etc.) no se modifican; solo el texto mostrado al docente.
 */

export type TipoPruebaReal = "mixta" | "solo_desarrollo" | "solo_alternativas"

export function normalizeTipoPruebaReal(tipo: string | null | undefined): TipoPruebaReal {
  if (tipo === "solo_desarrollo" || tipo === "solo_alternativas") return tipo
  return "mixta"
}

function developmentKeySortValue(key: string): number {
  const k = String(key ?? "").trim().replace(/_/g, " ")
  const m = /^P(\d{1,3})$/i.exec(k.replace(/\s/g, ""))
  if (m) return Number(m[1])
  const m2 = /^(\d{1,3})$/.exec(k)
  if (m2) return Number(m2[1])
  return Number.MAX_SAFE_INTEGER
}

/** Orden pedagógico estable para mapear P39 → Desarrollo 1, etc. */
export function sortDevelopmentItemKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const da = developmentKeySortValue(a)
    const db = developmentKeySortValue(b)
    if (da !== db) return da - db
    return a.localeCompare(b)
  })
}

export function buildDevelopmentOrdinalMap(
  keys: string[],
  tipoPruebaReal: TipoPruebaReal,
): Map<string, number> {
  const map = new Map<string, number>()
  if (tipoPruebaReal !== "solo_desarrollo") return map
  sortDevelopmentItemKeys(keys).forEach((k, i) => map.set(k, i + 1))
  return map
}

export function getDevelopmentItemOrdinal(
  internalKey: string,
  allKeys: string[],
  tipoPruebaReal: TipoPruebaReal,
): number | null {
  if (tipoPruebaReal !== "solo_desarrollo") return null
  return buildDevelopmentOrdinalMap(allKeys, tipoPruebaReal).get(internalKey) ?? null
}

/** Etiqueta corta: "Desarrollo 1" o "P39" según tipo de prueba. */
export function formatDevelopmentItemDisplayLabel(
  internalKey: string,
  tipoPruebaReal: TipoPruebaReal,
  ordinal?: number | null,
): string {
  const key = String(internalKey ?? "").trim()
  if (tipoPruebaReal === "solo_desarrollo") {
    const n = ordinal ?? 1
    return `Desarrollo ${n}`
  }
  return key.replace(/_/g, " ")
}

/** Encabezado de sección en informes (PDF / tablas). */
export function formatDevelopmentItemSectionLabel(
  internalKey: string,
  tipoPruebaReal: TipoPruebaReal,
  ordinal?: number | null,
): string {
  if (tipoPruebaReal === "solo_desarrollo") {
    return formatDevelopmentItemDisplayLabel(internalKey, tipoPruebaReal, ordinal)
  }
  const base = formatDevelopmentItemDisplayLabel(internalKey, tipoPruebaReal, ordinal)
  return `Pregunta Desarrollo: ${base}`
}

/** Inferencia solo para UI histórica (modal docente) cuando no hay tipoPrueba en el payload. */
export function inferTipoPruebaRealForDisplay(input: {
  tipoPrueba?: string | null
  detalle_desarrollo?: Record<string, unknown> | null
  alternativas_corregidas?: unknown[] | null
}): TipoPruebaReal {
  if (input.tipoPrueba) return normalizeTipoPruebaReal(input.tipoPrueba)
  const hasDev = Object.keys(input.detalle_desarrollo || {}).length > 0
  const hasAlt =
    Array.isArray(input.alternativas_corregidas) && input.alternativas_corregidas.length > 0
  if (hasDev && !hasAlt) return "solo_desarrollo"
  if (!hasDev && hasAlt) return "solo_alternativas"
  return "mixta"
}
