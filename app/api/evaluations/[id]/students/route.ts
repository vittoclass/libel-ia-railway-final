import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/evaluations/[id]/students
 * Lista estudiantes asociados a la evaluación desde evaluation_students.
 * Si no hay filas, devuelve [] sin error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, user_id")
    .eq("id", id)
    .maybeSingle()

  if (evalErr || !evaluation) {
    return NextResponse.json(
      { error: evalErr?.message ?? "Evaluación no encontrada" },
      { status: evaluation ? 500 : 404 }
    )
  }

  const teacherId = profile?.teacher_id ?? null
  const isOwnerByTeacher = teacherId && evaluation.teacher_id === teacherId
  const isOwnerByUser = evaluation.user_id && evaluation.user_id === user.id
  if (!isOwnerByTeacher && !isOwnerByUser) {
    return NextResponse.json({ error: "No autorizado para esta evaluación" }, { status: 403 })
  }

  const { data: rows } = await supabase
    .from("evaluation_students")
    .select("student_name, created_at")
    .eq("evaluation_id", id)
    .order("student_name", { ascending: true })

  const students = (rows ?? []).map((r: { student_name: string | null; created_at: string }) => ({
    student_name: r.student_name ?? "",
    created_at: r.created_at,
  }))

  return NextResponse.json({ students })
}
