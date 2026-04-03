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

  const [photosRes, sessionRes] = await Promise.all([
    supabase
      .from("batch_photo_uploads")
      .select(
        "id, batch_id, storage_path, processed_at, created_at, content_type, student_index, page_index, evaluation_id, status",
      )
      .eq("batch_id", batchId)
      .order("student_index", { ascending: true })
      .order("page_index", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("batch_scan_sessions")
      .select("expected_pages_per_student, source_exam_id")
      .eq("batch_id", batchId)
      .maybeSingle(),
  ])

  const { data, error } = photosRes
  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return NextResponse.json({ photos: [], warning: "Tabla batch_photo_uploads no aplicada aún." })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let expected_pages_per_student: number | null = null
  let source_exam_id: string | null = null
  if (!sessionRes.error && sessionRes.data) {
    const sess = sessionRes.data as { expected_pages_per_student?: number | null; source_exam_id?: string | null }
    const rawEp = sess.expected_pages_per_student
    if (rawEp != null && Number.isFinite(Number(rawEp))) {
      expected_pages_per_student = Math.max(1, Math.min(50, Math.floor(Number(rawEp))))
    }
    source_exam_id = sess.source_exam_id ?? null
  }

  return NextResponse.json({
    photos: data ?? [],
    session: {
      expected_pages_per_student,
      source_exam_id,
    },
  })
}
