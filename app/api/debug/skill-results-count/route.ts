/**
 * GET /api/debug/skill-results-count?evaluation_id=...
 * Conteo rápido: cuántas filas hay en evaluation_skill_results para esa evaluación.
 * Solo desarrollo.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "No disponible en producción" }, { status: 404 })
  }

  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const evaluationId = req.nextUrl.searchParams.get("evaluation_id")?.trim()
  if (!evaluationId) {
    return NextResponse.json({ error: "evaluation_id requerido" }, { status: 400 })
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const teacherId = profileRow?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ error: "Perfil sin teacher_id" }, { status: 403 })
  }

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, teacher_id")
    .eq("id", evaluationId)
    .eq("teacher_id", teacherId)
    .maybeSingle()

  if (!evaluation) {
    return NextResponse.json({ error: "Evaluación no encontrada o sin permiso" }, { status: 404 })
  }

  const { count } = await supabase
    .from("evaluation_skill_results")
    .select("id", { count: "exact", head: true })
    .eq("evaluation_id", evaluationId)

  const { data: sample } = await supabase
    .from("evaluation_skill_results")
    .select("evaluation_id, student_profile_id, axis_id, skill_id, accuracy")
    .eq("evaluation_id", evaluationId)
    .limit(5)

  const rows_count = count ?? 0
  const sample_rows = sample ?? []

  return NextResponse.json({
    evaluation_id: evaluationId,
    rows_count,
    sample_rows,
  })
}
