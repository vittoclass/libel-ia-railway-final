/**
 * Generación de imágenes de marcadores ArUco para la hoja LibelIA V2.
 * Usa el mismo diccionario (ARUCO_MIP_36h12) que el detector en sheet-perspective-fiducial.
 * Solo cliente; se usa al generar el PDF de la variante libelia_standard_v2.
 */

const LIBELIA_ARUCO_MARKER_IDS = [0, 1, 2, 3] as const
const DICTIONARY_NAME = "ARUCO_MIP_36h12"
/** Tamaño en píxeles del canvas para cada marcador (después se escala en PDF por MARKER_SIZE_MM). */
const MARKER_PX = 120

type ARType = {
  Dictionary: new (name: string) => { generateSVG: (id: number) => string }
}

function getAR(): ARType | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { AR?: ARType }
  if (w.AR) return w.AR
  return null
}

/**
 * Carga js-aruco2 de forma lazy y devuelve AR (Dictionary). En Next puede estar en el módulo.
 */
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
  throw new Error("No se pudo cargar js-aruco2 para generar marcadores ArUco.")
}

/**
 * Convierte una cadena SVG en data URL de imagen PNG vía canvas.
 */
function svgToPngDataUrl(svgString: string, sizePx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = sizePx
      canvas.height = sizePx
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error("Canvas 2d no disponible"))
        return
      }
      ctx.fillStyle = "white"
      ctx.fillRect(0, 0, sizePx, sizePx)
      ctx.drawImage(img, 0, 0, sizePx, sizePx)
      const dataUrl = canvas.toDataURL("image/png")
      URL.revokeObjectURL(url)
      resolve(dataUrl)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Error al cargar SVG del marcador"))
    }
    img.src = url
  })
}

/**
 * Devuelve 4 data URLs (PNG) de los marcadores ArUco con IDs 0, 1, 2, 3 en orden tl, tr, br, bl.
 * Solo ejecutar en cliente (generación de PDF V2).
 */
export async function getLibelIAArUcoMarkerDataUrls(): Promise<string[]> {
  const AR = await loadAR()
  const dictionary = new AR.Dictionary(DICTIONARY_NAME)
  const urls: string[] = []
  for (const id of LIBELIA_ARUCO_MARKER_IDS) {
    const svg = dictionary.generateSVG(id)
    const dataUrl = await svgToPngDataUrl(svg, MARKER_PX)
    urls.push(dataUrl)
  }
  return urls
}

export { LIBELIA_ARUCO_MARKER_IDS, DICTIONARY_NAME }
