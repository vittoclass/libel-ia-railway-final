/**
 * Tipos compartidos para motores de scoring estandarizado (SIMCE/PAES ensayo).
 * P1 — preparación arquitectónica; no reemplaza consumidores existentes.
 */

export type ScoringEngine = "chilean_grade" | "simce_practice" | "paes_practice"

export type ConfidenceLevel = "low" | "medium" | "high"

/** Metodología de cálculo; extensible sin romper consumidores futuros. */
export type ScoringMethodology =
  | "chilean_split_scale"
  | "linear_fallback"
  | "demre_table"
  | "anchor_table"
  | "item_parameterized"
  | "referential_scale"

export type ScoringResultMetadata = {
  scoring_engine: ScoringEngine
  confidence_level: ConfidenceLevel
  methodology: ScoringMethodology
}

/** Resultado tipado con trazabilidad de motor (opt-in; no usado en producción aún). */
export type ScoredResult<T> = {
  value: T
  metadata: ScoringResultMetadata
}
