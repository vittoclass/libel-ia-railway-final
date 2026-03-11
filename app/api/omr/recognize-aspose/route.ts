/**
 * API route: reconocimiento OMR con Aspose.OMR Cloud.
 * Solo para el flujo robusto de hoja LibelIA. No reemplaza /api/evaluate ni otros flujos.
 * Requiere: ASPOSE_CLIENT_ID, ASPOSE_CLIENT_SECRET, ASPOSE_OMR_TEMPLATE_BASE64 en env.
 */

import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ASPOSE_TOKEN_URL = "https://api.aspose.cloud/connect/token"
const ASPOSE_POST_RECOGNIZE = "https://api.aspose.cloud/v5.0/omr/RecognizeTemplate/PostRecognizeTemplate"
const ASPOSE_GET_RECOGNIZE = "https://api.aspose.cloud/v5.0/omr/RecognizeTemplate/GetRecognizeTemplate"
const POLL_INTERVAL_MS = 2000
const POLL_MAX_WAIT_MS = 35000

export type GridReadResult = { pregunta: number; respuesta: string; confianza: number }

type AsposeTokenResponse = { access_token?: string; error?: string }
type AsposeGetResponse = {
  id?: string
  responseStatusCode?: string
  results?: Array<{ type?: string; data?: string }>
  error?: string | null
}

function parseQuestionNumber(name: string): number | null {
  const s = String(name).trim()
  const m = s.match(/^Q?(\d+)$/i) || s.match(/(\d+)/)
  if (m) return parseInt(m[1], 10)
  return null
}

function mapAsposeResultToGrid(
  decoded: unknown,
  numQuestions: number,
  optionLabels: string[]
): GridReadResult[] {
  const results: GridReadResult[] = []
  const optionSet = new Set(optionLabels.map((o) => o.toUpperCase()))
  const defaultConfidence = 0.95

  const items: Array<{ name: string; value: string }> = []

  if (Array.isArray(decoded)) {
    for (const row of decoded) {
      if (row && typeof row === "object") {
        const name = (row["Element Name"] ?? row["Name"] ?? row["elementName"] ?? row["name"] ?? row["question"]) ?? ""
        const value = (row["Value"] ?? row["value"] ?? row["Answer"] ?? row["answer"]) ?? ""
        items.push({ name: String(name), value: String(value).trim() })
      }
    }
  } else if (decoded && typeof decoded === "object" && "OmrElements" in decoded) {
    const arr = (decoded as { OmrElements?: unknown[] }).OmrElements
    if (Array.isArray(arr)) {
      for (const el of arr) {
        if (el && typeof el === "object") {
          const name = (el as Record<string, unknown>)["Name"] ?? (el as Record<string, unknown>)["name"] ?? ""
          const value = (el as Record<string, unknown>)["Value"] ?? (el as Record<string, unknown>)["value"] ?? ""
          items.push({ name: String(name), value: String(value).trim() })
        }
      }
    }
  }

  const byQuestion = new Map<number, string>()
  for (const { name, value } of items) {
    const q = parseQuestionNumber(name)
    if (q != null && q >= 1 && q <= numQuestions) {
      const normalized = value.toUpperCase()
      if (normalized === "" || optionSet.has(normalized) || normalized === "DOBLE_MARCA" || normalized === "MULTIPLE") {
        byQuestion.set(q, value === "" ? "" : normalized === "MULTIPLE" ? "DOBLE_MARCA" : normalized)
      } else {
        byQuestion.set(q, normalized)
      }
    }
  }

  for (let q = 1; q <= numQuestions; q++) {
    results.push({
      pregunta: q,
      respuesta: byQuestion.get(q) ?? "",
      confianza: defaultConfidence,
    })
  }
  return results
}

export async function POST(req: NextRequest) {
  try {
    const isDev = process.env.NODE_ENV === "development"
    const body = await req.json()
    const imageBase64 = body?.imageBase64 ?? body?.image
    const numQuestions = Math.max(1, Math.min(200, Number(body?.numQuestions) || 40))
    const optionLabels: string[] = Array.isArray(body?.optionLabels) ? body.optionLabels : ["A", "B", "C", "D"]

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { success: false, error: "Falta imageBase64 en el cuerpo de la petición." },
        { status: 400 }
      )
    }

    const clientId = process.env.ASPOSE_CLIENT_ID
    const clientSecret = process.env.ASPOSE_CLIENT_SECRET
    const templateBase64 = process.env.ASPOSE_OMR_TEMPLATE_BASE64
    const omrFromBody = body?.omrBase64
    const effectiveOmrBase64 =
      omrFromBody && typeof omrFromBody === "string" ? omrFromBody : templateBase64

    if (isDev) {
      console.log("[AsposeOMR][Recognize] Request recibida", {
        numQuestions,
        optionLabels,
        hasOmrInBody: !!omrFromBody,
        omrSource: omrFromBody ? "body" : templateBase64 ? "env" : "none",
        omrLength: effectiveOmrBase64?.length ?? 0,
      })
    }

    if (!clientId || !clientSecret || !effectiveOmrBase64) {
      if (isDev) {
        console.warn("[AsposeOMR][Recognize] Configuración incompleta", {
          hasClientId: !!clientId,
          hasClientSecret: !!clientSecret,
          hasTemplate: !!effectiveOmrBase64,
        })
      }
      return NextResponse.json({
        success: false,
        error:
          "Aspose OMR no está configurado. Falta el archivo .omr (body.omrBase64 o ASPOSE_OMR_TEMPLATE_BASE64) o las credenciales (ASPOSE_CLIENT_ID / ASPOSE_CLIENT_SECRET).",
      })
    }

    const tokenRes = await fetch(ASPOSE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const tokenData: AsposeTokenResponse = await tokenRes.json()
    const accessToken = tokenData.access_token
    if (!accessToken) {
      if (isDev) {
        console.error("[AsposeOMR][Recognize] No se pudo obtener token de Aspose.", {
          status: tokenRes.status,
          body: tokenData,
        })
      }
      return NextResponse.json({
        success: false,
        error: "No se pudo obtener el token de Aspose. Verifique Client ID y Client Secret.",
      })
    }

    const postBody = {
      Images: [imageBase64.replace(/^data:image\/\w+;base64,/, "")],
      omrFile: effectiveOmrBase64,
      outputFormat: "JSON",
      recognitionThreshold: 35,
    }

    if (isDev) {
      console.log("[AsposeOMR][Recognize] ANTES fetch PostRecognizeTemplate", {
        endpoint: ASPOSE_POST_RECOGNIZE,
        bodyKeys: Object.keys(postBody),
        imagesLength: postBody.Images?.length ?? 0,
        omrFileLength: effectiveOmrBase64?.length ?? 0,
      })
    }

    const postRes = await fetch(ASPOSE_POST_RECOGNIZE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(postBody),
    })

    const postResponseText = await postRes.text()

    if (isDev) {
      const bodyResumen = postResponseText.length > 500 ? postResponseText.slice(0, 500) + "..." : postResponseText
      let parsedAs: "json" | "text" = "text"
      try {
        JSON.parse(postResponseText)
        parsedAs = "json"
      } catch {
        parsedAs = "text"
      }
      console.log("[AsposeOMR][Recognize] DESPUÉS fetch PostRecognizeTemplate", {
        status: postRes.status,
        ok: postRes.ok,
        bodyResumen,
        parsedAs,
      })
    }

    if (!postRes.ok) {
      if (isDev) {
        console.error("[AsposeOMR][Recognize] PostRecognizeTemplate falló", {
          status: postRes.status,
          body: postResponseText.slice(0, 500),
        })
      }
      return NextResponse.json({
        success: false,
        error: `Aspose PostRecognizeTemplate falló: ${postRes.status} ${postResponseText.slice(0, 200)}`,
      })
    }

    const postJson = (() => {
      try {
        const parsed = JSON.parse(postResponseText)
        return typeof parsed === "string" ? { requestId: parsed } : parsed as { id?: string; taskId?: string; requestId?: string }
      } catch {
        return { requestId: postResponseText.trim() }
      }
    })()
    const taskId =
      typeof postJson === "string"
        ? postJson
        : postJson?.id ?? postJson?.taskId ?? postJson?.requestId
    if (!taskId || typeof taskId !== "string") {
      if (isDev) {
        console.error("[AsposeOMR][Recognize] Aspose no devolvió ID de tarea válido.", {
          raw: postJson,
        })
      }
      return NextResponse.json({
        success: false,
        error: "Aspose no devolvió un ID de tarea.",
      })
    }

    const started = Date.now()
    let getRes: Response
    let getData: AsposeGetResponse

    do {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      if (isDev) {
        console.log("[AsposeOMR][Recognize] ANTES fetch GetRecognizeTemplate", {
          endpoint: ASPOSE_GET_RECOGNIZE,
          taskId,
        })
      }
      getRes = await fetch(`${ASPOSE_GET_RECOGNIZE}?id=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const getResponseText = await getRes.text()

      if (isDev) {
        const bodyResumen = getResponseText.length > 500 ? getResponseText.slice(0, 500) + "..." : getResponseText
        let parsedAs: "json" | "text" = "text"
        try {
          JSON.parse(getResponseText)
          parsedAs = "json"
        } catch {
          parsedAs = "text"
        }
        console.log("[AsposeOMR][Recognize] DESPUÉS fetch GetRecognizeTemplate", {
          status: getRes.status,
          ok: getRes.ok,
          bodyResumen,
          parsedAs,
        })
      }

      try {
        getData = JSON.parse(getResponseText) as AsposeGetResponse
      } catch (e) {
        if (isDev) {
          console.error("[AsposeOMR][Recognize] GetRecognizeTemplate respuesta no es JSON válido", {
            taskId,
            bodyPreview: getResponseText.slice(0, 300),
          })
        }
        return NextResponse.json({
          success: false,
          error: "Aspose devolvió una respuesta de estado que no es JSON válido.",
        })
      }

      if (isDev) {
        console.log("[AsposeOMR][Recognize] Poll GetRecognizeTemplate", {
          taskId,
          statusCode: getData.responseStatusCode,
          hasResults: !!getData.results?.length,
          error: getData.error,
        })
      }
      if (getData.responseStatusCode === "Ok" && getData.results?.length) break
      if (getData.error) {
        return NextResponse.json({
          success: false,
          error: `Aspose reconocimiento: ${String(getData.error)}`,
        })
      }
    } while (Date.now() - started < POLL_MAX_WAIT_MS)

    if (getData.responseStatusCode !== "Ok" || !getData.results?.length || !getData.results[0].data) {
      if (isDev) {
        console.error("[AsposeOMR][Recognize] Tiempo de espera agotado o sin resultados.", {
          taskId,
          statusCode: getData.responseStatusCode,
          resultsLength: getData.results?.length ?? 0,
        })
      }
      return NextResponse.json({
        success: false,
        error: "Aspose no devolvió resultados de reconocimiento a tiempo.",
      })
    }

    const decodedRaw = Buffer.from(getData.results[0].data, "base64").toString("utf8")
    let decoded: unknown
    try {
      decoded = JSON.parse(decodedRaw) as unknown
    } catch {
      const lines = decodedRaw.split(/\r?\n/).filter(Boolean)
      const rows: Array<Record<string, string>> = []
      const header = lines[0]?.split(",").map((h) => h.trim()) ?? []
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
        const row: Record<string, string> = {}
        header.forEach((h, j) => {
          row[h] = cells[j] ?? ""
        })
        rows.push(row)
      }
      decoded = rows
    }
    const results = mapAsposeResultToGrid(decoded, numQuestions, optionLabels)
    const answeredCount = results.filter(
      (r) => r.respuesta && r.respuesta !== "SIN_RESPUESTA",
    ).length
    if (isDev) {
      console.log("[AsposeOMR][Recognize] Resultados mapeados a GridReadResult[]", {
        totalResults: results.length,
        answeredCount,
      })
    }

    return NextResponse.json({ success: true, results })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (process.env.NODE_ENV === "development") {
      console.error("[AsposeOMR][Recognize] Error inesperado en la ruta.", { error: e, message })
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
