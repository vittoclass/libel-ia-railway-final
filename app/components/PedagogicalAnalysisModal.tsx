"use client"

/**
 * Modal de anÃ¡lisis pedagÃ³gico por evaluaciÃ³n.
 * Consume GET /api/evaluations/[id]/pedagogical-analysis.
 * No modifica Ver informe ni el flujo de evaluaciÃ³n.
 */
import * as React from "react"
import { useState, useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, BookOpen, FileDown } from "lucide-react"
import { exportElementToPdf } from "@/app/lib/export-report-pdf"
import { useToast } from "@/hooks/use-toast"
import type { PedagogicalAnalysisExportData } from "@/app/lib/pedagogical-analysis-export-types"
import { PedagogicalAnalysisReportBody } from "@/app/components/PedagogicalAnalysisReportBody"

type Props = {
  evaluationId: string | null
  /** Opcional: nombre/alumno o tÃ­tulo de evaluaciÃ³n para el tÃ­tulo del modal */
  evaluationLabel?: string | null
  /** Opcional: nombre del estudiante (para contexto e informe PDF) */
  studentName?: string | null
  /** Opcional: nombre del curso (para contexto e informe PDF) */
  courseLabel?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function PedagogicalAnalysisModal({
  evaluationId,
  evaluationLabel,
  studentName,
  courseLabel,
  open,
  onOpenChange,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PedagogicalAnalysisExportData | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const [exportPdfLoading, setExportPdfLoading] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (!open || !evaluationId) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setData(null)
    fetch(`/api/evaluations/${evaluationId}/pedagogical-analysis`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(j.error || "Error al cargar")
          setData(null)
          return
        }
        setData(j)
      })
      .catch(() => {
        setError("No se pudo cargar el anÃ¡lisis pedagÃ³gico.")
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [open, evaluationId])

  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && data) {
      console.info("[PedagogicalAnalysisModal] data received", {
        evaluationId,
        has_source_exam: data.has_source_exam,
        has_evaluation_items: data.has_evaluation_items,
        has_source_exam_items: data.has_source_exam_items,
        analysis_available: data.analysis_available,
        status_reason: data.status_reason,
      })
    }
  }, [data, evaluationId])

  const showAnalysis =
    data?.analysis_available === true ||
    (data && data.has_source_exam && (data.by_question?.length ?? 0) > 0 && data.analysis_available !== false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Análisis pedagógico de evaluación{evaluationLabel ? ` — ${evaluationLabel}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div ref={reportRef} className="space-y-4 text-sm">
          <PedagogicalAnalysisReportBody
            loading={loading}
            error={error}
            data={data}
            studentName={studentName}
            courseLabel={courseLabel}
            evaluationLabel={evaluationLabel}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={exportPdfLoading || !data || !showAnalysis}
            onClick={async () => {
              if (!reportRef.current) return
              setExportPdfLoading(true)
              const name = (evaluationLabel || "evaluacion").replace(/[^\w\u00C0-\u024F\s\-]/g, "").replace(/\s+/g, "_").slice(0, 60)
              const result = await exportElementToPdf(reportRef.current, `libelia_informe_estudiante_${name}.pdf`)
              setExportPdfLoading(false)
              if (!result.ok && result.error) toast({ title: result.error, variant: "destructive" })
            }}
          >
            {exportPdfLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
            Exportar informe PDF
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
