"use client"

/**
 * Diálogo para importación masiva de ítems de prueba base (source_exam_items).
 * Permite pegar un listado o subir un PDF; extrae texto, previsualiza e importa solo líneas válidas.
 * No reemplaza ni borra ítems existentes. Aislado del flujo de evaluación.
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, FileUp, FileText } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { parseBulkItemsText } from "@/app/lib/parse-bulk-items"
import type { ParsedLine } from "@/app/lib/parse-bulk-items"
import type { ItemWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import { normalizeSourceExamText } from "@/app/lib/normalize-source-exam-text"
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
  const [pdfExtracting, setPdfExtracting] = useState(false)
  const [preview, setPreview] = useState<{
    valid: ItemWithPedagogy<ParsedLine>[]
    invalid: { line: string; reason: string }[]
    developmentWarnings?: string[]
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const handlePdfUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const isPdf = file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")
      if (!isPdf) {
        toast({ title: "El archivo debe ser PDF", variant: "destructive" })
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
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch(`/api/source-exams/${sourceExamId}/items/extract-pdf-text`, {
          method: "POST",
          credentials: "include",
          body: formData,
        })
        const contentType = res.headers.get("content-type") ?? ""
        let data: { text?: string; pageCount?: number; warning?: string; error?: string; details?: string; message?: string } = {}
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
          if (data.warning) setPdfWarning(data.warning)
          else if (normalized.warnings.length > 0) setPdfWarning(normalized.warnings.join(" "))
          else setPdfWarning(null)
          if (rawText.length === 0) {
            setPdfWarning(
              "No se extrajo texto del PDF (¿escaneado o vacío?). Puede pegar el texto manualmente abajo."
            )
            toast({
              title: "PDF sin texto extraíble",
              description: "No se encontró texto en el PDF. Revise el archivo o pegue el contenido manualmente.",
              variant: "destructive",
            })
          } else {
            toast({
              title: "Texto extraído y normalizado",
              description: data.pageCount ? `${data.pageCount} página(s). Revise abajo y previsualice.` : undefined,
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
          title: "Error de conexión al extraer PDF",
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
    const validMerged = [...bulkFiltered, ...dev.items]
    const enriched = enrichItemsWithPedagogy(validMerged)
    const consumedSet = new Set(dev.consumedLines.map((l) => l.trim()))
    const invalidFiltered = result.invalid.filter(
      (inv) => !consumedSet.has(inv.line.trim()) && !looksLikeDocumentHeader(inv.line)
    )
    setPreview({
      valid: enriched,
      invalid: invalidFiltered,
      developmentWarnings: dev.warnings.length > 0 ? dev.warnings : undefined,
    })
  }, [text])

  const handleImport = useCallback(async () => {
    const result = parseBulkItemsText(text)
    const dev = parseDevelopmentBlocksFromText(text)
    const valid = [...result.valid, ...dev.items]
    if (valid.length === 0) {
      toast({
        title: "Sin ítems válidos",
        description: result.invalid.length
          ? `${result.invalid.length} línea(s) con error. Corrija el formato y previsualice de nuevo.`
          : "Pegue un listado con el formato indicado.",
        variant: "destructive",
      })
      return
    }
    if (valid.length > MAX_LINES) {
      toast({
        title: "Límite excedido",
        description: `Máximo ${MAX_LINES} líneas por importación. Tiene ${valid.length} válidas.`,
        variant: "destructive",
      })
      return
    }
    setImporting(true)
    try {
      const res = await fetch(`/api/source-exams/${sourceExamId}/items/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const inserted = data.inserted ?? 0
        toast({
          title: data.message || (inserted > 0 ? `Importados ${inserted} ítem(s).` : "Sin ítems importados."),
          description:
            data.invalid > 0
              ? `${data.invalid} línea(s) inválida(s) no importadas.`
              : undefined,
        })
        if (inserted > 0) {
          setText("")
          setPreview(null)
          onImported()
          onOpenChange(false)
        }
      } else {
        toast({
          title: data.error || "Error al importar",
          description: data.errors?.slice(0, 3).join(" ") || data.message,
          variant: "destructive",
        })
      }
    } catch {
      toast({ title: "Error de conexión", variant: "destructive" })
    } finally {
      setImporting(false)
    }
  }, [text, sourceExamId, onImported, onOpenChange, toast])

  const onClose = useCallback(
    (open: boolean) => {
      if (!open && !importing) {
        setText("")
        setPreview(null)
        setPdfWarning(null)
      }
      onOpenChange(open)
    },
    [importing, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" /> Importar ítems
          </DialogTitle>
          <DialogDescription>
            Pegue un listado de ítems o suba un PDF con texto. Se importarán solo las líneas válidas. No se borran ni reemplazan ítems existentes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 overflow-auto flex-1 min-h-0">
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 p-3 bg-muted/30">
            <Label className="flex items-center gap-1.5 text-sm font-medium shrink-0">
              <FileText className="h-4 w-4" /> Subir PDF
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
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
              {pdfExtracting ? "Extrayendo…" : "Seleccionar PDF"}
            </Button>
            <span className="text-xs text-muted-foreground">Solo PDF con texto extraíble (no escaneado). Máx. 10 MB.</span>
          </div>
          {pdfWarning && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              {pdfWarning}
            </div>
          )}
          {preview?.developmentWarnings && preview.developmentWarnings.length > 0 && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              <span className="font-medium">Desarrollo detectado:</span>{" "}
              {preview.developmentWarnings.join(" ")}
            </div>
          )}
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
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handlePreview}>
              Previsualizar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleImport}
              disabled={importing || !text.trim()}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Importar ítems válidos
            </Button>
          </div>
          {preview && (
            <div className="border rounded-md overflow-auto max-h-[220px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Nº</TableHead>
                    <TableHead>Texto</TableHead>
                    <TableHead className="w-20">Tipo</TableHead>
                    <TableHead className="w-14">Puntaje</TableHead>
                    <TableHead className="w-24">Eje</TableHead>
                    <TableHead className="w-24">Habilidad</TableHead>
                    <TableHead className="w-24">Nivel cognitivo</TableHead>
                    <TableHead className="w-20">Dificultad</TableHead>
                    <TableHead className="w-28 max-w-[180px]">Rúbrica</TableHead>
                    <TableHead className="w-20">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.valid.slice(0, 50).map((p, i) => (
                    <TableRow key={`v-${i}`}>
                      <TableCell>{p.item_number}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={p.rubric_text ? `${p.item_text}\n\nRúbrica:\n${p.rubric_text}` : p.item_text}>
                        {p.item_text}
                      </TableCell>
                      <TableCell className="text-xs">{p.question_type ?? "—"}</TableCell>
                      <TableCell>{p.max_score ?? "—"}</TableCell>
                      <TableCell className="truncate">{p.axis_label ?? "—"}</TableCell>
                      <TableCell className="truncate" title={p.pedagogical?.skill ?? p.skill_label ?? undefined}>
                        {p.pedagogical?.skill ?? p.skill_label ?? "—"}
                      </TableCell>
                      <TableCell className="truncate text-xs text-muted-foreground">{p.pedagogical?.cognitive_level ?? "—"}</TableCell>
                      <TableCell className="truncate text-xs">{p.pedagogical?.difficulty ?? "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground" title={p.rubric_text ?? undefined}>
                        {p.rubric_text ? (p.rubric_text.length > 55 ? `${p.rubric_text.slice(0, 55).trim()}…` : p.rubric_text) : "—"}
                      </TableCell>
                      <TableCell className="text-green-600 text-xs">
                        {p.rubric_text ? "Válida (rúbrica)" : "Válida"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {preview.invalid.slice(0, 20).map((inv, i) => (
                    <TableRow key={`i-${i}`} className="bg-destructive/5">
                      <TableCell colSpan={10} className="text-destructive text-xs">
                        {inv.reason}: &quot;{inv.line.slice(0, 60)}
                        {inv.line.length > 60 ? "…" : ""}&quot;
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(preview.valid.length > 50 || preview.invalid.length > 20) && (
                <p className="text-xs text-muted-foreground px-2 py-1 border-t">
                  Mostrando hasta 50 válidas y 20 inválidas. Total: {preview.valid.length} válidas, {preview.invalid.length} inválidas.
                </p>
              )}
            </div>
          )}
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
