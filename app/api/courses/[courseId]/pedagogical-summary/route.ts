/**
 * GET /api/courses/[courseId]/pedagogical-summary
 * Resumen pedagógico del curso: agrega análisis de todas las evaluaciones del curso.
 * Solo lectura. No modifica scoring, nota ni informe.
 * Devuelve metadata: evaluation_count_total, evaluation_count_with_source_exam,
 * evaluation_count_analyzable, summary_available, status_reason.
 */
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { getSourceExamForEvaluation } from "@/app/lib/source-exam-db"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import {
  analyzeLearningResults,
  aggregateCourseSummary,
  normalizePedagogicalText,
  formatPedagogicalDisplayText,
  type EvaluationItemRow,
  type SourceExamItemWithPedagogy,
  type LearningResultsAnalysis,
  type LogroByQuestion,
} from "@/app/lib/analyze-learning-results"
import {
  clampLogroPctFromScores,
  projectPaesFromLogroPct,
  projectSimceFromLogroPct,
  simceLevelFromLogroPct,
  type SimceLevel,
} from "@/app/lib/standard-scale-converters"
import { getInstrumentAnalyticsModeFromExamType, type InstrumentAnalyticsMode } from "@/app/lib/assessment-category"
import { buildCourseQualityMetrics } from "@/app/lib/pedagogical-intelligence/metrics"
import type { CourseStudentMetricInput } from "@/app/lib/pedagogical-intelligence/types"
import type { SupabaseClient } from "@supabase/supabase-js"
import { agencyAchievementLevelFromLogroPct } from "@/app/lib/chile-standards/agency-level-cuts"
import {
  inferSubjectForChileDictionary,
  resolveChileMinisterialSkillCode,
  resolveChileSkillTrace,
} from "@/app/lib/chile-standards/evaluation-dictionary"

export const dynamic = "force-dynamic"

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"
// SNAPSHOT_NATIONAL_ANALYTICS_V1
const ENABLE_NATIONAL_ANALYTICS =
  process.env.ENABLE_NATIONAL_ANALYTICS === "true" || process.env.ENABLE_NATIONAL_ANALYTICS === "1"

type StatusReason =
  | "ok"
  | "no_evaluations_in_course"
  | "evaluations_found_but_none_associated"
  | "evaluations_associated_but_no_items"

type NationalAnalyticsRow = {
  evaluation_id: string
  student_name: string
  note_7: number | null
  score_obtained: number
  score_max: number
  logro_pct: number | null
  /** Solo modo PAES; null si instrumento es SIMCE u otro. */
  paes_score: number | null
  /** Solo modo SIMCE; null si instrumento es PAES u otro. */
  simce_score: number | null
  /** Nivel estilo Agencia/SIMCE; null si instrumento es PAES u otro. */
  simce_level: SimceLevel | null
  instrument_analytics_mode: InstrumentAnalyticsMode
}

type DimensionKey = "axis" | "skill" | "cognitive_level"
type ExamMode = "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"

type ItemAnalysisCourseRow = {
  item_number: number
  correct_answer: string | null
  pct_correct: number
  pct_wrong: number
  pct_omitted: number
  biserial_xc: number | null
  distractors: { A: number; B: number; C: number; D: number; E: number }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function normalizeOption(raw: unknown): "A" | "B" | "C" | "D" | "E" | null {
  if (raw == null) return null
  const s = String(raw).trim().toUpperCase()
  if (s === "A" || s === "B" || s === "C" || s === "D" || s === "E") return s
  return null
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2 || ys.length !== n) return null
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let denX = 0
  let denY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  if (denX <= 0 || denY <= 0) return null
  return num / Math.sqrt(denX * denY)
}

/** Colapsa filas duplicadas (mismo evaluation_id + question_number) para no inflar totales ni %. */
function dedupeEvaluationItemsForCourseAnalysis(
  items: Array<{
    evaluation_id: string
    question_number: number | null
    student_answer: string | null
    correct_answer: string | null
    is_correct: boolean | null
  }>
): Array<{
  evaluation_id: string
  question_number: number
  student_answer: string | null
  correct_answer: string | null
  is_correct: boolean | null
}> {
  const map = new Map<
    string,
    {
      evaluation_id: string
      question_number: number
      student_answer: string | null
      correct_answer: string | null
      is_correct: boolean | null
    }
  >()
  for (const row of items) {
    const qn = Number(row.question_number)
    if (!Number.isFinite(qn) || qn <= 0) continue
    const k = `${String(row.evaluation_id)}:${qn}`
    const prev = map.get(k)
    if (!prev) {
      map.set(k, {
        evaluation_id: String(row.evaluation_id),
        question_number: qn,
        student_answer: row.student_answer,
        correct_answer: row.correct_answer,
        is_correct: row.is_correct,
      })
      continue
    }
    const anyCorrect = prev.is_correct === true || row.is_correct === true
    const mergedCorrect: boolean | null = anyCorrect
      ? true
      : prev.is_correct === false || row.is_correct === false
        ? false
        : null
    const sa =
      prev.student_answer != null && String(prev.student_answer).trim() !== ""
        ? prev.student_answer
        : row.student_answer
    const ca =
      prev.correct_answer != null && String(prev.correct_answer).trim() !== ""
        ? prev.correct_answer
        : row.correct_answer
    map.set(k, {
      evaluation_id: String(row.evaluation_id),
      question_number: qn,
      student_answer: sa,
      correct_answer: ca,
      is_correct: mergedCorrect,
    })
  }
  return Array.from(map.values())
}

function computeCourseItemAnalysis(params: {
  items: Array<{
    evaluation_id: string
    question_number: number | null
    student_answer: string | null
    correct_answer: string | null
    is_correct: boolean | null
  }>
  totalScoreByEvaluation: Map<string, number>
}): ItemAnalysisCourseRow[] {
  const itemsDeduped = dedupeEvaluationItemsForCourseAnalysis(params.items)
  const byQuestion = new Map<
    number,
    {
      rows: Array<{ evaluation_id: string; correct01: number; studentOpt: "A" | "B" | "C" | "D" | "E" | null; correctOpt: "A" | "B" | "C" | "D" | "E" | null }>
      correctByOption: Record<string, number>
    }
  >()

  for (const row of itemsDeduped) {
    const qn = row.question_number
    const correctOpt = normalizeOption(row.correct_answer)
    const studentOpt = normalizeOption(row.student_answer)
    const correct01 = row.is_correct === true ? 1 : 0
    const cur = byQuestion.get(qn) ?? { rows: [], correctByOption: {} }
    if (correctOpt) cur.correctByOption[correctOpt] = (cur.correctByOption[correctOpt] ?? 0) + 1
    cur.rows.push({
      evaluation_id: String(row.evaluation_id),
      correct01,
      studentOpt,
      correctOpt,
    })
    byQuestion.set(qn, cur)
  }

  const out: ItemAnalysisCourseRow[] = []
  for (const [item_number, bucket] of byQuestion) {
    const total = bucket.rows.length
    if (total === 0) continue
    let correctCount = 0
    let omitCount = 0
    const dist = { A: 0, B: 0, C: 0, D: 0, E: 0 }
    const xs: number[] = []
    const ys: number[] = []
    for (const r of bucket.rows) {
      if (r.correct01 === 1) correctCount += 1
      if (!r.studentOpt) {
        omitCount += 1
      } else {
        dist[r.studentOpt] += 1
      }
      xs.push(r.correct01)
      ys.push(Number(params.totalScoreByEvaluation.get(r.evaluation_id) ?? 0))
    }
    const wrongCount = total - correctCount - omitCount
    const biserial = pearsonCorrelation(xs, ys)
    const majorityCorrectAnswer = Object.entries(bucket.correctByOption).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    out.push({
      item_number,
      correct_answer: majorityCorrectAnswer,
      pct_correct: round1(Math.min(100, (correctCount / total) * 100)),
      pct_wrong: round1(Math.min(100, (wrongCount / total) * 100)),
      pct_omitted: round1(Math.min(100, (omitCount / total) * 100)),
      biserial_xc: biserial == null ? null : Math.round(biserial * 1000) / 1000,
      distractors: {
        A: round1(Math.min(100, (dist.A / total) * 100)),
        B: round1(Math.min(100, (dist.B / total) * 100)),
        C: round1(Math.min(100, (dist.C / total) * 100)),
        D: round1(Math.min(100, (dist.D / total) * 100)),
        E: round1(Math.min(100, (dist.E / total) * 100)),
      },
    })
  }
  return out.sort((a, b) => a.item_number - b.item_number)
}

function dominantSubjectFromEvaluations(evals: Array<{ subject?: string | null }>): string {
  const m = new Map<string, number>()
  for (const e of evals) {
    const s = String(e.subject ?? "").trim() || "Lenguaje"
    m.set(s, (m.get(s) ?? 0) + 1)
  }
  let best = "Lenguaje"
  let c = 0
  for (const [k, v] of m) {
    if (v > c) {
      best = k
      c = v
    }
  }
  return best
}

function enrichSkillAggregateForChile(
  row: { dimension_value: string; logro_pct: number | null; question_count: number },
  subjectModes: string
) {
  const subj = inferSubjectForChileDictionary(subjectModes)
  const label = pickLabel(row.dimension_value, "Sin habilidad")
  const trace = resolveChileSkillTrace(subj, label)
  const logro = row.logro_pct
  const achievement_level =
    logro == null || !Number.isFinite(Number(logro))
      ? null
      : agencyAchievementLevelFromLogroPct(Number(logro))
  return {
    ...row,
    achievement_level,
    chile_eje_tematico: trace?.eje_tematico ?? null,
    chile_indicador_code: trace?.indicador_simce_paes_code ?? null,
    chile_indicador_descriptor: trace?.indicador_simce_paes_descriptor ?? null,
    chile_ministerial_skill_code: resolveChileMinisterialSkillCode(subj, label),
  }
}

function enrichAxisAggregateForChile(row: {
  dimension_value: string
  logro_pct: number | null
  question_count: number
}) {
  const logro = row.logro_pct
  const achievement_level =
    logro == null || !Number.isFinite(Number(logro))
      ? null
      : agencyAchievementLevelFromLogroPct(Number(logro))
  return {
    ...row,
    achievement_level,
    chile_eje_tematico: pickLabel(row.dimension_value, "Sin eje"),
    chile_indicador_code: null as string | null,
    chile_indicador_descriptor: null as string | null,
  }
}

function pickLabel(value: unknown, fallback: string): string {
  if (value == null) return fallback
  if (typeof value === "string") return value.trim() || fallback
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const candidate =
      (typeof obj.descripcion === "string" && obj.descripcion) ||
      (typeof obj.label === "string" && obj.label) ||
      (typeof obj.nombre === "string" && obj.nombre) ||
      (typeof obj.name === "string" && obj.name) ||
      (typeof obj.titulo === "string" && obj.titulo) ||
      (typeof obj.title === "string" && obj.title) ||
      ""
    return candidate.trim() || fallback
  }
  return fallback
}

function buildAggregatesFromByQuestion(
  byQuestion: LogroByQuestion[],
  dimension: DimensionKey
) {
  const acc = new Map<string, { display: string; obtained: number; max: number; count: number }>()
  for (const q of byQuestion) {
    const fallback =
      dimension === "axis" ? "Sin eje" : dimension === "skill" ? "Sin habilidad" : "aplicar"
    const raw = formatPedagogicalDisplayText(pickLabel(q[dimension], fallback))
    // DATA_NORMALIZATION_V2: llave normalizada para fusionar textos equivalentes.
    const key = normalizePedagogicalText(raw)
    const cur = acc.get(key) ?? { display: raw, obtained: 0, max: 0, count: 0 }
    const shouldReplaceDisplay = cur.display === key && /[ÁÉÍÓÚÜÑ]/.test(raw)
    acc.set(key, {
      // DATA_NORMALIZATION_V2: prioriza variante con acento si aparece.
      display: shouldReplaceDisplay ? raw : (cur.display || raw),
      obtained: cur.obtained + (Number(q.score_obtained) || 0),
      max: cur.max + (Number(q.score_max) || 0),
      count: cur.count + 1,
    })
  }
  return Array.from(acc.values()).map((v) => ({
    dimension_value: v.display,
    score_obtained: v.obtained,
    score_max: v.max,
    // LOGICA_ANTERIOR_LOCAL: ... : 0
    // DATA_NORMALIZATION_V2: no evaluado => null
    logro_pct: v.max > 0 ? Math.round((v.obtained / v.max) * 100) : null,
    question_count: v.count,
  }))
}

function buildFallbackByQuestionFromEvaluationItems(items: EvaluationItemRow[]): LogroByQuestion[] {
  return items.map((item, idx) => {
    const qnRaw = Number(item.question_number)
    const qn = Number.isFinite(qnRaw) && qnRaw > 0 ? qnRaw : idx + 1
    const scoreObtained = Number(item.score_obtained)
    const scoreMax = Number(item.score_max)
    const safeMax = Number.isFinite(scoreMax) && scoreMax > 0 ? scoreMax : 1
    const safeObtained = Number.isFinite(scoreObtained)
      ? scoreObtained
      : item.is_correct === true
        ? 1
        : 0
    return {
      item_number: qn,
      axis: "Sin eje",
      skill: "Sin habilidad",
      cognitive_level: "aplicar",
      score_obtained: safeObtained,
      score_max: safeMax,
      logro_pct: safeMax > 0 ? Math.round((safeObtained / safeMax) * 100) : null,
    }
  })
}

function sanitizeAnalysis(analysis: LearningResultsAnalysis): LearningResultsAnalysis {
  const sanitizedByQuestion: LogroByQuestion[] = analysis.by_question.map((q) => ({
    ...q,
    axis: pickLabel(q.axis, "Sin eje"),
    skill: pickLabel(q.skill, "Sin habilidad"),
    cognitive_level: pickLabel(q.cognitive_level, "aplicar"),
  }))
  return {
    ...analysis,
    by_question: sanitizedByQuestion,
    by_axis: buildAggregatesFromByQuestion(sanitizedByQuestion, "axis"),
    by_skill: buildAggregatesFromByQuestion(sanitizedByQuestion, "skill"),
    by_cognitive_level: buildAggregatesFromByQuestion(sanitizedByQuestion, "cognitive_level"),
  }
}

/** Obtiene el análisis pedagógico de una evaluación (misma lógica que GET pedagogical-analysis). */
async function fetchAnalysisForEvaluation(
  supabase: SupabaseClient,
  evaluationId: string
): Promise<LearningResultsAnalysis> {
  const sourceExamId = await getSourceExamForEvaluation(supabase, evaluationId)
  const [itemsRes, sourceItemsRes] = await Promise.all([
    supabase
      .from("evaluation_items")
      .select("question_number, score_obtained, score_max, is_correct, student_answer, correct_answer")
      .eq("evaluation_id", evaluationId)
      .order("question_number", { ascending: true }),
    sourceExamId
      ? supabase
          .from("source_exam_items")
          .select("id, item_number, item_text, axis_label, skill_label, cognitive_level, max_score, rubric_text, question_type")
          .eq("source_exam_id", sourceExamId)
          .order("item_number", { ascending: true })
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])
  const evaluationItems = (itemsRes.data ?? []) as EvaluationItemRow[]
  const sourceItemsRaw = (sourceItemsRes.data ?? []) as SourceExamItemWithPedagogy[]
  const sourceItemsNormalized = sourceItemsRaw.map((s, idx) => {
    const rawNum = Number(s.item_number)
    const safeItemNumber = Number.isFinite(rawNum) && rawNum > 0 ? rawNum : idx + 1
    return { ...s, item_number: safeItemNumber }
  })
  const sourceExamItemsEnriched =
    sourceItemsNormalized.length > 0
      ? enrichItemsWithPedagogy(sourceItemsNormalized)
      : ([] as SourceExamItemWithPedagogy[])
  const analysis = analyzeLearningResults(evaluationId, evaluationItems, sourceExamItemsEnriched)
  const sourceByItem = new Map<number, SourceExamItemWithPedagogy>()
  for (const s of sourceExamItemsEnriched) {
    const n = Number(s.item_number)
    if (Number.isFinite(n) && n > 0) sourceByItem.set(n, s)
  }
  const existingItems = new Set<number>(analysis.by_question.map((q) => q.item_number))
  const normalizedByQuestion = analysis.by_question.map((q) => {
    const src = sourceByItem.get(q.item_number)
    const srcAxis = src?.axis_label != null && String(src.axis_label).trim() !== "" ? String(src.axis_label).trim() : null
    const srcSkill = src?.skill_label != null && String(src.skill_label).trim() !== "" ? String(src.skill_label).trim() : null
    const srcCog =
      src?.cognitive_level != null && String(src.cognitive_level).trim() !== ""
        ? String(src.cognitive_level).trim()
        : null
    const axis =
      q.axis === "Sin eje" && srcAxis
        ? srcAxis
        : q.axis
    const skill =
      q.skill === "Sin habilidad" && srcSkill
        ? srcSkill
        : q.skill
    const cognitive =
      q.cognitive_level === "aplicar" && srcCog
        ? srcCog
        : q.cognitive_level
    return { ...q, axis, skill, cognitive_level: cognitive }
  })
  const completedByQuestion = [...normalizedByQuestion]
  for (const [itemNo, src] of sourceByItem.entries()) {
    if (existingItems.has(itemNo)) continue
    const axis = String(src.axis_label ?? "").trim() || "Sin eje"
    const skill = String(src.skill_label ?? "").trim() || String(src.pedagogical?.skill ?? "").trim() || "Sin habilidad"
    const cognitive =
      String(src.cognitive_level ?? "").trim() ||
      String(src.pedagogical?.cognitive_level ?? "").trim() ||
      "aplicar"
    const max = Number(src.max_score)
    completedByQuestion.push({
      item_number: itemNo,
      axis,
      skill,
      cognitive_level: cognitive,
      score_obtained: 0,
      score_max: Number.isFinite(max) && max > 0 ? max : 1,
      logro_pct: 0,
    })
  }
  const completedAnalysis: LearningResultsAnalysis = {
    ...analysis,
    by_question: completedByQuestion.sort((a, b) => a.item_number - b.item_number),
  }

  // SNAPSHOT_NATIONAL_ANALYTICS_V1: fallback robusto si no hay match question_number<->item_number
  if (completedAnalysis.by_question.length === 0 && evaluationItems.length > 0) {
    const fallbackByQuestion = buildFallbackByQuestionFromEvaluationItems(evaluationItems)
    const fallbackAnalysis: LearningResultsAnalysis = {
      ...completedAnalysis,
      by_question: fallbackByQuestion,
      by_axis: buildAggregatesFromByQuestion(fallbackByQuestion, "axis"),
      by_skill: buildAggregatesFromByQuestion(fallbackByQuestion, "skill"),
      by_cognitive_level: buildAggregatesFromByQuestion(fallbackByQuestion, "cognitive_level"),
    }
    return sanitizeAnalysis(fallbackAnalysis)
  }

  return sanitizeAnalysis(completedAnalysis)
}

/** Encuentra axis y skill para un item_number en la lista de by_question. */
function findAxisAndSkill(
  byQuestion: LogroByQuestion[],
  itemNumber: number
): { axis: string; skill: string } {
  const q = byQuestion.find((x) => x.item_number === itemNumber)
  return q
    ? { axis: pickLabel(q.axis, "Sin eje"), skill: pickLabel(q.skill, "Sin habilidad") }
    : { axis: "Sin eje", skill: "Sin habilidad" }
}

function toNationalAnalyticsRows(params: {
  analyses: LearningResultsAnalysis[]
  evaluationIds: string[]
  maxFallbackByEvaluation: Map<string, number>
  studentByEvaluation: Map<string, string>
  noteByEvaluation: Map<string, number>
  examTypeByEvaluationId: Map<string, string | null>
}): NationalAnalyticsRow[] {
  const rows: NationalAnalyticsRow[] = []
  const byEvaluationId = new Map(params.analyses.map((a) => [a.evaluation_id, a]))
  for (const evaluationId of params.evaluationIds) {
    const a = byEvaluationId.get(evaluationId)
    const score_obtained = a
      ? a.by_question.reduce((s, q) => s + (Number(q.score_obtained) || 0), 0)
      : 0
    const score_max_raw = a
      ? a.by_question.reduce((s, q) => s + (Number(q.score_max) || 0), 0)
      : 0
    // SNAPSHOT_NATIONAL_ANALYTICS_V1: escala dinamica universal por prioridad pauta->items
    const score_max_fallback = params.maxFallbackByEvaluation.get(evaluationId) ?? 0
    const score_max = score_max_raw > 0 ? score_max_raw : score_max_fallback
    const logro_pct = score_max > 0 ? Math.round(clampLogroPctFromScores(score_obtained, score_max)) : null
    const mode = getInstrumentAnalyticsModeFromExamType(params.examTypeByEvaluationId.get(evaluationId))
    const lp = Number(logro_pct ?? 0)
    let paes_score: number | null = null
    let simce_score: number | null = null
    let simce_level: SimceLevel | null = null
    if (mode === "SIMCE") {
      simce_score = projectSimceFromLogroPct(lp)
      simce_level = simceLevelFromLogroPct(lp)
    } else if (mode === "PAES") {
      paes_score = projectPaesFromLogroPct(lp)
    }
    rows.push({
      evaluation_id: evaluationId,
      student_name: params.studentByEvaluation.get(evaluationId) ?? "Estudiante",
      note_7: params.noteByEvaluation.get(evaluationId) ?? null,
      score_obtained,
      score_max,
      logro_pct,
      paes_score,
      simce_score,
      simce_level,
      instrument_analytics_mode: mode,
    })
  }
  return rows
}

function toCourseStudentMetricInputs(analyses: LearningResultsAnalysis[]): CourseStudentMetricInput[] {
  return analyses.map((a) => {
    const totalScore = a.by_question.reduce((sum, q) => sum + (Number(q.score_obtained) || 0), 0)
    const maxScore = a.by_question.reduce((sum, q) => sum + (Number(q.score_max) || 0), 0)
    const totalLogroPct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : null
    return {
      // PHASE_1_METRICS_V1: cada evaluacion representa una observacion de alumno en este flujo.
      student_id: a.evaluation_id,
      total_score: totalScore,
      max_score: maxScore,
      total_logro_pct: totalLogroPct,
      by_item: a.by_question.map((q) => ({
        item_number: q.item_number,
        is_correct:
          Number(q.score_max) > 0
            ? (Number(q.score_obtained) || 0) >= (Number(q.score_max) || 0)
            : null,
      })),
    }
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const { courseId } = await params
  if (!courseId) {
    return NextResponse.json({ error: "courseId requerido" }, { status: 400 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const teacherId = profile?.teacher_id ?? null
  const schoolId = profile?.school_id ?? null
  const roleNorm = String(profile?.role ?? "").trim().toLowerCase()
  const canViewSchoolScope = roleNorm === "admin" || roleNorm === "utp" || roleNorm === "direccion"
  if (!teacherId && !(canViewSchoolScope && schoolId)) {
    return NextResponse.json({ error: "Completa tu perfil" }, { status: 403 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const normalizedCourse =
    courseId === "_" || courseId === "Sin%20curso" ? "Sin curso" : decodeURIComponent(courseId)

  let evaluationsQuery = supabase
    .from("evaluations")
    .select("id, course_id, course_label, exam_type, subject, school_id")
    .order("evaluated_at", { ascending: false })
  if (canViewSchoolScope && schoolId) {
    evaluationsQuery = evaluationsQuery.eq("school_id", schoolId)
  } else {
    evaluationsQuery = evaluationsQuery.eq("teacher_id", teacherId as string)
  }
  const { data: evaluations, error: evError } = await evaluationsQuery

  if (evError) {
    return NextResponse.json({ error: evError.message }, { status: 500 })
  }

  const all = (evaluations ?? []) as Array<{
    id: string
    course_id: string | null
    course_label?: string | null
    exam_type?: string | null
    subject?: string | null
    school_id?: string | null
  }>
  const normalizeCourseKey = (v: unknown): string =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")

  // SNAPSHOT_NATIONAL_ANALYTICS_V1: busqueda hibrida course_id o course_label
  const targetCourseKey = normalizeCourseKey(normalizedCourse)
  const filtered = all.filter((e) => {
    const byCourseId = e.course_id != null && String(e.course_id).trim() !== ""
      ? normalizeCourseKey(String(e.course_id))
      : normalizeCourseKey("Sin curso")
    const byCourseLabel = normalizeCourseKey(e.course_label ?? "")
    return byCourseId === targetCourseKey || byCourseLabel === targetCourseKey
  })

  // SNAPSHOT_NATIONAL_ANALYTICS_V1: fallback seguro para curso URL cuando hay evaluaciones sin curso
  const filteredWithUrlFallback =
    filtered.length > 0 || normalizedCourse === "Sin curso"
      ? filtered
      : all.filter((e) => e.course_id == null || String(e.course_id).trim() === "")

  const examTypeParam = req.nextUrl.searchParams.get("exam_type")?.trim() ?? ""
  const examNorm = examTypeParam.toLowerCase()
  const courseEvalsForSummary = examNorm
    ? filteredWithUrlFallback.filter(
        (e) => String(e.exam_type ?? "").trim().toLowerCase() === examNorm
      )
    : filteredWithUrlFallback

  const evaluationIds = courseEvalsForSummary.map((e) => e.id)
  const subjectModes = dominantSubjectFromEvaluations(courseEvalsForSummary)
  const emptyNationalAnalytics = {
    enabled: ENABLE_NATIONAL_ANALYTICS,
    by_evaluation: [] as NationalAnalyticsRow[],
    course_summary: {
      average_note_7: null as number | null,
      average_logro_pct: 0,
      average_paes: 100,
      average_simce: 0,
      simce_distribution: {
        Adecuado: 0,
        Elemental: 0,
        Insuficiente: 0,
      } as Record<SimceLevel, number>,
    },
  }
  const analyticsModeByEval = courseEvalsForSummary.map((e) =>
    getInstrumentAnalyticsModeFromExamType(e.exam_type)
  )
  const analyticsMode: ExamMode =
    analyticsModeByEval.filter((m) => m === "PAES").length >=
    analyticsModeByEval.filter((m) => m === "SIMCE").length
      ? "PAES"
      : "SIMCE"
  if (evaluationIds.length === 0) {
    const payload = {
      course: normalizedCourse,
      evaluation_count: 0,
      evaluation_count_total: 0,
      evaluation_count_with_source_exam: 0,
      evaluation_count_analyzable: 0,
      evaluation_count_without_source_exam: 0,
      evaluation_count_without_items: 0,
      summary_available: false,
      status_reason: "no_evaluations_in_course" as StatusReason,
      student_count: 0,
      by_axis: [],
      by_skill: [],
      by_cognitive_level: [],
      weakest_skills: [],
      weakest_axes: [],
      most_failed_questions: [],
      question_heat_map: [],
      item_analysis_course: [],
      analytics_mode: analyticsMode,
      national_analytics: emptyNationalAnalytics,
      exam_type_filter: examTypeParam || null,
    }
    if (isDev) console.info("[pedagogical-summary]", { courseId, normalizedCourse, ...payload })
    return NextResponse.json(payload, { status: 200, headers: { "Cache-Control": "no-store" } })
  }

  /** Paso 1: metadata por evaluación (prueba base + conteos) para logs y conteos. */
  const evalsMeta: Array<{
    id: string
    course_id: string | null
    has_source_exam: boolean
    evaluation_items_count: number
    source_exam_items_count: number
  }> = []
  for (const e of courseEvalsForSummary) {
    const sourceExamId = await getSourceExamForEvaluation(supabase, e.id)
    let evaluation_items_count = 0
    let source_exam_items_count = 0
    const [itemsRes, sourceRes] = await Promise.all([
      supabase.from("evaluation_items").select("question_number", { count: "exact", head: true }).eq("evaluation_id", e.id),
      sourceExamId
        ? supabase.from("source_exam_items").select("id", { count: "exact", head: true }).eq("source_exam_id", sourceExamId)
        : Promise.resolve({ count: 0 }),
    ])
    evaluation_items_count = itemsRes.count ?? 0
    source_exam_items_count = sourceExamId ? (sourceRes.count ?? 0) : 0
    evalsMeta.push({
      id: e.id,
      course_id: e.course_id,
      has_source_exam: !!sourceExamId,
      evaluation_items_count,
      source_exam_items_count,
    })
  }

  let studentCount = 0
  const studentsRes = await supabase
    .from("evaluation_students")
    .select("evaluation_id, student_name")
    .in("evaluation_id", evaluationIds)
  const students = (studentsRes.data ?? []) as Array<{ evaluation_id: string; student_name?: string | null }>
  studentCount = students.length
  const studentByEvaluation = new Map<string, string>()
  for (const row of students) {
    const evId = String(row.evaluation_id ?? "").trim()
    if (!evId || studentByEvaluation.has(evId)) continue
    const n = String(row.student_name ?? "").trim()
    studentByEvaluation.set(evId, n || "Estudiante")
  }

  const summariesRes = await supabase
    .from("evaluation_summaries")
    .select("evaluation_id, grade_chile")
    .in("evaluation_id", evaluationIds)
  const summaries = (summariesRes.data ?? []) as Array<{ evaluation_id: string; grade_chile?: number | null }>
  const noteByEvaluation = new Map<string, number>()
  for (const s of summaries) {
    const evId = String(s.evaluation_id ?? "").trim()
    const note = Number(s.grade_chile)
    if (!evId || !Number.isFinite(note)) continue
    noteByEvaluation.set(evId, note)
  }

  const analyses: LearningResultsAnalysis[] = []
  for (const evaluationId of evaluationIds) {
    const analysis = await fetchAnalysisForEvaluation(supabase, evaluationId)
    analyses.push(analysis)
  }
  const totalScoreByEvaluation = new Map<string, number>()
  for (const a of analyses) {
    const totalScore = a.by_question.reduce((sum, q) => sum + (Number(q.score_obtained) || 0), 0)
    totalScoreByEvaluation.set(a.evaluation_id, totalScore)
  }
  const allItemsRes = await supabase
    .from("evaluation_items")
    .select("evaluation_id, question_number, student_answer, correct_answer, is_correct")
    .in("evaluation_id", evaluationIds)
  const itemRows = (allItemsRes.data ?? []) as Array<{
    evaluation_id: string
    question_number: number | null
    student_answer: string | null
    correct_answer: string | null
    is_correct: boolean | null
  }>
  const itemAnalysisCourse = computeCourseItemAnalysis({
    items: itemRows,
    totalScoreByEvaluation,
  })
  // PHASE_1_METRICS_V1: integración silenciosa de métricas de calidad (sin cambios de UI en esta fase).
  const phase1Metrics = buildCourseQualityMetrics(toCourseStudentMetricInputs(analyses))

  const evaluation_count_with_source_exam = evalsMeta.filter((m) => m.has_source_exam).length
  const evaluation_count_analyzable = analyses.filter((a) => a.by_question.length > 0).length
  const evaluation_count_total = courseEvalsForSummary.length
  const evaluation_count_without_source_exam = evaluation_count_total - evaluation_count_with_source_exam
  const evaluation_count_without_items = evalsMeta.filter(
    (m) => m.has_source_exam && (m.evaluation_items_count === 0 || m.source_exam_items_count === 0)
  ).length

  let status_reason: StatusReason = "ok"
  if (evaluation_count_with_source_exam === 0) status_reason = "evaluations_found_but_none_associated"
  else if (evaluation_count_analyzable === 0) status_reason = "evaluations_associated_but_no_items"

  const summary_available = evaluation_count_analyzable > 0

  const evalsMetaWithIncluded: Array<{
    id: string
    course_id: string | null
    has_source_exam: boolean
    evaluation_items_count: number
    source_exam_items_count: number
    included_in_summary: boolean
    exclusion_reason?: string
  }> = evalsMeta.map((m) => {
    const analysis = analyses.find((a) => a.evaluation_id === m.id)
    const included = (analysis?.by_question.length ?? 0) > 0
    let exclusion_reason: string | undefined
    if (!included) {
      if (!m.has_source_exam) exclusion_reason = "no_source_exam"
      else if (m.evaluation_items_count === 0) exclusion_reason = "no_evaluation_items"
      else if (m.source_exam_items_count === 0) exclusion_reason = "no_source_exam_items"
      else exclusion_reason = "no_matching_items"
    }
    return {
      ...m,
      included_in_summary: included,
      exclusion_reason,
    }
  })

  if (isDev) {
    console.info("[pedagogical-summary]", {
      courseId,
      normalizedCourse,
      evaluation_count_total,
      evaluation_count_with_source_exam,
      evaluation_count_analyzable,
      evaluation_count_without_source_exam,
      evaluation_count_without_items,
      summary_available,
      status_reason,
    })
    console.info("[pedagogical-summary][PHASE_1_METRICS_V1]", {
      student_stats_count: phase1Metrics.student_stats.length,
      item_discrimination_count: phase1Metrics.item_discrimination.length,
    })
    evalsMetaWithIncluded.forEach((m) => {
      console.info("[pedagogical-summary] eval", {
        evaluation_id: m.id,
        course_id: m.course_id,
        has_source_exam: m.has_source_exam,
        evaluation_items_count: m.evaluation_items_count,
        source_exam_items_count: m.source_exam_items_count,
        included_in_summary: m.included_in_summary,
        exclusion_reason: m.exclusion_reason,
      })
    })
  }

  const courseSummary = aggregateCourseSummary(analyses)
  if (!courseSummary) {
    return NextResponse.json(
      {
        course: normalizedCourse,
        evaluation_count: evaluationIds.length,
        evaluation_count_total,
        evaluation_count_with_source_exam,
        evaluation_count_analyzable,
        evaluation_count_without_source_exam,
        evaluation_count_without_items,
        summary_available: false,
        status_reason: status_reason,
        student_count: studentCount,
        by_axis: [],
        by_skill: [],
        by_cognitive_level: [],
        weakest_skills: [],
        weakest_axes: [],
        most_failed_questions: [],
        question_heat_map: [],
        item_analysis_course: itemAnalysisCourse,
        analytics_mode: analyticsMode,
        national_analytics: emptyNationalAnalytics,
        exam_type_filter: examTypeParam || null,
        chile_agency_cuts_note:
          "Nivel de logro (Agencia / estándar porcentual): <50% Insuficiente · 50–69% Elemental · ≥70% Adecuado.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  }

  const weakest_axes = [...courseSummary.average_by_axis]
    .filter((a) => a.question_count >= 1 && typeof a.logro_pct === "number")
    .sort((a, b) => Number(a.logro_pct) - Number(b.logro_pct))
    .slice(0, 10)
    .map((a) => ({
      axis: a.dimension_value,
      average_logro_pct: Number(a.logro_pct),
      question_count: a.question_count,
    }))

  const evaluationCount = courseSummary.evaluation_count
  const firstWithQuestions = analyses.find((a) => a.by_question.length > 0)
  const byQuestionRef = firstWithQuestions?.by_question ?? []
  const most_failed_questions = courseSummary.questions_most_errors.map((q) => {
    const { axis, skill } = findAxisAndSkill(byQuestionRef, q.item_number)
    const denom = Math.max(evaluationCount, 1)
    // (alumnos que fallaron u omitieron el ítem) / (total de evaluaciones en el curso) × 100; tope 100.
    const error_pct = Math.min(100, Math.round((q.error_count / denom) * 100))
    return {
      item_number: q.item_number,
      axis,
      skill,
      error_pct,
      student_count: q.error_count,
    }
  })

  /** Mapa de calor por pregunta: logro promedio por item_number (solo datos ya producidos por analyses). */
  const questionLogroAcc = new Map<number, { sum: number; count: number; axis: string; skill: string }>()
  for (const a of analyses) {
    for (const q of a.by_question) {
      const cur = questionLogroAcc.get(q.item_number)
      const axis = q.axis || "—"
      const skill = q.skill || "—"
      if (cur) {
        cur.sum += Number(q.logro_pct ?? 0)
        cur.count += 1
      } else {
        questionLogroAcc.set(q.item_number, { sum: Number(q.logro_pct ?? 0), count: 1, axis, skill })
      }
    }
  }
  const question_heat_map = Array.from(questionLogroAcc.entries())
    .map(([item_number, v]) => ({
      item_number,
      logro_pct: v.count > 0 ? Math.round(v.sum / v.count) : 0,
      axis: v.axis,
      skill: v.skill,
    }))
    .sort((a, b) => a.item_number - b.item_number)

  let national_analytics = emptyNationalAnalytics
  if (ENABLE_NATIONAL_ANALYTICS) {
    const maxFallbackByEvaluation = new Map<string, number>()
    for (const meta of evalsMeta) {
      const sourceMax = Number(meta.source_exam_items_count) || 0
      const itemMax = Number(meta.evaluation_items_count) || 0
      maxFallbackByEvaluation.set(meta.id, sourceMax > 0 ? sourceMax : itemMax)
    }
    const examTypeByEvaluationId = new Map<string, string | null>()
    for (const e of courseEvalsForSummary) {
      examTypeByEvaluationId.set(e.id, e.exam_type ?? null)
    }
    const byEvaluation = toNationalAnalyticsRows({
      analyses,
      evaluationIds,
      maxFallbackByEvaluation,
      studentByEvaluation,
      noteByEvaluation,
      examTypeByEvaluationId,
    })
    const count = byEvaluation.length
    const average_note_7 =
      count > 0
        ? (() => {
            const withNote = byEvaluation.filter((r) => Number.isFinite(Number(r.note_7)))
            if (withNote.length === 0) return null
            const sum = withNote.reduce((s, r) => s + Number(r.note_7), 0)
            return Math.round((sum / withNote.length) * 10) / 10
          })()
        : null
    const average_logro_pct =
      count > 0
        ? Math.round(byEvaluation.reduce((s, r) => s + Number(r.logro_pct ?? 0), 0) / count)
        : 0
    const paesRows = byEvaluation.filter((r) => r.paes_score != null)
    const simceRows = byEvaluation.filter((r) => r.simce_score != null)
    const simceLevelRows = byEvaluation.filter((r) => r.simce_level != null)
    const average_paes =
      paesRows.length > 0
        ? Math.round(paesRows.reduce((s, r) => s + Number(r.paes_score), 0) / paesRows.length)
        : 0
    const average_simce =
      simceRows.length > 0
        ? Math.round(simceRows.reduce((s, r) => s + Number(r.simce_score), 0) / simceRows.length)
        : 0
    const distCount: Record<SimceLevel, number> = {
      Adecuado: 0,
      Elemental: 0,
      Insuficiente: 0,
    }
    for (const r of byEvaluation) {
      if (r.simce_level) distCount[r.simce_level] += 1
    }
    const simceDenom = simceLevelRows.length
    const simce_distribution: Record<SimceLevel, number> = {
      Adecuado: simceDenom > 0 ? Math.round((distCount.Adecuado / simceDenom) * 100) : 0,
      Elemental: simceDenom > 0 ? Math.round((distCount.Elemental / simceDenom) * 100) : 0,
      Insuficiente: simceDenom > 0 ? Math.round((distCount.Insuficiente / simceDenom) * 100) : 0,
    }
    national_analytics = {
      enabled: true,
      by_evaluation: byEvaluation,
      course_summary: {
        average_note_7,
        average_logro_pct,
        average_paes,
        average_simce,
        simce_distribution,
      },
    }
  }

  const allInstitutionalOther = courseEvalsForSummary.every(
    (e) => getInstrumentAnalyticsModeFromExamType(e.exam_type) === "INSTITUTIONAL_OTHER",
  )
  let by_axis_enriched = courseSummary.average_by_axis.map((r) => enrichAxisAggregateForChile(r))
  let by_skill_enriched = courseSummary.average_by_skill.map((r) => enrichSkillAggregateForChile(r, subjectModes))
  if (allInstitutionalOther) {
    by_axis_enriched = by_axis_enriched.map((r) => ({ ...r, achievement_level: null }))
    by_skill_enriched = by_skill_enriched.map((r) => ({
      ...r,
      achievement_level: null,
      chile_eje_tematico: null,
      chile_indicador_code: null,
      chile_indicador_descriptor: null,
      chile_ministerial_skill_code: null,
    }))
  }

  return NextResponse.json(
    {
      course: normalizedCourse,
      evaluation_count: courseSummary.evaluation_count,
      evaluation_count_total,
      evaluation_count_with_source_exam,
      evaluation_count_analyzable,
      evaluation_count_without_source_exam,
      evaluation_count_without_items,
      summary_available,
      status_reason,
      student_count: studentCount,
      by_axis: by_axis_enriched,
      by_skill: by_skill_enriched,
      by_cognitive_level: courseSummary.average_by_cognitive_level,
      weakest_skills: courseSummary.weakest_skills,
      weakest_axes: weakest_axes,
      most_failed_questions,
      question_heat_map,
      item_analysis_course: itemAnalysisCourse,
      analytics_mode: analyticsMode,
      national_analytics,
      exam_type_filter: examTypeParam || null,
      chile_agency_cuts_note:
        "Nivel de logro (Agencia / estándar porcentual): <50% Insuficiente · 50–69% Elemental · ≥70% Adecuado.",
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}
