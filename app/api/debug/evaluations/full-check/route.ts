import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/debug/evaluations/full-check?evaluation_id=... (opcional)
 * Solo desarrollo: si evaluation_id no viene, usa la última evaluación del teacher_id (order by evaluated_at desc limit 1).
 * Respuesta: ok, teacher_id, evaluation, items_count, summaries_count, students_count, students_sample, notes.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "No disponible en producción" }, { status: 404 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user || !profile?.teacher_id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  let evaluationId = req.nextUrl.searchParams.get("evaluation_id")?.trim()
  if (!evaluationId) {
    const { data: lastRow, error: lastErr } = await supabase
      .from("evaluations")
      .select("id")
      .eq("teacher_id", profile.teacher_id)
      .order("evaluated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastErr || !lastRow?.id) {
      return NextResponse.json({
        ok: false,
        teacher_id: profile.teacher_id,
        error: lastErr?.message ?? "No hay evaluaciones para este perfil",
        notes: ["No se encontró ninguna evaluación del teacher_id."],
      }, { status: 200 })
    }
    evaluationId = lastRow.id
  }

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, title, course_id, course_label, subject, status, evaluated_at")
    .eq("id", evaluationId)
    .eq("teacher_id", profile.teacher_id)
    .maybeSingle()

  if (evalErr || !evaluation) {
    return NextResponse.json(
      { ok: false, error: evalErr?.message ?? "Evaluación no encontrada o sin permiso", teacher_id: profile.teacher_id },
      { status: evaluation ? 500 : 404 }
    )
  }

  const [itemsRes, summaryRes, studentsRes] = await Promise.all([
    supabase.from("evaluation_items").select("id").eq("evaluation_id", evaluationId),
    supabase.from("evaluation_summaries").select("id").eq("evaluation_id", evaluationId).maybeSingle(),
    supabase
      .from("evaluation_students")
      .select("id, student_name, student_normalized")
      .eq("evaluation_id", evaluationId)
      .order("student_name", { ascending: true })
      .limit(20),
  ])

  const items = (itemsRes.data ?? []) as { id: string }[]
  const students = (studentsRes.data ?? []) as Array<{ id: string; student_name: string | null; student_normalized: string | null }>
  const students_sample = students.slice(0, 10).map((s) => (s.student_name != null ? String(s.student_name).trim() : "—"))

  const notes: string[] = []
  if (students.length === 0) notes.push("Si students_count=0: aún no se está persistiendo evaluation_students para esta evaluación.")
  if (items.length === 0) notes.push("Si items_count=0: no se guardaron evaluation_items (el Ver nunca mostrará informe).")

  return NextResponse.json({
    ok: true,
    teacher_id: profile.teacher_id,
    evaluation: {
      id: evaluation.id,
      course_id: evaluation.course_id,
      course_label: (evaluation as { course_label?: string | null }).course_label ?? null,
      title: evaluation.title,
      subject: (evaluation as { subject?: string | null }).subject ?? null,
      status: evaluation.status ?? "draft",
      evaluated_at: (evaluation as { evaluated_at?: string | null }).evaluated_at ?? null,
    },
    items_count: items.length,
    summaries_count: summaryRes.data ? 1 : 0,
    students_count: students.length,
    students_sample,
    notes,
  })
}
