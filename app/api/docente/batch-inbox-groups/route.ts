import { NextRequest, NextResponse } from "next/server"
import { groupBatchPhotosByStudent, type BatchPhotoInboxRow } from "@/app/lib/docente/batch-inbox-grouping"
import { getAuthUser, getSupabaseRouteClient } from "@/app/lib/supabase-route"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET ?batch_id= — Fotos del lote agrupadas por student_index (solo lectura, RLS).
 * Contrato para un futuro paso que alimente “Evaluar” en PC sin tocar el motor OMR aquí.
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
    .select("id, storage_path, student_index, page_index, created_at, content_type, processed_at")
    .eq("batch_id", batchId)
    .order("student_index", { ascending: true })
    .order("page_index", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(500)

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return NextResponse.json({ groups: [], warning: "Tabla o columnas no aplicadas." })
    }
    if (error.message.includes("student_index") || error.message.includes("column")) {
      return NextResponse.json({
        groups: [],
        warning: "Ejecute la migración PASO C (student_index / page_index) en Supabase.",
      })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const photos = (data ?? []) as BatchPhotoInboxRow[]
  const groups = groupBatchPhotosByStudent(photos)

  return NextResponse.json({
    batch_id: batchId,
    groups,
    meta: {
      contract:
        "Cada grupo = un estudiante lógico (student_index). pages ordenadas por page_index; listo para mapear a exámenes en PC sin modificar OMR.",
    },
  })
}
