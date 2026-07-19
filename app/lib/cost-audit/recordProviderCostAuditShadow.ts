import { extractProviderUsage } from "./extractProviderUsage"
import { isCostAuditShadowEnabled } from "./env"
import { persistEvaluationCostAuditShadow } from "./persistEvaluationCostAuditShadow"
import type { CostAuditContext, CostAuditCostSource, EvaluationCostAuditOperation } from "./types"

type RecordProviderCostAuditShadowInput = {
  provider: string
  model?: string | null
  operation: EvaluationCostAuditOperation
  usage?: unknown
  providerRequestId?: string | null
  durationMs?: number | null
  pagesProcessed?: number | null
  filesProcessed?: number | null
  costSource?: CostAuditCostSource
  rawUsageJson?: Record<string, unknown> | null
  costAuditContext?: CostAuditContext
}

/** Fire-and-forget shadow audit; nunca lanza ni altera el flujo de evaluación. */
export function recordProviderCostAuditShadow(input: RecordProviderCostAuditShadowInput): void {
  if (!isCostAuditShadowEnabled()) return

  const extracted = extractProviderUsage(input.usage)
  const pagesProcessed = input.pagesProcessed ?? null
  const filesProcessed = input.filesProcessed ?? null
  let cost_source = input.costSource ?? extracted.cost_source
  if (cost_source === "UNKNOWN" && (pagesProcessed != null || filesProcessed != null)) {
    cost_source = "REAL_PROVIDER_USAGE"
  }
  const raw_usage_json =
    input.rawUsageJson ??
    (extracted.raw_usage_json
      ? (extracted.raw_usage_json as Record<string, unknown>)
      : pagesProcessed != null || filesProcessed != null
        ? {
            ...(pagesProcessed != null ? { pages_processed: pagesProcessed } : {}),
            ...(filesProcessed != null ? { files_processed: filesProcessed } : {}),
          }
        : null)

  void persistEvaluationCostAuditShadow({
    evaluation_id: input.costAuditContext?.evaluation_id ?? null,
    batch_id: input.costAuditContext?.batch_id ?? null,
    source_exam_id: input.costAuditContext?.source_exam_id ?? null,
    call_index: input.costAuditContext?.call_index ?? null,
    provider: input.provider,
    model: input.model ?? null,
    operation: input.operation,
    input_tokens_real: extracted.input_tokens_real,
    output_tokens_real: extracted.output_tokens_real,
    total_tokens_real: extracted.total_tokens_real,
    pages_processed: pagesProcessed,
    files_processed: filesProcessed,
    estimated_cost_usd: null,
    cost_source,
    provider_request_id: input.providerRequestId ?? null,
    duration_ms: input.durationMs ?? null,
    raw_usage_json,
  })
}
