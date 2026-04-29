import { NextResponse } from "next/server"
import {
  aggregateCourseSummary,
  analyzeLearningResults,
  type CoursePedagogicalSummary,
  type EvaluationItemRow,
  type SourceExamItemWithPedagogy,
} from "@/app/lib/analyze-learning-results"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import { getInstrumentAnalyticsModeFromEvaluationTags } from "@/app/lib/assessment-category"
import { normUuid } from "@/app/lib/evaluation-read-scope"
import { projectPaesFromLogroPct, projectSimceFromLogroPct } from "@/app/lib/standard-scale-converters"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const MAX_EVALUATIONS = 500
const ITEMS_CHUNK = 120
const SOURCE_EXAM_CHUNK = 80
const TREND_FLAT_EPS_PCT = 2

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type EvalRow = {
  id: string
  course_label: string | null
  subject: string | null
  exam_type?: string | null
  assessment_category?: string | null
  source_exam_id?: string | null
  evaluated_at?: string | null
}

type TestTypeKey = "SIMCE" | "PAES" | "Interna"

type Agg = { obtained: number; max: number; evalIds: Set<string> }
type ComparisonSemaphore = "superior" | "similar" | "below" | "neutral"
type ByTestTypeCourseItem = { course_label: string; logro_pct: number | null; evaluation_count: number }
type ByTestTypeCourse = Record<TestTypeKey, ByTestTypeCourseItem[]>
type AlertLevel = "info" | "warning" | "critical"
type AlertTrend = "up" | "flat" | "down"
type AlertItem = {
  level: AlertLevel
  code: string
  message: string
  confidence: number
  course_label?: string
  axis_label?: string
  logro_pct?: number | null
  by_skill?: Array<{ skill_label?: string; logro_pct?: number | null }>
  trend?: AlertTrend
}
type CourseScoreAgg = { scores: number[]; maxSet: Set<number>; evalIds: Set<string> }
type ScoreByTypeCourse = {
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

type NationalProjectedCourseAgg = {
  projectedScores: number[]
  evalIds: Set<string>
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sum = nums.reduce((acc, n) => acc + n, 0)
  return sum / nums.length
}

function semaphoreFromLogroPct(pct: number | null): "green" | "yellow" | "red" | "neutral" {
  if (pct == null || !Number.isFinite(pct)) return "neutral"
  if (pct >= 70) return "green"
  if (pct >= 50) return "yellow"
  return "red"
}

function logroFromAgg(agg: Pick<Agg, "obtained" | "max">): number | null {
  const max = agg.max
  if (!(max > 0)) return null
  return Math.round((agg.obtained / max) * 10000) / 100
}

function comparisonSemaphoreFromDiff(diffPct: number | null): ComparisonSemaphore {
  if (diffPct == null || !Number.isFinite(diffPct)) return "neutral"
  if (diffPct >= 5) return "superior"
  if (diffPct <= -5) return "below"
  return "similar"
}

/** Etiqueta curso para agrupar y mostrar: 2°A, 2 º A → 2A; UUID / vacío → Sin curso. */
function normalizeCourseDisplay(raw: string | null | undefined): string {
  const t = raw != null ? String(raw).trim() : ""
  if (!t || UUID_RE.test(t)) return "Sin curso"
  let s = t.replace(/[º°]/g, "")
  s = s.replace(/\s+/g, " ").trim()
  s = s.replace(/(\d)\s+([A-Za-zÀ-ÿ])/gi, "$1$2")
  s = s.replace(/\s/g, "")
  const m = s.match(/^(\d+)([A-Za-zÀ-ÿ]+)$/u)
  if (m) return `${m[1]}${m[2].toUpperCase()}`
  if (s.length > 0) return s
  return "Sin curso"
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "")
}

/** Asignatura para agrupar y mostrar (sin UUID). */
function normalizeSubjectDisplay(raw: string | null | undefined): string {
  const t = raw != null ? String(raw).trim() : ""
  if (!t || UUID_RE.test(t)) return "Sin asignatura"
  const low = stripAccents(t.toLowerCase())
  if (low.includes("lenguaje") && low.includes("comunicacion")) return "Lenguaje"
  if (/matematicas?/.test(low)) return "Matemática"
  const cleaned = t.replace(/\s+/g, " ").trim()
  if (!cleaned) return "Sin asignatura"
  return cleaned
}

function testTypeFromEval(e: Pick<EvalRow, "exam_type" | "assessment_category">): TestTypeKey {
  const mode = getInstrumentAnalyticsModeFromEvaluationTags(e.exam_type ?? null, e.assessment_category ?? null)
  if (mode === "SIMCE") return "SIMCE"
  if (mode === "PAES") return "PAES"
  return "Interna"
}

function evalDateMs(iso: string | null | undefined): number {
  if (iso == null || String(iso).trim() === "") return NaN
  const t = Date.parse(String(iso))
  return Number.isFinite(t) ? t : NaN
}

function weakestAxisLabelFromSummary(summary: CoursePedagogicalSummary | undefined): string | undefined {
  if (!summary) return undefined
  const rows = summary.average_by_axis.filter((x) => x.score_max > 0 && x.logro_pct != null)
  if (rows.length === 0) return undefined
  const sorted = [...rows].sort((a, b) => Number(a.logro_pct) - Number(b.logro_pct))
  const nonPlaceholder = sorted.filter((r) => !/^SIN\s+EJE$/i.test(String(r.dimension_value).trim()))
  const pick = (nonPlaceholder.length > 0 ? nonPlaceholder : sorted)[0]
  return pick?.dimension_value
}

function weakestSkillEntriesFromSummary(
  summary: CoursePedagogicalSummary | undefined,
): Array<{ skill_label: string; logro_pct: number | null }> | undefined {
  if (!summary) return undefined
  const rows = summary.average_by_skill.filter((x) => x.score_max > 0 && x.logro_pct != null)
  if (rows.length === 0) return undefined
  const sorted = [...rows].sort((a, b) => Number(a.logro_pct) - Number(b.logro_pct))
  const filtered = sorted.filter((r) => !/^SIN\s+HABILIDAD$/i.test(String(r.dimension_value).trim()))
  const pick = (filtered.length > 0 ? filtered : sorted).slice(0, 2)
  if (pick.length === 0) return undefined
  return pick.map((r) => ({ skill_label: r.dimension_value, logro_pct: r.logro_pct }))
}

function trendForCourseInstrument(
  evalRows: EvalRow[],
  itemTotals: Map<string, { obtained: number; max: number }>,
  courseKey: string,
  instrument: "PAES" | "SIMCE",
): AlertTrend | undefined {
  const scored = evalRows
    .filter((e) => normalizeCourseDisplay(e.course_label) === courseKey && testTypeFromEval(e) === instrument)
    .map((e) => {
      const totals = itemTotals.get(e.id) ?? { obtained: 0, max: 0 }
      return {
        id: e.id,
        t: evalDateMs(e.evaluated_at),
        logro: logroFromAgg(totals),
      }
    })
    .filter((x) => x.logro != null && Number.isFinite(x.logro))

  scored.sort((a, b) => {
    const fa = Number.isFinite(a.t)
    const fb = Number.isFinite(b.t)
    if (fa && fb && a.t !== b.t) return b.t - a.t
    if (fa !== fb) return fa ? -1 : 1
    return b.id.localeCompare(a.id)
  })

  if (scored.length < 2) return undefined
  const last = scored[0]!.logro!
  const prev = scored[1]!.logro!
  const diff = last - prev
  if (diff > TREND_FLAT_EPS_PCT) return "up"
  if (diff < -TREND_FLAT_EPS_PCT) return "down"
  return "flat"
}

async function loadSourceExamItemsById(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseServer>>>,
  sourceExamIds: string[],
): Promise<Map<string, SourceExamItemWithPedagogy[]>> {
  const out = new Map<string, SourceExamItemWithPedagogy[]>()
  if (sourceExamIds.length === 0) return out

  const flat: SourceExamItemWithPedagogy[] = []
  for (let i = 0; i < sourceExamIds.length; i += SOURCE_EXAM_CHUNK) {
    const slice = sourceExamIds.slice(i, i + SOURCE_EXAM_CHUNK)
    const { data, error } = await supabase
      .from("source_exam_items")
      .select(
        "source_exam_id, item_number, item_text, axis_label, skill_label, cognitive_level, max_score, rubric_text, question_type",
      )
      .in("source_exam_id", slice)
    if (error) {
      console.warn("[teacher/overview] source_exam_items:", error.message)
      continue
    }
    for (const row of (data ?? []) as SourceExamItemWithPedagogy[]) {
      flat.push(row)
    }
  }

  for (const row of flat) {
    const sid = String((row as { source_exam_id?: string }).source_exam_id ?? "").trim()
    if (!sid) continue
    const list = out.get(sid) ?? []
    list.push(row)
    out.set(sid, list)
  }

  for (const [sid, rows] of out) {
    const sorted = [...rows].sort((a, b) => Number(a.item_number) - Number(b.item_number))
    out.set(sid, enrichItemsWithPedagogy(sorted))
  }
  return out
}

function buildCoursePedagogySummaries(
  evalRows: EvalRow[],
  itemsByEvaluationId: Map<string, EvaluationItemRow[]>,
  sourceByExamId: Map<string, SourceExamItemWithPedagogy[]>,
): Map<string, CoursePedagogicalSummary> {
  const analysesByCourse = new Map<string, ReturnType<typeof analyzeLearningResults>[]>()
  for (const e of evalRows) {
    const sid = String(e.source_exam_id ?? "").trim()
    if (!sid) continue
    const source = sourceByExamId.get(sid)
    if (!source || source.length === 0) continue
    const items = itemsByEvaluationId.get(e.id) ?? []
    if (items.length === 0) continue
    const analysis = analyzeLearningResults(e.id, items, source)
    if (analysis.by_question.length === 0) continue
    const ck = normalizeCourseDisplay(e.course_label)
    const list = analysesByCourse.get(ck) ?? []
    list.push(analysis)
    analysesByCourse.set(ck, list)
  }

  const summaries = new Map<string, CoursePedagogicalSummary>()
  for (const [ck, analyses] of analysesByCourse) {
    const s = aggregateCourseSummary(analyses)
    if (s) summaries.set(ck, s)
  }
  return summaries
}

function bumpAgg(map: Map<string, Agg>, key: string, evalId: string, obtained: number, max: number): void {
  let a = map.get(key)
  if (!a) {
    a = { obtained: 0, max: 0, evalIds: new Set() }
    map.set(key, a)
  }
  a.obtained += obtained
  a.max += max
  a.evalIds.add(evalId)
}

/**
 * GET /api/dashboard/teacher/overview
 * Solo lectura. Alcance únicamente por teacher_id del perfil (sin school_id).
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
    .select("teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacherIdRaw =
    profile?.teacher_id != null && String(profile.teacher_id).trim() !== "" ? String(profile.teacher_id).trim() : null
  const teacherIdNorm = normUuid(teacherIdRaw)
  const schoolIdNorm = normUuid(
    profile?.school_id != null && String(profile.school_id).trim() !== "" ? String(profile.school_id).trim() : null,
  )

  if (!teacherIdNorm) {
    const by_test_type_course: ByTestTypeCourse = { SIMCE: [], PAES: [], Interna: [] }
    const score_by_test_type_course: ScoreByTypeCourse = { PAES: [], SIMCE: [], Interna: [] }
    return NextResponse.json({
      has_teacher_id: false,
      global: { logro_pct: null, semaphore: "neutral" as const, total_evaluations: 0 },
      by_course: [],
      by_subject: [],
      by_test_type: [
        { key: "SIMCE" as const, count: 0, share_pct: 0 },
        { key: "PAES" as const, count: 0, share_pct: 0 },
        { key: "Interna" as const, count: 0, share_pct: 0 },
      ],
      by_test_type_course,
      score_by_test_type_course,
      insights: [],
      alerts: [],
      comparison: {
        teacher_logro_pct: null,
        school_logro_pct: null,
        diff_pct: null,
      },
      comparison_semaphore: "neutral" as const,
      has_school_id: schoolIdNorm != null,
    })
  }

  let evalQuery = supabase
    .from("evaluations")
    .select("id, course_label, subject, exam_type, assessment_category, is_archived, source_exam_id, evaluated_at")
    .eq("teacher_id", teacherIdNorm)
    .or("is_archived.is.null,is_archived.eq.false")
    .order("evaluated_at", { ascending: false, nullsFirst: false })
    .limit(MAX_EVALUATIONS)

  const { data: evalData, error: evErr } = await evalQuery

  if (evErr) {
    return NextResponse.json({ error: evErr.message }, { status: 500 })
  }

  const evalRows = ((evalData ?? []) as EvalRow[]).filter((r) => String((r as { id?: string }).id ?? "").trim() !== "")

  const ids = evalRows.map((e) => e.id)
  if (ids.length === 0) {
    const by_test_type_course: ByTestTypeCourse = { SIMCE: [], PAES: [], Interna: [] }
    const score_by_test_type_course: ScoreByTypeCourse = { PAES: [], SIMCE: [], Interna: [] }
    return NextResponse.json({
      has_teacher_id: true,
      global: { logro_pct: null, semaphore: "neutral" as const, total_evaluations: 0 },
      by_course: [],
      by_subject: [],
      by_test_type: [
        { key: "SIMCE" as const, count: 0, share_pct: 0 },
        { key: "PAES" as const, count: 0, share_pct: 0 },
        { key: "Interna" as const, count: 0, share_pct: 0 },
      ],
      by_test_type_course,
      score_by_test_type_course,
      insights: [],
      alerts: [],
      comparison: {
        teacher_logro_pct: null,
        school_logro_pct: null,
        diff_pct: null,
      },
      comparison_semaphore: "neutral" as const,
      has_school_id: schoolIdNorm != null,
    })
  }

  const itemTotals = new Map<string, { obtained: number; max: number }>()
  const itemsByEvaluationId = new Map<string, EvaluationItemRow[]>()
  for (let i = 0; i < ids.length; i += ITEMS_CHUNK) {
    const slice = ids.slice(i, i + ITEMS_CHUNK)
    const { data: itemRows } = await supabase
      .from("evaluation_items")
      .select("evaluation_id, question_number, score_obtained, score_max, is_correct")
      .in("evaluation_id", slice)
    for (const it of (itemRows ?? []) as Array<{
      evaluation_id: string
      question_number?: number | string | null
      score_obtained?: number | null
      score_max?: number | null
      is_correct?: boolean | null
    }>) {
      const key = String(it.evaluation_id)
      const cur = itemTotals.get(key) ?? { obtained: 0, max: 0 }
      cur.obtained += Number(it.score_obtained) || 0
      cur.max += Number(it.score_max) || 0
      itemTotals.set(key, cur)

      const qnRaw = it.question_number
      const qn = typeof qnRaw === "number" ? qnRaw : Number(qnRaw)
      if (Number.isFinite(qn) && qn >= 1) {
        const list = itemsByEvaluationId.get(key) ?? []
        list.push({
          question_number: qn,
          score_obtained: it.score_obtained,
          score_max: it.score_max,
          is_correct: it.is_correct,
        })
        itemsByEvaluationId.set(key, list)
      }
    }
  }

  const sourceExamIds = [
    ...new Set(
      evalRows.map((e) => String(e.source_exam_id ?? "").trim()).filter((x) => x.length > 0),
    ),
  ]
  const sourceByExamId = await loadSourceExamItemsById(supabase, sourceExamIds)
  const coursePedagogySummaries = buildCoursePedagogySummaries(evalRows, itemsByEvaluationId, sourceByExamId)

  const globalAgg: Agg = { obtained: 0, max: 0, evalIds: new Set() }
  const courseMap = new Map<string, Agg>()
  const subjectMap = new Map<string, Agg>()
  const testTypeCounts: Record<TestTypeKey, number> = { SIMCE: 0, PAES: 0, Interna: 0 }
  const testTypeCourseMap: Record<TestTypeKey, Map<string, Agg>> = {
    SIMCE: new Map<string, Agg>(),
    PAES: new Map<string, Agg>(),
    Interna: new Map<string, Agg>(),
  }
  const scoreTypeCourseMap: Record<TestTypeKey, Map<string, CourseScoreAgg>> = {
    SIMCE: new Map<string, CourseScoreAgg>(),
    PAES: new Map<string, CourseScoreAgg>(),
    Interna: new Map<string, CourseScoreAgg>(),
  }
  const nationalProjectedByCourse: {
    PAES: Map<string, NationalProjectedCourseAgg>
    SIMCE: Map<string, NationalProjectedCourseAgg>
  } = {
    PAES: new Map<string, NationalProjectedCourseAgg>(),
    SIMCE: new Map<string, NationalProjectedCourseAgg>(),
  }

  for (const e of evalRows) {
    const totals = itemTotals.get(e.id) ?? { obtained: 0, max: 0 }
    const obtained = totals.obtained
    const max = totals.max

    globalAgg.obtained += obtained
    globalAgg.max += max
    globalAgg.evalIds.add(e.id)

    const courseKey = normalizeCourseDisplay(e.course_label)
    bumpAgg(courseMap, courseKey, e.id, obtained, max)

    const subjKey = normalizeSubjectDisplay(e.subject)
    bumpAgg(subjectMap, subjKey, e.id, obtained, max)

    const tt = testTypeFromEval(e)
    testTypeCounts[tt] += 1
    bumpAgg(testTypeCourseMap[tt], courseKey, e.id, obtained, max)
    const logroPct = max > 0 ? (obtained / max) * 100 : null
    if (tt === "SIMCE" || tt === "PAES") {
      if (logroPct != null && Number.isFinite(logroPct)) {
        const projectedScore = tt === "SIMCE" ? projectSimceFromLogroPct(logroPct) : projectPaesFromLogroPct(logroPct)
        let projectedAgg = nationalProjectedByCourse[tt].get(courseKey)
        if (!projectedAgg) {
          projectedAgg = { projectedScores: [], evalIds: new Set<string>() }
          nationalProjectedByCourse[tt].set(courseKey, projectedAgg)
        }
        projectedAgg.projectedScores.push(projectedScore)
        projectedAgg.evalIds.add(e.id)
      }
    }

    let scoreAgg = scoreTypeCourseMap[tt].get(courseKey)
    if (!scoreAgg) {
      scoreAgg = { scores: [], maxSet: new Set<number>(), evalIds: new Set<string>() }
      scoreTypeCourseMap[tt].set(courseKey, scoreAgg)
    }
    scoreAgg.scores.push(obtained)
    if (max > 0) scoreAgg.maxSet.add(max)
    scoreAgg.evalIds.add(e.id)
  }

  const totalEvals = evalRows.length
  const globalLogro = logroFromAgg(globalAgg)
  let schoolLogro: number | null = null
  let diffPct: number | null = null
  if (schoolIdNorm) {
    const { data: schoolEvalData, error: schoolEvalErr } = await supabase
      .from("evaluations")
      .select("id, is_archived")
      .eq("school_id", schoolIdNorm)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("evaluated_at", { ascending: false, nullsFirst: false })
      .limit(MAX_EVALUATIONS)

    if (schoolEvalErr) {
      return NextResponse.json({ error: schoolEvalErr.message }, { status: 500 })
    }

    const schoolEvalIds = ((schoolEvalData ?? []) as Array<{ id: string }>).map((r) => String(r.id ?? "").trim()).filter(Boolean)
    if (schoolEvalIds.length > 0) {
      const schoolAgg: Agg = { obtained: 0, max: 0, evalIds: new Set() }
      for (let i = 0; i < schoolEvalIds.length; i += ITEMS_CHUNK) {
        const slice = schoolEvalIds.slice(i, i + ITEMS_CHUNK)
        const { data: schoolItemRows } = await supabase
          .from("evaluation_items")
          .select("evaluation_id, score_obtained, score_max")
          .in("evaluation_id", slice)
        for (const it of (schoolItemRows ?? []) as Array<{
          evaluation_id: string
          score_obtained?: number | null
          score_max?: number | null
        }>) {
          schoolAgg.obtained += Number(it.score_obtained) || 0
          schoolAgg.max += Number(it.score_max) || 0
          schoolAgg.evalIds.add(String(it.evaluation_id))
        }
      }
      schoolLogro = logroFromAgg(schoolAgg)
    }
  }
  if (globalLogro != null && schoolLogro != null) {
    diffPct = Math.round((globalLogro - schoolLogro) * 100) / 100
  }

  const by_course = [...courseMap.entries()]
    .map(([course_label, agg]) => {
      const lp = logroFromAgg(agg)
      return {
        course_label,
        logro_pct: lp,
        eval_count: agg.evalIds.size,
        semaphore: semaphoreFromLogroPct(lp),
      }
    })
    .sort((a, b) => b.eval_count - a.eval_count || a.course_label.localeCompare(b.course_label, "es"))

  const by_subject = [...subjectMap.entries()]
    .map(([subject_label, agg]) => ({
      subject_label,
      logro_pct: logroFromAgg(agg),
      eval_count: agg.evalIds.size,
    }))
    .sort((a, b) => (b.logro_pct ?? -1) - (a.logro_pct ?? -1) || a.subject_label.localeCompare(b.subject_label, "es"))

  const by_test_type: Array<{ key: TestTypeKey; count: number; share_pct: number }> = (["SIMCE", "PAES", "Interna"] as const).map(
    (key) => ({
      key,
      count: testTypeCounts[key],
      share_pct: totalEvals > 0 ? Math.round((testTypeCounts[key] / totalEvals) * 1000) / 10 : 0,
    }),
  )
  const by_test_type_course: ByTestTypeCourse = {
    SIMCE: [...testTypeCourseMap.SIMCE.entries()]
      .map(([course_label, agg]) => ({
        course_label,
        logro_pct: logroFromAgg(agg),
        evaluation_count: agg.evalIds.size,
      }))
      .sort((a, b) => b.evaluation_count - a.evaluation_count || a.course_label.localeCompare(b.course_label, "es")),
    PAES: [...testTypeCourseMap.PAES.entries()]
      .map(([course_label, agg]) => ({
        course_label,
        logro_pct: logroFromAgg(agg),
        evaluation_count: agg.evalIds.size,
      }))
      .sort((a, b) => b.evaluation_count - a.evaluation_count || a.course_label.localeCompare(b.course_label, "es")),
    Interna: [...testTypeCourseMap.Interna.entries()]
      .map(([course_label, agg]) => ({
        course_label,
        logro_pct: logroFromAgg(agg),
        evaluation_count: agg.evalIds.size,
      }))
      .sort((a, b) => b.evaluation_count - a.evaluation_count || a.course_label.localeCompare(b.course_label, "es")),
  }

  const score_by_test_type_course: ScoreByTypeCourse = {
    PAES: [...scoreTypeCourseMap.PAES.entries()]
      .map(([course_label, agg]) => {
        const projected = nationalProjectedByCourse.PAES.get(course_label)
        const vals = projected?.projectedScores ?? []
        const avg_score = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
        const min_score = vals.length ? Math.min(...vals) : null
        const max_score = vals.length ? Math.max(...vals) : null
        return {
          course_label,
          // Misma fuente/lógica que dashboard UTP/dirección: logro% (evaluation_items) -> escala PAES.
          avg_score,
          min_score,
          max_score,
          evaluation_count: agg.evalIds.size,
          standardized_score_available: vals.length > 0,
        }
      })
      .sort((a, b) => b.evaluation_count - a.evaluation_count || a.course_label.localeCompare(b.course_label, "es")),
    SIMCE: [...scoreTypeCourseMap.SIMCE.entries()]
      .map(([course_label, agg]) => {
        const projected = nationalProjectedByCourse.SIMCE.get(course_label)
        const vals = projected?.projectedScores ?? []
        const avg_score = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
        return {
          course_label,
          // Misma fuente/lógica que dashboard UTP/dirección: logro% (evaluation_items) -> escala SIMCE.
          avg_score,
          evaluation_count: agg.evalIds.size,
          standardized_score_available: vals.length > 0,
        }
      })
      .sort((a, b) => b.evaluation_count - a.evaluation_count || a.course_label.localeCompare(b.course_label, "es")),
    Interna: [...scoreTypeCourseMap.Interna.entries()]
      .map(([course_label, agg]) => {
        const avg = mean(agg.scores)
        if (avg == null || agg.maxSet.size !== 1) return null
        return {
          course_label,
          avg_score: round1(avg),
          evaluation_count: agg.evalIds.size,
        }
      })
      .filter((x): x is { course_label: string; avg_score: number; evaluation_count: number } => x != null)
      .sort((a, b) => b.avg_score - a.avg_score || a.course_label.localeCompare(b.course_label, "es")),
  }

  const insights: string[] = []
  const alerts: AlertItem[] = []

  if (globalLogro != null) {
    insights.push(`Tu logro global acumulado es ${round1(globalLogro).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%.`)
  }
  const strongestCourse = by_course[0]
  if (strongestCourse?.logro_pct != null) {
    insights.push(
      `El curso ${strongestCourse.course_label} concentra más evaluaciones (${strongestCourse.eval_count}) con logro ${round1(
        strongestCourse.logro_pct,
      ).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%.`,
    )
  }

  for (const row of by_test_type_course.PAES.slice(0, 2)) {
    if (row.logro_pct != null) {
      insights.push(
        `En ${row.course_label}, el logro interno en evaluaciones tipo PAES es ${round1(row.logro_pct).toLocaleString("es-CL", {
          maximumFractionDigits: 1,
        })}%.`,
      )
    }
  }
  for (const row of by_test_type_course.SIMCE.slice(0, 2)) {
    if (row.logro_pct != null) {
      insights.push(
        `En ${row.course_label}, el logro interno en evaluaciones tipo SIMCE es ${round1(row.logro_pct).toLocaleString("es-CL", {
          maximumFractionDigits: 1,
        })}%.`,
      )
    }
  }

  for (const row of by_test_type_course.PAES) {
    if ((row.logro_pct ?? 0) < 50 && row.evaluation_count > 0) {
      const courseKey = row.course_label
      const pedagogy = coursePedagogySummaries.get(courseKey)
      const axis_label = weakestAxisLabelFromSummary(pedagogy)
      const skillBlock = weakestSkillEntriesFromSummary(pedagogy)
      const trend = trendForCourseInstrument(evalRows, itemTotals, courseKey, "PAES")
      const alert: AlertItem = {
        level: "warning",
        code: "LOW_SCORE_PAES",
        message: `El curso ${row.course_label} presenta puntajes bajos en evaluaciones tipo PAES.`,
        confidence: 0.74,
        course_label: courseKey,
        logro_pct: row.logro_pct,
      }
      if (axis_label) alert.axis_label = axis_label
      if (skillBlock && skillBlock.length > 0) alert.by_skill = skillBlock
      if (trend) alert.trend = trend
      alerts.push(alert)
    }
  }
  for (const row of by_test_type_course.SIMCE) {
    if ((row.logro_pct ?? 0) < 50 && row.evaluation_count > 0) {
      const courseKey = row.course_label
      const pedagogy = coursePedagogySummaries.get(courseKey)
      const axis_label = weakestAxisLabelFromSummary(pedagogy)
      const skillBlock = weakestSkillEntriesFromSummary(pedagogy)
      const trend = trendForCourseInstrument(evalRows, itemTotals, courseKey, "SIMCE")
      const alert: AlertItem = {
        level: "warning",
        code: "LOW_SCORE_SIMCE",
        message: `El curso ${row.course_label} presenta puntajes bajos en evaluaciones tipo SIMCE.`,
        confidence: 0.74,
        course_label: courseKey,
        logro_pct: row.logro_pct,
      }
      if (axis_label) alert.axis_label = axis_label
      if (skillBlock && skillBlock.length > 0) alert.by_skill = skillBlock
      if (trend) alert.trend = trend
      alerts.push(alert)
    }
  }

  if (totalEvals > 0) {
    alerts.push({
      level: "info",
      code: "POSSIBLE_MISSING_STUDENTS",
      message:
        "Se detectan posibles estudiantes sin evaluación en algunos cursos. Esta es una señal preventiva y requiere verificación manual antes de tomar decisiones.",
      confidence: 0.42,
    })
  }

  return NextResponse.json({
    has_teacher_id: true,
    has_school_id: schoolIdNorm != null,
    global: {
      logro_pct: globalLogro,
      semaphore: semaphoreFromLogroPct(globalLogro),
      total_evaluations: totalEvals,
    },
    comparison: {
      teacher_logro_pct: globalLogro,
      school_logro_pct: schoolLogro,
      diff_pct: diffPct,
    },
    comparison_semaphore: comparisonSemaphoreFromDiff(diffPct),
    by_course,
    by_subject,
    by_test_type,
    by_test_type_course,
    score_by_test_type_course,
    insights,
    alerts,
    truncated: evalRows.length >= MAX_EVALUATIONS,
  })
}
