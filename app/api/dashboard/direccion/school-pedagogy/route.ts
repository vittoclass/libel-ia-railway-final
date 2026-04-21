/**
 * Analítica pedagógica agregada por school_id (vista Dirección / UTP).
 * Solo lectura; no toca captura ni OMR.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import {
  buildSchoolExecutiveNarrative,
  levelDistributionFromLevels,
  type SchoolSkillAggregateRow,
} from "@/app/lib/chile-standards/school-executive-narrative"
import type { ChileAgencyAchievementLevel } from "@/app/lib/chile-standards/agency-level-cuts"
import { agencyAchievementLevelFromLogroPct } from "@/app/lib/chile-standards/agency-level-cuts"
import { resolveChileMinisterialSkillCode } from "@/app/lib/chile-standards/evaluation-dictionary"
import { canonicalPedagogicalSkillDisplayLabel } from "@/app/lib/analyze-learning-results"
import {
  evaluationMatchesExamTypeQueryParam,
  getInstrumentAnalyticsModeFromEvaluationTags,
} from "@/app/lib/assessment-category"
import {
  buildSegmentBuckets,
  evalMatchesSubjectAndFamily,
  parseInstrumentFamilyQueryParam,
  resolveInstitutionalScope,
  type EvalTagRow,
} from "@/app/lib/pedagogy-segment-filters"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function jsonNoStore(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, {
    status: init?.status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  })
}

function isPlaceholderSchoolId(v: string): boolean {
  const s = String(v ?? "").trim().toLowerCase()
  return s === "00000000-0000-0000-0000-000000000000" || s === "0"
}

function normalizeCourseKey(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return jsonNoStore({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return jsonNoStore({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  const relax = isDashboardInstitutionalRelaxEnabled()
  const allowedProd =
    role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN" || role === "UTP"
  if (!relax && !isMasterEmail(user.email) && !allowedProd) {
    return jsonNoStore({ error: "Prohibido" }, { status: 403 })
  }

  const profileSchoolId = (profile as { school_id?: string | null } | null)?.school_id ?? null
  const requestedSchoolId = req.nextUrl.searchParams.get("school_id")?.trim() ?? ""
  const schoolId = requestedSchoolId && !isPlaceholderSchoolId(requestedSchoolId) ? requestedSchoolId : profileSchoolId
  if (!schoolId) {
    return jsonNoStore({
      error: "Perfil sin school_id",
      school_id: null,
      evaluation_count: 0,
      by_skill: [] as SchoolSkillAggregateRow[],
      analisis_utp: [] as string[],
    })
  }

  const examTypeParam = req.nextUrl.searchParams.get("exam_type")?.trim() ?? ""
  const batchIdParam = req.nextUrl.searchParams.get("batch_id")?.trim() ?? ""
  const courseParam = req.nextUrl.searchParams.get("course")?.trim() ?? ""

  let query = supabase
    .from("evaluations")
    .select("id, subject, exam_type, assessment_category, course_id, course_label")
    .eq("school_id", schoolId)
    .eq("is_archived", false)
    .order("evaluated_at", { ascending: false })
    .limit(800)
  if (batchIdParam) query = query.eq("batch_id", batchIdParam)

  const { data: evaluations, error: evErr } = await query
  if (evErr) return jsonNoStore({ error: evErr.message }, { status: 500 })

  const evRows = (evaluations ?? []) as Array<{
    id: string
    subject?: string | null
    exam_type?: string | null
    assessment_category?: string | null
    course_id?: string | null
    course_label?: string | null
  }>

  let evFiltered = evRows
  if (courseParam) {
    const ck = normalizeCourseKey(courseParam)
    evFiltered = evFiltered.filter(
      (e) =>
        normalizeCourseKey(e.course_id) === ck ||
        (e.course_label != null && normalizeCourseKey(e.course_label) === ck),
    )
  }
  if (examTypeParam) {
    evFiltered = evFiltered.filter((e) =>
      evaluationMatchesExamTypeQueryParam(e.exam_type, e.assessment_category, examTypeParam),
    )
  }

  const segments = buildSegmentBuckets(evFiltered as EvalTagRow[])
  const subjectParamRaw = req.nextUrl.searchParams.get("subject")?.trim() ?? ""
  const familyFromQuery = parseInstrumentFamilyQueryParam(req.nextUrl.searchParams.get("instrument_family"))
  const familyFromLegacyExam =
    familyFromQuery == null && examTypeParam
      ? getInstrumentAnalyticsModeFromEvaluationTags(examTypeParam, null)
      : null
  const effectiveFamily = familyFromQuery ?? familyFromLegacyExam

  const scope = resolveInstitutionalScope({
    segments,
    subjectParam: subjectParamRaw,
    familyParam: effectiveFamily,
    autoSelectSingleNationalAmongMixed: true,
  })

  if (scope.mode === "segmentation_only" && evFiltered.length > 0) {
    return jsonNoStore({
      school_id: schoolId,
      summary_available: false,
      status_reason: "requires_subject_and_instrument_family",
      segmentation: segments,
      segment_auto_selected: false,
      subject_filter: null,
      instrument_family_filter: null,
      evaluation_count: 0,
      evaluation_count_total: evFiltered.length,
      exam_type_filter: examTypeParam || null,
      batch_id_filter: batchIdParam || null,
      course_filter: courseParam || null,
      by_skill: [] as SchoolSkillAggregateRow[],
      analisis_utp: buildSchoolExecutiveNarrative({ school_id: schoolId, evaluation_count: 0, skill_rows: [] }),
    })
  }

  const filteredEvals =
    scope.mode === "full"
      ? evFiltered.filter((e) =>
          evalMatchesSubjectAndFamily(e as EvalTagRow, scope.subject_key, scope.family),
        )
      : []

  const evaluationIds = filteredEvals.map((e) => String(e.id)).filter(Boolean)
  if (evaluationIds.length === 0) {
    const emptyReason =
      evFiltered.length === 0 ? "no_evaluations_in_course" : "no_evaluations_for_segment"
    return jsonNoStore({
      school_id: schoolId,
      summary_available: false,
      status_reason: emptyReason,
      segmentation: segments,
      segment_auto_selected: scope.mode === "full" ? scope.auto_selected : false,
      subject_filter: scope.mode === "full" ? scope.subject_key : null,
      instrument_family_filter: scope.mode === "full" ? scope.family : null,
      evaluation_count: 0,
      evaluation_count_total: evFiltered.length,
      exam_type_filter: examTypeParam || null,
      batch_id_filter: batchIdParam || null,
      course_filter: courseParam || null,
      by_skill: [] as SchoolSkillAggregateRow[],
      analisis_utp: buildSchoolExecutiveNarrative({ school_id: schoolId, evaluation_count: 0, skill_rows: [] }),
    })
  }

  const { data: skillRes, error: srErr } = await supabase
    .from("evaluation_skill_results")
    .select("skill_id, logro_pct, achievement_level, score_obtained, score_max")
    .in("evaluation_id", evaluationIds)

  if (srErr) return jsonNoStore({ error: srErr.message }, { status: 500 })

  const rows = (skillRes ?? []) as Array<{
    skill_id: string | null
    logro_pct: number | null
    achievement_level: string | null
    score_obtained: number | null
    score_max: number | null
  }>

  const skillIds = [...new Set(rows.map((r) => r.skill_id).filter(Boolean))] as string[]
  const skillMeta = new Map<string, { name: string; subject: string | null }>()
  if (skillIds.length > 0) {
    const { data: skRows } = await supabase.from("pedagogy_skills").select("id, name, axis_id").in("id", skillIds)
    const axisIds = [...new Set((skRows ?? []).map((s) => (s as { axis_id?: string }).axis_id).filter(Boolean))] as string[]
    const axisSubject = new Map<string, string | null>()
    if (axisIds.length > 0) {
      const { data: axRows } = await supabase.from("pedagogy_axes").select("id, subject").in("id", axisIds)
      for (const a of axRows ?? []) {
        const ax = a as { id: string; subject?: string | null }
        axisSubject.set(ax.id, ax.subject ?? null)
      }
    }
    for (const s of skRows ?? []) {
      const sk = s as { id: string; name?: string | null; axis_id?: string | null }
      const subj = sk.axis_id ? axisSubject.get(sk.axis_id) ?? null : null
      skillMeta.set(sk.id, { name: String(sk.name ?? "—"), subject: subj })
    }
  }

  type Acc = {
    sumLogro: number
    nLogro: number
    levels: Array<ChileAgencyAchievementLevel | null>
  }
  /** Agrupa por etiqueta canónica de habilidad (mismo criterio que analyze-learning-results). */
  const bySkill = new Map<string, Acc>()
  for (const r of rows) {
    const sid = r.skill_id
    if (!sid) continue
    const meta = skillMeta.get(sid)
    const subj = meta?.subject ?? null
    const canonName = canonicalPedagogicalSkillDisplayLabel(meta?.name ?? "—")
    const aggKey = `${subj ?? ""}::${canonName}`
    const acc = bySkill.get(aggKey) ?? { sumLogro: 0, nLogro: 0, levels: [] }
    let lp = r.logro_pct != null && Number.isFinite(Number(r.logro_pct)) ? Math.round(Number(r.logro_pct)) : null
    if (lp == null && r.score_max != null && Number(r.score_max) > 0) {
      lp = Math.round(Math.max(0, Math.min(100, (Number(r.score_obtained) || 0) / Number(r.score_max)) * 100))
    }
    if (lp != null) {
      acc.sumLogro += lp
      acc.nLogro += 1
    }
    let level = r.achievement_level as ChileAgencyAchievementLevel | null
    if (level !== "Insuficiente" && level !== "Elemental" && level !== "Adecuado") {
      level = lp != null ? agencyAchievementLevelFromLogroPct(lp) : null
    }
    acc.levels.push(level)
    bySkill.set(aggKey, acc)
  }

  const by_skill: SchoolSkillAggregateRow[] = []
  for (const [aggKey, acc] of bySkill) {
    const sep = aggKey.indexOf("::")
    const subjFromKey = sep >= 0 ? aggKey.slice(0, sep) : ""
    const canonSkillName = sep >= 0 ? aggKey.slice(sep + 2) : aggKey
    const subjectResolved = subjFromKey.trim() !== "" ? subjFromKey : null
    const avg_logro_pct = acc.nLogro > 0 ? Math.round(acc.sumLogro / acc.nLogro) : null
    const dist = levelDistributionFromLevels(acc.levels)
    by_skill.push({
      skill_name: canonSkillName,
      subject: subjectResolved,
      ministerial_skill_code: resolveChileMinisterialSkillCode(
        subjectResolved ?? "Lenguaje",
        canonSkillName,
      ),
      avg_logro_pct,
      student_result_rows: acc.levels.length,
      insuficiente_pct: dist.insuficiente_pct,
      elemental_pct: dist.elemental_pct,
      adecuado_pct: dist.adecuado_pct,
    })
  }
  by_skill.sort((a, b) => (a.avg_logro_pct ?? 999) - (b.avg_logro_pct ?? 999))

  const analisis_utp = buildSchoolExecutiveNarrative({
    school_id: schoolId,
    evaluation_count: filteredEvals.length,
    skill_rows: by_skill,
  })

  return jsonNoStore({
    school_id: schoolId,
    summary_available: true,
    status_reason: "ok",
    segmentation: segments,
    segment_auto_selected: scope.mode === "full" ? scope.auto_selected : false,
    subject_filter: scope.mode === "full" ? scope.subject_key : null,
    instrument_family_filter: scope.mode === "full" ? scope.family : null,
    evaluation_count: filteredEvals.length,
    evaluation_count_total: evFiltered.length,
    exam_type_filter: examTypeParam || null,
    batch_id_filter: batchIdParam || null,
    course_filter: courseParam || null,
    skill_result_rows: rows.length,
    by_skill,
    analisis_utp,
  })
}
