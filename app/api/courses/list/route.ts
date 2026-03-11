import { NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/courses/list
 * Lista cursos del profesor (distinct course_id de evaluations).
 * Requiere sesión y profile.teacher_id.
 */
export async function GET() {
  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({
      courses: [],
      reason: "PROFILE_NOT_ONBOARDED",
      message: "Completa tu perfil para ver cursos.",
    }, { status: 200 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: evals, error: evError } = await supabase
    .from("evaluations")
    .select("id, course_id, status")
    .eq("teacher_id", teacherId)

  if (evError) {
    return NextResponse.json({ error: evError.message }, { status: 500 })
  }

  const list = (evals ?? []) as Array<{ id: string; course_id: string | null; status: string | null }>
  const courseIds = new Set<string>()
  list.forEach((e) => {
    const c = e.course_id != null && String(e.course_id).trim() !== "" ? String(e.course_id).trim() : "Sin curso"
    courseIds.add(c)
  })

  const courses: Array<{
    course_id: string
    total_evaluations: number
    draft_count: number
    final_count: number
    archived_count: number
    total_students: number
  }> = []

  for (const courseId of courseIds) {
    const evalsInCourse = list.filter((e) => {
      const c = e.course_id != null && String(e.course_id).trim() !== "" ? String(e.course_id).trim() : "Sin curso"
      return c === courseId
    })
    const draft_count = evalsInCourse.filter((e) => e.status === "draft").length
    const final_count = evalsInCourse.filter((e) => e.status === "final").length
    const archived_count = evalsInCourse.filter((e) => e.status === "archived").length

    const evalIds = evalsInCourse.map((e) => e.id)
    let total_students = 0
    if (evalIds.length > 0) {
      const { count } = await supabase
        .from("evaluation_students")
        .select("id", { count: "exact", head: true })
        .in("evaluation_id", evalIds)
      total_students = count ?? 0
    }

    courses.push({
      course_id: courseId,
      total_evaluations: evalsInCourse.length,
      draft_count,
      final_count,
      archived_count,
      total_students,
    })
  }

  courses.sort((a, b) => a.course_id.localeCompare(b.course_id))

  return NextResponse.json({ courses })
}
