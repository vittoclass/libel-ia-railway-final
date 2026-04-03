"use client"

/**
 * Modal de análisis pedagógico por evaluación.
 * Consume GET /api/evaluations/[id]/pedagogical-analysis.
 * No modifica Ver informe ni el flujo de evaluación.
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
import { Loader2, BookOpen, FileDown } from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { exportElementToPdf } from "@/app/lib/export-report-pdf"
import { useToast } from "@/hooks/use-toast"
import { formatPedagogicalDisplayText } from "@/app/lib/analyze-learning-results"

type AnalysisData = {
  evaluation_id: string
  has_source_exam: boolean
  has_evaluation_items?: boolean
  has_source_exam_items?: boolean
  analysis_available?: boolean
  status_reason?: string
  by_question: Array<{
    item_number: number
    axis: string
    skill: string
    cognitive_level: string
    score_obtained: number
    score_max: number
    logro_pct: number | null
  }>
  by_skill: Array<{ dimension_value: string; score_obtained: number; score_max: number; logro_pct: number | null; question_count: number }>
  by_axis: Array<{ dimension_value: string; score_obtained: number; score_max: number; logro_pct: number | null; question_count: number }>
  by_cognitive_level: Array<{ dimension_value: string; score_obtained: number; score_max: number; logro_pct: number | null; question_count: number }>
  student_summary: {
    strong_axes: string[]
    weak_axes: string[]
    strong_skills: string[]
    weak_skills: string[]
    lowest_cognitive_level: string | null
    highest_cognitive_level: string | null
  } | null
  // PHASE_2_SCALES_V1
  projections?: {
    simce_estimated: number | null
    paes_estimated: number | null
    level_label: "Insuficiente" | "Elemental" | "Adecuado" | null
    year?: number
  }
  // PHASE_3_INFERENCE_SECURITY_V1
  strategic_analysis?: {
    paragraph: string
    key_gap?: {
      numbers_pct?: number | null
      modelacion_pct?: number | null
      overall_pct?: number | null
      z_score_course?: number | null
      simce_level?: "Insuficiente" | "Elemental" | "Adecuado" | null
    }
  } | null
}

type Props = {
  evaluationId: string | null
  /** Opcional: nombre/alumno o título de evaluación para el título del modal */
  evaluationLabel?: string | null
  /** Opcional: nombre del estudiante (para contexto e informe PDF) */
  studentName?: string | null
  /** Opcional: nombre del curso (para contexto e informe PDF) */
  courseLabel?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function StatusMessage({ data }: { data: AnalysisData }) {
  const reason = data.status_reason
  const hasSource = data.has_source_exam
  const hasEvalItems = data.has_evaluation_items !== false
  const hasSourceItems = data.has_source_exam_items !== false

  if (reason === "missing_source_exam" || !hasSource) {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        Esta evaluación aún no tiene prueba base asociada.
      </p>
    )
  }
  if (reason === "missing_evaluation_items" || !hasEvalItems) {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        La evaluación tiene prueba base asociada, pero aún no tiene datos por pregunta suficientes.
      </p>
    )
  }
  if (reason === "missing_source_exam_items" || !hasSourceItems) {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        La prueba base asociada aún no tiene ítems cargados.
      </p>
    )
  }
  return (
    <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
      No hay datos suficientes para mostrar el análisis pedagógico.
    </p>
  )
}

function formatPct(value: number | null | undefined): string {
  // DATA_NORMALIZATION_V2: no evaluado se muestra con guion.
  if (value == null || !Number.isFinite(Number(value))) return "—"
  return `${Math.round(Number(value))}%`
}

function chartPct(value: number | null | undefined): number {
  return value == null || !Number.isFinite(Number(value)) ? 0 : Math.round(Number(value))
}

function safeScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—"
  return String(Math.round(Number(value)))
}

function levelBadgeClass(level: string | null | undefined): string {
  // PHASE_2_SCALES_V1: badges vibrantes para mejor legibilidad en modal y PDF.
  if (level === "Adecuado") return "border-emerald-700 bg-emerald-500 text-white"
  if (level === "Elemental") return "border-amber-700 bg-amber-500 text-white"
  return "border-rose-700 bg-rose-600 text-white"
}

/** Reglas: <50% debilidad, 50-69% desarrollo medio, ≥70% fortaleza. Solo interpreta datos ya calculados. */
function buildStudentDiagnosis(data: AnalysisData) {
  const byAxis = data.by_axis ?? []
  const bySkill = data.by_skill ?? []
  const byCog = data.by_cognitive_level ?? []
  const strengthsAxis = byAxis.filter((r) => typeof r.logro_pct === "number" && r.logro_pct >= 70).map((r) => ({ name: formatPedagogicalDisplayText(r.dimension_value), pct: Number(r.logro_pct) }))
  const strengthsSkill = bySkill.filter((r) => typeof r.logro_pct === "number" && r.logro_pct >= 70).map((r) => ({ name: formatPedagogicalDisplayText(r.dimension_value), pct: Number(r.logro_pct) }))
  const weakAxis = byAxis.filter((r) => typeof r.logro_pct === "number" && r.logro_pct < 50).map((r) => ({ name: formatPedagogicalDisplayText(r.dimension_value), pct: Number(r.logro_pct) }))
  const weakSkill = bySkill.filter((r) => typeof r.logro_pct === "number" && r.logro_pct < 50).map((r) => ({ name: formatPedagogicalDisplayText(r.dimension_value), pct: Number(r.logro_pct) }))
  const weakCog = byCog.filter((r) => typeof r.logro_pct === "number" && r.logro_pct < 50).map((r) => ({ name: formatPedagogicalDisplayText(r.dimension_value), pct: Number(r.logro_pct) }))
  const recommendations = [
    ...weakSkill.map((s) => s.name),
    ...weakAxis.map((a) => a.name),
  ].filter(Boolean).slice(0, 6)
  return {
    strengthsAxis,
    strengthsSkill,
    weakAxis,
    weakSkill,
    weakCog,
    recommendations,
    hasContent:
      strengthsAxis.length > 0 ||
      strengthsSkill.length > 0 ||
      weakAxis.length > 0 ||
      weakSkill.length > 0 ||
      weakCog.length > 0 ||
      recommendations.length > 0,
  }
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
  const [data, setData] = useState<AnalysisData | null>(null)
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
        setError("No se pudo cargar el análisis pedagógico.")
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

  const summary = data?.student_summary
  const showAnalysis =
    data?.analysis_available === true ||
    (data && data.has_source_exam && (data.by_question?.length ?? 0) > 0 && data.analysis_available !== false)
  const showStatusMessage = data && !showAnalysis

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
          {(studentName || courseLabel || evaluationLabel) && (
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] p-3 text-xs space-y-1">
              <div className="font-semibold text-[var(--text-accent)]">Contexto</div>
              {studentName && <div>Estudiante: {studentName}</div>}
              {courseLabel && <div>Curso: {courseLabel}</div>}
              {evaluationLabel && <div>Evaluación: {evaluationLabel}</div>}
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-[var(--text-muted)] py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
            </div>
          )}
          {error && (
            <p className="text-destructive py-2">{error}</p>
          )}
          {!loading && !error && data && showStatusMessage && (
            <StatusMessage data={data} />
          )}
          {!loading && !error && data && showAnalysis && (
            <>
              {data.projections && (
                <div className="space-y-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] p-4">
                  <h4 className="font-semibold text-[var(--text-accent)]">PROYECCIÓN DE ESTÁNDARES NACIONALES</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-md border border-slate-300 bg-white p-3 shadow-sm">
                      <p className="text-xs font-medium text-[var(--text-muted)]">SIMCE (ESTIMADO)</p>
                      <p className="text-2xl font-bold text-slate-900">{safeScore(data.projections.simce_estimated)}</p>
                    </div>
                    <div className="rounded-md border border-slate-300 bg-white p-3 shadow-sm">
                      <p className="text-xs font-medium text-[var(--text-muted)]">PAES (ESTIMADO)</p>
                      <p className="text-2xl font-bold text-slate-900">{safeScore(data.projections.paes_estimated)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-[var(--text-muted)]">NIVEL DE DESEMPEÑO:</span>
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 font-semibold ${levelBadgeClass(data.projections.level_label)}`}
                    >
                      {data.projections.level_label ? data.projections.level_label.toUpperCase() : "—"}
                    </span>
                  </div>
                </div>
              )}
              {summary && (
                <div className="rounded-md border bg-[var(--bg-muted)] p-3 space-y-2">
                  <h4 className="font-semibold text-[var(--text-accent)]">Resumen del alumno</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Ejes fuertes:</span>{" "}
                      {summary.strong_axes.length ? summary.strong_axes.join(", ") : "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Ejes descendidos:</span>{" "}
                      {summary.weak_axes.length ? summary.weak_axes.join(", ") : "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Habilidades fuertes:</span>{" "}
                      {summary.strong_skills.length ? summary.strong_skills.join(", ") : "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Habilidades descendidas:</span>{" "}
                      {summary.weak_skills.length ? summary.weak_skills.join(", ") : "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Nivel cognitivo más alto:</span>{" "}
                      {summary.highest_cognitive_level ?? "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Nivel cognitivo más bajo:</span>{" "}
                      {summary.lowest_cognitive_level ?? "—"}
                    </div>
                  </div>
                </div>
              )}
              {data.by_axis.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Logro por eje</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Eje</TableHead>
                        <TableHead className="w-24">Obtenido</TableHead>
                        <TableHead className="w-24">Máximo</TableHead>
                        <TableHead className="w-20">Logro %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_axis.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{formatPedagogicalDisplayText(r.dimension_value)}</TableCell>
                          <TableCell>{r.score_obtained}</TableCell>
                          <TableCell>{r.score_max}</TableCell>
                          <TableCell>
                            <span className={(r.logro_pct ?? -1) >= 70 ? "text-green-600" : (r.logro_pct ?? 999) < 50 ? "text-amber-600" : ""}>
                              {formatPct(r.logro_pct)}
                            </span>
                          </TableCell>
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
                        <TableHead className="w-24">Obtenido</TableHead>
                        <TableHead className="w-24">Máximo</TableHead>
                        <TableHead className="w-20">Logro %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_skill.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{formatPedagogicalDisplayText(r.dimension_value)}</TableCell>
                          <TableCell>{r.score_obtained}</TableCell>
                          <TableCell>{r.score_max}</TableCell>
                          <TableCell>
                            <span className={(r.logro_pct ?? -1) >= 70 ? "text-green-600" : (r.logro_pct ?? 999) < 50 ? "text-amber-600" : ""}>
                              {formatPct(r.logro_pct)}
                            </span>
                          </TableCell>
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
                        <TableHead className="w-24">Obtenido</TableHead>
                        <TableHead className="w-24">Máximo</TableHead>
                        <TableHead className="w-20">Logro %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_cognitive_level.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{formatPedagogicalDisplayText(r.dimension_value)}</TableCell>
                          <TableCell>{r.score_obtained}</TableCell>
                          <TableCell>{r.score_max}</TableCell>
                          <TableCell>{formatPct(r.logro_pct)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {data.by_question.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Logro por pregunta</h4>
                  <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14">Nº</TableHead>
                          <TableHead>Eje</TableHead>
                          <TableHead>Habilidad</TableHead>
                          <TableHead className="w-24">Nivel</TableHead>
                          <TableHead className="w-16">Obtenido</TableHead>
                          <TableHead className="w-16">Máx</TableHead>
                          <TableHead className="w-16">Logro %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.by_question.map((q, i) => (
                          <TableRow key={i}>
                            <TableCell>{q.item_number}</TableCell>
                            <TableCell className="max-w-[120px] truncate">{formatPedagogicalDisplayText(q.axis)}</TableCell>
                            <TableCell className="max-w-[120px] truncate">{formatPedagogicalDisplayText(q.skill)}</TableCell>
                            <TableCell>{q.cognitive_level}</TableCell>
                            <TableCell>{q.score_obtained}</TableCell>
                            <TableCell>{q.score_max}</TableCell>
                            <TableCell>{formatPct(q.logro_pct)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              {/* Gráficos pedagógicos — mismos datos que las tablas */}
              <div className="space-y-6 pt-2 border-t border-[var(--border-color)]">
                <h4 className="font-semibold text-[var(--text-accent)]">Gráficos pedagógicos</h4>
                {data.by_axis.length > 0 && (
                  <div className="w-full">
                    <p className="text-sm font-medium text-[var(--text-muted)] mb-2">Logro por eje</p>
                    <div className="w-full h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.by_axis.map((r) => ({ name: formatPedagogicalDisplayText(r.dimension_value), logro: chartPct(r.logro_pct) }))}
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
                    <p className="text-sm font-medium text-[var(--text-muted)] mb-2">Habilidades evaluadas</p>
                    <div className="w-full h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.by_skill.map((r) => ({ name: formatPedagogicalDisplayText(r.dimension_value), logro: chartPct(r.logro_pct) }))}
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
                {data.by_cognitive_level.length > 0 && (
                  <div className="w-full">
                    <p className="text-sm font-medium text-[var(--text-muted)] mb-2">Niveles cognitivos</p>
                    <div className="w-full h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.by_cognitive_level.map((r) => ({ name: formatPedagogicalDisplayText(r.dimension_value), logro: chartPct(r.logro_pct) }))}
                          margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" className="opacity-50" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} labelFormatter={(l) => l} />
                          <Bar dataKey="logro" name="Logro %" radius={[4, 4, 0, 0]}>
                            {data.by_cognitive_level.map((r, i) => (
                              <Cell key={i} fill={(r.logro_pct ?? -1) >= 70 ? "hsl(var(--chart-2))" : (r.logro_pct ?? 999) < 50 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
              {/* Diagnóstico pedagógico automático — reglas por porcentaje, debajo de los gráficos */}
              {(data.by_axis.length > 0 || data.by_skill.length > 0 || data.by_cognitive_level.length > 0) && (() => {
                const d = buildStudentDiagnosis(data)
                if (!d.hasContent) return null
                return (
                  <div className="space-y-4 pt-4 border-t border-[var(--border-color)]">
                    <h4 className="font-semibold text-[var(--text-accent)]">Diagnóstico pedagógico automático</h4>
                    <div className="rounded-md border bg-[var(--bg-muted)] p-4 space-y-4 text-sm">
                      {(d.strengthsAxis.length > 0 || d.strengthsSkill.length > 0) && (
                        <div>
                          <p className="font-medium text-[var(--text-accent)] mb-1">El estudiante muestra fortalezas en:</p>
                          <ul className="list-disc list-inside space-y-0.5 text-[var(--text)]">
                            {d.strengthsAxis.map((x, i) => (
                              <li key={`ax-${i}`}>{x.name} ({formatPct(x.pct)})</li>
                            ))}
                            {d.strengthsSkill.map((x, i) => (
                              <li key={`sk-${i}`}>{x.name} ({formatPct(x.pct)})</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(d.weakAxis.length > 0 || d.weakSkill.length > 0 || d.weakCog.length > 0) && (
                        <div>
                          <p className="font-medium text-[var(--text-accent)] mb-1">Presenta dificultades en:</p>
                          <ul className="list-disc list-inside space-y-0.5 text-[var(--text)]">
                            {d.weakAxis.map((x, i) => (
                              <li key={`wax-${i}`}>{x.name} ({formatPct(x.pct)})</li>
                            ))}
                            {d.weakSkill.map((x, i) => (
                              <li key={`wsk-${i}`}>{x.name} ({formatPct(x.pct)})</li>
                            ))}
                            {d.weakCog.map((x, i) => (
                              <li key={`wcog-${i}`}>Nivel cognitivo: {x.name} ({formatPct(x.pct)})</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {d.recommendations.length > 0 && (
                        <div>
                          <p className="font-medium text-[var(--text-accent)] mb-1">Se recomienda reforzar:</p>
                          <ul className="list-disc list-inside space-y-0.5 text-[var(--text)]">
                            {d.recommendations.map((name, i) => (
                              <li key={i}>{name}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
              {data.strategic_analysis?.paragraph && (
                <div className="space-y-3 pt-4 border-t border-[var(--border-color)]">
                  <h4 className="font-semibold text-[var(--text-accent)]">ANÁLISIS ESTRATÉGICO DEL ESPECIALISTA</h4>
                  <div className="rounded-md border border-slate-300 bg-white p-4 text-sm leading-6 text-slate-900">
                    {/* PHASE_3_INFERENCE_SECURITY_V1 */}
                    {data.strategic_analysis.paragraph}
                  </div>
                </div>
              )}
            </>
          )}
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
