/**
 * Motor de nota escolar chilena (1.0–7.0) — capa de arquitectura P1.
 *
 * Réplica la fórmula de app/api/evaluate/evaluation-logic.ts (calculateGrade)
 * sin importar ni modificar evaluate. Listo para migración futura de imports.
 *
 * NO reemplaza calculateGrade ni calculateFinalScore en producción.
 */

import type { ScoredResult, ScoringResultMetadata } from "@/app/lib/standardized/types"

export const CHILEAN_GRADE_MIN = 1.0
export const CHILEAN_GRADE_MAX = 7.0
export const CHILEAN_GRADE_APPROVAL = 4.0
/** Exigencia por defecto alineada a evaluate (60% → nota 4.0). */
export const CHILEAN_EXIGENCIA_DEFAULT_PCT = 60

export const CHILEAN_GRADE_METADATA: ScoringResultMetadata = {
  scoring_engine: "chilean_grade",
  confidence_level: "high",
  methodology: "chilean_split_scale",
}

/**
 * Nota Chile 1.0–7.0 a partir de puntaje obtenido, máximo y % de exigencia.
 * Idéntica a calculateGrade en evaluation-logic.ts.
 */
export function calculateChileanGrade(
  score: number,
  maxScore: number,
  porcentajeExigencia: number = CHILEAN_EXIGENCIA_DEFAULT_PCT,
): number {
  if (maxScore <= 0 || porcentajeExigencia <= 0) return CHILEAN_GRADE_MIN

  const exigenciaDecimal = Math.min(100, Math.max(1, porcentajeExigencia)) / 100
  const puntosAprobacion = Math.ceil(maxScore * exigenciaDecimal)
  const puntajeEfectivo = Math.max(0, score)

  if (puntajeEfectivo === 0) return CHILEAN_GRADE_MIN

  let grade: number

  if (puntajeEfectivo <= puntosAprobacion) {
    const ratio = Math.min(1, puntajeEfectivo / puntosAprobacion)
    grade = CHILEAN_GRADE_MIN + 3.0 * Math.pow(ratio, 0.95)
    grade = Math.min(CHILEAN_GRADE_APPROVAL, grade)
  } else {
    const remainingPoints = maxScore - puntosAprobacion
    if (remainingPoints === 0) return CHILEAN_GRADE_MAX
    grade =
      CHILEAN_GRADE_APPROVAL +
      3.0 * ((puntajeEfectivo - puntosAprobacion) / remainingPoints)
  }

  return Math.min(CHILEAN_GRADE_MAX, Math.round(grade * 10) / 10)
}

/** Misma fórmula con metadata de motor (uso futuro; no wired en producción). */
export function calculateChileanGradeWithMetadata(
  score: number,
  maxScore: number,
  porcentajeExigencia: number = CHILEAN_EXIGENCIA_DEFAULT_PCT,
): ScoredResult<number> {
  return {
    value: calculateChileanGrade(score, maxScore, porcentajeExigencia),
    metadata: CHILEAN_GRADE_METADATA,
  }
}

/** Puntos mínimos para nota 4.0 (útil para velocímetros / UI futura). */
export function chileanApprovalPoints(maxScore: number, porcentajeExigencia: number): number {
  if (maxScore <= 0 || porcentajeExigencia <= 0) return 0
  const exigenciaDecimal = Math.min(100, Math.max(1, porcentajeExigencia)) / 100
  return Math.ceil(maxScore * exigenciaDecimal)
}
