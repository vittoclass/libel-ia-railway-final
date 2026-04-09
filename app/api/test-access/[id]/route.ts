/**
 * TEMPORAL — diagnóstico de acceso a datos de evaluación.
 * No comprueba ownership ni school_id: solo lee con service_role (igual que el resto de API routes).
 *
 * Activación (reversible): en .env local `ALLOW_EVAL_TEST_ACCESS=1`, o `NODE_ENV=development`.
 * En producción queda 404 salvo que definas explícitamente ALLOW_EVAL_TEST_ACCESS=1.
 *
 * Si esta ruta devuelve 200 con `evaluation` y la oficial `/api/evaluations/[id]` devuelve 403,
 * el fallo está en la lógica de permisos de la route oficial, no en RLS (la API usa service_role y bypass RLS).
 *
 * Quitar este archivo cuando termine el diagnóstico.
 */
import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

function isTestAccessEnabled(): boolean {
  if (process.env.NODE_ENV === "development") return true
  return process.env.ALLOW_EVAL_TEST_ACCESS === "1"
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isTestAccessEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { id } = await params
  if (!id?.trim()) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select(
      "id, title, course_id, course_label, subject, evaluated_at, status, teacher_id, school_id, user_id, source_exam_id, batch_id"
    )
    .eq("id", id.trim())
    .maybeSingle()

  const { data: items } = await supabase
    .from("evaluation_items")
    .select("question_number, student_answer, correct_answer, is_correct, score_obtained, score_max")
    .eq("evaluation_id", id.trim())
    .order("question_number", { ascending: true })

  const { data: summary } = await supabase
    .from("evaluation_summaries")
    .select("grade_chile, strengths, improvements")
    .eq("evaluation_id", id.trim())
    .maybeSingle()

  return NextResponse.json(
    {
      _diagnostic: "test-access: sin auth de aplicación; solo para descartar fallos de red/DB",
      evaluation: evaluation ?? null,
      evaluation_query_error: evalErr?.message ?? null,
      items_count: Array.isArray(items) ? items.length : 0,
      items_sample: Array.isArray(items) ? items.slice(0, 5) : [],
      summary: summary ?? null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}
