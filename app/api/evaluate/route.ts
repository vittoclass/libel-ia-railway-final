import { NextRequest, NextResponse } from "next/server"
import { executeEvaluatePostBody } from "./evaluation-logic"

export const runtime = "nodejs"
// REFIX_404_RAILWAY: mantener respuesta dinámica en producción Railway
export const dynamic = "force-dynamic"
// REFIX_404_RAILWAY: timeout ampliado para evitar corte en rama serverless
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    console.log("[evaluate] ANTES req.json()")
    const body = await req.json()
    console.log("[evaluate] DESPUÉS req.json()", {
      fileUrlsLen: Array.isArray((body as { fileUrls?: unknown }).fileUrls)
        ? (body as { fileUrls: unknown[] }).fileUrls.length
        : 0,
    })
    return await executeEvaluatePostBody(body)
  } catch (parseErr) {
    console.error("[evaluate] JSON inválido:", parseErr)
    return NextResponse.json(
      { success: false, error: "Cuerpo de solicitud inválido (JSON)" },
      { status: 400 },
    )
  }
}
