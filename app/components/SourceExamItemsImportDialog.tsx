"use client"

/**
 * Diálogo para importación masiva de ítems de prueba base (source_exam_items).
 * Permite pegar un listado o subir un PDF; extrae texto, previsualiza e importa solo líneas válidas.
 * Por defecto reemplaza ítems existentes al importar (evita duplicados). Opción de solo añadir.
 */
import * as React from "react"
import { useState, useCallback, useRef, useEffect } from "react"
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
import { Loader2, FileUp, FileText, Plus, Trash2, ChevronDown, Sparkles, ShieldCheck } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
/** Smart Import: evita spinner infinito si el modelo o la red tardan demasiado. */
const SMART_EXTRACT_FETCH_MS = 360_000
const VALIDATE_PRACTICE_FETCH_MS = 360_000

type ValidatePracticeAlert = {
  severity: string
  code: string
  item_number: number | null
  detail: string
  base_preview: string | null
  real_preview: string | null
}

type ValidatePracticeSummary = {
  base_alternative_count: number
  real_alternative_count: number
  missing_in_real_count: number
  extra_in_real_count: number
  key_mismatch_count: number
  type_mismatch_count: number
  text_very_different_count: number
  order_unusual_in_real: boolean
  key_missing_in_real_count: number
}

const SEP_PIPE = " | "

/** Sincroniza el panel "Texto fuente" con el formato estándar (Nº | enunciado | eje | habilidad | competencia | dificultad). */
function smartExtractRowsToStandardSourceText(rows: ParsedLine[]): string {
  const esc = (s: string | null | undefined) => String(s ?? "").replace(/\|/g, "¦").trim()
  return rows
    .map((r) =>
      [r.item_number, esc(r.item_text), esc(r.axis_label), esc(r.skill_label), esc(r.competence), esc(r.difficulty)].join(
        SEP_PIPE,
      ),
    )
    .join("\n")
}

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
  /** Título de la prueba base activa (banco); se muestra en banner para evitar ambigüedad. */
  sourceExamTitle?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

export default function SourceExamItemsImportDialog({
  sourceExamId,
  sourceExamTitle = "",
  open,
  onOpenChange,
  onImported,
}: Props) {
  const hasActiveBase = typeof sourceExamId === "string" && sourceExamId.trim().length > 0
  const displayTitle = sourceExamTitle.trim() || "(Sin título)"
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
  const [importTab, setImportTab] = useState<"manual" | "smart">("manual")
  const [smartExtracting, setSmartExtracting] = useState(false)
  const [validatePracticeLoading, setValidatePracticeLoading] = useState(false)
  const [validatePracticeResult, setValidatePracticeResult] = useState<{
    summary: ValidatePracticeSummary
    alerts: ValidatePracticeAlert[]
    meta?: Record<string, unknown>
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const smartFileInputRef = useRef<HTMLInputElement>(null)
  const validatePracticeFileInputRef = useRef<HTMLInputElement>(null)
  const previewTableRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      setValidatePracticeResult(null)
    }
  }, [open, sourceExamId])

  const handlePdfUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!hasActiveBase) {
        toast({
          title: "Sin prueba base activa",
          description: "Cierre este diálogo, elija una prueba base en el banco y vuelva a abrir Importar ítems.",
          variant: "destructive",
        })
        e.target.value = ""
        return
      }
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
    [sourceExamId, toast, hasActiveBase]
  )

  const handlePreview = useCallback(() => {
    if (!hasActiveBase) {
      toast({
        title: "Sin prueba base activa",
        description: "Abra Importar ítems desde una prueba base seleccionada en el banco.",
        variant: "destructive",
      })
      return
    }
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
  }, [text, hasActiveBase, toast])

  const handleImport = useCallback(async () => {
    if (!hasActiveBase) {
      toast({
        title: "Sin prueba base activa",
        description: "Abra Importar ítems desde una prueba base seleccionada en el banco.",
        variant: "destructive",
      })
      return
    }
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
  }, [
    text,
    instrumentTitle,
    replaceExistingItems,
    sourceExamId,
    onImported,
    onOpenChange,
    toast,
    editorItems,
    preview,
    hasActiveBase,
  ])

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
        setImportTab("manual")
        setValidatePracticeResult(null)
        setValidatePracticeLoading(false)
      }
      onOpenChange(open)
    },
    [importing, onOpenChange]
  )

  const handleSmartExtractUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!hasActiveBase) {
        toast({
          title: "Sin prueba base activa",
          description: "Abra Importar ítems desde una prueba base seleccionada en el banco.",
          variant: "destructive",
        })
        e.target.value = ""
        return
      }
      const file = e.target.files?.[0]
      if (!file) return
      const n = file.name?.toLowerCase() ?? ""
      const ok =
        file.type === "application/pdf" ||
        n.endsWith(".pdf") ||
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        n.endsWith(".docx")
      if (!ok) {
        toast({ title: "Use PDF o Word (.docx)", variant: "destructive" })
        e.target.value = ""
        return
      }
      setSmartExtracting(true)
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), SMART_EXTRACT_FETCH_MS)
      try {
        const fd = new FormData()
        fd.append("file", file)
        fd.append("source_exam_id", sourceExamId)
        const res = await fetch("/api/source-exams/smart-extract", {
          method: "POST",
          credentials: "include",
          body: fd,
          signal: controller.signal,
        })

        const ct = res.headers.get("content-type") ?? ""
        let data: {
          items?: Array<Record<string, unknown>>
          error?: string
          details?: string
          warnings?: string[]
          meta?: { items_returned?: number }
          anthropic_status?: number | null
          anthropic_type?: string | null
        } = {}
        let bodyParseNote: string | null = null
        try {
          if (ct.includes("application/json")) {
            data = (await res.json()) as typeof data
          } else {
            const txt = await res.text()
            bodyParseNote = txt ? `Respuesta no JSON (${res.status}): ${txt.slice(0, 280)}` : `Respuesta vacía (${res.status})`
          }
        } catch (parseErr) {
          bodyParseNote = parseErr instanceof Error ? parseErr.message : String(parseErr)
        }

        if (process.env.NODE_ENV !== "production") {
          console.log("[IA Smart Import] response", {
            httpStatus: res.status,
            ok: res.ok,
            error: data.error,
            itemsCount: Array.isArray(data.items) ? data.items.length : 0,
            anthropic_status: data.anthropic_status,
            bodyParseNote,
          })
        }

        const showSmartFailure = (title: string, description?: string) => {
          toast({ title, description, variant: "destructive", duration: 12_000 })
        }

        if (bodyParseNote) {
          showSmartFailure("No se pudo leer la respuesta del servidor", bodyParseNote)
          return
        }

        if (!res.ok) {
          showSmartFailure(
            data.error || `Error del servidor (${res.status})`,
            [
              data.details,
              data.anthropic_status != null ? `Anthropic (upstream): HTTP ${data.anthropic_status}` : "",
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          )
          return
        }

        const rawItems = Array.isArray(data.items) ? data.items : []
        const itemsEffectivelyEmpty = rawItems.length === 0

        if (itemsEffectivelyEmpty && typeof data.error === "string" && data.error.trim()) {
          showSmartFailure(
            data.error.trim(),
            data.details?.trim() || data.warnings?.filter(Boolean).join(" ") || undefined,
          )
          return
        }
        const rows: ParsedLine[] = rawItems.map((it, idx) => {
          const num = Number(it.item_number)
          const item_number = Number.isFinite(num) && num >= 1 ? Math.floor(num) : idx + 1
          const qt = typeof it.question_type === "string" ? it.question_type.trim().toLowerCase() : ""
          const allowed = ["multiple_choice", "true_false", "short_answer", "essay", "completion"] as const
          const question_type = (allowed as readonly string[]).includes(qt) ? qt : null
          const ms = it.max_score
          let max_score: number | null = null
          if (typeof ms === "number" && Number.isFinite(ms)) max_score = Math.max(0, Math.floor(ms))
          else if (ms != null) {
            const x = parseInt(String(ms), 10)
            if (!Number.isNaN(x) && x >= 0) max_score = x
          }
          return {
            item_number,
            item_text: String(it.item_text ?? "").trim(),
            axis_label: typeof it.axis_label === "string" && it.axis_label.trim() ? it.axis_label.trim() : null,
            skill_label: typeof it.skill_label === "string" && it.skill_label.trim() ? it.skill_label.trim() : null,
            cognitive_level:
              typeof it.cognitive_level === "string" && it.cognitive_level.trim() ? it.cognitive_level.trim() : null,
            competence: typeof it.competence === "string" && it.competence.trim() ? it.competence.trim() : null,
            difficulty: typeof it.difficulty === "string" && it.difficulty.trim() ? it.difficulty.trim() : null,
            question_type: question_type as ParsedLine["question_type"],
            correct_answer:
              typeof it.correct_answer === "string" && it.correct_answer.trim()
                ? it.correct_answer.trim().toUpperCase()
                : null,
            max_score,
            rubric_text: typeof it.rubric_text === "string" && it.rubric_text.trim() ? it.rubric_text.trim() : null,
          }
        })
        const merged = dedupeParsedLinesByItemNumber(rows).filter((r) => r.item_text.trim().length > 0)
        const capped = merged.slice(0, MAX_LINES)
        if (merged.length > MAX_LINES) {
          toast({
            title: "Límite de filas",
            description: `Solo se cargaron las primeras ${MAX_LINES} ítems.`,
            variant: "destructive",
          })
        }
        if (capped.length === 0) {
          showSmartFailure(
            data.error?.trim() || "Sin ítems con confianza suficiente",
            [
              data.details?.trim(),
              data.warnings?.filter(Boolean).join(" "),
              "Si el servidor devolvió 200 sin ítems, revise logs [smart-extract], avisos JSON en la respuesta o el umbral en smart-base-parser.",
            ]
              .filter(Boolean)
              .join(" ") || undefined,
          )
          return
        }
        const enriched = enrichItemsWithPedagogy(capped)
        setPreview({ valid: enriched, invalid: [] })
        setEditorItems(capped)
        setSourcePanelOpen(false)
        setUnrecognizedOpen(false)
        setText(smartExtractRowsToStandardSourceText(capped))
        const baseName = file.name?.replace(/\.(pdf|docx)$/i, "").replace(/[-_]+/g, " ").trim() || ""
        setInstrumentTitle((prev) => (prev.trim() ? prev : baseName))
        setImportTab("manual")
        toast({
          title: "Extracción IA completada",
          description: `${capped.length} ítem(s) en la tabla (Eje, Habilidad, Clave y demás columnas). Revise y pulse Importar cuando esté listo.`,
        })
        if (data.warnings && data.warnings.length > 0) {
          const structural = data.warnings.some(
            (w) =>
              w.includes('"items"') ||
              w.includes("no es un arreglo") ||
              w.includes("no contiene la clave") ||
              w.includes("JSON no es válido") ||
              w.includes("tabla de ítems"),
          )
          toast({
            title: structural ? "Aviso: formato de salida de la IA" : "Avisos (Smart Import)",
            description: data.warnings.join(" "),
            variant: structural ? "destructive" : "default",
            duration: structural ? 14_000 : 10_000,
          })
        }
        window.setTimeout(() => {
          previewTableRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }, 80)
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError"
        const msg = err instanceof Error ? err.message : String(err)
        if (process.env.NODE_ENV !== "production") {
          console.error("[IA Smart Import] catch:", err)
        }
        toast({
          title: aborted ? "Tiempo de espera agotado (IA)" : "Error de conexión (IA)",
          description: aborted
            ? `La petición superó ${Math.round(SMART_EXTRACT_FETCH_MS / 60_000)} minutos. Pruebe un archivo más pequeño o revise Railway/logs del servidor.`
            : msg,
          variant: "destructive",
          duration: 12_000,
        })
      } finally {
        window.clearTimeout(timeoutId)
        setSmartExtracting(false)
        e.target.value = ""
        if (smartFileInputRef.current) smartFileInputRef.current.value = ""
      }
    },
    [sourceExamId, toast, hasActiveBase],
  )

  const handleValidatePracticeUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!hasActiveBase) {
        toast({
          title: "Sin prueba base activa",
          description: "Abra Importar ítems desde una prueba base seleccionada en el banco.",
          variant: "destructive",
        })
        e.target.value = ""
        return
      }
      const file = e.target.files?.[0]
      if (!file) return
      const n = file.name?.toLowerCase() ?? ""
      const ok =
        file.type === "application/pdf" ||
        n.endsWith(".pdf") ||
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        n.endsWith(".docx")
      if (!ok) {
        toast({ title: "Use PDF o Word (.docx)", variant: "destructive" })
        e.target.value = ""
        return
      }
      setValidatePracticeLoading(true)
      setValidatePracticeResult(null)
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), VALIDATE_PRACTICE_FETCH_MS)
      try {
        const fd = new FormData()
        fd.append("file", file)
        const res = await fetch(`/api/source-exams/${sourceExamId}/validate-practice`, {
          method: "POST",
          credentials: "include",
          body: fd,
          signal: controller.signal,
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          summary?: ValidatePracticeSummary
          alerts?: ValidatePracticeAlert[]
          meta?: Record<string, unknown>
          error?: string
          details?: string
        }
        if (process.env.NODE_ENV !== "production") {
          console.log("[Validar prueba] response", { httpStatus: res.status, ok: data.ok, summary: data.summary })
        }
        if (!res.ok || data.ok === false) {
          toast({
            title: data.error || `Error (${res.status})`,
            description: data.details,
            variant: "destructive",
            duration: 14_000,
          })
          return
        }
        if (data.summary && Array.isArray(data.alerts)) {
          setValidatePracticeResult({
            summary: data.summary,
            alerts: data.alerts,
            meta: data.meta,
          })
          toast({
            title: "Validación completada",
            description: `Base (alternativas): ${data.summary.base_alternative_count} · Detectadas en archivo: ${data.summary.real_alternative_count}. Revise alertas abajo; no se modificó la prueba base.`,
            duration: 12_000,
          })
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError"
        toast({
          title: aborted ? "Tiempo de espera (validación)" : "Error de conexión",
          description: aborted
            ? "La validación superó el tiempo máximo. Intente con un archivo más pequeño."
            : err instanceof Error
              ? err.message
              : String(err),
          variant: "destructive",
        })
      } finally {
        window.clearTimeout(timeoutId)
        setValidatePracticeLoading(false)
        e.target.value = ""
        if (validatePracticeFileInputRef.current) validatePracticeFileInputRef.current.value = ""
      }
    },
    [sourceExamId, toast, hasActiveBase],
  )

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[min(96vw,72rem)] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" /> Importar ítems
          </DialogTitle>
          <DialogDescription>
            <strong>Manual / PDF:</strong> pegue un listado o suba PDF/DOCX como siempre. <strong>IA Smart Import:</strong> opcional;
            requiere <code className="text-xs">ANTHROPIC_API_KEY</code>. Revise la tabla antes de importar; no altera OMR ni el
            guardado existente.
          </DialogDescription>
        </DialogHeader>
        <div
          className={`rounded-md border px-3 py-2 text-sm shrink-0 ${hasActiveBase ? "border-primary/50 bg-primary/5" : "border-destructive/50 bg-destructive/10"}`}
          role="status"
        >
          <span className="font-semibold text-foreground">Prueba base activa: </span>
          {hasActiveBase ? (
            <span className="text-foreground/90">{displayTitle}</span>
          ) : (
            <span className="text-destructive font-medium">
              ninguna — cierre y elija una prueba en el banco antes de importar o validar.
            </span>
          )}
          {hasActiveBase ? (
            <span className="block text-[11px] text-muted-foreground font-mono mt-1 break-all">ID: {sourceExamId.trim()}</span>
          ) : null}
        </div>
        {!hasActiveBase ? (
          <p className="text-xs text-destructive m-0 shrink-0">
            Importar, IA Smart Import y validar prueba subida están deshabilitados hasta tener una prueba base activa.
          </p>
        ) : null}
        <div className="space-y-1.5 shrink-0">
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
        <Tabs
          value={importTab}
          onValueChange={(v) => setImportTab(v as "manual" | "smart")}
          className="flex flex-col flex-1 min-h-0 gap-2"
        >
          <TabsList className="shrink-0 w-full max-w-lg justify-start">
            <TabsTrigger value="manual">Manual / PDF</TabsTrigger>
            <TabsTrigger value="smart" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              IA Smart Import
            </TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="flex-1 min-h-0 overflow-hidden mt-0 data-[state=inactive]:hidden">
            <div className="space-y-3 overflow-auto max-h-[min(58vh,480px)] pr-1">
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
              disabled={pdfExtracting || !hasActiveBase}
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
            <div
              ref={previewTableRef}
              className="border rounded-md overflow-auto max-h-[min(70vh,520px)] scroll-mt-4"
            >
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
                      <TableCell className="max-w-[100px] p-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Dificultad"
                          value={p.difficulty ?? ""}
                          onChange={(e) =>
                            setEditorItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, difficulty: e.target.value.trim() || null } : row,
                              ),
                            )
                          }
                        />
                      </TableCell>
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
            </div>
          </TabsContent>
          <TabsContent value="smart" className="mt-0 space-y-3 data-[state=inactive]:hidden overflow-auto max-h-[min(36vh,280px)] pr-1">
            <p className="text-xs text-muted-foreground m-0 leading-relaxed">
              Sube un PDF o DOCX: el servidor reutiliza el mismo extractor que en manual y envía el texto a{" "}
              <strong>Claude</strong> (modelo según <code className="text-[10px]">ANTHROPIC_SMART_EXTRACT_MODEL</code> o
              predeterminado). Los campos se filtran por confianza ≥ 75 % en el servidor; la tabla de previsualización muestra
              Eje, Habilidad, Clave y el resto. Tras procesar, se abre la pestaña Manual para revisar y pulsar{" "}
              <strong>Importar</strong>.
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 p-3 bg-muted/30">
              <Label className="flex items-center gap-1.5 text-sm font-medium shrink-0">
                <Sparkles className="h-4 w-4" /> Archivo
              </Label>
              <input
                ref={smartFileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={handleSmartExtractUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={smartExtracting || validatePracticeLoading || !hasActiveBase}
                onClick={() => smartFileInputRef.current?.click()}
              >
                {smartExtracting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {smartExtracting ? "Procesando…" : "Elegir PDF o DOCX"}
              </Button>
              <span className="text-xs text-muted-foreground">Máx. 10 MB · misma autenticación que la prueba base actual.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-primary/30 p-3 bg-muted/20">
              <Label className="flex items-center gap-1.5 text-sm font-medium shrink-0">
                <ShieldCheck className="h-4 w-4 text-primary" /> Validar prueba subida
              </Label>
              <input
                ref={validatePracticeFileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={handleValidatePracticeUpload}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={smartExtracting || validatePracticeLoading || !hasActiveBase}
                onClick={() => validatePracticeFileInputRef.current?.click()}
              >
                {validatePracticeLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {validatePracticeLoading ? "Validando…" : "Comparar con la base (solo alternativas)"}
              </Button>
              <span className="text-xs text-muted-foreground">
                No importa ni cambia ítems: solo compara tu archivo con los ítems de alternativa múltiple ya guardados.
              </span>
            </div>
            {validatePracticeResult ? (
              <div className="rounded-md border border-border bg-background text-xs space-y-2 p-3 max-h-[220px] overflow-auto">
                <p className="font-medium text-foreground m-0">Resumen</p>
                <ul className="list-disc pl-4 m-0 space-y-0.5 text-muted-foreground">
                  <li>Base (alternativas): {validatePracticeResult.summary.base_alternative_count}</li>
                  <li>Detectadas en archivo: {validatePracticeResult.summary.real_alternative_count}</li>
                  <li>Faltantes en archivo: {validatePracticeResult.summary.missing_in_real_count}</li>
                  <li>Sobrantes en archivo: {validatePracticeResult.summary.extra_in_real_count}</li>
                  <li>Clave distinta: {validatePracticeResult.summary.key_mismatch_count}</li>
                  <li>Clave en base sin detectar en archivo: {validatePracticeResult.summary.key_missing_in_real_count}</li>
                  <li>Tipo distinto: {validatePracticeResult.summary.type_mismatch_count}</li>
                  <li>Texto muy distinto: {validatePracticeResult.summary.text_very_different_count}</li>
                  <li>Orden inusual en extracción: {validatePracticeResult.summary.order_unusual_in_real ? "sí" : "no"}</li>
                </ul>
                {validatePracticeResult.alerts.length > 0 ? (
                  <>
                    <p className="font-medium text-foreground m-0 pt-1">Alertas ({validatePracticeResult.alerts.length})</p>
                    <ul className="list-none m-0 space-y-2">
                      {validatePracticeResult.alerts.slice(0, 40).map((a, i) => (
                        <li key={`val-${a.code}-${a.item_number ?? "x"}-${i}`} className="border-b border-border/60 pb-2 last:border-0">
                          <span className="text-[10px] uppercase text-muted-foreground">{a.code}</span>
                          {a.item_number != null ? (
                            <span className="text-[10px] text-muted-foreground"> · ítem {a.item_number}</span>
                          ) : null}
                          <p className="m-0 mt-0.5 text-foreground/90">{a.detail}</p>
                        </li>
                      ))}
                    </ul>
                    {validatePracticeResult.alerts.length > 40 ? (
                      <p className="text-muted-foreground m-0">… y {validatePracticeResult.alerts.length - 40} más (ver logs servidor).</p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted-foreground m-0">Sin alertas en esta corrida.</p>
                )}
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 shrink-0">
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
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={importTab === "smart" || !hasActiveBase}
            >
              Previsualizar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleImport}
              disabled={importing || (!text.trim() && !preview) || !hasActiveBase}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Importar ítems válidos
            </Button>
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
