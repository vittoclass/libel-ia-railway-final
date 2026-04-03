import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function canAccess(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "DIRECCION" || role === "UTP" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

/**
 * Catálogo ligero de habilidades por asignatura (solo lectura). No depende de ENABLE_PEDAGOGY.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  if (!canAccess(role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 })

  const subject = String(req.nextUrl.searchParams.get("subject") ?? "Lenguaje").trim() || "Lenguaje"

  const { data: axes } = await supabase.from("pedagogy_axes").select("id, name, subject").eq("subject", subject).order("name")

  const axisIds = (axes ?? []).map((a: { id: string }) => a.id)
  let skills: Array<{ id: string; axis_id: string; name: string; axis_name?: string }> = []
  if (axisIds.length > 0) {
    const { data: sk } = await supabase
      .from("pedagogy_skills")
      .select("id, axis_id, name")
      .in("axis_id", axisIds)
      .order("name")
    const axisName = new Map((axes ?? []).map((a: { id: string; name: string }) => [a.id, a.name]))
    skills = (sk ?? []).map((s: { id: string; axis_id: string; name: string }) => ({
      ...s,
      axis_name: axisName.get(s.axis_id),
    }))
  }

  return NextResponse.json({ subject, axes: axes ?? [], skills })
}
