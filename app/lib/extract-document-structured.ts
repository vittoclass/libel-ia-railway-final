/**
 * Extracción estructurada de documentos para importación de prueba base (PDF y DOCX).
 * - Azure Document Intelligence: prebuilt-layout (tablas + párrafos + líneas) con fallback a prebuilt-read.
 * - PDF sin Azure: pdf-parse (solo capa de texto).
 * - DOCX sin Azure: mammoth (texto + HTML/tablas a texto).
 * Prioridad: no perder contenido; se fusionan cuerpos de texto si alguno aporta fragmentos no presentes en el principal.
 */
import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer"
import type { AnalyzeResult, DocumentPage, DocumentTable } from "@azure/ai-form-recognizer"
import mammoth from "mammoth"
import { extractTextFromPdf } from "@/app/lib/extract-text-from-pdf"
import { recordAzureDiCostAuditShadow } from "@/app/lib/cost-audit/recordAzureDiCostAuditShadow"
import type { CostAuditContext, EvaluationCostAuditOperation } from "@/app/lib/cost-audit/types"

export type StructuredLine = {
  page: number
  text: string
  bbox: number[]
}

export type TextBlock = {
  page: number
  blockIndex: number
  text: string
  lineCount: number
}

export type DocumentForensic = {
  filename: string
  declared_mime: string
  detected_kind: "pdf" | "docx"
  /** Descripción breve del camino ejecutado. */
  pipeline: string
  azure_model_used?: "prebuilt-layout" | "prebuilt-read"
  pages_detected: number
  pages_processed: number
  lines_per_page: Record<string, number>
  lines_total: number
  blocks_total: number
  paragraphs_detected: number
  tables_detected: number
  table_cells_total: number
  words_approx_total: number
  char_api_content: number
  char_from_ordered_lines: number
  char_raw_text_final: number
  /** Heurística: muchas páginas y poco texto incrustado (solo fallback pdf-parse). */
  pdf_scanned_heuristic?: boolean
}

export type DocumentExtractionInfo = {
  method:
    | "azure_prebuilt_layout"
    | "azure_prebuilt_read"
    | "pdf_parse_fallback"
    | "mammoth_docx"
    | "mammoth_docx_azure_supplement"
  pages_processed: number
  lines_per_page: Record<string, number>
  lines_total: number
  blocks_total: number
  azure_content_length?: number
}

export type ExtractDocumentStructuredResult = {
  raw_text: string
  structured_lines: StructuredLine[]
  blocks: TextBlock[]
  pageCount: number
  warning?: string
  extraction: DocumentExtractionInfo
  forensic: DocumentForensic
}

const DEBUG = process.env.NODE_ENV !== "production"

export type SourceDocumentMeta = {
  filename: string
  mimeType: string
  cost_audit?: {
    context?: CostAuditContext
    operation_prefix?: "smart_extract_azure" | "validate_practice_azure" | "extract_pdf_text_azure"
  }
}

function resolveAzureStructuredOperation(
  prefix: "smart_extract_azure" | "validate_practice_azure" | "extract_pdf_text_azure" | undefined,
  model: "prebuilt-layout" | "prebuilt-read",
): EvaluationCostAuditOperation {
  if (!prefix) return "document_structured_azure"
  const isRead = model === "prebuilt-read"
  if (prefix === "smart_extract_azure") {
    return isRead ? "smart_extract_azure_read_fallback" : "smart_extract_azure_layout"
  }
  if (prefix === "validate_practice_azure") {
    return isRead ? "validate_practice_azure_read_fallback" : "validate_practice_azure_layout"
  }
  return isRead ? "extract_pdf_text_azure_read_fallback" : "extract_pdf_text_azure_layout"
}

function detectKind(meta: SourceDocumentMeta): "pdf" | "docx" {
  const n = meta.filename.toLowerCase()
  const m = meta.mimeType.toLowerCase()
  if (n.endsWith(".docx") || m.includes("wordprocessingml") || m === "application/vnd.ms-word.document.macroenabled.12") {
    return "docx"
  }
  return "pdf"
}

function getAzureClient(): DocumentAnalysisClient | null {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim()
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim()
  if (!endpoint || !key) return null
  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key))
}

function flattenPolygon(polygon: Array<{ x: number; y: number }> | number[] | undefined): number[] {
  if (!polygon?.length) return []
  const first = polygon[0] as { x?: number; y?: number } | number
  if (typeof first === "number") return [...(polygon as number[])]
  const out: number[] = []
  for (const p of polygon as Array<{ x: number; y: number }>) {
    out.push(p.x, p.y)
  }
  return out
}

function polygonBounds(polygon: number[] | undefined) {
  if (!polygon?.length) return { top: 0, bottom: 0, left: 0, right: 0, height: 0 }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    const x = polygon[i]!
    const y = polygon[i + 1]!
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return { top: 0, bottom: 0, left: 0, right: 0, height: 0 }
  return { top: minY, bottom: maxY, left: minX, right: maxX, height: maxY - minY }
}

function sortPageLines(lines: StructuredLine[]): StructuredLine[] {
  return [...lines].sort((a, b) => {
    const ba = polygonBounds(a.bbox)
    const bb = polygonBounds(b.bbox)
    const yKeyA = Math.round(ba.top * 200) / 200
    const yKeyB = Math.round(bb.top * 200) / 200
    if (yKeyA !== yKeyB) return yKeyA - yKeyB
    return ba.left - bb.left
  })
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function groupPageIntoBlocks(sortedLines: StructuredLine[]): StructuredLine[][] {
  if (sortedLines.length === 0) return []
  const heights = sortedLines.map((l) => polygonBounds(l.bbox).height).filter((h) => h > 0.0001)
  const mh = median(heights)
  const gapThreshold = Math.max(mh * 1.75, 0.07)
  const blocks: StructuredLine[][] = []
  let cur: StructuredLine[] = []
  let prevBottom = -Infinity
  for (const line of sortedLines) {
    const b = polygonBounds(line.bbox)
    if (cur.length === 0) {
      cur.push(line)
      prevBottom = b.bottom
      continue
    }
    const gap = b.top - prevBottom
    if (gap > gapThreshold) {
      blocks.push(cur)
      cur = [line]
    } else cur.push(line)
    prevBottom = Math.max(prevBottom, b.bottom)
  }
  if (cur.length) blocks.push(cur)
  return blocks
}

function pagesToStructuredLines(pages: DocumentPage[]): StructuredLine[] {
  const out: StructuredLine[] = []
  for (const page of pages) {
    const pn = page.pageNumber
    for (const line of page.lines ?? []) {
      const text = (line.content ?? "").replace(/\r\n/g, "\n").trimEnd()
      if (!text.trim()) continue
      out.push({ page: pn, text, bbox: flattenPolygon(line.polygon) })
    }
  }
  return out
}

function buildRawTextFromLines(lines: StructuredLine[]): string {
  const byPage = new Map<number, StructuredLine[]>()
  for (const L of lines) {
    const arr = byPage.get(L.page) ?? []
    arr.push(L)
    byPage.set(L.page, arr)
  }
  const parts: string[] = []
  for (const p of [...byPage.keys()].sort((a, b) => a - b)) {
    const sorted = sortPageLines(byPage.get(p) ?? [])
    for (const line of sorted) parts.push(line.text)
    parts.push("")
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function tablesToPlainText(tables: DocumentTable[] | undefined): string {
  if (!tables?.length) return ""
  const chunks: string[] = []
  for (const t of tables) {
    const byRow = new Map<number, Map<number, string>>()
    for (const c of t.cells) {
      const r = c.rowIndex
      const col = c.columnIndex
      if (!byRow.has(r)) byRow.set(r, new Map())
      byRow.get(r)!.set(col, (c.content ?? "").replace(/\s+/g, " ").trim())
    }
    const rowIndices = [...byRow.keys()].sort((a, b) => a - b)
    const rows: string[] = []
    for (const r of rowIndices) {
      const cols = byRow.get(r)!
      const colIndices = [...cols.keys()].sort((a, b) => a - b)
      rows.push(colIndices.map((ci) => cols.get(ci) ?? "").join("\t"))
    }
    if (rows.length) chunks.push(rows.join("\n"))
  }
  return chunks.join("\n\n---tabla---\n\n")
}

function paragraphsToPlain(paragraphs: AnalyzeResult["paragraphs"]): string {
  if (!paragraphs?.length) return ""
  return paragraphs.map((p) => (p.content ?? "").trim()).filter(Boolean).join("\n\n")
}

/** Une textos evitando perder bloques que no aparecen como subcadena del más largo. */
function mergeTextBodiesNoLoss(...parts: string[]): string {
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0)
  if (cleaned.length === 0) return ""
  let base = cleaned.reduce((a, b) => (a.length >= b.length ? a : b))
  for (const p of cleaned) {
    if (p === base) continue
    const probeLen = Math.min(500, p.length)
    const probe = p.slice(0, probeLen)
    if (probe.length > 30 && !base.includes(probe)) {
      base += "\n\n" + p
    }
  }
  return base.trim()
}

function countWordsApprox(pages: DocumentPage[]): number {
  let n = 0
  for (const p of pages) {
    n += p.words?.length ?? 0
  }
  return n
}

function countTableCells(tables: DocumentTable[] | undefined): number {
  if (!tables?.length) return 0
  return tables.reduce((acc, t) => acc + (t.cells?.length ?? 0), 0)
}

function analyzeResultToStructured(
  analyze: AnalyzeResult,
  model: "prebuilt-layout" | "prebuilt-read",
): Omit<ExtractDocumentStructuredResult, "forensic" | "warning"> {
  const pages = analyze.pages ?? []
  let structured_lines = pagesToStructuredLines(pages)
  const apiContent = (analyze.content ?? "").trim()
  const tablesPlain = tablesToPlainText(analyze.tables)
  const paragraphsPlain = paragraphsToPlain(analyze.paragraphs)

  if (structured_lines.length === 0 && apiContent.length > 0) {
    structured_lines = apiContent
      .split(/\r?\n/)
      .filter((t) => t.trim().length > 0)
      .map((text) => ({ page: 1, text, bbox: [] as number[] }))
  }

  const byPage = new Map<number, StructuredLine[]>()
  for (const L of structured_lines) {
    const arr = byPage.get(L.page) ?? []
    arr.push(L)
    byPage.set(L.page, arr)
  }

  const blocks: TextBlock[] = []
  let blockIndex = 0
  const linesPerPage: Record<string, number> = {}

  for (const p of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageLines = sortPageLines(byPage.get(p) ?? [])
    linesPerPage[String(p)] = pageLines.length
    for (const bl of groupPageIntoBlocks(pageLines)) {
      blocks.push({
        page: p,
        blockIndex: blockIndex++,
        text: bl.map((l) => l.text).join("\n"),
        lineCount: bl.length,
      })
    }
  }

  const fromLines = buildRawTextFromLines(structured_lines)
  const raw_text = mergeTextBodiesNoLoss(apiContent, fromLines, tablesPlain, paragraphsPlain)

  const method: DocumentExtractionInfo["method"] =
    model === "prebuilt-layout" ? "azure_prebuilt_layout" : "azure_prebuilt_read"

  if (DEBUG) {
    console.log("[extract-document-structured] Azure:", {
      model,
      pages: pages.length,
      linesTotal: structured_lines.length,
      tables: analyze.tables?.length ?? 0,
      paragraphs: analyze.paragraphs?.length ?? 0,
      lenContent: apiContent.length,
      lenFromLines: fromLines.length,
      lenMerged: raw_text.length,
    })
  }

  return {
    raw_text,
    structured_lines,
    blocks,
    pageCount: pages.length,
    extraction: {
      method,
      pages_processed: pages.length,
      lines_per_page: linesPerPage,
      lines_total: structured_lines.length,
      blocks_total: blocks.length,
      azure_content_length: apiContent.length,
    },
  }
}

async function extractWithAzure(buffer: Buffer, meta: SourceDocumentMeta): Promise<ExtractDocumentStructuredResult | null> {
  const client = getAzureClient()
  if (!client) {
    if (DEBUG) console.log("[extract-document-structured] Azure no configurado.")
    return null
  }

  const kind = detectKind(meta)
  const t0 = Date.now()
  let result: AnalyzeResult | undefined
  let modelUsed: "prebuilt-layout" | "prebuilt-read" = "prebuilt-layout"

  try {
    const poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer)
    result = (await poller.pollUntilDone()) as AnalyzeResult
  } catch (e1) {
    if (DEBUG) console.warn("[extract-document-structured] prebuilt-layout falló, probando prebuilt-read:", e1)
    try {
      const poller = await client.beginAnalyzeDocument("prebuilt-read", buffer)
      result = (await poller.pollUntilDone()) as AnalyzeResult
      modelUsed = "prebuilt-read"
    } catch (e2) {
      console.error("[extract-document-structured] Azure read también falló:", e2)
      return null
    }
  }

  if (!result?.pages?.length) {
    if (DEBUG) console.warn("[extract-document-structured] Azure sin páginas.")
    return null
  }

  const built = analyzeResultToStructured(result, modelUsed)
  const pages = result.pages ?? []
  const words_approx_total = countWordsApprox(pages)
  const tables_detected = result.tables?.length ?? 0
  const paragraphs_detected = result.paragraphs?.length ?? 0
  const table_cells_total = countTableCells(result.tables)

  for (const page of pages) {
    const pn = page.pageNumber
    let charSum = 0
    for (const line of page.lines ?? []) charSum += (line.content ?? "").length
    console.log(
      `[extract-document-text] ${kind.toUpperCase()} Azure page=${pn} lines=${page.lines?.length ?? 0} words=${page.words?.length ?? 0} approxLineChars=${charSum} model=${modelUsed}`,
    )
  }

  console.log(
    `[extract-document-text] Azure OK ${Date.now() - t0}ms kind=${kind} pages=${built.pageCount} lines=${built.extraction.lines_total} blocks=${built.extraction.blocks_total} tables=${tables_detected} paragraphs=${paragraphs_detected} words≈${words_approx_total} chars_final=${built.raw_text.length}`,
  )

  recordAzureDiCostAuditShadow({
    operation: resolveAzureStructuredOperation(meta.cost_audit?.operation_prefix, modelUsed),
    model: modelUsed,
    pagesProcessed: built.pageCount,
    filesProcessed: 1,
    durationMs: Date.now() - t0,
    costAuditContext: meta.cost_audit?.context,
  })

  const forensic: DocumentForensic = {
    filename: meta.filename,
    declared_mime: meta.mimeType,
    detected_kind: kind,
    pipeline: `azure_${modelUsed}`,
    azure_model_used: modelUsed,
    pages_detected: built.pageCount,
    pages_processed: built.pageCount,
    lines_per_page: built.extraction.lines_per_page,
    lines_total: built.extraction.lines_total,
    blocks_total: built.extraction.blocks_total,
    paragraphs_detected,
    tables_detected,
    table_cells_total,
    words_approx_total,
    char_api_content: (result.content ?? "").trim().length,
    char_from_ordered_lines: buildRawTextFromLines(built.structured_lines).length,
    char_raw_text_final: built.raw_text.length,
  }

  return {
    ...built,
    forensic,
  }
}

function htmlToRoughText(html: string): string {
  return html
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/td>/gi, "\t")
    .replace(/<\/th>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function extractDocxMammoth(buffer: Buffer, meta: SourceDocumentMeta): Promise<ExtractDocumentStructuredResult> {
  const [raw, html] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ])
  const fromHtml = htmlToRoughText(html.value)
  const rawPlain = (raw.value ?? "").trim()
  const merged = mergeTextBodiesNoLoss(rawPlain, fromHtml)
  const lines = merged.split(/\r?\n/)
  const structured_lines: StructuredLine[] = []
  for (const line of lines) {
    const t = line
    if (!t.trim()) continue
    structured_lines.push({ page: 1, text: t, bbox: [] })
  }
  const blocks: TextBlock[] = [
    {
      page: 1,
      blockIndex: 0,
      text: structured_lines.map((l) => l.text).join("\n"),
      lineCount: structured_lines.length,
    },
  ]
  const forensic: DocumentForensic = {
    filename: meta.filename,
    declared_mime: meta.mimeType,
    detected_kind: "docx",
    pipeline: "mammoth_extractRawText+convertToHtml_merge",
    pages_detected: 1,
    pages_processed: 1,
    lines_per_page: structured_lines.length ? { "1": structured_lines.length } : {},
    lines_total: structured_lines.length,
    blocks_total: blocks.length,
    paragraphs_detected: 0,
    tables_detected: (html.value.match(/<table/gi) ?? []).length,
    table_cells_total: 0,
    words_approx_total: merged.split(/\s+/).filter(Boolean).length,
    char_api_content: rawPlain.length,
    char_from_ordered_lines: merged.length,
    char_raw_text_final: merged.length,
  }

  if (DEBUG) {
    console.log("[extract-document-structured] mammoth docx:", {
      rawLen: rawPlain.length,
      htmlLen: fromHtml.length,
      mergedLen: merged.length,
      lines: structured_lines.length,
    })
  }

  return {
    raw_text: merged,
    structured_lines,
    blocks,
    pageCount: 1,
    warning: raw.messages?.length ? raw.messages.map((m) => m.message).join("; ") : undefined,
    extraction: {
      method: "mammoth_docx",
      pages_processed: 1,
      lines_per_page: forensic.lines_per_page,
      lines_total: structured_lines.length,
      blocks_total: blocks.length,
    },
    forensic,
  }
}

async function extractPdfParseFallback(buffer: Buffer, meta: SourceDocumentMeta): Promise<ExtractDocumentStructuredResult> {
  const r = await extractTextFromPdf(buffer)
  const text = r.text ?? ""
  const lines = text.split(/\r?\n/)
  const structured_lines: StructuredLine[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    structured_lines.push({ page: 1, text: line, bbox: [] })
  }
  const blocks: TextBlock[] = [
    {
      page: 1,
      blockIndex: 0,
      text: structured_lines.map((l) => l.text).join("\n"),
      lineCount: structured_lines.length,
    },
  ]
  const pageCount = r.pageCount || 1
  const scannedHeuristic = pageCount >= 2 && text.trim().length < 80

  const forensic: DocumentForensic = {
    filename: meta.filename,
    declared_mime: meta.mimeType,
    detected_kind: "pdf",
    pipeline: "pdf-parse_embedded_text_only",
    pages_detected: pageCount,
    pages_processed: pageCount,
    lines_per_page: structured_lines.length ? { "1": structured_lines.length } : {},
    lines_total: structured_lines.length,
    blocks_total: blocks.length,
    paragraphs_detected: 0,
    tables_detected: 0,
    table_cells_total: 0,
    words_approx_total: text.split(/\s+/).filter(Boolean).length,
    char_api_content: 0,
    char_from_ordered_lines: text.trim().length,
    char_raw_text_final: text.trim().length,
    pdf_scanned_heuristic: scannedHeuristic,
  }

  return {
    raw_text: text.trim(),
    structured_lines,
    blocks,
    pageCount,
    warning: r.warning,
    extraction: {
      method: "pdf_parse_fallback",
      pages_processed: pageCount,
      lines_per_page: forensic.lines_per_page,
      lines_total: structured_lines.length,
      blocks_total: blocks.length,
    },
    forensic,
  }
}

/**
 * Extrae PDF o DOCX con la ruta más completa disponible (Azure layout/read > fallbacks locales).
 */
export async function extractSourceDocumentStructured(
  buffer: Buffer,
  meta: SourceDocumentMeta,
): Promise<ExtractDocumentStructuredResult> {
  const kind = detectKind(meta)

  const azure = await extractWithAzure(buffer, meta)
  if (azure && azure.raw_text.trim().length > 0) {
    if (kind === "docx") {
      const mammothPart = await extractDocxMammoth(buffer, meta)
      const merged = mergeTextBodiesNoLoss(azure.raw_text, mammothPart.raw_text)
      if (merged.length !== azure.raw_text.length) {
        return {
          ...azure,
          raw_text: merged,
          forensic: {
            ...azure.forensic,
            char_raw_text_final: merged.length,
            pipeline: `${azure.forensic.pipeline} + mammoth_docx_supplement`,
          },
        }
      }
    }
    return azure
  }

  if (kind === "docx") {
    return extractDocxMammoth(buffer, meta)
  }

  return extractPdfParseFallback(buffer, meta)
}

/** @deprecated Usar extractSourceDocumentStructured; se mantiene para imports existentes. */
export async function extractPdfStructured(buffer: Buffer): Promise<ExtractDocumentStructuredResult> {
  return extractSourceDocumentStructured(buffer, { filename: "document.pdf", mimeType: "application/pdf" })
}

// Tipos compatibles con código que importaba desde extract-pdf-structured
export type PdfExtractionInfo = DocumentExtractionInfo
export type ExtractPdfStructuredResult = ExtractDocumentStructuredResult
