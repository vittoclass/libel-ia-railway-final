"use client"

/**
 * Modal de resumen pedagógico por curso.
 * Consume GET /api/courses/[courseId]/pedagogical-summary.
 * No modifica el diagnóstico actual del curso.
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
  by_axis: Array<{ dimension_value: string; logro_pct: number; question_count: number }>
  by_skill: Array<{ dimension_value: string; logro_pct: number; question_count: number }>
  by_cognitive_level: Array<{ dimension_value: string; logro_pct: number; question_count: number }>
  weakest_skills: Array<{ skill: string; average_logro_pct: number }>
  weakest_axes: Array<{ axis: string; average_logro_pct: number; question_count: number }>
  most_failed_questions: Array<{
    item_number: number
    axis: string
    skill: string
    error_pct: number
    student_count: number
  }>
  question_heat_map?: Array<{ item_number: number; logro_pct: number; axis?: string; skill?: string }>
  national_analytics?: {
    enabled: boolean
    by_evaluation: Array<{
      evaluation_id: string
      student_name: string
      note_7: number | null
      score_obtained: number
      score_max: number
      logro_pct: number
      paes_score: number
      simce_score: number
      simce_level: "Adecuado" | "Elemental" | "Insatisfactorio"
    }>
    course_summary: {
      average_note_7: number | null
      average_logro_pct: number
      average_paes: number
      average_simce: number
      simce_distribution: {
        Adecuado: number
        Elemental: number
        Insatisfactorio: number
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

function normalizeSummaryData(raw: SummaryData): SummaryData {
  // SNAPSHOT_NATIONAL_ANALYTICS_V1: normalizacion de entrada para impedir objetos en render
  const mapDimensionRows = (rows: Array<{ dimension_value: string; logro_pct: number; question_count: number }>) =>
    (rows ?? []).map((r) => ({
      ...r,
      dimension_value: pickPedagogicalLabel(r.dimension_value),
    }))

  return {
    ...raw,
    course: toSafeText(raw.course, "Curso"),
    by_axis: mapDimensionRows(raw.by_axis),
    by_skill: mapDimensionRows(raw.by_skill),
    by_cognitive_level: mapDimensionRows(raw.by_cognitive_level),
    weakest_skills: (raw.weakest_skills ?? []).map((s) => ({
      ...s,
      skill: pickPedagogicalLabel(s.skill),
    })),
    weakest_axes: (raw.weakest_axes ?? []).map((a) => ({
      ...a,
      axis: pickPedagogicalLabel(a.axis),
    })),
    most_failed_questions: (raw.most_failed_questions ?? []).map((q) => ({
      ...q,
      axis: pickPedagogicalLabel(q.axis),
      skill: pickPedagogicalLabel(q.skill),
    })),
    question_heat_map: (raw.question_heat_map ?? []).map((q) => ({
      ...q,
      axis: pickPedagogicalLabel(q.axis ?? "—"),
      skill: pickPedagogicalLabel(q.skill ?? "—"),
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

function SummaryBlock({ data }: { data: SummaryData }) {
  const total = data.evaluation_count_total ?? data.evaluation_count
  const withSource = data.evaluation_count_with_source_exam
  const analyzable = data.evaluation_count_analyzable
  const hasNewFields = withSource !== undefined || analyzable !== undefined
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
  const { toast } = useToast()

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
    const url = `/api/courses/${encodeURIComponent(courseId)}/pedagogical-summary`
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
  }, [open, courseId])

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
  // SNAPSHOT_NATIONAL_ANALYTICS_V1: vista desacoplada del flag backend para no ocultar controles del modal
  const hasNational = Boolean(Array.isArray(national?.by_evaluation) && national.by_evaluation.length > 0)
  // SNAPSHOT_NATIONAL_ANALYTICS_V1: normalizacion defensiva para evitar renderizar objetos en <td>
  const nationalRows = hasNational
    ? national!.by_evaluation.map((row) => {
        const safeNote = typeof row.note_7 === "number" && Number.isFinite(row.note_7) ? row.note_7.toFixed(1) : "N/A"
        const safePaes = typeof row.paes_score === "number" && Number.isFinite(row.paes_score) ? row.paes_score : "N/A"
        const safeSimce = typeof row.simce_score === "number" && Number.isFinite(row.simce_score) ? row.simce_score : "N/A"
        const safeLevel =
          row.simce_level === "Adecuado" || row.simce_level === "Elemental" || row.simce_level === "Insatisfactorio"
            ? row.simce_level
            : "N/A"
        const safeLogro = typeof row.logro_pct === "number" && Number.isFinite(row.logro_pct) ? `${row.logro_pct}%` : "N/A"
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
              <SummaryBlock data={data} />
              {(data.evaluation_count_without_items ?? 0) > 0 && (
                <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
                  Datos incompletos detectados
                </p>
              )}
              {!data.summary_available && (data.evaluation_count_analyzable ?? data.evaluation_count) === 0 && (
                <NoSummaryMessage data={data} />
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
                        <TableHead className="w-20">Preguntas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_axis.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{pickPedagogicalLabel(r.dimension_value)}</TableCell>
                          <TableCell>
                            <span className={r.logro_pct >= 70 ? "text-green-600" : r.logro_pct < 50 ? "text-amber-600" : ""}>
                              {r.logro_pct}%
                            </span>
                          </TableCell>
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
                        <TableHead className="w-20">Preguntas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_skill.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{pickPedagogicalLabel(r.dimension_value)}</TableCell>
                          <TableCell>
                            <span className={r.logro_pct >= 70 ? "text-green-600" : r.logro_pct < 50 ? "text-amber-600" : ""}>
                              {r.logro_pct}%
                            </span>
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
                          <TableCell>{r.logro_pct}%</TableCell>
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
                      <li key={i}>{pickPedagogicalLabel(s.skill)}: {s.average_logro_pct}%</li>
                    ))}
                  </ul>
                </div>
              )}
              {data.weakest_axes.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Ejes más débiles</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {data.weakest_axes.slice(0, 10).map((a, i) => (
                      <li key={i}>{pickPedagogicalLabel(a.axis)}: {a.average_logro_pct}%</li>
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
                          data={data.by_axis.map((r) => ({ name: pickPedagogicalLabel(r.dimension_value), logro: r.logro_pct }))}
                          margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" className="opacity-50" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} labelFormatter={(l) => l} />
                          <Bar dataKey="logro" name="Logro %" radius={[4, 4, 0, 0]}>
                            {data.by_axis.map((r, i) => (
                              <Cell key={i} fill={r.logro_pct >= 70 ? "hsl(var(--chart-2))" : r.logro_pct < 50 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"} />
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
                          data={data.by_skill.map((r) => ({ name: pickPedagogicalLabel(r.dimension_value), logro: r.logro_pct }))}
                          margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" className="opacity-50" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} labelFormatter={(l) => l} />
                          <Bar dataKey="logro" name="Logro %" radius={[4, 4, 0, 0]}>
                            {data.by_skill.map((r, i) => (
                              <Cell key={i} fill={r.logro_pct >= 70 ? "hsl(var(--chart-2))" : r.logro_pct < 50 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"} />
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
                              ? data.by_axis.map((r) => ({ dimension: pickPedagogicalLabel(r.dimension_value), logro: r.logro_pct, fullMark: 100 }))
                              : data.by_skill.map((r) => ({ dimension: pickPedagogicalLabel(r.dimension_value), logro: r.logro_pct, fullMark: 100 }))
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
              {/* SNAPSHOT_NATIONAL_ANALYTICS_V1 */}
              {hasNational && (
                <div className="space-y-4 pt-4 border-t border-[var(--border-color)]">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold text-[var(--text-accent)]">Analítica Nacional (PAES/SIMCE)</h4>
                  </div>
                  <div className="rounded-md border bg-[var(--bg-muted)] p-3 text-sm grid grid-cols-1 md:grid-cols-5 gap-2">
                    <div><strong>Nota 7.0 prom.</strong>: {national?.course_summary.average_note_7 ?? "—"}</div>
                    <div><strong>Logro prom.</strong>: {national?.course_summary.average_logro_pct ?? 0}%</div>
                    <div><strong>PAES prom.</strong>: {national?.course_summary.average_paes ?? 100}</div>
                    <div><strong>SIMCE prom.</strong>: {national?.course_summary.average_simce ?? 0}</div>
                    <div>
                      <strong>Distribución SIMCE</strong>: A {national?.course_summary.simce_distribution.Adecuado ?? 0}% ·
                      E {national?.course_summary.simce_distribution.Elemental ?? 0}% ·
                      I {national?.course_summary.simce_distribution.Insatisfactorio ?? 0}%
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
                          <TableHead className="w-24">Nivel SIMCE</TableHead>
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
                  by_axis: data.by_axis.map((x) => ({ ...x, dimension_value: pickPedagogicalLabel(x.dimension_value) })),
                  by_skill: data.by_skill.map((x) => ({ ...x, dimension_value: pickPedagogicalLabel(x.dimension_value) })),
                  by_cognitive_level: (data.by_cognitive_level ?? []).map((x) => ({
                    ...x,
                    dimension_value: pickPedagogicalLabel(x.dimension_value),
                  })),
                  most_failed_questions: data.most_failed_questions.map((x) => ({
                    ...x,
                    axis: pickPedagogicalLabel(x.axis),
                    skill: pickPedagogicalLabel(x.skill),
                  })),
                })
                const heatMap = (data.question_heat_map ?? []).slice().sort((a, b) => a.item_number - b.item_number)
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
                        <QuestionHeatMap items={heatMap} />
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
              disabled={!hasNational}
              onClick={() => {
                if (!national) return
                const headers = [
                  "Estudiante",
                  "Nota 7.0",
                  "Puntaje Obtenido",
                  "Puntaje Maximo",
                  "Logro %",
                  "PAES",
                  "SIMCE",
                  "Nivel SIMCE",
                ]
                const rows = nationalRows.map((alumno) => [
                  alumno.student,
                  alumno.note === "N/A" ? "" : alumno.note,
                  alumno.scoreObtained === "N/A" ? "" : alumno.scoreObtained,
                  alumno.scoreMax === "N/A" ? "" : alumno.scoreMax,
                  alumno.logro === "N/A" ? "" : alumno.logro.replace("%", ""),
                  alumno.paes === "N/A" ? "" : alumno.paes,
                  alumno.simce === "N/A" ? "" : alumno.simce,
                  alumno.level === "N/A" ? "" : alumno.level,
                ])
                const safeName = (courseDisplayName || "curso")
                  .replace(/[^\w\u00C0-\u024F\s\-]/g, "")
                  .replace(/\s+/g, "_")
                  .slice(0, 60)
                downloadCsvFile({
                  filename: `libelia_analitica_nacional_${safeName}.csv`,
                  headers,
                  rows,
                  delimiter: ",",
                })
              }}
            >
              <FileDown className="h-4 w-4 mr-2" />
              Exportar CSV gestión
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
