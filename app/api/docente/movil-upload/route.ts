import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BYTES = 20 * 1024 * 1024

/**
 * POST /api/docente/movil-upload — Sin sesión. multipart: batch_id, student_index, page_index, file
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Servidor no configurado" }, { status: 503 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 })
  }

  const batchId = String(form.get("batch_id") ?? "").trim()
  if (!UUID_REGEX.test(batchId)) {
    return NextResponse.json({ error: "batch_id inválido" }, { status: 400 })
  }

  const studentIndex = Math.max(1, Math.min(500, Number(form.get("student_index")) || 1))
  const pageIndex = Math.max(1, Math.min(50, Number(form.get("page_index")) || 1))

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 })
  }

  const mime = (file.type || "").toLowerCase()
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "Solo imágenes" }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Archivo demasiado grande (máx. 20 MB)" }, { status: 400 })
  }

  const { data: sessionRow, error: sErr } = await supabase
    .from("batch_scan_sessions")
    .select("teacher_id, school_id, expires_at")
    .eq("batch_id", batchId)
    .maybeSingle()

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 })
  }

  if (!sessionRow) {
    return NextResponse.json({ error: "Lote no válido o no registrado" }, { status: 404 })
  }

  const row = sessionRow as { teacher_id: string; school_id: string; expires_at: string }
  const exp = new Date(row.expires_at)
  if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
    return NextResponse.json({ error: "Código QR expirado" }, { status: 410 })
  }

  const teacherId = String(row.teacher_id)
  const schoolId = String(row.school_id)

  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg"
  const objectName = `s${studentIndex}_p${pageIndex}_${crypto.randomUUID()}.${ext}`
  const storagePath = `${teacherId}/${batchId}/${objectName}`

  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await supabase.storage.from(BATCH_SCANS_BUCKET).upload(storagePath, buffer, {
    contentType: mime || "image/jpeg",
    upsert: false,
  })

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const { error: insErr } = await supabase.from("batch_photo_uploads").insert({
    batch_id: batchId,
    school_id: schoolId,
    teacher_id: teacherId,
    storage_path: storagePath,
    content_type: mime || null,
    file_size: file.size,
    created_by: null,
    student_index: studentIndex,
    page_index: pageIndex,
  })

  if (insErr) {
    await supabase.storage.from(BATCH_SCANS_BUCKET).remove([storagePath]).catch(() => {})
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    student_index: studentIndex,
    page_index: pageIndex,
  })
}
