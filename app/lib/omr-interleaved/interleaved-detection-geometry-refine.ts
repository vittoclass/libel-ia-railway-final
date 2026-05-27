/**
 * Refinamiento universal marca→fila (solo pipeline interleaved).
 * Reagrupa detecciones por compatibilidad física antes de re-ejecutar decodeBubbleRow,
 * con rollback si falla validateHybridPostMapPhysicalIntegrity.
 * No toca OMR clásico ni azure-layout-omr-pipeline.
 */
import type { HybridSlotTopology } from "./hybrid-slot-topology"
import { getOmrSlotsInPhysicalOrder } from "./hybrid-slot-topology"
import type { IndexedMark } from "./types"
import { buildPanelGeometryModel, clusterRowsByYIndexed, decodeBubbleRow, meanY } from "./cluster-and-decode"
import { validateHybridPostMapPhysicalIntegrity } from "./hybrid-physical-integrity"
import { isInterleavedDetectionGeometryRefineEnabled, isInterleavedDetectionGeometryRefineConservativeEnabled, isInterleavedCanonicalGeometryGuardEnabled, isInterleavedColumnGeometryValidationEnabled } from "./env"
import { nearestOcrNumberForRow, type OcrNumberHit } from "./ocr-question-numbers"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"

const SPLIT_X = 0.5

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

export type GeometryRebuildSkippedReason =
  | "empty_kmeans_cluster"
  | "degenerate_column_centers"
  | "insufficient_column_marks"

const MIN_COLUMN_CENTER_GAP = 0.008

export type Kmeans1dValidatedResult = {
  centers: number[]
  valid: boolean
  skipReason?: GeometryRebuildSkippedReason
}

function kmeans1dValidated(values: number[], k: number): Kmeans1dValidatedResult {
  if (k <= 0 || !values.length) {
    return { centers: [], valid: false, skipReason: "insufficient_column_marks" }
  }
  if (values.length < k) {
    return { centers: [], valid: false, skipReason: "insufficient_column_marks" }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const centers = Array.from({ length: k }, (_, i) => {
    const idx = Math.min(sorted.length - 1, Math.floor(((i + 0.5) / k) * sorted.length))
    return sorted[idx]!
  })

  for (let iter = 0; iter < 10; iter++) {
    const buckets: number[][] = Array.from({ length: k }, () => [])
    for (const v of sorted) {
      let best = 0
      let dist = Number.POSITIVE_INFINITY
      for (let i = 0; i < k; i++) {
        const d = Math.abs(v - (centers[i] ?? v))
        if (d < dist) {
          dist = d
          best = i
        }
      }
      buckets[best]!.push(v)
    }
    for (let i = 0; i < k; i++) {
      const b = buckets[i]!
      if (b.length === 0) {
        return { centers: [], valid: false, skipReason: "empty_kmeans_cluster" }
      }
      centers[i] = b.reduce((s, v) => s + v, 0) / b.length
    }
  }

  const ordered = [...centers].sort((a, b) => a - b)
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]! - ordered[i - 1]! < MIN_COLUMN_CENTER_GAP) {
      return { centers: [], valid: false, skipReason: "degenerate_column_centers" }
    }
  }
  return { centers: ordered, valid: true }
}

/** Centros por cuantiles — fallback cuando k-means es inválido (sin [0,0,...]). */
function quantileSpreadColumnCenters(values: number[], k: number): number[] {
  if (!values.length || k <= 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  if (max - min < MIN_COLUMN_CENTER_GAP) return []
  return Array.from({ length: k }, (_, i) => min + ((i + 0.5) / k) * (max - min))
}

function resolvePanelColumnCenters(params: {
  panelMarks: IndexedMark[]
  expectedOptionCount: number
  priorCenters?: number[]
}): {
  centers: number[]
  geometrySource: string
  geometryRebuildSkippedReason?: GeometryRebuildSkippedReason
} {
  const { panelMarks, expectedOptionCount, priorCenters } = params
  const xs = panelMarks.map((m) => m.mark.centerX).filter((x) => Number.isFinite(x))

  if (priorCenters && priorCenters.length === expectedOptionCount) {
    const orderedPrior = [...priorCenters].sort((a, b) => a - b)
    let priorOk = true
    for (let i = 1; i < orderedPrior.length; i++) {
      if (orderedPrior[i]! - orderedPrior[i - 1]! < MIN_COLUMN_CENTER_GAP) {
        priorOk = false
        break
      }
    }
    const nearZeroCount = orderedPrior.filter((c) => Math.abs(c) < 1e-5).length
    if (priorOk && nearZeroCount < 2) {
      return { centers: orderedPrior, geometrySource: "descriptor_prior_centers" }
    }
  }

  const kmeans = kmeans1dValidated(xs, expectedOptionCount)
  if (kmeans.valid && kmeans.centers.length === expectedOptionCount) {
    return { centers: kmeans.centers, geometrySource: "kmeans_panel_rebuild" }
  }

  const quantile = quantileSpreadColumnCenters(xs, expectedOptionCount)
  if (quantile.length === expectedOptionCount) {
    return {
      centers: quantile,
      geometrySource: "quantile_panel_fallback",
      geometryRebuildSkippedReason: kmeans.skipReason,
    }
  }

  return {
    centers: [],
    geometrySource: "geometry_unavailable",
    geometryRebuildSkippedReason: kmeans.skipReason ?? "insufficient_column_marks",
  }
}

function nearestCenterIndex(x: number, centers: number[]): number {
  let best = 0
  let dist = Number.POSITIVE_INFINITY
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(x - (centers[i] ?? x))
    if (d < dist) {
      dist = d
      best = i
    }
  }
  return best
}

function bboxOverlapHeight(
  poly: Array<{ x: number; y: number }>,
  y0: number,
  y1: number,
): number {
  if (!poly.length) return 0
  const ys = poly.map((p) => p.y)
  const a0 = Math.min(...ys)
  const a1 = Math.max(...ys)
  const lo = Math.max(a0, Math.min(y0, y1))
  const hi = Math.min(a1, Math.max(y0, y1))
  return Math.max(0, hi - lo)
}

function shallowCloneRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((r) => ({ ...r }))
}

function mergeDecodedPreserveHybrid(base: Record<string, unknown>, decoded: Record<string, unknown>): Record<string, unknown> {
  const stickyKeys = [
    "physicalIndex",
    "canonicalId",
    "hybridOmrParticipation",
    "hybridOcrNumericHintMismatch",
    "hybridAssignmentFailure",
    "inferredBlank",
    "completedByExpectation",
  ] as const
  const out: Record<string, unknown> = { ...decoded }
  out.questionNumber = base.questionNumber
  for (const k of stickyKeys) {
    if (k in base && base[k] !== undefined) out[k] = base[k]
  }
  return out
}

function panelSide(panelIndex: 0 | 1): "left" | "right" {
  return panelIndex === 1 ? "right" : "left"
}

const CONSERVATIVE_WINNER_MARGIN_THRESHOLD = 0.07

/**
 * Determina si una pregunta ya tiene detección confiable y NO debe ser
 * alterada por el refinamiento geométrico.
 *
 * Protegida = todas estas condiciones se cumplen:
 *  1. Tiene al menos una detección asignada
 *  2. No hubo resolución de ambigüedad
 *  3. No hay mismatch con OCR numérico
 *  4. No tiene tight margin pendiente
 *  5. El margen ganador (si existe) supera el umbral
 */
function isSlotProtectedFromRefine(row: Record<string, unknown>): boolean {
  const assigned = row.assignedDetectionIndices
  if (!Array.isArray(assigned) || assigned.length === 0) return false

  if (row.ambiguityResolutionReason != null) return false

  if (row.hybridOcrNumericHintMismatch === true) return false

  const tightMargin = row.interleavedTightMarginResolution as Record<string, unknown> | null | undefined
  if (tightMargin && tightMargin.pendingClassicBridge === true) return false

  const margin = Number(row.ambiguityWinnerMargin ?? NaN)
  if (Number.isFinite(margin) && margin < CONSERVATIVE_WINNER_MARGIN_THRESHOLD) return false

  return true
}

function refineOnePanel(params: {
  panelIndex: 0 | 1
  slotsSorted: Record<string, unknown>[]
  panelItems: IndexedMark[]
  closedQuestionIds: string[]
  expectedOptionCount: number
  ocrHits: OcrNumberHit[]
}): Record<string, unknown>[] {
  const { panelIndex, slotsSorted, panelItems, closedQuestionIds, expectedOptionCount, ocrHits } = params
  const K = slotsSorted.length
  if (K === 0) return []

  const rawYs = slotsSorted
    .map((s) => Number(s.rowCenterY))
    .filter((y) => Number.isFinite(y) && y > 0)
  const fallbackY = rawYs.length ? median(rawYs) : 0.5
  const anchors: number[] = slotsSorted.map((s) => {
    const y = Number(s.rowCenterY)
    return Number.isFinite(y) && y > 0 ? y : fallbackY
  })

  const ySteps: number[] = []
  for (let i = 1; i < anchors.length; i++) {
    const d = Math.abs(anchors[i]! - anchors[i - 1]!)
    if (d > 1e-6) ySteps.push(d)
  }
  const yScale = Math.max(0.012, median(ySteps.length ? ySteps : [0.02]))

  const modelRows = clusterRowsByYIndexed(panelItems)
  const model = buildPanelGeometryModel({
    panelIndex,
    rows: modelRows,
    panelItems,
    expectedOptionCount,
  })

  const colResolved = resolvePanelColumnCenters({
    panelMarks: panelItems,
    expectedOptionCount,
    priorCenters:
      model.expectedColumnCenters.length === expectedOptionCount
        ? model.expectedColumnCenters
        : undefined,
  })
  const colCenters =
    colResolved.centers.length === expectedOptionCount
      ? colResolved.centers
      : model.expectedColumnCenters.length === expectedOptionCount
        ? model.expectedColumnCenters
        : colResolved.centers
  const colSteps: number[] = []
  for (let i = 1; i < colCenters.length; i++) {
    const d = Math.abs(colCenters[i]! - colCenters[i - 1]!)
    if (d > 1e-6) colSteps.push(d)
  }
  const xScale = Math.max(0.012, median(colSteps.length ? colSteps : [0.03]))

  let buckets: IndexedMark[][] = Array.from({ length: K }, () => [])

  const iterations = 4
  for (let it = 0; it < iterations; it++) {
    buckets = Array.from({ length: K }, () => [])
    for (const m of panelItems) {
      const mx = m.mark.centerX
      const my = m.mark.centerY
      const colIdx = nearestCenterIndex(mx, colCenters)
      let bestI = 0
      let bestCost = Number.POSITIVE_INFINITY
      for (let i = 0; i < K; i++) {
        const dy = Math.abs(my - anchors[i]!) / yScale
        const dx = Math.abs(mx - (colCenters[colIdx] ?? mx)) / xScale
        let cost = dy + dx * 0.34

        const stripHalf = yScale * 0.52
        const ov = bboxOverlapHeight(m.mark.polygonNorm, anchors[i]! - stripHalf, anchors[i]! + stripHalf)
        if (ov > 1e-6) cost -= Math.min(0.14, (ov / Math.max(1e-6, stripHalf * 2)) * 0.12)

        const qn = Number(slotsSorted[i]!.questionNumber ?? 0)
        if (
          ocrHits.length > 0 &&
          m.mark.state === "selected" &&
          m.mark.confidence >= 0.55 &&
          Number.isFinite(qn) &&
          qn >= 1 &&
          qn <= closedQuestionIds.length
        ) {
          const rowY = (my + anchors[i]!) * 0.5
          const ocr = nearestOcrNumberForRow({
            hits: ocrHits,
            rowCenterY: rowY,
            panel: panelSide(panelIndex),
            maxDy: 0.058,
          })
          const idRaw = String(closedQuestionIds[qn - 1] ?? "")
          const expectedNum = parseClosedIdNumericSlot(idRaw)
          if (ocr != null && expectedNum != null && ocr === expectedNum) cost -= 0.022
        }

        if (cost < bestCost) {
          bestCost = cost
          bestI = i
        }
      }
      buckets[bestI]!.push(m)
    }

    const ranked = buckets.map((b, slotIdx) => ({
      b,
      my: b.length ? meanY(b) : anchors[slotIdx]!,
      slotIdx,
    }))
    ranked.sort((a, b) => a.my - b.my)

    for (let j = 0; j < K; j++) anchors[j] = ranked[j]!.my

    buckets = ranked.map((r) => r.b)
  }

  const out: Record<string, unknown>[] = []
  for (let j = 0; j < K; j++) {
    const meta = slotsSorted[j]!
    const row = buckets[j] ?? []
    const decoded = decodeBubbleRow({
      row,
      questionNumber: Number(meta.questionNumber ?? 0),
      panelIndex,
      rowIndexWithinPanel: Number(meta.rowIndexWithinPanel ?? j),
      splitX: SPLIT_X,
      expectedOptionCount,
      model,
      debugAcc: undefined,
    })
    out.push(mergeDecodedPreserveHybrid(meta, decoded))
  }
  return out
}

/**
 * Construye lookups estables para matching de parches refinados
 * contra filas base, priorizando canonicalId sobre physicalIndex.
 */
function buildStablePatchLookup(refinedRows: Record<string, unknown>[]) {
  const byCanonicalId = new Map<string, Record<string, unknown>>()
  const byPhysicalIndex = new Map<number, Record<string, unknown>>()

  for (const row of refinedRows ?? []) {
    if (row?.canonicalId != null) {
      byCanonicalId.set(String(row.canonicalId), row)
    }
    if (typeof row?.physicalIndex === "number") {
      byPhysicalIndex.set(row.physicalIndex as number, row)
    }
  }

  return { byCanonicalId, byPhysicalIndex }
}

export type InterleavedDetectionGeometryRefineTelemetry = {
  interleavedDetectionGeometryRefineApplied: boolean
  interleavedDetectionGeometryRefineRollback: boolean
  interleavedDetectionGeometryRefinePanelsProcessed: number
  interleavedDetectionGeometryRefineConservativeEnabled?: boolean
  interleavedDetectionGeometryRefineProtectedCount?: number
  interleavedDetectionGeometryRefineRefinedCount?: number
  interleavedDetectionGeometryRefineProtectedQuestions?: number[]
}

export function applyInterleavedDetectionGeometryRefine(params: {
  perQuestion: Array<Record<string, unknown>>
  indexedMarks: IndexedMark[]
  topology: HybridSlotTopology
  closedQuestionIds: string[]
  expectedOptionCount: number
  ocrHits: OcrNumberHit[]
  strictHybridPostMap: boolean
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: InterleavedDetectionGeometryRefineTelemetry
} {
  const emptyTelemetry: InterleavedDetectionGeometryRefineTelemetry = {
    interleavedDetectionGeometryRefineApplied: false,
    interleavedDetectionGeometryRefineRollback: false,
    interleavedDetectionGeometryRefinePanelsProcessed: 0,
  }

  const { perQuestion, indexedMarks, topology, closedQuestionIds, expectedOptionCount, ocrHits, strictHybridPostMap } =
    params

  if (!isInterleavedDetectionGeometryRefineEnabled() || !perQuestion.length || !indexedMarks.length) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  const nClosed = topology.closedOmrQuestionCount
  if (perQuestion.length !== nClosed || closedQuestionIds.length !== nClosed) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  const before = shallowCloneRows(perQuestion)
  const byQ = new Map<number, Record<string, unknown>>()
  for (const r of perQuestion) {
    const qn = Number(r.questionNumber ?? 0)
    if (Number.isFinite(qn) && qn >= 1) byQ.set(qn, r)
  }
  if (byQ.size !== nClosed) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  let panelsProcessed = 0
  const rebuiltByQ = new Map<number, Record<string, unknown>>()

  for (const panelIndex of [0, 1] as const) {
    const slots = [...perQuestion].filter((r) => (Number(r.panelIndex ?? 0) === 1 ? 1 : 0) === panelIndex)
    if (!slots.length) continue
    slots.sort((a, b) => Number(a.rowIndexWithinPanel ?? 0) - Number(b.rowIndexWithinPanel ?? 0))
    const panelItems = indexedMarks.filter((it) =>
      panelIndex === 0 ? it.mark.centerX <= SPLIT_X : it.mark.centerX > SPLIT_X,
    )
    if (!panelItems.length) continue

    const refined = refineOnePanel({
      panelIndex,
      slotsSorted: slots,
      panelItems,
      closedQuestionIds,
      expectedOptionCount,
      ocrHits,
    })
    if (refined.length !== slots.length) continue
    panelsProcessed++
    for (const row of refined) {
      const qn = Number(row.questionNumber ?? 0)
      if (Number.isFinite(qn) && qn >= 1) rebuiltByQ.set(qn, row)
    }
  }

  if (!panelsProcessed || rebuiltByQ.size === 0) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  const conservativeEnabled = isInterleavedDetectionGeometryRefineConservativeEnabled()
  const protectedQuestions: number[] = []
  let refinedCount = 0

  const refinedArray = Array.from(rebuiltByQ.values())
  const lookup = buildStablePatchLookup(refinedArray)

  const candidate: Array<Record<string, unknown>> = []
  for (const base of perQuestion) {
    const qn = Number(base.questionNumber ?? 0)

    if (conservativeEnabled && isSlotProtectedFromRefine(base)) {
      candidate.push(base)
      if (Number.isFinite(qn) && qn >= 1) protectedQuestions.push(qn)
      continue
    }

    let patch: Record<string, unknown> | undefined

    if (base.canonicalId != null && lookup.byCanonicalId.has(String(base.canonicalId))) {
      patch = lookup.byCanonicalId.get(String(base.canonicalId))
    } else if (
      typeof base.physicalIndex === "number" &&
      lookup.byPhysicalIndex.has(base.physicalIndex as number)
    ) {
      patch = lookup.byPhysicalIndex.get(base.physicalIndex as number)
    }

    if (!patch) {
      candidate.push(base)
      continue
    }

    candidate.push({
      ...base,
      ...patch,
      questionNumber: base.questionNumber,
      canonicalId: base.canonicalId,
      physicalIndex: base.physicalIndex,
      panelIndex: base.panelIndex,
      rowIndexWithinPanel: base.rowIndexWithinPanel,
    })
    refinedCount++
  }

  for (const merged of candidate) {
    if (merged.canonicalId == null) continue
    const original = perQuestion.find((r) => r.canonicalId === merged.canonicalId)
    if (!original || merged.canonicalId !== original.canonicalId) {
      throw new Error(
        `REGLA_DE_ORO_VIOLATION: canonicalId altered (${merged.canonicalId})`
      )
    }
  }

  if (candidate.length !== nClosed) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  candidate.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))

  const post = validateHybridPostMapPhysicalIntegrity({
    perQuestion: candidate,
    topology,
    closedQuestionIds,
    strictHybrid: strictHybridPostMap,
  })

  if (!post.ok) {
    return {
      perQuestion: before,
      telemetry: {
        interleavedDetectionGeometryRefineApplied: false,
        interleavedDetectionGeometryRefineRollback: true,
        interleavedDetectionGeometryRefinePanelsProcessed: panelsProcessed,
        interleavedDetectionGeometryRefineConservativeEnabled: conservativeEnabled,
        interleavedDetectionGeometryRefineProtectedCount: protectedQuestions.length,
        interleavedDetectionGeometryRefineRefinedCount: refinedCount,
        interleavedDetectionGeometryRefineProtectedQuestions: protectedQuestions,
      },
    }
  }

  return {
    perQuestion: candidate,
    telemetry: {
      interleavedDetectionGeometryRefineApplied: true,
      interleavedDetectionGeometryRefineRollback: false,
      interleavedDetectionGeometryRefinePanelsProcessed: panelsProcessed,
      interleavedDetectionGeometryRefineConservativeEnabled: conservativeEnabled,
      interleavedDetectionGeometryRefineProtectedCount: protectedQuestions.length,
      interleavedDetectionGeometryRefineRefinedCount: refinedCount,
      interleavedDetectionGeometryRefineProtectedQuestions: protectedQuestions,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Geometry Guard — validación Y-order vs physicalIndex-order por panel
// Solo pipeline interleaved. Feature flag: INTERLEAVED_CANONICAL_GEOMETRY_GUARD
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalGeometryGuardMismatch = {
  panelIndex: number
  expectedRowIndex: number
  actualRowIndex: number
  canonicalId: string
  canonicalIdAfter: string
  physicalIndex: number
  physicalIndexAfter: number
  rowCenterY: number
  geometryMismatch: true
  geometryMismatchDistance: number
  geometryGuardTriggered: true
  geometryReassignmentApplied: boolean
}

export type CanonicalGeometryGuardTelemetry = {
  canonicalGeometryGuardEnabled: boolean
  canonicalGeometryGuardApplied: boolean
  canonicalGeometryGuardRollback: boolean
  canonicalGeometryGuardMismatchCount: number
  canonicalGeometryGuardMismatches?: CanonicalGeometryGuardMismatch[]
}

export function applyCanonicalGeometryGuard(params: {
  perQuestion: Array<Record<string, unknown>>
  topology: HybridSlotTopology
  closedQuestionIds: string[]
  strictHybridPostMap: boolean
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: CanonicalGeometryGuardTelemetry
} {
  const emptyTelemetry: CanonicalGeometryGuardTelemetry = {
    canonicalGeometryGuardEnabled: false,
    canonicalGeometryGuardApplied: false,
    canonicalGeometryGuardRollback: false,
    canonicalGeometryGuardMismatchCount: 0,
  }

  if (!isInterleavedCanonicalGeometryGuardEnabled()) {
    return { perQuestion: params.perQuestion, telemetry: emptyTelemetry }
  }
  emptyTelemetry.canonicalGeometryGuardEnabled = true

  const { perQuestion, topology, closedQuestionIds, strictHybridPostMap } = params
  const nClosed = topology.closedOmrQuestionCount
  if (perQuestion.length !== nClosed || closedQuestionIds.length !== nClosed) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  const omrSlots = getOmrSlotsInPhysicalOrder(topology)
  const slotByCanonical = new Map<string, (typeof omrSlots)[number]>()
  for (const s of omrSlots) slotByCanonical.set(s.canonicalId, s)

  const panels = new Map<number, Array<{ globalIdx: number; row: Record<string, unknown> }>>()
  for (let i = 0; i < perQuestion.length; i++) {
    const row = perQuestion[i]!
    const p = Number(row.panelIndex ?? 0) === 1 ? 1 : 0
    if (!panels.has(p)) panels.set(p, [])
    panels.get(p)!.push({ globalIdx: i, row })
  }

  const allMismatches: CanonicalGeometryGuardMismatch[] = []
  const before = shallowCloneRows(perQuestion)
  const candidate = perQuestion.map((r) => ({ ...r }))
  let anyReassignment = false

  for (const [panelIndex, entries] of panels) {
    const rowsByY = [...entries].sort((a, b) => {
      const ya = Number(a.row.rowCenterY ?? 0)
      const yb = Number(b.row.rowCenterY ?? 0)
      return ya - yb
    })

    const panelCanonicals = rowsByY
      .map((e) => String(e.row.canonicalId ?? ""))
      .filter(Boolean)
    if (panelCanonicals.length !== rowsByY.length) continue

    const panelSlotDescs = panelCanonicals
      .map((cid) => slotByCanonical.get(cid))
      .filter((s): s is NonNullable<typeof s> => s != null)
    if (panelSlotDescs.length !== rowsByY.length) continue

    const expectedOrder = [...panelSlotDescs].sort(
      (a, b) => a.physicalIndex - b.physicalIndex,
    )

    let panelHasMismatch = false
    for (let j = 0; j < rowsByY.length; j++) {
      const currentCid = panelCanonicals[j]!
      const expectedCid = expectedOrder[j]!.canonicalId
      if (currentCid !== expectedCid) {
        panelHasMismatch = true
        break
      }
    }
    if (!panelHasMismatch) continue

    for (let j = 0; j < rowsByY.length; j++) {
      const entry = rowsByY[j]!
      const currentCid = String(entry.row.canonicalId ?? "")
      const expectedSlot = expectedOrder[j]!
      const expectedCid = expectedSlot.canonicalId

      if (currentCid === expectedCid) continue

      const currentSlot = slotByCanonical.get(currentCid)
      const actualIdxInExpected = expectedOrder.findIndex(
        (s) => s.canonicalId === currentCid,
      )
      const numericId = parseClosedIdNumericSlot(expectedCid)
      if (numericId == null || numericId < 1) continue

      const mismatchDistance = Math.abs(j - actualIdxInExpected)

      allMismatches.push({
        panelIndex,
        expectedRowIndex: j,
        actualRowIndex: actualIdxInExpected,
        canonicalId: currentCid,
        canonicalIdAfter: expectedCid,
        physicalIndex: currentSlot?.physicalIndex ?? 0,
        physicalIndexAfter: expectedSlot.physicalIndex,
        rowCenterY: Number(entry.row.rowCenterY ?? 0),
        geometryMismatch: true,
        geometryMismatchDistance: mismatchDistance,
        geometryGuardTriggered: true,
        geometryReassignmentApplied: true,
      })

      candidate[entry.globalIdx] = {
        ...candidate[entry.globalIdx],
        canonicalId: expectedCid,
        physicalIndex: numericId,
        questionNumber: numericId,
        rowIndexWithinPanel: j,
      }
      anyReassignment = true
    }
  }

  if (!anyReassignment) {
    return {
      perQuestion,
      telemetry: {
        ...emptyTelemetry,
        canonicalGeometryGuardMismatchCount: 0,
      },
    }
  }

  console.log(
    "[omr-interleaved][canonical-geometry-guard] mismatches detected",
    JSON.stringify(
      allMismatches.map((m) => ({
        panel: m.panelIndex,
        expectedRow: m.expectedRowIndex,
        actualRow: m.actualRowIndex,
        cidBefore: m.canonicalId,
        cidAfter: m.canonicalIdAfter,
        physBefore: m.physicalIndex,
        physAfter: m.physicalIndexAfter,
        y: Number(m.rowCenterY.toFixed(5)),
        dist: m.geometryMismatchDistance,
      })),
    ),
  )

  candidate.sort(
    (a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0),
  )

  const post = validateHybridPostMapPhysicalIntegrity({
    perQuestion: candidate,
    topology,
    closedQuestionIds,
    strictHybrid: strictHybridPostMap,
  })

  if (!post.ok) {
    console.log(
      "[omr-interleaved][canonical-geometry-guard] rollback — post-map validation failed",
      post.ok === false ? post.error : "",
    )
    for (const m of allMismatches) m.geometryReassignmentApplied = false
    return {
      perQuestion: before,
      telemetry: {
        canonicalGeometryGuardEnabled: true,
        canonicalGeometryGuardApplied: false,
        canonicalGeometryGuardRollback: true,
        canonicalGeometryGuardMismatchCount: allMismatches.length,
        canonicalGeometryGuardMismatches: allMismatches,
      },
    }
  }

  console.log(
    `[omr-interleaved][canonical-geometry-guard] applied — ${allMismatches.length} reassignments`,
  )

  return {
    perQuestion: candidate,
    telemetry: {
      canonicalGeometryGuardEnabled: true,
      canonicalGeometryGuardApplied: true,
      canonicalGeometryGuardRollback: false,
      canonicalGeometryGuardMismatchCount: allMismatches.length,
      canonicalGeometryGuardMismatches: allMismatches,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Column Geometry Validation — verifica selectedAnswer vs columna geométrica
// real de la marca seleccionada. Feature flag: INTERLEAVED_COLUMN_GEOMETRY_VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function letterForColumn(i: number): string {
  return ["A", "B", "C", "D", "E", "F", "G", "H"][i] ?? "?"
}

function columnIndexForLetter(letter: string): number {
  const idx = "ABCDEFGH".indexOf(letter.toUpperCase())
  return idx >= 0 ? idx : -1
}

export type InterleavedColumnGeometryRowDiagnostic = {
  panelIndex: number
  rowIndexWithinPanel: number
  rowCenterY: number
  physicalIndex: number
  canonicalId: string
  selectedAnswer: string
  selectedMarkX: number | null
  selectedMarkY: number | null
  selectedOptionIndex: number | null
  expectedColumnCenters: number[]
  nearestColumnByX: number | null
  nearestColumnLetterByX: string | null
  selectedAnswerMatchesNearestColumn: boolean | null
  assignedDetectionIndices: number[]
  geometrySource: string
  geometryRebuildSkippedReason?: GeometryRebuildSkippedReason
  decisionSource: string
}

export type InterleavedColumnGeometryValidationTelemetry = {
  interleavedColumnGeometryValidationEnabled: boolean
  interleavedColumnGeometryValidationApplied: boolean
  interleavedColumnGeometryValidationRollback: boolean
  interleavedColumnGeometryMismatchCount: number
  interleavedColumnGeometryCorrectedCount: number
  interleavedColumnGeometryTelemetryRows: InterleavedColumnGeometryRowDiagnostic[]
}

function extractPriorPanelCenters(
  perQuestion: Array<Record<string, unknown>>,
  panelIndex: number,
  expectedOptionCount: number,
): number[] | undefined {
  for (const row of perQuestion) {
    const p = Number(row.panelIndex ?? 0) === 1 ? 1 : 0
    if (p !== panelIndex) continue
    const diag = row.interleavedColumnGeometryDiagnostic as Record<string, unknown> | undefined
    const raw = diag?.expectedColumnCenters ?? diag?.columnCenters
    if (!Array.isArray(raw)) continue
    const centers = (raw as unknown[]).filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    if (centers.length !== expectedOptionCount) continue
    const ordered = [...centers].sort((a, b) => a - b)
    let ok = true
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i]! - ordered[i - 1]! < MIN_COLUMN_CENTER_GAP) {
        ok = false
        break
      }
    }
    if (ok) return ordered
  }
  return undefined
}

export function applyInterleavedColumnGeometryValidation(params: {
  perQuestion: Array<Record<string, unknown>>
  indexedMarks: IndexedMark[]
  expectedOptionCount: number
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: InterleavedColumnGeometryValidationTelemetry
} {
  const emptyTelemetry: InterleavedColumnGeometryValidationTelemetry = {
    interleavedColumnGeometryValidationEnabled: false,
    interleavedColumnGeometryValidationApplied: false,
    interleavedColumnGeometryValidationRollback: false,
    interleavedColumnGeometryMismatchCount: 0,
    interleavedColumnGeometryCorrectedCount: 0,
    interleavedColumnGeometryTelemetryRows: [],
  }

  if (!isInterleavedColumnGeometryValidationEnabled()) {
    return { perQuestion: params.perQuestion, telemetry: emptyTelemetry }
  }
  emptyTelemetry.interleavedColumnGeometryValidationEnabled = true

  const { perQuestion, indexedMarks, expectedOptionCount } = params

  if (!perQuestion.length || !indexedMarks.length) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  const markByIdx = new Map<number, IndexedMark>()
  for (const m of indexedMarks) markByIdx.set(m.idx, m)

  const leftMarks = indexedMarks.filter((m) => m.mark.centerX <= SPLIT_X)
  const rightMarks = indexedMarks.filter((m) => m.mark.centerX > SPLIT_X)

  const priorLeftCenters = extractPriorPanelCenters(perQuestion, 0, expectedOptionCount)
  const priorRightCenters = extractPriorPanelCenters(perQuestion, 1, expectedOptionCount)

  const leftResolved = resolvePanelColumnCenters({
    panelMarks: leftMarks,
    expectedOptionCount,
    priorCenters: priorLeftCenters,
  })
  const rightResolved = resolvePanelColumnCenters({
    panelMarks: rightMarks,
    expectedOptionCount,
    priorCenters: priorRightCenters,
  })
  const leftCenters = leftResolved.centers
  const rightCenters = rightResolved.centers
  const panelGeometryMeta = new Map<number, { geometrySource: string; geometryRebuildSkippedReason?: GeometryRebuildSkippedReason }>()
  panelGeometryMeta.set(0, {
    geometrySource: leftResolved.geometrySource,
    geometryRebuildSkippedReason: leftResolved.geometryRebuildSkippedReason,
  })
  panelGeometryMeta.set(1, {
    geometrySource: rightResolved.geometrySource,
    geometryRebuildSkippedReason: rightResolved.geometryRebuildSkippedReason,
  })

  const before = shallowCloneRows(perQuestion)
  const candidate = perQuestion.map((r) => ({ ...r }))
  const telemetryRows: InterleavedColumnGeometryRowDiagnostic[] = []
  let mismatchCount = 0
  let correctedCount = 0

  for (let i = 0; i < candidate.length; i++) {
    const row = candidate[i]!
    const panelIndex = Number(row.panelIndex ?? 0) === 1 ? 1 : 0
    const centers = panelIndex === 1 ? rightCenters : leftCenters
    const assigned = Array.isArray(row.assignedDetectionIndices)
      ? (row.assignedDetectionIndices as number[])
      : []
    const selectedAnswer = String(row.selectedAnswer ?? "").trim().toUpperCase()
    const ambTelemetry = row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined
    const decisionSource = String(ambTelemetry?.decisionSource ?? "unknown")
    const tightMarginResolution = row.interleavedTightMarginResolution as Record<string, unknown> | undefined
    const substitutedFromClassic = tightMarginResolution?.substitutedFromClassic === true
    const completedByExpectation = row.completedByExpectation === true
    const inferredBlank = row.inferredBlank === true

    let selectedMarkX: number | null = null
    let selectedMarkY: number | null = null
    let nearestColumnByX: number | null = null
    let nearestColumnLetterByX: string | null = null
    let selectedOptionIndex: number | null = null
    let matches: boolean | null = null

    const isActionable =
      assigned.length > 0 &&
      centers.length === expectedOptionCount &&
      selectedAnswer.length === 1 &&
      /^[A-Z]$/.test(selectedAnswer) &&
      !substitutedFromClassic &&
      !completedByExpectation &&
      !inferredBlank

    if (isActionable) {
      const mark = markByIdx.get(assigned[0]!)
      if (mark) {
        selectedMarkX = mark.mark.centerX
        selectedMarkY = mark.mark.centerY
        selectedOptionIndex = columnIndexForLetter(selectedAnswer)

        let bestCol = 0
        let bestDist = Number.POSITIVE_INFINITY
        for (let c = 0; c < centers.length; c++) {
          const d = Math.abs(mark.mark.centerX - (centers[c] ?? 0))
          if (d < bestDist) {
            bestDist = d
            bestCol = c
          }
        }
        nearestColumnByX = bestCol
        nearestColumnLetterByX = letterForColumn(bestCol)
        matches = selectedAnswer === nearestColumnLetterByX

        if (!matches) {
          mismatchCount++
          row.interleavedColumnMappingMismatch = true
          row.interleavedColumnMappingMismatchFrom = selectedAnswer
          row.interleavedColumnMappingMismatchTo = nearestColumnLetterByX
          row.selectedAnswer = nearestColumnLetterByX
          correctedCount++
          console.log(
            `[omr-interleaved][column-geometry-validation] mismatch Q${row.questionNumber} panel=${panelIndex}: ` +
              `selectedAnswer=${selectedAnswer} nearestColumnByX=${nearestColumnLetterByX} ` +
              `markX=${selectedMarkX?.toFixed(5)} centers=[${centers.map((c) => c.toFixed(4)).join(",")}]`,
          )
        }
      }
    }

    const panelMeta = panelGeometryMeta.get(panelIndex) ?? {
      geometrySource: centers.length === expectedOptionCount ? "kmeans_panel_rebuild" : "geometry_unavailable",
    }

    telemetryRows.push({
      panelIndex,
      rowIndexWithinPanel: Number(row.rowIndexWithinPanel ?? 0),
      rowCenterY: Number(row.rowCenterY ?? 0),
      physicalIndex: Number(row.physicalIndex ?? 0),
      canonicalId: String(row.canonicalId ?? ""),
      selectedAnswer: String(row.selectedAnswer ?? ""),
      selectedMarkX,
      selectedMarkY,
      selectedOptionIndex,
      expectedColumnCenters: centers,
      nearestColumnByX,
      nearestColumnLetterByX,
      selectedAnswerMatchesNearestColumn: matches,
      assignedDetectionIndices: assigned,
      geometrySource: panelMeta.geometrySource,
      geometryRebuildSkippedReason: panelMeta.geometryRebuildSkippedReason,
      decisionSource,
    })
  }

  if (correctedCount > 0) {
    console.log(
      `[omr-interleaved][column-geometry-validation] corrected ${correctedCount} of ${mismatchCount} mismatches`,
    )
  }

  if (mismatchCount === 0) {
    for (let i = 0; i < candidate.length; i++) {
      candidate[i]!.interleavedColumnGeometryDiagnostic = telemetryRows[i]
    }
    return {
      perQuestion: candidate,
      telemetry: {
        interleavedColumnGeometryValidationEnabled: true,
        interleavedColumnGeometryValidationApplied: false,
        interleavedColumnGeometryValidationRollback: false,
        interleavedColumnGeometryMismatchCount: 0,
        interleavedColumnGeometryCorrectedCount: 0,
        interleavedColumnGeometryTelemetryRows: telemetryRows,
      },
    }
  }

  for (let i = 0; i < candidate.length; i++) {
    candidate[i]!.interleavedColumnGeometryDiagnostic = telemetryRows[i]
  }

  return {
    perQuestion: candidate,
    telemetry: {
      interleavedColumnGeometryValidationEnabled: true,
      interleavedColumnGeometryValidationApplied: correctedCount > 0,
      interleavedColumnGeometryValidationRollback: false,
      interleavedColumnGeometryMismatchCount: mismatchCount,
      interleavedColumnGeometryCorrectedCount: correctedCount,
      interleavedColumnGeometryTelemetryRows: telemetryRows,
    },
  }
}
