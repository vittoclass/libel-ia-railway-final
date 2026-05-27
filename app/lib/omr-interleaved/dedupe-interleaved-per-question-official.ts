/**
 * Sanitización previa al passthrough oficial (extract-closed-answers).
 * Elimina filas fantasma de expected-physical-row-preservation sin tocar el pipeline ni OMR clásico.
 *
 * Reversible: quitar import/uso en extract-closed-answers.ts y borrar este archivo.
 */

import { normalizeToCanonicalId } from "../canonical-closed-id"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"

export type InterleavedOfficialOutputSanitization = {
  droppedGhostRowsCount: number
  sanitizedFromPipelineCount: number
  sanitizedToExpectedCount: number
  duplicateCanonicalIdsResolved: number
  paddingRowsAdded: number
}

const BLANK_LIKE = new Set(["", "BLANK", "SIN_RESPUESTA"])

function normalizeAnswer(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
}

function isBlankAnswer(raw: unknown): boolean {
  return BLANK_LIKE.has(normalizeAnswer(raw))
}

/** Fila típica de preservación sin evidencia física: no debe ganar ante detección real. */
export function isInterleavedPreservationGhostRow(row: Record<string, unknown>): boolean {
  return (
    row.physicalRowMissing === true &&
    row.observedFromSensors !== true &&
    isBlankAnswer(row.selectedAnswer)
  )
}

function hasPhysicalCandidateSignal(row: Record<string, unknown>): boolean {
  if (row.observedFromSensors === true) return true
  if (row.physicalRowMissing === false) return true
  if (row.weakPhysicalEvidence === true) return true
  if (row.physicalRowPreservedFromWeakEvidence === true) return true
  if (!isBlankAnswer(row.selectedAnswer)) return true
  const indices = row.assignedDetectionIndices
  if (Array.isArray(indices) && indices.length > 0) return true
  const confMap = row.confidencesByColumn
  if (confMap && typeof confMap === "object" && Object.keys(confMap as object).length > 0) return true
  return false
}

function rowPriorityScore(row: Record<string, unknown>): number {
  let score = 0
  if (row.observedFromSensors === true) score += 10_000
  if (row.physicalRowMissing !== true) score += 5_000
  if (row.weakPhysicalEvidence === true || row.physicalRowPreservedFromWeakEvidence === true) score += 2_000
  if (!isBlankAnswer(row.selectedAnswer)) score += 1_000
  const conf = typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0
  score += conf * 100
  if (Array.isArray(row.assignedDetectionIndices) && row.assignedDetectionIndices.length > 0) score += 50
  if (isInterleavedPreservationGhostRow(row)) score -= 50_000
  if (row.interleavedOfficialOutputPadding === true) score -= 60_000
  return score
}

function rowNumericSlot(row: Record<string, unknown>): number | null {
  const fromCanon = typeof row.canonicalId === "string" ? parseClosedIdNumericSlot(row.canonicalId) : null
  if (fromCanon != null) return fromCanon
  const qn = Number(row.questionNumber ?? row.physicalIndex ?? 0)
  return Number.isFinite(qn) && qn >= 1 ? qn : null
}

function rowCanonicalKey(row: Record<string, unknown>): string | null {
  const fromCanon = normalizeToCanonicalId(row.canonicalId)
  if (fromCanon) return fromCanon
  const slot = rowNumericSlot(row)
  return slot != null ? `C${slot}` : null
}

function pickBestRowForOfficialSlot(candidates: Record<string, unknown>[]): Record<string, unknown> {
  const physical = candidates.filter(hasPhysicalCandidateSignal)
  const pool = physical.length > 0 ? physical : candidates
  let best = pool[0]!
  for (let i = 1; i < pool.length; i++) {
    const row = pool[i]!
    if (rowPriorityScore(row) > rowPriorityScore(best)) best = row
  }
  return best
}

function buildOfficialPaddingRow(slot: number, canonicalId: string): Record<string, unknown> {
  return {
    questionNumber: slot,
    physicalIndex: slot,
    canonicalId,
    selectedAnswer: "BLANK",
    respuesta: "BLANK",
    observedFromSensors: false,
    physicalRowMissing: true,
    interleavedOfficialOutputPadding: true,
    interleavedOfficialOutputSanitized: true,
    confidencesByColumn: {},
    confidence: 0.4,
  }
}

function normalizeExpectedCanonicalIds(ids?: string[]): string[] {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const canon = normalizeToCanonicalId(raw)
    if (!canon || seen.has(canon)) continue
    seen.add(canon)
    out.push(canon)
  }
  return out
}

/**
 * Dedupe por pregunta canónica y materializa exactamente `expectedClosedCount` filas oficiales.
 * Preferencia: observedFromSensors=true > fila física real > BLANK de padding (una vez por slot).
 */
export function dedupeInterleavedPerQuestionForOfficialOutput(
  perQuestion: Array<Record<string, unknown>>,
  expectedClosedCount: number,
  expectedClosedCanonicalIds?: string[],
): { perQuestion: Array<Record<string, unknown>>; sanitization: InterleavedOfficialOutputSanitization } {
  const sanitizedFromPipelineCount = perQuestion.length
  const expectedCanonicalIds = normalizeExpectedCanonicalIds(expectedClosedCanonicalIds)
  const useCanonicalInventory = expectedCanonicalIds.length > 0
  const expected =
    useCanonicalInventory
      ? expectedCanonicalIds.length
      : Number.isFinite(expectedClosedCount) && expectedClosedCount > 0
        ? Math.floor(expectedClosedCount)
        : 0

  if (expected <= 0 || perQuestion.length === 0) {
    return {
      perQuestion: [...perQuestion],
      sanitization: {
        droppedGhostRowsCount: 0,
        sanitizedFromPipelineCount,
        sanitizedToExpectedCount: perQuestion.length,
        duplicateCanonicalIdsResolved: 0,
        paddingRowsAdded: 0,
      },
    }
  }

  const groups = new Map<string, Record<string, unknown>[]>()
  const unkeyed: Record<string, unknown>[] = []

  for (const row of perQuestion) {
    if (!row || typeof row !== "object") continue
    const key = rowCanonicalKey(row)
    if (!key) {
      unkeyed.push(row)
      continue
    }
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  let duplicateCanonicalIdsResolved = 0
  let droppedGhostRowsCount = 0
  const winners: Record<string, unknown>[] = []

  for (const [, candidates] of groups) {
    if (candidates.length > 1) {
      duplicateCanonicalIdsResolved++
      const winner = pickBestRowForOfficialSlot(candidates)
      winners.push({
        ...winner,
        interleavedOfficialOutputSanitized: true,
      })
      for (const row of candidates) {
        if (row === winner) continue
        if (isInterleavedPreservationGhostRow(row)) droppedGhostRowsCount++
      }
    } else {
      winners.push({
        ...candidates[0]!,
        interleavedOfficialOutputSanitized: true,
      })
    }
  }

  for (const row of unkeyed) {
    winners.push({ ...row, interleavedOfficialOutputSanitized: true })
  }

  const bySlot = new Map<number, Record<string, unknown>>()
  for (const row of winners) {
    const slot = rowNumericSlot(row)
    if (slot == null || slot < 1) continue
    const existing = bySlot.get(slot)
    if (!existing) {
      bySlot.set(slot, row)
      continue
    }
    duplicateCanonicalIdsResolved++
    const merged = pickBestRowForOfficialSlot([existing, row])
    if (existing !== merged && isInterleavedPreservationGhostRow(existing)) droppedGhostRowsCount++
    if (row !== merged && isInterleavedPreservationGhostRow(row)) droppedGhostRowsCount++
    bySlot.set(slot, { ...merged, interleavedOfficialOutputSanitized: true })
  }

  let ranked = [...bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row)

  if (ranked.length > expected) {
    const sortedForTrim = [...ranked].sort((a, b) => {
      const scoreDiff = rowPriorityScore(b) - rowPriorityScore(a)
      if (scoreDiff !== 0) return scoreDiff
      return (rowNumericSlot(a) ?? 0) - (rowNumericSlot(b) ?? 0)
    })
    const keptSet = new Set(sortedForTrim.slice(0, expected))
    for (const row of ranked) {
      if (!keptSet.has(row) && isInterleavedPreservationGhostRow(row)) droppedGhostRowsCount++
    }
    ranked = sortedForTrim
      .slice(0, expected)
      .sort((a, b) => (rowNumericSlot(a) ?? 0) - (rowNumericSlot(b) ?? 0))
  }

  const finalBySlot = new Map<number, Record<string, unknown>>()
  for (const row of ranked) {
    const slot = rowNumericSlot(row)
    if (slot != null && slot >= 1 && slot <= expected) finalBySlot.set(slot, row)
  }
  const finalByCanonical = new Map<string, Record<string, unknown>>()
  for (const row of ranked) {
    const canonical = rowCanonicalKey(row)
    if (!canonical) continue
    const existing = finalByCanonical.get(canonical)
    if (!existing) {
      finalByCanonical.set(canonical, row)
      continue
    }
    duplicateCanonicalIdsResolved++
    const merged = pickBestRowForOfficialSlot([existing, row])
    if (existing !== merged && isInterleavedPreservationGhostRow(existing)) droppedGhostRowsCount++
    if (row !== merged && isInterleavedPreservationGhostRow(row)) droppedGhostRowsCount++
    finalByCanonical.set(canonical, { ...merged, interleavedOfficialOutputSanitized: true })
  }

  let paddingRowsAdded = 0
  const final: Record<string, unknown>[] = []

  if (useCanonicalInventory) {
    for (const canonicalId of expectedCanonicalIds) {
      const slot = parseClosedIdNumericSlot(canonicalId) ?? Number(final.length + 1)
      const existing = finalByCanonical.get(canonicalId)
      if (existing) {
        final.push({
          ...existing,
          canonicalId: normalizeToCanonicalId(existing.canonicalId) ?? canonicalId,
          questionNumber:
            typeof existing.questionNumber === "number" && Number.isFinite(existing.questionNumber)
              ? existing.questionNumber
              : slot,
          physicalIndex:
            typeof existing.physicalIndex === "number" && Number.isFinite(existing.physicalIndex)
              ? existing.physicalIndex
              : slot,
          interleavedOfficialOutputSanitized: true,
        })
      } else {
        paddingRowsAdded++
        final.push(buildOfficialPaddingRow(slot, canonicalId))
      }
    }
  } else {
    for (let slot = 1; slot <= expected; slot++) {
      const canonicalId = `C${slot}`
      const existing = finalBySlot.get(slot)
      if (existing) {
        final.push({
          ...existing,
          questionNumber: slot,
          physicalIndex: slot,
          canonicalId: normalizeToCanonicalId(existing.canonicalId) ?? canonicalId,
          interleavedOfficialOutputSanitized: true,
        })
      } else {
        paddingRowsAdded++
        final.push(buildOfficialPaddingRow(slot, canonicalId))
      }
    }
  }

  return {
    perQuestion: final,
    sanitization: {
      droppedGhostRowsCount,
      sanitizedFromPipelineCount,
      sanitizedToExpectedCount: final.length,
      duplicateCanonicalIdsResolved,
      paddingRowsAdded,
    },
  }
}
