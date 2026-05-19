/**
 * Detector V2 de marcadores negros para captura móvil.
 * Grayscale + Otsu + componentes conectados + validación anti-ruido.
 */

import type { MarkerDetectResult, Point, SheetQuad } from "./markerDetectV1"
import {
  auditSheetQuad,
  DEFAULT_QUAD_AUDIT_OPTIONS,
  perspectiveErrorFromQuad,
  QUADRANT_TO_CORNER,
  type CornerLabel,
  type QuadrantIndex,
  type QuadrantRegion,
  type QuadGeometryAudit,
} from "./quadAudit"

export const MARKER_V2_DEFAULTS = {
  quadrantInset: 0.38,
  minAreaRatio: 0.00018,
  maxAreaRatio: 0.12,
  minFillRatio: 0.4,
  minCompactness: 0.42,
  aspectMin: 0.5,
  aspectMax: 1.85,
  minComponentPixels: 14,
  maxComponentPixels: 60_000,
  otsuBias: 12,
  relaxedAcceptWinners: true,
  fallbackToNextCandidate: true,
  relaxedMinWidthAt960: 8,
  relaxedMinHeightAt960: 8,
  relaxedMinAreaAt480: 40,
  relaxedMinAreaAt960: 80,
} as const

const RELAXED_REF_WIDTH = 960
const RELAXED_AREA_WIDTH_MIN = 480

export type MarkerV2DetectParams = typeof MARKER_V2_DEFAULTS

export type RelaxedAbsoluteMins = {
  minWidth: number
  minHeight: number
  minArea: number
}

export function computeRelaxedAbsoluteMins(
  workWidth: number,
  params: MarkerV2DetectParams = MARKER_V2_DEFAULTS
): RelaxedAbsoluteMins {
  const scale = workWidth / RELAXED_REF_WIDTH
  const minWidth = params.relaxedMinWidthAt960 * scale
  const minHeight = params.relaxedMinHeightAt960 * scale
  const minArea =
    workWidth <= RELAXED_AREA_WIDTH_MIN
      ? params.relaxedMinAreaAt480
      : workWidth >= RELAXED_REF_WIDTH
        ? params.relaxedMinAreaAt960
        : params.relaxedMinAreaAt480 +
          ((params.relaxedMinAreaAt960 - params.relaxedMinAreaAt480) *
            (workWidth - RELAXED_AREA_WIDTH_MIN)) /
            (RELAXED_REF_WIDTH - RELAXED_AREA_WIDTH_MIN)
  return { minWidth, minHeight, minArea }
}

export type V2QuadrantAudit = {
  quadrant: QuadrantIndex
  corner: CornerLabel
  strictAccepted: boolean
  usedForQuad: boolean
  finalRejectReason: string | null
  relaxedOverride: boolean
}

export type MarkerDetectV2Result = MarkerDetectResult & {
  strictMarkerCount: number
  relaxedMarkerCount: number
  quadrantAudits: V2QuadrantAudit[]
  quadAudit: QuadGeometryAudit
}

type RawComponent = {
  pixelCount: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  sumX: number
  sumY: number
}

type ScoredCandidate = {
  score: number
  found: boolean
  rejectReason?: string
  centroid: Point
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  pixelCount: number
  blobArea: number
  aspect: number
  areaRatio: number
  innerCorner: Point
}

function buildRegions(w: number, h: number, inset: number): QuadrantRegion[] {
  const qw = Math.floor(w * inset)
  const qh = Math.floor(h * inset)
  return [
    { q: 0, x0: 0, y0: 0, x1: qw, y1: qh },
    { q: 1, x0: w - qw, y0: 0, x1: w, y1: qh },
    { q: 2, x0: w - qw, y0: h - qh, x1: w, y1: h },
    { q: 3, x0: 0, y0: h - qh, x1: qw, y1: h },
  ]
}

function toGrayscale(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      gray[y * w + x] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    }
  }
  return gray
}

export function computeOtsuThreshold(gray: Uint8Array): number {
  const hist = new Uint32Array(256)
  const n = gray.length
  for (let i = 0; i < n; i++) hist[gray[i]]++

  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]

  let sumB = 0
  let wB = 0
  let maxVar = 0
  let threshold = 128

  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const varBetween = wB * wF * (mB - mF) * (mB - mF)
    if (varBetween > maxVar) {
      maxVar = varBetween
      threshold = t
    }
  }
  return threshold
}

function quadrantForPoint(x: number, y: number, regions: QuadrantRegion[]): QuadrantIndex | null {
  for (const r of regions) {
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return r.q
  }
  return null
}

function innerCornerFromBbox(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  quadrant: QuadrantIndex
): Point {
  switch (quadrant) {
    case 0:
      return { x: bbox.maxX, y: bbox.maxY }
    case 1:
      return { x: bbox.minX, y: bbox.maxY }
    case 2:
      return { x: bbox.minX, y: bbox.minY }
    default:
      return { x: bbox.maxX, y: bbox.minY }
  }
}

function positionScore(cx: number, cy: number, region: QuadrantRegion): number {
  const rw = region.x1 - region.x0 || 1
  const rh = region.y1 - region.y0 || 1
  const ux = (cx - region.x0) / rw
  const uy = (cy - region.y0) / rh
  switch (region.q) {
    case 0:
      return (1 - ux) * 0.5 + (1 - uy) * 0.5
    case 1:
      return ux * 0.5 + (1 - uy) * 0.5
    case 2:
      return ux * 0.5 + uy * 0.5
    default:
      return (1 - ux) * 0.5 + uy * 0.5
  }
}

function aspectScore(aspect: number): number {
  const dev = Math.abs(aspect - 1)
  return Math.max(0, 1 - dev / 0.55)
}

function areaFitScore(areaRatio: number, params: MarkerV2DetectParams): number {
  const mid = (params.minAreaRatio + params.maxAreaRatio) / 2
  const half = (params.maxAreaRatio - params.minAreaRatio) / 2 || 0.001
  const dev = Math.abs(areaRatio - mid) / half
  return Math.max(0, 1 - dev)
}

function scoreComponent(
  comp: RawComponent,
  region: QuadrantRegion,
  frameArea: number,
  params: MarkerV2DetectParams
): { score: number; metrics: Omit<ScoredCandidate, "score" | "found" | "rejectReason"> } {
  const bw = comp.maxX - comp.minX + 1
  const bh = comp.maxY - comp.minY + 1
  const bboxArea = bw * bh
  const aspect = bw / (bh || 1)
  const areaRatio = bboxArea / frameArea
  const fillRatio = comp.pixelCount / (bboxArea || 1)
  const perimApprox = 2 * (bw + bh)
  const compactness =
    perimApprox > 0 ? (4 * Math.PI * comp.pixelCount) / (perimApprox * perimApprox) : 0
  const cx = comp.sumX / comp.pixelCount
  const cy = comp.sumY / comp.pixelCount
  const centroid = { x: cx, y: cy }
  const bbox = { minX: comp.minX, minY: comp.minY, maxX: comp.maxX, maxY: comp.maxY }

  const score =
    aspectScore(aspect) * 0.22 +
    Math.min(1, fillRatio) * 0.28 +
    Math.min(1, compactness) * 0.18 +
    positionScore(cx, cy, region) * 0.22 +
    areaFitScore(areaRatio, params) * 0.1

  return {
    score,
    metrics: {
      bbox,
      pixelCount: comp.pixelCount,
      blobArea: bboxArea,
      areaRatio,
      aspect,
      centroid,
      innerCorner: innerCornerFromBbox(bbox, region.q),
    },
  }
}

function rejectReasonFor(comp: RawComponent, frameArea: number, params: MarkerV2DetectParams): string | null {
  if (comp.pixelCount < params.minComponentPixels) return "small"
  if (comp.pixelCount > params.maxComponentPixels) return "large"
  const bw = comp.maxX - comp.minX + 1
  const bh = comp.maxY - comp.minY + 1
  const aspect = bw / (bh || 1)
  const areaRatio = (bw * bh) / frameArea
  const fillRatio = comp.pixelCount / (bw * bh || 1)
  const perimApprox = 2 * (bw + bh)
  const compactness =
    perimApprox > 0 ? (4 * Math.PI * comp.pixelCount) / (perimApprox * perimApprox) : 0

  if (aspect < params.aspectMin || aspect > params.aspectMax) return "aspect"
  if (areaRatio < params.minAreaRatio || areaRatio > params.maxAreaRatio) return "area"
  if (fillRatio < params.minFillRatio) return "fill"
  if (compactness < params.minCompactness) return "shape"
  return null
}

function relaxedAbsoluteSizeRejectReason(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  blobArea: number,
  workWidth: number,
  params: MarkerV2DetectParams
): boolean {
  const bw = bbox.maxX - bbox.minX + 1
  const bh = bbox.maxY - bbox.minY + 1
  const { minWidth, minHeight, minArea } = computeRelaxedAbsoluteMins(workWidth, params)
  return bw < minWidth || bh < minHeight || blobArea < minArea
}

function findConnectedComponents(mask: Uint8Array, w: number, h: number): RawComponent[] {
  const visited = new Uint8Array(w * h)
  const stackX: number[] = []
  const stackY: number[] = []
  const out: RawComponent[] = []

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (!mask[idx] || visited[idx]) continue

      const comp: RawComponent = {
        pixelCount: 0,
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
        sumX: 0,
        sumY: 0,
      }

      stackX.length = 0
      stackY.length = 0
      stackX.push(x)
      stackY.push(y)
      visited[idx] = 1

      while (stackX.length > 0) {
        const cx = stackX.pop()!
        const cy = stackY.pop()!

        comp.pixelCount++
        comp.sumX += cx
        comp.sumY += cy
        if (cx < comp.minX) comp.minX = cx
        if (cy < comp.minY) comp.minY = cy
        if (cx > comp.maxX) comp.maxX = cx
        if (cy > comp.maxY) comp.maxY = cy

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const nidx = ny * w + nx
          if (!mask[nidx] || visited[nidx]) continue
          visited[nidx] = 1
          stackX.push(nx)
          stackY.push(ny)
        }
      }

      out.push(comp)
    }
  }

  return out
}

/** Detecta marcadores con pipeline V2 (producción captura móvil). */
export function detectMarkersV2(
  imageData: ImageData,
  params: MarkerV2DetectParams = MARKER_V2_DEFAULTS
): MarkerDetectV2Result {
  const { width: w, height: h, data } = imageData
  const frameArea = w * h
  const regions = buildRegions(w, h, params.quadrantInset)
  const gray = toGrayscale(data, w, h)
  const otsu = computeOtsuThreshold(gray)
  const threshold = Math.min(255, otsu + params.otsuBias)

  const mask = new Uint8Array(w * h)
  for (let i = 0; i < gray.length; i++) {
    mask[i] = gray[i] < threshold ? 1 : 0
  }

  const components = findConnectedComponents(mask, w, h)
  const byQuadrant: ScoredCandidate[][] = [[], [], [], []]

  for (const comp of components) {
    const cx = comp.sumX / comp.pixelCount
    const cy = comp.sumY / comp.pixelCount
    const q = quadrantForPoint(cx, cy, regions)
    if (q === null) continue

    const region = regions[q]!
    const reject = rejectReasonFor(comp, frameArea, params)
    const scored = scoreComponent(comp, region, frameArea, params)

    byQuadrant[q].push({
      score: scored.score,
      found: reject === null,
      rejectReason: reject ?? undefined,
      ...scored.metrics,
    })
  }

  const markers: Point[] = []
  const cornerPoints: Partial<Record<CornerLabel, Point>> = {}
  const quadrantAudits: V2QuadrantAudit[] = []
  let strictValid = 0
  let relaxedValid = 0

  for (let qi = 0; qi < 4; qi++) {
    const q = qi as QuadrantIndex
    const corner = QUADRANT_TO_CORNER[q]
    const pool = byQuadrant[q]
    pool.sort((a, b) => b.score - a.score)
    const passing = pool.filter((c) => c.found)

    let chosen: ScoredCandidate | null = passing[0] ?? null
    let relaxedOverride = false

    if (!chosen && params.fallbackToNextCandidate && pool.length > 0) {
      chosen = pool[0]
    }

    let strictAccepted = false
    let usedForQuad = false
    let finalRejectReason: string | null = null

    if (!chosen) {
      finalRejectReason = "sin candidato"
    } else if (chosen.found) {
      strictAccepted = true
      usedForQuad = true
      strictValid++
      relaxedValid++
      markers.push(chosen.centroid)
      cornerPoints[corner] = chosen.innerCorner
    } else if (params.relaxedAcceptWinners && chosen.innerCorner && chosen.bbox) {
      if (relaxedAbsoluteSizeRejectReason(chosen.bbox, chosen.blobArea, w, params)) {
        finalRejectReason = "ruido"
      } else {
        relaxedOverride = true
        usedForQuad = true
        relaxedValid++
        finalRejectReason = chosen.rejectReason ?? "relajado"
        markers.push(chosen.centroid)
        cornerPoints[corner] = chosen.innerCorner
      }
    } else {
      finalRejectReason = chosen.rejectReason ?? "rechazado"
    }

    quadrantAudits.push({
      quadrant: q,
      corner,
      strictAccepted,
      usedForQuad,
      finalRejectReason,
      relaxedOverride,
    })
  }

  const quadAudit = auditSheetQuad(
    cornerPoints,
    regions,
    w,
    h,
    relaxedValid,
    { ...DEFAULT_QUAD_AUDIT_OPTIONS, relaxed: params.relaxedAcceptWinners }
  )

  const markerCount =
    params.relaxedAcceptWinners && relaxedValid >= strictValid ? relaxedValid : strictValid

  const quad =
    markerCount === 4 && quadAudit.assembledQuad != null ? quadAudit.assembledQuad : null

  const areaRatio =
    quad != null
      ? quadAudit.areaRatio > 0
        ? quadAudit.areaRatio
        : (() => {
            const xs = quad.map((p) => p.x)
            const ys = quad.map((p) => p.y)
            return (
              ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / frameArea
            )
          })()
      : 0

  const perspectiveError =
    quad != null
      ? quadAudit.geometryValid
        ? quadAudit.perspectiveError
        : params.relaxedAcceptWinners
          ? perspectiveErrorFromQuad(quad)
          : 1
      : quadAudit.perspectiveError

  return {
    markerCount,
    markers,
    quad,
    areaRatio,
    perspectiveError,
    workWidth: w,
    workHeight: h,
    strictMarkerCount: strictValid,
    relaxedMarkerCount: relaxedValid,
    quadrantAudits,
    quadAudit,
  }
}
