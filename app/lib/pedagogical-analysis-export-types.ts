/**
 * Tipo compartido para análisis pedagógico (modal, PDF individual, exportación ZIP).
 * Reversible: solo tipos; no afecta runtime de OMR ni evaluación.
 */

export type PedagogicalAnalysisExportData = {
  evaluation_id: string
  has_source_exam: boolean
  has_evaluation_items?: boolean
  has_source_exam_items?: boolean
  analysis_available?: boolean
  status_reason?: string
  by_question: Array<{
    item_number: number
    axis: string
    skill: string
    cognitive_level: string
    score_obtained: number
    score_max: number
    logro_pct: number | null
  }>
  by_skill: Array<{
    dimension_value: string
    score_obtained: number
    score_max: number
    logro_pct: number | null
    question_count: number
  }>
  by_axis: Array<{
    dimension_value: string
    score_obtained: number
    score_max: number
    logro_pct: number | null
    question_count: number
  }>
  by_cognitive_level: Array<{
    dimension_value: string
    score_obtained: number
    score_max: number
    logro_pct: number | null
    question_count: number
  }>
  student_summary: {
    strong_axes: string[]
    weak_axes: string[]
    strong_skills: string[]
    weak_skills: string[]
    lowest_cognitive_level: string | null
    highest_cognitive_level: string | null
  } | null
  instrument_type?: string | null
  instrument_analytics_mode?: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
  projections?: {
    simce_estimated: number | null
    paes_estimated: number | null
    level_label: "Insuficiente" | "Elemental" | "Adecuado" | null
    year?: number
  }
  strategic_analysis?: {
    paragraph: string
    key_gap?: {
      numbers_pct?: number | null
      modelacion_pct?: number | null
      overall_pct?: number | null
      z_score_course?: number | null
      simce_level?: "Insuficiente" | "Elemental" | "Adecuado" | null
    }
  } | null
}
