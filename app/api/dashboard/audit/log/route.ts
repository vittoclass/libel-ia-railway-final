import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { logAction } from "@/app/lib/audit"

export const dynamic = "force-dynamic"

// PHASE_5_INSTITUTIONAL_V1
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 503 })
  let body: {
    action?: string
    targetId?: string
    targetType?: string
    metadata?: Record<string, unknown> | null
  } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 })
  }

  const action = String(body.action ?? "").trim() || "OTRA_ACCION"
  const targetId = String(body.targetId ?? "").trim()
  if (!targetId) return NextResponse.json({ ok: false, error: "targetId es requerido" }, { status: 400 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle()

  const result = await logAction({
    userId: user.id,
    orgId: (profile as { organization_id?: string | null } | null)?.organization_id ?? null,
    actorRole: (profile as { role?: string | null } | null)?.role ?? null,
    action,
    targetId,
    targetType: body.targetType ?? "evaluation",
    metadata: body.metadata ?? null,
    supabase,
  })
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? "Error de auditoría" }, { status: 200 })
  return NextResponse.json({ ok: true })
}
