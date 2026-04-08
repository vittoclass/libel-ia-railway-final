import { NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function isAllowedRole(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

function scopeOrganization(profile: { organization_id?: string | null; school_id?: string | null; teacher_id?: string | null } | null): string | null {
  return profile?.organization_id ?? profile?.school_id ?? profile?.teacher_id ?? null
}

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id, school_id, teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  if (!isMasterEmail(user.email) && !isAllowedRole(role)) {
    return NextResponse.json({ ok: false, error: "Prohibido" }, { status: 403 })
  }

  const orgId = scopeOrganization(profile as { organization_id?: string | null; school_id?: string | null; teacher_id?: string | null } | null)
  if (!orgId) return NextResponse.json({ ok: false, error: "Perfil sin alcance institucional" }, { status: 409 })

  const { data: updated, error } = await supabase
    .from("utp_instrument_uploads")
    .update({ is_archived: true })
    .eq("organization_id", orgId)
    .eq("is_archived", false)
    .select("id")

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const ids = (updated ?? []).map((r) => String((r as { id: string }).id)).filter(Boolean)
  if (ids.length > 0) {
    await supabase.from("source_exams").update({ is_archived: true }).in("utp_instrument_upload_id", ids).eq("is_archived", false)
  }

  return NextResponse.json({ ok: true, archived_count: (updated ?? []).length })
}
