import { NextRequest, NextResponse } from "next/server"
import { promoteBatchStudentToEvaluation } from "@/app/lib/docente/batch-promote-student"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST /api/docente/batch-promote-student
 * Body: { batch_id, student_index, course_label?, subject? }
 * Crea evaluations + vínculo en batch_photo_uploads si el alumno tiene suficientes páginas distintas.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  let body: {
    batch_id?: string
    student_index?: number
    course_label?: string | null
    subject?: string | null
    /** Opcional: RUT detectado; el servidor intenta resolver nombre en public.students. */
    student_rut?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const batchId = String(body?.batch_id ?? "").trim()
  if (!UUID_REGEX.test(batchId)) {
    return NextResponse.json({ error: "batch_id UUID inválido" }, { status: 400 })
  }

  const studentIndex = Math.floor(Number(body?.student_index))
  if (!Number.isFinite(studentIndex) || studentIndex < 1) {
    return NextResponse.json({ error: "student_index entero >= 1 requerido" }, { status: 400 })
  }

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("user_id, teacher_id, school_id, department, role")
    .eq("user_id", user.id)
    .maybeSingle()

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 })
  }

  const teacherId = (profile as { teacher_id?: string | null } | null)?.teacher_id ?? null
  const schoolId = (profile as { school_id?: string | null } | null)?.school_id ?? null
  const department = (profile as { department?: string | null } | null)?.department ?? null

  if (!teacherId || !schoolId) {
    return NextResponse.json(
      { error: "Perfil incompleto: teacher_id y school_id son obligatorios." },
      { status: 400 },
    )
  }

  const result = await promoteBatchStudentToEvaluation({
    supabase,
    userId: user.id,
    teacherId: String(teacherId),
    schoolId: String(schoolId),
    batchId,
    studentIndex,
    department,
    course_label: typeof body.course_label === "string" ? body.course_label : null,
    subject: typeof body.subject === "string" ? body.subject : null,
    student_rut: typeof body.student_rut === "string" ? body.student_rut : null,
  })

  if (!result.ok) {
    const status =
      result.code === "INCOMPLETE_PAGES" ? 409 : result.error.includes("no pertenece") ? 403 : 400
    return NextResponse.json({ error: result.error, code: result.code }, { status })
  }

  return NextResponse.json({
    ok: true,
    evaluation_id: result.evaluation_id,
    already_existed: result.already_existed ?? false,
  })
}
