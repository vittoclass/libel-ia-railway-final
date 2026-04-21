"use client"

import Link from "next/link"
import { Fragment, useEffect, useState } from "react"
import {
  USE_NEW_PEDAGOGIC_LABELS,
  uiCoberturaBajada,
  uiCoberturaTitulo,
  uiEstandarAprendizajeBajada,
  uiEstandarAprendizajeTitulo,
  uiSemaforoBajada,
  uiSemaforoTitulo,
} from "@/app/lib/pedagogic-ui-copy"
import { formatStudentDisplayName } from "@/app/lib/format-student-name"

type Kpis = {
  promedio_logro_institucional: number
  total_evaluaciones_mes: number
  simce_proyectado_promedio: number
  paes_proyectado_promedio: number
}

type CourseBreakdownRow = {
  course_key: string
  course_display: string
  evaluation_count: number
  avg_logro_pct: number | null
  simce_projection: number | null
  paes_projection: number | null
}

type SegmentBreakdownRow = {
  subject_key: string
  subject_display: string
  instrument_family: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
  evaluation_count: number
  avg_logro_pct: number | null
  simce_projection: number | null
  paes_projection: number | null
  course_breakdown: CourseBreakdownRow[]
}

function parseCourseBreakdownFromApi(raw: unknown): CourseBreakdownRow[] {
  if (!Array.isArray(raw)) return []
  const out: CourseBreakdownRow[] = []
  for (const c of raw) {
    if (!c || typeof c !== "object") continue
    const o = c as Record<string, unknown>
    if (typeof o.course_key !== "string" || typeof o.course_display !== "string") continue
    const n = Number(o.evaluation_count)
    if (!Number.isFinite(n)) continue
    const avgRaw = o.avg_logro_pct
    const avg_logro_pct =
      avgRaw == null ? null : Number.isFinite(Number(avgRaw)) ? Number(avgRaw) : null
    const simRaw = o.simce_projection
    const paesRaw = o.paes_projection
    out.push({
      course_key: o.course_key,
      course_display: o.course_display,
      evaluation_count: n,
      avg_logro_pct,
      simce_projection: simRaw != null && Number.isFinite(Number(simRaw)) ? Number(simRaw) : null,
      paes_projection: paesRaw != null && Number.isFinite(Number(paesRaw)) ? Number(paesRaw) : null,
    })
  }
  return out
}

function formatSegmentRowProjection(
  instrument_family: SegmentBreakdownRow["instrument_family"],
  simce_projection: number | null,
  paes_projection: number | null,
): string {
  if (instrument_family === "SIMCE" && simce_projection != null && Number.isFinite(Number(simce_projection))) {
    return `SIMCE ${Math.round(Number(simce_projection))} (200–350)`
  }
  if (instrument_family === "PAES" && paes_projection != null && Number.isFinite(Number(paes_projection))) {
    return `PAES ${Math.round(Number(paes_projection))} (100–1000)`
  }
  return "—"
}

export default function DashboardDireccionPage() {
  const [kpis, setKpis] = useState<Kpis>({
    promedio_logro_institucional: 0,
    total_evaluaciones_mes: 0,
    simce_proyectado_promedio: 0,
    paes_proyectado_promedio: 0,
  })
  const [semaforo, setSemaforo] = useState({
    insuficiente: 0,
    elemental: 0,
    adecuado: 0,
    total: 0,
  })
  const [riskDistribution, setRiskDistribution] = useState({
    critico: 0,
    alto: 0,
    medio: 0,
    bajo: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [globalAlert, setGlobalAlert] = useState<string | null>(null)
  const [criticalStudents, setCriticalStudents] = useState<
    Array<{
      evaluation_id: string
      student_name: string
      student_name_raw?: string | null
      course_label: string
      grade_chile: number
      evaluated_at: string | null
    }>
  >([])
  const [apiWarning, setApiWarning] = useState<string | null>(null)
  const [aggregates, setAggregates] = useState<{
    evaluations_in_scope: number
    summaries_count: number
    items_rows: number
    avg_grade_chile: number | null
    avg_logro_pct: number | null
  } | null>(null)
  const [recentPreview, setRecentPreview] = useState<
    Array<{
      evaluation_id: string
      title: string | null
      subject: string | null
      logro_pct: number | null
      evaluated_at: string | null
      grade_chile: number | null
      instrument_analytics_mode?: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
    }>
  >([])
  const [segmentBreakdown, setSegmentBreakdown] = useState<SegmentBreakdownRow[]>([])

  async function loadDireccion() {
    setLoading(true)
    setError(null)
    try {
      const url = `/api/dashboard/direccion?sync=${Date.now()}`
      const res = await fetch(url, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? "No se pudo cargar el resumen ejecutivo")
        setSegmentBreakdown([])
      } else {
        setKpis(json?.kpis ?? {
          promedio_logro_institucional: 0,
          total_evaluaciones_mes: 0,
          simce_proyectado_promedio: 0,
          paes_proyectado_promedio: 0,
        })
        setSemaforo(json?.semaforo ?? { insuficiente: 0, elemental: 0, adecuado: 0, total: 0 })
        setRiskDistribution(json?.risk_distribution ?? { critico: 0, alto: 0, medio: 0, bajo: 0 })
        setGlobalAlert(typeof json?.global_alert === "string" ? json.global_alert : null)
        setCriticalStudents(Array.isArray(json?.critical_students) ? json.critical_students : [])
        setApiWarning(typeof json?.warning === "string" && json.warning ? json.warning : null)
        setAggregates(
          json?.aggregates && typeof json.aggregates === "object"
            ? {
                evaluations_in_scope: Number(json.aggregates.evaluations_in_scope) || 0,
                summaries_count: Number(json.aggregates.summaries_count) || 0,
                items_rows: Number(json.aggregates.items_rows) || 0,
                avg_grade_chile:
                  json.aggregates.avg_grade_chile != null && Number.isFinite(Number(json.aggregates.avg_grade_chile))
                    ? Number(json.aggregates.avg_grade_chile)
                    : null,
                avg_logro_pct:
                  json.aggregates.avg_logro_pct != null && Number.isFinite(Number(json.aggregates.avg_logro_pct))
                    ? Number(json.aggregates.avg_logro_pct)
                    : null,
              }
            : null,
        )
        setRecentPreview(Array.isArray(json?.recent_evaluations_preview) ? json.recent_evaluations_preview : [])
        const rawSeg = json?.segment_breakdown
        setSegmentBreakdown(
          Array.isArray(rawSeg)
            ? (rawSeg as SegmentBreakdownRow[])
                .filter(
                  (r) =>
                    r &&
                    typeof r.subject_display === "string" &&
                    (r.instrument_family === "SIMCE" ||
                      r.instrument_family === "PAES" ||
                      r.instrument_family === "INSTITUTIONAL_OTHER"),
                )
                .map((r) => ({
                  ...r,
                  course_breakdown: parseCourseBreakdownFromApi(
                    (r as { course_breakdown?: unknown }).course_breakdown,
                  ),
                }))
            : [],
        )
      }
    } catch {
      setError("Error de red al cargar KPIs")
      setSegmentBreakdown([])
    } finally {
      setLoading(false)
    }
  }

  function syncRealData() {
    try {
      localStorage.removeItem("direccion_kpis_cache")
    } catch {
      /* noop */
    }
    try {
      localStorage.setItem("utp_link_updated_at", String(Date.now()))
    } catch {
      /* noop */
    }
    void loadDireccion()
  }

  useEffect(() => {
    let mounted = true
    void loadDireccion()
    const onStorage = (evt: StorageEvent) => {
      if (!mounted) return
      if (evt.key === "utp_link_updated_at") void loadDireccion()
    }
    window.addEventListener("storage", onStorage)
    const interval = window.setInterval(() => {
      if (mounted) void loadDireccion()
    }, 30000)
    return () => {
      mounted = false
      window.removeEventListener("storage", onStorage)
      window.clearInterval(interval)
    }
  }, [])
  const total = Math.max(1, semaforo.total || 0)
  const pctInsuf = Math.round((semaforo.insuficiente / total) * 100)
  const pctElem = Math.round((semaforo.elemental / total) * 100)
  const pctAdq = Math.round((semaforo.adecuado / total) * 100)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Dirección - Resumen Ejecutivo</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/direccion/analitica-colegio"
            className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
          >
            Analítica por colegio
          </Link>
          <Link
            href="/dashboard/direccion/trazabilidad"
            className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100"
          >
            Trazabilidad por habilidad
          </Link>
          <button
            type="button"
            onClick={() => syncRealData()}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Sincronizar Datos Reales
          </button>
        </div>
      </div>
      {loading && <p className="text-sm text-[var(--text-muted)]">Calculando indicadores...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {globalAlert && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{globalAlert}</p>}
      {apiWarning && <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{apiWarning}</p>}
      {aggregates && (
        <p className="text-xs text-[var(--text-muted)]">
          OMR en vivo: {aggregates.evaluations_in_scope} evaluación(es) en alcance · {aggregates.summaries_count} resumen(es) ·{" "}
          {aggregates.items_rows} filas de ítems
          {aggregates.avg_grade_chile != null ? ` · nota Chile promedio ${aggregates.avg_grade_chile.toFixed(2)}` : ""}
          {aggregates.avg_logro_pct != null
            ? ` · ${USE_NEW_PEDAGOGIC_LABELS ? "cobertura curricular (ítems)" : "logro ítems"} ${aggregates.avg_logro_pct.toFixed(1)}%`
            : ""}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-4">
        <article className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{uiCoberturaTitulo()}</p>
          {uiCoberturaBajada() ? (
            <p className="text-[11px] text-slate-500 mt-1 leading-snug">{uiCoberturaBajada()}</p>
          ) : null}
          <p className="mt-2 text-3xl font-bold text-emerald-700">{Math.round(kpis.promedio_logro_institucional)}%</p>
          <div className="mt-3 h-3 w-full rounded-full bg-emerald-100 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.max(0, Math.min(100, kpis.promedio_logro_institucional))}%` }}
            />
          </div>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Total de Evaluaciones Mes</p>
          <p className="mt-2 text-3xl font-bold text-slate-800">{Math.round(kpis.total_evaluaciones_mes)}</p>
        </article>
        <article className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">SIMCE Proyectado</p>
          <p className="mt-2 text-3xl font-bold text-sky-700">{Math.round(kpis.simce_proyectado_promedio)}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Escala SIMCE (200-350)</p>
        </article>
        <article className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">PAES Proyectado Promedio</p>
          <p className="mt-2 text-3xl font-bold text-indigo-700">{Math.round(kpis.paes_proyectado_promedio)}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Escala DEMRE (100-1000)</p>
        </article>
      </div>
      {!loading && segmentBreakdown.length > 0 && (
        <article className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900">Desglose por asignatura y tipo de prueba</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1 max-w-3xl">
            Basado en las mismas evaluaciones que el resumen superior. No mezcla SIMCE, PAES ni pruebas internas. Por curso se
            agrupan etiquetas equivalentes (p. ej. ordinales) sin duplicar filas artificiales.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm border border-slate-200 rounded-md overflow-hidden">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-700">Asignatura</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-700">Tipo</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700">Nº eval.</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700">Logro %</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700">Proyección</th>
                </tr>
              </thead>
              <tbody>
                {segmentBreakdown.map((row, i) => {
                  const rowKey = `${row.subject_key}-${row.instrument_family}-${i}`
                  const tipoLabel =
                    row.instrument_family === "SIMCE"
                      ? "SIMCE"
                      : row.instrument_family === "PAES"
                        ? "PAES"
                        : "Interna"
                  const proyeccion = formatSegmentRowProjection(
                    row.instrument_family,
                    row.simce_projection,
                    row.paes_projection,
                  )
                  const courses = row.course_breakdown ?? []
                  const courseTable = (
                    <table className="w-full text-xs border border-slate-100 rounded-md overflow-hidden">
                      <thead className="bg-slate-50/90">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Curso</th>
                          <th className="text-right px-2 py-1.5 font-semibold text-slate-600">Nº eval.</th>
                          <th className="text-right px-2 py-1.5 font-semibold text-slate-600">Logro %</th>
                          <th className="text-right px-2 py-1.5 font-semibold text-slate-600">Proyección</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courses.map((c) => (
                          <tr key={c.course_key} className="border-t border-slate-100 bg-white">
                            <td className="px-2 py-1.5 text-slate-800">{c.course_display}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{c.evaluation_count}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
                              {c.avg_logro_pct != null && Number.isFinite(Number(c.avg_logro_pct))
                                ? `${Number(c.avg_logro_pct).toFixed(1)}%`
                                : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600">
                              {formatSegmentRowProjection(
                                row.instrument_family,
                                c.simce_projection,
                                c.paes_projection,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                  return (
                    <Fragment key={rowKey}>
                      <tr className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-900">{row.subject_display}</td>
                        <td className="px-3 py-2 text-slate-700">{tipoLabel}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.evaluation_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.avg_logro_pct != null && Number.isFinite(Number(row.avg_logro_pct))
                            ? `${Number(row.avg_logro_pct).toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 text-xs">{proyeccion}</td>
                      </tr>
                      {courses.length === 1 ? (
                        <tr className="border-t border-slate-50 bg-slate-50/50">
                          <td colSpan={5} className="px-3 py-2">
                            {courseTable}
                          </td>
                        </tr>
                      ) : null}
                      {courses.length > 1 ? (
                        <tr className="border-t border-slate-50 bg-slate-50/50">
                          <td colSpan={5} className="px-3 py-2">
                            <details className="group">
                              <summary className="cursor-pointer text-slate-700 font-medium text-xs list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                                <span className="text-slate-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                                Por curso ({courses.length})
                              </summary>
                              <div className="mt-2 pl-4 border-l-2 border-slate-200">{courseTable}</div>
                            </details>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </article>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <h3 className="font-semibold">{uiSemaforoTitulo()}</h3>
          <p className="text-xs text-[var(--text-muted)] mb-1">{uiSemaforoBajada()}</p>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Notas Chile (grade_chile): &lt; 4,0 Insuficiente · 4,0 a &lt; 5,5 Elemental · ≥ 5,5 Adecuado. Con vínculo UTP a
            ensayos SIMCE o PAES, solo esas evaluaciones alimentan este bloque cuando aplica; si no hay vínculo, se usan
            todas las evaluaciones en alcance.
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-rose-50 border border-rose-200 px-3 py-2">
              <span className="text-sm font-medium text-rose-700">Insuficiente</span>
              <span className="font-bold text-rose-700">{semaforo.insuficiente}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <span className="text-sm font-medium text-amber-700">Elemental</span>
              <span className="font-bold text-amber-700">{semaforo.elemental}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
              <span className="text-sm font-medium text-emerald-700">Adecuado</span>
              <span className="font-bold text-emerald-700">{semaforo.adecuado}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Total en categorías de desempeño: {semaforo.total}
          </p>
        </article>
        <article className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <h3 className="font-semibold">Estado de Riesgo Operacional</h3>
          <p className="text-xs text-[var(--text-muted)] mb-3">Distribución por nota Chile en resúmenes OMR (evaluation_summaries)</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border bg-red-50 border-red-200 p-3">
              <p className="text-xs text-red-600">Crítico</p>
              <p className="text-xl font-bold text-red-700">{riskDistribution.critico}</p>
            </div>
            <div className="rounded-lg border bg-rose-50 border-rose-200 p-3">
              <p className="text-xs text-rose-600">Alto</p>
              <p className="text-xl font-bold text-rose-700">{riskDistribution.alto}</p>
            </div>
            <div className="rounded-lg border bg-amber-50 border-amber-200 p-3">
              <p className="text-xs text-amber-600">Medio</p>
              <p className="text-xl font-bold text-amber-700">{riskDistribution.medio}</p>
            </div>
            <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3">
              <p className="text-xs text-emerald-600">Bajo</p>
              <p className="text-xl font-bold text-emerald-700">{riskDistribution.bajo}</p>
            </div>
          </div>
        </article>
      </div>
      <article className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
        <h3 className="font-semibold">{uiEstandarAprendizajeTitulo()}</h3>
        {uiEstandarAprendizajeBajada() ? (
          <p className="text-xs text-[var(--text-muted)] mb-2">{uiEstandarAprendizajeBajada()}</p>
        ) : null}
        <p className="text-xs text-[var(--text-muted)] mb-4">
          {USE_NEW_PEDAGOGIC_LABELS
            ? "Participación por nivel (Insuficiente / Elemental / Adecuado) respecto del total categorizado."
            : "Porcentaje de alumnos por nivel (Insuficiente / Elemental / Adecuado)"}
        </p>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-rose-700 font-medium">Insuficiente</span>
              <span className="font-semibold">{pctInsuf}%</span>
            </div>
            <div className="h-3 rounded-full bg-rose-100 overflow-hidden">
              <div className="h-full bg-rose-500" style={{ width: `${pctInsuf}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-amber-700 font-medium">Elemental</span>
              <span className="font-semibold">{pctElem}%</span>
            </div>
            <div className="h-3 rounded-full bg-amber-100 overflow-hidden">
              <div className="h-full bg-amber-500" style={{ width: `${pctElem}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-emerald-700 font-medium">Adecuado</span>
              <span className="font-semibold">{pctAdq}%</span>
            </div>
            <div className="h-3 rounded-full bg-emerald-100 overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${pctAdq}%` }} />
            </div>
          </div>
        </div>
      </article>
      {recentPreview.length > 0 && (
        <article className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <h3 className="font-semibold">Últimas evaluaciones OMR en alcance</h3>
          <p className="text-xs text-[var(--text-muted)] mb-2">Hasta 3 evaluaciones más recientes (datos reales de ítems y resumen)</p>
          <ul className="text-sm space-y-2">
            {recentPreview.map((r) => (
              <li key={r.evaluation_id} className="border border-slate-100 rounded-md px-3 py-2 bg-slate-50/80">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title ?? r.subject ?? "Evaluación"}</span>
                  {r.instrument_analytics_mode === "SIMCE" ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-sky-100 text-sky-800 border border-sky-200">
                      SIMCE
                    </span>
                  ) : null}
                  {r.instrument_analytics_mode === "PAES" ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-200">
                      PAES
                    </span>
                  ) : null}
                  {r.instrument_analytics_mode === "INSTITUTIONAL_OTHER" ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200">
                      Interna
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-[var(--text-muted)]">
                  {r.evaluated_at ? new Date(r.evaluated_at).toLocaleString("es-CL") : "—"} ·{" "}
                  {USE_NEW_PEDAGOGIC_LABELS ? "cobertura" : "logro"}{" "}
                  {r.logro_pct != null ? `${Math.round(r.logro_pct)}%` : "—"} · nota{" "}
                  {r.grade_chile != null && Number.isFinite(Number(r.grade_chile)) ? Number(r.grade_chile).toFixed(1) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </article>
      )}
      <article className="rounded-xl border border-red-200 bg-red-50/40 p-4 shadow-sm">
        <h3 className="font-semibold text-red-900">Riesgo Crítico (identidad visible)</h3>
        <p className="text-xs text-red-800 mb-3">Alumnos críticos del cableado UTP a Dirección</p>
        {criticalStudents.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            Sin registros con nota bajo 4,0 en evaluation_summaries del alcance actual. Si subió pruebas, verifique vínculo UTP o
            que exista school_id/teacher_id en el perfil para las últimas 3 evaluaciones.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-red-100 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-red-50">
                <tr>
                  <th className="text-left px-3 py-2">Alumno / raw</th>
                  <th className="text-left px-3 py-2">Curso</th>
                  <th className="text-left px-3 py-2">Nota</th>
                  <th className="text-left px-3 py-2">Fecha escaneo</th>
                </tr>
              </thead>
              <tbody>
                {criticalStudents.map((s) => (
                  <tr key={s.evaluation_id} className="border-t border-red-100">
                    <td className="px-3 py-2">
                      <span className="block">{formatStudentDisplayName(s.student_name) || s.student_name}</span>
                      {s.student_name_raw ? (
                        <span className="block text-xs text-[var(--text-muted)]">raw: {s.student_name_raw}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{s.course_label}</td>
                    <td className="px-3 py-2 font-semibold text-red-700">{s.grade_chile}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                      {s.evaluated_at ? new Date(s.evaluated_at).toLocaleString("es-CL") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  )
}
