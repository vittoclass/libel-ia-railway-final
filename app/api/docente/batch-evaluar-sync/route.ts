import { NextRequest, NextResponse } from "next/server"
import { parseBatchPhotoPageParams } from "@/app/lib/docente/batch-photo-pagination"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { normalizeRutCanonical } from "@/app/lib/student-identity/rut"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET ?batch_id=&offset=&limit= — Fotos del lote móvil con URLs firmadas + slots (solo offset=0) para /evaluar.
 * Paginación: `limit` por defecto 90, máx 120; `meta.has_more` / `next_offset` para seguir leyendo.
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

  const { offset, limit } = parseBatchPhotoPageParams(req.nextUrl.searchParams)
  const rangeEnd = offset + limit - 1

  const { data: photos, error: phErr } = await server
    .from("batch_photo_uploads")
    .select("id, student_index, page_index, storage_path, evaluation_id, processed_at, status, content_type")
    .eq("batch_id", batchId)
    .eq("teacher_id", teacherId)
    .order("student_index", { ascending: true })
    .order("page_index", { ascending: true })
    .order("created_at", { ascending: true })
    .range(offset, rangeEnd)

  if (phErr) {
    if (phErr.message.includes("does not exist") || phErr.code === "42P01") {
      return NextResponse.json({ photos: [], slots: [], warning: "Tabla batch_photo_uploads no disponible." })
    }
    return NextResponse.json({ error: phErr.message }, { status: 500 })
  }

  const list = photos ?? []
  const hasMore = list.length === limit
  const nextOffset = hasMore ? offset + limit : offset + list.length
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

  type BatchEvaluarSlot = {
    evaluation_id: string | null
    student_index: number | null
    student_name: string | null
    student_rut: string | null
    grade_chile: number | null
    is_evaluated: boolean
    slot_phase: "corregido" | "vinculado" | "captura" | "pendiente"
  }

  let slots: BatchEvaluarSlot[] = []

  if (offset === 0) {
    const { data: evalRows } = await server
      .from("evaluations")
      .select("id, batch_student_index")
      .eq("batch_id", batchId)
      .eq("teacher_id", teacherId)
      .not("batch_student_index", "is", null)
      .limit(220)

    const { data: photoIndexRows } = await server
      .from("batch_photo_uploads")
      .select("student_index, evaluation_id")
      .eq("batch_id", batchId)
      .eq("teacher_id", teacherId)
      .not("student_index", "is", null)
      .limit(2000)

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

    const slotByIndex = new Map<
      number,
      { evaluation_id: string | null; student_name: string | null; student_rut: string | null }
    >()

    for (const e of evalRows ?? []) {
      const ev = e as { id: string; batch_student_index: number | null }
      if (ev.batch_student_index == null || ev.batch_student_index < 1) continue
      const st = studentsByEval.get(ev.id)
      slotByIndex.set(ev.batch_student_index, {
        evaluation_id: ev.id,
        student_name: st?.student_name ?? null,
        student_rut: st?.student_identifier ?? null,
      })
    }

    const hasPhotosByIndex = new Map<number, boolean>()
    for (const row of photoIndexRows ?? []) {
      const pr = row as { student_index?: number | null; evaluation_id?: string | null }
      const si = pr.student_index
      if (si == null || si < 1) continue
      hasPhotosByIndex.set(si, true)
      const cur = slotByIndex.get(si) ?? { evaluation_id: null, student_name: null, student_rut: null }
      const photoEvalId = pr.evaluation_id != null && String(pr.evaluation_id).trim() !== "" ? String(pr.evaluation_id).trim() : null
      if (!cur.evaluation_id && photoEvalId) cur.evaluation_id = photoEvalId
      slotByIndex.set(si, cur)
    }

    const allEvalIds = [
      ...new Set(
        [...slotByIndex.values()]
          .map((s) => s.evaluation_id)
          .filter((id): id is string => id != null && id.trim() !== ""),
      ),
    ]

    const gradeChileByEval = new Map<string, number | null>()
    const hasItemsByEval = new Set<string>()
    if (allEvalIds.length > 0) {
      const { data: summaryRows } = await server
        .from("evaluation_summaries")
        .select("evaluation_id, grade_chile")
        .in("evaluation_id", allEvalIds)
      for (const s of summaryRows ?? []) {
        const row = s as { evaluation_id: string; grade_chile?: number | null }
        if (row.evaluation_id) gradeChileByEval.set(row.evaluation_id, row.grade_chile ?? null)
      }

      const { data: itemRows } = await server
        .from("evaluation_items")
        .select("evaluation_id")
        .in("evaluation_id", allEvalIds)
        .limit(5000)
      for (const item of itemRows ?? []) {
        const evId = (item as { evaluation_id?: string }).evaluation_id
        if (evId) hasItemsByEval.add(evId)
      }
    }

    slots = [...slotByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([student_index, base]) => {
        const evaluation_id = base.evaluation_id
        const grade_chile = evaluation_id ? (gradeChileByEval.get(evaluation_id) ?? null) : null
        const hasGrade = grade_chile != null
        const hasItems = evaluation_id ? hasItemsByEval.has(evaluation_id) : false
        const is_evaluated = hasGrade || hasItems
        let slot_phase: BatchEvaluarSlot["slot_phase"] = "pendiente"
        if (is_evaluated) slot_phase = "corregido"
        else if (evaluation_id) slot_phase = "vinculado"
        else if (hasPhotosByIndex.get(student_index)) slot_phase = "captura"
        return {
          student_index,
          evaluation_id,
          student_name: base.student_name,
          student_rut: base.student_rut,
          grade_chile,
          is_evaluated,
          slot_phase,
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
  }

  const evaluatedStudentIndexes = new Set<number>()
  if (offset === 0) {
    for (const slot of slots) {
      if (slot.is_evaluated && slot.student_index != null && slot.student_index >= 1) {
        evaluatedStudentIndexes.add(slot.student_index)
      }
    }
  } else {
    const { data: evalRowsForFilter } = await server
      .from("evaluations")
      .select("id, batch_student_index")
      .eq("batch_id", batchId)
      .eq("teacher_id", teacherId)
      .not("batch_student_index", "is", null)
      .limit(220)

    const filterEvalIds = (evalRowsForFilter ?? [])
      .map((e) => (e as { id: string }).id)
      .filter(Boolean)
    const gradeByEval = new Map<string, number | null>()
    const hasItemsByEval = new Set<string>()
    if (filterEvalIds.length > 0) {
      const { data: summaryRows } = await server
        .from("evaluation_summaries")
        .select("evaluation_id, grade_chile")
        .in("evaluation_id", filterEvalIds)
      for (const s of summaryRows ?? []) {
        const row = s as { evaluation_id: string; grade_chile?: number | null }
        if (row.evaluation_id) gradeByEval.set(row.evaluation_id, row.grade_chile ?? null)
      }
      const { data: itemRows } = await server
        .from("evaluation_items")
        .select("evaluation_id")
        .in("evaluation_id", filterEvalIds)
        .limit(5000)
      for (const item of itemRows ?? []) {
        const evId = (item as { evaluation_id?: string }).evaluation_id
        if (evId) hasItemsByEval.add(evId)
      }
    }
    for (const e of evalRowsForFilter ?? []) {
      const ev = e as { id: string; batch_student_index: number | null }
      if (ev.batch_student_index == null || ev.batch_student_index < 1) continue
      const hasGrade = gradeByEval.get(ev.id) != null
      const hasItems = hasItemsByEval.has(ev.id)
      if (hasGrade || hasItems) evaluatedStudentIndexes.add(ev.batch_student_index)
    }
  }

  let filteredLinkedPhotosCount = 0
  let filteredEvaluatedSlotPhotosCount = 0
  const photosForEvaluar = withUrls.filter((photo) => {
    const linkedEvalId =
      photo.evaluation_id != null && String(photo.evaluation_id).trim() !== "" ? String(photo.evaluation_id).trim() : null
    if (photo.status === "linked" && linkedEvalId) {
      filteredLinkedPhotosCount++
      return false
    }
    const si = photo.student_index
    if (si != null && si >= 1 && evaluatedStudentIndexes.has(si)) {
      filteredEvaluatedSlotPhotosCount++
      return false
    }
    return true
  })

  return NextResponse.json({
    batch_id: batchId,
    photos: photosForEvaluar,
    slots,
    meta: {
      teacher_id: teacherId,
      offset,
      limit,
      count: photosForEvaluar.length,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
    },
    ...(process.env.NODE_ENV === "development"
      ? {
          debug: {
            filteredLinkedPhotosCount,
            filteredEvaluatedSlotPhotosCount,
          },
        }
      : {}),
  })
}
