"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

type TimelinePoint = { month: string; logro_pct: number }

type EvolutionRow = { course_label: string; timeline: TimelinePoint[] }

type SkillRow = { skill_name: string; logro_pct: number }

type SkillsCourseStatus = "has_low_skills" | "no_low_skills" | "no_pedagogical_data"

type SkillsByCourse = { course_label: string; skills: SkillRow[]; status?: SkillsCourseStatus }

type AnalyticsPayload = {
  evolution_by_course: EvolutionRow[]
  skills_by_course: SkillsByCourse[]
  performance_distribution: { lt_50_pct: number; from_50_to_69_pct: number; gte_70_pct: number }
  evaluation_types: { SIMCE: number; PAES: number; Interna: number }
  meta?: {
    evaluations_in_scope?: number
    skills_source?: string
    skills_debug?: {
      evaluations_with_source_exam?: number
      matched_items_count?: number
      skills_groups_count?: number
      courses_with_skills_count?: number
      courses_without_pedagogical_match?: string[]
    }
  }
}

type RechartsModule = typeof import("recharts")

const LINE_COLORS = ["#2563EB", "#10B981"]

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

/** Comparación tolerante curso evolución vs skills (espacios, mayúsculas, tildes). */
function normalizeCourseLabelForMatch(s: string): string {
  return String(s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function findSkillsBlockByCourse(payload: AnalyticsPayload, courseLabel: string): SkillsByCourse | undefined {
  const n = normalizeCourseLabelForMatch(courseLabel)
  return payload.skills_by_course.find((x) => normalizeCourseLabelForMatch(x.course_label) === n)
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

function normalizeAnalyticsPayload(raw: unknown): AnalyticsPayload {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const dist =
    o.performance_distribution && typeof o.performance_distribution === "object"
      ? (o.performance_distribution as Record<string, unknown>)
      : {}
  const types =
    o.evaluation_types && typeof o.evaluation_types === "object" ? (o.evaluation_types as Record<string, unknown>) : {}
  const meta = o.meta && typeof o.meta === "object" ? (o.meta as Record<string, unknown>) : {}

  const evolution_raw = Array.isArray(o.evolution_by_course) ? o.evolution_by_course : []
  const evolution_by_course: EvolutionRow[] = evolution_raw
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const r = x as Record<string, unknown>
      const tl = Array.isArray(r.timeline) ? r.timeline : []
      const timeline: TimelinePoint[] = tl
        .filter((p) => p && typeof p === "object")
        .map((p) => {
          const q = p as Record<string, unknown>
          return {
            month: String(q.month ?? ""),
            logro_pct: Number.isFinite(Number(q.logro_pct)) ? Number(q.logro_pct) : 0,
          }
        })
        .filter((p) => p.month.length > 0)
      return { course_label: String(r.course_label ?? ""), timeline }
    })
    .filter((r) => r.course_label.length > 0)

  const skills_raw = Array.isArray(o.skills_by_course) ? o.skills_by_course : []
  const skills_by_course: SkillsByCourse[] = skills_raw
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const r = x as Record<string, unknown>
      const sk = Array.isArray(r.skills) ? r.skills : []
      const skills: SkillRow[] = sk
        .filter((s) => s && typeof s === "object")
        .map((s) => {
          const t = s as Record<string, unknown>
          const rawLabel = String(
            t.skill_name ??
              t.skill_label ??
              t.dimension ??
              t.label ??
              t.dimension_value ??
              t.title ??
              t.name ??
              t.habilidad ??
              "",
          )
          return {
            skill_name: visualNormalizePedagogyLabel(rawLabel),
            logro_pct: Number.isFinite(Number(t.logro_pct)) ? Number(t.logro_pct) : 0,
          }
        })
        .filter((s) => s.skill_name.length > 0)
      const statusRaw = String(r.status ?? "").trim()
      const status: SkillsCourseStatus | undefined =
        statusRaw === "has_low_skills" || statusRaw === "no_low_skills" || statusRaw === "no_pedagogical_data"
          ? statusRaw
          : undefined
      return { course_label: String(r.course_label ?? ""), skills, status }
    })
    .filter((r) => r.course_label.length > 0)

  return {
    evolution_by_course,
    skills_by_course,
    performance_distribution: {
      lt_50_pct: Number.isFinite(Number(dist.lt_50_pct)) ? Number(dist.lt_50_pct) : 0,
      from_50_to_69_pct: Number.isFinite(Number(dist.from_50_to_69_pct)) ? Number(dist.from_50_to_69_pct) : 0,
      gte_70_pct: Number.isFinite(Number(dist.gte_70_pct)) ? Number(dist.gte_70_pct) : 0,
    },
    evaluation_types: {
      SIMCE: Number.isFinite(Number(types.SIMCE)) ? Number(types.SIMCE) : 0,
      PAES: Number.isFinite(Number(types.PAES)) ? Number(types.PAES) : 0,
      Interna: Number.isFinite(Number(types.Interna)) ? Number(types.Interna) : 0,
    },
    meta: {
      evaluations_in_scope: Number.isFinite(Number(meta.evaluations_in_scope)) ? Number(meta.evaluations_in_scope) : 0,
      skills_source: typeof meta.skills_source === "string" ? meta.skills_source : undefined,
    },
  }
}

function SimpleTimelineFallback(props: {
  lineData: Array<Record<string, string | number | null | undefined>>
  selectedCourses: string[]
}) {
  const { lineData, selectedCourses } = props
  if (lineData.length === 0) {
    return (
      <p className="text-xs text-[#374151] rounded-lg border border-[#E5E7EB] bg-[#F7F9FB] px-3 py-2 leading-relaxed">
        Este curso aún no tiene suficientes evaluaciones con fecha válida
      </p>
    )
  }
  return (
    <div className="space-y-2 text-xs">
      {lineData.map((row) => (
        <div key={String(row.month)} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-[#E5E7EB] pb-1.5">
          <span className="font-medium text-[#111827] w-16 shrink-0">{row.month}</span>
          {selectedCourses.map((c) => (
            <span key={c} className="text-[#6B7280]">
              {displayCourseLabel(c)}:{" "}
              <span className="tabular-nums font-medium">
                {row[c] != null && row[c] !== "" ? `${Number(row[c]).toFixed(1)}%` : "—"}
              </span>
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function SimpleBarPercent(props: { label: string; pct: number; color: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px] text-[#374151]">
        <span>{props.label}</span>
        <span className="tabular-nums">{props.pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-[#F7F9FB] border border-[#E5E7EB]/80 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, props.pct)}%`, backgroundColor: props.color }} />
      </div>
    </div>
  )
}

function SimpleCountBar(props: { label: string; count: number; max: number }) {
  const w = props.max > 0 ? Math.round((props.count / props.max) * 100) : 0
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px] text-[#374151]">
        <span>{props.label}</span>
        <span className="tabular-nums">{props.count}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-[#F7F9FB] border border-[#E5E7EB]/80 overflow-hidden">
        <div className="h-full rounded-full bg-[#6B7280]" style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

export function UtpChartsBlock() {
  const [fetchLoading, setFetchLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null)
  const [selectedCourses, setSelectedCourses] = useState<string[]>([])
  const [rechartsMod, setRechartsMod] = useState<RechartsModule | null | "failed">(null)

  useEffect(() => {
    let cancelled = false
    import("recharts")
      .then((m) => {
        if (!cancelled) setRechartsMod(m)
      })
      .catch(() => {
        if (!cancelled) setRechartsMod("failed")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setFetchLoading(true)
      setFetchError(null)
      try {
        const res = await fetch("/api/dashboard/utp/analytics", { cache: "no-store" })
        let json: unknown = null
        try {
          json = await res.json()
        } catch {
          json = null
        }
        if (cancelled) return
        if (!res.ok) {
          const detail =
            json && typeof json === "object" && "error" in json && typeof (json as { error?: unknown }).error === "string"
              ? (json as { error: string }).error
              : `HTTP ${res.status}`
          setFetchError(detail)
          setPayload(null)
          return
        }
        setPayload(normalizeAnalyticsPayload(json))
      } catch {
        if (!cancelled) {
          setFetchError("Error de red o respuesta inválida.")
          setPayload(null)
        }
      } finally {
        if (!cancelled) setFetchLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const allCourseOptions = useMemo(() => {
    if (!payload) return []
    const u = new Set<string>()
    for (const e of payload.evolution_by_course ?? []) u.add(e.course_label)
    for (const s of payload.skills_by_course ?? []) u.add(s.course_label)
    const arr = [...u]
    const main = arr.filter((c) => !isUnassignedCourseKey(c)).sort((a, b) => a.localeCompare(b, "es"))
    const tail = arr.filter((c) => isUnassignedCourseKey(c)).sort((a, b) => a.localeCompare(b, "es"))
    return [...main, ...tail]
  }, [payload])

  useEffect(() => {
    if (allCourseOptions.length === 0) {
      setSelectedCourses([])
      return
    }
    setSelectedCourses((prev) => {
      const kept = prev.filter((c) => allCourseOptions.includes(c)).slice(0, 2)
      if (kept.length > 0) return kept
      return allCourseOptions.slice(0, Math.min(2, allCourseOptions.length))
    })
  }, [allCourseOptions])

  const toggleCourse = useCallback((course: string) => {
    setSelectedCourses((prev) => {
      if (prev.includes(course)) return prev.filter((c) => c !== course)
      if (prev.length >= 2) return [prev[prev.length - 1]!, course]
      return [...prev, course]
    })
  }, [])

  const lineData = useMemo(() => {
    if (!payload || selectedCourses.length === 0) return []
    const monthSet = new Set<string>()
    for (const c of selectedCourses) {
      const ev = payload.evolution_by_course.find((e) => e.course_label === c)
      ev?.timeline.forEach((t) => monthSet.add(t.month))
    }
    const months = [...monthSet].sort()
    return months.map((month) => {
      const row: Record<string, string | number | null> = { month }
      for (const c of selectedCourses) {
        const ev = payload.evolution_by_course.find((e) => e.course_label === c)
        const pt = ev?.timeline.find((t) => t.month === month)
        row[c] = pt != null ? pt.logro_pct : null
      }
      return row
    })
  }, [payload, selectedCourses])

  /** Curso efectivo para habilidades: primero entre los marcados con filas en skills_by_course (evita quedarse en un curso cuyo array venga vacío). */
  const skillsCourseResolution = useMemo(() => {
    if (!payload || selectedCourses.length === 0) {
      return { courseForSkills: "", block: undefined as SkillsByCourse | undefined, skills: [] as SkillRow[] }
    }
    const withData = selectedCourses.find((c) => {
      const b = findSkillsBlockByCourse(payload, c)
      return (b?.skills?.length ?? 0) > 0
    })
    const courseForSkills =
      withData ??
      selectedCourses.find((c) => findSkillsBlockByCourse(payload, c) != null) ??
      selectedCourses[0] ??
      ""
    const block = courseForSkills ? findSkillsBlockByCourse(payload, courseForSkills) : undefined
    return { courseForSkills, block, skills: block?.skills ?? [] }
  }, [payload, selectedCourses])

  useEffect(() => {
    if (!payload || selectedCourses.length === 0) return
    const { courseForSkills, skills } = skillsCourseResolution
    console.log("skills_by_course:", payload.skills_by_course)
    console.log("curso seleccionado:", courseForSkills)
    console.log("skills del curso:", skills)
  }, [payload, selectedCourses, skillsCourseResolution])

  const skillsBarData = useMemo(() => {
    const skills = skillsCourseResolution.skills
    const seen = new Map<string, number>()
    return skills.map((s) => {
      const truncated = s.skill_name.length > 28 ? `${s.skill_name.slice(0, 28)}…` : s.skill_name
      const n = seen.get(truncated) ?? 0
      seen.set(truncated, n + 1)
      const name = n === 0 ? truncated : `${truncated} (${n + 1})`
      const v = Number.isFinite(s.logro_pct) ? s.logro_pct : 0
      return {
        name,
        fullName: s.skill_name,
        logro_pct: v,
        value: v,
      }
    })
  }, [skillsCourseResolution.skills])

  const skillsEmptyReason = useMemo(() => {
    if (!payload || selectedCourses.length === 0) return null
    const { block, skills } = skillsCourseResolution
    if (!block || block.status === "no_pedagogical_data") return "no_pedagogical_data"
    if (skills.length === 0 && block.status === "no_low_skills") return "no_low_skills"
    return null
  }, [payload, selectedCourses, skillsCourseResolution])

  const pieData = useMemo(() => {
    if (!payload) return []
    const d = payload.performance_distribution
    return [
      { name: "Menor a 50%", value: d.lt_50_pct, fill: "#EF4444" },
      { name: "50% a 69%", value: d.from_50_to_69_pct, fill: "#F59E0B" },
      { name: "70% o más", value: d.gte_70_pct, fill: "#10B981" },
    ].filter((x) => x.value > 0)
  }, [payload])

  const performanceNarrative = useMemo(() => {
    if (!payload) return null
    const d = payload.performance_distribution
    return {
      apoyo: d.lt_50_pct.toFixed(1),
      desarrollo: d.from_50_to_69_pct.toFixed(1),
      adecuado: d.gte_70_pct.toFixed(1),
    }
  }, [payload])

  const typeBarData = useMemo(() => {
    if (!payload) return []
    const t = payload.evaluation_types
    return [
      { tipo: "SIMCE", cantidad: t.SIMCE },
      { tipo: "PAES", cantidad: t.PAES },
      { tipo: "Interna", cantidad: t.Interna },
    ]
  }, [payload])

  const typeMax = useMemo(() => Math.max(1, ...typeBarData.map((x) => x.cantidad)), [typeBarData])

  const hasEvolution = lineData.length > 0
  const nEvals = payload?.meta?.evaluations_in_scope ?? 0
  const waitingForChartLib = Boolean(payload && nEvals > 0 && rechartsMod === null)
  const showLoadingLine = fetchLoading || waitingForChartLib
  const useRecharts = rechartsMod !== null && rechartsMod !== "failed"

  const RC = useRecharts ? rechartsMod : null

  return (
    <section
      id="utp-charts-block"
      className="rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-[0_4px_24px_rgba(17,24,39,0.06)] space-y-6 min-h-[120px] w-full min-w-0"
    >
      <div>
        <h3 className="text-lg sm:text-xl font-semibold tracking-tight text-[#111827]">Gráficos de evolución y distribución</h3>
        <p className="text-xs text-[#374151] mt-3 rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] px-4 py-3 leading-relaxed">
          Los gráficos muestran la evolución de los resultados de aprendizaje en el tiempo.
        </p>
        <p className="text-xs text-[#6B7280] mt-2">
          Solo lectura
          {payload ? (
            <>
              {" "}
              · Evaluaciones en alcance: <span className="font-semibold text-[#111827] tabular-nums">{nEvals}</span>
              {payload.meta?.skills_source ? (
                <>
                  {" "}
                  · Habilidades: <span className="font-medium text-[#111827]">{payload.meta.skills_source}</span>
                </>
              ) : null}
            </>
          ) : null}
        </p>
      </div>

      {fetchError ? (
        <p className="text-sm text-[#B91C1C] rounded-xl border border-[#EF4444]/25 bg-[#FEF2F2] px-4 py-3">
          No se pudieron cargar los gráficos UTP.{fetchError.trim() ? ` (${fetchError})` : ""}
        </p>
      ) : null}

      {showLoadingLine && !fetchError ? <p className="text-sm text-[#6B7280]">Cargando gráficos…</p> : null}

      {!fetchLoading && !fetchError && payload && nEvals === 0 ? (
        <p className="text-sm text-[#6B7280] rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] px-4 py-3">
          No hay datos suficientes para gráficos UTP.
        </p>
      ) : null}

      {!fetchLoading && !fetchError && payload && nEvals > 0 && rechartsMod === "failed" ? (
        <p className="text-xs text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/30 rounded-xl px-4 py-3">
          La librería de gráficos no está disponible; se muestra una vista simplificada.
        </p>
      ) : null}

      {!fetchLoading && !fetchError && payload && nEvals > 0 && rechartsMod !== null ? (
        <>
          {allCourseOptions.length > 0 ? (
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] p-4">
              <p className="text-xs font-semibold text-[#111827] mb-3">Cursos en el gráfico (máx. 2)</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {allCourseOptions.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-xs text-[#374151] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCourses.includes(c)}
                      onChange={() => toggleCourse(c)}
                      className="rounded border-[#E5E7EB] text-[#111827]"
                    />
                    <span className="text-[#111827]">{displayCourseLabel(c)}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#374151] rounded-lg border border-[#E5E7EB] bg-[#F7F9FB] px-3 py-2 leading-relaxed">
              Aún no hay evolución en el tiempo: se necesitan evaluaciones con fecha válida por curso.
            </p>
          )}

          <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F9FB]/50 p-4 sm:p-5">
          <div className="grid gap-6 lg:grid-cols-2 w-full min-w-0">
            <article className="rounded-xl border border-[#E5E7EB] bg-white p-4 sm:p-5 min-w-0 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <h4 className="text-sm font-semibold text-[#111827] mb-3">Evolución por curso (logro % mensual)</h4>
              {!hasEvolution ? (
                <p className="text-xs text-[#374151] rounded-lg border border-[#E5E7EB] bg-[#F7F9FB] px-3 py-2 leading-relaxed">
                  Este curso aún no tiene suficientes evaluaciones con fecha válida
                </p>
              ) : useRecharts && RC ? (
                <div className="h-[280px] w-full min-h-[280px] min-w-0">
                  <RC.ResponsiveContainer width="100%" height="100%">
                    <RC.LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <RC.CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                      <RC.XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <RC.YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={32} />
                      <RC.Tooltip
                        formatter={(value: number | string | undefined) => [
                          `${value != null && value !== "" ? Number(value).toFixed(1) : "—"}%`,
                          "Logro",
                        ]}
                      />
                      <RC.Legend wrapperStyle={{ fontSize: 12 }} />
                      {selectedCourses.map((c, i) => (
                        <RC.Line
                          key={c}
                          type="monotone"
                          dataKey={c}
                          name={displayCourseLabel(c)}
                          stroke={LINE_COLORS[i % LINE_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </RC.LineChart>
                  </RC.ResponsiveContainer>
                </div>
              ) : (
                <SimpleTimelineFallback lineData={lineData} selectedCourses={selectedCourses} />
              )}
              <p className="text-[11px] text-[#6B7280] mt-3 leading-relaxed">
                Cada punto agrupa el logro de las evaluaciones del curso en ese mes: Σ puntaje obtenido / Σ puntaje máximo.
              </p>
            </article>

            <article className="rounded-xl border border-[#E5E7EB] bg-white p-4 sm:p-5 min-w-0 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <h4 className="text-sm font-semibold text-[#111827] mb-3">Habilidades con menor logro (curso seleccionado)</h4>
              {skillsCourseResolution.courseForSkills ? (
                <p className="text-[11px] text-[#6B7280] mb-2">
                  Curso del gráfico:{" "}
                  <span className="font-medium text-[#111827]">
                    {displayCourseLabel(skillsCourseResolution.courseForSkills)}
                  </span>
                </p>
              ) : null}
              {skillsBarData.length === 0 ? (
                <p className="text-xs text-[#374151] rounded-lg border border-[#E5E7EB] bg-[#F7F9FB] px-3 py-2 leading-relaxed">
                  {skillsEmptyReason === "no_low_skills"
                    ? "No hay habilidades bajo 70% en el curso mostrado (según datos recibidos)."
                    : "No hay datos pedagógicos"}
                </p>
              ) : useRecharts && RC ? (
                <>
                  <div className="h-[280px] w-full min-h-[280px] min-w-0">
                    <RC.ResponsiveContainer width="100%" height="100%">
                      <RC.BarChart data={skillsBarData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                        <RC.CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                        <RC.XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                        <RC.YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                        <RC.Tooltip
                          formatter={(value: number | string | undefined, _n, p) => {
                            const full = (p?.payload as { fullName?: string } | undefined)?.fullName
                            const n = value != null && value !== "" ? Number(value) : NaN
                            return [`${Number.isFinite(n) ? n.toFixed(1) : "—"}%`, full ?? "Logro"]
                          }}
                        />
                        <RC.Bar dataKey="value" name="Logro %" fill="#4F46E5" radius={[0, 4, 4, 0]} />
                      </RC.BarChart>
                    </RC.ResponsiveContainer>
                  </div>
                  <ul className="mt-3 pt-3 border-t border-[#E5E7EB] text-[11px] text-[#374151] space-y-1.5 list-none">
                    {skillsBarData.map((row, i) => (
                      <li key={`${row.fullName}-${i}`}>
                        <span className="font-medium text-[#111827]">{row.fullName}</span>
                        <span className="text-[#6B7280]"> — </span>
                        <span className="tabular-nums">{row.logro_pct.toFixed(1)}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="space-y-2">
                  {skillsBarData.map((s, i) => (
                    <SimpleBarPercent key={`${s.fullName}-${i}`} label={s.fullName} pct={s.logro_pct} color="#4F46E5" />
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-xl border border-[#E5E7EB] bg-white p-4 sm:p-5 min-w-0 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <h4 className="text-sm font-semibold text-[#111827] mb-3">Distribución de desempeño (evaluaciones)</h4>
              {pieData.length === 0 ? (
                <p className="text-xs text-[#6B7280] py-8">Sin datos para la distribución.</p>
              ) : useRecharts && RC ? (
                <div className="h-[280px] w-full min-h-[280px] min-w-0">
                  <RC.ResponsiveContainer width="100%" height="100%">
                    <RC.PieChart>
                      <RC.Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {pieData.map((entry, index) => (
                          <RC.Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </RC.Pie>
                      <RC.Tooltip
                        formatter={(v: number | string | undefined) =>
                          `${v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—"}%`
                        }
                      />
                      <RC.Legend wrapperStyle={{ fontSize: 12 }} />
                    </RC.PieChart>
                  </RC.ResponsiveContainer>
                </div>
              ) : (
                <div className="space-y-3 py-2">
                  {pieData.map((p) => (
                    <SimpleBarPercent key={p.name} label={p.name} pct={p.value} color={p.fill} />
                  ))}
                </div>
              )}
              <p className="text-[11px] text-[#6B7280] mt-3">Porcentaje del total de evaluaciones en alcance, por franja de logro.</p>
              {performanceNarrative && nEvals > 0 ? (
                <div className="text-xs text-[#374151] mt-4 space-y-2 border-t border-[#E5E7EB] pt-3">
                  <p>
                    <span className="font-medium tabular-nums">{performanceNarrative.apoyo}%</span> de evaluaciones
                    requiere apoyo.
                  </p>
                  <p>
                    <span className="font-medium tabular-nums">{performanceNarrative.desarrollo}%</span> se encuentra en
                    desarrollo.
                  </p>
                  <p>
                    <span className="font-medium tabular-nums">{performanceNarrative.adecuado}%</span> presenta logro
                    adecuado.
                  </p>
                </div>
              ) : null}
            </article>

            <article className="rounded-xl border border-[#E5E7EB] bg-white p-4 sm:p-5 min-w-0 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <h4 className="text-sm font-semibold text-[#111827] mb-3">Tipo de evaluación (conteo)</h4>
              {useRecharts && RC ? (
                <div className="h-[280px] w-full min-h-[280px] min-w-0">
                  <RC.ResponsiveContainer width="100%" height="100%">
                    <RC.BarChart data={typeBarData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <RC.CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                      <RC.XAxis dataKey="tipo" tick={{ fontSize: 11 }} />
                      <RC.YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                      <RC.Tooltip />
                      <RC.Bar dataKey="cantidad" name="Evaluaciones" fill="#6B7280" radius={[4, 4, 0, 0]} />
                    </RC.BarChart>
                  </RC.ResponsiveContainer>
                </div>
              ) : (
                <div className="space-y-3 py-2">
                  {typeBarData.map((t) => (
                    <SimpleCountBar key={t.tipo} label={t.tipo} count={t.cantidad} max={typeMax} />
                  ))}
                </div>
              )}
              <p className="text-[11px] text-[#6B7280] mt-3">Clasificación según etiquetas de la evaluación (SIMCE / PAES / otras).</p>
            </article>
          </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
