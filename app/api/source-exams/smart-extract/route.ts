/**
 * POST /api/source-exams/smart-extract
 * Texto del documento (Azure/extractor local) → Anthropic (2 pasadas) → JSON de ítems (el cliente importa a la BD).
 * Política global: completitud de ítems primero; enriquecimiento pedagógico después (ver smart-base-parser).
 */
import { NextRequest, NextResponse } from "next/server"
import Anthropic, { APIError } from "@anthropic-ai/sdk"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { extractSourceDocumentStructured } from "@/app/lib/extract-document-structured"
import {
  SMART_EXTRACT_ENRICH_SYSTEM_PROMPT,
  SMART_EXTRACT_STAGE1_SYSTEM_PROMPT,
  buildEnrichmentUserJson,
  extractJsonObjectFromModelText,
  finalizeSlimStage1Items,
  getAxisHintsForSubject,
  getSmartExtractRawItemStats,
  mergePedagogyEnrichments,
  resolveDocumentSubjectForEnrichment,
  sanitizePedagogyEnrichmentsParsed,
  truncateDocumentForLlm,
} from "@/app/lib/smart-base-parser"

export const dynamic = "force-dynamic"

/** Opcional: `ANTHROPIC_MODEL`. Por defecto `claude-sonnet-4-6`. */
const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6"
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_DOC_CHARS = 100_000
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const

const DEFAULT_STAGE1_MAX_TOKENS = 16384
const DEFAULT_STAGE2_MAX_TOKENS = 8192

function parseStageMaxTokens(stage: "1" | "2"): number {
  const key = stage === "1" ? "SMART_EXTRACT_STAGE1_MAX_TOKENS" : "SMART_EXTRACT_STAGE2_MAX_TOKENS"
  const def = stage === "1" ? DEFAULT_STAGE1_MAX_TOKENS : DEFAULT_STAGE2_MAX_TOKENS
  const v = process.env[key]?.trim()
  if (!v) return def
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n < 256) return def
  return Math.min(n, 64000)
}

function messageTextContent(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b && b.text ? b.text : ""))
    .join("\n")
    .trim()
}

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
  user: { id: string }
) {
  const { data: sourceExam, error: fetchErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id, subject, title, course_label")
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
  const row = sourceExam as { subject?: unknown; title?: unknown; course_label?: unknown }
  const subject = typeof row.subject === "string" ? row.subject.trim() || null : null
  const title = typeof row.title === "string" ? row.title.trim() || null : null
  const course_label = typeof row.course_label === "string" ? row.course_label.trim() || null : null
  return { ok: true as const, subject, title, course_label }
}

function mapAnthropicError(e: APIError) {
  const st = e.status
  const base = {
    details: e.message,
    anthropic_status: st ?? null,
    anthropic_type: e.type ?? null,
    request_id: e.requestID ?? null,
    items: [] as unknown[],
  }
  if (st === 401) {
    return jsonNs({ error: "API key de Anthropic rechazada (401).", ...base }, 503)
  }
  if (st === 429) {
    return jsonNs({ error: "Límite de tasa o cuota Anthropic (429).", ...base }, 429)
  }
  if (st === 404) {
    return jsonNs({ error: "Recurso o modelo no encontrado en Anthropic (404).", ...base }, 503)
  }
  if (st === 400) {
    return jsonNs({ error: "Petición rechazada por Anthropic (400).", ...base }, 502)
  }
  return jsonNs({ error: `Error Anthropic (${st ?? "?"}).`, ...base }, 502)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return jsonNs({ error: "No autorizado" }, 401)

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    return jsonNs(
      {
        error: "Falta ANTHROPIC_API_KEY en el servidor.",
        items: [],
      },
      503,
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) return jsonNs({ error: "Supabase no configurado" }, 503)

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return jsonNs({ error: "FormData inválido" }, 400)
  }

  const sourceExamIdRaw = formData.get("source_exam_id") ?? formData.get("sourceExamId")
  const sourceExamId = typeof sourceExamIdRaw === "string" ? sourceExamIdRaw.trim() : ""
  if (!sourceExamId) {
    return jsonNs({ error: "Envíe source_exam_id" }, 400)
  }

  const access = await checkSourceExamAccess(supabase, sourceExamId, user)
  if (!access.ok) return jsonNs({ error: access.error }, access.status)
  const sourceExamSubject = access.subject
  const sourceExamTitle = access.title
  const sourceExamCourseLabel = access.course_label

  const file = formData.get("file") ?? formData.get("pdf") ?? formData.get("document")
  if (!file || !(file instanceof Blob)) {
    return jsonNs({ error: "Envíe el archivo en el campo file" }, 400)
  }

  const name = typeof (file as File).name === "string" ? (file as File).name : "document"
  const mime = file.type || ""
  const kind = isAllowedFile(name, mime)
  if (!kind) {
    return jsonNs({ error: "Solo PDF o DOCX" }, 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_FILE_BYTES) {
    return jsonNs({ error: `Archivo > ${MAX_FILE_BYTES / 1024 / 1024} MB` }, 400)
  }

  let structured: Awaited<ReturnType<typeof extractSourceDocumentStructured>>
  try {
    structured = await extractSourceDocumentStructured(buffer, {
      filename: name,
      mimeType: mime || (kind === "pdf" ? "application/pdf" : DOCX_MIME),
    })
  } catch (e) {
    return jsonNs(
      { error: "No se pudo extraer texto del documento", details: e instanceof Error ? e.message : String(e) },
      500,
    )
  }

  const rawText = structured.raw_text?.trim() ?? ""
  if (!rawText) {
    return jsonNs({ error: "Sin texto extraíble", items: [] }, 200)
  }

  const { text: docForLlm, truncated } = truncateDocumentForLlm(rawText, MAX_DOC_CHARS)
  const userContent = `Nombre archivo: ${name}\n\n---\nDOCUMENTO:\n\n${docForLlm}`

  try {
    // Reversible: si Anthropic exigiera org vía env, comentar estas dos líneas.
    delete process.env.ANTHROPIC_ORG_ID
    delete process.env.ANTHROPIC_ORGANIZATION

    const key = process.env.ANTHROPIC_API_KEY || ""
    console.log("KEY PREFIJO:", key.slice(0, 10))
    console.log("KEY FINAL:", key.slice(-6))

    console.log(
      "[smart-extract] OCR/base antes de Anthropic:",
      JSON.stringify(
        {
          pageCount: structured.pageCount,
          char_raw_text: rawText.length,
          char_sent_to_llm: docForLlm.length,
          document_truncated_for_llm: truncated,
          forensic_lines_total: structured.forensic?.lines_total ?? null,
          forensic_words_approx_total: structured.forensic?.words_approx_total ?? null,
          forensic_char_raw_text_final: structured.forensic?.char_raw_text_final ?? null,
          extraction_method: structured.extraction?.method ?? null,
        },
        null,
        2,
      ),
    )

    const maxTokensStage1 = parseStageMaxTokens("1")
    const maxTokensStage2 = parseStageMaxTokens("2")
    const skipEnrich = process.env.SMART_EXTRACT_SKIP_ENRICH === "1"

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const msg1 = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokensStage1,
      system: SMART_EXTRACT_STAGE1_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    })

    const textOut1 = messageTextContent(msg1)

    console.log(
      "[smart-extract] pasada 1 Anthropic:",
      JSON.stringify(
        {
          max_tokens_solicitados: maxTokensStage1,
          stop_reason: msg1.stop_reason,
          output_tokens: msg1.usage?.output_tokens ?? null,
          input_tokens: msg1.usage?.input_tokens ?? null,
          textOut_chars: textOut1.length,
          textOut_empty: textOut1.length === 0,
          truncado_por_max_tokens: msg1.stop_reason === "max_tokens",
        },
        null,
        2,
      ),
    )

    if (!textOut1) {
      console.log("[smart-extract] AUDIT: return temprano — pasada 1 sin texto")
      return jsonNs({ error: "El modelo no devolvió texto (pasada 1)", items: [] }, 200)
    }

    let parsed1: unknown
    try {
      parsed1 = extractJsonObjectFromModelText(textOut1)
    } catch (parseErr) {
      console.log(
        "[smart-extract] AUDIT parseo pasada 1 falló:",
        JSON.stringify(
          {
            parse_error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            textOut_tail: textOut1.slice(-400),
          },
          null,
          2,
        ),
      )
      return jsonNs(
        {
          error: "La respuesta no es JSON válido (pasada 1)",
          details: parseErr instanceof Error ? parseErr.message : String(parseErr),
          raw_preview: textOut1.slice(0, 400),
          items: [],
        },
        200,
      )
    }

    const rawStats1 = getSmartExtractRawItemStats(parsed1)
    const itemsAfterStage1 = finalizeSlimStage1Items(parsed1)
    const stage1ItemCount = itemsAfterStage1.length
    let items = itemsAfterStage1

    console.log(
      "[smart-extract] pasada 1 parseo/finalize:",
      JSON.stringify(
        {
          rawStats: rawStats1,
          items_devueltos_pasada1: stage1ItemCount,
        },
        null,
        2,
      ),
    )

    let msg2: Awaited<ReturnType<typeof anthropic.messages.create>> | null = null
    let textOut2 = ""
    let enrichParseOk = false
    let enrichmentContextMeta: {
      document_subject: string | null
      subject_source: "source_exams" | "metadata" | "heuristic" | "none"
      axis_hints_count: number
    } | null = null

    if (!skipEnrich && items.length > 0) {
      const subjectResolved = resolveDocumentSubjectForEnrichment({
        sourceExamSubject,
        documentTextSample: docForLlm,
        title: sourceExamTitle,
        courseLabel: sourceExamCourseLabel,
      })
      const axisHints = getAxisHintsForSubject(subjectResolved.subject)
      enrichmentContextMeta = {
        document_subject: subjectResolved.subject,
        subject_source: subjectResolved.source,
        axis_hints_count: axisHints.length,
      }
      const enrichUser = buildEnrichmentUserJson(items, {
        document_subject: subjectResolved.subject,
        subject_source: subjectResolved.source,
        axis_hints: axisHints,
      })
      console.log(
        "[smart-extract] enriquecimiento: contexto asignatura",
        JSON.stringify({
          subject: subjectResolved.subject,
          source: subjectResolved.source,
          axis_hints_count: axisHints.length,
        }),
      )
      try {
        msg2 = await anthropic.messages.create({
          model: MODEL,
          max_tokens: maxTokensStage2,
          system: SMART_EXTRACT_ENRICH_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Inferir metadatos pedagógicos para cada ítem según el system prompt: asigna eje, habilidad y nivel cognitivo en cada fila (mejor opción razonable); solo null si el ítem es ilegible o ininterpretable. Usa document_subject y axis_hints. Prohibido etiquetas basura tipo "General".\n\nJSON de entrada:\n${enrichUser}`,
            },
          ],
        })
        textOut2 = messageTextContent(msg2)
        console.log(
          "[smart-extract] pasada 2 Anthropic:",
          JSON.stringify(
            {
              max_tokens_solicitados: maxTokensStage2,
              stop_reason: msg2.stop_reason,
              output_tokens: msg2.usage?.output_tokens ?? null,
              input_tokens: msg2.usage?.input_tokens ?? null,
              textOut_chars: textOut2.length,
              truncado_por_max_tokens: msg2.stop_reason === "max_tokens",
            },
            null,
            2,
          ),
        )
        if (textOut2) {
          try {
            const parsed2 = extractJsonObjectFromModelText(textOut2)
            const sanitized2 = sanitizePedagogyEnrichmentsParsed(parsed2)
            items = mergePedagogyEnrichments(items, sanitized2)
            enrichParseOk = true
          } catch (e2) {
            console.log(
              "[smart-extract] parseo pasada 2 falló:",
              e2 instanceof Error ? e2.message : String(e2),
            )
          }
        }
      } catch (e2) {
        console.log("[smart-extract] pasada 2 error:", e2 instanceof Error ? e2.message : String(e2))
      }
    }

    const enrichmentsMergedCount = items.filter((it) => it.pedagogy_inferred === true).length

    console.log(
      "[smart-extract] resumen dos pasadas:",
      JSON.stringify(
        {
          items_finales: items.length,
          pasada1_raw_count: rawStats1.rawCount,
          pasada2_enrich_parse_ok: enrichParseOk,
          pasada2_filas_con_pedagogy_inferred: enrichmentsMergedCount,
          skip_enrich_flag: skipEnrich,
        },
        null,
        2,
      ),
    )

    const byType = items.reduce<Record<string, number>>((acc, it) => {
      const k = it.question_type ?? "(null)"
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    console.log(
      "[smart-extract] AUDIT tipos de pregunta (final):",
      JSON.stringify({ question_type_counts: byType }, null, 2),
    )

    const warnings: string[] = []
    if (truncated) warnings.push(`Documento truncado a ${MAX_DOC_CHARS} caracteres.`)
    if (msg1.stop_reason === "max_tokens") {
      warnings.push(
        "La pasada 1 terminó por límite de salida (max_tokens): puede faltar parte de las preguntas. Aumente SMART_EXTRACT_STAGE1_MAX_TOKENS si la API lo permite.",
      )
    }
    if (!skipEnrich && items.length > 0 && !enrichParseOk) {
      warnings.push(
        "No se pudo aplicar el enriquecimiento pedagógico (pasada 2); eje, habilidad y nivel cognitivo pueden quedar vacíos.",
      )
    }
    if (msg2?.stop_reason === "max_tokens") {
      warnings.push("La pasada 2 truncó por max_tokens; revise metadatos pedagógicos.")
    }

    console.log(
      "[smart-extract] AUDIT: esta ruta no escribe en BD; el cliente importa después (POST separado).",
    )

    const responseBody = {
      items,
      warnings,
      meta: {
        model: MODEL,
        document_truncated: truncated,
        extraction_method: structured.extraction?.method ?? null,
        pages: structured.pageCount ?? null,
        items_returned: items.length,
        smart_extract_stage1_max_tokens: maxTokensStage1,
        smart_extract_stage2_max_tokens: maxTokensStage2,
        smart_extract_stage1_stop_reason: msg1.stop_reason,
        smart_extract_stage1_output_tokens: msg1.usage?.output_tokens ?? null,
        smart_extract_stage1_input_tokens: msg1.usage?.input_tokens ?? null,
        smart_extract_stage1_items: stage1ItemCount,
        smart_extract_stage2_stop_reason: msg2?.stop_reason ?? null,
        smart_extract_stage2_output_tokens: msg2?.usage?.output_tokens ?? null,
        smart_extract_stage2_input_tokens: msg2?.usage?.input_tokens ?? null,
        smart_extract_stage2_enriched_items: enrichmentsMergedCount,
        smart_extract_skip_enrich: skipEnrich,
        smart_extract_enrich_parse_ok: enrichParseOk,
        /** Contexto enviado a pasada 2 (útil para verificar asignatura y ejes en red/JSON). */
        smart_extract_enrichment_context: enrichmentContextMeta,
      },
    }
    console.log(
      "[smart-extract] AUDIT antes return OK:",
      JSON.stringify(
        {
          shape: "{ items, warnings, meta }",
          items_length: responseBody.items.length,
          meta_items_returned: responseBody.meta.items_returned,
          warnings_count: responseBody.warnings.length,
        },
        null,
        2,
      ),
    )

    return jsonNs(responseBody)
  } catch (e) {
    console.error("[smart-extract]", e)
    if (e instanceof APIError) {
      const hdrs = e.headers
      const responseHeaders: Record<string, string> = {}
      if (hdrs && typeof hdrs.forEach === "function") {
        hdrs.forEach((v: string, k: string) => {
          responseHeaders[k] = v
        })
      }
      const orgHeader =
        responseHeaders["anthropic-organization-id"] ??
        (typeof hdrs?.get === "function" ? hdrs.get("anthropic-organization-id") : null)
      console.log(
        "[smart-extract] ANTHROPIC ERROR (copiar):",
        JSON.stringify(
          {
            modelo_usado: MODEL,
            status: e.status,
            message: e.message,
            type: e.type,
            request_id: e.requestID,
            error_completo: e.error,
            "anthropic-organization-id": orgHeader,
            response_headers: responseHeaders,
          },
          null,
          2,
        ),
      )
      return mapAnthropicError(e)
    }
    return jsonNs(
      {
        error: "Fallo al llamar a Anthropic",
        details: e instanceof Error ? e.message : String(e),
        items: [],
      },
      503,
    )
  }
}
