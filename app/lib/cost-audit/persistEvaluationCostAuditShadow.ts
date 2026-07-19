/**
 * Persistencia shadow de usage/tokens IA en evaluación (append-only, fail-safe).
 * Nunca lanza excepción; no bloquea evaluación.
 */
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { createClient } from "@supabase/supabase-js"
import { isCostAuditShadowEnabled } from "./env"
import type { PersistEvaluationCostAuditShadowInput } from "./types"

function resolveSupabase() {
  const supabase = getSupabaseServer()
  if (supabase) return supabase

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl && serviceRole) {
    return createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return null
}

export async function persistEvaluationCostAuditShadow(
  input: PersistEvaluationCostAuditShadowInput,
): Promise<void> {
  if (!isCostAuditShadowEnabled()) return

  try {
    const supabase = resolveSupabase()
    if (!supabase) {
      console.warn("[cost_audit_shadow] Supabase client not available (non-blocking)")
      return
    }

    const row = {
      evaluation_id: input.evaluation_id ?? null,
      batch_id: input.batch_id ?? null,
      source_exam_id: input.source_exam_id ?? null,
      provider: input.provider,
      model: input.model ?? null,
      operation: input.operation,
      call_index: input.call_index ?? null,
      input_tokens_real: input.input_tokens_real ?? null,
      output_tokens_real: input.output_tokens_real ?? null,
      total_tokens_real: input.total_tokens_real ?? null,
      pages_processed: input.pages_processed ?? null,
      files_processed: input.files_processed ?? null,
      estimated_cost_usd: input.estimated_cost_usd ?? null,
      cost_source: input.cost_source,
      provider_request_id: input.provider_request_id ?? null,
      duration_ms: input.duration_ms ?? null,
      shadow_layer: input.shadow_layer ?? "cost_audit_shadow_v1",
      raw_usage_json: input.raw_usage_json ?? null,
    }

    const { error } = await supabase.from("evaluation_cost_audit").insert(row)
    if (error) {
      console.warn("[cost_audit_shadow] persist failed (non-blocking)", {
        operation: input.operation,
        provider: input.provider,
        message: error.message,
      })
    }
  } catch (err) {
    console.warn("[cost_audit_shadow] unexpected failure (non-blocking)", {
      operation: input.operation,
      provider: input.provider,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
