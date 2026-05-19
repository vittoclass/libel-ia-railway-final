/**
 * GET /api/evaluations/[id]/pedagogical-analysis
 * Análisis de logro pedagógico: cruza ítems de la evaluación con la prueba base asociada.
 * Solo lectura. No modifica scoring, nota ni informe.
 * Devuelve estados explícitos: has_source_exam, has_evaluation_items, has_source_exam_items, analysis_available, status_reason.
 */
import { NextRequest, NextResponse } from "next/server"
import { canReadEvaluationInAppScope, normUuid, profileScopeFromRow } from "@/app/lib/evaluation-read-scope"
import { getOrCreateProfile } from "@/app/lib/profile"
import { resolveStudentDisplayName } from "@/app/lib/student-display-name"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { getSourceExamForEvaluation } from "@/app/lib/source-exam-db"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import { convertToNationalScore, nationalLevelLabel } from "@/app/lib/standard-scale/converters"
import { mean, sampleStdDev, zScore } from "@/app/lib/pedagogical-intelligence/metrics"
import { generateStrategicAnalysis } from "@/app/lib/pedagogical-intelligence/inference-engine"
import { getInstrumentAnalyticsModeFromEvaluationTags } from "@/app/lib/assessment-category"
import {
  analyzeLearningResults,
  normalizePedagogicalText,
  type EvaluationItemRow,
  type SourceExamItemWithPedagogy,
} from "@/app/lib/analyze-learning-results"

export const dynamic = "force-dynamic"

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

type StatusReason =
  | "ok"
  | "missing_source_exam"
  | "missing_evaluation_items"
  | "missing_source_exam_items"
  | "error"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: evaluationId } = await params
  if (!evaluationId) {
    return NextResponse.json({ error: "Falta id de evaluación" }, { status: 400 })
  }

  const { user } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const { teacher_id_used, school_id_used } = profileScopeFromRow(profileRow)

  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, user_id, school_id, course_id, evaluated_at, exam_type, assessment_category")
    .eq("id", evaluationId)
    .maybeSingle()

  if (evErr || !evaluation) {
    return NextResponse.json({ error: "Evaluación no encontrada" }, { status: 404 })
  }

  const canRead = canReadEvaluationInAppScope({
    userId: user.id,
    evaluation: evaluation as { teacher_id?: string | null; user_id?: string | null; school_id?: string | null },
    teacher_id_used,
    school_id_used,
  })
  if (!canRead) {
    return NextResponse.json({ error: "No autorizado para esta evaluación" }, { status: 403 })
  }

  const [studentsNameRes, summaryNameRes] = await Promise.all([
    supabase.from("evaluation_students").select("student_name").eq("evaluation_id", evaluationId),
    supabase
      .from("evaluation_summaries")
      .select("student_name_raw, raw, created_at")
      .eq("evaluation_id", evaluationId)
      .order("created_at", { ascending: true }),
  ])
  let student_display_name = ""
  for (const row of studentsNameRes.data ?? []) {
    const n = resolveStudentDisplayName({
      student_name: (row as { student_name?: string | null }).student_name ?? null,
      student_name_raw: null,
      raw: null,
    }).trim()
    if (n) {
      student_display_name = n
      break
    }
  }
  if (!student_display_name) {
    const summaryRows = (summaryNameRes.data ?? []) as Array<{
      student_name_raw?: string | null
      raw?: unknown
    }>
    const summaryTyped = summaryRows.length > 0 ? summaryRows[summaryRows.length - 1]! : null
    if (summaryTyped) {
      student_display_name = resolveStudentDisplayName({
        student_name: null,
        student_name_raw: summaryTyped.student_name_raw ?? null,
        raw: summaryTyped.raw,
      }).trim()
    }
  }
  if (!student_display_name) student_display_name = "Sin nombre de estudiante"

  /** Para agregados del curso (z-score): perfil o, en su defecto, profesor de la fila evaluada. */
  const teacherIdForCourseStats =
    teacher_id_used ?? normUuid((evaluation as { teacher_id?: string | null }).teacher_id ?? null)

  const examTypeRaw = (evaluation as { exam_type?: string | null }).exam_type ?? null
  const assessmentCategoryRaw = (evaluation as { assessment_category?: string | null }).assessment_category ?? null
  const instrument_analytics_mode = getInstrumentAnalyticsModeFromEvaluationTags(examTypeRaw, assessmentCategoryRaw)

  const sourceExamId = await getSourceExamForEvaluation(supabase, evaluationId)

  const [itemsRes, sourceItemsRes] = await Promise.all([
    supabase
      .from("evaluation_items")
      .select("question_number, score_obtained, score_max, is_correct, student_answer, correct_answer")
      .eq("evaluation_id", evaluationId)
      .order("question_number", { ascending: true }),
    sourceExamId
      ? supabase
          .from("source_exam_items")
          .select("id, item_number, item_text, axis_label, skill_label, cognitive_level, max_score, rubric_text, question_type")
          .eq("source_exam_id", sourceExamId)
          .order("item_number", { ascending: true })
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])

  const evaluationItems = (itemsRes.data ?? []) as EvaluationItemRow[]
  const sourceItemsRaw = (sourceItemsRes.data ?? []) as SourceExamItemWithPedagogy[]
  const sourceExamItemsEnriched =
    sourceItemsRaw.length > 0 ? enrichItemsWithPedagogy(sourceItemsRaw) : ([] as SourceExamItemWithPedagogy[])

  const analysis = analyzeLearningResults(
    evaluationId,
    evaluationItems,
    sourceExamItemsEnriched
  )

  const has_source_exam = !!sourceExamId
  const has_evaluation_items = evaluationItems.length > 0
  const has_source_exam_items = sourceItemsRaw.length > 0
  const analysis_available =
    has_source_exam && has_evaluation_items && has_source_exam_items && analysis.by_question.length > 0

  let status_reason: StatusReason = "ok"
  if (!has_source_exam) status_reason = "missing_source_exam"
  else if (!has_evaluation_items) status_reason = "missing_evaluation_items"
  else if (!has_source_exam_items) status_reason = "missing_source_exam_items"
  else if (!analysis.by_question.length) status_reason = "missing_source_exam_items"

  // PHASE_2_SCALES_V1: proyecciones nacionales para modal/pfd sin recalculo en frontend.
  const requestedYear = Number(req.nextUrl.searchParams.get("year") || 2026)
  const scaleYear = Number.isFinite(requestedYear) && requestedYear > 0 ? Math.floor(requestedYear) : 2026
  const totalObtained = analysis.by_question.reduce((sum, q) => sum + (Number(q.score_obtained) || 0), 0)
  const totalMax = analysis.by_question.reduce((sum, q) => sum + (Number(q.score_max) || 0), 0)
  const logroPct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : null
  const projections = {
    simce_estimated:
      instrument_analytics_mode === "SIMCE" ? convertToNationalScore(logroPct, "simce", scaleYear) : null,
    paes_estimated:
      instrument_analytics_mode === "PAES" ? convertToNationalScore(logroPct, "paes", scaleYear) : null,
    level_label:
      instrument_analytics_mode === "SIMCE" ? nationalLevelLabel(logroPct) : null,
    year: scaleYear,
  }
  // PHASE_4_MEMORY_IDENTITY_V1
  let delta_analysis: {
    previous_evaluation_id: string | null
    delta_overall_pct: number | null
    by_axis: Array<{ axis: string; delta_pct: number | null }>
    by_skill: Array<{ skill: string; delta_pct: number | null }>
  } | null = null
  // PHASE_4_MEMORY_IDENTITY_V1
  try {
    const { data: currentStudent } = await supabase
      .from("evaluation_students")
      .select("student_id")
      .eq("evaluation_id", evaluationId)
      .not("student_id", "is", null)
      .limit(1)
      .maybeSingle()
    const studentId = (currentStudent as { student_id?: string | null } | null)?.student_id ?? null
    if (studentId) {
      const currentEvaluatedAt =
        (evaluation as { evaluated_at?: string | null }).evaluated_at ?? new Date().toISOString()
      const { data: prevLink } = await supabase
        .from("student_evaluations")
        .select("evaluation_id, evaluated_at")
        .eq("student_id", studentId)
        .lt("evaluated_at", currentEvaluatedAt)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      const prevEvaluationId = (prevLink as { evaluation_id?: string | null } | null)?.evaluation_id ?? null
      if (prevEvaluationId) {
        const prevSourceExamId = await getSourceExamForEvaluation(supabase, prevEvaluationId)
        const [prevItemsRes, prevSourceItemsRes] = await Promise.all([
          supabase
            .from("evaluation_items")
            .select("question_number, score_obtained, score_max, is_correct, student_answer, correct_answer")
            .eq("evaluation_id", prevEvaluationId)
            .order("question_number", { ascending: true }),
          prevSourceExamId
            ? supabase
                .from("source_exam_items")
                .select("id, item_number, item_text, axis_label, skill_label, cognitive_level, max_score, rubric_text, question_type")
                .eq("source_exam_id", prevSourceExamId)
                .order("item_number", { ascending: true })
            : Promise.resolve({ data: [] as unknown[], error: null }),
        ])
        const prevEvaluationItems = (prevItemsRes.data ?? []) as EvaluationItemRow[]
        const prevSourceItemsRaw = (prevSourceItemsRes.data ?? []) as SourceExamItemWithPedagogy[]
        const prevSourceExamItemsEnriched =
          prevSourceItemsRaw.length > 0 ? enrichItemsWithPedagogy(prevSourceItemsRaw) : ([] as SourceExamItemWithPedagogy[])
        const prevAnalysis = analyzeLearningResults(prevEvaluationId, prevEvaluationItems, prevSourceExamItemsEnriched)

        const prevObt = prevAnalysis.by_question.reduce((s, q) => s + (Number(q.score_obtained) || 0), 0)
        const prevMax = prevAnalysis.by_question.reduce((s, q) => s + (Number(q.score_max) || 0), 0)
        const prevLogro = prevMax > 0 ? Math.round((prevObt / prevMax) * 100) : null
        const deltaOverall =
          logroPct != null && prevLogro != null ? Math.round((logroPct - prevLogro) * 10) / 10 : null

        const byAxisCurrent = new Map(
          analysis.by_axis.map((x) => [normalizePedagogicalText(x.dimension_value), typeof x.logro_pct === "number" ? x.logro_pct : null])
        )
        const byAxisPrev = new Map(
          prevAnalysis.by_axis.map((x) => [normalizePedagogicalText(x.dimension_value), typeof x.logro_pct === "number" ? x.logro_pct : null])
        )
        const axisKeys = new Set([...byAxisCurrent.keys(), ...byAxisPrev.keys()])
        const byAxisDelta = Array.from(axisKeys).map((k) => {
          const c = byAxisCurrent.get(k)
          const p = byAxisPrev.get(k)
          return {
            axis: k,
            delta_pct: c != null && p != null ? Math.round((c - p) * 10) / 10 : null,
          }
        })

        const bySkillCurrent = new Map(
          analysis.by_skill.map((x) => [normalizePedagogicalText(x.dimension_value), typeof x.logro_pct === "number" ? x.logro_pct : null])
        )
        const bySkillPrev = new Map(
          prevAnalysis.by_skill.map((x) => [normalizePedagogicalText(x.dimension_value), typeof x.logro_pct === "number" ? x.logro_pct : null])
        )
        const skillKeys = new Set([...bySkillCurrent.keys(), ...bySkillPrev.keys()])
        const bySkillDelta = Array.from(skillKeys).map((k) => {
          const c = bySkillCurrent.get(k)
          const p = bySkillPrev.get(k)
          return {
            skill: k,
            delta_pct: c != null && p != null ? Math.round((c - p) * 10) / 10 : null,
          }
        })

        delta_analysis = {
          previous_evaluation_id: prevEvaluationId,
          delta_overall_pct: deltaOverall,
          by_axis: byAxisDelta,
          by_skill: bySkillDelta,
        }
      }
    }
  } catch (deltaErr) {
    if (isDev) console.warn("[pedagogical-analysis][delta] fallback", deltaErr)
    delta_analysis = null
  }
  // PHASE_3_INFERENCE_SECURITY_V1
  let strategic_analysis: {
    paragraph: string
    key_gap: {
      numbers_pct: number | null
      modelacion_pct: number | null
      overall_pct: number | null
      z_score_course: number | null
      simce_level: "Insuficiente" | "Elemental" | "Adecuado" | null
    }
  } | null = null
  // PHASE_3_INFERENCE_SECURITY_V1
  try {
    if (instrument_analytics_mode === "SIMCE") {
    const courseId = (evaluation as { course_id?: string | null }).course_id ?? null
    let zCourse: number | null = null
    if (courseId && teacherIdForCourseStats) {
      const { data: courseEvaluations } = await supabase
        .from("evaluations")
        .select("id")
        .eq("teacher_id", teacherIdForCourseStats)
        .eq("course_id", courseId)
      const courseEvalIds = (courseEvaluations ?? []).map((r) => String((r as { id: string }).id))
      if (courseEvalIds.length > 0) {
        const { data: courseItems } = await supabase
          .from("evaluation_items")
          .select("evaluation_id, score_obtained, score_max")
          .in("evaluation_id", courseEvalIds)
        const grouped = new Map<string, Array<{ score_obtained: number | null; score_max: number | null }>>()
        for (const row of courseItems ?? []) {
          const evId = String((row as { evaluation_id?: string | null }).evaluation_id ?? "")
          if (!evId) continue
          const arr = grouped.get(evId) ?? []
          arr.push({
            score_obtained: (row as { score_obtained?: number | null }).score_obtained ?? null,
            score_max: (row as { score_max?: number | null }).score_max ?? null,
          })
          grouped.set(evId, arr)
        }
        const logroList: number[] = []
        for (const evId of courseEvalIds) {
          const rows = grouped.get(evId) ?? []
          const totalObt = rows.reduce((s, r) => s + (Number(r.score_obtained) || 0), 0)
          const totalMx = rows.reduce((s, r) => s + (Number(r.score_max) || 0), 0)
          if (totalMx > 0) logroList.push(Math.round((totalObt / totalMx) * 100))
        }
        const m = mean(logroList)
        const sd = sampleStdDev(logroList)
        zCourse = logroPct != null ? zScore(logroPct, m, sd) : null
      }
    }
    strategic_analysis = generateStrategicAnalysis({
      // PHASE_3_INFERENCE_SECURITY_V1
      by_axis: analysis.by_axis.map((x) => ({ dimension_value: x.dimension_value, logro_pct: x.logro_pct })),
      // PHASE_3_INFERENCE_SECURITY_V1
      by_skill: analysis.by_skill.map((x) => ({ dimension_value: x.dimension_value, logro_pct: x.logro_pct })),
      // PHASE_3_INFERENCE_SECURITY_V1
      overall_logro_pct: logroPct,
      // PHASE_3_INFERENCE_SECURITY_V1
      z_score_course: zCourse,
      // PHASE_3_INFERENCE_SECURITY_V1
      simce_level: projections.level_label,
      // PHASE_4_MEMORY_IDENTITY_V1
      delta_overall_pct: delta_analysis?.delta_overall_pct ?? null,
      // PHASE_4_MEMORY_IDENTITY_V1
      delta_by_axis: delta_analysis?.by_axis ?? [],
      // PHASE_4_MEMORY_IDENTITY_V1
      delta_by_skill: delta_analysis?.by_skill ?? [],
    })
    } else {
      strategic_analysis = null
    }
  } catch (e) {
    // PHASE_3_INFERENCE_SECURITY_V1
    if (isDev) console.warn("[pedagogical-analysis][strategic_analysis] fallback", e)
    strategic_analysis = null
  }

  if (isDev) {
    console.info("[pedagogical-analysis]", {
      evaluationId,
      source_exam_id: sourceExamId ?? null,
      evaluation_items_count: evaluationItems.length,
      source_exam_items_count: sourceItemsRaw.length,
      has_source_exam,
      has_evaluation_items,
      has_source_exam_items,
      analysis_available,
      status_reason,
    })
  }

  return NextResponse.json(
    {
      ...analysis,
      student_display_name,
      has_source_exam,
      has_evaluation_items,
      has_source_exam_items,
      analysis_available,
      status_reason,
      instrument_type: examTypeRaw,
      instrument_analytics_mode,
      projections,
      delta_analysis,
      strategic_analysis,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
