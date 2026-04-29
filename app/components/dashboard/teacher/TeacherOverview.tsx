"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

type Semaphore = "green" | "yellow" | "red" | "neutral"

/** Campos opcionales: si la API los envía, se muestran; no se inventan valores. */
type OverviewAlert = {
  level: "info" | "warning" | "critical"
  code: string
  message: string
  confidence: number
  course_label?: string
  axis_label?: string
  logro_pct?: number | null
  by_skill?: Array<{ skill_label?: string; logro_pct?: number | null }>
  trend?: "up" | "flat" | "down"
}

type OverviewJson = {
  error?: string
  has_teacher_id?: boolean
  has_school_id?: boolean
  global?: {
    logro_pct: number | null
    semaphore: Semaphore
    total_evaluations: number
  }
  comparison?: {
    teacher_logro_pct: number | null
    school_logro_pct: number | null
    diff_pct: number | null
  }
  comparison_semaphore?: "superior" | "similar" | "below" | "neutral"
  by_course?: Array<{
    course_label: string
    logro_pct: number | null
    eval_count: number
    semaphore: Semaphore
  }>
  by_subject?: Array<{
    subject_label: string
    logro_pct: number | null
    eval_count: number
  }>
  by_test_type?: Array<{
    key: "SIMCE" | "PAES" | "Interna"
    count: number
    share_pct: number
  }>
  by_test_type_course?: {
    SIMCE: Array<{ course_label: string; logro_pct: number | null; evaluation_count: number }>
    PAES: Array<{ course_label: string; logro_pct: number | null; evaluation_count: number }>
    Interna: Array<{ course_label: string; logro_pct: number | null; evaluation_count: number }>
  }
  score_by_test_type_course?: {
    PAES: Array<{
      course_label: string
      avg_score: number | null
      min_score: number | null
      max_score: number | null
      evaluation_count: number
      standardized_score_available: boolean
    }>
    SIMCE: Array<{
      course_label: string
      avg_score: number | null
      evaluation_count: number
      standardized_score_available: boolean
    }>
    Interna: Array<{ course_label: string; avg_score: number; evaluation_count: number }>
  }
  insights?: string[]
  alerts?: OverviewAlert[]
  coverage?: { note?: string }
  truncated?: boolean
}

function semaphoreMeta(s: Semaphore): { emoji: string; label: string; bar: string } {
  switch (s) {
    case "green":
      return { emoji: "🟢", label: "Adecuado", bar: "bg-[#10B981]" }
    case "yellow":
      return { emoji: "🟡", label: "En desarrollo", bar: "bg-[#F59E0B]" }
    case "red":
      return { emoji: "🔴", label: "Requiere apoyo", bar: "bg-[#EF4444]" }
    default:
      return { emoji: "⚪", label: "Sin información suficiente", bar: "bg-[#E5E7EB]" }
  }
}

function formatPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(Number(p))) return "Sin información suficiente"
  return `${Number(p).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`
}

function comparisonMeta(kind: OverviewJson["comparison_semaphore"]): { emoji: string; text: string; color: string } {
  if (kind === "superior") {
    return { emoji: "🟢", text: "Se observa un desempeño por sobre el promedio del establecimiento", color: "text-[#047857]" }
  }
  if (kind === "below") {
    return {
      emoji: "🔴",
      text: "Se observa una diferencia respecto al promedio del establecimiento",
      color: "text-[#B91C1C]",
    }
  }
  if (kind === "similar") {
    return { emoji: "🟡", text: "Se observa un desempeño similar al promedio del establecimiento", color: "text-[#B45309]" }
  }
  return { emoji: "⚪", text: "Sin información suficiente para comparación institucional", color: "text-[#6B7280]" }
}

function courseLabelForDisplay(label: string): string {
  const t = String(label ?? "").trim().toLowerCase()
  if (t === "sin curso" || t === "sincurso" || !t) return "Sin curso asignado"
  return label
}

function isUnassignedCourseLabel(label: string): boolean {
  const t = String(label ?? "").trim().toLowerCase()
  return t === "sin curso" || t === "sincurso" || !t
}

function parseCourseFromLowScoreMessage(message: string): string | null {
  const m = String(message).match(/El curso\s+(.+?)\s+presenta puntajes bajos/i)
  return m?.[1]?.trim() ?? null
}

function testTypeFromAlertCode(code: string): "PAES" | "SIMCE" | null {
  if (code === "LOW_SCORE_PAES") return "PAES"
  if (code === "LOW_SCORE_SIMCE") return "SIMCE"
  return null
}

function trendPresentation(trend: OverviewAlert["trend"]): { icon: string; label: string } | null {
  if (trend === "up") return { icon: "↑", label: "mejora" }
  if (trend === "flat") return { icon: "→", label: "se mantiene" }
  if (trend === "down") return { icon: "↓", label: "en descenso" }
  return null
}

/** Texto compacto para “Lectura y acción” (solo copia de UI). */
function trendPhraseLectura(trend: OverviewAlert["trend"]): string | null {
  if (trend === "up") return "↑ mejora"
  if (trend === "flat") return "→ se mantiene"
  if (trend === "down") return "↓ en descenso"
  return null
}

function resolveAlertCourseKey(a: OverviewAlert): string | null {
  const raw = a.course_label?.trim()
  if (raw) return raw
  return parseCourseFromLowScoreMessage(a.message)
}

function logroPctForAlertDisplay(a: OverviewAlert, byTtc: OverviewJson["by_test_type_course"] | undefined, courseKey: string | null): number | null {
  if (a.logro_pct != null && Number.isFinite(Number(a.logro_pct))) return Number(a.logro_pct)
  if (!courseKey || !byTtc) return null
  const kind = testTypeFromAlertCode(a.code)
  if (!kind) return null
  const row = byTtc[kind]?.find((r) => r.course_label === courseKey)
  return row?.logro_pct ?? null
}

/** Orden solo para maquetación: menor logro primero (usa datos ya entregados por la API). */
function sortPedagogicalAlertsForDisplay(items: OverviewAlert[], byTtc: OverviewJson["by_test_type_course"] | undefined): OverviewAlert[] {
  return [...items].sort((a, b) => {
    const ka = resolveAlertCourseKey(a)
    const kb = resolveAlertCourseKey(b)
    const la = logroPctForAlertDisplay(a, byTtc, ka)
    const lb = logroPctForAlertDisplay(b, byTtc, kb)
    const fa = la != null && Number.isFinite(la)
    const fb = lb != null && Number.isFinite(lb)
    if (fa && fb) return la! - lb!
    if (fa) return -1
    if (fb) return 1
    return String(a.code).localeCompare(String(b.code), "es")
  })
}

function weakSkillLabelsForDisplay(a: OverviewAlert): string[] {
  const raw = a.by_skill
  if (!raw?.length) return []
  const sorted = [...raw].sort((x, y) => {
    const lx = x.logro_pct
    const ly = y.logro_pct
    if (lx != null && ly != null && Number.isFinite(lx) && Number.isFinite(ly)) return lx - ly
    return 0
  })
  return sorted
    .slice(0, 2)
    .map((s) => String(s.skill_label ?? "").trim())
    .filter(Boolean)
}

function alertHasLecturaSignal(a: OverviewAlert): boolean {
  if (a.trend) return true
  if (String(a.axis_label ?? "").trim()) return true
  return weakSkillLabelsForDisplay(a).length > 0
}

function isLowScoreAlertCode(code: string): boolean {
  return code === "LOW_SCORE_PAES" || code === "LOW_SCORE_SIMCE"
}

/**
 * Orden solo para “Lectura y acción”: más críticos primero (descenso y menor logro).
 * No altera datos de API.
 */
function sortAlertsForLecturaAccion(
  items: OverviewAlert[],
  byTtc: OverviewJson["by_test_type_course"] | undefined,
): OverviewAlert[] {
  const trendRank = (t: OverviewAlert["trend"]) => {
    if (t === "down") return 0
    if (t === "flat") return 1
    if (t === "up") return 2
    return 3
  }
  return [...items].sort((a, b) => {
    const ta = trendRank(a.trend)
    const tb = trendRank(b.trend)
    if (ta !== tb) return ta - tb
    const ka = resolveAlertCourseKey(a)
    const kb = resolveAlertCourseKey(b)
    const la = logroPctForAlertDisplay(a, byTtc, ka)
    const lb = logroPctForAlertDisplay(b, byTtc, kb)
    const fa = la != null && Number.isFinite(la)
    const fb = lb != null && Number.isFinite(lb)
    if (fa && fb) return la! - lb!
    if (fa) return -1
    if (fb) return 1
    return String(a.code).localeCompare(String(b.code), "es")
  })
}

function lecturaAccionTip(weakSkills: string[], testType: "PAES" | "SIMCE" | null): string | null {
  if (weakSkills.length > 0) {
    if (weakSkills.length === 1) return `Reforzar práctica con énfasis en ${weakSkills[0]}.`
    return `Reforzar práctica en ${weakSkills[0]} e ${weakSkills[1]}.`
  }
  if (testType) return `Reforzar práctica en evaluaciones tipo ${testType}.`
  return null
}

type CourseOverviewRow = NonNullable<OverviewJson["by_course"]>[number]

/** Solo orden para maquetación (no altera datos de API). */
function sortCoursesForOverviewCards(rows: CourseOverviewRow[]): CourseOverviewRow[] {
  const tier = (r: CourseOverviewRow) => {
    const hasLogro = r.logro_pct != null && Number.isFinite(Number(r.logro_pct))
    if (hasLogro) return 0
    if (r.eval_count > 0) return 1
    return 2
  }
  return [...rows].sort((a, b) => {
    const d = tier(a) - tier(b)
    if (d !== 0) return d
    return String(a.course_label).localeCompare(String(b.course_label), "es")
  })
}

function TeacherCourseOverviewCard({
  courseLabel,
  logroPct,
  evalCount,
  semaphore,
  paesAvgScore,
  simceAvgScore,
}: {
  courseLabel: string
  logroPct: number | null
  evalCount: number
  semaphore: Semaphore
  paesAvgScore: number | null | undefined
  simceAvgScore: number | null | undefined
}) {
  const sm = semaphoreMeta(semaphore)
  const hasLogro = logroPct != null && Number.isFinite(Number(logroPct))
  const logroPctFormatted = hasLogro
    ? `${Number(logroPct).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`
    : null
  const showSimce = hasLogro && simceAvgScore != null && Number.isFinite(Number(simceAvgScore))
  const showPaes = hasLogro && paesAvgScore != null && Number.isFinite(Number(paesAvgScore))

  return (
    <article
      className="rounded-lg border border-[#E5E7EB] bg-[#FAFBFC] p-5 shadow-sm"
      aria-label={courseLabel}
    >
      <div className="flex flex-col gap-0.5">
        <h4 className="text-sm font-semibold text-[#111827] leading-snug">{courseLabel}</h4>
        <p className="text-xs font-medium text-[#4B5563] leading-snug">
          <span className="mr-1" aria-hidden>
            {sm.emoji}
          </span>
          {sm.label}
        </p>
      </div>

      {hasLogro ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-[#E5E7EB]/80 pt-4 text-sm text-[#374151]">
          <p>
            <span className="text-[#6B7280]">Nivel de logro:</span>{" "}
            <span className="text-base font-semibold tabular-nums text-[#111827]">{logroPctFormatted}</span>
          </p>
          <p>
            <span className="text-[#6B7280]">Evaluaciones:</span>{" "}
            <span className="font-medium tabular-nums text-[#111827]">{evalCount.toLocaleString("es-CL")}</span>
          </p>
          {showSimce ? (
            <p>
              <span className="text-[#6B7280]">Referencia SIMCE:</span>{" "}
              <span className="font-medium tabular-nums text-[#111827]">
                {Math.round(Number(simceAvgScore)).toLocaleString("es-CL")} puntos
              </span>
            </p>
          ) : null}
          {showPaes ? (
            <p>
              <span className="text-[#6B7280]">Referencia PAES:</span>{" "}
              <span className="font-medium tabular-nums text-[#111827]">
                {Math.round(Number(paesAvgScore)).toLocaleString("es-CL")} puntos
              </span>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2 border-t border-[#E5E7EB]/80 pt-4 text-sm">
          <p className="text-[#6B7280] leading-relaxed">Sin información suficiente para evaluar el curso</p>
          <p className="text-[#374151]">
            <span className="tabular-nums font-medium text-[#111827]">{evalCount.toLocaleString("es-CL")}</span>{" "}
            evaluaciones registradas
          </p>
        </div>
      )}
    </article>
  )
}

function LecturaAccionItem({
  courseDisplay,
  axisTitle,
  logroPct,
  weakSkills,
  trendPhrase,
  semaphore,
  testTypeLabel,
}: {
  courseDisplay: string
  axisTitle: string
  logroPct: number | null
  weakSkills: string[]
  trendPhrase: string | null
  semaphore: Semaphore
  testTypeLabel: "PAES" | "SIMCE" | null
}) {
  const sm = semaphoreMeta(semaphore)
  const logroStr =
    logroPct != null && Number.isFinite(logroPct)
      ? `${Number(logroPct).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`
      : null
  const tip = lecturaAccionTip(weakSkills, testTypeLabel)
  const headline = testTypeLabel ? `${courseDisplay} · ${testTypeLabel}` : courseDisplay

  return (
    <li className="list-none rounded-lg border border-[#FECACA]/80 bg-white px-3 py-2.5 shadow-sm">
      <p className="text-xs font-semibold text-[#111827] leading-tight">{headline}</p>
      <p className="mt-1.5 text-sm text-[#111827] leading-snug">
        <span aria-hidden>{sm.emoji}</span>{" "}
        <span className="font-medium">
          {axisTitle}
          {logroStr ? ` — ${logroStr}` : ""}
          {trendPhrase ? ` (${trendPhrase})` : ""}
        </span>
      </p>
      {weakSkills.length > 0 ? (
        <p className="mt-1.5 text-xs text-[#374151] leading-snug">Habilidades: {weakSkills.join(", ")}</p>
      ) : null}
      {tip ? <p className="mt-1.5 text-xs text-[#6B7280] leading-snug">💡 {tip}</p> : null}
    </li>
  )
}

function PedagogicalAlertCompactCard({
  courseDisplay,
  axisTitle,
  logroPct,
  weakSkills,
  trend,
  semaphore,
  testTypeLabel,
}: {
  courseDisplay: string
  axisTitle: string
  logroPct: number | null
  weakSkills: string[]
  trend: ReturnType<typeof trendPresentation>
  semaphore: Semaphore
  testTypeLabel: "PAES" | "SIMCE" | null
}) {
  const sm = semaphoreMeta(semaphore)
  const logroStr =
    logroPct != null && Number.isFinite(logroPct)
      ? `${Number(logroPct).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`
      : null
  const suggestion =
    weakSkills.length > 0
      ? `Reforzar actividades de ${weakSkills.join(" e ")}`
      : testTypeLabel
        ? `Reforzar práctica en evaluaciones ${testTypeLabel}`
        : null

  return (
    <li className="list-none rounded-lg border border-[#FECACA]/80 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold text-[#111827] leading-tight">{courseDisplay}</p>
      <p className="mt-1 text-sm text-[#111827] leading-snug">
        <span aria-hidden>{sm.emoji}</span>{" "}
        <span className="font-medium">
          {axisTitle}
          {logroStr ? ` — ${logroStr}` : null}
        </span>
      </p>
      {trend ? (
        <p className="mt-1 text-xs text-[#6B7280]">
          {trend.icon} Tendencia: {trend.label}
        </p>
      ) : null}
      {weakSkills.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-xs text-[#374151]">
          {weakSkills.map((s, i) => (
            <li key={`${s}-${i}`}>• {s}</li>
          ))}
        </ul>
      ) : null}
      {suggestion ? <p className="mt-1 text-xs text-[#6B7280] leading-snug">💡 {suggestion}</p> : null}
    </li>
  )
}

export function TeacherOverview() {
  const [data, setData] = useState<OverviewJson | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(false)
    try {
      const res = await fetch("/api/dashboard/teacher/overview", { cache: "no-store", credentials: "include" })
      const json = (await res.json()) as OverviewJson
      if (!res.ok) {
        setFetchError(true)
        setData(null)
        return
      }
      setData(json)
    } catch {
      setFetchError(true)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <section
        className="rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
        aria-label="Panorama de evaluaciones aplicadas"
      >
        <p className="text-sm text-[#6B7280]">Cargando panorama de evaluaciones aplicadas…</p>
      </section>
    )
  }

  if (fetchError || !data) {
    return (
      <section
        className="rounded-2xl border border-[#F59E0B]/35 bg-[#FFFBEB] p-6 text-sm text-[#111827] shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
        aria-live="polite"
      >
        <p className="font-medium">No se pudo cargar el panorama docente en este momento.</p>
        <button type="button" onClick={() => void load()} className="mt-3 text-[#B45309] underline font-medium">
          Reintentar
        </button>
      </section>
    )
  }

  if (data.has_teacher_id === false) {
    return (
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-sm text-[#111827] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h2 className="text-base font-semibold text-[#111827]">Panorama de evaluaciones aplicadas</h2>
        <p className="mt-2 leading-relaxed">
          Para ver indicadores de logro con tus evaluaciones, necesitamos un <strong>docente</strong> vinculado a tu
          perfil. Cuando esté disponible, aquí verás el resumen sin comparar con el colegio.
        </p>
        <Link href="/perfil" className="mt-4 inline-block font-medium text-[#047857] underline">
          Ir a perfil
        </Link>
      </section>
    )
  }

  const total = data.global?.total_evaluations ?? 0
  if (total === 0) {
    return (
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-sm text-[#6B7280] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h2 className="text-base font-semibold text-[#111827]">Panorama de evaluaciones aplicadas</h2>
        <p className="mt-2 leading-relaxed">Aún no hay evaluaciones suficientes para construir el panorama docente.</p>
      </section>
    )
  }

  const g = data.global!
  const gMeta = semaphoreMeta(g.semaphore)
  const cmp = data.comparison
  const cmpMeta = comparisonMeta(data.comparison_semaphore)
  const courses = data.by_course ?? []
  const subjects = data.by_subject ?? []
  const types = data.by_test_type ?? []
  const scores = data.score_by_test_type_course ?? { PAES: [], SIMCE: [], Interna: [] }
  const assignedCourses = sortCoursesForOverviewCards(courses.filter((c) => !isUnassignedCourseLabel(c.course_label)))
  const unassignedCourses = sortCoursesForOverviewCards(courses.filter((c) => isUnassignedCourseLabel(c.course_label)))
  const paesAvgByCourseLabel = new Map(scores.PAES.map((r) => [r.course_label, r.avg_score]))
  const simceAvgByCourseLabel = new Map(scores.SIMCE.map((r) => [r.course_label, r.avg_score]))
  const alerts = data.alerts ?? []
  const byTtc = data.by_test_type_course
  const pedagogicalAlerts = sortPedagogicalAlertsForDisplay(
    alerts.filter((a) => a.code !== "POSSIBLE_MISSING_STUDENTS"),
    byTtc,
  )
  const lecturaCandidates = sortAlertsForLecturaAccion(
    pedagogicalAlerts.filter((a) => isLowScoreAlertCode(a.code) && alertHasLecturaSignal(a)),
    byTtc,
  )
  const lecturaTop = lecturaCandidates.slice(0, 4)
  const possibleMissingAlert = alerts.find((a) => a.code === "POSSIBLE_MISSING_STUDENTS")

  return (
    <section className="space-y-8" aria-label="Panorama de evaluaciones aplicadas">
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 sm:p-10 shadow-[0_4px_24px_rgba(17,24,39,0.06)]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-start justify-between gap-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#111827]">Panorama de evaluaciones aplicadas</h2>
            <p className="mt-2 text-sm text-[#6B7280] max-w-prose leading-relaxed">
              Vista general de <strong className="text-[#111827] font-semibold">tu</strong> práctica evaluativa (logro ponderado por puntaje máximo). Sin
              comparación con el colegio en esta fase.
            </p>
          </div>
          {data.truncated ? (
            <p className="text-xs text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/30 rounded-lg px-3 py-1.5">
              Alcance acotado (máx. recientes en servidor).
            </p>
          ) : null}
        </div>

        <div className="mx-auto mt-8 grid max-w-4xl gap-5 sm:grid-cols-3">
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] p-6 sm:col-span-2 text-center sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Rendimiento general de las evaluaciones</p>
            <p className="mt-3 text-5xl sm:text-6xl font-bold tabular-nums text-[#111827] tracking-tight">{formatPct(g.logro_pct)}</p>
            <p className="mt-2 text-xs text-[#6B7280] leading-relaxed max-w-lg">
              Suma de puntajes obtenidos / suma de puntajes máximos, en todas tus evaluaciones del alcance.
            </p>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 flex flex-col justify-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Semáforo</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden>
                {gMeta.emoji}
              </span>
              <span className="text-sm font-medium text-[#111827]">{gMeta.label}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[#E5E7EB] overflow-hidden">
              <div
                className={`h-full rounded-full ${gMeta.bar}`}
                style={{ width: g.logro_pct != null && g.logro_pct > 0 ? `${Math.min(100, g.logro_pct)}%` : "4%" }}
              />
            </div>
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-4xl text-sm text-[#6B7280]">
          <span className="font-semibold text-[#111827] tabular-nums text-lg">{g.total_evaluations}</span> evaluaciones en este
          panorama.
        </p>
      </div>

      <div className="rounded-2xl border-2 border-[#10B981]/25 bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h3 className="text-base font-semibold text-[#111827]">Comparación con el colegio</h3>
        {data.has_school_id === false ? (
          <p className="mt-3 text-sm text-[#6B7280]">No hay datos suficientes para comparación institucional.</p>
        ) : cmp?.school_logro_pct == null || cmp.teacher_logro_pct == null || cmp.diff_pct == null ? (
          <p className="mt-3 text-sm text-[#6B7280]">Aún no hay datos institucionales suficientes para comparar.</p>
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-[#6B7280]">
              Rendimiento de las evaluaciones:{" "}
              <span className="font-semibold text-[#111827] text-base tabular-nums">{formatPct(cmp.teacher_logro_pct)}</span>
            </p>
            <p className="text-[#6B7280]">
              Promedio colegio: <span className="font-semibold text-[#111827] text-base tabular-nums">{formatPct(cmp.school_logro_pct)}</span>
            </p>
            <p className={`font-semibold ${cmpMeta.color}`}>
              {cmpMeta.emoji} {cmpMeta.text} ({cmp.diff_pct > 0 ? "+" : ""}
              {cmp.diff_pct.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%)
            </p>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h3 className="text-base font-semibold text-[#111827]">Por curso</h3>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#6B7280]">
          Resumen por curso: nivel de logro (mismo criterio que el panorama global), cantidad de evaluaciones y referencia de
          puntaje SIMCE o PAES cuando corresponde a tus datos.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {assignedCourses.map((c) => (
            <TeacherCourseOverviewCard
              key={c.course_label}
              courseLabel={courseLabelForDisplay(c.course_label)}
              logroPct={c.logro_pct}
              evalCount={c.eval_count}
              semaphore={c.semaphore}
              paesAvgScore={paesAvgByCourseLabel.get(c.course_label)}
              simceAvgScore={simceAvgByCourseLabel.get(c.course_label)}
            />
          ))}
        </div>
      </div>

      {unassignedCourses.length > 0 ? (
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-10 shadow-[0_4px_24px_rgba(17,24,39,0.06)]">
          <h3 className="text-base font-semibold text-[#111827]">Registros sin curso asignado</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#6B7280]">
            Evaluaciones que aún no tienen un curso vinculado en el registro.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {unassignedCourses.map((c) => (
              <TeacherCourseOverviewCard
                key={`unassigned-${c.course_label}`}
                courseLabel={courseLabelForDisplay(c.course_label)}
                logroPct={c.logro_pct}
                evalCount={c.eval_count}
                semaphore={c.semaphore}
                paesAvgScore={paesAvgByCourseLabel.get(c.course_label)}
                simceAvgScore={simceAvgByCourseLabel.get(c.course_label)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h3 className="text-base font-semibold text-[#111827]">Por asignatura</h3>
        <p className="mt-1 text-sm text-[#6B7280] mb-6">Barras según logro en cada asignatura.</p>
        <ul className="space-y-4">
          {subjects.map((s) => {
            const w = s.logro_pct != null && s.logro_pct > 0 ? Math.min(100, s.logro_pct) : 0
            const barClass =
              s.logro_pct == null
                ? "bg-[#E5E7EB]"
                : s.logro_pct >= 70
                  ? "bg-[#10B981]"
                  : s.logro_pct >= 50
                    ? "bg-[#F59E0B]"
                    : "bg-[#EF4444]"
            return (
              <li key={s.subject_label}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-[#111827]">{s.subject_label}</span>
                  <span className="tabular-nums text-[#6B7280]">
                    {formatPct(s.logro_pct)}
                    <span className="text-[#D1D5DB]"> · </span>
                    {s.eval_count} eval.
                  </span>
                </div>
                <div className="mt-2 h-3 w-full rounded-full bg-[#F7F9FB] border border-[#E5E7EB]/80 overflow-hidden">
                  <div className={`h-full rounded-full ${barClass}`} style={{ width: `${w}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h3 className="text-base font-semibold text-[#111827]">Tipo de prueba</h3>
        <p className="mt-1 text-sm text-[#6B7280] mb-6">Según etiquetas de la evaluación (SIMCE / PAES / resto como interna).</p>
        <ul className="grid gap-4 sm:grid-cols-3">
          {types.map((t) => (
            <li
              key={t.key}
              className="rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] px-5 py-4 text-center"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{t.key}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-[#111827]">{t.count}</p>
              <p className="mt-1 text-xs text-[#6B7280]">{formatPct(t.share_pct)} del total</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-[#F59E0B]/25 bg-[#FFFBEB] p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h3 className="text-base font-semibold text-[#111827]">Lectura y acción</h3>
        <p className="mt-1 text-sm text-[#6B7280] leading-relaxed">
          Evolución por eje o habilidad y una pista breve para el trabajo en clase (prioriza situaciones más críticas).
        </p>
        {lecturaTop.length === 0 ? (
          <p className="mt-4 text-sm text-[#6B7280] leading-relaxed">
            No hay información suficiente para generar recomendaciones en este momento.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {lecturaTop.map((a, idx) => {
              const courseKey = resolveAlertCourseKey(a)
              const courseDisplay = courseKey ? courseLabelForDisplay(courseKey) : "Curso"
              const logroPct = logroPctForAlertDisplay(a, byTtc, courseKey)
              const tt = testTypeFromAlertCode(a.code)
              const axisTitle =
                a.axis_label?.trim() || (tt ? `Eje / logro en pruebas ${tt}` : "Eje o habilidad en evaluaciones")
              const weakSkills = weakSkillLabelsForDisplay(a)
              const trendPhrase = trendPhraseLectura(a.trend)
              const row = courseKey ? courses.find((c) => c.course_label === courseKey) : undefined
              const semaphore: Semaphore = row?.semaphore ?? "red"
              return (
                <LecturaAccionItem
                  key={`lectura-${a.code}-${courseKey ?? "x"}-${idx}`}
                  courseDisplay={courseDisplay}
                  axisTitle={axisTitle}
                  logroPct={logroPct}
                  weakSkills={weakSkills}
                  trendPhrase={trendPhrase}
                  semaphore={semaphore}
                  testTypeLabel={tt}
                />
              )
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F9FB] p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h3 className="text-base font-semibold text-[#111827]">👥 Seguimiento de evaluación (posibles faltantes)</h3>
        <p className="mt-3 text-sm text-[#374151] leading-relaxed">
          {possibleMissingAlert?.message ??
            "No hay señales suficientes para estimar posibles faltantes de evaluación en este momento."}
        </p>
        <p className="mt-2 text-xs text-[#6B7280] leading-relaxed">
          Señal suave: esta información es referencial y no confirma ausencias; se recomienda validar con el registro del curso.
        </p>
      </div>

      <p className="text-sm text-[#6B7280] pt-2">
        Los resultados corresponden a las evaluaciones aplicadas y buscan apoyar la toma de decisiones pedagógicas.
      </p>
    </section>
  )
}
