import { NextRequest, NextResponse } from "next/server"
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

export async function POST(req: NextRequest) {
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

  let body: { upload_id?: string } = {}
  try {
    body = (await req.json()) as { upload_id?: string }
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 })
  }

  const uploadId = String(body.upload_id ?? "").trim()
  if (!uploadId) return NextResponse.json({ ok: false, error: "upload_id requerido" }, { status: 400 })

  const { data: updated, error } = await supabase
    .from("utp_instrument_uploads")
    .update({ is_archived: true })
    .eq("id", uploadId)
    .eq("organization_id", orgId)
    .eq("is_archived", false)
    .select("id")
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ ok: false, error: "Instrumento no encontrado o ya archivado" }, { status: 404 })

  await supabase
    .from("source_exams")
    .update({ is_archived: true })
    .eq("utp_instrument_upload_id", uploadId)
    .eq("is_archived", false)

  return NextResponse.json({ ok: true, id: uploadId })
}
