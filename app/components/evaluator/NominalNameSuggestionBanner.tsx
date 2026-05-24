"use client"

/**
 * FASE 3D.1 — Sugerencia nominal + memoria docente.
 * La edición manual del docente siempre prevalece.
 * Memoria manual_override/exact_match solo al blur, evaluar o acción explícita (no debounce al escribir).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { UserCheck, X, HelpCircle, CheckCircle2, History, Pencil } from "lucide-react"
import {
  isActiveManualNominalOverride,
  normalizeNominalName,
} from "@/app/lib/pedagogical-graph/nominalIdentity"
import type { ObservedNominalMemoryResolution } from "@/app/lib/pedagogical-graph/historicalNominalBoost"
import {
  deriveNominalConfirmationType,
  persistTeacherNominalMemory,
  resetNominalMemorySessionDedupeForManualCorrection,
  resetNominalMemorySessionDedupeForObserved,
  type NominalConfirmationType,
} from "@/app/lib/pedagogical-graph/nominalTeacherMemoryClient"
import {
  deriveNominalUxDecision,
  isGenericOrEmptyManualName,
  type NominalConfidenceLevel,
  type NominalSuggestionForUx,
  type NominalUxPresentation,
} from "@/app/lib/pedagogical-graph/nominalUxConfidence"

export type NominalSuggestionCandidate = NominalSuggestionForUx & {
  student_profile_id: string | null
  catalog_student_id: string | null
  source?: string
}

type Props = {
  observedNameRaw: string | null | undefined
  currentManualName: string
  courseLabel?: string | null
  courseId?: string | null
  evaluationId?: string | null
  disabled?: boolean
  onApplyConfirmedName: (name: string) => void
}

const showNominalDevPanel =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_NOMINAL_DEBUG === "1" || process.env.NODE_ENV === "development")

export function NominalNameSuggestionBanner({
  observedNameRaw,
  currentManualName,
  courseLabel,
  courseId,
  evaluationId,
  disabled,
  onApplyConfirmedName,
}: Props) {
  const [candidates, setCandidates] = useState<NominalSuggestionCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [skippedReason, setSkippedReason] = useState<string | null>(null)
  const [serverUxMode, setServerUxMode] = useState<NominalUxPresentation | null>(null)
  const [serverTopSuggestion, setServerTopSuggestion] = useState<string | null>(null)
  const [serverConfidence, setServerConfidence] = useState<NominalConfidenceLevel | null>(null)
  const [allowVisualPrefill, setAllowVisualPrefill] = useState(false)
  const [memoryResolution, setMemoryResolution] = useState<ObservedNominalMemoryResolution | null>(null)
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)
  const [previousUsedLabel, setPreviousUsedLabel] = useState<string | null>(null)
  const prevManualNormRef = useRef<string>("")
  const [memoryStatusMessage, setMemoryStatusMessage] = useState<string | null>(null)
  const [memorySaveFailedHint, setMemorySaveFailedHint] = useState(false)
  const [memoryErrorDev, setMemoryErrorDev] = useState<string | null>(null)
  const [manualOverrideActive, setManualOverrideActive] = useState(false)
  const [secondaryHistoricalSuggestion, setSecondaryHistoricalSuggestion] = useState<string | null>(
    null
  )
  const [autofillDisplayName, setAutofillDisplayName] = useState<string | null>(null)
  const [otherCourseMemory, setOtherCourseMemory] = useState<{
    eligible: boolean
    confirmed_name: string
    message: string
  } | null>(null)
  const prefillKeyRef = useRef<string | null>(null)

  const observed = observedNameRaw != null ? String(observedNameRaw).trim() : ""
  const manual = currentManualName.trim()
  const observedNorm = observed ? normalizeNominalName(observed).normalized : ""
  const manualNorm = manual ? normalizeNominalName(manual).normalized : ""
  const manualMatchesObserved =
    observedNorm.length > 0 && manualNorm.length > 0 && observedNorm === manualNorm
  const manualEmptyForMemory =
    manualMatchesObserved || isGenericOrEmptyManualName(manual)
  const manualIsOverrideLocal = isActiveManualNominalOverride(observed, manual)
  const manualIsOverride = manualOverrideActive || manualIsOverrideLocal

  const top = candidates[0] ?? null
  const topDisplayNorm = top ? normalizeNominalName(top.display_name).normalized : ""
  const hasReviewableSuggestion =
    Boolean(top) &&
    candidates.length > 0 &&
    topDisplayNorm.length > 0 &&
    topDisplayNorm !== observedNorm

  const uxDecision = useMemo(() => {
    if (dismissed) {
      return {
        nominal_confidence_level: "low" as NominalConfidenceLevel,
        nominal_ux_mode: "hidden" as NominalUxPresentation,
        requires_teacher_review: true,
        allow_visual_prefill: false,
        show_observed_ocr: false,
      }
    }
    return deriveNominalUxDecision({
      observedRaw: observed,
      manualName: manual,
      topCandidate: top,
      manualMatchesObserved,
      manualEmptyForMemory: manualMatchesObserved || isGenericOrEmptyManualName(manual),
      memoryResolution,
    })
  }, [observed, manual, top, manualMatchesObserved, dismissed, memoryResolution])

  const uxMode: NominalUxPresentation =
    dismissed ? "hidden" : serverUxMode ?? uxDecision.nominal_ux_mode
  const confidenceLevel: NominalConfidenceLevel =
    serverConfidence ?? uxDecision.nominal_confidence_level

  const autofillTargetName = useMemo(() => {
    const fromApi = serverTopSuggestion?.trim()
    if (fromApi) return fromApi
    const fromDisplay = autofillDisplayName?.trim()
    if (fromDisplay) return fromDisplay
    return top?.display_name?.trim() || null
  }, [serverTopSuggestion, autofillDisplayName, top])

  /** Prioridad absoluta: respuesta explícita del API nominal-suggestions. */
  const isServerHistoricalAutofill =
    serverUxMode === "historical_autofill" &&
    allowVisualPrefill &&
    Boolean(autofillTargetName)

  const saveNominalMemory = useCallback(
    async (
      confirmationType: NominalConfirmationType,
      extra?: {
        confirmedDisplayName?: string
        studentProfileId?: string | null
        catalogStudentId?: string | null
        matchScore?: number | null
      }
    ) => {
      if (!observed || disabled) return
      const confirmed = (extra?.confirmedDisplayName ?? manual).trim()
      if (!confirmed) return

      const result = await persistTeacherNominalMemory({
        observedNameRaw: observed,
        confirmedDisplayName: confirmed,
        evaluationId: evaluationId ?? null,
        courseLabel: courseLabel ?? null,
        confirmationType,
        source:
          confirmationType === "suggested_match"
            ? "nominal_suggestion_banner"
            : "manual_name_field_or_evaluation_flow",
        studentProfileId: extra?.studentProfileId ?? null,
        catalogStudentId: extra?.catalogStudentId ?? null,
        matchScore: extra?.matchScore ?? null,
        ignored: confirmationType === "ignored",
      })

      if (confirmationType === "manual_override") {
        if (result.persisted) {
          resetNominalMemorySessionDedupeForManualCorrection(observed, confirmed)
          prefillKeyRef.current = null
          setMemoryStatusMessage(
            result.message ?? (result.deduped ? "Memoria ya registrada" : "Guardado como corrección docente")
          )
          setMemorySaveFailedHint(false)
          setMemoryErrorDev(null)
          window.setTimeout(() => setMemoryStatusMessage(null), 4000)
        } else if (
          result.skipped !== "dedupe_skip" &&
          (!result.skipped || result.skipped === "not_persisted" || result.skipped === "http_error")
        ) {
          setMemorySaveFailedHint(true)
          setMemoryStatusMessage(null)
          if (showNominalDevPanel) {
            const fallbackBits = [
              result.fallback_attempted ? "fallback_attempted" : null,
              result.fallback_error_code ? `fallback_error_code=${result.fallback_error_code}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
            setMemoryErrorDev(
              [
                `Error memoria: ${result.storage ?? "?"} / ${result.error_code ?? result.skipped ?? "?"}`,
                fallbackBits || null,
              ]
                .filter(Boolean)
                .join(" · ")
            )
          } else {
            setMemoryErrorDev(null)
          }
          window.setTimeout(() => {
            setMemorySaveFailedHint(false)
            setMemoryErrorDev(null)
          }, 6000)
        }
      }
    },
    [observed, manual, evaluationId, courseLabel, disabled]
  )

  useEffect(() => {
    if (!observed || dismissed || disabled) {
      setCandidates([])
      setSkippedReason(null)
      setFetchError(null)
      setServerUxMode(null)
      setServerTopSuggestion(null)
      setServerConfidence(null)
      return
    }

    let cancelled = false
    const t = window.setTimeout(async () => {
      setLoading(true)
      setFetchError(null)
      setSkippedReason(null)
      try {
        const params = new URLSearchParams({
          observed_name: observed,
          ...(manual ? { resolved_name: manual } : {}),
          ...(courseLabel ? { course_label: courseLabel } : {}),
          ...(courseId ? { course_id: courseId } : {}),
          ...(evaluationId ? { evaluation_id: evaluationId } : {}),
        })
        const res = await fetch(`/api/docente/nominal-suggestions?${params.toString()}`, {
          cache: "no-store",
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setCandidates([])
          setSkippedReason(null)
          setFetchError(typeof data.error === "string" ? data.error : "No se pudieron cargar sugerencias")
          return
        }
        const overrideActive = data.manual_override_active === true
        setManualOverrideActive(overrideActive)
        setSecondaryHistoricalSuggestion(
          overrideActive && typeof data.secondary_historical_suggestion === "string"
            ? data.secondary_historical_suggestion
            : null
        )
        const list = Array.isArray(data.candidates) ? (data.candidates as NominalSuggestionCandidate[]) : []
        const topFromApi = list[0] ?? null
        setCandidates(overrideActive ? [] : list.slice(0, 3))
        setSkippedReason(
          typeof data.skipped_reason === "string" ? data.skipped_reason : list.length === 0 ? "no_candidates" : null
        )
        if (typeof data.nominal_ux_mode === "string") {
          setServerUxMode(data.nominal_ux_mode as NominalUxPresentation)
        }
        if (typeof data.nominal_confidence_level === "string") {
          setServerConfidence(data.nominal_confidence_level as NominalConfidenceLevel)
        }
        setAllowVisualPrefill(data.allow_visual_prefill === true)
        const apiTopSuggestion =
          (typeof data.top_suggestion === "string" && data.top_suggestion.trim()) ||
          (typeof data.autofill_display_name === "string" && data.autofill_display_name.trim()) ||
          topFromApi?.display_name?.trim() ||
          null
        setServerTopSuggestion(apiTopSuggestion)
        const memRaw = data.nominal_memory
        if (memRaw && typeof memRaw === "object") {
          const m = memRaw as Record<string, unknown>
          setMemoryResolution({
            last_teacher_correction:
              (m.last_teacher_correction as ObservedNominalMemoryResolution["last_teacher_correction"]) ??
              null,
            previous_used_name:
              (m.previous_used_name as ObservedNominalMemoryResolution["previous_used_name"]) ?? null,
            preferred_complete_name:
              (m.preferred_complete_name as ObservedNominalMemoryResolution["preferred_complete_name"]) ??
              null,
            last_correction_is_abbreviated: m.last_correction_is_abbreviated === true,
            has_historical_conflict: m.has_historical_conflict === true,
            autofill_eligible: m.autofill_eligible === true,
            other_course_suggestion_eligible: m.other_course_suggestion_eligible === true,
            other_course_suggested_name:
              typeof m.other_course_suggested_name === "string"
                ? m.other_course_suggested_name
                : null,
            same_course_confirmation_count:
              typeof m.same_course_confirmation_count === "number"
                ? m.same_course_confirmation_count
                : 0,
            other_course_confirmation_count:
              typeof m.other_course_confirmation_count === "number"
                ? m.other_course_confirmation_count
                : 0,
            consistency_score:
              typeof m.consistency_score === "number" ? m.consistency_score : 0,
            dominant_entry: null,
          })
        } else {
          setMemoryResolution(null)
        }
        setAutofillDisplayName(
          typeof data.autofill_display_name === "string" ? data.autofill_display_name : null
        )
        const ocm = data.other_course_memory
        if (ocm && typeof ocm === "object" && !Array.isArray(ocm)) {
          const o = ocm as Record<string, unknown>
          const name = typeof o.confirmed_name === "string" ? o.confirmed_name : ""
          setOtherCourseMemory(
            o.eligible === true && name
              ? {
                  eligible: true,
                  confirmed_name: name,
                  message:
                    typeof o.message === "string"
                      ? o.message
                      : `Antes corregiste este OCR como ${name} en otro curso`,
                }
              : null
          )
        } else {
          setOtherCourseMemory(null)
        }
        setConflictMessage(typeof data.conflict_message === "string" ? data.conflict_message : null)
        setPreviousUsedLabel(typeof data.previous_used_label === "string" ? data.previous_used_label : null)

        const apiUxMode =
          typeof data.nominal_ux_mode === "string" ? (data.nominal_ux_mode as NominalUxPresentation) : null
        if (
          !overrideActive &&
          apiUxMode === "historical_autofill" &&
          data.allow_visual_prefill === true &&
          apiTopSuggestion
        ) {
          const overrideNow = isActiveManualNominalOverride(observed, manual)
          const emptyForMemory =
            (observedNorm.length > 0 && manualNorm.length > 0 && observedNorm === manualNorm) ||
            isGenericOrEmptyManualName(manual)
          if (overrideNow && !emptyForMemory) {
            /* docente ya escribió otro nombre */
          } else {
            const prefillKey = `${observed}|${apiTopSuggestion}`
            if (prefillKeyRef.current !== prefillKey) {
              prefillKeyRef.current = prefillKey
              console.info("[nominal autofill fired]", {
                top_suggestion: apiTopSuggestion,
                observed,
                uxMode: apiUxMode,
                source: "fetch_response",
              })
              onApplyConfirmedName(apiTopSuggestion)
            }
          }
        }

        if (showNominalDevPanel) {
          console.info("[nominal-banner] response", {
            candidates_length: list.length,
            top_display_name: topFromApi?.display_name ?? null,
            top_suggestion:
              typeof data.top_suggestion === "string" ? data.top_suggestion : topFromApi?.display_name ?? null,
            top_source: topFromApi?.source ?? null,
            ux_mode: typeof data.nominal_ux_mode === "string" ? data.nominal_ux_mode : null,
            nominal_confidence_level:
              typeof data.nominal_confidence_level === "string" ? data.nominal_confidence_level : null,
            observed_name: observed,
            course_label: courseLabel ?? null,
            fetch_url: `/api/docente/nominal-suggestions?${params.toString()}`,
          })
        }
      } catch {
        if (!cancelled) {
          setFetchError("Sin conexión para sugerencias nominales")
          setSkippedReason(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [observed, manual, manualNorm, observedNorm, courseLabel, courseId, evaluationId, dismissed, disabled, onApplyConfirmedName])

  useEffect(() => {
    setDismissed(false)
    prefillKeyRef.current = null
    setServerUxMode(null)
    setServerTopSuggestion(null)
    setServerConfidence(null)
    setMemoryResolution(null)
    setConflictMessage(null)
    setPreviousUsedLabel(null)
    setMemoryStatusMessage(null)
    setMemorySaveFailedHint(false)
    setMemoryErrorDev(null)
    setManualOverrideActive(false)
    setSecondaryHistoricalSuggestion(null)
    setAutofillDisplayName(null)
    setOtherCourseMemory(null)
    prevManualNormRef.current = ""
    resetNominalMemorySessionDedupeForObserved(observed)
  }, [observed])

  useEffect(() => {
    if (!observed || !manualNorm) return
    const prev = prevManualNormRef.current
    if (prev && prev !== manualNorm && prev !== observedNorm) {
      resetNominalMemorySessionDedupeForManualCorrection(observed, manual)
      prefillKeyRef.current = null
      setDismissed(false)
    }
    prevManualNormRef.current = manualNorm
  }, [observed, manual, manualNorm, observedNorm])

  useEffect(() => {
    if (disabled || dismissed || !isServerHistoricalAutofill || !autofillTargetName) return
    if (manualIsOverride && !manualMatchesObserved && !manualEmptyForMemory) return
    const key = `${observed}|${autofillTargetName}`
    if (prefillKeyRef.current === key) return
    prefillKeyRef.current = key
    console.info("[nominal autofill fired]", {
      top_suggestion: autofillTargetName,
      observed,
      uxMode: serverUxMode,
      allowVisualPrefill,
    })
    onApplyConfirmedName(autofillTargetName)
  }, [
    isServerHistoricalAutofill,
    autofillTargetName,
    observed,
    disabled,
    dismissed,
    onApplyConfirmedName,
    manualIsOverride,
    manualMatchesObserved,
    manualEmptyForMemory,
    serverUxMode,
    allowVisualPrefill,
  ])

  const handleConfirm = () => {
    if (!top) return
    const preferredComplete =
      memoryResolution?.preferred_complete_name ?? memoryResolution?.previous_used_name
    const abbreviatedLast = memoryResolution?.last_correction_is_abbreviated === true
    const topNorm = normalizeNominalName(top.display_name).normalized
    const suggestComplete =
      abbreviatedLast &&
      preferredComplete &&
      topNorm === memoryResolution?.last_teacher_correction?.normalized
    const nameToApply = suggestComplete ? preferredComplete!.display_name : top.display_name
    onApplyConfirmedName(nameToApply)
    void saveNominalMemory(suggestComplete ? "manual_override" : "suggested_match", {
      confirmedDisplayName: nameToApply,
      studentProfileId: top.student_profile_id,
      catalogStudentId: top.catalog_student_id,
      matchScore: top.match_score,
    })
    setDismissed(true)
  }

  const handleIgnore = () => {
    void saveNominalMemory("ignored", { confirmedDisplayName: manual || observed })
    setDismissed(true)
  }

  const handleRevertPrefill = () => {
    prefillKeyRef.current = null
    onApplyConfirmedName("")
    setDismissed(false)
  }

  if (!observed || dismissed || disabled) return null

  if (isServerHistoricalAutofill && autofillTargetName) {
    const label = autofillTargetName
    const sameCourseCount = memoryResolution?.same_course_confirmation_count ?? 0
    const chipDetail =
      sameCourseCount >= 3
        ? ` (confirmado 3+ veces en este curso)`
        : sameCourseCount > 0
          ? ` (confirmado ${sameCourseCount}× en este curso)`
          : ""
    const labelNorm = normalizeNominalName(label).normalized
    return (
      <div
        className="mt-2 rounded-md border border-slate-200 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-900/40 px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-2">
          <History className="h-4 w-4 text-slate-600 shrink-0" aria-hidden />
          <span className="text-[var(--text-secondary)]">
            ✓ Autocompletado por memoria docente:{" "}
            <strong className="text-[var(--text-primary)]">{label}</strong>
            {chipDetail}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={handleRevertPrefill}
          >
            <Pencil className="h-3 w-3 mr-1" />
            cambiar
          </Button>
          {labelNorm && manualNorm !== labelNorm ? (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleConfirm}>
              <UserCheck className="h-3 w-3 mr-1" />
              Confirmar
            </Button>
          ) : null}
        </div>
        {conflictMessage ? (
          <p className="text-[11px] text-[var(--text-muted)] mt-1 pl-6">{conflictMessage}</p>
        ) : null}
        {previousUsedLabel ? (
          <p className="text-[11px] text-[var(--text-muted)] pl-6">{previousUsedLabel}</p>
        ) : null}
        {uxDecision.show_observed_ocr ? (
          <p className="text-[11px] text-[var(--text-muted)] mt-1 pl-6">
            OCR observado: {observed}
          </p>
        ) : null}
      </div>
    )
  }

  if (manualIsOverride && manual.length > 0 && !isServerHistoricalAutofill) {
    const secondaryNorm = secondaryHistoricalSuggestion
      ? normalizeNominalName(secondaryHistoricalSuggestion).normalized
      : ""
    const showSecondaryNotice =
      secondaryHistoricalSuggestion &&
      secondaryNorm.length > 0 &&
      secondaryNorm !== manualNorm &&
      secondaryNorm !== observedNorm

    return (
      <div
        className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30 px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <p className="text-[var(--text-secondary)]">
          OCR detectó <strong className="text-[var(--text-primary)]">{observed}</strong>
        </p>
        <p className="text-[var(--text-primary)] mt-1">
          Nombre definido por el docente: <strong>{manual}</strong>
        </p>
        <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
          {memoryStatusMessage ?? "Memoria actualizada · se guardará al evaluar"}
        </p>
        {showSecondaryNotice ? (
          <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
            Había una sugerencia anterior distinta ({secondaryHistoricalSuggestion}), pero se usará
            el nombre escrito por el docente.
          </p>
        ) : null}
        {memorySaveFailedHint ? (
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
            No se pudo guardar memoria histórica
            {memoryErrorDev ? (
              <span className="block text-[10px] font-mono text-amber-800/80 dark:text-amber-200/80 mt-0.5">
                {memoryErrorDev}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    )
  }

  const suggestionHeadline =
    top?.source === "historical_nominal_memory"
      ? `Memoria docente: ${top.display_name}`
      : top
        ? `¿Quizás: ${top.display_name}?`
        : ""

  if (!manualIsOverride && top?.source === "last_teacher_manual_override" && !isServerHistoricalAutofill) {
    const correctedName = top.display_name
    const applyLastCorrection = () => {
      onApplyConfirmedName(correctedName)
      void saveNominalMemory("manual_override", { confirmedDisplayName: correctedName })
      setDismissed(true)
    }

    return (
      <div
        className="mt-2 rounded-lg border border-violet-200 bg-violet-50/80 dark:border-violet-800 dark:bg-violet-950/30 px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-2">
          <History className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)]">
              Ya habías corregido este nombre antes: <strong>{correctedName}</strong>
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-8"
                onClick={applyLastCorrection}
                disabled={loading}
              >
                <UserCheck className="h-3.5 w-3.5 mr-1" />
                Usar {correctedName}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={handleIgnore}>
                <X className="h-3.5 w-3.5 mr-1" />
                Ignorar
              </Button>
            </div>
            {memorySaveFailedHint ? (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                No se pudo guardar memoria histórica
              </p>
            ) : null}
            {fetchError ? (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{fetchError}</p>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (
    !manualIsOverride &&
    !isServerHistoricalAutofill &&
    (uxMode === "complete_name_preferred" || uxMode === "teacher_correction_conflict") &&
    top
  ) {
    const preferredComplete = memoryResolution?.preferred_complete_name
    const abbreviatedLast = memoryResolution?.last_correction_is_abbreviated === true
    const useCompletePreferred =
      uxMode === "complete_name_preferred" ||
      (abbreviatedLast && preferredComplete != null)
    const applyName = useCompletePreferred
      ? preferredComplete!.display_name
      : memoryResolution?.last_teacher_correction?.display_name ?? top.display_name
    const applyButtonLabel = useCompletePreferred
      ? `Completar como ${preferredComplete!.display_name}`
      : `Usar ${applyName}`
    return (
      <div
        className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <p className="text-[var(--text-secondary)]">
          OCR detectó <strong className="text-[var(--text-primary)]">{observed}</strong>
        </p>
        {conflictMessage ? (
          <p className="text-[var(--text-primary)] mt-1">
            <strong>{conflictMessage}</strong>
          </p>
        ) : null}
        {previousUsedLabel ? (
          <p className="text-[var(--text-muted)] text-xs mt-0.5">{previousUsedLabel}</p>
        ) : null}
        <div className="flex flex-wrap gap-2 mt-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-8"
            onClick={() => {
              onApplyConfirmedName(applyName)
              void saveNominalMemory(useCompletePreferred ? "manual_override" : "suggested_match", {
                confirmedDisplayName: applyName,
                studentProfileId: top.student_profile_id,
                catalogStudentId: top.catalog_student_id,
                matchScore: top.match_score,
              })
            }}
            disabled={loading}
          >
            <UserCheck className="h-3.5 w-3.5 mr-1" />
            {applyButtonLabel}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={handleIgnore}>
            <X className="h-3.5 w-3.5 mr-1" />
            Ignorar
          </Button>
        </div>
      </div>
    )
  }

  if (
    !manualIsOverride &&
    !isServerHistoricalAutofill &&
    uxMode === "other_course_suggestion" &&
    top &&
    otherCourseMemory
  ) {
    const otherName = otherCourseMemory.confirmed_name
    return (
      <div
        className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <p className="text-[var(--text-secondary)]">
          OCR detectó <strong className="text-[var(--text-primary)]">{observed}</strong>
        </p>
        <p className="text-[var(--text-primary)] mt-1">{otherCourseMemory.message}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-8"
            onClick={() => {
              onApplyConfirmedName(otherName)
              void saveNominalMemory("suggested_match", {
                confirmedDisplayName: otherName,
                studentProfileId: top.student_profile_id,
                catalogStudentId: top.catalog_student_id,
                matchScore: top.match_score,
              })
              setDismissed(true)
            }}
            disabled={loading}
          >
            <UserCheck className="h-3.5 w-3.5 mr-1" />
            Usar {otherName}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={handleIgnore}>
            <X className="h-3.5 w-3.5 mr-1" />
            Ignorar
          </Button>
        </div>
      </div>
    )
  }

  if (!manualIsOverride && !isServerHistoricalAutofill && uxMode === "historical_chip") {
    const label = autofillDisplayName ?? top?.display_name ?? manual
    const sameCourseCount = memoryResolution?.same_course_confirmation_count ?? 0
    const chipDetail =
      sameCourseCount > 0 ? ` (confirmado ${sameCourseCount}× en este curso)` : ""
    const labelNorm = label ? normalizeNominalName(label).normalized : ""
    return (
      <div
        className="mt-2 rounded-md border border-slate-200 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-900/40 px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-2">
          <History className="h-4 w-4 text-slate-600 shrink-0" aria-hidden />
          <span className="text-[var(--text-secondary)]">
            Autocompletado por memoria docente:{" "}
            <strong className="text-[var(--text-primary)]">{label}</strong>
            {chipDetail}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={handleRevertPrefill}
          >
            <Pencil className="h-3 w-3 mr-1" />
            cambiar
          </Button>
          {labelNorm && manualNorm !== labelNorm ? (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleConfirm}>
              <UserCheck className="h-3 w-3 mr-1" />
              Confirmar
            </Button>
          ) : null}
        </div>
        {conflictMessage ? (
          <p className="text-[11px] text-[var(--text-muted)] mt-1 pl-6">{conflictMessage}</p>
        ) : null}
        {previousUsedLabel ? (
          <p className="text-[11px] text-[var(--text-muted)] pl-6">{previousUsedLabel}</p>
        ) : null}
        {uxDecision.show_observed_ocr ? (
          <p className="text-[11px] text-[var(--text-muted)] mt-1 pl-6">
            OCR observado: {observed}
          </p>
        ) : null}
      </div>
    )
  }

  if (
    !manualIsOverride &&
    !isServerHistoricalAutofill &&
    hasReviewableSuggestion &&
    top &&
    uxMode !== "historical_autofill" &&
    uxMode !== "historical_chip"
  ) {
    const preferredComplete = memoryResolution?.preferred_complete_name
    const abbreviatedLast = memoryResolution?.last_correction_is_abbreviated === true
    const suggestComplete =
      abbreviatedLast &&
      preferredComplete != null &&
      topDisplayNorm === memoryResolution?.last_teacher_correction?.normalized
    const displayCandidate = suggestComplete
      ? preferredComplete.display_name
      : top.display_name
    const manualDiffersFromSuggestion =
      manualNorm.length > 0 && manualNorm !== normalizeNominalName(displayCandidate).normalized
    const applyLabel = suggestComplete
      ? `Completar como ${preferredComplete.display_name}`
      : `Usar ${top.display_name}`

    return (
      <div
        className="mt-2 rounded-lg border border-violet-200 bg-violet-50/80 dark:border-violet-800 dark:bg-violet-950/30 px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-2">
          {top.source === "historical_nominal_memory" ? (
            <History className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" aria-hidden />
          ) : (
            <HelpCircle className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" aria-hidden />
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-[var(--text-secondary)]">
              OCR detectó <strong className="text-[var(--text-primary)]">{observed}</strong>
              {manualDiffersFromSuggestion ? (
                <>
                  {" · "}
                  nombre en el campo: <strong className="text-[var(--text-primary)]">{manual}</strong>
                </>
              ) : null}
              {loading ? " — buscando coincidencias…" : null}
            </p>
            <p className="text-[var(--text-primary)]">
              {manualDiffersFromSuggestion ? (
                <>
                  sugerencia histórica <strong>{displayCandidate}</strong>
                </>
              ) : suggestComplete ? (
                <>
                  Memoria docente (nombre completo): <strong>{displayCandidate}</strong>
                </>
              ) : (
                suggestionHeadline
              )}
              {top.historical_confirmation_count && top.historical_confirmation_count > 0
                ? ` (confirmado antes ${top.historical_confirmation_count}×)`
                : null}
            </p>
            {confidenceLevel === "low" && showNominalDevPanel ? (
              <p className="text-[10px] text-violet-900/70 font-mono">
                confianza baja — revisión docente
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2 pl-6">
          <Button type="button" size="sm" variant="default" className="h-8" onClick={handleConfirm} disabled={loading}>
            <UserCheck className="h-3.5 w-3.5 mr-1" />
            {applyLabel}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={handleIgnore}>
            <X className="h-3.5 w-3.5 mr-1" />
            Ignorar
          </Button>
        </div>
        {fetchError ? <p className="mt-1 pl-6 text-xs text-amber-700 dark:text-amber-300">{fetchError}</p> : null}
        {showNominalDevPanel ? (
          <p className="mt-2 pl-6 text-[10px] text-violet-900/70 font-mono">
            {skippedReason ?? "reviewable_suggestion"} · ux={uxMode} · conf={confidenceLevel}
          </p>
        ) : null}
      </div>
    )
  }

  if (
    (uxMode === "detected_quiet" || manualMatchesObserved) &&
    uxMode !== "historical_autofill" &&
    uxMode !== "historical_chip"
  ) {
    return (
      <p
        className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Nombre detectado</span>
        {showNominalDevPanel ? (
          <span className="text-[10px] text-emerald-800/60 font-mono ml-1">[exact_match]</span>
        ) : null}
      </p>
    )
  }

  if (uxMode === "hidden" && !loading && !fetchError) {
    if (!top && observed.length > 0) {
      return (
        <p className="mt-1.5 text-xs text-[var(--text-muted)]" role="status">
          OCR: <span className="font-medium text-[var(--text-secondary)]">{observed}</span> — sin
          coincidencias en el roster. Puede editar el nombre arriba.
        </p>
      )
    }
    return null
  }

  if (!manualIsOverride && !isServerHistoricalAutofill && uxMode === "compact_suggest" && top) {
    return (
      <div
        className="mt-2 rounded-md border border-amber-200/80 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20 px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <p className="text-[var(--text-secondary)]">
          OCR: <strong>{observed}</strong>
          {loading ? " — buscando…" : null}
        </p>
        <p className="text-[var(--text-primary)] mt-0.5">
          Sugerencia: <strong>{top.display_name}</strong>
          {top.historical_confirmation_count && top.historical_confirmation_count > 0
            ? ` · confirmado ${top.historical_confirmation_count}×`
            : null}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Button type="button" size="sm" variant="default" className="h-8" onClick={handleConfirm} disabled={loading}>
            <UserCheck className="h-3.5 w-3.5 mr-1" />
            Confirmar
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={handleIgnore}>
            <X className="h-3.5 w-3.5 mr-1" />
            Ignorar
          </Button>
        </div>
      </div>
    )
  }

  const showSuggestionPrompt =
    Boolean(top) && !manualMatchesObserved && !manualIsOverride && !isServerHistoricalAutofill

  if (isServerHistoricalAutofill) return null

  return (
    <div
      className="mt-2 rounded-lg border border-violet-200 bg-violet-50/80 dark:border-violet-800 dark:bg-violet-950/30 px-3 py-2 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <HelpCircle className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[var(--text-secondary)]">
            OCR detectó: <strong className="text-[var(--text-primary)]">{observed}</strong>
            {loading ? " — buscando coincidencias…" : null}
          </p>
          {showSuggestionPrompt ? (
            <p className="text-[var(--text-primary)]">
              ¿Quizás: <strong>{top!.display_name}</strong>
              {top!.historical_confirmation_count && top!.historical_confirmation_count > 0
                ? ` (confirmado antes ${top!.historical_confirmation_count}×)`
                : null}
              ?
            </p>
          ) : fetchError ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">{fetchError}</p>
          ) : !loading && observed.length > 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              Sin coincidencias en el roster para este curso. Puede editar el nombre manualmente.
            </p>
          ) : null}
        </div>
      </div>
      {showSuggestionPrompt ? (
        <div className="flex flex-wrap gap-2 mt-2 pl-6">
          <Button type="button" size="sm" variant="default" className="h-8" onClick={handleConfirm} disabled={loading}>
            <UserCheck className="h-3.5 w-3.5 mr-1" />
            Confirmar
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={handleIgnore}>
            <X className="h-3.5 w-3.5 mr-1" />
            Ignorar
          </Button>
        </div>
      ) : null}
      {showNominalDevPanel ? (
        <p className="mt-2 pl-6 text-[10px] text-violet-900/70 font-mono">
          {skippedReason ?? "nominal_suggest"}
        </p>
      ) : null}
    </div>
  )
}

/** Persistencia al blur del input o antes de evaluar (desde EvaluatorClient). */
export async function flushNominalMemoryForGroup(params: {
  observedNameRaw: string | null | undefined
  manualName: string
  evaluationId?: string | null
  courseLabel?: string | null
}): Promise<void> {
  const observed = params.observedNameRaw != null ? String(params.observedNameRaw).trim() : ""
  const manual = String(params.manualName ?? "").trim()
  console.log("[flushNominalMemoryForGroup]", {
    observedNameRaw: observed || null,
    confirmedDisplayName: manual || null,
    courseLabel: params.courseLabel ?? null,
    evaluationId: params.evaluationId ?? null,
  })
  if (!observed) {
    console.warn("falta observedNameRaw")
    return
  }
  if (!manual) {
    console.warn("falta confirmedDisplayName")
    return
  }
  const type = deriveNominalConfirmationType(observed, manual)
  if (!type || type === "ignored") {
    console.warn("[flushNominalMemoryForGroup] sin tipo de confirmación", { type })
    return
  }
  await persistTeacherNominalMemory({
    observedNameRaw: observed,
    confirmedDisplayName: manual,
    evaluationId: params.evaluationId ?? null,
    courseLabel: params.courseLabel ?? null,
    confirmationType: type,
    source: "manual_name_field_or_evaluation_flow",
  })
}
