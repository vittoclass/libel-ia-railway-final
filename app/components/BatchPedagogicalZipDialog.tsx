"use client"

/**
 * ZIP masivo: Informes_Individuales + Resumen_SIMCE_Curso + Analisis_Pedagogico.
 * Flujo estricto: generar PDF → validar Blob → añadir a JSZip; si falla un paso, no se entrega ZIP.
 * Si falta course_id unificado, se genera ZIP solo con informes individuales (modo degradado).
 */
import * as React from "react"
import JSZip from "jszip"
import { saveAs } from "file-saver"
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
import { CourseAnalisisPedagogicoZipBody, CourseResumenSimceZipBody } from "@/app/components/CourseBatchZipPdfViews"
import type { CourseZipSummaryPayload } from "@/app/components/CourseBatchZipPdfViews"
import { exportElementToPdfBlob } from "@/app/lib/export-report-pdf"
import type { PedagogicalAnalysisExportData } from "@/app/lib/pedagogical-analysis-export-types"
import { formatStudentDisplayName } from "@/app/lib/format-student-name"

type BatchEvalRow = {
  id: string
  title: string | null
  course_id: string | null
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

type ZipAccumulator = { file(path: string, data: ArrayBuffer): unknown }

/** Vuelca el PDF a ArrayBuffer antes de añadirlo al ZIP (libera presión de memoria vs. retener muchos Blob). */
async function zipAddPdfBuffer(zip: ZipAccumulator, path: string, blob: Blob): Promise<void> {
  if (!blob || blob.size === 0) throw new Error(`PDF vacío: ${path}`)
  const ab = await blob.arrayBuffer()
  zip.file(path, ab)
}

/** Descarga de respaldo si saveAs falla o el navegador bloquea (popup / extensiones). */
function downloadBlobWithObjectUrl(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.rel = "noopener"
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function saveZipBlob(blob: Blob, filename: string): void {
  try {
    saveAs(blob, filename)
  } catch (e) {
    console.warn("[BatchPedagogicalZipDialog] saveAs falló, usando enlace de descarga:", e)
    downloadBlobWithObjectUrl(blob, filename)
  }
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

async function fetchCourseSummaryJson(courseId: string): Promise<CourseZipSummaryPayload | { error: string }> {
  const r = await fetch(`/api/courses/${encodeURIComponent(courseId)}/pedagogical-summary`, {
    credentials: "include",
    cache: "no-store",
  })
  const j = (await r.json()) as CourseZipSummaryPayload & { error?: string }
  if (!r.ok || (j as { error?: string }).error) {
    return { error: typeof (j as { error?: string }).error === "string" ? (j as { error: string }).error : "Error al cargar resumen del curso" }
  }
  return j as CourseZipSummaryPayload
}

async function dataUrlToPdfBlob(
  data: PedagogicalAnalysisExportData,
  labels: {
    studentName: string | null
    courseLabel: string | null
    evaluationLabel: string | null
  },
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
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

async function courseSummaryToPdfBlob(
  payload: CourseZipSummaryPayload,
  courseLabel: string,
  variant: "resumen" | "analisis",
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  const host = document.createElement("div")
  host.setAttribute("data-batch-course-pdf-host", "1")
  host.style.cssText =
    "position:fixed;left:-12000px;top:0;width:768px;max-width:768px;background:#ffffff;color:#0f172a;z-index:-1;overflow:visible;"
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => {
      root.render(
        <div className="bg-white">
          {variant === "resumen" ? (
            <CourseResumenSimceZipBody data={payload} courseLabel={courseLabel} />
          ) : (
            <CourseAnalisisPedagogicoZipBody data={payload} courseLabel={courseLabel} />
          )}
        </div>,
      )
    })
    await waitForLayout()
    const inner = host.firstElementChild as HTMLElement | null
    if (!inner) return { ok: false, error: "Sin nodo de resumen curso" }
    return await exportElementToPdfBlob(inner)
  } finally {
    root.unmount()
    host.remove()
  }
}

/** Mismo course_id UUID en todas las filas y no nulo. */
function resolveBatchCourseId(rows: BatchEvalRow[]): { courseId: string } | { error: string } {
  const first = rows[0]?.course_id?.trim() ?? ""
  if (!first) {
    return {
      error:
        "Este lote no tiene curso asignado en las evaluaciones (course_id). Edita el curso en cada evaluación o desde la lista para poder generar el resumen SIMCE y el análisis pedagógico del curso.",
    }
  }
  for (const r of rows) {
    const c = r.course_id?.trim() ?? ""
    if (c !== first) {
      return { error: "Las evaluaciones del lote deben compartir el mismo curso (mismo course_id) para unificar el ZIP." }
    }
  }
  return { courseId: first }
}

function individualPdfBaseName(row: BatchEvalRow): string {
  const id = sanitizeZipPart(formatStudentDisplayName(row.first_student_name) || row.first_student_name, "")
  const short = row.id.replace(/-/g, "").slice(0, 8)
  const base = id || `eval_${short}` || "estudiante"
  return `${base}_Informe_Individual`
}

export type BatchPedagogicalZipDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  batchId: string | null
  suggestedExamTitle?: string | null
  suggestedCourseLabel?: string | null
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
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [progressCurrent, setProgressCurrent] = React.useState(0)
  const [progressTotal, setProgressTotal] = React.useState(0)
  const [progressLabel, setProgressLabel] = React.useState("")

  React.useEffect(() => {
    if (!open || !batchId) {
      setRows([])
      setListError(null)
      setPhase("idle")
      setIsGenerating(false)
      setProgressCurrent(0)
      setProgressTotal(0)
      setProgressLabel("")
      return
    }
    let cancelled = false
    setLoadingList(true)
    setListError(null)
    setPhase("idle")
    setIsGenerating(false)
    setProgressCurrent(0)
    setProgressTotal(0)
    setProgressLabel("")
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

  const progressPct = progressTotal > 0 ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100)) : 0

  const busy = isGenerating || phase === "zipping"

  const runSimplePdfExport = async () => {
    if (!batchId || rows.length === 0) return
    console.log("[BatchPedagogicalZipDialog] Descarga simple: 1 PDF de prueba…")
    setIsGenerating(true)
    setPhase("zipping")
    setProgressLabel("Generando un solo PDF de prueba…")
    setProgressTotal(1)
    setProgressCurrent(0)
    try {
      const row = rows[0]
      const titleFromForm = suggestedExamTitle?.trim() || null
      const courseFromForm = suggestedCourseLabel?.trim() || null
      const titleFromBatch = rows.find((r) => r.title?.trim())?.title?.trim() ?? null
      const courseFromBatch = rows.find((r) => r.course_label?.trim())?.course_label?.trim() ?? null

      const payload = await fetchAnalysisJson(row.id)
      if ("error" in payload) throw new Error(payload.error)

      const pdf = await dataUrlToPdfBlob(payload, {
        studentName: row.first_student_name,
        courseLabel: row.course_label ?? courseFromForm ?? courseFromBatch,
        evaluationLabel: row.title ?? titleFromForm ?? titleFromBatch,
      })
      if (!pdf.ok) throw new Error(pdf.error)
      if (!pdf.blob || pdf.blob.size === 0) throw new Error("PDF vacío")

      const fname = `${individualPdfBaseName(row)}_PRUEBA.pdf`
      saveZipBlob(pdf.blob, fname)
      setProgressCurrent(1)
      setPhase("done")
      setProgressLabel("PDF de prueba descargado.")
      toast({ title: "Descarga simple lista", description: fname })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPhase("idle")
      toast({ title: "Falló la descarga simple", description: msg, variant: "destructive" })
    } finally {
      setIsGenerating(false)
    }
  }

  const runExport = async () => {
    if (!batchId || rows.length === 0) return

    console.log("Iniciando proceso de ZIP…", { batchId, evaluaciones: rows.length })
    setIsGenerating(true)
    setPhase("zipping")
    setProgressLabel("Validando lote y dependencias…")
    setProgressCurrent(0)

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

    const courseCheck = resolveBatchCourseId(rows)
    const courseId = "error" in courseCheck ? null : courseCheck.courseId
    const partialZipOnly = courseId == null

    if (partialZipOnly && "error" in courseCheck) {
      console.warn("[BatchPedagogicalZipDialog] ZIP parcial (solo individuales):", courseCheck.error)
      toast({
        title: "ZIP sin resumen de curso",
        description: `${courseCheck.error} Se generarán solo los informes individuales en el ZIP.`,
      })
    }

    const zip = new JSZip()
    const totalSteps = partialZipOnly ? rows.length : rows.length + 2
    setProgressTotal(totalSteps)
    setProgressCurrent(0)
    setProgressLabel(partialZipOnly ? "Generando solo informes individuales…" : "Generando informes y resumen de curso…")

    const okIds: string[] = []

    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        setProgressLabel(`Procesando alumno ${i + 1} de ${rows.length} — informe individual…`)
        setProgressCurrent(i)
        await yieldToMain()

        const payload = await fetchAnalysisJson(row.id)
        if ("error" in payload) {
          throw new Error(
            `Alumno ${i + 1} (${formatStudentDisplayName(row.first_student_name) || row.first_student_name || row.id}): ${payload.error}`,
          )
        }

        const pdf = await dataUrlToPdfBlob(payload, {
          studentName: row.first_student_name,
          courseLabel: row.course_label ?? courseFromForm ?? courseFromBatch,
          evaluationLabel: row.title ?? titleFromForm ?? titleFromBatch,
        })

        if (!pdf.ok) {
          throw new Error(`Alumno ${i + 1}: ${pdf.error}`)
        }
        if (!pdf.blob || pdf.blob.size === 0) {
          throw new Error(`Alumno ${i + 1}: PDF vacío`)
        }

        const fname = `${individualPdfBaseName(row)}.pdf`
        await zipAddPdfBuffer(zip, `Informes_Individuales/${fname}`, pdf.blob)
        okIds.push(row.id)
        setProgressCurrent(i + 1)
        await yieldToMain()
      }

      if (courseId) {
        setProgressLabel("Cargando datos del curso para resumen SIMCE y análisis…")
        const summaryPayload = await fetchCourseSummaryJson(courseId)
        if ("error" in summaryPayload) {
          throw new Error(summaryPayload.error)
        }

        const courseLabelForFiles = coursePart

        setProgressLabel(`Generando resumen SIMCE del curso (${rows.length} informes listos) + análisis…`)
        const resumenPdf = await courseSummaryToPdfBlob(summaryPayload, courseLabelForFiles, "resumen")
        if (!resumenPdf.ok) throw new Error(resumenPdf.error)
        if (!resumenPdf.blob || resumenPdf.blob.size === 0) throw new Error("PDF de resumen SIMCE vacío")
        await zipAddPdfBuffer(
          zip,
          `Resumen_SIMCE_Curso/${courseLabelForFiles}_Resumen_SIMCE_Curso.pdf`,
          resumenPdf.blob,
        )
        setProgressCurrent(rows.length + 1)

        setProgressLabel("Generando análisis pedagógico (informe técnico para el profesor)…")
        const analisisPdf = await courseSummaryToPdfBlob(summaryPayload, courseLabelForFiles, "analisis")
        if (!analisisPdf.ok) throw new Error(analisisPdf.error)
        if (!analisisPdf.blob || analisisPdf.blob.size === 0) throw new Error("PDF de análisis pedagógico vacío")
        await zipAddPdfBuffer(zip, `Analisis_Pedagogico/${courseLabelForFiles}_Analisis_Pedagogico.pdf`, analisisPdf.blob)
        setProgressCurrent(totalSteps)
      }

      setProgressLabel("Comprimiendo ZIP…")
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" })
      if (!blob || blob.size === 0) throw new Error("ZIP vacío")
      const outZipName = partialZipOnly ? `${examPart}_${coursePart}_${datePart}_solo_individuales.zip` : zipName
      saveZipBlob(blob, outZipName)

      setPhase("done")
      setProgressLabel("Descarga completada.")

      try {
        await fetch("/api/batch-exports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            batch_id: batchId,
            zip_filename: outZipName,
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
        description: partialZipOnly
          ? `${okIds.length} informes individuales (sin carpetas de curso: unifica course_id en el lote para resumen SIMCE y análisis).`
          : `Paquete completo: ${okIds.length} informes + resumen SIMCE + análisis pedagógico.`,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[BatchPedagogicalZipDialog] ZIP error:", e)
      setPhase("idle")
      setProgressCurrent(0)
      setProgressTotal(0)
      setProgressLabel("")
      toast({
        title: "Exportación interrumpida",
        description: msg,
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Descarga completa (ZIP)
          </DialogTitle>
          <DialogDescription>
            Con curso unificado (mismo course_id) se generan tres carpetas. Si falta, se descarga un ZIP solo con informes individuales. Si falla un PDF individual, no se entrega el ZIP.
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
            {(phase === "zipping" || isGenerating) && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground leading-snug">{progressLabel}</p>
                <Progress value={progressPct} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Avance: {progressCurrent} / {progressTotal} pasos
                </p>
              </div>
            )}
            {phase === "done" && <p className="text-green-700 dark:text-green-400">{progressLabel || "Listo."}</p>}
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || loadingList || !!listError || rows.length === 0}
            onClick={(e) => {
              e.preventDefault()
              void runSimplePdfExport()
            }}
          >
            Descarga simple (1 PDF)
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={busy || loadingList || !!listError || rows.length === 0}
            onClick={(e) => {
              e.preventDefault()
              void runExport()
            }}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Generando…
              </>
            ) : (
              "Descarga completa (ZIP)"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
