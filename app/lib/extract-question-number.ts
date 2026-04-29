/**
 * Normaliza question_number / item_number cuando no es un entero puro (solo lectura / análisis).
 * No afecta OMR, scoring ni persistencia.
 */

/**
 * Extrae el primer entero > 0 presente en value (p. ej. "P1" → 1, "Pregunta 12" → 12, "01" → 1).
 * Si no hay dígitos o el valor no es usable → null (ítem ignorado en cruces pedagógicos, igual que antes con NaN).
 */
export function extractQuestionNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value)
    return n > 0 ? n : null
  }
  const raw = String(value ?? "").trim()
  if (!raw) return null
  const match = raw.match(/(\d+)/)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n)) return null
  const out = Math.trunc(n)
  return out > 0 ? out : null
}
