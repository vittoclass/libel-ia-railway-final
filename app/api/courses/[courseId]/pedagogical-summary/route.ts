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
import type { SupabaseClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

type StatusReason =
  | "ok"
  | "no_evaluations_in_course"
  | "evaluations_found_but_none_associated"
  | "evaluations_associated_but_no_items"

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
  return analyzeLearningResults(evaluationId, evaluationItems, sourceExamItemsEnriched)
}

/** Encuentra axis y skill para un item_number en la lista de by_question. */
function findAxisAndSkill(
  byQuestion: LogroByQuestion[],
  itemNumber: number
): { axis: string; skill: string } {
  const q = byQuestion.find((x) => x.item_number === itemNumber)
  return q ? { axis: q.axis, skill: q.skill } : { axis: "—", skill: "—" }
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
    .select("id, course_id")
    .eq("teacher_id", teacherId)
    .order("evaluated_at", { ascending: false })

  if (evError) {
    return NextResponse.json({ error: evError.message }, { status: 500 })
  }

  const all = (evaluations ?? []) as Array<{ id: string; course_id: string | null }>
  const filtered = all.filter((e) => {
    const course = e.course_id != null && String(e.course_id).trim() !== "" ? String(e.course_id).trim() : "Sin curso"
    return course === normalizedCourse
  })

  const evaluationIds = filtered.map((e) => e.id)
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
  for (const e of filtered) {
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
    .select("evaluation_id")
    .in("evaluation_id", evaluationIds)
  const students = (studentsRes.data ?? []) as Array<{ evaluation_id: string }>
  studentCount = students.length

  const analyses: LearningResultsAnalysis[] = []
  for (const evaluationId of evaluationIds) {
    const analysis = await fetchAnalysisForEvaluation(supabase, evaluationId)
    analyses.push(analysis)
  }

  const evaluation_count_with_source_exam = evalsMeta.filter((m) => m.has_source_exam).length
  const evaluation_count_analyzable = analyses.filter((a) => a.by_question.length > 0).length
  const evaluation_count_total = filtered.length
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
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}
