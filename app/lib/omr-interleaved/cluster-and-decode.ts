import type { IndexedMark, OmrTemplateVariantInterleaved } from "./types"
import type { InterleavedPipelineDebugAcc } from "./debug/buildInterleavedDebugSnapshot"
import { partitionLeftRightRowsBySharedVerticalBands, segmentRowClustersByVerticalGap } from "./detectVerticalClosedBlocks"
import { bandVerticalSpan, effectivePairingYThreshold } from "./normalizeRowsPerBlock"
import { nearestOcrNumberForRow, type OcrNumberHit } from "./ocr-question-numbers"
import type { HybridSlotTopology } from "./hybrid-slot-topology"
import { rebuildHybridClosedAssignment } from "./rebuild-hybrid-closed-assignment"
import { rebuildQuestionSequence } from "./rebuildQuestionSequence"
import type { RebuildQuestionSortOrder } from "./rebuildQuestionSequence"
import { summarizeSharedVerticalBands, summarizeSingleColumnGapBlocks } from "./debug/summarizeInterleavedBands"
import { getInterleavedTightWinnerMarginMinGap, isOmrInterleavedDebugEnabled } from "./env"
import type { InterleavedPipelineForensicSession } from "./interleaved-pipeline-forensics"

function letter(i: number): string {
  return ["A", "B", "C", "D", "E", "F", "G", "H"][i] ?? "?"
}

function polygonBounds(polygon: Array<{ x: number; y: number }>): { width: number; height: number; area: number } {
  if (!polygon.length) return { width: 0, height: 0, area: 0 }
  const xs = polygon.map((p) => p.x)
  const ys = polygon.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = Math.max(0, maxX - minX)
  const height = Math.max(0, maxY - minY)
  return { width, height, area: width * height }
}

export function clusterRowsByYIndexed(items: IndexedMark[]): IndexedMark[][] {
  const sorted = [...items].sort((a, b) => a.mark.centerY - b.mark.centerY)
  const rows: IndexedMark[][] = []
  const threshold = 0.018
  for (const it of sorted) {
    let placed = false
    for (const row of rows) {
      const ry = row[0]!.mark.centerY
      if (Math.abs(it.mark.centerY - ry) < threshold) {
        row.push(it)
        placed = true
        break
      }
    }
    if (!placed) rows.push([it])
  }
  for (const row of rows) {
    row.sort((a, b) => a.mark.centerX - b.mark.centerX)
  }
  return rows
}

export function meanY(row: IndexedMark[]): number {
  if (!row.length) return 0
  return row.reduce((s, it) => s + it.mark.centerY, 0) / row.length
}

/** @deprecated Preferir segmentRowClustersByVerticalGap; se mantiene como alias del helper aislado. */
export function segmentRowsIntoGapBlocks(rows: IndexedMark[][], gapFactor = 2.65): IndexedMark[][][] {
  return segmentRowClustersByVerticalGap(rows, gapFactor)
}

function kmeans1d(values: number[], k: number): number[] {
  if (!values.length) return Array.from({ length: k }, (_, i) => (i + 0.5) / k)
  const sorted = [...values].sort((a, b) => a - b)
  const centers = Array.from({ length: k }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / Math.max(1, k - 1))]!)
  for (let iter = 0; iter < 10; iter++) {
    const buckets: number[][] = Array.from({ length: k }, () => [])
    for (const v of sorted) {
      let best = 0
      let dist = Number.POSITIVE_INFINITY
      for (let i = 0; i < k; i++) {
        const d = Math.abs(v - centers[i]!)
        if (d < dist) {
          dist = d
          best = i
        }
      }
      buckets[best]!.push(v)
    }
    for (let i = 0; i < k; i++) {
      const b = buckets[i]!
      if (b.length > 0) centers[i] = b.reduce((s, v) => s + v, 0) / b.length
    }
  }
  return centers.sort((a, b) => a - b)
}

function nearestCenterIndex(x: number, centers: number[]): number {
  let best = 0
  let dist = Number.POSITIVE_INFINITY
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(x - centers[i]!)
    if (d < dist) {
      dist = d
      best = i
    }
  }
  return best
}

type PanelGeometryModel = {
  panelIndex: 0 | 1
  expectedColumnCenters: number[]
  expectedRowCenters: number[]
  physicalRowCenters: number[]
  logicalToPhysicalRowIndex: number[]
  rowBands: Array<{ yMin: number; yMax: number; center: number }>
  dominantRowSpacing: number
  anomalousPhysicalGaps: Array<{ fromRow: number; toRow: number; gap: number }>
  rowIndexCenter: number
  rowDriftSlope: number
  referenceY: number
  columnSlopeByIndex: number[]
  xOffsetEstimated: number
  yOffsetEstimated: number
  xTolerance: number
  yTolerance: number
  rowJitter: number
}

function estimateMedianGap(values: number[]): number {
  if (values.length < 2) return 0.02
  const sorted = [...values].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]! - sorted[i - 1]!
    if (d > 1e-6) gaps.push(d)
  }
  if (!gaps.length) return 0.02
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]!
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const clamped = Math.max(0, Math.min(1, p))
  const idx = Math.floor(clamped * (sorted.length - 1))
  return sorted[idx]!
}

function medianAbsoluteDeviation(values: number[]): number {
  if (!values.length) return 0
  const m = median(values)
  return median(values.map((v) => Math.abs(v - m)))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function ensureGeometryDiagnostics(debugAcc: InterleavedPipelineDebugAcc, model?: PanelGeometryModel) {
  const gd = (debugAcc.geometryDiagnostics ??= {
    expectedBubbleCenters: [],
    detectedBubbleCenters: [],
    rowVerticalDelta: [],
    rawDetectionDiagnostics: [],
    columnDiagnostics: [],
    pipelineStageCounters: {
      rawContoursDetected: 0,
      candidateBubblesDetected: 0,
      rejectedByAspectRatio: 0,
      rejectedByArea: 0,
      rejectedByFillThreshold: 0,
      rejectedBeforeClustering: 0,
      survivedClustering: 0,
      survivedColumnAssignment: 0,
      survivedRowAssignment: 0,
      finalAssignedAnswers: 0,
    },
    candidateLifecycleTrace: [],
    questionAssemblyDiagnostics: [],
    candidateLostBetweenStages: [],
    pipelineInvariantViolations: [],
    pipelineForensicCounters: {
      candidatesEnteringRanking: 0,
      candidatesAfterRanking: 0,
      candidatesAttachedToQuestions: 0,
      questionsWithCandidates: 0,
      questionsWithoutCandidates: 0,
      questionsWithEmptyConfidences: 0,
      questionsWithObservedFromSensorsFalse: 0,
    },
    xOffsetEstimated: model?.xOffsetEstimated ?? 0,
    yOffsetEstimated: model?.yOffsetEstimated ?? 0,
    averageRowError: 0,
    averageColumnError: 0,
    warpedWidth: 1200,
    warpedHeight: 1700,
    questionDiagnostics: [],
  })
  return gd
}

function buildPhysicalRowModel(rowCentersSorted: number[]): {
  physicalRowCenters: number[]
  logicalToPhysicalRowIndex: number[]
  rowBands: Array<{ yMin: number; yMax: number; center: number }>
  dominantRowSpacing: number
  anomalousPhysicalGaps: Array<{ fromRow: number; toRow: number; gap: number }>
} {
  const physicalRowCenters = [...rowCentersSorted].sort((a, b) => a - b)
  if (!physicalRowCenters.length) {
    return {
      physicalRowCenters: [],
      logicalToPhysicalRowIndex: [],
      rowBands: [],
      dominantRowSpacing: 0.02,
      anomalousPhysicalGaps: [],
    }
  }
  const gaps: number[] = []
  for (let i = 1; i < physicalRowCenters.length; i++) {
    const gap = physicalRowCenters[i]! - physicalRowCenters[i - 1]!
    if (gap > 1e-6) gaps.push(gap)
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const trimmedGaps =
    sortedGaps.length > 5 ? sortedGaps.slice(0, Math.max(1, Math.floor(sortedGaps.length * 0.8))) : sortedGaps
  const dominantRowSpacing = Math.max(0.008, median(trimmedGaps.length ? trimmedGaps : sortedGaps))
  const gapMad = medianAbsoluteDeviation(sortedGaps)
  const gapOutlierThreshold = dominantRowSpacing + Math.max(gapMad * 3.2, dominantRowSpacing * 0.9)
  const anomalousPhysicalGaps: Array<{ fromRow: number; toRow: number; gap: number }> = []
  for (let i = 1; i < physicalRowCenters.length; i++) {
    const gap = physicalRowCenters[i]! - physicalRowCenters[i - 1]!
    if (gap > gapOutlierThreshold) {
      anomalousPhysicalGaps.push({ fromRow: i - 1, toRow: i, gap })
    }
  }

  const rowBands: Array<{ yMin: number; yMax: number; center: number }> = []
  for (let i = 0; i < physicalRowCenters.length; i++) {
    const center = physicalRowCenters[i]!
    const prev = physicalRowCenters[i - 1]
    const next = physicalRowCenters[i + 1]
    const lowerGap = prev == null ? dominantRowSpacing : center - prev
    const upperGap = next == null ? dominantRowSpacing : next - center
    const yMin = center - Math.max(dominantRowSpacing * 0.58, lowerGap * 0.5)
    const yMax = center + Math.max(dominantRowSpacing * 0.58, upperGap * 0.5)
    rowBands.push({ yMin, yMax, center })
  }
  const logicalToPhysicalRowIndex = physicalRowCenters.map((_, i) => i)
  return { physicalRowCenters, logicalToPhysicalRowIndex, rowBands, dominantRowSpacing, anomalousPhysicalGaps }
}

function estimateLinearSlope(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0
  const meanX = points.reduce((s, p) => s + p.x, 0) / points.length
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length
  let cov = 0
  let vari = 0
  for (const p of points) {
    const dx = p.x - meanX
    cov += dx * (p.y - meanY)
    vari += dx * dx
  }
  if (vari < 1e-9) return 0
  return cov / vari
}

function estimateSlopeForColumn(points: Array<{ x: number; y: number }>, referenceY: number): number {
  if (points.length < 3) return 0
  const centered = points.map((p) => ({ x: p.x, y: p.y - referenceY }))
  const ySpread = Math.sqrt(centered.reduce((s, p) => s + p.y * p.y, 0) / Math.max(1, centered.length))
  if (ySpread < 1e-6) return 0
  let covariance = 0
  let variance = 0
  for (const p of centered) {
    covariance += p.x * p.y
    variance += p.y * p.y
  }
  if (variance < 1e-9) return 0
  let slope = covariance / variance
  // Iterative trimming to avoid outliers dominating the slope.
  for (let iter = 0; iter < 2; iter++) {
    const residuals = centered.map((p) => p.x - slope * p.y)
    const mad = Math.max(1e-6, medianAbsoluteDeviation(residuals))
    const inliers = centered.filter((p, i) => Math.abs(residuals[i] ?? 0) <= mad * 2.8)
    if (inliers.length < 3) break
    let cov = 0
    let vari = 0
    for (const p of inliers) {
      cov += p.x * p.y
      vari += p.y * p.y
    }
    if (vari < 1e-9) break
    slope = cov / vari
  }
  return slope
}

function debugLogInterleaved(message: string, payload?: Record<string, unknown>): void {
  if (!isOmrInterleavedDebugEnabled()) return
  if (payload) {
    console.log(`[omr-interleaved][geometry] ${message}`, payload)
    return
  }
  console.log(`[omr-interleaved][geometry] ${message}`)
}

function candidateIdFromDetectionIdx(detectionIdx: number): string {
  return `cand-${detectionIdx}`
}

type InterleavedRejectReason =
  | "OUTSIDE_X_TOLERANCE"
  | "OUTSIDE_Y_TOLERANCE"
  | "ROW_AMBIGUOUS"
  | "ROW_NEIGHBOR_CONFLICT"
  | "BAND_EXTREME_REJECT"
  | "COLUMN_AMBIGUOUS"
  | "MULTIPLE_CANDIDATES"
  | "DISTANCE_TOO_HIGH"

function snapNearestIndex(value: number, centers: number[], tolerance: number): { index: number; ambiguous: boolean } {
  let best = -1
  let bestDist = Number.POSITIVE_INFINITY
  let secondBest = Number.POSITIVE_INFINITY
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(value - (centers[i] ?? value))
    if (d < bestDist) {
      secondBest = bestDist
      bestDist = d
      best = i
    } else if (d < secondBest) {
      secondBest = d
    }
  }
  const ambiguous = bestDist <= tolerance && secondBest <= tolerance && Math.abs(secondBest - bestDist) < tolerance * 0.22
  return { index: Math.max(0, best), ambiguous }
}

export function buildPanelGeometryModel(params: {
  panelIndex: 0 | 1
  rows: IndexedMark[][]
  panelItems: IndexedMark[]
  expectedOptionCount: number
}): PanelGeometryModel {
  const { panelIndex, rows, panelItems, expectedOptionCount } = params
  const rowCenters = [...rows.map((r) => meanY(r))].sort((a, b) => a - b)
  const rowPitch = estimateMedianGap(rowCenters)
  const yBase = rowCenters[0] ?? 0.1
  const rowIndexCenter = Math.max(0, (rowCenters.length - 1) / 2)
  const baselineByIndex = rowCenters.map((_, i) => yBase + i * rowPitch)
  const rowResidualByIndex = rowCenters.map((v, i) => v - (baselineByIndex[i] ?? v))
  const rowDriftSlope = estimateLinearSlope(rowResidualByIndex.map((r, i) => ({ x: i - rowIndexCenter, y: r })))
  const expectedRowCenters = rowCenters.map(
    (_, i) => (baselineByIndex[i] ?? yBase + i * rowPitch) + rowDriftSlope * (i - rowIndexCenter),
  )
  const referenceY = median(rowCenters)
  const physicalRowModel = buildPhysicalRowModel(rowCenters)
  const xValues = panelItems.map((it) => it.mark.centerX)
  const expectedColumnCenters = kmeans1d(xValues, expectedOptionCount)
  const columnPoints: Array<Array<{ x: number; y: number }>> = Array.from({ length: expectedOptionCount }, () => [])
  for (const it of panelItems) {
    const ci = nearestCenterIndex(it.mark.centerX, expectedColumnCenters)
    columnPoints[ci]?.push({ x: it.mark.centerX - (expectedColumnCenters[ci] ?? it.mark.centerX), y: it.mark.centerY })
  }
  const columnSlopeByIndex = columnPoints.map((pts) => estimateSlopeForColumn(pts, referenceY))

  const xResiduals: number[] = []
  for (const it of panelItems) {
    const ci = nearestCenterIndex(it.mark.centerX, expectedColumnCenters)
    const slope = columnSlopeByIndex[ci] ?? 0
    const expectedX = (expectedColumnCenters[ci] ?? it.mark.centerX) + slope * (it.mark.centerY - referenceY)
    xResiduals.push(it.mark.centerX - expectedX)
  }
  const yResiduals: number[] = rowCenters.map((obs, i) => obs - (expectedRowCenters[i] ?? obs))
  const xOffsetEstimated = xResiduals.length ? xResiduals.reduce((s, v) => s + v, 0) / xResiduals.length : 0
  const yOffsetEstimated = yResiduals.length ? yResiduals.reduce((s, v) => s + v, 0) / yResiduals.length : 0
  const xResidualSpread = Math.max(0.006, medianAbsoluteDeviation(xResiduals) * 1.4826)
  const yResidualSpread = Math.max(0.005, medianAbsoluteDeviation(yResiduals) * 1.4826)
  const xTolerance = Math.max(0.018, estimateMedianGap(expectedColumnCenters) * 0.45, xResidualSpread * 2.3)
  const yTolerance = Math.max(0.01, rowPitch * 0.45, yResidualSpread * 2.2)
  const rowJitter = Math.max(0.004, yResidualSpread)

  debugLogInterleaved("panel model estimated", {
    panelIndex,
    rowPitch: Number(rowPitch.toFixed(5)),
    rowDriftSlope: Number(rowDriftSlope.toFixed(6)),
    referenceY: Number(referenceY.toFixed(5)),
    slopeMedian: Number(median(columnSlopeByIndex).toFixed(6)),
    slopeP95: Number(percentile(columnSlopeByIndex.map((v) => Math.abs(v)), 0.95).toFixed(6)),
    xOffsetEstimated: Number(xOffsetEstimated.toFixed(5)),
    yOffsetEstimated: Number(yOffsetEstimated.toFixed(5)),
    xTolerance: Number(xTolerance.toFixed(5)),
    yTolerance: Number(yTolerance.toFixed(5)),
    rowJitter: Number(rowJitter.toFixed(5)),
    dominantRowSpacing: Number(physicalRowModel.dominantRowSpacing.toFixed(5)),
    anomalousGapCount: physicalRowModel.anomalousPhysicalGaps.length,
  })

  return {
    panelIndex,
    expectedColumnCenters,
    expectedRowCenters,
    physicalRowCenters: physicalRowModel.physicalRowCenters,
    logicalToPhysicalRowIndex: physicalRowModel.logicalToPhysicalRowIndex,
    rowBands: physicalRowModel.rowBands,
    dominantRowSpacing: physicalRowModel.dominantRowSpacing,
    anomalousPhysicalGaps: physicalRowModel.anomalousPhysicalGaps,
    rowIndexCenter,
    rowDriftSlope,
    referenceY,
    columnSlopeByIndex,
    xOffsetEstimated,
    yOffsetEstimated,
    xTolerance,
    yTolerance,
    rowJitter,
  }
}

function recordPanelColumnDiagnostics(params: {
  debugAcc?: InterleavedPipelineDebugAcc
  panelIndex: 0 | 1
  panelItems: IndexedMark[]
  rows: IndexedMark[][]
  model: PanelGeometryModel
  expectedOptionCount: number
}): void {
  const { debugAcc, panelIndex, panelItems, rows, model, expectedOptionCount } = params
  if (!debugAcc) return
  const gd = ensureGeometryDiagnostics(debugAcc, model)
  const centers = model.expectedColumnCenters
  const spacing = centers.slice(1).map((c, i) => c - (centers[i] ?? c))
  const medianSpacing = spacing.length ? median(spacing) : 0
  const horizontalDeviation =
    spacing.length && medianSpacing > 1e-6
      ? spacing.reduce((s, v) => s + Math.abs(v - medianSpacing), 0) / spacing.length
      : 0
  const assignmentHistogram = Array.from({ length: expectedOptionCount }, (_, i) => ({ column: letter(i), count: 0 }))
  for (const item of panelItems) {
    const ci = nearestCenterIndex(item.mark.centerX, centers)
    const bin = assignmentHistogram[ci]
    if (bin) bin.count += 1
  }
  const conflictsABCD: Array<{ columns: string[]; overlapRatio: number }> = []
  let overlapAccumulator = 0
  let overlapPairs = 0
  for (let i = 0; i < centers.length - 1; i++) {
    const localSpacing = Math.max(1e-6, (centers[i + 1] ?? centers[i] ?? 0) - (centers[i] ?? 0))
    const overlapRatio = Math.max(0, 1 - localSpacing / Math.max(1e-6, medianSpacing || localSpacing))
    overlapAccumulator += overlapRatio
    overlapPairs += 1
    if (overlapRatio > 0.25) {
      conflictsABCD.push({ columns: [letter(i), letter(i + 1)], overlapRatio })
    }
  }
  const collapsedColumns = spacing
    .map((s, i) => ({ s, i }))
    .filter((x) => medianSpacing > 1e-6 && x.s < medianSpacing * 0.65)
    .map((x) => ({ column: `${letter(x.i)}-${letter(x.i + 1)}`, reason: "COMPRESSED_SPACING_BELOW_MEDIAN" }))
  const perRowHorizontalDrift = rows.map((row, rowIndex) => {
    const residuals = row.map((it) => {
      const ci = nearestCenterIndex(it.mark.centerX, centers)
      return it.mark.centerX - (centers[ci] ?? it.mark.centerX)
    })
    const drift = residuals.length ? residuals.reduce((s, v) => s + v, 0) / residuals.length : 0
    return { rowIndex, drift }
  })
  const driftSpread = perRowHorizontalDrift.map((d) => Math.abs(d.drift))
  const clusteringConfidence = clamp(1 - percentile(driftSpread, 0.9) / Math.max(1e-6, model.xTolerance), 0, 1)

  gd.columnDiagnostics.push({
    panelIndex,
    columnCenters: centers,
    horizontalSpacing: spacing,
    horizontalDeviation,
    assignmentHistogram,
    conflictsABCD,
    collapsedColumns,
    horizontalOverlap: overlapPairs > 0 ? overlapAccumulator / overlapPairs : 0,
    clusteringConfidence,
    perRowHorizontalDrift,
  })
}

function recordRawDetectionDiagnostics(params: {
  debugAcc?: InterleavedPipelineDebugAcc
  panelIndex: 0 | 1
  panelItems: IndexedMark[]
  model: PanelGeometryModel
}): void {
  const { debugAcc, panelIndex, panelItems, model } = params
  if (!debugAcc) return
  const gd = ensureGeometryDiagnostics(debugAcc, model)
  const centers = model.expectedColumnCenters
  const rowCenters = model.physicalRowCenters.map((v) => v + model.yOffsetEstimated)
  for (const it of panelItems) {
    const ci = nearestCenterIndex(it.mark.centerX, centers)
    const candidateX = centers[ci] ?? it.mark.centerX
    const nearestColumnCenterDistance = Math.abs(it.mark.centerX - candidateX)
    const rowSnap = rowCenters.length
      ? snapNearestIndex(it.mark.centerY, rowCenters, model.yTolerance * 1.35)
      : { index: 0, ambiguous: false }
    const candidateY = rowCenters[rowSnap.index] ?? it.mark.centerY
    const nearestRowCenterDistance = Math.abs(it.mark.centerY - candidateY)
    const bounds = polygonBounds(it.mark.polygonNorm)
    gd.rawDetectionDiagnostics.push({
      detectionIdx: it.idx,
      centerX: it.mark.centerX,
      centerY: it.mark.centerY,
      normalizedX: it.mark.centerX,
      normalizedY: it.mark.centerY,
      width: bounds.width,
      height: bounds.height,
      fillScore: null,
      darknessScore: null,
      contourArea: bounds.area,
      confidence: it.mark.confidence,
      panelIndexCandidate: panelIndex,
      rowIndexCandidate: rowSnap.index,
      columnIndexCandidate: ci,
      columnLetterCandidate: letter(ci),
      rejectedBeforeDecode: false,
      rejectionReason: null,
      survivedToDecode: true,
      nearestColumnCenterDistance,
      nearestRowCenterDistance,
    })
  }
}

function resolveOddEvenRowIndexWithContinuity(params: {
  row: IndexedMark[]
  model: PanelGeometryModel
  visualIndex: number
  previousAssignedRowIndex: number | null
}): number {
  const { row, model, visualIndex, previousAssignedRowIndex } = params
  const maxIndex = Math.max(0, model.physicalRowCenters.length - 1)
  let resolved = clamp(visualIndex, 0, maxIndex)
  if (!row.length || model.physicalRowCenters.length === 0) return resolved
  const rowCenter = meanY(row)
  const snapTolerance = Math.max(model.yTolerance * 1.45, model.dominantRowSpacing * 0.78, model.rowJitter * 2.8)
  const snapped = snapNearestIndex(rowCenter, model.physicalRowCenters, snapTolerance)
  const snappedIndex = clamp(snapped.index, 0, maxIndex)

  // When snap is unambiguous, trust the geometric position directly.
  if (!snapped.ambiguous) {
    resolved = snappedIndex
  } else if (Math.abs(snappedIndex - resolved) > 1) {
    resolved = snappedIndex
  }

  if (previousAssignedRowIndex != null) {
    // Allow forward jumps up to 2 always (rows can have gaps from development zones).
    // Only apply soft continuity — never override an unambiguous snap.
    const maxForwardJump = 2
    const expectedNext = previousAssignedRowIndex + 1
    if (snapped.ambiguous) {
      if (resolved < previousAssignedRowIndex) {
        resolved = clamp(expectedNext, 0, maxIndex)
      } else if (resolved - previousAssignedRowIndex > maxForwardJump) {
        resolved = clamp(expectedNext, 0, maxIndex)
      }
    } else {
      // Unambiguous snap: only constrain if clearly regressing (likely noise)
      if (resolved < previousAssignedRowIndex && resolved < visualIndex) {
        resolved = clamp(Math.max(resolved, expectedNext), 0, maxIndex)
      }
    }
  }
  return clamp(resolved, 0, maxIndex)
}

export function decodeBubbleRow(params: {
  row: IndexedMark[]
  questionNumber: number
  panelIndex: 0 | 1
  rowIndexWithinPanel: number
  splitX: number
  expectedOptionCount: number
  model?: PanelGeometryModel
  debugAcc?: InterleavedPipelineDebugAcc
}): Record<string, unknown> {
  const { row, questionNumber, panelIndex, rowIndexWithinPanel, splitX, expectedOptionCount, model, debugAcc } = params
  void splitX
  if (row.length === 0) {
    return {
      questionNumber,
      panelIndex,
      rowIndexWithinPanel,
      rowCenterY: 0,
      selectedAnswer: "BLANK",
      assignedDetectionIndices: [],
      confidencesByColumn: {},
      observedFromSensors: false,
      interleavedPipeline: true,
    }
  }
  const panelNoiseBaseCandidates = row
    .filter((it) => it.mark.state !== "selected")
    .map((it) => it.mark.confidence)
    .sort((a, b) => a - b)
  const panelNoiseBase =
    panelNoiseBaseCandidates.length > 0
      ? panelNoiseBaseCandidates[Math.floor(panelNoiseBaseCandidates.length * 0.7)]!
      : 0.7
  const sensitivityThreshold = Math.max(0.55, Math.min(0.92, panelNoiseBase + 0.1))
  const rowCenterY = meanY(row)
  const centers =
    model?.expectedColumnCenters?.length === expectedOptionCount
      ? model.expectedColumnCenters.map((v, i) => {
          const slope = model.columnSlopeByIndex[i] ?? 0
          const drift = slope * (rowCenterY - model.referenceY)
          return v + model.xOffsetEstimated + drift
        })
      : kmeans1d(
          row.map((it) => it.mark.centerX),
          expectedOptionCount,
        )
  const expectedRowCentersCalibrated = model?.expectedRowCenters?.length
    ? model.expectedRowCenters.map((v) => v + (model.yOffsetEstimated ?? 0))
    : []
  const physicalRowCentersCalibrated = model?.physicalRowCenters?.length
    ? model.physicalRowCenters.map((v) => v + (model.yOffsetEstimated ?? 0))
    : expectedRowCentersCalibrated
  const physicalRowIndexExpected = clamp(
    model?.logicalToPhysicalRowIndex?.[rowIndexWithinPanel] ?? rowIndexWithinPanel,
    0,
    Math.max(0, physicalRowCentersCalibrated.length - 1),
  )
  const expectedPhysicalY = physicalRowCentersCalibrated[physicalRowIndexExpected] ?? model?.expectedRowCenters[rowIndexWithinPanel] ?? meanY(row)
  const xTol = model?.xTolerance ?? 0.06
  const yTol = model?.yTolerance ?? 0.02
  const xTolSoft = xTol * 2.6
  const yTolSoft = yTol * 2.6
  const dominantRowSpacing = Math.max(1e-6, model?.dominantRowSpacing ?? yTol * 2.2)
  const ySnapTolerance = Math.max(yTol * 1.35, (model?.rowJitter ?? 0) * 2.4, (model?.dominantRowSpacing ?? 0.02) * 0.62)
  const xSnapTolerance = xTol * 1.35

  const bucket: Array<{ idx: number; mark: IndexedMark["mark"]; localX: number }> = []
  for (const it of row) {
    bucket.push({ idx: it.idx, mark: it.mark, localX: it.mark.centerX })
  }
  const rowSnap = physicalRowCentersCalibrated.length
    ? snapNearestIndex(meanY(row), physicalRowCentersCalibrated, ySnapTolerance)
    : { index: rowIndexWithinPanel, ambiguous: false }
  const snappedPhysicalY = physicalRowCentersCalibrated[rowSnap.index] ?? expectedPhysicalY
  const driftRaw = snappedPhysicalY - expectedPhysicalY
  const driftLimit = Math.max(yTol * 1.8, (model?.dominantRowSpacing ?? 0.02) * 0.72)
  const driftApplied = clamp(driftRaw, -driftLimit, driftLimit)
  const calibratedExpectedY = expectedPhysicalY + driftApplied
  const rowDistanceToExpected = expectedRowCentersCalibrated.length
    ? Math.abs(rowCenterY - expectedPhysicalY)
    : Math.abs(rowCenterY - calibratedExpectedY)
  const rowDistanceToSnapped = physicalRowCentersCalibrated.length
    ? Math.abs(rowCenterY - (physicalRowCentersCalibrated[rowSnap.index] ?? calibratedExpectedY))
    : rowDistanceToExpected
  const nearestPhysicalRows = [...physicalRowCentersCalibrated]
    .map((centerY, idx) => ({ rowIndex: idx, centerY, dy: Math.abs(centerY - rowCenterY) }))
    .sort((a, b) => a.dy - b.dy)
    .slice(0, 3)
  const expectedBand = model?.rowBands?.[physicalRowIndexExpected]
  const rowBandAccepted = expectedBand ? rowCenterY >= expectedBand.yMin && rowCenterY <= expectedBand.yMax : rowDistanceToExpected <= ySnapTolerance
  const rowBandRejectedReason = rowBandAccepted ? null : "ROW_CENTER_OUTSIDE_EXPECTED_PHYSICAL_BAND"
  const physicalGapDetected = (model?.anomalousPhysicalGaps ?? []).some(
    (g) => Math.abs(g.toRow - physicalRowIndexExpected) <= 1 || Math.abs(g.fromRow - physicalRowIndexExpected) <= 1,
  )
  if (rowSnap.ambiguous) {
    debugLogInterleaved("row candidate ambiguous", {
      panelIndex,
      questionNumber,
      expectedRow: rowIndexWithinPanel,
      detectedRow: rowSnap.index,
      tolerance: Number(ySnapTolerance.toFixed(5)),
      reason: "ROW_AMBIGUOUS",
    })
  }
  type CandidateTrace = {
    detectionIdx: number
    optionIdx: number
    dx: number
    dy: number
    dxNorm: number
    dyNorm: number
    distanceScore: number
    confidence: number
    state: "selected" | "unselected"
    rowSnapped: number
    columnDistanceScore: number
    rowDistanceScore: number
    fillConfidenceScore: number
    bandPenaltyScore: number
    neighborConflictPenalty: number
    finalCandidateScore: number
    bandPenaltyApplied: boolean
    bandPenaltyValue: number
    hardRejectedByBand: boolean
    reason: "ACCEPTED" | InterleavedRejectReason
  }
  type LifecycleCandidate = {
    detectionIdx: number
    candidateId: string
    panelIndex: 0 | 1
    rowIndex: number
    columnLetter: string
    enteredColumnAssignment: boolean
    survivedColumnAssignment: boolean
    enteredRowAssignment: boolean
    survivedRowAssignment: boolean
    enteredBandGate: boolean
    survivedBandGate: boolean
    enteredRanking: boolean
    survivedRanking: boolean
    attachedToQuestion: boolean
    attachedQuestionNumber: number | null
    reachedPerQuestionRaw: boolean
    selectedFinal: boolean
    rejectionStage: string | null
    rejectionReason: string | null
  }
  const candidateTrace: CandidateTrace[] = []
  const lifecycleByCandidateId = new Map<string, LifecycleCandidate>()
  for (const mark of bucket) {
    const baseColumn = nearestCenterIndex(mark.localX, centers)
    const candidateId = candidateIdFromDetectionIdx(mark.idx)
    lifecycleByCandidateId.set(candidateId, {
      detectionIdx: mark.idx,
      candidateId,
      panelIndex,
      rowIndex: rowIndexWithinPanel,
      columnLetter: letter(baseColumn),
      enteredColumnAssignment: true,
      survivedColumnAssignment: false,
      enteredRowAssignment: false,
      survivedRowAssignment: false,
      enteredBandGate: false,
      survivedBandGate: false,
      enteredRanking: false,
      survivedRanking: false,
      attachedToQuestion: false,
      attachedQuestionNumber: null,
      reachedPerQuestionRaw: false,
      selectedFinal: false,
      rejectionStage: null,
      rejectionReason: null,
    })
  }
  const byOption = new Map<
    number,
    {
      idx: number
      confidence: number
      state: "selected" | "unselected"
      score: number
      dx: number
      dy: number
      rowSnapped: number
      bandPenaltyApplied: boolean
      bandPenaltyValue: number
      hardRejectedByBand: boolean
    }
  >()
  const conservativeHardRejectLimit = Math.max((model?.dominantRowSpacing ?? 0.02) * 1.55, yTolSoft * 1.15)
  const ambiguityResidualTolerance = Math.max(yTol * 1.45, (model?.rowJitter ?? 0.005) * 2.8)
  let anyBandPenaltyApplied = false
  let anyHardRejectedByBand = false
  for (const mark of bucket) {
    const snappedCol = snapNearestIndex(mark.localX, centers, xSnapTolerance)
    const detectionRowSnap = physicalRowCentersCalibrated.length
      ? snapNearestIndex(mark.mark.centerY, physicalRowCentersCalibrated, ySnapTolerance)
      : { index: rowIndexWithinPanel, ambiguous: false }
    const optionIdx = snappedCol.index
    const cx = centers[optionIdx] ?? mark.localX
    const dx = Math.abs(mark.mark.centerX - cx)
    const dy = Math.abs(mark.mark.centerY - calibratedExpectedY)
    const dxNorm = dx / Math.max(1e-6, xTol)
    const dyNorm = dy / Math.max(1e-6, yTol)
    const distanceScore = dxNorm * 0.62 + dyNorm * 0.38
    const tooFarX = dx > xTolSoft
    const tooFarY = dy > yTolSoft
    const distanceTooHigh = distanceScore > 2.75
    const rowNeighborConflict =
      detectionRowSnap.index !== physicalRowIndexExpected &&
      Math.abs(detectionRowSnap.index - physicalRowIndexExpected) <= 1 &&
      Math.abs(mark.mark.centerY - (physicalRowCentersCalibrated[detectionRowSnap.index] ?? calibratedExpectedY)) + yTol * 0.25 <
        Math.abs(mark.mark.centerY - calibratedExpectedY)
    const expectedGapNearby = (model?.anomalousPhysicalGaps ?? []).some(
      (g) =>
        Math.abs(g.toRow - physicalRowIndexExpected) <= 1 ||
        Math.abs(g.fromRow - physicalRowIndexExpected) <= 1 ||
        Math.abs(g.toRow - detectionRowSnap.index) <= 1 ||
        Math.abs(g.fromRow - detectionRowSnap.index) <= 1,
    )
    const allowedJump = expectedGapNearby ? 2 : 1
    const longJumpConflict = Math.abs(detectionRowSnap.index - physicalRowIndexExpected) > allowedJump
    const candidateBand = model?.rowBands?.[detectionRowSnap.index]
    const expectedRowBand = model?.rowBands?.[physicalRowIndexExpected]
    const bandOutsideDistance = candidateBand
      ? mark.mark.centerY < candidateBand.yMin
        ? candidateBand.yMin - mark.mark.centerY
        : mark.mark.centerY > candidateBand.yMax
          ? mark.mark.centerY - candidateBand.yMax
          : 0
      : 0
    const expectedBandOutsideDistance = expectedRowBand
      ? mark.mark.centerY < expectedRowBand.yMin
        ? expectedRowBand.yMin - mark.mark.centerY
        : mark.mark.centerY > expectedRowBand.yMax
          ? mark.mark.centerY - expectedRowBand.yMax
          : 0
      : 0
    const dominantSpacing = Math.max(1e-6, model?.dominantRowSpacing ?? yTol)
    const bandOutsideNorm =
      Math.max(bandOutsideDistance, expectedBandOutsideDistance) / dominantSpacing +
      (expectedBandOutsideDistance > 0 ? expectedBandOutsideDistance / dominantSpacing : 0)
    const bandPenaltyApplied = bandOutsideDistance > 0
    const bandPenaltyValue = bandPenaltyApplied
      ? clamp(bandOutsideNorm * 0.9 + bandOutsideNorm * bandOutsideNorm * 0.55, 0.12, 2.4)
      : 0
    // Preservación local: una marca FÍSICAMENTE rellenada (state==="selected") con
    // alta confianza y distancia moderada NO debe ser hard-rejected por banda. La
    // regla original (basada solo en distancia geométrica) está expulsando marcas
    // reales. Mantenemos el rechazo extremo para distancias ya catastróficas.
    const markIsPhysicallySelected = mark.mark.state === "selected" && mark.mark.confidence >= 0.7
    const bandHardLimitForSelected = Math.max(conservativeHardRejectLimit * 1.35, dominantSpacing * 1.95)
    const hardRejectedByBand = markIsPhysicallySelected
      ? bandOutsideDistance > bandHardLimitForSelected ||
        expectedBandOutsideDistance > bandHardLimitForSelected * 0.92
      : bandOutsideDistance > conservativeHardRejectLimit ||
        expectedBandOutsideDistance > conservativeHardRejectLimit * 0.9
    if (bandPenaltyApplied) anyBandPenaltyApplied = true
    if (hardRejectedByBand) anyHardRejectedByBand = true
    const rejectedByAmbiguity = snappedCol.ambiguous
    const verticalGapToExpected = Math.abs(mark.mark.centerY - calibratedExpectedY)
    // Validación física de vecinos: si la marca es real (state==="selected"), su
    // dy a la fila esperada está dentro de la mitad del row spacing y NO está
    // claramente "robada" por una fila vecina (verticalGapToExpected razonable),
    // no la consideramos en conflicto severo aunque haya neighbor row.
    const selectedWithinRowVicinity =
      markIsPhysicallySelected &&
      verticalGapToExpected <= Math.max(yTol * 1.55, dominantSpacing * 0.55)
    const severeNeighborConflict =
      rowNeighborConflict &&
      verticalGapToExpected > Math.max(yTol * 1.05, (model?.rowJitter ?? 0.004) * 1.8) &&
      !selectedWithinRowVicinity
    const columnDistanceScore = dxNorm * 0.62
    const rowDistanceScore = dyNorm * 0.38
    const fillConfidenceScore = (1 - mark.mark.confidence) + (mark.mark.state === "selected" ? 0 : 0.325)
    const neighborConflictPenalty = severeNeighborConflict ? 1.05 : rowNeighborConflict ? 0.4 : 0
    const finalCandidateScore =
      columnDistanceScore + rowDistanceScore + fillConfidenceScore + bandPenaltyValue + neighborConflictPenalty
    const candidateId = candidateIdFromDetectionIdx(mark.idx)
    const lifecycle = lifecycleByCandidateId.get(candidateId)
    if (lifecycle) {
      lifecycle.columnLetter = letter(optionIdx)
      lifecycle.enteredRowAssignment = true
      lifecycle.enteredBandGate = true
      lifecycle.survivedColumnAssignment = !rejectedByAmbiguity && !tooFarX
      lifecycle.survivedRowAssignment = !tooFarY && !severeNeighborConflict && !longJumpConflict
      lifecycle.survivedBandGate = !hardRejectedByBand
    }
    if (tooFarX || tooFarY || distanceTooHigh || rejectedByAmbiguity || longJumpConflict || hardRejectedByBand || severeNeighborConflict) {
      let reason: InterleavedRejectReason
      if (rejectedByAmbiguity && snappedCol.ambiguous) reason = "COLUMN_AMBIGUOUS"
      else if (severeNeighborConflict) reason = "ROW_NEIGHBOR_CONFLICT"
      else if (hardRejectedByBand) reason = "BAND_EXTREME_REJECT"
      else if (longJumpConflict) reason = "ROW_NEIGHBOR_CONFLICT"
      else if (tooFarX) reason = "OUTSIDE_X_TOLERANCE"
      else if (tooFarY) reason = "OUTSIDE_Y_TOLERANCE"
      else reason = "DISTANCE_TOO_HIGH"
      candidateTrace.push({
        detectionIdx: mark.idx,
        optionIdx,
        dx,
        dy,
        dxNorm,
        dyNorm,
        distanceScore,
        confidence: mark.mark.confidence,
        state: mark.mark.state,
        rowSnapped: detectionRowSnap.index,
        columnDistanceScore,
        rowDistanceScore,
        fillConfidenceScore,
        bandPenaltyScore: bandPenaltyValue,
        neighborConflictPenalty,
        finalCandidateScore,
        bandPenaltyApplied,
        bandPenaltyValue,
        hardRejectedByBand,
        reason,
      })
      debugLogInterleaved("nearest candidate rejected", {
        panelIndex,
        questionNumber,
        detectionIdx: mark.idx,
        reason,
        expectedRow: rowIndexWithinPanel,
        detectedRow: detectionRowSnap.index,
        expectedColumn: optionIdx,
        detectedColumn: optionIdx,
        dx: Number(dx.toFixed(5)),
        dy: Number(dy.toFixed(5)),
        optionIdx,
        dxNorm: Number(dxNorm.toFixed(3)),
        dyNorm: Number(dyNorm.toFixed(3)),
        finalCandidateScore: Number(finalCandidateScore.toFixed(4)),
        bandPenaltyValue: Number(bandPenaltyValue.toFixed(4)),
        hardRejectedByBand,
        xTol: Number(xTol.toFixed(5)),
        yTol: Number(yTol.toFixed(5)),
        xTolSoft: Number(xTolSoft.toFixed(5)),
        yTolSoft: Number(yTolSoft.toFixed(5)),
      })
      if (lifecycle) {
        lifecycle.rejectionStage =
          reason === "COLUMN_AMBIGUOUS" || reason === "OUTSIDE_X_TOLERANCE"
            ? "column_assignment"
            : reason === "OUTSIDE_Y_TOLERANCE" || reason === "ROW_NEIGHBOR_CONFLICT"
              ? "row_assignment"
              : reason === "BAND_EXTREME_REJECT"
                ? "band_gate"
                : "ranking"
        lifecycle.rejectionReason = reason
      }
      continue
    }
    candidateTrace.push({
      detectionIdx: mark.idx,
      optionIdx,
      dx,
      dy,
      dxNorm,
      dyNorm,
      distanceScore,
      confidence: mark.mark.confidence,
      state: mark.mark.state,
      rowSnapped: detectionRowSnap.index,
      columnDistanceScore,
      rowDistanceScore,
      fillConfidenceScore,
      bandPenaltyScore: bandPenaltyValue,
      neighborConflictPenalty,
      finalCandidateScore,
      bandPenaltyApplied,
      bandPenaltyValue,
      hardRejectedByBand,
      reason: "ACCEPTED",
    })
    debugLogInterleaved("nearest candidate accepted", {
      panelIndex,
      questionNumber,
      detectionIdx: mark.idx,
      expectedRow: rowIndexWithinPanel,
      detectedRow: detectionRowSnap.index,
      expectedColumn: optionIdx,
      detectedColumn: optionIdx,
      dx: Number(dx.toFixed(5)),
      dy: Number(dy.toFixed(5)),
      distanceScore: Number(distanceScore.toFixed(4)),
      finalCandidateScore: Number(finalCandidateScore.toFixed(4)),
      confidence: Number(mark.mark.confidence.toFixed(4)),
      state: mark.mark.state,
      bandPenaltyValue: Number(bandPenaltyValue.toFixed(4)),
      bandPenaltyApplied,
    })
    const prev = byOption.get(optionIdx)
    if (
      !prev ||
      finalCandidateScore < prev.score - 0.01 ||
      (Math.abs(finalCandidateScore - prev.score) <= 0.01 && mark.mark.confidence > prev.confidence)
    ) {
      if (prev) {
        debugLogInterleaved("candidate replaced for column", {
          panelIndex,
          questionNumber,
          reason: "MULTIPLE_CANDIDATES",
          optionIdx,
          previousDetectionIdx: prev.idx,
          newDetectionIdx: mark.idx,
          previousScore: Number(prev.score.toFixed(4)),
          newScore: Number(finalCandidateScore.toFixed(4)),
          previousConfidence: Number(prev.confidence.toFixed(4)),
          newConfidence: Number(mark.mark.confidence.toFixed(4)),
        })
        const replacedId = candidateIdFromDetectionIdx(prev.idx)
        const replacedLifecycle = lifecycleByCandidateId.get(replacedId)
        if (replacedLifecycle && !replacedLifecycle.rejectionStage) {
          replacedLifecycle.rejectionStage = "ranking"
          replacedLifecycle.rejectionReason = "MULTIPLE_CANDIDATES"
        }
      }
      byOption.set(optionIdx, {
        idx: mark.idx,
        confidence: mark.mark.confidence,
        state: mark.mark.state,
        score: finalCandidateScore,
        dx,
        dy,
        rowSnapped: detectionRowSnap.index,
        bandPenaltyApplied,
        bandPenaltyValue,
        hardRejectedByBand,
      })
    }
  }
  const confidencesByColumn: Record<string, number> = {}
  for (let i = 0; i < expectedOptionCount; i++) {
    const hit = byOption.get(i)
    if (hit) confidencesByColumn[letter(i)] = Number(hit.confidence.toFixed(4))
  }
  const candidatesPrePhysicalEvidence = Array.from(byOption.entries()).sort(
    (a, b) => a[1].score - b[1].score || b[1].confidence - a[1].confidence,
  )
  let candidates = candidatesPrePhysicalEvidence
  let forcedByUniqueSelectedUnderRowAmbiguity = false
  if (rowSnap.ambiguous && candidates.length > 1) {
    const selectedAmongCandidates = candidates.filter(([, c]) => c.state === "selected")
    if (selectedAmongCandidates.length === 1) {
      const [uIdx, uCand] = selectedAmongCandidates[0]!
      const maxUnselectedConf = Math.max(
        0,
        ...candidates.filter(([k]) => k !== uIdx).map(([, c]) => c.confidence),
      )
      // Evidencia relativa al vecindario de opciones: una sola marca física "selected"
      // debe superar el ruido local (máx. confianza entre burbujas no rellenadas) con
      // margen; piso universal 0.62, techo 0.82 para no exigir confianzas imposibles.
      const minSelectedConf = Math.min(0.82, Math.max(0.62, maxUnselectedConf + 0.11))
      if (uCand.confidence >= minSelectedConf) {
        const rowSnapDelta = Math.abs((uCand.rowSnapped ?? physicalRowIndexExpected) - physicalRowIndexExpected)
        const dyBudget = Math.max(
          ambiguityResidualTolerance * 1.2,
          yTol * 1.65,
          dominantRowSpacing * 0.78,
        )
        if (rowSnapDelta <= 1 && uCand.dy <= dyBudget && !uCand.hardRejectedByBand) {
          const others = candidates
            .filter(([k]) => k !== uIdx)
            .sort((a, b) => a[1].score - b[1].score || b[1].confidence - a[1].confidence)
          candidates = [[uIdx, uCand], ...others]
          forcedByUniqueSelectedUnderRowAmbiguity = true
        }
      }
    }
  }
  // Desempate horizontal universal: el ganador por score compuesto puede ser una
  // burbuja no rellenada en columna C mientras la marca física (selected) vive en
  // columna adyacente con score apenas peor — típico de ruido X cuando los centros
  // están cerca del borde de Voronói. Solo actuamos si la marca selected está
  // alineada con su columna snap (dx relativo a vecino) y el gap de score es
  // acotado por el paso de columnas vs xTol (sin IDs ni plantillas fijas).
  if (candidates.length >= 2 && !forcedByUniqueSelectedUnderRowAmbiguity) {
    const [i0, c0] = candidates[0]!
    const [i1, c1] = candidates[1]!
    const idxAdjacent = Math.abs(i0 - i1) === 1
    const scoreGap = c1.score - c0.score
    const colSpacings: number[] = []
    for (let i = 1; i < centers.length; i++) {
      colSpacings.push(Math.abs((centers[i] ?? 0) - (centers[i - 1] ?? 0)))
    }
    const medianColSpacing = colSpacings.length ? median(colSpacings) : xTol
    const horizontalSwapMaxGap = clamp(
      (medianColSpacing / Math.max(1e-6, xTol)) * 0.05,
      0.085,
      0.23,
    )
    const dominanceOk = c0.score > 1e-6 && c1.score / c0.score <= 1.34
    if (
      idxAdjacent &&
      c0.state === "unselected" &&
      c1.state === "selected" &&
      c1.confidence >= Math.max(0.69, c0.confidence + 0.11) &&
      scoreGap > 0 &&
      scoreGap < horizontalSwapMaxGap &&
      dominanceOk
    ) {
      const mark1 = bucket.find((b) => b.idx === c1.idx)
      if (mark1) {
        const x = mark1.mark.centerX
        const d0 = Math.abs(x - (centers[i0] ?? x))
        const d1 = Math.abs(x - (centers[i1] ?? x))
        const alignSlack = Math.min(xTol * 0.34, medianColSpacing * 0.19)
        if (d1 <= d0 + alignSlack) {
          candidates = [[i1, c1], [i0, c0], ...candidates.slice(2)]
        }
      }
    }
  }
  const rankedCandidates = candidates.map(([optionIdx, candidate], rank) => ({ rank: rank + 1, optionIdx, candidate }))
  let chosen: (typeof candidates)[number][1] | null = candidates[0]?.[1] ?? null
  let chosenIdx = candidates[0]?.[0] ?? -1
  // Forensic continuity (interleaved-only): persist best-ranked candidate
  // even if it is later nullified, so question_attachment->per_question_raw
  // never loses the survivor silently. NOT used to alter any decision logic.
  const bestRankedCandidateInitial = candidatesPrePhysicalEvidence[0]?.[1] ?? null
  const bestRankedCandidateIdInitial = bestRankedCandidateInitial
    ? candidateIdFromDetectionIdx(bestRankedCandidateInitial.idx)
    : null
  const bestRankedCompositeScoreInitial = bestRankedCandidateInitial?.score ?? null
  let chosenCandidateBeforeNullification: {
    candidateId: string
    optionLetter: string
    compositeScore: number
    confidence: number
  } | null = null
  let explicitFinalNullificationReason: string | null = null
  const second = candidates[1]?.[1] ?? null
  const winnerMargin = chosen && second ? second.score - chosen.score : null
  const topRowsAreImmediateNeighbors =
    chosen && second ? Math.abs((chosen.rowSnapped ?? physicalRowIndexExpected) - (second.rowSnapped ?? physicalRowIndexExpected)) <= 1 : false
  // Umbral en espacio de score compuesto: derivado del paso vertical medio
  // (dyNorm) entre tiers vecinos. Evita mezclar coords Y absolutas (~0.05)
  // con márgenes de score (~0.08–0.18), que inflaba el umbral y anulaba
  // resoluciones válidas tras tiering estable.
  const dyNormHalfPitch = Math.min(1.05, dominantRowSpacing * 0.5 / Math.max(1e-6, yTol))
  const scoreMarginFromVerticalNeighbor = 0.38 * dyNormHalfPitch * 0.88
  const ambiguityGapAdaptiveThreshold = clamp(
    Math.max(0.062, yTol * 2.15, scoreMarginFromVerticalNeighbor),
    0.062,
    0.155,
  )
  const ambiguityClearWinner = winnerMargin != null && winnerMargin >= ambiguityGapAdaptiveThreshold
  const ambiguityResidualOk = chosen ? chosen.dy <= ambiguityResidualTolerance : false
  const ambiguityResolutionTriggeredByGeometry = rowSnap.ambiguous
  const scoreDominanceRatio =
    chosen && second ? second.score / Math.max(chosen.score, 1e-6) : Number.POSITIVE_INFINITY
  const topTwoBothPhysicallySelected =
    !!(
      chosen &&
      second &&
      chosen.state === "selected" &&
      second.state === "selected" &&
      chosen.confidence >= 0.64 &&
      second.confidence >= 0.64
    )
  const hasCompetitiveConflictNearby =
    !!(
      chosen &&
      second &&
      topTwoBothPhysicallySelected &&
      winnerMargin != null &&
      (winnerMargin < Math.max(0.1, ambiguityGapAdaptiveThreshold * 1.08) ||
        scoreDominanceRatio < 1.32 ||
        second.confidence >= chosen.confidence - 0.015)
    )
  const stableAttachmentToExpectedRow =
    !!chosen &&
    Math.abs((chosen.rowSnapped ?? physicalRowIndexExpected) - physicalRowIndexExpected) <= 1 &&
    chosen.dy <= Math.max(ambiguityResidualTolerance * 0.82, yTol * 1.1) &&
    !chosen.hardRejectedByBand &&
    chosen.bandPenaltyValue <= 0.26
  // Anclaje suave: misma noción que stableAttachmentToExpectedRow pero con
  // tolerancias ligeramente más amplias, usado SOLO cuando el chosen es una
  // marca físicamente rellenada (state==="selected"). No afecta candidatos
  // sintetizados ni acepta filas sin marca real.
  const softAttachmentForSelected =
    !!chosen &&
    chosen.state === "selected" &&
    Math.abs((chosen.rowSnapped ?? physicalRowIndexExpected) - physicalRowIndexExpected) <= 1 &&
    chosen.dy <= Math.max(ambiguityResidualTolerance, yTol * 1.45, (model?.dominantRowSpacing ?? 0.02) * 0.55) &&
    !chosen.hardRejectedByBand &&
    chosen.bandPenaltyValue <= 0.5
  const chosenIsPhysicallySolidSelected =
    !!chosen &&
    chosen.state === "selected" &&
    chosen.confidence >= 0.7 &&
    softAttachmentForSelected
  const ambiguityResolutionTriggered = ambiguityResolutionTriggeredByGeometry && candidates.length > 1
  const safeToMaterializeDespiteAmbiguity =
    !!(
      ambiguityResolutionTriggered &&
      chosen &&
      bestRankedCandidateIdInitial &&
      !hasCompetitiveConflictNearby &&
      (
        (
          stableAttachmentToExpectedRow &&
          ambiguityClearWinner &&
          topRowsAreImmediateNeighbors &&
          winnerMargin != null &&
          winnerMargin >= Math.max(0.13, ambiguityGapAdaptiveThreshold * 1.15) &&
          scoreDominanceRatio >= 1.42 &&
          ambiguityResidualOk
        ) ||
        // Rama de salvataje físico: si el ganador es una marca real (selected)
        // con confianza alta, dy razonable y los top-2 son vecinos verticales
        // inmediatos, materializamos. NO inventa respuesta: requiere
        // state==="selected" => marca rellenada físicamente detectada.
        (
          chosenIsPhysicallySolidSelected &&
          topRowsAreImmediateNeighbors &&
          winnerMargin != null &&
          winnerMargin >= Math.max(0.06, ambiguityGapAdaptiveThreshold * 0.55) &&
          scoreDominanceRatio >= 1.18
        )
      )
    )
  let ambiguityResolutionAccepted = false
  let ambiguityResolutionReason: string | null = null
  let materializedDespiteAmbiguity = false
  if (ambiguityResolutionTriggered) {
    ambiguityResolutionAccepted = !!(
      chosen &&
      (
        forcedByUniqueSelectedUnderRowAmbiguity ||
        (ambiguityClearWinner && topRowsAreImmediateNeighbors && ambiguityResidualOk) ||
        safeToMaterializeDespiteAmbiguity ||
        // Aceptación local cuando el ganador es una marca física real y los
        // top-rows son vecinos. Mantener simétrico (no por columna).
        (chosenIsPhysicallySolidSelected && topRowsAreImmediateNeighbors)
      )
    )
    if (!ambiguityResolutionAccepted) {
      ambiguityResolutionReason = "INSUFFICIENT_MARGIN_OR_NON_NEIGHBOR_ROWS"
      if (chosen && chosenIdx >= 0 && !chosenCandidateBeforeNullification) {
        chosenCandidateBeforeNullification = {
          candidateId: candidateIdFromDetectionIdx(chosen.idx),
          optionLetter: letter(chosenIdx),
          compositeScore: chosen.score,
          confidence: chosen.confidence,
        }
        explicitFinalNullificationReason =
          "AMBIGUITY_RESOLUTION_REJECTED_INSUFFICIENT_MARGIN_OR_NON_NEIGHBOR_ROWS"
      }
      chosen = null
      chosenIdx = -1
    } else {
      materializedDespiteAmbiguity = safeToMaterializeDespiteAmbiguity
      ambiguityResolutionReason = forcedByUniqueSelectedUnderRowAmbiguity
        ? "UNIQUE_SELECTED_UNDER_ROW_SNAP_AMBIGUITY"
        : safeToMaterializeDespiteAmbiguity
          ? "SAFE_MATERIALIZATION_DESPITE_AMBIGUITY"
          : "DOMINANT_NEIGHBOR_WITHIN_ADAPTIVE_VERTICAL_TOLERANCE"
    }
  }
  // Guard local: marca rellenada físicamente (state==="selected") con confianza
  // razonable NO debe ser nulificada por la combinación "low confidence + high
  // composite score". El score alto suele venir de penalizaciones de banda en
  // filas con drift; si la marca fue detectada rellenada, conservarla.
  const chosenIsRealFilledMark = !!(chosen && chosen.state === "selected" && chosen.confidence >= 0.6)
  if (
    chosen &&
    !chosenIsRealFilledMark &&
    chosen.confidence < Math.max(0.43, sensitivityThreshold - 0.2) &&
    chosen.score > 1.9
  ) {
    if (!ambiguityResolutionReason) ambiguityResolutionReason = "LOW_CONFIDENCE_WITH_HIGH_COMPOSITE_SCORE"
    if (chosen && chosenIdx >= 0 && !chosenCandidateBeforeNullification) {
      chosenCandidateBeforeNullification = {
        candidateId: candidateIdFromDetectionIdx(chosen.idx),
        optionLetter: letter(chosenIdx),
        compositeScore: chosen.score,
        confidence: chosen.confidence,
      }
    }
    explicitFinalNullificationReason =
      explicitFinalNullificationReason ?? "CHOSEN_NULLIFIED_LOW_CONFIDENCE_WITH_HIGH_COMPOSITE_SCORE"
    chosen = null
    chosenIdx = -1
  }

  // Margen mínimo entre 1.er y 2.º candidato por score compuesto (solo interleaved).
  // No altera OMR clásico; reversible vía INTERLEAVED_TIGHT_WINNER_MARGIN_DISABLE.
  const tightWinnerMarginMinGap = getInterleavedTightWinnerMarginMinGap()
  let interleavedTightMarginResolution: Record<string, unknown> | null = null
  const secondRanked = candidates[1]?.[1] ?? null
  if (
    Number.isFinite(tightWinnerMarginMinGap) &&
    tightWinnerMarginMinGap < Number.POSITIVE_INFINITY &&
    chosen &&
    secondRanked &&
    candidates.length >= 2 &&
    chosen === candidates[0]?.[1] &&
    secondRanked === candidates[1]?.[1]
  ) {
    const marginNow = secondRanked.score - chosen.score
    if (marginNow < tightWinnerMarginMinGap) {
      interleavedTightMarginResolution = {
        pendingClassicBridge: true,
        winnerMargin: Number(marginNow.toFixed(6)),
        bestScore: chosen.score,
        secondBestScore: secondRanked.score,
        confidenceDifference: Number((secondRanked.confidence - chosen.confidence).toFixed(6)),
        minScoreGapApplied: tightWinnerMarginMinGap,
        suppressedInterleavedLetter: letter(chosenIdx),
        ambiguityResolutionReason: "TIGHT_WINNER_MARGIN_BELOW_THRESHOLD",
      }
      if (chosenIdx >= 0 && !chosenCandidateBeforeNullification) {
        chosenCandidateBeforeNullification = {
          candidateId: candidateIdFromDetectionIdx(chosen.idx),
          optionLetter: letter(chosenIdx),
          compositeScore: chosen.score,
          confidence: chosen.confidence,
        }
      }
      explicitFinalNullificationReason = "INTERLEAVED_TIGHT_WINNER_MARGIN"
      if (!ambiguityResolutionReason) ambiguityResolutionReason = "TIGHT_WINNER_MARGIN_BELOW_THRESHOLD"
      chosen = null
      chosenIdx = -1
    }
  }

  let interleavedAmbiguityTelemetry: {
    winnerMargin: number | null
    bestScore: number | null
    secondBestScore: number | null
    confidenceDifference: number | null
    decisionSource: string
    ambiguityResolutionReason: string | null
  } = {
    winnerMargin: winnerMargin != null ? Number(winnerMargin.toFixed(6)) : null,
    bestScore: candidates[0]?.[1]?.score ?? null,
    secondBestScore: candidates[1]?.[1]?.score ?? null,
    confidenceDifference:
      candidates[0]?.[1] && candidates[1]?.[1]
        ? Number((candidates[1]![1].confidence - candidates[0]![1].confidence).toFixed(6))
        : null,
    decisionSource: interleavedTightMarginResolution ? "pending_tight_margin_classic_bridge" : "interleaved_ranking",
    ambiguityResolutionReason,
  }

  const nearestCandidates = [...candidateTrace]
    .sort((a, b) => a.finalCandidateScore - b.finalCandidateScore || b.confidence - a.confidence)
    .slice(0, 5)
  const selectedAnswer = chosen && chosenIdx >= 0 ? letter(chosenIdx) : "BLANK"
  const acceptedCandidateCount = candidateTrace.filter((c) => c.reason === "ACCEPTED").length
  const candidateIdsSeen = bucket.map((m) => candidateIdFromDetectionIdx(m.idx))
  const candidateIdsAfterColumnStage = candidateIdsSeen.filter((id) => lifecycleByCandidateId.get(id)?.survivedColumnAssignment)
  const candidateIdsAfterRowStage = candidateIdsSeen.filter((id) => lifecycleByCandidateId.get(id)?.survivedRowAssignment)
  const candidateIdsAfterBandStage = candidateIdsSeen.filter((id) => lifecycleByCandidateId.get(id)?.survivedBandGate)
  const candidateIdsAfterRanking = candidates.map(([, c]) => candidateIdFromDetectionIdx(c.idx))
  const attachedCandidateIds = [...candidateIdsAfterRanking]
  const finalSelectedCandidateId = chosen ? candidateIdFromDetectionIdx(chosen.idx) : null
  for (const candidateId of candidateIdsAfterBandStage) {
    const lifecycle = lifecycleByCandidateId.get(candidateId)
    if (!lifecycle) continue
    lifecycle.enteredRanking = true
  }
  for (const candidateId of candidateIdsAfterRanking) {
    const lifecycle = lifecycleByCandidateId.get(candidateId)
    if (!lifecycle) continue
    lifecycle.survivedRanking = true
    lifecycle.attachedToQuestion = true
    lifecycle.attachedQuestionNumber = questionNumber
    lifecycle.reachedPerQuestionRaw = true
  }
  if (finalSelectedCandidateId) {
    const selectedLifecycle = lifecycleByCandidateId.get(finalSelectedCandidateId)
    if (selectedLifecycle) selectedLifecycle.selectedFinal = true
  }
  const finalMaterializationFailure = candidateIdsAfterRanking.length > 0 && !finalSelectedCandidateId
  // Forensic guarantee: if there is a real materialization failure with surviving
  // ranked candidates but no explicit reason was recorded, attach a non-silent
  // fallback so assignedDetectionIndices=[] never appears without a reason.
  if (finalMaterializationFailure && !explicitFinalNullificationReason) {
    explicitFinalNullificationReason = ambiguityResolutionTriggered
      ? ambiguityResolutionAccepted
        ? "MATERIALIZATION_WITHOUT_SELECTED_WINNER_DESPITE_AMBIGUITY_RESOLVED"
        : "ROW_AMBIGUITY_NOT_RESOLVED"
      : "NO_FINAL_WINNER_AFTER_RANKING_NO_EXPLICIT_NULLIFIER"
  }
  if (!chosen) {
    for (const candidateId of candidateIdsAfterRanking) {
      const lifecycle = lifecycleByCandidateId.get(candidateId)
      if (!lifecycle || lifecycle.rejectionStage) continue
      lifecycle.rejectionStage = "materialization"
      lifecycle.rejectionReason =
        explicitFinalNullificationReason ??
        (ambiguityResolutionTriggered
          ? ambiguityResolutionAccepted
            ? "MATERIALIZATION_WITHOUT_SELECTED_WINNER"
            : "ROW_AMBIGUITY_NOT_RESOLVED"
          : "NO_FINAL_WINNER")
    }
  }
  const rowDelta = rowCenterY - calibratedExpectedY
  debugLogInterleaved("row matching", {
    panelIndex,
    questionNumber,
    expectedLogicalRow: rowIndexWithinPanel,
    expectedPhysicalRow: physicalRowIndexExpected,
    expectedPhysicalY: Number(expectedPhysicalY.toFixed(5)),
    observedDetectionY: Number(rowCenterY.toFixed(5)),
    rowCenterY: Number(rowCenterY.toFixed(5)),
    expectedY: Number(calibratedExpectedY.toFixed(5)),
    rowDelta: Number(rowDelta.toFixed(5)),
    verticalResidual: Number((rowCenterY - expectedPhysicalY).toFixed(5)),
    driftApplied: Number(driftApplied.toFixed(5)),
    physicalGapDetected,
    rowBandAccepted,
    rowBandRejectedReason,
    nearestPhysicalRows: nearestPhysicalRows.map((r) => ({
      rowIndex: r.rowIndex,
      centerY: Number(r.centerY.toFixed(5)),
      dy: Number(r.dy.toFixed(5)),
    })),
    selectedAnswer,
    assignedDetectionIndices: chosen ? [chosen.idx] : [],
    observedFromSensors: bucket.length > 0,
    rejectedAsBlank: chosen ? false : true,
    ambiguityResolutionTriggered,
    ambiguityWinnerMargin: winnerMargin != null ? Number(winnerMargin.toFixed(5)) : null,
    ambiguityResolutionAccepted,
    ambiguityResolutionReason,
    forcedByUniqueSelectedUnderRowAmbiguity,
    safeToMaterializeDespiteAmbiguity,
    materializedDespiteAmbiguity,
    bandPenaltyApplied: anyBandPenaltyApplied,
    hardRejectedByBand: anyHardRejectedByBand,
    nearestCandidates: nearestCandidates.map((c) => ({
      detectionIdx: c.detectionIdx,
      column: c.optionIdx,
      confidence: Number(c.confidence.toFixed(4)),
      score: Number(c.finalCandidateScore.toFixed(4)),
      dx: Number(c.dx.toFixed(5)),
      dy: Number(c.dy.toFixed(5)),
      rowSnapped: c.rowSnapped,
      reason: c.reason,
      bandPenaltyApplied: c.bandPenaltyApplied,
      bandPenaltyValue: Number(c.bandPenaltyValue.toFixed(4)),
      hardRejectedByBand: c.hardRejectedByBand,
    })),
    expectedCenterByOption: centers.map((x, i) => ({ column: letter(i), x: Number(x.toFixed(5)), y: Number(calibratedExpectedY.toFixed(5)) })),
    discardedCandidates: candidates.slice(1, 5).map((c) => ({
      detectionIdx: c[1].idx,
      column: c[0],
      confidence: Number(c[1].confidence.toFixed(4)),
      score: Number(c[1].score.toFixed(4)),
    })),
    interleavedAmbiguityTelemetry,
    interleavedTightMarginResolution,
  })
  if (debugAcc) {
    const gd = ensureGeometryDiagnostics(debugAcc, model)
    gd.pipelineStageCounters.survivedColumnAssignment += acceptedCandidateCount
    gd.pipelineStageCounters.survivedRowAssignment += rowBandAccepted ? 1 : 0
    gd.pipelineStageCounters.finalAssignedAnswers += selectedAnswer === "BLANK" ? 0 : 1
    gd.pipelineForensicCounters.candidatesEnteringRanking += candidateIdsAfterBandStage.length
    gd.pipelineForensicCounters.candidatesAfterRanking += candidateIdsAfterRanking.length
    gd.pipelineForensicCounters.candidatesAttachedToQuestions += attachedCandidateIds.length
    gd.pipelineForensicCounters.questionsWithCandidates += candidateIdsSeen.length > 0 ? 1 : 0
    gd.pipelineForensicCounters.questionsWithoutCandidates += candidateIdsSeen.length > 0 ? 0 : 1
    gd.pipelineForensicCounters.questionsWithEmptyConfidences += Object.keys(confidencesByColumn).length === 0 ? 1 : 0
    gd.pipelineForensicCounters.questionsWithObservedFromSensorsFalse += bucket.length > 0 ? 0 : 1
    for (const lifecycle of lifecycleByCandidateId.values()) {
      gd.candidateLifecycleTrace.push(lifecycle)
    }
    const stageTransitions: Array<{ previous: string; next: string; previousIds: string[]; nextIds: string[] }> = [
      { previous: "seen", next: "column_stage", previousIds: candidateIdsSeen, nextIds: candidateIdsAfterColumnStage },
      {
        previous: "column_stage",
        next: "row_stage",
        previousIds: candidateIdsAfterColumnStage,
        nextIds: candidateIdsAfterRowStage,
      },
      { previous: "row_stage", next: "band_stage", previousIds: candidateIdsAfterRowStage, nextIds: candidateIdsAfterBandStage },
      {
        previous: "band_stage",
        next: "ranking_stage",
        previousIds: candidateIdsAfterBandStage,
        nextIds: candidateIdsAfterRanking,
      },
      {
        previous: "ranking_stage",
        next: "question_attachment",
        previousIds: candidateIdsAfterRanking,
        nextIds: attachedCandidateIds,
      },
      {
        previous: "question_attachment",
        next: "per_question_raw",
        previousIds: attachedCandidateIds,
        nextIds: finalSelectedCandidateId ? [finalSelectedCandidateId] : [],
      },
    ]
    for (const transition of stageTransitions) {
      const nextSet = new Set(transition.nextIds)
      for (const candidateId of transition.previousIds) {
        if (nextSet.has(candidateId)) continue
        const lifecycle = lifecycleByCandidateId.get(candidateId)
        if (!lifecycle || lifecycle.rejectionReason) continue
        gd.candidateLostBetweenStages.push({
          candidateId,
          lostBetween: `${transition.previous}->${transition.next}`,
          previousStage: transition.previous,
          nextStage: transition.next,
          lastKnownState: JSON.stringify({
            panelIndex: lifecycle.panelIndex,
            rowIndex: lifecycle.rowIndex,
            columnLetter: lifecycle.columnLetter,
          }),
        })
      }
    }
    gd.questionAssemblyDiagnostics.push({
      questionNumber,
      candidateIdsSeen,
      candidateIdsAfterColumnStage,
      candidateIdsAfterRowStage,
      candidateIdsAfterBandStage,
      candidateIdsAfterRanking,
      attachedCandidateIds,
      finalSelectedCandidateId,
      whyNoAssignment: finalSelectedCandidateId
        ? null
        : candidateIdsSeen.length === 0
          ? "NO_CANDIDATES_SEEN"
          : explicitFinalNullificationReason === "INTERLEAVED_TIGHT_WINNER_MARGIN"
            ? "INTERLEAVED_TIGHT_WINNER_MARGIN"
            : ambiguityResolutionTriggered && !ambiguityResolutionAccepted
              ? "ROW_AMBIGUITY_NOT_RESOLVED"
              : candidateIdsAfterRanking.length === 0
                ? "ALL_CANDIDATES_FILTERED_BEFORE_RANKING"
                : "NO_FINAL_WINNER_AFTER_MATERIALIZATION",
      whyNoConfidences:
        Object.keys(confidencesByColumn).length > 0
          ? null
          : candidateIdsSeen.length === 0
            ? "NO_CANDIDATES_SEEN"
            : "NO_CANDIDATE_SURVIVED_TO_CONFIDENCE_MAP",
      whyObservedFromSensorsFalse: bucket.length > 0 ? null : "ROW_BUCKET_EMPTY",
      bestRankedCandidateId: bestRankedCandidateIdInitial,
      bestRankedCompositeScore: bestRankedCompositeScoreInitial,
      chosenCandidateBeforeNullification,
      explicitFinalNullificationReason,
      finalMaterializationFailure,
      materializedDespiteAmbiguity,
    })
    if (candidateIdsAfterRanking.length > 0 && attachedCandidateIds.length === 0) {
      gd.pipelineInvariantViolations.push({
        invariant: "surviving_candidate_must_attach_to_question",
        questionNumber,
        detail: "Hay candidatos tras ranking sin adjunto a pregunta.",
      })
    }
    if (candidateIdsSeen.length > 0 && (chosen ? [chosen.idx] : []).length === 0) {
      gd.pipelineInvariantViolations.push({
        invariant: "question_with_candidates_cannot_have_empty_assignment",
        questionNumber,
        detail: "La pregunta tuvo candidatos, pero assignedDetectionIndices terminó vacío.",
      })
    }
    if (finalMaterializationFailure && !explicitFinalNullificationReason) {
      gd.pipelineInvariantViolations.push({
        invariant: "empty_assignment_must_have_explicit_nullification_reason",
        questionNumber,
        detail:
          "Hubo candidatos surviving ranking pero finalSelectedCandidateId=null sin explicitFinalNullificationReason. " +
          "BLANK no debe materializarse silenciosamente.",
      })
    }
    if (Object.keys(confidencesByColumn).length === 0 && candidateIdsSeen.length > 0) {
      gd.pipelineInvariantViolations.push({
        invariant: "empty_confidences_only_when_zero_candidates",
        questionNumber,
        detail: "confidencesByColumn vacío con candidatos presentes.",
      })
    }
    gd.rowVerticalDelta.push({
      panelIndex,
      questionNumber,
      expectedY: calibratedExpectedY,
      observedY: rowCenterY,
      delta: rowDelta,
    })
    for (let i = 0; i < centers.length; i++) {
      gd.expectedBubbleCenters.push({
        x: centers[i]!,
        y: calibratedExpectedY,
        panelIndex,
        questionNumber,
        column: letter(i),
      })
    }
    for (const mark of bucket) {
      gd.detectedBubbleCenters.push({
        x: mark.mark.centerX,
        y: mark.mark.centerY,
        idx: mark.idx,
        panelIndex,
        questionNumber,
      })
    }
    gd.questionDiagnostics.push({
      panelIndex,
      questionNumber,
      rowIndexWithinPanel,
      expectedLogicalRow: rowIndexWithinPanel,
      expectedPhysicalRow: physicalRowIndexExpected,
      expectedPhysicalY,
      observedDetectionY: rowCenterY,
      nearestPhysicalRows: nearestPhysicalRows.map((r) => ({ rowIndex: r.rowIndex, centerY: r.centerY, dy: r.dy })),
      verticalResidual: rowCenterY - expectedPhysicalY,
      rowBandAccepted,
      rowBandRejectedReason,
      driftApplied,
      physicalGapDetected,
      expectedCenterByOption: centers.map((x, i) => ({ column: letter(i), x, y: calibratedExpectedY })),
      detectedCenters: bucket.map((m) => ({ idx: m.idx, x: m.mark.centerX, y: m.mark.centerY, confidence: m.mark.confidence, state: m.mark.state })),
      rowSnapped: rowSnap.index,
      rowDelta,
      rowDistanceToExpected,
      rowDistanceToSnapped,
      nearestCandidates: nearestCandidates.map((c) => ({
        detectionIdx: c.detectionIdx,
        optionIdx: c.optionIdx,
        dx: c.dx,
        dy: c.dy,
        distanceScore: c.finalCandidateScore,
        confidence: c.confidence,
        rowSnapped: c.rowSnapped,
        reason: c.reason,
      })),
      candidateScores: nearestCandidates.map((c) => ({
        detectionIdx: c.detectionIdx,
        optionIdx: c.optionIdx,
        finalCandidateScore: c.finalCandidateScore,
        columnDistanceScore: c.columnDistanceScore,
        rowDistanceScore: c.rowDistanceScore,
        fillConfidenceScore: c.fillConfidenceScore,
        bandPenaltyScore: c.bandPenaltyScore,
        neighborConflictPenalty: c.neighborConflictPenalty,
        bandPenaltyApplied: c.bandPenaltyApplied,
        bandPenaltyValue: c.bandPenaltyValue,
        hardRejectedByBand: c.hardRejectedByBand,
      })),
      selectedCandidateScore: chosen?.score ?? null,
      rejectedCandidateScores: candidateTrace
        .filter((c) => c.reason !== "ACCEPTED")
        .sort((a, b) => a.finalCandidateScore - b.finalCandidateScore)
        .slice(0, 8)
        .map((c) => ({
          detectionIdx: c.detectionIdx,
          optionIdx: c.optionIdx,
          finalCandidateScore: c.finalCandidateScore,
          reason: c.reason,
        })),
      ambiguityResolutionTriggered,
      ambiguityWinnerMargin: winnerMargin,
      resolvedAmbiguity: ambiguityResolutionAccepted,
      ambiguityResolutionReason,
      safeToMaterializeDespiteAmbiguity,
      materializedDespiteAmbiguity,
      bandPenaltyApplied: anyBandPenaltyApplied,
      hardRejectedByBand: anyHardRejectedByBand,
      candidateRankings: rankedCandidates.slice(0, 8).map((r) => ({
        rank: r.rank,
        detectionIdx: r.candidate.idx,
        optionIdx: r.optionIdx,
        finalCandidateScore: r.candidate.score,
      })),
      candidateConflictReason:
        nearestCandidates.find((c) => c.reason !== "ACCEPTED")?.reason ?? (rowBandAccepted ? null : rowBandRejectedReason),
      finalAssignmentReason:
        selectedAnswer === "BLANK"
          ? explicitFinalNullificationReason === "INTERLEAVED_TIGHT_WINNER_MARGIN"
            ? "INTERLEAVED_TIGHT_WINNER_MARGIN"
            : ambiguityResolutionTriggered && !ambiguityResolutionAccepted
              ? "ROW_AMBIGUOUS_WITHOUT_CLEAR_WINNER"
              : anyHardRejectedByBand
                ? "NO_VALID_CANDIDATE_IN_PHYSICAL_ROW_BAND"
                : "NO_VALID_CANDIDATE_AFTER_SOFT_BAND_PENALTY"
          : chosen?.state === "selected"
            ? ambiguityResolutionTriggered && ambiguityResolutionAccepted
              ? "SELECTED_MARK_RESOLVED_FROM_ROW_AMBIGUITY"
              : "SELECTED_MARK_WITH_BEST_COMPOSITE_SCORE"
            : "HIGH_CONFIDENCE_FALLBACK_WITH_COMPOSITE_SCORE",
      selectedAnswer,
      selectedDetectionIdx: chosen?.idx ?? null,
      blankReason:
        selectedAnswer === "BLANK"
          ? explicitFinalNullificationReason === "INTERLEAVED_TIGHT_WINNER_MARGIN"
            ? "TIGHT_WINNER_MARGIN_AWAITING_CLASSIC_OR_BLANK"
            : ambiguityResolutionTriggered && !ambiguityResolutionAccepted
              ? "ROW_AMBIGUOUS_WITHOUT_STABLE_MARGIN"
              : anyHardRejectedByBand
                ? "ALL_CANDIDATES_REJECTED_BY_EXTREME_BAND_DISTANCE"
                : "NO_ACCEPTED_CANDIDATE_AFTER_SOFT_PHYSICAL_BAND_PENALTY"
          : null,
      interleavedAmbiguityTelemetry,
      interleavedTightMarginResolution,
    })
  }
  const verticalOrderingSuspicious = Math.abs(rowIndexWithinPanel - questionNumber + 1) > 2
  return {
    questionNumber,
    panelIndex,
    rowIndexWithinPanel,
    rowCenterY,
    selectedAnswer,
    assignedDetectionIndices: chosen ? [chosen.idx] : [],
    confidencesByColumn,
    observedFromSensors: bucket.length > 0,
    materializedDespiteAmbiguity,
    interleavedPipeline: true,
    interleavedAmbiguityTelemetry,
    ...(interleavedTightMarginResolution ? { interleavedTightMarginResolution } : {}),
    ...(interleavedTightMarginResolution ? { interleavedReviewRecommended: true } : {}),
    verticalOrderingTelemetry: {
      rowIndexWithinPanel,
      rowCenterY,
      physicalRowIndexExpected,
      snappedRowIndex: rowSnap.index,
      snappedAmbiguous: rowSnap.ambiguous,
      rowDistanceToExpected,
      rowDistanceToSnapped,
      verticalOrderingSuspicious,
    },
  }
}

export type Tier = { y: number; left?: IndexedMark[]; right?: IndexedMark[] }

export function pairLeftRightRowsIntoTiers(
  leftRows: IndexedMark[][],
  rightRows: IndexedMark[][],
  yThreshold = 0.024,
): Tier[] {
  let yTh = yThreshold
  if (leftRows.length === 1 && rightRows.length === 1) {
    const dyCenters = Math.abs(meanY(leftRows[0]!) - meanY(rightRows[0]!))
    // Una fila por lado: bandHeight≈pitch y effectivePairingYThreshold(h)=min(0.024,h·0.25)
    // puede quedar estrictamente por debajo de |ΔY| entre centros, bloqueando el único par posible.
    yTh = Math.max(yTh, dyCenters + 1e-6)
  }
  const usedR = new Set<number>()
  const tiers: Tier[] = []
  const leftSorted = [...leftRows].sort((a, b) => meanY(a) - meanY(b))
  for (const lrow of leftSorted) {
    const yl = meanY(lrow)
    let bestJ = -1
    let bestDy = Number.POSITIVE_INFINITY
    for (let j = 0; j < rightRows.length; j++) {
      if (usedR.has(j)) continue
      const yr = meanY(rightRows[j]!)
      const dy = Math.abs(yl - yr)
      if (dy < bestDy && dy < yTh) {
        bestDy = dy
        bestJ = j
      }
    }
    const tier: Tier = { y: yl, left: lrow }
    if (bestJ >= 0) {
      tier.right = rightRows[bestJ]
      tier.y = (yl + meanY(rightRows[bestJ]!)) / 2
      usedR.add(bestJ)
    }
    tiers.push(tier)
  }
  for (let j = 0; j < rightRows.length; j++) {
    if (usedR.has(j)) continue
    tiers.push({ y: meanY(rightRows[j]!), right: rightRows[j] })
  }
  tiers.sort((a, b) => a.y - b.y)
  return tiers
}

function applyInterleavedQuestionRebuild(params: {
  decoded: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  ocrHits: OcrNumberHit[]
  hybridTopology: HybridSlotTopology | null | undefined
  sortOrder: RebuildQuestionSortOrder
  debugAcc?: InterleavedPipelineDebugAcc
}): Array<Record<string, unknown>> {
  const topo = params.hybridTopology
  if (topo?.hasInterleavedDevelopment) {
    return rebuildHybridClosedAssignment({
      decoded: params.decoded,
      closedQuestionIds: params.closedQuestionIds,
      topology: topo,
      ocrHits: params.ocrHits,
      sortOrder: params.sortOrder,
    })
  }
  return rebuildQuestionSequence({
    decoded: params.decoded,
    closedQuestionIds: params.closedQuestionIds,
    ocrHits: params.ocrHits,
    sortOrder: params.sortOrder,
    onTrace: params.debugAcc ? (e) => params.debugAcc!.rebuildTrace.push(e) : undefined,
  })
}

function parseSlotFromClosedId(id: string): number | null {
  const u = id.toUpperCase()
  const m = u.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Impar/par clásico: emparejamiento izq/der por bandas verticales compartidas (huecos = desarrollo). */
export function mapInterleavedOddEvenDualColumn(params: {
  items: IndexedMark[]
  closedQuestionIds: string[]
  expectedOptionCount: number
  ocrHits: OcrNumberHit[]
  debugAcc?: InterleavedPipelineDebugAcc
  hybridTopology?: HybridSlotTopology | null
  forensics?: InterleavedPipelineForensicSession
}): Array<Record<string, unknown>> {
  const splitX = 0.5
  const { items, closedQuestionIds, expectedOptionCount, ocrHits, debugAcc, forensics } = params
  const leftItems = items.filter((it) => it.mark.centerX <= splitX)
  const rightItems = items.filter((it) => it.mark.centerX > splitX)
  if (forensics) {
    forensics.recordStage("panels_segmented", {
      inputCount: items.length,
      outputCount: leftItems.length + rightItems.length,
      droppedCount: Math.max(0, items.length - leftItems.length - rightItems.length),
      collapsed: leftItems.length + rightItems.length === 0,
      collapseReason: leftItems.length + rightItems.length === 0 ? "no_items_after_panel_split" : null,
      invariantViolations: [],
    })
  }
  const leftRows = clusterRowsByYIndexed(leftItems)
  const rightRows = clusterRowsByYIndexed(rightItems)
  const leftModel = buildPanelGeometryModel({
    panelIndex: 0,
    rows: leftRows,
    panelItems: leftItems,
    expectedOptionCount,
  })
  const rightModel = buildPanelGeometryModel({
    panelIndex: 1,
    rows: rightRows,
    panelItems: rightItems,
    expectedOptionCount,
  })
  if (forensics) {
    const rowClusters = leftRows.length + rightRows.length
    forensics.clustersBeforeCollapse = rowClusters
    forensics.clustersAfterCollapse = rowClusters
    forensics.recordStage("clustered", {
      inputCount: leftItems.length + rightItems.length,
      outputCount: rowClusters,
      droppedCount: Math.max(0, leftItems.length + rightItems.length - rowClusters),
      collapsed: rowClusters === 0,
      collapseReason: rowClusters === 0 ? "zero_row_clusters_after_y_grouping" : null,
      invariantViolations: [],
    })
    const geomOk =
      leftModel.expectedColumnCenters.length > 0 && rightModel.expectedColumnCenters.length > 0
    forensics.recordStage("geometry_normalized", {
      inputCount: 2,
      outputCount: geomOk
        ? 2
        : leftModel.expectedColumnCenters.length > 0 || rightModel.expectedColumnCenters.length > 0
          ? 1
          : 0,
      droppedCount: geomOk ? 0 : 1,
      collapsed: !geomOk,
      collapseReason: !geomOk ? "panel_geometry_model_degenerate" : null,
      invariantViolations: [],
    })
  }
  if (debugAcc) {
    const gd = ensureGeometryDiagnostics(debugAcc)
    gd.pipelineStageCounters.survivedClustering += leftRows.reduce((s, r) => s + r.length, 0)
    gd.pipelineStageCounters.survivedClustering += rightRows.reduce((s, r) => s + r.length, 0)
    recordPanelColumnDiagnostics({
      debugAcc,
      panelIndex: 0,
      panelItems: leftItems,
      rows: leftRows,
      model: leftModel,
      expectedOptionCount,
    })
    recordPanelColumnDiagnostics({
      debugAcc,
      panelIndex: 1,
      panelItems: rightItems,
      rows: rightRows,
      model: rightModel,
      expectedOptionCount,
    })
    recordRawDetectionDiagnostics({ debugAcc, panelIndex: 0, panelItems: leftItems, model: leftModel })
    recordRawDetectionDiagnostics({ debugAcc, panelIndex: 1, panelItems: rightItems, model: rightModel })
  }
  const bands = partitionLeftRightRowsBySharedVerticalBands(leftRows, rightRows)
  if (debugAcc) {
    debugAcc.bands = summarizeSharedVerticalBands(bands)
  }
  const tiersAcc: Tier[] = []
  let tierIndexGlobal = 0
  for (const band of bands) {
    const h = bandVerticalSpan(band.yMin, band.yMax)
    const yTh = effectivePairingYThreshold(h)
    const tiers = pairLeftRightRowsIntoTiers(band.leftRows, band.rightRows, yTh)
    for (const t of tiers) {
      if (debugAcc) {
        debugAcc.pairings.push({
          bandIndex: band.blockIndex,
          tierIndexGlobal,
          rowCenterY: t.y,
          leftPresent: !!t.left,
          rightPresent: !!t.right,
          leftOrphan: !!t.left && !t.right,
          rightOrphan: !!t.right && !t.left,
        })
      }
      tierIndexGlobal++
      tiersAcc.push(t)
    }
  }
  tiersAcc.sort((a, b) => a.y - b.y)
  const out: Array<Record<string, unknown>> = []
  let rowIndexWithinPanel = 0
  let nextSeq = 1
  const used = new Set<number>()
  const maxDyOcr = 0.045

  // FIX: Emit each panel's rows sorted by ACTUAL panel Y (not averaged tier Y)
  // to guarantee visualIndex matches physical vertical order within each panel.
  const leftRowsInYOrder = tiersAcc.filter((t) => t.left).map((t) => t.left!).sort((a, b) => meanY(a) - meanY(b))
  const rightRowsInYOrder = tiersAcc.filter((t) => t.right).map((t) => t.right!).sort((a, b) => meanY(a) - meanY(b))

  let visualLeft = 0
  let visualRight = 0
  let previousAssignedLeft: number | null = null
  let previousAssignedRight: number | null = null
  const emitRow = (row: IndexedMark[], panelIndex: 0 | 1) => {
    const y = meanY(row)
    const ocr = nearestOcrNumberForRow({
      hits: ocrHits,
      rowCenterY: y,
      panel: panelIndex === 0 ? "left" : "right",
      maxDy: maxDyOcr,
    })
    let qn = nextSeq
    if (ocr != null) {
      const idx = closedQuestionIds.findIndex((id) => parseSlotFromClosedId(id) === ocr)
      if (idx >= 0) {
        const cand = idx + 1
        if (!used.has(cand) && cand >= nextSeq - 1 && cand <= nextSeq + 2) qn = cand
      }
    }
    while (used.has(qn)) qn++
    used.add(qn)
    nextSeq = Math.max(nextSeq, qn + 1)
    const visualIndex = panelIndex === 0 ? visualLeft : visualRight
    const model = panelIndex === 0 ? leftModel : rightModel
    const previousAssigned = panelIndex === 0 ? previousAssignedLeft : previousAssignedRight
    const resolvedRowIndexWithinPanel = resolveOddEvenRowIndexWithContinuity({
      row,
      model,
      visualIndex,
      previousAssignedRowIndex: previousAssigned,
    })
    if (panelIndex === 0) {
      previousAssignedLeft = resolvedRowIndexWithinPanel
      visualLeft++
    } else {
      previousAssignedRight = resolvedRowIndexWithinPanel
      visualRight++
    }

    if (debugAcc) {
      const verticalSuspicious = Math.abs(resolvedRowIndexWithinPanel - visualIndex) > 2
      if (!debugAcc.verticalOrderingTrace) debugAcc.verticalOrderingTrace = []
      debugAcc.verticalOrderingTrace.push({
        questionNumber: qn,
        panelIndex,
        physicalIndex: qn,
        rowIndexWithinPanel: resolvedRowIndexWithinPanel,
        visualIndex,
        rowCenterY: y,
        previousAssigned,
        verticalOrderingSuspicious: verticalSuspicious,
      })
      if (verticalSuspicious) {
        if (!debugAcc.verticalOrderingWarnings) debugAcc.verticalOrderingWarnings = []
        debugAcc.verticalOrderingWarnings.push(
          `Q${qn} panel=${panelIndex}: rowIndexWithinPanel=${resolvedRowIndexWithinPanel} vs visualIndex=${visualIndex} (drift=${resolvedRowIndexWithinPanel - visualIndex})`,
        )
      }
    }

    out.push(
      decodeBubbleRow({
        row,
        questionNumber: qn,
        panelIndex,
        rowIndexWithinPanel: resolvedRowIndexWithinPanel,
        splitX,
        expectedOptionCount,
        model,
        debugAcc,
      }),
    )
    rowIndexWithinPanel++
  }

  // Interleave left/right by actual row Y for question numbering, but each panel
  // tracks its own visual index independently and in correct Y order.
  const allRowEntries: Array<{ row: IndexedMark[]; panel: 0 | 1; panelYRank: number }> = [
    ...leftRowsInYOrder.map((row, i) => ({ row, panel: 0 as const, panelYRank: i })),
    ...rightRowsInYOrder.map((row, i) => ({ row, panel: 1 as const, panelYRank: i })),
  ]
  allRowEntries.sort((a, b) => meanY(a.row) - meanY(b.row))
  for (const entry of allRowEntries) {
    emitRow(entry.row, entry.panel)
  }

  if (forensics) {
    const mappedIn = tiersAcc.length
    forensics.recordStage("mapped", {
      inputCount: mappedIn,
      outputCount: out.length,
      droppedCount: Math.max(0, mappedIn - out.length),
      collapsed: out.length === 0,
      collapseReason: out.length === 0 ? "decode_emitted_zero_rows_pre_rebuild" : null,
      invariantViolations: [],
    })
  }

  const rebuilt = applyInterleavedQuestionRebuild({
    decoded: out,
    closedQuestionIds,
    ocrHits,
    hybridTopology: params.hybridTopology,
    sortOrder: "y_then_panel",
    debugAcc,
  })
  if (forensics) {
    forensics.recordStage("rebuilt", {
      inputCount: out.length,
      outputCount: rebuilt.length,
      droppedCount: Math.max(0, out.length - rebuilt.length),
      collapsed: rebuilt.length === 0,
      collapseReason: rebuilt.length === 0 ? "rebuild_produced_zero_rows" : null,
      invariantViolations: [],
    })
  }
  if (debugAcc?.geometryDiagnostics) {
    const deltas = debugAcc.geometryDiagnostics.rowVerticalDelta
    const colErr = debugAcc.geometryDiagnostics.expectedBubbleCenters
      .map((c) => {
        const det = debugAcc.geometryDiagnostics!.detectedBubbleCenters
          .filter((d) => d.panelIndex === c.panelIndex && d.questionNumber === c.questionNumber)
          .sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0]
        return det ? Math.abs(det.x - c.x) : 0
      })
      .filter((v) => Number.isFinite(v))
    debugAcc.geometryDiagnostics.xOffsetEstimated = (leftModel.xOffsetEstimated + rightModel.xOffsetEstimated) / 2
    debugAcc.geometryDiagnostics.yOffsetEstimated = (leftModel.yOffsetEstimated + rightModel.yOffsetEstimated) / 2
    debugAcc.geometryDiagnostics.averageRowError = deltas.length
      ? deltas.reduce((s, d) => s + Math.abs(d.delta), 0) / deltas.length
      : 0
    debugAcc.geometryDiagnostics.averageColumnError = colErr.length
      ? colErr.reduce((s, v) => s + v, 0) / colErr.length
      : 0
  }
  return rebuilt.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))
}

/** Secuencial en dos columnas: bloques Y independientes por columna (reinicio de escala local entre gaps). */
export function mapInterleavedSequentialDualColumn(params: {
  items: IndexedMark[]
  closedQuestionIds: string[]
  expectedOptionCount: number
  ocrHits: OcrNumberHit[]
  debugAcc?: InterleavedPipelineDebugAcc
  hybridTopology?: HybridSlotTopology | null
  forensics?: InterleavedPipelineForensicSession
}): Array<Record<string, unknown>> {
  const splitX = 0.5
  const { items, closedQuestionIds, expectedOptionCount, ocrHits, debugAcc, forensics } = params
  const leftItems = items.filter((it) => it.mark.centerX <= splitX)
  const rightItems = items.filter((it) => it.mark.centerX > splitX)
  if (forensics) {
    forensics.recordStage("panels_segmented", {
      inputCount: items.length,
      outputCount: leftItems.length + rightItems.length,
      droppedCount: Math.max(0, items.length - leftItems.length - rightItems.length),
      collapsed: leftItems.length + rightItems.length === 0,
      collapseReason: leftItems.length + rightItems.length === 0 ? "no_items_after_panel_split" : null,
      invariantViolations: [],
    })
  }
  const leftRows = clusterRowsByYIndexed(leftItems)
  const rightRows = clusterRowsByYIndexed(rightItems)
  const leftModel = buildPanelGeometryModel({
    panelIndex: 0,
    rows: leftRows,
    panelItems: leftItems,
    expectedOptionCount,
  })
  const rightModel = buildPanelGeometryModel({
    panelIndex: 1,
    rows: rightRows,
    panelItems: rightItems,
    expectedOptionCount,
  })
  if (forensics) {
    const rowClusters = leftRows.length + rightRows.length
    forensics.clustersBeforeCollapse = rowClusters
    forensics.clustersAfterCollapse = rowClusters
    forensics.recordStage("clustered", {
      inputCount: leftItems.length + rightItems.length,
      outputCount: rowClusters,
      droppedCount: Math.max(0, leftItems.length + rightItems.length - rowClusters),
      collapsed: rowClusters === 0,
      collapseReason: rowClusters === 0 ? "zero_row_clusters_after_y_grouping" : null,
      invariantViolations: [],
    })
    const geomOk =
      leftModel.expectedColumnCenters.length > 0 && rightModel.expectedColumnCenters.length > 0
    forensics.recordStage("geometry_normalized", {
      inputCount: 2,
      outputCount: geomOk ? 2 : leftModel.expectedColumnCenters.length > 0 || rightModel.expectedColumnCenters.length > 0 ? 1 : 0,
      droppedCount: geomOk ? 0 : 1,
      collapsed: !geomOk,
      collapseReason: !geomOk ? "panel_geometry_model_degenerate" : null,
      invariantViolations: [],
    })
  }
  if (debugAcc) {
    const gd = ensureGeometryDiagnostics(debugAcc)
    gd.pipelineStageCounters.survivedClustering += leftRows.reduce((s, r) => s + r.length, 0)
    gd.pipelineStageCounters.survivedClustering += rightRows.reduce((s, r) => s + r.length, 0)
    recordPanelColumnDiagnostics({
      debugAcc,
      panelIndex: 0,
      panelItems: leftItems,
      rows: leftRows,
      model: leftModel,
      expectedOptionCount,
    })
    recordPanelColumnDiagnostics({
      debugAcc,
      panelIndex: 1,
      panelItems: rightItems,
      rows: rightRows,
      model: rightModel,
      expectedOptionCount,
    })
    recordRawDetectionDiagnostics({ debugAcc, panelIndex: 0, panelItems: leftItems, model: leftModel })
    recordRawDetectionDiagnostics({ debugAcc, panelIndex: 1, panelItems: rightItems, model: rightModel })
  }
  const leftCount = Math.ceil(closedQuestionIds.length / 2)

  if (debugAcc) {
    const ly = leftRows.map((r) => meanY(r))
    const ry = rightRows.map((r) => meanY(r))
    debugAcc.bands = [
      {
        bandIndex: 0,
        yMin: ly.length ? Math.min(...ly) : 0,
        yMax: ly.length ? Math.max(...ly) : 0,
        leftRowCount: leftRows.length,
        rightRowCount: 0,
      },
      {
        bandIndex: 1,
        yMin: ry.length ? Math.min(...ry) : 0,
        yMax: ry.length ? Math.max(...ry) : 0,
        leftRowCount: 0,
        rightRowCount: rightRows.length,
      },
    ]
    debugAcc.pairings = []
  }

  const out: Array<Record<string, unknown>> = []
  let rowIndexWithinPanel = 0
  const used = new Set<number>()
  const maxDyOcr = 0.045

  const emitNumbered = (row: IndexedMark[], panelIndex: 0 | 1, qnBase: number) => {
    const y = meanY(row)
    const ocr = nearestOcrNumberForRow({
      hits: ocrHits,
      rowCenterY: y,
      panel: panelIndex === 0 ? "left" : "right",
      maxDy: maxDyOcr,
    })
    let qn = qnBase
    if (ocr != null) {
      const idx = closedQuestionIds.findIndex((id) => parseSlotFromClosedId(id) === ocr)
      if (idx >= 0) {
        const cand = idx + 1
        if (!used.has(cand) && Math.abs(cand - qnBase) <= 2) qn = cand
      }
    }
    while (used.has(qn)) qn++
    used.add(qn)
    out.push(
      decodeBubbleRow({
        row,
        questionNumber: qn,
        panelIndex,
        rowIndexWithinPanel: panelIndex === 0 ? li - 1 : ri - 1,
        splitX,
        expectedOptionCount,
        model: panelIndex === 0 ? leftModel : rightModel,
        debugAcc,
      }),
    )
    rowIndexWithinPanel++
  }

  const leftSorted = [...leftRows].sort((a, b) => meanY(a) - meanY(b))
  let li = 0
  for (const row of leftSorted) {
    li++
    emitNumbered(row, 0, li)
  }

  const rightSorted = [...rightRows].sort((a, b) => meanY(a) - meanY(b))
  let ri = 0
  for (const row of rightSorted) {
    ri++
    emitNumbered(row, 1, leftCount + ri)
  }

  if (forensics) {
    forensics.recordStage("mapped", {
      inputCount: leftSorted.length + rightSorted.length,
      outputCount: out.length,
      droppedCount: Math.max(0, leftSorted.length + rightSorted.length - out.length),
      collapsed: out.length === 0,
      collapseReason: out.length === 0 ? "decode_emitted_zero_rows_pre_rebuild" : null,
      invariantViolations: [],
    })
  }

  const rebuilt = applyInterleavedQuestionRebuild({
    decoded: out,
    closedQuestionIds,
    ocrHits,
    hybridTopology: params.hybridTopology,
    sortOrder: "panel_then_y",
    debugAcc,
  })
  if (forensics) {
    forensics.recordStage("rebuilt", {
      inputCount: out.length,
      outputCount: rebuilt.length,
      droppedCount: Math.max(0, out.length - rebuilt.length),
      collapsed: rebuilt.length === 0,
      collapseReason: rebuilt.length === 0 ? "rebuild_produced_zero_rows" : null,
      invariantViolations: [],
    })
  }
  return rebuilt.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))
}

export function mapInterleavedSingleColumn(params: {
  items: IndexedMark[]
  closedQuestionIds: string[]
  expectedOptionCount: number
  ocrHits: OcrNumberHit[]
  debugAcc?: InterleavedPipelineDebugAcc
  hybridTopology?: HybridSlotTopology | null
  forensics?: InterleavedPipelineForensicSession
}): Array<Record<string, unknown>> {
  const { forensics } = params
  if (forensics) {
    forensics.recordStage("panels_segmented", {
      inputCount: params.items.length,
      outputCount: params.items.length,
      droppedCount: 0,
      collapsed: params.items.length === 0,
      collapseReason: params.items.length === 0 ? "no_items_single_column" : null,
      invariantViolations: [],
    })
  }
  const rows = clusterRowsByYIndexed(params.items)
  const singleModel = buildPanelGeometryModel({
    panelIndex: 0,
    rows,
    panelItems: params.items,
    expectedOptionCount: params.expectedOptionCount,
  })
  if (forensics) {
    const rowClusters = rows.length
    forensics.clustersBeforeCollapse = rowClusters
    forensics.clustersAfterCollapse = rowClusters
    forensics.recordStage("clustered", {
      inputCount: params.items.length,
      outputCount: rowClusters,
      droppedCount: Math.max(0, params.items.length - rowClusters),
      collapsed: rowClusters === 0,
      collapseReason: rowClusters === 0 ? "zero_row_clusters_single_column" : null,
      invariantViolations: [],
    })
    const geomOk = singleModel.expectedColumnCenters.length > 0
    forensics.recordStage("geometry_normalized", {
      inputCount: 1,
      outputCount: geomOk ? 1 : 0,
      droppedCount: geomOk ? 0 : 1,
      collapsed: !geomOk,
      collapseReason: !geomOk ? "panel_geometry_model_degenerate" : null,
      invariantViolations: [],
    })
  }
  if (params.debugAcc) {
    const gd = ensureGeometryDiagnostics(params.debugAcc)
    gd.pipelineStageCounters.survivedClustering += rows.reduce((s, r) => s + r.length, 0)
    recordPanelColumnDiagnostics({
      debugAcc: params.debugAcc,
      panelIndex: 0,
      panelItems: params.items,
      rows,
      model: singleModel,
      expectedOptionCount: params.expectedOptionCount,
    })
    recordRawDetectionDiagnostics({
      debugAcc: params.debugAcc,
      panelIndex: 0,
      panelItems: params.items,
      model: singleModel,
    })
  }
  const blocks = segmentRowClustersByVerticalGap(rows)
  if (params.debugAcc) {
    params.debugAcc.bands = summarizeSingleColumnGapBlocks(blocks)
    params.debugAcc.pairings = []
  }
  const out: Array<Record<string, unknown>> = []
  let rowIndexWithinPanel = 0
  let ci = 0
  const used = new Set<number>()
  const maxDyOcr = 0.045
  const splitX = 0.5

  for (const block of blocks) {
    const sorted = [...block].sort((a, b) => meanY(a) - meanY(b))
    for (const row of sorted) {
      ci++
      if (ci > params.closedQuestionIds.length) break
      const qnBase = ci
      const y = meanY(row)
      const ocr = nearestOcrNumberForRow({
        hits: params.ocrHits,
        rowCenterY: y,
        panel: "left",
        maxDy: maxDyOcr,
      })
      let qn = qnBase
      if (ocr != null) {
        const idx = params.closedQuestionIds.findIndex((id) => parseSlotFromClosedId(id) === ocr)
        if (idx >= 0) {
          const cand = idx + 1
          if (!used.has(cand) && Math.abs(cand - qnBase) <= 2) qn = cand
        }
      }
      while (used.has(qn)) qn++
      used.add(qn)
      out.push(
        decodeBubbleRow({
          row,
          questionNumber: qn,
          panelIndex: 0,
          rowIndexWithinPanel: ci - 1,
          splitX,
          expectedOptionCount: params.expectedOptionCount,
          model: singleModel,
          debugAcc: params.debugAcc,
        }),
      )
      rowIndexWithinPanel++
    }
  }
  if (forensics) {
    forensics.recordStage("mapped", {
      inputCount: rows.length,
      outputCount: out.length,
      droppedCount: Math.max(0, rows.length - out.length),
      collapsed: out.length === 0,
      collapseReason: out.length === 0 ? "decode_emitted_zero_rows_pre_rebuild" : null,
      invariantViolations: [],
    })
  }
  const rebuilt = applyInterleavedQuestionRebuild({
    decoded: out,
    closedQuestionIds: params.closedQuestionIds,
    ocrHits: params.ocrHits,
    hybridTopology: params.hybridTopology,
    sortOrder: "y_then_panel",
    debugAcc: params.debugAcc,
  })
  if (forensics) {
    forensics.recordStage("rebuilt", {
      inputCount: out.length,
      outputCount: rebuilt.length,
      droppedCount: Math.max(0, out.length - rebuilt.length),
      collapsed: rebuilt.length === 0,
      collapseReason: rebuilt.length === 0 ? "rebuild_produced_zero_rows" : null,
      invariantViolations: [],
    })
  }
  return rebuilt.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))
}

export function mapInterleavedByVariant(params: {
  variant: OmrTemplateVariantInterleaved
  items: IndexedMark[]
  closedQuestionIds: string[]
  expectedOptionCount: number
  ocrHits: OcrNumberHit[]
  debugAcc?: InterleavedPipelineDebugAcc
  hybridTopology?: HybridSlotTopology | null
  forensics?: InterleavedPipelineForensicSession
}): Array<Record<string, unknown>> {
  const { variant, items, closedQuestionIds, expectedOptionCount, ocrHits, debugAcc, forensics } = params
  if (variant === "single_column") {
    return mapInterleavedSingleColumn({
      items,
      closedQuestionIds,
      expectedOptionCount,
      ocrHits,
      debugAcc,
      hybridTopology: params.hybridTopology,
      forensics,
    })
  }
  if (variant === "sequential_dual_column") {
    return mapInterleavedSequentialDualColumn({
      items,
      closedQuestionIds,
      expectedOptionCount,
      ocrHits,
      debugAcc,
      hybridTopology: params.hybridTopology,
      forensics,
    })
  }
  return mapInterleavedOddEvenDualColumn({
    items,
    closedQuestionIds,
    expectedOptionCount,
    ocrHits,
    debugAcc,
    hybridTopology: params.hybridTopology,
    forensics,
  })
}
