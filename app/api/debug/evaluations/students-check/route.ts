import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/debug/evaluations/students-check?evaluation_id=...
 * Solo desarrollo: cantidad de filas en evaluation_students y muestra de nombres.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "No disponible en producción" }, { status: 404 })
  }

  const evaluationId = req.nextUrl.searchParams.get("evaluation_id")?.trim()
  if (!evaluationId) {
    return NextResponse.json({ error: "evaluation_id requerido" }, { status: 400 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user || !profile?.teacher_id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, teacher_id")
    .eq("id", evaluationId)
    .eq("teacher_id", profile.teacher_id)
    .maybeSingle()

  if (!evaluation) {
    return NextResponse.json({ error: "Evaluación no encontrada o sin permiso" }, { status: 404 })
  }

  const { data: rows, error } = await supabase
    .from("evaluation_students")
    .select("id, student_name, student_normalized, course_id_text, created_at")
    .eq("evaluation_id", evaluationId)
    .order("student_name", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const list = (rows ?? []) as Array<{ id: string; student_name: string | null; student_normalized: string | null; course_id_text: string | null; created_at: string }>
  const sample = list.slice(0, 10).map((r) => ({ student_name: r.student_name, student_normalized: r.student_normalized }))

  return NextResponse.json({
    evaluation_id: evaluationId,
    teacher_id: profile.teacher_id,
    count: list.length,
    sample,
  })
}
