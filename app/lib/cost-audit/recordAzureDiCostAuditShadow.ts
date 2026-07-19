import { recordProviderCostAuditShadow } from "./recordProviderCostAuditShadow"
import type { CostAuditContext, EvaluationCostAuditOperation } from "./types"

/** Shadow audit para llamadas Azure Document Intelligence (páginas/transacciones, sin tokens). */
export function recordAzureDiCostAuditShadow(input: {
  operation: EvaluationCostAuditOperation
  model: "prebuilt-layout" | "prebuilt-read"
  pagesProcessed?: number | null
  filesProcessed?: number
  durationMs?: number | null
  providerRequestId?: string | null
  costAuditContext?: CostAuditContext
}): void {
  const pages = input.pagesProcessed ?? null
  recordProviderCostAuditShadow({
    provider: "azure_di",
    model: input.model,
    operation: input.operation,
    pagesProcessed: pages,
    filesProcessed: input.filesProcessed ?? 1,
    durationMs: input.durationMs ?? null,
    providerRequestId: input.providerRequestId ?? null,
    costSource: "REAL_PROVIDER_USAGE",
    costAuditContext: input.costAuditContext,
    rawUsageJson: pages != null ? { pages_processed: pages } : null,
  })
}
