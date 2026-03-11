/**
 * Detección de fiduciales ArUco y corrección de perspectiva para hoja LibelIA V2.
 * Solo se usa cuando la plantilla tiene sheetSpec === "libelia_standard_v2".
 * Reutiliza warpPerspectiveToDataUrl de sheet-perspective; no toca el flujo V1.
 */

import { warpPerspectiveToDataUrl } from "./sheet-perspective"
import type { QuadCorners } from "./sheet-perspective"
import { DICTIONARY_NAME } from "./omr-sheet-aruco"

const EXPECTED_IDS = [0, 1, 2, 3]

type ARDetector = { detect: (image: { width: number; height: number; data: Uint8ClampedArray }) => Array<{ id: number; corners: Array<{ x: number; y: number }> }> }
type ARType = { Detector: new (config?: { dictionaryName?: string }) => ARDetector }

function getAR(): ARType | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { AR?: ARType }
  if (w.AR) return w.AR
  return null
}

async function loadAR(): Promise<ARType> {
  const fromWindow = getAR()
  if (fromWindow) return fromWindow
  try {
    const mod = await import("js-aruco2")
    const AR = (mod as unknown as { AR?: ARType }).AR ?? (mod as unknown as { default?: { AR?: ARType } }).default?.AR
    if (AR) return AR
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    const w = window as unknown as { AR?: ARType }
    if (w.AR) return w.AR
  }
  throw new Error("No se pudo cargar js-aruco2 para detección de fiduciales.")
}

/**
 * Orden de esquinas de página: [tl, tr, br, bl].
 * Para cada marcador id 0..3, la esquina "interior" al contenido es la que apunta hacia el centro.
 * corners en js-aruco2: [0]=tl, [1]=tr, [2]=br, [3]=bl del marcador.
 * Marcador 0 (tl página) → interior = br del marcador = corners[2]
 * Marcador 1 (tr página) → interior = bl del marcador = corners[3]
 * Marcador 2 (br página) → interior = tl del marcador = corners[0]
 * Marcador 3 (bl página) → interior = tr del marcador = corners[1]
 */
const INNER_CORNER_INDEX = [2, 3, 0, 1] as const

function buildQuadFromMarkers(
  markers: Array<{ id: number; corners: Array<{ x: number; y: number }> }>
): QuadCorners | null {
  const byId = new Map<number, (typeof markers)[0]>()
  for (const m of markers) {
    if (EXPECTED_IDS.includes(m.id) && m.corners && m.corners.length >= 4) {
      byId.set(m.id, m)
    }
  }
  if (byId.size !== 4) return null
  const quad: QuadCorners = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ]
  for (let i = 0; i < 4; i++) {
    const m = byId.get(EXPECTED_IDS[i])
    if (!m) return null
    const c = m.corners[INNER_CORNER_INDEX[i]]
    quad[i] = [c.x, c.y]
  }
  return quad
}

/**
 * Detecta los 4 fiduciales ArUco (IDs 0,1,2,3), construye el cuadrilátero de esquinas interiores
 * y aplica la homografía para rectificar la hoja. Solo para hoja LibelIA V2.
 * Si falla la detección o no se encuentran los 4 marcadores, devuelve null (el llamador puede usar findSheetCornersAndWarp).
 */
export async function findSheetCornersFiducialAndWarp(
  dataUrl: string,
  templateAspectRatio: number
): Promise<{ correctedDataUrl: string; corners: QuadCorners; detectedCount: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = async () => {
      try {
        const w = img.width
        const h = img.height
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, w, h)

        const AR = await loadAR()
        const detector = new AR.Detector({ dictionaryName: DICTIONARY_NAME })
        const markers = detector.detect(imageData)
        const quad = buildQuadFromMarkers(markers)
        if (!quad) {
          resolve(null)
          return
        }

        const destWidth = Math.max(400, Math.round(w * 0.9))
        const destHeight = Math.round(destWidth / templateAspectRatio)

        const correctedDataUrl = await warpPerspectiveToDataUrl(
          dataUrl,
          quad,
          destWidth,
          destHeight
        )
        resolve({
          correctedDataUrl,
          corners: quad,
          detectedCount: 4,
        })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}
