import { NextRequest, NextResponse } from "next/server"
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
  if (!isMasterEmail(user.email) && !canAccessUtpApi(role)) {
    return NextResponse.json({ ok: false, error: "Prohibido" }, { status: 403 })
  }

  let body: { batch_id?: string } = {}
  try {
    body = (await req.json()) as { batch_id?: string }
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 })
  }

  const batchId = String(body.batch_id ?? "").trim()
  if (!batchId) return NextResponse.json({ ok: false, error: "batch_id requerido" }, { status: 400 })

  const schoolId = (profile as { school_id?: string | null } | null)?.school_id ?? null
  const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null
  const teacherId = (profile as { teacher_id?: string | null } | null)?.teacher_id ?? null

  let q = supabase
    .from("batch_scan_sessions")
    .update({ is_archived: true })
    .eq("batch_id", batchId)
    .eq("is_archived", false)

  if (schoolId) q = q.eq("school_id", schoolId)
  else if (teacherId) q = q.eq("teacher_id", teacherId)
  else if (orgId) {
    const { data: peers } = await supabase
      .from("profiles")
      .select("teacher_id")
      .eq("organization_id", orgId)
      .not("teacher_id", "is", null)
    const tids = [...new Set((peers ?? []).map((p: { teacher_id?: string | null }) => p.teacher_id).filter(Boolean))] as string[]
    if (tids.length > 0) q = q.in("teacher_id", tids)
  }

  const { data: updated, error } = await q.select("batch_id").maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ ok: false, error: "Lote no encontrado o ya archivado" }, { status: 404 })

  return NextResponse.json({ ok: true, batch_id: batchId })
}
