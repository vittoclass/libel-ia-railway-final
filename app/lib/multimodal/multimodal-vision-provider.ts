/**
 * Proveedor visual multimodal — reutiliza exclusivamente
 * requestEvaluationVisionCompletion (sin cliente nuevo, sin modelo hardcodeado).
 *
 * El proveedor oficial acepta 1 imagen por llamada → happy path = 1 Vision.
 * Si hay N imágenes, se elige primaria (FINAL > order) y el resto queda en
 * metadatos/calidad del prompt.
 */

import {
  requestEvaluationVisionCompletion,
  type EvaluationProviderTrace,
} from "@/app/lib/ai-evaluation-provider"
import type { MultimodalArtsImageInput } from "@/app/lib/multimodal/types"

const MULTIMODAL_VISION_TIMEOUT_MS = 40_000

export type MultimodalVisionRequestParams = {
  images: MultimodalArtsImageInput[]
  prompt: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export type MultimodalVisionRequestResult = {
  content: string
  trace: EvaluationProviderTrace
  primary_image_id: string
  secondary_image_ids: string[]
  provider_used: string
  vision_calls: 1
}

function rolePriority(role: MultimodalArtsImageInput["role"]): number {
  switch (role) {
    case "FINAL":
      return 0
    case "DETAIL":
      return 1
    case "PROCESS":
      return 2
    case "TEXT_RESPONSE":
      return 3
    default:
      return 4
  }
}

/** Primaria: role FINAL, luego menor order, luego primer id. */
export function selectPrimaryMultimodalImage(
  images: MultimodalArtsImageInput[],
): {
  primary: MultimodalArtsImageInput
  secondary: MultimodalArtsImageInput[]
} {
  const sorted = images
    .slice()
    .filter((im) => String(im.base64 ?? "").trim().length > 0)
    .sort((a, b) => {
      const rp = rolePriority(a.role) - rolePriority(b.role)
      if (rp !== 0) return rp
      return a.order - b.order
    })
  if (!sorted.length) {
    throw new Error("multimodal_vision_no_images")
  }
  const primary = sorted[0]!
  const secondary = sorted.slice(1)
  return { primary, secondary }
}

/**
 * Una sola llamada Vision vía el wrapper oficial.
 */
export async function requestMultimodalArtsVision(
  params: MultimodalVisionRequestParams,
): Promise<MultimodalVisionRequestResult> {
  const { primary, secondary } = selectPrimaryMultimodalImage(params.images)

  const { content, trace } = await requestEvaluationVisionCompletion({
    imageBase64: primary.base64,
    prompt: params.prompt,
    maxTokens: params.maxTokens ?? 4096,
    temperature: params.temperature ?? 0.1,
    timeoutMs: params.timeoutMs ?? MULTIMODAL_VISION_TIMEOUT_MS,
  })

  return {
    content: String(content ?? ""),
    trace,
    primary_image_id: primary.image_id,
    secondary_image_ids: secondary.map((s) => s.image_id),
    provider_used: trace.provider_used,
    vision_calls: 1,
  }
}
