/**
 * POST /api/source-exams/[id]/items/extract-pdf-text
 * Extrae contenido de PDF o DOCX para previsualizar/importar ítems de prueba base.
 *
 * Flujo E2E importación: este endpoint → texto en UI → Previsualizar → parser → tabla (opcional).
 *
 * Pipeline documental:
 * - Azure Document Intelligence prebuilt-layout (tablas, párrafos, líneas, words) con fallback prebuilt-read.
 * - PDF sin Azure: pdf-parse (solo texto incrustado).
 * - DOCX sin Azure: mammoth (raw + HTML/tablas); con Azure se fusiona mammoth si aporta texto faltante.
 *
 * Respuesta: text, raw_text, structured_lines, blocks, extraction, forensic (métricas y diagnóstico).
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { extractSourceDocumentStructured } from "@/app/lib/extract-document-structured"
import { inferSuggestedInstrumentTitle } from "@/app/lib/normalize-source-exam-text"

export const dynamic = "force-dynamic"

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const

function isAllowedFile(name: string, mime: string): "pdf" | "docx" | null {
  const n = name.toLowerCase()
  const m = mime.toLowerCase()
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf"
  if (m === DOCX_MIME || n.endsWith(".docx")) return "docx"
  if (m === "application/msword" && n.endsWith(".doc")) return null
  return null
}

async function checkSourceExamAccess(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  sourceExamId: string,
  user: { id: string }
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  const { id: sourceExamId } = await params
  if (!sourceExamId) return NextResponse.json({ error: "Falta id de prueba base" }, { status: 400 })

  const access = await checkSourceExamAccess(supabase, sourceExamId, user)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Formato de petición inválido" }, { status: 400 })
  }
  const file = formData.get("file") ?? formData.get("pdf") ?? formData.get("document")
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Envíe un archivo en el campo 'file' (PDF o DOCX)" }, { status: 400 })
  }
  const name = typeof (file as File).name === "string" ? (file as File).name : "document"
  const mime = file.type || ""
  const kind = isAllowedFile(name, mime)
  if (!kind) {
    return NextResponse.json(
      { error: "Formato no soportado. Use PDF o DOCX (.docx). Los .doc antiguos no están soportados." },
      { status: 400 }
    )
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  console.log("[extract-document-text] entrada:", {
    name,
    mime: mime || "(vacío)",
    kind,
    bytes: buffer.length,
  })

  if (buffer.length > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `El archivo no puede superar ${MAX_FILE_BYTES / 1024 / 1024} MB` },
      { status: 400 }
    )
  }

  try {
    const result = await extractSourceDocumentStructured(buffer, {
      filename: name,
      mimeType: mime || (kind === "pdf" ? "application/pdf" : DOCX_MIME),
    })
    const text = result.raw_text ?? ""

    console.log("[extract-document-text] salida forense:", {
      kind,
      method: result.extraction.method,
      pages: result.pageCount,
      lines: result.extraction.lines_total,
      blocks: result.extraction.blocks_total,
      tables: result.forensic.tables_detected,
      paragraphs: result.forensic.paragraphs_detected,
      wordsApprox: result.forensic.words_approx_total,
      char_final: text.length,
      char_content_vs_lines: {
        api_or_embed: result.forensic.char_api_content,
        ordered_lines: result.forensic.char_from_ordered_lines,
      },
      pdf_scanned_hint: result.forensic.pdf_scanned_heuristic ?? false,
    })

    let warning = result.warning
    if (
      result.extraction.method === "pdf_parse_fallback" &&
      text.trim().length < 80 &&
      !process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
    ) {
      warning =
        (warning ? warning + " " : "") +
        "Para PDF escaneados o con diagramación compleja, configure AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT y AZURE_DOCUMENT_INTELLIGENCE_KEY."
    }
    if (result.forensic.pdf_scanned_heuristic) {
      warning =
        (warning ? warning + " " : "") +
        "Posible PDF escaneado o sin capa de texto: el resultado puede estar incompleto sin Azure OCR."
    }

    const suggested_title = inferSuggestedInstrumentTitle(text)
    return NextResponse.json({
      text,
      raw_text: text,
      pageCount: result.pageCount,
      file_kind: kind,
      warning: warning ?? undefined,
      suggested_title: suggested_title ?? undefined,
      structured_lines: result.structured_lines,
      blocks: result.blocks,
      extraction: result.extraction,
      forensic: result.forensic,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[extract-document-text] fallo:", message)
    return NextResponse.json(
      { error: "No se pudo extraer el documento", details: message },
      { status: 422 }
    )
  }
}
