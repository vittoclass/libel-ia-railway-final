/**
 * POST /api/evaluations/[id]/sync-student
 * Rescate post-guardado: vincula estudiante a student_profiles y evaluation_students.
 * Lee perfil con el mismo patrón robusto que /api/evaluations/list: getAuthUser + SELECT profiles por user_id.
 * Respuesta siempre auditable.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { ensureStudentProfile } from "@/app/lib/student-profile-link"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV !== "production"

function auditResponse(
  ok: boolean,
  evaluation_id: string,
  received_student_name: string,
  received_course_label: string | null,
  normalized_student_name: string,
  student_profile_id: string | null,
  created_or_existing: "created" | "existing" | null,
  message: string
) {
  return {
    ok,
    evaluation_id,
    received_student_name,
    received_course_label,
    normalized_student_name,
    student_profile_id,
    created_or_existing,
    message,
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: evaluationId } = await params
  if (!evaluationId) {
    return NextResponse.json(
      auditResponse(false, "", "", null, "", null, null, "id de evaluación requerido"),
      { status: 400 }
    )
  }

  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json(
      auditResponse(false, evaluationId, "", null, "", null, null, "No autorizado"),
      { status: 401 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      auditResponse(
        false,
        evaluationId,
        "",
        null,
        "",
        null,
        null,
        "Supabase no configurado"
      ),
      { status: 503 }
    )
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (profileError) {
    if (isDev) console.info("[sync-student] profile select error", user.id, profileError.message)
    return NextResponse.json(
      auditResponse(false, evaluationId, "", null, "", null, null, profileError.message),
      { status: 500 }
    )
  }

  if (!profileRow) {
    return NextResponse.json(
      auditResponse(false, evaluationId, "", null, "", null, null, "Perfil no encontrado"),
      { status: 409 }
    )
  }

  const teacherId = profileRow.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json(
      auditResponse(false, evaluationId, "", null, "", null, null, "Completa tu perfil (teacher_id)"),
      { status: 409 }
    )
  }

  if (isDev) {
    console.info("[sync-student] user_id", user.id)
    console.info("[sync-student] teacher_id", teacherId)
  }

  let body: { student_name?: string; course_label?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      auditResponse(false, evaluationId, "", null, "", null, null, "Body JSON inválido"),
      { status: 400 }
    )
  }

  const received_student_name = typeof body.student_name === "string" ? body.student_name : ""
  const student_name = received_student_name.trim()

  if (isDev) console.info("[sync-student] received_student_name", received_student_name)

  if (!student_name) {
    return NextResponse.json(
      auditResponse(
        false,
        evaluationId,
        received_student_name,
        body.course_label ?? null,
        "",
        null,
        null,
        "student_name vacío"
      ),
      { status: 400 }
    )
  }

  const received_course_label =
    body.course_label != null && String(body.course_label).trim() !== ""
      ? String(body.course_label).trim()
      : null
  const course_label = received_course_label

  const normalized_student_name = student_name.toLowerCase()

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, school_id")
    .eq("id", evaluationId)
    .eq("teacher_id", teacherId)
    .maybeSingle()

  if (evalErr || !evaluation) {
    const msg = !evaluation
      ? "Evaluación no encontrada o no pertenece al profesor"
      : (evalErr && "message" in evalErr ? String((evalErr as { message: string }).message) : "Error al verificar evaluación")
    return NextResponse.json(
      auditResponse(
        false,
        evaluationId,
        received_student_name,
        received_course_label,
        normalized_student_name,
        null,
        null,
        msg
      ),
      { status: evaluation ? 500 : 403 }
    )
  }

  const school_id = evaluation.school_id ?? profileRow.school_id ?? null

  const { error: upsertErr } = await supabase
    .from("evaluation_students")
    .upsert(
      {
        evaluation_id: evaluationId,
        student_name,
        student_normalized: normalized_student_name,
        course_label,
      },
      { onConflict: "evaluation_id,student_normalized" }
    )

  if (upsertErr) {
    return NextResponse.json(
      auditResponse(
        false,
        evaluationId,
        received_student_name,
        received_course_label,
        normalized_student_name,
        null,
        null,
        "Error al upsert evaluation_students: " + upsertErr.message
      ),
      { status: 500 }
    )
  }

  const profileId = await ensureStudentProfile(supabase, {
    teacher_id: teacherId,
    school_id,
    student_name,
    course_label,
  })

  if (!profileId) {
    return NextResponse.json(
      auditResponse(
        false,
        evaluationId,
        received_student_name,
        received_course_label,
        normalized_student_name,
        null,
        null,
        "No se pudo obtener o crear student_profile"
      ),
      { status: 500 }
    )
  }

  const { error: updateErr } = await supabase
    .from("evaluation_students")
    .update({ student_profile_id: profileId })
    .eq("evaluation_id", evaluationId)
    .eq("student_normalized", normalized_student_name)

  if (updateErr) {
    return NextResponse.json(
      auditResponse(
        false,
        evaluationId,
        received_student_name,
        received_course_label,
        normalized_student_name,
        profileId,
        null,
        "Error al vincular student_profile_id: " + updateErr.message
      ),
      { status: 500 }
    )
  }

  let created_or_existing: "created" | "existing" | null = null
  try {
    const { data: profileRow } = await supabase
      .from("student_profiles")
      .select("created_at")
      .eq("id", profileId)
      .single()
    if (profileRow?.created_at) {
      const created = new Date(profileRow.created_at).getTime()
      const now = Date.now()
      created_or_existing = now - created < 4000 ? "created" : "existing"
    }
  } catch {
    created_or_existing = null
  }

  return NextResponse.json(
    auditResponse(
      true,
      evaluationId,
      received_student_name,
      received_course_label,
      normalized_student_name,
      profileId,
      created_or_existing,
      "Estudiante sincronizado correctamente"
    )
  )
}
