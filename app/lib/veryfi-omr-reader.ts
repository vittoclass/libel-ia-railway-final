/**
 * Cliente backend para Veryfi API (Process Document).
 * Lee credenciales desde process.env; NO expone nada al frontend.
 * Endpoint: POST https://api.veryfi.com/api/v8/partner/documents
 */

const VERYFI_API_BASE = "https://api.veryfi.com"
const ENDPOINT = `${VERYFI_API_BASE}/api/v8/partner/documents`

function getConfig(): {
  enabled: boolean
  clientId: string
  username: string
  apiKey: string
} | null {
  if (typeof process === "undefined" || !process.env) return null
  const enabled = process.env.VERYFI_ENABLED === "true"
  const clientId = process.env.VERYFI_CLIENT_ID?.trim() ?? ""
  const username = process.env.VERYFI_USERNAME?.trim() ?? ""
  const apiKey = process.env.VERYFI_API_KEY?.trim() ?? ""
  if (!enabled || !clientId || !username || !apiKey) return null
  return { enabled: true, clientId, username, apiKey }
}

export type VeryfiRawInspectionResponse = {
  success: true
  rawVeryfiResponse: unknown
}

/**
 * Envía la imagen a Veryfi Process Document.
 * Headers: CLIENT-ID, AUTHORIZATION (apikey USERNAME:API_KEY), Content-Type: application/json.
 */
export async function readOMRWithVeryfiBackend(
  imageBase64: string,
  _numQuestions: number,
  _optionLabels: string[]
): Promise<VeryfiRawInspectionResponse> {
  const config = getConfig()
  if (!config) {
    console.log("[VERYFI] error: credenciales no configuradas (VERYFI_ENABLED, VERYFI_CLIENT_ID, VERYFI_USERNAME, VERYFI_API_KEY)")
    throw new Error("Veryfi no configurado. Configure VERYFI_ENABLED=true y las credenciales.")
  }

  const rawBase64 = imageBase64.includes("base64,") ? imageBase64.split("base64,")[1] ?? imageBase64 : imageBase64

  console.log("[VERYFI] request started")
  console.log("[VERYFI] endpoint", ENDPOINT)
  console.log("[VERYFI] client id prefix", config.clientId ? `${config.clientId.substring(0, 6)}...` : "(empty)")
  console.log("[VERYFI] username", config.username || "(empty)")
  const authValue = `apikey ${config.username}:${config.apiKey}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "CLIENT-ID": config.clientId,
    Authorization: authValue,
  }
  console.log("[VERYFI] auth header built = true")

  const body = {
    file_data: rawBase64,
    file_name: "omr_sheet.jpg",
    categories: ["forms"],
  }

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.log("[VERYFI] error", err)
    throw new Error("Error de conexión con Veryfi. Revise red y credenciales.")
  }

  const responseBodyRaw = await res.text()
  console.log("[VERYFI] response status", res.status)
  console.log("[VERYFI] response body raw", responseBodyRaw.length > 500 ? responseBodyRaw.slice(0, 500) + "..." : responseBodyRaw)

  if (res.status === 401 || res.status === 403) {
    const errMsg = `Veryfi HTTP ${res.status}: ${responseBodyRaw.slice(0, 300)}`
    console.log("[VERYFI] error", errMsg)
    throw new Error(errMsg)
  }

  if (!res.ok) {
    let errMsg: string
    try {
      const j = JSON.parse(responseBodyRaw) as { message?: string; error?: string }
      errMsg = j?.message ?? j?.error ?? responseBodyRaw.slice(0, 200) ?? `Veryfi respondió ${res.status}`
    } catch {
      errMsg = responseBodyRaw.slice(0, 200) || `Veryfi respondió ${res.status}`
    }
    console.log("[VERYFI] error", errMsg)
    throw new Error(errMsg)
  }

  let response: unknown
  try {
    response = JSON.parse(responseBodyRaw)
  } catch {
    console.log("[VERYFI] error: respuesta no es JSON válido")
    throw new Error("Veryfi devolvió una respuesta no válida.")
  }

  console.log("[VERYFI] raw response", JSON.stringify(response).slice(0, 800) + (JSON.stringify(response).length > 800 ? "..." : ""))

  return {
    success: true,
    rawVeryfiResponse: response,
  }
}
