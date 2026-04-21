/**
 * Valores recomendados para exam_type en evaluaciones / pruebas base (filtros de reporte).
 * El almacenamiento sigue siendo texto libre; estos labels unifican la UTP.
 */
export const EXAM_TYPE_ENSAYO = "Ensayo"
export const EXAM_TYPE_DIAGNOSTICO = "Diagnóstico"

export const EXAM_TYPE_FILTER_OPTIONS = [
  { value: "", label: "Todas" },
  { value: EXAM_TYPE_ENSAYO, label: EXAM_TYPE_ENSAYO },
  { value: EXAM_TYPE_DIAGNOSTICO, label: EXAM_TYPE_DIAGNOSTICO },
] as const

/** Coincide con filtro canónico en API (`evaluationMatchesExamTypeQueryParam`). */
export const EXAM_TYPE_FILTER_SIMCE_FAMILY = "SIMCE"
export const EXAM_TYPE_FILTER_PAES_FAMILY = "PAES"

/** Opciones extra para dashboards; no altera valores persistidos. */
export const EXAM_TYPE_FILTER_OPTIONS_WITH_NATIONAL = [
  ...EXAM_TYPE_FILTER_OPTIONS,
  { value: EXAM_TYPE_FILTER_SIMCE_FAMILY, label: "SIMCE (familia)" },
  { value: EXAM_TYPE_FILTER_PAES_FAMILY, label: "PAES (familia)" },
] as const
