/**
 * Tipos para la capa de prueba base (source_exam).
 * NO confundir con: evaluation (prueba respondida), answer_key (plantilla correcta), rubric (rúbrica).
 * Uso exclusivo para instrumento fuente / prueba en blanco.
 */

export interface SourceExamRow {
  id: string
  teacher_id: string
  school_id?: string | null
  title?: string | null
  subject?: string | null
  course_label?: string | null
  exam_type?: string | null
  pedagogy_mode?: string | null
  source_file_name?: string | null
  source_text?: string | null
  created_at?: string | null
}

export interface SourceExamItemRow {
  id: string
  source_exam_id: string
  item_number?: number | null
  item_text?: string | null
  axis_id?: string | null
  skill_id?: string | null
  competence?: string | null
  difficulty?: string | null
  created_at?: string | null
}

export interface EvaluationSourceExamRow {
  evaluation_id: string
  source_exam_id: string
  created_at?: string | null
}

/** Payload mínimo para crear/actualizar asociación evaluación -> prueba base */
export interface AssociateEvaluationSourceExamPayload {
  evaluation_id: string
  source_exam_id: string
}
