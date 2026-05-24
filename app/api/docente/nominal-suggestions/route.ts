/**
 * GET /api/docente/nominal-suggestions
 * Sugerencias nominales seguras (Graph Layer). No toca evaluate, OCR ni evaluation_students.
 */
import { NextRequest, NextResponse } from "next/server"
import {
  buildNominalSuggestionsForTeacher,
  isActiveManualNominalOverride,
  isGenericNominalName,
  normalizeNominalName,
  type RankedNominalCandidate,
} from "@/app/lib/pedagogical-graph/nominalIdentity"
import { findLastTeacherManualOverrideForExactObserved } from "@/app/lib/pedagogical-graph/historicalNominalBoost"
import { loadTeacherNominalConfirmationIndex } from "@/app/lib/pedagogical-graph/nominalConfirmationMemory"
import {
  deriveNominalConfidenceLevel,
  deriveNominalUxDecision,
} from "@/app/lib/pedagogical-graph/nominalUxConfidence"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV === "development"

export async function GET(req: NextRequest) {
  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  let teacherId = profile?.teacher_id != null ? String(profile.teacher_id).trim() : ""
  if (!teacherId) {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("teacher_id")
      .eq("user_id", user.id)
      .maybeSingle()
    teacherId =
      (profileRow as { teacher_id?: string | null } | null)?.teacher_id != null
        ? String((profileRow as { teacher_id: string }).teacher_id).trim()
        : ""
  }
  if (!teacherId) {
    return NextResponse.json({ error: "Perfil docente incompleto" }, { status: 403 })
  }

  const url = new URL(req.url)
  const observedNameRaw = String(url.searchParams.get("observed_name") ?? "").trim()
  if (!observedNameRaw) {
    return NextResponse.json({ error: "observed_name requerido" }, { status: 400 })
  }

  const resolvedDisplayName = String(url.searchParams.get("resolved_name") ?? "").trim() || undefined
  let courseLabel = String(url.searchParams.get("course_label") ?? "").trim() || null
  const courseId = String(url.searchParams.get("course_id") ?? "").trim() || null
  const evaluationId = String(url.searchParams.get("evaluation_id") ?? "").trim() || undefined
  const schoolId = profile?.school_id != null ? String(profile.school_id).trim() : null

  const { data: orgRow } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const organizationId =
    (orgRow as { organization_id?: string | null } | null)?.organization_id ?? null

  const confirmationIndex = await loadTeacherNominalConfirmationIndex(supabase, {
    teacherId,
    organizationId,
  })

  const observedNormProbe = normalizeNominalName(observedNameRaw).normalized
  const almivysInIndex = confirmationIndex.all.some(
    (r) => r.observed_name_normalized === "almivys"
  )

  const lastExactManualOverride = findLastTeacherManualOverrideForExactObserved(
    observedNormProbe,
    confirmationIndex.all
  )
  const lastOverrideDisplayName = lastExactManualOverride?.confirmed_display_name?.trim() ?? ""
  const lastOverrideNorm = lastOverrideDisplayName
    ? normalizeNominalName(lastOverrideDisplayName).normalized
    : ""

  const resolvedNormProbe = resolvedDisplayName
    ? normalizeNominalName(resolvedDisplayName).normalized
    : ""
  const manualOverrideActiveProbe = isActiveManualNominalOverride(observedNameRaw, resolvedDisplayName)
  const manualEmptyForMemory =
    resolvedNormProbe.length > 0 && resolvedNormProbe === observedNormProbe
  const manualMatchesObserved = manualEmptyForMemory

  if (!courseLabel && courseId) {
    const { data: evalCourseRow } = await supabase
      .from("evaluations")
      .select("course_label")
      .eq("teacher_id", teacherId)
      .eq("course_id", courseId)
      .not("course_label", "is", null)
      .order("evaluated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const inferred =
      (evalCourseRow as { course_label?: string | null } | null)?.course_label != null
        ? String((evalCourseRow as { course_label: string }).course_label).trim()
        : ""
    if (inferred) courseLabel = inferred
  }

  // Si el campo manual aún muestra el OCR, no bloquear ranking ni memoria (manualEmptyForMemory).
  let resolvedForRanking = resolvedDisplayName
  if (!manualOverrideActiveProbe && manualEmptyForMemory) {
    resolvedForRanking = undefined
  }

  const result = await buildNominalSuggestionsForTeacher(supabase, {
    teacherId,
    schoolId,
    courseId,
    courseLabel,
    currentEvaluationId: evaluationId,
    observedNameRaw,
    resolvedDisplayName: resolvedForRanking,
    confirmationIndex,
    manualEmptyForMemory,
    manualMatchesObserved,
  })

  let rankedForResponse = result.ranked
  if (lastOverrideDisplayName && !manualOverrideActiveProbe) {
    const pinned: RankedNominalCandidate = {
      displayName: lastOverrideDisplayName,
      normalized: lastOverrideNorm,
      importantTokens: normalizeNominalName(lastOverrideDisplayName).importantTokens,
      studentProfileId: lastExactManualOverride?.student_profile_id ?? null,
      catalogStudentId: lastExactManualOverride?.catalog_student_id ?? null,
      courseLabel: lastExactManualOverride?.course_label ?? courseLabel,
      schoolId: null,
      sameCourse: false,
      sameSchool: false,
      historicalMatchCount: 0,
      historicalConfirmationCount: lastExactManualOverride?.historical_confirmation_count ?? 1,
      source: "historical_nominal_memory",
      score: 1,
      baseNominalScore: 1,
      levenshteinSimilarity: 1,
      tokenBagMatch: false,
      tokenOverlap: 0,
      reasons: ["last_teacher_manual_override"],
      historical_nominal_boost_applied: false,
      historical_nominal_boost_value: 0,
      consistency_score: 1,
    }
    rankedForResponse = [
      pinned,
      ...rankedForResponse.filter(
        (c) => normalizeNominalName(c.displayName).normalized !== lastOverrideNorm
      ),
    ]
  }

  const candidates = rankedForResponse.map((c, index) => ({
    display_name: c.displayName,
    rank: index,
    match_score: c.score,
    levenshtein_similarity: c.levenshteinSimilarity,
    reasons: c.reasons,
    source: c.reasons.includes("last_teacher_manual_override")
      ? "last_teacher_manual_override"
      : c.source,
    student_profile_id: c.studentProfileId,
    catalog_student_id: c.catalogStudentId,
    historical_confirmation_count: c.historicalConfirmationCount,
    historical_match_count: c.historicalMatchCount,
    historical_nominal_boost_applied: c.historical_nominal_boost_applied ?? false,
    historical_nominal_boost_value: c.historical_nominal_boost_value ?? 0,
    consistency_score: c.consistency_score,
    same_course: c.sameCourse,
    requires_teacher_review: true,
  }))

  if (isDev) {
    console.info("[nominal-suggestions]", {
      observed_name: observedNameRaw,
      observed_name_normalized: observedNormProbe,
      teacher_id: teacherId,
      course_label: courseLabel,
      confirmationIndex_all_length: confirmationIndex.all.length,
      index_first_5: confirmationIndex.all.slice(0, 5).map((r) => ({
        observed_name_raw: r.observed_name_raw,
        observed_name_normalized: r.observed_name_normalized,
        confirmed_display_name: r.confirmed_display_name,
        confirmation_type: r.confirmation_type,
        course_label: r.course_label,
      })),
      has_almivys_observed_normalized: almivysInIndex,
      last_exact_manual_override: lastOverrideDisplayName || null,
      final_candidates: candidates.map((c) => ({
        display_name: c.display_name,
        source: c.source,
        match_score: c.match_score,
        historical_confirmation_count: c.historical_confirmation_count,
        reasons: c.reasons,
      })),
    })
  }

  const manualOverrideActive =
    result.manualOverrideActive === true || manualOverrideActiveProbe
  const top = manualOverrideActive ? null : (candidates[0] ?? null)
  const memory = result.memoryResolution
  const nominal_confidence_level = deriveNominalConfidenceLevel(observedNameRaw, top, memory)
  const ux = deriveNominalUxDecision({
    observedRaw: observedNameRaw,
    manualName: resolvedDisplayName ?? "",
    topCandidate: top,
    manualMatchesObserved,
    manualEmptyForMemory,
    memoryResolution: memory,
  })

  const autofillDisplayName =
    memory?.autofill_eligible && memory.dominant_entry?.confirmedDisplayName
      ? memory.dominant_entry.confirmedDisplayName
      : top?.display_name ?? null
  const otherCourseName = memory?.other_course_suggested_name ?? null

  const topRanked = rankedForResponse[0]
  const secondaryHistoricalSuggestion =
    typeof result.secondaryHistoricalSuggestion === "string"
      ? result.secondaryHistoricalSuggestion
      : null

  const topSource = topRanked?.reasons?.includes("last_teacher_manual_override")
    ? "last_teacher_manual_override"
    : topRanked?.source ?? null
  const historicalConfirmationCount = memory?.dominant_entry?.historical_confirmation_count ?? topRanked?.historicalConfirmationCount ?? 0

  const nominal_memory_debug = {
    observed_name_normalized: result.observed.normalized,
    requested_course_label: courseLabel,
    same_course_confirmation_count: memory?.same_course_confirmation_count ?? 0,
    other_course_confirmation_count: memory?.other_course_confirmation_count ?? 0,
    historical_confirmation_count: historicalConfirmationCount,
    autofill_eligible: memory?.autofill_eligible === true,
    nominal_ux_mode: ux.nominal_ux_mode,
    allow_visual_prefill: ux.allow_visual_prefill,
    manual_empty_for_memory: manualEmptyForMemory,
    top_suggestion:
      memory?.autofill_eligible && memory.dominant_entry?.confirmedDisplayName
        ? memory.dominant_entry.confirmedDisplayName
        : top?.display_name ?? null,
    top_source: topSource,
  }

  return NextResponse.json({
    ok: true,
    observed_name_raw: result.observed.raw,
    observed_name_normalized: result.observed.normalized,
    skipped_reason: result.skippedReason ?? null,
    manual_override_active: manualOverrideActive,
    resolved_name: manualOverrideActive ? resolvedDisplayName ?? null : null,
    secondary_historical_suggestion: manualOverrideActive ? secondaryHistoricalSuggestion : null,
    top_suggestion: manualOverrideActive
      ? resolvedDisplayName && !isGenericNominalName(resolvedDisplayName)
        ? resolvedDisplayName
        : null
      : nominal_memory_debug.top_suggestion ??
        (memory?.dominant_entry?.confirmedDisplayName?.trim() || null),
    candidates: manualOverrideActive ? [] : candidates,
    nominal_confidence_level,
    nominal_ux_mode: ux.nominal_ux_mode,
    allow_visual_prefill: ux.allow_visual_prefill,
    requires_teacher_review: ux.requires_teacher_review,
    manual_edit_is_authority: true,
    autofill_display_name: autofillDisplayName,
    other_course_memory: otherCourseName
      ? {
          eligible: memory?.other_course_suggestion_eligible === true,
          confirmed_name: otherCourseName,
          message: `Antes corregiste este OCR como ${otherCourseName} en otro curso`,
        }
      : null,
    nominal_memory: memory
      ? {
          last_teacher_correction: memory.last_teacher_correction,
          previous_used_name: memory.previous_used_name,
          preferred_complete_name: memory.preferred_complete_name,
          last_correction_is_abbreviated: memory.last_correction_is_abbreviated,
          has_historical_conflict: memory.has_historical_conflict,
          autofill_eligible: memory.autofill_eligible,
          other_course_suggestion_eligible: memory.other_course_suggestion_eligible,
          other_course_suggested_name: memory.other_course_suggested_name,
          same_course_confirmation_count: memory.same_course_confirmation_count,
          other_course_confirmation_count: memory.other_course_confirmation_count,
          consistency_score: memory.consistency_score,
        }
      : null,
    nominal_memory_debug,
    conflict_message: ux.conflict_message ?? null,
    previous_used_label: ux.previous_used_label ?? null,
    historical_nominal_boost_applied: topRanked?.historical_nominal_boost_applied ?? false,
    historical_nominal_boost_value: topRanked?.historical_nominal_boost_value ?? 0,
    historical_boost: topRanked
      ? {
          applied: topRanked.historical_nominal_boost_applied ?? false,
          value: topRanked.historical_nominal_boost_value ?? 0,
          historical_confirmation_count: topRanked.historicalConfirmationCount ?? 0,
          consistency_score: topRanked.consistency_score ?? 0,
        }
      : null,
  })
}
