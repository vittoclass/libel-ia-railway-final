/**
 * detection-index-uniqueness-guard.ts
 *
 * Guard final universal: garantiza que cada assignedDetectionIndex se use
 * como máximo en UNA fila/pregunta del resultado interleaved.
 *
 * Si un mismo detectionIndex aparece en 2+ filas:
 *   - se conserva SOLO en la fila con mejor match geométrico local
 *     (rowCenterY más cercano, mismo panel, physicalIndex coherente)
 *   - las demás filas pierden ese índice, y si quedan sin evidencia
 *     pasan a BLANK + reviewRecommended = true
 *
 * Reversible: INTERLEAVED_DETECTION_INDEX_UNIQUENESS_GUARD=0
 */
import { isInterleavedDetectionIndexUniquenessGuardEnabled } from "./env"

// ── Telemetría ──

export type DetectionIndexUniquenessRowTelemetry = {
  questionNumber: number
  canonicalId: string | null
  duplicateIndicesFound: number[]
  indicesKept: number[]
  indicesStripped: number[]
  selectedAnswerBefore: string
  selectedAnswerAfter: string
  wasContaminated: boolean
  decisionReason: string
}

export type DetectionIndexUniquenessGuardTelemetry = {
  detectionIndexUniquenessGuardEnabled: boolean
  detectionIndexUniquenessGuardApplied: boolean
  reusedDetectionIndexDetected: boolean
  reusedDetectionIndexCount: number
  reusedDetectionIndices: number[]
  reusedByCanonicalIds: Array<{ detectionIndex: number; canonicalIds: string[] }>
  finalPhysicalUniquenessGuardApplied: boolean
  finalPhysicalUniquenessGuardRejectedCount: number
  bridgeRejectedDueToNonLocalDetection: number
  rowTelemetry: DetectionIndexUniquenessRowTelemetry[]
}

// ── Helpers ──

function getNumericIndices(row: Record<string, unknown>): number[] {
  if (!Array.isArray(row.assignedDetectionIndices)) return []
  return (row.assignedDetectionIndices as unknown[]).filter(
    (x): x is number => typeof x === "number" && Number.isFinite(x),
  )
}

function getRowCenterY(row: Record<string, unknown>): number {
  if (typeof row.rowCenterY === "number" && Number.isFinite(row.rowCenterY)) return row.rowCenterY
  if (typeof row.selectedMarkY === "number" && Number.isFinite(row.selectedMarkY)) return row.selectedMarkY
  return -1
}

function getPanelIndex(row: Record<string, unknown>): number {
  if (typeof row.panelIndex === "number" && Number.isFinite(row.panelIndex)) return row.panelIndex
  return -1
}

function getRowIndexWithinPanel(row: Record<string, unknown>): number {
  if (typeof row.rowIndexWithinPanel === "number" && Number.isFinite(row.rowIndexWithinPanel))
    return row.rowIndexWithinPanel
  return -1
}

function getPhysicalIndex(row: Record<string, unknown>): number {
  if (typeof row.physicalIndex === "number" && Number.isFinite(row.physicalIndex)) return row.physicalIndex
  return -1
}

function getCanonicalId(row: Record<string, unknown>): string | null {
  return typeof row.canonicalId === "string" && row.canonicalId.length > 0 ? row.canonicalId : null
}

/**
 * Score de "localidad geométrica" de un detectionIndex respecto a una fila.
 * Menor = mejor match. Se usa para resolver empates cuando 2+ filas reclaman
 * el mismo índice.
 */
function localityScore(row: Record<string, unknown>, _detIdx: number): number {
  const centerY = getRowCenterY(row)
  const panel = getPanelIndex(row)
  const rowIdx = getRowIndexWithinPanel(row)

  let score = 0

  if (centerY < 0) score += 10
  if (panel < 0) score += 5
  if (rowIdx < 0) score += 5

  const indices = getNumericIndices(row)
  if (indices.length === 0) score += 20

  const sel = String(row.selectedAnswer ?? "").trim().toUpperCase()
  if (sel === "BLANK" || sel === "" || sel === "SIN_RESPUESTA") score += 3

  const src = extractDecisionSource(row)
  if (src && (src.includes("bridge") || src.includes("azure_layout_family"))) score += 2

  if (row.interleavedReviewRecommended === true) score += 1

  return score
}

function extractDecisionSource(row: Record<string, unknown>): string | null {
  const amb = row.interleavedAmbiguityTelemetry
  if (amb && typeof amb === "object") {
    const ds = (amb as Record<string, unknown>).decisionSource
    if (typeof ds === "string") return ds
  }
  return null
}

// ── Guard principal ──

export function applyDetectionIndexUniquenessGuard(params: {
  perQuestion: Array<Record<string, unknown>>
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: DetectionIndexUniquenessGuardTelemetry
} {
  const emptyTelemetry: DetectionIndexUniquenessGuardTelemetry = {
    detectionIndexUniquenessGuardEnabled: false,
    detectionIndexUniquenessGuardApplied: false,
    reusedDetectionIndexDetected: false,
    reusedDetectionIndexCount: 0,
    reusedDetectionIndices: [],
    reusedByCanonicalIds: [],
    finalPhysicalUniquenessGuardApplied: false,
    finalPhysicalUniquenessGuardRejectedCount: 0,
    bridgeRejectedDueToNonLocalDetection: 0,
    rowTelemetry: [],
  }

  if (!isInterleavedDetectionIndexUniquenessGuardEnabled()) {
    return { perQuestion: params.perQuestion, telemetry: emptyTelemetry }
  }

  const { perQuestion } = params

  // Paso 1: Construir mapa detectionIndex → [rowIndex, ...]
  const indexToRows = new Map<number, number[]>()
  for (let ri = 0; ri < perQuestion.length; ri++) {
    const indices = getNumericIndices(perQuestion[ri]!)
    for (const idx of indices) {
      const arr = indexToRows.get(idx)
      if (arr) arr.push(ri)
      else indexToRows.set(idx, [ri])
    }
  }

  // Paso 2: Identificar índices duplicados
  const duplicatedIndices: number[] = []
  const reusedByCanonicalIds: Array<{ detectionIndex: number; canonicalIds: string[] }> = []

  for (const [detIdx, rowIndices] of indexToRows) {
    if (rowIndices.length <= 1) continue
    duplicatedIndices.push(detIdx)
    reusedByCanonicalIds.push({
      detectionIndex: detIdx,
      canonicalIds: rowIndices.map((ri) => getCanonicalId(perQuestion[ri]!) ?? `row_${ri}`),
    })
  }

  if (duplicatedIndices.length === 0) {
    return {
      perQuestion,
      telemetry: {
        ...emptyTelemetry,
        detectionIndexUniquenessGuardEnabled: true,
        reusedDetectionIndexDetected: false,
      },
    }
  }

  // Paso 3: Para cada índice duplicado, elegir ganador por localidad geométrica
  const indicesToStripFromRow = new Map<number, Set<number>>() // rowIndex → Set<detIdx to remove>

  for (const detIdx of duplicatedIndices) {
    const contenders = indexToRows.get(detIdx)!
    const scored = contenders.map((ri) => ({
      ri,
      score: localityScore(perQuestion[ri]!, detIdx),
      centerY: getRowCenterY(perQuestion[ri]!),
      panel: getPanelIndex(perQuestion[ri]!),
      physicalIdx: getPhysicalIndex(perQuestion[ri]!),
      rowWithin: getRowIndexWithinPanel(perQuestion[ri]!),
    }))

    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      if (a.physicalIdx >= 0 && b.physicalIdx >= 0 && a.physicalIdx !== b.physicalIdx) {
        return a.physicalIdx - b.physicalIdx
      }
      return a.centerY - b.centerY
    })

    const winner = scored[0]!
    for (let si = 1; si < scored.length; si++) {
      const loser = scored[si]!
      let set = indicesToStripFromRow.get(loser.ri)
      if (!set) {
        set = new Set()
        indicesToStripFromRow.set(loser.ri, set)
      }
      set.add(detIdx)
    }
  }

  // Paso 4: Aplicar strips y generar telemetría
  const rowTelemetry: DetectionIndexUniquenessRowTelemetry[] = []
  let rejectedCount = 0
  let bridgeNonLocal = 0

  const result = perQuestion.map((row, ri) => {
    const toStrip = indicesToStripFromRow.get(ri)
    if (!toStrip || toStrip.size === 0) return row

    const currentIndices = getNumericIndices(row)
    const keptIndices = currentIndices.filter((idx) => !toStrip.has(idx))
    const strippedIndices = currentIndices.filter((idx) => toStrip.has(idx))

    const selectedBefore = String(row.selectedAnswer ?? "").trim().toUpperCase()
    const canonId = getCanonicalId(row)
    const src = extractDecisionSource(row)
    const cameFromBridge = src != null && (src.includes("bridge") || src.includes("azure_layout_family"))
    if (cameFromBridge) bridgeNonLocal++

    const noEvidenceRemaining = keptIndices.length === 0
    const selectedAfter = noEvidenceRemaining ? "BLANK" : selectedBefore
    const wasContaminated = strippedIndices.length > 0

    if (wasContaminated) rejectedCount++

    const baseTelemetry =
      (row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}

    const decisionReason = noEvidenceRemaining
      ? `blank_rejected_reused_detection_index_stripped=[${strippedIndices.join(",")}]`
      : `kept_partial_indices=[${keptIndices.join(",")}]_stripped=[${strippedIndices.join(",")}]`

    rowTelemetry.push({
      questionNumber: Number(row.questionNumber ?? 0),
      canonicalId: canonId,
      duplicateIndicesFound: strippedIndices,
      indicesKept: keptIndices,
      indicesStripped: strippedIndices,
      selectedAnswerBefore: selectedBefore,
      selectedAnswerAfter: selectedAfter,
      wasContaminated,
      decisionReason,
    })

    return {
      ...row,
      assignedDetectionIndices: keptIndices,
      selectedAnswer: selectedAfter,
      ...(noEvidenceRemaining
        ? {
            interleavedReviewRecommended: true,
            interleavedAmbiguityTelemetry: {
              ...baseTelemetry,
              decisionSource: "blank_rejected_reused_detection_index",
              reusedDetectionIndexDetected: true,
              reusedDetectionIndex: strippedIndices,
              bridgeCandidateBelongsToAnotherRow: cameFromBridge,
            },
          }
        : {
            interleavedAmbiguityTelemetry: {
              ...baseTelemetry,
              reusedDetectionIndexDetected: true,
              reusedDetectionIndex: strippedIndices,
              detectionIndexPartialStrip: true,
            },
          }),
    }
  })

  // Paso 5: Validación defensiva post-guard
  const postGuardDuplicates = findRemainingDuplicates(result)
  if (postGuardDuplicates.length > 0) {
    for (const { detIdx, rowIndices } of postGuardDuplicates) {
      for (const ri of rowIndices) {
        const row = result[ri]!
        const currentIndices = getNumericIndices(row)
        const cleaned = currentIndices.filter((i) => i !== detIdx)
        const baseTel =
          (row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}
        result[ri] = {
          ...row,
          assignedDetectionIndices: cleaned,
          ...(cleaned.length === 0
            ? {
                selectedAnswer: "BLANK",
                interleavedReviewRecommended: true,
                interleavedAmbiguityTelemetry: {
                  ...baseTel,
                  decisionSource: "blank_rejected_reused_detection_index",
                  defensivePostGuardStrip: true,
                },
              }
            : {}),
        }
        rejectedCount++
      }
    }
  }

  return {
    perQuestion: result,
    telemetry: {
      detectionIndexUniquenessGuardEnabled: true,
      detectionIndexUniquenessGuardApplied: rejectedCount > 0,
      reusedDetectionIndexDetected: true,
      reusedDetectionIndexCount: duplicatedIndices.length,
      reusedDetectionIndices: duplicatedIndices,
      reusedByCanonicalIds,
      finalPhysicalUniquenessGuardApplied: rejectedCount > 0,
      finalPhysicalUniquenessGuardRejectedCount: rejectedCount,
      bridgeRejectedDueToNonLocalDetection: bridgeNonLocal,
      rowTelemetry,
    },
  }
}

// ── Helpers post-guard ──

function findRemainingDuplicates(
  rows: Array<Record<string, unknown>>,
): Array<{ detIdx: number; rowIndices: number[] }> {
  const map = new Map<number, number[]>()
  for (let ri = 0; ri < rows.length; ri++) {
    const indices = getNumericIndices(rows[ri]!)
    for (const idx of indices) {
      const arr = map.get(idx)
      if (arr) arr.push(ri)
      else map.set(idx, [ri])
    }
  }
  const dups: Array<{ detIdx: number; rowIndices: number[] }> = []
  for (const [detIdx, rowIndices] of map) {
    if (rowIndices.length > 1) dups.push({ detIdx, rowIndices })
  }
  return dups
}

/**
 * Validación rápida de assertion: retorna true si NO hay índices duplicados.
 * Útil para invariant checks en el pipeline.
 */
export function assertNoDetectionIndexDuplicates(
  rows: Array<Record<string, unknown>>,
): { ok: boolean; violations: Array<{ detIdx: number; rowIndices: number[] }> } {
  const violations = findRemainingDuplicates(rows)
  return { ok: violations.length === 0, violations }
}
