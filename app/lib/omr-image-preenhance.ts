/**
 * Pre-procesamiento reversible de imagen para un reintento de OMR Azure.
 * Si falla (canvas no disponible, formato raro), el caller debe usar la imagen original.
 */
import { createCanvas, loadImage } from "canvas"

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/**
 * Aumenta contraste y aplica un afilado muy suave; salida JPEG en data URL base64.
 */
export async function enhanceOmrStudentImageBase64(dataUrlOrBase64: string): Promise<string> {
  const trimmed = String(dataUrlOrBase64 ?? "").trim()
  if (!trimmed) throw new Error("empty_image")
  const base64Payload = trimmed.includes("base64,") ? trimmed.split("base64,")[1]! : trimmed
  const buf = Buffer.from(base64Payload, "base64")
  if (buf.length < 32) throw new Error("image_too_small")

  const img = await loadImage(buf)
  const w = img.width
  const h = img.height
  if (w < 8 || h < 8) throw new Error("image_dimensions_too_small")

  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, w, h)
  const d = imageData.data

  const contrast = 1.22
  const intercept = 128 * (1 - contrast)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clampByte(d[i]! * contrast + intercept)
    d[i + 1] = clampByte(d[i + 1]! * contrast + intercept)
    d[i + 2] = clampByte(d[i + 2]! * contrast + intercept)
  }
  ctx.putImageData(imageData, 0, 0)

  const sharp = ctx.getImageData(0, 0, w, h)
  const copy = new Uint8ClampedArray(sharp.data)
  const out = new Uint8ClampedArray(copy)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const o = idx + c
        const center = copy[o]!
        const lap =
          -0.15 * (copy[o - 4]! + copy[o + 4]! + copy[o - w * 4]! + copy[o + w * 4]!) + 1.6 * center
        out[o] = clampByte(lap)
      }
    }
  }
  sharp.data.set(out)
  ctx.putImageData(sharp, 0, 0)

  return canvas.toDataURL("image/jpeg", 0.92)
}
