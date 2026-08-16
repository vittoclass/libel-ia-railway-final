"use client"

/**
 * Diálogo para importación masiva de ítems de prueba base (source_exam_items).
 * Permite pegar un listado o subir un PDF; extrae texto, previsualiza e importa solo líneas válidas.
 * Por defecto reemplaza ítems existentes al importar (evita duplicados). Opción de solo añadir.
 *
 * Reversión rápida (UX Paso 2 / puntaje masivo): `git checkout -- app/components/SourceExamItemsImportDialog.tsx`
 */
import * as React from "react"
import { useState, useCallback, useRef, useEffect, useMemo } from "react"
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
import {
  Loader2,
  FileUp,
  FileText,
  Plus,
  Trash2,
  ChevronDown,
  Sparkles,
  ListChecks,
  Files,
  Pencil,
} from "lucide-react"
import {
  buildDraftFromParsedLines,
  buildDraftFromParsedLinesWithSmartMeta,
  applyBulkConfirmToDrafts,
  draftRowToParsedLine,
  draftsApplyMergeOverlay,
  draftsToParsedLines,
  formatBulkConfirmMissingDescription,
  mergeParsedLineIntoDraft,
  summarizeDraftsForImport,
  teacherFacingRowStatus,
  type MergeDraftOverlayByItem,
  type SourceExamItemDraft,
  type TeacherFacingRowStatus,
} from "@/app/lib/source-exam-validation-draft"
import { mergeOverlayFromJsonRecord } from "@/app/lib/source-exam-draft-merge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { dedupeParsedLinesByItemNumber, parseBulkItemsText } from "@/app/lib/parse-bulk-items"
import type { ParsedLine } from "@/app/lib/parse-bulk-items"
import type { ItemWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import { inferSuggestedInstrumentTitle, normalizeSourceExamText } from "@/app/lib/normalize-source-exam-text"
import { parseDevelopmentBlocksFromText } from "@/app/lib/parse-development-blocks"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** Misma regla que `assignOnePointToMissingMaxScores` en el borrador; puntos configurables (solo cliente). */
function assignPointsToMissingMaxScores(drafts: SourceExamItemDraft[], points: number): SourceExamItemDraft[] {
  const p = Math.max(0, Math.floor(Number(points)) || 0)
  return drafts.map((d) => {
    if (d.max_score.value != null && Number.isFinite(d.max_score.value)) return d
    return { ...d, max_score: { value: p, status: "edited_by_user" } }
  })
}

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

const SEP_PIPE = " | "

/** Separa enunciado y bloque A/B/C… para columnas legibles (alternativas siguen en item_text al importar). */
function splitStemAndAlternatives(itemText: string): { stem: string; altBlock: string } {
  const lines = String(itemText ?? "").split(/\r?\n/)
  let firstAlt = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]?.trim() ?? ""
    if (/^[A-Ea-e]\s*[\)\.\:]\s*\S/.test(t)) {
      firstAlt = i
      break
    }
  }
  if (firstAlt <= 0) return { stem: String(itemText ?? "").trim(), altBlock: "" }
  return {
    stem: lines.slice(0, firstAlt).join("\n").trim(),
    altBlock: lines.slice(firstAlt).join("\n").trim(),
  }
}

function teacherStatusTextClass(s: TeacherFacingRowStatus): string {
  switch (s) {
    case "Completo":
      return "text-emerald-800 dark:text-emerald-200"
    case "Falta revisar":
      return "text-amber-800 dark:text-amber-200"
    case "Sin puntaje":
    case "Sin respuesta":
      return "text-destructive"
    default:
      return ""
  }
}

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
      if (typeof ms === "number" && Number.isFinite(ms)) max_score = Math.max(0, Math.floor(ms))
      else {
        const s = String(ms).trim()
        if (s.length > 0) {
          const n = Number(s.replace(",", "."))
          if (!Number.isNaN(n) && n >= 0) max_score = Math.floor(n)
        }
      }
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
  /** Borrador local con field_status (solo cliente; no se envía al servidor). */
  const [itemDrafts, setItemDrafts] = useState<SourceExamItemDraft[] | null>(null)
  const reviewRowRefs = useRef<Array<HTMLTableRowElement | null>>([])
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)
  const [unrecognizedOpen, setUnrecognizedOpen] = useState(true)
  const [pdfOcrDebug, setPdfOcrDebug] = useState<PdfOcrDebugSnapshot | null>(null)
  const [pdfOcrPanelOpen, setPdfOcrPanelOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importTab, setImportTab] = useState<"manual" | "smart">("manual")
  const [smartExtracting, setSmartExtracting] = useState(false)
  const [answerKeyFileLabel, setAnswerKeyFileLabel] = useState<string | null>(null)
  const [rubricFileLabel, setRubricFileLabel] = useState<string | null>(null)
  const [answerKeyFile, setAnswerKeyFile] = useState<File | null>(null)
  const [rubricFile, setRubricFile] = useState<File | null>(null)
  /** Archivo de prueba elegido antes de pulsar “Analizar y completar”. */
  const [pendingSmartMainFile, setPendingSmartMainFile] = useState<File | null>(null)
  const [pendingSmartMainLabel, setPendingSmartMainLabel] = useState<string | null>(null)
  const [expandedReviewRow, setExpandedReviewRow] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const smartFileInputRef = useRef<HTMLInputElement>(null)
  const lastSmartMainFileRef = useRef<File | null>(null)
  const answerKeySmartInputRef = useRef<HTMLInputElement>(null)
  const rubricSmartInputRef = useRef<HTMLInputElement>(null)
  const previewTableRef = useRef<HTMLDivElement>(null)
  const importCtaRef = useRef<HTMLButtonElement>(null)
  const { toast } = useToast()

  /** UX Paso 2: tras “Confirmar todo”, mensaje visible + siguiente paso (importar). */
  const [showReadyToImportBanner, setShowReadyToImportBanner] = useState(false)
  const [confirmBannerKind, setConfirmBannerKind] = useState<"all" | "partial">("all")
  const [emphasizeImportCta, setEmphasizeImportCta] = useState(false)
  const [postConfirmImportPromptOpen, setPostConfirmImportPromptOpen] = useState(false)
  const [massScorePopoverOpen, setMassScorePopoverOpen] = useState(false)
  const [massScorePointsInput, setMassScorePointsInput] = useState("1")

  const resetImportReadyHints = useCallback(() => {
    setShowReadyToImportBanner(false)
    setConfirmBannerKind("all")
    setEmphasizeImportCta(false)
    setPostConfirmImportPromptOpen(false)
  }, [])

  const validationRows: ParsedLine[] = useMemo(() => {
    if (preview && itemDrafts?.length) return draftsToParsedLines(itemDrafts)
    return editorItems
  }, [preview, itemDrafts, editorItems])

  const compactImportSummary = useMemo(() => {
    if (!itemDrafts?.length) return null
    const s = summarizeDraftsForImport(itemDrafts)
    return `${s.total} ítems · ${s.sinPuntaje} sin puntaje · ${s.sinRespuestaCorrecta} sin respuesta registrada`
  }, [itemDrafts])

  const updateRowAt = useCallback((index: number, partial: Partial<ParsedLine>) => {
    setItemDrafts((prev) => {
      if (!prev || index < 0 || index >= prev.length) return prev
      const base = draftRowToParsedLine(prev[index])
      const line: ParsedLine = { ...base, ...partial }
      return prev.map((d, i) => (i === index ? mergeParsedLineIntoDraft(d, line) : d))
    })
  }, [])

  const confirmAllCompleteDraftRows = useCallback(() => {
    if (!itemDrafts?.length) return
    const result = applyBulkConfirmToDrafts(itemDrafts)
    setItemDrafts(result.next)
    if (result.confirmedCount === 0 && result.alreadyConfirmedCount === 0) {
      const detail = formatBulkConfirmMissingDescription(result.missingFieldCounts)
      toast({
        title: "No se pudo confirmar ninguna fila",
        description: detail
          ? `Falta: ${detail}.`
          : "Ninguna fila tiene el enunciado mínimo para importar.",
      })
      return
    }
    if (result.skippedCount > 0) {
      const detail = formatBulkConfirmMissingDescription(result.missingFieldCounts)
      toast({
        title:
          result.confirmedCount > 0
            ? `Se confirmaron ${result.confirmedCount} fila${result.confirmedCount === 1 ? "" : "s"}`
            : "Hay filas ya confirmadas",
        description: detail
          ? `No se confirmaron ${result.skippedCount}: falta ${detail}.`
          : `${result.skippedCount} fila(s) siguen pendientes.`,
      })
    }
    setConfirmBannerKind(result.skippedCount > 0 ? "partial" : "all")
    setShowReadyToImportBanner(true)
    setEmphasizeImportCta(true)
    queueMicrotask(() => {
      importCtaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
    window.setTimeout(() => setPostConfirmImportPromptOpen(true), 480)
  }, [itemDrafts, toast])

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
          resetImportReadyHints()
          setPreview(null)
          setItemDrafts(null)
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
    [sourceExamId, toast, hasActiveBase, resetImportReadyHints]
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
    resetImportReadyHints()
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
    const rowsForEditor = validMerged.map((p) => ({
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
    }))
    setEditorItems(rowsForEditor)
    setItemDrafts(buildDraftFromParsedLines(rowsForEditor))
  }, [text, hasActiveBase, toast, resetImportReadyHints])

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
    const tableLines =
      preview !== null && itemDrafts?.length ? draftsToParsedLines(itemDrafts) : editorItems
    const editedFiltered = dedupeParsedLinesByItemNumber(
      sanitizeEditorItemsForApi(tableLines).filter(
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
          setItemDrafts(null)
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
    itemDrafts,
  ])

  const onClose = useCallback(
    (open: boolean) => {
      if (!open && !importing) {
        setText("")
        resetImportReadyHints()
        setMassScorePopoverOpen(false)
        setMassScorePointsInput("1")
        setPreview(null)
        setEditorItems([])
        setItemDrafts(null)
        setSourcePanelOpen(true)
        setUnrecognizedOpen(true)
        setPdfOcrDebug(null)
        setPdfOcrPanelOpen(false)
        setPdfWarning(null)
        setSuggestedTitle(null)
        setInstrumentTitle("")
        setImportTab("manual")
        setAnswerKeyFile(null)
        setRubricFile(null)
        setAnswerKeyFileLabel(null)
        setRubricFileLabel(null)
        lastSmartMainFileRef.current = null
        setPendingSmartMainFile(null)
        setPendingSmartMainLabel(null)
        setExpandedReviewRow(null)
      }
      onOpenChange(open)
    },
    [importing, onOpenChange, resetImportReadyHints]
  )

  const runSmartExtractForFile = useCallback(
    async (file: File, opts?: { answerKey?: File | null; rubric?: File | null }) => {
      setSmartExtracting(true)
      lastSmartMainFileRef.current = file
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), SMART_EXTRACT_FETCH_MS)
      try {
        const fd = new FormData()
        fd.append("file", file)
        fd.append("source_exam_id", sourceExamId)
        if (opts?.answerKey) fd.append("answer_key_file", opts.answerKey)
        if (opts?.rubric) fd.append("rubric_file", opts.rubric)
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
          meta?: Record<string, unknown>
          anthropic_status?: number | null
          merge_draft_overlay?: Record<string, MergeDraftOverlayByItem>
        } = {}
        let bodyParseNote: string | null = null
        try {
          if (ct.includes("application/json")) data = (await res.json()) as typeof data
          else {
            const txt = await res.text()
            bodyParseNote = txt ? `Respuesta no JSON (${res.status}): ${txt.slice(0, 280)}` : `Respuesta vacía (${res.status})`
          }
        } catch (parseErr) {
          bodyParseNote = parseErr instanceof Error ? parseErr.message : String(parseErr)
        }
        const showSmartFailure = (title: string, description?: string) =>
          toast({ title, description, variant: "destructive", duration: 12_000 })
        if (bodyParseNote) return showSmartFailure("No se pudo leer la respuesta del servidor", bodyParseNote)
        if (!res.ok) {
          return showSmartFailure(
            data.error || `Error del servidor (${res.status})`,
            [data.details, data.anthropic_status != null ? `Anthropic (upstream): HTTP ${data.anthropic_status}` : ""]
              .filter(Boolean)
              .join(" · ") || undefined,
          )
        }
        const rawItems = Array.isArray(data.items) ? data.items : []
        if (rawItems.length === 0 && typeof data.error === "string" && data.error.trim()) {
          return showSmartFailure(data.error.trim(), data.details?.trim() || data.warnings?.filter(Boolean).join(" ") || undefined)
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
            const s = String(ms).trim()
            if (s.length > 0) {
              const n = Number(s.replace(",", "."))
              if (!Number.isNaN(n) && n >= 0) max_score = Math.floor(n)
            }
          }
          let correct_answer: string | null = null
          const caRaw = it.correct_answer
          if (caRaw != null && caRaw !== "") {
            const u = String(caRaw).trim().toUpperCase()
            if (/^[A-E]$/.test(u)) correct_answer = u
            else if (u === "V" || u === "F") correct_answer = u
          }
          return {
            item_number,
            item_text: String(it.item_text ?? "").trim(),
            axis_label: typeof it.axis_label === "string" && it.axis_label.trim() ? it.axis_label.trim() : null,
            skill_label: typeof it.skill_label === "string" && it.skill_label.trim() ? it.skill_label.trim() : null,
            cognitive_level: typeof it.cognitive_level === "string" && it.cognitive_level.trim() ? it.cognitive_level.trim() : null,
            competence: typeof it.competence === "string" && it.competence.trim() ? it.competence.trim() : null,
            difficulty: typeof it.difficulty === "string" && it.difficulty.trim() ? it.difficulty.trim() : null,
            question_type: question_type as ParsedLine["question_type"],
            correct_answer,
            max_score,
            rubric_text: typeof it.rubric_text === "string" && it.rubric_text.trim() ? it.rubric_text.trim() : null,
          }
        })
        const merged = dedupeParsedLinesByItemNumber(rows).filter((r) => r.item_text.trim().length > 0)
        const capped = merged.slice(0, MAX_LINES)
        if (capped.length === 0) {
          return showSmartFailure(
            data.error?.trim() || "Sin ítems con confianza suficiente",
            [data.details?.trim(), data.warnings?.filter(Boolean).join(" ")].filter(Boolean).join(" ") || undefined,
          )
        }
        const enriched = enrichItemsWithPedagogy(capped)
        resetImportReadyHints()
        setPreview({ valid: enriched, invalid: [] })
        setEditorItems(capped)
        let drafts = buildDraftFromParsedLinesWithSmartMeta(capped, rawItems)
        if (data.merge_draft_overlay && typeof data.merge_draft_overlay === "object") {
          drafts = draftsApplyMergeOverlay(drafts, mergeOverlayFromJsonRecord(data.merge_draft_overlay))
        }
        setItemDrafts(drafts)
        setSourcePanelOpen(false)
        setUnrecognizedOpen(false)
        setText(smartExtractRowsToStandardSourceText(capped))
        const baseName = file.name?.replace(/\.(pdf|docx)$/i, "").replace(/[-_]+/g, " ").trim() || ""
        setInstrumentTitle((prev) => (prev.trim() ? prev : baseName))
        setImportTab("smart")
        toast({
          title: "Análisis listo",
          description: `${capped.length} preguntas detectadas. Revise la tabla y pulse Importar prueba base.`,
        })
        setPendingSmartMainLabel(file.name)
        window.setTimeout(() => previewTableRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80)
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError"
        toast({
          title: aborted ? "Tiempo de espera agotado (IA)" : "Error de conexión (IA)",
          description: aborted
            ? `La petición superó ${Math.round(SMART_EXTRACT_FETCH_MS / 60_000)} minutos. Pruebe un archivo más pequeño o revise Railway/logs del servidor.`
            : err instanceof Error
              ? err.message
              : String(err),
          variant: "destructive",
          duration: 12_000,
        })
      } finally {
        window.clearTimeout(timeoutId)
        setSmartExtracting(false)
      }
    },
    [sourceExamId, toast, resetImportReadyHints],
  )

  const handleSmartMainFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
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
      setPendingSmartMainFile(file)
      setPendingSmartMainLabel(file.name)
      e.target.value = ""
      if (smartFileInputRef.current) smartFileInputRef.current.value = ""
    },
    [hasActiveBase, toast],
  )

  const handleAnalyzeSmartClick = useCallback(async () => {
    if (!hasActiveBase) {
      toast({
        title: "Sin prueba base activa",
        description: "Abra Importar ítems desde una prueba base seleccionada en el banco.",
        variant: "destructive",
      })
      return
    }
    const main = pendingSmartMainFile
    if (!main) {
      toast({
        title: "Falta la prueba",
        description: "Elija el archivo PDF o Word de la prueba antes de analizar.",
        variant: "destructive",
      })
      return
    }
    await runSmartExtractForFile(main, {
      answerKey: answerKeyFile ?? undefined,
      rubric: rubricFile ?? undefined,
    })
  }, [answerKeyFile, hasActiveBase, pendingSmartMainFile, rubricFile, runSmartExtractForFile, toast])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex h-[min(92vh,960px)] max-h-[92vh] w-[min(98vw,92rem)] max-w-[98vw] flex-col gap-0 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" /> Importar ítems
          </DialogTitle>
          <DialogDescription className="text-sm">
            <strong>Manual:</strong> pegue o suba un documento. <strong>IA:</strong> suba prueba (y pauta si tiene) y analice. Revise
            la tabla y pulse importar. Requiere clave de IA en el servidor.
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
          <p className="text-xs text-destructive m-0 shrink-0">Seleccione una prueba base en el banco para continuar.</p>
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
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
        >
          <TabsList className="shrink-0 w-full max-w-lg justify-start">
            <TabsTrigger value="manual">Manual / PDF</TabsTrigger>
            <TabsTrigger value="smart" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              IA Smart Import
            </TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
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
            </div>
          </TabsContent>
          <TabsContent value="smart" className="mt-0 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 data-[state=inactive]:hidden">
            <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm leading-relaxed text-foreground">
              <span className="font-semibold">Paso 1 · Subir documentos.</span>{" "}
              Suba la prueba y, si tiene, la pauta o la rúbrica. La IA completará respuestas, puntajes y habilidades. Revise la
              tabla antes de importar.
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <Label className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4 shrink-0" /> Archivo de la prueba
                </Label>
                <p className="mt-1 text-xs text-muted-foreground m-0">PDF o Word · máx. 10 MB</p>
                <input
                  ref={smartFileInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={handleSmartMainFileSelected}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full sm:w-auto"
                  disabled={smartExtracting || !hasActiveBase}
                  onClick={() => smartFileInputRef.current?.click()}
                >
                  Elegir archivo
                </Button>
                <p className="mt-2 text-xs font-medium text-foreground m-0 break-all">
                  {pendingSmartMainLabel ?? "Ningún archivo elegido"}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <Label className="flex items-center gap-2 text-sm font-semibold">
                  <Files className="h-4 w-4 shrink-0" /> Pauta o rúbrica (opcional)
                </Label>
                <p className="mt-1 text-xs text-muted-foreground m-0">
                  Mejoran respuestas correctas y puntajes. Puede subir solo uno o ambos.
                </p>
                <input
                  ref={answerKeySmartInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) {
                      setAnswerKeyFile(f)
                      setAnswerKeyFileLabel(f.name)
                    }
                    e.target.value = ""
                  }}
                />
                <input
                  ref={rubricSmartInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) {
                      setRubricFile(f)
                      setRubricFileLabel(f.name)
                    }
                    e.target.value = ""
                  }}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={smartExtracting || !hasActiveBase}
                    onClick={() => answerKeySmartInputRef.current?.click()}
                  >
                    Subir pauta
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={smartExtracting || !hasActiveBase}
                    onClick={() => rubricSmartInputRef.current?.click()}
                  >
                    Subir rúbrica
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground m-0 break-all">
                  Pauta: {answerKeyFileLabel ?? "—"} · Rúbrica: {rubricFileLabel ?? "—"}
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="lg"
              className="h-12 w-full text-base font-semibold sm:max-w-xl"
              disabled={smartExtracting || !hasActiveBase || !pendingSmartMainFile}
              onClick={() => void handleAnalyzeSmartClick()}
            >
              {smartExtracting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Sparkles className="mr-2 h-5 w-5" />}
              {smartExtracting ? "Analizando…" : "Analizar y completar prueba base"}
            </Button>
            {pendingSmartMainLabel && preview ? (
              <p className="text-xs text-muted-foreground m-0">
                Analizado: <span className="font-medium text-foreground">{pendingSmartMainLabel}</span>. Revise el{" "}
                <strong className="text-foreground">Paso 2</strong> debajo de las pestañas.
              </p>
            ) : null}
          </TabsContent>
        </Tabs>
        {preview && (
          <>
            <div
              ref={previewTableRef}
              className="mt-3 flex min-h-[min(70vh,640px)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm scroll-mt-4"
            >
              <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-3">
                <h3 className="m-0 text-base font-semibold text-foreground">Paso 2 · Revisar y guardar</h3>
                <p className="m-0 mt-1 text-sm text-muted-foreground">
                  Nada se guarda en la plataforma hasta que pulse <span className="font-medium text-foreground">Importar prueba base</span>.
                </p>
                {compactImportSummary ? (
                  <p className="m-0 mt-2 text-sm text-foreground/90">{compactImportSummary}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    const lines = validationRows
                    const n = nextItemNumber(lines)
                    const empty = createEmptyParsedLine(n)
                    const draftRow = buildDraftFromParsedLines([empty])[0]
                    setItemDrafts((prev) => [...(prev ?? []), draftRow])
                    setEditorItems((prev) => [...prev, empty])
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Añadir fila
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Popover open={massScorePopoverOpen} onOpenChange={setMassScorePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={!itemDrafts?.length}
                      >
                        Asignar puntaje (sin puntaje)
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" align="end" sideOffset={6}>
                      <p className="text-sm font-medium leading-snug m-0">Asignar puntaje a ítems sin puntaje</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Input
                          id="mass-score-points"
                          type="number"
                          min={0}
                          step={1}
                          className="h-9 w-[5.5rem]"
                          inputMode="numeric"
                          value={massScorePointsInput}
                          onChange={(e) => setMassScorePointsInput(e.target.value)}
                          aria-label="Puntos a asignar"
                        />
                        <span className="text-sm text-muted-foreground">puntos</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => {
                          const raw = massScorePointsInput.trim()
                          const n = raw === "" ? NaN : Number(raw.replace(",", "."))
                          if (Number.isNaN(n) || n < 0 || !Number.isFinite(n)) {
                            toast({
                              title: "Valor inválido",
                              description: "Indique un número entero mayor o igual a 0.",
                              variant: "destructive",
                            })
                            return
                          }
                          const points = Math.max(0, Math.floor(n))
                          setItemDrafts((prev) => (prev ? assignPointsToMissingMaxScores(prev, points) : null))
                          toast({
                            title: "Listo",
                            description:
                              points === 0
                                ? "Puntaje 0 en cada ítem que no tenía puntaje."
                                : `${points} punto${points === 1 ? "" : "s"} en cada ítem que no tenía puntaje.`,
                          })
                          setMassScorePopoverOpen(false)
                        }}
                      >
                        Aplicar
                      </Button>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8"
                    onClick={confirmAllCompleteDraftRows}
                    disabled={!itemDrafts?.length}
                  >
                    <ListChecks className="mr-1 h-3.5 w-3.5" />
                    Confirmar todo
                  </Button>
                </div>
              </div>
              <div className="min-h-0 max-h-[min(68vh,620px)] flex-1 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-20 bg-muted/95 shadow-sm backdrop-blur-sm">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12 whitespace-nowrap">Nº</TableHead>
                      <TableHead className="min-w-[220px]">Pregunta</TableHead>
                      <TableHead className="min-w-[200px]">Alternativas / respuesta</TableHead>
                      <TableHead className="w-16 whitespace-nowrap">Puntaje</TableHead>
                      <TableHead className="min-w-[120px]">Eje</TableHead>
                      <TableHead className="min-w-[120px]">Habilidad</TableHead>
                      <TableHead className="w-[9rem] whitespace-nowrap">Estado</TableHead>
                      <TableHead className="w-28 text-right whitespace-nowrap">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validationRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          No hay ítems. Pulse Previsualizar (manual) o analice un documento (IA).
                        </TableCell>
                      </TableRow>
                    )}
                    {validationRows.map((p, i) => {
                      const d = itemDrafts?.[i]
                      const { stem, altBlock } = splitStemAndAlternatives(p.item_text)
                      const statusLabel: TeacherFacingRowStatus = d ? teacherFacingRowStatus(d) : "Falta revisar"
                      const openExtra = expandedReviewRow === i
                      return (
                        <React.Fragment key={`v-${i}-${p.item_number}`}>
                          <TableRow
                            ref={(el) => {
                              reviewRowRefs.current[i] = el
                            }}
                            className={openExtra ? "bg-muted/40" : undefined}
                          >
                            <TableCell className="align-top py-3">
                              <Input
                                className="h-9 w-14"
                                value={String(p.item_number)}
                                onChange={(e) =>
                                  updateRowAt(i, {
                                    item_number: Math.max(1, parseInt(e.target.value || "1", 10) || 1),
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell className="align-top py-3 max-w-[min(32rem,44vw)]">
                              <textarea
                                className="min-h-[72px] w-full rounded-md border border-input bg-background px-2 py-2 text-sm leading-snug"
                                value={p.item_text}
                                onChange={(e) => updateRowAt(i, { item_text: e.target.value })}
                                spellCheck={false}
                              />
                              {stem && altBlock ? (
                                <p className="mt-1 text-[11px] text-muted-foreground m-0">
                                  Enunciado y alternativas pueden ir en el mismo bloque; edítelo aquí si hace falta.
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell className="align-top py-3 text-sm">
                              {altBlock ? (
                                <pre className="mb-2 max-h-36 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-muted/30 p-2 font-sans text-xs leading-relaxed">
                                  {altBlock}
                                </pre>
                              ) : (
                                <p className="text-xs text-muted-foreground m-0 mb-2">
                                  {p.question_type === "multiple_choice" || p.question_type === "true_false"
                                    ? "Si no ves alternativas, compruebe el texto completo en «Pregunta»."
                                    : "—"}
                                </p>
                              )}
                              <div className="flex flex-col gap-1">
                                <Label className="text-[11px] text-muted-foreground">Respuesta correcta</Label>
                                <Input
                                  className="h-9 w-20"
                                  placeholder="A–E / V/F"
                                  value={p.correct_answer ?? ""}
                                  onChange={(e) =>
                                    updateRowAt(i, { correct_answer: e.target.value.trim().toUpperCase() || null })
                                  }
                                />
                              </div>
                            </TableCell>
                            <TableCell className="align-top py-3">
                              <Input
                                className="h-9 w-16"
                                inputMode="numeric"
                                value={p.max_score === 0 ? "0" : p.max_score ?? ""}
                                onChange={(e) =>
                                  updateRowAt(i, {
                                    max_score:
                                      e.target.value === "" ? null : Math.max(0, parseInt(e.target.value || "0", 10) || 0),
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell className="align-top py-3">
                              <Input
                                className="h-9 text-sm"
                                placeholder="Eje"
                                value={p.axis_label ?? ""}
                                onChange={(e) => updateRowAt(i, { axis_label: e.target.value.trim() || null })}
                              />
                            </TableCell>
                            <TableCell className="align-top py-3">
                              <Input
                                className="h-9 text-sm"
                                placeholder="Habilidad"
                                value={p.skill_label ?? ""}
                                onChange={(e) => updateRowAt(i, { skill_label: e.target.value.trim() || null })}
                              />
                            </TableCell>
                            <TableCell className="align-top py-3">
                              <span className={`text-sm font-medium ${teacherStatusTextClass(statusLabel)}`}>{statusLabel}</span>
                            </TableCell>
                            <TableCell className="align-top py-3 text-right">
                              <div className="flex flex-col items-end gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8"
                                  onClick={() => setExpandedReviewRow((x) => (x === i ? null : i))}
                                >
                                  <Pencil className="mr-1 h-3.5 w-3.5" />
                                  Editar
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => {
                                    setItemDrafts((prev) => (prev ? prev.filter((_, idx) => idx !== i) : null))
                                    setEditorItems((prev) => prev.filter((_, idx) => idx !== i))
                                    setExpandedReviewRow((x) => (x === i ? null : x))
                                  }}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  Quitar
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {openExtra ? (
                            <TableRow key={`extra-${i}`} className="bg-muted/25">
                              <TableCell colSpan={8} className="py-3">
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                  <div>
                                    <Label className="text-xs">Tipo de pregunta</Label>
                                    <select
                                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                      value={p.question_type ?? ""}
                                      onChange={(e) => updateRowAt(i, { question_type: e.target.value || null })}
                                    >
                                      <option value="">—</option>
                                      <option value="multiple_choice">Alternativas</option>
                                      <option value="true_false">Verdadero / falso</option>
                                      <option value="short_answer">Respuesta corta</option>
                                      <option value="essay">Desarrollo</option>
                                      <option value="completion">Completar</option>
                                    </select>
                                  </div>
                                  <div>
                                    <Label className="text-xs">Nivel cognitivo</Label>
                                    <Input
                                      className="mt-1 h-9 text-sm"
                                      value={p.cognitive_level ?? ""}
                                      onChange={(e) => updateRowAt(i, { cognitive_level: e.target.value.trim() || null })}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">Dificultad</Label>
                                    <Input
                                      className="mt-1 h-9 text-sm"
                                      value={p.difficulty ?? ""}
                                      onChange={(e) => updateRowAt(i, { difficulty: e.target.value.trim() || null })}
                                    />
                                  </div>
                                  <div className="sm:col-span-2 lg:col-span-4">
                                    <Label className="text-xs">Rúbrica o criterios (si aplica)</Label>
                                    <textarea
                                      className="mt-1 min-h-[64px] w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                                      value={p.rubric_text ?? ""}
                                      onChange={(e) => updateRowAt(i, { rubric_text: e.target.value || null })}
                                    />
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </React.Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
                {validationRows.length > MAX_LINES && (
                  <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    Hay {validationRows.length} filas; el máximo por importación es {MAX_LINES}.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <Collapsible open={sourcePanelOpen} onOpenChange={setSourcePanelOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
                  <span>Opcional · texto fuente (manual)</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${sourcePanelOpen ? "rotate-180" : ""}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  <p className="text-xs text-muted-foreground m-0">
                    Solo si importó desde listado manual: aquí no se actualiza la tabla hasta pulsar Previsualizar.
                  </p>
                  <textarea
                    className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                    Líneas no reconocidas (manual)
                    {preview.invalid.length > 0 ? ` (${preview.invalid.length})` : ""}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${unrecognizedOpen ? "rotate-180" : ""}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  {preview.invalid.length === 0 ? (
                    <p className="text-xs text-muted-foreground m-0">Ninguna.</p>
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
          </>
        )}
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
          {showReadyToImportBanner ? (
            <div
              role="status"
              className="rounded-md border border-emerald-500/45 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-950 dark:text-emerald-100 shrink-0"
            >
              {confirmBannerKind === "all"
                ? "Todos los ítems están listos para importar."
                : "Hay ítems confirmados listos para importar. Revise las filas pendientes."}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 shrink-0 scroll-mt-24">
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
              ref={importCtaRef}
              type="button"
              size="sm"
              onClick={handleImport}
              disabled={importing || (!text.trim() && !preview) || !hasActiveBase}
              className={cn(
                emphasizeImportCta && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md",
              )}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Importar prueba base
            </Button>
          </div>
        <AlertDialog open={postConfirmImportPromptOpen} onOpenChange={setPostConfirmImportPromptOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Importar ahora?</AlertDialogTitle>
              <AlertDialogDescription>¿Deseas importar la prueba base ahora?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Revisar</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                onClick={() => {
                  void handleImport()
                }}
                disabled={importing || (!text.trim() && !preview) || !hasActiveBase}
              >
                Importar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={importing}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* Reversión UX (mismo comentario que arriba): git checkout -- app/components/SourceExamItemsImportDialog.tsx */
