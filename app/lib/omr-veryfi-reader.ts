/**
 * Adaptador frontend para lectura OMR vía Veryfi.
 * Llama a /api/omr/read-veryfi y devuelve resultados compatibles con compare.
 * NO expone credenciales; todo pasa por el backend.
 */

import type { GridReadResult } from "@/app/lib/omr-libelia-reader"

export type ReadOMRVeryfiResponse = {
  results: GridReadResult[]
  omissions?: number[]
  doubleMarks?: number[]
  metadata?: { engine?: string; processingTimeMs?: number }
}

export async function readOMRWithVeryfi(
  imageDataUrl: string,
  numQuestions: number,
  optionLabels: string[],
  templateId?: string | null
): Promise<ReadOMRVeryfiResponse> {
  if (process.env.NODE_ENV === "development") {
    console.log("[VERYFI_READER] iniciando lectura", {
      numQuestions,
      optionLabels: optionLabels?.length,
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

  const res = await fetch("/api/omr/read-veryfi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({ success: false, error: "Respuesta inválida del servidor." }))

  if (process.env.NODE_ENV === "development") {
    console.log("[VERYFI_READER] respuesta recibida", {
      success: data?.success,
      hasRawVeryfiResponse: !!data?.rawVeryfiResponse,
      resultsLength: Array.isArray(data?.results) ? data.results.length : 0,
      error: data?.error,
    })
    if (data?.rawVeryfiResponse) {
      console.log("[VERYFI_READER] rawVeryfiResponse (inspección)", data.rawVeryfiResponse)
    }
  }

  if (!data.success) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : data.error != null
          ? String(data.error)
          : "Veryfi devolvió error."
    if (process.env.NODE_ENV === "development") {
      console.error("[VERYFI_READER] error", msg)
    }
    const err = new Error(msg)
    ;(err as Error & { code?: string }).code = "VERYFI_OMR_ERROR"
    throw err
  }

  if (!Array.isArray(data.results)) {
    if (data.rawVeryfiResponse) {
      throw new Error(
        "Modo inspección: Veryfi devolvió respuesta cruda (rawVeryfiResponse). Revisa consola del navegador y logs del servidor [VERYFI] para ver la estructura. Fallback a LibelIA."
      )
    }
    throw new Error("Veryfi no devolvió resultados en el formato esperado.")
  }

  return {
    results: data.results as GridReadResult[],
    omissions: Array.isArray(data.omissions) ? data.omissions : undefined,
    doubleMarks: Array.isArray(data.doubleMarks) ? data.doubleMarks : undefined,
    metadata: data.metadata,
  }
}
