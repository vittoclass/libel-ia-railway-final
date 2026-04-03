import { NextRequest, NextResponse } from "next/server"
import {
  BATCH_RELEASE_PENDING_UTP,
  BATCH_RELEASE_REJECTED,
  BATCH_RELEASE_VALIDATED,
} from "@/app/lib/evaluation-batch-release"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { refreshSkillRollupForBatch } from "@/app/lib/skill-traceability/rollup-refresh"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

/** Solo UTP (y admin) aprueba o rechaza; Dirección no actúa como guardián de calidad. */
function canDecide(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

type Body = { batch_id?: string; action?: string; observations?: string | null }

/**
 * POST { batch_id, action: "approve" | "reject", observations? } — Decisión UTP.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const batchId = String(body.batch_id ?? "").trim()
  const action = String(body.action ?? "").trim().toLowerCase()
  const observations = body.observations != null ? String(body.observations).trim() : ""

  if (!batchId) return NextResponse.json({ error: "batch_id requerido" }, { status: 400 })
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action debe ser approve o reject" }, { status: 400 })
  }
  if (action === "reject" && observations.length < 3) {
    return NextResponse.json({ error: "Indique observaciones al devolver el lote (mín. 3 caracteres)" }, { status: 400 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  if (!canDecide(role)) {
    return NextResponse.json({ error: "Solo UTP o administración pueden validar lotes" }, { status: 403 })
  }

  const schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
  if (!schoolId && !isDashboardInstitutionalRelaxEnabled()) {
    return NextResponse.json({ error: "school_id requerido en perfil" }, { status: 400 })
  }

  const { data: row, error: selErr } = await supabase
    .from("evaluation_batch_institutional_release")
    .select("batch_id, school_id, status")
    .eq("batch_id", batchId)
    .maybeSingle()

  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 })
  const r = row as { school_id?: string; status?: string } | null
  if (!r) return NextResponse.json({ error: "Lote sin registro de envío" }, { status: 404 })

  if (schoolId && String(r.school_id ?? "") !== schoolId) {
    return NextResponse.json({ error: "El lote pertenece a otro colegio" }, { status: 403 })
  }

  if (String(r.status ?? "") !== BATCH_RELEASE_PENDING_UTP) {
    return NextResponse.json({ error: "Solo se puede decidir sobre lotes en estado pending_utp" }, { status: 409 })
  }

  const now = new Date().toISOString()
  const nextStatus = action === "approve" ? BATCH_RELEASE_VALIDATED : BATCH_RELEASE_REJECTED

  const { error: upErr } = await supabase
    .from("evaluation_batch_institutional_release")
    .update({
      status: nextStatus,
      reviewed_by: user.id,
      reviewed_at: now,
      utp_observations: action === "reject" ? observations : null,
      updated_at: now,
    })
    .eq("batch_id", batchId)
    .eq("status", BATCH_RELEASE_PENDING_UTP)

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await refreshSkillRollupForBatch(supabase, batchId)

  return NextResponse.json({
    ok: true,
    batch_id: batchId,
    status: nextStatus,
    message: action === "approve" ? "Lote aprobado. Los datos cuentan en trazabilidad institucional." : "Lote devuelto al docente.",
  })
}
