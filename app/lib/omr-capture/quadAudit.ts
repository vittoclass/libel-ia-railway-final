/**
 * Validación de cuadrilátero para captura móvil OMR (V2).
 */

import type { Point, SheetQuad } from "./markerDetectV1"

export type CornerLabel = "TL" | "TR" | "BR" | "BL"

export type QuadrantIndex = 0 | 1 | 2 | 3

export type QuadrantRegion = {
  q: QuadrantIndex
  x0: number
  y0: number
  x1: number
  y1: number
}

export const QUADRANT_TO_CORNER: Record<QuadrantIndex, CornerLabel> = {
  0: "TL",
  1: "TR",
  2: "BR",
  3: "BL",
}

export type QuadValidationIssue =
  | "insufficient_markers"
  | "missing_corner"
  | "area_too_small"
  | "self_intersection"
  | "not_convex"
  | "crossed_edges"
  | "invalid_edge_lengths"
  | "corner_order_suspect"
  | "degenerate_point"

export type QuadGeometryAudit = {
  assembledQuad: SheetQuad | null
  expectedQuad: SheetQuad
  presentCorners: CornerLabel[]
  missingCorners: CornerLabel[]
  geometryValid: boolean
  issues: QuadValidationIssue[]
  issueMessages: string[]
  isConvex: boolean | null
  hasSelfIntersection: boolean | null
  signedArea: number
  areaRatio: number
  perspectiveError: number
  perspectiveErrorReason: string
}

export type QuadAuditOptions = {
  minQuadAreaRatio: number
  minEdgePx: number
  relaxed: boolean
  relaxedMinQuadAreaRatio: number
}

export const DEFAULT_QUAD_AUDIT_OPTIONS: QuadAuditOptions = {
  minQuadAreaRatio: 0.1,
  minEdgePx: 12,
  relaxed: true,
  relaxedMinQuadAreaRatio: 0.06,
}

export function expectedQuadFromRegions(regions: QuadrantRegion[]): SheetQuad {
  const corner = (r: QuadrantRegion, q: QuadrantIndex): Point => {
    switch (q) {
      case 0:
        return { x: r.x1 - 1, y: r.y1 - 1 }
      case 1:
        return { x: r.x0, y: r.y1 - 1 }
      case 2:
        return { x: r.x0, y: r.y0 }
      default:
        return { x: r.x1 - 1, y: r.y0 }
    }
  }
  return [corner(regions[0], 0), corner(regions[1], 1), corner(regions[2], 2), corner(regions[3], 3)]
}

function cross2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross2(p1, p2, p3)
  const d2 = cross2(p1, p2, p4)
  const d3 = cross2(p3, p4, p1)
  const d4 = cross2(p3, p4, p2)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return false
}

function shoelaceArea(pts: Point[]): number {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(sum) / 2
}

function isConvexQuad(pts: Point[]): boolean {
  if (pts.length !== 4) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % 4]
    const c = pts[(i + 2) % 4]
    const cr = cross2(a, b, c)
    if (Math.abs(cr) < 1e-6) continue
    if (sign === 0) sign = cr > 0 ? 1 : -1
    else if ((cr > 0 ? 1 : -1) !== sign) return false
  }
  return sign !== 0
}

function hasSelfIntersection(pts: Point[]): boolean {
  if (pts.length !== 4) return false
  const edges: [Point, Point][] = [
    [pts[0], pts[1]],
    [pts[1], pts[2]],
    [pts[2], pts[3]],
    [pts[3], pts[0]],
  ]
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === 3)) continue
      if (segmentsIntersect(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) return true
    }
  }
  return false
}

function minEdgeLength(pts: Point[]): number {
  let min = Infinity
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    const len = Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y)
    if (len < min) min = len
  }
  return min === Infinity ? 0 : min
}

function cornerOrderSuspect(q: SheetQuad): boolean {
  const [tl, tr, br, bl] = q
  if (tl.x >= tr.x - 2) return true
  if (bl.x >= br.x - 2) return true
  if (tl.y >= bl.y - 2) return true
  if (tr.y >= br.y - 2) return true
  return false
}

export function perspectiveErrorFromQuad(q: SheetQuad): number {
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

export function auditSheetQuad(
  cornerPoints: Partial<Record<CornerLabel, Point>>,
  regions: QuadrantRegion[],
  frameW: number,
  frameH: number,
  markerCount: number,
  opts: QuadAuditOptions = DEFAULT_QUAD_AUDIT_OPTIONS
): QuadGeometryAudit {
  const expectedQuad = expectedQuadFromRegions(regions)
  const allCorners: CornerLabel[] = ["TL", "TR", "BR", "BL"]
  const presentCorners = allCorners.filter((c) => cornerPoints[c] != null)
  const missingCorners = allCorners.filter((c) => cornerPoints[c] == null)

  const issues: QuadValidationIssue[] = []
  const issueMessages: string[] = []

  if (markerCount < 4) {
    issues.push("insufficient_markers")
    issueMessages.push(`Marcadores insuficientes (${markerCount})`)
  }
  for (const c of missingCorners) {
    issues.push("missing_corner")
    issueMessages.push(`Esquina ${c} ausente`)
  }

  const ptsOrdered: Point[] = allCorners.map((c) => cornerPoints[c]).filter((p): p is Point => p != null)

  if (ptsOrdered.length < 4) {
    return {
      assembledQuad: null,
      expectedQuad,
      presentCorners,
      missingCorners,
      geometryValid: false,
      issues,
      issueMessages,
      isConvex: null,
      hasSelfIntersection: null,
      signedArea: 0,
      areaRatio: 0,
      perspectiveError: 1,
      perspectiveErrorReason:
        markerCount < 4
          ? `Sin quad: ${markerCount} marcadores`
          : `Sin quad: ${ptsOrdered.length} puntos`,
    }
  }

  const assembledQuad: SheetQuad = [
    cornerPoints.TL!,
    cornerPoints.TR!,
    cornerPoints.BR!,
    cornerPoints.BL!,
  ]

  for (const p of assembledQuad) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      issues.push("degenerate_point")
      issueMessages.push("Coordenadas no finitas")
    }
  }

  const frameArea = frameW * frameH
  const signedArea = shoelaceArea(assembledQuad)
  const areaRatio = signedArea / frameArea
  const minArea = opts.relaxed ? opts.relaxedMinQuadAreaRatio : opts.minQuadAreaRatio

  if (areaRatio < minArea) {
    issues.push("area_too_small")
    issueMessages.push(`Área insuficiente (${areaRatio.toFixed(4)})`)
  }

  const minEdge = minEdgeLength(assembledQuad)
  const minEdgeThreshold = opts.relaxed ? opts.minEdgePx * 0.5 : opts.minEdgePx
  if (minEdge < minEdgeThreshold) {
    issues.push("invalid_edge_lengths")
    issueMessages.push(`Lado corto (${minEdge.toFixed(1)}px)`)
  }

  const convex = isConvexQuad(assembledQuad)
  const selfInt = hasSelfIntersection(assembledQuad)

  if (!convex) {
    issues.push("not_convex")
    issueMessages.push("Quad no convexo")
  }
  if (selfInt) {
    issues.push("self_intersection")
    issues.push("crossed_edges")
    issueMessages.push("Aristas cruzadas")
  }
  if (cornerOrderSuspect(assembledQuad)) {
    issues.push("corner_order_suspect")
    issueMessages.push("Orden de esquinas sospechoso")
  }

  const hardBlock = issues.some((i) =>
    ["self_intersection", "crossed_edges", "degenerate_point", "insufficient_markers", "missing_corner"].includes(i)
  )
  const areaOk = areaRatio >= minArea
  const geometryValid =
    presentCorners.length === 4 &&
    !hardBlock &&
    areaOk &&
    (opts.relaxed ||
      (!issues.includes("not_convex") &&
        !issues.includes("corner_order_suspect") &&
        !issues.includes("invalid_edge_lengths")))

  const perspectiveError = geometryValid ? perspectiveErrorFromQuad(assembledQuad) : 1

  let perspectiveErrorReason: string
  if (perspectiveError >= 0.99 && !geometryValid) {
    const parts = issueMessages.length ? issueMessages.join("; ") : issues.join(", ")
    perspectiveErrorReason = `Geometría inválida: ${parts}`
  } else if (perspectiveError >= 0.99) {
    perspectiveErrorReason = "Perspectiva extrema"
  } else {
    perspectiveErrorReason = `Perspectiva aceptable (${perspectiveError.toFixed(4)})`
  }

  return {
    assembledQuad,
    expectedQuad,
    presentCorners,
    missingCorners,
    geometryValid,
    issues,
    issueMessages,
    isConvex: convex,
    hasSelfIntersection: selfInt,
    signedArea,
    areaRatio,
    perspectiveError,
    perspectiveErrorReason,
  }
}
