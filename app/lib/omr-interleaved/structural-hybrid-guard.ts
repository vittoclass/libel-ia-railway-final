/**
 * Guardas de integridad estructural (solo pipeline interleaved).
 * Objetivo: impedir degradación silenciosa de la pauta estructurada hacia una dimensión de plantilla/caller menor.
 */
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"

export type StructuralHybridGuardPhase = "pre_map" | "post_map"

export type StructuralHybridIntegrityReport = {
  structuralTemplateMismatch: boolean
  structuralHybridCollapseDetected: boolean
  structuralCollapseReason: string | null
  /** Mínimo estructural exigido por la pauta (`closedQuestionIds`). */
  expectedHybridQuestionCount: number
  expectedQuestionCountUsed: number | null
  detectedTemplateCapacity: number | null
  canonicalStructuredCount: number
  highestCanonicalSlot: number
  hybridStructurePreserved: boolean
  structuralFallbackPrevented: boolean
  preventedSilentTemplateReduction: boolean
  hybridQuestionSequenceCollapsed?: boolean
  developmentSlotsLostDuringAssembly?: boolean
  pipelineInvariantViolations: Array<{ invariant: string; questionNumber: number; detail: string }>
}

const INF = Number.POSITIVE_INFINITY

/**
 * Convención ubicua en este repo: sufijo `_${questionCount}_${optionCount}` (p. ej. template_nc_26_4).
 * Si no coincide, no se infiere capacidad (sin heurísticas por nombre de plantilla).
 */
export function inferTemplateQuestionCapacityFromKey(templateKey: string): number | null {
  const key = String(templateKey ?? "").trim()
  if (!key) return null
  const m = key.match(/_(\d+)_(\d+)\s*$/i)
  if (!m) return null
  const q = Number(m[1])
  const opts = Number(m[2])
  if (!Number.isFinite(q) || q < 1) return null
  if (!Number.isFinite(opts) || opts < 2 || opts > 8) return null
  return Math.floor(q)
}

function highestNumericSlotInClosedIds(closedQuestionIds: string[]): number {
  let hi = 0
  for (const id of closedQuestionIds) {
    const n = parseClosedIdNumericSlot(id)
    if (n != null && Number.isFinite(n)) hi = Math.max(hi, n)
  }
  return hi
}

function maxQuestionNumber(perQuestion: Array<Record<string, unknown>>): number {
  let m = 0
  for (const row of perQuestion) {
    const qn = Number(row.questionNumber ?? 0)
    if (Number.isFinite(qn) && qn > m) m = qn
  }
  return m
}

function buildReportBase(params: {
  closedQuestionIds: string[]
  expectedQuestionCount?: number
  templateKey: string
}): Omit<
  StructuralHybridIntegrityReport,
  | "structuralHybridCollapseDetected"
  | "structuralCollapseReason"
  | "hybridStructurePreserved"
  | "structuralFallbackPrevented"
  | "preventedSilentTemplateReduction"
  | "hybridQuestionSequenceCollapsed"
  | "developmentSlotsLostDuringAssembly"
  | "pipelineInvariantViolations"
> {
  const canonicalStructuredCount = params.closedQuestionIds.length
  const parsedHi = highestNumericSlotInClosedIds(params.closedQuestionIds)
  const highestCanonicalSlot = parsedHi > 0 ? parsedHi : canonicalStructuredCount
  const expectedHybridQuestionCount = canonicalStructuredCount
  const detectedTemplateCapacity = inferTemplateQuestionCapacityFromKey(params.templateKey)
  const exp =
    typeof params.expectedQuestionCount === "number" && params.expectedQuestionCount > 0
      ? Math.floor(params.expectedQuestionCount)
      : null
  const cap = detectedTemplateCapacity
  const structuralTemplateMismatch = exp != null && cap != null && exp !== cap
  return {
    structuralTemplateMismatch,
    expectedHybridQuestionCount,
    expectedQuestionCountUsed: exp,
    detectedTemplateCapacity: cap,
    canonicalStructuredCount,
    highestCanonicalSlot,
  }
}

/**
 * Valida coherencia estructural sin tocar decode/scoring.
 * `expectedHybridQuestionCount` = tamaño de pauta cerrada estructurada (cardinal de `closedQuestionIds`).
 */
export function evaluateStructuralHybridGuard(params: {
  closedQuestionIds: string[]
  expectedQuestionCount?: number
  templateKey: string
  phase: StructuralHybridGuardPhase
  /** Tras map + rebuild; obligatorio en post_map. */
  mappedPerQuestion?: Array<Record<string, unknown>>
}): StructuralHybridIntegrityReport {
  const n = params.closedQuestionIds.length
  const rawHighestNumeric = highestNumericSlotInClosedIds(params.closedQuestionIds)
  const base = buildReportBase({
    closedQuestionIds: params.closedQuestionIds,
    expectedQuestionCount: params.expectedQuestionCount,
    templateKey: params.templateKey,
  })
  const exp = base.expectedQuestionCountUsed
  const cap = base.detectedTemplateCapacity

  const violations: StructuralHybridIntegrityReport["pipelineInvariantViolations"] = []

  const minDeclared =
    exp == null && cap == null ? INF : Math.min(exp ?? INF, cap ?? INF)

  let collapse = false
  let reason: string | null = null
  let preventedSilent = false
  let sequenceCollapsed: boolean | undefined

  if (base.structuralTemplateMismatch) {
    violations.push({
      invariant: "structuralTemplateMismatch",
      questionNumber: 0,
      detail: `expectedQuestionCountUsed=${exp} detectedTemplateCapacity=${cap}`,
    })
  }

  if (!collapse && minDeclared < INF && minDeclared < n) {
    collapse = true
    preventedSilent = true
    reason =
      "structuralHybridCollapseDetected: dimensión declarada (mínimo entre expectedQuestionCount y template) " +
      `es ${minDeclared}, inferior a la pauta estructurada (${n} ítems cerrados).`
    violations.push({
      invariant: "preventedSilentTemplateReduction",
      questionNumber: 0,
      detail: `min(expected,capacity)=${minDeclared} < canonicalStructuredCount=${n}`,
    })
  }

  if (n > 0 && rawHighestNumeric > n) {
    violations.push({
      invariant: "highest_numeric_token_in_closed_ids_exceeds_list_length",
      questionNumber: 0,
      detail: `maxNumericInIds=${rawHighestNumeric} canonicalStructuredCount=${n}`,
    })
  }

  if (params.phase === "post_map" && params.mappedPerQuestion) {
    const mappedCount = params.mappedPerQuestion.length
    const maxQ = maxQuestionNumber(params.mappedPerQuestion)
    if (!collapse && mappedCount < n) {
      collapse = true
      preventedSilent = true
      reason =
        `structuralHybridCollapseDetected: filas decodificadas (${mappedCount}) < pauta cerrada (${n}).`
      violations.push({
        invariant: "canonicalStructuredCount_ne_pipeline_row_count",
        questionNumber: 0,
        detail: `mappedRowCount=${mappedCount} canonicalStructuredCount=${n}`,
      })
    }
    sequenceCollapsed = maxQ < n && mappedCount >= n
    if (!collapse && sequenceCollapsed) {
      collapse = true
      preventedSilent = true
      reason =
        "hybridQuestionSequenceCollapsed: max(questionNumber) tras ensamblaje es menor que la pauta estructurada."
      violations.push({
        invariant: "hybridQuestionSequenceCollapsed",
        questionNumber: 0,
        detail: `maxQuestionNumber=${maxQ} canonicalStructuredCount=${n}`,
      })
    }

  }

  return {
    ...base,
    structuralHybridCollapseDetected: collapse,
    structuralCollapseReason: reason,
    hybridStructurePreserved: !collapse,
    structuralFallbackPrevented: collapse,
    preventedSilentTemplateReduction: preventedSilent,
    hybridQuestionSequenceCollapsed: sequenceCollapsed,
    developmentSlotsLostDuringAssembly: false,
    pipelineInvariantViolations: violations,
  }
}

export function mergeStructuralViolationsIntoDebug(
  debug:
    | {
        geometryDiagnostics?: { pipelineInvariantViolations?: Array<{ invariant: string; questionNumber: number; detail: string }> }
      }
    | undefined,
  report: StructuralHybridIntegrityReport,
): void {
  if (!debug?.geometryDiagnostics) return
  const gd = debug.geometryDiagnostics
  gd.pipelineInvariantViolations = [...(gd.pipelineInvariantViolations ?? []), ...report.pipelineInvariantViolations]
}
