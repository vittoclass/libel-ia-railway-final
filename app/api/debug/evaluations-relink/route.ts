import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * POST /api/debug/evaluations-relink
 * Reasigna teacher_id en evaluations (solo desarrollo).
 * Body: { fromTeacherId: string, toTeacherId: string }
 * Devuelve { updatedCount: number }.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const body = await req.json().catch(() => ({}))
  const fromTeacherId = typeof body.fromTeacherId === "string" ? body.fromTeacherId.trim() : null
  const toTeacherId = typeof body.toTeacherId === "string" ? body.toTeacherId.trim() : null

  if (!fromTeacherId || !toTeacherId) {
    return NextResponse.json({ error: "fromTeacherId y toTeacherId son requeridos" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("evaluations")
    .update({ teacher_id: toTeacherId })
    .eq("teacher_id", fromTeacherId)
    .select("id")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const updatedCount = Array.isArray(data) ? data.length : 0
  return NextResponse.json({ updatedCount })
}
