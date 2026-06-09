"use client"

/**
 * Cuerpo del informe pedagógico (mismo contenido que el modal, para PDF y ZIP por lote).
 * No toca OMR ni evaluación.
 */
import * as React from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2 } from "lucide-react"
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
import { formatPedagogicalReadableText, formatQuestionNumbersSpanish } from "@/app/lib/pedagogical-export-formatting"
import { formatStudentDisplayName } from "@/app/lib/format-student-name"
import {
  buildStudentReportDiagnosis,
  COGNITIVE_PERFORMANCE_LABELS,
  type StudentReportDiagnosis,
} from "@/app/lib/pedagogical-report-presentation"
import { PAES_PROJECTION_DISCLAIMER, paesMethodologyUiPhrase } from "@/app/lib/paesProjectionCanonical"
import { SIMCE_PROJECTION_DISCLAIMER } from "@/app/lib/simceProjectionCanonical"
import type { PedagogicalAnalysisExportData } from "@/app/lib/pedagogical-analysis-export-types"

export type PedagogicalAnalysisReportBodyProps = {
  loading: boolean
  error: string | null
  data: PedagogicalAnalysisExportData | null
  studentName?: string | null
  courseLabel?: string | null
  evaluationLabel?: string | null
}

function StatusMessage({ data }: { data: PedagogicalAnalysisExportData }) {
  const reason = data.status_reason
  const hasSource = data.has_source_exam
  const hasEvalItems = data.has_evaluation_items !== false
  const hasSourceItems = data.has_source_exam_items !== false

  const wrap = (detail: string) => (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200 space-y-1">
      <p className="font-semibold">No hay análisis pedagógico disponible para esta evaluación.</p>
      <p className="text-sm">{detail}</p>
    </div>
  )

  if (reason === "missing_source_exam" || !hasSource) {
    return wrap("Esta evaluación aún no tiene prueba base asociada.")
  }
  if (reason === "missing_evaluation_items" || !hasEvalItems) {
    return wrap("La evaluación tiene prueba base asociada, pero aún no tiene datos por pregunta suficientes.")
  }
  if (reason === "missing_source_exam_items" || !hasSourceItems) {
    return wrap("La prueba base asociada aún no tiene ítems cargados.")
  }
  return wrap("No hay datos suficientes para generar el análisis pedagógico con la información actual.")
}

function clampDisplayPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—"
  return `${clampDisplayPct(Number(value))}%`
}

function chartPct(value: number | null | undefined): number {
  return value == null || !Number.isFinite(Number(value)) ? 0 : clampDisplayPct(Number(value))
}

function safeScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—"
  return String(Math.round(Number(value)))
}

function levelBadgeClass(level: string | null | undefined): string {
  if (level === "Adecuado" || level === "Alto" || level === "Avanzado") {
    return "border-emerald-700 bg-emerald-500 text-white"
  }
  if (level === "Elemental" || level === "Medio") return "border-amber-700 bg-amber-500 text-white"
  return "border-rose-700 bg-rose-600 text-white"
}

function buildStudentDiagnosis(data: PedagogicalAnalysisExportData): StudentReportDiagnosis {
  return buildStudentReportDiagnosis({
    by_axis: data.by_axis ?? [],
    by_skill: data.by_skill ?? [],
    by_cognitive_level: data.by_cognitive_level ?? [],
    by_question: data.by_question ?? [],
  })
}

export function PedagogicalAnalysisReportBody({
  loading,
  error,
  data,
  studentName,
  courseLabel,
  evaluationLabel,
}: PedagogicalAnalysisReportBodyProps) {
  const summary = data?.student_summary ?? null
  const showAnalysis =
    data?.analysis_available === true ||
    (data != null && data.has_source_exam && (data.by_question?.length ?? 0) > 0 && data.analysis_available !== false)
  const showStatusMessage = data != null && !showAnalysis
  const mode = data?.instrument_analytics_mode
  const showNationalProjections =
    data?.projections &&
    (mode === "SIMCE" || mode === "PAES") &&
    (data.projections.simce_estimated != null ||
      data.projections.paes_estimated != null ||
      data.projections.level_label != null)

  return (
    <div className="space-y-4 text-sm">
      {(studentName || courseLabel || evaluationLabel) && (
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] p-3 text-xs space-y-1">
          <div className="font-semibold text-[var(--text-accent)]">Contexto</div>
          {studentName && <div>Estudiante: {formatStudentDisplayName(studentName) || studentName}</div>}
          {courseLabel && <div>Curso: {courseLabel}</div>}
          {evaluationLabel && <div>Evaluación: {evaluationLabel}</div>}
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-muted)] py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      )}
      {error && <p className="text-destructive py-2">{error}</p>}
      {!loading && !error && data && showStatusMessage && <StatusMessage data={data} />}
      {!loading && !error && data && showAnalysis && (
        <PedagogicalAnalysisInner data={data} summary={summary} mode={mode} showNationalProjections={!!showNationalProjections} />
      )}
    </div>
  )
}

function PedagogicalAnalysisInner({
  data,
  summary,
  mode,
  showNationalProjections,
}: {
  data: PedagogicalAnalysisExportData
  summary: PedagogicalAnalysisExportData["student_summary"]
  mode: PedagogicalAnalysisExportData["instrument_analytics_mode"] | undefined
  showNationalProjections: boolean
}) {
  const diagnosisSections =
    data.by_axis.length > 0 || data.by_skill.length > 0 || data.by_cognitive_level.length > 0
      ? buildStudentDiagnosis(data)
      : null

  return (
    <>
      {showNationalProjections && data.projections && (
        <div className="space-y-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] p-4">
          <h4 className="font-semibold text-[var(--text-accent)]">Proyección referencial según tipo de instrumento</h4>
          <p className="text-xs text-[var(--text-muted)]">
            {mode === "SIMCE" &&
              "Ensayo SIMCE: estimación pedagógica en escala referencial y nivel estimado según desempeño observado en esta evaluación."}
            {mode === "PAES" &&
              "Ensayo PAES: estimación pedagógica en escala referencial según desempeño observado en esta evaluación."}
          </p>
          {data.projections.logro_pct != null && Number.isFinite(Number(data.projections.logro_pct)) && (
            <p className="text-xs text-[var(--text-muted)]">
              <span className="font-medium">Logro:</span> {formatPct(data.projections.logro_pct)}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(mode === "SIMCE" || data.projections.simce_estimated != null) && (
              <div className="rounded-md border border-slate-300 bg-white p-3 shadow-sm">
                <p className="text-xs font-medium text-[var(--text-muted)]">Proyección SIMCE referencial</p>
                <p className="text-2xl font-bold text-slate-900">{safeScore(data.projections.simce_estimated)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {data.projections.simce_projection_disclaimer ?? SIMCE_PROJECTION_DISCLAIMER}
                </p>
              </div>
            )}
            {(mode === "PAES" || data.projections.paes_estimated != null) && (
              <div className="rounded-md border border-slate-300 bg-white p-3 shadow-sm">
                <p className="text-xs font-medium text-[var(--text-muted)]">Proyección PAES referencial</p>
                <p className="text-2xl font-bold text-slate-900">{safeScore(data.projections.paes_estimated)}</p>
                {(() => {
                  const phrase = paesMethodologyUiPhrase(data.projections.paes_projection_meta)
                  return phrase ? (
                    <p className="text-xs text-[var(--text-muted)] mt-1">{phrase}</p>
                  ) : null
                })()}
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {data.projections.paes_projection_disclaimer ?? PAES_PROJECTION_DISCLAIMER}
                </p>
              </div>
            )}
          </div>
          {mode === "SIMCE" && data.projections.level_label != null && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-[var(--text-muted)]">Nivel estimado (cortes internos referenciales):</span>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 font-semibold ${levelBadgeClass(data.projections.level_label)}`}
              >
                {data.projections.level_label.toUpperCase()}
              </span>
            </div>
          )}
          {mode === "PAES" && data.projections.paes_level_label != null && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-[var(--text-muted)]">Nivel estimado (cortes internos referenciales):</span>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 font-semibold ${levelBadgeClass(data.projections.paes_level_label)}`}
              >
                {data.projections.paes_level_label.toUpperCase()}
              </span>
            </div>
          )}
        </div>
      )}
      {summary && diagnosisSections && (
        <div className="rounded-md border bg-[var(--bg-muted)] p-3 space-y-2">
          <h4 className="font-semibold text-[var(--text-accent)]">Resumen del alumno</h4>
          <p className="text-xs text-[var(--text)]">{diagnosisSections.overview}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">{COGNITIVE_PERFORMANCE_LABELS.highest}:</span>{" "}
              {summary.highest_cognitive_level ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">{COGNITIVE_PERFORMANCE_LABELS.lowest}:</span>{" "}
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
                  <TableCell>{formatPedagogicalReadableText(r.dimension_value)}</TableCell>
                  <TableCell>{r.score_obtained}</TableCell>
                  <TableCell>{r.score_max}</TableCell>
                  <TableCell>
                    <span
                      className={
                        (r.logro_pct ?? -1) >= 70 ? "text-green-600" : (r.logro_pct ?? 999) < 50 ? "text-amber-600" : ""
                      }
                    >
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
                  <TableCell>{formatPedagogicalReadableText(r.dimension_value)}</TableCell>
                  <TableCell>{r.score_obtained}</TableCell>
                  <TableCell>{r.score_max}</TableCell>
                  <TableCell>
                    <span
                      className={
                        (r.logro_pct ?? -1) >= 70 ? "text-green-600" : (r.logro_pct ?? 999) < 50 ? "text-amber-600" : ""
                      }
                    >
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
                  <TableCell>{formatPedagogicalReadableText(r.dimension_value)}</TableCell>
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
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
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
                    <TableCell className="max-w-[120px] truncate">{formatPedagogicalReadableText(q.axis)}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{formatPedagogicalReadableText(q.skill)}</TableCell>
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
      <div className="space-y-6 pt-2 border-t border-[var(--border-color)]">
        <h4 className="font-semibold text-[var(--text-accent)]">Gráficos pedagógicos</h4>
        {data.by_axis.length > 0 && (
          <div className="w-full">
            <p className="text-sm font-medium text-[var(--text-muted)] mb-2">Logro por eje</p>
            <div className="w-full h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.by_axis.map((r) => ({
                    name: formatPedagogicalReadableText(r.dimension_value),
                    logro: chartPct(r.logro_pct),
                  }))}
                  margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-50" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} labelFormatter={(l) => l} />
                  <Bar dataKey="logro" name="Logro %" radius={[4, 4, 0, 0]}>
                    {data.by_axis.map((r, i) => (
                      <Cell
                        key={i}
                        fill={
                          (r.logro_pct ?? -1) >= 70 ? "hsl(var(--chart-2))" : (r.logro_pct ?? 999) < 50 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"
                        }
                      />
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
                  data={data.by_skill.map((r) => ({
                    name: formatPedagogicalReadableText(r.dimension_value),
                    logro: chartPct(r.logro_pct),
                  }))}
                  margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-50" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} labelFormatter={(l) => l} />
                  <Bar dataKey="logro" name="Logro %" radius={[4, 4, 0, 0]}>
                    {data.by_skill.map((r, i) => (
                      <Cell
                        key={i}
                        fill={
                          (r.logro_pct ?? -1) >= 70 ? "hsl(var(--chart-2))" : (r.logro_pct ?? 999) < 50 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"
                        }
                      />
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
                  data={data.by_cognitive_level.map((r) => ({
                    name: formatPedagogicalReadableText(r.dimension_value),
                    logro: chartPct(r.logro_pct),
                  }))}
                  margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-50" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number | undefined) => [`${v ?? 0}%`, "Logro"]} labelFormatter={(l) => l} />
                  <Bar dataKey="logro" name="Logro %" radius={[4, 4, 0, 0]}>
                    {data.by_cognitive_level.map((r, i) => (
                      <Cell
                        key={i}
                        fill={
                          (r.logro_pct ?? -1) >= 70 ? "hsl(var(--chart-2))" : (r.logro_pct ?? 999) < 50 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
      {diagnosisSections?.hasContent &&
        (() => {
          const d = diagnosisSections
          return (
            <div className="space-y-4 pt-4 border-t border-[var(--border-color)]">
              <div className="rounded-md border bg-[var(--bg-muted)] p-4 space-y-4 text-sm">
                <div>
                  <h4 className="font-semibold text-[var(--text-accent)] mb-2">Diagnóstico pedagógico automático</h4>
                  {d.strengths.length > 0 && (
                    <div className="mb-3">
                      <p className="font-medium text-[var(--text-accent)] mb-1">Desempeño destacado:</p>
                      <ul className="list-disc list-inside space-y-1 text-[var(--text)]">
                        {d.strengths.map((x, i) => (
                          <li key={`st-${i}`}>
                            <span className="font-medium">{x.displayName}</span> — {x.evidenceLabel}
                            {x.evidenceSuffix ? (
                              <span className="text-[var(--text-muted)]"> ({x.evidenceSuffix})</span>
                            ) : null}
                            {x.includesNote ? (
                              <span className="block text-xs text-[var(--text-muted)] mt-0.5">{x.includesNote}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {d.hierarchicalGaps.axes.length > 0 && (
                    <div>
                      <p className="font-medium text-[var(--text-accent)] mb-1">Brechas observadas:</p>
                      <div className="space-y-3 text-[var(--text)]">
                        {d.hierarchicalGaps.axes.map((axis, ai) => (
                          <div key={`gap-axis-${ai}`}>
                            <p className="font-medium">Eje: {axis.axisName}</p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                              {axis.skills.map((skill, si) => (
                                <li key={`gap-skill-${ai}-${si}`}>
                                  <span className="font-medium">Habilidad:</span> {skill.displayName} ({skill.pct}%
                                  {skill.evidenceSuffix ? ` · ${skill.evidenceSuffix}` : ""})
                                  {skill.cognitiveLevels.length > 0 ? (
                                    <span className="block text-xs text-[var(--text-muted)] mt-0.5">
                                      Nivel cognitivo asociado: {skill.cognitiveLevels.join(" / ")}
                                    </span>
                                  ) : null}
                                  {skill.includesNote ? (
                                    <span className="block text-xs text-[var(--text-muted)] mt-0.5">{skill.includesNote}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {d.hierarchicalGaps.standaloneCognitiveGaps.length > 0 && (
                    <div className="mt-3">
                      <p className="font-medium text-[var(--text-accent)] mb-1">Dificultad cognitiva observada:</p>
                      <ul className="list-disc list-inside space-y-1 text-[var(--text)]">
                        {d.hierarchicalGaps.standaloneCognitiveGaps.map((cog, i) => (
                          <li key={`cog-gap-${i}`}>
                            {cog.name} ({cog.pct}%
                            {cog.evidenceSuffix ? ` · ${cog.evidenceSuffix}` : ""})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {d.groupedRecommendations.length > 0 && (
                  <div className="pt-3 border-t border-[var(--border-color)]">
                    <h4 className="font-semibold text-[var(--text-accent)] mb-2">Recomendaciones</h4>
                    <div className="space-y-3 text-[var(--text)]">
                      {d.groupedRecommendations.map((group, gi) => (
                        <div key={`rec-group-${gi}`}>
                          <p className="font-medium">{group.groupTitle}</p>
                          <ul className="list-disc list-inside space-y-1 ml-2">
                            {group.skills.map((skill, si) => (
                              <li key={`rec-skill-${gi}-${si}`}>
                                {skill.name}
                                {skill.questionNumbers.length > 0
                                  ? ` (ítems ${formatQuestionNumbersSpanish(skill.questionNumbers)})`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      {data.strategic_analysis?.paragraph && (
        <div className="space-y-3 pt-4 border-t border-[var(--border-color)]">
          <h4 className="font-semibold text-[var(--text-accent)]">ANÁLISIS ESTRATÉGICO DEL ESPECIALISTA</h4>
          <div className="rounded-md border border-slate-300 bg-white p-4 text-sm leading-6 text-slate-900">{data.strategic_analysis.paragraph}</div>
        </div>
      )}
    </>
  )
}
