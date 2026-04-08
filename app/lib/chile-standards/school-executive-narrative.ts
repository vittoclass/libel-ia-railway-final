import type { ChileAgencyAchievementLevel } from "@/app/lib/chile-standards/agency-level-cuts"

export type SchoolSkillAggregateRow = {
  skill_name: string
  subject: string | null
  ministerial_skill_code?: string | null
  avg_logro_pct: number | null
  student_result_rows: number
  insuficiente_pct: number
  elemental_pct: number
  adecuado_pct: number
}

/**
 * Texto orientativo para UTP (reglas sobre datos agregados; sin LLM).
 */
export function buildSchoolExecutiveNarrative(input: {
  school_id: string
  evaluation_count: number
  skill_rows: SchoolSkillAggregateRow[]
}): string[] {
  const lines: string[] = []
  if (input.evaluation_count === 0) {
    lines.push("No hay evaluaciones con school_id en el periodo filtrado.")
    return lines
  }
  lines.push(
    `Se analizaron ${input.evaluation_count} evaluación(es) del establecimiento (agregación por habilidad desde resultados por estudiante).`
  )
  const sorted = [...input.skill_rows].filter((r) => r.avg_logro_pct != null).sort((a, b) => (a.avg_logro_pct ?? 0) - (b.avg_logro_pct ?? 0))
  const weakest = sorted.slice(0, 3)
  const strongest = sorted.slice(-3).reverse()
  if (weakest.length > 0) {
    lines.push(
      "Prioridad de refuerzo (menor logro promedio): " +
        weakest.map((w) => `${w.skill_name} (${w.avg_logro_pct}%)`).join("; ") +
        "."
    )
  }
  if (strongest.length > 0 && strongest[0] !== weakest[0]) {
    lines.push(
      "Fortalezas relativas: " + strongest.map((w) => `${w.skill_name} (${w.avg_logro_pct}%)`).join("; ") + "."
    )
  }
  const highRisk = input.skill_rows.filter((r) => r.insuficiente_pct >= 40)
  if (highRisk.length > 0) {
    lines.push(
      `En ${highRisk.length} habilidad(es) más del 40% de los registros están en nivel Insuficiente (<50% logro): conviene revisión curricular coordinada.`
    )
  }
  lines.push(
    "Cortes de nivel aplicados: <50% Insuficiente · 50–69% Elemental · ≥70% Adecuado (por porcentaje de logro por habilidad)."
  )
  return lines
}

export function levelDistributionFromLevels(levels: Array<ChileAgencyAchievementLevel | null | undefined>): {
  insuficiente_pct: number
  elemental_pct: number
  adecuado_pct: number
} {
  const counts = { Insuficiente: 0, Elemental: 0, Adecuado: 0 }
  let n = 0
  for (const l of levels) {
    if (l === "Insuficiente" || l === "Elemental" || l === "Adecuado") {
      counts[l]++
      n++
    }
  }
  if (n === 0) return { insuficiente_pct: 0, elemental_pct: 0, adecuado_pct: 0 }
  return {
    insuficiente_pct: Math.round((counts.Insuficiente / n) * 100),
    elemental_pct: Math.round((counts.Elemental / n) * 100),
    adecuado_pct: Math.round((counts.Adecuado / n) * 100),
  }
}
