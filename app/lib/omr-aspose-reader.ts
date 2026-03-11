/**
 * Adaptador de lectura OMR con Aspose.OMR Cloud.
 * Solo para el flujo robusto de hoja LibelIA. Llama a la API interna /api/omr/recognize-aspose.
 * Si Aspose no está configurado o falla, el llamador debe usar readLibelIASheetFromImage como fallback.
 */

import type { GridReadResult } from "@/app/lib/omr-libelia-reader"

/**
 * Envía la imagen de la hoja al motor Aspose.OMR Cloud (vía API interna) y devuelve resultados en formato LibelIA.
 * @param imageDataUrl - Data URL de la imagen (ej. de canvas.toDataURL("image/jpeg")) o base64 puro
 * @param numQuestions - Número de preguntas (debe coincidir con la plantilla Aspose)
 * @param optionLabels - Etiquetas de opciones, ej. ["A","B","C","D"]
 * @param omrBase64 - Opcional: contenido .omr en base64 (p. ej. de la plantilla LibelIA). Si no se pasa, la API usará el valor de env.
 * @returns GridReadResult[] compatible con compare/review/retry-save
 * @throws Si la API devuelve success: false o hay error de red (el llamador puede usar el lector de respaldo).
 */
export async function readOMRWithAspose(
  imageDataUrl: string,
  numQuestions: number,
  optionLabels: string[],
  omrBase64?: string | null
): Promise<GridReadResult[]> {
  let base64 = imageDataUrl
  if (base64.includes("base64,")) {
    base64 = base64.split("base64,")[1] ?? base64
  }

  const body: { imageBase64: string; numQuestions: number; optionLabels: string[]; omrBase64?: string } = {
    imageBase64: base64,
    numQuestions,
    optionLabels,
  }
  if (omrBase64) body.omrBase64 = omrBase64

  const res = await fetch("/api/omr/recognize-aspose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({ success: false, error: "Respuesta inválida del servidor." }))

  if (!data.success) {
    const msg = data.error ?? "Error desconocido al leer con Aspose OMR."
    const err = new Error(msg)
    ;(err as Error & { code?: string }).code = "ASPOSE_OMR_ERROR"
    throw err
  }

  if (!Array.isArray(data.results)) {
    throw new Error("Aspose OMR no devolvió resultados en el formato esperado.")
  }

  return data.results as GridReadResult[]
}
