/**
 * GET/POST /api/source-exams/[id]/items
 * GET: lista ítems de la prueba base. POST: añade ítems.
 * Body POST: items[] con { item_number?, item_text?, axis_id?, skill_id?, competence?, difficulty? }
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import { sanitizeUuidOrNull } from "@/app/lib/source-exam-traceability"

export const dynamic = "force-dynamic"

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const

async function checkSourceExamAccess(supabase: NonNullable<ReturnType<typeof getSupabaseServer>>, sourceExamId: string, user: { id: string }) {
  const { data: sourceExam, error: fetchErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id")
    .eq("id", sourceExamId)
    .maybeSingle()
  if (fetchErr || !sourceExam) return { ok: false as const, status: 404, error: "Prueba base no encontrada" }
  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!profile?.teacher_id || (sourceExam as { teacher_id: string }).teacher_id !== profile.teacher_id) {
    return { ok: false as const, status: 403, error: "Sin permiso sobre esta prueba base" }
  }
  return { ok: true as const, sourceExam }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  const { id: sourceExamId } = await params
  if (!sourceExamId) return NextResponse.json({ error: "Falta id de prueba base" }, { status: 400 })

  const access = await checkSourceExamAccess(supabase, sourceExamId, user)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabase
    .from("source_exam_items")
    .select("id, item_number, item_text, axis_id, skill_id, axis_label, skill_label, cognitive_level, competence, difficulty, question_type, correct_answer, max_score, rubric_text, created_at")
    .eq("source_exam_id", sourceExamId)
    .order("item_number", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const items = data ?? []
  const enriched = enrichItemsWithPedagogy(items)
  return NextResponse.json({ items: enriched }, { status: 200, headers: { "Cache-Control": "no-store" } })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  const { id: sourceExamId } = await params
  if (!sourceExamId) return NextResponse.json({ error: "Falta id de prueba base" }, { status: 400 })

  const access = await checkSourceExamAccess(supabase, sourceExamId, user)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = await req.json().catch(() => ({}))
  const raw = Array.isArray(body.items) ? body.items : Array.isArray(body) ? body : []
  const items = raw.map((it: Record<string, unknown>) => ({
    source_exam_id: sourceExamId,
    item_number: typeof it.item_number === "number" ? it.item_number : typeof it.item_number === "string" ? parseInt(it.item_number, 10) : null,
    item_text: typeof it.item_text === "string" ? it.item_text : null,
    axis_id: sanitizeUuidOrNull(typeof it.axis_id === "string" ? it.axis_id : null),
    skill_id: sanitizeUuidOrNull(typeof it.skill_id === "string" ? it.skill_id : null),
    axis_label: typeof it.axis_label === "string" ? it.axis_label.trim() || null : null,
    skill_label: typeof it.skill_label === "string" ? it.skill_label.trim() || null : null,
    competence: typeof it.competence === "string" ? it.competence : null,
    difficulty: typeof it.difficulty === "string" ? it.difficulty : null,
    question_type: typeof it.question_type === "string" ? it.question_type : null,
    correct_answer: typeof it.correct_answer === "string" ? it.correct_answer : null,
    max_score: typeof it.max_score === "number" ? it.max_score : typeof it.max_score === "string" ? parseInt(it.max_score, 10) : null,
    rubric_text: typeof it.rubric_text === "string" ? it.rubric_text : null,
    cognitive_level: typeof it.cognitive_level === "string" ? it.cognitive_level.trim() || null : null,
  }))

  if (items.length === 0) {
    return NextResponse.json({ error: "Envíe body.items con al menos un ítem" }, { status: 400 })
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("source_exam_items")
    .insert(items)
    .select("id, item_number, axis_id, skill_id")

  if (insertErr) {
    return NextResponse.json(
      {
        error: insertErr.message,
        supabase_error: {
          message: insertErr.message,
          code: insertErr.code ?? null,
          details: insertErr.details ?? null,
          hint: insertErr.hint ?? null,
        },
      },
      { status: 500, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    {
      inserted_count: inserted?.length ?? 0,
      items: inserted ?? [],
    },
    { headers: NO_STORE },
  )
}

/**
 * DELETE /api/source-exams/[id]/items
 * Borra todos los ítems de esta prueba base. Solo source_exam_items. No toca evaluaciones ni análisis.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  const { id: sourceExamId } = await params
  if (!sourceExamId) return NextResponse.json({ error: "Falta id de prueba base" }, { status: 400 })

  const access = await checkSourceExamAccess(supabase, sourceExamId, user)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: items, error: countErr } = await supabase
    .from("source_exam_items")
    .select("id")
    .eq("source_exam_id", sourceExamId)
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 })
  const count = items?.length ?? 0

  const { error: delErr } = await supabase
    .from("source_exam_items")
    .delete()
    .eq("source_exam_id", sourceExamId)

  if (delErr)
    return NextResponse.json(
      {
        error: delErr.message,
        supabase_error: {
          message: delErr.message,
          code: delErr.code ?? null,
          details: delErr.details ?? null,
          hint: delErr.hint ?? null,
        },
      },
      { status: 500, headers: NO_STORE },
    )
  return NextResponse.json({ ok: true, deleted_count: count }, { status: 200, headers: NO_STORE })
}
