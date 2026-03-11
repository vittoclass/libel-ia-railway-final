/**
 * PATCH /api/evaluations/[id]/items
 * Actualiza ítems de una evaluación (respuestas, correcta, puntajes). Solo dueño (teacher_id o user_id).
 * Tras guardar ejecuta recálculo central: summary + skills.
 */
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { recomputeEvaluationAfterTeacherDecision } from "@/app/lib/recompute-after-edit"

export const dynamic = "force-dynamic"

type ItemPayload = {
  question_number: number
  student_answer?: string | null
  correct_answer?: string | null
  is_correct?: boolean | null
  score_obtained?: number | null
  score_max?: number | null
}

function parseBody(body: unknown): ItemPayload[] | null {
  if (!body || typeof body !== "object") return null
  const b = body as { items?: unknown }
  if (!Array.isArray(b.items)) return null
  const out: ItemPayload[] = []
  for (const it of b.items) {
    if (!it || typeof it !== "object") continue
    const o = it as Record<string, unknown>
    const qn = typeof o.question_number === "number" ? o.question_number : Number(o.question_number)
    if (Number.isNaN(qn)) continue
    out.push({
      question_number: qn,
      student_answer: o.student_answer != null ? String(o.student_answer) : undefined,
      correct_answer: o.correct_answer != null ? String(o.correct_answer) : undefined,
      is_correct: o.is_correct === true ? true : o.is_correct === false ? false : undefined,
      score_obtained: typeof o.score_obtained === "number" ? o.score_obtained : o.score_obtained != null ? Number(o.score_obtained) : undefined,
      score_max: typeof o.score_max === "number" ? o.score_max : o.score_max != null ? Number(o.score_max) : undefined,
    })
  }
  return out.length ? out : null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: evaluationId } = await params
  if (!evaluationId) {
    return NextResponse.json({ error: "Falta id de evaluación" }, { status: 400 })
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
    .eq("id", evaluationId)
    .maybeSingle()

  if (evalErr || !evaluation) {
    return NextResponse.json({ error: "Evaluación no encontrada" }, { status: 404 })
  }

  const teacherId = profile?.teacher_id ?? null
  const isOwnerByTeacher = teacherId && evaluation.teacher_id === teacherId
  const evUserId = (evaluation as { user_id?: string }).user_id
  const isOwnerByUser = Boolean(evUserId && evUserId === user.id)
  if (!isOwnerByTeacher && !isOwnerByUser) {
    return NextResponse.json({ error: "No autorizado para esta evaluación" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const items = parseBody(body)
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Se requiere body.items (array de { question_number, ... })" }, { status: 400 })
  }

  const b = body as { porcentaje_exigencia?: number; puntaje_total_max?: number }
  const porcentajeExigencia = typeof b.porcentaje_exigencia === "number" && b.porcentaje_exigencia > 0 ? b.porcentaje_exigencia : undefined
  const puntajeTotalMax = typeof b.puntaje_total_max === "number" && b.puntaje_total_max > 0 ? b.puntaje_total_max : undefined

  for (const it of items) {
    const update: Record<string, unknown> = {}
    if (it.student_answer !== undefined) update.student_answer = it.student_answer
    if (it.correct_answer !== undefined) update.correct_answer = it.correct_answer
    if (it.is_correct !== undefined) update.is_correct = it.is_correct
    if (it.score_obtained !== undefined) update.score_obtained = it.score_obtained
    if (it.score_max !== undefined) update.score_max = it.score_max
    if (Object.keys(update).length === 0) continue

    const { error: upErr } = await supabase
      .from("evaluation_items")
      .update(update)
      .eq("evaluation_id", evaluationId)
      .eq("question_number", it.question_number)

    if (upErr) {
      return NextResponse.json(
        { error: "Error actualizando ítem", detail: upErr.message, question_number: it.question_number },
        { status: 500 }
      )
    }
  }

  const { data: itemsFromDb } = await supabase
    .from("evaluation_items")
    .select("question_number, student_answer, correct_answer, is_correct, score_obtained, score_max")
    .eq("evaluation_id", evaluationId)
    .order("question_number", { ascending: true })

  const recomputeResult = await recomputeEvaluationAfterTeacherDecision(supabase, evaluationId, {
    porcentajeExigencia: porcentajeExigencia ?? undefined,
    puntajeTotalMax: puntajeTotalMax ?? undefined,
  })

  const { data: summaryFromDb } = await supabase
    .from("evaluation_summaries")
    .select("evaluation_id, grade_chile, strengths, improvements")
    .eq("evaluation_id", evaluationId)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    evaluation_id: evaluationId,
    items_updated: items.length,
    recompute: {
      score_total: recomputeResult.score_total,
      score_max: recomputeResult.score_max,
      grade_chile: recomputeResult.grade_chile,
      skills_recomputed: recomputeResult.skills_recomputed ?? false,
    },
    db_items_after_save: Array.isArray(itemsFromDb) ? itemsFromDb : null,
    db_summary_after_recompute: summaryFromDb ?? null,
  })
}
