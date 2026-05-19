/**
 * Validación post-captura (imagen final). Opcional enderezado por perspectiva.
 */

import { LIBELIA_SHEET_ASPECT_RATIO } from "./constants"
import { postCaptureMessageForScore } from "./captureGuidance"
import { detectMarkersV2 } from "./markerDetectV2"
import {
  imageDataFromDataUrl,
  scalePointsToFull,
  type SheetQuad,
} from "./markerDetectV1"
import {
  analyzeFrame,
  pickDominantMessageKey,
  resolveTeacherMessage,
  type DominantMessageKey,
} from "./omrCaptureQuality"
import { warpPerspectiveToDataUrl } from "../sheet-perspective"
import type { QuadCorners } from "../sheet-perspective"

export type PostCaptureResult = {
  score: number
  message: string
  messageKey: DominantMessageKey
  warpedDataUrl: string | null
}

function quadToCorners(q: SheetQuad): QuadCorners {
  return q.map((p) => [p.x, p.y] as [number, number])
}

export async function validatePostCapture(
  dataUrl: string,
  captureWidth: number
): Promise<PostCaptureResult> {
  const loaded = await imageDataFromDataUrl(dataUrl, 720)
  if (!loaded) {
    return {
      score: 0,
      message: postCaptureMessageForScore(0),
      messageKey: "repeat_suggested",
      warpedDataUrl: null,
    }
  }

  const detection = detectMarkersV2(loaded.imageData)
  const { breakdown, metrics } = analyzeFrame(loaded.imageData, detection, captureWidth, 10)
  const score = breakdown.total

  const message = postCaptureMessageForScore(score)
  const messageKey = pickDominantMessageKey(metrics, "review", detection, score)

  let warpedDataUrl: string | null = null
  if (detection.quad && detection.markerCount === 4 && score >= 70) {
    const fullQuad = scalePointsToFull(detection.quad, loaded.scale) as SheetQuad
    const corners = quadToCorners(fullQuad)
    const destWidth = Math.max(400, Math.round(loaded.fullWidth * 0.92))
    const destHeight = Math.round(destWidth / LIBELIA_SHEET_ASPECT_RATIO)
    try {
      warpedDataUrl = await warpPerspectiveToDataUrl(dataUrl, corners, destWidth, destHeight)
    } catch {
      warpedDataUrl = null
    }
  }

  return { score, message, messageKey, warpedDataUrl }
}

export { resolveTeacherMessage, postCaptureMessageForScore }

export async function dataUrlToJpegFile(
  dataUrl: string,
  filename: string
): Promise<File | null> {
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    return new File([blob], filename, { type: "image/jpeg" })
  } catch {
    return null
  }
}
