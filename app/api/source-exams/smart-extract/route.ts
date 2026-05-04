/**
 * POST /api/source-exams/smart-extract
 * Texto del documento (Azure/extractor local) → Anthropic (2 pasadas) → JSON de ítems (el cliente importa a la BD).
 * Política global: completitud de ítems primero; enriquecimiento pedagógico después (ver smart-base-parser).
 */
import { NextRequest, NextResponse } from "next/server"
import Anthropic, { APIError } from "@anthropic-ai/sdk"
import { createHash } from "node:crypto"
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
  sanitizePedagogyEnrichmentsParsed,
  truncateDocumentForLlm,
} from "@/app/lib/smart-base-parser"
import {
  SUPPLEMENT_EXTRACT_SYSTEM_PROMPT,
  augmentSupplementMapsFromText,
  mergeOverlayToJsonRecord,
  mergeSmartExtractWithSupplements,
  supplementRowsToMaps,
  type SupplementRow,
} from "@/app/lib/source-exam-draft-merge"

export const dynamic = "force-dynamic"

/** Opcional: `ANTHROPIC_MODEL`. Por defecto `claude-sonnet-4-6`. */
const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6"
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_DOC_CHARS = 100_000
const MAX_SUPPLEMENT_CHARS = 45_000
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const

const DEFAULT_STAGE1_MAX_TOKENS = 16384
const DEFAULT_STAGE2_MAX_TOKENS = 8192
const SMART_EXTRACT_TEMPERATURE = 0.1

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

function hasNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0
}

function normalizeSubjectKey(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function toCanonicalSubjectLabel(v: string | null | undefined): string | null {
  if (!v) return null
  const key = normalizeSubjectKey(v)
  if (!key) return null
  if (/(^|[^a-z])(lenguaje|lengua)([^a-z]|$)/.test(key)) return "Lenguaje"
  if (/matematica|matematicas|matem/.test(key)) return "Matemática"
  if (/(^|[^a-z])historia([^a-z]|$)/.test(key)) return "Historia"
  if (/ciencias?(\s+naturales)?|biolog|fisica|quimica/.test(key)) return "Ciencias"
  if (/ingles|english/.test(key)) return "Inglés"
  return null
}

function inferSubjectFromTextKeywords(text: string): string | null {
  const sample = normalizeSubjectKey(text).slice(0, 40_000)
  if (sample.length < 20) return null
  const score = (keywords: readonly string[]): number =>
    keywords.reduce((acc, kw) => (sample.includes(kw) ? acc + 1 : acc), 0)
  const ranked = [
    { subject: "Matemática" as const, score: score(["matematica", "matematicas", "algebra", "geometria", "fraccion", "ecuacion", "porcentaje"]) },
    { subject: "Lenguaje" as const, score: score(["lenguaje", "lengua", "lectura", "comprension", "texto", "inferencia", "literatura"]) },
    { subject: "Historia" as const, score: score(["historia", "independencia", "colonia", "republica", "siglo", "fuente historica"]) },
    { subject: "Ciencias" as const, score: score(["ciencias", "biologia", "fisica", "quimica", "ecosistema", "experimento", "energia"]) },
    { subject: "Inglés" as const, score: score(["ingles", "english", "reading", "grammar", "vocabulary", "listening"]) },
  ].sort((a, b) => b.score - a.score)
  if (ranked[0].score < 1) return null
  if (ranked[1]?.score === ranked[0].score) return null
  return ranked[0].subject
}

type SubjectSource = "source_exams" | "payload" | "title" | "filename" | "ocr" | "none"
type EnrichmentPromptSubjectSource = "source_exams" | "metadata" | "heuristic" | "none"

function toPromptSubjectSource(source: SubjectSource): EnrichmentPromptSubjectSource {
  if (source === "source_exams") return "source_exams"
  if (source === "none") return "none"
  if (source === "payload" || source === "title" || source === "filename") return "metadata"
  return "heuristic"
}

function resolveSubjectContext(args: {
  sourceExamSubject: string | null
  payloadSubject: string | null
  sourceExamTitle: string | null
  fileName: string
  documentTextSample: string
}): { subject: string | null; source: SubjectSource } {
  const fromDb = toCanonicalSubjectLabel(args.sourceExamSubject)
  if (fromDb) return { subject: fromDb, source: "source_exams" }

  const fromPayload = toCanonicalSubjectLabel(args.payloadSubject)
  if (fromPayload) return { subject: fromPayload, source: "payload" }

  const fromTitle = toCanonicalSubjectLabel(args.sourceExamTitle)
  if (fromTitle) return { subject: fromTitle, source: "title" }

  const fromFilename = toCanonicalSubjectLabel(args.fileName)
  if (fromFilename) return { subject: fromFilename, source: "filename" }

  const fromOcr = inferSubjectFromTextKeywords(args.documentTextSample)
  if (fromOcr) return { subject: fromOcr, source: "ocr" }

  return { subject: null, source: "none" }
}

function getAxisHintsForResolvedSubject(subject: string | null): string[] {
  if (!subject) return []
  const fromBase = getAxisHintsForSubject(subject)
  if (fromBase.length > 0) return fromBase
  if (subject === "Historia") {
    return ["Pensamiento temporal y espacial", "Análisis de fuentes históricas", "Formación ciudadana"]
  }
  if (subject === "Inglés") {
    return ["Reading comprehension", "Vocabulary", "Grammar and language use"]
  }
  return []
}

function getControlledAxisHintsFallback(): string[] {
  return ["Números y operaciones", "Comprensión lectora", "Análisis de fuentes históricas", "Biología", "Reading comprehension"]
}

function parseSmartExtractTemperature(): number {
  const raw = process.env.SMART_EXTRACT_TEMPERATURE?.trim()
  if (!raw) return SMART_EXTRACT_TEMPERATURE
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return SMART_EXTRACT_TEMPERATURE
  return Math.min(1, Math.max(0, parsed))
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
  const startedAt = Date.now()
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
  void sourceExamCourseLabel

  const payloadSubjectRaw =
    formData.get("subject") ??
    formData.get("source_exam_subject") ??
    formData.get("sourceExamSubject") ??
    formData.get("document_subject")
  const payloadSubject = typeof payloadSubjectRaw === "string" ? payloadSubjectRaw.trim() || null : null

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

  async function readOptionalSupplement(fieldName: string): Promise<{ buffer: Buffer; name: string; mime: string } | null> {
    const raw = formData.get(fieldName)
    if (!raw || !(raw instanceof Blob) || raw.size === 0) return null
    const buf = Buffer.from(await raw.arrayBuffer())
    if (buf.length > MAX_FILE_BYTES) return null
    const name = typeof (raw as File).name === "string" ? (raw as File).name : `${fieldName}.pdf`
    const mime = raw.type || ""
    if (!isAllowedFile(name, mime)) return null
    return { buffer: buf, name, mime }
  }

  const supplementAkPromise = readOptionalSupplement("answer_key_file")
  const supplementRfPromise = readOptionalSupplement("rubric_file")
  const [supplementAk, supplementRf] = await Promise.all([supplementAkPromise, supplementRfPromise])

  let structured: Awaited<ReturnType<typeof extractSourceDocumentStructured>>
  const extractionStartedAt = Date.now()
  let extractionFinishedAt = extractionStartedAt
  try {
    structured = await extractSourceDocumentStructured(buffer, {
      filename: name,
      mimeType: mime || (kind === "pdf" ? "application/pdf" : DOCX_MIME),
    })
    extractionFinishedAt = Date.now()
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
    const temperature = parseSmartExtractTemperature()
    const skipEnrich = process.env.SMART_EXTRACT_SKIP_ENRICH === "1"
    const inputTextHashShort = createHash("sha256").update(rawText).digest("hex").slice(0, 12)
    let pass1StartedAt = 0
    let pass1FinishedAt = 0
    let pass2StartedAt = 0
    let pass2FinishedAt = 0

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    pass1StartedAt = Date.now()
    const msg1 = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokensStage1,
      temperature,
      system: SMART_EXTRACT_STAGE1_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    })
    pass1FinishedAt = Date.now()

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
    let pass1Ok = false
    try {
      parsed1 = extractJsonObjectFromModelText(textOut1)
      pass1Ok = true
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
      subject_source: SubjectSource
      axis_hints_count: number
      subject_resolved: string | null
      enrichment_context_ok: boolean
    } | null = null

    if (!skipEnrich && items.length > 0) {
      const subjectResolved = resolveSubjectContext({
        sourceExamSubject,
        payloadSubject,
        sourceExamTitle,
        fileName: name,
        documentTextSample: rawText,
      })
      const axisHintsFromSubject = getAxisHintsForResolvedSubject(subjectResolved.subject)
      const axisHints =
        axisHintsFromSubject.length > 0
          ? axisHintsFromSubject
          : subjectResolved.subject == null
            ? getControlledAxisHintsFallback()
            : []
      const enrichmentContextOk = Boolean(subjectResolved.subject) && axisHints.length > 0
      enrichmentContextMeta = {
        document_subject: subjectResolved.subject,
        subject_source: subjectResolved.source,
        axis_hints_count: axisHints.length,
        subject_resolved: subjectResolved.subject,
        enrichment_context_ok: enrichmentContextOk,
      }
      const enrichUser = buildEnrichmentUserJson(items, {
        document_subject: subjectResolved.subject,
        subject_source: toPromptSubjectSource(subjectResolved.source),
        axis_hints: axisHints,
      })
      console.log(
        "[smart-extract] enriquecimiento: contexto asignatura",
        JSON.stringify({
          subject: subjectResolved.subject,
          source: subjectResolved.source,
          axis_hints_count: axisHints.length,
          enrichment_context_ok: enrichmentContextOk,
        }),
      )
      try {
        pass2StartedAt = Date.now()
        msg2 = await anthropic.messages.create({
          model: MODEL,
          max_tokens: maxTokensStage2,
          temperature,
          system: SMART_EXTRACT_ENRICH_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Inferir metadatos pedagógicos para cada ítem según el system prompt: asigna eje, habilidad y nivel cognitivo en cada fila (mejor opción razonable); solo null si el ítem es ilegible o ininterpretable. Usa document_subject y axis_hints. Prohibido etiquetas basura tipo "General".\n\nJSON de entrada:\n${enrichUser}`,
            },
          ],
        })
        pass2FinishedAt = Date.now()
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
        pass2FinishedAt = Date.now()
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

    let merge_summary:
      | {
          answersCompletedFromPauta: number
          scoresCompletedFromPautaOrRubric: number
          rubricsAssociated: number
          conflictsNeedReview: number
        }
      | null = null
    let merge_draft_overlay: ReturnType<typeof mergeOverlayToJsonRecord> | null = null

    if (items.length > 0 && (supplementAk || supplementRf)) {
      try {
        let pautaDoc = ""
        let rubricDoc = ""
        if (supplementAk) {
          const exAk = await extractSourceDocumentStructured(supplementAk.buffer, {
            filename: supplementAk.name,
            mimeType:
              supplementAk.mime ||
              (supplementAk.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : DOCX_MIME),
          })
          pautaDoc = truncateDocumentForLlm(exAk.raw_text ?? "", MAX_SUPPLEMENT_CHARS).text.trim()
        }
        if (supplementRf) {
          const exRf = await extractSourceDocumentStructured(supplementRf.buffer, {
            filename: supplementRf.name,
            mimeType:
              supplementRf.mime ||
              (supplementRf.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : DOCX_MIME),
          })
          rubricDoc = truncateDocumentForLlm(exRf.raw_text ?? "", MAX_SUPPLEMENT_CHARS).text.trim()
        }
        if (!pautaDoc && !rubricDoc) {
          warnings.push("Los archivos de pauta/rúbrica no arrojaron texto extraíble; fusión omitida.")
        } else {
          const msgSup = await anthropic.messages.create({
            model: MODEL,
            max_tokens: Math.min(parseStageMaxTokens("2"), 8192),
            temperature,
            system: SUPPLEMENT_EXTRACT_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: `PAUTA:\n\n${pautaDoc || "(sin texto)"}\n\n---\n\nRÚBRICA:\n\n${rubricDoc || "(sin texto)"}`,
              },
            ],
          })
          const textSup = messageTextContent(msgSup)
          const parsedSup = extractJsonObjectFromModelText(textSup)
          const obj =
            parsedSup && typeof parsedSup === "object"
              ? (parsedSup as { from_pauta?: unknown; from_rubric?: unknown })
              : {}
          const maps = supplementRowsToMaps({
            from_pauta: Array.isArray(obj.from_pauta) ? (obj.from_pauta as SupplementRow[]) : [],
            from_rubric: Array.isArray(obj.from_rubric) ? (obj.from_rubric as SupplementRow[]) : [],
          })
          augmentSupplementMapsFromText(pautaDoc, rubricDoc, maps.pauta, maps.rubric, items)
          const mergedRes = mergeSmartExtractWithSupplements(items, maps.pauta, maps.rubric)
          items = mergedRes.merged
          merge_summary = mergedRes.summary
          merge_draft_overlay = mergeOverlayToJsonRecord(mergedRes.overlayByItemNumber)
          console.log(
            "[smart-extract] fusión pauta/rúbrica aplicada:",
            JSON.stringify(mergedRes.summary, null, 2),
          )
        }
      } catch (mergeErr) {
        console.log("[smart-extract] fusión pauta/rúbrica error:", mergeErr)
        warnings.push(
          `Fusión pauta/rúbrica omitida: ${mergeErr instanceof Error ? mergeErr.message : String(mergeErr)}`,
        )
      }
    }

    const itemsDetected = items.length
    const itemsWithCorrectAnswer = items.filter((it) => hasNonEmptyString(it.correct_answer)).length
    const itemsWithAxisLabel = items.filter((it) => hasNonEmptyString(it.axis_label)).length
    const itemsWithSkillLabel = items.filter((it) => hasNonEmptyString(it.skill_label)).length
    const itemsWithCognitiveLevel = items.filter((it) => hasNonEmptyString(it.cognitive_level)).length
    // Propuesta futura (NO aplicada): evaluar fallback max_score=1 solo si negocio lo autoriza explícitamente.
    const itemsWithScoreMax = items.filter((it) => typeof it.max_score === "number" && Number.isFinite(it.max_score)).length
    const smartPass2Ok = skipEnrich ? true : Boolean(msg2 && textOut2.trim().length > 0)
    const metrics = {
      input_text_length: rawText.length,
      input_text_hash_short: inputTextHashShort,
      items_detected: itemsDetected,
      items_with_correct_answer: itemsWithCorrectAnswer,
      items_with_axis_label: itemsWithAxisLabel,
      items_with_skill_label: itemsWithSkillLabel,
      items_with_cognitive_level: itemsWithCognitiveLevel,
      items_with_score_max: itemsWithScoreMax,
      smart_pass_1_ok: pass1Ok,
      smart_pass_2_ok: smartPass2Ok,
      smart_extract_enrich_parse_ok: enrichParseOk,
      warnings,
      duration_ms_total: Date.now() - startedAt,
      duration_ms_extraction_text: Math.max(0, extractionFinishedAt - extractionStartedAt),
      duration_ms_ia_pass_1: pass1StartedAt > 0 && pass1FinishedAt > 0 ? Math.max(0, pass1FinishedAt - pass1StartedAt) : 0,
      duration_ms_ia_pass_2: pass2StartedAt > 0 && pass2FinishedAt > 0 ? Math.max(0, pass2FinishedAt - pass2StartedAt) : 0,
    } as const

    console.log(
      "[smart-extract] AUDIT: esta ruta no escribe en BD; el cliente importa después (POST separado).",
    )
    console.log("[smart-extract] métricas intento:", JSON.stringify(metrics, null, 2))

    const responseBody = {
      items,
      warnings,
      ...(merge_summary ? { merge_summary } : {}),
      ...(merge_draft_overlay ? { merge_draft_overlay } : {}),
      meta: {
        model: MODEL,
        document_truncated: truncated,
        extraction_method: structured.extraction?.method ?? null,
        pages: structured.pageCount ?? null,
        items_returned: items.length,
        smart_extract_stage1_max_tokens: maxTokensStage1,
        smart_extract_stage2_max_tokens: maxTokensStage2,
        smart_extract_temperature: temperature,
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
        input_text_length: metrics.input_text_length,
        input_text_hash_short: metrics.input_text_hash_short,
        items_detected: metrics.items_detected,
        items_with_correct_answer: metrics.items_with_correct_answer,
        items_with_axis_label: metrics.items_with_axis_label,
        items_with_skill_label: metrics.items_with_skill_label,
        items_with_cognitive_level: metrics.items_with_cognitive_level,
        items_with_score_max: metrics.items_with_score_max,
        smart_pass_1_ok: metrics.smart_pass_1_ok,
        smart_pass_2_ok: metrics.smart_pass_2_ok,
        duration_ms_total: metrics.duration_ms_total,
        duration_ms_extraction_text: metrics.duration_ms_extraction_text,
        duration_ms_ia_pass_1: metrics.duration_ms_ia_pass_1,
        duration_ms_ia_pass_2: metrics.duration_ms_ia_pass_2,
        /** Contexto enviado a pasada 2 (útil para verificar asignatura y ejes en red/JSON). */
        smart_extract_enrichment_context: enrichmentContextMeta,
        subject_resolved: enrichmentContextMeta?.subject_resolved ?? null,
        subject_source: enrichmentContextMeta?.subject_source ?? "none",
        axis_hints_count: enrichmentContextMeta?.axis_hints_count ?? 0,
        enrichment_context_ok: enrichmentContextMeta?.enrichment_context_ok ?? false,
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
