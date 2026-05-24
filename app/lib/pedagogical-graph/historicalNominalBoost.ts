/**
 * FASE 3D — Boost longitudinal nominal (solo ranking/UX; no OCR ni persistencia de identidad).
 * Agrupa confirmaciones docente: OCR observado → nombre confirmado.
 * Última corrección manual_override manda; conteo usa log1p; recencia pesa fuerte.
 */
import {
  courseConfidenceMatch,
  isCurrentCourseContextKnown,
  type CourseMatchInput,
} from "@/app/lib/pedagogical-graph/courseConfidenceMatch"
import type { TeacherNominalConfirmationRecord } from "@/app/lib/pedagogical-graph/nominalConfirmationMemory"
import {
  completenessRankBonus,
  isClearlyIncompleteVs,
  isNominalExpansionOf,
  scoreNominalCompleteness,
} from "@/app/lib/pedagogical-graph/nominalCompleteness"
import {
  isGenericNominalName,
  normalizeNominalName,
  type NormalizedNominalName,
  type NominalRosterEntry,
} from "@/app/lib/pedagogical-graph/nominalIdentity"

export type HistoricalNominalBoostContext = {
  teacherId: string
  courseLabel: string | null
  /** Siempre true cuando el índice se cargó en scope del docente actual. */
  sameTeacherScope: boolean
  confirmations: TeacherNominalConfirmationRecord[]
  /** Nombre manual actual del profesor (evita sugerir contra lo recién escrito). */
  resolvedNormalized?: string
}

export type ObservedToConfirmedEntry = {
  confirmedDisplayName: string
  confirmedNormalized: string
  studentProfileId: string | null
  catalogStudentId: string | null
  historical_confirmation_count: number
  exact_match_count: number
  manual_override_count: number
  ignored_count: number
  /** @deprecated Usar countCourseScopedConfirmations en runtime con curso actual. */
  same_course_confirmation_count: number
  other_course_confirmation_count: number
  last_confirmed_at: string | null
  last_manual_override_at: string | null
}

export type TeacherCorrectionRef = {
  display_name: string
  normalized: string
  confirmation_count: number
  last_at: string | null
}

export type ObservedNominalMemoryResolution = {
  last_teacher_correction: TeacherCorrectionRef | null
  previous_used_name: TeacherCorrectionRef | null
  /** Nombre completo preferido cuando la última corrección es abreviada (ej. Colomba F → Franchesca). */
  preferred_complete_name: TeacherCorrectionRef | null
  /** Última corrección es abreviatura/incompleta frente a un nombre más completo en historial. */
  last_correction_is_abbreviated: boolean
  has_historical_conflict: boolean
  autofill_eligible: boolean
  /** 3+ confirmaciones en otro curso (sin autofill automático). */
  other_course_suggestion_eligible: boolean
  other_course_suggested_name: string | null
  same_course_confirmation_count: number
  other_course_confirmation_count: number
  consistency_score: number
  /** Entrada ganadora según ranking memoria (completitud + recencia; no aplasta abreviaturas). */
  dominant_entry: ObservedToConfirmedEntry | null
}

export type HistoricalNominalBoostResult = {
  historical_nominal_boost_applied: boolean
  historical_nominal_boost_value: number
  historical_confirmation_count: number
  consistency_score: number
  same_course_weight: number
  same_teacher_weight: number
  recency_weight: number
  same_course_bonus: number
  teacher_history_bonus: number
  contradictory_override_count: number
  is_last_teacher_correction: boolean
  /** Metadatos para Graph Layer / observability. */
  historical_boost: {
    applied: boolean
    value: number
    historical_confirmation_count: number
    consistency_score: number
    same_course_weight: number
    same_teacher_weight: number
    recency_weight: number
    dominant_confirmed_name: string | null
  }
}

const MS_PER_DAY = 86_400_000
const MAX_BOOST = 0.48
const LOG_COUNT_SCALE = 0.14
const EXACT_MATCH_BONUS = 0.04
const MANUAL_OVERRIDE_CORRECTIVE_BONUS = 0.1
const LAST_CORRECTION_BOOST = 0.22
const LAST_CORRECTION_BOOST_WHEN_SUPERSEDED_BY_FULLER = 0.05
const EXPANSION_OVER_ABBREVIATED_LAST_BOOST = 0.2
const SAME_COURSE_BONUS_CAP = 0.08
const TEACHER_HISTORY_BONUS_CAP = 0.1
const RECENCY_BONUS_CAP = 0.14
const MANUAL_RECENCY_BONUS_CAP = 0.2
const MIN_CONSISTENCY_FOR_BOOST = 0.45
const MIN_CONSISTENCY_FOR_AUTOFILL = 0.62
const CONTRADICTORY_SUPPRESS_RATIO = 0.55
const MIN_AUTOFILL_CONFIRMATIONS = 3

function confirmationCourseContext(rec: TeacherNominalConfirmationRecord): CourseMatchInput {
  return {
    courseId: null,
    courseLabel: confirmationCourseLabel(rec),
  }
}

export type CourseScopedConfirmationCounts = {
  same_course_confirmation_count: number
  other_course_confirmation_count: number
  unknown_course_confirmation_count: number
}

/**
 * Cuenta confirmaciones globales (teacher + observed + confirmed) con confianza por curso.
 */
export function countCourseScopedConfirmations(
  confirmations: TeacherNominalConfirmationRecord[],
  observed: NormalizedNominalName,
  confirmedNorm: string,
  currentCourse: CourseMatchInput
): CourseScopedConfirmationCounts {
  let same_course_confirmation_count = 0
  let other_course_confirmation_count = 0
  let unknown_course_confirmation_count = 0

  if (!confirmedNorm) {
    return {
      same_course_confirmation_count,
      other_course_confirmation_count,
      unknown_course_confirmation_count,
    }
  }

  for (const rec of confirmations) {
    if (!recordMatchesObserved(rec, observed)) continue
    if (rec.ignored || rec.confirmation_type === "ignored") continue
    const recConfirmedNorm = recordConfirmedNormalized(rec)
    if (!recConfirmedNorm || recConfirmedNorm !== confirmedNorm) continue

    const match = courseConfidenceMatch(currentCourse, confirmationCourseContext(rec))
    if (match === "same") same_course_confirmation_count += 1
    else if (match === "other") other_course_confirmation_count += 1
    else unknown_course_confirmation_count += 1
  }

  return {
    same_course_confirmation_count,
    other_course_confirmation_count,
    unknown_course_confirmation_count,
  }
}

function observedKeys(observed: NormalizedNominalName): string[] {
  const keys = new Set<string>()
  if (observed.normalized) keys.add(observed.normalized)
  if (observed.tokenBagKey) keys.add(`bag:${observed.tokenBagKey}`)
  return [...keys]
}

function confirmationCourseLabel(rec: TeacherNominalConfirmationRecord): string | null {
  return rec.course_label != null ? String(rec.course_label).trim() || null : null
}

function recordConfirmedNormalized(rec: TeacherNominalConfirmationRecord): string {
  const stored = rec.confirmed_name_normalized?.trim()
  if (stored) return stored
  const confirmed = rec.confirmed_display_name?.trim()
  return confirmed ? normalizeNominalName(confirmed).normalized : ""
}

function recordMatchesObserved(
  rec: TeacherNominalConfirmationRecord,
  observed: NormalizedNominalName
): boolean {
  const observedNorm =
    rec.observed_name_normalized || normalizeNominalName(rec.observed_name_raw).normalized
  if (observedNorm && observedNorm === observed.normalized) return true
  const bag = rec.observed_token_bag_key
  if (bag && observed.tokenBagKey && bag === observed.tokenBagKey) return true
  if (bag && observed.tokenBagKey && bag === `bag:${observed.tokenBagKey}`) return true
  return false
}

function isManualOverrideRecord(rec: TeacherNominalConfirmationRecord): boolean {
  return rec.manual_override === true || rec.confirmation_type === "manual_override"
}

function recencyWeight(lastAt: string | null, opts?: { manualOverride?: boolean }): number {
  if (!lastAt) return 0
  const ageMs = Date.now() - new Date(lastAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return opts?.manualOverride ? MANUAL_RECENCY_BONUS_CAP : RECENCY_BONUS_CAP
  }
  const days = ageMs / MS_PER_DAY
  const cap = opts?.manualOverride ? MANUAL_RECENCY_BONUS_CAP : RECENCY_BONUS_CAP
  if (days <= 3) return cap
  if (days <= 7) return cap * 0.92
  if (days <= 30) return cap * 0.55
  if (days <= 90) return cap * 0.32
  return cap * 0.12
}

function logCountBoost(count: number): number {
  if (count < 1) return 0
  return LOG_COUNT_SCALE * Math.log1p(count)
}

/**
 * Índice OCR observado → candidatos confirmados (conteos y overrides contradictorios).
 */
export function buildObservedToConfirmedIndex(
  confirmations: TeacherNominalConfirmationRecord[]
): Map<string, ObservedToConfirmedEntry[]> {
  const byObserved = new Map<string, Map<string, ObservedToConfirmedEntry>>()

  for (const rec of confirmations) {
    const observedNorm = rec.observed_name_normalized || normalizeNominalName(rec.observed_name_raw).normalized
    if (!observedNorm) continue

    const keys = [observedNorm, `bag:${rec.observed_token_bag_key}`]
    for (const key of keys) {
      let inner = byObserved.get(key)
      if (!inner) {
        inner = new Map()
        byObserved.set(key, inner)
      }

      const confirmedName = rec.confirmed_display_name?.trim() || ""
      const confirmedNorm = confirmedName ? normalizeNominalName(confirmedName).normalized : ""
      const innerKey =
        confirmedNorm || (rec.student_profile_id ? `profile:${rec.student_profile_id}` : `ignored:${rec.confirmed_at}`)

      let entry = inner.get(innerKey)
      if (!entry) {
        entry = {
          confirmedDisplayName: confirmedName,
          confirmedNormalized: confirmedNorm,
          studentProfileId: rec.student_profile_id,
          catalogStudentId: rec.catalog_student_id,
          historical_confirmation_count: 0,
          exact_match_count: 0,
          manual_override_count: 0,
          ignored_count: 0,
          same_course_confirmation_count: 0,
          other_course_confirmation_count: 0,
          last_confirmed_at: null,
          last_manual_override_at: null,
        }
        inner.set(innerKey, entry)
      }

      if (rec.ignored || rec.confirmation_type === "ignored") {
        entry.ignored_count += 1
        continue
      }

      const type = rec.confirmation_type
      const isExact =
        type === "exact_match" ||
        rec.exact_match ||
        (!rec.manual_override && confirmedNorm && confirmedNorm === observedNorm)
      const isOverride = isManualOverrideRecord(rec)

      if (!confirmedNorm && !rec.student_profile_id) continue

      entry.historical_confirmation_count += 1
      if (isExact) entry.exact_match_count += 1
      if (isOverride) entry.manual_override_count += 1
      const at = rec.confirmed_at
      if (at && (!entry.last_confirmed_at || at > entry.last_confirmed_at)) {
        entry.last_confirmed_at = at
      }
      if (isOverride && at && (!entry.last_manual_override_at || at > entry.last_manual_override_at)) {
        entry.last_manual_override_at = at
      }
      if (!entry.confirmedDisplayName && confirmedName) {
        entry.confirmedDisplayName = confirmedName
        entry.confirmedNormalized = confirmedNorm
      }
      entry.studentProfileId = entry.studentProfileId ?? rec.student_profile_id
      entry.catalogStudentId = entry.catalogStudentId ?? rec.catalog_student_id
    }
  }

  const out = new Map<string, ObservedToConfirmedEntry[]>()
  for (const [k, inner] of byObserved) {
    out.set(k, [...inner.values()])
  }
  return out
}

export function collectEntriesForObserved(
  observed: NormalizedNominalName,
  index: Map<string, ObservedToConfirmedEntry[]>
): ObservedToConfirmedEntry[] {
  const seen = new Map<string, ObservedToConfirmedEntry>()
  for (const key of observedKeys(observed)) {
    const list = index.get(key)
    if (!list?.length) continue
    for (const e of list) {
      if (e.historical_confirmation_count < 1) continue
      const dedupeKey = e.confirmedNormalized || e.confirmedDisplayName
      if (!dedupeKey) continue
      const prev = seen.get(dedupeKey)
      if (!prev) {
        seen.set(dedupeKey, { ...e })
        continue
      }
      prev.historical_confirmation_count += e.historical_confirmation_count
      prev.exact_match_count += e.exact_match_count
      prev.manual_override_count += e.manual_override_count
      prev.ignored_count += e.ignored_count
      prev.same_course_confirmation_count += e.same_course_confirmation_count
      prev.other_course_confirmation_count += e.other_course_confirmation_count
      if (e.last_confirmed_at && (!prev.last_confirmed_at || e.last_confirmed_at > prev.last_confirmed_at)) {
        prev.last_confirmed_at = e.last_confirmed_at
      }
      if (
        e.last_manual_override_at &&
        (!prev.last_manual_override_at || e.last_manual_override_at > prev.last_manual_override_at)
      ) {
        prev.last_manual_override_at = e.last_manual_override_at
      }
      if (!prev.confirmedDisplayName && e.confirmedDisplayName) {
        prev.confirmedDisplayName = e.confirmedDisplayName
      }
    }
  }
  return [...seen.values()]
}

function findLastManualOverrideRecord(
  observed: NormalizedNominalName,
  confirmations: TeacherNominalConfirmationRecord[]
): TeacherNominalConfirmationRecord | null {
  let best: TeacherNominalConfirmationRecord | null = null
  for (const rec of confirmations) {
    if (!recordMatchesObserved(rec, observed)) continue
    if (rec.ignored || rec.confirmation_type === "ignored") continue
    if (!isManualOverrideRecord(rec)) continue
    const confirmed = rec.confirmed_display_name?.trim()
    if (!confirmed) continue
    if (!best || rec.confirmed_at > best.confirmed_at) best = rec
  }
  return best
}

/**
 * Última corrección manual del docente para el OCR normalizado exacto (teacher scope).
 * Equivalente a:
 * WHERE teacher_id = docente AND observed_name_normalized = :observedNorm
 *   AND confirmation_type = 'manual_override' AND ignored = false
 * ORDER BY created_at DESC LIMIT 1
 */
export function findLastTeacherManualOverrideForExactObserved(
  observedNormalized: string,
  confirmations: TeacherNominalConfirmationRecord[]
): TeacherNominalConfirmationRecord | null {
  const observedNorm = observedNormalized.trim()
  if (!observedNorm) return null

  let best: TeacherNominalConfirmationRecord | null = null
  for (const rec of confirmations) {
    if (rec.ignored || rec.confirmation_type === "ignored") continue
    if (rec.confirmation_type !== "manual_override" && !rec.manual_override) continue
    const recObservedNorm =
      rec.observed_name_normalized || normalizeNominalName(rec.observed_name_raw).normalized
    if (recObservedNorm !== observedNorm) continue
    const confirmed = rec.confirmed_display_name?.trim()
    if (!confirmed || isGenericNominalName(confirmed)) continue
    if (!best || rec.confirmed_at > best.confirmed_at) best = rec
  }
  return best
}

function entryToCorrectionRef(entry: ObservedToConfirmedEntry): TeacherCorrectionRef {
  return {
    display_name: entry.confirmedDisplayName,
    normalized: entry.confirmedNormalized,
    confirmation_count: entry.historical_confirmation_count,
    last_at: entry.last_manual_override_at ?? entry.last_confirmed_at,
  }
}

function computeConsistencyForEntry(
  entry: ObservedToConfirmedEntry,
  allForObserved: ObservedToConfirmedEntry[]
): { consistency_score: number; contradictory_override_count: number } {
  const totalPositive = allForObserved.reduce((s, e) => s + e.historical_confirmation_count, 0)
  const contradictory = allForObserved
    .filter((e) => e.confirmedNormalized !== entry.confirmedNormalized && e.historical_confirmation_count > 0)
    .reduce((s, e) => s + e.historical_confirmation_count + e.manual_override_count * 0.5, 0)

  const dominant = entry.historical_confirmation_count
  const consistency_score =
    totalPositive > 0 ? dominant / (dominant + contradictory + entry.ignored_count * 0.25) : 0

  const contradictory_override_count = allForObserved
    .filter((e) => e.confirmedNormalized !== entry.confirmedNormalized)
    .reduce((s, e) => s + e.manual_override_count, 0)

  return { consistency_score: Math.min(1, consistency_score), contradictory_override_count }
}

function findFullerAlternativeForNorm(
  norm: string,
  allForObserved: ObservedToConfirmedEntry[]
): ObservedToConfirmedEntry | null {
  let best: ObservedToConfirmedEntry | null = null
  let bestScore = -1
  for (const e of allForObserved) {
    if (!e.confirmedNormalized || e.confirmedNormalized === norm) continue
    if (!isNominalExpansionOf(norm, e.confirmedNormalized)) continue
    if (!isClearlyIncompleteVs(norm, e.confirmedNormalized)) continue
    const cs = scoreNominalCompleteness(e.confirmedNormalized).completeness_score
    if (cs > bestScore) {
      bestScore = cs
      best = e
    }
  }
  return best
}

/** Score de ranking memoria: recencia + completitud; última corrección breve no aplasta nombre completo. */
export function rankObservedMemoryEntry(
  entry: ObservedToConfirmedEntry,
  opts: {
    lastCorrectionNorm: string | null
    allForObserved: ObservedToConfirmedEntry[]
    resolvedNormalized?: string
  }
): number {
  const { consistency_score } = computeConsistencyForEntry(entry, opts.allForObserved)
  const recencyAt = entry.last_manual_override_at ?? entry.last_confirmed_at
  const recency = recencyWeight(recencyAt, { manualOverride: Boolean(entry.last_manual_override_at) })
  const countPart = logCountBoost(entry.historical_confirmation_count) * (0.55 + consistency_score * 0.45)
  const completenessPart = completenessRankBonus(entry.confirmedNormalized || entry.confirmedDisplayName)

  let lastCorrectionBonus = 0
  if (opts.lastCorrectionNorm && entry.confirmedNormalized === opts.lastCorrectionNorm) {
    const fuller = findFullerAlternativeForNorm(opts.lastCorrectionNorm, opts.allForObserved)
    lastCorrectionBonus = fuller
      ? LAST_CORRECTION_BOOST_WHEN_SUPERSEDED_BY_FULLER
      : LAST_CORRECTION_BOOST
  }

  let expansionBonus = 0
  if (
    opts.lastCorrectionNorm &&
    entry.confirmedNormalized &&
    entry.confirmedNormalized !== opts.lastCorrectionNorm &&
    isNominalExpansionOf(opts.lastCorrectionNorm, entry.confirmedNormalized)
  ) {
    expansionBonus = EXPANSION_OVER_ABBREVIATED_LAST_BOOST
  }

  let resolvedBonus = 0
  let resolvedPenalty = 0
  const resolvedNorm = opts.resolvedNormalized?.trim() || ""
  if (resolvedNorm) {
    if (entry.confirmedNormalized === resolvedNorm) {
      resolvedBonus = 0.28
    } else {
      resolvedPenalty = -0.35
      if (
        isNominalExpansionOf(resolvedNorm, entry.confirmedNormalized) ||
        isNominalExpansionOf(entry.confirmedNormalized, resolvedNorm)
      ) {
        resolvedPenalty = -0.12
      }
    }
  }

  return (
    lastCorrectionBonus +
    expansionBonus +
    recency +
    countPart +
    completenessPart +
    resolvedBonus +
    resolvedPenalty
  )
}

export function sortObservedMemoryEntries(
  entries: ObservedToConfirmedEntry[],
  opts: {
    lastCorrectionNorm: string | null
    resolvedNormalized?: string
  }
): ObservedToConfirmedEntry[] {
  const all = entries
  return [...entries].sort((a, b) => {
    const scoreA = rankObservedMemoryEntry(a, {
      lastCorrectionNorm: opts.lastCorrectionNorm,
      allForObserved: all,
      resolvedNormalized: opts.resolvedNormalized,
    })
    const scoreB = rankObservedMemoryEntry(b, {
      lastCorrectionNorm: opts.lastCorrectionNorm,
      allForObserved: all,
      resolvedNormalized: opts.resolvedNormalized,
    })
    return scoreB - scoreA || b.historical_confirmation_count - a.historical_confirmation_count
  })
}

/**
 * Resuelve memoria nominal para un OCR: última corrección docente, conflicto y elegibilidad de autofill.
 */
export function resolveObservedNominalMemory(
  observed: NormalizedNominalName,
  confirmations: TeacherNominalConfirmationRecord[],
  opts?: {
    resolvedNormalized?: string
    sameTeacherScope?: boolean
    currentCourse?: CourseMatchInput
    /** manual === observed: tratar manual como vacío solo para autofill (no borrar UI). */
    manualEmptyForMemory?: boolean
    /** Alias explícito: manual normalizado === OCR observado. */
    manualMatchesObserved?: boolean
  }
): ObservedNominalMemoryResolution {
  const empty: ObservedNominalMemoryResolution = {
    last_teacher_correction: null,
    previous_used_name: null,
    preferred_complete_name: null,
    last_correction_is_abbreviated: false,
    has_historical_conflict: false,
    autofill_eligible: false,
    other_course_suggestion_eligible: false,
    other_course_suggested_name: null,
    same_course_confirmation_count: 0,
    other_course_confirmation_count: 0,
    consistency_score: 0,
    dominant_entry: null,
  }

  if (!observed.normalized || !confirmations.length) return empty
  if (opts?.sameTeacherScope === false) return empty

  const index = buildObservedToConfirmedIndex(confirmations)
  const entries = collectEntriesForObserved(observed, index).filter((e) => e.confirmedDisplayName?.trim())
  if (!entries.length) return empty

  const lastOverrideRec = findLastManualOverrideRecord(observed, confirmations)
  const lastCorrectionNorm = lastOverrideRec
    ? normalizeNominalName(lastOverrideRec.confirmed_display_name ?? "").normalized
    : null

  const sorted = sortObservedMemoryEntries(entries, {
    lastCorrectionNorm,
    resolvedNormalized: opts?.resolvedNormalized,
  })

  const lastEntry =
    (lastCorrectionNorm
      ? entries.find((e) => e.confirmedNormalized === lastCorrectionNorm)
      : null) ?? sorted[0] ?? null

  const fullerForLast =
    lastCorrectionNorm != null ? findFullerAlternativeForNorm(lastCorrectionNorm, entries) : null
  const lastMetrics = lastEntry
    ? scoreNominalCompleteness(lastEntry.confirmedNormalized || lastEntry.confirmedDisplayName)
    : null
  const last_correction_is_abbreviated = Boolean(
    lastMetrics?.is_likely_abbreviated ||
      (lastCorrectionNorm != null && fullerForLast != null)
  )

  const resolvedNormEarly = opts?.resolvedNormalized?.trim() || ""
  const resolvedEntry =
    resolvedNormEarly.length > 0
      ? entries.find((e) => e.confirmedNormalized === resolvedNormEarly)
      : null

  let dominant = sorted[0] ?? null
  if (resolvedEntry) {
    dominant = resolvedEntry
  } else if (last_correction_is_abbreviated && fullerForLast) {
    dominant = fullerForLast
  }

  const distinctConfirmed = entries.filter((e) => e.historical_confirmation_count > 0)
  const has_historical_conflict = distinctConfirmed.length >= 2

  const preferred_complete_name =
    last_correction_is_abbreviated && fullerForLast ? entryToCorrectionRef(fullerForLast) : null

  let previous_used_name: TeacherCorrectionRef | null = null
  if (preferred_complete_name) {
    previous_used_name = preferred_complete_name
  } else if (has_historical_conflict && lastEntry) {
    const previousCandidates = sortObservedMemoryEntries(
      entries.filter((e) => e.confirmedNormalized !== lastEntry.confirmedNormalized),
      { lastCorrectionNorm: null, resolvedNormalized: opts?.resolvedNormalized }
    )
    const prev = previousCandidates[0]
    if (prev && prev.historical_confirmation_count > 0) {
      previous_used_name = entryToCorrectionRef(prev)
    }
  }

  const last_teacher_correction = lastEntry ? entryToCorrectionRef(lastEntry) : null
  const { consistency_score, contradictory_override_count } = lastEntry
    ? computeConsistencyForEntry(lastEntry, entries)
    : { consistency_score: 0, contradictory_override_count: 0 }

  const resolvedNorm = opts?.resolvedNormalized?.trim() || ""
  const resolvedMatchesLast =
    !resolvedNorm || !lastEntry || resolvedNorm === lastEntry.confirmedNormalized

  const hasRecentContradictoryOverride =
    lastEntry != null &&
    entries.some(
      (e) =>
        e.confirmedNormalized !== lastEntry.confirmedNormalized &&
        e.last_manual_override_at &&
        lastEntry.last_manual_override_at &&
        e.last_manual_override_at > lastEntry.last_manual_override_at
    )

  const autofillTarget = dominant ?? lastEntry
  const autofill_consistency = autofillTarget
    ? computeConsistencyForEntry(autofillTarget, entries).consistency_score
    : consistency_score

  const currentCourse: CourseMatchInput = opts?.currentCourse ?? {}
  const courseKnown = isCurrentCourseContextKnown(currentCourse)
  const manualEmptyForMemory =
    opts?.manualEmptyForMemory === true || opts?.manualMatchesObserved === true

  const scopedCounts = autofillTarget?.confirmedNormalized
    ? countCourseScopedConfirmations(
        confirmations,
        observed,
        autofillTarget.confirmedNormalized,
        currentCourse
      )
    : {
        same_course_confirmation_count: 0,
        other_course_confirmation_count: 0,
        unknown_course_confirmation_count: 0,
      }

  const same_course_confirmation_count = scopedCounts.same_course_confirmation_count
  const other_course_confirmation_count = scopedCounts.other_course_confirmation_count

  const resolvedAllowsAutofill =
    manualEmptyForMemory ||
    (resolvedNormEarly
      ? resolvedNormEarly === autofillTarget?.confirmedNormalized
      : resolvedMatchesLast)

  const autofill_eligible =
    Boolean(autofillTarget) &&
    courseKnown &&
    same_course_confirmation_count >= MIN_AUTOFILL_CONFIRMATIONS &&
    autofill_consistency >= MIN_CONSISTENCY_FOR_AUTOFILL &&
    !hasRecentContradictoryOverride &&
    !preferred_complete_name &&
    resolvedAllowsAutofill

  const other_course_suggestion_eligible =
    Boolean(autofillTarget?.confirmedDisplayName) &&
    courseKnown &&
    other_course_confirmation_count >= MIN_AUTOFILL_CONFIRMATIONS &&
    same_course_confirmation_count < MIN_AUTOFILL_CONFIRMATIONS &&
    resolvedAllowsAutofill

  const other_course_suggested_name = other_course_suggestion_eligible
    ? autofillTarget!.confirmedDisplayName
    : null

  return {
    last_teacher_correction,
    previous_used_name,
    preferred_complete_name,
    last_correction_is_abbreviated,
    has_historical_conflict,
    autofill_eligible,
    other_course_suggestion_eligible,
    other_course_suggested_name,
    same_course_confirmation_count,
    other_course_confirmation_count,
    consistency_score,
    dominant_entry: dominant,
  }
}

function lookupEntryForCandidate(
  observed: NormalizedNominalName,
  candidate: Pick<NominalRosterEntry, "displayName" | "studentProfileId" | "catalogStudentId">,
  index: Map<string, ObservedToConfirmedEntry[]>
): ObservedToConfirmedEntry | null {
  const candNorm = normalizeNominalName(candidate.displayName).normalized
  if (!candNorm) return null

  const entries = collectEntriesForObserved(observed, index)
  for (const e of entries) {
    if (e.confirmedNormalized && e.confirmedNormalized === candNorm) return e
    if (
      candidate.studentProfileId &&
      e.studentProfileId &&
      e.studentProfileId === candidate.studentProfileId
    ) {
      return e
    }
    if (
      candidate.catalogStudentId &&
      e.catalogStudentId &&
      e.catalogStudentId === candidate.catalogStudentId
    ) {
      return e
    }
  }
  return null
}

export function computeHistoricalNominalBoost(
  observed: NormalizedNominalName,
  candidate: Pick<
    NominalRosterEntry,
    "displayName" | "studentProfileId" | "catalogStudentId" | "courseLabel" | "sameCourse"
  >,
  ctx: HistoricalNominalBoostContext,
  index?: Map<string, ObservedToConfirmedEntry[]>
): HistoricalNominalBoostResult {
  const emptyMeta: HistoricalNominalBoostResult["historical_boost"] = {
    applied: false,
    value: 0,
    historical_confirmation_count: 0,
    consistency_score: 0,
    same_course_weight: 0,
    same_teacher_weight: 0,
    recency_weight: 0,
    dominant_confirmed_name: null,
  }

  const zero: HistoricalNominalBoostResult = {
    historical_nominal_boost_applied: false,
    historical_nominal_boost_value: 0,
    historical_confirmation_count: 0,
    consistency_score: 0,
    same_course_weight: 0,
    same_teacher_weight: 0,
    recency_weight: 0,
    same_course_bonus: 0,
    teacher_history_bonus: 0,
    contradictory_override_count: 0,
    is_last_teacher_correction: false,
    historical_boost: emptyMeta,
  }

  if (!ctx.confirmations.length) return zero

  const idx = index ?? buildObservedToConfirmedIndex(ctx.confirmations)
  const entry = lookupEntryForCandidate(observed, candidate, idx)
  if (!entry || entry.historical_confirmation_count < 1) return zero

  const allForObserved = collectEntriesForObserved(observed, idx)
  const memory = resolveObservedNominalMemory(observed, ctx.confirmations, {
    resolvedNormalized: ctx.resolvedNormalized,
    sameTeacherScope: ctx.sameTeacherScope,
  })

  const { consistency_score, contradictory_override_count } = computeConsistencyForEntry(entry, allForObserved)

  if (consistency_score < MIN_CONSISTENCY_FOR_BOOST && contradictory_override_count >= 2) {
    return zero
  }
  if (contradictory_override_count >= 3 && consistency_score < CONTRADICTORY_SUPPRESS_RATIO) {
    return zero
  }

  const same_teacher_weight = ctx.sameTeacherScope ? 1 : 0
  const currentCourse: CourseMatchInput = { courseId: null, courseLabel: ctx.courseLabel }
  const scopedForCandidate = entry.confirmedNormalized
    ? countCourseScopedConfirmations(
        ctx.confirmations,
        observed,
        entry.confirmedNormalized,
        currentCourse
      )
    : { same_course_confirmation_count: 0, other_course_confirmation_count: 0, unknown_course_confirmation_count: 0 }
  const same_course_weight =
    candidate.sameCourse ||
    scopedForCandidate.same_course_confirmation_count > 0 ||
    courseConfidenceMatch(currentCourse, { courseId: null, courseLabel: candidate.courseLabel }) ===
      "same"
      ? 1
      : 0

  if (same_teacher_weight < 1 && same_course_weight < 1) {
    return zero
  }

  const count = entry.historical_confirmation_count
  const recencyAt = entry.last_manual_override_at ?? entry.last_confirmed_at
  const recency_weight = recencyWeight(recencyAt, { manualOverride: Boolean(entry.last_manual_override_at) })
  const countBoost = logCountBoost(count) * consistency_score
  const same_course_bonus = same_course_weight > 0 ? Math.min(SAME_COURSE_BONUS_CAP, 0.02 * Math.log1p(count)) : 0
  const teacher_history_bonus =
    same_teacher_weight > 0 ? Math.min(TEACHER_HISTORY_BONUS_CAP, 0.018 * Math.log1p(Math.min(count, 8))) : 0

  const exactBonus =
    entry.exact_match_count > 0 ? Math.min(EXACT_MATCH_BONUS, 0.012 * Math.log1p(entry.exact_match_count)) : 0
  const overrideBonus =
    entry.manual_override_count > 0
      ? Math.min(MANUAL_OVERRIDE_CORRECTIVE_BONUS, 0.025 * Math.log1p(entry.manual_override_count))
      : 0

  const is_last_teacher_correction =
    memory.last_teacher_correction?.normalized != null &&
    entry.confirmedNormalized === memory.last_teacher_correction.normalized

  let lastCorrectionBonus = 0
  if (is_last_teacher_correction && memory.last_teacher_correction?.normalized) {
    const fuller = findFullerAlternativeForNorm(memory.last_teacher_correction.normalized, allForObserved)
    lastCorrectionBonus = fuller
      ? LAST_CORRECTION_BOOST_WHEN_SUPERSEDED_BY_FULLER
      : LAST_CORRECTION_BOOST
  }

  const expandsAbbreviatedLast =
    memory.last_correction_is_abbreviated &&
    memory.last_teacher_correction?.normalized != null &&
    entry.confirmedNormalized != null &&
    isNominalExpansionOf(memory.last_teacher_correction.normalized, entry.confirmedNormalized)

  if (expandsAbbreviatedLast) {
    lastCorrectionBonus = Math.max(lastCorrectionBonus, EXPANSION_OVER_ABBREVIATED_LAST_BOOST)
  }

  const preferredCompleteNorm = memory.preferred_complete_name?.normalized ?? ""
  if (
    preferredCompleteNorm &&
    entry.confirmedNormalized === preferredCompleteNorm &&
    memory.last_correction_is_abbreviated
  ) {
    lastCorrectionBonus = Math.max(lastCorrectionBonus, EXPANSION_OVER_ABBREVIATED_LAST_BOOST * 1.15)
  }

  const completenessBonus = completenessRankBonus(entry.confirmedDisplayName)

  let historical_nominal_boost_value =
    countBoost +
    same_course_bonus +
    teacher_history_bonus +
    recency_weight +
    exactBonus +
    overrideBonus +
    lastCorrectionBonus +
    completenessBonus

  if (
    ctx.resolvedNormalized &&
    ctx.resolvedNormalized !== entry.confirmedNormalized &&
    ctx.resolvedNormalized.length > 0
  ) {
    historical_nominal_boost_value *= 0.35
  }

  if (
    is_last_teacher_correction &&
    memory.preferred_complete_name &&
    memory.last_correction_is_abbreviated &&
    entry.confirmedNormalized === memory.last_teacher_correction?.normalized
  ) {
    historical_nominal_boost_value *= 0.32
  }

  historical_nominal_boost_value = Math.min(historical_nominal_boost_value, MAX_BOOST)

  const dominant = memory.dominant_entry?.confirmedDisplayName ?? entry.confirmedDisplayName

  return {
    historical_nominal_boost_applied: historical_nominal_boost_value > 0.02,
    historical_nominal_boost_value,
    historical_confirmation_count: count,
    consistency_score,
    same_course_weight,
    same_teacher_weight,
    recency_weight,
    same_course_bonus,
    teacher_history_bonus,
    contradictory_override_count,
    is_last_teacher_correction,
    historical_boost: {
      applied: historical_nominal_boost_value > 0.02,
      value: historical_nominal_boost_value,
      historical_confirmation_count: count,
      consistency_score,
      same_course_weight,
      same_teacher_weight,
      recency_weight,
      dominant_confirmed_name: dominant,
    },
  }
}

/**
 * Entradas confirmadas por el docente para este OCR (normalizado o token bag),
 * ordenadas por ranking memoria (recencia + última corrección; no solo conteo bruto).
 */
export function getHistoricalConfirmedEntriesForObserved(
  observed: NormalizedNominalName,
  index: Map<string, ObservedToConfirmedEntry[]>,
  opts?: {
    confirmations?: TeacherNominalConfirmationRecord[]
    resolvedNormalized?: string
  }
): ObservedToConfirmedEntry[] {
  const entries = collectEntriesForObserved(observed, index).filter((e) => e.confirmedDisplayName?.trim())
  const lastOverrideRec = opts?.confirmations?.length
    ? findLastManualOverrideRecord(observed, opts.confirmations)
    : null
  const lastCorrectionNorm = lastOverrideRec
    ? normalizeNominalName(lastOverrideRec.confirmed_display_name ?? "").normalized
    : null
  return sortObservedMemoryEntries(entries, {
    lastCorrectionNorm,
    resolvedNormalized: opts?.resolvedNormalized,
  })
}

/** Entrada dominante según última corrección docente y recencia (no solo conteo). */
export function dominantHistoricalConfirmedName(
  observed: NormalizedNominalName,
  ctx: HistoricalNominalBoostContext,
  index?: Map<string, ObservedToConfirmedEntry[]>
): ObservedToConfirmedEntry | null {
  const resolution = resolveObservedNominalMemory(observed, ctx.confirmations, {
    resolvedNormalized: ctx.resolvedNormalized,
    sameTeacherScope: ctx.sameTeacherScope,
  })
  return resolution.dominant_entry
}
