/**
 * POST /api/source-exams/[id]/validate-practice
 * Compara la prueba base (ítems multiple_choice en BD) vs extracción en memoria de un PDF/DOCX subido.
 * No escribe en BD; no modifica la prueba base.
 */
import { NextRequest, NextResponse } from "next/server"
import Anthropic, { APIError } from "@anthropic-ai/sdk"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { extractSourceDocumentStructured } from "@/app/lib/extract-document-structured"
import { extractJsonObjectFromModelText, truncateDocumentForLlm } from "@/app/lib/smart-base-parser"
import {
  VALIDATE_PRACTICE_MC_SYSTEM_PROMPT,
  comparePracticeMultipleChoiceVsBase,
  parseValidatePracticeMcExtract,
  type ValidatePracticeMcItem,
} from "@/app/lib/validate-practice-vs-base"
import { recordProviderCostAuditShadow } from "@/app/lib/cost-audit/recordProviderCostAuditShadow"

export const dynamic = "force-dynamic"

const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6"
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_DOC_CHARS = 100_000
const MAX_OUTPUT_TOKENS = Math.min(
  Math.max(parseInt(process.env.VALIDATE_PRACTICE_MAX_TOKENS?.trim() || "8192", 10) || 8192, 1024),
  32000,
)
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const

function jsonNs(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

function isAllowedFile(name: string, mime: string): "pdf" | "docx" | null {
  const n = name.toLowerCase()
  const m = mime.toLowerCase()
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf"
  if (m === DOCX_MIME || n.endsWith(".docx")) return "docx"
  return null
}

async function checkSourceExamAccess(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  sourceExamId: string,
  user: { id: string },
) {
  const { data: sourceExam, error: fetchErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id")
    .eq("id", sourceExamId)
    .maybeSingle()
  if (fetchErr || !sourceExam) return { ok: false as const, status: 404, error: "Prueba base no encontrada" }
  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!profile?.teacher_id || (sourceExam as { teacher_id: string }).teacher_id !== profile.teacher_id) {
    return { ok: false as const, status: 403, error: "Sin permiso sobre esta prueba base" }
  }
  return { ok: true as const }
}

function messageTextContent(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b && b.text ? b.text : ""))
    .join("\n")
    .trim()
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: sourceExamId } = await ctx.params
  if (!sourceExamId?.trim()) {
    return jsonNs({ ok: false, error: "ID de prueba base inválido" }, 400)
  }

  const user = await getAuthUser()
  if (!user) return jsonNs({ ok: false, error: "No autorizado" }, 401)

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    return jsonNs({ ok: false, error: "Falta ANTHROPIC_API_KEY en el servidor." }, 503)
  }

  const supabase = getSupabaseServer()
  if (!supabase) return jsonNs({ ok: false, error: "Supabase no configurado" }, 503)

  const access = await checkSourceExamAccess(supabase, sourceExamId, user)
  if (!access.ok) return jsonNs({ ok: false, error: access.error }, access.status)

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return jsonNs({ ok: false, error: "FormData inválido" }, 400)
  }

  const file = formData.get("file") ?? formData.get("pdf") ?? formData.get("document")
  if (!file || !(file instanceof Blob)) {
    return jsonNs({ ok: false, error: "Envíe el archivo en el campo file" }, 400)
  }

  const name = typeof (file as File).name === "string" ? (file as File).name : "document"
  const mime = file.type || ""
  const kind = isAllowedFile(name, mime)
  if (!kind) {
    return jsonNs({ ok: false, error: "Solo PDF o DOCX" }, 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_FILE_BYTES) {
    return jsonNs({ ok: false, error: `Archivo > ${MAX_FILE_BYTES / 1024 / 1024} MB` }, 400)
  }

  const { data: rows, error: rowsErr } = await supabase
    .from("source_exam_items")
    .select("item_number, item_text, question_type, correct_answer")
    .eq("source_exam_id", sourceExamId)
    .order("item_number", { ascending: true })

  if (rowsErr) {
    console.log("[validate-practice] error leyendo base:", rowsErr.message)
    return jsonNs({ ok: false, error: "No se pudieron leer ítems de la prueba base", details: rowsErr.message }, 500)
  }

  const baseMc: ValidatePracticeMcItem[] = (rows ?? [])
    .filter((r) => String((r as { question_type?: string | null }).question_type ?? "").toLowerCase() === "multiple_choice")
    .map((r) => {
      const n = Number((r as { item_number?: number }).item_number)
      const item_number = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0
      const item_text = String((r as { item_text?: string | null }).item_text ?? "").trim()
      const ca = String((r as { correct_answer?: string | null }).correct_answer ?? "").trim().toUpperCase()
      const correct_answer = /^[A-E]$/.test(ca) ? ca : null
      return {
        item_number,
        item_text,
        question_type: "multiple_choice" as const,
        correct_answer,
      }
    })
    .filter((x) => x.item_number >= 1 && x.item_text.length > 0)

  let structured: Awaited<ReturnType<typeof extractSourceDocumentStructured>>
  try {
    structured = await extractSourceDocumentStructured(buffer, {
      filename: name,
      mimeType: mime || (kind === "pdf" ? "application/pdf" : DOCX_MIME),
      cost_audit: {
        operation_prefix: "validate_practice_azure",
        context: { source_exam_id: sourceExamId },
      },
    })
  } catch (e) {
    return jsonNs(
      {
        ok: false,
        error: "No se pudo extraer texto del documento",
        details: e instanceof Error ? e.message : String(e),
      },
      500,
    )
  }

  const rawText = structured.raw_text?.trim() ?? ""
  if (!rawText) {
    return jsonNs({ ok: false, error: "Sin texto extraíble en el archivo subido" }, 200)
  }

  const { text: docForLlm, truncated } = truncateDocumentForLlm(rawText, MAX_DOC_CHARS)
  const userContent = `Nombre archivo: ${name}\n\n---\nDOCUMENTO (prueba real a validar):\n\n${docForLlm}`

  delete process.env.ANTHROPIC_ORG_ID
  delete process.env.ANTHROPIC_ORGANIZATION

  console.log(
    "[validate-practice] inicio",
    JSON.stringify({
      sourceExamId,
      base_mc_count: baseMc.length,
      char_raw: rawText.length,
      char_llm: docForLlm.length,
      truncated,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    }),
  )

  try {
    const anthropicStartedAt = Date.now()
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: VALIDATE_PRACTICE_MC_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    })

    recordProviderCostAuditShadow({
      provider: "anthropic",
      model: MODEL,
      operation: "validate_practice_anthropic",
      usage: msg.usage,
      durationMs: Date.now() - anthropicStartedAt,
      costAuditContext: { source_exam_id: sourceExamId },
    })

    const textOut = messageTextContent(msg)
    console.log(
      "[validate-practice] anthropic",
      JSON.stringify({
        stop_reason: msg.stop_reason,
        output_tokens: msg.usage?.output_tokens ?? null,
        textOut_chars: textOut.length,
      }),
    )

    if (!textOut) {
      return jsonNs({ ok: false, error: "El modelo no devolvió texto" }, 200)
    }

    let parsed: unknown
    try {
      parsed = extractJsonObjectFromModelText(textOut)
    } catch (e) {
      console.log("[validate-practice] parseo JSON falló:", e instanceof Error ? e.message : String(e))
      return jsonNs(
        {
          ok: false,
          error: "La respuesta del modelo no es JSON válido",
          details: e instanceof Error ? e.message : String(e),
        },
        200,
      )
    }

    const realMc = parseValidatePracticeMcExtract(parsed)
    const { summary, alerts } = comparePracticeMultipleChoiceVsBase(baseMc, realMc)

    console.log(
      "[validate-practice] resultado",
      JSON.stringify({
        ...summary,
        alerts_count: alerts.length,
        real_mc_extracted: realMc.length,
      }),
    )

    return jsonNs({
      ok: true,
      summary,
      alerts,
      meta: {
        model: MODEL,
        document_truncated: truncated,
        extraction_method: structured.extraction?.method ?? null,
        pages: structured.pageCount ?? null,
        stop_reason: msg.stop_reason,
        output_tokens: msg.usage?.output_tokens ?? null,
      },
    })
  } catch (e) {
    console.error("[validate-practice]", e)
    if (e instanceof APIError) {
      return jsonNs(
        {
          ok: false,
          error: "Error llamando a Anthropic",
          details: e.message,
          anthropic_status: e.status ?? null,
        },
        502,
      )
    }
    return jsonNs(
      {
        ok: false,
        error: "Fallo en validación",
        details: e instanceof Error ? e.message : String(e),
      },
      503,
    )
  }
}
