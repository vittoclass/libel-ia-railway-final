/**
 * Cortes de nivel de logro alineados a estándar de desempeño por porcentaje (referencia Agencia de Calidad).
 * Umbral: <50% Insuficiente · 50–69% Elemental · ≥70% Adecuado.
 */

export type ChileAgencyAchievementLevel = "Insuficiente" | "Elemental" | "Adecuado"

export function agencyAchievementLevelFromLogroPct(logroPct: number): ChileAgencyAchievementLevel {
  const p = Math.max(0, Math.min(100, Number(logroPct)))
  if (!Number.isFinite(p)) return "Insuficiente"
  if (p < 50) return "Insuficiente"
  if (p < 70) return "Elemental"
  return "Adecuado"
}
