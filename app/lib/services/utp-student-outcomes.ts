/**
 * Agregación read-only de resultados reales para Dashboard UTP (360°).
 * No toca OMR, persistencia de evaluaciones ni scoring.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import {
  aggregateCourseSummary,
  analyzeLearningResults,
  normalizePedagogicalText,
  type EvaluationItemRow,
  type SourceExamItemWithPedagogy,
} from "@/app/lib/analyze-learning-results"
import { getSourceExamForEvaluation, getSourceExamItems } from "@/app/lib/source-exam-db"
import { parseAssessmentTypeToFlat, type FlatAssessmentType } from "@/app/lib/assessment-category"
import { resolveStudentDisplayName } from "@/app/lib/student-display-name"

export const UTP_STUDENT_OUTCOMES_MAX_EVALS = 500
export const UTP_STUDENT_OUTCOMES_INSTITUTIONAL_EXPECTED_PCT = 70

export type StudentOutcomesLink = {
  evaluation_ids: string[]
  /** Plano canónico; legado SIMCE/PAES/INTERNA se normaliza al leer. */
  assessment_type?: FlatAssessmentType | null
  source_exam_id?: string | null
  linked_at?: string | null
  linked_by_user_id?: string | null
  confidence?: "explicit" | "heuristic"
  notes?: string | null
}

export type UtpStudentOutcomesMeta = {
  audit_report_id: string
  upload_id: string | null
  organization_id: string | null
  link: StudentOutcomesLink
  student_count: number
  evaluation_count: number
  pedagogy_enabled: boolean
  aggregation_version: "utp_student_outcomes_v1"
  warnings: string[]
}

export type AccuracyRow = {
  skill_id: string | null
  skill_label: string
  achieved_pct: number | null
  expected_pct: number | null
  expected_source: "audit_band" | "institutional_default" | "unavailable"
  gap_pct: number | null
  score_obtained_sum: number
  score_max_sum: number
  question_instances: number
  student_weight: number
}

export type AxisAccuracyRow = {
  axis_id: string | null
  axis_label: string
  achieved_pct: number | null
  expected_pct: number | null
  expected_source: "audit_band" | "institutional_default" | "unavailable"
  gap_pct: number | null
  score_obtained_sum: number
  score_max_sum: number
  question_instances: number
  student_weight: number
}

export type CognitiveAchievementRow = {
  cognitive_level: string
  achieved_pct: number | null
  score_obtained_sum: number
  score_max_sum: number
  question_instances: number
}

export type CognitiveDominantRow = {
  cognitive_level: string
  student_count: number
  share_of_students: number
}

export type StudentRiskItem = {
  evaluation_id: string
  student_display_name: string
  student_normalized: string | null
  course_label: string | null
  grade_chile: number
  evaluated_at: string | null
}

export type StudentRiskListPayload = {
  threshold_note_chile: number
  items: StudentRiskItem[]
  total_below_threshold: number
  page: number
  page_size: number
  has_more: boolean
}

export type UtpStudentOutcomesPayload = {
  meta: UtpStudentOutcomesMeta
  accuracy_by_skill: AccuracyRow[]
  accuracy_by_axis: AxisAccuracyRow[]
  cognitive_distribution: {
    by_achievement_weight: CognitiveAchievementRow[]
    by_student_dominant_level: CognitiveDominantRow[]
  }
  student_risk_list: StudentRiskListPayload
  strategic_analysis: {
    course_narrative: string
    gap_alerts: string[]
    pme_actions: string[]
    interdisciplinary_note: string | null
    student_narratives: Array<{
      evaluation_id: string
      student_display_name: string
      note: string
    }>
  }
}

function emptyLink(): StudentOutcomesLink {
  return { evaluation_ids: [] }
}

export function emptyStudentOutcomesPayload(auditReportId: string, warnings: string[] = []): UtpStudentOutcomesPayload {
  return {
    meta: {
      audit_report_id: auditReportId,
      upload_id: null,
      organization_id: null,
      link: emptyLink(),
      student_count: 0,
      evaluation_count: 0,
      pedagogy_enabled: process.env.ENABLE_PEDAGOGY === "true",
      aggregation_version: "utp_student_outcomes_v1",
      warnings,
    },
    accuracy_by_skill: [],
    accuracy_by_axis: [],
    cognitive_distribution: { by_achievement_weight: [], by_student_dominant_level: [] },
    student_risk_list: {
      threshold_note_chile: 4.0,
      items: [],
      total_below_threshold: 0,
      page: 1,
      page_size: 50,
      has_more: false,
    },
    strategic_analysis: {
      course_narrative: "Sin datos suficientes para análisis estratégico.",
      gap_alerts: [],
      pme_actions: [],
      interdisciplinary_note: null,
      student_narratives: [],
    },
  }
}

function parseContentBlob(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw)
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>
    } catch {
      /* ignore */
    }
  }
  return {}
}

/** Vínculo en content.student_outcomes_link = { evaluation_ids }. Compat: link bajo content.root_cause heredado. */
function readLinkFromContent(content: Record<string, unknown>): StudentOutcomesLink {
  let raw: unknown = content.student_outcomes_link
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const nestedRc = parseContentBlob(content.root_cause)
    raw = nestedRc.student_outcomes_link
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyLink()
  const o = raw as Record<string, unknown>
  const ids = Array.isArray(o.evaluation_ids) ? o.evaluation_ids.map((x) => String(x)).filter(Boolean) : []
  const confRaw = String(o.confidence ?? "explicit")
  const confidence = confRaw === "heuristic" ? ("heuristic" as const) : ("explicit" as const)
  const assessment_type = parseAssessmentTypeToFlat(String(o.assessment_type ?? ""))
  return {
    evaluation_ids: [...new Set(ids)],
    assessment_type,
    source_exam_id: o.source_exam_id != null ? String(o.source_exam_id) : null,
    linked_at: o.linked_at != null ? String(o.linked_at) : null,
    linked_by_user_id: o.linked_by_user_id != null ? String(o.linked_by_user_id) : null,
    confidence,
    notes: o.notes != null ? String(o.notes) : null,
  }
}

function confidenceToExpectedPct(confidence: string): number | null {
  const c = String(confidence ?? "").toUpperCase()
  if (c === "ALTA") return 72
  if (c === "MEDIA") return 65
  if (c === "BAJA") return 55
  return null
}

function expectedForSkillLabel(
  skillLabel: string,
  detected: Array<{ skill?: string; confidence?: string }>
): { expected_pct: number | null; expected_source: AccuracyRow["expected_source"] } {
  const key = normalizePedagogicalText(skillLabel)
  for (const d of detected) {
    const s = normalizePedagogicalText(String(d.skill ?? ""))
    if (s && (key.includes(s) || s.includes(key))) {
      const pct = confidenceToExpectedPct(String(d.confidence ?? ""))
      if (pct != null) return { expected_pct: pct, expected_source: "audit_band" }
    }
  }
  return { expected_pct: UTP_STUDENT_OUTCOMES_INSTITUTIONAL_EXPECTED_PCT, expected_source: "institutional_default" }
}

function dominantCognitiveLevel(analysis: ReturnType<typeof analyzeLearningResults>): string | null {
  const arr = analysis.by_cognitive_level.filter((x) => x.score_max > 0)
  if (!arr.length) return null
  return arr.reduce((a, b) => (a.score_max >= b.score_max ? a : b)).dimension_value
}

async function loadOneAnalysis(
  supabase: SupabaseClient,
  evaluationId: string
): Promise<ReturnType<typeof analyzeLearningResults> | null> {
  try {
    const sourceExamId = await getSourceExamForEvaluation(supabase, evaluationId)
    const [itemsRes, sourceRows] = await Promise.all([
      supabase
        .from("evaluation_items")
        .select("question_number, score_obtained, score_max, is_correct, student_answer, correct_answer")
        .eq("evaluation_id", evaluationId)
        .order("question_number", { ascending: true }),
      sourceExamId
        ? getSourceExamItems(supabase, sourceExamId)
        : Promise.resolve([]),
    ])
    if (itemsRes.error) return null
    const evaluationItems = (itemsRes.data ?? []) as EvaluationItemRow[]
    const sourceItemsRaw = (sourceRows ?? []) as Parameters<typeof enrichItemsWithPedagogy>[0]
    const sourceExamItemsEnriched: SourceExamItemWithPedagogy[] =
      sourceItemsRaw.length > 0 ? (enrichItemsWithPedagogy(sourceItemsRaw) as SourceExamItemWithPedagogy[]) : []
    return analyzeLearningResults(evaluationId, evaluationItems, sourceExamItemsEnriched)
  } catch {
    return null
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function shortLabel(input: string, n = 32): string {
  const v = String(input ?? "").trim()
  return v.length > n ? `${v.slice(0, n - 1)}…` : v
}

function detectGapAlerts(
  byAxis: AxisAccuracyRow[],
  bySkill: AccuracyRow[]
): string[] {
  const alerts: string[] = []
  const axisRows = byAxis.filter((x) => typeof x.achieved_pct === "number") as Array<AxisAccuracyRow & { achieved_pct: number }>
  const skillRows = bySkill.filter((x) => typeof x.achieved_pct === "number") as Array<AccuracyRow & { achieved_pct: number }>
  if (!axisRows.length || !skillRows.length) return alerts

  const topAxis = [...axisRows].sort((a, b) => b.achieved_pct - a.achieved_pct)[0]
  const lowSkill = [...skillRows].sort((a, b) => a.achieved_pct - b.achieved_pct)[0]
  const gap = topAxis.achieved_pct - lowSkill.achieved_pct
  if (gap >= 18) {
    alerts.push(
      `Alerta: ${shortLabel(topAxis.axis_label)} está alto (${Math.round(topAxis.achieved_pct)}%), pero ${shortLabel(lowSkill.skill_label)} está bajo (${Math.round(lowSkill.achieved_pct)}%).`
    )
  }

  const modelacion = skillRows.find((s) => normalizePedagogicalText(s.skill_label).includes("MODELACION"))
  const numeros = axisRows.find((a) => normalizePedagogicalText(a.axis_label).includes("NUMEROS"))
  if (modelacion && numeros && numeros.achieved_pct >= 60 && modelacion.achieved_pct <= 50) {
    alerts.push(
      `El niño sabe la operación, pero no entiende qué le están preguntando: Números ${Math.round(numeros.achieved_pct)}% y Modelación ${Math.round(modelacion.achieved_pct)}%.`
    )
  }
  return alerts
}

function buildPmeActions(gapAlerts: string[], riskTotal: number): string[] {
  const actions: string[] = []
  if (gapAlerts.length > 0) {
    actions.push("Haga una guía de 15 minutos solo de problemas de la vida diaria antes de la próxima prueba.")
  } else {
    actions.push("Haga reforzamiento focalizado de la habilidad más baja con ejercicios cortos al inicio de clase.")
  }
  actions.push(
    riskTotal >= 2
      ? "Siente a los 2 alumnos con nota más baja y trabaje con ellos el error más repetido de la última prueba."
      : "Haga apoyo directo a los rojos con una revisión uno a uno de los errores de la última prueba."
  )
  actions.push(
    "Revise con Lenguaje la lectura de enunciados largos y planifique nivelación de contenidos en conjunto."
  )
  return actions.slice(0, 3)
}

async function buildInterdisciplinaryNote(
  supabase: SupabaseClient,
  organizationId: string | null,
  linkedEvaluationIds: string[]
): Promise<string | null> {
  if (!organizationId || linkedEvaluationIds.length === 0) return null
  try {
    const { data: linkedEvals } = await supabase
      .from("evaluations")
      .select("id, subject")
      .in("id", linkedEvaluationIds)
    const currentSubjects = [...new Set((linkedEvals ?? []).map((e: any) => String(e.subject ?? "").trim()).filter(Boolean))]
    const currentMain = currentSubjects[0] ?? "Asignatura actual"

    const { data: orgEvals } = await supabase
      .from("evaluations")
      .select("id, subject, school_id")
      .eq("school_id", organizationId)
      .limit(500)
    if (!orgEvals?.length) return null
    const otherIds = orgEvals
      .filter((e: any) => !linkedEvaluationIds.includes(String(e.id)))
      .map((e: any) => String(e.id))
    if (!otherIds.length) return null

    const { data: otherSums } = await supabase
      .from("evaluation_summaries")
      .select("evaluation_id, grade_chile")
      .in("evaluation_id", otherIds)
    if (!otherSums?.length) return null
    const bySubject = new Map<string, number[]>()
    for (const ev of orgEvals as any[]) {
      const eid = String(ev.id)
      if (linkedEvaluationIds.includes(eid)) continue
      const g = Number((otherSums as any[]).find((s) => String(s.evaluation_id) === eid)?.grade_chile)
      if (!Number.isFinite(g)) continue
      const s = String(ev.subject ?? "").trim() || "Otra asignatura"
      bySubject.set(s, [...(bySubject.get(s) ?? []), g])
    }
    const candidates = Array.from(bySubject.entries())
      .map(([subject, grades]) => ({ subject, avg: grades.reduce((a, b) => a + b, 0) / grades.length }))
      .sort((a, b) => a.avg - b.avg)
    if (!candidates.length) return null
    const worst = candidates[0]
    if (worst.avg >= 4.5) return null
    return `Cruce interdisciplinar: en ${currentMain} hay tope similar a ${worst.subject} (promedio ${worst.avg.toFixed(1)}). Revise si en Lenguaje ya trabajaron lectura de enunciados largos.`
  } catch {
    return null
  }
}

/**
 * Calcula payload completo. Errores parciales se reflejan en meta.warnings; no lanza.
 */
export async function computeUtpStudentOutcomes(
  supabase: SupabaseClient,
  params: {
    auditReportId: string
    page?: number
    pageSize?: number
    detectedSkills?: Array<{ skill?: string; confidence?: string }>
  }
): Promise<UtpStudentOutcomesPayload> {
  const auditReportId = String(params.auditReportId ?? "").trim()
  const page = Math.max(1, Math.floor(Number(params.page) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(params.pageSize) || 50)))
  const warnings: string[] = []

  if (!auditReportId) {
    return emptyStudentOutcomesPayload("", ["missing_audit_report_id"])
  }

  try {
    const { data: report, error: repErr } = await supabase
      .from("utp_audit_reports")
      .select("id, upload_id, content")
      .eq("id", auditReportId)
      .maybeSingle()

    if (repErr || !report) {
      warnings.push(repErr?.message ?? "report_not_found")
      return emptyStudentOutcomesPayload(auditReportId, warnings)
    }

    let organization_id: string | null = null
    const uploadId = (report as { upload_id?: string | null }).upload_id
    if (uploadId) {
      try {
        const { data: upl } = await supabase
          .from("utp_instrument_uploads")
          .select("organization_id")
          .eq("id", uploadId)
          .maybeSingle()
        organization_id = (upl as { organization_id?: string | null } | null)?.organization_id ?? null
      } catch {
        /* sin organization_id en meta si falla el join lógico */
      }
    }

    const contentBlob = parseContentBlob((report as { content?: unknown }).content)
    const link = readLinkFromContent(contentBlob)
    let evalIds = link.evaluation_ids.filter(Boolean)
    if (evalIds.length > UTP_STUDENT_OUTCOMES_MAX_EVALS) {
      warnings.push(`evaluation_ids_truncated_to_${UTP_STUDENT_OUTCOMES_MAX_EVALS}`)
      evalIds = evalIds.slice(0, UTP_STUDENT_OUTCOMES_MAX_EVALS)
    }

    const base: UtpStudentOutcomesPayload = {
      ...emptyStudentOutcomesPayload(auditReportId, warnings),
      meta: {
        audit_report_id: auditReportId,
        upload_id: (report as { upload_id?: string | null }).upload_id ?? null,
        organization_id,
        link: { ...link, evaluation_ids: evalIds },
        student_count: evalIds.length,
        evaluation_count: evalIds.length,
        pedagogy_enabled: process.env.ENABLE_PEDAGOGY === "true",
        aggregation_version: "utp_student_outcomes_v1",
        warnings,
      },
    }

    if (evalIds.length === 0) {
      warnings.push("no_linked_evaluations")
      return base
    }

    const analyses: ReturnType<typeof analyzeLearningResults>[] = []
    for (const group of chunk(evalIds, 30)) {
      const partial = await Promise.all(group.map((id) => loadOneAnalysis(supabase, id)))
      for (const a of partial) {
        if (a && a.by_question.length > 0) analyses.push(a)
      }
    }

    if (analyses.length === 0) {
      warnings.push("no_aggregable_evaluations")
      return base
    }

    const course = aggregateCourseSummary(analyses)
    if (!course) {
      warnings.push("aggregate_failed")
      return base
    }

    const detected = params.detectedSkills ?? []

    const accuracy_by_skill: AccuracyRow[] = course.average_by_skill.map((s) => {
      const exp = expectedForSkillLabel(s.dimension_value, detected)
      const achieved = typeof s.logro_pct === "number" ? s.logro_pct : null
      const gap =
        achieved != null && exp.expected_pct != null ? Math.round((achieved - exp.expected_pct) * 10) / 10 : null
      return {
        skill_id: null,
        skill_label: s.dimension_value,
        achieved_pct: achieved,
        expected_pct: exp.expected_pct,
        expected_source: exp.expected_source,
        gap_pct: gap,
        score_obtained_sum: s.score_obtained,
        score_max_sum: s.score_max,
        question_instances: s.question_count,
        student_weight: analyses.length,
      }
    })

    const accuracy_by_axis: AxisAccuracyRow[] = course.average_by_axis.map((a) => {
      const achieved = typeof a.logro_pct === "number" ? a.logro_pct : null
      return {
        axis_id: null,
        axis_label: a.dimension_value,
        achieved_pct: achieved,
        expected_pct: null,
        expected_source: "unavailable" as const,
        gap_pct: null,
        score_obtained_sum: a.score_obtained,
        score_max_sum: a.score_max,
        question_instances: a.question_count,
        student_weight: analyses.length,
      }
    })

    const by_achievement_weight: CognitiveAchievementRow[] = course.average_by_cognitive_level.map((c) => ({
      cognitive_level: c.dimension_value,
      achieved_pct: typeof c.logro_pct === "number" ? c.logro_pct : null,
      score_obtained_sum: c.score_obtained,
      score_max_sum: c.score_max,
      question_instances: c.question_count,
    }))

    const dominantCounts = new Map<string, number>()
    for (const a of analyses) {
      const d = dominantCognitiveLevel(a)
      if (d) dominantCounts.set(d, (dominantCounts.get(d) ?? 0) + 1)
    }
    const n = analyses.length
    const by_student_dominant_level: CognitiveDominantRow[] = Array.from(dominantCounts.entries()).map(([cognitive_level, student_count]) => ({
      cognitive_level,
      student_count,
      share_of_students: n > 0 ? Math.round((student_count / n) * 1000) / 1000 : 0,
    }))

    let riskItems: StudentRiskItem[] = []
    let totalBelow = 0
    try {
      const { data: sums, error: sumErr } = await supabase
        .from("evaluation_summaries")
        .select("evaluation_id, grade_chile, student_name_raw, raw")
        .in("evaluation_id", evalIds)
      if (!sumErr && sums?.length) {
        const sumByEval = new Map<string, { grade_chile?: unknown; student_name_raw?: string | null; raw?: unknown }>()
        for (const row of sums) {
          const r = row as {
            evaluation_id: string
            grade_chile?: unknown
            student_name_raw?: string | null
            raw?: unknown
          }
          if (!sumByEval.has(r.evaluation_id)) sumByEval.set(r.evaluation_id, r)
        }
        const below = sums.filter((r) => {
          const g = Number((r as { grade_chile?: unknown }).grade_chile)
          return Number.isFinite(g) && g < 4.0
        }) as Array<{ evaluation_id: string; grade_chile?: number | null }>
        totalBelow = below.length
        const idsPage = below.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((b) => b.evaluation_id)
        if (idsPage.length > 0) {
          const [evRes, stRes] = await Promise.all([
            supabase.from("evaluations").select("id, evaluated_at, course_label").in("id", idsPage),
            supabase
              .from("evaluation_students")
              .select("evaluation_id, student_name, student_normalized, course_label, student_profile_id")
              .in("evaluation_id", idsPage),
          ])
          const evById = new Map((evRes.data ?? []).map((e: { id: string }) => [e.id, e]))
          const stByEval = new Map<
            string,
            { student_name?: string; student_normalized?: string; course_label?: string | null; student_profile_id?: string | null }
          >()
          for (const row of stRes.data ?? []) {
            const er = row as {
              evaluation_id: string
              student_name?: string
              student_normalized?: string
              course_label?: string | null
              student_profile_id?: string | null
            }
            if (!stByEval.has(er.evaluation_id)) stByEval.set(er.evaluation_id, er)
          }

          const profileIds = [...new Set(Array.from(stByEval.values()).map((s) => s.student_profile_id).filter(Boolean))] as string[]
          const profileById = new Map<string, { student_name?: string | null; course_label?: string | null }>()
          if (profileIds.length > 0) {
            const { data: profiles } = await supabase
              .from("student_profiles")
              .select("id, student_name, course_label")
              .in("id", profileIds)
            for (const p of profiles ?? []) {
              const row = p as { id: string; student_name?: string | null; course_label?: string | null }
              profileById.set(row.id, { student_name: row.student_name ?? null, course_label: row.course_label ?? null })
            }
          }

          riskItems = idsPage
            .map((eid) => {
              const sumRow = below.find((b) => b.evaluation_id === eid)
              const sm = sumByEval.get(eid)
              const ev = evById.get(eid) as { evaluated_at?: string | null; course_label?: string | null } | undefined
              const st = stByEval.get(eid)
              const profile = st?.student_profile_id ? profileById.get(st.student_profile_id) : null
              const g = Number(sumRow?.grade_chile)
              const student_display_name = resolveStudentDisplayName({
                student_name: st?.student_name ?? profile?.student_name ?? null,
                student_name_raw: sm?.student_name_raw ?? null,
                raw: sm?.raw,
              })
              return {
                evaluation_id: eid,
                student_display_name,
                student_normalized: st?.student_normalized ?? null,
                course_label: profile?.course_label ?? st?.course_label ?? ev?.course_label ?? "SIN CURSO",
                grade_chile: Number.isFinite(g) ? Math.round(g * 10) / 10 : 0,
                evaluated_at: ev?.evaluated_at ?? null,
              }
            })
            .filter((row) => row.student_display_name.trim() !== "")
        }
      } else if (sumErr) warnings.push(`summaries:${sumErr.message}`)
    } catch {
      warnings.push("risk_list_failed")
    }

    base.meta.student_count = analyses.length
    base.meta.evaluation_count = analyses.length
    base.meta.warnings = warnings
    base.accuracy_by_skill = accuracy_by_skill
    base.accuracy_by_axis = accuracy_by_axis
    base.cognitive_distribution = { by_achievement_weight, by_student_dominant_level }
    base.student_risk_list = {
      threshold_note_chile: 4.0,
      items: riskItems,
      total_below_threshold: totalBelow,
      page,
      page_size: pageSize,
      has_more: page * pageSize < totalBelow,
    }
    const gap_alerts = detectGapAlerts(accuracy_by_axis, accuracy_by_skill)
    const pme_actions = buildPmeActions(gap_alerts, totalBelow)
    const interdisciplinary_note = await buildInterdisciplinaryNote(supabase, organization_id, evalIds)
    const avgAxis =
      accuracy_by_axis.filter((x) => typeof x.achieved_pct === "number").reduce((acc, x) => acc + Number(x.achieved_pct), 0) /
      Math.max(1, accuracy_by_axis.filter((x) => typeof x.achieved_pct === "number").length)
    const avgSkill =
      accuracy_by_skill.filter((x) => typeof x.achieved_pct === "number").reduce((acc, x) => acc + Number(x.achieved_pct), 0) /
      Math.max(1, accuracy_by_skill.filter((x) => typeof x.achieved_pct === "number").length)
    const projectionLevel =
      avgSkill >= 70 ? "ADECUADO" : avgSkill >= 55 ? "ELEMENTAL" : "INSUFICIENTE"
    const topAxis = [...accuracy_by_axis]
      .filter((x) => typeof x.achieved_pct === "number")
      .sort((a, b) => Number(b.achieved_pct) - Number(a.achieved_pct))[0]
    const lowSkill = [...accuracy_by_skill]
      .filter((x) => typeof x.achieved_pct === "number")
      .sort((a, b) => Number(a.achieved_pct) - Number(b.achieved_pct))[0]
    base.strategic_analysis = {
      course_narrative:
        `Resumen del curso: Ejes ${Math.round(avgAxis)}%, Habilidades ${Math.round(avgSkill)}%, nivel proyectado ${projectionLevel}. ` +
        (topAxis && lowSkill
          ? `${shortLabel(topAxis.axis_label)} va mejor que ${shortLabel(lowSkill.skill_label)}.`
          : "Aplique reforzamiento focalizado en la habilidad más baja."),
      gap_alerts,
      pme_actions,
      interdisciplinary_note,
      student_narratives: riskItems.slice(0, 8).map((r) => ({
        evaluation_id: r.evaluation_id,
        student_display_name: r.student_display_name,
        note:
          `Nota ${r.grade_chile.toFixed(1)}. Mañana haga apoyo directo a este estudiante: ` +
          `repase el error más repetido, luego haga 3 problemas de la vida diaria y cierre con una pregunta corta de salida.`,
      })),
    }
    return base
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "unknown_error")
    return emptyStudentOutcomesPayload(auditReportId, warnings)
  }
}
