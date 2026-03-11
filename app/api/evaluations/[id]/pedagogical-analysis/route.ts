/**
 * GET /api/evaluations/[id]/pedagogical-analysis
 * Análisis de logro pedagógico: cruza ítems de la evaluación con la prueba base asociada.
 * Solo lectura. No modifica scoring, nota ni informe.
 * Devuelve estados explícitos: has_source_exam, has_evaluation_items, has_source_exam_items, analysis_available, status_reason.
 */
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { getSourceExamForEvaluation } from "@/app/lib/source-exam-db"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import {
  analyzeLearningResults,
  type EvaluationItemRow,
  type SourceExamItemWithPedagogy,
} from "@/app/lib/analyze-learning-results"

export const dynamic = "force-dynamic"

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

type StatusReason =
  | "ok"
  | "missing_source_exam"
  | "missing_evaluation_items"
  | "missing_source_exam_items"
  | "error"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: evaluationId } = await params
  if (!evaluationId) {
    return NextResponse.json({ error: "Falta id de evaluación" }, { status: 400 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, user_id")
    .eq("id", evaluationId)
    .maybeSingle()

  if (evErr || !evaluation) {
    return NextResponse.json({ error: "Evaluación no encontrada" }, { status: 404 })
  }

  const teacherId = profile?.teacher_id ?? null
  const ev = evaluation as { teacher_id?: string; user_id?: string }
  const isOwnerByTeacher = Boolean(teacherId && ev.teacher_id === teacherId)
  const isOwnerByUser = Boolean(ev.user_id && ev.user_id === user.id)
  if (!isOwnerByTeacher && !isOwnerByUser) {
    return NextResponse.json({ error: "No autorizado para esta evaluación" }, { status: 403 })
  }

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

  const analysis = analyzeLearningResults(
    evaluationId,
    evaluationItems,
    sourceExamItemsEnriched
  )

  const has_source_exam = !!sourceExamId
  const has_evaluation_items = evaluationItems.length > 0
  const has_source_exam_items = sourceItemsRaw.length > 0
  const analysis_available =
    has_source_exam && has_evaluation_items && has_source_exam_items && analysis.by_question.length > 0

  let status_reason: StatusReason = "ok"
  if (!has_source_exam) status_reason = "missing_source_exam"
  else if (!has_evaluation_items) status_reason = "missing_evaluation_items"
  else if (!has_source_exam_items) status_reason = "missing_source_exam_items"
  else if (!analysis.by_question.length) status_reason = "missing_source_exam_items"

  if (isDev) {
    console.info("[pedagogical-analysis]", {
      evaluationId,
      source_exam_id: sourceExamId ?? null,
      evaluation_items_count: evaluationItems.length,
      source_exam_items_count: sourceItemsRaw.length,
      has_source_exam,
      has_evaluation_items,
      has_source_exam_items,
      analysis_available,
      status_reason,
    })
  }

  return NextResponse.json(
    {
      ...analysis,
      has_source_exam,
      has_evaluation_items,
      has_source_exam_items,
      analysis_available,
      status_reason,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
