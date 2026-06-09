"use client"

/**
 * Modal de resumen pedagógico por curso.
 * Consume GET /api/courses/[courseId]/pedagogical-summary.
 * No modifica el diagnóstico actual del curso.
 */
import * as React from "react"
import { useState, useEffect, useRef, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Loader2, FolderOpen, FileDown } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
} from "recharts"
import { exportElementToPdf } from "@/app/lib/export-report-pdf"
import { useToast } from "@/hooks/use-toast"
import { buildPedagogicalDiagnosis } from "@/app/lib/pedagogical-diagnosis-text"
import { QuestionHeatMap } from "@/app/components/QuestionHeatMap"
import { downloadCsvFile } from "@/app/lib/csv-export"
import { EXAM_TYPE_FILTER_OPTIONS_WITH_NATIONAL } from "@/app/lib/exam-type-constants"
import { SIMCE_PROJECTION_DISCLAIMER } from "@/app/lib/simceProjectionCanonical"
import { projectPaesFromLogroPct, projectSimceFromLogroPct } from "@/app/lib/standard-scale-converters"
import { formatPedagogicalReadableText } from "@/app/lib/pedagogical-export-formatting"

type LogroRowChile = {
  dimension_value: string
  logro_pct: number | null
  question_count: number
  achievement_level?: "Insuficiente" | "Elemental" | "Adecuado" | null
  chile_eje_tematico?: string | null
  chile_indicador_code?: string | null
  chile_indicador_descriptor?: string | null
}

type SummaryData = {
  course: string
  evaluation_count: number
  evaluation_count_total?: number
  evaluation_count_with_source_exam?: number
  evaluation_count_analyzable?: number
  evaluation_count_without_source_exam?: number
  evaluation_count_without_items?: number
  summary_available?: boolean
  status_reason?: string
  student_count: number
  by_axis: LogroRowChile[]
  by_skill: LogroRowChile[]
  by_cognitive_level: Array<{ dimension_value: string; logro_pct: number | null; question_count: number }>
  weakest_skills: Array<{ skill: string; average_logro_pct: number | null }>
  weakest_axes: Array<{ axis: string; average_logro_pct: number | null; question_count: number }>
  most_failed_questions: Array<{
    item_number: number
    axis: string
    skill: string
    error_pct: number
    student_count: number
  }>
  question_heat_map?: Array<{ item_number: number; logro_pct: number | null; axis?: string; skill?: string }>
  analytics_mode?: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
  item_analysis_course?: Array<{
    item_number: number
    correct_answer: string | null
    pct_correct: number
    pct_wrong: number
    pct_omitted: number
    biserial_xc: number | null
    distractors: { A: number; B: number; C: number; D: number; E: number }
  }>
  exam_type_filter?: string | null
  chile_agency_cuts_note?: string | null
  segmentation?: Array<{
    subject_key: string
    subject_display: string
    instrument_family: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
    evaluation_count: number
    evaluation_ids: string[]
  }>
  segment_auto_selected?: boolean
  subject_filter?: string | null
  instrument_family_filter?: string | null
  national_analytics?: {
    enabled: boolean
    by_evaluation: Array<{
      evaluation_id: string
      student_name: string
      note_7: number | null
      score_obtained: number
      score_max: number
      logro_pct: number | null
      paes_score: number | null
      simce_score: number | null
      simce_level: "Adecuado" | "Elemental" | "Insuficiente" | null
      instrument_analytics_mode?: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
    }>
    course_summary: {
      average_note_7: number | null
      average_logro_pct: number | null
      average_paes: number
      average_simce: number
      simce_distribution: {
        Adecuado: number
        Elemental: number
        Insuficiente: number
      }
    }
  }
}

type Props = {
  courseId: string | null
  courseLabel?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function toSafeText(value: unknown, fallback = "N/A"): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

// SNAPSHOT_NATIONAL_ANALYTICS_V1: extractor semantico para labels pedagogicos
function pickPedagogicalLabel(value: unknown, fallback = "N/A"): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    if (typeof obj.descripcion === "string" && obj.descripcion.trim()) return obj.descripcion
    if (typeof obj.label === "string" && obj.label.trim()) return obj.label
    if (typeof obj.nombre === "string" && obj.nombre.trim()) return obj.nombre
    if (typeof obj.name === "string" && obj.name.trim()) return obj.name
    if (typeof obj.titulo === "string" && obj.titulo.trim()) return obj.titulo
    if (typeof obj.title === "string" && obj.title.trim()) return obj.title
    if (typeof obj.ejemplo === "string" && obj.ejemplo.trim()) return obj.ejemplo
  }
  return toSafeText(value, fallback)
}

function formatPedagogyForDisplay(value: unknown, fallback = "N/A"): string {
  const s = pickPedagogicalLabel(value, fallback)
  if (s === fallback || s === "—") return s
  return formatPedagogicalReadableText(s)
}

function normalizeSummaryData(raw: SummaryData): SummaryData {
  // SNAPSHOT_NATIONAL_ANALYTICS_V1: normalizacion de entrada para impedir objetos en render
  const mapDimensionRows = (rows: LogroRowChile[]) =>
    (rows ?? []).map((r) => ({
      ...r,
      dimension_value: formatPedagogyForDisplay(r.dimension_value),
    }))

  return {
    ...raw,
    course: toSafeText(raw.course, "Curso"),
    by_axis: mapDimensionRows(raw.by_axis),
    by_skill: mapDimensionRows(raw.by_skill),
    by_cognitive_level: mapDimensionRows(raw.by_cognitive_level),
    weakest_skills: (raw.weakest_skills ?? []).map((s) => ({
      ...s,
      skill: formatPedagogyForDisplay(s.skill),
    })),
    weakest_axes: (raw.weakest_axes ?? []).map((a) => ({
      ...a,
      axis: formatPedagogyForDisplay(a.axis),
    })),
    most_failed_questions: (raw.most_failed_questions ?? []).map((q) => ({
      ...q,
      error_pct: Math.min(100, Math.max(0, Number(q.error_pct ?? 0))),
      axis: formatPedagogyForDisplay(q.axis),
      skill: formatPedagogyForDisplay(q.skill),
    })),
    question_heat_map: (raw.question_heat_map ?? []).map((q) => ({
      ...q,
      axis: formatPedagogyForDisplay(q.axis ?? "—", "—"),
      skill: formatPedagogyForDisplay(q.skill ?? "—", "—"),
    })),
    national_analytics: raw.national_analytics
      ? {
          ...raw.national_analytics,
          by_evaluation: (raw.national_analytics.by_evaluation ?? []).map((r) => ({
            ...r,
            student_name: toSafeText(r.student_name, "Estudiante"),
          })),
        }
      : raw.national_analytics,
  }
}

function clampDisplayPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function formatPct(value: number | null | undefined): string {
  // DATA_NORMALIZATION_V2: no evaluado se representa con guion.
  if (value == null || !Number.isFinite(Number(value))) return "—"
  return `${clampDisplayPct(Number(value))}%`
}

function chartPct(value: number | null | undefined): number {
  return value == null || !Number.isFinite(Number(value)) ? 0 : clampDisplayPct(Number(value))
}

function computeGlobalLogroPct(data: SummaryData): number | null {
  const fromItems =
    (data.item_analysis_course ?? []).length > 0
      ? (data.item_analysis_course ?? []).reduce((sum, r) => sum + Number(r.pct_correct ?? 0), 0) /
        (data.item_analysis_course ?? []).length
      : null
  const fromAxes =
    (data.by_axis ?? []).length > 0
      ? (data.by_axis ?? []).reduce((sum, r) => sum + Number(r.logro_pct ?? 0), 0) / (data.by_axis ?? []).length
      : null
  const fromNational =
    data.national_analytics?.course_summary?.average_logro_pct != null
      ? Number(data.national_analytics.course_summary.average_logro_pct)
      : null
  const value = fromItems ?? fromAxes ?? fromNational
  return value == null || !Number.isFinite(value) ? null : Math.round(value)
}

function isMissingPedagogyLabel(value: unknown): boolean {
  const normalized = pickPedagogicalLabel(value, "N/A").trim().toLowerCase()
  return (
    normalized === "n/a" ||
    normalized === "sin eje" ||
    normalized === "sin habilidad" ||
    normalized === "sin metadata" ||
    normalized === "—"
  )
}

function SummaryBlock({ data }: { data: SummaryData }) {
  const total = data.evaluation_count_total ?? data.evaluation_count
  const withSource = data.evaluation_count_with_source_exam
  const analyzable = data.evaluation_count_analyzable
  const hasNewFields = withSource !== undefined || analyzable !== undefined
  const avgLogro = computeGlobalLogroPct(data)
  const analyticsMode = data.analytics_mode
  const estimatedNationalScore =
    avgLogro == null || !Number.isFinite(avgLogro)
      ? null
      : analyticsMode === "SIMCE"
        ? { kind: "SIMCE" as const, value: projectSimceFromLogroPct(avgLogro) }
        : analyticsMode === "PAES"
          ? { kind: "PAES" as const, value: projectPaesFromLogroPct(avgLogro) }
          : null
  return (
    <div className="rounded-md border bg-[var(--bg-muted)] p-3 space-y-2">
      <div className="font-medium text-[var(--text-accent)]">Resumen del curso</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span><strong>Curso:</strong> {toSafeText(data.course, "Curso")}</span>
        <span><strong>Evaluaciones encontradas:</strong> {total}</span>
        <span><strong>Con prueba base:</strong> {hasNewFields && withSource !== undefined ? withSource : "—"}</span>
        <span><strong>Analizables:</strong> {hasNewFields && analyzable !== undefined ? analyzable : "—"}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {total} evaluación{total !== 1 ? "es" : ""} en este curso.
        {hasNewFields && withSource !== undefined && ` ${withSource} con prueba base asociada.`}
        {hasNewFields && analyzable !== undefined && ` ${analyzable} con análisis pedagógico disponible.`}
      </p>
      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm">
        {estimatedNationalScore != null ? (
          <>
            <span className="font-semibold text-indigo-900">
              Puntaje estimado del curso ({estimatedNationalScore.kind}):
            </span>{" "}
            <span className="text-indigo-800 font-bold">{`${Math.round(estimatedNationalScore.value)} puntos`}</span>
            {avgLogro != null && Number.isFinite(avgLogro) ? (
              <span className="text-indigo-700"> · basado en logro promedio {Math.round(avgLogro)}%</span>
            ) : null}
            {estimatedNationalScore.kind === "SIMCE" ? (
              <span className="block text-xs text-indigo-700 mt-1">{SIMCE_PROJECTION_DISCLAIMER}</span>
            ) : null}
          </>
        ) : (
          <>
            {avgLogro != null && Number.isFinite(avgLogro) ? (
              <>
                <span className="font-semibold text-indigo-900">Logro promedio (institucional):</span>{" "}
                <span className="text-indigo-800 font-bold">{Math.round(avgLogro)}%</span>
                <span className="text-indigo-700">
                  {" "}
                  · Sin proyección SIMCE/PAES en esta tarjeta (segmento institucional u otro modo).
                </span>
              </>
            ) : (
              <span className="text-indigo-800">Sin logro agregado para estimar.</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function NoSummaryMessage({ data }: { data: SummaryData }) {
  const total = data.evaluation_count_total ?? data.evaluation_count
  const reason = data.status_reason
  if (total === 0) {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        No hay evaluaciones en este curso.
      </p>
    )
  }
  if (reason === "evaluations_found_but_none_associated") {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        Hay evaluaciones en este curso, pero ninguna tiene prueba base asociada.
      </p>
    )
  }
  if (reason === "evaluations_associated_but_no_items") {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        Hay evaluaciones asociadas, pero aún no tienen datos suficientes para análisis pedagógico.
      </p>
    )
  }
  if (reason === "requires_subject_and_instrument_family") {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        Este curso tiene evaluaciones en más de una combinación asignatura / familia de instrumento (SIMCE, PAES o internas).
        Elija <strong>asignatura</strong> y <strong>familia</strong> arriba para ver un resumen sin mezclar segmentos.
      </p>
    )
  }
  if (reason === "no_evaluations_for_segment") {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        No hay evaluaciones que coincidan con la asignatura y familia seleccionadas. Pruebe otra combinación.
      </p>
    )
  }
  return (
    <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
      No hay datos suficientes para mostrar el resumen pedagógico en este curso.
    </p>
  )
}

export default function CoursePedagogicalSummaryModal({
  courseId,
  courseLabel,
  open,
  onOpenChange,
}: Props) {
  // SNAPSHOT_NATIONAL_ANALYTICS_V1: utilitario defensivo de render para evitar "Objects are not valid as a React child"
  const safeText = toSafeText
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SummaryData | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const [exportPdfLoading, setExportPdfLoading] = useState(false)
  const [showNationalAnalytics, setShowNationalAnalytics] = useState(true)
  const [examTypeFilter, setExamTypeFilter] = useState("")
  const [segmentSubject, setSegmentSubject] = useState("")
  const [segmentFamily, setSegmentFamily] = useState<"" | "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER">("")
  const { toast } = useToast()

  const subjectOptions = useMemo(() => {
    const seg = data?.segmentation
    if (!seg?.length) return [] as Array<{ key: string; label: string }>
    const m = new Map<string, string>()
    for (const s of seg) {
      if (!m.has(s.subject_key)) m.set(s.subject_key, s.subject_display)
    }
    return Array.from(m.entries()).map(([key, label]) => ({ key, label }))
  }, [data?.segmentation])

  useEffect(() => {
    if (!open) {
      setSegmentSubject("")
      setSegmentFamily("")
    }
  }, [open])

  useEffect(() => {
    // SNAPSHOT_NATIONAL_ANALYTICS_V1: persistencia local del switch de proyecciones
    if (typeof window === "undefined") return
    try {
      const stored = window.localStorage.getItem("libelia_show_national_analytics")
      if (stored === null) {
        setShowNationalAnalytics(true)
        return
      }
      setShowNationalAnalytics(stored !== "false")
    } catch {
      setShowNationalAnalytics(true)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem("libelia_show_national_analytics", showNationalAnalytics ? "true" : "false")
    } catch {
      // ignore storage failures
    }
  }, [showNationalAnalytics])

  useEffect(() => {
    if (!open || !courseId) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setData(null)
    const qs = new URLSearchParams()
    if (examTypeFilter.trim()) qs.set("exam_type", examTypeFilter.trim())
    if (segmentSubject.trim()) qs.set("subject", segmentSubject.trim())
    if (segmentFamily) qs.set("instrument_family", segmentFamily)
    const qstr = qs.toString()
    const url = `/api/courses/${encodeURIComponent(courseId)}/pedagogical-summary${qstr ? `?${qstr}` : ""}`
    fetch(url, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(j.error || "Error al cargar")
          setData(null)
          return
        }
        setData(normalizeSummaryData(j as SummaryData))
      })
      .catch(() => {
        setError("No se pudo cargar el resumen pedagógico.")
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [open, courseId, examTypeFilter, segmentSubject, segmentFamily])

  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && open && courseId) {
      console.info("[CoursePedagogicalSummaryModal] open", { courseId, courseLabel: courseLabel ?? null })
    }
  }, [open, courseId, courseLabel])

  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && data) {
      console.info("[CoursePedagogicalSummaryModal] data received", {
        course: data.course,
        evaluation_count_total: data.evaluation_count_total,
        evaluation_count_with_source_exam: data.evaluation_count_with_source_exam,
        evaluation_count_analyzable: data.evaluation_count_analyzable,
        summary_available: data.summary_available,
        status_reason: data.status_reason,
      })
    }
  }, [data])

  const courseDisplayName = courseLabel ?? data?.course ?? (courseId ? String(courseId) : null) ?? "Curso"
  const national = data?.national_analytics
  // DATA_SCIENCE_FIX_V1: detectar metadata incompleta antes de graficos.
  const hasMissingAxisMetadata = Boolean(data?.by_axis.some((r) => isMissingPedagogyLabel(r.dimension_value)))
  const hasMissingSkillMetadata = Boolean(data?.by_skill.some((r) => isMissingPedagogyLabel(r.dimension_value)))
  const shouldShowMetadataWarning =
    Boolean(data) &&
    (((data?.by_axis?.length ?? 0) === 0 || (data?.by_skill?.length ?? 0) === 0) ||
      hasMissingAxisMetadata ||
      hasMissingSkillMetadata)
  // SNAPSHOT_NATIONAL_ANALYTICS_V1: vista desacoplada del flag backend para no ocultar controles del modal
  const hasNational = Boolean(Array.isArray(national?.by_evaluation) && national.by_evaluation.length > 0)
  // SNAPSHOT_NATIONAL_ANALYTICS_V1: normalizacion defensiva para evitar renderizar objetos en <td>
  const nationalRows = hasNational
    ? national!.by_evaluation.map((row) => {
        const safeNote = typeof row.note_7 === "number" && Number.isFinite(row.note_7) ? row.note_7.toFixed(1) : "N/A"
        const safePaes = typeof row.paes_score === "number" && Number.isFinite(row.paes_score) ? row.paes_score : "N/A"
        const safeSimce = typeof row.simce_score === "number" && Number.isFinite(row.simce_score) ? row.simce_score : "N/A"
        const safeLevel =
          row.simce_level === "Adecuado" || row.simce_level === "Elemental" || row.simce_level === "Insuficiente"
            ? row.simce_level
            : "N/A"
        const safeLogro = row.logro_pct == null ? "N/A" : `${clampDisplayPct(Number(row.logro_pct))}%`
        return {
          id: String(row.evaluation_id ?? ""),
          student: safeText(row.student_name, "Estudiante"),
          note: safeNote,
          logro: safeLogro,
          paes: safePaes,
          simce: safeSimce,
          level: safeLevel,
          scoreObtained: typeof row.score_obtained === "number" && Number.isFinite(row.score_obtained) ? row.score_obtained : "N/A",
          scoreMax: typeof row.score_max === "number" && Number.isFinite(row.score_max) ? row.score_max : "N/A",
        }
      })
    : []
  const itemAnalysisRows = data?.item_analysis_course ?? []
  const analyticsModeLabel =
    data?.analytics_mode === "SIMCE"
      ? "SIMCE"
      : data?.analytics_mode === "PAES"
        ? "PAES"
        : "Institucional"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" /> Resumen pedagógico del curso: {safeText(courseDisplayName, "Curso")}
          </DialogTitle>
        </DialogHeader>
        <div ref={reportRef} className="space-y-4 text-sm">
          {!loading && !error && data && (
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] p-3 text-xs">
              <div className="font-semibold text-[var(--text-accent)]">Contexto</div>
              <div>Curso: {safeText(courseDisplayName, "Curso")}</div>
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-[var(--text-muted)] py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </p>
          )}
          {!loading && !error && !data && (
            <p className="text-sm text-[var(--text-muted)]">No se pudo cargar el resumen pedagógico.</p>
          )}
          {!loading && !error && data && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                <div className="text-xs text-muted-foreground shrink-0 space-y-1">
                  <div>
                    <span className="font-medium text-[var(--text-accent)]">Asignatura (filtro institucional)</span>
                    <input
                      list="pedagogy-subject-options"
                      className="ml-2 rounded-md border border-[var(--border-color)] bg-background px-2 py-1 text-sm min-w-[10rem]"
                      value={segmentSubject}
                      onChange={(e) => setSegmentSubject(e.target.value)}
                      placeholder="Ej. Matemática"
                      aria-label="Filtrar por asignatura"
                    />
                    <datalist id="pedagogy-subject-options">
                      {subjectOptions.map((o) => (
                        <option key={o.key} value={o.label} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--text-accent)]">Familia de instrumento</span>
                    <select
                      className="ml-2 rounded-md border border-[var(--border-color)] bg-background px-2 py-1 text-sm"
                      value={segmentFamily}
                      onChange={(e) =>
                        setSegmentFamily(
                          e.target.value as "" | "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER",
                        )
                      }
                      aria-label="Familia SIMCE PAES o internas"
                    >
                      <option value="">— Elegir —</option>
                      <option value="SIMCE">SIMCE</option>
                      <option value="PAES">PAES</option>
                      <option value="INSTITUTIONAL_OTHER">Internas (otras)</option>
                    </select>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--text-accent)]">Tipo de prueba (exam_type, opcional)</span>
                    <select
                      className="ml-2 rounded-md border border-[var(--border-color)] bg-background px-2 py-1 text-sm"
                      value={examTypeFilter}
                      onChange={(e) => setExamTypeFilter(e.target.value)}
                      aria-label="Filtrar por exam_type"
                    >
                      {EXAM_TYPE_FILTER_OPTIONS_WITH_NATIONAL.map((o) => (
                        <option key={o.value || "all"} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              {data.segmentation && data.segmentation.length > 1 && (
                <div className="rounded-md border border-[var(--border-color)] overflow-x-auto text-xs">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-[var(--bg-muted)] text-left">
                        <th className="px-2 py-1.5">Asignatura</th>
                        <th className="px-2 py-1.5">Familia</th>
                        <th className="px-2 py-1.5 text-right">Evaluaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.segmentation.map((s, i) => (
                        <tr key={`${s.subject_key}-${s.instrument_family}-${i}`} className="border-t border-[var(--border-color)]">
                          <td className="px-2 py-1">{safeText(s.subject_display)}</td>
                          <td className="px-2 py-1">{s.instrument_family}</td>
                          <td className="px-2 py-1 text-right">{s.evaluation_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.segment_auto_selected ? (
                <p className="text-xs text-muted-foreground">
                  Segmento único detectado: se muestra automáticamente{" "}
                  <strong>{data.subject_filter ?? "—"}</strong> · <strong>{data.instrument_family_filter ?? "—"}</strong>.
                </p>
              ) : null}
              {data.chile_agency_cuts_note ? (
                <p className="text-xs text-[var(--text-muted)] border border-dashed border-[var(--border-color)] rounded-md px-2 py-1.5">
                  {data.chile_agency_cuts_note}
                </p>
              ) : null}
              <SummaryBlock data={data} />
              {(data.evaluation_count_without_items ?? 0) > 0 && (
                <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
                  Datos incompletos detectados
                </p>
              )}
              {!data.summary_available && (data.evaluation_count_analyzable ?? data.evaluation_count) === 0 && (
                <NoSummaryMessage data={data} />
              )}
              {shouldShowMetadataWarning && (
                <p className="rounded-md border border-orange-500/60 bg-orange-500/10 px-3 py-2 text-orange-800 dark:text-orange-200">
                  {/* LOGICA_ANTERIOR_LOCAL: no se advertia explicitamente por metadatos faltantes de ejes/habilidades */}
                  {/* DATA_SCIENCE_FIX_V1: alerta preventiva de integridad para lectura de graficos */}
                  Faltan metadatos pedagógicos (Ejes/Habilidades) en parte de la data. Los gráficos pueden verse incompletos.
                </p>
              )}
              {((data.summary_available === true) || ((data.evaluation_count_analyzable ?? data.evaluation_count) > 0)) && (
            <>
              {data.by_axis.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Logro por eje</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Eje</TableHead>
                        <TableHead className="w-24">Logro %</TableHead>
                        <TableHead className="w-28">Nivel</TableHead>
                        <TableHead className="w-20">Preguntas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_axis.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{pickPedagogicalLabel(r.dimension_value)}</TableCell>
                          <TableCell>
                            <span className={(r.logro_pct ?? -1) >= 70 ? "text-green-600" : (r.logro_pct ?? 999) < 50 ? "text-amber-600" : ""}>
                              {formatPct(r.logro_pct)}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">{r.achievement_level ?? "—"}</TableCell>
                          <TableCell>{r.question_count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {data.by_skill.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Logro por habilidad</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Habilidad</TableHead>
                        <TableHead className="w-24">Logro %</TableHead>
                        <TableHead className="w-28">Nivel</TableHead>
                        <TableHead className="w-24">Indicador</TableHead>
                        <TableHead className="w-20">Preguntas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_skill.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{pickPedagogicalLabel(r.dimension_value)}</TableCell>
                          <TableCell>
                            <span className={(r.logro_pct ?? -1) >= 70 ? "text-green-600" : (r.logro_pct ?? 999) < 50 ? "text-amber-600" : ""}>
                              {formatPct(r.logro_pct)}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs font-medium">{r.achievement_level ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[140px]" title={r.chile_indicador_descriptor ?? undefined}>
                            {r.chile_indicador_code ?? "—"}
                          </TableCell>
                          <TableCell>{r.question_count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {data.by_cognitive_level.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Logro por nivel cognitivo</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nivel</TableHead>
                        <TableHead className="w-24">Logro %</TableHead>
                        <TableHead className="w-20">Preguntas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_cognitive_level.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{pickPedagogicalLabel(r.dimension_value)}</TableCell>
                          <TableCell>{formatPct(r.logro_pct)}</TableCell>
                          <TableCell>{r.question_count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {data.weakest_skills.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Habilidades más débiles</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {data.weakest_skills.slice(0, 10).map((s, i) => (
                      <li key={i}>{pickPedagogicalLabel(s.skill)}: {formatPct(s.average_logro_pct)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {data.weakest_axes.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Ejes más débiles</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {data.weakest_axes.slice(0, 10).map((a, i) => (
                      <li key={i}>{pickPedagogicalLabel(a.axis)}: {formatPct(a.average_logro_pct)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {data.most_failed_questions.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Preguntas con mayor error</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Nº</TableHead>
                        <TableHead>Eje</TableHead>
                        <TableHead>Habilidad</TableHead>
                        <TableHead className="w-20">Error %</TableHead>
                        <TableHead className="w-24">Estudiantes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.most_failed_questions.map((q, i) => (
                        <TableRow key={i}>
                          <TableCell>{q.item_number}</TableCell>
                          <TableCell className="max-w-[120px] truncate">{pickPedagogicalLabel(q.axis)}</TableCell>
                          <TableCell className="max-w-[120px] truncate">{pickPedagogicalLabel(q.skill)}</TableCell>
                          <TableCell>{q.error_pct}%</TableCell>
                          <TableCell>{q.student_count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {/* Gráficos pedagógicos del curso */}
              <div className="space-y-6 pt-4 border-t border-[var(--border-color)]">
                <h4 className="font-semibold text-[var(--text-accent)]">Gráficos pedagógicos del curso</h4>
                {data.by_axis.length > 0 && (
                  <div className="w-full">
                    <p className="text-sm font-medium text-[var(--text-muted)] mb-2">Promedio por eje</p>
                    <div className="w-full h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.by_axis.map((r) => ({ name: pickPedagogicalLabel(r.dimension_value), logro: chartPct(r.logro_pct) }))}
                          margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" className="opacity-50" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} labelFormatter={(l) => l} />
                          <Bar dataKey="logro" name="Logro %" radius={[4, 4, 0, 0]}>
                            {data.by_axis.map((r, i) => (
                              <Cell key={i} fill={(r.logro_pct ?? -1) >= 70 ? "hsl(var(--chart-2))" : (r.logro_pct ?? 999) < 50 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                {data.by_skill.length > 0 && (
                  <div className="w-full">
                    <p className="text-sm font-medium text-[var(--text-muted)] mb-2">Promedio por habilidad</p>
                    <div className="w-full h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.by_skill.map((r) => ({ name: pickPedagogicalLabel(r.dimension_value), logro: chartPct(r.logro_pct) }))}
                          margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" className="opacity-50" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} labelFormatter={(l) => l} />
                          <Bar dataKey="logro" name="Logro %" radius={[4, 4, 0, 0]}>
                            {data.by_skill.map((r, i) => (
                              <Cell key={i} fill={(r.logro_pct ?? -1) >= 70 ? "hsl(var(--chart-2))" : (r.logro_pct ?? 999) < 50 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                {(data.by_axis.length > 0 || data.by_skill.length > 0) && (
                  <div className="w-full">
                    <p className="text-sm font-medium text-[var(--text-muted)] mb-2">Radar pedagógico del curso</p>
                    <div className="w-full h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart
                          data={
                            data.by_axis.length >= data.by_skill.length
                              ? data.by_axis.map((r) => ({ dimension: pickPedagogicalLabel(r.dimension_value), logro: chartPct(r.logro_pct), fullMark: 100 }))
                              : data.by_skill.map((r) => ({ dimension: pickPedagogicalLabel(r.dimension_value), logro: chartPct(r.logro_pct), fullMark: 100 }))
                          }
                          margin={{ top: 16, right: 16, left: 16, bottom: 16 }}
                        >
                          <PolarGrid stroke="hsl(var(--border))" />
                          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10 }} />
                          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                          <Radar name="Logro %" dataKey="logro" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.4} strokeWidth={2} />
                          <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} contentStyle={{ fontSize: 12 }} />
                          <Legend />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
              {itemAnalysisRows.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-[var(--border-color)]">
                  <div>
                    <h4 className="font-semibold text-[var(--text-accent)]">Tabla de análisis de ítems del curso</h4>
                    <p className="text-xs text-[var(--text-muted)]">
                      Formato técnico para seguimiento UTP/Dirección. Selector automático activo: <strong>{analyticsModeLabel}</strong>.
                    </p>
                  </div>
                  <div className="w-full overflow-x-auto rounded-md border border-[var(--border-color)]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nº</TableHead>
                          <TableHead>Clave</TableHead>
                          <TableHead>% Correctas</TableHead>
                          <TableHead>% Erradas</TableHead>
                          <TableHead>% Omitidas</TableHead>
                          <TableHead>XC Biserial</TableHead>
                          <TableHead>A</TableHead>
                          <TableHead>B</TableHead>
                          <TableHead>C</TableHead>
                          <TableHead>D</TableHead>
                          <TableHead>E</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {itemAnalysisRows.map((r) => (
                          <TableRow key={`item-analysis-${r.item_number}`}>
                            <TableCell>{r.item_number}</TableCell>
                            <TableCell>{r.correct_answer ?? "—"}</TableCell>
                            <TableCell>{r.pct_correct}%</TableCell>
                            <TableCell>{r.pct_wrong}%</TableCell>
                            <TableCell>{r.pct_omitted}%</TableCell>
                            <TableCell>{r.biserial_xc == null ? "—" : r.biserial_xc}</TableCell>
                            <TableCell>{r.distractors.A}%</TableCell>
                            <TableCell>{r.distractors.B}%</TableCell>
                            <TableCell>{r.distractors.C}%</TableCell>
                            <TableCell>{r.distractors.D}%</TableCell>
                            <TableCell>{r.distractors.E}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              {/* SNAPSHOT_NATIONAL_ANALYTICS_V1 */}
              {hasNational && (
                <div className="space-y-4 pt-4 border-t border-[var(--border-color)]">
                  <div className="flex flex-col gap-1">
                    <h4 className="font-semibold text-[var(--text-accent)]">Analítica Nacional (PAES/SIMCE)</h4>
                    <p className="text-xs text-[var(--text-muted)]">
                      Por fila: según <code className="text-[11px]">exam_type</code> de la evaluación — SIMCE sin PAES, PAES sin nivel SIMCE/Agencia, pruebas propias sin columnas nacionales (N/A).
                    </p>
                  </div>
                  <div className="rounded-md border bg-[var(--bg-muted)] p-3 text-sm grid grid-cols-1 md:grid-cols-5 gap-2">
                    <div><strong>Nota 7.0 prom.</strong>: {national?.course_summary.average_note_7 ?? "—"}</div>
                    <div><strong>Logro prom.</strong>: {computeGlobalLogroPct(data) != null ? `${computeGlobalLogroPct(data)}%` : "—"}</div>
                    <div><strong>PAES prom.</strong>: {national?.course_summary.average_paes ?? 100}</div>
                    <div><strong>SIMCE prom.</strong>: {national?.course_summary.average_simce ?? 0}</div>
                    <div>
                      <strong>Distribución nivel logro %</strong>: A {national?.course_summary.simce_distribution.Adecuado ?? 0}% ·
                      E {national?.course_summary.simce_distribution.Elemental ?? 0}% ·
                      I {national?.course_summary.simce_distribution.Insuficiente ?? 0}%
                    </div>
                  </div>
                  {/* SNAPSHOT_NATIONAL_ANALYTICS_V1: columnas nacionales forzadas en detalle */}
                  <div className="w-full overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Estudiante</TableHead>
                          <TableHead className="w-20">Nota 7.0</TableHead>
                          <TableHead className="w-20">PAES</TableHead>
                          <TableHead className="w-20">SIMCE</TableHead>
                          <TableHead className="w-28">Nivel (logro %)</TableHead>
                          <TableHead className="w-20">Logro %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {nationalRows.map((alumno) => (
                          <TableRow key={alumno.id}>
                            <TableCell>{safeText(alumno.student, "Estudiante")}</TableCell>
                            <TableCell>{alumno.note || "-"}</TableCell>
                            <TableCell>{alumno.paes === "N/A" || alumno.paes == null ? "-" : alumno.paes}</TableCell>
                            <TableCell>{alumno.simce === "N/A" || alumno.simce == null ? "-" : alumno.simce}</TableCell>
                            <TableCell>{alumno.level === "N/A" || alumno.level == null ? "-" : alumno.level}</TableCell>
                            <TableCell>{alumno.logro || "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              {/* Diagnóstico pedagógico, evidencia y mapa de calor (después de los gráficos) */}
              {(data.by_axis.length > 0 || data.by_skill.length > 0 || data.most_failed_questions.length > 0) && (() => {
                const diagnosis = buildPedagogicalDiagnosis({
                  by_axis: data.by_axis.map((x) => ({
                    ...x,
                    dimension_value: pickPedagogicalLabel(x.dimension_value),
                    logro_pct: Number(x.logro_pct ?? 0),
                  })),
                  by_skill: data.by_skill.map((x) => ({
                    ...x,
                    dimension_value: pickPedagogicalLabel(x.dimension_value),
                    logro_pct: Number(x.logro_pct ?? 0),
                  })),
                  by_cognitive_level: (data.by_cognitive_level ?? []).map((x) => ({
                    ...x,
                    dimension_value: pickPedagogicalLabel(x.dimension_value),
                    logro_pct: Number(x.logro_pct ?? 0),
                  })),
                  most_failed_questions: data.most_failed_questions.map((x) => ({
                    ...x,
                    axis: pickPedagogicalLabel(x.axis),
                    skill: pickPedagogicalLabel(x.skill),
                  })),
                })
                const questionMetaByItem = new Map(
                  (data.question_heat_map ?? []).map((q) => [
                    q.item_number,
                    { axis: q.axis ?? "—", skill: q.skill ?? "—" },
                  ]),
                )
                const heatMap =
                  (data.item_analysis_course ?? []).length > 0
                    ? (data.item_analysis_course ?? [])
                        .map((row) => ({
                          item_number: row.item_number,
                          logro_pct: Number(row.pct_correct ?? 0),
                          axis: questionMetaByItem.get(row.item_number)?.axis ?? "—",
                          skill: questionMetaByItem.get(row.item_number)?.skill ?? "—",
                        }))
                        .sort((a, b) => a.item_number - b.item_number)
                    : (data.question_heat_map ?? [])
                        .map((a) => ({ ...a, logro_pct: Number(a.logro_pct ?? 0) }))
                        .sort((a, b) => a.item_number - b.item_number)
                return (
                  <div className="space-y-6 pt-4 border-t border-[var(--border-color)]">
                    <h4 className="font-semibold text-[var(--text-accent)]">Diagnóstico pedagógico</h4>
                    <div className="rounded-md border bg-[var(--bg-muted)] p-4 space-y-3 text-sm">
                      <p className="font-medium text-[var(--text-accent)]">Diagnóstico pedagógico del curso</p>
                      {diagnosis.diagnosisParagraphs.map((p, i) => (
                        <p key={i} className="text-[var(--text)]">{safeText(p, "")}</p>
                      ))}
                    </div>

                    {(diagnosis.evidenceLines.length > 0 || diagnosis.triangulationMessage) && (
                      <>
                        <h4 className="font-semibold text-[var(--text-accent)]">Evidencia pedagógica</h4>
                        <div className="rounded-md border bg-[var(--bg-muted)] p-4 space-y-2 text-sm">
                          <p className="font-medium text-[var(--text-accent)]">Evidencia de dificultad</p>
                          {diagnosis.evidenceLines.map((line, i) => (
                            <p key={i} className="text-[var(--text)] whitespace-pre-wrap">{safeText(line, "")}</p>
                          ))}
                          {diagnosis.triangulationMessage && (
                            <p className="pt-2 font-medium text-[var(--text-accent)]">{safeText(diagnosis.triangulationMessage, "")}</p>
                          )}
                        </div>
                      </>
                    )}

                    {heatMap.length > 0 && (
                      <>
                        <h4 className="font-semibold text-[var(--text-accent)]">Mapa de calor de preguntas</h4>
                        <QuestionHeatMap
                          items={heatMap}
                          totalQuestions={
                            (data.item_analysis_course ?? []).length > 0
                              ? Math.max(...(data.item_analysis_course ?? []).map((r) => r.item_number))
                              : Math.max(0, ...(heatMap.map((h) => h.item_number)))
                          }
                        />
                      </>
                    )}
                  </div>
                )
              })()}
            </>
          )}
            </>
          )}
        </div>
        <DialogFooter className="sticky bottom-0 z-20 border-t border-[var(--border-color)] bg-background pt-3">
          <div className="flex flex-col gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-2 text-xs">
              <span>Mostrar columnas nacionales</span>
              <Switch checked={showNationalAnalytics} onCheckedChange={(checked) => setShowNationalAnalytics(Boolean(checked))} />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNational && itemAnalysisRows.length === 0}
              onClick={() => {
                const headers = [
                  "Modo",
                  "N Pregunta",
                  "Respuesta Correcta",
                  "% Correctas",
                  "% Erradas",
                  "% Omitidas",
                  "XC Biserial",
                  "% A",
                  "% B",
                  "% C",
                  "% D",
                  "% E",
                ]
                const rows = itemAnalysisRows.map((r) => [
                  analyticsModeLabel,
                  r.item_number,
                  r.correct_answer ?? "",
                  r.pct_correct,
                  r.pct_wrong,
                  r.pct_omitted,
                  r.biserial_xc ?? "",
                  r.distractors.A,
                  r.distractors.B,
                  r.distractors.C,
                  r.distractors.D,
                  r.distractors.E,
                ])
                const safeName = (courseDisplayName || "curso")
                  .replace(/[^\w\u00C0-\u024F\s\-]/g, "")
                  .replace(/\s+/g, "_")
                  .slice(0, 60)
                downloadCsvFile({
                  filename: `libelia_analisis_items_${safeName}.csv`,
                  headers,
                  rows,
                  delimiter: ",",
                })
              }}
            >
              <FileDown className="h-4 w-4 mr-2" />
              Exportar CSV (ítems técnicos)
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={exportPdfLoading || !data}
            onClick={async () => {
              if (!reportRef.current) return
              setExportPdfLoading(true)
              const name = (courseDisplayName || "curso").replace(/[^\w\u00C0-\u024F\s\-]/g, "").replace(/\s+/g, "_").slice(0, 60)
              const result = await exportElementToPdf(reportRef.current, `libelia_resumen_curso_${name}.pdf`)
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
