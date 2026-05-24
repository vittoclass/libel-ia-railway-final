/**
 * POST /api/docente/nominal-confirmation
 * Registro observacional de confirmación nominal docente (append-only).
 * No modifica evaluation_students, students ni scoring.
 */
import { NextRequest, NextResponse } from "next/server"
import {
  recordTeacherNominalConfirmation,
  type NominalConfirmationType,
} from "@/app/lib/pedagogical-graph/nominalConfirmationMemory"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV === "development"

function devNominalDiagnostics(result: {
  storage?: string
  error_code?: string
  error_message?: string
  insert_error_details?: { details?: string | null; hint?: string | null }
}) {
  if (!isDev) return {}
  return {
    error_code: result.error_code,
    error_message: result.error_message,
    insert_error_details: result.insert_error_details,
  }
}

const CONFIRMATION_TYPES = new Set<NominalConfirmationType>([
  "exact_match",
  "manual_override",
  "suggested_match",
  "ignored",
])

/** Schema POST esperado (JSON). */
export const NOMINAL_CONFIRMATION_BODY_SCHEMA = {
  observed_name_raw: "string (requerido, no vacío)",
  confirmed_display_name: "string | null (requerido salvo ignored)",
  confirmation_type: "exact_match | manual_override | suggested_match | ignored",
  evaluation_id: "uuid | null (opcional; vacío → null)",
  course_label: "string | null (opcional)",
  student_profile_id: "string | null (opcional)",
  catalog_student_id: "string | null (opcional)",
  match_score: "number | null (opcional)",
  manual_override: "boolean (opcional)",
  exact_match: "boolean (opcional)",
  ignored: "boolean (opcional)",
  source: "string | null (opcional)",
} as const

function trimOrNull(v: unknown): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t || null
}

function logInvalidNominalBody(details: Record<string, unknown>) {
  console.warn("[nominal-confirmation invalid body]", details)
}

type Body = {
  observed_name_raw?: string
  confirmed_display_name?: string | null
  student_profile_id?: string | null
  catalog_student_id?: string | null
  evaluation_id?: string | null
  match_score?: number | null
  manual_override?: boolean
  exact_match?: boolean
  confirmation_type?: string
  source?: string | null
  ignored?: boolean
  course_label?: string | null
}

export async function POST(req: NextRequest) {
  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })

  const teacherId = profile?.teacher_id != null ? String(profile.teacher_id).trim() : ""
  if (!teacherId) {
    return NextResponse.json({ ok: false, error: "Perfil docente incompleto" }, { status: 403 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error: "Supabase no configurado",
        storage: "none",
        persisted: false,
        ...(isDev
          ? {
              error_code: "SUPABASE_NOT_CONFIGURED",
              error_message: !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
                ? "Falta SUPABASE_SERVICE_ROLE_KEY"
                : "Cliente Supabase no disponible",
            }
          : {}),
      },
      { status: 503 }
    )
  }

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    logInvalidNominalBody({ reason: "json_parse_failed", received_body: null })
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 })
  }

  console.log("[nominal route received]", body)

  const observedNameRaw = String(body.observed_name_raw ?? "").trim()
  const confirmedDisplayName = trimOrNull(body.confirmed_display_name)
  const evaluationId = trimOrNull(body.evaluation_id)
  const rawType = String(body.confirmation_type ?? "").trim()
  const confirmationType = CONFIRMATION_TYPES.has(rawType as NominalConfirmationType)
    ? (rawType as NominalConfirmationType)
    : null
  const ignored = body.ignored === true || confirmationType === "ignored"

  const missingFields: string[] = []
  if (!observedNameRaw) missingFields.push("observed_name_raw")
  if (!ignored && !confirmedDisplayName) missingFields.push("confirmed_display_name")

  const invalidConfirmationType =
    rawType.length > 0 && confirmationType == null ? rawType : undefined
  const invalidEvaluationId =
    body.evaluation_id != null && String(body.evaluation_id).trim() === ""
      ? String(body.evaluation_id)
      : undefined
  const invalidObservedName = !observedNameRaw
    ? { received: body.observed_name_raw, legacy_observed_name: (body as { observed_name?: unknown }).observed_name }
    : undefined
  const invalidConfirmedName =
    !ignored && !confirmedDisplayName
      ? { received: body.confirmed_display_name, legacy_confirmed_name: (body as { confirmed_name?: unknown }).confirmed_name }
      : undefined

  if (missingFields.length > 0 || invalidConfirmationType) {
    logInvalidNominalBody({
      received_body: body,
      missing_fields: missingFields,
      invalid_confirmation_type: invalidConfirmationType,
      invalid_evaluation_id: invalidEvaluationId,
      invalid_observed_name: invalidObservedName,
      invalid_confirmed_name: invalidConfirmedName,
      expected_schema: NOMINAL_CONFIRMATION_BODY_SCHEMA,
    })
    if (!observedNameRaw) {
      return NextResponse.json({ ok: false, error: "observed_name_raw requerido" }, { status: 400 })
    }
    if (!ignored && !confirmedDisplayName) {
      return NextResponse.json({ ok: false, error: "confirmed_display_name requerido" }, { status: 400 })
    }
  }

  const { data: orgRow } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const organizationId =
    (orgRow as { organization_id?: string | null } | null)?.organization_id ?? null

  const result = await recordTeacherNominalConfirmation(supabase, {
    teacherId,
    userId: user.id,
    organizationId,
    evaluationId,
    observedNameRaw,
    confirmedDisplayName,
    studentProfileId: body.student_profile_id ?? null,
    catalogStudentId: body.catalog_student_id ?? null,
    manualOverride: body.manual_override === true,
    exactMatch: body.exact_match === true,
    confirmationType,
    source: body.source ?? null,
    ignored: body.ignored === true || confirmationType === "ignored",
    matchScore: typeof body.match_score === "number" ? body.match_score : null,
    courseLabel: body.course_label ?? null,
  })

  const storage = result.storage ?? "unknown"
  const persisted = result.persisted === true && storage === "graph_nominal_confirmations"

  if (!result.ok) {
    logInvalidNominalBody({
      reason: "record_failed",
      received_body: body,
      error: result.error,
      storage: result.storage,
      missing_fields: missingFields,
      invalid_confirmation_type: invalidConfirmationType,
      invalid_evaluation_id: invalidEvaluationId,
      invalid_observed_name: invalidObservedName,
      invalid_confirmed_name: invalidConfirmedName,
      expected_schema: NOMINAL_CONFIRMATION_BODY_SCHEMA,
      ...devNominalDiagnostics(result),
    })
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Error al registrar",
        storage,
        persisted: false,
        ...devNominalDiagnostics(result),
      },
      { status: 400 }
    )
  }

  return NextResponse.json({
    ok: true,
    storage,
    persisted,
    record: result.record,
    deduped: result.storage === "dedupe_skip",
    manual_edit_is_authority: true,
    ...(result.audit_backup ? { audit_backup: true } : {}),
    ...devNominalDiagnostics(result),
  })
}
