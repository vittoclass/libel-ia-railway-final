export type CostAuditCostSource =
  | "REAL_PROVIDER_USAGE"
  | "REAL_PROVIDER_TOKENS"
  | "ESTIMATED"
  | "UNKNOWN"

export type CostAuditContext = {
  evaluation_id?: string | null
  batch_id?: string | null
  source_exam_id?: string | null
  call_index?: number | null
}

export type EvaluationCostAuditOperation =
  | "evaluate_text"
  | "evaluate_vision"
  | "anthropic_text_fallback"
  | "anthropic_vision_fallback"
  | "evaluate_azure_read"
  | "smart_extract_azure_layout"
  | "smart_extract_azure_read_fallback"
  | "validate_practice_azure_layout"
  | "validate_practice_azure_read_fallback"
  | "extract_pdf_text_azure_layout"
  | "extract_pdf_text_azure_read_fallback"
  | "document_structured_azure"
  | "omr_official_azure_layout"
  | "omr_interleaved_azure_layout"
  | "omr_validation_azure_layout"
  | "smart_extract_stage_1"
  | "smart_extract_stage_2"
  | "smart_extract_supplement"
  | "validate_practice_anthropic"
  | "extract_name_azure_vision_read"
  | "extract_name_azure_di_read"
  | "extract_name_mistral"

export type PersistEvaluationCostAuditShadowInput = {
  evaluation_id?: string | null
  batch_id?: string | null
  source_exam_id?: string | null
  provider: string
  model?: string | null
  operation: EvaluationCostAuditOperation
  call_index?: number | null
  input_tokens_real?: number | null
  output_tokens_real?: number | null
  total_tokens_real?: number | null
  pages_processed?: number | null
  files_processed?: number | null
  estimated_cost_usd?: number | null
  cost_source: CostAuditCostSource
  provider_request_id?: string | null
  duration_ms?: number | null
  shadow_layer?: string
  raw_usage_json?: Record<string, unknown> | null
}
