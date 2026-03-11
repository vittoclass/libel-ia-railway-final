/**
 * API route: generación de plantilla Aspose.OMR (.omr) desde parámetros tipo LibelIA.
 * Construye markup JSON (AnswerSheet), llama a PostGenerateTemplate y devuelve el .omr en base64.
 * Requiere: ASPOSE_CLIENT_ID, ASPOSE_CLIENT_SECRET en env.
 */

import { NextRequest, NextResponse } from "next/server"
import { getLibelIAAsposeMarkupJson } from "@/app/lib/omr-aspose-template-generator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ASPOSE_TOKEN_URL = "https://api.aspose.cloud/connect/token"
const ASPOSE_POST_GENERATE = "https://api.aspose.cloud/v5.0/omr/GenerateTemplate/PostGenerateTemplate"
const ASPOSE_GET_GENERATE = "https://api.aspose.cloud/v5.0/omr/GenerateTemplate/GetGenerateTemplate"
const POLL_INTERVAL_MS = 2000
const POLL_MAX_WAIT_MS = 60000

type AsposeTokenResponse = { access_token?: string; error?: string }
type AsposeGetGenerateResponse = {
  id?: string
  responseStatusCode?: string
  results?: Array<{ type?: string; data?: string }>
  error?: string | null
}

export async function POST(req: NextRequest) {
  try {
    const isDev = process.env.NODE_ENV === "development"
    const body = await req.json().catch(() => ({}))
    const numQuestions = Math.max(1, Math.min(200, Number(body?.numQuestions) ?? 40))
    const numOptions = Math.max(2, Math.min(8, Number(body?.numOptions) ?? 4))
    const name = typeof body?.name === "string" ? body.name : "LibelIA"
    const templateId = typeof body?.templateId === "string" ? body.templateId : undefined

    const clientId = process.env.ASPOSE_CLIENT_ID
    const clientSecret = process.env.ASPOSE_CLIENT_SECRET
    if (isDev) {
      console.log("[AsposeOMR][Generate] Request recibida", {
        numQuestions,
        numOptions,
        name,
        templateId,
      })
    }
    if (!clientId || !clientSecret) {
      if (isDev) {
        console.warn("[AsposeOMR][Generate] Faltan credenciales de Aspose.")
      }
      return NextResponse.json({
        success: false,
        error:
          "Aspose no está configurado. Configure ASPOSE_CLIENT_ID y ASPOSE_CLIENT_SECRET en las variables de entorno.",
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
        console.error("[AsposeOMR][Generate] No se pudo obtener token de Aspose.", {
          status: tokenRes.status,
          body: tokenData,
        })
      }
      return NextResponse.json({
        success: false,
        error: "No se pudo obtener el token de Aspose. Verifique Client ID y Client Secret.",
      })
    }

    const markupJson = getLibelIAAsposeMarkupJson({ numQuestions, numOptions, name })
    const markupBase64 = Buffer.from(markupJson, "utf8").toString("base64")

    const postBody = {
      MarkupFile: markupBase64,
      Images: {}, // Requerido por la API; objeto vacío cuando el markup no referencia imágenes
      settings: {
        PaperSize: "A4",
        Orientation: "Vertical",
        BubbleSize: "Normal",
        FontFamily: "Arial",
        FontSize: 12,
        FontStyle: "Regular",
      },
    }

    if (isDev) {
      const bodyKeys = Object.keys(postBody)
      const imagesVal = (postBody as Record<string, unknown>).Images
      console.log("[AsposeOMR][Generate] ANTES fetch PostGenerateTemplate", {
        endpoint: ASPOSE_POST_GENERATE,
        bodyKeys,
        hasImages: "Images" in postBody,
        imagesExists: imagesVal !== undefined && imagesVal !== null,
        imagesIsArray: Array.isArray(imagesVal),
        imagesLength: Array.isArray(imagesVal) ? imagesVal.length : (typeof imagesVal === "object" && imagesVal !== null ? Object.keys(imagesVal).length : "N/A"),
        markupBase64Length: markupBase64?.length ?? 0,
      })
    }

    const postRes = await fetch(ASPOSE_POST_GENERATE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(postBody),
    })

    const responseText = await postRes.text()

    if (isDev) {
      const bodyResumen = postRes.ok ? "(éxito)" : (responseText.length > 300 ? responseText.slice(0, 300) + "..." : responseText)
      console.log("[AsposeOMR][Generate] DESPUÉS fetch PostGenerateTemplate", {
        status: postRes.status,
        ok: postRes.ok,
        bodyResumen,
      })
    }

    if (!postRes.ok) {
      if (isDev) {
        console.error("[AsposeOMR][Generate] PostGenerateTemplate falló", {
          status: postRes.status,
          body: responseText.slice(0, 500),
        })
      }
      return NextResponse.json({
        success: false,
        error: `Aspose PostGenerateTemplate falló: ${postRes.status} ${responseText.slice(0, 300)}`,
      })
    }

    const postJson =
      (() => {
        try {
          const parsed = JSON.parse(responseText)
          return typeof parsed === "string" ? { requestId: parsed } : parsed as { id?: string; taskId?: string; requestId?: string }
        } catch {
          return { requestId: responseText.trim() }
        }
      })()
    const taskId =
      typeof postJson === "string"
        ? postJson
        : postJson?.id ?? postJson?.taskId ?? postJson?.requestId
    if (!taskId || typeof taskId !== "string") {
      if (isDev) {
        console.error("[AsposeOMR][Generate] Aspose no devolvió ID de tarea válido.", {
          raw: postJson,
        })
      }
      return NextResponse.json({
        success: false,
        error: "Aspose no devolvió un ID de tarea de generación.",
      })
    }

    const started = Date.now()
    let getData: AsposeGetGenerateResponse

    do {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      const getRes = await fetch(
        `${ASPOSE_GET_GENERATE}?id=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      getData = (await getRes.json()) as AsposeGetGenerateResponse
      if (isDev) {
        console.log("[AsposeOMR][Generate] Poll GetGenerateTemplate", {
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
          error: `Aspose generación: ${String(getData.error)}`,
        })
      }
    } while (Date.now() - started < POLL_MAX_WAIT_MS)

    if (getData.responseStatusCode !== "Ok" || !getData.results?.length) {
      if (isDev) {
        console.error("[AsposeOMR][Generate] Tiempo de espera agotado o sin resultados.", {
          taskId,
          statusCode: getData.responseStatusCode,
          resultsLength: getData.results?.length ?? 0,
        })
      }
      return NextResponse.json({
        success: false,
        error: "Aspose no devolvió la plantilla generada a tiempo.",
      })
    }

    let omrBase64: string | null = null
    let printableFormPngBase64: string | null = null
    for (const r of getData.results) {
      if (r.type === "Omr" && r.data) omrBase64 = r.data
      if (r.type === "Png" && r.data) printableFormPngBase64 = r.data
    }

    if (!omrBase64) {
      if (isDev) {
        console.error("[AsposeOMR][Generate] No se encontró archivo .omr en resultados.", {
          taskId,
          resultsLength: getData.results?.length ?? 0,
        })
      }
      return NextResponse.json({
        success: false,
        error: "Aspose no incluyó el archivo .omr en la respuesta.",
      })
    }

    if (isDev) {
      console.log("[AsposeOMR][Generate] Plantilla generada correctamente", {
        taskId,
        templateId,
        omrLength: omrBase64.length,
        hasPrintable: !!printableFormPngBase64,
      })
    }
    return NextResponse.json({
      success: true,
      omrBase64,
      taskId,
      printableFormPngBase64: printableFormPngBase64 ?? undefined,
      templateId: templateId ?? undefined,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (process.env.NODE_ENV === "development") {
      console.error("[AsposeOMR][Generate] Error inesperado en la ruta.", { error: e, message })
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
