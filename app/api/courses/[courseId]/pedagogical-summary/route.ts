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
import type { SupabaseClient } from "@supabase/supabase-js"

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
  logro_pct: number
  paes_score: number
  simce_score: number
  simce_level: SimceLevel
}

type DimensionKey = "axis" | "skill" | "cognitive_level"

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

function normalizeGroupKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function buildAggregatesFromByQuestion(
  byQuestion: LogroByQuestion[],
  dimension: DimensionKey
) {
  const acc = new Map<string, { display: string; obtained: number; max: number; count: number }>()
  for (const q of byQuestion) {
    const fallback =
      dimension === "axis" ? "Sin eje" : dimension === "skill" ? "Sin habilidad" : "aplicar"
    const raw = pickLabel(q[dimension], fallback)
    const key = normalizeGroupKey(raw)
    const cur = acc.get(key) ?? { display: raw, obtained: 0, max: 0, count: 0 }
    acc.set(key, {
      display: cur.display || raw,
      obtained: cur.obtained + (Number(q.score_obtained) || 0),
      max: cur.max + (Number(q.score_max) || 0),
      count: cur.count + 1,
    })
  }
  return Array.from(acc.values()).map((v) => ({
    dimension_value: v.display,
    score_obtained: v.obtained,
    score_max: v.max,
    logro_pct: v.max > 0 ? Math.round((v.obtained / v.max) * 100) : 0,
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
      logro_pct: Math.round((safeObtained / safeMax) * 100),
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
          .select("id, item_number, item_text, axis_label, skill_label, max_score, rubric_text, question_type")
          .eq("source_exam_id", sourceExamId)
          .order("item_number", { ascending: true })
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])
  const evaluationItems = (itemsRes.data ?? []) as EvaluationItemRow[]
  const sourceItemsRaw = (sourceItemsRes.data ?? []) as SourceExamItemWithPedagogy[]
  const sourceExamItemsEnriched =
    sourceItemsRaw.length > 0 ? enrichItemsWithPedagogy(sourceItemsRaw) : ([] as SourceExamItemWithPedagogy[])
  const analysis = analyzeLearningResults(evaluationId, evaluationItems, sourceExamItemsEnriched)

  // SNAPSHOT_NATIONAL_ANALYTICS_V1: fallback robusto si no hay match question_number<->item_number
  if (analysis.by_question.length === 0 && evaluationItems.length > 0) {
    const fallbackByQuestion = buildFallbackByQuestionFromEvaluationItems(evaluationItems)
    const fallbackAnalysis: LearningResultsAnalysis = {
      ...analysis,
      by_question: fallbackByQuestion,
      by_axis: buildAggregatesFromByQuestion(fallbackByQuestion, "axis"),
      by_skill: buildAggregatesFromByQuestion(fallbackByQuestion, "skill"),
      by_cognitive_level: buildAggregatesFromByQuestion(fallbackByQuestion, "cognitive_level"),
    }
    return sanitizeAnalysis(fallbackAnalysis)
  }

  return sanitizeAnalysis(analysis)
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
    const logro_pct = Math.round(clampLogroPctFromScores(score_obtained, score_max))
    rows.push({
      evaluation_id: evaluationId,
      student_name: params.studentByEvaluation.get(evaluationId) ?? "Estudiante",
      note_7: params.noteByEvaluation.get(evaluationId) ?? null,
      score_obtained,
      score_max,
      logro_pct,
      paes_score: projectPaesFromLogroPct(logro_pct),
      simce_score: projectSimceFromLogroPct(logro_pct),
      simce_level: simceLevelFromLogroPct(logro_pct),
    })
  }
  return rows
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const { courseId } = await params
  if (!courseId) {
    return NextResponse.json({ error: "courseId requerido" }, { status: 400 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ error: "Completa tu perfil" }, { status: 403 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const normalizedCourse =
    courseId === "_" || courseId === "Sin%20curso" ? "Sin curso" : decodeURIComponent(courseId)

  const { data: evaluations, error: evError } = await supabase
    .from("evaluations")
    .select("id, course_id, course_label")
    .eq("teacher_id", teacherId)
    .order("evaluated_at", { ascending: false })

  if (evError) {
    return NextResponse.json({ error: evError.message }, { status: 500 })
  }

  const all = (evaluations ?? []) as Array<{ id: string; course_id: string | null; course_label?: string | null }>
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

  const evaluationIds = filteredWithUrlFallback.map((e) => e.id)
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
        Insatisfactorio: 0,
      } as Record<SimceLevel, number>,
    },
  }
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
      national_analytics: emptyNationalAnalytics,
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
  for (const e of filteredWithUrlFallback) {
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

  const evaluation_count_with_source_exam = evalsMeta.filter((m) => m.has_source_exam).length
  const evaluation_count_analyzable = analyses.filter((a) => a.by_question.length > 0).length
  const evaluation_count_total = filteredWithUrlFallback.length
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
        national_analytics: emptyNationalAnalytics,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  }

  const weakest_axes = [...courseSummary.average_by_axis]
    .filter((a) => a.question_count >= 1)
    .sort((a, b) => a.logro_pct - b.logro_pct)
    .slice(0, 10)
    .map((a) => ({
      axis: a.dimension_value,
      average_logro_pct: a.logro_pct,
      question_count: a.question_count,
    }))

  const evaluationCount = courseSummary.evaluation_count
  const firstWithQuestions = analyses.find((a) => a.by_question.length > 0)
  const byQuestionRef = firstWithQuestions?.by_question ?? []
  const most_failed_questions = courseSummary.questions_most_errors.map((q) => {
    const { axis, skill } = findAxisAndSkill(byQuestionRef, q.item_number)
    const error_pct =
      evaluationCount > 0 ? Math.round((q.error_count / evaluationCount) * 100) : 0
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
        cur.sum += q.logro_pct
        cur.count += 1
      } else {
        questionLogroAcc.set(q.item_number, { sum: q.logro_pct, count: 1, axis, skill })
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
    const byEvaluation = toNationalAnalyticsRows({
      analyses,
      evaluationIds,
      maxFallbackByEvaluation,
      studentByEvaluation,
      noteByEvaluation,
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
      count > 0 ? Math.round(byEvaluation.reduce((s, r) => s + r.logro_pct, 0) / count) : 0
    const average_paes =
      count > 0 ? Math.round(byEvaluation.reduce((s, r) => s + r.paes_score, 0) / count) : 100
    const average_simce =
      count > 0 ? Math.round(byEvaluation.reduce((s, r) => s + r.simce_score, 0) / count) : 0
    const distCount: Record<SimceLevel, number> = {
      Adecuado: 0,
      Elemental: 0,
      Insatisfactorio: 0,
    }
    for (const r of byEvaluation) distCount[r.simce_level] += 1
    const simce_distribution: Record<SimceLevel, number> = {
      Adecuado: count > 0 ? Math.round((distCount.Adecuado / count) * 100) : 0,
      Elemental: count > 0 ? Math.round((distCount.Elemental / count) * 100) : 0,
      Insatisfactorio: count > 0 ? Math.round((distCount.Insatisfactorio / count) * 100) : 0,
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
      by_axis: courseSummary.average_by_axis,
      by_skill: courseSummary.average_by_skill,
      by_cognitive_level: courseSummary.average_by_cognitive_level,
      weakest_skills: courseSummary.weakest_skills,
      weakest_axes: weakest_axes,
      most_failed_questions,
      question_heat_map,
      national_analytics,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}
