"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { EXAM_TYPE_FILTER_OPTIONS } from "@/app/lib/exam-type-constants"

type SkillRow = {
  skill_name: string
  subject: string | null
  avg_logro_pct: number | null
  student_result_rows: number
  insuficiente_pct: number
  elemental_pct: number
  adecuado_pct: number
}

type Payload = {
  school_id: string | null
  evaluation_count: number
  exam_type_filter: string | null
  skill_result_rows?: number
  by_skill: SkillRow[]
  analisis_utp: string[]
  error?: string
}

export default function AnaliticaColegioPage() {
  const [examType, setExamType] = useState("")
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (examType.trim()) qs.set("exam_type", examType.trim())
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
  }, [examType])

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
          <span className="text-[var(--text-muted)]">exam_type</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            value={examType}
            onChange={(e) => setExamType(e.target.value)}
          >
            {EXAM_TYPE_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100"
        >
          Actualizar
        </button>
      </div>

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
          </div>

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
