// app/api/evaluations/[id]/route.ts
// GET: detalle de una evaluación (metadata, items, summary, estudiantes). Solo del usuario autenticado.
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV !== "production"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (isDev) console.info("[API][EVAL_DETAIL] start", id)
  if (!id) {
    return NextResponse.json(
      isDev ? { step: "params", message: "id requerido", debug: { id } } : { error: "id requerido" },
      { status: 400 }
    )
  }

  const { user, profile } = await getOrCreateProfile()
  if (isDev) console.info("[API][EVAL_DETAIL] user", user?.id ?? null)
  if (isDev) console.info("[API][EVAL_DETAIL] profile read", !!profile)
  const teacherId = profile?.teacher_id ?? null
  if (isDev) console.info("[API][EVAL_DETAIL] teacher_id", teacherId)
  if (!user) {
    return NextResponse.json(
      isDev ? { step: "auth", message: "No autorizado", debug: { hasUser: false } } : { error: "No autorizado" },
      { status: 401 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      isDev ? { step: "config", message: "Supabase no configurado", debug: {} } : { error: "Supabase no configurado" },
      { status: 503 }
    )
  }

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, title, course_id, course_label, subject, evaluated_at, status, teacher_id, school_id, user_id, source_exam_id")
    .eq("id", id)
    .maybeSingle()

  if (isDev) console.info("[API][EVAL_DETAIL] evaluation found", !!evaluation)
  if (evalErr || !evaluation) {
    const step = evalErr ? "fetch_evaluation" : "not_found"
    const message = evalErr?.message ?? "Evaluación no encontrada"
    if (isDev) console.info("[API][EVAL_DETAIL] error/not found", step, message)
    return NextResponse.json(
      isDev ? { step, message, debug: { id, evalErr: evalErr?.message ?? null } } : { error: message },
      { status: evaluation ? 500 : 404 }
    )
  }

  const isOwnerByTeacher = teacherId && evaluation.teacher_id === teacherId
  const isOwnerByUser = evaluation.user_id && evaluation.user_id === user.id
  if (isDev) console.info("[API][EVAL_DETAIL] ownership validated", { isOwnerByTeacher, isOwnerByUser })
  if (!isOwnerByTeacher && !isOwnerByUser) {
    if (isDev) console.info("[API][EVAL_DETAIL] 403 forbidden")
    return NextResponse.json(
      isDev
        ? {
            step: "ownership",
            message: "No autorizado para esta evaluación",
            debug: { evaluationTeacherId: evaluation.teacher_id, evaluationUserId: (evaluation as { user_id?: string }).user_id, profileTeacherId: teacherId, userId: user.id },
          }
        : { error: "No autorizado para esta evaluación" },
      { status: 403 }
    )
  }

  const [itemsRes, summaryRes, studentsRes] = await Promise.all([
    supabase
      .from("evaluation_items")
      .select("question_number, student_answer, correct_answer, is_correct, score_obtained, score_max")
      .eq("evaluation_id", id)
      .order("question_number", { ascending: true }),
    supabase
      .from("evaluation_summaries")
      .select("grade_chile, strengths, improvements, raw")
      .eq("evaluation_id", id)
      .maybeSingle(),
    supabase
      .from("evaluation_students")
      .select("id, student_name, created_at")
      .eq("evaluation_id", id)
      .order("student_name", { ascending: true }),
  ])

  const items = Array.isArray(itemsRes.data) ? itemsRes.data : []
  const summary = summaryRes.data ?? null
  const students = Array.isArray(studentsRes.data) ? studentsRes.data : []
  if (isDev) {
    if (itemsRes.error) console.info("[API][EVAL_DETAIL] evaluation_items error:", itemsRes.error.message)
    if (summaryRes.error) console.info("[API][EVAL_DETAIL] evaluation_summaries error:", summaryRes.error.message)
    if (studentsRes.error) console.info("[API][EVAL_DETAIL] evaluation_students error:", studentsRes.error.message)
    console.info("[API][EVAL_DETAIL] items count", items.length)
    console.info("[API][EVAL_DETAIL] summary found", !!summary)
    console.info("[API][EVAL_DETAIL] response 200")
  }
  const firstStudentName = students.length > 0 && (students[0] as { student_name?: string | null }).student_name
    ? String((students[0] as { student_name: string }).student_name).trim()
    : undefined

  return NextResponse.json(
    {
      evaluation: {
        id: evaluation.id,
        title: evaluation.title,
        course_id: evaluation.course_id,
        course_label: (evaluation as { course_label?: string | null }).course_label ?? undefined,
        subject: evaluation.subject,
        evaluated_at: evaluation.evaluated_at,
        status: evaluation.status ?? "draft",
        student_name: firstStudentName,
        source_exam_id: (evaluation as { source_exam_id?: string | null }).source_exam_id ?? undefined,
      },
      items,
      summary: summary
        ? {
            grade_chile: summary.grade_chile,
            strengths: summary.strengths,
            improvements: summary.improvements,
            raw: summary.raw,
          }
        : null,
      students,
      evaluation_items: items,
      evaluation_summaries: summary
        ? {
            grade_chile: summary.grade_chile,
            strengths: summary.strengths,
            improvements: summary.improvements,
            raw: summary.raw,
          }
        : null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}
