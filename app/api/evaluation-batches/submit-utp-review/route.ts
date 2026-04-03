import { NextRequest, NextResponse } from "next/server"
import { BATCH_RELEASE_PENDING_UTP, BATCH_RELEASE_REJECTED, BATCH_RELEASE_VALIDATED } from "@/app/lib/evaluation-batch-release"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { refreshSkillRollupForBatch } from "@/app/lib/skill-traceability/rollup-refresh"

export const dynamic = "force-dynamic"

/**
 * POST { batch_id } — Docente envía el lote a revisión UTP (embudo calidad).
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  let body: { batch_id?: string } = {}
  try {
    body = (await req.json()) as { batch_id?: string }
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const batchId = String(body.batch_id ?? "").trim()
  if (!batchId) return NextResponse.json({ error: "batch_id requerido" }, { status: 400 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacherId = String((profile as { teacher_id?: string | null } | null)?.teacher_id ?? "").trim()
  const schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
  if (!teacherId || !schoolId) {
    return NextResponse.json({ error: "Complete teacher_id y school_id en su perfil" }, { status: 403 })
  }

  const { data: evs, error: evErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, school_id")
    .eq("batch_id", batchId)
    .limit(500)

  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
  if (!evs?.length) return NextResponse.json({ error: "No hay evaluaciones en este lote" }, { status: 400 })

  for (const e of evs) {
    const row = e as { teacher_id?: string | null; school_id?: string | null }
    if (String(row.teacher_id ?? "").trim() !== teacherId) {
      return NextResponse.json({ error: "El lote contiene evaluaciones de otro docente" }, { status: 403 })
    }
    if (String(row.school_id ?? "").trim() !== schoolId) {
      return NextResponse.json({ error: "Inconsistencia de colegio en el lote" }, { status: 400 })
    }
  }

  const { data: existing } = await supabase
    .from("evaluation_batch_institutional_release")
    .select("status")
    .eq("batch_id", batchId)
    .maybeSingle()

  const prev = String((existing as { status?: string } | null)?.status ?? "").trim()
  if (prev === BATCH_RELEASE_VALIDATED) {
    return NextResponse.json({ error: "Este lote ya fue validado por UTP" }, { status: 409 })
  }
  if (prev === BATCH_RELEASE_PENDING_UTP) {
    return NextResponse.json({ error: "Este lote ya está en revisión UTP" }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { error: upErr } = await supabase.from("evaluation_batch_institutional_release").upsert(
    {
      batch_id: batchId,
      school_id: schoolId,
      status: BATCH_RELEASE_PENDING_UTP,
      submitted_by: user.id,
      submitted_at: now,
      reviewed_by: null,
      reviewed_at: null,
      utp_observations: null,
      updated_at: now,
    },
    { onConflict: "batch_id" },
  )

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await refreshSkillRollupForBatch(supabase, batchId)

  return NextResponse.json({
    ok: true,
    batch_id: batchId,
    status: BATCH_RELEASE_PENDING_UTP,
    message:
      prev === BATCH_RELEASE_REJECTED
        ? "Lote reenviado a revisión UTP."
        : "Lote enviado a revisión UTP. La trazabilidad institucional se actualizará tras el visto bueno.",
  })
}
