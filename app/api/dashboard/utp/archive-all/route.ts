import { NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function canAccessUtpApi(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  if (!isMasterEmail(user.email) && !canAccessUtpApi(role)) {
    return NextResponse.json({ ok: false, error: "Prohibido" }, { status: 403 })
  }

  const schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
  if (!schoolId) {
    return NextResponse.json({ ok: false, error: "Perfil sin school_id" }, { status: 409 })
  }

  const { data: archivedBatches, error: batchesErr } = await supabase
    .from("batch_scan_sessions")
    .update({ is_archived: true })
    .eq("school_id", schoolId)
    .eq("is_archived", false)
    .select("batch_id")

  if (batchesErr) return NextResponse.json({ ok: false, error: batchesErr.message }, { status: 500 })

  const { data: archivedEvals, error: evalsErr } = await supabase
    .from("evaluations")
    .update({ is_archived: true })
    .eq("school_id", schoolId)
    .eq("is_archived", false)
    .select("id")

  if (evalsErr) return NextResponse.json({ ok: false, error: evalsErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    archived_batches: (archivedBatches ?? []).length,
    archived_evaluations: (archivedEvals ?? []).length,
  })
}
