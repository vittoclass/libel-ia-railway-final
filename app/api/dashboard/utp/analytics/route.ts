import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { instrumentFamilyForEval } from "@/app/lib/pedagogy-segment-filters"
import {
  type EvaluationItemRow,
} from "@/app/lib/analyze-learning-results"
import { resolveEvaluationPedagogy } from "@/app/lib/evaluation-pedagogy"
import { normalizeCourseLabelForReports } from "@/app/lib/report-course-label"

export const dynamic = "force-dynamic"

type EvalRow = {
  id: string
  course_label: string | null
  course_id: string | null
  evaluated_at: string | null
  teacher_id?: string | null
  school_id?: string | null
  exam_type?: string | null
  assessment_category?: string | null
  source_exam_id?: string | null
}

type CourseSkillAcc = {
  obtained: number
  max: number
  fallbackPctSum: number
  fallbackCount: number
}

type SkillsCourseStatus = "has_low_skills" | "no_low_skills" | "no_pedagogical_data"
type CourseSkillsDebug = {
  course_label_normalized: string
  evaluation_count: number
  evaluations_with_source_exam: number
  evaluation_ids: string[]
  source_exam_ids: string[]
  evaluation_items_count: number
  source_exam_items_count: number
  matched_items_count: number
  skills_groups_count: number
  sample_question_numbers: number[]
  sample_item_numbers: number[]
}

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function canAccess(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

function toPercent1(v: number): number {
  return Math.round(v * 10) / 10
}

function evalLogroPct(obtained: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0
  if (!Number.isFinite(obtained)) return 0
  return (obtained / max) * 100
}

/** Solo presentación: etiquetas de eje/habilidad más legibles y clave de fusión para duplicados evidentes. */
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

function pedagogyLabelMergeKey(label: string): string {
  const v = visualNormalizePedagogyLabel(label)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
  return v.replace(/[^a-z0-9]+/g, "")
}

function isUnassignedCourseLabelKey(course: string): boolean {
  const x = String(course ?? "").trim()
  const compact = x
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  return compact === "SINCURSO" || x.toLowerCase() === "sin curso"
}

function sortCourseRowsUnassignedLast<T extends { course_label: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ua = isUnassignedCourseLabelKey(a.course_label)
    const ub = isUnassignedCourseLabelKey(b.course_label)
    if (ua !== ub) return ua ? 1 : -1
    return a.course_label.localeCompare(b.course_label, "es")
  })
}

function monthKeyFromEvaluatedAt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
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

function finalizeSkillLogro(acc: CourseSkillAcc): number {
  if (acc.max > 0) return evalLogroPct(acc.obtained, acc.max)
  if (acc.fallbackCount > 0) return acc.fallbackPctSum / acc.fallbackCount
  return 0
}

function addCourseSkillFromScores(map: Map<string, CourseSkillAcc>, skillKey: string, scoreObt: number, scoreMax: number) {
  const acc =
    map.get(skillKey) ??
    ({
      obtained: 0,
      max: 0,
      fallbackPctSum: 0,
      fallbackCount: 0,
    } satisfies CourseSkillAcc)
  if (Number.isFinite(scoreMax) && scoreMax > 0 && Number.isFinite(scoreObt)) {
    acc.obtained += scoreObt
    acc.max += scoreMax
  }
  map.set(skillKey, acc)
}

export async function GET(req: NextRequest) {
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
      .select("id, course_label, course_id, evaluated_at, teacher_id, school_id, exam_type, assessment_category, source_exam_id")
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
      else
        return NextResponse.json({
          evolution_by_course: [],
          skills_by_course: [],
          performance_distribution: { lt_50_pct: 0, from_50_to_69_pct: 0, gte_70_pct: 0 },
          evaluation_types: { SIMCE: 0, PAES: 0, Interna: 0 },
          meta: { evaluations_in_scope: 0, skills_source: "none" as const },
        })
    } else if (teacherId) {
      evalQuery = evalQuery.eq("teacher_id", teacherId)
    } else {
      return NextResponse.json({
        evolution_by_course: [],
        skills_by_course: [],
        performance_distribution: { lt_50_pct: 0, from_50_to_69_pct: 0, gte_70_pct: 0 },
        evaluation_types: { SIMCE: 0, PAES: 0, Interna: 0 },
        meta: { evaluations_in_scope: 0, skills_source: "none" as const },
      })
    }

    const { data: evaluations, error: evalErr } = await evalQuery
    if (evalErr) return NextResponse.json({ error: evalErr.message }, { status: 500 })

    const evalRows = (evaluations ?? []) as EvalRow[]
    const evalIds = evalRows.map((e) => String(e.id)).filter(Boolean)
    if (evalIds.length === 0) {
      return NextResponse.json({
        evolution_by_course: [],
        skills_by_course: [],
        performance_distribution: { lt_50_pct: 0, from_50_to_69_pct: 0, gte_70_pct: 0 },
        evaluation_types: { SIMCE: 0, PAES: 0, Interna: 0 },
        meta: { evaluations_in_scope: 0, skills_source: "none" as const },
      })
    }

    const evalIdToCourse = new Map<string, string>()
    for (const e of evalRows) {
      const id = String(e.id)
      const courseLabel = normalizeCourseLabelForReports(String(e.course_label ?? "").trim() || String(e.course_id ?? "").trim())
      evalIdToCourse.set(id, courseLabel)
    }

    const { data: itemRows, error: itemErr } = await supabase
      .from("evaluation_items")
      .select("evaluation_id, question_number, score_obtained, score_max")
      .in("evaluation_id", evalIds)
    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

    const totalsByEval = new Map<string, { obtained: number; max: number }>()
    const itemRowsTyped = (itemRows ?? []) as Array<{
      evaluation_id: string
      question_number?: number | string | null
      score_obtained?: number | null
      score_max?: number | null
    }>
    for (const row of itemRowsTyped) {
      const id = String(row.evaluation_id)
      const current = totalsByEval.get(id) ?? { obtained: 0, max: 0 }
      current.obtained += Number(row.score_obtained) || 0
      current.max += Number(row.score_max) || 0
      totalsByEval.set(id, current)
    }

    /** course|month -> agregado ítems (misma fórmula que informe demo) */
    const timelineAcc = new Map<string, { obtained: number; max: number }>()
    let nLt50 = 0
    let n50_69 = 0
    let nGte70 = 0
    const typeCounts = { SIMCE: 0, PAES: 0, Interna: 0 }

    for (const e of evalRows) {
      const id = String(e.id)
      const totals = totalsByEval.get(id) ?? { obtained: 0, max: 0 }
      const logro = evalLogroPct(totals.obtained, totals.max)
      if (logro < 50) nLt50 += 1
      else if (logro < 70) n50_69 += 1
      else nGte70 += 1

      const fam = instrumentFamilyForEval({
        id,
        exam_type: e.exam_type ?? null,
        assessment_category: e.assessment_category ?? null,
      })
      if (fam === "SIMCE") typeCounts.SIMCE += 1
      else if (fam === "PAES") typeCounts.PAES += 1
      else typeCounts.Interna += 1

      const month = monthKeyFromEvaluatedAt(e.evaluated_at)
      if (!month) continue
      const course = evalIdToCourse.get(id) ?? "Sin curso"
      const tKey = `${course}\0${month}`
      const tCur = timelineAcc.get(tKey) ?? { obtained: 0, max: 0 }
      tCur.obtained += totals.obtained
      tCur.max += totals.max
      timelineAcc.set(tKey, tCur)
    }

    const nTotal = nLt50 + n50_69 + nGte70
    const performance_distribution =
      nTotal > 0
        ? {
            lt_50_pct: toPercent1((nLt50 / nTotal) * 100),
            from_50_to_69_pct: toPercent1((n50_69 / nTotal) * 100),
            gte_70_pct: toPercent1((nGte70 / nTotal) * 100),
          }
        : { lt_50_pct: 0, from_50_to_69_pct: 0, gte_70_pct: 0 }

    const coursesSet = new Set<string>(evalIdToCourse.values())
    const timelineByCourse = new Map<string, Array<{ month: string; logro_pct: number }>>()
    for (const course of coursesSet) {
      const months = [...timelineAcc.entries()]
        .filter(([k]) => k.startsWith(`${course}\0`))
        .map(([k, acc]) => {
          const month = k.split("\0")[1] ?? ""
          const pct = acc.max > 0 ? evalLogroPct(acc.obtained, acc.max) : 0
          return { month, logro_pct: toPercent1(pct) }
        })
        .sort((a, b) => a.month.localeCompare(b.month))
      if (months.length > 0) timelineByCourse.set(course, months)
    }

    const evolution_by_course = sortCourseRowsUnassignedLast(
      [...timelineByCourse.entries()].map(([course_label, timeline]) => ({ course_label, timeline })),
    )

    /** Habilidades por curso: pipeline estable del informe individual (source_exam + items + analyzeLearningResults). */
    const skillsByCourseMap = new Map<string, Map<string, CourseSkillAcc>>()
    const skillDisplayByCourseMerge = new Map<string, Map<string, string>>()

    function noteSkillDisplay(course: string, mergeKey: string, rawLabel: string) {
      if (!mergeKey) return
      const vis = visualNormalizePedagogyLabel(rawLabel)
      let cm = skillDisplayByCourseMerge.get(course)
      if (!cm) {
        cm = new Map()
        skillDisplayByCourseMerge.set(course, cm)
      }
      const prev = cm.get(mergeKey)
      if (!prev || vis.length > prev.length) cm.set(mergeKey, vis)
    }

    function ensureCourseSkills(course: string): Map<string, CourseSkillAcc> {
      let m = skillsByCourseMap.get(course)
      if (!m) {
        m = new Map()
        skillsByCourseMap.set(course, m)
      }
      return m
    }

    let skillsSource: "analyze_learning_results_pipeline" | "none" = "none"
    const evalItemsByEvalId = new Map<string, EvaluationItemRow[]>()
    for (const item of itemRowsTyped) {
      const evalId = String(item.evaluation_id ?? "").trim()
      if (!evalId) continue
      const qn = normalizeQuestionNumber(item.question_number)
      if (qn == null) continue
      const rows = evalItemsByEvalId.get(evalId) ?? []
      rows.push({
        question_number: qn,
        score_obtained: Number(item.score_obtained),
        score_max: Number(item.score_max),
      })
      evalItemsByEvalId.set(evalId, rows)
    }

    const sourceExamBridgeByEvalId = new Set<string>()
    try {
      const { data: bridgeRows } = await supabase
        .from("evaluation_source_exams")
        .select("evaluation_id")
        .in("evaluation_id", evalIds)
      for (const row of (bridgeRows ?? []) as Array<{ evaluation_id?: string | null }>) {
        const evalId = String(row.evaluation_id ?? "").trim()
        if (evalId) sourceExamBridgeByEvalId.add(evalId)
      }
    } catch {
      // Tabla puente puede no existir en algunos entornos.
    }

    const sourceExamColumnByEvalId = new Map<string, string>()
    for (const e of evalRows) {
      const sid = String(e.source_exam_id ?? "").trim()
      if (sid) sourceExamColumnByEvalId.set(String(e.id), sid)
    }

    let evaluationsWithSourceExam = 0
    let evaluationsWithPedagogicalAnalysis = 0
    let evaluationsWithMatchedItems = 0
    let sourceExamItemsCount = 0
    const coursesWithSkills = new Set<string>()
    const sampleProblemEvaluations: Array<{
      evaluation_id: string
      course_label: string
      teacher_id: string | null
      school_id: string | null
      source_exam_id: string | null
      item_count: number
      matched_items_count: number
      skills_count: number
      reason_missing: string
    }> = []

    for (const e of evalRows) {
      const evalId = String(e.id)
      const evaluationItems = evalItemsByEvalId.get(evalId) ?? []
      const pedagogy = await resolveEvaluationPedagogy(supabase, { id: evalId }, { evaluationItems })
      if (pedagogy.has_source_exam) evaluationsWithSourceExam += 1
      if (pedagogy.matched_items_count > 0) evaluationsWithMatchedItems += 1
      if (pedagogy.analysis_available) {
        evaluationsWithPedagogicalAnalysis += 1
        skillsSource = "analyze_learning_results_pipeline"
      }
      sourceExamItemsCount += pedagogy.source_exam_items.length
      if (!pedagogy.analysis_available && sampleProblemEvaluations.length < 10) {
        sampleProblemEvaluations.push({
          evaluation_id: evalId,
          course_label: evalIdToCourse.get(evalId) ?? "Sin curso",
          teacher_id: String(e.teacher_id ?? "").trim() || null,
          school_id: String(e.school_id ?? "").trim() || null,
          source_exam_id: pedagogy.source_exam_id,
          item_count: pedagogy.evaluation_items.length,
          matched_items_count: pedagogy.matched_items_count,
          skills_count: pedagogy.skills_count,
          reason_missing: pedagogy.reason_missing,
        })
      }

      const course = evalIdToCourse.get(evalId) ?? "Sin curso"
      for (const skill of pedagogy.analysis.by_skill) {
        const rawLabel = String(skill.dimension_value ?? "").trim()
        if (!rawLabel) continue
        const mergeKey = pedagogyLabelMergeKey(rawLabel)
        if (!mergeKey) continue
        noteSkillDisplay(course, mergeKey, rawLabel)
        addCourseSkillFromScores(
          ensureCourseSkills(course),
          mergeKey,
          Number(skill.score_obtained) || 0,
          Number(skill.score_max) || 0,
        )
      }
      if (pedagogy.analysis.by_skill.length > 0) coursesWithSkills.add(course)
    }

    const coursesWithoutPedagogicalMatch: string[] = []
    const skills_by_course = sortCourseRowsUnassignedLast(
      [...coursesSet]
        .map((course_label) => {
          const skillMapAcc = skillsByCourseMap.get(course_label) ?? new Map<string, CourseSkillAcc>()
          const allSkills = [...skillMapAcc.entries()]
            .map(([mergeKey, acc]) => ({
              skill_name:
                skillDisplayByCourseMerge.get(course_label)?.get(mergeKey) ??
                visualNormalizePedagogyLabel(mergeKey),
              logro_pct: toPercent1(finalizeSkillLogro(acc)),
            }))
            .sort((a, b) => a.logro_pct - b.logro_pct)
          const skills = allSkills
            .filter((s) => s.logro_pct < 70)
            .slice(0, 5)
          let status: SkillsCourseStatus = "has_low_skills"
          if (allSkills.length === 0) {
            status = "no_pedagogical_data"
            coursesWithoutPedagogicalMatch.push(course_label)
          } else if (skills.length === 0) {
            status = "no_low_skills"
          }
          return { course_label, skills, status }
        })
    )

    const skillsGroupsCount = [...skillsByCourseMap.values()].reduce((acc, m) => acc + m.size, 0)
    const coursesWithSkillsCount = skills_by_course.filter((x) => x.status !== "no_pedagogical_data").length
    const skills_debug_by_course: CourseSkillsDebug[] = []
    const coursesDetected = [...coursesSet]
    const coursesWithoutSkills = coursesDetected.filter((c) => !coursesWithSkills.has(c))

    return NextResponse.json({
      evolution_by_course,
      skills_by_course,
      performance_distribution,
      evaluation_types: typeCounts,
      meta: {
        evaluations_in_scope: evalIds.length,
        skills_source: skillsSource,
        skills_debug: {
          evaluations_analyzed: evalIds.length,
          evaluations_with_source_exam: evaluationsWithSourceExam,
          evaluations_with_pedagogical_analysis: evaluationsWithPedagogicalAnalysis,
          skills_groups_count: skillsGroupsCount,
          courses_with_skills_count: coursesWithSkillsCount,
          courses_without_pedagogical_match: coursesWithoutPedagogicalMatch,
        },
        pipeline_debug_summary: {
          evaluations_in_scope: evalIds.length,
          evaluations_with_teacher_id: evalRows.filter((x) => String(x.teacher_id ?? "").trim() !== "").length,
          evaluations_with_school_id: evalRows.filter((x) => String((x.school_id ?? "")).trim() !== "").length,
          evaluations_with_course_label: evalRows.filter((x) => String(x.course_label ?? "").trim() !== "").length,
          evaluations_with_source_exam_id: sourceExamColumnByEvalId.size,
          evaluations_with_source_exam_bridge: sourceExamBridgeByEvalId.size,
          evaluations_with_any_source_exam: evaluationsWithSourceExam,
          evaluation_items_count: itemRowsTyped.length,
          source_exam_items_count: sourceExamItemsCount,
          evaluations_with_matched_items: evaluationsWithMatchedItems,
          evaluations_with_pedagogical_analysis: evaluationsWithPedagogicalAnalysis,
          courses_detected: coursesDetected,
          courses_with_skills: [...coursesWithSkills],
          courses_without_skills: coursesWithoutSkills,
          sample_problem_evaluations: sampleProblemEvaluations,
        },
        skills_debug_by_course,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error inesperado" },
      { status: 500 },
    )
  }
}
