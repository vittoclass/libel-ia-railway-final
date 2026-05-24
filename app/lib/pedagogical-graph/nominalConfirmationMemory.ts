/**

 * Memoria observacional de confirmaciones nominales (no destructiva).

 * Persistencia principal: graph_nominal_confirmations.

 * evaluation_audit_logs: respaldo opcional append-only (best-effort).

 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeNominalName, nominalTokenBagKey } from "@/app/lib/pedagogical-graph/nominalIdentity"



/** Acción de auditoría para respaldo opcional de confirmaciones nominales. */

export const NOMINAL_CONFIRMATION_AUDIT_ACTION = "NOMINAL_TEACHER_CONFIRMATION"



export const NOMINAL_CONFIRMATION_TABLE = "graph_nominal_confirmations"



/** @deprecated Usar NOMINAL_CONFIRMATION_TABLE */

export const NOMINAL_CONFIRMATION_TABLE_PROBE = NOMINAL_CONFIRMATION_TABLE



export type NominalConfirmationType =

  | "exact_match"

  | "manual_override"

  | "suggested_match"

  | "ignored"



export type TeacherNominalConfirmationRecord = {

  observed_name_raw: string

  observed_name_normalized: string

  observed_token_bag_key: string

  confirmed_display_name: string | null

  confirmed_name_normalized?: string | null

  student_profile_id: string | null

  catalog_student_id: string | null

  confirmed_by_teacher: boolean

  confirmed_at: string

  manual_override: boolean

  exact_match: boolean

  ignored: boolean

  confirmation_type: NominalConfirmationType | null

  source: string | null

  historical_confirmation_count: number

  evaluation_id?: string | null

  match_score?: number | null

  course_label?: string | null

}



export type RecordNominalConfirmationInput = {

  teacherId: string

  userId: string

  organizationId: string | null

  evaluationId?: string | null

  observedNameRaw: string

  confirmedDisplayName?: string | null

  studentProfileId?: string | null

  catalogStudentId?: string | null

  manualOverride?: boolean

  exactMatch?: boolean

  confirmationType?: NominalConfirmationType | null

  source?: string | null

  ignored?: boolean

  matchScore?: number | null

  courseLabel?: string | null

}



type GraphNominalConfirmationRow = {

  id?: string

  teacher_id: string

  organization_id: string | null

  course_label: string | null

  evaluation_id: string | null

  observed_name_raw: string

  observed_name_normalized: string

  confirmed_name: string

  confirmed_name_normalized: string

  confirmation_type: NominalConfirmationType

  manual_override: boolean

  exact_match: boolean

  ignored: boolean

  source: string | null

  metadata: Record<string, unknown>

  created_at?: string

}



function resolveConfirmationType(

  observedNorm: string,

  confirmedNorm: string,

  input: Pick<

    RecordNominalConfirmationInput,

    "confirmationType" | "manualOverride" | "exactMatch" | "ignored"

  >

): NominalConfirmationType | null {

  if (input.ignored) return "ignored"

  if (input.confirmationType) return input.confirmationType

  if (input.manualOverride) return "manual_override"

  if (input.exactMatch) return "exact_match"

  if (confirmedNorm && observedNorm === confirmedNorm) return "exact_match"

  if (confirmedNorm) return "manual_override"

  return null

}



function nominalMemoryDedupeKey(

  evaluationId: string | null | undefined,

  observedNorm: string,

  confirmedNorm: string,

  confirmationType: NominalConfirmationType

): string {

  return `${evaluationId?.trim() || "_no_eval_"}|${observedNorm}|${confirmedNorm}|${confirmationType}`

}



function hasRecentDuplicate(

  index: NominalConfirmationIndex,

  key: string,

  evaluationId: string | null | undefined

): boolean {

  const evalScoped = evaluationId?.trim() || ""

  // Sin evaluation_id cada corrección debe persistir (regla 3× mismo curso → autofill).

  if (!evalScoped) return false

  for (const prev of index.all) {

    const prevConfirmed = prev.confirmed_display_name

      ? normalizeNominalName(prev.confirmed_display_name).normalized

      : ""

    const prevType =

      prev.confirmation_type ??

      (prev.ignored ? "ignored" : prev.manual_override ? "manual_override" : prev.exact_match ? "exact_match" : null)

    if (!prevType) continue

    const prevKey = nominalMemoryDedupeKey(

      prev.evaluation_id,

      prev.observed_name_normalized,

      prevConfirmed,

      prevType

    )

    if (prevKey !== key) continue

    if (prev.evaluation_id?.trim() !== evalScoped) continue

    return true

  }

  return false

}



export type NominalConfirmationIndex = {

  byObservedTokenBag: Map<string, number>

  byProfileId: Map<string, number>

  recent: TeacherNominalConfirmationRecord[]

  all: TeacherNominalConfirmationRecord[]

}



const MAX_CONFIRMATION_ROWS = 120

function isDevEnv(): boolean {
  return process.env.NODE_ENV === "development"
}



function isOptionalSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {

  if (!err) return false

  const code = String(err.code ?? "")

  const msg = String(err.message ?? "").toLowerCase()

  if (code === "42703" || code === "PGRST204" || code === "42P01") return true

  if (msg.includes("does not exist") && (msg.includes("column") || msg.includes("relation"))) return true

  return msg.includes("column") && (msg.includes("does not exist") || msg.includes("not found"))

}



function buildEvaluationAuditLogInsertPayload(params: {

  organizationId: string | null

  userId: string

  action: string

  targetId: string

  targetType?: string

  actorRole?: string | null

  metadata: Record<string, unknown> | null

}): Record<string, unknown> {

  return {

    organization_id: params.organizationId,

    actor_id: params.userId,

    action: params.action,

    target_type: params.targetType ?? "evaluation",

    target_id: params.targetId,

    metadata: params.metadata ?? null,

  }

}



function parseConfirmationMetadata(meta: unknown): Partial<TeacherNominalConfirmationRecord> | null {

  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null

  const o = meta as Record<string, unknown>

  const observed = String(o.observed_name_raw ?? "").trim()

  if (!observed) return null

  const norm = String(o.observed_name_normalized ?? normalizeNominalName(observed).normalized)

  return {

    observed_name_raw: observed,

    observed_name_normalized: norm,

    observed_token_bag_key: String(

      o.observed_token_bag_key ?? nominalTokenBagKey(normalizeNominalName(observed).importantTokens)

    ),

    confirmed_display_name:

      o.confirmed_display_name != null

        ? String(o.confirmed_display_name).trim() || null

        : o.confirmed_name != null

          ? String(o.confirmed_name).trim() || null

          : null,

    student_profile_id: o.student_profile_id != null ? String(o.student_profile_id) : null,

    catalog_student_id: o.catalog_student_id != null ? String(o.catalog_student_id) : null,

    confirmed_by_teacher: o.confirmed_by_teacher === true,

    confirmed_at: String(o.confirmed_at ?? new Date().toISOString()),

    manual_override: o.manual_override === true,

    exact_match: o.exact_match === true,

    ignored: o.ignored === true,

    confirmation_type:

      typeof o.confirmation_type === "string"

        ? (o.confirmation_type as NominalConfirmationType)

        : null,

    source: o.source != null ? String(o.source).trim() || null : null,

    historical_confirmation_count:

      typeof o.historical_confirmation_count === "number" ? o.historical_confirmation_count : 1,

    evaluation_id: o.evaluation_id != null ? String(o.evaluation_id) : null,

    match_score: typeof o.match_score === "number" ? o.match_score : null,

    course_label: o.course_label != null ? String(o.course_label).trim() || null : null,

  }

}



function mapGraphRowToRecord(row: GraphNominalConfirmationRow & { created_at?: string }): TeacherNominalConfirmationRecord | null {

  const observed = String(row.observed_name_raw ?? "").trim()

  if (!observed) return null

  const meta =

    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)

      ? (row.metadata as Record<string, unknown>)

      : {}

  const observedNorm = String(row.observed_name_normalized ?? normalizeNominalName(observed).normalized)

  const confirmedDisplay = String(row.confirmed_name ?? "").trim() || null

  const tokenBag =

    meta.observed_token_bag_key != null

      ? String(meta.observed_token_bag_key)

      : nominalTokenBagKey(normalizeNominalName(observed).importantTokens)



  return {

    observed_name_raw: observed,

    observed_name_normalized: observedNorm,

    observed_token_bag_key: tokenBag,

    confirmed_display_name: confirmedDisplay,

    confirmed_name_normalized:
      String(row.confirmed_name_normalized ?? "").trim() ||
      (confirmedDisplay ? normalizeNominalName(confirmedDisplay).normalized : null),

    student_profile_id: meta.student_profile_id != null ? String(meta.student_profile_id) : null,

    catalog_student_id: meta.catalog_student_id != null ? String(meta.catalog_student_id) : null,

    confirmed_by_teacher: row.ignored !== true && !!confirmedDisplay,

    confirmed_at: row.created_at ?? new Date().toISOString(),

    manual_override: row.manual_override === true,

    exact_match: row.exact_match === true,

    ignored: row.ignored === true,

    confirmation_type: row.confirmation_type ?? null,

    source: row.source ?? null,

    historical_confirmation_count:

      typeof meta.historical_confirmation_count === "number" ? meta.historical_confirmation_count : 1,

    evaluation_id: row.evaluation_id ?? null,

    match_score: typeof meta.match_score === "number" ? meta.match_score : null,

    course_label: row.course_label ?? null,

  }

}



function buildGraphNominalInsertRow(

  input: RecordNominalConfirmationInput,

  record: TeacherNominalConfirmationRecord,

  confirmationType: NominalConfirmationType,

  confirmedNorm: string

): GraphNominalConfirmationRow {

  const confirmedName =

    record.confirmed_display_name?.trim() ||

    (confirmationType === "ignored" ? record.observed_name_raw : "")

  const confirmedNameNorm =

    confirmedNorm ||

    (confirmationType === "ignored" ? record.observed_name_normalized : "")



  return {

    teacher_id: input.teacherId,

    organization_id: input.organizationId,

    course_label: record.course_label ?? null,

    evaluation_id: record.evaluation_id ?? null,

    observed_name_raw: record.observed_name_raw,

    observed_name_normalized: record.observed_name_normalized,

    confirmed_name: confirmedName,

    confirmed_name_normalized: confirmedNameNorm,

    confirmation_type: confirmationType,

    manual_override: record.manual_override,

    exact_match: record.exact_match,

    ignored: record.ignored,

    source: record.source,

    metadata: {

      observed_token_bag_key: record.observed_token_bag_key,

      student_profile_id: record.student_profile_id,

      catalog_student_id: record.catalog_student_id,

      match_score: record.match_score ?? null,

      confirmed_by_teacher: record.confirmed_by_teacher,

      historical_confirmation_count: record.historical_confirmation_count,

      user_id: input.userId,

      actor_role: "teacher",

    },

  }

}



async function appendOptionalAuditBackup(

  supabase: SupabaseClient,

  params: {

    organizationId: string | null

    userId: string

    targetId: string

    evaluationId: string | null

    metadata: Record<string, unknown>

  }

): Promise<void> {

  const auditInsertPayload = buildEvaluationAuditLogInsertPayload({

    organizationId: params.organizationId,

    userId: params.userId,

    action: NOMINAL_CONFIRMATION_AUDIT_ACTION,

    targetId: params.targetId,

    targetType: params.evaluationId ? "evaluation" : "teacher",

    actorRole: "teacher",

    metadata: params.metadata,

  })

  const { error } = await supabase.from("evaluation_audit_logs").insert(auditInsertPayload)

  if (error) {

    console.warn("[nominal memory audit backup failed]", {

      code: error.code,

      message: error.message,

    })

  }

}



function accumulateConfirmationIntoIndex(

  full: TeacherNominalConfirmationRecord,

  index: NominalConfirmationIndex

): void {

  if (!full.ignored) {

    index.byObservedTokenBag.set(

      full.observed_token_bag_key,

      (index.byObservedTokenBag.get(full.observed_token_bag_key) ?? 0) + 1

    )

    if (full.student_profile_id) {

      index.byProfileId.set(

        full.student_profile_id,

        (index.byProfileId.get(full.student_profile_id) ?? 0) + 1

      )

    }

  }

  index.all.push(full)

  if (index.recent.length < 24) index.recent.push(full)

}



export async function probeNominalConfirmationTable(

  supabase: SupabaseClient

): Promise<{ available: boolean; reason?: string }> {

  const { error } = await supabase.from(NOMINAL_CONFIRMATION_TABLE).select("id").limit(1)

  if (!error) return { available: true }

  if (isOptionalSchemaError(error)) return { available: false, reason: "table_not_deployed" }

  return { available: false, reason: error.message }

}



export type NominalConfirmationInsertErrorDetails = {

  details?: string | null

  hint?: string | null

}



/**

 * Registra confirmación docente (append-only). No modifica evaluation_students ni students.

 */

export async function recordTeacherNominalConfirmation(

  supabase: SupabaseClient,

  input: RecordNominalConfirmationInput

): Promise<{

  ok: boolean

  record?: TeacherNominalConfirmationRecord

  error?: string

  storage?: string

  persisted?: boolean

  audit_backup?: boolean

  error_code?: string

  error_message?: string

  insert_error_details?: NominalConfirmationInsertErrorDetails

}> {

  const observed = normalizeNominalName(input.observedNameRaw)

  if (!observed.normalized) {

    return { ok: false, error: "observed_name_required" }

  }



  const evaluationId =

    input.evaluationId != null ? String(input.evaluationId).trim() || null : null



  const index = await loadTeacherNominalConfirmationIndex(supabase, {

    teacherId: input.teacherId,

    organizationId: input.organizationId,

  })



  const confirmedTrim = input.confirmedDisplayName?.trim() || ""

  const confirmedNorm = confirmedTrim ? normalizeNominalName(confirmedTrim).normalized : ""

  const confirmationType = resolveConfirmationType(observed.normalized, confirmedNorm, input)



  if (!input.ignored && !confirmedTrim) {

    return { ok: false, error: "confirmed_name_required" }

  }

  if (!confirmationType) {

    return { ok: false, error: "confirmation_type_required" }

  }



  const dedupeKey = nominalMemoryDedupeKey(

    evaluationId,

    observed.normalized,

    confirmedNorm || (confirmationType === "ignored" ? observed.normalized : ""),

    confirmationType

  )



  if (hasRecentDuplicate(index, dedupeKey, evaluationId)) {

    return { ok: true, storage: "dedupe_skip", persisted: false, record: undefined }

  }



  const priorBagCount = index.byObservedTokenBag.get(observed.tokenBagKey) ?? 0

  const priorProfileCount = input.studentProfileId

    ? (index.byProfileId.get(input.studentProfileId) ?? 0)

    : 0

  const historicalCount =

    Math.max(priorBagCount, priorProfileCount) + (confirmationType === "ignored" ? 0 : 1)



  const isExact = confirmationType === "exact_match"

  const isManualOverride = confirmationType === "manual_override"

  const isIgnored = confirmationType === "ignored"



  const record: TeacherNominalConfirmationRecord = {

    observed_name_raw: observed.raw,

    observed_name_normalized: observed.normalized,

    observed_token_bag_key: observed.tokenBagKey,

    confirmed_display_name: confirmedTrim || null,

    student_profile_id: input.studentProfileId ?? null,

    catalog_student_id: input.catalogStudentId ?? null,

    confirmed_by_teacher: !isIgnored && !!confirmedTrim,

    confirmed_at: new Date().toISOString(),

    manual_override: isManualOverride,

    exact_match: isExact,

    ignored: isIgnored,

    confirmation_type: confirmationType,

    source: input.source?.trim() || "manual_name_field_or_evaluation_flow",

    historical_confirmation_count: isIgnored ? priorBagCount : historicalCount,

    evaluation_id: evaluationId,

    match_score: input.matchScore ?? null,

    course_label: input.courseLabel?.trim() || null,

  }



  const targetId = (evaluationId ?? input.teacherId).trim()

  if (!targetId) return { ok: false, error: "target_id_required" }



  const graphRow = buildGraphNominalInsertRow(input, record, confirmationType, confirmedNorm)

  console.log("[nominal insert attempt]", {
    table: NOMINAL_CONFIRMATION_TABLE,
    teacherId: input.teacherId,
    evaluationId: evaluationId ?? null,
    confirmationType,
    graphRow,
  })

  const { error: graphError } = await supabase.from(NOMINAL_CONFIRMATION_TABLE).insert(graphRow)

  if (graphError) {
    console.error("[nominal insert error completo]", graphError)
    console.error("[nominal memory graph insert failed]", {

      code: graphError.code,

      message: graphError.message,

      details: graphError.details,

      hint: graphError.hint,

      teacherId: input.teacherId,

      evaluationId: evaluationId ?? null,

      confirmationType,

    })

    return {

      ok: false,

      error: graphError.message,

      storage: isOptionalSchemaError(graphError) ? "table_not_deployed" : "insert_failed",

      persisted: false,

      error_code: graphError.code != null ? String(graphError.code) : undefined,

      error_message: graphError.message,

      insert_error_details: {

        details: graphError.details != null ? String(graphError.details) : null,

        hint: graphError.hint != null ? String(graphError.hint) : null,

      },

    }

  }



  const metadata: Record<string, unknown> = {

    teacher_id: input.teacherId,

    organization_id: input.organizationId,

    actor_role: "teacher",

    target_type: evaluationId ? "evaluation" : "teacher",

    target_id: targetId,

    observed_name: record.observed_name_raw,

    confirmed_name: record.confirmed_display_name,

    created_at: record.confirmed_at,

    storage_primary: NOMINAL_CONFIRMATION_TABLE,

    ...record,

  }



  void appendOptionalAuditBackup(supabase, {

    organizationId: input.organizationId,

    userId: input.userId,

    targetId,

    evaluationId,

    metadata,

  })



  return {

    ok: true,

    record,

    storage: NOMINAL_CONFIRMATION_TABLE,

    persisted: true,

    audit_backup: true,

  }

}



async function loadFromGraphNominalConfirmations(

  supabase: SupabaseClient,

  teacherId: string

): Promise<{ rows: TeacherNominalConfirmationRecord[]; error?: boolean }> {

  const { data, error } = await supabase

    .from(NOMINAL_CONFIRMATION_TABLE)

    .select(

      "teacher_id, organization_id, course_label, evaluation_id, observed_name_raw, observed_name_normalized, confirmed_name, confirmed_name_normalized, confirmation_type, manual_override, exact_match, ignored, source, metadata, created_at"

    )

    .eq("teacher_id", teacherId)

    .order("created_at", { ascending: false })

    .limit(MAX_CONFIRMATION_ROWS)



  if (error) {

    if (isOptionalSchemaError(error)) return { rows: [], error: false }

    console.warn("[nominal memory graph load failed]", error.message)

    return { rows: [], error: true }

  }



  const rows: TeacherNominalConfirmationRecord[] = []

  for (const raw of data ?? []) {

    const mapped = mapGraphRowToRecord(raw as GraphNominalConfirmationRow)

    if (mapped) rows.push(mapped)

  }

  return { rows }

}



async function loadFromAuditLogsFallback(

  supabase: SupabaseClient,

  teacherId: string

): Promise<TeacherNominalConfirmationRecord[]> {

  const baseQuery = () =>

    supabase

      .from("evaluation_audit_logs")

      .select("metadata, created_at")

      .eq("action", NOMINAL_CONFIRMATION_AUDIT_ACTION)

      .filter("metadata->>teacher_id", "eq", teacherId)

      .order("created_at", { ascending: false })

      .limit(MAX_CONFIRMATION_ROWS)



  let { data, error } = await baseQuery()

  if (error && isOptionalSchemaError(error)) {

    ;({ data, error } = await supabase

      .from("evaluation_audit_logs")

      .select("metadata, created_at")

      .eq("action", NOMINAL_CONFIRMATION_AUDIT_ACTION)

      .order("created_at", { ascending: false })

      .limit(MAX_CONFIRMATION_ROWS))

  }

  if (error && !isOptionalSchemaError(error)) return []



  const rows: TeacherNominalConfirmationRecord[] = []

  for (const row of data ?? []) {

    const parsed = parseConfirmationMetadata((row as { metadata?: unknown }).metadata)

    if (!parsed) continue

    const meta = (row as { metadata?: Record<string, unknown> }).metadata

    const rowTeacherId = meta?.teacher_id != null ? String(meta.teacher_id) : ""

    if (rowTeacherId && rowTeacherId !== teacherId) continue



    rows.push({

      observed_name_raw: parsed.observed_name_raw!,

      observed_name_normalized: parsed.observed_name_normalized!,

      observed_token_bag_key: parsed.observed_token_bag_key!,

      confirmed_display_name: parsed.confirmed_display_name ?? null,

      student_profile_id: parsed.student_profile_id ?? null,

      catalog_student_id: parsed.catalog_student_id ?? null,

      confirmed_by_teacher: parsed.confirmed_by_teacher === true,

      confirmed_at: parsed.confirmed_at ?? new Date().toISOString(),

      manual_override: parsed.manual_override === true,

      exact_match: parsed.exact_match === true,

      ignored: parsed.ignored === true,

      confirmation_type: parsed.confirmation_type ?? null,

      source: parsed.source ?? null,

      historical_confirmation_count: parsed.historical_confirmation_count ?? 1,

      evaluation_id: parsed.evaluation_id ?? null,

      match_score: parsed.match_score ?? null,

      course_label: parsed.course_label ?? null,

    })

  }

  return rows

}



/** Índice de confirmaciones previas del docente (lectura desde graph_nominal_confirmations). */

export async function loadTeacherNominalConfirmationIndex(

  supabase: SupabaseClient,

  opts: { teacherId: string; organizationId: string | null }

): Promise<NominalConfirmationIndex> {

  const byObservedTokenBag = new Map<string, number>()

  const byProfileId = new Map<string, number>()

  const recent: TeacherNominalConfirmationRecord[] = []

  const all: TeacherNominalConfirmationRecord[] = []



  const probe = await probeNominalConfirmationTable(supabase)

  let confirmations: TeacherNominalConfirmationRecord[] = []



  if (probe.available) {
    const graphLoad = await loadFromGraphNominalConfirmations(supabase, opts.teacherId)
    confirmations = graphLoad.rows
    if (graphLoad.error && isDevEnv()) {
      console.warn("[nominal memory] graph table available but load failed; not using audit fallback", {
        teacherId: opts.teacherId,
      })
    }
  } else {
    confirmations = await loadFromAuditLogsFallback(supabase, opts.teacherId)
  }



  for (const full of confirmations) {

    accumulateConfirmationIntoIndex(full, {

      byObservedTokenBag,

      byProfileId,

      recent,

      all,

    })

  }



  return { byObservedTokenBag, byProfileId, recent, all }

}


