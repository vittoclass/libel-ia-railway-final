/**
 * Sprint 31–34 — Contrato del núcleo común de criterios de Desarrollo.
 * Sin puntaje, nota, scoring, OMR ni persistencia.
 */

import type { CriterionIdSource, RubricParseStatus } from "@/app/lib/development-core/parse-rubric-criteria"
import type { RequirementCheckStatus } from "@/app/lib/development-core/boundary-decision"

export type DevelopmentCriteriaPromptMode =
  | "NOT_APPLICABLE"
  | "SINGLE_EVIDENCE_TEXT"
  | "SINGLE_EVIDENCE_VISUAL"
  | "MULTIPLE_OPEN_EVIDENCES"

/** Niveles oficiales actuales de Solo Desarrollo (+ ambigüedad de frontera LAB). */
export type DevelopmentCriteriaNivelLogro =
  | "LOGRADO"
  | "PARCIALMENTE_LOGRADO"
  | "INSUFICIENTE"
  | "NO_OBSERVABLE"
  | "BOUNDARY_AMBIGUOUS"

export type AssessmentStatus = "OBSERVABLE" | "NOT_OBSERVABLE"

export interface DevelopmentCriteriaCoreInput {
  item_key: string
  question_text: string
  student_text: string
  rubric_text: string
  subject?: string
  context?: string
  existing_item_metadata?: Record<string, unknown>
}

export interface RequirementCheckRecord {
  requirement: string
  status: RequirementCheckStatus
  evidence_quote?: string
  reason: string
  level_label?: string
  level_ordinal?: number
  kind?: "positive" | "problem_condition"
}

export interface DevelopmentCriteriaEvaluated {
  criterio_id: string
  criterio_label: string
  nivel_logro: string
  evidencia: string
  justificacion: string
  /** Sprint 33 — provenance del ID (opcional; compat no lo exige). */
  criterion_id_source?: CriterionIdSource
  /** Descriptor textual seleccionado de la rúbrica (si aplica). */
  descriptor_selected?: string
  /** Requisitos faltantes derivados del descriptor (no del juicio global). */
  missing_requirements?: string[]
  /** Si la escala no tiene NO_OBSERVABLE pero la evidencia no es observable. */
  assessment_status?: AssessmentStatus
  /** Sprint 34 — checklist por requisito */
  requirement_checks?: RequirementCheckRecord[]
  present_requirements?: string[]
  absent_requirements?: string[]
  /** Decisión de frontera */
  boundary_decision?: "LEVEL" | "BOUNDARY_AMBIGUOUS" | "INSUFFICIENT_EVIDENCE"
  recommended_level?: string
  alternate_level?: string
  ambiguity_reason?: string
  /** Packs de requisitos del criterio (trazables al descriptor). */
  level_requirement_packs?: Array<{
    level_label: string
    observable_requirements: string[]
    prohibited_or_absent_conditions?: string[]
  }>
}

export interface DevelopmentCriteriaCoreDiagnostics {
  parser_used: string
  criteria_count: number
  blocked: boolean
  blocked_reason?: string
  /** Sprint 33 */
  rubric_parse_status?: RubricParseStatus
  rubric_format?: string
  criterion_ids_stable?: boolean
  empty_evidence_preserved_criteria?: boolean
  /** Sprint 34 */
  boundary_stage?: boolean
  requirements_fingerprint?: string
}

export interface DevelopmentCriteriaCoreResult {
  criterios_evaluados: DevelopmentCriteriaEvaluated[]
  raw_provider_output?: unknown
  diagnostics: DevelopmentCriteriaCoreDiagnostics
}

export interface DevelopmentCriteriaParityDiff {
  index: number
  field: string
  left: string
  right: string
}

export interface DevelopmentCriteriaParityComparison {
  equal: boolean
  count_match: boolean
  order_match: boolean
  diffs: DevelopmentCriteriaParityDiff[]
}
