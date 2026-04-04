import { NextRequest, NextResponse } from "next/server"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { normalizeRutCanonical } from "@/app/lib/student-identity/rut"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET ?batch_id= — Fotos del lote móvil con URLs firmadas + slots promovidos (evaluations) para /evaluar.
 * Solo filas cuyo teacher_id coincide con el perfil del usuario.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const batchId = String(req.nextUrl.searchParams.get("batch_id") ?? "").trim()
  if (!batchId || !UUID_REGEX.test(batchId)) {
    return NextResponse.json({ error: "batch_id UUID inválido" }, { status: 400 })
  }

  const server = getSupabaseServer()
  if (!server) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: profile, error: pErr } = await server
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  const teacherId = (profile as { teacher_id?: string | null } | null)?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ error: "Perfil sin teacher_id" }, { status: 400 })
  }

  const { data: session } = await server
    .from("batch_scan_sessions")
    .select("teacher_id")
    .eq("batch_id", batchId)
    .maybeSingle()

  if (session && String((session as { teacher_id: string }).teacher_id) !== String(teacherId)) {
    return NextResponse.json({ error: "Este lote no pertenece a tu sesión docente" }, { status: 403 })
  }

  const { data: photos, error: phErr } = await server
    .from("batch_photo_uploads")
    .select("id, student_index, page_index, storage_path, evaluation_id, processed_at, status, content_type")
    .eq("batch_id", batchId)
    .eq("teacher_id", teacherId)
    .order("student_index", { ascending: true })
    .order("page_index", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(120)

  if (phErr) {
    if (phErr.message.includes("does not exist") || phErr.code === "42P01") {
      return NextResponse.json({ photos: [], slots: [], warning: "Tabla batch_photo_uploads no disponible." })
    }
    return NextResponse.json({ error: phErr.message }, { status: 500 })
  }

  const list = photos ?? []
  const withUrls: Array<{
    id: string
    student_index: number | null
    page_index: number | null
    storage_path: string | null
    evaluation_id: string | null
    processed_at: string | null
    status: string | null
    signed_url: string | null
  }> = []

  for (const row of list) {
    const path = (row as { storage_path?: string | null }).storage_path
    let signed: string | null = null
    if (path) {
      const { data: u } = await server.storage.from(BATCH_SCANS_BUCKET).createSignedUrl(path, 180)
      signed = u?.signedUrl ?? null
    }
    const r = row as {
      id: string
      student_index?: number | null
      page_index?: number | null
      storage_path?: string | null
      evaluation_id?: string | null
      processed_at?: string | null
      status?: string | null
    }
    withUrls.push({
      id: r.id,
      student_index: r.student_index ?? null,
      page_index: r.page_index ?? null,
      storage_path: r.storage_path ?? null,
      evaluation_id: r.evaluation_id ?? null,
      processed_at: r.processed_at ?? null,
      status: r.status ?? null,
      signed_url: signed,
    })
  }

  const { data: evalRows } = await server
    .from("evaluations")
    .select("id, batch_student_index")
    .eq("batch_id", batchId)
    .eq("teacher_id", teacherId)
    .not("batch_student_index", "is", null)
    .limit(200)

  const evalIds = (evalRows ?? []).map((e) => (e as { id: string }).id).filter(Boolean)
  /** Varias filas por evaluation_id (upserts distintos): fusionar nombre y RUT sin quedarnos solo con la primera. */
  const studentsByEval = new Map<string, { student_name: string | null; student_identifier: string | null }>()
  if (evalIds.length > 0) {
    const { data: stRows } = await server
      .from("evaluation_students")
      .select("evaluation_id, student_name, student_identifier")
      .in("evaluation_id", evalIds)
    for (const s of stRows ?? []) {
      const row = s as { evaluation_id: string; student_name?: string | null; student_identifier?: string | null }
      const evId = row.evaluation_id
      if (!evId) continue
      const sn = row.student_name != null && String(row.student_name).trim() !== "" ? String(row.student_name).trim() : null
      const sid =
        row.student_identifier != null && String(row.student_identifier).trim() !== ""
          ? String(row.student_identifier).trim()
          : null
      const cur = studentsByEval.get(evId) ?? { student_name: null, student_identifier: null }
      if (sn && !cur.student_name) cur.student_name = sn
      if (sid && !cur.student_identifier) cur.student_identifier = sid
      studentsByEval.set(evId, cur)
    }
  }

  const slots = (evalRows ?? []).map((e) => {
    const ev = e as { id: string; batch_student_index: number | null }
    const st = studentsByEval.get(ev.id)
    return {
      evaluation_id: ev.id,
      student_index: ev.batch_student_index,
      student_name: st?.student_name ?? null,
      student_rut: st?.student_identifier ?? null,
    }
  })

  for (const slot of slots) {
    const hasName = slot.student_name != null && String(slot.student_name).trim() !== ""
    if (hasName) continue
    const rutRaw = slot.student_rut?.trim()
    const rutNorm = rutRaw ? normalizeRutCanonical(rutRaw) : null
    if (!rutNorm) continue
    const { data: stu } = await server.from("students").select("full_name").eq("rut_norm", rutNorm).maybeSingle()
    const fn = (stu as { full_name?: string | null } | null)?.full_name?.trim()
    if (fn) slot.student_name = fn
  }

  return NextResponse.json({
    batch_id: batchId,
    photos: withUrls,
    slots,
    meta: {
      teacher_id: teacherId,
      count: withUrls.length,
    },
  })
}
