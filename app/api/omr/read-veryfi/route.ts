/**
 * POST /api/omr/read-veryfi
 * Acepta imagen en base64 y metadata; llama a Veryfi Process Document;
 * devuelve formato compatible con el flujo OMR (results, omissions?, doubleMarks?, metadata.engine: "veryfi").
 * NO toca compare, scoring ni persistencia.
 */

import { NextRequest, NextResponse } from "next/server"
import { readOMRWithVeryfiBackend } from "@/app/lib/veryfi-omr-reader"
import { getOMRProvider } from "@/app/lib/omr-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const provider = getOMRProvider()
    if (provider !== "veryfi") {
      return NextResponse.json(
        { success: false, error: "OMR_PROVIDER no es veryfi. Configure OMR_PROVIDER=veryfi para usar Veryfi." },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const imageBase64 = body?.imageBase64 ?? body?.image
    const numQuestions = Math.max(1, Math.min(200, Number(body?.numQuestions) || 40))
    const optionLabels: string[] = Array.isArray(body?.optionLabels) ? body.optionLabels : ["A", "B", "C", "D"]
    const templateId = typeof body?.templateId === "string" ? body.templateId : undefined

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { success: false, error: "Falta imageBase64 en el cuerpo de la petición." },
        { status: 400 }
      )
    }

    const result = await readOMRWithVeryfiBackend(imageBase64, numQuestions, optionLabels)

    return NextResponse.json({
      success: true,
      rawVeryfiResponse: result.rawVeryfiResponse,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { success: false, error: message },
      { status: 502 }
    )
  }
}
