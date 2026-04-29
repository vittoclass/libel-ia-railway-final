import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { normalizeCourseLabelForReports } from "@/app/lib/report-course-label"
import { resolveEvaluationPedagogy } from "@/app/lib/evaluation-pedagogy"

export const dynamic = "force-dynamic"

type SupabaseServerClient = NonNullable<ReturnType<typeof getSupabaseServer>>

type EvalRow = {
  id: string
  course_label: string | null
  course_id: string | null
  subject: string | null
  teacher_id: string | null
  source_exam_id: string | null
}

type SkillResultRow = {
  evaluation_id: string
  axis_id: string | null
  skill_id: string | null
  logro_pct: number | null
  score_obtained: number | null
  score_max: number | null
}

type SkillResultColumns = {
  hasEvaluationId: boolean
  hasAxisId: boolean
  hasSkillId: boolean
  hasLogroPct: boolean
  hasScoreObtained: boolean
  hasScoreMax: boolean
}

type SourceExamItemColumns = {
  hasSourceExamId: boolean
  hasItemNumber: boolean
  hasAxisId: boolean
  hasSkillId: boolean
  hasAxisLabel: boolean
  hasSkillLabel: boolean
}

type GroupMetricRow = {
  dimension: string
  logro_pct: number
  evaluation_count: number
  coverage_pct: number
}

type GroupAcc = {
  sumLogro: number
  countLogro: number
  evaluationIds: Set<string>
  pedagogicalEvalIds: Set<string>
}

const TOP_LIMIT = 10

/** Evita truncamiento: muchos evaluation_id en un solo .in() y tope de filas por respuesta PostgREST. */
const EVAL_ITEMS_EVAL_ID_CHUNK = 200
const EVAL_ITEMS_ROW_PAGE_SIZE = 1000

type EvaluationItemScoreRow = {
  evaluation_id: string
  question_number?: number | string | null
  score_obtained?: number | null
  score_max?: number | null
}

async function fetchAllEvaluationItemsForDemoReport(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  evalIds: string[],
): Promise<{ rows: EvaluationItemScoreRow[]; error: { message: string } | null }> {
  const rows: EvaluationItemScoreRow[] = []
  for (let i = 0; i < evalIds.length; i += EVAL_ITEMS_EVAL_ID_CHUNK) {
    const chunk = evalIds.slice(i, i + EVAL_ITEMS_EVAL_ID_CHUNK)
    if (chunk.length === 0) continue
    let offset = 0
    while (true) {
      const { data: page, error } = await supabase
        .from("evaluation_items")
        .select("evaluation_id, question_number, score_obtained, score_max")
        .in("evaluation_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + EVAL_ITEMS_ROW_PAGE_SIZE - 1)
      if (error) return { rows: [], error: { message: error.message } }
      const batch = (page ?? []) as EvaluationItemScoreRow[]
      rows.push(...batch)
      if (batch.length < EVAL_ITEMS_ROW_PAGE_SIZE) break
      offset += EVAL_ITEMS_ROW_PAGE_SIZE
    }
  }
  return { rows, error: null }
}

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function canAccess(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

function evalLogroPct(obtained: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0
  if (!Number.isFinite(obtained)) return 0
  return (obtained / max) * 100
}

function toPercent1(v: number): number {
  return Math.round(v * 10) / 10
}

function normalizeQuestionNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value)
    return n > 0 ? n : null
  }
  const raw = String(value ?? "").trim()
  if (!raw) return null
  const match = raw.match(/(\d+)/)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n)) return null
  const out = Math.trunc(n)
  return out > 0 ? out : null
}

function normalizeSubjectLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim()
  if (!raw) return "Sin asignatura"
  const key = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
  if (key === "matematicas" || key === "matematica") return "Matemática"
  if (key === "lenguaje y comunicacion" || key === "lenguaje") return "Lenguaje"
  return raw
}

/** Etiqueta de persona: trim, sin null ni cadenas vacías. */
function normalizePersonLabel(value: string | null | undefined): string {
  return String(value ?? "").trim()
}

/**
 * Resuelve etiqueta por docente para agregación UTP (solo lectura).
 * Prioridad: profiles.full_name con user_id = teacher_id de evaluación, luego profiles.teacher_id, luego teachers.name.
 * Fallback estable: Docente 1…N ordenado por UUID (teacher_id) lexicográfico; sin teacher_id al final.
 */
async function resolveTeacherLabelsForUtpDemo(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  evaluationTeacherIds: string[],
  hasEvalsWithoutTeacher: boolean,
): Promise<{ labelByTeacherId: Map<string, string>; anonymousTeacherLabel: string | null }> {
  const uniqueSorted = [...new Set(evaluationTeacherIds.map((id) => normalizePersonLabel(id)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )

  const resolvedReal = new Map<string, string>()
  const pickFirst = (...candidates: (string | undefined)[]) => {
    for (const c of candidates) {
      const s = normalizePersonLabel(c)
      if (s) return s
    }
    return ""
  }

  if (uniqueSorted.length > 0) {
    const [byUserRes, byTeacherRes, teachersRes] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name").in("user_id", uniqueSorted),
      supabase.from("profiles").select("teacher_id, full_name").in("teacher_id", uniqueSorted),
      supabase.from("teachers").select("id, name").in("id", uniqueSorted),
    ])

    const nameByProfileUserId = new Map<string, string>()
    if (!byUserRes.error && byUserRes.data) {
      for (const row of byUserRes.data as Array<{ user_id?: string | null; full_name?: string | null }>) {
        const uid = normalizePersonLabel(row.user_id)
        const fn = normalizePersonLabel(row.full_name)
        if (uid && fn) nameByProfileUserId.set(uid, fn)
      }
    }

    const nameByProfileTeacherId = new Map<string, string>()
    if (!byTeacherRes.error && byTeacherRes.data) {
      for (const row of byTeacherRes.data as Array<{ teacher_id?: string | null; full_name?: string | null }>) {
        const tid = normalizePersonLabel(row.teacher_id)
        const fn = normalizePersonLabel(row.full_name)
        if (tid && fn) nameByProfileTeacherId.set(tid, fn)
      }
    }

    const nameByTeachersTable = new Map<string, string>()
    if (!teachersRes.error && teachersRes.data) {
      for (const row of teachersRes.data as Array<{ id?: string | null; name?: string | null }>) {
        const id = normalizePersonLabel(row.id)
        const n = normalizePersonLabel(row.name)
        if (id && n) nameByTeachersTable.set(id, n)
      }
    }

    for (const tid of uniqueSorted) {
      const label = pickFirst(
        nameByProfileUserId.get(tid),
        nameByProfileTeacherId.get(tid),
        nameByTeachersTable.get(tid),
      )
      if (label) resolvedReal.set(tid, label)
    }
  }

  const labelByTeacherId = new Map<string, string>(resolvedReal)
  let seq = 0
  for (const tid of uniqueSorted) {
    if (!labelByTeacherId.has(tid)) {
      seq += 1
      labelByTeacherId.set(tid, `Docente ${seq}`)
    }
  }

  let anonymousTeacherLabel: string | null = null
  if (hasEvalsWithoutTeacher) {
    seq += 1
    anonymousTeacherLabel = `Docente ${seq}`
  }

  return { labelByTeacherId, anonymousTeacherLabel }
}

function addGroupValue(map: Map<string, GroupAcc>, key: string, evalId: string, logroPct: number, pedagogical: boolean) {
  const safeKey = key.trim() || "Sin dato"
  const acc = map.get(safeKey) ?? {
    sumLogro: 0,
    countLogro: 0,
    evaluationIds: new Set<string>(),
    pedagogicalEvalIds: new Set<string>(),
  }
  acc.sumLogro += logroPct
  acc.countLogro += 1
  acc.evaluationIds.add(evalId)
  if (pedagogical) acc.pedagogicalEvalIds.add(evalId)
  map.set(safeKey, acc)
}

function buildMetricRows(map: Map<string, GroupAcc>, opts?: { hideNoData?: boolean; limit?: number }): GroupMetricRow[] {
  const hideNoData = opts?.hideNoData ?? false
  const limit = opts?.limit ?? TOP_LIMIT
  return [...map.entries()]
    .map(([dimension, acc]) => {
      const avg = acc.countLogro > 0 ? acc.sumLogro / acc.countLogro : 0
      const evalCount = acc.evaluationIds.size
      const coverage = evalCount > 0 ? (acc.pedagogicalEvalIds.size / evalCount) * 100 : 0
      return {
        dimension,
        logro_pct: toPercent1(avg),
        evaluation_count: evalCount,
        coverage_pct: toPercent1(coverage),
      }
    })
    .filter((row) => (hideNoData ? row.dimension !== "Sin curso" && row.dimension !== "Sin asignatura" : true))
    .sort((a, b) => b.logro_pct - a.logro_pct)
    .slice(0, Math.max(1, limit))
}

type PedagogyAcc = {
  obtained: number
  max: number
  fallbackPctSum: number
  fallbackCount: number
  evaluationIds: Set<string>
}

function addPedagogyValue(map: Map<string, PedagogyAcc>, key: string, row: SkillResultRow) {
  const safeKey = key.trim() || "Sin dato"
  const acc = map.get(safeKey) ?? {
    obtained: 0,
    max: 0,
    fallbackPctSum: 0,
    fallbackCount: 0,
    evaluationIds: new Set<string>(),
  }
  const scoreMax = Number(row.score_max)
  const scoreObt = Number(row.score_obtained)
  if (Number.isFinite(scoreMax) && scoreMax > 0 && Number.isFinite(scoreObt)) {
    acc.obtained += scoreObt
    acc.max += scoreMax
  } else {
    const pct = Number(row.logro_pct)
    if (Number.isFinite(pct)) {
      acc.fallbackPctSum += pct
      acc.fallbackCount += 1
    }
  }
  acc.evaluationIds.add(String(row.evaluation_id))
  map.set(safeKey, acc)
}

function buildPedagogyMetricRows(map: Map<string, PedagogyAcc>, totalEvaluationsInScope: number): GroupMetricRow[] {
  return [...map.entries()]
    .map(([dimension, acc]) => {
      let logro = 0
      if (acc.max > 0) logro = evalLogroPct(acc.obtained, acc.max)
      else if (acc.fallbackCount > 0) logro = acc.fallbackPctSum / acc.fallbackCount
      const coverage =
        totalEvaluationsInScope > 0 ? (acc.evaluationIds.size / totalEvaluationsInScope) * 100 : 0
      return {
        dimension,
        logro_pct: toPercent1(logro),
        evaluation_count: acc.evaluationIds.size,
        coverage_pct: toPercent1(coverage),
      }
    })
    .sort((a, b) => b.logro_pct - a.logro_pct)
    .slice(0, TOP_LIMIT)
}

function addPedagogyValueFromScores(
  map: Map<string, PedagogyAcc>,
  key: string,
  evaluationId: string,
  scoreObtained: number,
  scoreMax: number,
) {
  const safeKey = key.trim() || "Sin dato"
  const acc = map.get(safeKey) ?? {
    obtained: 0,
    max: 0,
    fallbackPctSum: 0,
    fallbackCount: 0,
    evaluationIds: new Set<string>(),
  }
  if (Number.isFinite(scoreMax) && scoreMax > 0 && Number.isFinite(scoreObtained)) {
    acc.obtained += scoreObtained
    acc.max += scoreMax
  }
  acc.evaluationIds.add(evaluationId)
  map.set(safeKey, acc)
}

async function readEvaluationSkillResultsColumns(supabase: SupabaseServerClient): Promise<SkillResultColumns> {
  const defaults: SkillResultColumns = {
    hasEvaluationId: false,
    hasAxisId: false,
    hasSkillId: false,
    hasLogroPct: false,
    hasScoreObtained: false,
    hasScoreMax: false,
  }
  try {
    const { data: cols } = await supabase
      .from("information_schema.columns")
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", "evaluation_skill_results")

    const names = new Set(
      ((cols ?? []) as Array<{ column_name?: string | null }>)
        .map((c) => String(c.column_name ?? "").trim())
        .filter(Boolean),
    )
    return {
      hasEvaluationId: names.has("evaluation_id"),
      hasAxisId: names.has("axis_id"),
      hasSkillId: names.has("skill_id"),
      hasLogroPct: names.has("logro_pct"),
      hasScoreObtained: names.has("score_obtained"),
      hasScoreMax: names.has("score_max"),
    }
  } catch {
    return defaults
  }
}

async function readSourceExamItemsColumns(supabase: SupabaseServerClient): Promise<SourceExamItemColumns> {
  const defaults: SourceExamItemColumns = {
    hasSourceExamId: false,
    hasItemNumber: false,
    hasAxisId: false,
    hasSkillId: false,
    hasAxisLabel: false,
    hasSkillLabel: false,
  }
  try {
    const { data: cols } = await supabase
      .from("information_schema.columns")
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", "source_exam_items")
    const names = new Set(
      ((cols ?? []) as Array<{ column_name?: string | null }>)
        .map((c) => String(c.column_name ?? "").trim())
        .filter(Boolean),
    )
    return {
      hasSourceExamId: names.has("source_exam_id"),
      hasItemNumber: names.has("item_number"),
      hasAxisId: names.has("axis_id"),
      hasSkillId: names.has("skill_id"),
      hasAxisLabel: names.has("axis_label"),
      hasSkillLabel: names.has("skill_label"),
    }
  } catch {
    return defaults
  }
}

export async function GET(_req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

    const supabase = getSupabaseServer()
    if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, organization_id, school_id, teacher_id")
      .eq("user_id", user.id)
      .maybeSingle()

    const role = normalizeRole((profile as { role?: string | null } | null)?.role)
    if (!isMasterEmail(user.email) && !canAccess(role)) {
      return NextResponse.json({ error: "Prohibido" }, { status: 403 })
    }

    const schoolId = (profile as { school_id?: string | null } | null)?.school_id ?? null
    const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null
    const teacherId = (profile as { teacher_id?: string | null } | null)?.teacher_id ?? null

    let evalQuery = supabase
      .from("evaluations")
      .select("id, course_label, course_id, subject, teacher_id, source_exam_id")
      .eq("is_archived", false)
      .order("evaluated_at", { ascending: false })
      .limit(1000)

    if (schoolId) {
      evalQuery = evalQuery.eq("school_id", schoolId)
    } else if (orgId) {
      const { data: peers } = await supabase
        .from("profiles")
        .select("teacher_id")
        .eq("organization_id", orgId)
        .not("teacher_id", "is", null)
      const tids = [...new Set((peers ?? []).map((p: { teacher_id?: string | null }) => p.teacher_id).filter(Boolean))] as string[]
      if (tids.length > 0) evalQuery = evalQuery.in("teacher_id", tids)
      else if (teacherId) evalQuery = evalQuery.eq("teacher_id", teacherId)
      else return NextResponse.json({ sections: {}, meta: { evaluations_in_scope: 0 } })
    } else if (teacherId) {
      evalQuery = evalQuery.eq("teacher_id", teacherId)
    } else {
      return NextResponse.json({ sections: {}, meta: { evaluations_in_scope: 0 } })
    }

    const { data: evaluations, error: evalErr } = await evalQuery
    if (evalErr) return NextResponse.json({ error: evalErr.message }, { status: 500 })

    const evalRows = (evaluations ?? []) as EvalRow[]
    const evalIds = evalRows.map((e) => String(e.id)).filter(Boolean)
    if (evalIds.length === 0) {
      return NextResponse.json({
        sections: {
          by_course: [],
          by_subject: [],
          by_teacher: [],
          by_axis: [],
          by_skill: [],
        },
        meta: {
          evaluations_in_scope: 0,
          pedagogical_evaluation_count: 0,
          pedagogical_coverage_pct: 0,
          has_pedagogical_data: false,
        },
      })
    }

    const { rows: itemRowsTyped, error: itemErr } = await fetchAllEvaluationItemsForDemoReport(supabase, evalIds)
    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

    const totalsByEval = new Map<string, { obtained: number; max: number }>()
    for (const row of itemRowsTyped) {
      const id = String(row.evaluation_id)
      const current = totalsByEval.get(id) ?? { obtained: 0, max: 0 }
      current.obtained += Number(row.score_obtained) || 0
      current.max += Number(row.score_max) || 0
      totalsByEval.set(id, current)
    }

    const skillColumns = await readEvaluationSkillResultsColumns(supabase)
    let skillRows: SkillResultRow[] = []
    if (skillColumns.hasEvaluationId) {
      const selectCols = [
        "evaluation_id",
        ...(skillColumns.hasAxisId ? ["axis_id"] : []),
        ...(skillColumns.hasSkillId ? ["skill_id"] : []),
        ...(skillColumns.hasLogroPct ? ["logro_pct"] : []),
        ...(skillColumns.hasScoreObtained ? ["score_obtained"] : []),
        ...(skillColumns.hasScoreMax ? ["score_max"] : []),
      ].join(", ")
      const { data: skillRowsRaw, error: skillErr } = await supabase
        .from("evaluation_skill_results")
        .select(selectCols)
        .in("evaluation_id", evalIds)
      if (skillErr) {
        skillRows = []
      } else {
        skillRows = ((skillRowsRaw ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
          evaluation_id: String(r.evaluation_id ?? ""),
          axis_id: skillColumns.hasAxisId ? (r.axis_id != null ? String(r.axis_id) : null) : null,
          skill_id: skillColumns.hasSkillId ? (r.skill_id != null ? String(r.skill_id) : null) : null,
          logro_pct: skillColumns.hasLogroPct ? (Number.isFinite(Number(r.logro_pct)) ? Number(r.logro_pct) : null) : null,
          score_obtained: skillColumns.hasScoreObtained
            ? (Number.isFinite(Number(r.score_obtained)) ? Number(r.score_obtained) : null)
            : null,
          score_max: skillColumns.hasScoreMax ? (Number.isFinite(Number(r.score_max)) ? Number(r.score_max) : null) : null,
        }))
      }
    }
    const pedagogicalEvalIds = new Set(skillRows.map((r) => String(r.evaluation_id)))
    let pedagogySource: "evaluation_skill_results" | "source_exam_items_fallback" | "none" = "none"
    const fallbackDebug = {
      evaluation_ids_count: evalIds.length,
      evaluations_with_source_exam: 0,
      source_exam_ids_count: 0,
      evaluation_items_count: itemRowsTyped.length,
      source_exam_items_count: 0,
      matched_items_count: 0,
      rows_with_axis_label: 0,
      rows_with_skill_label: 0,
      rows_with_score: 0,
      axis_groups_count: 0,
      skill_groups_count: 0,
      sample_question_numbers: [] as string[],
      sample_item_numbers: [] as string[],
    }

    const teacherIdsFromEvals = evalRows.map((e) => String(e.teacher_id ?? "").trim()).filter(Boolean)
    const hasEvalsWithoutTeacher = evalRows.some((e) => !String(e.teacher_id ?? "").trim())
    const { labelByTeacherId, anonymousTeacherLabel } = await resolveTeacherLabelsForUtpDemo(
      supabase,
      teacherIdsFromEvals,
      hasEvalsWithoutTeacher,
    )

    const byCourse = new Map<string, GroupAcc>()
    const bySubject = new Map<string, GroupAcc>()
    const byTeacher = new Map<string, GroupAcc>()

    for (const e of evalRows) {
      const id = String(e.id)
      const totals = totalsByEval.get(id) ?? { obtained: 0, max: 0 }
      const logro = evalLogroPct(totals.obtained, totals.max)
      const hasPedagogy = pedagogicalEvalIds.has(id)

      const courseLabel = normalizeCourseLabelForReports(
        String(e.course_label ?? "").trim() || String(e.course_id ?? "").trim(),
      )
      const subjectLabel = normalizeSubjectLabel(e.subject)
      const teacherKey = String(e.teacher_id ?? "").trim()
      const teacherLabel = teacherKey
        ? (labelByTeacherId.get(teacherKey) ?? "Docente")
        : (anonymousTeacherLabel ?? "Docente")

      addGroupValue(byCourse, courseLabel, id, logro, hasPedagogy)
      addGroupValue(bySubject, subjectLabel, id, logro, hasPedagogy)
      addGroupValue(byTeacher, teacherLabel, id, logro, hasPedagogy)
    }
    const axisIds = skillColumns.hasAxisId
      ? ([...new Set(skillRows.map((r) => r.axis_id).filter(Boolean))] as string[])
      : []
    const skillIds = [...new Set(skillRows.map((r) => r.skill_id).filter(Boolean))] as string[]
    const axisMap = new Map<string, string>()
    const skillMap = new Map<string, string>()

    if (skillColumns.hasAxisId && axisIds.length > 0) {
      const { data: axisRows } = await supabase.from("pedagogy_axes").select("id, name").in("id", axisIds)
      for (const row of (axisRows ?? []) as Array<{ id: string; name?: string | null }>) {
        axisMap.set(String(row.id), String(row.name ?? "").trim() || String(row.id))
      }
    }
    if (skillIds.length > 0) {
      const { data: skRows } = await supabase.from("pedagogy_skills").select("id, name").in("id", skillIds)
      for (const row of (skRows ?? []) as Array<{ id: string; name?: string | null }>) {
        skillMap.set(String(row.id), String(row.name ?? "").trim() || String(row.id))
      }
    }

    const byAxis = new Map<string, PedagogyAcc>()
    const bySkill = new Map<string, PedagogyAcc>()
    const level1Usable = skillRows.length > 0 && (skillColumns.hasAxisId || skillColumns.hasSkillId)
    if (level1Usable) {
      for (const row of skillRows) {
        if (skillColumns.hasAxisId) {
          const axisLabel = row.axis_id ? axisMap.get(String(row.axis_id)) ?? String(row.axis_id) : "Sin eje"
          addPedagogyValue(byAxis, axisLabel, row)
        }
        if (skillColumns.hasSkillId) {
          const skillLabel = row.skill_id ? skillMap.get(String(row.skill_id)) ?? String(row.skill_id) : "Sin habilidad"
          addPedagogyValue(bySkill, skillLabel, row)
        }
      }
      if (byAxis.size > 0 || bySkill.size > 0) {
        pedagogySource = "evaluation_skill_results"
      }
    }

    if (pedagogySource === "none") {
      const evalItemsByEvalId = new Map<string, Array<{ question_number: number; score_obtained: number; score_max: number }>>()
      for (const it of itemRowsTyped) {
        const evalId = String(it.evaluation_id ?? "").trim()
        if (!evalId) continue
        const qn = normalizeQuestionNumber(it.question_number)
        if (qn == null) continue
        const list = evalItemsByEvalId.get(evalId) ?? []
        list.push({
          question_number: qn,
          score_obtained: Number(it.score_obtained) || 0,
          score_max: Number(it.score_max) || 0,
        })
        evalItemsByEvalId.set(evalId, list)
      }

      const sourceExamIdsSet = new Set<string>()
      for (const e of evalRows) {
        const evalId = String(e.id)
        const pedagogical = await resolveEvaluationPedagogy(supabase, { id: evalId }, { evaluationItems: evalItemsByEvalId.get(evalId) ?? [] })
        if (!pedagogical.has_source_exam) continue
        fallbackDebug.evaluations_with_source_exam += 1
        if (pedagogical.source_exam_id) sourceExamIdsSet.add(pedagogical.source_exam_id)
        fallbackDebug.source_exam_items_count += pedagogical.source_exam_items.length
        fallbackDebug.matched_items_count += pedagogical.matched_items_count
        for (const row of pedagogical.analysis.by_question) {
          if (fallbackDebug.sample_question_numbers.length < 8) {
            fallbackDebug.sample_question_numbers.push(String(row.item_number))
          }
        }
        for (const src of pedagogical.source_exam_items) {
          if (fallbackDebug.sample_item_numbers.length < 8) {
            fallbackDebug.sample_item_numbers.push(String(src.item_number ?? ""))
          }
        }
        for (const axis of pedagogical.analysis.by_axis) {
          const label = String(axis.dimension_value ?? "").trim()
          if (label) {
            fallbackDebug.rows_with_axis_label += 1
            addPedagogyValueFromScores(byAxis, label, evalId, Number(axis.score_obtained) || 0, Number(axis.score_max) || 0)
          }
        }
        for (const skill of pedagogical.analysis.by_skill) {
          const label = String(skill.dimension_value ?? "").trim()
          if (label) {
            fallbackDebug.rows_with_skill_label += 1
            addPedagogyValueFromScores(bySkill, label, evalId, Number(skill.score_obtained) || 0, Number(skill.score_max) || 0)
          }
        }
        if (pedagogical.analysis.by_question.some((q) => Number.isFinite(Number(q.score_max)) && Number(q.score_max) > 0)) {
          fallbackDebug.rows_with_score += 1
        }
      }

      fallbackDebug.source_exam_ids_count = sourceExamIdsSet.size
      fallbackDebug.axis_groups_count = byAxis.size
      fallbackDebug.skill_groups_count = bySkill.size
      if (byAxis.size > 0 || bySkill.size > 0) {
        pedagogySource = "source_exam_items_fallback"
      }
    }

    const pedagogicalCoverage =
      evalIds.length > 0 ? toPercent1((pedagogicalEvalIds.size / evalIds.length) * 100) : 0
    const hasPedagogicalData = byAxis.size > 0 || bySkill.size > 0

    /** Diagnóstico temporal: agregación por teacher_id real (no por etiqueta de UI). No afecta sections.* */
    const itemCountByEval = new Map<string, number>()
    for (const it of itemRowsTyped) {
      const eid = String(it.evaluation_id ?? "").trim()
      if (!eid) continue
      itemCountByEval.set(eid, (itemCountByEval.get(eid) ?? 0) + 1)
    }
    type DebugTeacherAcc = {
      teacher_id: string
      teacher_name: string
      evaluationIds: Set<string>
      item_count: number
      sum_score_obtained: number
      sum_score_max: number
    }
    const debugTeacherAcc = new Map<string, DebugTeacherAcc>()
    for (const e of evalRows) {
      const eid = String(e.id)
      const tidRaw = String(e.teacher_id ?? "").trim()
      const tidKey = tidRaw || "__no_teacher__"
      const teacherName = tidRaw
        ? (labelByTeacherId.get(tidRaw) ?? "Docente")
        : (anonymousTeacherLabel ?? "Docente")
      const totals = totalsByEval.get(eid) ?? { obtained: 0, max: 0 }
      const ic = itemCountByEval.get(eid) ?? 0
      const cur: DebugTeacherAcc =
        debugTeacherAcc.get(tidKey) ??
        ({
          teacher_id: tidRaw || "",
          teacher_name: teacherName,
          evaluationIds: new Set<string>(),
          item_count: 0,
          sum_score_obtained: 0,
          sum_score_max: 0,
        } satisfies DebugTeacherAcc)
      cur.evaluationIds.add(eid)
      cur.item_count += ic
      cur.sum_score_obtained += totals.obtained
      cur.sum_score_max += totals.max
      cur.teacher_name = teacherName
      debugTeacherAcc.set(tidKey, cur)
    }
    const debug_teacher_rows = [...debugTeacherAcc.values()].map((acc) => ({
      teacher_id: acc.teacher_id || null,
      teacher_name: acc.teacher_name,
      evaluation_count: acc.evaluationIds.size,
      item_count: acc.item_count,
      sum_score_obtained: acc.sum_score_obtained,
      sum_score_max: acc.sum_score_max,
      computed_logro_pct: toPercent1(evalLogroPct(acc.sum_score_obtained, acc.sum_score_max)),
    }))

    return NextResponse.json({
      sections: {
        by_course: buildMetricRows(byCourse, { hideNoData: false, limit: TOP_LIMIT }),
        by_subject: buildMetricRows(bySubject, { hideNoData: false, limit: TOP_LIMIT }),
        by_teacher: buildMetricRows(byTeacher, { hideNoData: false, limit: TOP_LIMIT }),
        by_axis: buildPedagogyMetricRows(byAxis, evalIds.length),
        by_skill: buildPedagogyMetricRows(bySkill, evalIds.length),
      },
      meta: {
        evaluations_in_scope: evalIds.length,
        pedagogical_evaluation_count: pedagogicalEvalIds.size,
        pedagogical_coverage_pct: pedagogicalCoverage,
        has_pedagogical_data: hasPedagogicalData,
        pedagogical_source: pedagogySource,
        fallback_debug: fallbackDebug,
        debug_teacher_rows,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error inesperado" },
      { status: 500 },
    )
  }
}
