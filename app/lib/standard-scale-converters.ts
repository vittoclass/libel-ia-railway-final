// SNAPSHOT_NATIONAL_ANALYTICS_V1
/**
 * Conversores de proyección nacional (PAES/SIMCE) desacoplados del scoring base.
 * No altera nota 1.0-7.0 ni OMR; solo transforma porcentaje de logro.
 */

import { agencyAchievementLevelFromLogroPct } from "@/app/lib/chile-standards/agency-level-cuts"
import { projectCanonicalSimce } from "@/app/lib/simceProjectionCanonical"

/** Nivel de desempeño por logro % (cortes Agencia: &lt;50 · 50–69 · ≥70). */
export type SimceLevel = "Adecuado" | "Elemental" | "Insuficiente"

/** Nivel de proyección SIMCE referencial (cortes internos de 4 niveles). */
export type SimceProjectionLevel = "Insuficiente" | "Elemental" | "Adecuado" | "Alto"

/** Nivel de proyección PAES referencial (cortes internos de 4 niveles). */
export type PaesProjectionLevel = "Bajo" | "Medio" | "Alto" | "Avanzado"

export function clampLogroPctFromScores(scoreObtained: number, scoreMax: number): number {
  if (!Number.isFinite(scoreObtained) || !Number.isFinite(scoreMax) || scoreMax <= 0) return 0
  const ratio = scoreObtained / scoreMax
  return Math.max(0, Math.min(100, ratio * 100))
}

export function projectPaesFromLogroPct(logroPct: number): number {
  const pct = Math.max(0, Math.min(100, logroPct))
  /** Piso 100 (escala PAES referencial 100–1000); evita 0 cuando hay logro registrado. */
  return clampPaesReferentialScore(Math.round(100 + (pct / 100) * 900))
}

/** Acota puntaje PAES referencial al rango institucional 100–1000. */
export function clampPaesReferentialScore(score: number): number {
  if (!Number.isFinite(score)) return 100
  return Math.max(100, Math.min(1000, Math.round(score)))
}

/** Acota puntaje SIMCE referencial al rango institucional 200–400. */
export function clampSimceReferentialScore(score: number): number {
  if (!Number.isFinite(score)) return 200
  return Math.max(200, Math.min(400, Math.round(score)))
}

/** Wrapper sobre proyección canónica referencial (200→400). */
export function projectSimceFromLogroPct(logroPct: number): number {
  return projectCanonicalSimce(logroPct)
}

export function simceLevelFromLogroPct(logroPct: number): SimceLevel {
  return agencyAchievementLevelFromLogroPct(logroPct)
}

/** Cortes internos SIMCE referencial: &lt;50 · 50–69 · 70–84 · ≥85. */
export function simceProjectionLevelFromLogroPct(logroPct: number): SimceProjectionLevel {
  const p = Math.max(0, Math.min(100, Number(logroPct)))
  if (!Number.isFinite(p)) return "Insuficiente"
  if (p < 50) return "Insuficiente"
  if (p < 70) return "Elemental"
  if (p < 85) return "Adecuado"
  return "Alto"
}

/** Cortes internos PAES referencial: &lt;40 · 40–59 · 60–79 · ≥80. */
export function paesProjectionLevelFromLogroPct(logroPct: number): PaesProjectionLevel {
  const p = Math.max(0, Math.min(100, Number(logroPct)))
  if (!Number.isFinite(p)) return "Bajo"
  if (p < 40) return "Bajo"
  if (p < 60) return "Medio"
  if (p < 80) return "Alto"
  return "Avanzado"
}

