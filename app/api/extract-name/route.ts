import { type NextRequest, NextResponse } from "next/server"
import {
  inferMimeType,
  parseNameListFromForm,
  runExtractNamePipeline,
  type ExtractNameErrorStage,
} from "@/app/lib/extract-name-core"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function resolveErrorStage(err: unknown): ExtractNameErrorStage {
  if (err != null && typeof err === "object" && "error_stage" in err) {
    const stage = (err as { error_stage?: unknown }).error_stage
    if (typeof stage === "string") return stage as ExtractNameErrorStage
  }
  return "pipeline"
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const files = formData.getAll("files") as File[]
    const nameListJson = formData.get("nameList") as string | null
    const includeAudit =
      formData.get("includeAudit") !== "0" && formData.get("includeAudit") !== "false"

    const { nameList, parseError: nameListParseError } = parseNameListFromForm(nameListJson)

    console.log(`[API /extract-name] Nombres en lista de clase disponibles: ${nameList.length > 0}`)

    const fileInputs: Array<{ name: string; buffer: Buffer; mimeType: string }> = []
    for (const file of files) {
      const name = file.name || "sin-nombre"
      fileInputs.push({
        name,
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: inferMimeType(name, file.type),
      })
    }

    const result = await runExtractNamePipeline({
      files: fileInputs,
      nameList,
      nameListParseError,
      includeAudit,
    })

    const audit = result.audit

    if (audit) {
      console.log("[API /extract-name] audit:", {
        files_count: audit.files_count,
        mime_types: audit.mime_types,
        azure_vision_text_length: audit.azure_vision_text_length,
        document_intelligence_used: audit.document_intelligence_used,
        document_intelligence_text_length: audit.document_intelligence_text_length,
        combined_text_preview: audit.combined_text_preview,
        ai_fallback_used: audit.ai_fallback_used,
        suggestions_count: audit.suggestions_count,
        error_stage: audit.error_stage,
        ocr_source: audit.ocr_source,
        direct_label_name_detected: audit.direct_label_name_detected,
        direct_label_pattern: audit.direct_label_pattern,
        direct_label_raw_value: audit.direct_label_raw_value,
        direct_label_normalized: audit.direct_label_normalized,
      })
    }

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          error_stage: result.error_stage ?? audit?.error_stage ?? "pipeline",
          ...(audit ? { audit } : {}),
        },
        { status: 400 },
      )
    }

    console.log(`[API /extract-name] Sugerencias finales devueltas:`, result.suggestions)

    return NextResponse.json({
      success: true,
      suggestions: result.suggestions,
      ...(audit ? { audit } : {}),
    })
  } catch (error) {
    console.error("[API /extract-name] ❌ ERROR EN EL BLOQUE POST:", error)
    const errorStage = resolveErrorStage(error)
    const status =
      error != null &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: number }).status === "number" &&
      ((error as { status: number }).status === 503 || (error as { status: number }).status === 502)
        ? 503
        : 500
    return NextResponse.json(
      {
        success: false,
        error: "No se pudo extraer nombres en este momento. Intenta de nuevo.",
        error_stage: errorStage,
      },
      { status },
    )
  }
}
