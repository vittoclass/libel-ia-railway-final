/**
 * Motor de logro pedagógico: cruza resultados de evaluación con metadata de la prueba base.
 * Solo lectura. No modifica scoring, evaluación ni informe.
 * Mapeo: evaluation_items.question_number = source_exam_items.item_number.
 */
import type { PedagogicalMetadata } from "@/app/lib/analyze-pedagogical-structure"

/** Ítem de evaluación (respuesta del estudiante por pregunta). */
export interface EvaluationItemRow {
  question_number: number
  score_obtained?: number | null
  score_max?: number | null
  is_correct?: boolean | null
  student_answer?: string | null
  correct_answer?: string | null
}

/** Ítem de prueba base con metadata pedagógica (enriquecido por enrichItemsWithPedagogy). */
export interface SourceExamItemWithPedagogy {
  item_number?: number | null
  item_text?: string | null
  axis_label?: string | null
  skill_label?: string | null
  max_score?: number | null
  rubric_text?: string | null
  pedagogical?: PedagogicalMetadata
}

/** Logro por pregunta. */
export interface LogroByQuestion {
  item_number: number
  axis: string
  skill: string
  cognitive_level: string
  score_obtained: number
  score_max: number
  logro_pct: number
}

/** Logro agregado por dimensión (habilidad, eje, nivel cognitivo). */
export interface LogroAggregate {
  dimension_value: string
  score_obtained: number
  score_max: number
  logro_pct: number
  question_count: number
}

/** Resumen por alumno (una evaluación = un estudiante en este flujo). */
export interface StudentPedagogicalSummary {
  strong_axes: string[]
  weak_axes: string[]
  strong_skills: string[]
  weak_skills: string[]
  lowest_cognitive_level: string | null
  highest_cognitive_level: string | null
  by_question: LogroByQuestion[]
  by_skill: LogroAggregate[]
  by_axis: LogroAggregate[]
  by_cognitive_level: LogroAggregate[]
}

/** Resumen por curso (varias evaluaciones agregadas). */
export interface CoursePedagogicalSummary {
  evaluation_count: number
  average_by_axis: LogroAggregate[]
  average_by_skill: LogroAggregate[]
  average_by_cognitive_level: LogroAggregate[]
  questions_most_errors: { item_number: number; error_count: number }[]
  weakest_skills: { skill: string; average_logro_pct: number }[]
}

/** Resultado completo del análisis de una evaluación. */
export interface LearningResultsAnalysis {
  evaluation_id: string
  has_source_exam: boolean
  by_question: LogroByQuestion[]
  by_skill: LogroAggregate[]
  by_axis: LogroAggregate[]
  by_cognitive_level: LogroAggregate[]
  student_summary: StudentPedagogicalSummary | null
  course_summary: CoursePedagogicalSummary | null
}

const LOGRO_STRONG_PCT = 70
const LOGRO_WEAK_PCT = 50
const MIN_QUESTIONS_FOR_STRENGTH = 1

function normalizeScoreObtained(
  item: EvaluationItemRow,
  scoreMax: number
): { obtained: number; max: number } {
  let obtained = Number(item.score_obtained) ?? 0
  let max = Number(item.score_max) ?? scoreMax
  if (max <= 0) max = 1
  if (Number(item.score_max) === 1 && item.is_correct === true) {
    obtained = 1
    max = 1
  } else if (item.score_obtained != null || item.score_max != null) {
    obtained = Number(item.score_obtained) || 0
    max = Number(item.score_max) || max
  }
  return { obtained, max }
}

/**
 * Analiza logro pedagógico cruzando ítems de evaluación con ítems de prueba base enriquecidos.
 * No muta datos. Mapeo por question_number === item_number.
 */
export function analyzeLearningResults(
  evaluationId: string,
  evaluationItems: EvaluationItemRow[],
  sourceExamItemsEnriched: SourceExamItemWithPedagogy[]
): LearningResultsAnalysis {
  const byQuestion: LogroByQuestion[] = []
  const skillMap = new Map<string, { obtained: number; max: number; count: number }>()
  const axisMap = new Map<string, { obtained: number; max: number; count: number }>()
  const cognitiveMap = new Map<string, { obtained: number; max: number; count: number }>()

  const sourceByNumber = new Map<number, SourceExamItemWithPedagogy>()
  for (const s of sourceExamItemsEnriched) {
    const num = Number(s.item_number)
    if (num >= 1) sourceByNumber.set(num, s)
  }

  for (const ei of evaluationItems) {
    const qn = Number(ei.question_number)
    if (Number.isNaN(qn)) continue
    const source = sourceByNumber.get(qn)
    const axis = source?.axis_label?.trim() || "Sin eje"
    const skill = source?.pedagogical?.skill || source?.skill_label?.trim() || "Sin habilidad"
    const cognitiveLevel = source?.pedagogical?.cognitive_level || "aplicar"
    const scoreMaxSource = Number(source?.max_score) || 0
    const { obtained, max } = normalizeScoreObtained(ei, scoreMaxSource || 1)
    const logroPct = max > 0 ? Math.round((obtained / max) * 100) : 0

    byQuestion.push({
      item_number: qn,
      axis,
      skill,
      cognitive_level: cognitiveLevel,
      score_obtained: obtained,
      score_max: max,
      logro_pct: logroPct,
    })

    const addAgg = (
      map: Map<string, { obtained: number; max: number; count: number }>,
      key: string,
      o: number,
      m: number
    ) => {
      const cur = map.get(key) ?? { obtained: 0, max: 0, count: 0 }
      map.set(key, {
        obtained: cur.obtained + o,
        max: cur.max + m,
        count: cur.count + 1,
      })
    }
    addAgg(skillMap, skill, obtained, max)
    addAgg(axisMap, axis, obtained, max)
    addAgg(cognitiveMap, cognitiveLevel, obtained, max)
  }

  const toAggregate = (
    map: Map<string, { obtained: number; max: number; count: number }>
  ): LogroAggregate[] =>
    Array.from(map.entries()).map(([dimension_value, v]) => ({
      dimension_value,
      score_obtained: v.obtained,
      score_max: v.max,
      logro_pct: v.max > 0 ? Math.round((v.obtained / v.max) * 100) : 0,
      question_count: v.count,
    }))

  const by_skill = toAggregate(skillMap)
  const by_axis = toAggregate(axisMap)
  const by_cognitive_level = toAggregate(cognitiveMap)

  const strong_axes = by_axis
    .filter((a) => a.question_count >= MIN_QUESTIONS_FOR_STRENGTH && a.logro_pct >= LOGRO_STRONG_PCT)
    .map((a) => a.dimension_value)
  const weak_axes = by_axis
    .filter((a) => a.question_count >= MIN_QUESTIONS_FOR_STRENGTH && a.logro_pct < LOGRO_WEAK_PCT)
    .map((a) => a.dimension_value)
  const strong_skills = by_skill
    .filter((s) => s.question_count >= MIN_QUESTIONS_FOR_STRENGTH && s.logro_pct >= LOGRO_STRONG_PCT)
    .map((s) => s.dimension_value)
  const weak_skills = by_skill
    .filter((s) => s.question_count >= MIN_QUESTIONS_FOR_STRENGTH && s.logro_pct < LOGRO_WEAK_PCT)
    .map((s) => s.dimension_value)

  const withLevel = by_cognitive_level.filter((c) => c.score_max > 0)
  const lowest =
    withLevel.length > 0
      ? withLevel.reduce((a, b) => (a.logro_pct <= b.logro_pct ? a : b)).dimension_value
      : null
  const highest =
    withLevel.length > 0
      ? withLevel.reduce((a, b) => (a.logro_pct >= b.logro_pct ? a : b)).dimension_value
      : null

  const student_summary: StudentPedagogicalSummary = {
    strong_axes,
    weak_axes,
    strong_skills,
    weak_skills,
    lowest_cognitive_level: lowest,
    highest_cognitive_level: highest,
    by_question: byQuestion,
    by_skill,
    by_axis,
    by_cognitive_level,
  }

  return {
    evaluation_id: evaluationId,
    has_source_exam: sourceExamItemsEnriched.length > 0,
    by_question: byQuestion,
    by_skill,
    by_axis,
    by_cognitive_level,
    student_summary: byQuestion.length > 0 ? student_summary : null,
    course_summary: null,
  }
}

/**
 * Agrega resultados de varias evaluaciones (mismo curso) para resumen por curso.
 */
export function aggregateCourseSummary(
  analyses: LearningResultsAnalysis[]
): CoursePedagogicalSummary | null {
  if (!analyses.length) return null
  const axisAcc = new Map<string, { obtained: number; max: number; count: number }>()
  const skillAcc = new Map<string, { obtained: number; max: number; count: number }>()
  const cognitiveAcc = new Map<string, { obtained: number; max: number; count: number }>()
  const questionErrors = new Map<number, number>()

  for (const a of analyses) {
    for (const q of a.by_question) {
      const key = q.item_number
      const prev = questionErrors.get(key) ?? 0
      if (q.logro_pct < 100) questionErrors.set(key, prev + 1)
    }
    for (const x of a.by_axis) {
      const cur = axisAcc.get(x.dimension_value) ?? { obtained: 0, max: 0, count: 0 }
      axisAcc.set(x.dimension_value, {
        obtained: cur.obtained + x.score_obtained,
        max: cur.max + x.score_max,
        count: cur.count + x.question_count,
      })
    }
    for (const x of a.by_skill) {
      const cur = skillAcc.get(x.dimension_value) ?? { obtained: 0, max: 0, count: 0 }
      skillAcc.set(x.dimension_value, {
        obtained: cur.obtained + x.score_obtained,
        max: cur.max + x.score_max,
        count: cur.count + x.question_count,
      })
    }
    for (const x of a.by_cognitive_level) {
      const cur = cognitiveAcc.get(x.dimension_value) ?? { obtained: 0, max: 0, count: 0 }
      cognitiveAcc.set(x.dimension_value, {
        obtained: cur.obtained + x.score_obtained,
        max: cur.max + x.score_max,
        count: cur.count + x.question_count,
      })
    }
  }

  const toAgg = (
    map: Map<string, { obtained: number; max: number; count: number }>
  ): LogroAggregate[] =>
    Array.from(map.entries()).map(([dimension_value, v]) => ({
      dimension_value,
      score_obtained: v.obtained,
      score_max: v.max,
      logro_pct: v.max > 0 ? Math.round((v.obtained / v.max) * 100) : 0,
      question_count: v.count,
    }))

  const questions_most_errors = Array.from(questionErrors.entries())
    .map(([item_number, error_count]) => ({ item_number, error_count }))
    .sort((a, b) => b.error_count - a.error_count)
    .slice(0, 10)

  const average_by_skill = toAgg(skillAcc)
  const weakest_skills = average_by_skill
    .filter((s) => s.question_count >= 1)
    .map((s) => ({ skill: s.dimension_value, average_logro_pct: s.logro_pct }))
    .sort((a, b) => a.average_logro_pct - b.average_logro_pct)
    .slice(0, 10)

  return {
    evaluation_count: analyses.length,
    average_by_axis: toAgg(axisAcc),
    average_by_skill,
    average_by_cognitive_level: toAgg(cognitiveAcc),
    questions_most_errors,
    weakest_skills,
  }
}
