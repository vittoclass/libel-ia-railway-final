/**
 * Contrato puro de consolidación OMR multipágina (capa de integración).
 * No altera motores OMR ni scoring.
 */

export type OmrPageQuestionContribution = {
  question_id: string
  selected_answer: string
  confidence: number
  observed_from_sensors: boolean
  assigned_detection_indices: number[]
  confidences_by_column: Record<string, number>
}

export type OmrPageContribution = {
  page_index: number
  source_filename?: string
  per_question: OmrPageQuestionContribution[]
  observed_count: number
  nonblank_count: number
  blank_count: number
  sensor_count: number
  engine: string
  variant?: string
}

export type OmrRowEvidenceClass =
  | "HAS_SENSOR_EVIDENCE"
  | "NO_SENSOR_EVIDENCE"
  | "LEGACY_ENGINE_LETTER"

export type OmrPageEvidenceClass = "HAS_OMR_EVIDENCE" | "NON_OMR_OR_EMPTY_PAGE"

export type MergedOmrQuestion = {
  question_id: string
  selected_answer: string
  confidence: number
  observed_from_sensors: boolean
  assigned_detection_indices: number[]
  confidences_by_column: Record<string, number>
  source_page_index: number | null
  source_filename?: string
  engine?: string
  variant?: string
  ignored_blank_pages: number[]
  conflict: boolean
  conflict_candidates?: Array<{
    page_index: number
    selected_answer: string
    confidence: number
    source_filename?: string
  }>
}

export type MultipageOmrConflict = {
  code: "MULTIPAGE_OMR_CONFLICT"
  question_id: string
  candidates: Array<{
    page_index: number
    selected_answer: string
    confidence: number
    source_filename?: string
    engine?: string
  }>
}

export type IgnoredOmrPage = {
  page_index: number
  reason: "NON_OMR_OR_EMPTY_PAGE"
  source_filename?: string
  engine?: string
}

export type IgnoredOmrRow = {
  page_index: number
  question_id: string
  reason: "NO_SENSOR_EVIDENCE" | "ignored_blank_without_sensor"
  selected_answer: string
}

export type OmrQuestionProvenance = {
  question_id: string
  selected_answer: string
  source_page_index: number | null
  source_filename?: string
  engine?: string
  variant?: string
  observed_from_sensors: boolean
  assigned_detection_indices: number[]
  confidence: number
  ignored_blank_pages: number[]
  conflict: boolean
  conflict_candidates?: MergedOmrQuestion["conflict_candidates"]
}

export type MergeMultipageOmrResult = {
  merged_per_question: MergedOmrQuestion[]
  page_contributions: OmrPageContribution[]
  conflicts: MultipageOmrConflict[]
  ignored_pages: IgnoredOmrPage[]
  ignored_rows: IgnoredOmrRow[]
  provenance_by_question: Record<string, OmrQuestionProvenance>
  summary: {
    pages_total: number
    pages_ignored: number
    questions_merged: number
    questions_with_answer: number
    conflicts: number
    ignored_blank_without_sensor: number
  }
}

export type OfficialOmrRawRowWithProvenance = Record<string, unknown> & {
  questionNumber?: number
  canonicalId?: string
  selectedAnswer?: string
  confidence?: number
  observedFromSensors?: boolean
  assignedDetectionIndices?: number[]
  confidencesByColumn?: Record<string, number>
  multipageProvenance?: {
    source_page_index: number | null
    source_filename?: string
    engine?: string
    variant?: string
    ignored_blank_pages: number[]
    conflict: boolean
    conflict_candidates?: MergedOmrQuestion["conflict_candidates"]
  }
}
