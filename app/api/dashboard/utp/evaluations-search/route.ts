import { NextRequest, NextResponse } from "next/server"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function isAllowedRole(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

/**
 * GET /api/dashboard/utp/evaluations-search?q=&limit=
 * Listado ligero de evaluaciones para vínculo UTP (read-only).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ items: [] }, { status: 200 })

    const supabase = getSupabaseServer()
    if (!supabase) return NextResponse.json({ items: [] }, { status: 200 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle()

    const role = normalizeRole((profile as { role?: string | null } | null)?.role)
    if (!isAllowedRole(role)) return NextResponse.json({ items: [] }, { status: 200 })

    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim()
    const limit = Math.min(80, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 40) || 40))

    let query = supabase
      .from("evaluations")
      .select("id, title, subject, course_label, evaluated_at")
      .order("evaluated_at", { ascending: false, nullsFirst: false })
      .limit(limit)

    if (q.length >= 2) {
      const safe = `%${q.replace(/[%_,]/g, "").slice(0, 64)}%`
      query = query.or(`title.ilike.${safe},course_label.ilike.${safe},subject.ilike.${safe}`)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ items: [], warning: error.message }, { status: 200 })
    }

    const items = (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      title: row.title != null ? String(row.title) : null,
      subject: row.subject != null ? String(row.subject) : null,
      course_label: row.course_label != null ? String(row.course_label) : null,
      evaluated_at: row.evaluated_at != null ? String(row.evaluated_at) : null,
    }))

    return NextResponse.json({ items }, { status: 200 })
  } catch {
    return NextResponse.json({ items: [] }, { status: 200 })
  }
}
