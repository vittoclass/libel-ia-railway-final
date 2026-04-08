import {
  agencyAchievementLevelFromLogroPct,
  type ChileAgencyAchievementLevel,
} from "@/app/lib/chile-standards/agency-level-cuts"

export type SkillResultAgencyFields = {
  logro_pct: number | null
  achievement_level: ChileAgencyAchievementLevel | null
}

export function logroPctFromSkillScores(scoreObtained: number, scoreMax: number): number | null {
  if (!Number.isFinite(scoreObtained) || !Number.isFinite(scoreMax) || scoreMax <= 0) return null
  const ratio = scoreObtained / scoreMax
  return Math.max(0, Math.min(100, Math.round(ratio * 100)))
}

export function agencyFieldsFromSkillScores(
  scoreObtained: number,
  scoreMax: number
): SkillResultAgencyFields {
  const logro_pct = logroPctFromSkillScores(scoreObtained, scoreMax)
  if (logro_pct == null) return { logro_pct: null, achievement_level: null }
  return {
    logro_pct,
    achievement_level: agencyAchievementLevelFromLogroPct(logro_pct),
  }
}
