/**
 * POST /api/evaluations/[id]/recompute-skills
 * Recalcula habilidades desde evaluation_items. Respuesta siempre auditable.
 * No toca el flujo de evaluación ni persist-evaluation.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { recomputeSkillsForEvaluation } from "@/app/lib/backfill-skill-results"

export const dynamic = "force-dynamic"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: evaluationId } = await params
  if (!evaluationId) {
    return NextResponse.json(
      { ok: false, evaluation_id: "", message: "id requerido", error: "missing id" },
      { status: 400 }
    )
  }

  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json(
      { ok: false, evaluation_id: evaluationId, message: "No autorizado", error: "unauthorized" },
      { status: 401 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { ok: false, evaluation_id: evaluationId, message: "Supabase no configurado", error: "no supabase" },
      { status: 503 }
    )
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (profileError || !profileRow?.teacher_id) {
    return NextResponse.json(
      {
        ok: false,
        evaluation_id: evaluationId,
        message: profileError?.message ?? "Completa tu perfil (teacher_id)",
        error: profileError?.message ?? "no teacher_id",
      },
      { status: 403 }
    )
  }

  const result = await recomputeSkillsForEvaluation(
    supabase,
    evaluationId,
    profileRow.teacher_id
  )

  if (!result.ok) {
    const status =
      result.message === "Evaluación no encontrada o sin permiso"
        ? 404
        : result.message === "La evaluación no tiene items para analizar"
          ? 400
          : 500
    return NextResponse.json(
      {
        ok: false,
        evaluation_id: result.evaluation_id ?? evaluationId,
        title: result.title ?? null,
        subject: result.subject,
        pedagogy_mode_used: result.pedagogy_mode_used ?? null,
        exam_type: result.exam_type ?? null,
        items_count: result.items_count ?? 0,
        linked_profiles_count: result.linked_profiles_count ?? 0,
        deleted_existing_rows_count: result.deleted_existing_rows_count ?? 0,
        computed_skill_rows_count: result.computed_skill_rows_count ?? 0,
        rows_to_insert_count: result.rows_to_insert_count ?? 0,
        inserted_skill_rows_count: result.inserted_skill_rows_count ?? 0,
        reason: result.reason ?? "ERROR",
        sample_item_texts: result.sample_item_texts ?? [],
        sample_computed_rows: result.sample_computed_rows ?? [],
        sample_rows_to_insert: result.sample_rows_to_insert ?? [],
        message: result.message,
        error: result.error,
      },
      { status }
    )
  }

  return NextResponse.json({
    ok: true,
    evaluation_id: result.evaluation_id,
    title: result.title ?? null,
    subject: result.subject,
    pedagogy_mode_used: result.pedagogy_mode_used ?? null,
    exam_type: result.exam_type ?? null,
    items_count: result.items_count,
    linked_profiles_count: result.linked_profiles_count,
    deleted_existing_rows_count: result.deleted_existing_rows_count,
    computed_skill_rows_count: result.computed_skill_rows_count,
    rows_to_insert_count: result.rows_to_insert_count,
    inserted_skill_rows_count: result.inserted_skill_rows_count,
    reason: result.reason ?? (result.ok ? "INSERTED_OK" : "NO_ITEMS"),
    sample_item_texts: result.sample_item_texts ?? [],
    sample_computed_rows: result.sample_computed_rows ?? [],
    sample_rows_to_insert: result.sample_rows_to_insert ?? [],
    message: result.message,
  })
}
