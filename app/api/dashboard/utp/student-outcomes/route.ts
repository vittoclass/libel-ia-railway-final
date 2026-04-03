import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import {
  computeUtpStudentOutcomes,
  emptyStudentOutcomesPayload,
} from "@/app/lib/services/utp-student-outcomes"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function isAllowedRole(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

/**
 * GET /api/dashboard/utp/student-outcomes?audit_report_id=&page=&page_size=
 * Solo lectura. Fallos de agregación devuelven 200 con estructura vacía (sin 500).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

    const supabase = getSupabaseServer()
    if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle()

    const role = normalizeRole((profile as { role?: string | null } | null)?.role)
    if (!isAllowedRole(role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 })

    const auditReportId = String(req.nextUrl.searchParams.get("audit_report_id") ?? "").trim()
    const page = Number(req.nextUrl.searchParams.get("page") ?? "1")
    const pageSize = Number(req.nextUrl.searchParams.get("page_size") ?? "50")

    if (!auditReportId) {
      return NextResponse.json(emptyStudentOutcomesPayload("", ["missing_audit_report_id"]), { status: 200 })
    }

    try {
      const payload = await computeUtpStudentOutcomes(supabase, {
        auditReportId,
        page: Number.isFinite(page) ? page : 1,
        pageSize: Number.isFinite(pageSize) ? pageSize : 50,
        detectedSkills: [],
      })
      return NextResponse.json(payload, { status: 200 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return NextResponse.json(emptyStudentOutcomesPayload(auditReportId, [msg]), { status: 200 })
    }
  } catch {
    return NextResponse.json(emptyStudentOutcomesPayload("", ["route_error"]), { status: 200 })
  }
}
