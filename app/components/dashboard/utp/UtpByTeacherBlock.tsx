"use client"

import { useEffect, useMemo, useState } from "react"

type MetricRow = {
  dimension: string
  logro_pct: number
  evaluation_count: number
  coverage_pct: number
}

type DemoPayload = {
  sections?: {
    by_course?: MetricRow[]
    by_teacher?: MetricRow[]
    by_skill?: MetricRow[]
    by_axis?: MetricRow[]
  }
  meta?: {
    evaluations_in_scope?: number
    has_pedagogical_data?: boolean
  }
}

type EvalLotGroup = {
  batch_id: string
  course_label: string
  evaluation_ids: string[]
}

type BatchSessionRow = {
  batch_id: string
  teacher_id?: string | null
}

type AnalyticsSkillEntry = { skill_name: string; logro_pct: number }

type AnalyticsSkillsPayload = {
  skills_by_course?: Array<{
    course_label: string
    skills: AnalyticsSkillEntry[]
    status?: "has_low_skills" | "no_low_skills" | "no_pedagogical_data"
  }>
}

function safePercent(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return n
}

function safeCount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function isUnassignedCourseKey(key: string): boolean {
  const x = String(key ?? "").trim()
  const compact = x
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  return compact === "SINCURSO" || x.toLowerCase() === "sin curso"
}

function displayCourseLabel(key: string): string {
  if (isUnassignedCourseKey(key)) return "Sin curso asignado"
  return String(key ?? "").trim() || "Sin curso asignado"
}

function visualNormalizePedagogyLabel(raw: string): string {
  let s = String(raw ?? "").trim().replace(/\s+/g, " ")
  if (!s) return s
  s = s.replace(/([a-záéíóúñ])(informaci[oó]n)\b/gi, "$1 $2")
  s = s.replace(/([a-záéíóúñ])(comprensi[oó]n)\b/gi, "$1 $2")
  s = s.replace(/([a-záéíóúñ])(probabilidad)\b/gi, "$1 $2")
  s = s.replace(/([a-záéíóúñ])(medici[oó]n)\b/gi, "$1 $2")
  s = s.replace(/([a-záéíóúñ])(datos)\b/gi, "$1 $2")
  s = s.replace(/([a-záéíóúññ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2")
  s = s.replace(/\bHa(?=[A-ZÁÉÍÓÚÑ])/g, "")
  s = s.replace(/\s+/g, " ").trim()
  const lower = s.toLowerCase()
  s = lower.length > 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : s
  s = s.replace(/\s+E\s+/g, " e ").replace(/\s+Y\s+/g, " y ").replace(/\s+O\s+/g, " o ")
  return s.replace(/\s+/g, " ").trim()
}

function sortMetricRowsUnassignedCourseLast(rows: MetricRow[]): MetricRow[] {
  return [...rows].sort((a, b) => {
    const da = String(a.dimension ?? "")
    const db = String(b.dimension ?? "")
    const ua = isUnassignedCourseKey(da)
    const ub = isUnassignedCourseKey(db)
    if (ua !== ub) return ua ? 1 : -1
    return da.localeCompare(db, "es")
  })
}

function parseAnalyticsSkills(raw: unknown): AnalyticsSkillsPayload | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const arr = o.skills_by_course
  if (!Array.isArray(arr)) return { skills_by_course: [] }
  const skills_by_course = arr
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const r = x as Record<string, unknown>
      const sk = Array.isArray(r.skills) ? r.skills : []
      const skills: AnalyticsSkillEntry[] = sk
        .filter((s) => s && typeof s === "object")
        .map((s) => {
          const t = s as Record<string, unknown>
          return {
            skill_name: visualNormalizePedagogyLabel(String(t.skill_name ?? "")),
            logro_pct: Number.isFinite(Number(t.logro_pct)) ? Number(t.logro_pct) : 0,
          }
        })
        .filter((s) => s.skill_name.length > 0)
      const statusRaw = String(r.status ?? "").trim()
      let status: "has_low_skills" | "no_low_skills" | "no_pedagogical_data" | undefined
      if (statusRaw === "has_low_skills" || statusRaw === "no_low_skills" || statusRaw === "no_pedagogical_data") {
        status = statusRaw
      }
      return { course_label: String(r.course_label ?? ""), skills, status }
    })
    .filter((r) => r.course_label.length > 0)
  return { skills_by_course }
}

function buildTeacherBatchMaps(
  groups: EvalLotGroup[],
  sessions: BatchSessionRow[],
): {
  tidToCourseEvals: Map<string, Map<string, number>>
  tidToTotal: Map<string, number>
} {
  const sessionByBatch = new Map<string, string>()
  for (const s of sessions) {
    const bid = String(s.batch_id ?? "").trim()
    const tid = String(s.teacher_id ?? "").trim()
    if (bid && tid) sessionByBatch.set(bid, tid)
  }
  const tidToCourseEvals = new Map<string, Map<string, number>>()
  for (const g of groups) {
    const bid = String(g.batch_id ?? "").trim()
    const tid = sessionByBatch.get(bid) ?? ""
    if (!tid) continue
    const course = String(g.course_label ?? "").trim() || "Sin curso"
    const n = Array.isArray(g.evaluation_ids) ? g.evaluation_ids.length : 0
    if (!tidToCourseEvals.has(tid)) tidToCourseEvals.set(tid, new Map())
    const cm = tidToCourseEvals.get(tid)!
    cm.set(course, (cm.get(course) ?? 0) + n)
  }
  const tidToTotal = new Map<string, number>()
  for (const [tid, cm] of tidToCourseEvals) {
    let t = 0
    for (const v of cm.values()) t += v
    tidToTotal.set(tid, t)
  }
  return { tidToCourseEvals, tidToTotal }
}

function resolveReliableTeacherIdFromDimension(
  dimension: string,
  tidToCourseEvals: Map<string, Map<string, number>>,
): string | null {
  const raw = String(dimension ?? "").trim()
  // Solo consideramos vínculo confiable cuando la dimensión ya trae teacher_id explícito.
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
  if (!isUuid) return null
  if (!tidToCourseEvals.has(raw)) return null
  return raw
}

export function UtpByTeacherBlock() {
  const [demo, setDemo] = useState<DemoPayload | null>(null)
  const [demoErr, setDemoErr] = useState<string | null>(null)
  const [tidToCourseEvals, setTidToCourseEvals] = useState<Map<string, Map<string, number>>>(new Map())
  const [analyticsSkillsByCourse, setAnalyticsSkillsByCourse] = useState<Map<string, AnalyticsSkillEntry[]>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setDemoErr(null)
      try {
        const [demoRes, utpRes, batchRes, analyticsRes] = await Promise.all([
          fetch("/api/dashboard/utp/demo-report", { cache: "no-store" }),
          fetch("/api/dashboard/utp", { cache: "no-store" }),
          fetch("/api/dashboard/utp/evaluation-batches", { cache: "no-store" }),
          fetch("/api/dashboard/utp/analytics", { cache: "no-store" }),
        ])
        const demoJson = (await demoRes.json().catch(() => ({}))) as DemoPayload & { error?: string }
        if (cancelled) return
        if (!demoRes.ok) {
          setDemo(null)
          setDemoErr(typeof demoJson.error === "string" ? demoJson.error : "No se pudo cargar el informe demo.")
          setTidToCourseEvals(new Map())
          return
        }
        setDemo(demoJson)

        let groups: EvalLotGroup[] = []
        if (batchRes.ok) {
          const bj = (await batchRes.json()) as { groups?: EvalLotGroup[] }
          groups = Array.isArray(bj?.groups) ? bj.groups : []
        }
        let sessions: BatchSessionRow[] = []
        if (utpRes.ok) {
          const uj = (await utpRes.json()) as { batch_sessions?: BatchSessionRow[] }
          sessions = Array.isArray(uj?.batch_sessions) ? uj.batch_sessions : []
        }
        const { tidToCourseEvals: tcm } = buildTeacherBatchMaps(groups, sessions)
        setTidToCourseEvals(tcm)

        let analyticsJson: unknown = null
        try {
          analyticsJson = await analyticsRes.json()
        } catch {
          analyticsJson = null
        }
        const skillsMap = new Map<string, AnalyticsSkillEntry[]>()
        if (analyticsRes.ok && analyticsJson) {
          const parsed = parseAnalyticsSkills(analyticsJson)
          for (const row of parsed?.skills_by_course ?? []) {
            skillsMap.set(row.course_label, row.skills)
          }
        }
        setAnalyticsSkillsByCourse(skillsMap)
      } catch {
        if (!cancelled) {
          setDemoErr("Error de red al cargar datos.")
          setDemo(null)
          setAnalyticsSkillsByCourse(new Map())
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const teachersAlpha = useMemo(() => {
    const rows = [...(demo?.sections?.by_teacher ?? [])]
    return rows.sort((a, b) => a.dimension.localeCompare(b.dimension, "es"))
  }, [demo])

  const byCourseInst = useMemo(() => {
    const rows = [...(demo?.sections?.by_course ?? [])]
    return sortMetricRowsUnassignedCourseLast(rows)
  }, [demo])

  const hardSkills = useMemo(() => {
    const bySkill = new Map<string, number>()
    for (const courseSkills of analyticsSkillsByCourse.values()) {
      for (const skill of courseSkills) {
        const key = visualNormalizePedagogyLabel(skill.skill_name)
        if (!key) continue
        const current = bySkill.get(key)
        if (current == null || skill.logro_pct < current) bySkill.set(key, skill.logro_pct)
      }
    }
    return [...bySkill.entries()]
      .map(([skill_name, logro_pct]) => ({ skill_name, logro_pct }))
      .sort((a, b) => a.logro_pct - b.logro_pct)
      .slice(0, 5)
  }, [analyticsSkillsByCourse])

  const recommendText = useMemo(() => {
    const parts: string[] = []
    if (hardSkills.length > 0) {
      parts.push(`habilidad(es): ${hardSkills.map((x) => x.skill_name).join(", ")}`)
    }
    if (parts.length === 0) return null
    return `Se recomienda reforzar el trabajo en ${parts.join(" y ")}.`
  }, [hardSkills])

  if (loading) {
    return (
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <p className="text-sm text-[#6B7280]">Cargando análisis por docente…</p>
      </section>
    )
  }

  if (demoErr) {
    return (
      <section className="rounded-2xl border border-[#EF4444]/25 bg-[#FEF2F2] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <p className="text-sm text-[#B91C1C]">{demoErr}</p>
      </section>
    )
  }

  if (!demo || teachersAlpha.length === 0) {
    return (
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h3 className="text-base font-semibold text-[#111827]">Análisis por docente</h3>
        <p className="mt-2 text-sm text-[#6B7280]">No hay docentes con evaluaciones en el alcance del informe demo.</p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)] space-y-6">
      <div>
        <h3 className="text-lg font-semibold tracking-tight text-[#111827]">Análisis por docente</h3>
        <p className="mt-3 text-xs text-[#374151] bg-[#FFFBEB] border border-[#F59E0B]/30 rounded-xl px-4 py-3 leading-relaxed">
          No constituye evaluación docente ni juicio de desempeño. Solo consolida datos de evaluaciones de estudiantes
          para apoyo pedagógico institucional.
        </p>
        <p className="mt-3 text-xs text-[#6B7280] leading-relaxed">
          Los docentes se listan en orden alfabético. No se compara ni clasifica el desempeño entre docentes.
        </p>
      </div>

      <div className="space-y-5">
        {teachersAlpha.map((t) => {
          const tid = resolveReliableTeacherIdFromDimension(t.dimension, tidToCourseEvals)
          const courseMap = tid ? tidToCourseEvals.get(tid) : undefined
          const courseRows = courseMap
            ? [...courseMap.entries()].sort(([a], [b]) => {
                const ua = isUnassignedCourseKey(a)
                const ub = isUnassignedCourseKey(b)
                if (ua !== ub) return ua ? 1 : -1
                return a.localeCompare(b, "es")
              })
            : []
          return (
            <article key={t.dimension} className="rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] p-5 space-y-4">
              <header>
                <h4 className="text-sm font-semibold text-[#111827]">{t.dimension}</h4>
                <p className="text-xs text-[#6B7280] mt-2">
                  Evaluaciones registradas: <span className="font-semibold tabular-nums text-[#111827]">{safeCount(t.evaluation_count)}</span>
                </p>
                <p className="text-xs text-[#6B7280] mt-1">Información referencial para análisis institucional.</p>
              </header>
              <div>
                <p className="text-xs font-semibold text-[#111827] mb-2">Cursos evaluados (por lotes vinculados)</p>
                {courseRows.length === 0 ? (
                  <p className="text-xs text-[#6B7280]">
                    No hay vínculo suficiente para detallar cursos de este docente.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="bg-[#F7F9FB]">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Curso</th>
                          <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">N° evaluaciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courseRows.map(([course, n]) => {
                          return (
                            <tr key={`${t.dimension}-${course}`} className="border-t border-[#E5E7EB]">
                              <td className="px-3 py-2 text-[#111827]">{displayCourseLabel(course)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#374151]">{n}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-[#6B7280] mt-2">
                  Información referencial para análisis institucional.
                </p>
              </div>
            </article>
          )
        })}
      </div>

      <article className="rounded-xl border border-[#E5E7EB] bg-white p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <h4 className="text-sm font-semibold text-[#111827]">Logro por curso (ámbito institucional del informe demo)</h4>
        <p className="text-xs text-[#6B7280] mt-2 mb-3 leading-relaxed">
          Mismo conjunto de evaluaciones que alimenta el informe UTP demo; útil como referencia curricular, sin comparar
          docentes.
        </p>
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
          <table className="min-w-full text-xs">
            <thead className="bg-[#F7F9FB]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Curso</th>
                <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Estado</th>
                <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">Logro %</th>
                <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">N eval.</th>
              </tr>
            </thead>
            <tbody>
              {byCourseInst.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-[#6B7280]">
                    Sin datos por curso.
                  </td>
                </tr>
              ) : (
                byCourseInst.map((row) => {
                  const logroPct = safePercent(row.logro_pct)
                  const st =
                    logroPct >= 70
                      ? "🟢 Adecuado"
                      : logroPct >= 50
                        ? "🟡 En desarrollo"
                        : "🔴 Requiere apoyo"
                  return (
                    <tr key={row.dimension} className="border-t border-[#E5E7EB]">
                      <td className="px-3 py-2 text-[#111827] font-medium">{displayCourseLabel(String(row.dimension))}</td>
                      <td className="px-3 py-2 text-[#374151]">{st}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#111827]">{logroPct.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#6B7280]">
                        {safeCount(row.evaluation_count)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </article>

      {hardSkills.length > 0 ? (
        <article className="rounded-xl border border-[#E5E7EB] border-l-4 border-l-[#10B981] bg-[#F7F9FB] p-5 sm:p-6 space-y-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <h4 className="text-sm font-semibold text-[#111827]">Principales focos institucionales</h4>
          <p className="text-xs text-[#6B7280] leading-relaxed">
            Síntesis derivada de las habilidades por curso de analítica UTP. No reemplaza el análisis específico por curso.
          </p>
          <div>
            <p className="text-xs font-semibold text-[#111827]">Habilidades</p>
            <ul className="list-disc pl-5 text-xs text-[#374151] space-y-1 mt-2">
              {hardSkills.map((x) => (
                <li key={x.skill_name}>
                  {x.skill_name} ({safePercent(x.logro_pct).toFixed(1)}% logro)
                </li>
              ))}
            </ul>
          </div>
          {recommendText ? <p className="text-sm text-[#111827] border-t border-[#E5E7EB] pt-4 mt-2 leading-relaxed">{recommendText}</p> : null}
        </article>
      ) : (
        <p className="text-xs text-[#6B7280]">
          No hay datos pedagógicos suficientes en analítica UTP para esta sección.
        </p>
      )}
    </section>
  )
}
