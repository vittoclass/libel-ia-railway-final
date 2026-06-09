export type NormalizedCropRect = { x: number; y: number; w: number; h: number }

export function normalizeCropRect(r: NormalizedCropRect): NormalizedCropRect {
  const x = Math.max(0, Math.min(1, r.x))
  const y = Math.max(0, Math.min(1, r.y))
  const w = Math.max(0.05, Math.min(1 - x, r.w))
  const h = Math.max(0.05, Math.min(1 - y, r.h))
  return { x, y, w, h }
}

export function defaultCropRect(): NormalizedCropRect {
  return { x: 0, y: 0, w: 1, h: 1 }
}

export function isCustomCropRect(r: NormalizedCropRect | null | undefined): boolean {
  if (!r) return false
  return r.w < 0.98 || r.h < 0.98 || r.x > 0.02 || r.y > 0.02
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("No se pudo cargar la imagen para recortar."))
    img.src = url
  })
}

/** Recorte client-side aislado (sin OMR ni perspectiva). */
export async function cropImageFileFromUrl(
  imageUrl: string,
  rect: NormalizedCropRect,
  filename: string,
): Promise<{ file: File; width: number; height: number } | null> {
  const img = await loadImageFromUrl(imageUrl)
  const r = normalizeCropRect(rect)
  const sx = Math.floor(r.x * img.naturalWidth)
  const sy = Math.floor(r.y * img.naturalHeight)
  const sw = Math.max(1, Math.floor(r.w * img.naturalWidth))
  const sh = Math.max(1, Math.floor(r.h * img.naturalHeight))

  const canvas = document.createElement("canvas")
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
  })
  if (!blob) return null

  return {
    file: new File([blob], filename, { type: "image/jpeg" }),
    width: sw,
    height: sh,
  }
}
