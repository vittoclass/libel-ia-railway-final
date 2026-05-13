/**
 * Selección universal odd_even vs sequential en rejillas de dos columnas,
 * usando solo geometría + OCR de índices (sin examen ni scoring).
 */
import type { OcrNumberHit } from "./ocr-question-numbers"
import type { OmrTemplateVariantInterleaved } from "./types"

export type VariantAutoDetectionDiagnostics = {
  variantRequested: OmrTemplateVariantInterleaved
  variantDetected: OmrTemplateVariantInterleaved
  variantEffective: OmrTemplateVariantInterleaved
  autoOverrideApplied: boolean
  overrideReason: string | null
  totalOcrHits: number
  paritySplitScore: number
  leftOddFraction: number | null
  rightOddFraction: number | null
  leftHitCount: number
  rightHitCount: number
  yPairedBands: number
  pairedDeltaOneVotes: number
  pairedDeltaHalfVotes: number
  closedHalfUsed: number
}

const Y_CLUSTER_TOL = 0.024
const MIN_TOTAL_HITS = 5
const MIN_SIDE_HITS = 2
const MIN_X_SEPARATION = 0.065

function median(sorted: number[]): number {
  if (!sorted.length) return 0.5
  const m = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2
}

function oddFraction(hits: OcrNumberHit[]): number | null {
  if (!hits.length) return null
  return hits.filter((h) => h.value % 2 === 1).length / hits.length
}

/**
 * En rejilla secuencial típica (izq 1..half, der half+1..N), en la misma fila física:
 *   right - left === ceil(N/2). En intercalada impar/par: right - left === 1.
 */
export function resolveInterleavedDualColumnVariant(params: {
  requested: OmrTemplateVariantInterleaved
  ocrHits: OcrNumberHit[]
  closedQuestionCount: number
  disableAuto?: boolean
}): VariantAutoDetectionDiagnostics {
  const requested = params.requested
  const hits = params.ocrHits ?? []
  const closedN = Math.max(1, Math.floor(params.closedQuestionCount))
  const half = Math.ceil(closedN / 2)

  const emptyDiag = (
    partial: Partial<VariantAutoDetectionDiagnostics> = {},
  ): VariantAutoDetectionDiagnostics => ({
    variantRequested: requested,
    variantDetected: requested,
    variantEffective: requested,
    autoOverrideApplied: false,
    overrideReason: null,
    totalOcrHits: hits.length,
    paritySplitScore: 0,
    leftOddFraction: null,
    rightOddFraction: null,
    leftHitCount: 0,
    rightHitCount: 0,
    yPairedBands: 0,
    pairedDeltaOneVotes: 0,
    pairedDeltaHalfVotes: 0,
    closedHalfUsed: half,
    ...partial,
  })

  if (requested === "single_column" || params.disableAuto === true) {
    return emptyDiag({
      overrideReason: params.disableAuto ? "auto_disabled" : null,
    })
  }

  if (hits.length < MIN_TOTAL_HITS) {
    return emptyDiag({
      overrideReason: "insufficient_ocr_hits_for_auto_variant",
    })
  }

  const xs = [...hits.map((h) => h.centerX)].sort((a, b) => a - b)
  const midRaw = median(xs)
  const midClamped = Math.min(0.62, Math.max(0.38, midRaw))

  const leftHits = hits.filter((h) => h.centerX < midClamped)
  const rightHits = hits.filter((h) => h.centerX >= midClamped)

  const leftOddFraction = oddFraction(leftHits)
  const rightOddFraction = oddFraction(rightHits)
  const paritySplitScore =
    leftOddFraction != null && rightOddFraction != null ? leftOddFraction - rightOddFraction : 0

  const sortedByY = [...hits].sort((a, b) => a.centerY - b.centerY)
  const clusters: OcrNumberHit[][] = []
  for (const h of sortedByY) {
    const last = clusters[clusters.length - 1]
    if (!last || Math.abs(h.centerY - last[0]!.centerY) > Y_CLUSTER_TOL) {
      clusters.push([h])
    } else {
      last.push(h)
    }
  }

  let pairedDeltaOneVotes = 0
  let pairedDeltaHalfVotes = 0
  let yPairedBands = 0

  for (const cl of clusters) {
    if (cl.length < 2) continue
    const byX = [...cl].sort((a, b) => a.centerX - b.centerX)
    const leftMost = byX[0]!
    const rightMost = byX[byX.length - 1]!
    if (rightMost.centerX - leftMost.centerX < MIN_X_SEPARATION) continue

    const leftVal = leftMost.centerX <= rightMost.centerX ? leftMost.value : rightMost.value
    const rightVal = leftMost.centerX <= rightMost.centerX ? rightMost.value : leftMost.value
    if (leftVal >= rightVal) continue

    const d = rightVal - leftVal
    yPairedBands++
    if (d === 1) pairedDeltaOneVotes++
    else if (Math.abs(d - half) <= 1) pairedDeltaHalfVotes++
  }

  let detected: OmrTemplateVariantInterleaved = requested

  const strongOddEvenPairs =
    pairedDeltaOneVotes >= 2 &&
    pairedDeltaOneVotes >= pairedDeltaHalfVotes + 1 &&
    yPairedBands >= 2

  const strongSequentialPairs =
    pairedDeltaHalfVotes >= 2 &&
    pairedDeltaHalfVotes >= pairedDeltaOneVotes + 1 &&
    yPairedBands >= 2

  if (strongOddEvenPairs && !strongSequentialPairs) {
    detected = "odd_even_dual_column"
  } else if (strongSequentialPairs && !strongOddEvenPairs) {
    detected = "sequential_dual_column"
  } else if (
    pairedDeltaOneVotes === 0 &&
    pairedDeltaHalfVotes === 0 &&
    leftOddFraction != null &&
    rightOddFraction != null &&
    leftHits.length >= MIN_SIDE_HITS &&
    rightHits.length >= MIN_SIDE_HITS
  ) {
    if (paritySplitScore >= 0.22) detected = "odd_even_dual_column"
    else if (Math.abs(paritySplitScore) < 0.12) detected = "sequential_dual_column"
  }

  let effective: OmrTemplateVariantInterleaved = requested
  let autoOverrideApplied = false
  let overrideReason: string | null = null

  if (requested === "sequential_dual_column" && detected === "odd_even_dual_column") {
    const promote =
      strongOddEvenPairs ||
      paritySplitScore >= 0.28 ||
      (pairedDeltaOneVotes >= 3 && pairedDeltaOneVotes > pairedDeltaHalfVotes)
    if (promote) {
      effective = "odd_even_dual_column"
      autoOverrideApplied = true
      overrideReason = "sequential_requested_physical_odd_even_evidence"
    }
  } else if (requested === "odd_even_dual_column" && detected === "sequential_dual_column") {
    const demote =
      strongSequentialPairs && pairedDeltaHalfVotes >= 3 && pairedDeltaOneVotes === 0
    if (demote) {
      effective = "sequential_dual_column"
      autoOverrideApplied = true
      overrideReason = "odd_even_requested_physical_sequential_evidence"
    }
  }

  return {
    variantRequested: requested,
    variantDetected: detected,
    variantEffective: effective,
    autoOverrideApplied,
    overrideReason,
    totalOcrHits: hits.length,
    paritySplitScore,
    leftOddFraction,
    rightOddFraction,
    leftHitCount: leftHits.length,
    rightHitCount: rightHits.length,
    yPairedBands,
    pairedDeltaOneVotes,
    pairedDeltaHalfVotes,
    closedHalfUsed: half,
  }
}
