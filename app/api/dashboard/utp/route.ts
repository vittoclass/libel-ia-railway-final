import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function canAccessUtpApi(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

// PHASE_5_INSTITUTIONAL_V1
export async function GET(_req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  console.log("ROL DETECTADO:", role, "| profile.role:", (profile as { role?: string | null } | null)?.role ?? null)
  if (!canAccessUtpApi(role)) {
    return NextResponse.json({ error: "Prohibido" }, { status: 403 })
  }

  const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null
  try {
    let query = supabase
      .from("evaluation_audit_logs")
      .select("id, actor_id, action, target_id, target_type, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
    if (orgId) query = query.eq("organization_id", orgId)
    const { data, error } = await query
    if (error) {
      return NextResponse.json({ items: [], warning: error.message }, { status: 200 })
    }
    const items = (data ?? []).map((r) => ({
      id: r.id,
      actor_id: r.actor_id,
      actor_name: String((r.metadata as Record<string, unknown> | null)?.["actor_name"] ?? r.actor_id).slice(0, 40),
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      student_or_course: String((r.metadata as Record<string, unknown> | null)?.["student_or_course"] ?? "—"),
      created_at: r.created_at,
    }))
    // PHASE_6_NORMATIVE_ENGINE_V1: incluir foco de riesgo desde student_projections
    let projectionsQuery = supabase
      .from("student_projections")
      .select("id, organization_id, student_id, evaluation_id, logro_pct, simce_level_label, paes_estimated, risk_level, calculated_at")
      .order("calculated_at", { ascending: false })
      .limit(150)
    if (orgId) projectionsQuery = projectionsQuery.eq("organization_id", orgId)
    let { data: projections, error: projectionsErr } = await projectionsQuery
    if (projectionsErr) {
      const fallback = await supabase
        .from("student_projections")
        .select(
          "id, organization_id, student_id, evaluation_id, logro_pct, simce_level_label, paes_estimated, risk_level, calculated_at",
        )
        .order("calculated_at", { ascending: false })
        .limit(150)
      projections = fallback.data ?? []
      projectionsErr = fallback.error
    }

    const riskRows = ((projections ?? []) as Array<{
      id: string
      student_id: string | null
      evaluation_id: string | null
      logro_pct: number | null
      simce_level_label: string | null
      paes_estimated: number | null
      risk_level: string | null
      calculated_at: string | null
    }>)
      .filter((r) => {
        const k = String(r.risk_level ?? "").toUpperCase()
        return k === "ALTO" || k === "CRITICO"
      })
      .slice(0, 30)
      .map((r) => ({
        id: r.id,
        student_id: r.student_id,
        evaluation_id: r.evaluation_id,
        logro_pct: Number(r.logro_pct) || 0,
        agency_level: r.simce_level_label ?? null,
        paes_estimated: r.paes_estimated ?? null,
        risk_level: r.risk_level ?? null,
        calculated_at: r.calculated_at ?? null,
      }))

    const semaforo = (projections ?? []).reduce(
      (acc, r: { simce_level_label?: string | null; logro_pct?: number | null }) => {
        const lvl = String(r.simce_level_label ?? "").toUpperCase()
        const logro = Number(r.logro_pct)
        if (lvl === "INSUFICIENTE" || (!lvl && Number.isFinite(logro) && logro < 50)) acc.insuficiente++
        else if (lvl === "ELEMENTAL" || (!lvl && Number.isFinite(logro) && logro < 70)) acc.elemental++
        else if (lvl === "ADECUADO" || (!lvl && Number.isFinite(logro) && logro >= 70)) acc.adecuado++
        return acc
      },
      { insuficiente: 0, elemental: 0, adecuado: 0 }
    )

    return NextResponse.json({
      items,
      risk_rows: riskRows,
      semaforo: {
        ...semaforo,
        total: (projections ?? []).length,
      },
      warning: projectionsErr ? String(projectionsErr.message) : undefined,
    })
  } catch (e) {
    return NextResponse.json({ items: [], warning: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
