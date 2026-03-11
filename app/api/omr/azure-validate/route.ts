/**
 * POST /api/omr/azure-validate
 * Valida calidad de captura y selection marks con Azure Document Intelligence.
 * Solo se usa como apoyo cuando OpenCV devuelve muchas incidencias. No toca compare ni scoring.
 * Body: { imageBase64: string }
 * Response: { hasSelectionMarks, selectionMarkCount?, qualityWarning?, provider }
 */

import { NextRequest, NextResponse } from "next/server"
import {
  validateWithAzure,
  isAzureOmrValidationAvailable,
} from "@/app/lib/azure-omr-validator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    if (!isAzureOmrValidationAvailable()) {
      return NextResponse.json(
        {
          hasSelectionMarks: false,
          qualityWarning: "Validación Azure OMR no está habilitada o no está configurada.",
          provider: "azure-document-intelligence",
        },
        { status: 200 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const imageBase64 = body?.imageBase64 ?? body?.image
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { error: "Falta imageBase64 en el cuerpo." },
        { status: 400 }
      )
    }

    const result = await validateWithAzure(imageBase64)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[AZURE_OMR] validation error", message)
    return NextResponse.json(
      {
        hasSelectionMarks: false,
        qualityWarning: message,
        provider: "azure-document-intelligence",
      },
      { status: 200 }
    )
  }
}
