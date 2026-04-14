/**
 * Upsert en student_projections a partir de una evaluación (ítems + estudiante).
 * Usado por POST /api/pedagogy/calculate-projections y por persist-evaluation (service role).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { ensureStudentRowForStudentProfile } from "@/app/lib/student-identity/repository"
import {
  agencyLevelFromPct,
  getAgencyCuts,
  getDemreTable,
  paesFromCorrectas,
} from "@/app/lib/services/pedagogical"
import { projectPaesFromLogroPct, projectSimceFromLogroPct } from "@/app/lib/standard-scale-converters"

export type UpsertStudentProjectionResult =
  | { ok: true; projection: Record<string, unknown> }
  | { ok: false; step: string; message: string }

export function riskLevelFromLogroPct(logroPct: number): {
  level: "BAJO" | "MEDIO" | "ALTO"
  score: number
  flags: Array<{ code: string; severity: "ALTO"; message: string }>
} {
  const safe = Number.isFinite(logroPct) ? Math.max(0, Math.min(100, logroPct)) : 0
  if (safe < 40) {
    return {
      level: "ALTO",
      score: Math.round(100 - safe),
      flags: [{ code: "LOGRO_BAJO_40", severity: "ALTO", message: "Logro menor a 40% (alerta temprana)." }],
    }
  }
  if (safe < 50) {
    return {
      level: "ALTO",
      score: Math.round(100 - safe),
      flags: [{ code: "LOGRO_BAJO_50", severity: "ALTO", message: "Logro menor a 50%." }],
    }
  }
  return { level: "BAJO", score: Math.round(100 - safe), flags: [] }
}

async function resolveOrganizationIdForEvaluation(
  supabase: SupabaseClient,
  teacherId: string | null
): Promise<string | null> {
  if (!teacherId) return null
  const { data } = await supabase
    .from("profiles")
    .select("organization_id, school_id, teacher_id")
    .eq("teacher_id", teacherId)
    .limit(1)
    .maybeSingle()
  const row = data as {
    organization_id?: string | null
    school_id?: string | null
    teacher_id?: string | null
  } | null
  // Mismo criterio que `current_scope_org_id()` y `getScopeOrganizationId` (pedagogical.ts)
  const scope = row?.organization_id ?? row?.school_id ?? row?.teacher_id ?? null
  return scope != null && String(scope).trim() !== "" ? String(scope) : null
}

async function resolveStudentIdForEvaluation(
  supabase: SupabaseClient,
  evaluationId: string
): Promise<string | null> {
  const { data: evalStudent } = await supabase
    .from("evaluation_students")
    .select("student_id")
    .eq("evaluation_id", evaluationId)
    .not("student_id", "is", null)
    .limit(1)
    .maybeSingle()
  let sid = String((evalStudent as { student_id?: string | null } | null)?.student_id ?? "").trim()
  if (sid) return sid
  const { data: link } = await supabase
    .from("student_evaluations")
    .select("student_id")
    .eq("evaluation_id", evaluationId)
    .maybeSingle()
  sid = String((link as { student_id?: string | null } | null)?.student_id ?? "").trim()
  if (sid) return sid

  const { data: esRow } = await supabase
    .from("evaluation_students")
    .select("student_profile_id, student_name, course_label")
    .eq("evaluation_id", evaluationId)
    .not("student_profile_id", "is", null)
    .limit(1)
    .maybeSingle()
  const profileId = String(
    (esRow as { student_profile_id?: string | null } | null)?.student_profile_id ?? ""
  ).trim()
  if (!profileId) return null
  const fullName =
    String((esRow as { student_name?: string | null } | null)?.student_name ?? "").trim() || "Estudiante"
  const courseLabel = (esRow as { course_label?: string | null } | null)?.course_label ?? null
  const bridgeId = await ensureStudentRowForStudentProfile(supabase, {
    student_profile_id: profileId,
    full_name: fullName,
    course_label: courseLabel,
  })
  if (!bridgeId) return null
  await supabase
    .from("evaluation_students")
    .update({ student_id: bridgeId })
    .eq("evaluation_id", evaluationId)
    .eq("student_profile_id", profileId)
  await supabase
    .from("student_evaluations")
    .upsert(
      {
        student_id: bridgeId,
        evaluation_id: evaluationId,
        course_label: courseLabel,
        evaluated_at: new Date().toISOString(),
      },
      { onConflict: "evaluation_id" }
    )
    .select("id")
    .maybeSingle()
  return bridgeId
}

export async function upsertStudentProjectionFromEvaluation(
  supabase: SupabaseClient,
  evaluationId: string,
  input?: {
    year?: number
    gradeLevel?: string
    subject?: string
    paesApplication?: "REGULAR" | "INVIERNO"
    paesSubject?: string
  }
): Promise<UpsertStudentProjectionResult> {
  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, course_id")
    .eq("id", evaluationId)
    .maybeSingle()

  if (evalErr || !evaluation) {
    return { ok: false, step: "evaluation", message: evalErr?.message ?? "Evaluación no encontrada" }
  }

  const { data: items, error: itemsErr } = await supabase
    .from("evaluation_items")
    .select("score_obtained, score_max, is_correct")
    .eq("evaluation_id", evaluationId)

  if (itemsErr) {
    return { ok: false, step: "items", message: itemsErr.message }
  }

  const totalItems = (items ?? []).length
  const totalObtained = (items ?? []).reduce((acc, i) => acc + (Number(i.score_obtained) || 0), 0)
  const totalMax = (items ?? []).reduce((acc, i) => acc + (Number(i.score_max) || 0), 0)
  if (totalMax <= 0) {
    return { ok: false, step: "items", message: "Sin puntaje máximo en ítems; no se calcula proyección" }
  }

  const logroPctRaw = (totalObtained / totalMax) * 100
  const logroPct = Math.round(logroPctRaw * 100) / 100

  const studentId = await resolveStudentIdForEvaluation(supabase, evaluationId)
  if (!studentId) {
    return { ok: false, step: "student", message: "No se encontró student_id asociado a la evaluación" }
  }

  const teacherId = String((evaluation as { teacher_id?: string | null }).teacher_id ?? "").trim() || null
  const organizationId = await resolveOrganizationIdForEvaluation(supabase, teacherId)
  if (!organizationId) {
    return { ok: false, step: "organization", message: "No se pudo determinar organization_id del docente" }
  }

  const targetYear = Number.isFinite(input?.year) ? Number(input?.year) : 2026
  const gradeLevel = (input?.gradeLevel ?? "2M").trim().toUpperCase()
  const subject = (input?.subject ?? "GENERAL").trim().toUpperCase()
  const paesApplication = input?.paesApplication ?? "REGULAR"
  const paesSubject = (input?.paesSubject ?? "COMPETENCIA_LECTORA").trim().toUpperCase()

  const [agency, demre] = await Promise.all([
    getAgencyCuts({
      supabase,
      organizationId,
      year: targetYear,
      gradeLevel,
      subject,
    }),
    getDemreTable({
      supabase,
      organizationId,
      year: targetYear,
      application: paesApplication,
      subject: paesSubject,
    }),
  ])

  const correctFromItems = (items ?? []).filter((i) => i.is_correct === true).length
  const estimatedCorrectas =
    totalItems > 0 ? Math.round((Math.max(0, Math.min(100, logroPct)) / 100) * totalItems) : 0
  const correctAnswers = correctFromItems > 0 ? correctFromItems : estimatedCorrectas

  const demreScore = paesFromCorrectas(correctAnswers, demre.rows)
  const paesFromLogro = projectPaesFromLogroPct(logroPct)
  const paesEstimated = Math.round(Math.max(100, demreScore ?? paesFromLogro))

  const agencyLevel = agencyLevelFromPct(logroPct, agency.cuts)
  const risk = riskLevelFromLogroPct(logroPct)
  const simceEstimated = projectSimceFromLogroPct(logroPct)

  const sourceLabel =
    agency.source === "REFERENCIAL" || demre.source === "REFERENCIAL" ? "REFERENCIAL" : "OFICIAL"

  const parametersSnapshot = {
    source_label: sourceLabel,
    agency: {
      key: agency.parameterKey,
      year_used: agency.yearUsed,
      source_label: agency.source,
    },
    demre: {
      key: demre.parameterKey,
      year_used: demre.yearUsed,
      source_label: demre.source,
      table_subject: paesSubject,
      application: paesApplication,
    },
  }

  const upsertPayload = {
    organization_id: organizationId,
    student_id: studentId,
    evaluation_id: evaluationId,
    course_id: (evaluation as { course_id?: string | null }).course_id ?? null,
    logro_pct: logroPct,
    correct_answers: correctAnswers,
    total_items: totalItems,
    simce_estimated: simceEstimated,
    paes_estimated: paesEstimated,
    paes_test_type: paesSubject,
    paes_application: paesApplication,
    simce_level_label: agencyLevel,
    risk_score: risk.score,
    risk_level: risk.level,
    risk_flags: risk.flags,
    parameters_snapshot: parametersSnapshot,
    calculated_at: new Date().toISOString(),
  }

  const { data: saved, error: saveErr } = await supabase
    .from("student_projections")
    .upsert(upsertPayload, { onConflict: "student_id,evaluation_id" })
    .select("*")
    .maybeSingle()

  if (saveErr) {
    return { ok: false, step: "persist", message: saveErr.message }
  }

  return { ok: true, projection: (saved ?? upsertPayload) as Record<string, unknown> }
}
