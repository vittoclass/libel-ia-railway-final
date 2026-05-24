/**
 * FASE 3C — Confianza nominal longitudinal (solo UX; no auto-confirma ni persiste identidad).
 */
import {
  isActiveManualNominalOverride,
  levenshteinSimilarity,
  normalizeNominalName,
} from "@/app/lib/pedagogical-graph/nominalIdentity"
import type { ObservedNominalMemoryResolution } from "@/app/lib/pedagogical-graph/historicalNominalBoost"

/** Alineado con nominalIdentity (evita import circular en buildMatchMetadata). */
const HIGH_LEVENSHTEIN_THRESHOLD = 0.72
const HIGH_NOMINAL_SCORE_THRESHOLD = 0.86
const MIN_NOMINAL_MATCH_SCORE = 0.52
const MIN_AUTOFILL_CONFIRMATIONS = 3
const MIN_CONSISTENCY_FOR_AUTOFILL = 0.62

export type NominalConfidenceLevel = "low" | "medium" | "high" | "very_high"

/** Modo de presentación UI (no implica confirmación docente). */
export type NominalUxPresentation =
  | "hidden"
  | "detected_quiet"
  | "doubtful_banner"
  | "compact_suggest"
  | "historical_chip"
  | "historical_autofill"
  | "other_course_suggestion"
  | "teacher_correction_conflict"
  | "complete_name_preferred"
  | "manual_override_authority"

export type NominalSuggestionForUx = {
  display_name: string
  match_score: number
  levenshtein_similarity?: number
  historical_confirmation_count?: number
  historical_match_count?: number
  same_course?: boolean
  reasons?: string[]
  historical_nominal_boost_applied?: boolean
  historical_nominal_boost_value?: number
  consistency_score?: number
}

export type NominalUxContext = {
  observedRaw: string
  manualName: string
  topCandidate: NominalSuggestionForUx | null
  /** Si el docente ya alineó manual con el OCR observado. */
  manualMatchesObserved: boolean
  /** manual === observed: vacío solo para memoria/autofill; el texto visual se mantiene. */
  manualEmptyForMemory?: boolean
  memoryResolution?: ObservedNominalMemoryResolution | null
}

export type NominalUxDecision = {
  nominal_confidence_level: NominalConfidenceLevel
  nominal_ux_mode: NominalUxPresentation
  requires_teacher_review: boolean
  /** Prellenado visual permitido (sin POST de confirmación). */
  allow_visual_prefill: boolean
  /** OCR observado sigue visible en UI. */
  show_observed_ocr: boolean
  /** Mensaje opcional de conflicto histórico. */
  conflict_message?: string | null
  previous_used_label?: string | null
}

const GENERIC_MANUAL = /^(alumno|estudiante)\s*\d*$/i

export function isGenericOrEmptyManualName(name: string): boolean {
  const t = name.trim()
  return !t || GENERIC_MANUAL.test(t)
}

/**
 * Nivel longitudinal: combina score actual, similitud Levenshtein y confirmaciones históricas.
 */
export function deriveNominalConfidenceLevel(
  observedRaw: string,
  top: NominalSuggestionForUx | null,
  memory?: ObservedNominalMemoryResolution | null
): NominalConfidenceLevel {
  if (!top) return "low"

  const score = top.match_score
  const histConf = top.historical_confirmation_count ?? 0
  const histMatch = top.historical_match_count ?? 0
  const histBoost = top.historical_nominal_boost_applied === true
  const boostValue = top.historical_nominal_boost_value ?? 0
  const consistency = Math.max(top.consistency_score ?? 0, memory?.consistency_score ?? 0)
  const lev =
    typeof top.levenshtein_similarity === "number"
      ? top.levenshtein_similarity
      : levenshteinSimilarity(observedRaw, top.display_name)
  const sameCourse =
    top.same_course === true ||
    (top.reasons?.includes("same_course") ?? false) ||
    (memory?.same_course_confirmation_count ?? 0) >= MIN_AUTOFILL_CONFIRMATIONS
  const tokenBag = top.reasons?.includes("token_bag_match") ?? false
  const preferredNorm = memory?.preferred_complete_name?.normalized ?? ""
  const topNormForHist = normalizeNominalName(top.display_name).normalized
  const isPreferredComplete =
    preferredNorm.length > 0 && topNormForHist === preferredNorm
  const isLastCorrection =
    memory?.last_teacher_correction?.normalized != null &&
    topNormForHist === memory.last_teacher_correction.normalized &&
    !memory.last_correction_is_abbreviated

  const historicalStrong =
    (histBoost && histConf >= 2 && consistency >= MIN_CONSISTENCY_FOR_AUTOFILL) ||
    (isLastCorrection && histConf >= MIN_AUTOFILL_CONFIRMATIONS) ||
    (isPreferredComplete && histConf >= 1)
  const ocrClear = lev >= HIGH_LEVENSHTEIN_THRESHOLD || tokenBag
  const ocrOrHistory = ocrClear || historicalStrong

  if (
    score >= MIN_NOMINAL_MATCH_SCORE + 0.1 &&
    (sameCourse || histBoost || isLastCorrection) &&
    historicalStrong &&
    histConf >= MIN_AUTOFILL_CONFIRMATIONS
  ) {
    return "very_high"
  }

  if (
    score >= HIGH_NOMINAL_SCORE_THRESHOLD &&
    sameCourse &&
    histConf >= MIN_AUTOFILL_CONFIRMATIONS &&
    ocrOrHistory &&
    (histMatch >= 1 || histConf >= MIN_AUTOFILL_CONFIRMATIONS)
  ) {
    return "very_high"
  }

  if (
    (score >= 0.72 || (historicalStrong && score >= MIN_NOMINAL_MATCH_SCORE + 0.12)) &&
    (sameCourse || histBoost || isLastCorrection) &&
    (ocrOrHistory || histConf >= 2) &&
    (histConf >= 2 || histMatch >= 2)
  ) {
    return "high"
  }

  if (score >= HIGH_NOMINAL_SCORE_THRESHOLD && sameCourse && ocrOrHistory) {
    return "high"
  }

  if (score >= MIN_NOMINAL_MATCH_SCORE + 0.1 && lev >= 0.55) {
    return "medium"
  }

  return "low"
}

function buildConflictLabels(memory: ObservedNominalMemoryResolution): {
  conflict_message: string | null
  previous_used_label: string | null
} {
  const last = memory.last_teacher_correction
  if (!last) return { conflict_message: null, previous_used_label: null }

  if (memory.preferred_complete_name && memory.last_correction_is_abbreviated) {
    const full = memory.preferred_complete_name
    return {
      conflict_message: `Última corrección breve: ${last.display_name}`,
      previous_used_label: full
        ? `Nombre completo previo: ${full.display_name}`
        : null,
    }
  }

  const conflict_message = `Última corrección docente: ${last.display_name}`
  const previous_used_label = memory.previous_used_name
    ? `Antes se usó: ${memory.previous_used_name.display_name}`
    : null
  return { conflict_message, previous_used_label }
}

/**
 * Decide cómo mostrar la memoria nominal sin bloquear edición manual.
 */
export function deriveNominalUxDecision(ctx: NominalUxContext): NominalUxDecision {
  const observed = ctx.observedRaw.trim()
  if (!observed) {
    return {
      nominal_confidence_level: "low",
      nominal_ux_mode: "hidden",
      requires_teacher_review: false,
      allow_visual_prefill: false,
      show_observed_ocr: false,
    }
  }

  const memory = ctx.memoryResolution ?? null
  const top = ctx.topCandidate
  const level = deriveNominalConfidenceLevel(observed, top, memory)
  const manual = ctx.manualName.trim()
  const manualNorm = manual ? normalizeNominalName(manual).normalized : ""
  const topNorm = top ? normalizeNominalName(top.display_name).normalized : ""
  const manualMatchesTop = Boolean(topNorm && manualNorm && manualNorm === topNorm)
  const manualEmpty = isGenericOrEmptyManualName(manual)
  const manualEmptyForMemory =
    ctx.manualEmptyForMemory === true ||
    ctx.manualMatchesObserved === true ||
    (manualEmpty && ctx.manualMatchesObserved)
  const manualOverrideActive = isActiveManualNominalOverride(observed, manual)

  if (manualOverrideActive) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "manual_override_authority",
      requires_teacher_review: false,
      allow_visual_prefill: false,
      show_observed_ocr: true,
    }
  }

  const histConf = top?.historical_confirmation_count ?? 0
  const memoryAutofill = memory?.autofill_eligible === true
  const otherCourseSuggestion = memory?.other_course_suggestion_eligible === true

  const levObsTop = top
    ? typeof top.levenshtein_similarity === "number"
      ? top.levenshtein_similarity
      : levenshteinSimilarity(observed, top.display_name)
    : 0

  const ocrDoubtful = !top || levObsTop < 0.55 || top.match_score < MIN_NOMINAL_MATCH_SCORE + 0.08

  const conflictLabels = memory?.has_historical_conflict ? buildConflictLabels(memory) : null
  const prefersCompleteName =
    memory?.preferred_complete_name != null && memory.last_correction_is_abbreviated

  const observedNorm = normalizeNominalName(observed).normalized
  const slotEmptyForMemory = manualEmpty || manualEmptyForMemory || ctx.manualMatchesObserved === true
  const hasReviewableSuggestion =
    Boolean(top) && topNorm.length > 0 && topNorm !== observedNorm
  const autofillDisplayName =
    memory?.dominant_entry?.confirmedDisplayName ?? top?.display_name ?? null

  if (prefersCompleteName && slotEmptyForMemory) {
    const labels = buildConflictLabels(memory!)
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "complete_name_preferred",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: true,
      conflict_message: labels.conflict_message,
      previous_used_label: labels.previous_used_label,
    }
  }

  if (memoryAutofill && slotEmptyForMemory && autofillDisplayName) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "historical_autofill",
      requires_teacher_review: true,
      allow_visual_prefill: true,
      show_observed_ocr: true,
      conflict_message: memory.has_historical_conflict ? conflictLabels?.conflict_message ?? null : null,
      previous_used_label: memory.has_historical_conflict ? conflictLabels?.previous_used_label ?? null : null,
    }
  }

  if (
    (level === "high" || level === "very_high") &&
    (memory?.same_course_confirmation_count ?? 0) >= MIN_AUTOFILL_CONFIRMATIONS &&
    top &&
    slotEmptyForMemory
  ) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "historical_chip",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: true,
      conflict_message: memory?.has_historical_conflict ? conflictLabels?.conflict_message ?? null : null,
      previous_used_label: memory?.has_historical_conflict ? conflictLabels?.previous_used_label ?? null : null,
    }
  }

  if (otherCourseSuggestion && slotEmptyForMemory && top) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "other_course_suggestion",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: true,
    }
  }

  if (
    memory?.has_historical_conflict &&
    memory.last_teacher_correction &&
    !prefersCompleteName &&
    (memory.preferred_complete_name != null || !memoryAutofill) &&
    slotEmptyForMemory
  ) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "teacher_correction_conflict",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: true,
      conflict_message: conflictLabels?.conflict_message ?? null,
      previous_used_label: conflictLabels?.previous_used_label ?? null,
    }
  }

  if (hasReviewableSuggestion && slotEmptyForMemory) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "compact_suggest",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: true,
    }
  }

  if (ctx.manualMatchesObserved && !manualEmptyForMemory && (level === "high" || level === "very_high" || !top)) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "detected_quiet",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: false,
    }
  }

  if (manualMatchesTop && !manualEmptyForMemory && (level === "high" || level === "very_high")) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "detected_quiet",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: false,
    }
  }

  if (memory?.has_historical_conflict && memory.last_teacher_correction && top && !prefersCompleteName) {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "teacher_correction_conflict",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: true,
      conflict_message: conflictLabels?.conflict_message ?? null,
      previous_used_label: conflictLabels?.previous_used_label ?? null,
    }
  }

  if (ocrDoubtful || level === "low") {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "doubtful_banner",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: true,
    }
  }

  if (level === "medium") {
    return {
      nominal_confidence_level: level,
      nominal_ux_mode: "compact_suggest",
      requires_teacher_review: true,
      allow_visual_prefill: false,
      show_observed_ocr: true,
    }
  }

  return {
    nominal_confidence_level: level,
    nominal_ux_mode: "compact_suggest",
    requires_teacher_review: true,
    allow_visual_prefill: false,
    show_observed_ocr: true,
  }
}
