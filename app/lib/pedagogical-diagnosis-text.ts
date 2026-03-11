/**
 * Generación de texto de diagnóstico pedagógico a partir de datos ya producidos por el sistema.
 * Solo lectura. No modifica análisis, scoring ni evaluación.
 * Consume: by_axis, by_skill, by_cognitive_level, most_failed_questions.
 */

export type HeatMapItem = {
  item_number: number
  logro_pct: number
  /** "green" | "yellow" | "red" según umbrales 70 / 50 */
  level: "green" | "yellow" | "red"
}

/** Reglas: logro ≥ 70% verde, 50–69% amarillo, < 50% rojo */
export function getHeatMapLevel(logro_pct: number): "green" | "yellow" | "red" {
  if (logro_pct >= 70) return "green"
  if (logro_pct >= 50) return "yellow"
  return "red"
}

export type DiagnosisInput = {
  by_axis: Array<{ dimension_value: string; logro_pct: number; question_count?: number }>
  by_skill: Array<{ dimension_value: string; logro_pct: number; question_count?: number }>
  by_cognitive_level: Array<{ dimension_value: string; logro_pct: number; question_count?: number }>
  most_failed_questions: Array<{
    item_number: number
    axis: string
    skill: string
    error_pct: number
    student_count?: number
  }>
}

export type DiagnosisResult = {
  /** Párrafos de diagnóstico automático para mostrar en UI/PDF */
  diagnosisParagraphs: string[]
  /** Líneas de evidencia (preguntas, eje, habilidad) */
  evidenceLines: string[]
  /** Mensaje de triangulación si varias preguntas fallidas comparten eje/habilidad */
  triangulationMessage: string | null
}

/**
 * Genera diagnóstico pedagógico automático a partir de by_axis, by_skill, by_cognitive_level y most_failed_questions.
 */
export function buildPedagogicalDiagnosis(input: DiagnosisInput): DiagnosisResult {
  const { by_axis, by_skill, by_cognitive_level, most_failed_questions } = input
  const diagnosisParagraphs: string[] = []
  const evidenceLines: string[] = []
  let triangulationMessage: string | null = null

  const weakAxis = by_axis.filter((r) => r.logro_pct < 70).sort((a, b) => a.logro_pct - b.logro_pct)
  const weakestAxis = weakAxis[0]
  const failedQ = most_failed_questions.slice(0, 10)
  const weakSkills = by_skill.filter((s) => s.logro_pct < 70).sort((a, b) => a.logro_pct - b.logro_pct)
  const weakestSkill = weakSkills[0]

  if (weakestAxis) {
    diagnosisParagraphs.push(
      `El curso presenta mayor dificultad en el eje "${weakestAxis.dimension_value}" (logro ${weakestAxis.logro_pct}%).`
    )
  }

  if (failedQ.length > 0) {
    const nums = failedQ.map((q) => q.item_number).join(" y ")
    const skills = [...new Set(failedQ.map((q) => q.skill).filter(Boolean))]
    const skillText = skills.length > 0 ? skills.join(", ") : "varias habilidades"
    diagnosisParagraphs.push(
      `Las preguntas con mayor porcentaje de error son ${nums}, asociadas a la(s) habilidad(es) ${skillText}.`
    )
    diagnosisParagraphs.push(
      "Esto sugiere dificultades en tareas de interpretación y resolución de problemas que requieren reforzar."
    )
  }

  if (weakestSkill && failedQ.length === 0) {
    diagnosisParagraphs.push(
      `Se observan menores logros en la habilidad "${weakestSkill.dimension_value}" (${weakestSkill.logro_pct}%).`
    )
  }

  if (by_cognitive_level.length > 0) {
    const weakCog = by_cognitive_level.filter((c) => c.logro_pct < 70).sort((a, b) => a.logro_pct - b.logro_pct)
    if (weakCog[0]) {
      diagnosisParagraphs.push(
        `En nivel cognitivo, el menor desempeño se da en "${weakCog[0].dimension_value}" (${weakCog[0].logro_pct}%).`
      )
    }
  }

  if (failedQ.length > 0) {
    evidenceLines.push("Preguntas:")
    failedQ.forEach((q) => {
      evidenceLines.push(`  ${q.item_number} (${q.error_pct}% error)`)
    })
    const axes = [...new Set(failedQ.map((q) => q.axis).filter(Boolean))]
    const skills = [...new Set(failedQ.map((q) => q.skill).filter(Boolean))]
    if (axes.length > 0) evidenceLines.push("Eje:", ...axes.map((a) => `  ${a}`))
    if (skills.length > 0) evidenceLines.push("Habilidad:", ...skills.map((s) => `  ${s}`))
  }

  const sameAxisCount = new Map<string, number>()
  const sameSkillCount = new Map<string, number>()
  for (const q of failedQ) {
    if (q.axis) sameAxisCount.set(q.axis, (sameAxisCount.get(q.axis) ?? 0) + 1)
    if (q.skill) sameSkillCount.set(q.skill, (sameSkillCount.get(q.skill) ?? 0) + 1)
  }
  const axisWithPattern = [...sameAxisCount.entries()].find(([, count]) => count >= 2)
  const skillWithPattern = [...sameSkillCount.entries()].find(([, count]) => count >= 2)
  if (skillWithPattern) {
    triangulationMessage = `Se observa un patrón consistente de error en la habilidad "${skillWithPattern[0]}", evidenciado en múltiples preguntas del curso.`
  }
  if (axisWithPattern && !triangulationMessage) {
    triangulationMessage = `Se observa un patrón consistente de error en el eje "${axisWithPattern[0]}", evidenciado en múltiples preguntas.`
  }
  if (axisWithPattern && skillWithPattern) {
    triangulationMessage = `Se observa un patrón consistente de error en la habilidad "${skillWithPattern[0]}", evidenciado en múltiples preguntas del eje ${axisWithPattern[0]}.`
  }

  return {
    diagnosisParagraphs: diagnosisParagraphs.length > 0 ? diagnosisParagraphs : ["No hay suficientes datos para generar diagnóstico automático."],
    evidenceLines: evidenceLines.length > 0 ? evidenceLines : [],
    triangulationMessage,
  }
}
