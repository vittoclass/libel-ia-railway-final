import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET /api/docente/batch-session/public?batch_id= — Sin auth. Solo confirma que el lote está registrado y vigente.
 * No expone teacher_id / school_id al cliente.
 */
export async function GET(req: NextRequest) {
  const batchId = String(req.nextUrl.searchParams.get("batch_id") ?? "").trim()
  if (!UUID_REGEX.test(batchId)) {
    return NextResponse.json({ ok: false, error: "batch_id inválido" }, { status: 400 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Servidor no configurado" }, { status: 503 })
  }

  const { data, error } = await supabase
    .from("batch_scan_sessions")
    .select("batch_id, expires_at")
    .eq("batch_id", batchId)
    .maybeSingle()

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return NextResponse.json({ ok: false, error: "Sesiones de lote no configuradas en el proyecto." }, { status: 503 })
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: "Lote no registrado. Actualice el QR desde la estación PC." }, { status: 404 })
  }

  const exp = new Date(String((data as { expires_at: string }).expires_at))
  if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: "Este código QR expiró. Genere uno nuevo en el PC." }, { status: 410 })
  }

  return NextResponse.json({ ok: true, batch_id: batchId })
}
