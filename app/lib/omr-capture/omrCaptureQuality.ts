/**
 * Score 0–100 y mensaje dominante para captura OMR guiada.
 */

import type { MarkerDetectResult, Point } from "./markerDetectV1"
import { LIBELIA_SHEET_ASPECT_RATIO } from "./constants"

export type QualityBreakdown = {
  markers: number
  perspective: number
  sharpness: number
  lighting: number
  size: number
  stability: number
  total: number
}

export type FrameMetrics = {
  detection: MarkerDetectResult
  laplacianVariance: number
  meanBrightness: number
  shadowScore: number
  captureWidth: number
}

export type DominantMessageKey =
  | "find_markers"
  | "closer"
  | "farther"
  | "straighten"
  | "shadow"
  | "steady"
  | "ready_capture"
  | "adequate"
  | "unsafe"

const MESSAGES: Record<DominantMessageKey, string> = {
  find_markers: "Busca los 4 cuadrados negros de la hoja",
  closer: "Acerca un poco la cámara",
  farther: "Aleja un poco la cámara",
  straighten: "Endereza la hoja",
  shadow: "Evita sombra sobre las burbujas",
  steady: "Mantén quieto",
  ready_capture: "Listo, capturando",
  adequate: "Foto adecuada para evaluación automática",
  unsafe: "Foto tomada, pero no es segura para OMR. Repetir foto.",
}

export function messageForKey(key: DominantMessageKey): string {
  return MESSAGES[key]
}

function laplacianVariance(imageData: ImageData, quad: MarkerDetectResult["quad"]): number {
  const { width: w, height: h, data } = imageData
  let x0 = 0
  let y0 = 0
  let x1 = w
  let y1 = h
  if (quad) {
    const xs = quad.map((p) => p.x)
    const ys = quad.map((p) => p.y)
    x0 = Math.max(0, Math.floor(Math.min(...xs)))
    y0 = Math.max(0, Math.floor(Math.min(...ys)))
    x1 = Math.min(w, Math.ceil(Math.max(...xs)))
    y1 = Math.min(h, Math.ceil(Math.max(...ys)))
  }
  const rw = Math.max(8, x1 - x0)
  const rh = Math.max(8, y1 - y0)
  let sum = 0
  let sumSq = 0
  let n = 0
  const step = Math.max(1, Math.floor(Math.min(rw, rh) / 80))
  for (let y = y0 + 1; y < y1 - 1; y += step) {
    for (let x = x0 + 1; x < x1 - 1; x += step) {
      const i = (y * w + x) * 4
      const g =
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const iR = (y * w + x + 1) * 4
      const gR =
        0.299 * data[iR] + 0.587 * data[iR + 1] + 0.114 * data[iR + 2]
      const iD = ((y + 1) * w + x) * 4
      const gD =
        0.299 * data[iD] + 0.587 * data[iD + 1] + 0.114 * data[iD + 2]
      const lap = Math.abs(2 * g - gR - gD)
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  if (n < 2) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

function lightingMetrics(imageData: ImageData, quad: MarkerDetectResult["quad"]): {
  meanBrightness: number
  shadowScore: number
} {
  const { width: w, height: h, data } = imageData
  let x0 = Math.floor(w * 0.2)
  let y0 = Math.floor(h * 0.25)
  let x1 = Math.floor(w * 0.8)
  let y1 = Math.floor(h * 0.85)
  if (quad) {
    const xs = quad.map((p) => p.x)
    const ys = quad.map((p) => p.y)
    x0 = Math.max(0, Math.floor(Math.min(...xs)))
    y0 = Math.max(0, Math.floor(Math.min(...ys)))
    x1 = Math.min(w, Math.ceil(Math.max(...xs)))
    y1 = Math.min(h, Math.ceil(Math.max(...ys)))
  }
  let sum = 0
  let dark = 0
  let bright = 0
  let n = 0
  const step = Math.max(1, Math.floor((x1 - x0) / 40))
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * w + x) * 4
      const g =
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      sum += g
      if (g < 70) dark++
      if (g > 245) bright++
      n++
    }
  }
  if (n === 0) return { meanBrightness: 128, shadowScore: 0 }
  const mean = sum / n
  const shadowScore = Math.min(1, dark / n + bright / n)
  return { meanBrightness: mean, shadowScore }
}

export function analyzeFrame(
  imageData: ImageData,
  detection: MarkerDetectResult,
  captureWidth: number,
  stabilityScore10: number
): { breakdown: QualityBreakdown; metrics: FrameMetrics } {
  const lap = laplacianVariance(imageData, detection.quad)
  const { meanBrightness, shadowScore } = lightingMetrics(imageData, detection.quad)

  const markersPts =
    detection.markerCount === 4 ? 30 : detection.markerCount === 3 ? 20 : detection.markerCount === 2 ? 10 : 0

  const perspectivePts = Math.round(
    20 * Math.max(0, 1 - detection.perspectiveError / 0.22)
  )

  const sharpnessPts = Math.round(15 * Math.min(1, lap / 120))

  let lightingPts = 15
  if (meanBrightness < 85 || meanBrightness > 225) lightingPts -= 8
  if (shadowScore > 0.35) lightingPts -= 7
  lightingPts = Math.max(0, lightingPts)

  let sizePts = 0
  const area = detection.areaRatio
  if (area >= 0.28 && area <= 0.88) sizePts = 10
  else if (area >= 0.18 && area < 0.28) sizePts = 6
  else if (area > 0.88 && area <= 0.95) sizePts = 6
  else if (area > 0.12) sizePts = 3

  if (captureWidth >= 1200) sizePts = Math.min(10, sizePts + 2)
  else if (captureWidth < 800) sizePts = Math.max(0, sizePts - 3)

  const stabilityPts = Math.round(Math.min(10, Math.max(0, stabilityScore10)))

  const breakdown: QualityBreakdown = {
    markers: markersPts,
    perspective: perspectivePts,
    sharpness: sharpnessPts,
    lighting: lightingPts,
    size: sizePts,
    stability: stabilityPts,
    total: 0,
  }
  breakdown.total =
    breakdown.markers +
    breakdown.perspective +
    breakdown.sharpness +
    breakdown.lighting +
    breakdown.size +
    breakdown.stability

  return {
    breakdown,
    metrics: {
      detection,
      laplacianVariance: lap,
      meanBrightness,
      shadowScore,
      captureWidth,
    },
  }
}

export function pickDominantMessageKey(
  metrics: FrameMetrics,
  uiState: "searching" | "adjusting" | "almost" | "ready" | "capturing" | "review",
  postScore?: number
): DominantMessageKey {
  if (uiState === "capturing") return "ready_capture"
  if (uiState === "review" && postScore != null) {
    if (postScore >= 85) return "adequate"
    if (postScore < 70) return "unsafe"
    return "adequate"
  }
  if (uiState === "ready") return "ready_capture"

  const d = metrics.detection
  if (d.markerCount < 4) return "find_markers"

  if (d.areaRatio < 0.18) return "closer"
  if (d.areaRatio > 0.92) return "farther"
  if (d.perspectiveError > 0.16) return "straighten"
  if (metrics.shadowScore > 0.38) return "shadow"
  if (metrics.laplacianVariance < 45) return "steady"

  return "steady"
}

export function quadAspectRatio(quad: Point[]): number {
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  return h > 0 ? w / h : 1
}

export function aspectMismatch(quad: Point[]): number {
  const ar = quadAspectRatio(quad)
  return Math.abs(ar - LIBELIA_SHEET_ASPECT_RATIO) / LIBELIA_SHEET_ASPECT_RATIO
}
