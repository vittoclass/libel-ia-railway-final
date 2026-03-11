import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/debug/student-link-check?evaluation_id=...
 * Solo desarrollo. Devuelve evaluation_students (nombre, normalized, profile_id) y student_profiles encontrados.
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

  const evaluationId = req.nextUrl.searchParams.get("evaluation_id")?.trim()
  if (!evaluationId) {
    return NextResponse.json({ error: "evaluation_id requerido" }, { status: 400 })
  }

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id")
    .eq("id", evaluationId)
    .eq("teacher_id", profile.teacher_id)
    .maybeSingle()

  if (evalErr || !evaluation) {
    return NextResponse.json(
      { error: evalErr?.message ?? "Evaluación no encontrada o sin permiso" },
      { status: evaluation ? 500 : 404 }
    )
  }

  const { data: evalStudents, error: studentsErr } = await supabase
    .from("evaluation_students")
    .select("student_name, student_normalized, student_profile_id")
    .eq("evaluation_id", evaluationId)
    .order("student_name", { ascending: true })

  if (studentsErr) {
    return NextResponse.json(
      { error: "Error al leer evaluation_students: " + studentsErr.message },
      { status: 500 }
    )
  }

  const evaluation_students = (evalStudents ?? []).map((r) => ({
    student_name: r.student_name ?? null,
    student_normalized: r.student_normalized ?? null,
    student_profile_id: (r as { student_profile_id?: string | null }).student_profile_id ?? null,
  }))

  const profileIds = (evalStudents ?? [])
    .map((r) => (r as { student_profile_id?: string | null }).student_profile_id)
    .filter((id): id is string => id != null && String(id).trim() !== "")

  let student_profiles: Array<{ id: string; student_name: string | null; student_normalized: string | null; course_label: string | null }> = []
  if (profileIds.length > 0) {
    const { data: profiles, error: profErr } = await supabase
      .from("student_profiles")
      .select("id, student_name, student_normalized, course_label")
      .in("id", profileIds)
    if (!profErr && profiles?.length) {
      student_profiles = profiles.map((p) => ({
        id: p.id,
        student_name: p.student_name ?? null,
        student_normalized: p.student_normalized ?? null,
        course_label: (p as { course_label?: string | null }).course_label ?? null,
      }))
    }
  }

  return NextResponse.json({
    evaluation_id: evaluationId,
    evaluation_students,
    student_profiles,
  })
}
