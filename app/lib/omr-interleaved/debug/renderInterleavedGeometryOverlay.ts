import sharp from "sharp"
import type { InterleavedDebugSnapshot } from "./buildInterleavedDebugSnapshot"

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export async function renderInterleavedGeometryOverlayPng(params: {
  width: number
  height: number
  snapshot: InterleavedDebugSnapshot
  warpedImageBuffer: Buffer
}): Promise<Buffer> {
  const { width: W, height: H, snapshot, warpedImageBuffer } = params
  const gd = snapshot.geometryDiagnostics
  const layer: string[] = []

  if (gd) {
    for (const b of gd.expectedBubbleCenters) {
      const x = b.x * W
      const y = b.y * H
      layer.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="none" stroke="#2563eb" stroke-width="1.5"/>`)
      layer.push(
        `<text x="${(x + 10).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="10" fill="#1d4ed8" font-family="system-ui,sans-serif">${esc(`${b.column} Q${b.questionNumber} P${b.panelIndex}`)}</text>`,
      )
    }
    for (const d of gd.detectedBubbleCenters) {
      const x = d.x * W
      const y = d.y * H
      layer.push(`<rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" fill="none" stroke="#16a34a" stroke-width="1.5"/>`)
      layer.push(
        `<text x="${(x + 7).toFixed(1)}" y="${(y + 11).toFixed(1)}" font-size="9" fill="#166534" font-family="system-ui,sans-serif">${esc(`#${d.idx}`)}</text>`,
      )
    }
    for (const r of gd.rowVerticalDelta) {
      const x1 = r.panelIndex === 0 ? W * 0.06 : W * 0.54
      const x2 = r.panelIndex === 0 ? W * 0.46 : W * 0.94
      const yExp = r.expectedY * H
      const yObs = r.observedY * H
      layer.push(`<line x1="${x1.toFixed(1)}" y1="${yExp.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${yExp.toFixed(1)}" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="4 3"/>`)
      layer.push(`<line x1="${x1.toFixed(1)}" y1="${yObs.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${yObs.toFixed(1)}" stroke="#ef4444" stroke-width="1.2"/>`)
      layer.push(
        `<text x="${x1.toFixed(1)}" y="${(yObs - 5).toFixed(1)}" font-size="10" fill="#7f1d1d" font-family="system-ui,sans-serif">${esc(`Q${r.questionNumber} dY=${r.delta.toFixed(4)}`)}</text>`,
      )
    }
  }

  for (const row of snapshot.reconstructionFinal) {
    const x = row.panel === 0 ? W * 0.015 : W * 0.915
    const y = row.rowCenterY * H
    layer.push(
      `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="12" font-weight="700" fill="#111827" font-family="system-ui,sans-serif">${esc(`Q${row.questionNumber}`)}</text>`,
    )
  }

  const info = gd
    ? `xOff=${gd.xOffsetEstimated.toFixed(4)} yOff=${gd.yOffsetEstimated.toFixed(4)} rowErr=${gd.averageRowError.toFixed(4)} colErr=${gd.averageColumnError.toFixed(4)}`
    : "geometryDiagnostics unavailable"
  layer.push(`<rect x="8" y="8" width="${Math.max(360, W * 0.38)}" height="26" fill="rgba(255,255,255,0.8)" stroke="#cbd5e1"/>`)
  layer.push(`<text x="14" y="25" font-size="12" fill="#0f172a" font-family="system-ui,sans-serif">${esc(info)}</text>`)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${layer.join("")}</svg>`
  const base = await sharp(warpedImageBuffer).resize(W, H, { fit: "fill" }).png().toBuffer()
  return sharp(base).composite([{ input: Buffer.from(svg) }]).png().toBuffer()
}
