"use client"

/**
 * Exporta informes pedagógicos individuales a PDF y los agrupa en ZIP (cliente).
 * No interfiere con OMR ni con el flujo de evaluación.
 */
import * as React from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { format } from "date-fns"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Loader2, FileArchive } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { PedagogicalAnalysisReportBody } from "@/app/components/PedagogicalAnalysisReportBody"
import { exportElementToPdfBlob } from "@/app/lib/export-report-pdf"
import type { PedagogicalAnalysisExportData } from "@/app/lib/pedagogical-analysis-export-types"

type BatchEvalRow = {
  id: string
  title: string | null
  course_label: string | null
  first_student_name: string | null
}

function sanitizeZipPart(s: string | null | undefined, fallback: string): string {
  const t = (s ?? "").trim() || fallback
  return t
    .replace(/[^\w\u00C0-\u024F\s\-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80)
}

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

async function waitForLayout(): Promise<void> {
  await yieldToMain()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function fetchAnalysisJson(evaluationId: string): Promise<PedagogicalAnalysisExportData | { error: string }> {
  const r = await fetch(`/api/evaluations/${evaluationId}/pedagogical-analysis`, {
    credentials: "include",
    cache: "no-store",
  })
  const j = (await r.json()) as PedagogicalAnalysisExportData & { error?: string }
  if (!r.ok || j.error) return { error: typeof j.error === "string" ? j.error : "Error al cargar análisis" }
  return j as PedagogicalAnalysisExportData
}

async function dataUrlToPdfBlob(data: PedagogicalAnalysisExportData, labels: {
  studentName: string | null
  courseLabel: string | null
  evaluationLabel: string | null
}): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  const host = document.createElement("div")
  host.setAttribute("data-batch-pdf-host", "1")
  host.style.cssText =
    "position:fixed;left:-12000px;top:0;width:768px;max-width:768px;background:#ffffff;color:#0f172a;z-index:-1;overflow:visible;"
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => {
      root.render(
        <div className="space-y-4 text-sm p-4 bg-white">
          <PedagogicalAnalysisReportBody
            loading={false}
            error={null}
            data={data}
            studentName={labels.studentName}
            courseLabel={labels.courseLabel}
            evaluationLabel={labels.evaluationLabel}
          />
        </div>,
      )
    })
    await waitForLayout()
    const inner = host.firstElementChild as HTMLElement | null
    if (!inner) return { ok: false, error: "Sin nodo de informe" }
    return await exportElementToPdfBlob(inner)
  } finally {
    root.unmount()
    host.remove()
  }
}

function pdfFileNameForRow(row: BatchEvalRow): string {
  const student = sanitizeZipPart(row.first_student_name, "estudiante")
  const short = row.id.replace(/-/g, "").slice(0, 8)
  return `informe_${student}_${short}.pdf`
}

export type BatchPedagogicalZipDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  batchId: string | null
  /** Sugerencias desde el formulario del evaluador */
  suggestedExamTitle?: string | null
  suggestedCourseLabel?: string | null
  /** Al regenerar desde «Mis archivos», nombres guardados en el historial */
  historyExamTitle?: string | null
  historyCourseLabel?: string | null
  onRecorded?: () => void
}

export function BatchPedagogicalZipDialog({
  open,
  onOpenChange,
  batchId,
  suggestedExamTitle,
  suggestedCourseLabel,
  historyExamTitle,
  historyCourseLabel,
  onRecorded,
}: BatchPedagogicalZipDialogProps) {
  const { toast } = useToast()
  const [loadingList, setLoadingList] = React.useState(false)
  const [rows, setRows] = React.useState<BatchEvalRow[]>([])
  const [listError, setListError] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<"idle" | "zipping" | "done">("idle")
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [totalPlanned, setTotalPlanned] = React.useState(0)
  const [skipped, setSkipped] = React.useState(0)

  React.useEffect(() => {
    if (!open || !batchId) {
      setRows([])
      setListError(null)
      setPhase("idle")
      setCurrentIndex(0)
      setTotalPlanned(0)
      setSkipped(0)
      return
    }
    let cancelled = false
    setLoadingList(true)
    setListError(null)
    setPhase("idle")
    setCurrentIndex(0)
    setTotalPlanned(0)
    setSkipped(0)
    fetch(`/api/evaluations/by-batch?batch_id=${encodeURIComponent(batchId)}`, { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as { evaluations?: BatchEvalRow[]; error?: string }
        if (!r.ok) throw new Error(j.error || "No se pudo listar el lote")
        return j.evaluations ?? []
      })
      .then((list) => {
        if (!cancelled) setRows(list)
      })
      .catch((e) => {
        if (!cancelled) setListError(e instanceof Error ? e.message : "Error de red")
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, batchId])

  const progressPct =
    totalPlanned > 0 && phase === "zipping" ? Math.round((currentIndex / totalPlanned) * 100) : phase === "done" ? 100 : 0

  const runExport = async () => {
    if (!batchId || rows.length === 0) return
    const JSZip = (await import("jszip")).default
    const { saveAs } = await import("file-saver")

    const titleFromForm = suggestedExamTitle?.trim() || null
    const courseFromForm = suggestedCourseLabel?.trim() || null
    const titleFromHistory = historyExamTitle?.trim() || null
    const courseFromHistory = historyCourseLabel?.trim() || null
    const titleFromBatch = rows.find((r) => r.title?.trim())?.title?.trim() ?? null
    const courseFromBatch = rows.find((r) => r.course_label?.trim())?.course_label?.trim() ?? null

    const examPart = sanitizeZipPart(titleFromForm ?? titleFromHistory ?? titleFromBatch, "Prueba")
    const coursePart = sanitizeZipPart(courseFromForm ?? courseFromHistory ?? courseFromBatch, "Curso")
    const datePart = format(new Date(), "yyyy-MM-dd")
    const zipName = `${examPart}_${coursePart}_${datePart}.zip`

    const zip = new JSZip()
    setPhase("zipping")
    setTotalPlanned(rows.length)
    setCurrentIndex(0)
    setSkipped(0)
    let skipCount = 0
    const okIds: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      setCurrentIndex(i + 1)
      await yieldToMain()

      const payload = await fetchAnalysisJson(row.id)
      if ("error" in payload) {
        skipCount++
        setSkipped(skipCount)
        continue
      }

      const pdf = await dataUrlToPdfBlob(payload, {
        studentName: row.first_student_name,
        courseLabel: row.course_label ?? courseFromForm ?? courseFromBatch,
        evaluationLabel: row.title ?? titleFromForm ?? titleFromBatch,
      })

      if (!pdf.ok) {
        skipCount++
        setSkipped(skipCount)
        continue
      }

      zip.file(pdfFileNameForRow(row), pdf.blob)
      okIds.push(row.id)
      await yieldToMain()
    }

    if (okIds.length === 0) {
      setPhase("idle")
      toast({
        title: "No se generó el ZIP",
        description: skipCount > 0 ? `${skipCount} informes omitidos (sin datos o error).` : "Sin PDFs válidos.",
        variant: "destructive",
      })
      return
    }

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" })
    saveAs(blob, zipName)

    setPhase("done")

    try {
      await fetch("/api/batch-exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          batch_id: batchId,
          zip_filename: zipName,
          exam_title: titleFromForm ?? titleFromHistory ?? titleFromBatch,
          course_label: courseFromForm ?? courseFromHistory ?? courseFromBatch,
          evaluation_ids: okIds,
        }),
      })
      onRecorded?.()
    } catch {
      /* historial opcional */
    }

    toast({
      title: "ZIP descargado",
      description:
        skipCount > 0
          ? `Listo: ${okIds.length} PDFs. Omitidos: ${skipCount}.`
          : `Listo: ${okIds.length} informes en ${zipName}.`,
    })
  }

  const busy = phase === "zipping"

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Exportar lote a ZIP
          </DialogTitle>
          <DialogDescription>
            Genera un PDF por evaluación del lote (mismo contenido que el informe pedagógico individual) y los comprime. El proceso puede tardar varios minutos en lotes grandes.
          </DialogDescription>
        </DialogHeader>

        {loadingList ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando evaluaciones del lote…
          </div>
        ) : listError ? (
          <p className="text-sm text-destructive">{listError}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">Evaluaciones en este lote:</span> {rows.length}
            </p>
            {phase === "zipping" && (
              <div className="space-y-2">
                <p>
                  Generando informe {currentIndex} de {totalPlanned}…
                </p>
                <Progress value={progressPct} className="h-2" />
                {skipped > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Omitidos hasta ahora: {skipped}</p>
                )}
              </div>
            )}
            {phase === "done" && <p className="text-green-700 dark:text-green-400">Descarga completada.</p>}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button
            type="button"
            disabled={busy || loadingList || !!listError || rows.length === 0}
            onClick={() => void runExport()}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Generando…
              </>
            ) : (
              "Generar y descargar ZIP"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
