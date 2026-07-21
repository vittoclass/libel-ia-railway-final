/**
 * Diagnóstico liviano de calidad de imagen.
 * Nunca asigna puntaje bajo por calidad de cámara — solo informativo.
 * Usa `sharp` si está disponible (ya es dependencia del repo); si no, dimensiones
 * por cabecera JPEG/PNG y omite blur.
 */

import type { MultimodalArtsImageInput } from "@/app/lib/multimodal/types"

type SharpFn = (input?: Buffer | string, options?: { failOn?: string }) => {
  metadata: () => Promise<{ width?: number; height?: number }>
  resize: (
    w: number,
    h: number,
    opts?: { fit?: string },
  ) => {
    grayscale: () => {
      raw: () => {
        toBuffer: (opts: {
          resolveWithObject: true
        }) => Promise<{ data: Buffer; info: { width: number; height: number } }>
      }
    }
  }
}

async function loadSharp(): Promise<SharpFn | null> {
  try {
    const mod = (await import("sharp")) as unknown as {
      default?: SharpFn
    } & SharpFn
    return (typeof mod.default === "function" ? mod.default : mod) as SharpFn
  } catch {
    return null
  }
}

export type ImageQualityDiagnosis = {
  image_id: string
  available: boolean
  width?: number
  height?: number
  orientation?: "landscape" | "portrait" | "square" | "unknown"
  /** Varianza Laplacian aproximada (mayor = más nítida). Omitido si no hay sharp. */
  blur_score?: number
  /** Desviación estándar de luminancia. Omitido si no hay sharp. */
  contrast_score?: number
  exposure?: "underexposed" | "overexposed" | "ok" | "unknown"
  notes: string[]
}

function stripDataUrl(raw: string): { buf: Buffer | null; isUrl: boolean } {
  const s = String(raw ?? "").trim()
  if (!s) return { buf: null, isUrl: false }
  if (s.startsWith("http://") || s.startsWith("https://")) {
    return { buf: null, isUrl: true }
  }
  const b64 = s.includes("base64,") ? (s.split("base64,")[1] ?? "") : s
  try {
    const buf = Buffer.from(b64, "base64")
    if (buf.length < 32) return { buf: null, isUrl: false }
    return { buf, isUrl: false }
  } catch {
    return { buf: null, isUrl: false }
  }
}

/** Dimensiones JPEG vía SOF0/SOF2 sin decodificar píxeles. */
function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]!
    if (marker === 0xd9 || marker === 0xda) break
    const len = (buf[i + 2]! << 8) | buf[i + 3]!
    if (len < 2) break
    // SOF0 / SOF2
    if (marker === 0xc0 || marker === 0xc2) {
      const height = (buf[i + 5]! << 8) | buf[i + 6]!
      const width = (buf[i + 7]! << 8) | buf[i + 8]!
      if (width > 0 && height > 0) return { width, height }
    }
    i += 2 + len
  }
  return null
}

/** Dimensiones PNG vía IHDR. */
function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null
  const sig = buf.subarray(0, 8)
  const expected = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!sig.equals(expected)) return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width > 0 && height > 0) return { width, height }
  return null
}

function orientationOf(
  w: number,
  h: number,
): "landscape" | "portrait" | "square" | "unknown" {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "unknown"
  if (w === h) return "square"
  return w > h ? "landscape" : "portrait"
}

/**
 * Estimación barata de nitidez: varianza de Laplacian discreto en escala de grises.
 * Documentado: requiere píxeles (sharp); sin sharp se omite.
 */
function approxBlurAndContrast(gray: Buffer, width: number, height: number): {
  blur: number
  contrast: number
  mean: number
} {
  if (width < 3 || height < 3 || gray.length < width * height) {
    return { blur: 0, contrast: 0, mean: 0 }
  }
  let sum = 0
  let sumSq = 0
  let n = 0
  let lapSum = 0
  let lapSumSq = 0
  let lapN = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const v = gray[i] ?? 0
      sum += v
      sumSq += v * v
      n++
      const left = gray[i - 1] ?? 0
      const right = gray[i + 1] ?? 0
      const up = gray[i - width] ?? 0
      const down = gray[i + width] ?? 0
      const lap = Math.abs(4 * v - left - right - up - down)
      lapSum += lap
      lapSumSq += lap * lap
      lapN++
    }
  }
  if (n === 0 || lapN === 0) return { blur: 0, contrast: 0, mean: 0 }
  const mean = sum / n
  const variance = Math.max(0, sumSq / n - mean * mean)
  const lapMean = lapSum / lapN
  const lapVar = Math.max(0, lapSumSq / lapN - lapMean * lapMean)
  return { blur: lapVar, contrast: Math.sqrt(variance), mean }
}

function headerOnlyDiagnosis(
  image_id: string,
  buf: Buffer,
): ImageQualityDiagnosis {
  const notes: string[] = ["blur_omitted_no_pixel_decode"]
  const dims = jpegDimensions(buf) ?? pngDimensions(buf)
  if (!dims) {
    return {
      image_id,
      available: buf.length > 32,
      orientation: "unknown",
      exposure: "unknown",
      notes: [...notes, "dimensions_unavailable_header_parse"],
    }
  }
  if (dims.width < 200 || dims.height < 200) notes.push("low_resolution")
  // Heurística vacía: buffer muy pequeño relativo a resolución declarada.
  const expectedMin = Math.max(200, (dims.width * dims.height) / 200)
  if (buf.length < expectedMin) notes.push("possible_empty_or_truncated")

  return {
    image_id,
    available: true,
    width: dims.width,
    height: dims.height,
    orientation: orientationOf(dims.width, dims.height),
    exposure: "unknown",
    notes,
  }
}

export async function diagnoseImageQuality(
  image: MultimodalArtsImageInput,
): Promise<ImageQualityDiagnosis> {
  const notes: string[] = []
  const { buf, isUrl } = stripDataUrl(image.base64)

  if (isUrl) {
    return {
      image_id: image.image_id,
      available: true,
      orientation: "unknown",
      exposure: "unknown",
      notes: ["url_reference_skipped_pixel_analysis"],
    }
  }

  if (!buf) {
    return {
      image_id: image.image_id,
      available: false,
      orientation: "unknown",
      exposure: "unknown",
      notes: ["image_unavailable_or_invalid_base64"],
    }
  }

  const sharp = await loadSharp()
  if (!sharp) {
    return headerOnlyDiagnosis(image.image_id, buf)
  }

  try {
    const meta = await sharp(buf, { failOn: "none" }).metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    const orientation = orientationOf(width, height)

    if (width > 0 && height > 0 && (width < 200 || height < 200)) {
      notes.push("low_resolution")
    }
    if (buf.length < 64) notes.push("image_empty_or_tiny")

    const maxEdge = 320
    const scale =
      width > 0 && height > 0
        ? Math.min(1, maxEdge / Math.max(width, height))
        : 1
    const tw = Math.max(1, Math.round(width * scale))
    const th = Math.max(1, Math.round(height * scale))

    const { data, info } = await sharp(buf, { failOn: "none" })
      .resize(tw, th, { fit: "inside" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const { blur, contrast, mean } = approxBlurAndContrast(
      data,
      info.width,
      info.height,
    )

    let exposure: ImageQualityDiagnosis["exposure"] = "ok"
    if (mean < 45) {
      exposure = "underexposed"
      notes.push("underexposed")
    } else if (mean > 210) {
      exposure = "overexposed"
      notes.push("overexposed")
    }

    if (blur < 80) notes.push("possible_blur")
    if (contrast < 18) notes.push("low_contrast")

    // Contraste ~0 y luminancia extrema → posible imagen vacía/uniforme.
    if (contrast < 4 && (mean < 20 || mean > 235)) {
      notes.push("possible_blank_image")
    }

    return {
      image_id: image.image_id,
      available: true,
      width,
      height,
      orientation,
      blur_score: Math.round(blur * 100) / 100,
      contrast_score: Math.round(contrast * 100) / 100,
      exposure,
      notes,
    }
  } catch (e) {
    const fallback = headerOnlyDiagnosis(image.image_id, buf)
    return {
      ...fallback,
      notes: [
        ...fallback.notes,
        `sharp_decode_failed:${e instanceof Error ? e.message : "unknown"}`,
      ],
    }
  }
}

export async function diagnoseAllImages(
  images: MultimodalArtsImageInput[],
): Promise<ImageQualityDiagnosis[]> {
  const out: ImageQualityDiagnosis[] = []
  for (const img of images) {
    out.push(await diagnoseImageQuality(img))
  }
  return out
}

/** Si la calidad impide observar (informativo; no baja logro artístico). */
export function qualityBlocksObservation(d: ImageQualityDiagnosis): boolean {
  if (!d.available) return true
  if (d.notes.includes("image_empty_or_tiny")) return true
  if (d.notes.includes("possible_blank_image")) return true
  if (d.notes.includes("low_resolution") && (d.blur_score ?? 999) < 60) return true
  if ((d.blur_score ?? 999) < 40) return true
  if (d.exposure === "underexposed" && (d.contrast_score ?? 0) < 12) return true
  if (d.exposure === "overexposed" && (d.contrast_score ?? 0) < 12) return true
  return false
}
