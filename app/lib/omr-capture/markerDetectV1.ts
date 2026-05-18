/**
 * Detección de 4 cuadrados negros (marcadores V1) en frame reducido.
 * Solo captura móvil; no modifica pipelines OMR.
 */

export type Point = { x: number; y: number }

/** Esquinas interiores hacia el contenido: [tl, tr, br, bl]. */
export type SheetQuad = [Point, Point, Point, Point]

export type MarkerDetectResult = {
  markerCount: number
  /** Centroides en coords del canvas de trabajo, orden tl, tr, br, bl. */
  markers: Point[]
  quad: SheetQuad | null
  areaRatio: number
  perspectiveError: number
  workWidth: number
  workHeight: number
}

const QUADRANT_INSET = 0.38
const DARK_THRESHOLD = 95
const MIN_BLOB_PIXELS = 40

function grayAt(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  const i = (y * w + x) * 4
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
}

type BlobStats = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  count: number
  sumX: number
  sumY: number
}

function emptyBlob(): BlobStats {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    count: 0,
    sumX: 0,
    sumY: 0,
  }
}

function scanQuadrant(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): BlobStats | null {
  const b = emptyBlob()
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (grayAt(data, w, x, y) < DARK_THRESHOLD) {
        b.count++
        b.sumX += x
        b.sumY += y
        if (x < b.minX) b.minX = x
        if (y < b.minY) b.minY = y
        if (x > b.maxX) b.maxX = x
        if (y > b.maxY) b.maxY = y
      }
    }
  }
  if (b.count < MIN_BLOB_PIXELS) return null
  const bw = b.maxX - b.minX + 1
  const bh = b.maxY - b.minY + 1
  const aspect = bw / (bh || 1)
  if (aspect < 0.55 || aspect > 1.8) return null
  const frameArea = w * h
  const blobArea = bw * bh
  if (blobArea / frameArea < 0.0008 || blobArea / frameArea > 0.06) return null
  return b
}

function innerCorner(b: BlobStats, quadrant: 0 | 1 | 2 | 3): Point {
  switch (quadrant) {
    case 0:
      return { x: b.maxX, y: b.maxY }
    case 1:
      return { x: b.minX, y: b.maxY }
    case 2:
      return { x: b.minX, y: b.minY }
    default:
      return { x: b.maxX, y: b.minY }
  }
}

function perspectiveErrorFromQuad(q: SheetQuad): number {
  const [tl, tr, br, bl] = q
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y)
  const left = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  const right = Math.hypot(br.x - tr.x, br.y - tr.y)
  const avgH = (top + bottom) / 2 || 1
  const avgW = (left + right) / 2 || 1
  const skew = Math.abs(top - bottom) / avgH + Math.abs(left - right) / avgW
  return Math.min(1, skew / 0.5)
}

/**
 * Analiza ImageData (RGBA) y devuelve marcadores + cuadrilátero interior.
 */
export function detectBlackSquareMarkers(imageData: ImageData): MarkerDetectResult {
  const { width: w, height: h, data } = imageData
  const qw = Math.floor(w * QUADRANT_INSET)
  const qh = Math.floor(h * QUADRANT_INSET)

  const regions: Array<{ x0: number; y0: number; x1: number; y1: number; q: 0 | 1 | 2 | 3 }> = [
    { x0: 0, y0: 0, x1: qw, y1: qh, q: 0 },
    { x0: w - qw, y0: 0, x1: w, y1: qh, q: 1 },
    { x0: w - qw, y0: h - qh, x1: w, y1: h, q: 2 },
    { x0: 0, y0: h - qh, x1: qw, y1: h, q: 3 },
  ]

  const markers: Point[] = []
  const quadPoints: Point[] = []
  let valid = 0

  for (const r of regions) {
    const blob = scanQuadrant(data, w, h, r.x0, r.y0, r.x1, r.y1)
    if (!blob) continue
    valid++
    markers.push({
      x: blob.sumX / blob.count,
      y: blob.sumY / blob.count,
    })
    quadPoints.push(innerCorner(blob, r.q))
  }

  if (valid !== 4 || quadPoints.length !== 4) {
    return {
      markerCount: valid,
      markers,
      quad: null,
      areaRatio: 0,
      perspectiveError: 1,
      workWidth: w,
      workHeight: h,
    }
  }

  const quad = quadPoints as SheetQuad
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
  const areaRatio = area / (w * h)

  return {
    markerCount: 4,
    markers,
    quad,
    areaRatio,
    perspectiveError: perspectiveErrorFromQuad(quad),
    workWidth: w,
    workHeight: h,
  }
}

export function drawVideoFrameToWorkCanvas(
  video: HTMLVideoElement,
  workCanvas: HTMLCanvasElement,
  maxWidth: number
): ImageData | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (vw < 2 || vh < 2) return null
  const scale = Math.min(1, maxWidth / vw)
  const w = Math.max(2, Math.round(vw * scale))
  const h = Math.max(2, Math.round(vh * scale))
  workCanvas.width = w
  workCanvas.height = h
  const ctx = workCanvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

export function imageDataFromDataUrl(
  dataUrl: string,
  maxWidth: number
): Promise<{ imageData: ImageData; fullWidth: number; fullHeight: number; scale: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const fw = img.naturalWidth
      const fh = img.naturalHeight
      const scale = Math.min(1, maxWidth / fw)
      const w = Math.max(2, Math.round(fw * scale))
      const h = Math.max(2, Math.round(fh * scale))
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(img, 0, 0, fw, fh, 0, 0, w, h)
      resolve({
        imageData: ctx.getImageData(0, 0, w, h),
        fullWidth: fw,
        fullHeight: fh,
        scale,
      })
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

/** Escala puntos de trabajo a coords de imagen completa. */
export function scalePointsToFull(points: Point[], scale: number): Point[] {
  const inv = 1 / scale
  return points.map((p) => ({ x: p.x * inv, y: p.y * inv }))
}
