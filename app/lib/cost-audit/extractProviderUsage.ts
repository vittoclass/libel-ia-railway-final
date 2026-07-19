import type { CostAuditCostSource } from "./types"

export type ExtractedProviderUsage = {
  input_tokens_real: number | null
  output_tokens_real: number | null
  total_tokens_real: number | null
  cost_source: CostAuditCostSource
  raw_usage_json: Record<string, number> | null
}

function pickNonNegativeInt(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value)
    }
  }
  return null
}

function sanitizeUsageBlock(usage: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value
    }
  }
  return out
}

/** Extrae tokens reales de bloques usage (Mistral/OpenAI-compatible o Anthropic). Sin prompts ni respuestas. */
export function extractProviderUsage(usage: unknown): ExtractedProviderUsage {
  if (!usage || typeof usage !== "object") {
    return {
      input_tokens_real: null,
      output_tokens_real: null,
      total_tokens_real: null,
      cost_source: "UNKNOWN",
      raw_usage_json: null,
    }
  }

  const block = usage as Record<string, unknown>
  const input_tokens_real = pickNonNegativeInt(block, ["input_tokens", "prompt_tokens"])
  const output_tokens_real = pickNonNegativeInt(block, ["output_tokens", "completion_tokens"])
  let total_tokens_real = pickNonNegativeInt(block, ["total_tokens"])
  if (total_tokens_real == null && input_tokens_real != null && output_tokens_real != null) {
    total_tokens_real = input_tokens_real + output_tokens_real
  }

  if (input_tokens_real == null && output_tokens_real == null && total_tokens_real == null) {
    return {
      input_tokens_real: null,
      output_tokens_real: null,
      total_tokens_real: null,
      cost_source: "UNKNOWN",
      raw_usage_json: null,
    }
  }

  const raw_usage_json = sanitizeUsageBlock(block)
  return {
    input_tokens_real,
    output_tokens_real,
    total_tokens_real,
    cost_source: "REAL_PROVIDER_TOKENS",
    raw_usage_json: Object.keys(raw_usage_json).length > 0 ? raw_usage_json : null,
  }
}
