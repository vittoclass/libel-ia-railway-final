import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const PEDAGOGY_ENABLED = process.env.ENABLE_PEDAGOGY === "true"

/**
 * POST /api/evaluations/[id]/tags
 * Body: { tags: [{ question_number, axis_id?, skill_id? }] }
 * Valida sesión y que la evaluación pertenezca al teacher_id del perfil. Upsert en evaluation_question_tags.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!PEDAGOGY_ENABLED) {
    return NextResponse.json({ step: "config", message: "Pedagogy no habilitado" }, { status: 404 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ step: "auth", message: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ step: "config", message: "Supabase no configurado" }, { status: 503 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ step: "validation", message: "Falta id" }, { status: 400 })
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacher_id = profileRow?.teacher_id ?? profile?.teacher_id ?? null
  if (!teacher_id) {
    return NextResponse.json({ step: "profile", message: "Perfil incompleto" }, { status: 403 })
  }

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, teacher_id")
    .eq("id", id)
    .eq("teacher_id", teacher_id)
    .maybeSingle()

  if (!evaluation) {
    return NextResponse.json({ step: "evaluation", message: "No encontrada o sin permiso" }, { status: 404 })
  }

  let body: { tags?: Array<{ question_number: number; axis_id?: string | null; skill_id?: string | null }> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ step: "validation", message: "Body inválido" }, { status: 400 })
  }

  const tags = Array.isArray(body?.tags) ? body.tags : []
  if (tags.length === 0) {
    return NextResponse.json({ step: "validation", message: "tags es requerido (array)" }, { status: 400 })
  }

  const rows = tags.map((t) => ({
    evaluation_id: id,
    question_number: Number(t.question_number),
    axis_id: t.axis_id && String(t.axis_id).trim() ? String(t.axis_id).trim() : null,
    skill_id: t.skill_id && String(t.skill_id).trim() ? String(t.skill_id).trim() : null,
  }))

  const { error } = await supabase
    .from("evaluation_question_tags")
    .upsert(rows, { onConflict: "evaluation_id,question_number" })

  if (error) {
    if (process.env.NODE_ENV !== "production") console.warn("[evaluations/tags]", error)
    return NextResponse.json({ step: "tags", message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
