"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EXAM_TYPE_FILTER_OPTIONS_WITH_NATIONAL } from "@/app/lib/exam-type-constants"

type SkillRow = {
  skill_name: string
  subject: string | null
  avg_logro_pct: number | null
  student_result_rows: number
  insuficiente_pct: number
  elemental_pct: number
  adecuado_pct: number
}

type SegmentRow = {
  subject_key: string
  subject_display: string
  instrument_family: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
  evaluation_count: number
  evaluation_ids: string[]
}

type Payload = {
  school_id: string | null
  evaluation_count: number
  evaluation_count_total?: number
  summary_available?: boolean
  status_reason?: string
  segmentation?: SegmentRow[]
  segment_auto_selected?: boolean
  subject_filter?: string | null
  instrument_family_filter?: string | null
  exam_type_filter: string | null
  course_filter?: string | null
  batch_id_filter?: string | null
  skill_result_rows?: number
  by_skill: SkillRow[]
  analisis_utp: string[]
  error?: string
}

export default function AnaliticaColegioPage() {
  const [examType, setExamType] = useState("")
  const [subjectFilter, setSubjectFilter] = useState("")
  const [instrumentFamily, setInstrumentFamily] = useState<"" | "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER">("")
  const [courseFilter, setCourseFilter] = useState("")
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const subjectOptions = useMemo(() => {
    const seg = data?.segmentation
    if (!seg?.length) return [] as Array<{ key: string; label: string }>
    const m = new Map<string, string>()
    for (const s of seg) {
      if (!m.has(s.subject_key)) m.set(s.subject_key, s.subject_display)
    }
    return Array.from(m.entries()).map(([key, label]) => ({ key, label }))
  }, [data?.segmentation])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (examType.trim()) qs.set("exam_type", examType.trim())
      if (subjectFilter.trim()) qs.set("subject", subjectFilter.trim())
      if (instrumentFamily) qs.set("instrument_family", instrumentFamily)
      if (courseFilter.trim()) qs.set("course", courseFilter.trim())
      const res = await fetch(`/api/dashboard/direccion/school-pedagogy?${qs}`, { cache: "no-store" })
      const j = (await res.json()) as Payload
      if (!res.ok) {
        setError(j?.error ?? "No se pudo cargar la analítica")
        setData(null)
        return
      }
      setData(j)
    } catch {
      setError("Error de red")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [examType, subjectFilter, instrumentFamily, courseFilter])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="max-w-6xl mx-auto space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Analítica por colegio</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-3xl">
            Agregación por <code className="text-xs bg-slate-100 px-1 rounded">school_id</code> y habilidades (resultados reales en{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">evaluation_skill_results</code>). Cortes: &lt;50% Insuficiente · 50–69%
            Elemental · ≥70% Adecuado.
          </p>
        </div>
        <Link
          href="/dashboard/direccion"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Volver a Dirección
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-muted)]">Asignatura</span>
          <input
            list="colegio-subject-options"
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 min-w-[9rem]"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            placeholder="Ej. Lenguaje"
          />
          <datalist id="colegio-subject-options">
            {subjectOptions.map((o) => (
              <option key={o.key} value={o.label} />
            ))}
          </datalist>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-muted)]">Familia</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            value={instrumentFamily}
            onChange={(e) =>
              setInstrumentFamily(e.target.value as "" | "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER")
            }
          >
            <option value="">— Elegir —</option>
            <option value="SIMCE">SIMCE</option>
            <option value="PAES">PAES</option>
            <option value="INSTITUTIONAL_OTHER">Internas</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-muted)]">Curso (opc.)</span>
          <input
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 w-36"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            placeholder="Etiqueta o id"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100"
        >
          Actualizar
        </button>
      </div>
      <details className="text-sm border border-slate-200 rounded-md bg-slate-50/80 px-3 py-2 max-w-3xl">
        <summary className="cursor-pointer font-medium text-slate-700">Filtros avanzados (exam_type legado)</summary>
        <p className="text-xs text-[var(--text-muted)] mt-2 mb-2">
          La familia del instrumento (SIMCE / PAES / internas) se resuelve con las etiquetas canónicas de cada evaluación.
          Use exam_type solo si necesita acotar por valor crudo almacenado; no sustituye a la familia.
        </p>
        <label className="inline-flex items-center gap-2">
          <span className="text-[var(--text-muted)]">exam_type</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            value={examType}
            onChange={(e) => setExamType(e.target.value)}
          >
            {EXAM_TYPE_FILTER_OPTIONS_WITH_NATIONAL.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </details>

      {loading && <p className="text-sm text-[var(--text-muted)]">Cargando…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && !loading && (
        <>
          <div className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm text-sm space-y-1">
            <p>
              <strong>school_id:</strong> {data.school_id ?? "—"}
            </p>
            <p>
              <strong>Evaluaciones en filtro:</strong> {data.evaluation_count} ·{" "}
              <strong>Filas de resultado por habilidad:</strong> {data.skill_result_rows ?? "—"}
            </p>
            {data.exam_type_filter ? (
              <p>
                <strong>Filtro exam_type:</strong> {data.exam_type_filter}
              </p>
            ) : null}
            {data.course_filter ? (
              <p>
                <strong>Filtro curso:</strong> {data.course_filter}
              </p>
            ) : null}
            {data.status_reason === "requires_subject_and_instrument_family" ? (
              <p className="text-amber-800">
                Hay más de un bloque SIMCE o PAES por asignatura, o solo segmentos internos sin elegir. Elija{" "}
                <strong>asignatura</strong> y <strong>familia</strong> arriba para ver habilidades agregadas sin mezclar
                SIMCE, PAES ni internas.
              </p>
            ) : null}
            {data.segment_auto_selected ? (
              <p className="text-slate-600">
                Vista aplicada automáticamente para un segmento determinado ({data.subject_filter ?? "—"} ·{" "}
                {data.instrument_family_filter ?? "—"}). Incluye el caso de un único bloque SIMCE o PAES aunque existan
                otras evaluaciones internas en el colegio.
              </p>
            ) : null}
          </div>

          {data.segmentation && data.segmentation.length > 1 ? (
            <div className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm overflow-x-auto text-sm">
              <h2 className="font-semibold mb-2">Segmentos detectados (sin mezclar)</h2>
              <table className="min-w-full">
                <thead>
                  <tr className="bg-slate-50 border-b text-left">
                    <th className="px-3 py-2">Asignatura</th>
                    <th className="px-3 py-2">Familia</th>
                    <th className="px-3 py-2 text-right">Evaluaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.segmentation.map((s, i) => (
                    <tr key={`${s.subject_key}-${s.instrument_family}-${i}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">{s.subject_display}</td>
                      <td className="px-3 py-2">{s.instrument_family}</td>
                      <td className="px-3 py-2 text-right">{s.evaluation_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <article className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
            <h2 className="font-semibold text-indigo-950 mb-2">Análisis IA (UTP)</h2>
            <p className="text-xs text-indigo-900/80 mb-3">
              Interpretación automática basada en los datos agregados (sin modelo generativo); lista verificable para dirección y UTP.
            </p>
            {data.analisis_utp.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Sin narrativa (sin datos).</p>
            ) : (
              <ul className="list-disc list-inside space-y-2 text-sm text-slate-800">
                {data.analisis_utp.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </article>

          <article className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm overflow-x-auto">
            <h2 className="font-semibold mb-3">Logro por habilidad (establecimiento)</h2>
            {data.by_skill.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No hay agregados por habilidad para este alcance.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2">Asignatura (eje)</th>
                    <th className="text-left px-3 py-2">Habilidad</th>
                    <th className="text-right px-3 py-2">Logro % prom.</th>
                    <th className="text-right px-3 py-2">N registros</th>
                    <th className="text-right px-3 py-2">Insuf. %</th>
                    <th className="text-right px-3 py-2">Elem. %</th>
                    <th className="text-right px-3 py-2">Adec. %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_skill.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-[var(--text-muted)]">{r.subject ?? "—"}</td>
                      <td className="px-3 py-2 font-medium">{r.skill_name}</td>
                      <td className="px-3 py-2 text-right">{r.avg_logro_pct != null ? `${r.avg_logro_pct}%` : "—"}</td>
                      <td className="px-3 py-2 text-right">{r.student_result_rows}</td>
                      <td className="px-3 py-2 text-right text-rose-700">{r.insuficiente_pct}%</td>
                      <td className="px-3 py-2 text-right text-amber-800">{r.elemental_pct}%</td>
                      <td className="px-3 py-2 text-right text-emerald-800">{r.adecuado_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        </>
      )}
    </section>
  )
}
