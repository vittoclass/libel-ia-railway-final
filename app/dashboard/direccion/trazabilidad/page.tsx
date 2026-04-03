"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { semesterKeyFromDate } from "@/app/lib/skill-traceability/semester"

type CatalogSkill = { id: string; axis_id: string; name: string; axis_name?: string }

type TracePayload = {
  meta: {
    skill_id: string
    skill_label: string
    axis_label: string
    subject: string
    semester_key: string
    semester_previous: string
    delta_definition: string
  }
  school: {
    accuracy_avg_pct: number | null
    batch_count: number
    student_count: number
    trend_label: string
    verdict: string
  }
  comparison_previous_semester: { semester_key: string; accuracy_avg_pct: number | null; delta_pp: number | null }
  insight: string
  drill_batches: Array<{
    batch_id: string
    course_label: string | null
    evaluated_at: string | null
    accuracy_avg_pct: number | null
    student_count: number | null
    focused: boolean
  }>
  student_timeline: Array<{
    evaluation_id: string
    evaluated_at: string | null
    accuracy_pct: number | null
    batch_id: string | null
    title: string | null
  }>
  course_detail: {
    batch_id: string
    accuracy_avg_pct: number | null
    student_count: number | null
    students: Array<{ student_profile_id: string; accuracy_pct: number | null }>
  } | null
  error?: string
  hint?: string
}

export default function TrazabilidadHabilidadesPage() {
  const [subject, setSubject] = useState("Lenguaje")
  const [semesterKey, setSemesterKey] = useState(() => semesterKeyFromDate(new Date()))
  const [skills, setSkills] = useState<CatalogSkill[]>([])
  const [skillId, setSkillId] = useState("")
  const [focusBatchId, setFocusBatchId] = useState<string | null>(null)
  const [studentProfileId, setStudentProfileId] = useState<string | null>(null)
  const [data, setData] = useState<TracePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/traceability/catalog?subject=${encodeURIComponent(subject)}`, {
        cache: "no-store",
      })
      const j = await res.json()
      if (res.ok && Array.isArray(j.skills)) {
        setSkills(j.skills)
        if (!skillId && j.skills[0]?.id) setSkillId(j.skills[0].id)
      }
    } catch {
      /* noop */
    }
  }, [subject, skillId])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const loadTrace = useCallback(async () => {
    if (!skillId) return
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({
        skill_id: skillId,
        subject,
        semester_key: semesterKey,
      })
      if (focusBatchId) p.set("batch_id", focusBatchId)
      if (studentProfileId) p.set("student_profile_id", studentProfileId)
      const res = await fetch(`/api/dashboard/traceability/skills?${p}`, { cache: "no-store" })
      const j = (await res.json()) as TracePayload & { error?: string; hint?: string }
      if (!res.ok) {
        setError(j?.error ?? "Error al cargar trazabilidad")
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
  }, [skillId, subject, semesterKey, focusBatchId, studentProfileId])

  useEffect(() => {
    void loadTrace()
  }, [loadTrace])

  return (
    <section className="max-w-6xl mx-auto space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Trazabilidad evolutiva (habilidad)</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-3xl">
            Vista en 3 niveles: KPI colegio (promedio entre lotes), curso/lote (batch), alumno (historial). Misma habilidad en
            pantalla. Δ en puntos porcentuales entre semestres H1/H2; ±5 pp dispara veredicto.
          </p>
        </div>
        <Link href="/dashboard/direccion" className="text-sm text-sky-700 hover:underline">
          ← Volver al panel
        </Link>
      </div>

      <div className="rounded-xl border border-[var(--border-color)] bg-white p-4 grid gap-3 md:grid-cols-4">
        <label className="text-xs text-[var(--text-muted)] md:col-span-1">
          Asignatura
          <select
            className="mt-1 w-full rounded-md border border-[var(--border-color)] px-2 py-2 text-sm"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
              setSkillId("")
            }}
          >
            <option value="Lenguaje">Lenguaje</option>
            <option value="Matemática">Matemática</option>
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)] md:col-span-1">
          Semestre (clave)
          <input
            className="mt-1 w-full rounded-md border border-[var(--border-color)] px-2 py-2 text-sm font-mono"
            value={semesterKey}
            onChange={(e) => setSemesterKey(e.target.value.trim())}
            placeholder="2026-H1"
          />
        </label>
        <label className="text-xs text-[var(--text-muted)] md:col-span-2">
          Habilidad (catálogo)
          <select
            className="mt-1 w-full rounded-md border border-[var(--border-color)] px-2 py-2 text-sm"
            value={skillId}
            onChange={(e) => setSkillId(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.axis_name ? `${s.axis_name} · ` : ""}
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-slate-900 text-white px-3 py-2 text-sm"
            onClick={() => void loadTrace()}
            disabled={loading || !skillId}
          >
            {loading ? "Cargando…" : "Actualizar"}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            onClick={() => {
              setFocusBatchId(null)
              setStudentProfileId(null)
            }}
          >
            Reset zoom
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && !error && (
        <>
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
            <p className="text-xs uppercase text-[var(--text-muted)]">Colegio · {data.meta.semester_key}</p>
            <div className="mt-2 flex flex-wrap items-end gap-4">
              <div>
                <p className="text-3xl font-bold text-slate-900">
                  {data.school.accuracy_avg_pct != null ? `${Math.round(data.school.accuracy_avg_pct * 10) / 10}%` : "—"}
                </p>
                <p className="text-xs text-[var(--text-muted)]">Accuracy medio (entre lotes)</p>
              </div>
              <div>
                <p className={`text-sm font-semibold ${data.school.verdict === "alerta_retroceso" ? "text-red-700" : data.school.verdict === "incremento_inteligencia" ? "text-emerald-700" : "text-slate-700"}`}>
                  {data.school.trend_label}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  vs {data.comparison_previous_semester.semester_key}:{" "}
                  {data.comparison_previous_semester.accuracy_avg_pct != null
                    ? `${Math.round(data.comparison_previous_semester.accuracy_avg_pct * 10) / 10}%`
                    : "—"}
                  {data.comparison_previous_semester.delta_pp != null && (
                    <span className="ml-1">
                      (Δ {data.comparison_previous_semester.delta_pp > 0 ? "+" : ""}
                      {Math.round(data.comparison_previous_semester.delta_pp * 10) / 10} pp)
                    </span>
                  )}
                </p>
              </div>
              <div className="text-xs text-[var(--text-muted)] max-w-xl">
                Lotes: {data.school.batch_count} · Estudiantes (suma por lote, aprox.): {data.school.student_count}
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-800 leading-snug border-t border-slate-100 pt-3">{data.insight}</p>
            <p className="mt-2 text-[10px] text-slate-500 font-mono">{data.meta.delta_definition}</p>
          </div>

          <div className="rounded-xl border border-[var(--border-color)] bg-white overflow-hidden">
            <div className="px-4 py-2 border-b bg-slate-50 text-sm font-semibold">Drill-down: lotes (curso)</div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-3 py-2">Curso / lote</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Accuracy %</th>
                  <th className="px-3 py-2">Alumnos</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.drill_batches.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-[var(--text-muted)]">
                      Sin lotes con datos de habilidad en este semestre (¿migración rollup aplicada? ¿hay evaluation_skill_results?).
                    </td>
                  </tr>
                ) : (
                  data.drill_batches.map((row) => (
                    <tr key={row.batch_id} className={row.focused ? "bg-sky-50" : "border-t border-slate-100"}>
                      <td className="px-3 py-2 font-mono text-[11px] md:text-sm md:font-sans">
                        {row.course_label ?? "—"} <span className="text-slate-400">{row.batch_id.slice(0, 8)}…</span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.evaluated_at ? new Date(row.evaluated_at).toLocaleString("es-CL") : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.accuracy_avg_pct != null ? `${Math.round(row.accuracy_avg_pct * 10) / 10}%` : "—"}
                      </td>
                      <td className="px-3 py-2">{row.student_count ?? "—"}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-sky-700 text-xs underline"
                          onClick={() => {
                            setFocusBatchId(row.batch_id)
                            setStudentProfileId(null)
                          }}
                        >
                          Ver alumnos
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data.course_detail && (
            <div className="rounded-xl border border-[var(--border-color)] bg-white overflow-hidden">
              <div className="px-4 py-2 border-b bg-slate-50 text-sm font-semibold">
                Alumnos en lote {data.course_detail.batch_id.slice(0, 8)}… · {data.meta.skill_label}
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-3 py-2">student_profile_id</th>
                    <th className="px-3 py-2">Accuracy %</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.course_detail.students.map((s) => (
                    <tr key={s.student_profile_id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-[11px]">{s.student_profile_id}</td>
                      <td className="px-3 py-2">
                        {s.accuracy_pct != null ? `${Math.round(s.accuracy_pct * 10) / 10}%` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-sky-700 text-xs underline"
                          onClick={() => setStudentProfileId(s.student_profile_id)}
                        >
                          Historial
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {studentProfileId && data.student_timeline.length > 0 && (
            <div className="rounded-xl border border-[var(--border-color)] bg-white overflow-hidden">
              <div className="px-4 py-2 border-b bg-slate-50 text-sm font-semibold">
                Historial alumno · {studentProfileId.slice(0, 8)}…
              </div>
              <ul className="divide-y divide-slate-100 text-sm">
                {data.student_timeline.map((t) => (
                  <li key={t.evaluation_id} className="px-4 py-2 flex flex-wrap gap-2">
                    <span className="text-xs text-[var(--text-muted)]">
                      {t.evaluated_at ? new Date(t.evaluated_at).toLocaleString("es-CL") : "—"}
                    </span>
                    <span className="font-medium">{t.accuracy_pct != null ? `${Math.round(t.accuracy_pct * 10) / 10}%` : "—"}</span>
                    <span className="text-xs truncate max-w-[12rem]">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
