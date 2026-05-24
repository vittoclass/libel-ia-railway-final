/**
 * FASE 3D.1 — Cliente de memoria nominal docente (observacional, best-effort).
 * La edición manual del profesor es autoridad máxima; sin tocar OCR ni evaluate.
 */
import { normalizeNominalName } from "@/app/lib/pedagogical-graph/nominalIdentity"

export type NominalConfirmationType =
  | "exact_match"
  | "manual_override"
  | "suggested_match"
  | "ignored"

export type PersistNominalMemoryInput = {
  observedNameRaw: string
  confirmedDisplayName: string
  evaluationId?: string | null
  courseLabel?: string | null
  confirmationType?: NominalConfirmationType
  source?: string
  studentProfileId?: string | null
  catalogStudentId?: string | null
  matchScore?: number | null
  ignored?: boolean
  /** Omite deduplicación de sesión (p. ej. reintento explícito). */
  force?: boolean
}

export type PersistNominalMemoryResult = {
  /** true si el backend aceptó la memoria (insert o dedupe_skip) */
  sent: boolean
  /** true si hubo insert nuevo; también true en dedupe_skip para UX */
  persisted: boolean
  storage?: string
  skipped?: string
  deduped?: boolean
  message?: string
  error_code?: string
  error_message?: string
  fallback_attempted?: boolean
  fallback_error_code?: string
  fallback_payload_keys?: string[]
}

/** Misma heurística que slots genéricos en EvaluatorClient (sin importar el componente). */
export function isGenericNominalManualName(name: string | undefined | null): boolean {
  if (!name || typeof name !== "string") return true
  const t = name.trim()
  if (t === "" || /^Alumno\s+\d+$/i.test(t)) return true
  if (/^Alumno\s+lote/i.test(t)) return true
  if (/lote/i.test(t) && /índice/i.test(t)) return true
  if (/^(alumno|estudiante)\s*\d*$/i.test(t)) return true
  return false
}

export function deriveNominalConfirmationType(
  observedRaw: string,
  manualRaw: string,
  opts?: { suggested?: boolean; ignored?: boolean }
): NominalConfirmationType | null {
  if (opts?.ignored) return "ignored"
  if (opts?.suggested) return "suggested_match"
  const observed = observedRaw.trim()
  const manual = manualRaw.trim()
  if (!observed || !manual || isGenericNominalManualName(manual)) return null
  const observedNorm = normalizeNominalName(observed).normalized
  const manualNorm = normalizeNominalName(manual).normalized
  if (!observedNorm || !manualNorm) return null
  if (observedNorm === manualNorm) return "exact_match"
  return "manual_override"
}

export function buildNominalMemoryDedupeKey(params: {
  evaluationId: string | null | undefined
  observedNormalized: string
  confirmedNormalized: string
  confirmationType: NominalConfirmationType
}): string {
  return [
    params.evaluationId?.trim() || "_no_eval_",
    params.observedNormalized,
    params.confirmedNormalized,
    params.confirmationType,
  ].join("|")
}

const sessionDedupeKeys = new Set<string>()

/** Reinicia deduplicación de sesión (p. ej. al cambiar OCR observado en el mismo slot). */
export function resetNominalMemorySessionDedupeForObserved(observedRaw: string): void {
  const norm = normalizeNominalName(observedRaw.trim()).normalized
  if (!norm) return
  for (const key of [...sessionDedupeKeys]) {
    if (key.includes(`|${norm}|`)) sessionDedupeKeys.delete(key)
  }
}

/**
 * Al cambiar el nombre manual para el mismo OCR, permite re-persistir la nueva corrección
 * e invalida dedupe de confirmaciones anteriores en sesión.
 */
export function resetNominalMemorySessionDedupeForManualCorrection(
  observedRaw: string,
  _previousManualRaw?: string
): void {
  resetNominalMemorySessionDedupeForObserved(observedRaw)
}

/**
 * Persiste memoria nominal vía POST /api/docente/nominal-confirmation.
 * No guarda si falta OCR, manual genérico, o tipo ignorado sin intención explícita.
 */
export async function persistTeacherNominalMemory(
  input: PersistNominalMemoryInput
): Promise<PersistNominalMemoryResult> {
  const observed = String(input.observedNameRaw ?? "").trim()
  const manual = String(input.confirmedDisplayName ?? "").trim()
  if (!observed) {
    console.warn("falta observedNameRaw")
    return { sent: false, persisted: false, skipped: "no_observed" }
  }
  if (!manual) {
    console.warn("falta confirmedDisplayName")
    return { sent: false, persisted: false, skipped: "no_confirmed" }
  }
  if (isGenericNominalManualName(manual)) {
    return { sent: false, persisted: false, skipped: "generic_manual" }
  }

  const confirmationType =
    input.confirmationType ??
    deriveNominalConfirmationType(observed, manual, { ignored: input.ignored === true })

  if (!confirmationType) return { sent: false, persisted: false, skipped: "no_confirmation_type" }
  if (confirmationType === "ignored" && input.ignored !== true) {
    return { sent: false, persisted: false, skipped: "ignored_not_requested" }
  }

  const observedNorm = normalizeNominalName(observed).normalized
  const confirmedNorm = normalizeNominalName(manual).normalized
  if (!observedNorm || !confirmedNorm) {
    return { sent: false, persisted: false, skipped: "normalize_failed" }
  }

  const evaluationId =
    input.evaluationId != null ? String(input.evaluationId).trim() || null : null

  const dedupeKey = buildNominalMemoryDedupeKey({
    evaluationId,
    observedNormalized: observedNorm,
    confirmedNormalized: confirmedNorm,
    confirmationType,
  })

  // Solo deduplicar en sesión cuando hay evaluation_id (evitar bloquear 3× sin eval).
  if (!input.force && evaluationId && sessionDedupeKeys.has(dedupeKey)) {
    return { sent: false, persisted: false, skipped: "session_dedupe" }
  }

  const exactMatch = confirmationType === "exact_match"
  const manualOverride = confirmationType === "manual_override"

  const payload = {
    observed_name_raw: observed,
    confirmed_display_name: manual,
    evaluation_id: evaluationId,
    course_label: input.courseLabel ?? null,
    confirmation_type: confirmationType,
    source: input.source ?? "manual_name_field_or_evaluation_flow",
    manual_override: manualOverride,
    exact_match: exactMatch,
    ignored: confirmationType === "ignored",
    student_profile_id: input.studentProfileId ?? null,
    catalog_student_id: input.catalogStudentId ?? null,
    match_score: input.matchScore ?? null,
  }

  console.log("[persistTeacherNominalMemory] payload exacto", payload)

  try {
    const res = await fetch("/api/docente/nominal-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    let body: {
      ok?: boolean
      storage?: string
      persisted?: boolean
      deduped?: boolean
      error_code?: string
      error_message?: string
      fallback_attempted?: boolean
      fallback_error_code?: string
      fallback_payload_keys?: string[]
      available_columns_unknown?: boolean
    } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      console.log("[persistTeacherNominalMemory] POST respuesta", { status: res.status, body: null })
      return { sent: false, persisted: false, skipped: "invalid_response", storage: undefined }
    }
    console.log("[persistTeacherNominalMemory] POST respuesta", { status: res.status, body })

    const devError = {
      error_code: typeof body.error_code === "string" ? body.error_code : undefined,
      error_message: typeof body.error_message === "string" ? body.error_message : undefined,
      fallback_attempted: body.fallback_attempted === true,
      fallback_error_code:
        typeof body.fallback_error_code === "string" ? body.fallback_error_code : undefined,
      fallback_payload_keys: Array.isArray(body.fallback_payload_keys)
        ? body.fallback_payload_keys
        : undefined,
    }

    if (body.available_columns_unknown === true) {
      return {
        sent: false,
        persisted: false,
        skipped: "available_columns_unknown",
        storage: body.storage,
        ...devError,
      }
    }

    if (!res.ok || body.ok !== true) {
      return {
        sent: false,
        persisted: false,
        skipped: "http_error",
        storage: body.storage,
        ...devError,
      }
    }

    const deduped = body.deduped === true || body.storage === "dedupe_skip"
    if (deduped) {
      sessionDedupeKeys.add(dedupeKey)
      return {
        sent: true,
        persisted: true,
        storage: "dedupe_skip",
        deduped: true,
        message: "Memoria ya registrada",
      }
    }

    const persisted = body.persisted === true
    if (persisted) {
      sessionDedupeKeys.add(dedupeKey)
    }

    return {
      sent: persisted,
      persisted,
      storage: body.storage,
      skipped: persisted ? undefined : body.storage ?? "not_persisted",
      ...devError,
    }
  } catch (err) {
    console.log("[persistTeacherNominalMemory] POST error de red", err)
    return { sent: false, persisted: false, skipped: "network" }
  }
}

/** Prueba manual (solo dev): POST fijo que debe insertar en graph_nominal_confirmations. */
export async function testTeacherNominalConfirmationDirectPost(): Promise<{
  status: number
  body: unknown
}> {
  const payload = {
    observed_name_raw: "TEST_OCR",
    confirmed_display_name: "TEST_MANUAL",
    confirmation_type: "manual_override" as const,
  }
  console.log("[testTeacherNominalConfirmationDirectPost] enviando", payload)
  const res = await fetch("/api/docente/nominal-confirmation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  console.log("[testTeacherNominalConfirmationDirectPost] respuesta", { status: res.status, body })
  return { status: res.status, body }
}

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  ;(window as Window & { __testNominalPost?: typeof testTeacherNominalConfirmationDirectPost }).__testNominalPost =
    testTeacherNominalConfirmationDirectPost
}
