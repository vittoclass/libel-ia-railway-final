/**
 * Adaptador de lectura OMR con microservicio (LEADTOOLS u OpenCV).
 * Llama a /api/omr/read-leadtools y devuelve resultados compatibles con compare.
 * Incluye omissions/doubleMarks/metadata cuando el microservicio los envía.
 */

import type { GridReadResult } from "@/app/lib/omr-libelia-reader"

export type ReadOMRExternalResponse = {
  results: GridReadResult[]
  omissions?: number[]
  doubleMarks?: number[]
  metadata?: { engine?: string; processingTimeMs?: number; flatScoresDetected?: boolean }
}

/**
 * Envía la imagen al proxy y devuelve resultados + metadatos (omissions, doubleMarks, engine).
 */
export async function readOMRWithLeadtools(
  imageDataUrl: string,
  numQuestions: number,
  optionLabels: string[],
  templateId?: string | null
): Promise<ReadOMRExternalResponse> {
  if (process.env.NODE_ENV === "development") {
    console.log("[LEADTOOLS_READER] iniciando lectura", {
      numQuestions,
      optionLabels,
      templateId: templateId ?? "none",
    })
  }

  let base64 = imageDataUrl
  if (base64.includes("base64,")) {
    base64 = base64.split("base64,")[1] ?? base64
  }

  const body: {
    imageBase64: string
    numQuestions: number
    optionLabels: string[]
    templateId?: string
  } = {
    imageBase64: base64,
    numQuestions,
    optionLabels,
  }
  if (templateId) body.templateId = templateId

  const res = await fetch("/api/omr/read-leadtools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({ success: false, error: "Respuesta inválida del servidor." }))

  if (process.env.NODE_ENV === "development") {
    console.log("[LEADTOOLS_READER] respuesta recibida", {
      success: data?.success,
      resultsLength: Array.isArray(data?.results) ? data.results.length : 0,
      omissions: data?.omissions?.length,
      doubleMarks: data?.doubleMarks?.length,
      error: data?.error,
    })
  }

  if (!data.success) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : data.error != null
          ? String(data.error)
          : "Microservicio OMR devolvió error."
    if (process.env.NODE_ENV === "development") {
      console.error("[LEADTOOLS_READER] error", msg)
    }
    const err = new Error(msg)
    ;(err as Error & { code?: string }).code = "LEADTOOLS_OMR_ERROR"
    throw err
  }

  if (!Array.isArray(data.results)) {
    throw new Error("El microservicio no devolvió resultados en el formato esperado.")
  }

  return {
    results: data.results as GridReadResult[],
    omissions: Array.isArray(data.omissions) ? data.omissions : undefined,
    doubleMarks: Array.isArray(data.doubleMarks) ? data.doubleMarks : undefined,
    metadata: data.metadata,
  }
}
