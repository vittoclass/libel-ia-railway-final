/**
 * Fuente única para proyección SIMCE referencial (visualización / gestión).
 * No es SIMCE oficial ni altera scoring, notas ni persistencia de evaluación.
 */

export const SIMCE_PROJECTION_TYPE_REFERENTIAL = "referential" as const

export type SimceProjectionType = typeof SIMCE_PROJECTION_TYPE_REFERENTIAL

export const SIMCE_PROJECTION_DISCLAIMER =
  "Proyección referencial basada en el logro de esta evaluación; no reemplaza la medición oficial de la Agencia de Calidad."

/** Rango de la proyección lineal referencial (solo presentación; coincide con projectCanonicalSimce). */
export const SIMCE_PROJECTION_SCALE_RANGE = "200–400" as const

export const SIMCE_PROJECTION_SCALE_LABEL = `Escala SIMCE referencial (${SIMCE_PROJECTION_SCALE_RANGE})` as const

export const SIMCE_PROJECTION_SCALE_INLINE = `(${SIMCE_PROJECTION_SCALE_RANGE})` as const

/** Escala lineal institucional: 200 (0% logro) → 400 (100% logro). */
export function projectCanonicalSimce(logroPct: number): number {
  const pct = Math.max(0, Math.min(100, Number(logroPct)))
  if (!Number.isFinite(pct)) return 200
  const raw = Math.round(200 + (pct / 100) * 200)
  return Math.max(200, Math.min(400, raw))
}

export function simceProjectionMetadata(): {
  simce_projection_type: SimceProjectionType
  simce_projection_disclaimer: string
} {
  return {
    simce_projection_type: SIMCE_PROJECTION_TYPE_REFERENTIAL,
    simce_projection_disclaimer: SIMCE_PROJECTION_DISCLAIMER,
  }
}
