"use client"

import { useCallback, useEffect, useState } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { StrategicNarrativePanel } from "@/app/components/dashboard/utp/StrategicNarrativePanel"
import {
  uiChartTooltipLabel,
  uiCoberturaPorEjeBajada,
  uiCoberturaPorEjeTitulo,
  uiCoberturaPorHabilidadBajada,
  uiCoberturaPorHabilidadTitulo,
} from "@/app/lib/pedagogic-ui-copy"

type OutcomesPayload = {
  meta: {
    audit_report_id: string
    evaluation_count: number
    warnings: string[]
    link: { evaluation_ids: string[] }
  }
  accuracy_by_skill: Array<{ skill_label: string; achieved_pct: number | null; expected_pct: number | null }>
  accuracy_by_axis: Array<{ axis_label: string; achieved_pct: number | null }>
  cognitive_distribution: {
    by_achievement_weight: Array<{ cognitive_level: string; achieved_pct: number | null }>
    by_student_dominant_level: Array<{ cognitive_level: string; student_count: number; share_of_students: number }>
  }
  student_risk_list: {
    threshold_note_chile: number
    items: Array<{
      evaluation_id: string
      student_display_name: string
      course_label: string | null
      grade_chile: number
      evaluated_at: string | null
    }>
    total_below_threshold: number
    page: number
    page_size: number
    has_more: boolean
  }
  strategic_analysis?: {
    course_narrative: string
    gap_alerts: string[]
    pme_actions: string[]
    interdisciplinary_note: string | null
    student_narratives: Array<{ evaluation_id: string; student_display_name: string; note: string }>
  }
}

const COLORS = ["#0f766e", "#0369a1", "#7c3aed", "#b45309", "#be123c", "#4d7c0f"]

type ResultsMirrorProps = {
  auditReportId: string
  refreshToken?: number
}

export function ResultsMirror({ auditReportId, refreshToken = 0 }: ResultsMirrorProps) {
  const [data, setData] = useState<OutcomesPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [courseFilter, setCourseFilter] = useState<string>("ALL")

  const load = useCallback(async () => {
    if (!auditReportId) return
    setLoading(true)
    try {
      const url = new URL("/api/dashboard/utp/student-outcomes", window.location.origin)
      url.searchParams.set("audit_report_id", auditReportId)
      const res = await fetch(url.toString(), { cache: "no-store" })
      const json = (await res.json().catch(() => null)) as OutcomesPayload | null
      setData(json && json.meta ? json : null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [auditReportId])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  if (!auditReportId) {
    return <p className="text-sm text-[var(--text-muted)]">Seleccione un informe para ver desempeño en aula.</p>
  }

  if (loading) {
    return <p className="text-sm text-[var(--text-muted)]">Cargando resultados agregados…</p>
  }

  if (!data) {
    return <p className="text-sm text-[var(--text-muted)]">No hay datos de desempeño disponibles.</p>
  }

  const warnings = data.meta.warnings ?? []
  const nLinked = data.meta.link?.evaluation_ids?.length ?? 0
  const skillChart = (data.accuracy_by_skill ?? [])
    .filter((s) => typeof s.achieved_pct === "number")
    .slice(0, 12)
    .map((s) => ({
      name: s.skill_label.length > 24 ? `${s.skill_label.slice(0, 22)}…` : s.skill_label,
      logro: s.achieved_pct as number,
      esperado: s.expected_pct,
    }))

  const axisChart = (data.accuracy_by_axis ?? [])
    .filter((a) => typeof a.achieved_pct === "number")
    .slice(0, 10)
    .map((a) => ({
      name: a.axis_label.length > 20 ? `${a.axis_label.slice(0, 18)}…` : a.axis_label,
      logro: a.achieved_pct as number,
    }))

  const cognitivePie = (data.cognitive_distribution?.by_student_dominant_level ?? []).map((c) => ({
    name: c.cognitive_level,
    value: c.student_count,
  }))

  const risks = data.student_risk_list?.items ?? []
  const risksNamed = risks.filter((r) => String(r.student_display_name ?? "").trim() !== "")
  const courses = [...new Set(risksNamed.map((r) => String(r.course_label ?? "SIN CURSO")))]
  const risksFiltered = risksNamed.filter((r) =>
    courseFilter === "ALL" ? true : String(r.course_label ?? "SIN CURSO") === courseFilter,
  )
  const groupedByCourse = risksFiltered.reduce<Record<string, typeof risks>>((acc, row) => {
    const key = String(row.course_label ?? "SIN CURSO")
    acc[key] = [...(acc[key] ?? []), row]
    return acc
  }, {})

  if (nLinked === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Vincule una o más evaluaciones en el panel superior para ver agregados de aula.
        </p>
        {warnings.length > 0 && (
          <p className="text-xs text-[var(--text-muted)]">{warnings.join(" · ")}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <p className="text-xs text-[var(--text-muted)] border-b border-slate-100 pb-2">{warnings.join(" · ")}</p>
      )}
      <p className="text-sm text-slate-600">
        Evaluaciones agregadas: <strong>{data.meta.evaluation_count}</strong>
      </p>
      <StrategicNarrativePanel strategic={data.strategic_analysis ?? null} />

      {/* id legado: el PDF UTP usa `schoolAnalytics.by_skill` + #utp-dashboard-pdf-capture-root (ficha HTML). */}
      <div id="utp-dashboard-pdf-results-charts" className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3 bg-white">
          <h4 className="text-sm font-semibold mb-1">{uiCoberturaPorHabilidadTitulo()}</h4>
          {uiCoberturaPorHabilidadBajada() ? (
            <p className="text-[11px] text-slate-500 mb-2 leading-snug">{uiCoberturaPorHabilidadBajada()}</p>
          ) : null}
          {skillChart.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Sin datos pedagógicos (¿falta prueba base o ítems?).</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={skillChart} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={60} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [`${Number(v ?? 0)}%`, uiChartTooltipLabel()]} />
                  <Bar dataKey="logro" fill="#0f766e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 p-3 bg-white">
          <h4 className="text-sm font-semibold mb-1">{uiCoberturaPorEjeTitulo()}</h4>
          {uiCoberturaPorEjeBajada() ? (
            <p className="text-[11px] text-slate-500 mb-2 leading-snug">{uiCoberturaPorEjeBajada()}</p>
          ) : null}
          {axisChart.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Sin ejes agregados.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={axisChart} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={60} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [`${Number(v ?? 0)}%`, uiChartTooltipLabel()]} />
                  <Bar dataKey="logro" fill="#0369a1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 bg-white">
        <h4 className="text-sm font-semibold mb-2">Nivel cognitivo dominante (por estudiante)</h4>
        {cognitivePie.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Sin distribución cognitiva.</p>
        ) : (
          <div className="h-56 flex justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cognitivePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72}>
                  {cognitivePie.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      </div>

      <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
        <h4 className="text-sm font-semibold text-rose-900 mb-2">
          Riesgo académico (nota Chile &lt; {data.student_risk_list?.threshold_note_chile ?? 4})
        </h4>
        <p className="text-xs text-rose-800 mb-2">
          Total bajo umbral: {data.student_risk_list?.total_below_threshold ?? 0}
        </p>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-rose-900">Curso:</span>
          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            className="text-xs rounded border border-rose-200 px-2 py-1 bg-white"
          >
            <option value="ALL">Todos</option>
            {courses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {risks.length > 0 && risksNamed.length === 0 ? (
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-2">
            Hay {risks.length} evaluación(es) bajo umbral sin nombre resolvible. Complete evaluation_students.student_name o
            evaluation_summaries.student_name_raw (o migre y re-guarde).
          </p>
        ) : risksFiltered.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Ningún registro en esta página o sin resumen de nota.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(groupedByCourse).map(([course, rows]) => (
              <div key={course} className="overflow-x-auto rounded border border-rose-100 bg-white">
                <div className="px-3 py-2 bg-rose-100/60 text-xs font-semibold text-rose-900">Curso: {course}</div>
                <table className="min-w-full text-sm">
                  <thead className="bg-rose-50">
                    <tr>
                      <th className="text-left px-3 py-2">Estudiante</th>
                      <th className="text-left px-3 py-2">Nota</th>
                      <th className="text-left px-3 py-2">Fecha escaneo</th>
                      <th className="text-left px-3 py-2">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${course}-${r.evaluation_id}`} className="border-t border-rose-100">
                        <td className="px-3 py-2">{r.student_display_name}</td>
                        <td className="px-3 py-2 font-medium text-rose-700">{r.grade_chile}</td>
                        <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                          {r.evaluated_at ? new Date(r.evaluated_at).toLocaleString("es-CL") : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={`/api/evaluations/${encodeURIComponent(r.evaluation_id)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                          >
                            Ver Prueba
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs rounded-md border border-slate-300 px-2 py-1 hover:bg-white"
          >
            Actualizar datos
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem("utp_link_updated_at", String(Date.now()))
              } catch {
                /* noop */
              }
              void load()
            }}
            className="text-xs rounded-md border border-slate-800 bg-slate-900 text-white px-2 py-1 hover:bg-slate-800"
          >
            Sincronizar Datos Reales
          </button>
        </div>
      </div>
    </div>
  )
}
