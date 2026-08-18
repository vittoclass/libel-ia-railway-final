/**
 * Proveedor visual multimodal — reutiliza exclusivamente
 * requestEvaluationVisionCompletion (N=1 / ruta M4) y un sibling aditivo
 * requestEvaluationVisionCompletionMulti (N>=2, máximo 2 vistas, 1 llamada).
 *
 * N=1 permanece en el wrapper compartido sin mutarlo.
 * N>=2 envía VIEW_1 (primera usable por order) + VIEW_2 (última usable = FINAL)
 * en una sola solicitud. No se envían 3+ imágenes a Vision (CAP M8 = 2).
 */

import {
  requestEvaluationVisionCompletion,
  requestEvaluationVisionCompletionMulti,
  type EvaluationProviderTrace,
} from "@/app/lib/ai-evaluation-provider"
import type { MultimodalArtsImageInput } from "@/app/lib/multimodal/types"

const MULTIMODAL_VISION_TIMEOUT_MS = 40_000
const M8_MAX_VISION_IMAGES = 2

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

export type MultimodalVisionViewsSelection = {
  views: MultimodalArtsImageInput[]
  unused: MultimodalArtsImageInput[]
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

function usableMultimodalImages(
  images: MultimodalArtsImageInput[],
): MultimodalArtsImageInput[] {
  return images
    .map((im, index) => ({ im, index }))
    .filter(({ im }) => String(im.base64 ?? "").trim().length > 0)
    .sort((a, b) => {
      if (a.im.order !== b.im.order) return a.im.order - b.im.order
      return a.index - b.index
    })
    .map(({ im }) => im)
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
 * Selección determinista de hasta 2 vistas para Vision (CAP M8).
 * VIEW_1 = primera usable por order; VIEW_2 = última usable (FINAL en Camino B).
 * No infiere GENERAL/DETAIL. No muta el array de entrada.
 */
export function selectMultimodalVisionViews(
  images: MultimodalArtsImageInput[],
): MultimodalVisionViewsSelection {
  const usable = usableMultimodalImages(images)
  if (!usable.length) {
    throw new Error("multimodal_vision_no_images")
  }
  if (usable.length === 1) {
    return { views: [usable[0]!], unused: [] }
  }
  const view1 = usable[0]!
  const view2 = usable[usable.length - 1]!
  const views = [view1, view2].slice(0, M8_MAX_VISION_IMAGES)
  const unused = usable.filter((im) => im !== view1 && im !== view2)
  return { views, unused }
}

/**
 * N=1: una sola llamada Vision vía el wrapper oficial M4.
 * N>=2: una sola llamada sibling con exactamente 2 vistas.
 */
export async function requestMultimodalArtsVision(
  params: MultimodalVisionRequestParams,
): Promise<MultimodalVisionRequestResult> {
  const { primary, secondary } = selectPrimaryMultimodalImage(params.images)
  const usableCount = usableMultimodalImages(params.images).length

  if (usableCount <= 1) {
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

  const { views } = selectMultimodalVisionViews(params.images)
  const imageBase64List: [string, string] = [views[0]!.base64, views[1]!.base64]
  const { content, trace } = await requestEvaluationVisionCompletionMulti({
    imageBase64List,
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
