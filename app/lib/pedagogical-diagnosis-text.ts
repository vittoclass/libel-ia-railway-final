/**
 * Generación de texto de diagnóstico pedagógico a partir de datos ya producidos por el sistema.
 * Solo lectura. No modifica análisis, scoring ni evaluación.
 * Consume: by_axis, by_skill, by_cognitive_level, most_failed_questions.
 */
import { formatPedagogicalReadableText, formatQuestionNumbersSpanish } from "@/app/lib/pedagogical-export-formatting"
import {
  buildGroupedRecommendationsDisplay,
  buildHierarchicalGapsDisplay,
  groupEvidenceByCanonicalSkillForDisplay,
} from "@/app/lib/pedagogical-report-presentation"

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
  /** Brechas jerárquicas (solo presentación) */
  hierarchicalGapLines?: string[]
  /** Recomendaciones agrupadas (solo presentación) */
  groupedRecommendationLines?: string[]
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
      `El curso presenta mayor dificultad en el eje "${formatPedagogicalReadableText(weakestAxis.dimension_value)}" (logro ${weakestAxis.logro_pct}%).`
    )
  }

  if (failedQ.length > 0) {
    const nums = formatQuestionNumbersSpanish(failedQ.map((q) => q.item_number))
    const skills = [...new Set(failedQ.map((q) => q.skill).filter(Boolean))]
    const skillText =
      skills.length > 0 ? skills.map((sk) => formatPedagogicalReadableText(String(sk))).join(", ") : "varias habilidades"
    diagnosisParagraphs.push(
      `Las preguntas con mayor porcentaje de error son: ${nums}, asociadas a la(s) habilidad(es) ${skillText}.`
    )
  }

  if (weakestSkill && failedQ.length === 0) {
    diagnosisParagraphs.push(
      `Se observan menores logros en la habilidad "${formatPedagogicalReadableText(weakestSkill.dimension_value)}" (${weakestSkill.logro_pct}%).`
    )
  }

  if (by_cognitive_level.length > 0) {
    const weakCog = by_cognitive_level.filter((c) => c.logro_pct < 70).sort((a, b) => a.logro_pct - b.logro_pct)
    if (weakCog[0]) {
      diagnosisParagraphs.push(
        `En nivel cognitivo, el menor desempeño se da en "${formatPedagogicalReadableText(weakCog[0].dimension_value)}" (${weakCog[0].logro_pct}%).`
      )
    }
  }

  if (failedQ.length > 0) {
    evidenceLines.push("Preguntas:")
    failedQ.forEach((q) => {
      evidenceLines.push(`  ${q.item_number} (${Math.min(100, Math.max(0, Number(q.error_pct)))}% error)`)
    })
    const axes = [...new Set(failedQ.map((q) => q.axis).filter(Boolean))]
    const skills = [...new Set(failedQ.map((q) => q.skill).filter(Boolean))]
    if (axes.length > 0) evidenceLines.push("Eje:", ...axes.map((a) => `  ${formatPedagogicalReadableText(String(a))}`))
    if (skills.length > 0) evidenceLines.push("Habilidad:", ...skills.map((s) => `  ${formatPedagogicalReadableText(String(s))}`))
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
    triangulationMessage = `Se observa un patrón consistente de error en la habilidad "${formatPedagogicalReadableText(skillWithPattern[0])}", evidenciado en múltiples preguntas del curso.`
  }
  if (axisWithPattern && !triangulationMessage) {
    triangulationMessage = `Se observa un patrón consistente de error en el eje "${formatPedagogicalReadableText(axisWithPattern[0])}", evidenciado en múltiples preguntas.`
  }
  if (axisWithPattern && skillWithPattern) {
    triangulationMessage = `Se observa un patrón consistente de error en la habilidad "${formatPedagogicalReadableText(skillWithPattern[0])}", evidenciado en múltiples preguntas del eje ${formatPedagogicalReadableText(axisWithPattern[0])}.`
  }

  const byQuestionFromFailed = failedQ.map((q) => ({
    item_number: q.item_number,
    skill: q.skill,
    axis: q.axis,
  }))

  const hierarchicalGaps = buildHierarchicalGapsDisplay({
    by_axis,
    by_skill,
    by_cognitive_level,
    by_question: byQuestionFromFailed,
  })

  const hierarchicalGapLines: string[] = []
  for (const axis of hierarchicalGaps.axes) {
    hierarchicalGapLines.push(`Eje: ${axis.axisName}`)
    for (const skill of axis.skills) {
      const suffix = skill.evidenceSuffix ? ` · ${skill.evidenceSuffix}` : ""
      hierarchicalGapLines.push(`  Habilidad: ${skill.displayName} (${skill.pct}%${suffix})`)
      if (skill.cognitiveLevels.length > 0) {
        hierarchicalGapLines.push(`  Nivel cognitivo asociado: ${skill.cognitiveLevels.join(" / ")}`)
      }
    }
  }
  for (const cog of hierarchicalGaps.standaloneCognitiveGaps) {
    hierarchicalGapLines.push(`Dificultad cognitiva observada: ${cog.name} (${cog.pct}%)`)
  }

  const groupedRecommendations = buildGroupedRecommendationsDisplay({
    by_axis,
    by_skill,
    by_question: byQuestionFromFailed,
  })
  const groupedRecommendationLines: string[] = []
  for (const group of groupedRecommendations) {
    groupedRecommendationLines.push(group.groupTitle)
    for (const skill of group.skills) {
      const qPart =
        skill.questionNumbers.length > 0
          ? ` (ítems ${formatQuestionNumbersSpanish(skill.questionNumbers)})`
          : ""
      groupedRecommendationLines.push(`  ${skill.name}${qPart}`)
    }
  }

  const weakSkillsGrouped = groupEvidenceByCanonicalSkillForDisplay(
    by_skill.filter((s) => s.logro_pct < 70),
    byQuestionFromFailed,
    "weakness",
  )
  if (weakSkillsGrouped.length > 0 && diagnosisParagraphs.length > 0) {
    const top = weakSkillsGrouped[0]
    const evidenceNote = top.evidenceSuffix ? ` (${top.evidenceSuffix})` : ""
    diagnosisParagraphs.push(
      `La brecha prioritaria por habilidad se concentra en "${top.displayName}" (${top.pct}%${evidenceNote}).`,
    )
  }

  return {
    diagnosisParagraphs: diagnosisParagraphs.length > 0 ? diagnosisParagraphs : ["No hay suficientes datos para generar diagnóstico automático."],
    evidenceLines: evidenceLines.length > 0 ? evidenceLines : [],
    triangulationMessage,
    hierarchicalGapLines: hierarchicalGapLines.length > 0 ? hierarchicalGapLines : undefined,
    groupedRecommendationLines: groupedRecommendationLines.length > 0 ? groupedRecommendationLines : undefined,
  }
}
