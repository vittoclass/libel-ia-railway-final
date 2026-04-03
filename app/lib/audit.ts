import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseServer } from "@/app/lib/supabase-server"

type AuditAction =
  | "EXAMEN_CORREGIDO"
  | "ALUMNO_EDITADO"
  | "RUT_VINCULADO"
  | "EVALUACION_EDITADA"
  | "RECOMPUTE_EJECUTADO"
  | "OTRA_ACCION"

// PHASE_5_INSTITUTIONAL_V1
export async function logAction(params: {
  userId: string
  orgId: string | null
  action: AuditAction | string
  targetId: string
  targetType?: string
  actorRole?: string | null
  metadata?: Record<string, unknown> | null
  supabase?: SupabaseClient
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = params.supabase ?? getSupabaseServer()
  if (!supabase) return { ok: false, error: "Supabase no configurado" }
  try {
    const payload = {
      organization_id: params.orgId,
      actor_id: params.userId,
      actor_role: params.actorRole ?? null,
      action: params.action,
      target_type: params.targetType ?? "evaluation",
      target_id: params.targetId,
      metadata: params.metadata ?? null,
    }
    const { error } = await supabase.from("evaluation_audit_logs").insert(payload)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
