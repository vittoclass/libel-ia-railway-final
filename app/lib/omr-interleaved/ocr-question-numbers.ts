/**
 * Candidatos de numeración desde líneas OCR (prebuilt-layout).
 * Coordenadas normalizadas 0–1 como selectionMarks.
 */
import type { AnalyzeResultPayload, AnalyzePage } from "./azure-layout-client"

export type OcrNumberHit = { value: number; centerX: number; centerY: number }

function lineCenterAndPoly(
  line: { content?: string; polygon?: number[] },
  page: AnalyzePage,
): { cx: number; cy: number; text: string } | null {
  const poly = line.polygon
  if (!poly || poly.length < 4) return null
  const w = page.width && page.width > 0 ? page.width : 1
  const h = page.height && page.height > 0 ? page.height : 1
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i + 1 < poly.length; i += 2) {
    xs.push(poly[i]! / w)
    ys.push(poly[i + 1]! / h)
  }
  if (xs.length === 0) return null
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length
  const text = String(line.content ?? "").trim()
  return { cx, cy, text }
}

/** Solo enteros aislados típicos de índice de pregunta (1–199). */
export function extractOcrQuestionNumberHits(analyzeResult: AnalyzeResultPayload): OcrNumberHit[] {
  const hits: OcrNumberHit[] = []
  for (const page of analyzeResult.pages ?? []) {
    for (const line of page.lines ?? []) {
      const g = lineCenterAndPoly(line, page)
      if (!g) continue
      const m = g.text.match(/^\s*(\d{1,3})\s*$/)
      if (!m) continue
      const value = Number(m[1])
      if (!Number.isFinite(value) || value < 1 || value > 199) continue
      hits.push({ value, centerX: g.cx, centerY: g.cy })
    }
  }
  return hits
}

/** Mejor hit OCR cerca de una fila (misma columna aproximada). */
export function nearestOcrNumberForRow(params: {
  hits: OcrNumberHit[]
  rowCenterY: number
  panel: "left" | "right"
  maxDy: number
}): number | null {
  const { hits, rowCenterY, panel, maxDy } = params
  const inBand = (h: OcrNumberHit) =>
    panel === "left" ? h.centerX < 0.52 : h.centerX >= 0.48
  let best: OcrNumberHit | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const h of hits) {
    if (!inBand(h)) continue
    const d = Math.abs(h.centerY - rowCenterY)
    if (d <= maxDy && d < bestD) {
      bestD = d
      best = h
    }
  }
  return best ? best.value : null
}

/** Igual que `nearestOcrNumberForRow` pero expone ΔY (solo diagnóstico). */
export function nearestOcrHitForRow(params: {
  hits: OcrNumberHit[]
  rowCenterY: number
  panel: "left" | "right"
  maxDy: number
}): { value: number; dy: number; centerX: number } | null {
  const { hits, rowCenterY, panel, maxDy } = params
  const inBand = (h: OcrNumberHit) => (panel === "left" ? h.centerX < 0.52 : h.centerX >= 0.48)
  let best: OcrNumberHit | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const h of hits) {
    if (!inBand(h)) continue
    const d = Math.abs(h.centerY - rowCenterY)
    if (d <= maxDy && d < bestD) {
      bestD = d
      best = h
    }
  }
  return best ? { value: best.value, dy: bestD, centerX: best.centerX } : null
}
