import { NextRequest, NextResponse } from "next/server"
import { getAuthUser, getSupabaseRouteClient } from "@/app/lib/supabase-route"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET ?batch_id= — Filas de batch_photo_uploads visibles por RLS (solo el docente dueño).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const batchId = String(req.nextUrl.searchParams.get("batch_id") ?? "").trim()
  if (!batchId || !UUID_REGEX.test(batchId)) {
    return NextResponse.json({ error: "batch_id UUID inválido" }, { status: 400 })
  }

  const supabase = await getSupabaseRouteClient()
  const { data, error } = await supabase
    .from("batch_photo_uploads")
    .select("id, batch_id, storage_path, processed_at, created_at, content_type, student_index, page_index")
    .eq("batch_id", batchId)
    .order("student_index", { ascending: true })
    .order("page_index", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(200)

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return NextResponse.json({ photos: [], warning: "Tabla batch_photo_uploads no aplicada aún." })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ photos: data ?? [] })
}
