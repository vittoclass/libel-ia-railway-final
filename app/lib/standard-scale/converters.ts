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
  const table = tableByYear(year)
  const anchors = scaleType === "simce" ? table.simce : table.paes
  return Math.round(interpolateLinear(Number(logroPct), anchors))
}

// PHASE_2_SCALES_V1
export function nationalLevelLabel(logroPct: number | null | undefined): NationalLevelLabel | null {
  if (logroPct == null || !Number.isFinite(Number(logroPct))) return null
  const pct = clampLogroPct(Number(logroPct))
  if (pct >= 75) return "Adecuado"
  if (pct >= 50) return "Elemental"
  return "Insuficiente"
}
