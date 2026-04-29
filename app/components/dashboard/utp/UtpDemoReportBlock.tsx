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
    by_subject?: MetricRow[]
    by_teacher?: MetricRow[]
    by_axis?: MetricRow[]
    by_skill?: MetricRow[]
  }
  meta?: {
    evaluations_in_scope?: number
    pedagogical_evaluation_count?: number
    pedagogical_coverage_pct?: number
    has_pedagogical_data?: boolean
  }
}

type AnalyticsSkillEntry = { skill_name: string; logro_pct: number }

type AnalyticsSkillsPayload = {
  skills_by_course?: Array<{
    course_label: string
    skills: AnalyticsSkillEntry[]
    status?: "has_low_skills" | "no_low_skills" | "no_pedagogical_data"
  }>
}

type VisualStatus = {
  emoji: "🟢" | "🟡" | "🔴"
  label: "Adecuado" | "En desarrollo" | "Requiere apoyo"
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

/** Texto de dimensión para tablas: trim, sin null; vacío → Sin dato. */
function dimensionLabel(value: unknown): string {
  const s = String(value ?? "").trim()
  return s || "Sin dato"
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

/** Solo presentación (alineado con analítica UTP). */
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

/** Umbral solo UX: aviso de muestra pequeña sin cambiar cómo se calculan los promedios. */
const LIMITED_INFO_MAX_EXCLUSIVE = 4

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

function statusFromLogro(logroPct: number): VisualStatus {
  if (logroPct >= 70) return { emoji: "🟢", label: "Adecuado" }
  if (logroPct >= 50) return { emoji: "🟡", label: "En desarrollo" }
  return { emoji: "🔴", label: "Requiere apoyo" }
}

function courseAchievementText(logroPct: number): string {
  if (logroPct < 50) return "El curso presenta un nivel de logro bajo en las evaluaciones aplicadas."
  if (logroPct < 70) return "El curso presenta un nivel de logro en desarrollo en las evaluaciones aplicadas."
  return "El curso presenta un nivel de logro adecuado en las evaluaciones aplicadas."
}

function TableBlock(props: {
  title: string
  rows: MetricRow[]
  formatDimension?: (value: unknown) => string
}) {
  const { title, rows, formatDimension } = props
  const fmtDim = formatDimension ?? dimensionLabel
  const showCoverageColumn = rows.some((r) => safePercent(r.coverage_pct) > 0)
  const colCount = showCoverageColumn ? 5 : 4
  return (
    <article className="rounded-xl border border-[#E5E7EB] bg-white p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <h4 className="text-sm font-semibold text-[#111827]">{title}</h4>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-[#F7F9FB] border-b border-[#E5E7EB]">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Dimensión</th>
              <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Semáforo</th>
              <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">Logro %</th>
              <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">N evaluaciones</th>
              {showCoverageColumn ? (
                <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">Cobertura</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="border-t border-[#E5E7EB]">
                <td colSpan={colCount} className="px-3 py-3 text-[#6B7280]">
                  Sin datos
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const logroPct = safePercent(row.logro_pct)
                const status = statusFromLogro(logroPct)
                const evalCount = safeCount(row.evaluation_count)
                const coveragePct = safePercent(row.coverage_pct)
                return (
                  <tr key={`${row.dimension}-${idx}`} className="border-t border-[#E5E7EB]/80 hover:bg-[#F7F9FB]/80">
                    <td className="px-3 py-2 text-[#111827]">{fmtDim(row.dimension)}</td>
                    <td className="px-3 py-2 text-[#374151]">
                      {status.emoji} {status.label}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#111827] font-medium">
                      {logroPct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#374151]">{evalCount}</td>
                    {showCoverageColumn ? (
                      <td className="px-3 py-2 text-right tabular-nums text-[#6B7280]">
                        {coveragePct > 0 ? `${coveragePct.toFixed(1)}%` : "Sin cobertura calculada"}
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {!showCoverageColumn && rows.length > 0 ? (
        <p className="text-[11px] text-[#6B7280] mt-3">Cobertura pedagógica no mostrada: no hay valores confiables en este informe.</p>
      ) : null}
    </article>
  )
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

type AnalyticsCoursePedagogy = {
  status: "has_low_skills" | "no_low_skills" | "no_pedagogical_data"
  lowSkills: AnalyticsSkillEntry[]
}

type CourseAnalysisRow = {
  courseKey: string
  logroPct: number
  hasLogro: boolean
}

export function UtpDemoReportBlock() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<DemoPayload | null>(null)
  const [coursePedagogyFromAnalytics, setCoursePedagogyFromAnalytics] = useState<Map<string, AnalyticsCoursePedagogy>>(
    () => new Map(),
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [demoRes, analyticsRes] = await Promise.all([
          fetch("/api/dashboard/utp/demo-report", { cache: "no-store" }),
          fetch("/api/dashboard/utp/analytics", { cache: "no-store" }),
        ])
        const demoJson = (await demoRes.json()) as DemoPayload & { error?: string }
        let analyticsJson: unknown = null
        try {
          analyticsJson = await analyticsRes.json()
        } catch {
          analyticsJson = null
        }
        if (cancelled) return
        if (!demoRes.ok) {
          setError(demoJson?.error ?? "No se pudo cargar informe demo.")
          setPayload(null)
          setCoursePedagogyFromAnalytics(new Map())
          return
        }
        setPayload(demoJson)

        const map = new Map<string, AnalyticsCoursePedagogy>()
        if (analyticsRes.ok && analyticsJson) {
          const parsed = parseAnalyticsSkills(analyticsJson)
          for (const row of parsed?.skills_by_course ?? []) {
            const top = [...row.skills]
              .filter((s) => s.logro_pct < 70)
              .sort((a, b) => a.logro_pct - b.logro_pct)
              .slice(0, 3)
            const status = row.status ?? (row.skills.length > 0 ? "no_low_skills" : "no_pedagogical_data")
            map.set(row.course_label, { status, lowSkills: top })
          }
        }
        setCoursePedagogyFromAnalytics(map)
      } catch {
        if (!cancelled) {
          setError("No se pudo cargar informe demo.")
          setPayload(null)
          setCoursePedagogyFromAnalytics(new Map())
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

  const courseRows = useMemo(() => payload?.sections?.by_course ?? [], [payload])
  const subjectRows = useMemo(() => payload?.sections?.by_subject ?? [], [payload])
  const teacherRows = useMemo(() => payload?.sections?.by_teacher ?? [], [payload])
  const axisRows = useMemo(() => payload?.sections?.by_axis ?? [], [payload])
  const skillRows = useMemo(() => payload?.sections?.by_skill ?? [], [payload])
  const hasPedagogy = Boolean(payload?.meta?.has_pedagogical_data)
  const logroByCourse = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of courseRows) {
      const key = String(row.dimension ?? "").trim()
      if (!key) continue
      map.set(key, safePercent(row.logro_pct))
    }
    return map
  }, [courseRows])
  const evalCountByCourse = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of courseRows) {
      const key = String(row.dimension ?? "").trim()
      if (!key) continue
      map.set(key, safeCount(row.evaluation_count))
    }
    return map
  }, [courseRows])
  const evaluationsInScope = safeCount(payload?.meta?.evaluations_in_scope)
  const courseAnalysisRows = useMemo<CourseAnalysisRow[]>(() => {
    const keys = [...coursePedagogyFromAnalytics.keys()]
    const main = keys.filter((k) => !isUnassignedCourseKey(k)).sort((a, b) => a.localeCompare(b, "es"))
    const unassigned = keys.filter((k) => isUnassignedCourseKey(k)).sort((a, b) => a.localeCompare(b, "es"))
    return [...main, ...unassigned].map((courseKey) => {
      const logro = logroByCourse.get(courseKey)
      return {
        courseKey,
        logroPct: logro ?? 0,
        hasLogro: typeof logro === "number",
      }
    })
  }, [coursePedagogyFromAnalytics, logroByCourse])
  const { rankingMainRows, rankingUnassignedRows, displayedRankingRows } = useMemo(() => {
    const base = [...courseRows]
      .filter((r) => String(r.dimension ?? "").trim() !== "")
      .map((r) => ({
        ...r,
        logro_pct: safePercent(r.logro_pct),
        evaluation_count: safeCount(r.evaluation_count),
      }))
      .sort((a, b) => safePercent(b.logro_pct) - safePercent(a.logro_pct))

    const main = base.filter((r) => !isUnassignedCourseKey(String(r.dimension))).slice(0, 10)
    const unassigned = base.filter((r) => isUnassignedCourseKey(String(r.dimension)))
    return {
      rankingMainRows: main,
      rankingUnassignedRows: unassigned,
      displayedRankingRows: [...main, ...unassigned],
    }
  }, [courseRows])
  const criticalCoursesCount = useMemo(() => {
    let count = 0
    for (const entry of coursePedagogyFromAnalytics.values()) {
      if (entry.status === "has_low_skills") count += 1
    }
    return count
  }, [coursePedagogyFromAnalytics])

  return (
    <section className="rounded-2xl border-2 border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-[0_4px_24px_rgba(17,24,39,0.06)] space-y-5">
      <div>
        <h3 className="text-lg sm:text-xl font-semibold tracking-tight text-[#111827]">Informe UTP DEMO</h3>
        <p className="text-xs text-[#374151] mt-3 rounded-xl border border-[#10B981]/25 bg-[#ECFDF5]/40 px-4 py-3 leading-relaxed">
          Los resultados reflejan el desempeño de los estudiantes en las evaluaciones aplicadas y tienen como propósito apoyar
          la toma de decisiones pedagógicas.
        </p>
        <p className="text-xs text-[#6B7280] mt-2">
          Base principal: evaluations + evaluation_items. Pedagógico (eje/habilidad) solo si existe.
          {payload ? (
            <>
              {" "}
              · <span className="font-semibold text-[#111827]">Evaluaciones: {evaluationsInScope}</span>
            </>
          ) : null}
        </p>
      </div>

      <p className="text-xs text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/30 rounded-xl px-4 py-3 leading-relaxed">
        Los resultados por eje y habilidad dependen de evaluaciones con estructura pedagógica completa
      </p>
      <p className="text-xs text-[#374151] bg-[#F7F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3 leading-relaxed">
        Semáforo de logro: 🟢 Adecuado (≥70%) · 🟡 En desarrollo (50–69%) · 🔴 Requiere apoyo (&lt;50%)
      </p>

      {loading ? <p className="text-sm text-[#6B7280]">Cargando informe demo…</p> : null}
      {error ? <p className="text-sm text-[#B91C1C]">{error}</p> : null}

      {!loading && !error ? (
        <>
          <article className="rounded-xl border border-[#E5E7EB] bg-[#F7F9FB]/60 p-4 sm:p-5 space-y-4">
            <h4 className="text-sm font-semibold text-[#111827]">Ranking por curso (Top 10)</h4>
            <p className="text-xs text-[#374151] rounded-lg border border-[#E5E7EB] bg-[#F7F9FB] px-3 py-2 leading-relaxed mt-2">
              Se muestran los 10 cursos con mayor logro. Algunos cursos pueden no aparecer.
            </p>
            {displayedRankingRows.length === 0 ? (
              <p className="text-sm text-[#6B7280] mt-2">Sin datos suficientes para ranking de cursos.</p>
            ) : (
              <div className="mt-3 space-y-5">
                <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white p-3">
                  <p className="text-[11px] font-semibold text-[#6B7280] mb-2 uppercase tracking-wide">Cursos con etiqueta</p>
                  <table className="min-w-full text-xs">
                    <thead className="bg-[#F7F9FB]">
                      <tr>
                        <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">#</th>
                        <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Curso</th>
                        <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">Logro %</th>
                        <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Estado</th>
                        <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">N evaluaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankingMainRows.length === 0 ? (
                        <tr className="border-t border-[#E5E7EB]">
                          <td colSpan={5} className="px-3 py-3 text-[#6B7280]">
                            Sin cursos con etiqueta en el ranking.
                          </td>
                        </tr>
                      ) : (
                        rankingMainRows.map((row, idx) => {
                          const logroPct = safePercent(row.logro_pct)
                          const status = statusFromLogro(logroPct)
                          return (
                            <tr key={`main-${row.dimension}-${idx}`} className="border-t border-[#E5E7EB]/80">
                              <td className="px-3 py-2 text-right tabular-nums text-[#6B7280]">{idx + 1}</td>
                              <td className="px-3 py-2 text-[#111827] font-medium">{displayCourseLabel(String(row.dimension))}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#111827]">{logroPct.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-[#374151]">
                                {status.emoji} {status.label}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#374151]">
                                {safeCount(row.evaluation_count)}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {rankingUnassignedRows.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-dashed border-[#E5E7EB] bg-white p-3">
                    <p className="text-[11px] font-semibold text-[#6B7280] mb-2 uppercase tracking-wide">Registros sin curso asignado</p>
                    <table className="min-w-full text-xs">
                      <thead className="bg-[#F7F9FB]">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Curso</th>
                          <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">Logro %</th>
                          <th className="px-3 py-2 text-left font-semibold text-[#6B7280]">Estado</th>
                          <th className="px-3 py-2 text-right font-semibold text-[#6B7280]">N evaluaciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankingUnassignedRows.map((row, idx) => {
                          const logroPct = safePercent(row.logro_pct)
                          const status = statusFromLogro(logroPct)
                          return (
                            <tr key={`un-${row.dimension}-${idx}`} className="border-t border-[#E5E7EB]">
                              <td className="px-3 py-2 text-[#111827]">{displayCourseLabel(String(row.dimension))}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#111827]">{logroPct.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-[#374151]">
                                {status.emoji} {status.label}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#374151]">
                                {safeCount(row.evaluation_count)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            )}
            <p className="text-xs text-[#6B7280] mt-3">
              {criticalCoursesCount > 0
                ? `Cursos que requieren apoyo: ${criticalCoursesCount}`
                : "No hay cursos que requieran apoyo según los datos disponibles"}
            </p>
            {courseAnalysisRows.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {courseAnalysisRows.map((row, idx) => {
                  const courseKey = row.courseKey
                  const logroPct = row.logroPct
                  const pedagogy = coursePedagogyFromAnalytics.get(courseKey)
                  const courseDifficulties = pedagogy?.lowSkills ?? []
                  const hasCourseDifficulties = courseDifficulties.length > 0
                  const hasPedagogicalDataForCourse = pedagogy?.status !== "no_pedagogical_data"
                  const isUnassigned = isUnassignedCourseKey(courseKey)
                  const nEvalCourse = evalCountByCourse.get(courseKey) ?? 0
                  const limitedInfo = nEvalCourse < LIMITED_INFO_MAX_EXCLUSIVE
                  return (
                    <div key={`analysis-${courseKey}-${idx}`} className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      {limitedInfo ? (
                        <p className="text-[11px] text-[#374151] rounded-lg border border-[#E5E7EB] bg-[#F7F9FB] px-2.5 py-1.5 mb-2 leading-relaxed">
                          Información limitada (menos de {LIMITED_INFO_MAX_EXCLUSIVE} evaluaciones)
                        </p>
                      ) : null}
                      <p className="text-xs text-[#111827] leading-relaxed">
                        <span className="font-semibold">{displayCourseLabel(courseKey)}:</span>{" "}
                        {row.hasLogro
                          ? courseAchievementText(logroPct)
                          : "Hay datos pedagógicos para este curso, pero no hay logro general disponible en el informe demo."}
                      </p>
                      {hasCourseDifficulties ? (
                        <p className="text-xs text-[#374151] mt-2 leading-relaxed">
                          Las principales dificultades de aprendizaje se observan en:{" "}
                          {courseDifficulties.map((s) => s.skill_name).join(", ")}.
                        </p>
                      ) : (
                        <p className="text-xs text-[#6B7280] mt-2 leading-relaxed">
                          {hasPedagogicalDataForCourse
                            ? "No se observan dificultades pedagógicas prioritarias para este curso."
                            : isUnassigned
                              ? "No hay datos pedagógicos suficientes para registros sin curso asignado."
                              : "No hay datos pedagógicos suficientes para este curso."}
                        </p>
                      )}
                      {hasCourseDifficulties ? (
                        <p className="text-xs text-[#374151] mt-2 leading-relaxed">
                          Se recomienda reforzar actividades asociadas a estas habilidades en el curso.
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </article>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TableBlock
              title="1) Promedio por curso"
              rows={sortMetricRowsUnassignedCourseLast(courseRows)}
              formatDimension={(v) => displayCourseLabel(String(v ?? ""))}
            />
            <TableBlock title="2) Promedio por asignatura" rows={subjectRows} />
            <TableBlock title="3) Promedio por docente" rows={teacherRows} />
          </div>

          {hasPedagogy ? (
            <div className="grid gap-4 md:grid-cols-2">
              <TableBlock title="4) Promedio por eje" rows={axisRows} formatDimension={(v) => visualNormalizePedagogyLabel(String(v ?? ""))} />
              <TableBlock
                title="5) Promedio por habilidad"
                rows={skillRows}
                formatDimension={(v) => visualNormalizePedagogyLabel(String(v ?? ""))}
              />
            </div>
          ) : (
            <p className="text-sm text-[#6B7280] border border-[#E5E7EB] rounded-xl px-4 py-3 bg-[#F7F9FB]">
              Sin datos pedagógicos suficientes
            </p>
          )}
        </>
      ) : null}
    </section>
  )
}
