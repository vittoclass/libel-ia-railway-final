/**
 * Tipos de la capa grafo pedagógico (snapshot solo lectura).
 * No modifica scoring, OMR ni persistencia.
 */

export type PedagogicalGraphNodeType =
  | "student"
  | "evaluation"
  | "item"
  | "skill"
  | "axis"
  | "cognitive_level"
  | "subject"
  | "course"
  | "teacher"
  | "school"
  | "organization"
  | "source_exam"
  | "batch"
  | "student_profile"
  | "skill_label_text"
  | "axis_label_text"
  | "achievement_level"
  | "score_summary"
  /** FASE 0 caligráfica — solo evidencia, sin reconocimiento de letras */
  | "handwriting_profile"
  | "writing_evidence"
  | "handwriting_observation"
  | "possible_ocr_difficulty"
  | "teacher_corrected_text"
  | "ocr_original_text"
  /** FASE 1 — memoria caligráfica longitudinal (solo lectura, sin letras/autoría) */
  | "historical_handwriting_profile"
  | "handwriting_memory"
  | "writing_progress"
  | "recurring_ocr_confusion"
  | "repeated_pattern_cluster"
  /** FASE 2A — co-fallo intra-evaluación (inferido, solo evidencia) */
  | "failure_pattern"
  | "co_occurrence_cluster"
  | "inferred_relation"
  /** FASE 3B — identidad nominal en grafo (solo evidencia) */
  | "name_observation"
  | "name_candidate"
  | "possible_student_match"
  | "nominal_confirmation"

export type PedagogicalGraphConfidence = "high" | "medium" | "low"

export type PedagogicalGraphEdgeType =
  | "completed"
  | "contains"
  | "measures"
  | "belongs_to"
  | "has_cognitive_level"
  | "belongs_to_subject"
  | "uses"
  | "part_of"
  | "has_text_skill"
  | "has_text_axis"
  | "has_score_summary"
  | "applied"
  | "has_achievement_level"
  /** FASE 0 caligráfica */
  | "has_handwriting_profile"
  | "contains_writing_evidence"
  | "has_written_answer"
  | "may_need_review"
  | "improves"
  | "references"
  /** FASE 1 — memoria longitudinal */
  | "has_handwriting_memory"
  | "shares_pattern_with"
  | "repeated_in"
  | "contributes_to"
  | "aggregates"
  | "linked_to_cluster"
  /** FASE 2A — co-fallo intra-evaluación */
  | "co_fails_with"
  | "has_inferred_pattern"
  | "supported_by"
  /** FASE 3B — identidad nominal en grafo */
  | "has_name_observation"
  | "has_possible_student_match"
  | "suggests_name_candidate"
  | "teacher_confirmed_match"

export interface PedagogicalGraphNode {
  id: string
  type: PedagogicalGraphNodeType
  label: string
  confidence: PedagogicalGraphConfidence
  /** Nodos `student`: `name_source`, `name_confidence` (high | medium | low). */
  metadata?: Record<string, unknown>
}

export interface PedagogicalGraphEdge {
  id: string
  source: string
  target: string
  type: PedagogicalGraphEdgeType
  confidence: PedagogicalGraphConfidence
  metadata?: Record<string, unknown>
}

/** FASE 2C — métricas y límites del snapshot (solo lectura). */
export interface PedagogicalGraphObservability {
  node_count: number
  edge_count: number
  build_duration_ms: number
  layers_included: string[]
  caps_applied: string[]
  warnings: string[]
  degraded: boolean
  nodes_before_cap?: number
  edges_before_cap?: number
  response_bytes_estimate?: number
}

export interface PedagogicalGraphSummary {
  skills_count: number
  items_count: number
  weak_skills: string[]
  strong_skills: string[]
  /** FASE 0: conteo de nodos writing_evidence en el snapshot (observabilidad). */
  writing_evidence_count?: number
  /** FASE 1: evaluaciones históricas consideradas en memoria caligráfica. */
  historical_evaluations_included?: number
  /** FASE 1: clusters de patrón repetido detectados. */
  repeated_pattern_clusters?: number
  /** FASE 1: confusiones OCR recurrentes agregadas. */
  recurring_ocr_confusion_count?: number
  /** FASE 2A: clusters de co-fallo intra-evaluación inferidos. */
  co_failure_clusters_count?: number
  /** FASE 2A: aristas inferidas por co-fallo (tope aplicado). */
  inferred_intra_eval_edges_count?: number
}

export interface PedagogicalGraphSnapshot {
  evaluation_id: string
  student_display_name: string
  nodes: PedagogicalGraphNode[]
  edges: PedagogicalGraphEdge[]
  summary: PedagogicalGraphSummary
  /** FASE 2C — observabilidad y estado de degradación (no altera nodos/aristas del núcleo). */
  observability?: PedagogicalGraphObservability
}

export type BuildGraphSnapshotResult =
  | { ok: true; snapshot: PedagogicalGraphSnapshot }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "schema_error"; message: string }
