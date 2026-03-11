/**
 * Alineación real hoja vs plantilla para OMR con plantilla superpuesta.
 * Detecta la hoja en el frame de la cámara (bbox) y calcula feedback de alineación
 * respecto al marco esperado (centro + relación de aspecto de la plantilla).
 * Solo se usa en el flujo TemplateOverlayOMRModal; no toca APIs ni persistencia.
 *
 * UMBRALES (ajustables aquí):
 * - GRAY_THRESHOLD: píxel ≥ este valor se considera papel; por debajo, fondo. 175 evita sombras suaves.
 * - MIN_SHEET_AREA_RATIO: mínima fracción del frame que debe ocupar la hoja para contar como detectada (evita ruido).
 * - MAX_WORK_SIZE: lado máximo del canvas de trabajo para no sobrecargar el dispositivo.
 * - ALIGN_READY_SCORE: puntuación mínima (0–1) para permitir captura. 0.7 exige centro + aspecto + tamaño razonables.
 * - CENTER_TOLERANCE_NORM: tolerancia de descentrado como fracción de la diagonal del frame.
 * - ASPECT_TOLERANCE: tolerancia de diferencia de relación de aspecto respecto a la plantilla.
 * - AREA_MIN_RATIO / AREA_MAX_RATIO: rango de área de la hoja (evita "muy lejos" o recortes).
 */

/** Píxel ≥ este valor → papel. Por debajo → fondo. */
export const GRAY_THRESHOLD = 175
/** Mínima fracción del frame que debe ocupar la hoja para contar como detectada. */
export const MIN_SHEET_AREA_RATIO = 0.05
/** Lado máximo del canvas de trabajo (rendimiento). */
export const MAX_WORK_SIZE = 320
/** Puntuación mínima (0–1) para considerar alineación lista para capturar. */
export const ALIGN_READY_SCORE = 0.7
/** Tolerancia de descentrado (fracción de la diagonal del frame). */
export const CENTER_TOLERANCE_NORM = 0.15
/** Tolerancia de diferencia de relación de aspecto respecto a la plantilla. */
export const ASPECT_TOLERANCE = 0.12
/** Área mínima de la hoja en el frame (evita "muy lejos"). */
export const AREA_MIN_RATIO = 0.15
/** Área máxima de la hoja en el frame (evita recortes). */
export const AREA_MAX_RATIO = 0.92

const GRAY_THRESHOLD_INTERNAL = GRAY_THRESHOLD
const MIN_SHEET_AREA_RATIO_INTERNAL = MIN_SHEET_AREA_RATIO
const MAX_WORK_SIZE_INTERNAL = MAX_WORK_SIZE
const ALIGN_READY_SCORE_INTERNAL = ALIGN_READY_SCORE
const CENTER_TOLERANCE_NORM_INTERNAL = CENTER_TOLERANCE_NORM
const ASPECT_TOLERANCE_INTERNAL = ASPECT_TOLERANCE
const AREA_MIN_RATIO_INTERNAL = AREA_MIN_RATIO
const AREA_MAX_RATIO_INTERNAL = AREA_MAX_RATIO

export type SheetDetection = {
  center: { x: number; y: number }
  width: number
  height: number
  aspectRatio: number
  areaRatio: number
}

export type AlignmentFeedback = {
  score: number
  message: string
  ready: boolean
}

/**
 * Dibuja el frame actual del video en el canvas de trabajo (redimensionado si hace falta),
 * convierte a escala de grises, aplica umbral y devuelve el bbox de la región "hoja"
 * (píxeles claros). Si no hay región suficientemente grande, devuelve null.
 */
export function detectSheetInFrame(
  video: HTMLVideoElement,
  workCanvas: HTMLCanvasElement,
  opts?: { grayThreshold?: number; minAreaRatio?: number }
): SheetDetection | null {
  if (!video.videoWidth || !video.videoHeight) return null

  const threshold = opts?.grayThreshold ?? GRAY_THRESHOLD_INTERNAL
  const minAreaRatio = opts?.minAreaRatio ?? MIN_SHEET_AREA_RATIO_INTERNAL

  const vw = video.videoWidth
  const vh = video.videoHeight
  const scale = Math.min(1, MAX_WORK_SIZE_INTERNAL / Math.max(vw, vh))
  const w = Math.round(vw * scale)
  const h = Math.round(vh * scale)

  workCanvas.width = w
  workCanvas.height = h
  const ctx = workCanvas.getContext("2d")
  if (!ctx) return null

  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data

  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let count = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      if (gray >= threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        count++
      }
    }
  }

  const area = (maxX - minX + 1) * (maxY - minY + 1)
  const frameArea = w * h
  const areaRatio = area / frameArea

  if (count < 100 || areaRatio < minAreaRatio || maxX <= minX || maxY <= minY) {
    return null
  }

  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  }
  const aspectRatio = height > 0 ? width / height : 1

  return {
    center,
    width,
    height,
    aspectRatio,
    areaRatio: (width * height) / frameArea,
  }
}

/**
 * Calcula puntuación de alineación (0–1), mensaje de guía y si está listo para capturar,
 * comparando la hoja detectada con el marco esperado (centro del frame + relación de aspecto de la plantilla).
 */
export function getAlignmentFeedback(
  detected: SheetDetection | null,
  viewWidth: number,
  viewHeight: number,
  templateAspectRatio: number,
  opts?: { readyScore?: number; centerTolerance?: number; aspectTolerance?: number }
): AlignmentFeedback {
  const readyScore = opts?.readyScore ?? ALIGN_READY_SCORE_INTERNAL
  const centerTol = opts?.centerTolerance ?? CENTER_TOLERANCE_NORM_INTERNAL
  const aspectTol = opts?.aspectTolerance ?? ASPECT_TOLERANCE_INTERNAL

  if (!detected || viewWidth <= 0 || viewHeight <= 0) {
    return {
      score: 0,
      message: "Coloca la hoja dentro del marco",
      ready: false,
    }
  }

  const viewCenterX = viewWidth / 2
  const viewCenterY = viewHeight / 2
  const dx = detected.center.x - viewCenterX
  const dy = detected.center.y - viewCenterY
  const diag = Math.hypot(viewWidth, viewHeight) || 1
  const centerDistNorm = Math.hypot(dx, dy) / diag

  const aspectDiff = Math.abs(detected.aspectRatio - templateAspectRatio) / templateAspectRatio
  const centerOk = centerDistNorm <= centerTol
  const aspectOk = aspectDiff <= aspectTol

  const areaOk =
    detected.areaRatio >= AREA_MIN_RATIO_INTERNAL && detected.areaRatio <= AREA_MAX_RATIO_INTERNAL
  const areaScore = areaOk
    ? 1
    : detected.areaRatio < AREA_MIN_RATIO_INTERNAL
      ? detected.areaRatio / AREA_MIN_RATIO_INTERNAL
      : Math.max(0, 1 - (detected.areaRatio - AREA_MAX_RATIO_INTERNAL) / (1 - AREA_MAX_RATIO_INTERNAL))

  const centerScore = Math.max(0, 1 - centerDistNorm / centerTol)
  const aspectScore = Math.max(0, 1 - aspectDiff / aspectTol)
  const score = 0.4 * centerScore + 0.4 * aspectScore + 0.2 * areaScore

  let message: string
  if (!centerOk || !aspectOk || !areaOk) {
    const parts: string[] = []
    if (centerDistNorm > centerTol) {
      if (Math.abs(dx) > Math.abs(dy)) {
        parts.push(dx > 0 ? "Mueve la hoja a la izquierda" : "Mueve la hoja a la derecha")
      } else {
        parts.push(dy > 0 ? "Sube un poco la hoja" : "Baja un poco la hoja")
      }
    }
    if (aspectDiff > aspectTol && !parts.length) {
      if (detected.aspectRatio > templateAspectRatio * (1 + aspectTol)) {
        parts.push("Inclina menos la hoja o acerca un poco")
      } else {
        parts.push("Alinea mejor la hoja con el marco")
      }
    }
    if (detected.areaRatio < AREA_MIN_RATIO_INTERNAL && !parts.length) {
      parts.push("Acércate un poco")
    }
    if (detected.areaRatio > AREA_MAX_RATIO_INTERNAL && !parts.length) {
      parts.push("Aleja un poco")
    }
    message = parts.length ? parts[0] : "Corrige la posición para continuar"
  } else {
    message = "Alineación correcta. Puedes capturar."
  }

  return {
    score,
    message,
    ready: score >= readyScore,
  }
}

/** Score por debajo de este valor → dibujar bbox en rojo. Entre este y ready → amarillo. */
const SEMAPHORE_RED_MAX = 0.4

/**
 * Dibuja en el canvas overlay el bounding box de la hoja detectada, con color según estado de alineación.
 * Solo dibuja lo que realmente detecta el sistema. No modifica el video ni el canvas de trabajo.
 * @param overlayCanvas Canvas superpuesto al video (mismo tamaño que el elemento de video en pantalla).
 * @param detected Hoja detectada (en coords del canvas de trabajo) o null.
 * @param feedback Resultado de getAlignmentFeedback (para color: rojo / amarillo / verde).
 * @param workW Ancho del canvas de trabajo usado en detectSheetInFrame.
 * @param workH Alto del canvas de trabajo.
 * @param displayW Ancho del elemento de video en pantalla (p. ej. video.clientWidth).
 * @param displayH Alto del elemento de video en pantalla (p. ej. video.clientHeight).
 * @param videoWidth video.videoWidth (resolución intrínseca).
 * @param videoHeight video.videoHeight.
 */
export function drawDetectionOverlay(
  overlayCanvas: HTMLCanvasElement,
  detected: SheetDetection | null,
  feedback: AlignmentFeedback,
  workW: number,
  workH: number,
  displayW: number,
  displayH: number,
  videoWidth: number,
  videoHeight: number
): void {
  const ctx = overlayCanvas.getContext("2d")
  if (!ctx) return

  overlayCanvas.width = displayW
  overlayCanvas.height = displayH
  ctx.clearRect(0, 0, displayW, displayH)

  if (!detected || workW <= 0 || workH <= 0) return

  const videoAspect = videoWidth / videoHeight
  const displayAspect = displayW / displayH
  let contentW: number
  let contentH: number
  let offsetX: number
  let offsetY: number
  if (videoAspect >= displayAspect) {
    contentW = displayW
    contentH = displayW / videoAspect
    offsetX = 0
    offsetY = (displayH - contentH) / 2
  } else {
    contentH = displayH
    contentW = displayH * videoAspect
    offsetX = (displayW - contentW) / 2
    offsetY = 0
  }

  const scaleX = contentW / workW
  const scaleY = contentH / workH
  const x = offsetX + (detected.center.x - detected.width / 2) * scaleX
  const y = offsetY + (detected.center.y - detected.height / 2) * scaleY
  const w = detected.width * scaleX
  const h = detected.height * scaleY

  if (feedback.ready) {
    ctx.strokeStyle = "rgba(34, 197, 94, 0.9)"
    ctx.fillStyle = "rgba(34, 197, 94, 0.08)"
  } else if (feedback.score >= SEMAPHORE_RED_MAX) {
    ctx.strokeStyle = "rgba(234, 179, 8, 0.9)"
    ctx.fillStyle = "rgba(234, 179, 8, 0.06)"
  } else {
    ctx.strokeStyle = "rgba(239, 68, 68, 0.9)"
    ctx.fillStyle = "rgba(239, 68, 68, 0.06)"
  }
  ctx.lineWidth = 2.5
  ctx.setLineDash([])
  ctx.fillRect(x, y, w, h)
  ctx.strokeRect(x, y, w, h)
}
