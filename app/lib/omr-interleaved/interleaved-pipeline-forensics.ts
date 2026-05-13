/**
 * Traza forense universal del pipeline OMR interleaved (solo diagnóstico / control de fallback).
 * No altera scoring ni OMR clásico.
 */
import type { HybridSlotTopology } from "./hybrid-slot-topology"
import { getOmrSlotsInPhysicalOrder } from "./hybrid-slot-topology"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"

export type InterleavedForensicStageId =
  | "image_loaded"
  | "anchors_detected"
  | "panels_segmented"
  | "geometry_normalized"
  | "candidate_bubbles_detected"
  | "clustered"
  | "mapped"
  | "rebuilt"
  | "ambiguity_resolved"
  | "materialized"
  | "finalized"
  | "hybrid_map_zero_rows_fallback"
  | "hybrid_strict_fallback"

export type InterleavedForensicInvariantViolation = {
  invariant: string
  detail: string
  questionNumber?: number
}

export type InterleavedForensicStageRecord = {
  stage: InterleavedForensicStageId
  inputCount: number
  outputCount: number
  droppedCount: number
  collapsed: boolean
  collapseReason: string | null
  invariantViolations: InterleavedForensicInvariantViolation[]
  durationMs?: number
}

export type InterleavedStructuralIntegrityStatus =
  | "full_valid"
  | "partial_recovered"
  | "invalid_empty"
  | "invalid_inconsistent"

export type InterleavedPipelineForensicReport = {
  stages: InterleavedForensicStageRecord[]
  firstFailedStage: InterleavedForensicStageId | null
  collapseStage: InterleavedForensicStageId | null
  collapseReason: string | null
  collapseDiagnostics: string[]
  rowsBeforeCollapse: number | null
  rowsAfterCollapse: number | null
  clustersBeforeCollapse: number | null
  clustersAfterCollapse: number | null
  materializedRows: number | null
  ambiguityRejectedRows: number | null
  structuralIntegrityStatus: InterleavedStructuralIntegrityStatus
  fallbackTriggerStage: InterleavedForensicStageId | null
  fallbackTriggerReason: string | null
  partialStructuralSurvivalApplied: boolean
  partialStructuralSurvivalReason: string | null
}

type StageMetrics = {
  inputCount: number
  outputCount: number
  droppedCount: number
  collapsed: boolean
  collapseReason: string | null
  invariantViolations: InterleavedForensicInvariantViolation[]
}

function normId(id: string): string {
  return String(id ?? "").trim()
}

function canonicalNumericId(canonicalId: string): number | null {
  return parseClosedIdNumericSlot(canonicalId)
}

export class InterleavedPipelineForensicSession {
  readonly stages: InterleavedForensicStageRecord[] = []
  private t0 = 0
  partialStructuralSurvivalApplied = false
  partialStructuralSurvivalReason: string | null = null
  rowsBeforeCollapse: number | null = null
  rowsAfterCollapse: number | null = null
  clustersBeforeCollapse: number | null = null
  clustersAfterCollapse: number | null = null
  materializedRows: number | null = null
  ambiguityRejectedRows: number | null = null
  structuralIntegrityStatus: InterleavedStructuralIntegrityStatus = "invalid_empty"
  fallbackTriggerStage: InterleavedForensicStageId | null = null
  fallbackTriggerReason: string | null = null

  startTimer(): void {
    this.t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
  }

  private elapsedMs(): number | undefined {
    const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
    const d = t1 - this.t0
    return Number.isFinite(d) && d >= 0 ? d : undefined
  }

  recordStage(stage: InterleavedForensicStageId, metrics: StageMetrics): void {
    const rec: InterleavedForensicStageRecord = {
      stage,
      inputCount: metrics.inputCount,
      outputCount: metrics.outputCount,
      droppedCount: metrics.droppedCount,
      collapsed: metrics.collapsed,
      collapseReason: metrics.collapseReason,
      invariantViolations: [...metrics.invariantViolations],
      durationMs: this.elapsedMs(),
    }
    this.stages.push(rec)
    this.startTimer()
  }

  finalizeReport(params: {
    firstFailedStage: InterleavedForensicStageId | null
    collapseStage: InterleavedForensicStageId | null
    collapseReason: string | null
    collapseDiagnostics: string[]
    structuralIntegrityStatus: InterleavedStructuralIntegrityStatus
  }): InterleavedPipelineForensicReport {
    return {
      stages: [...this.stages],
      firstFailedStage: params.firstFailedStage,
      collapseStage: params.collapseStage,
      collapseReason: params.collapseReason,
      collapseDiagnostics: [...params.collapseDiagnostics],
      rowsBeforeCollapse: this.rowsBeforeCollapse,
      rowsAfterCollapse: this.rowsAfterCollapse,
      clustersBeforeCollapse: this.clustersBeforeCollapse,
      clustersAfterCollapse: this.clustersAfterCollapse,
      materializedRows: this.materializedRows,
      ambiguityRejectedRows: this.ambiguityRejectedRows,
      structuralIntegrityStatus: params.structuralIntegrityStatus,
      fallbackTriggerStage: this.fallbackTriggerStage,
      fallbackTriggerReason: this.fallbackTriggerReason,
      partialStructuralSurvivalApplied: this.partialStructuralSurvivalApplied,
      partialStructuralSurvivalReason: this.partialStructuralSurvivalReason,
    }
  }
}

export function createInterleavedForensicSession(): InterleavedPipelineForensicSession {
  const s = new InterleavedPipelineForensicSession()
  s.startTimer()
  return s
}

/** Primera etapa con colapso explícito o salida vacía con entrada positiva (heurística universal). */
export function deriveCollapseFromStages(stages: InterleavedForensicStageRecord[]): {
  firstFailedStage: InterleavedForensicStageId | null
  collapseStage: InterleavedForensicStageId | null
  collapseReason: string | null
  diagnostics: string[]
} {
  const diagnostics: string[] = []
  let firstFailed: InterleavedForensicStageId | null = null
  let collapseStage: InterleavedForensicStageId | null = null
  let collapseReason: string | null = null

  const criticalEmpty: InterleavedForensicStageId[] = [
    "candidate_bubbles_detected",
    "clustered",
    "mapped",
    "rebuilt",
    "materialized",
  ]

  for (const s of stages) {
    if (s.collapsed && s.collapseReason) {
      if (!firstFailed) firstFailed = s.stage
      if (!collapseStage) {
        collapseStage = s.stage
        collapseReason = s.collapseReason
      }
      diagnostics.push(`${s.stage}: ${s.collapseReason}`)
    }
    if (
      criticalEmpty.includes(s.stage) &&
      s.inputCount > 0 &&
      s.outputCount === 0 &&
      !s.collapsed
    ) {
      const msg = `${s.stage}: salida_vacia_con_entrada_positiva (in=${s.inputCount})`
      diagnostics.push(msg)
      if (!firstFailed) firstFailed = s.stage
      if (!collapseStage) {
        collapseStage = s.stage
        collapseReason = "empty_output_with_positive_input"
      }
    }
  }
  return { firstFailedStage: firstFailed, collapseStage, collapseReason, diagnostics }
}

type ForensicDebugAccShape = {
  geometryDiagnostics?: {
    questionAssemblyDiagnostics?: Array<{
      finalMaterializationFailure?: boolean
      explicitFinalNullificationReason?: string | null
    }>
  }
}

export function countAmbiguityRejectedFromDebugAcc(acc: ForensicDebugAccShape | undefined): number {
  const qa = acc?.geometryDiagnostics?.questionAssemblyDiagnostics
  if (!qa?.length) return 0
  let n = 0
  for (const q of qa) {
    if (q.finalMaterializationFailure === true) n++
    else if (q.explicitFinalNullificationReason) n++
  }
  return n
}

export function countMaterializedFromPerQuestion(
  rows: Array<Record<string, unknown>>,
): number {
  if (!rows.length) return 0
  let n = 0
  for (const row of rows) {
    const sel = String(row?.selectedAnswer ?? "").trim().toUpperCase()
    if (sel && sel !== "BLANK" && sel !== "SIN_RESPUESTA" && sel !== "MULTIPLE") n++
  }
  return n
}

/**
 * Filas que pasan chequeos por-slot (sin exigir cardinal completo de la pauta).
 * No inventa filas; solo preserva subset consistente con topología cerrada OMR.
 */
export function filterPartialRowsPassingSlotChecks(params: {
  perQuestion: Array<Record<string, unknown>>
  topology: HybridSlotTopology
  closedQuestionIds: string[]
  strictHybrid: boolean
}): Array<Record<string, unknown>> {
  const { perQuestion, topology, closedQuestionIds, strictHybrid } = params
  const n = closedQuestionIds.length
  if (n < 1) return []
  const omrSlots = getOmrSlotsInPhysicalOrder(topology)

  const expectedNumericIds = new Set<number>()
  for (const id of closedQuestionIds) {
    const num = parseClosedIdNumericSlot(id)
    if (num != null) expectedNumericIds.add(num)
  }

  const seen = new Set<number>()
  const out: Array<Record<string, unknown>> = []

  for (const row of perQuestion) {
    const qn = Number(row.questionNumber ?? 0)
    if (!Number.isFinite(qn) || qn < 1 || !expectedNumericIds.has(qn)) continue
    if (seen.has(qn)) continue

    if (strictHybrid) {
      if (row.completedByExpectation === true) continue
      const pi = row.physicalIndex
      if (typeof pi !== "number" || !Number.isFinite(pi) || pi !== qn) continue
      if (row.canonicalId != null) {
        const expectedNum = canonicalNumericId(String(row.canonicalId ?? ""))
        if (expectedNum != null && expectedNum !== qn) continue
      }
    }

    seen.add(qn)
    out.push(row)
  }

  out.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))
  return out
}

export function partialSurvivalIsEligible(params: {
  partialRowCount: number
  azureMarkCount: number
  clusterRowCount: number
}): boolean {
  if (params.partialRowCount < 1) return false
  if (params.azureMarkCount < 1) return false
  if (params.clusterRowCount < 1) return false
  return true
}
