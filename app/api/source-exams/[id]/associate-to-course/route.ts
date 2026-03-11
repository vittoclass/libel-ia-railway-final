/**
 * POST /api/source-exams/[id]/associate-to-course
 * Asociación masiva: vincula esta prueba base a todas las evaluaciones del curso.
 * Solo actualiza source_exam_id (y tabla puente). NO modifica notas, evaluation_items ni scoring.
 */
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { associateEvaluationToSourceExam } from "@/app/lib/source-exam-db"

export const dynamic = "force-dynamic"

async function checkSourceExamAccess(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  sourceExamId: string,
  teacherId: string
) {
  const { data: sourceExam, error } = await supabase
    .from("source_exams")
    .select("id, teacher_id")
    .eq("id", sourceExamId)
    .maybeSingle()
  if (error || !sourceExam) return { ok: false as const, error: "Prueba base no encontrada" }
  if ((sourceExam as { teacher_id: string }).teacher_id !== teacherId) {
    return { ok: false as const, error: "Sin permiso sobre esta prueba base" }
  }
  return { ok: true as const }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceExamId } = await params
  if (!sourceExamId) return NextResponse.json({ error: "Falta id de prueba base" }, { status: 400 })

  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) return NextResponse.json({ error: "Completa tu perfil para usar esta función" }, { status: 403 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const access = await checkSourceExamAccess(supabase, sourceExamId, teacherId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 404 })

  let body: { course_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }
  const courseId = typeof body.course_id === "string" ? body.course_id.trim() : null
  if (!courseId) return NextResponse.json({ error: "Se requiere course_id" }, { status: 400 })

  const { data: evaluations, error: evErr } = await supabase
    .from("evaluations")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("course_id", courseId)

  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
  const list = (evaluations ?? []) as Array<{ id: string }>
  const count = list.length

  let updated = 0
  for (const ev of list) {
    const result = await associateEvaluationToSourceExam(supabase, {
      evaluation_id: ev.id,
      source_exam_id: sourceExamId,
    })
    if (result.ok) updated++
  }

  return NextResponse.json({
    ok: true,
    course_id: courseId,
    total_evaluations: count,
    associated_count: updated,
  })
}
