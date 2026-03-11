import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServer, isSupabaseConfigured } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/evaluations/by-course/:courseId
 * Devuelve las evaluaciones del curso (para verificar historial tras persistencia).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { courseId: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "Supabase no configurado" },
      { status: 503 }
    )
  }
  const courseId = params?.courseId
  if (!courseId) {
    return NextResponse.json(
      { success: false, error: "Falta courseId" },
      { status: 400 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Error al conectar con Supabase" },
      { status: 503 }
    )
  }

  const { data: evaluations, error } = await supabase
    .from("evaluations")
    .select("id, title, subject, evaluated_at, created_at")
    .eq("course_id", courseId)
    .order("evaluated_at", { ascending: false })

  if (error) {
    console.error("[evaluations/by-course]", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, evaluations: evaluations ?? [] })
}
