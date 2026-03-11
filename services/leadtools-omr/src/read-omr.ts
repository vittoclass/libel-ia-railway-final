/**
 * Handler POST /read-omr.
 * - Si LEADTOOLS_MOCK=true → solo mock, logs mockActive. No lectura real.
 * - Si no → intenta motor real; si no está implementado, devuelve error claro.
 * NO hay mock oculto cuando el motor real falla.
 */
import type { ReadOmrRequest, ReadOmrSuccessResponse, ReadOmrErrorResponse } from "./contract"

const MOCK_ENV = process.env.LEADTOOLS_MOCK === "true" || process.env.LEADTOOLS_MOCK === "1"
const MOCK_FALLBACK_ENV = process.env.LEADTOOLS_MOCK_FALLBACK === "true" || process.env.LEADTOOLS_MOCK_FALLBACK === "1"

function mockResults(numQuestions: number, optionLabels: string[]): ReadOmrSuccessResponse["results"] {
  const opts = optionLabels.length ? optionLabels : ["A", "B", "C", "D"]
  const results: ReadOmrSuccessResponse["results"] = []
  for (let q = 1; q <= numQuestions; q++) {
    const idx = (q - 1) % opts.length
    results.push({
      pregunta: q,
      respuesta: opts[idx] ?? "A",
      confianza: 0.92 + Math.random() * 0.06,
    })
  }
  return results
}

/**
 * Motor real de lectura OMR.
 * Reemplazar el cuerpo de esta función cuando el SDK LEADTOOLS esté instalado y licenciado.
 * Entrada: imageBuffer (Buffer), request (templateId, numQuestions, optionLabels).
 * Salida: results[] con { pregunta, respuesta, confianza } o lanzar error.
 */
function runRealOmrEngine(
  imageBuffer: Buffer,
  request: ReadOmrRequest
): ReadOmrSuccessResponse {
  // ——— PUNTO EXACTO DE CONEXIÓN CON LEADTOOLS OMR ———
  // 1. Añadir dependencia: npm install leadtools (o el paquete OMR específico de LEADTOOLS para Node).
  // 2. Configurar licencia: LEADTOOLS requiere archivo de licencia o setRuntimeLicense().
  // 3. En este archivo: importar el SDK, cargar plantilla por request.templateId,
  //    llamar al reconocimiento con imageBuffer, mapear salida a results[].
  //
  // Ejemplo de firma cuando esté conectado:
  // const recognitionResult = await leadtoolsOmr.recognize(imageBuffer, { templateId: request.templateId, ... })
  // return { success: true, results: mapToContract(recognitionResult), omissions: [], doubleMarks: [], metadata: { engine: "leadtools", processingTimeMs } }

  throw new Error("Motor real no implementado todavía")
}

export function handleReadOmr(body: ReadOmrRequest): ReadOmrSuccessResponse | ReadOmrErrorResponse {
  const start = Date.now()
  const numQuestions = Math.max(1, Math.min(200, body.numQuestions || 40))
  const optionLabels = Array.isArray(body.optionLabels) && body.optionLabels.length > 0
    ? body.optionLabels
    : ["A", "B", "C", "D"]

  // Mock solo si está explícitamente activado
  if (MOCK_ENV) {
    console.log("[LEADTOOLS_SERVICE] mockActive (LEADTOOLS_MOCK=true)")
    const results = mockResults(numQuestions, optionLabels)
    const processingTimeMs = Date.now() - start
    console.log("[LEADTOOLS_SERVICE] resultados mock generados", { total: results.length, processingTimeMs })
    return {
      success: true,
      results,
      omissions: [],
      doubleMarks: [],
      metadata: { engine: "leadtools-mock", processingTimeMs },
    }
  }

  // ——— Camino real (sin mock) ———
  if (!body.imageBase64 || typeof body.imageBase64 !== "string") {
    console.error("[LEADTOOLS_SERVICE] error: falta imageBase64")
    return { success: false, error: "Falta imageBase64 en la petición." }
  }

  const imageBuffer = Buffer.from(body.imageBase64, "base64")
  if (imageBuffer.length === 0) {
    console.error("[LEADTOOLS_SERVICE] error: imagen base64 inválida")
    return { success: false, error: "Imagen base64 inválida." }
  }

  console.log("[LEADTOOLS_SERVICE] realImageProcessingStarted", {
    templateId: body.templateId,
    numQuestions,
    imageBytes: imageBuffer.length,
  })

  try {
    const result = runRealOmrEngine(imageBuffer, body)
    const processingTimeMs = Date.now() - start
    console.log("[LEADTOOLS_SERVICE] realImageProcessingFinished", {
      success: true,
      resultsCount: result.results.length,
      processingTimeMs,
    })
    return { ...result, metadata: { ...result.metadata, processingTimeMs } }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.log("[LEADTOOLS_SERVICE] realImageProcessingFinished", { success: false, error: message })
    console.error("[LEADTOOLS_SERVICE] motor real no disponible:", message)

    if (MOCK_FALLBACK_ENV) {
      console.log("[LEADTOOLS_SERVICE] mockFallbackUsed (LEADTOOLS_MOCK_FALLBACK=true)")
      const results = mockResults(numQuestions, optionLabels)
      const processingTimeMs = Date.now() - start
      return {
        success: true,
        results,
        omissions: [],
        doubleMarks: [],
        metadata: { engine: "leadtools-mock-fallback", processingTimeMs },
      }
    }

    return {
      success: false,
      error: message,
    }
  }
}
