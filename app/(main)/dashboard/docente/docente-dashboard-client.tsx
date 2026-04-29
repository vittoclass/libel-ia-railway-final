"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import PedagogicalAnalysisModal from "@/app/components/PedagogicalAnalysisModal"
import { normalizeCourseLabel } from "@/app/lib/course-utils"
import { TeacherOverview } from "@/app/components/dashboard/teacher/TeacherOverview"
import { DocenteEvaluationDetailModal } from "./docente-evaluation-detail-modal"
import { DocenteSmartGradesCopy } from "./docente-smart-grades-copy"

const ENABLE_PEDAGOGY_UI = process.env.NEXT_PUBLIC_ENABLE_PEDAGOGY === "true"

type CoursePayload = {
  course_key: string
  course_label: string
  evaluation_count: number
  avg_grade_chile: number | null
  avg_logro_pct: number | null
  student_result_rows: number
  /** Asignaturas con al menos una evaluación en el curso (solo lectura API). */
  subjects?: string[]
}

type EvaluationPayload = {
  id: string
  title: string | null
  subject: string | null
  course_key: string
  course_label: string
  evaluated_at: string | null
  student_count: number
  primary_student_label: string
  grade_chile: number | null
  logro_pct: number | null
  resolved_grade: number | null
  /** UUID de lote persistido en evaluations.batch_id; regeneración ZIP en el evaluador. */
  batch_id?: string | null
  /** Indica prueba base asociada (insumo del informe pedagógico existente). */
  has_source_exam?: boolean
  exam_type?: string | null
  assessment_category?: string | null
  /** Derivado de exam_type / assessment_category (SIMCE / PAES / resto). */
  instrument_mode?: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
}

type AtRiskPayload = {
  evaluation_id: string
  evaluation_title: string | null
  course_key: string
  course_label: string
  student_name: string
  grade_chile: number
  logro_pct: number | null
  evaluated_at: string | null
}

type DashboardJson = {
  error?: string
  message?: string
  scope_mode?: "teacher" | "school" | "none"
  scope_label?: string
  profile_role?: string
  school_id?: string | null
  teacher_id?: string | null
  courses: CoursePayload[]
  evaluations: EvaluationPayload[]
  at_risk: AtRiskPayload[]
  truncated?: boolean
}

type AssignmentRow = {
  id: string
  teacher_id: string
  course_id: string | null
  course_label: string
  subject: string
}

function logroSemaphoreClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return "bg-[#E5E7EB] text-[#6B7280]"
  const p = Number(pct)
  if (p >= 60) return "bg-[#10B981] text-white"
  if (p >= 40) return "bg-[#F59E0B] text-[#111827]"
  return "bg-[#EF4444] text-white"
}

/** Misma convención que los bloques por curso (ancla a sección inferior). */
function anchorIdForCourseKey(courseKey: string): string {
  return `curso-${encodeURIComponent(courseKey).replace(/%/g, "")}`
}

function riskGradeBadgeClass(grade: number): string {
  if (grade < 3) return "bg-[#B91C1C] text-white"
  if (grade < 3.5) return "bg-[#DC2626] text-white"
  return "bg-[#EF4444] text-white"
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assignmentCourseKey(a: Pick<AssignmentRow, "course_id" | "course_label">): string {
  const cid = a.course_id != null && String(a.course_id).trim() !== "" ? String(a.course_id).trim() : ""
  if (cid) return cid
  const lbl = String(a.course_label ?? "").trim()
  if (lbl) return normalizeCourseLabel(lbl)
  return "Sin curso"
}

/** Etiqueta legible para filas; nunca muestra UUID crudo al usuario. */
function formatCourseForUser(course_label: string | null | undefined, course_key: string): string {
  const lbl = String(course_label ?? "").trim()
  if (lbl && !UUID_RE.test(lbl)) return lbl
  if (lbl && UUID_RE.test(lbl)) return "Sin etiqueta de curso"
  const ck = String(course_key ?? "").trim()
  if (ck && UUID_RE.test(ck)) return "Sin etiqueta de curso"
  if (ck && ck !== "Sin curso") return ck
  return "Sin curso"
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
}

function studentLabel(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim()
  return t ? t : "Alumno sin identificar"
}

function evaluatorZipHref(ev: Pick<EvaluationPayload, "batch_id" | "title" | "course_label">): string {
  const base = "/evaluar?tab=mis-archivos"
  if (ev.batch_id != null && String(ev.batch_id).trim() !== "") {
    const b = encodeURIComponent(ev.batch_id.trim())
    const exam = encodeURIComponent(ev.title ?? "")
    const curso = encodeURIComponent(ev.course_label ?? "")
    return `${base}&batch=${b}&exam=${exam}&curso=${curso}`
  }
  return base
}

const EVAL_INIT = 10
const RISK_INIT = 12

function InstrumentBadge({ ev }: { ev: EvaluationPayload }) {
  const mode = ev.instrument_mode
  if (mode === "SIMCE") {
    return (
      <span className="shrink-0 rounded-md border border-[#F59E0B]/35 bg-[#FFFBEB] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#B45309]">
        SIMCE
      </span>
    )
  }
  if (mode === "PAES") {
    return (
      <span className="shrink-0 rounded-md border border-[#E5E7EB] bg-[#F7F9FB] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#111827]">
        PAES
      </span>
    )
  }
  const raw = ev.exam_type?.trim() || ev.assessment_category?.trim()
  if (raw) {
    return (
      <span className="shrink-0 rounded-md border border-[#E5E7EB] bg-white px-2 py-0.5 text-[10px] font-medium text-[#6B7280]" title="Tipo de instrumento en la evaluación">
        {raw.length > 24 ? `${raw.slice(0, 24)}…` : raw}
      </span>
    )
  }
  return null
}

function EvalInformeActions({
  ev,
  onDetail,
  onCorrectionPdf,
  onPedagogy,
}: {
  ev: EvaluationPayload
  onDetail: () => void
  onCorrectionPdf: () => void
  onPedagogy: () => void
}) {
  const zipHref = evaluatorZipHref(ev)
  const hasBatch = ev.batch_id != null && String(ev.batch_id).trim() !== ""

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F7F9FB]"
        onClick={onDetail}
      >
        Ver detalle
      </button>
      <button
        type="button"
        className="rounded-lg border border-[#111827] bg-[#111827] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#374151]"
        onClick={onCorrectionPdf}
        title="Mismo PDF que en el evaluador cuando hay datos persistidos (fortalezas, corrección detallada, alternativas, desarrollo). Si faltan datos, se ofrece un resumen en PDF."
      >
        Informe corrección (PDF)
      </button>
      {ENABLE_PEDAGOGY_UI ? (
        <button
          type="button"
          disabled={ev.has_source_exam !== true}
          className="rounded-lg border border-[#059669] bg-[#10B981] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onPedagogy}
          title={
            ev.has_source_exam === true
              ? "Mismo modal y API que en el evaluador: GET /api/evaluations/[id]/pedagogical-analysis"
              : "Sin prueba base asociada a esta evaluación: el informe pedagógico del sistema no aplica."
          }
        >
          Informe pedagógico
        </button>
      ) : null}
      {hasBatch ? (
        <Link
          href={zipHref}
          className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F7F9FB]"
          title="Evaluador: Mis archivos → regenerar ZIP pedagógico de este lote."
        >
          ZIP del lote
        </Link>
      ) : null}
    </div>
  )
}

type MergedCourse = {
  course_key: string
  course_label: string
  subjects: string[]
  from_assignment: boolean
  stats: CoursePayload | null
}

export function DocenteDashboardClient() {
  const searchParams = useSearchParams()
  const cursoFilter = searchParams.get("curso")?.trim() || ""

  const [data, setData] = useState<DashboardJson | null>(null)
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [assignWarning, setAssignWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [autoPdfNext, setAutoPdfNext] = useState(false)

  const [pedagogyOpen, setPedagogyOpen] = useState(false)
  const [pedagogyEvalId, setPedagogyEvalId] = useState<string | null>(null)
  const [pedagogyEvalLabel, setPedagogyEvalLabel] = useState<string | undefined>(undefined)
  const [pedagogyStudent, setPedagogyStudent] = useState<string | undefined>(undefined)
  const [pedagogyCourse, setPedagogyCourse] = useState<string | undefined>(undefined)

  const [evalLimitByCourse, setEvalLimitByCourse] = useState<Record<string, number>>({})
  const [riskLimitByCourse, setRiskLimitByCourse] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const [dashRes, asgRes] = await Promise.all([
        fetch("/api/teacher/dashboard", { cache: "no-store", credentials: "include" }),
        fetch("/api/docente/assignments", { cache: "no-store", credentials: "include" }),
      ])
      const dashJson = (await dashRes.json()) as DashboardJson
      const asgJson = (await asgRes.json()) as { assignments?: AssignmentRow[]; warning?: string; error?: string }

      if (!dashRes.ok) {
        setFetchError(typeof dashJson.error === "string" ? dashJson.error : "No se pudo cargar el panel")
        setData(null)
        return
      }
      setData(dashJson)

      if (asgRes.ok && Array.isArray(asgJson.assignments)) {
        setAssignments(asgJson.assignments)
        setAssignWarning(typeof asgJson.warning === "string" ? asgJson.warning : null)
      } else {
        setAssignments([])
        setAssignWarning(asgJson.error ?? null)
      }
    } catch {
      setFetchError("Error de red")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mergedCourses = useMemo((): MergedCourse[] => {
    const teacherId = data?.teacher_id?.trim() ?? ""
    const map = new Map<string, MergedCourse>()

    const skipAssignments = Boolean(
      assignWarning && /teacher_assignments|no aplicada|does not exist|42P01/i.test(assignWarning),
    )

    const filteredAssignments = teacherId
      ? assignments.filter((a) => String(a.teacher_id ?? "").trim() === teacherId)
      : assignments

    if (!skipAssignments) {
      for (const a of filteredAssignments) {
        const ck = assignmentCourseKey(a)
        if (!map.has(ck)) {
          map.set(ck, {
            course_key: ck,
            course_label: String(a.course_label ?? "").trim() || ck,
            subjects: [],
            from_assignment: true,
            stats: null,
          })
        }
        const m = map.get(ck)!
        const subj = String(a.subject ?? "").trim()
        if (subj && !m.subjects.includes(subj)) m.subjects.push(subj)
      }
    }

    for (const c of data?.courses ?? []) {
      const subs = [...(c.subjects ?? [])]
      if (!map.has(c.course_key)) {
        map.set(c.course_key, {
          course_key: c.course_key,
          course_label: c.course_label,
          subjects: subs,
          from_assignment: false,
          stats: c,
        })
      } else {
        const m = map.get(c.course_key)!
        m.stats = c
        if (!m.course_label || m.course_label === "Sin curso") m.course_label = c.course_label
        for (const s of subs) {
          if (s && !m.subjects.includes(s)) m.subjects.push(s)
        }
      }
    }

    for (const e of data?.evaluations ?? []) {
      if (!map.has(e.course_key)) {
        map.set(e.course_key, {
          course_key: e.course_key,
          course_label: e.course_label,
          subjects: [],
          from_assignment: false,
          stats: null,
        })
      } else {
        const m = map.get(e.course_key)!
        if (!m.course_label || m.course_label === "Sin curso") m.course_label = e.course_label
      }
    }

    const evalCountFor = (ck: string) => (data?.evaluations ?? []).filter((e) => e.course_key === ck).length

    const list = [...map.values()].sort((a, b) => {
      const na = a.stats?.evaluation_count ?? evalCountFor(a.course_key)
      const nb = b.stats?.evaluation_count ?? evalCountFor(b.course_key)
      if (nb !== na) return nb - na
      return a.course_label.localeCompare(b.course_label, "es")
    })
    return list
  }, [data, assignments, assignWarning])

  /** Lista completa del alcance (el resumen superior siempre muestra el mapa total). */
  const coursesForDetailSections = useMemo(() => {
    if (!cursoFilter) return mergedCourses
    return mergedCourses.filter((c) => c.course_key === cursoFilter)
  }, [mergedCourses, cursoFilter])

  /** Resumen superior: orden alfabético por curso para que ninguno domine por volumen. */
  const courseOverviewRows = useMemo(() => {
    const evals = data?.evaluations ?? []
    const countFor = (ck: string) => evals.filter((e) => e.course_key === ck).length
    return [...mergedCourses]
      .map((mc) => {
        const st = mc.stats
        const nEval = st?.evaluation_count ?? countFor(mc.course_key)
        return {
          course_key: mc.course_key,
          course_label: mc.course_label,
          eval_count: nEval,
          avg_grade: st?.avg_grade_chile ?? null,
          avg_logro: st?.avg_logro_pct ?? null,
        }
      })
      .sort((a, b) => a.course_label.localeCompare(b.course_label, "es"))
  }, [mergedCourses, data?.evaluations])

  const evalById = useMemo(() => {
    const m = new Map<string, EvaluationPayload>()
    for (const e of data?.evaluations ?? []) {
      m.set(e.id, e)
    }
    return m
  }, [data])

  const openPedagogy = useCallback((ev: EvaluationPayload) => {
    if (!ENABLE_PEDAGOGY_UI || ev.has_source_exam !== true) return
    setPedagogyEvalId(ev.id)
    setPedagogyEvalLabel(ev.title ?? undefined)
    setPedagogyStudent(ev.primary_student_label || undefined)
    setPedagogyCourse(ev.course_label || undefined)
    setPedagogyOpen(true)
  }, [])

  const openDetail = useCallback((id: string, withPdf?: boolean) => {
    const tid = String(id ?? "").trim()
    if (!tid || !UUID_RE.test(tid)) {
      console.warn("[docente-dashboard] id de evaluación inválido", id)
      return
    }
    setDetailId(tid)
    setDetailOpen(true)
    setAutoPdfNext(!!withPdf)
  }, [])

  if (loading && !data) {
    return (
      <div className="space-y-10 bg-[#F7F9FB] -mx-4 px-4 py-8 sm:-mx-6 sm:px-8 rounded-none">
        <TeacherOverview />
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-sm text-[#6B7280] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          Cargando panel docente…
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="space-y-10 bg-[#F7F9FB] -mx-4 px-4 py-8 sm:-mx-6 sm:px-8 rounded-none">
        <TeacherOverview />
        <div className="rounded-2xl border border-[#EF4444]/25 bg-white p-8 text-sm text-[#B91C1C] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {fetchError}
          <button type="button" onClick={() => void load()} className="ml-4 underline font-medium text-[#111827]">
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  const profileBlocked =
    data?.error === "PERFIL_SIN_TEACHER_ID" ||
    data?.error === "PERFIL_SIN_COLEGIO" ||
    data?.error === "PERFIL_SIN_ALCANCE"

  return (
    <div className="space-y-10 bg-[#F7F9FB] -mx-4 px-4 py-8 sm:-mx-6 sm:px-8">
      <TeacherOverview />
      <DocenteEvaluationDetailModal
        key={detailId ?? "x"}
        evaluationId={detailId}
        open={detailOpen}
        onOpenChange={(o) => {
          setDetailOpen(o)
          if (!o) {
            setDetailId(null)
            setAutoPdfNext(false)
          }
        }}
        autoDownloadPdf={autoPdfNext}
        onAutoDownloadPdfConsumed={() => setAutoPdfNext(false)}
      />

      <PedagogicalAnalysisModal
        evaluationId={pedagogyEvalId}
        evaluationLabel={pedagogyEvalLabel}
        studentName={pedagogyStudent}
        courseLabel={pedagogyCourse}
        open={pedagogyOpen}
        onOpenChange={(o) => {
          setPedagogyOpen(o)
          if (!o) {
            setPedagogyEvalId(null)
            setPedagogyEvalLabel(undefined)
            setPedagogyStudent(undefined)
            setPedagogyCourse(undefined)
          }
        }}
      />

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#111827]">Panel Docente</h2>
        <p className="mt-2 text-sm text-[#6B7280] leading-relaxed max-w-3xl">
          Arriba: mapa compacto de <strong className="text-[#111827]">todos</strong> los cursos del alcance (orden alfabético). Abajo: detalle por
          curso ordenado por volumen de evaluaciones. Las filas de evaluación muestran estudiante, curso, instrumento
          (SIMCE/PAES u otros), fecha, nota y logro.
        </p>
        {data?.scope_label ? (
          <div className="mt-4 rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] px-4 py-3 text-xs text-[#374151]">
            {data.scope_mode === "school" || data.scope_mode === "teacher" ? (
              <p className="text-sm font-semibold text-[#111827]">
                {data.scope_mode === "school"
                  ? "Mostrando cursos del establecimiento (misma lista que Cursos en el evaluador)"
                  : "Mostrando tus evaluaciones por docente (misma lista que Cursos sin colegio en perfil)"}
              </p>
            ) : null}
            <p className="mt-2">
              <span className="font-semibold text-[#111827]">Detalle:</span> {data.scope_label}
            </p>
            {data.scope_mode === "school" ? (
              <span className="block mt-2 text-[#6B7280] leading-relaxed">
                Rol perfil: {data.profile_role ?? "—"}. Tu perfil tiene <strong className="text-[#111827]">school_id</strong>: se listan las mismas
                evaluaciones que en la pestaña <strong className="text-[#111827]">Cursos</strong> del evaluador (todo el colegio en alcance).
              </span>
            ) : data.scope_mode === "teacher" ? (
              <span className="block mt-2 text-[#6B7280] leading-relaxed">
                Rol perfil: {data.profile_role ?? "—"}. Sin <strong>school_id</strong> en perfil se usa{" "}
                <strong className="text-[#111827]">teacher_id</strong>, igual que la lista del evaluador.
              </span>
            ) : null}
          </div>
        ) : null}
        {assignWarning ? <p className="mt-3 text-xs text-[#B45309]">Carga UTP: {assignWarning}</p> : null}
        {data?.truncated ? (
          <p className="mt-2 text-xs text-[#B45309]">Alcance de evaluaciones acotado en servidor (máx. recientes).</p>
        ) : null}
      </div>

      {profileBlocked ? (
        <div className="rounded-2xl border border-[#F59E0B]/30 bg-[#FFFBEB] p-6 text-sm text-[#111827] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {data?.message ?? "Completa tu perfil para ver tus evaluaciones."}{" "}
          <Link href="/perfil" className="font-medium underline">
            Ir a perfil
          </Link>
        </div>
      ) : null}

      {!profileBlocked && (
        <>
          {cursoFilter ? (
            <div className="text-sm">
              <Link href="/dashboard/docente" className="font-medium text-[#047857] hover:underline">
                ← Ver todos los cursos
              </Link>
            </div>
          ) : null}

          {(data?.evaluations?.length ?? 0) > 0 ? (
            <DocenteSmartGradesCopy
              evaluations={data!.evaluations}
              courses={courseOverviewRows}
              initialCourseKey={cursoFilter || undefined}
            />
          ) : null}

          {mergedCourses.length === 0 ? (
            <p className="text-sm text-[#6B7280]">No hay cursos en tu carga docente ni evaluaciones aún.</p>
          ) : (
            <div className="space-y-12">
              <section
                className="rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden"
                aria-label="Resumen por curso"
              >
                <div className="border-b border-[#E5E7EB] bg-[#F7F9FB] px-5 py-4 sm:px-6 sm:py-5">
                  <h3 className="text-base font-semibold text-[#111827]">Resumen por curso</h3>
                  <p className="mt-2 text-xs text-[#6B7280] leading-relaxed max-w-4xl">
                    {courseOverviewRows.length} curso{courseOverviewRows.length === 1 ? "" : "s"} en este alcance. Orden
                    alfabético para ver el mapa completo de un vistazo. Semáforo según logro promedio del curso: verde ≥
                    60&nbsp;%, amarillo 40–59&nbsp;%, rojo &lt; 40&nbsp;% (sin logro: gris).
                  </p>
                  {cursoFilter ? (
                    <p className="mt-3 text-xs font-medium text-[#B45309]">
                      Estás con vista enfocada a un curso; el detalle abajo está filtrado. Esta tabla sigue mostrando{" "}
                      <strong>todos</strong> los cursos del alcance.
                    </p>
                  ) : null}
                </div>
                <div className="max-h-[min(70vh,36rem)] overflow-auto">
                  <table className="w-full min-w-[640px] text-sm text-left">
                    <thead className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white">
                      <tr className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                        <th className="px-4 py-3.5">Curso</th>
                        <th className="px-4 py-3.5 text-right tabular-nums">Nº eval.</th>
                        <th className="px-4 py-3.5 text-right tabular-nums">Nota prom.</th>
                        <th className="px-4 py-3.5 text-right tabular-nums">Logro prom.</th>
                        <th className="px-4 py-3.5 text-center">Estado</th>
                        <th className="px-4 py-3.5 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]/80">
                      {courseOverviewRows.map((row) => {
                        const aid = anchorIdForCourseKey(row.course_key)
                        const focused = cursoFilter === row.course_key
                        return (
                          <tr
                            key={row.course_key}
                            className={
                              focused ? "bg-[#ECFDF5]/60" : "bg-white hover:bg-[#F7F9FB]"
                            }
                          >
                            <td className="px-4 py-3.5">
                              <div className="font-medium text-[#111827]">{row.course_label}</div>
                            </td>
                            <td className="px-4 py-3.5 text-right tabular-nums text-[#374151]">{row.eval_count}</td>
                            <td className="px-4 py-3.5 text-right tabular-nums text-[#374151]">
                              {row.avg_grade != null ? row.avg_grade : "—"}
                            </td>
                            <td className="px-4 py-3.5 text-right tabular-nums text-[#374151]">
                              {row.avg_logro != null ? `${row.avg_logro}%` : "—"}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span
                                className={`inline-flex h-3.5 w-3.5 rounded-full ring-2 ring-white shadow-sm ${logroSemaphoreClass(row.avg_logro)}`}
                                title={
                                  row.avg_logro != null
                                    ? `Logro promedio ${row.avg_logro}%`
                                    : "Sin dato de logro promedio"
                                }
                              />
                            </td>
                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                              <Link
                                href={`/dashboard/docente?curso=${encodeURIComponent(row.course_key)}`}
                                className="text-[#047857] font-medium hover:underline mr-4"
                              >
                                Enfocar
                              </Link>
                              <a
                                href={cursoFilter ? `/dashboard/docente#${aid}` : `#${aid}`}
                                className="text-[#6B7280] font-medium hover:text-[#111827] hover:underline"
                              >
                                Ver bloque
                              </a>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {coursesForDetailSections.map((mc) => {
                const stats =
                  mc.stats ??
                  ({
                    course_key: mc.course_key,
                    course_label: mc.course_label,
                    evaluation_count: 0,
                    avg_grade_chile: null,
                    avg_logro_pct: null,
                    student_result_rows: 0,
                    subjects: [],
                  } satisfies CoursePayload)

                const evalsRaw = (data?.evaluations ?? []).filter((e) => e.course_key === mc.course_key)
                const evalsUnique = [...new Map(evalsRaw.map((e) => [e.id, e])).values()].sort((a, b) => {
                  const ta = a.evaluated_at ? new Date(a.evaluated_at).getTime() : 0
                  const tb = b.evaluated_at ? new Date(b.evaluated_at).getTime() : 0
                  return tb - ta
                })

                const evalLimit = evalLimitByCourse[mc.course_key] ?? EVAL_INIT
                const riskLimit = riskLimitByCourse[mc.course_key] ?? RISK_INIT

                const evalsShown = evalsUnique.slice(0, evalLimit)
                const anchorSafe = anchorIdForCourseKey(mc.course_key)
                const subjectHint = [...new Set([...(stats.subjects ?? []), ...mc.subjects])].filter(Boolean).join(", ")

                const risks = (data?.at_risk ?? [])
                  .filter((r) => r.course_key === mc.course_key)
                  .sort((a, b) => a.grade_chile - b.grade_chile || a.student_name.localeCompare(b.student_name, "es"))

                return (
                  <section
                    key={mc.course_key}
                    id={anchorSafe}
                    className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-6 scroll-mt-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E5E7EB] pb-4">
                      <div>
                        <h3 className="text-lg sm:text-xl font-semibold text-[#111827]">{mc.course_label}</h3>
                        <p className="text-xs text-[#6B7280] mt-1 leading-relaxed max-w-2xl">
                          {subjectHint ? `Asignaturas (evaluadas): ${subjectHint}` : null}
                          {mc.from_assignment ? "" : subjectHint ? " · " : ""}
                          {mc.from_assignment ? "" : "Cursos agrupados por datos guardados en cada evaluación."}
                        </p>
                      </div>
                      <Link
                        href={`/dashboard/docente?curso=${encodeURIComponent(mc.course_key)}`}
                        className="text-xs font-medium text-[#047857] hover:underline shrink-0"
                      >
                        Enfocar solo este curso
                      </Link>
                    </div>

                    <div className="mt-5 rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] p-4 text-sm text-[#374151]">
                      <span className="font-semibold text-[#111827]">Resumen</span>
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        <span
                          className={`inline-flex h-4 w-4 shrink-0 rounded-full ${logroSemaphoreClass(stats.avg_logro_pct)}`}
                          title="Semáforo según promedio de logro"
                        />
                        <span>
                          <strong>{stats.evaluation_count}</strong> evaluaciones ·{" "}
                          <strong>{stats.student_result_rows}</strong> filas estudiante
                        </span>
                        <span className="text-[#6B7280]">
                          Nota prom.:{" "}
                          <strong className="text-[#111827] tabular-nums">{stats.avg_grade_chile != null ? stats.avg_grade_chile : "—"}</strong>
                        </span>
                        <span className="text-[#6B7280]">
                          Logro prom.:{" "}
                          <strong className="text-[#111827] tabular-nums">
                            {stats.avg_logro_pct != null ? `${stats.avg_logro_pct}%` : "—"}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="mt-8">
                      <h4 className="text-sm font-semibold text-[#111827]">Evaluaciones recientes</h4>
                      {evalsUnique.length === 0 ? (
                        <p className="mt-2 text-sm text-[#6B7280]">Sin evaluaciones registradas en este curso.</p>
                      ) : (
                        <div className="mt-3 space-y-4">
                          <ul className="space-y-3">
                            {evalsShown.map((ev) => (
                              <li
                                key={ev.id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-[#F7F9FB] px-4 py-3 text-sm"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-[#111827] leading-snug">
                                    <span>{studentLabel(ev.primary_student_label)}</span>
                                    <InstrumentBadge ev={ev} />
                                  </div>
                                  <div className="mt-1 text-sm text-[#6B7280]">
                                    <span className="text-[#374151]">
                                      {formatCourseForUser(ev.course_label, ev.course_key)}
                                    </span>
                                    <span className="text-[#D1D5DB]"> · </span>
                                    <span>{ev.title?.trim() ? ev.title : "Evaluación sin título"}</span>
                                    <span className="text-[#D1D5DB]"> · </span>
                                    <span>{formatDate(ev.evaluated_at)}</span>
                                    <span className="text-[#D1D5DB]"> · </span>
                                    <span>
                                      Nota {ev.resolved_grade != null ? ev.resolved_grade : "—"}
                                    </span>
                                    <span className="text-[#D1D5DB]"> · </span>
                                    <span>{ev.logro_pct != null ? `Logro ${ev.logro_pct}%` : "Logro —"}</span>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  <EvalInformeActions
                                    ev={ev}
                                    onDetail={() => openDetail(ev.id, false)}
                                    onCorrectionPdf={() => openDetail(ev.id, true)}
                                    onPedagogy={() => openPedagogy(ev)}
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                          {evalsUnique.length > evalLimit ? (
                            <button
                              type="button"
                              className="text-sm font-medium text-[#047857] hover:underline"
                              onClick={() =>
                                setEvalLimitByCourse((prev) => ({
                                  ...prev,
                                  [mc.course_key]: (prev[mc.course_key] ?? EVAL_INIT) + EVAL_INIT,
                                }))
                              }
                            >
                              Ver más evaluaciones en este curso ({evalsUnique.length - evalLimit} ocultas)
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="mt-8 rounded-xl border border-[#EF4444]/20 bg-[#FEF2F2] p-4 sm:p-5">
                      <h4 className="text-sm font-semibold text-[#111827]">Alumnos en riesgo (nota &lt; 4,0)</h4>
                      <p className="text-xs text-[#6B7280] mt-1">Una fila por evaluación en riesgo en este curso.</p>
                      {risks.length === 0 ? (
                        <p className="mt-3 text-sm text-[#6B7280]">Nadie bajo 4,0 en este curso (en el alcance cargado).</p>
                      ) : (
                        <>
                          <ul className="mt-3 divide-y divide-[#FECACA]/60 rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
                            {risks.slice(0, riskLimit).map((r) => (
                              <li key={r.evaluation_id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm bg-white">
                                <span
                                  className={`h-10 w-1 shrink-0 rounded ${logroSemaphoreClass(r.logro_pct)}`}
                                  title={r.logro_pct != null ? `Logro ${r.logro_pct}%` : "Logro —"}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-base font-semibold text-[#111827]">{studentLabel(r.student_name)}</div>
                                  <div className="mt-1 text-sm text-[#6B7280]">
                                    <span>{formatCourseForUser(r.course_label, r.course_key)}</span>
                                    <span className="text-[#D1D5DB]"> · </span>
                                    <span>{r.evaluation_title?.trim() ? r.evaluation_title : "Evaluación"}</span>
                                    <span className="text-[#D1D5DB]"> · </span>
                                    <span>{formatDate(r.evaluated_at)}</span>
                                    <span className="text-[#D1D5DB]"> · </span>
                                    <span className="tabular-nums">Nota {r.grade_chile}</span>
                                    <span className="text-[#D1D5DB]"> · </span>
                                    <span>{r.logro_pct != null ? `Logro ${r.logro_pct}%` : "Logro —"}</span>
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${riskGradeBadgeClass(r.grade_chile)}`}
                                >
                                  {r.grade_chile}
                                </span>
                                {(() => {
                                  const evRisk =
                                    evalById.get(r.evaluation_id) ??
                                    ({
                                      id: r.evaluation_id,
                                      title: r.evaluation_title,
                                      subject: null,
                                      course_key: r.course_key,
                                      course_label: r.course_label,
                                      evaluated_at: r.evaluated_at,
                                      student_count: 0,
                                      primary_student_label: r.student_name,
                                      grade_chile: r.grade_chile,
                                      logro_pct: r.logro_pct,
                                      resolved_grade: r.grade_chile,
                                      batch_id: null,
                                      has_source_exam: false,
                                    } satisfies EvaluationPayload)
                                  return (
                                    <EvalInformeActions
                                      ev={evRisk}
                                      onDetail={() => openDetail(r.evaluation_id, false)}
                                      onCorrectionPdf={() => openDetail(r.evaluation_id, true)}
                                      onPedagogy={() => openPedagogy(evRisk)}
                                    />
                                  )
                                })()}
                              </li>
                            ))}
                          </ul>
                          {risks.length > riskLimit ? (
                            <button
                              type="button"
                              className="mt-3 text-sm font-medium text-[#B91C1C] underline"
                              onClick={() =>
                                setRiskLimitByCourse((prev) => ({
                                  ...prev,
                                  [mc.course_key]: (prev[mc.course_key] ?? RISK_INIT) + RISK_INIT,
                                }))
                              }
                            >
                              Ver más ({risks.length - riskLimit})
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <h3 className="text-base font-semibold text-[#111827]">Evaluador e historial de ZIP</h3>
            <p className="mt-2 text-sm text-[#6B7280] leading-relaxed max-w-3xl">
              El ZIP pedagógico masivo y su regeneración viven en el evaluador («Mis archivos»). Desde cada evaluación
              puedes ir directo con el enlace «ZIP del lote» o «ZIP e historial».
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/evaluar"
                className="inline-flex rounded-lg border border-[#E5E7EB] bg-white px-5 py-2.5 text-sm font-medium text-[#111827] hover:bg-[#F7F9FB] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              >
                Abrir evaluador
              </Link>
              <Link
                href="/evaluar?tab=mis-archivos"
                className="inline-flex rounded-lg border border-[#111827] bg-[#111827] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#374151]"
              >
                Mis archivos (ZIP)
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
