/**
 * Anclaje opcional de numeración vía OCR (relajado respecto a ventanas locales ±2 del mapa).
 */

export function parseClosedIdNumericSlot(id: string): number | null {
  const u = id.toUpperCase()
  const m = u.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Numeric slot from closedQuestionIds whose numeric part matches OCR and is not yet used. */
export function anchorUnusedSlotFromOcr(
  ocr: number,
  closedQuestionIds: string[],
  usedSlots: Set<number>,
): number | null {
  for (let i = 0; i < closedQuestionIds.length; i++) {
    const id = closedQuestionIds[i]!
    const numericSlot = parseClosedIdNumericSlot(id)
    if (numericSlot == null) continue
    if (usedSlots.has(numericSlot)) continue
    if (numericSlot === ocr) return numericSlot
  }
  return null
}
