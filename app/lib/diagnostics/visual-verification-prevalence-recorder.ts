/**
 * PASO 2 / FASE 2A-2 — Recorder pasivo de prevalencia (telemetría only).
 *
 * Fail-soft absoluto: nunca lanza; no muta decisions/out; no activa Shadow/APPLY;
 * no llama Azure; no persiste; no PII; no letras; no imágenes.
 *
 * Emisión solo con LIBELIA_VISUAL_VERIFICATION_PREVALENCE === "1"
 * y rescueMode "shadow" | "apply" con decisiones ya calculadas.
 */

import type { AzureLayoutOmrDiagnosticContext } from "@/app/lib/omr/experimental/azure-layout-omr-pipeline"
import type {
  VisualBlankRescueMode,
  VisualBlankRescuePageResult,
  VisualBlankRescueRowDecision,
} from "@/app/lib/omr-shared/azure-visual-blank-rescue"

export const VISUAL_VERIFICATION_PREVALENCE_FLAG =
  "LIBELIA_VISUAL_VERIFICATION_PREVALENCE" as const

export const PREVALENCE_LOG_PREFIX = "[VISUAL_VERIFICATION_PREVALENCE]" as const
export const PREVALENCE_SKIPPED_LOG_PREFIX =
  "[VISUAL_VERIFICATION_PREVALENCE_SKIPPED]" as const

export const PREVALENCE_SCHEMA_VERSION = 1 as const
export const PREVALENCE_EVENT_NAME = "PAGE_PREVALENCE_SUMMARY" as const

export type PrevalenceSourceMode = "batch" | "direct"

export type PrevalenceAttemptOutcome = "used" | "discarded" | "failed" | "unknown"

export type PrevalencePageUsefulness =
  | "usefulPage"
  | "ignoredOrNonOmrPage"
  | "gridIncompleteUsefulPage"

export type PrevalencePageEvent = {
  schemaVersion: typeof PREVALENCE_SCHEMA_VERSION
  event: typeof PREVALENCE_EVENT_NAME
  diagnosticRunId: string
  evaluationBatchId?: string
  batchStudentIndex?: number
  pageIndex: number
  attempt: number
  eventKey: string
  sourceMode: PrevalenceSourceMode
  attemptOutcome: PrevalenceAttemptOutcome
  engine: "azure_layout_family"
  layoutMode: "standard"
  expectedQuestionCount: number
  expectedOptionCount: number
  selectionMarksTotal: number
  selectedCountAzure: number
  blankRowCountBefore: number
  autoRescueCandidateCount: number
  reviewCandidateCount: number
  insufficientAbsoluteEvidenceCount: number
  insufficientMarginCount: number
  alreadySelectedCount: number
  noActionCount: number
  excludedCompetitiveDoubleMarkCount: number
  excludedGridIncompleteCount: number
  excludedInvalidPolygonCount: number
  excludedOtherCount: number
  degradedPage: boolean
  degradedReason: string | null
  pageGatesPassed: boolean
  pageAbstainReason: string | null
  pageUsefulness: PrevalencePageUsefulness
  /** Metadata secundaria; nunca identidad. */
  emittedAt?: string
}

export type PrevalenceRecordInput = Readonly<{
  diagnosticContext?: AzureLayoutOmrDiagnosticContext
  rescueMode: VisualBlankRescueMode
  rescueResult: VisualBlankRescuePageResult
  expectedQuestionCount: number
  expectedOptionCount: number
  /** Imagen ya disponible en memoria para el rescate (sin re-medir). */
  imageAvailableInMemory: boolean
}>

type EmitFn = (line: string) => void

let emitFn: EmitFn = (line) => {
  console.log(line)
}

/** Solo tests. */
export function __setPrevalenceEmitForTests(fn: EmitFn | null): void {
  emitFn = fn ?? ((line) => console.log(line))
}

/** Solo el valor exacto "1" habilita. Ausencia / "" / "0" / "true" / "yes" / "2" → OFF. */
export function isVisualVerificationPrevalenceEnabled(): boolean {
  try {
    return process.env[VISUAL_VERIFICATION_PREVALENCE_FLAG] === "1"
  } catch {
    return false
  }
}

function isNonEmptyId(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== ""
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && Number.isFinite(v) && v >= 0
}

/**
 * eventKey batch:
 *   diagnosticRunId|evaluationBatchId|batchStudentIndex|pageIndex|attempt
 * eventKey direct (sin batchId — carga directa):
 *   diagnosticRunId|direct|pageIndex|attempt
 *
 * No inventa batchId. Sin timestamps.
 */
export function tryBuildPrevalenceEventKey(
  ctx: AzureLayoutOmrDiagnosticContext | null | undefined,
): { eventKey: string; sourceMode: PrevalenceSourceMode } | null {
  if (ctx == null || typeof ctx !== "object") return null
  const { diagnosticRunId, evaluationBatchId, batchStudentIndex, pageIndex, attempt } = ctx
  if (!isNonEmptyId(diagnosticRunId)) return null
  if (!isNonNegInt(pageIndex) || !isNonNegInt(attempt)) return null

  if (isNonEmptyId(evaluationBatchId)) {
    if (
      typeof batchStudentIndex !== "number" ||
      !Number.isInteger(batchStudentIndex) ||
      !Number.isFinite(batchStudentIndex)
    ) {
      return null
    }
    return {
      sourceMode: "batch",
      eventKey: `${diagnosticRunId.trim()}|${evaluationBatchId.trim()}|${batchStudentIndex}|${pageIndex}|${attempt}`,
    }
  }

  // Carga directa: sin evaluationBatchId. No inventar batchId.
  return {
    sourceMode: "direct",
    eventKey: `${diagnosticRunId.trim()}|direct|${pageIndex}|${attempt}`,
  }
}

function isLetterAnswer(answer: string | undefined): boolean {
  return /^[A-H]$/.test(String(answer ?? "").trim().toUpperCase())
}

function countDecisions(decisions: ReadonlyArray<VisualBlankRescueRowDecision>): {
  autoRescueCandidateCount: number
  reviewCandidateCount: number
  insufficientAbsoluteEvidenceCount: number
  insufficientMarginCount: number
  alreadySelectedCount: number
  noActionCount: number
  excludedCompetitiveDoubleMarkCount: number
  excludedInvalidPolygonCount: number
  excludedOtherCount: number
} {
  let autoRescueCandidateCount = 0
  let reviewCandidateCount = 0
  let insufficientAbsoluteEvidenceCount = 0
  let insufficientMarginCount = 0
  let alreadySelectedCount = 0
  let noActionCount = 0
  let excludedCompetitiveDoubleMarkCount = 0
  let excludedInvalidPolygonCount = 0
  let excludedOtherCount = 0

  for (const d of decisions) {
    if (d.action === "rescued_answer") {
      autoRescueCandidateCount++
      continue
    }
    if (d.action === "no_action") {
      noActionCount++
      if (d.reason === "already_selected") alreadySelectedCount++
      continue
    }
    if (d.action === "abstain") {
      if (d.reason === "insufficient_absolute_evidence") {
        insufficientAbsoluteEvidenceCount++
      } else if (d.reason === "insufficient_margin") {
        insufficientMarginCount++
      } else if (d.reason === "competitive_double_mark") {
        excludedCompetitiveDoubleMarkCount++
      } else if (
        d.reason === "invalid_polygon" ||
        d.reason === "invalid_polygon_geom"
      ) {
        excludedInvalidPolygonCount++
      } else {
        excludedOtherCount++
      }
    }
  }

  return {
    autoRescueCandidateCount,
    reviewCandidateCount,
    insufficientAbsoluteEvidenceCount,
    insufficientMarginCount,
    alreadySelectedCount,
    noActionCount,
    excludedCompetitiveDoubleMarkCount,
    excludedInvalidPolygonCount,
    excludedOtherCount,
  }
}

/**
 * Review candidate (Centro): solo insufficient_absolute_evidence bajo gates OK,
 * con bestLetter interna única y sin letras en el evento.
 * insufficient_margin se cuenta aparte y NO suma a reviewCandidateCount.
 */
export function countReviewCandidates(params: {
  decisions: ReadonlyArray<VisualBlankRescueRowDecision>
  pageGatesPassed: boolean
  selectedCountAzure: number
  expectedQuestionCount: number
  imageAvailableInMemory: boolean
  pageAbstainReason: string | null
}): number {
  if (!params.pageGatesPassed) return 0
  if (!params.imageAvailableInMemory) return 0
  if (params.pageAbstainReason === "grid_incomplete") return 0
  if (!(params.selectedCountAzure < params.expectedQuestionCount)) return 0

  let n = 0
  for (const d of params.decisions) {
    if (d.action !== "abstain") continue
    if (d.reason !== "insufficient_absolute_evidence") continue
    const best =
      d.metrics && typeof d.metrics.bestLetter === "string" ? d.metrics.bestLetter : null
    if (!best || !isLetterAnswer(best)) continue
    // bestLetter interna única: hay best y no hay empate tipado como competitive.
    n++
  }
  return n
}

export type DegradedAssessment = {
  degradedPage: boolean
  degradedReason: string | null
}

/**
 * Precedencia degradedReason:
 * 1. grid_incomplete
 * 2. severe_selected_deficit
 * 3. excessive_review_candidates
 * 4. excessive_blank_rows
 * 5. high_review_ratio
 */
export function assessDegradedPage(params: {
  pageAbstainReason: string | null
  selectedCountAzure: number
  expectedQuestionCount: number
  reviewCandidateCount: number
  blankRowCountBefore: number
  autoRescueCandidateCount: number
  pageUsefulness: PrevalencePageUsefulness
}): DegradedAssessment {
  // Páginas no útiles no se clasifican como degradadas "normales".
  if (
    params.pageUsefulness === "ignoredOrNonOmrPage" ||
    params.pageUsefulness === "gridIncompleteUsefulPage"
  ) {
    if (params.pageAbstainReason === "grid_incomplete") {
      return { degradedPage: true, degradedReason: "grid_incomplete" }
    }
    return { degradedPage: false, degradedReason: null }
  }

  const eq = Math.max(0, Math.floor(params.expectedQuestionCount))
  const severeCeiling = Math.max(1, Math.floor(eq * 0.25))

  if (params.pageAbstainReason === "grid_incomplete") {
    return { degradedPage: true, degradedReason: "grid_incomplete" }
  }
  if (params.selectedCountAzure <= severeCeiling) {
    return { degradedPage: true, degradedReason: "severe_selected_deficit" }
  }
  if (params.reviewCandidateCount > 2) {
    return { degradedPage: true, degradedReason: "excessive_review_candidates" }
  }
  const unresolvedBlanks = Math.max(
    0,
    params.blankRowCountBefore - params.autoRescueCandidateCount,
  )
  if (params.blankRowCountBefore > 2 && unresolvedBlanks > 0) {
    return { degradedPage: true, degradedReason: "excessive_blank_rows" }
  }
  if (eq > 0 && params.reviewCandidateCount / eq > 0.3) {
    return { degradedPage: true, degradedReason: "high_review_ratio" }
  }
  return { degradedPage: false, degradedReason: null }
}

export function classifyPageUsefulness(params: {
  selectionMarksTotal: number
  pageAbstainReason: string | null
}): PrevalencePageUsefulness {
  if (params.selectionMarksTotal <= 0) return "ignoredOrNonOmrPage"
  if (params.pageAbstainReason === "grid_incomplete") return "gridIncompleteUsefulPage"
  return "usefulPage"
}

function emitSkipped(reason: string, extra?: Record<string, unknown>): void {
  try {
    const payload = {
      schemaVersion: PREVALENCE_SCHEMA_VERSION,
      event: "PAGE_PREVALENCE_SKIPPED",
      reason,
      ...(extra ?? {}),
    }
    emitFn(`${PREVALENCE_SKIPPED_LOG_PREFIX} ${JSON.stringify(payload)}`)
  } catch {
    // never throw
  }
}

/**
 * Emite un evento de prevalencia de página. Fail-soft: captura excepciones propias.
 * No muta rescueResult ni decisions.
 */
export function recordVisualVerificationPrevalence(input: PrevalenceRecordInput): void {
  try {
    if (!isVisualVerificationPrevalenceEnabled()) return
    if (input.rescueMode !== "shadow" && input.rescueMode !== "apply") return

    const keyInfo = tryBuildPrevalenceEventKey(input.diagnosticContext)
    if (!keyInfo) {
      emitSkipped("missing_exact_context_ids", {
        hasDiagnosticRunId: isNonEmptyId(input.diagnosticContext?.diagnosticRunId),
        hasEvaluationBatchId: isNonEmptyId(input.diagnosticContext?.evaluationBatchId),
        hasBatchStudentIndex:
          typeof input.diagnosticContext?.batchStudentIndex === "number",
        hasPageIndex: isNonNegInt(input.diagnosticContext?.pageIndex),
        hasAttempt: isNonNegInt(input.diagnosticContext?.attempt),
      })
      return
    }

    const result = input.rescueResult
    const decisions = Array.isArray(result.decisions) ? result.decisions : []
    const counts = countDecisions(decisions)

    const expectedQuestionCount =
      typeof input.expectedQuestionCount === "number" &&
      Number.isFinite(input.expectedQuestionCount) &&
      input.expectedQuestionCount > 0
        ? Math.round(input.expectedQuestionCount)
        : 0
    const expectedOptionCount =
      typeof input.expectedOptionCount === "number" &&
      Number.isFinite(input.expectedOptionCount) &&
      input.expectedOptionCount >= 2
        ? Math.max(2, Math.min(8, Math.round(input.expectedOptionCount)))
        : 4

    const pageUsefulness = classifyPageUsefulness({
      selectionMarksTotal: result.selectionMarksTotal,
      pageAbstainReason: result.pageAbstainReason,
    })

    const excludedGridIncompleteCount =
      result.pageAbstainReason === "grid_incomplete" ? 1 : 0

    // Páginas no útiles: no atribuir revisiones masivas.
    let reviewCandidateCount = 0
    if (pageUsefulness === "usefulPage") {
      reviewCandidateCount = countReviewCandidates({
        decisions,
        pageGatesPassed: result.pageGatesPassed === true,
        selectedCountAzure: result.selectedCountAzure,
        expectedQuestionCount,
        imageAvailableInMemory: input.imageAvailableInMemory === true,
        pageAbstainReason: result.pageAbstainReason,
      })
    }

    const degraded = assessDegradedPage({
      pageAbstainReason: result.pageAbstainReason,
      selectedCountAzure: result.selectedCountAzure,
      expectedQuestionCount,
      reviewCandidateCount,
      blankRowCountBefore: result.blankRowCountBefore,
      autoRescueCandidateCount: counts.autoRescueCandidateCount,
      pageUsefulness,
    })

    const ctx = input.diagnosticContext!
    const event: PrevalencePageEvent = {
      schemaVersion: PREVALENCE_SCHEMA_VERSION,
      event: PREVALENCE_EVENT_NAME,
      diagnosticRunId: ctx.diagnosticRunId!.trim(),
      pageIndex: ctx.pageIndex!,
      attempt: ctx.attempt!,
      eventKey: keyInfo.eventKey,
      sourceMode: keyInfo.sourceMode,
      // En el punto del pipeline no se conoce aún si el adapter consumirá out.
      // El analizador resuelve used/discarded con el invariante del loop (ver README).
      attemptOutcome: "unknown",
      engine: "azure_layout_family",
      layoutMode: "standard",
      expectedQuestionCount,
      expectedOptionCount,
      selectionMarksTotal: result.selectionMarksTotal,
      selectedCountAzure: result.selectedCountAzure,
      blankRowCountBefore: result.blankRowCountBefore,
      autoRescueCandidateCount: counts.autoRescueCandidateCount,
      reviewCandidateCount,
      insufficientAbsoluteEvidenceCount: counts.insufficientAbsoluteEvidenceCount,
      insufficientMarginCount: counts.insufficientMarginCount,
      alreadySelectedCount: counts.alreadySelectedCount,
      noActionCount: counts.noActionCount,
      excludedCompetitiveDoubleMarkCount: counts.excludedCompetitiveDoubleMarkCount,
      excludedGridIncompleteCount,
      excludedInvalidPolygonCount: counts.excludedInvalidPolygonCount,
      excludedOtherCount: counts.excludedOtherCount,
      degradedPage: degraded.degradedPage,
      degradedReason: degraded.degradedReason,
      pageGatesPassed: result.pageGatesPassed === true,
      pageAbstainReason: result.pageAbstainReason,
      pageUsefulness,
      emittedAt: new Date().toISOString(),
    }

    if (keyInfo.sourceMode === "batch") {
      event.evaluationBatchId = ctx.evaluationBatchId!.trim()
      event.batchStudentIndex = ctx.batchStudentIndex
    }

    // Defensa: no filtrar letras/PII porque el contrato no las incluye;
    // serializar solo el objeto tipado.
    emitFn(`${PREVALENCE_LOG_PREFIX} ${JSON.stringify(event)}`)
  } catch {
    try {
      emitSkipped("recorder_internal_error")
    } catch {
      // never throw
    }
  }
}

/** Utilidad de test: detectar mutación de decisions. */
export function assertDecisionsUntouched(
  before: ReadonlyArray<VisualBlankRescueRowDecision>,
  after: ReadonlyArray<VisualBlankRescueRowDecision>,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after)
}
