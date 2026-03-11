import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/courses/[courseId]/evaluations
 * Lista evaluaciones del curso para el profesor autenticado.
 * Incluye status, title, subject, evaluated_at, grade_chile, student_count.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const { courseId } = await params
  if (!courseId) {
    return NextResponse.json({ error: "courseId requerido" }, { status: 400 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ error: "Completa tu perfil" }, { status: 403 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const normalizedCourseId = courseId === "_" || courseId === "Sin%20curso" ? "Sin curso" : decodeURIComponent(courseId)

  const { data: evaluations, error: evError } = await supabase
    .from("evaluations")
    .select("id, title, subject, course_id, evaluated_at, status")
    .eq("teacher_id", teacherId)
    .order("evaluated_at", { ascending: false })

  if (evError) {
    return NextResponse.json({ error: evError.message }, { status: 500 })
  }

  const all = (evaluations ?? []) as Array<{ id: string; title: string | null; subject: string | null; course_id: string | null; evaluated_at: string | null; status: string | null }>
  const filtered = all.filter((e) => {
    const course = e.course_id != null && String(e.course_id).trim() !== "" ? String(e.course_id).trim() : "Sin curso"
    return course === normalizedCourseId
  })

  const ids = filtered.map((e) => e.id)
  let summaries: Array<{ evaluation_id: string; grade_chile: number | null }> = []
  let studentCounts: Map<string, number> = new Map()
  if (ids.length > 0) {
    const [sumRes, studentsRes] = await Promise.all([
      supabase.from("evaluation_summaries").select("evaluation_id, grade_chile").in("evaluation_id", ids),
      supabase.from("evaluation_students").select("evaluation_id").in("evaluation_id", ids),
    ])
    summaries = sumRes.data ?? []
    const students = (studentsRes.data ?? []) as Array<{ evaluation_id: string }>
    students.forEach((s) => {
      studentCounts.set(s.evaluation_id, (studentCounts.get(s.evaluation_id) ?? 0) + 1)
    })
  }

  const gradeByEval = new Map(summaries.map((s) => [s.evaluation_id, s.grade_chile]))
  const rows = filtered.map((e) => ({
    id: e.id,
    title: e.title,
    subject: e.subject,
    evaluated_at: e.evaluated_at,
    status: e.status ?? "draft",
    grade_chile: gradeByEval.get(e.id) ?? null,
    student_count: studentCounts.get(e.id) ?? 0,
  }))

  // Filtro en JS: registros con status null se tratan como activos
  const active = rows.filter((r) => r.status !== "archived")
  const archived = rows.filter((r) => r.status === "archived")

  return NextResponse.json({
    course_id: normalizedCourseId,
    active,
    archived,
  })
}
