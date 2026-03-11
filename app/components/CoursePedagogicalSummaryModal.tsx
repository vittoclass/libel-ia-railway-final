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
}

type Props = {
  courseId: string | null
  courseLabel?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
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
        <span><strong>Curso:</strong> {data.course}</span>
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SummaryData | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const [exportPdfLoading, setExportPdfLoading] = useState(false)
  const { toast } = useToast()

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
        setData(j)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" /> Resumen pedagógico del curso: {courseDisplayName}
          </DialogTitle>
        </DialogHeader>
        <div ref={reportRef} className="space-y-4 text-sm">
          {!loading && !error && data && (
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] p-3 text-xs">
              <div className="font-semibold text-[var(--text-accent)]">Contexto</div>
              <div>Curso: {courseDisplayName}</div>
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
                          <TableCell>{r.dimension_value}</TableCell>
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
                          <TableCell>{r.dimension_value}</TableCell>
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
                          <TableCell>{r.dimension_value}</TableCell>
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
                      <li key={i}>{s.skill}: {s.average_logro_pct}%</li>
                    ))}
                  </ul>
                </div>
              )}
              {data.weakest_axes.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Ejes más débiles</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {data.weakest_axes.slice(0, 10).map((a, i) => (
                      <li key={i}>{a.axis}: {a.average_logro_pct}%</li>
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
                          <TableCell className="max-w-[120px] truncate">{q.axis}</TableCell>
                          <TableCell className="max-w-[120px] truncate">{q.skill}</TableCell>
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
                          data={data.by_axis.map((r) => ({ name: r.dimension_value, logro: r.logro_pct }))}
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
                          data={data.by_skill.map((r) => ({ name: r.dimension_value, logro: r.logro_pct }))}
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
                              ? data.by_axis.map((r) => ({ dimension: r.dimension_value, logro: r.logro_pct, fullMark: 100 }))
                              : data.by_skill.map((r) => ({ dimension: r.dimension_value, logro: r.logro_pct, fullMark: 100 }))
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
              {/* Diagnóstico pedagógico, evidencia y mapa de calor (después de los gráficos) */}
              {(data.by_axis.length > 0 || data.by_skill.length > 0 || data.most_failed_questions.length > 0) && (() => {
                const diagnosis = buildPedagogicalDiagnosis({
                  by_axis: data.by_axis,
                  by_skill: data.by_skill,
                  by_cognitive_level: data.by_cognitive_level ?? [],
                  most_failed_questions: data.most_failed_questions,
                })
                const heatMap = (data.question_heat_map ?? []).slice().sort((a, b) => a.item_number - b.item_number)
                return (
                  <div className="space-y-6 pt-4 border-t border-[var(--border-color)]">
                    <h4 className="font-semibold text-[var(--text-accent)]">Diagnóstico pedagógico</h4>
                    <div className="rounded-md border bg-[var(--bg-muted)] p-4 space-y-3 text-sm">
                      <p className="font-medium text-[var(--text-accent)]">Diagnóstico pedagógico del curso</p>
                      {diagnosis.diagnosisParagraphs.map((p, i) => (
                        <p key={i} className="text-[var(--text)]">{p}</p>
                      ))}
                    </div>

                    {(diagnosis.evidenceLines.length > 0 || diagnosis.triangulationMessage) && (
                      <>
                        <h4 className="font-semibold text-[var(--text-accent)]">Evidencia pedagógica</h4>
                        <div className="rounded-md border bg-[var(--bg-muted)] p-4 space-y-2 text-sm">
                          <p className="font-medium text-[var(--text-accent)]">Evidencia de dificultad</p>
                          {diagnosis.evidenceLines.map((line, i) => (
                            <p key={i} className="text-[var(--text)] whitespace-pre-wrap">{line}</p>
                          ))}
                          {diagnosis.triangulationMessage && (
                            <p className="pt-2 font-medium text-[var(--text-accent)]">{diagnosis.triangulationMessage}</p>
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
        <DialogFooter>
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
