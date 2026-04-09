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
  cognitive_level?: string | null
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
  logro_pct: number | null
}

/** Logro agregado por dimensión (habilidad, eje, nivel cognitivo). */
export interface LogroAggregate {
  dimension_value: string
  score_obtained: number
  score_max: number
  logro_pct: number | null
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
  score_total?: number
  score_max_pauta?: number
  grade_chile?: number
  exigencia_pct?: number
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
const EXIGENCIA_DEFAULT_DECIMAL = 0.6

const SKILL_CANONICAL_ALIASES: Record<string, string> = {
  LECTOR: "LECTURA",
  LECTORA: "LECTURA",
  "COMPRENSION LECTORA": "LECTURA",
  "COMPRENSION DE LECTURA": "LECTURA",
  "RESOLUCION DE PROBLEMAS": "RESOLUCION DE PROBLEMAS",
  LOCALIZARINFORMACION: "LOCALIZAR INFORMACION",
}

const AXIS_CANONICAL_ALIASES: Record<string, string> = {
  NUMEROS: "NUMEROS Y OPERACIONES",
  NUMERACION: "NUMEROS Y OPERACIONES",
  LECTOR: "LECTURA",
}

// DATA_NORMALIZATION_V2: normaliza texto pedagogico para usar como llave de agrupacion.
export function normalizePedagogicalText(text: string): string {
  // LOGICA_ANTERIOR_LOCAL: se agrupaba con el texto tal cual.
  try {
    const raw = String(text ?? "")
    const compact = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
    return compact ? compact.toUpperCase() : raw
  } catch {
    // DATA_NORMALIZATION_V2: fallback seguro para no romper render.
    return text
  }
}

function canonicalizePedagogicalDimension(text: string, dimension: "skill" | "axis"): string {
  const normalized = normalizePedagogicalText(text)
  if (!normalized) return normalized
  if (dimension === "skill") return SKILL_CANONICAL_ALIASES[normalized] ?? normalized
  return AXIS_CANONICAL_ALIASES[normalized] ?? normalized
}

/** Misma etiqueta canónica que usan los gráficos de logro pedagógico (habilidad). */
export function canonicalPedagogicalSkillDisplayLabel(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim() || "—"
  const canon = canonicalizePedagogicalDimension(s, "skill")
  return formatPedagogicalDisplayText(canon)
}

// DATA_NORMALIZATION_V2: formato de visualizacion estable (mantiene tildes si existen).
export function formatPedagogicalDisplayText(text: string): string {
  try {
    const raw = String(text ?? "")
    const compact = raw.replace(/\s+/g, " ").trim()
    return compact ? compact.toUpperCase() : raw
  } catch {
    return text
  }
}

// DATA_SCIENCE_FIX_V1: escala chilena partida con exigencia variable.
export function calculateGradeChileSplitScale(
  scoreTotal: number,
  scoreMax: number,
  exigenciaPct?: number
): number {
  // LOGICA_ANTERIOR_LOCAL: no existia calculo de nota en este motor.
  if (!Number.isFinite(scoreTotal) || !Number.isFinite(scoreMax) || scoreMax <= 0) return 1.0
  const exigenciaRaw = Number(exigenciaPct)
  const exigencia =
    Number.isFinite(exigenciaRaw) && exigenciaRaw > 0
      ? Math.min(1, exigenciaRaw > 1 ? exigenciaRaw / 100 : exigenciaRaw)
      : EXIGENCIA_DEFAULT_DECIMAL
  const puntosAprobacion = Math.max(1, Math.ceil(scoreMax * exigencia))
  const puntajeEfectivo = Math.max(0, scoreTotal)
  if (puntajeEfectivo <= 0) return 1.0
  let grade: number
  if (puntajeEfectivo <= puntosAprobacion) {
    const ratio = Math.min(1, puntajeEfectivo / puntosAprobacion)
    grade = 1.0 + 3.0 * Math.pow(ratio, 0.95)
    grade = Math.min(4.0, grade)
  } else {
    const remainingPoints = scoreMax - puntosAprobacion
    if (remainingPoints <= 0) return 7.0
    grade = 4.0 + 3.0 * ((puntajeEfectivo - puntosAprobacion) / remainingPoints)
  }
  return Math.min(7.0, Math.round(grade * 10) / 10)
}

function normalizeScoreObtained(
  item: EvaluationItemRow,
  scoreMax: number
): { obtained: number; max: number } {
  let obtained = Number(item.score_obtained) ?? 0
  // LOGICA_ANTERIOR_LOCAL: let max = Number(item.score_max) ?? scoreMax
  // DATA_SCIENCE_FIX_V1: priorizar denominador de pauta para fidelidad.
  let max = Number(scoreMax)
  if (!Number.isFinite(max)) max = Number(item.score_max)
  if (!Number.isFinite(max) || max < 0) max = 0
  if (Number(item.score_max) === 1 && item.is_correct === true) {
    obtained = 1
    // DATA_SCIENCE_FIX_V1: mantener max de pauta cuando exista.
    max = Number(scoreMax) > 0 ? Number(scoreMax) : Number(item.score_max) > 0 ? Number(item.score_max) : 0
  } else if (item.score_obtained != null || item.score_max != null) {
    obtained = Number(item.score_obtained) || 0
    // LOGICA_ANTERIOR_LOCAL: max = Number(item.score_max) || max
    // DATA_SCIENCE_FIX_V1: no sobreescribir denominador de pauta con score_max dinámico.
    max = Number(scoreMax) > 0 ? Number(scoreMax) : Number(item.score_max) > 0 ? Number(item.score_max) : max
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
  sourceExamItemsEnriched: SourceExamItemWithPedagogy[],
  exigenciaPct?: number
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
    const axisRaw = source?.axis_label?.trim() || "Sin eje"
    const skillLabelDb = (source?.skill_label ?? "").trim()
    const skillRaw =
      skillLabelDb.length > 0 ? skillLabelDb : String(source?.pedagogical?.skill ?? "").trim() || "Sin habilidad"
    const axisCanonical = canonicalizePedagogicalDimension(axisRaw, "axis")
    const skillCanonical = canonicalizePedagogicalDimension(skillRaw, "skill")
    const axis = formatPedagogicalDisplayText(axisCanonical)
    const skill = formatPedagogicalDisplayText(skillCanonical)
    const cognitiveDb = (source?.cognitive_level ?? "").trim()
    const cognitiveLevelRaw =
      cognitiveDb.length > 0 ? cognitiveDb : String(source?.pedagogical?.cognitive_level ?? "").trim() || "aplicar"
    const cognitiveLevel = formatPedagogicalDisplayText(cognitiveLevelRaw)
    const scoreMaxSource = Number(source?.max_score) || 0
    const { obtained, max } = normalizeScoreObtained(ei, scoreMaxSource || 1)
    // LOGICA_ANTERIOR_LOCAL: const logroPct = max > 0 ? Math.round((obtained / max) * 100) : 0
    // DATA_NORMALIZATION_V2: no evaluado (max=0) retorna null.
    const logroPct = max > 0 ? Math.round((obtained / max) * 100) : null

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
    addAgg(skillMap, canonicalizePedagogicalDimension(skill, "skill"), obtained, max)
    addAgg(axisMap, canonicalizePedagogicalDimension(axis, "axis"), obtained, max)
    addAgg(cognitiveMap, cognitiveLevel, obtained, max)
  }

  const toAggregate = (
    map: Map<string, { obtained: number; max: number; count: number }>
  ): LogroAggregate[] =>
    Array.from(map.entries()).map(([dimension_value, v]) => ({
      // DATA_NORMALIZATION_V2: salida visual consistente en mayusculas.
      dimension_value: formatPedagogicalDisplayText(dimension_value),
      score_obtained: v.obtained,
      score_max: v.max,
      // LOGICA_ANTERIOR_LOCAL: v.max > 0 ? Math.round((v.obtained / v.max) * 100) : 0
      logro_pct: v.max > 0 ? Math.round((v.obtained / v.max) * 100) : null,
      question_count: v.count,
    }))

  const by_skill = toAggregate(skillMap)
  const by_axis = toAggregate(axisMap)
  const by_cognitive_level = toAggregate(cognitiveMap)

  const strong_axes = by_axis
    .filter((a) => a.question_count >= MIN_QUESTIONS_FOR_STRENGTH && typeof a.logro_pct === "number" && a.logro_pct >= LOGRO_STRONG_PCT)
    .map((a) => a.dimension_value)
  const weak_axes = by_axis
    .filter((a) => a.question_count >= MIN_QUESTIONS_FOR_STRENGTH && typeof a.logro_pct === "number" && a.logro_pct < LOGRO_WEAK_PCT)
    .map((a) => a.dimension_value)
  const strong_skills = by_skill
    .filter((s) => s.question_count >= MIN_QUESTIONS_FOR_STRENGTH && typeof s.logro_pct === "number" && s.logro_pct >= LOGRO_STRONG_PCT)
    .map((s) => s.dimension_value)
  const weak_skills = by_skill
    .filter((s) => s.question_count >= MIN_QUESTIONS_FOR_STRENGTH && typeof s.logro_pct === "number" && s.logro_pct < LOGRO_WEAK_PCT)
    .map((s) => s.dimension_value)

  const withLevel = by_cognitive_level.filter(
    (c): c is LogroAggregate & { logro_pct: number } =>
      c.score_max > 0 && typeof c.logro_pct === "number"
  )
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

  // DATA_SCIENCE_FIX_V1: denominador fijo según pauta completa, no por cantidad dinámica de ítems respondidos.
  const scoreTotal = byQuestion.reduce((acc, q) => acc + (Number(q.score_obtained) || 0), 0)
  const pautaMaxRaw = sourceExamItemsEnriched.reduce((acc, s) => acc + (Number(s.max_score) || 0), 0)
  const scoreMaxPauta = pautaMaxRaw > 0 ? pautaMaxRaw : byQuestion.reduce((acc, q) => acc + (Number(q.score_max) || 0), 0)
  const gradeChile = calculateGradeChileSplitScale(scoreTotal, scoreMaxPauta, exigenciaPct)

  return {
    evaluation_id: evaluationId,
    has_source_exam: sourceExamItemsEnriched.length > 0,
    score_total: scoreTotal,
    score_max_pauta: scoreMaxPauta,
    grade_chile: gradeChile,
    exigencia_pct:
      Number.isFinite(Number(exigenciaPct)) && Number(exigenciaPct) > 0
        ? Number(exigenciaPct) > 1
          ? Number(exigenciaPct)
          : Number(exigenciaPct) * 100
        : EXIGENCIA_DEFAULT_DECIMAL * 100,
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

  // Una evaluación = un alumno en este flujo. Si hay varias filas by_question con el mismo
  // item_number (duplicados en BD), no se deben sumar como varios errores: se toma el mejor
  // logro_pct del ítem; error = omitido (null) o logro < 100. Así error_count ≤ evaluation_count.
  for (const a of analyses) {
    const bestLogroByItem = new Map<number, number | null>()
    for (const q of a.by_question) {
      const qn = q.item_number
      const v = q.logro_pct
      const prev = bestLogroByItem.get(qn)
      if (prev === undefined) {
        bestLogroByItem.set(qn, v)
      } else if (prev === null || v === null) {
        bestLogroByItem.set(qn, null)
      } else {
        bestLogroByItem.set(qn, Math.max(prev, v))
      }
    }
    for (const [itemNumber, bestLogro] of bestLogroByItem) {
      const failedOrOmitted = bestLogro == null || bestLogro < 100
      if (failedOrOmitted) {
        questionErrors.set(itemNumber, (questionErrors.get(itemNumber) ?? 0) + 1)
      }
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
      dimension_value: formatPedagogicalDisplayText(dimension_value),
      score_obtained: v.obtained,
      score_max: v.max,
      logro_pct: v.max > 0 ? Math.round((v.obtained / v.max) * 100) : null,
      question_count: v.count,
    }))

  const questions_most_errors = Array.from(questionErrors.entries())
    .map(([item_number, error_count]) => ({ item_number, error_count }))
    .sort((a, b) => b.error_count - a.error_count)
    .slice(0, 10)

  const average_by_skill = toAgg(skillAcc)
  const weakest_skills = average_by_skill
    .filter((s) => s.question_count >= 1 && typeof s.logro_pct === "number")
    .map((s) => ({ skill: s.dimension_value, average_logro_pct: Number(s.logro_pct) }))
    .sort((a, b) => Number(a.average_logro_pct) - Number(b.average_logro_pct))
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
