/**
 * Proveedor IA para evaluación textual (Mistral primario → Anthropic si 401/403/billing).
 * No usar para OMR ni lectura de alternativas por visión dedicada.
 */
import Anthropic from "@anthropic-ai/sdk"
import { recordProviderCostAuditShadow } from "./cost-audit/recordProviderCostAuditShadow"
import type { CostAuditContext } from "./cost-audit/types"

export type { CostAuditContext } from "./cost-audit/types"

export const EVALUATION_IA_UNAVAILABLE_MESSAGE = "IA evaluadora temporalmente no disponible."

export class EvaluationIaUnavailableError extends Error {
  readonly provider_trace: EvaluationProviderTrace

  constructor(
    message = EVALUATION_IA_UNAVAILABLE_MESSAGE,
    provider_trace: EvaluationProviderTrace = {
      ...DEFAULT_EVALUATION_PROVIDER_TRACE,
      provider_error_stage: "anthropic_fallback",
      anthropic_attempted: true,
    },
  ) {
    super(message)
    this.name = "EvaluationIaUnavailableError"
    this.provider_trace = provider_trace
  }
}

function safeProviderErrorMessage(e: unknown, maxLen = 240): string {
  const raw = e instanceof Error ? e.message : String(e ?? "unknown")
  return raw
    .replace(/sk-[a-zA-Z0-9_-]{8,}/gi, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, maxLen)
}

export type EvaluationProviderTrace = {
  provider_primary: "mistral"
  provider_used: "mistral" | "anthropic_fallback"
  provider_fallback_reason: "mistral_unauthorized" | null
  provider_error_stage: "mistral" | "anthropic_fallback" | null
  anthropic_attempted: boolean
  anthropic_error_message_safe: string | null
}

export const DEFAULT_EVALUATION_PROVIDER_TRACE: EvaluationProviderTrace = {
  provider_primary: "mistral",
  provider_used: "mistral",
  provider_fallback_reason: null,
  provider_error_stage: null,
  anthropic_attempted: false,
  anthropic_error_message_safe: null,
}

export function mergeEvaluationProviderTrace(
  acc: EvaluationProviderTrace,
  next: EvaluationProviderTrace,
): EvaluationProviderTrace {
  if (next.provider_used === "anthropic_fallback") return next
  return acc
}

const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions"
const MISTRAL_FETCH_TIMEOUT_MS = 25_000
const MISTRAL_FETCH_TIMEOUT_MS_VISION = 40_000

function primaryAiProvider(): string {
  return (process.env.AI_PROVIDER ?? "mistral").trim().toLowerCase() || "mistral"
}

function isAnthropicFallbackEnabled(): boolean {
  const fallback = (process.env.AI_FALLBACK_PROVIDER ?? "anthropic").trim().toLowerCase()
  return fallback === "anthropic" && !!process.env.ANTHROPIC_API_KEY?.trim()
}

export function evaluationAiKeysConfigured(): boolean {
  const mistral = !!process.env.MISTRAL_API_KEY?.trim()
  if (mistral && primaryAiProvider() === "mistral") return true
  return isAnthropicFallbackEnabled()
}

function isMistralUnauthorizedOrBilling(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true
  const lower = body.toLowerCase()
  return (
    lower.includes("unauthorized") ||
    lower.includes("billing") ||
    lower.includes("payment") ||
    lower.includes("insufficient") ||
    lower.includes("quota")
  )
}

function anthropicFallbackTrace(): EvaluationProviderTrace {
  return {
    provider_primary: "mistral",
    provider_used: "anthropic_fallback",
    provider_fallback_reason: "mistral_unauthorized",
    provider_error_stage: null,
    anthropic_attempted: true,
    anthropic_error_message_safe: null,
  }
}

function mistralAuthFailureNoFallbackTrace(): EvaluationProviderTrace {
  return {
    provider_primary: "mistral",
    provider_used: "mistral",
    provider_fallback_reason: "mistral_unauthorized",
    provider_error_stage: "mistral",
    anthropic_attempted: false,
    anthropic_error_message_safe: null,
  }
}

function anthropicFallbackFailedTrace(safeMsg: string): EvaluationProviderTrace {
  return {
    provider_primary: "mistral",
    provider_used: "mistral",
    provider_fallback_reason: "mistral_unauthorized",
    provider_error_stage: "anthropic_fallback",
    anthropic_attempted: true,
    anthropic_error_message_safe: safeMsg,
  }
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === "function") return anyFn([a, b])
  return b
}

async function fetchMistralWithRetry(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const mistralKey = process.env.MISTRAL_API_KEY?.trim()
  if (!mistralKey) {
    throw new Error("MISTRAL_API_KEY no configurada")
  }
  const timeoutMs = options?.timeoutMs ?? MISTRAL_FETCH_TIMEOUT_MS
  const maxRetries = 3
  const retryStatuses = [502, 503, 429]
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
    try {
      const signal = init.signal
        ? mergeAbortSignals(init.signal, timeoutController.signal)
        : timeoutController.signal
      const res = await fetch(url, { ...init, signal })
      clearTimeout(timeoutId)
      if (res.ok) return res
      const body = await res.text()
      if (isMistralUnauthorizedOrBilling(res.status, body)) {
        throw Object.assign(new Error(`Mistral API error: ${res.status} - ${body.slice(0, 300)}`), {
          mistralStatus: res.status,
          mistralBody: body,
        })
      }
      const errMsg = `Mistral API error: ${res.status} - ${body.slice(0, 300)}`
      if (!retryStatuses.includes(res.status) || attempt === maxRetries) {
        throw new Error(errMsg)
      }
      const delayMs = 2000 * Math.pow(2, attempt - 1)
      await new Promise((r) => setTimeout(r, delayMs))
    } catch (e) {
      clearTimeout(timeoutId)
      const abortedByTimeout = timeoutController.signal.aborted
      const isAbortError =
        e instanceof Error && (e.name === "AbortError" || (e as { code?: string }).code === "ABORT_ERR")
      if (abortedByTimeout && isAbortError) {
        throw new Error("ERROR_MISTRAL_TIMEOUT")
      }
      lastError = e instanceof Error ? e : new Error(String(e))
      const mistralStatus = (e as { mistralStatus?: number }).mistralStatus
      if (mistralStatus != null && isMistralUnauthorizedOrBilling(mistralStatus, (e as { mistralBody?: string }).mistralBody ?? "")) {
        throw lastError
      }
      if (lastError.message === "ERROR_MISTRAL_TIMEOUT") throw lastError
      if (attempt === maxRetries) throw lastError
      const delayMs = 2000 * Math.pow(2, attempt - 1)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError || new Error("Mistral API error: servicio no disponible")
}

function anthropicEvaluationModel(): string {
  return (
    process.env.ANTHROPIC_EVALUATION_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    "claude-sonnet-4-6"
  )
}

function messageTextContent(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b && b.text ? b.text : ""))
    .join("\n")
    .trim()
}

function normalizeVisionBase64(imageRef: string): { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string } {
  const s = String(imageRef ?? "").trim()
  if (!s) return { mediaType: "image/jpeg", data: "" }
  const dataMatch = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(s)
  if (dataMatch) {
    const mime = dataMatch[1].toLowerCase()
    const mediaType =
      mime === "image/png" ? "image/png" : mime === "image/webp" ? "image/webp" : "image/jpeg"
    return { mediaType, data: dataMatch[2] }
  }
  return { mediaType: "image/jpeg", data: s.replace(/^data:.*?;base64,/, "") }
}

type AnthropicCostAuditMeta = {
  operation: "anthropic_text_fallback" | "anthropic_vision_fallback"
  costAuditContext?: CostAuditContext
}

async function callAnthropicText(
  prompt: string,
  maxTokens: number,
  auditMeta?: Pick<AnthropicCostAuditMeta, "costAuditContext">,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new EvaluationIaUnavailableError()
  const anthropic = new Anthropic({ apiKey })
  const model = anthropicEvaluationModel()
  const startedAt = Date.now()
  const msg = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  })
  recordProviderCostAuditShadow({
    provider: "anthropic",
    model,
    operation: "anthropic_text_fallback",
    usage: msg.usage,
    providerRequestId: typeof msg.id === "string" ? msg.id : null,
    durationMs: Date.now() - startedAt,
    costAuditContext: auditMeta?.costAuditContext,
  })
  const text = messageTextContent(msg)
  if (!text) throw new EvaluationIaUnavailableError()
  return text
}

async function callAnthropicVision(
  imageBase64: string,
  prompt: string,
  maxTokens: number,
  auditMeta?: Pick<AnthropicCostAuditMeta, "costAuditContext">,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new EvaluationIaUnavailableError()
  const { mediaType, data } = normalizeVisionBase64(imageBase64)
  if (!data) throw new EvaluationIaUnavailableError()
  const anthropic = new Anthropic({ apiKey })
  const model = anthropicEvaluationModel()
  const startedAt = Date.now()
  const msg = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: prompt },
        ],
      },
    ],
  })
  recordProviderCostAuditShadow({
    provider: "anthropic",
    model,
    operation: "anthropic_vision_fallback",
    usage: msg.usage,
    providerRequestId: typeof msg.id === "string" ? msg.id : null,
    durationMs: Date.now() - startedAt,
    costAuditContext: auditMeta?.costAuditContext,
  })
  const text = messageTextContent(msg)
  if (!text) throw new EvaluationIaUnavailableError()
  return text
}

function shouldFallbackFromMistralError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const status = (e as { mistralStatus?: number }).mistralStatus
  const body = (e as { mistralBody?: string }).mistralBody ?? e.message
  if (typeof status === "number") return isMistralUnauthorizedOrBilling(status, body)
  return isMistralUnauthorizedOrBilling(0, e.message)
}

async function withAnthropicFallbackOnMistralAuth(
  mistralCall: () => Promise<{ content: string; trace: EvaluationProviderTrace }>,
  anthropicCall: () => Promise<string>,
): Promise<{ content: string; trace: EvaluationProviderTrace }> {
  try {
    return await mistralCall()
  } catch (e) {
    if (!shouldFallbackFromMistralError(e)) throw e
    console.warn("[evaluate][ai-provider] Mistral auth/billing; intentando Anthropic fallback", {
      fallbackEnabled: isAnthropicFallbackEnabled(),
      aiProvider: primaryAiProvider(),
      aiFallbackProvider: (process.env.AI_FALLBACK_PROVIDER ?? "anthropic").trim(),
    })
    if (!isAnthropicFallbackEnabled()) {
      throw new EvaluationIaUnavailableError(
        EVALUATION_IA_UNAVAILABLE_MESSAGE,
        mistralAuthFailureNoFallbackTrace(),
      )
    }
    try {
      const content = await anthropicCall()
      return { content, trace: anthropicFallbackTrace() }
    } catch (fallbackErr) {
      const safeMsg = safeProviderErrorMessage(fallbackErr)
      console.error("[evaluate][ai-provider] Anthropic fallback falló:", safeMsg)
      throw new EvaluationIaUnavailableError(
        EVALUATION_IA_UNAVAILABLE_MESSAGE,
        anthropicFallbackFailedTrace(safeMsg),
      )
    }
  }
}

export type EvaluationTextCompletionParams = {
  prompt: string
  maxTokens: number
  temperature?: number
  timeoutMs?: number
  costAuditContext?: CostAuditContext
}

export async function requestEvaluationTextCompletion(
  params: EvaluationTextCompletionParams,
): Promise<{ content: string; trace: EvaluationProviderTrace }> {
  const mistralKey = process.env.MISTRAL_API_KEY?.trim()
  if (!mistralKey) {
    if (!isAnthropicFallbackEnabled()) throw new EvaluationIaUnavailableError()
    const content = await callAnthropicText(params.prompt, params.maxTokens, {
      costAuditContext: params.costAuditContext,
    })
    return { content, trace: anthropicFallbackTrace() }
  }

  return withAnthropicFallbackOnMistralAuth(
    async () => {
      const mistralModel = "mistral-large-latest"
      const startedAt = Date.now()
      const res = await fetchMistralWithRetry(
        MISTRAL_CHAT_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mistralKey}`,
          },
          body: JSON.stringify({
            model: mistralModel,
            messages: [{ role: "user", content: params.prompt }],
            temperature: params.temperature ?? 0.1,
            response_format: { type: "json_object" },
            max_tokens: params.maxTokens,
          }),
        },
        { timeoutMs: params.timeoutMs ?? MISTRAL_FETCH_TIMEOUT_MS },
      )
      const data = await res.json()
      recordProviderCostAuditShadow({
        provider: "mistral",
        model: mistralModel,
        operation: "evaluate_text",
        usage: data?.usage,
        providerRequestId: typeof data?.id === "string" ? data.id : null,
        durationMs: Date.now() - startedAt,
        costAuditContext: params.costAuditContext,
      })
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error("Respuesta vacía de Mistral")
      return { content: String(content), trace: DEFAULT_EVALUATION_PROVIDER_TRACE }
    },
    () =>
      callAnthropicText(params.prompt, params.maxTokens, {
        costAuditContext: params.costAuditContext,
      }),
  )
}

export type EvaluationVisionCompletionParams = {
  imageBase64: string
  prompt: string
  maxTokens: number
  temperature?: number
  timeoutMs?: number
  costAuditContext?: CostAuditContext
}

export async function requestEvaluationVisionCompletion(
  params: EvaluationVisionCompletionParams,
): Promise<{ content: string; trace: EvaluationProviderTrace }> {
  const mistralKey = process.env.MISTRAL_API_KEY?.trim()
  const visionPart = (imageRef: string) => {
    const s = String(imageRef ?? "").trim()
    if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) {
      return { type: "image_url" as const, image_url: { url: s } }
    }
    return { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${s}` } }
  }

  if (!mistralKey) {
    if (!isAnthropicFallbackEnabled()) throw new EvaluationIaUnavailableError()
    const content = await callAnthropicVision(params.imageBase64, params.prompt, params.maxTokens, {
      costAuditContext: params.costAuditContext,
    })
    return { content, trace: anthropicFallbackTrace() }
  }

  return withAnthropicFallbackOnMistralAuth(
    async () => {
      const mistralModel = "pixtral-12b-2409"
      const startedAt = Date.now()
      const res = await fetchMistralWithRetry(
        MISTRAL_CHAT_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mistralKey}`,
          },
          body: JSON.stringify({
            model: mistralModel,
            messages: [
              {
                role: "user",
                content: [visionPart(params.imageBase64), { type: "text", text: params.prompt }],
              },
            ],
            temperature: params.temperature ?? 0.1,
            response_format: { type: "json_object" },
            max_tokens: params.maxTokens,
          }),
        },
        { timeoutMs: params.timeoutMs ?? MISTRAL_FETCH_TIMEOUT_MS_VISION },
      )
      const data = await res.json()
      recordProviderCostAuditShadow({
        provider: "mistral",
        model: mistralModel,
        operation: "evaluate_vision",
        usage: data?.usage,
        providerRequestId: typeof data?.id === "string" ? data.id : null,
        durationMs: Date.now() - startedAt,
        costAuditContext: params.costAuditContext,
      })
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error("Respuesta vacía de Mistral Vision")
      return { content: String(content), trace: DEFAULT_EVALUATION_PROVIDER_TRACE }
    },
    () =>
      callAnthropicVision(params.imageBase64, params.prompt, params.maxTokens, {
        costAuditContext: params.costAuditContext,
      }),
  )
}
