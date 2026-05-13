/**
 * Expected Physical Row Preservation
 *
 * Garantiza que cada pregunta cerrada esperada tenga una fila física trazable
 * antes del mapeo final. Busca evidencia débil en las marcas Azure originales
 * para filas que no sobrevivieron al clustering/decode (zonas inferiores,
 * evidencia débil, marcas rechazadas por band/neighbor conflict).
 *
 * NO toca OMR clásico, scoring, UI, evaluation-logic.
 * Solo interviene en app/lib/omr-interleaved/.
 * Reversible: INTERLEAVED_EXPECTED_PHYSICAL_ROW_PRESERVATION=0
 */

import { isInterleavedExpectedPhysicalRowPreservationEnabled } from "./env"
import type { IndexedMark, OmrTemplateVariantInterleaved } from "./types"
import type { HybridSlotTopology, HybridSlotDescriptor } from "./hybrid-slot-topology"

// ─── Telemetry Types ───────────────────────────────────────────────────────────

export type ExpectedPhysicalRowPreservationRowTelemetry = {
  canonicalId: string
  physicalIndex: number
  rowWasDetected: boolean
  rowPreservedFromWeakEvidence: boolean
  rowPreservedAsMissing: boolean
  selectedAnswer: string
  reviewRecommended: boolean
  weakPhysicalEvidence: boolean
  physicalRowMissing: boolean
  nearestMarkDistanceY: number | null
  nearestMarkPanel: number | null
  nearestRejectedMarks: number
  physicalRowMissingReason: string | null
  estimatedY: number | null
  evidenceMarksConsidered: number
}

export type ExpectedPhysicalRowPreservationTelemetry = {
  physicalRowPreservationEnabled: boolean
  physicalRowPreservationApplied: boolean
  expectedPhysicalRowsCount: number
  detectedPhysicalRowsCount: number
  missingPhysicalRowsBeforePreservation: number
  preservedWeakPhysicalRows: number
  bottomRowsPreserved: number
  rowTelemetry: ExpectedPhysicalRowPreservationRowTelemetry[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const VALID_ANSWERS = new Set(["A", "B", "C", "D", "E"])
const COLUMN_LETTERS = ["A", "B", "C", "D", "E"]

function estimateColumnFromX(
  x: number,
  expectedOptionCount: number,
  panelColumnCenters: number[] | null,
): string | null {
  if (panelColumnCenters && panelColumnCenters.length >= expectedOptionCount) {
    let bestIdx = 0
    let bestDist = Math.abs(x - panelColumnCenters[0]!)
    for (let i = 1; i < Math.min(expectedOptionCount, panelColumnCenters.length); i++) {
      const dist = Math.abs(x - panelColumnCenters[i]!)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    if (bestDist < 0.06) {
      return COLUMN_LETTERS[bestIdx] ?? null
    }
    return null
  }

  const optCount = Math.min(expectedOptionCount, 5)
  const colWidth = 1.0 / optCount
  const colIdx = Math.floor(x / colWidth)
  if (colIdx >= 0 && colIdx < optCount) {
    return COLUMN_LETTERS[colIdx] ?? null
  }
  return null
}

function computeExpectedYForPhysicalIndex(
  physicalIndex: number,
  detectedRows: Array<{ physicalIndex: number; centerY: number }>,
  totalPhysicalSlots: number,
): number | null {
  if (detectedRows.length < 2) return null

  const sorted = [...detectedRows].sort((a, b) => a.physicalIndex - b.physicalIndex)

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const idxDiff = sorted[i]!.physicalIndex - sorted[i - 1]!.physicalIndex
    if (idxDiff > 0) {
      gaps.push((sorted[i]!.centerY - sorted[i - 1]!.centerY) / idxDiff)
    }
  }
  if (gaps.length === 0) return null

  gaps.sort((a, b) => a - b)
  const medianGap = gaps[Math.floor(gaps.length / 2)]!

  let bestAnchor = sorted[0]!
  let bestDist = Math.abs(sorted[0]!.physicalIndex - physicalIndex)
  for (const r of sorted) {
    const dist = Math.abs(r.physicalIndex - physicalIndex)
    if (dist < bestDist) {
      bestDist = dist
      bestAnchor = r
    }
  }

  const estimatedY = bestAnchor.centerY + (physicalIndex - bestAnchor.physicalIndex) * medianGap
  return Math.max(0, Math.min(1, estimatedY))
}

function determinePanelForPhysicalIndex(
  physicalIndex: number,
  variant: OmrTemplateVariantInterleaved,
  totalPhysicalSlots: number,
): number {
  if (variant === "odd_even_dual_column") {
    return physicalIndex % 2 === 1 ? 0 : 1
  }
  if (variant === "sequential_dual_column") {
    const rowsPerPanel = Math.ceil(totalPhysicalSlots / 2)
    return physicalIndex <= rowsPerPanel ? 0 : 1
  }
  return 0
}

function panelXRange(panelIndex: number): { min: number; max: number } {
  if (panelIndex === 0) return { min: 0, max: 0.5 }
  return { min: 0.5, max: 1.0 }
}

// ─── Main Function ─────────────────────────────────────────────────────────────

export function applyExpectedPhysicalRowPreservation(params: {
  perQuestion: Array<Record<string, unknown>>
  indexedMarks: IndexedMark[]
  closedQuestionIds: string[]
  topology: HybridSlotTopology
  variant: OmrTemplateVariantInterleaved
  expectedOptionCount: number
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: ExpectedPhysicalRowPreservationTelemetry
} {
  const { closedQuestionIds, indexedMarks, topology, variant, expectedOptionCount } = params
  const original = params.perQuestion

  const emptyTelemetry: ExpectedPhysicalRowPreservationTelemetry = {
    physicalRowPreservationEnabled: false,
    physicalRowPreservationApplied: false,
    expectedPhysicalRowsCount: closedQuestionIds.length,
    detectedPhysicalRowsCount: original.length,
    missingPhysicalRowsBeforePreservation: 0,
    preservedWeakPhysicalRows: 0,
    bottomRowsPreserved: 0,
    rowTelemetry: [],
  }

  if (!isInterleavedExpectedPhysicalRowPreservationEnabled()) {
    return { perQuestion: original, telemetry: emptyTelemetry }
  }

  if (closedQuestionIds.length === 0 || original.length === 0) {
    return { perQuestion: original, telemetry: { ...emptyTelemetry, physicalRowPreservationEnabled: true } }
  }

  const totalPhysicalSlots = topology.physicalHybridSlotCount

  const closedSlotMap = new Map<string, HybridSlotDescriptor>()
  for (const desc of topology.hybridSlotDescriptors) {
    if (desc.participatesInOmr) {
      closedSlotMap.set(desc.canonicalId, desc)
    }
  }

  const existingCanonicalIds = new Set<string>()
  const existingDetectionIndices = new Set<number>()
  const detectedRowsForEstimation: Array<{ physicalIndex: number; centerY: number }> = []

  for (const row of original) {
    const cid = typeof row.canonicalId === "string" ? row.canonicalId : null
    if (cid) existingCanonicalIds.add(cid)

    const indices = row.assignedDetectionIndices
    if (Array.isArray(indices)) {
      for (const idx of indices) {
        if (typeof idx === "number") existingDetectionIndices.add(idx)
      }
    }

    const pIdx = typeof row.physicalIndex === "number" ? row.physicalIndex : null
    const centerY = typeof row.rowCenterY === "number" ? row.rowCenterY : null
    if (pIdx != null && centerY != null) {
      detectedRowsForEstimation.push({ physicalIndex: pIdx, centerY })
    }
  }

  const missingClosedIds: Array<{ canonicalId: string; physicalIndex: number }> = []
  for (const cid of closedQuestionIds) {
    if (!existingCanonicalIds.has(cid)) {
      const desc = closedSlotMap.get(cid)
      const pIdx = desc?.physicalIndex ?? 0
      missingClosedIds.push({ canonicalId: cid, physicalIndex: pIdx })
    }
  }

  if (missingClosedIds.length === 0) {
    return {
      perQuestion: original,
      telemetry: {
        physicalRowPreservationEnabled: true,
        physicalRowPreservationApplied: false,
        expectedPhysicalRowsCount: closedQuestionIds.length,
        detectedPhysicalRowsCount: original.length,
        missingPhysicalRowsBeforePreservation: 0,
        preservedWeakPhysicalRows: 0,
        bottomRowsPreserved: 0,
        rowTelemetry: [],
      },
    }
  }

  const Y_SEARCH_RADIUS = 0.035
  const X_TOLERANCE = 0.08

  const panelColumnCentersMap = new Map<number, number[]>()
  for (const row of original) {
    const pIdx = typeof row.panelIndex === "number" ? row.panelIndex : -1
    if (pIdx < 0) continue
    const colDiag = row.interleavedColumnGeometryDiagnostic as Record<string, unknown> | undefined
    if (colDiag && Array.isArray(colDiag.columnCenters)) {
      const centers = (colDiag.columnCenters as unknown[]).filter(
        (x): x is number => typeof x === "number",
      )
      if (centers.length >= expectedOptionCount && !panelColumnCentersMap.has(pIdx)) {
        panelColumnCentersMap.set(pIdx, centers)
      }
    }
  }

  const preservedRows: Array<Record<string, unknown>> = []
  const rowTelemetry: ExpectedPhysicalRowPreservationRowTelemetry[] = []
  let preservedWeakCount = 0
  let bottomRowsPreserved = 0

  const medianY = (() => {
    const ys = detectedRowsForEstimation.map((r) => r.centerY).sort((a, b) => a - b)
    if (ys.length === 0) return 0.5
    return ys[Math.floor(ys.length / 2)]!
  })()

  for (const missing of missingClosedIds) {
    const { canonicalId, physicalIndex } = missing

    const estimatedY = computeExpectedYForPhysicalIndex(
      physicalIndex,
      detectedRowsForEstimation,
      totalPhysicalSlots,
    )

    const expectedPanel = determinePanelForPhysicalIndex(physicalIndex, variant, totalPhysicalSlots)
    const xRange = panelXRange(expectedPanel)
    const panelCols = panelColumnCentersMap.get(expectedPanel) ?? null

    let nearestMarkDistanceY: number | null = null
    let nearestMarkPanel: number | null = null
    let nearestRejectedMarks = 0
    let evidenceMarksConsidered = 0

    let bestCandidate: { letter: string; confidence: number; markIdx: number; markY: number } | null = null

    if (estimatedY != null) {
      const candidateMarks: Array<{
        mark: IndexedMark
        distY: number
        letter: string | null
        inPanel: boolean
      }> = []

      for (const im of indexedMarks) {
        if (existingDetectionIndices.has(im.idx)) continue

        const my = im.mark.centerY
        const mx = im.mark.centerX
        const distY = Math.abs(my - estimatedY)

        if (distY > Y_SEARCH_RADIUS) continue

        const inPanel = mx >= xRange.min && mx <= xRange.max
        if (!inPanel) continue

        evidenceMarksConsidered++

        const relativeX = mx - xRange.min
        const normalizedX = relativeX / (xRange.max - xRange.min)
        const letter = estimateColumnFromX(normalizedX, expectedOptionCount, panelCols)

        candidateMarks.push({ mark: im, distY, letter, inPanel })

        if (nearestMarkDistanceY === null || distY < nearestMarkDistanceY) {
          nearestMarkDistanceY = distY
          nearestMarkPanel = expectedPanel
        }
      }

      nearestRejectedMarks = candidateMarks.length

      const selectedMarks = candidateMarks.filter(
        (c) => c.mark.mark.state === "selected" && c.letter != null,
      )

      if (selectedMarks.length > 0) {
        selectedMarks.sort((a, b) => {
          const confDiff = b.mark.mark.confidence - a.mark.mark.confidence
          if (Math.abs(confDiff) > 0.01) return confDiff
          return a.distY - b.distY
        })
        const best = selectedMarks[0]!
        bestCandidate = {
          letter: best.letter!,
          confidence: best.mark.mark.confidence,
          markIdx: best.mark.idx,
          markY: best.mark.mark.centerY,
        }
      } else {
        const unselectedWithColumn = candidateMarks.filter(
          (c) => c.letter != null && c.mark.mark.confidence > 0.3,
        )
        if (unselectedWithColumn.length > 0) {
          unselectedWithColumn.sort((a, b) => a.distY - b.distY)
          const closest = unselectedWithColumn[0]!
          if (closest.distY < Y_SEARCH_RADIUS * 0.6) {
            bestCandidate = {
              letter: closest.letter!,
              confidence: closest.mark.mark.confidence * 0.5,
              markIdx: closest.mark.idx,
              markY: closest.mark.mark.centerY,
            }
          }
        }
      }
    }

    const isBottomRow = estimatedY != null && estimatedY > medianY
    let selectedAnswer = "BLANK"
    let weakPhysicalEvidence = false
    let physicalRowMissing = true
    let physicalRowMissingReason: string | null = "no_physical_row_detected"
    const assignedDetectionIndices: number[] = []

    if (bestCandidate != null && VALID_ANSWERS.has(bestCandidate.letter)) {
      selectedAnswer = bestCandidate.letter
      weakPhysicalEvidence = true
      physicalRowMissing = false
      physicalRowMissingReason = null
      assignedDetectionIndices.push(bestCandidate.markIdx)
      existingDetectionIndices.add(bestCandidate.markIdx)
    } else if (evidenceMarksConsidered > 0) {
      physicalRowMissingReason = "marks_found_but_no_clear_column_assignment"
    } else {
      physicalRowMissingReason = "no_marks_in_expected_zone"
    }

    const preservedRow: Record<string, unknown> = {
      questionNumber: physicalIndex,
      physicalIndex,
      canonicalId: canonicalId,
      panelIndex: expectedPanel,
      rowIndexWithinPanel: -1,
      selectedAnswer,
      assignedDetectionIndices,
      confidencesByColumn: {},
      observedFromSensors: weakPhysicalEvidence,
      interleavedPipeline: true,
      interleavedReviewRecommended: true,
      reviewRecommended: true,
      weakPhysicalEvidence,
      physicalRowPreservedFromWeakEvidence: weakPhysicalEvidence,
      physicalRowMissing,
      physicalRowMissingReason,
      rowCenterY: estimatedY ?? null,
      rowCenterX: null,
      expectedPhysicalRowPreservation: true,
    }

    preservedRows.push(preservedRow)
    preservedWeakCount += weakPhysicalEvidence ? 1 : 0
    if (isBottomRow) bottomRowsPreserved++

    rowTelemetry.push({
      canonicalId,
      physicalIndex,
      rowWasDetected: false,
      rowPreservedFromWeakEvidence: weakPhysicalEvidence,
      rowPreservedAsMissing: physicalRowMissing,
      selectedAnswer,
      reviewRecommended: true,
      weakPhysicalEvidence,
      physicalRowMissing,
      nearestMarkDistanceY,
      nearestMarkPanel,
      nearestRejectedMarks,
      physicalRowMissingReason,
      estimatedY,
      evidenceMarksConsidered,
    })
  }

  const augmented = [...original, ...preservedRows]

  return {
    perQuestion: augmented,
    telemetry: {
      physicalRowPreservationEnabled: true,
      physicalRowPreservationApplied: preservedRows.length > 0,
      expectedPhysicalRowsCount: closedQuestionIds.length,
      detectedPhysicalRowsCount: original.length,
      missingPhysicalRowsBeforePreservation: missingClosedIds.length,
      preservedWeakPhysicalRows: preservedWeakCount,
      bottomRowsPreserved,
      rowTelemetry,
    },
  }
}
