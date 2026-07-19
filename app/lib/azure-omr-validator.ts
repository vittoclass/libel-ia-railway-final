/**
 * Validador opcional con Azure Document Intelligence para OMR.
 * Solo apoyo: validar calidad de captura y detección de selection marks.
 * NO se usa para calcular nota ni para compare. Solo para decisión de "recaptura" vs "revisar calibración".
 * Requiere: AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, AZURE_DOCUMENT_INTELLIGENCE_KEY,
 *           AZURE_OMR_VALIDATION_ENABLED=true (opcional).
 */
import { recordAzureDiCostAuditShadow } from "@/app/lib/cost-audit/recordAzureDiCostAuditShadow"

export type AzureOmrValidationResult = {
  hasSelectionMarks: boolean
  selectionMarkCount?: number
  qualityWarning?: string
  provider: "azure-document-intelligence"
}

const LOG_PREFIX = "[AZURE_OMR]"

function log(msg: string, data?: Record<string, unknown>) {
  if (data) {
    console.log(LOG_PREFIX, msg, data)
  } else {
    console.log(LOG_PREFIX, msg)
  }
}

function isValidationEnabled(): boolean {
  if (typeof process === "undefined" || !process.env) return false
  const v = process.env.AZURE_OMR_VALIDATION_ENABLED
  return v === "true" || v === "1"
}

function getConfig(): { endpoint: string; key: string; model: string } | null {
  if (typeof process === "undefined" || !process.env) return null
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim()
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim()
  if (!endpoint || !key) return null
  const model =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL?.trim() || "prebuilt-layout"
  return { endpoint: endpoint.replace(/\/$/, ""), key, model }
}

/**
 * Llama a Azure Document Intelligence (Layout) para analizar el documento
 * y extraer selection marks. Operación asíncrona: POST analyze → poll getResult.
 */
export async function validateWithAzure(
  imageBase64: string
): Promise<AzureOmrValidationResult> {
  const config = getConfig()
  if (!config) {
    return {
      hasSelectionMarks: false,
      qualityWarning: "Azure Document Intelligence no configurado.",
      provider: "azure-document-intelligence",
    }
  }

  log("validation started")

  let buffer: Buffer
  try {
    const b64 = imageBase64.includes("base64,")
      ? imageBase64.split("base64,")[1] ?? imageBase64
      : imageBase64
    buffer = Buffer.from(b64, "base64")
  } catch {
    log("validation result", { error: "invalid_base64" })
    return {
      hasSelectionMarks: false,
      qualityWarning: "Imagen base64 inválida.",
      provider: "azure-document-intelligence",
    }
  }

  const analyzeUrl = `${config.endpoint}/documentintelligence/documentModels/${config.model}:analyze?api-version=2024-11-30`
  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": config.key,
    "Content-Type": "application/octet-stream",
  }

  try {
    const t0 = Date.now()
    const initRes = await fetch(analyzeUrl, {
      method: "POST",
      headers,
      body: new Uint8Array(buffer),
    })

    if (initRes.status !== 202) {
      const errText = await initRes.text()
      log("validation result", { status: initRes.status, error: errText.slice(0, 200) })
      return {
        hasSelectionMarks: false,
        qualityWarning: `Azure respondió ${initRes.status}.`,
        provider: "azure-document-intelligence",
      }
    }

    const operationLocation = initRes.headers.get("Operation-Location")
    if (!operationLocation) {
      log("validation result", { error: "no_operation_location" })
      return {
        hasSelectionMarks: false,
        qualityWarning: "Respuesta Azure sin Operation-Location.",
        provider: "azure-document-intelligence",
      }
    }

    const resultUrl = operationLocation
    const maxAttempts = 30
    const delayMs = 1000
    let result: AnalyzeResult | null = null

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, delayMs))
      const res = await fetch(resultUrl, {
        method: "GET",
        headers: { "Ocp-Apim-Subscription-Key": config.key },
      })
      const data = (await res.json()) as { status?: string; result?: AnalyzeResult }
      if (data.status === "succeeded" && data.result) {
        result = data.result
        break
      }
      if (data.status === "failed") {
        log("validation result", { status: "failed", data })
        return {
          hasSelectionMarks: false,
          qualityWarning: "Análisis Azure falló.",
          provider: "azure-document-intelligence",
        }
      }
    }

    if (!result) {
      log("validation result", { error: "timeout" })
      return {
        hasSelectionMarks: false,
        qualityWarning: "Tiempo de espera del análisis Azure agotado.",
        provider: "azure-document-intelligence",
      }
    }

    const selectionMarkCount = countSelectionMarks(result)
    const hasSelectionMarks = selectionMarkCount > 0
    if (hasSelectionMarks) {
      log("selection marks detected", { count: selectionMarkCount })
    }

    let qualityWarning: string | undefined
    if (result.pages?.length === 0) {
      qualityWarning = "Azure no detectó páginas en el documento."
      log("quality warning", { reason: "no_pages" })
    } else if (!hasSelectionMarks && (result.pages?.length ?? 0) > 0) {
      qualityWarning = "Azure no detectó selection marks (burbujas) en la hoja."
      log("quality warning", { reason: "no_selection_marks" })
    }

    log("validation result", {
      hasSelectionMarks,
      selectionMarkCount,
      qualityWarning: qualityWarning ?? undefined,
    })

    recordAzureDiCostAuditShadow({
      operation: "omr_validation_azure_layout",
      model: config.model === "prebuilt-read" ? "prebuilt-read" : "prebuilt-layout",
      pagesProcessed: result.pages?.length ?? 1,
      filesProcessed: 1,
      durationMs: Date.now() - t0,
    })

    return {
      hasSelectionMarks,
      selectionMarkCount,
      qualityWarning,
      provider: "azure-document-intelligence",
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log("validation result", { error: message })
    return {
      hasSelectionMarks: false,
      qualityWarning: `Error de conexión con Azure: ${message}`,
      provider: "azure-document-intelligence",
    }
  }
}

type AnalyzeResult = {
  pages?: Array<{
    selectionMarks?: Array<{ state?: string }>
  }>
}

function countSelectionMarks(result: AnalyzeResult): number {
  let n = 0
  for (const page of result.pages ?? []) {
    n += page.selectionMarks?.length ?? 0
  }
  return n
}

export function isAzureOmrValidationAvailable(): boolean {
  return isValidationEnabled() && getConfig() !== null
}
