import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type UploadRow = {
  id: string
  batch_id: string | null
  teacher_id: string | null
  storage_path: string | null
  evaluation_id: string | null
  status: string | null
}

/**
 * DELETE ?photo_id=&batch_id=
 * Borra una fila de batch_photo_uploads y el objeto en Storage del docente dueño.
 * No altera evaluaciones ya vinculadas (evaluation_id / status linked).
 */
export async function DELETE(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const photoId = String(req.nextUrl.searchParams.get("photo_id") ?? "").trim()
  const batchId = String(req.nextUrl.searchParams.get("batch_id") ?? "").trim()
  if (!photoId || !UUID_REGEX.test(photoId)) {
    return NextResponse.json({ error: "photo_id UUID inválido" }, { status: 400 })
  }
  if (!batchId || !UUID_REGEX.test(batchId)) {
    return NextResponse.json({ error: "batch_id UUID inválido" }, { status: 400 })
  }

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  const teacherId = (profile as { teacher_id?: string | null } | null)?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ error: "Perfil sin teacher_id" }, { status: 400 })
  }

  const { data: row, error: selErr } = await supabase
    .from("batch_photo_uploads")
    .select("id, batch_id, teacher_id, storage_path, evaluation_id, status")
    .eq("id", photoId)
    .maybeSingle()

  if (selErr) {
    if (selErr.message.includes("does not exist") || selErr.code === "42P01") {
      return NextResponse.json({ error: "Tabla no disponible" }, { status: 503 })
    }
    return NextResponse.json({ error: selErr.message }, { status: 500 })
  }

  const r = row as UploadRow | null
  if (!r || r.batch_id !== batchId || r.teacher_id !== teacherId) {
    return NextResponse.json({ error: "Foto no encontrada o sin permiso" }, { status: 404 })
  }

  if (r.evaluation_id || String(r.status ?? "").toLowerCase() === "linked") {
    return NextResponse.json(
      {
        error: "Esta imagen ya fue sincronizada al evaluador y no puede eliminarse desde la estación.",
        code: "ALREADY_LINKED",
      },
      { status: 409 },
    )
  }

  const path = r.storage_path?.trim()
  if (path) {
    const { error: rmErr } = await supabase.storage.from(BATCH_SCANS_BUCKET).remove([path])
    if (rmErr) {
      return NextResponse.json({ error: `Storage: ${rmErr.message}` }, { status: 500 })
    }
  }

  const { error: delErr } = await supabase.from("batch_photo_uploads").delete().eq("id", photoId).eq("teacher_id", teacherId)

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
