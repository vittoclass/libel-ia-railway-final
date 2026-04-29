import { NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { normUuid } from "@/app/lib/evaluation-read-scope"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { getInstrumentAnalyticsModeFromExamType } from "@/app/lib/assessment-category"
import { approxGradeChileFromLogroPct, resolveStudentDisplayName } from "@/app/lib/student-display-name"
import { normalizeCourseLabel } from "@/app/lib/course-utils"

export const dynamic = "force-dynamic"

const MAX_EVALUATIONS = 500
const ITEMS_CHUNK = 120

type EvalRow = {
  id: string
  title: string | null
  subject: string | null
  course_id: string | null
  course_label: string | null
  evaluated_at: string | null
  status: string | null
  batch_id: string | null
  source_exam_id: string | null
  exam_type?: string | null
  assessment_category?: string | null
}

function normalizeDashboardRole(r: unknown): string {
  return String(r ?? "").trim().toUpperCase()
}

/**
 * Clave estable para agrupar: UUID de curso si existe; si no, etiqueta normalizada
 * (misma lógica que asignaciones UTP: sin course_id no puede colapsar todo en "Sin curso").
 */
function courseKeyFromEval(e: Pick<EvalRow, "course_id" | "course_label">): string {
  const cid = e.course_id != null && String(e.course_id).trim() !== "" ? String(e.course_id).trim() : ""
  if (cid) return cid
  const lbl = String(e.course_label ?? "").trim()
  if (lbl) return normalizeCourseLabel(lbl)
  return "Sin curso"
}

function courseLabelFromEval(e: EvalRow): string {
  const lbl = String(e.course_label ?? "").trim()
  if (lbl) return lbl
  const cid = e.course_id != null && String(e.course_id).trim() !== "" ? String(e.course_id).trim() : ""
  if (cid) return cid
  return "Sin curso"
}

/**
 * GET /api/teacher/dashboard
 * Solo lectura. Alcance de evaluaciones alineado con `GET /api/evaluations/list` (pestaña Cursos / Evaluaciones):
 * si el perfil tiene `school_id` → `evaluations.school_id`; si no, → `evaluations.teacher_id`.
 */
export async function GET() {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id, school_id, role")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacherIdRaw =
    profile?.teacher_id != null && String(profile.teacher_id).trim() !== "" ? String(profile.teacher_id).trim() : null
  const teacherIdNorm = normUuid(teacherIdRaw)
  const schoolIdUsed = normUuid(profile?.school_id ?? null)
  const profileRole = normalizeDashboardRole((profile as { role?: string | null } | null)?.role)
  /** Igual que `/api/evaluations/list`: prioriza colegio si existe en perfil. */
  const useSchoolScope = schoolIdUsed != null

  if (!schoolIdUsed && !teacherIdNorm) {
    return NextResponse.json(
      {
        error: "PERFIL_SIN_ALCANCE",
        message: "Completa tu perfil con colegio y/o docente asignado para ver el panel (mismo requisito que la lista del evaluador).",
        scope_mode: "none",
        scope_label: "Sin school_id ni teacher_id válido en el perfil.",
        profile_role: profileRole,
        school_id: null,
        teacher_id: null,
        courses: [],
        evaluations: [],
        at_risk: [],
      },
      { status: 200 },
    )
  }

  let evalQuery = supabase
    .from("evaluations")
    .select(
      "id, title, subject, course_id, course_label, evaluated_at, status, is_archived, batch_id, source_exam_id, exam_type, assessment_category",
    )
    .or("is_archived.is.null,is_archived.eq.false")
    .order("evaluated_at", { ascending: false, nullsFirst: false })
    .limit(MAX_EVALUATIONS)

  if (useSchoolScope) {
    evalQuery = evalQuery.eq("school_id", schoolIdUsed!)
  } else {
    evalQuery = evalQuery.eq("teacher_id", teacherIdNorm!)
  }

  const { data: evalData, error: evErr } = await evalQuery

  if (evErr) {
    return NextResponse.json({ error: evErr.message }, { status: 500 })
  }

  const evalRows = ((evalData ?? []) as Array<EvalRow & { is_archived?: boolean }>).filter(
    (r) => String(r.status ?? "").trim().toLowerCase() !== "archived",
  ) as EvalRow[]

  const ids = evalRows.map((e) => e.id)
  if (ids.length === 0) {
    return NextResponse.json({
      scope_mode: useSchoolScope ? "school" : "teacher",
      scope_label: useSchoolScope
        ? "No hay evaluaciones recientes en tu colegio (o están archivadas)."
        : "No hay evaluaciones recientes para tu docente (o están archivadas).",
      profile_role: profileRole,
      school_id: schoolIdUsed,
      teacher_id: teacherIdNorm,
      courses: [],
      evaluations: [],
      at_risk: [],
      truncated: false,
    })
  }

  const [{ data: summariesRaw }, studentsRes] = await Promise.all([
    supabase.from("evaluation_summaries").select("evaluation_id, grade_chile, student_name_raw, raw").in("evaluation_id", ids),
    supabase.from("evaluation_students").select("evaluation_id, student_name").in("evaluation_id", ids),
  ])

  const summaries = (summariesRaw ?? []) as Array<{
    evaluation_id: string
    grade_chile?: number | null
    student_name_raw?: string | null
    raw?: unknown
  }>

  const summaryByEval = new Map<string, (typeof summaries)[0]>()
  for (const s of summaries) {
    summaryByEval.set(String(s.evaluation_id), s)
  }

  const studentsByEval = new Map<string, string[]>()
  for (const row of (studentsRes.data ?? []) as Array<{ evaluation_id: string; student_name?: string | null }>) {
    const eid = String(row.evaluation_id)
    const name = String(row.student_name ?? "").trim()
    if (!studentsByEval.has(eid)) studentsByEval.set(eid, [])
    if (name) studentsByEval.get(eid)!.push(name)
  }

  const itemTotals = new Map<string, { obtained: number; max: number }>()
  for (let i = 0; i < ids.length; i += ITEMS_CHUNK) {
    const slice = ids.slice(i, i + ITEMS_CHUNK)
    const { data: itemRows } = await supabase
      .from("evaluation_items")
      .select("evaluation_id, score_obtained, score_max")
      .in("evaluation_id", slice)
    for (const it of (itemRows ?? []) as Array<{
      evaluation_id: string
      score_obtained?: number | null
      score_max?: number | null
    }>) {
      const key = String(it.evaluation_id)
      const cur = itemTotals.get(key) ?? { obtained: 0, max: 0 }
      cur.obtained += Number(it.score_obtained) || 0
      cur.max += Number(it.score_max) || 0
      itemTotals.set(key, cur)
    }
  }

  const logroByEvalId = new Map<string, number | null>()
  for (const eid of ids) {
    const agg = itemTotals.get(eid) ?? { obtained: 0, max: 0 }
    logroByEvalId.set(eid, agg.max > 0 ? Math.round((agg.obtained / agg.max) * 10000) / 100 : null)
  }

  function resolvedGrade(eid: string): number | null {
    const sum = summaryByEval.get(eid)
    const g = Number(sum?.grade_chile)
    if (Number.isFinite(g)) return g
    return approxGradeChileFromLogroPct(logroByEvalId.get(eid) ?? null)
  }

  type CourseAgg = {
    course_key: string
    course_label: string
    evaluation_ids: string[]
    grade_samples: number[]
    logro_samples: number[]
    student_rows: number
    subjects: Set<string>
  }
  const courseMap = new Map<string, CourseAgg>()

  for (const e of evalRows) {
    const ck = courseKeyFromEval(e)
    const cl = courseLabelFromEval(e)
    let agg = courseMap.get(ck)
    if (!agg) {
      agg = {
        course_key: ck,
        course_label: cl,
        evaluation_ids: [],
        grade_samples: [],
        logro_samples: [],
        student_rows: 0,
        subjects: new Set(),
      }
      courseMap.set(ck, agg)
    }
    const subj = String(e.subject ?? "").trim()
    if (subj) agg.subjects.add(subj)
    agg.evaluation_ids.push(e.id)
    const g = resolvedGrade(e.id)
    if (g != null && Number.isFinite(g)) agg.grade_samples.push(g)
    const lp = logroByEvalId.get(e.id)
    if (lp != null && Number.isFinite(lp)) agg.logro_samples.push(lp)
    agg.student_rows += studentsByEval.get(e.id)?.length ?? 0
    if (agg.course_label === "Sin curso" && cl !== "Sin curso") agg.course_label = cl
  }

  const courses = [...courseMap.values()]
    .map((c) => {
      const avg_grade =
        c.grade_samples.length > 0
          ? Math.round((c.grade_samples.reduce((a, b) => a + b, 0) / c.grade_samples.length) * 10) / 10
          : null
      const avg_logro =
        c.logro_samples.length > 0
          ? Math.round((c.logro_samples.reduce((a, b) => a + b, 0) / c.logro_samples.length) * 10) / 10
          : null
      return {
        course_key: c.course_key,
        course_label: c.course_label,
        evaluation_count: c.evaluation_ids.length,
        avg_grade_chile: avg_grade,
        avg_logro_pct: avg_logro,
        student_result_rows: c.student_rows,
        subjects: [...c.subjects].sort((x, y) => x.localeCompare(y, "es")),
      }
    })
    .sort((a, b) => b.evaluation_count - a.evaluation_count)

  function primaryStudentLabel(eid: string): string {
    const sum = summaryByEval.get(eid)
    const studs = studentsByEval.get(eid) ?? []
    if (studs.length === 1) {
      const one = studs[0]!.trim()
      if (one) return one
    }
    if (studs.length > 1) {
      const nonEmpty = studs.map((s) => s.trim()).filter(Boolean)
      if (nonEmpty.length >= 2) {
        const head = nonEmpty.slice(0, 2).join(" · ")
        return nonEmpty.length > 2 ? `${head} (+${nonEmpty.length - 2} más)` : head
      }
      if (nonEmpty.length === 1) return nonEmpty[0]!
    }
    const fromSummary = resolveStudentDisplayName({
      student_name: null,
      student_name_raw: sum?.student_name_raw ?? null,
      raw: sum?.raw,
    }).trim()
    if (fromSummary) return fromSummary
    return ""
  }

  const evaluations = evalRows.map((e) => {
    const sc = studentsByEval.get(e.id)?.length ?? 0
    const psl = primaryStudentLabel(e.id)
    const batch_id = normUuid(e.batch_id ?? null)
    const has_source_exam = e.source_exam_id != null && String(e.source_exam_id).trim() !== ""
    const examTagSource =
      e.exam_type != null && String(e.exam_type).trim() !== ""
        ? String(e.exam_type).trim()
        : e.assessment_category != null && String(e.assessment_category).trim() !== ""
          ? String(e.assessment_category).trim()
          : null
    const instrument_mode = getInstrumentAnalyticsModeFromExamType(examTagSource)
    return {
      id: e.id,
      title: e.title,
      subject: e.subject,
      course_key: courseKeyFromEval(e),
      course_label: courseLabelFromEval(e),
      evaluated_at: e.evaluated_at,
      student_count: sc,
      primary_student_label: psl,
      grade_chile: summaryByEval.get(e.id)?.grade_chile ?? null,
      logro_pct: logroByEvalId.get(e.id) ?? null,
      resolved_grade: resolvedGrade(e.id),
      batch_id,
      has_source_exam,
      exam_type: e.exam_type ?? null,
      assessment_category: e.assessment_category ?? null,
      instrument_mode,
    }
  })

  const at_risk: Array<{
    evaluation_id: string
    evaluation_title: string | null
    course_key: string
    course_label: string
    student_name: string
    grade_chile: number
    logro_pct: number | null
    evaluated_at: string | null
  }> = []

  for (const e of evalRows) {
    const rg = resolvedGrade(e.id)
    if (rg == null || !Number.isFinite(rg) || rg >= 4.0) continue
    const sum = summaryByEval.get(e.id)
    const studs = studentsByEval.get(e.id) ?? []
    const title = e.title
    const cl = courseLabelFromEval(e)
    const ck = courseKeyFromEval(e)
    const lp = logroByEvalId.get(e.id) ?? null
    let studentDisplay = ""
    const studsNonEmpty = studs.map((s) => s.trim()).filter(Boolean)
    if (studsNonEmpty.length === 0) {
      studentDisplay = resolveStudentDisplayName({
        student_name: null,
        student_name_raw: sum?.student_name_raw ?? null,
        raw: sum?.raw,
      }).trim()
    } else if (studsNonEmpty.length === 1) {
      studentDisplay = studsNonEmpty[0]!
    } else {
      studentDisplay = studsNonEmpty.join(" · ")
    }
    if (!studentDisplay) studentDisplay = "Alumno sin identificar"
    at_risk.push({
      evaluation_id: e.id,
      evaluation_title: title,
      course_key: ck,
      course_label: cl,
      student_name: studentDisplay,
      grade_chile: Math.round(rg * 10) / 10,
      logro_pct: lp,
      evaluated_at: e.evaluated_at ?? null,
    })
  }

  at_risk.sort((a, b) => a.grade_chile - b.grade_chile || a.student_name.localeCompare(b.student_name, "es"))

  return NextResponse.json({
    scope_mode: useSchoolScope ? "school" : "teacher",
    scope_label: useSchoolScope
      ? "Misma fuente que la pestaña Cursos: evaluaciones con school_id de tu perfil (todo el colegio en alcance)."
      : "Misma fuente que la pestaña Cursos sin school_id en perfil: evaluaciones con tu teacher_id.",
    profile_role: profileRole,
    school_id: schoolIdUsed,
    teacher_id: teacherIdNorm,
    courses,
    evaluations,
    at_risk: at_risk.slice(0, 60),
    truncated: evalRows.length >= MAX_EVALUATIONS,
  })
}
