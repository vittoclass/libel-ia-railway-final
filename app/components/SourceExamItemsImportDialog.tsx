"use client"

/**
 * Diálogo para importación masiva de ítems de prueba base (source_exam_items).
 * Permite pegar un listado o subir un PDF; extrae texto, previsualiza e importa solo líneas válidas.
 * Por defecto reemplaza ítems existentes al importar (evita duplicados). Opción de solo añadir.
 */
import * as React from "react"
import { useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, FileUp, FileText, Plus, Trash2, ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useToast } from "@/hooks/use-toast"
import { dedupeParsedLinesByItemNumber, parseBulkItemsText } from "@/app/lib/parse-bulk-items"
import type { ParsedLine } from "@/app/lib/parse-bulk-items"
import type { ItemWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import { inferSuggestedInstrumentTitle, normalizeSourceExamText } from "@/app/lib/normalize-source-exam-text"
import { parseDevelopmentBlocksFromText } from "@/app/lib/parse-development-blocks"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"

const FORMAT_HELP = `Formatos aceptados (una línea por ítem):

1) Estándar (separador " | "): número | enunciado | eje | habilidad | competencia | dificultad
2) SIMCE (tabulador): Nº	CORRECTA	PTJE	EJE   → ej: 1	D	1	Números y Operaciones
3) Desarrollo (separador " | "): Nº | TIPO | PTJE | EJE | HABILIDAD | ENUNCIADO   → TIPO: essay, short_answer, multiple_choice, true_false`

const EXAMPLE = `1 | Calcula el área del triángulo | Geometría | Resolución de problemas | Aplicación | media
2 | Determina el valor de x | Álgebra | Modelación | Procedimiento | media
-- O SIMCE (tabs): 1	D	1	Números
-- O desarrollo: 15 | essay | 4 | Lectura | Argumentación | Explica el conflicto del texto`

const MAX_LINES = 500

function sanitizeEditorItemsForApi(rows: ParsedLine[]): ParsedLine[] {
  const emptyToNull = (s: string | null | undefined): string | null => {
    const t = String(s ?? "").trim()
    return t.length ? t : null
  }
  return rows.map((it) => {
    const n = Math.floor(Number(it.item_number))
    const item_number = Number.isFinite(n) && n >= 1 ? n : 1
    let max_score: number | null = null
    const ms = it.max_score
    if (ms != null) {
      const x =
        typeof ms === "number" && Number.isFinite(ms) ? Math.floor(ms) : parseInt(String(ms), 10)
      if (!Number.isNaN(x) && x >= 0) max_score = x
    }
    return {
      ...it,
      item_number,
      item_text: String(it.item_text ?? "").trim(),
      axis_label: emptyToNull(it.axis_label),
      skill_label: emptyToNull(it.skill_label),
      competence: emptyToNull(it.competence),
      difficulty: emptyToNull(it.difficulty),
      question_type: emptyToNull(it.question_type) as ParsedLine["question_type"],
      correct_answer: emptyToNull(it.correct_answer),
      max_score,
      rubric_text: emptyToNull(it.rubric_text),
      cognitive_level: emptyToNull(it.cognitive_level),
    }
  })
}

function createEmptyParsedLine(itemNumber: number): ParsedLine {
  return {
    item_number: itemNumber,
    item_text: "",
    axis_label: null,
    skill_label: null,
    competence: null,
    difficulty: null,
    question_type: null,
    correct_answer: null,
    max_score: null,
    rubric_text: null,
    cognitive_level: null,
  }
}

function nextItemNumber(rows: ParsedLine[]): number {
  const nums = rows.map((r) => r.item_number).filter((n) => Number.isFinite(n) && n >= 1)
  return nums.length ? Math.max(...nums) + 1 : 1
}

/** Líneas que son encabezados/paginación del documento y no deben mostrarse como inválidas. */
function looksLikeDocumentHeader(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(t)) return true
  if (/^-\s*\d+\s*\/\s*\d+\s*-$/i.test(t)) return true
  if (/^página\s+\d+/i.test(t)) return true
  if (/ensayo\s+simce\s*[n°º]?\s*\d*/i.test(t)) return true
  if (/simce\s+[n°º]?\s*\d+/i.test(t)) return true
  if (/^n[º°]?\s*correcta\s+ptje\s+eje$/i.test(t.replace(/\s+/g, " "))) return true
  if (t.length <= 60 && (t.match(/[A-ZÁÉÍÓÚÑ]/g)?.length ?? 0) / Math.max(t.replace(/\s/g, "").length, 1) >= 0.9) return true
  return false
}

type PdfExtractionInfo = {
  method: string
  pages_processed: number
  lines_per_page: Record<string, number>
  lines_total: number
  blocks_total: number
  azure_content_length?: number
}

type DocumentForensicLite = {
  filename: string
  declared_mime: string
  detected_kind: string
  pipeline: string
  azure_model_used?: string
  pages_detected: number
  pages_processed: number
  paragraphs_detected: number
  tables_detected: number
  table_cells_total: number
  words_approx_total: number
  char_api_content: number
  char_from_ordered_lines: number
  char_raw_text_final: number
  pdf_scanned_heuristic?: boolean
}

type PdfOcrDebugSnapshot = {
  extraction: PdfExtractionInfo
  file_kind?: string
  forensic?: DocumentForensicLite
  /** Muestra parcial para no colgar el DOM; los totales están en extraction. */
  structured_lines_sample: Array<{ page: number; text: string }>
  blocks_sample: Array<{ page: number; blockIndex: number; lineCount: number; text: string }>
}

type Props = {
  sourceExamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

export default function SourceExamItemsImportDialog({
  sourceExamId,
  open,
  onOpenChange,
  onImported,
}: Props) {
  const [text, setText] = useState("")
  const [pdfWarning, setPdfWarning] = useState<string | null>(null)
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null)
  const [instrumentTitle, setInstrumentTitle] = useState("")
  /** true = borrar ítems actuales de esta prueba base antes de insertar (recomendado al reimportar). */
  const [replaceExistingItems, setReplaceExistingItems] = useState(true)
  const [pdfExtracting, setPdfExtracting] = useState(false)
  const [preview, setPreview] = useState<{
    valid: ItemWithPedagogy<ParsedLine>[]
    invalid: { line: string; reason: string }[]
    developmentWarnings?: string[]
  } | null>(null)
  /** Única fuente de verdad de la tabla tras Previsualizar; es lo que se envía en `parsed_items`. */
  const [editorItems, setEditorItems] = useState<ParsedLine[]>([])
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)
  const [unrecognizedOpen, setUnrecognizedOpen] = useState(true)
  const [pdfOcrDebug, setPdfOcrDebug] = useState<PdfOcrDebugSnapshot | null>(null)
  const [pdfOcrPanelOpen, setPdfOcrPanelOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const handlePdfUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const n = file.name?.toLowerCase() ?? ""
      const isPdf = file.type === "application/pdf" || n.endsWith(".pdf")
      const isDocx =
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        n.endsWith(".docx")
      if (!isPdf && !isDocx) {
        toast({ title: "Use PDF o Word (.docx)", variant: "destructive" })
        return
      }
      if (process.env.NODE_ENV !== "production") {
        console.log("[ImportDialog PDF] file selected:", {
          name: file.name,
          size: file.size,
          type: file.type,
        })
      }
      setPdfExtracting(true)
      setPdfWarning(null)
      setPdfOcrDebug(null)
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch(`/api/source-exams/${sourceExamId}/items/extract-pdf-text`, {
          method: "POST",
          credentials: "include",
          body: formData,
        })
        const contentType = res.headers.get("content-type") ?? ""
        let data: {
          text?: string
          raw_text?: string
          pageCount?: number
          warning?: string
          suggested_title?: string
          error?: string
          details?: string
          message?: string
          structured_lines?: Array<{ page: number; text: string; bbox?: number[] }>
          blocks?: Array<{ page: number; blockIndex: number; lineCount: number; text: string }>
          extraction?: PdfExtractionInfo
          forensic?: DocumentForensicLite
          file_kind?: string
        } = {}
        if (contentType.includes("application/json")) {
          data = await res.json().catch((err) => {
            console.error("[ImportDialog PDF] res.json() failed:", err?.message ?? err)
            return {}
          })
        } else {
          const bodyText = await res.text()
          if (process.env.NODE_ENV !== "production") {
            console.log("[ImportDialog PDF] response not JSON, status:", res.status, "body preview:", bodyText.slice(0, 200))
          }
          toast({
            title: "Error al extraer PDF",
            description: `Respuesta inesperada (${res.status}). Revise la consola del servidor.`,
            variant: "destructive",
          })
          return
        }
        if (process.env.NODE_ENV !== "production") {
          console.log("[ImportDialog PDF] response:", {
            ok: res.ok,
            status: res.status,
            hasText: typeof data.text === "string",
            textLength: typeof data.text === "string" ? data.text.length : 0,
            pageCount: data.pageCount,
            extraction: data.extraction,
            structured_lines: data.structured_lines?.length,
            blocks: data.blocks?.length,
            error: data.error,
          })
        }
        if (res.ok) {
          const rawText = typeof data.text === "string" ? data.text : ""
          const normalized = normalizeSourceExamText(rawText)
          if (process.env.NODE_ENV !== "production") {
            console.log("[ImportDialog PDF] normalized_text length:", normalized.normalized_text?.length ?? 0)
          }
          setText(normalized.normalized_text)
          setPreview(null)
          if (data.extraction && typeof data.extraction.method === "string") {
            const sl = Array.isArray(data.structured_lines) ? data.structured_lines : []
            const bl = Array.isArray(data.blocks) ? data.blocks : []
            setPdfOcrDebug({
              extraction: data.extraction,
              file_kind: typeof data.file_kind === "string" ? data.file_kind : undefined,
              forensic: data.forensic,
              structured_lines_sample: sl.slice(0, 80).map((l) => ({
                page: l.page,
                text: typeof l.text === "string" ? l.text : "",
              })),
              blocks_sample: bl.slice(0, 30).map((b) => ({
                page: b.page,
                blockIndex: b.blockIndex,
                lineCount: b.lineCount,
                text: typeof b.text === "string" ? b.text : "",
              })),
            })
            setPdfOcrPanelOpen(true)
          } else {
            setPdfOcrDebug(null)
          }
          const fromApi =
            typeof data.suggested_title === "string" && data.suggested_title.trim()
              ? data.suggested_title.trim()
              : ""
          const inferred =
            normalized.suggested_title || inferSuggestedInstrumentTitle(rawText) || ""
          const titleHint = fromApi || inferred || null
          const baseName =
            file.name?.replace(/\.(pdf|docx)$/i, "").replace(/[-_]+/g, " ").trim() || ""
          setSuggestedTitle(titleHint)
          setInstrumentTitle((prev) => {
            if (prev.trim()) return prev
            return titleHint || baseName || ""
          })
          if (data.warning) setPdfWarning(data.warning)
          else if (normalized.warnings.length > 0) setPdfWarning(normalized.warnings.join(" "))
          else setPdfWarning(null)
          if (rawText.length === 0) {
            setPdfWarning(
              "No se extrajo texto del archivo (¿PDF escaneado o vacío?). Pegue el contenido manualmente o use DOCX/Azure OCR."
            )
            toast({
              title: "Sin texto extraíble",
              description: "No se encontró texto. Revise el archivo, configure Azure OCR o pegue el contenido.",
              variant: "destructive",
            })
          } else {
            toast({
              title: "Documento extraído",
              description: data.pageCount
                ? `${data.pageCount} página(s) detectadas. Revise el texto y previsualice.`
                : "Revise el texto y previsualice.",
            })
          }
        } else {
          const errorMsg = data.error || "Error al extraer texto"
          const detailsMsg = data.details || data.message || `Código ${res.status}`
          toast({
            title: errorMsg,
            description: detailsMsg,
            variant: "destructive",
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("[ImportDialog PDF] catch:", msg)
        toast({
          title: "Error de conexión al extraer el documento",
          description: msg,
          variant: "destructive",
        })
      } finally {
        setPdfExtracting(false)
        e.target.value = ""
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    },
    [sourceExamId, toast]
  )

  const handlePreview = useCallback(() => {
    const result = parseBulkItemsText(text)
    const dev = parseDevelopmentBlocksFromText(text)
    const bulkFiltered = result.valid.filter(
      (p) => !dev.items.some((d) => p.item_text === `Pregunta ${d.item_number}`)
    )
    const validMerged = dedupeParsedLinesByItemNumber([...bulkFiltered, ...dev.items])
    const enriched = enrichItemsWithPedagogy(validMerged)
    const consumedSet = new Set(dev.consumedLines.map((l) => l.trim()))
    const invalidFiltered = result.invalid.filter(
      (inv) => !consumedSet.has(inv.line.trim()) && !looksLikeDocumentHeader(inv.line)
    )
    const inferred = inferSuggestedInstrumentTitle(text) || null
    setSuggestedTitle((prev) => prev || inferred)
    setInstrumentTitle((prev) => {
      if (prev.trim()) return prev
      return inferred || prev
    })
    setPreview({
      valid: enriched,
      invalid: invalidFiltered,
      developmentWarnings: dev.warnings.length > 0 ? dev.warnings : undefined,
    })
    setEditorItems(
      validMerged.map((p) => ({
        item_number: p.item_number,
        item_text: p.item_text,
        axis_label: p.axis_label ?? null,
        skill_label: p.skill_label ?? null,
        competence: p.competence ?? null,
        difficulty: p.difficulty ?? null,
        question_type: p.question_type ?? null,
        correct_answer: p.correct_answer ?? null,
        max_score: p.max_score ?? null,
        rubric_text: p.rubric_text ?? null,
        cognitive_level: p.cognitive_level ?? null,
      })),
    )
  }, [text])

  const handleImport = useCallback(async () => {
    const result = parseBulkItemsText(text)
    const dev = parseDevelopmentBlocksFromText(text)
    const bulkFiltered = result.valid.filter(
      (p) => !dev.items.some((d) => p.item_text === `Pregunta ${d.item_number}`)
    )
    const validFromParsed = dedupeParsedLinesByItemNumber([...bulkFiltered, ...dev.items])
    const editedFiltered = dedupeParsedLinesByItemNumber(
      sanitizeEditorItemsForApi(editorItems).filter(
        (it) => Number(it.item_number) >= 1 && String(it.item_text || "").trim().length > 0,
      ),
    )
    // Tras Previsualizar, solo cuenta la tabla (puedes vaciarla o añadir filas a mano); sin previsualizar, el texto parseado.
    const sourceForImport = preview !== null ? editedFiltered : validFromParsed
    const titleTrim = instrumentTitle.trim()
    if (sourceForImport.length === 0 && !titleTrim) {
      toast({
        title: "Sin ítems ni título",
        description: result.invalid.length
          ? `${result.invalid.length} línea(s) con error. Corrija el formato, indique un título o previsualice de nuevo.`
          : "Pegue un listado con el formato indicado o escriba un título para guardar solo el nombre del instrumento.",
        variant: "destructive",
      })
      return
    }
    if (sourceForImport.length > MAX_LINES) {
      toast({
        title: "Límite excedido",
        description: `Máximo ${MAX_LINES} líneas por importación. Tiene ${sourceForImport.length} válidas.`,
        variant: "destructive",
      })
      return
    }
    setImporting(true)
    try {
      const body: Record<string, unknown> = {
        text,
        instrument_title: titleTrim || undefined,
        replace_items: replaceExistingItems,
      }
      // Solo tras Previsualizar: el servidor NO debe re-parsear ni normalizar semánticamente; solo sanitiza `parsed_items`.
      if (preview !== null) {
        body.parsed_items = editedFiltered
        body.editor_import_source = true
      }
      const res = await fetch(`/api/source-exams/${sourceExamId}/items/import`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        credentials: "include",
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.ok) {
        const inserted = Number(data.inserted ?? 0)
        const titleUpdated = data.title_updated === true
        toast({
          title: (data.message as string) || (inserted > 0 ? `Importados ${inserted} ítem(s).` : "Sin ítems importados."),
          description:
            Number(data.invalid ?? 0) > 0
              ? `${data.invalid} línea(s) inválida(s) no importadas.`
              : undefined,
        })
        if (inserted > 0 || titleUpdated) {
          setText("")
          setPreview(null)
          setEditorItems([])
          setSourcePanelOpen(true)
          setUnrecognizedOpen(true)
          setInstrumentTitle("")
          setSuggestedTitle(null)
          onImported()
          onOpenChange(false)
        }
      } else {
        const debugPayload = { httpStatus: res.status, ...data }
        alert(JSON.stringify(debugPayload, null, 2))
        toast({
          title: (data.error as string) || "Error al importar",
          description: (Array.isArray(data.errors) ? data.errors : []).slice(0, 3).join(" ") || (data.message as string),
          variant: "destructive",
        })
      }
    } catch (e) {
      alert(
        JSON.stringify(
          {
            error: "fetch_failed",
            message: e instanceof Error ? e.message : String(e),
          },
          null,
          2,
        ),
      )
      toast({ title: "Error de conexión", variant: "destructive" })
    } finally {
      setImporting(false)
      queueMicrotask(() => setImporting(false))
    }
  }, [text, instrumentTitle, replaceExistingItems, sourceExamId, onImported, onOpenChange, toast, editorItems, preview])

  const onClose = useCallback(
    (open: boolean) => {
      if (!open && !importing) {
        setText("")
        setPreview(null)
        setEditorItems([])
        setSourcePanelOpen(true)
        setUnrecognizedOpen(true)
        setPdfOcrDebug(null)
        setPdfOcrPanelOpen(false)
        setPdfWarning(null)
        setSuggestedTitle(null)
        setInstrumentTitle("")
      }
      onOpenChange(open)
    },
    [importing, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[min(96vw,72rem)] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" /> Importar ítems
          </DialogTitle>
          <DialogDescription>
            Pegue un listado, suba un <strong>PDF</strong> o un <strong>Word (.docx)</strong>. El texto extraído se muestra completo abajo; la tabla de ítems es opcional tras Previsualizar. Con Azure configurado se usa OCR estructurado (layout) para no perder tablas ni bloques.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 overflow-auto flex-1 min-h-0">
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 p-3 bg-muted/30">
            <Label className="flex items-center gap-1.5 text-sm font-medium shrink-0">
              <FileText className="h-4 w-4" /> Subir archivo
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={handlePdfUpload}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pdfExtracting}
              onClick={() => fileInputRef.current?.click()}
            >
              {pdfExtracting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {pdfExtracting ? "Extrayendo…" : "PDF o DOCX"}
            </Button>
            <span className="text-xs text-muted-foreground">
              PDF o DOCX. OCR Azure recomendado para escaneados y tablas. Máx. 10 MB.
            </span>
          </div>
          {pdfWarning && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              {pdfWarning}
            </div>
          )}
          {pdfOcrDebug && (
            <Collapsible open={pdfOcrPanelOpen} onOpenChange={setPdfOcrPanelOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
                <span>
                  Depuración extracción ({pdfOcrDebug.file_kind ?? "?"}) — {pdfOcrDebug.extraction.method} · págs.{" "}
                  {pdfOcrDebug.extraction.pages_processed} · líneas {pdfOcrDebug.extraction.lines_total} · bloques{" "}
                  {pdfOcrDebug.extraction.blocks_total}
                  {pdfOcrDebug.forensic
                    ? ` · tablas ${pdfOcrDebug.forensic.tables_detected} · párrafos ${pdfOcrDebug.forensic.paragraphs_detected}`
                    : ""}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${pdfOcrPanelOpen ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2 text-xs">
                {pdfOcrDebug.forensic ? (
                  <div className="rounded border bg-muted/20 p-2 space-y-1">
                    <p className="font-medium m-0">Forense (servidor)</p>
                    <p className="text-muted-foreground m-0">
                      Archivo: {pdfOcrDebug.forensic.filename} · MIME: {pdfOcrDebug.forensic.declared_mime || "—"} ·
                      pipeline: {pdfOcrDebug.forensic.pipeline}
                      {pdfOcrDebug.forensic.azure_model_used
                        ? ` · modelo Azure: ${pdfOcrDebug.forensic.azure_model_used}`
                        : ""}
                    </p>
                    <p className="m-0">
                      Palabras≈{pdfOcrDebug.forensic.words_approx_total} · celdas tabla:{" "}
                      {pdfOcrDebug.forensic.table_cells_total} · chars finales: {pdfOcrDebug.forensic.char_raw_text_final}{" "}
                      (content/embed: {pdfOcrDebug.forensic.char_api_content}, líneas ordenadas:{" "}
                      {pdfOcrDebug.forensic.char_from_ordered_lines})
                    </p>
                    {pdfOcrDebug.forensic.pdf_scanned_heuristic ? (
                      <p className="text-amber-700 dark:text-amber-300 m-0">
                        Heurística: posible PDF escaneado / poco texto incrustado.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div>
                  <p className="font-medium text-foreground mb-1">Líneas por página (servidor)</p>
                  <pre className="max-h-24 overflow-auto rounded border bg-muted/30 p-2 text-[11px] whitespace-pre-wrap">
                    {JSON.stringify(pdfOcrDebug.extraction.lines_per_page, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">
                    Muestra de líneas OCR ({pdfOcrDebug.structured_lines_sample.length} de{" "}
                    {pdfOcrDebug.extraction.lines_total})
                  </p>
                  <ul className="max-h-40 overflow-auto rounded border bg-background p-2 space-y-1 list-none m-0">
                    {pdfOcrDebug.structured_lines_sample.map((l, i) => (
                      <li key={`ocr-line-${i}`} className="border-b border-border/50 pb-1 last:border-0">
                        <span className="text-muted-foreground">p.{l.page}</span> {l.text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">
                    Muestra de bloques ({pdfOcrDebug.blocks_sample.length} de {pdfOcrDebug.extraction.blocks_total})
                  </p>
                  <ul className="max-h-48 overflow-auto rounded border bg-background p-2 space-y-2 list-none m-0">
                    {pdfOcrDebug.blocks_sample.map((b, i) => (
                      <li key={`blk-${i}`} className="rounded bg-muted/20 p-2 whitespace-pre-wrap">
                        <span className="text-muted-foreground">
                          Pág. {b.page} · bloque {b.blockIndex} · {b.lineCount} línea(s)
                        </span>
                        <br />
                        {b.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="source-exam-instrument-title">Título del instrumento (se guarda al importar)</Label>
            <Input
              id="source-exam-instrument-title"
              value={instrumentTitle}
              onChange={(e) => setInstrumentTitle(e.target.value)}
              placeholder="Ej. Prueba unidad 3 — 4° medio"
              className="text-sm"
            />
            {suggestedTitle ? (
              <p className="text-xs text-muted-foreground m-0">
                Sugerencia según el texto o el PDF: <span className="text-foreground/90">{suggestedTitle}</span>
              </p>
            ) : null}
          </div>
          {preview?.developmentWarnings && preview.developmentWarnings.length > 0 && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              <span className="font-medium">Desarrollo detectado:</span>{" "}
              {preview.developmentWarnings.join(" ")}
            </div>
          )}
          {!preview && (
            <>
              <div>
                <Label>Listado o texto extraído (editable)</Label>
                <textarea
                  className="mt-1 w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder={EXAMPLE}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">{FORMAT_HELP}</div>
            </>
          )}
          {preview && (
            <div className="border rounded-md overflow-auto max-h-[min(70vh,520px)]">
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 text-xs border-b bg-muted/30">
                <span className="text-muted-foreground">
                  Modo híbrido: la tabla es lo que se importa. Añade o quita filas; el tipo (p. ej. desarrollo) y la clave se
                  respetan al guardar.
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0 h-8"
                  onClick={() =>
                    setEditorItems((prev) => [...prev, createEmptyParsedLine(nextItemNumber(prev))])
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Añadir ítem
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Nº</TableHead>
                    <TableHead>Texto</TableHead>
                    <TableHead className="w-[8.5rem]">Tipo</TableHead>
                    <TableHead className="w-14">Puntaje</TableHead>
                    <TableHead className="w-28">Eje</TableHead>
                    <TableHead className="w-28">Habilidad</TableHead>
                    <TableHead className="w-24">Nivel cognitivo</TableHead>
                    <TableHead className="w-20">Dificultad</TableHead>
                    <TableHead className="w-28 max-w-[180px]">Rúbrica</TableHead>
                    <TableHead className="w-20">Clave</TableHead>
                    <TableHead className="w-12 text-center">—</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editorItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-xs text-muted-foreground py-6">
                        No hay filas todavía. Use &quot;Añadir ítem&quot; o pulse Previsualizar de nuevo tras pegar el listado.
                      </TableCell>
                    </TableRow>
                  )}
                  {editorItems.map((p, i) => (
                    <TableRow key={`v-${i}-${p.item_number}`}>
                      <TableCell>
                        <Input
                          className="h-8 w-16"
                          value={String(p.item_number)}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, item_number: Math.max(1, parseInt(e.target.value || "1", 10) || 1) } : row,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <textarea
                          className="w-full min-h-[52px] rounded border border-input bg-background px-2 py-1 text-xs"
                          value={p.item_text}
                          onChange={(e) =>
                            setEditorItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, item_text: e.target.value } : row)))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        <select
                          className="h-8 rounded border border-input bg-background px-1 text-xs"
                          value={p.question_type ?? ""}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) => (idx === i ? { ...row, question_type: e.target.value || null } : row)),
                            )
                          }
                        >
                          <option value="">— (automático solo si vacío)</option>
                          <option value="multiple_choice">Alternativas</option>
                          <option value="true_false">Verdadero / falso</option>
                          <option value="short_answer">Respuesta corta</option>
                          <option value="essay">Desarrollo (essay)</option>
                          <option value="completion">Completar (completion)</option>
                        </select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-16"
                          value={p.max_score ?? ""}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i
                                  ? { ...row, max_score: e.target.value === "" ? null : Math.max(0, parseInt(e.target.value || "0", 10) || 0) }
                                  : row,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="max-w-[120px] p-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Eje"
                          value={p.axis_label ?? ""}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, axis_label: e.target.value.trim() || null } : row,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="max-w-[120px] p-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Habilidad"
                          value={p.skill_label ?? ""}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, skill_label: e.target.value.trim() || null } : row,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="max-w-[100px] p-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Nivel cognitivo"
                          value={p.cognitive_level ?? ""}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, cognitive_level: e.target.value.trim() || null } : row,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="truncate text-xs">{p.difficulty ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px]">
                        <textarea
                          className="w-full min-h-[52px] rounded border border-input bg-background px-2 py-1 text-xs"
                          value={p.rubric_text ?? ""}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) => (idx === i ? { ...row, rubric_text: e.target.value || null } : row)),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        <Input
                          className="h-8 w-16"
                          placeholder="A/B/..."
                          value={p.correct_answer ?? ""}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, correct_answer: e.target.value.trim().toUpperCase() || null } : row,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title="Quitar ítem de la importación"
                          onClick={() => setEditorItems((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {editorItems.length > MAX_LINES && (
                <p className="text-xs text-muted-foreground px-2 py-1 border-t">
                  Hay {editorItems.length} filas; el máximo por importación es {MAX_LINES}.
                </p>
              )}
            </div>
          )}
          {preview && (
            <div className="space-y-2">
              <Collapsible open={sourcePanelOpen} onOpenChange={setSourcePanelOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
                  <span>Texto fuente (apoyo para copiar/pegar)</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${sourcePanelOpen ? "rotate-180" : ""}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  <p className="text-xs text-muted-foreground m-0">
                    Editar aquí no cambia la tabla hasta que pulse <strong>Previsualizar</strong>. La importación usa solo la
                    tabla de arriba.
                  </p>
                  <textarea
                    className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder={EXAMPLE}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    spellCheck={false}
                  />
                </CollapsibleContent>
              </Collapsible>
              <Collapsible open={unrecognizedOpen} onOpenChange={setUnrecognizedOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
                  <span>
                    Líneas no reconocidas como ítems
                    {preview.invalid.length > 0 ? ` (${preview.invalid.length})` : ""}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${unrecognizedOpen ? "rotate-180" : ""}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  {preview.invalid.length === 0 ? (
                    <p className="text-xs text-muted-foreground m-0">No hay líneas marcadas como inválidas en el último parse.</p>
                  ) : (
                    <ul className="max-h-[200px] overflow-auto rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive space-y-2 list-none m-0">
                      {preview.invalid.map((inv, i) => (
                        <li key={`inv-${i}`}>
                          <span className="font-medium">{inv.reason}:</span> &quot;{inv.line}&quot;
                        </li>
                      ))}
                    </ul>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <Checkbox
              id="source-exam-replace-items"
              checked={replaceExistingItems}
              onCheckedChange={(v) => setReplaceExistingItems(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="source-exam-replace-items" className="text-sm font-normal leading-snug cursor-pointer">
              Reemplazar ítems ya guardados en esta prueba base (recomendado). Si lo desactiva, los nuevos se suman a los
              existentes y puede repetirse el mismo número de ítem.
            </Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handlePreview}>
              Previsualizar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleImport}
              disabled={importing || (!text.trim() && !preview)}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Importar ítems válidos
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={importing}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
