import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/** PATCH /api/evaluations/[id]/meta — Actualiza solo title, subject, course_id. Solo el profesor dueño. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (!profile?.teacher_id) {
    return NextResponse.json({ error: "Perfil incompleto" }, { status: 403 })
  }

  const { data: evaluation, error: fetchErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id")
    .eq("id", id)
    .single()

  if (fetchErr || !evaluation || evaluation.teacher_id !== profile.teacher_id) {
    return NextResponse.json({ error: "No encontrada o sin permiso" }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, string | null> = {}
  if (body.title !== undefined) updates.title = typeof body.title === "string" ? body.title.trim() || null : null
  if (body.subject !== undefined) updates.subject = typeof body.subject === "string" ? body.subject.trim() || null : null
  if (body.course_id !== undefined) updates.course_id = body.course_id === null || body.course_id === "" ? null : String(body.course_id).trim()
  if (body.pedagogy_mode !== undefined) updates.pedagogy_mode = typeof body.pedagogy_mode === "string" ? body.pedagogy_mode.trim() || null : null
  if (body.exam_type !== undefined) updates.exam_type = typeof body.exam_type === "string" ? body.exam_type.trim() || null : null
  if (body.source_exam_id !== undefined) updates.source_exam_id = body.source_exam_id === null || body.source_exam_id === "" ? null : String(body.source_exam_id).trim()

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar (title, subject, course_id, pedagogy_mode, exam_type o source_exam_id)" }, { status: 400 })
  }

  const { data: updated, error: updateErr } = await supabase
    .from("evaluations")
    .update(updates)
    .eq("id", id)
    .eq("teacher_id", profile.teacher_id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ evaluation: updated })
}
