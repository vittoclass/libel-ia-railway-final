/**
 * PATCH/DELETE /api/source-exams/[id]/items/[itemId]
 * Actualiza o elimina un ítem de prueba base. Solo si la prueba base es del teacher_id del perfil.
 * No toca evaluation_items ni evaluaciones del estudiante.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { sanitizeUuidOrNull } from "@/app/lib/source-exam-traceability"

export const dynamic = "force-dynamic"

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const

async function checkItemAccess(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  sourceExamId: string,
  itemId: string,
  user: { id: string }
) {
  const { data: item, error: itemErr } = await supabase
    .from("source_exam_items")
    .select("id, source_exam_id")
    .eq("id", itemId)
    .eq("source_exam_id", sourceExamId)
    .maybeSingle()
  if (itemErr || !item) return { ok: false as const, status: 404, error: "Ítem no encontrado" }
  const { data: sourceExam, error: exErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id")
    .eq("id", sourceExamId)
    .maybeSingle()
  if (exErr || !sourceExam) return { ok: false as const, status: 404, error: "Prueba base no encontrada" }
  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!profile?.teacher_id || (sourceExam as { teacher_id: string }).teacher_id !== profile.teacher_id) {
    return { ok: false as const, status: 403, error: "Sin permiso sobre esta prueba base" }
  }
  return { ok: true as const }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  const { id: sourceExamId, itemId } = await params
  if (!sourceExamId || !itemId) return NextResponse.json({ error: "Falta id o itemId" }, { status: 400 })

  const access = await checkItemAccess(supabase, sourceExamId, itemId, user)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const update: Record<string, unknown> = {}
  if (typeof body.item_number === "number" && !Number.isNaN(body.item_number)) update.item_number = body.item_number
  if (typeof body.item_number === "string") update.item_number = parseInt(body.item_number, 10)
  if (typeof body.item_text === "string") update.item_text = body.item_text
  if (typeof body.axis_id === "string") update.axis_id = sanitizeUuidOrNull(body.axis_id)
  if (typeof body.skill_id === "string") update.skill_id = sanitizeUuidOrNull(body.skill_id)
  if (typeof body.competence === "string") update.competence = body.competence
  if (typeof body.difficulty === "string") update.difficulty = body.difficulty
  if (typeof body.question_type === "string") update.question_type = body.question_type || null
  if (typeof body.correct_answer === "string") update.correct_answer = body.correct_answer
  if (typeof body.max_score === "number" && !Number.isNaN(body.max_score)) update.max_score = body.max_score
  if (typeof body.max_score === "string") update.max_score = parseInt(body.max_score, 10)
  if (typeof body.rubric_text === "string") update.rubric_text = body.rubric_text
  if (typeof body.axis_label === "string") update.axis_label = body.axis_label.trim() || null
  if (typeof body.skill_label === "string") update.skill_label = body.skill_label.trim() || null
  if (typeof body.cognitive_level === "string") update.cognitive_level = body.cognitive_level.trim() || null
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 })

  const { data, error } = await supabase
    .from("source_exam_items")
    .update(update)
    .eq("id", itemId)
    .eq("source_exam_id", sourceExamId)
    .select("id, item_number, item_text, axis_id, skill_id, axis_label, skill_label, cognitive_level, competence, difficulty, question_type, correct_answer, max_score, rubric_text")
    .single()

  if (error)
    return NextResponse.json(
      {
        error: error.message,
        supabase_error: {
          message: error.message,
          code: error.code ?? null,
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
      },
      { status: 500, headers: NO_STORE },
    )
  return NextResponse.json({ item: data }, { status: 200, headers: NO_STORE })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  const { id: sourceExamId, itemId } = await params
  if (!sourceExamId || !itemId) return NextResponse.json({ error: "Falta id o itemId" }, { status: 400 })

  const access = await checkItemAccess(supabase, sourceExamId, itemId, user)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { error } = await supabase
    .from("source_exam_items")
    .delete()
    .eq("id", itemId)
    .eq("source_exam_id", sourceExamId)

  if (error)
    return NextResponse.json(
      {
        error: error.message,
        supabase_error: {
          message: error.message,
          code: error.code ?? null,
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
      },
      { status: 500, headers: NO_STORE },
    )
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
