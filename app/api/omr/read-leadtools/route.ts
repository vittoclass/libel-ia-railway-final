/**
 * API route: proxy a microservicio OMR externo (LEADTOOLS o OpenCV).
 * Si OMR_PROVIDER=opencv → OPENCV_OMR_URL; si leadtools → LEADTOOLS_OMR_URL.
 * Reenvía el body al microservicio y devuelve el JSON del contrato.
 * NO toca compare, scoring ni persistencia.
 */

import { NextRequest, NextResponse } from "next/server"
import type { LeadToolsReadOmrRequest, LeadToolsReadOmrResponseBody } from "@/app/lib/omr-leadtools-contract"
import { getOMRProvider } from "@/app/lib/omr-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getMicroserviceBaseUrl(): string | null {
  const provider = getOMRProvider()
  if (provider === "opencv") return process.env.OPENCV_OMR_URL?.trim() ?? null
  if (provider === "leadtools") return process.env.LEADTOOLS_OMR_URL?.trim() ?? null
  return null
}

export async function POST(req: NextRequest) {
  const isDev = process.env.NODE_ENV === "development"
  try {
    if (isDev) {
      console.log("[OMR_PROXY] Request recibida")
    }

    const provider = getOMRProvider()
    if (provider !== "leadtools" && provider !== "opencv") {
      if (isDev) {
        console.log("[OMR_PROXY] Provider no es leadtools ni opencv, rechazando")
      }
      return NextResponse.json(
        { success: false, error: "OMR externo no activo. Configure OMR_PROVIDER=leadtools o OMR_PROVIDER=opencv." },
        { status: 400 }
      )
    }

    const baseUrl = getMicroserviceBaseUrl()
    if (!baseUrl) {
      if (isDev) {
        console.log("[OMR_PROXY] Error: URL del microservicio no configurada")
      }
      const envVar = provider === "opencv" ? "OPENCV_OMR_URL" : "LEADTOOLS_OMR_URL"
      return NextResponse.json(
        { success: false, error: `Configure ${envVar} para el provider ${provider}.` },
        { status: 503 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const imageBase64 = body?.imageBase64 ?? body?.image
    const templateId = typeof body?.templateId === "string" ? body.templateId : ""
    const numQuestions = Math.max(1, Math.min(200, Number(body?.numQuestions) || 40))
    const optionLabels: string[] = Array.isArray(body?.optionLabels) ? body.optionLabels : ["A", "B", "C", "D"]

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { success: false, error: "Falta imageBase64 en el cuerpo de la petición." },
        { status: 400 }
      )
    }

    const payload: LeadToolsReadOmrRequest = {
      imageBase64: imageBase64.includes("base64,") ? (imageBase64.split("base64,")[1] ?? imageBase64) : imageBase64,
      templateId: templateId || "default",
      numQuestions,
      optionLabels,
    }

    const url = `${baseUrl.replace(/\/$/, "")}/read-omr`
    if (isDev) {
      console.log("[OMR_PROXY] Reenviando a microservicio", {
        url,
        provider,
        templateId: payload.templateId,
        numQuestions: payload.numQuestions,
      })
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const responseText = await res.text()
    let parsedAs: "json" | "text" = "text"
    try {
      JSON.parse(responseText)
      parsedAs = "json"
    } catch {
      parsedAs = "text"
    }
    if (isDev) {
      const bodyResumen = responseText.length > 300 ? responseText.slice(0, 300) + "..." : responseText
      console.log("[OMR_PROXY] Respuesta microservicio", {
        status: res.status,
        ok: res.ok,
        bodyResumen,
        parsedAs,
      })
    }

    if (!res.ok) {
      let errMessage: string
      try {
        const errBody = JSON.parse(responseText) as { error?: unknown }
        errMessage =
          typeof errBody?.error === "string"
            ? errBody.error
            : errBody?.error != null
              ? String(errBody.error)
              : `Microservicio respondió ${res.status}.`
      } catch {
        errMessage = responseText.slice(0, 200) || `Microservicio respondió ${res.status}.`
      }
      if (isDev) {
        console.error("[OMR_PROXY] Error", { status: res.status, error: errMessage })
      }
      return NextResponse.json(
        { success: false, error: errMessage },
        { status: res.status >= 500 ? 502 : res.status }
      )
    }

    let data: LeadToolsReadOmrResponseBody
    try {
      data = JSON.parse(responseText) as LeadToolsReadOmrResponseBody
    } catch {
      if (isDev) {
        console.error("[OMR_PROXY] Error parseando respuesta JSON", { bodyPreview: responseText.slice(0, 200) })
      }
      return NextResponse.json(
        { success: false, error: "Respuesta del microservicio no es JSON válido." },
        { status: 502 }
      )
    }

    if (data.success === false) {
      const errMsg =
        typeof data.error === "string" ? data.error : data.error != null ? String(data.error) : "Error del microservicio."
      return NextResponse.json({ success: false, error: errMsg }, { status: 502 })
    }

    return NextResponse.json(data)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (isDev) {
      console.error("[OMR_PROXY] Error", { message })
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
