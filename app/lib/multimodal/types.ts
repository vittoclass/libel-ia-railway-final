/**
 * Contrato multimodal Artes — aditivo, sin scoring propio.
 * Se proyecta a criterios_evaluados oficial del motor.
 */

export type MultimodalImageRole =
  | "UNKNOWN"
  | "PROCESS"
  | "FINAL"
  | "DETAIL"
  | "TEXT_RESPONSE"

export type MultimodalArtsImageInput = {
  image_id: string
  order: number
  base64: string
  mime_type?: string
  role?: MultimodalImageRole
}

export type MultimodalArtsEvaluationInput = {
  item_key: string
  question_text: string
  rubric_text: string
  student_text?: string
  images: MultimodalArtsImageInput[]
  subject?: string
  context?: string
}

export type MultimodalObservationStatus =
  | "OBSERVED"
  | "PARTIALLY_OBSERVED"
  | "NOT_OBSERVABLE"
  | "IMAGE_QUALITY_INSUFFICIENT"

export type MultimodalConfidence = "LOW" | "MEDIUM" | "HIGH"

/** Niveles oficiales reutilizados por el scoring mecánico actual. */
export type MultimodalNivelLogro =
  | "LOGRADO"
  | "PARCIALMENTE_LOGRADO"
  | "INSUFICIENTE"
  | "NO_OBSERVABLE"

export type OfficialCriterioEvaluado = {
  criterio_id: string
  criterio_label: string
  nivel_logro: string
  evidencia: string
  justificacion: string
  observation_status?: MultimodalObservationStatus
  confidence?: MultimodalConfidence
  source_image_ids?: string[]
  inference_used?: boolean
}

export type MultimodalArtsEvaluationResult = {
  ok: boolean
  criterios_evaluados: OfficialCriterioEvaluado[]
  diagnostics: string[]
  provider_used?: string
  fallback_recommended: boolean
  /** Descripción observable para texto_estudiante (sin inventar). */
  texto_estudiante?: string
  /** Id de la imagen enviada al proveedor Vision (1 imagen / 1 llamada). */
  primary_image_id?: string
}

/** Evidencia intermedia del modelo (antes del adapter). */
export type MultimodalCriterionEvidence = {
  criterion_id: string
  criterion_label: string
  observed_content: string[]
  interpreted_content?: string[]
  observation_status: MultimodalObservationStatus
  confidence: MultimodalConfidence
  inference_used: boolean
  source_image_ids: string[]
  justification: string
  nivel_logro?: MultimodalNivelLogro
}
