import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import {
  agencyLevelFromPct,
  getAgencyCuts,
  getDemreTable,
  getScopeOrganizationId,
  paesFromCorrectas,
} from "@/app/lib/services/pedagogical"

export const dynamic = "force-dynamic"

type RequestBody = {
  evaluation_id?: string
  student_id?: string | null
  year?: number
  grade_level?: string
  subject?: string
  paes_application?: "REGULAR" | "INVIERNO"
  paes_subject?: string
}

function riskFromLogro(logroPct: number): {
  level: "BAJO" | "ALTO"
  score: number
  flags: Array<{ code: string; severity: "ALTO"; message: string }>
} {
  const safe = Number.isFinite(logroPct) ? Math.max(0, Math.min(100, logroPct)) : 0
  if (safe < 50) {
    return {
      level: "ALTO",
      score: Math.round(100 - safe),
      flags: [{ code: "LOGRO_BAJO_50", severity: "ALTO", message: "Logro menor a 50%." }],
    }
  }
  return { level: "BAJO", score: Math.round(100 - safe), flags: [] }
}

export async function POST(req: NextRequest) {
  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ step: "auth", message: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ step: "config", message: "Supabase no configurado" }, { status: 503 })

  let body: RequestBody = {}
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ step: "validation", message: "Body JSON inválido" }, { status: 400 })
  }

  const evaluationId = String(body.evaluation_id ?? "").trim()
  if (!evaluationId) {
    return NextResponse.json({ step: "validation", message: "evaluation_id es requerido" }, { status: 400 })
  }

  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ step: "profile", message: "Perfil incompleto (teacher_id)" }, { status: 403 })
  }

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, teacher_id, course_id")
    .eq("id", evaluationId)
    .eq("teacher_id", teacherId)
    .maybeSingle()

  if (!evaluation) {
    return NextResponse.json({ step: "evaluation", message: "No encontrada o sin permiso" }, { status: 404 })
  }

  const { data: items, error: itemsErr } = await supabase
    .from("evaluation_items")
    .select("score_obtained, score_max, is_correct")
    .eq("evaluation_id", evaluationId)

  if (itemsErr) {
    return NextResponse.json({ step: "items", message: itemsErr.message }, { status: 500 })
  }

  const totalItems = (items ?? []).length
  const totalObtained = (items ?? []).reduce((acc, i) => acc + (Number(i.score_obtained) || 0), 0)
  const totalMax = (items ?? []).reduce((acc, i) => acc + (Number(i.score_max) || 0), 0)
  const logroPctRaw = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0
  const logroPct = Math.round(logroPctRaw * 100) / 100

  const correctFromItems = (items ?? []).filter((i) => i.is_correct === true).length
  const estimatedCorrectas = totalItems > 0 ? Math.round((Math.max(0, Math.min(100, logroPct)) / 100) * totalItems) : 0
  const correctAnswers = correctFromItems > 0 ? correctFromItems : estimatedCorrectas

  let studentId = body.student_id != null ? String(body.student_id).trim() : ""
  if (!studentId) {
    const { data: evalStudent } = await supabase
      .from("evaluation_students")
      .select("student_id")
      .eq("evaluation_id", evaluationId)
      .not("student_id", "is", null)
      .limit(1)
      .maybeSingle()
    studentId = String((evalStudent as { student_id?: string | null } | null)?.student_id ?? "").trim()
  }
  if (!studentId) {
    const { data: link } = await supabase
      .from("student_evaluations")
      .select("student_id")
      .eq("evaluation_id", evaluationId)
      .maybeSingle()
    studentId = String((link as { student_id?: string | null } | null)?.student_id ?? "").trim()
  }
  if (!studentId) {
    return NextResponse.json({ step: "student", message: "No se encontró student_id asociado a la evaluación" }, { status: 409 })
  }

  const targetYear = Number.isFinite(body.year) ? Number(body.year) : 2026
  const gradeLevel = (body.grade_level ?? "2M").trim().toUpperCase()
  const subject = (body.subject ?? "GENERAL").trim().toUpperCase()
  const paesApplication = body.paes_application ?? "REGULAR"
  const paesSubject = (body.paes_subject ?? "COMPETENCIA_LECTORA").trim().toUpperCase()

  const organizationId = await getScopeOrganizationId(supabase, user.id)
  if (!organizationId) {
    return NextResponse.json({ step: "profile", message: "No se pudo determinar organization_id de alcance" }, { status: 409 })
  }

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

  const paesEstimated = paesFromCorrectas(correctAnswers, demre.rows)
  const agencyLevel = agencyLevelFromPct(logroPct, agency.cuts)
  const risk = riskFromLogro(logroPct)

  const sourceLabel =
    agency.source === "REFERENCIAL" || demre.source === "REFERENCIAL"
      ? "REFERENCIAL"
      : "OFICIAL"

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
    course_id: evaluation.course_id ?? null,
    logro_pct: logroPct,
    correct_answers: correctAnswers,
    total_items: totalItems,
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
    return NextResponse.json({ step: "persist", message: saveErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    source_label: sourceLabel,
    projection: saved ?? upsertPayload,
    checks: {
      logro_pct: logroPct,
      correct_answers: correctAnswers,
      demre_rows_loaded: demre.rows.length,
      agency_cuts_loaded: agency.cuts.length,
    },
  })
}
