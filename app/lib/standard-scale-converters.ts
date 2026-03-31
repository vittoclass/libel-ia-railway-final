// SNAPSHOT_NATIONAL_ANALYTICS_V1
/**
 * Conversores de proyección nacional (PAES/SIMCE) desacoplados del scoring base.
 * No altera nota 1.0-7.0 ni OMR; solo transforma porcentaje de logro.
 */

export type SimceLevel = "Adecuado" | "Elemental" | "Insatisfactorio"

export function clampLogroPctFromScores(scoreObtained: number, scoreMax: number): number {
  if (!Number.isFinite(scoreObtained) || !Number.isFinite(scoreMax) || scoreMax <= 0) return 0
  const ratio = scoreObtained / scoreMax
  return Math.max(0, Math.min(100, ratio * 100))
}

export function projectPaesFromLogroPct(logroPct: number): number {
  const pct = Math.max(0, Math.min(100, logroPct))
  return Math.round(100 + (pct / 100) * 900)
}

export function projectSimceFromLogroPct(logroPct: number): number {
  const pct = Math.max(0, Math.min(100, logroPct))
  return Math.round((pct / 100) * 400)
}

export function simceLevelFromLogroPct(logroPct: number): SimceLevel {
  if (logroPct >= 75) return "Adecuado"
  if (logroPct >= 50) return "Elemental"
  return "Insatisfactorio"
}

