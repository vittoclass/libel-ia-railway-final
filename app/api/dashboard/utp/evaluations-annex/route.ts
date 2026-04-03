import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function isAllowedRole(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

/**
 * POST — Anexa una evaluación huérfana a un lote existente (solo batch_id).
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  if (!isMasterEmail(user.email) && !isAllowedRole(role))
    return NextResponse.json({ ok: false, error: "Prohibido" }, { status: 403 })

  let body: { evaluation_id?: string; target_batch_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const evaluation_id = String(body?.evaluation_id ?? "").trim()
  const target_batch_id = String(body?.target_batch_id ?? "").trim()
  if (!evaluation_id || !target_batch_id) {
    return NextResponse.json({ ok: false, error: "evaluation_id y target_batch_id son requeridos" }, { status: 400 })
  }
  if (!UUID_REGEX.test(evaluation_id) || !UUID_REGEX.test(target_batch_id)) {
    return NextResponse.json({ ok: false, error: "IDs inválidos" }, { status: 400 })
  }

  const schoolId = (profile as { school_id?: string | null } | null)?.school_id ?? null

  const { data: targetMember } = await supabase.from("evaluations").select("id, school_id, batch_id").eq("batch_id", target_batch_id).limit(1).maybeSingle()

  const { data: orphan } = await supabase.from("evaluations").select("id, school_id, batch_id").eq("id", evaluation_id).maybeSingle()

  if (!orphan?.id) return NextResponse.json({ ok: false, error: "Evaluación no encontrada" }, { status: 404 })
  if (!targetMember?.id) return NextResponse.json({ ok: false, error: "Lote destino no encontrado" }, { status: 404 })

  const orphanSchool = (orphan as { school_id?: string | null }).school_id
  const targetSchool = (targetMember as { school_id?: string | null }).school_id
  if (schoolId && orphanSchool !== schoolId) {
    return NextResponse.json({ ok: false, error: "Evaluación fuera del alcance del colegio" }, { status: 403 })
  }
  if (schoolId && targetSchool !== schoolId) {
    return NextResponse.json({ ok: false, error: "Lote fuera del alcance del colegio" }, { status: 403 })
  }

  if ((orphan as { batch_id?: string | null }).batch_id) {
    return NextResponse.json({ ok: false, error: "La evaluación ya tiene lote asignado" }, { status: 400 })
  }

  const { error: upErr } = await supabase.from("evaluations").update({ batch_id: target_batch_id }).eq("id", evaluation_id)
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 200 })

  return NextResponse.json({ ok: true, evaluation_id, batch_id: target_batch_id })
}
