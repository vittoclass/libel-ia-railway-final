/**
 * Overlay PNG opcional (SVG + sharp) para inspección visual. Solo debug interleaved.
 */
import sharp from "sharp"
import type { InterleavedDebugSnapshot } from "./buildInterleavedDebugSnapshot"

function bandColor(i: number): string {
  const hue = (i * 47) % 360
  return `hsla(${hue}, 65%, 52%, 0.22)`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Imagen de diagnóstico: bandas en color, etiquetas de emparejamiento y número reconstruido.
 */
export async function renderInterleavedDebugOverlayPng(params: {
  width: number
  height: number
  snapshot: InterleavedDebugSnapshot
}): Promise<Buffer> {
  const { width: W, height: H, snapshot: s } = params
  const parts: string[] = []

  for (let i = 0; i < s.bands.length; i++) {
    const b = s.bands[i]!
    const y1 = b.yMin * H
    const y2 = b.yMax * H
    const h = Math.max(4, y2 - y1)
    parts.push(
      `<rect x="0" y="${y1.toFixed(1)}" width="${W}" height="${h.toFixed(1)}" fill="${bandColor(b.bandIndex)}" stroke="none"/>`,
    )
  }

  for (const p of s.pairings) {
    const y = p.rowCenterY * H
    const label = `t${p.tierIndexGlobal} L${p.leftPresent ? "1" : "0"} R${p.rightPresent ? "1" : "0"}`
    parts.push(
      `<text x="8" y="${(y + 4).toFixed(1)}" font-size="11" fill="#0f172a" font-family="system-ui,sans-serif">${escapeXml(label)}</text>`,
    )
  }

  for (const a of s.anchors) {
    const y = a.rowCenterY * H
    const x = a.panel === 0 ? 12 : W - 120
    const ocr = a.ocrValue != null ? String(a.ocrValue) : "—"
    const conf = a.confidenceApprox != null ? a.confidenceApprox.toFixed(2) : "—"
    const line = `#${a.reassignedQuestionNumber} ocr${ocr} ~${conf}`
    parts.push(
      `<text x="${x.toFixed(0)}" y="${(y - 6).toFixed(1)}" font-size="12" font-weight="600" fill="#1e3a8a" font-family="system-ui,sans-serif">${escapeXml(line)}</text>`,
    )
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
