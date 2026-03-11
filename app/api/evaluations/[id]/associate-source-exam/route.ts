/**
 * POST /api/evaluations/[id]/associate-source-exam
 * Asociación segura: vincula la evaluación a una prueba base. Solo dueño de la evaluación.
 * No modifica scoring, nota ni informe. Usa utilidades source-exam-db (tabla puente + evaluations.source_exam_id).
 */
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { associateEvaluationToSourceExam } from "@/app/lib/source-exam-db"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: evaluationId } = await params
  if (!evaluationId) return NextResponse.json({ error: "Falta id de evaluación" }, { status: 400 })

  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, user_id")
    .eq("id", evaluationId)
    .maybeSingle()

  if (evErr || !evaluation) return NextResponse.json({ error: "Evaluación no encontrada" }, { status: 404 })

  const teacherId = profile?.teacher_id ?? null
  const ev = evaluation as { teacher_id?: string; user_id?: string }
  const isOwnerByTeacher = teacherId && ev.teacher_id === teacherId
  const isOwnerByUser = ev.user_id && ev.user_id === user.id
  if (!isOwnerByTeacher && !isOwnerByUser) {
    return NextResponse.json({ error: "No autorizado para esta evaluación" }, { status: 403 })
  }

  let body: { source_exam_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }
  const source_exam_id = typeof body.source_exam_id === "string" ? body.source_exam_id.trim() : null
  if (!source_exam_id) return NextResponse.json({ error: "Se requiere source_exam_id" }, { status: 400 })

  const result = await associateEvaluationToSourceExam(supabase, { evaluation_id: evaluationId, source_exam_id })
  if (!result.ok) return NextResponse.json({ error: result.error ?? "Error al asociar" }, { status: 500 })
  if (process.env.NODE_ENV !== "production") {
    console.info("[associate-source-exam]", { evaluationId, source_exam_id, ok: true })
  }
  return NextResponse.json({ ok: true, evaluation_id: evaluationId, source_exam_id }, { status: 200 })
}
