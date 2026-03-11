/**
 * Lectura OMR por coordenadas conocidas de la hoja estándar LibelIA.
 * Usa getBubblePositions() y la geometría de omr-sheet-spec.ts.
 * Solo para el flujo de plantilla superpuesta (hoja LibelIA). No reemplaza omr-grid-reader.
 */

import {
  getBubblePositions,
  PAGE_WIDTH_MM,
  PAGE_HEIGHT_MM,
  BUBBLE_RADIUS_MM,
  INNER_LEFT_MM,
  INNER_TOP_MM,
  INNER_WIDTH_MM,
  HEADER_HEIGHT_MM,
  ROW_HEIGHT_MM,
} from "./omr-sheet-spec"

export type GridReadResult = {
  pregunta: number
  respuesta: string
  confianza: number
}

// ——— Calibración automática: papel y umbral dinámico ———
/** Número de zonas de fondo (papel) que se muestrean para estimar la intensidad base. */
export const PAPER_SAMPLE_COUNT = 8
/** Resta a la intensidad media del papel para obtener el umbral "marcada". Ej.: paperMean - 40. */
export const OFFSET_OSCURIDAD = 40
/** Umbral mínimo absoluto (gris) para no bajar demasiado en fotos muy oscuras. */
export const MIN_THRESHOLD = 80
/** Margen por debajo del umbral: si la burbuja más oscura está en (dynamicThreshold - DELTA_DUDA, dynamicThreshold] se considera dudosa. */
export const DELTA_DUDA = 15
/** Diferencia máxima de la segunda burbuja respecto al umbral para contar como doble marca (0 = debe estar también por debajo del umbral). */
export const DELTA_DOBLE = 0

// ——— Reglas de decisión (constantes documentadas) ———
/** Intensidad máxima (gris) fija como fallback si la estimación de papel falla. */
export const UMBRAL_OSCURIDAD_FALLBACK = 180
/** Diferencia mínima entre la opción más oscura y la segunda para considerar la respuesta "clara" (no dudosa). */
export const DELTA_MINIMO_CLARA = 25
/** Confianza cuando hay una sola opción marcada y delta >= DELTA_MINIMO_CLARA. */
export const CONFIANZA_MARCA_CLARA = 0.92
/** Confianza cuando hay una opción marcada pero delta < DELTA_MINIMO_CLARA o en banda dudosa. */
export const CONFIANZA_DUDOSA = 0.5
/** Confianza cuando no hay ninguna burbuja marcada (vacía). */
export const CONFIANZA_VACIA = 0.3

// ——— Lector híbrido: clasificación local por burbuja ———
/** Clasificación por burbuja (local, no solo umbral global). */
export type BubbleClass = "EMPTY" | "FILLED" | "UNCERTAIN"

/** Un píxel se considera "oscuro" si gray < localBackground - LOCAL_DARK_THRESHOLD. */
export const LOCAL_DARK_THRESHOLD = 25
/** Mínima fracción de píxeles oscuros en el círculo para clasificar FILLED. */
export const FILLED_DARK_RATIO_MIN = 0.25
/** Mínimo contraste (localBackground - meanGray) para FILLED. */
export const FILLED_CONTRAST_MIN = 20
/** Máxima fracción de píxeles oscuros para clasificar EMPTY. */
export const EMPTY_DARK_RATIO_MAX = 0.12
/** Máximo contraste para clasificar EMPTY. */
export const EMPTY_CONTRAST_MAX = 15

/**
 * Convierte coordenadas de la hoja (mm, página completa) a píxeles de la imagen.
 * La imagen rectificada es la hoja completa; el warp mapea el cuadrilátero detectado
 * a un rectángulo de dimensiones (imageWidth, imageHeight).
 */
function mmToPixel(
  cxMm: number,
  cyMm: number,
  imageWidth: number,
  imageHeight: number
): { px: number; py: number } {
  const px = (cxMm / PAGE_WIDTH_MM) * imageWidth
  const py = (cyMm / PAGE_HEIGHT_MM) * imageHeight
  return { px, py }
}

/** Posiciones en mm para muestreo del fondo (papel). Zonas en cabecera y entre filas. */
function getPaperSamplePositionsMm(): { x: number; y: number }[] {
  const startY = INNER_TOP_MM + HEADER_HEIGHT_MM
  return [
    { x: INNER_LEFT_MM + 25, y: INNER_TOP_MM + 14 },
    { x: INNER_LEFT_MM + INNER_WIDTH_MM - 25, y: INNER_TOP_MM + 14 },
    { x: INNER_LEFT_MM + 30, y: INNER_TOP_MM + 8 },
    { x: INNER_LEFT_MM + INNER_WIDTH_MM - 30, y: INNER_TOP_MM + 8 },
    { x: INNER_LEFT_MM + 20, y: startY + 1 },
    { x: INNER_LEFT_MM + INNER_WIDTH_MM / 2 - 12, y: startY + 1 },
    { x: INNER_LEFT_MM + INNER_WIDTH_MM / 2 + 12, y: startY + 1 },
    { x: INNER_LEFT_MM + INNER_WIDTH_MM - 20, y: startY + ROW_HEIGHT_MM + 1 },
  ]
}

/**
 * Promedia la intensidad (gris) en un círculo de centro (cx, cy) y radio radiusPx.
 */
function sampleCircleGray(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): number {
  const x0 = Math.max(0, Math.floor(cx - radiusPx))
  const y0 = Math.max(0, Math.floor(cy - radiusPx))
  const x1 = Math.min(width, Math.ceil(cx + radiusPx))
  const y1 = Math.min(height, Math.ceil(cy + radiusPx))
  let sum = 0
  let count = 0
  const r2 = radiusPx * radiusPx
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r2) {
        const i = (y * width + x) * 4
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        sum += 0.299 * r + 0.587 * g + 0.114 * b
        count++
      }
    }
  }
  return count > 0 ? sum / count : 255
}

/**
 * Promedia la intensidad (gris) en un anillo [rInner, rOuter] centrado en (cx, cy).
 * Sirve para estimar el fondo local junto a cada burbuja.
 */
function sampleAnnulusGray(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number
): number {
  const x0 = Math.max(0, Math.floor(cx - rOuter))
  const y0 = Math.max(0, Math.floor(cy - rOuter))
  const x1 = Math.min(width, Math.ceil(cx + rOuter))
  const y1 = Math.min(height, Math.ceil(cy + rOuter))
  let sum = 0
  let count = 0
  const rInner2 = rInner * rInner
  const rOuter2 = rOuter * rOuter
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx
      const dy = y - cy
      const d2 = dx * dx + dy * dy
      if (d2 >= rInner2 && d2 <= rOuter2) {
        const i = (y * width + x) * 4
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        sum += 0.299 * r + 0.587 * g + 0.114 * b
        count++
      }
    }
  }
  return count > 0 ? sum / count : 255
}

export type BubbleMetrics = {
  meanGray: number
  localBackground: number
  darkRatio: number
  contrast: number
}

/**
 * Analiza un parche local alrededor del centro de la burbuja.
 * Devuelve métricas para clasificación local (no solo umbral global).
 */
function analyzeBubblePatch(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): BubbleMetrics {
  const meanGray = sampleCircleGray(data, width, height, cx, cy, radiusPx)
  const rInner = radiusPx
  const rOuter = Math.max(radiusPx + 2, radiusPx * 2)
  const localBackground = sampleAnnulusGray(
    data,
    width,
    height,
    cx,
    cy,
    rInner,
    rOuter
  )
  const contrast = localBackground - meanGray
  const darkThreshold = Math.max(0, localBackground - LOCAL_DARK_THRESHOLD)
  let darkCount = 0
  let totalCount = 0
  const x0 = Math.max(0, Math.floor(cx - radiusPx))
  const y0 = Math.max(0, Math.floor(cy - radiusPx))
  const x1 = Math.min(width, Math.ceil(cx + radiusPx))
  const y1 = Math.min(height, Math.ceil(cy + radiusPx))
  const r2 = radiusPx * radiusPx
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r2) {
        totalCount++
        const i = (y * width + x) * 4
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        if (gray <= darkThreshold) darkCount++
      }
    }
  }
  const darkRatio = totalCount > 0 ? darkCount / totalCount : 0
  return { meanGray, localBackground, darkRatio, contrast }
}

/**
 * Clasifica una burbuja a partir de métricas locales (heurística clara, sin ML).
 */
function classifyBubble(metrics: BubbleMetrics): BubbleClass {
  const { darkRatio, contrast } = metrics
  if (
    darkRatio >= FILLED_DARK_RATIO_MIN &&
    contrast >= FILLED_CONTRAST_MIN
  ) {
    return "FILLED"
  }
  if (
    darkRatio <= EMPTY_DARK_RATIO_MAX &&
    contrast <= EMPTY_CONTRAST_MAX
  ) {
    return "EMPTY"
  }
  return "UNCERTAIN"
}

/** Radio en mm para muestreo del papel (zonas pequeñas de fondo). */
const PAPER_SAMPLE_RADIUS_MM = 1.5

/**
 * Estima la intensidad media del papel muestreando zonas de fondo (cabecera, entre filas).
 */
function getPaperMean(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
  radiusPx: number
): number {
  const positions = getPaperSamplePositionsMm()
  let sum = 0
  let count = 0
  const sampleRadiusPx = Math.max(2, PAPER_SAMPLE_RADIUS_MM * scale)
  for (const { x, y } of positions) {
    const { px, py } = mmToPixel(x, y, width, height)
    const gray = sampleCircleGray(data, width, height, px, py, sampleRadiusPx)
    sum += gray
    count++
  }
  return count > 0 ? sum / count : 255
}

/**
 * Lee respuestas desde la imagen rectificada usando las posiciones exactas de la hoja LibelIA.
 * La imagen debe ser la hoja completa tras el warp (esquinas detectadas → rectángulo con templateAspectRatio).
 *
 * @param dataUrl - Imagen ya corregida (perspectiva)
 * @param numQuestions - Número de preguntas
 * @param optionLabels - Etiquetas de opciones (ej. ["A","B","C","D"] o ["A".."E"])
 * @returns Array compatible con readGridFromImage: { pregunta, respuesta, confianza }
 */
export function readLibelIASheetFromImage(
  dataUrl: string,
  numQuestions: number,
  optionLabels: string[]
): Promise<GridReadResult[]> {
  const numOptions = optionLabels.length
  const positions = getBubblePositions(numQuestions, numOptions)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Canvas no disponible"))
          return
        }
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, img.width, img.height)
        const data = imageData.data
        const width = img.width
        const height = img.height

        const scaleX = width / PAGE_WIDTH_MM
        const scaleY = height / PAGE_HEIGHT_MM
        const scale = Math.min(scaleX, scaleY)
        const radiusPx = Math.max(2, BUBBLE_RADIUS_MM * scale)

        // Lector híbrido: métricas y clasificación local por burbuja (no solo umbral global)
        const bubbleData = new Map<
          string,
          { metrics: BubbleMetrics; class: BubbleClass }
        >()
        for (const { q, optionIndex, cx, cy } of positions) {
          const { px, py } = mmToPixel(cx, cy, width, height)
          const metrics = analyzeBubblePatch(
            data,
            width,
            height,
            px,
            py,
            radiusPx
          )
          const bubbleClass = classifyBubble(metrics)
          bubbleData.set(`${q}-${optionIndex}`, { metrics, class: bubbleClass })
        }

        const results: GridReadResult[] = []
        for (let q = 1; q <= numQuestions; q++) {
          const optionResults: {
            optionIndex: number
            bubbleClass: BubbleClass
            meanGray: number
          }[] = []
          for (let o = 0; o < numOptions; o++) {
            const entry = bubbleData.get(`${q}-${o}`)
            const bubbleClass = entry?.class ?? "EMPTY"
            const meanGray = entry?.metrics.meanGray ?? 255
            optionResults.push({ optionIndex: o, bubbleClass, meanGray })
          }

          const filled = optionResults.filter((x) => x.bubbleClass === "FILLED")
          const uncertain = optionResults.filter(
            (x) => x.bubbleClass === "UNCERTAIN"
          )

          if (filled.length >= 2) {
            results.push({
              pregunta: q,
              respuesta: "DOBLE_MARCA",
              confianza: CONFIANZA_DUDOSA,
            })
          } else if (filled.length === 1) {
            const label = optionLabels[filled[0].optionIndex] ?? ""
            results.push({
              pregunta: q,
              respuesta: label,
              confianza: CONFIANZA_MARCA_CLARA,
            })
          } else if (filled.length === 0 && uncertain.length > 0) {
            const best = uncertain.sort((a, b) => a.meanGray - b.meanGray)[0]
            const label = optionLabels[best.optionIndex] ?? ""
            results.push({
              pregunta: q,
              respuesta: label,
              confianza: CONFIANZA_DUDOSA,
            })
          } else {
            results.push({
              pregunta: q,
              respuesta: "",
              confianza: CONFIANZA_VACIA,
            })
          }
        }
        resolve(results)
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error("Error al cargar la imagen"))
    img.src = dataUrl
  })
}

/**
 * Dibuja los círculos de lectura sobre la imagen (modo debug).
 * Colorea por clasificación local: verde=FILLED, rojo=EMPTY, amarillo=UNCERTAIN.
 * Muestra paperMean y threshold para referencia.
 */
export function drawBubbleDebugOverlay(
  canvas: HTMLCanvasElement,
  dataUrl: string,
  numQuestions: number,
  numOptions: number
): Promise<void> {
  const positions = getBubblePositions(numQuestions, numOptions)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Canvas no disponible"))
          return
        }
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        const width = canvas.width
        const height = canvas.height

        const scaleX = width / PAGE_WIDTH_MM
        const scaleY = height / PAGE_HEIGHT_MM
        const scale = Math.min(scaleX, scaleY)
        const radiusPx = Math.max(2, BUBBLE_RADIUS_MM * scale)

        const paperMean = getPaperMean(data, width, height, scale, radiusPx)
        const dynamicThreshold =
          Number.isFinite(paperMean) && paperMean > MIN_THRESHOLD + OFFSET_OSCURIDAD
            ? Math.max(MIN_THRESHOLD, paperMean - OFFSET_OSCURIDAD)
            : UMBRAL_OSCURIDAD_FALLBACK

        const bubbleData = new Map<
          string,
          { metrics: BubbleMetrics; class: BubbleClass }
        >()
        for (const { q, optionIndex, cx, cy } of positions) {
          const { px, py } = mmToPixel(cx, cy, width, height)
          const metrics = analyzeBubblePatch(
            data,
            width,
            height,
            px,
            py,
            radiusPx
          )
          bubbleData.set(`${q}-${optionIndex}`, {
            metrics,
            class: classifyBubble(metrics),
          })
        }

        const classColor: Record<BubbleClass, string> = {
          FILLED: "rgba(0, 180, 0, 0.6)",
          EMPTY: "rgba(220, 0, 0, 0.5)",
          UNCERTAIN: "rgba(220, 200, 0, 0.6)",
        }
        ctx.lineWidth = 2
        for (const { q, optionIndex, cx, cy } of positions) {
          const { px, py } = mmToPixel(cx, cy, width, height)
          const entry = bubbleData.get(`${q}-${optionIndex}`)
          const bubbleClass = entry?.class ?? "EMPTY"
          ctx.strokeStyle = classColor[bubbleClass]
          ctx.beginPath()
          ctx.arc(px, py, radiusPx, 0, Math.PI * 2)
          ctx.stroke()
        }

        ctx.font = "14px sans-serif"
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)"
        ctx.fillRect(8, 8, 260, 58)
        ctx.fillStyle = "rgb(200, 255, 200)"
        ctx.fillText(`paperMean: ${paperMean.toFixed(0)}`, 12, 26)
        ctx.fillText(`threshold (ref): ${dynamicThreshold.toFixed(0)}`, 12, 42)
        ctx.fillText("Verde=FILLED Rojo=EMPTY Amarillo=UNCERTAIN", 12, 56)
        resolve()
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error("Error al cargar la imagen"))
    img.src = dataUrl
  })
}
