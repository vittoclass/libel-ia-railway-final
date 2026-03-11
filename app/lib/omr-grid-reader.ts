/**
 * Lectura OMR por posición (grid paramétrico) en el cliente.
 * Solo burbujas: celda más oscura = opción marcada.
 * No modifica backend ni APIs.
 */

const OPTIONS = ["A", "B", "C", "D"]
const DEFAULT_MARK_THRESHOLD = 180
const MIN_CONFIDENCE_DELTA = 20

export type GridReadResult = {
  pregunta: number
  respuesta: string
  confianza: number
}

export type GridReaderParams = {
  totalPreguntas: number
  columnas: number
  opciones: string[]
  markThreshold?: number
}

/**
 * Lee respuestas desde una imagen capturada usando un grid paramétrico.
 * Layout: columnas de preguntas (ej. 2), cada fila tiene N preguntas (una por columna), cada pregunta tiene opciones.length celdas.
 * Celda más oscura por pregunta = opción marcada (burbuja).
 */
export async function readGridFromImage(
  dataUrl: string,
  templateAspectRatio: number,
  params: GridReaderParams
): Promise<GridReadResult[]> {
  const { totalPreguntas, columnas, opciones } = params
  const markThreshold = params.markThreshold ?? DEFAULT_MARK_THRESHOLD
  const numRows = Math.ceil(totalPreguntas / columnas)
  const numCols = columnas * opciones.length

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Canvas no disponible"))
          return
        }
        const w = img.width
        const h = img.height
        const imgAspect = w / h
        let drawW = w
        let drawH = h
        let sx = 0
        let sy = 0
        if (imgAspect > templateAspectRatio) {
          drawW = h * templateAspectRatio
          sx = (w - drawW) / 2
        } else {
          drawH = w / templateAspectRatio
          sy = (h - drawH) / 2
        }
        canvas.width = drawW
        canvas.height = drawH
        ctx.drawImage(img, sx, sy, drawW, drawH, 0, 0, drawW, drawH)
        const imageData = ctx.getImageData(0, 0, drawW, drawH)
        const data = imageData.data

        const cellW = drawW / numCols
        const cellH = drawH / numRows
        const results: GridReadResult[] = []

        for (let q = 1; q <= totalPreguntas; q++) {
          const rowIndex = Math.floor((q - 1) / columnas)
          const colBase = ((q - 1) % columnas) * opciones.length
          const intensities: number[] = []
          for (let o = 0; o < opciones.length; o++) {
            const cx = (colBase + o + 0.5) * cellW
            const cy = (rowIndex + 0.5) * cellH
            const x0 = Math.max(0, Math.floor(cx - cellW / 4))
            const y0 = Math.max(0, Math.floor(cy - cellH / 4))
            const x1 = Math.min(drawW, Math.ceil(cx + cellW / 4))
            const y1 = Math.min(drawH, Math.ceil(cy + cellH / 4))
            let sum = 0
            let count = 0
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const i = (y * drawW + x) * 4
                const r = data[i]
                const g = data[i + 1]
                const b = data[i + 2]
                const gray = 0.299 * r + 0.587 * g + 0.114 * b
                sum += gray
                count++
              }
            }
            intensities.push(count > 0 ? sum / count : 255)
          }
          const minVal = Math.min(...intensities)
          const minIdx = intensities.indexOf(minVal)
          const isMarked = minVal <= markThreshold
          const secondMin = [...intensities].sort((a, b) => a - b)[1]
          const delta = secondMin - minVal
          const confianza = isMarked ? Math.min(1, 0.5 + delta / 200) : 0.3
          results.push({
            pregunta: q,
            respuesta: isMarked ? opciones[minIdx] ?? "" : "",
            confianza,
          })
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
