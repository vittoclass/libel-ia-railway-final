import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { canReadEvaluationInAppScope, normUuid, profileScopeFromRow } from "@/app/lib/evaluation-read-scope"

export const dynamic = "force-dynamic"

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)

/** GET /api/batch-exports — Historial del usuario (más recientes primero). */
export async function GET() {
  const { user } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data, error } = await supabase
    .from("batch_exports")
    .select("id, batch_id, zip_filename, exam_title, course_label, evaluation_count, evaluation_ids, storage_path, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) {
    if (error.code === "42P01" || error.message?.includes("does not exist")) {
      return NextResponse.json({ exports: [], message: "Tabla batch_exports pendiente de migración." })
    }
    console.error("[batch-exports GET]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ exports: data ?? [] }, { status: 200, headers: { "Cache-Control": "no-store" } })
}

type PostBody = {
  batch_id?: string
  zip_filename?: string
  exam_title?: string | null
  course_label?: string | null
  evaluation_ids?: string[]
}

/** POST /api/batch-exports — Registra una exportación tras generar el ZIP en el cliente. */
export async function POST(req: NextRequest) {
  const { user } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const batchId = typeof body.batch_id === "string" ? body.batch_id.trim() : ""
  const zipFilename = typeof body.zip_filename === "string" ? body.zip_filename.trim() : ""
  const idsRaw = Array.isArray(body.evaluation_ids) ? body.evaluation_ids : []
  const evaluation_ids = [...new Set(idsRaw.map((x) => String(x).trim()).filter((x) => isUuid(x)))]

  if (!isUuid(batchId) || !zipFilename || evaluation_ids.length === 0) {
    return NextResponse.json({ error: "Faltan batch_id, zip_filename o evaluation_ids" }, { status: 400 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profileRow } = await supabase.from("profiles").select("teacher_id, school_id").eq("user_id", user.id).maybeSingle()
  const { teacher_id_used, school_id_used } = profileScopeFromRow(profileRow)

  const { data: evs, error: evErr } = await supabase
    .from("evaluations")
    .select("id, batch_id, teacher_id, user_id, school_id")
    .in("id", evaluation_ids)

  if (evErr) {
    console.error("[batch-exports POST] evaluations", evErr)
    return NextResponse.json({ error: evErr.message }, { status: 500 })
  }

  const found = evs ?? []
  if (found.length !== evaluation_ids.length) {
    return NextResponse.json({ error: "Alguna evaluación no existe o no está accesible" }, { status: 400 })
  }

  const batchNorm = normUuid(batchId)
  for (const ev of found) {
    if (normUuid((ev as { batch_id?: string | null }).batch_id) !== batchNorm) {
      return NextResponse.json({ error: "Las evaluaciones no pertenecen al lote indicado" }, { status: 400 })
    }
    const ok = canReadEvaluationInAppScope({
      userId: user.id,
      evaluation: ev as { teacher_id?: string | null; user_id?: string | null; school_id?: string | null },
      teacher_id_used,
      school_id_used,
    })
    if (!ok) return NextResponse.json({ error: "No autorizado para una o más evaluaciones" }, { status: 403 })
  }

  const exam_title = body.exam_title != null ? String(body.exam_title).slice(0, 500) : null
  const course_label = body.course_label != null ? String(body.course_label).slice(0, 500) : null

  const { data: inserted, error: insErr } = await supabase
    .from("batch_exports")
    .insert({
      user_id: user.id,
      batch_id: batchId,
      zip_filename: zipFilename.slice(0, 240),
      exam_title,
      course_label,
      evaluation_ids,
      evaluation_count: evaluation_ids.length,
      storage_path: null,
    })
    .select("id, created_at")
    .maybeSingle()

  if (insErr) {
    if (insErr.code === "42P01" || insErr.message?.includes("does not exist")) {
      return NextResponse.json({ error: "Tabla batch_exports no creada; aplica migraciones Supabase." }, { status: 503 })
    }
    console.error("[batch-exports POST] insert", insErr)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, record: inserted }, { status: 201 })
}
