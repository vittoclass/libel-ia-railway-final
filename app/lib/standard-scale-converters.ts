// SNAPSHOT_NATIONAL_ANALYTICS_V1
/**
 * Conversores de proyección nacional (PAES/SIMCE) desacoplados del scoring base.
 * No altera nota 1.0-7.0 ni OMR; solo transforma porcentaje de logro.
 */

import { agencyAchievementLevelFromLogroPct } from "@/app/lib/chile-standards/agency-level-cuts"
import { projectCanonicalSimce } from "@/app/lib/simceProjectionCanonical"

/** Nivel de desempeño por logro % (cortes Agencia: &lt;50 · 50–69 · ≥70). */
export type SimceLevel = "Adecuado" | "Elemental" | "Insuficiente"

export function clampLogroPctFromScores(scoreObtained: number, scoreMax: number): number {
  if (!Number.isFinite(scoreObtained) || !Number.isFinite(scoreMax) || scoreMax <= 0) return 0
  const ratio = scoreObtained / scoreMax
  return Math.max(0, Math.min(100, ratio * 100))
}

export function projectPaesFromLogroPct(logroPct: number): number {
  const pct = Math.max(0, Math.min(100, logroPct))
  /** Piso 100 (escala PAES institucional 100–1000); evita 0 cuando hay logro registrado. */
  return Math.round(100 + (pct / 100) * 900)
}

/** Wrapper sobre proyección canónica referencial (200→400). */
export function projectSimceFromLogroPct(logroPct: number): number {
  return projectCanonicalSimce(logroPct)
}

export function simceLevelFromLogroPct(logroPct: number): SimceLevel {
  return agencyAchievementLevelFromLogroPct(logroPct)
}

