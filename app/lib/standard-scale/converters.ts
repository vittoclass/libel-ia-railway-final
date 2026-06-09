import { agencyAchievementLevelFromLogroPct } from "@/app/lib/chile-standards/agency-level-cuts"
import { projectCanonicalSimce } from "@/app/lib/simceProjectionCanonical"
import { NATIONAL_SCALE_TABLE_2026, type NationalScaleAnchor } from "@/app/lib/standard-scale/tables/2026"

// PHASE_2_SCALES_V1
export type NationalScaleType = "simce" | "paes"
// PHASE_2_SCALES_V1
export type NationalLevelLabel = "Insuficiente" | "Elemental" | "Adecuado"

function clampLogroPct(logroPct: number): number {
  if (!Number.isFinite(logroPct)) return 0
  return Math.max(0, Math.min(100, logroPct))
}

function interpolateLinear(logroPct: number, anchors: NationalScaleAnchor[]): number {
  if (!anchors.length) return 0
  const pct = clampLogroPct(logroPct)
  const sorted = [...anchors].sort((a, b) => a.logro_pct - b.logro_pct)
  if (pct <= sorted[0].logro_pct) return sorted[0].score
  if (pct >= sorted[sorted.length - 1].logro_pct) return sorted[sorted.length - 1].score

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (pct >= a.logro_pct && pct <= b.logro_pct) {
      const span = b.logro_pct - a.logro_pct
      if (span <= 0) return a.score
      const ratio = (pct - a.logro_pct) / span
      return a.score + ratio * (b.score - a.score)
    }
  }
  return sorted[sorted.length - 1].score
}

function tableByYear(year: number) {
  // PHASE_2_SCALES_V1
  // LOGICA_ANTERIOR_LOCAL: no existia tabla versionada por anio.
  // Fallback reversible al anio base 2026.
  if (year === 2026) return NATIONAL_SCALE_TABLE_2026
  return NATIONAL_SCALE_TABLE_2026
}

// PHASE_2_SCALES_V1
export function convertToNationalScore(
  logroPct: number | null | undefined,
  scaleType: NationalScaleType,
  year: number = 2026
): number | null {
  if (logroPct == null || !Number.isFinite(Number(logroPct))) return null
  if (scaleType === "simce") {
    return projectCanonicalSimce(Number(logroPct))
  }
  const table = tableByYear(year)
  const raw = Math.round(interpolateLinear(Number(logroPct), table.paes))
  return Math.max(100, Math.min(1000, raw))
}

// PHASE_2_SCALES_V1 — cortes Agencia: <50 · 50–69 · ≥70 (vía agency-level-cuts)
export function nationalLevelLabel(logroPct: number | null | undefined): NationalLevelLabel | null {
  if (logroPct == null || !Number.isFinite(Number(logroPct))) return null
  return agencyAchievementLevelFromLogroPct(Number(logroPct))
}
