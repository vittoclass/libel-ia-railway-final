/**
 * physical-answer-final-guard.ts
 *
 * Etapa final del pipeline interleaved: garantiza que la respuesta de cada fila
 * cerrada provenga exclusivamente de evidencia física directa de esa misma fila.
 * Previene falsos BLANK verificando campos directos Y campos dentro de
 * interleavedColumnGeometryDiagnostic.
 *
 * Reversible:
 *   INTERLEAVED_PHYSICAL_ANSWER_FINAL_GUARD=0  desactiva guard completo
 *   INTERLEAVED_PHYSICAL_EVIDENCE_GUARD=0      desactiva solo detección ampliada
 */
import {
  isInterleavedPhysicalAnswerFinalGuardEnabled,
  isInterleavedPhysicalEvidenceGuardEnabled,
} from "./env"

// ── Tipos de telemetría ──

export type PhysicalAnswerFinalGuardRowTelemetry = {
  questionNumber: number
  canonicalId: string | null
  physicalIndex: number | null
  hasDirectPhysicalEvidence: boolean
  nearestColumnLetterByX: string | null
  assignedDetectionIndicesFinal: number[]
  selectedAnswerBeforePhysicalGuard: string
  selectedAnswerAfterPhysicalGuard: string
  decisionSourceBeforePhysicalGuard: string | null
  decisionSourceAfterPhysicalGuard: string
  bridgeSuggestedAnswer: string | null
  bridgeSuppressedByPhysicalGuard: boolean
  physicalAnswerFinalGuardApplied: boolean
  physicalAnswerFinalGuardReason: string
  physicalEvidenceGuardApplied: boolean
  physicalEvidenceGuardPassed: boolean
  physicalEvidenceReasons: string[]
  physicalEvidenceLetter: string | null
  blankSuppressionPrevented: boolean
  falseBlankPrevented: boolean
}

export type PhysicalAnswerFinalGuardTelemetry = {
  physicalAnswerFinalGuardEnabled: boolean
  physicalAnswerFinalGuardApplied: boolean
  physicalAnswerFinalGuardRowsProcessed: number
  physicalAnswerFinalGuardRowsCorrected: number
  physicalAnswerFinalGuardRowsBlanked: number
  physicalAnswerFinalGuardRowsUnchanged: number
  physicalAnswerFinalGuardFalseBlanksPrevented: number
  physicalAnswerFinalGuardRowTelemetry: PhysicalAnswerFinalGuardRowTelemetry[]
}

// ── Helpers internos ──

const LETTER_RE = /^[A-Z]$/

function isLetter(v: unknown): v is string {
  return typeof v === "string" && LETTER_RE.test(v)
}

function extractDecisionSource(row: Record<string, unknown>): string | null {
  const amb = row.interleavedAmbiguityTelemetry
  if (amb && typeof amb === "object") {
    const ds = (amb as Record<string, unknown>).decisionSource
    if (typeof ds === "string") return ds
  }
  return null
}

function extractBridgeSuggestedAnswer(row: Record<string, unknown>): string | null {
  const amb = row.interleavedAmbiguityTelemetry
  if (amb && typeof amb === "object") {
    const a = amb as Record<string, unknown>
    const candidate = a.bridgeCandidateAnswer ?? a.bridgeSuggestedAnswer
    if (isLetter(candidate)) return candidate
  }
  return null
}

function getGeoDiag(row: Record<string, unknown>): Record<string, unknown> | null {
  const d = row.interleavedColumnGeometryDiagnostic
  if (d && typeof d === "object") return d as Record<string, unknown>
  return null
}

// ── CORE: hasStrongPhysicalEvidence ──

export function hasStrongPhysicalEvidence(row: Record<string, unknown>): {
  ok: boolean
  reasons: string[]
  physicalLetter: string | null
} {
  const reasons: string[] = []
  let physicalLetter: string | null = null

  const indices = Array.isArray(row.assignedDetectionIndices)
    ? (row.assignedDetectionIndices as unknown[]).filter(
        (x): x is number => typeof x === "number" && Number.isFinite(x),
      )
    : []

  if (indices.length > 0) {
    reasons.push(`assignedDetectionIndices=[${indices.join(",")}]`)
  }

  const markX = row.selectedMarkX
  const markY = row.selectedMarkY
  if (
    typeof markX === "number" && Number.isFinite(markX) &&
    typeof markY === "number" && Number.isFinite(markY)
  ) {
    reasons.push(`selectedMark=(${markX.toFixed(4)},${markY.toFixed(4)})`)
  }

  if (isLetter(row.nearestColumnLetterByX)) {
    reasons.push(`nearestColumnLetterByX=${row.nearestColumnLetterByX}`)
    if (!physicalLetter) physicalLetter = row.nearestColumnLetterByX
  }

  if (row.selectedAnswerMatchesNearestColumn === true) {
    reasons.push("selectedAnswerMatchesNearestColumn=true")
  }

  const geo = getGeoDiag(row)
  if (geo) {
    if (isLetter(geo.nearestColumnLetterByX)) {
      reasons.push(`geo.nearestColumnLetterByX=${geo.nearestColumnLetterByX}`)
      if (!physicalLetter) physicalLetter = geo.nearestColumnLetterByX
    }
    if (isLetter(geo.selectedAnswer)) {
      reasons.push(`geo.selectedAnswer=${geo.selectedAnswer}`)
      if (!physicalLetter) physicalLetter = geo.selectedAnswer
    }
    if (geo.selectedAnswerMatchesNearestColumn === true) {
      reasons.push("geo.selectedAnswerMatchesNearestColumn=true")
    }
  }

  if (!physicalLetter && indices.length > 0) {
    const sel = String(row.selectedAnswer ?? "").trim().toUpperCase()
    if (isLetter(sel)) {
      physicalLetter = sel
      reasons.push(`selectedAnswer=${sel}_with_detections`)
    }
  }

  return {
    ok: reasons.length > 0,
    reasons,
    physicalLetter,
  }
}

// ── Resolución de letra física con prioridad definida ──

function resolvePhysicalLetter(row: Record<string, unknown>): string | null {
  if (isLetter(row.nearestColumnLetterByX)) return row.nearestColumnLetterByX

  const geo = getGeoDiag(row)
  if (geo) {
    if (isLetter(geo.nearestColumnLetterByX)) return geo.nearestColumnLetterByX
    if (isLetter(geo.selectedAnswer)) return geo.selectedAnswer
  }

  const indices = Array.isArray(row.assignedDetectionIndices)
    ? (row.assignedDetectionIndices as unknown[]).filter(
        (x): x is number => typeof x === "number",
      )
    : []
  const sel = String(row.selectedAnswer ?? "").trim().toUpperCase()
  if (indices.length > 0 && isLetter(sel)) return sel

  return null
}

// ── Función principal ──

export function applyPhysicalAnswerFinalGuard(params: {
  perQuestion: Array<Record<string, unknown>>
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: PhysicalAnswerFinalGuardTelemetry
} {
  const emptyTelemetry: PhysicalAnswerFinalGuardTelemetry = {
    physicalAnswerFinalGuardEnabled: false,
    physicalAnswerFinalGuardApplied: false,
    physicalAnswerFinalGuardRowsProcessed: 0,
    physicalAnswerFinalGuardRowsCorrected: 0,
    physicalAnswerFinalGuardRowsBlanked: 0,
    physicalAnswerFinalGuardRowsUnchanged: 0,
    physicalAnswerFinalGuardFalseBlanksPrevented: 0,
    physicalAnswerFinalGuardRowTelemetry: [],
  }

  if (!isInterleavedPhysicalAnswerFinalGuardEnabled()) {
    return { perQuestion: params.perQuestion, telemetry: emptyTelemetry }
  }

  const evidenceGuardEnabled = isInterleavedPhysicalEvidenceGuardEnabled()
  const { perQuestion } = params
  const rowTelemetry: PhysicalAnswerFinalGuardRowTelemetry[] = []
  let corrected = 0
  let blanked = 0
  let unchanged = 0
  let falseBlanksPrevented = 0

  const result = perQuestion.map((row) => {
    const qn = Number(row.questionNumber ?? 0)
    const canonicalId = typeof row.canonicalId === "string" ? row.canonicalId : null
    const physicalIndex = typeof row.physicalIndex === "number" ? row.physicalIndex : null
    const selectedBefore = String(row.selectedAnswer ?? "").trim().toUpperCase()
    const decisionSourceBefore = extractDecisionSource(row)
    const bridgeSuggested = extractBridgeSuggestedAnswer(row)

    const indices = Array.isArray(row.assignedDetectionIndices)
      ? (row.assignedDetectionIndices as unknown[]).filter(
          (x): x is number => typeof x === "number" && Number.isFinite(x),
        )
      : []

    const evidence = hasStrongPhysicalEvidence(row)
    const physicalLetter = evidence.physicalLetter ?? resolvePhysicalLetter(row)

    const isBlankLike =
      selectedBefore === "" ||
      selectedBefore === "BLANK" ||
      selectedBefore === "SIN_RESPUESTA"

    const isInferredBlank = row.inferredBlank === true || row.completedByExpectation === true

    // ── Filas sintéticas de padding: no tocar ──
    if (isInferredBlank && isBlankLike && !evidence.ok) {
      const tel: PhysicalAnswerFinalGuardRowTelemetry = {
        questionNumber: qn,
        canonicalId,
        physicalIndex,
        hasDirectPhysicalEvidence: false,
        nearestColumnLetterByX: typeof row.nearestColumnLetterByX === "string" ? row.nearestColumnLetterByX : null,
        assignedDetectionIndicesFinal: indices as number[],
        selectedAnswerBeforePhysicalGuard: selectedBefore,
        selectedAnswerAfterPhysicalGuard: "BLANK",
        decisionSourceBeforePhysicalGuard: decisionSourceBefore,
        decisionSourceAfterPhysicalGuard: "blank_no_physical_evidence",
        bridgeSuggestedAnswer: bridgeSuggested,
        bridgeSuppressedByPhysicalGuard: false,
        physicalAnswerFinalGuardApplied: false,
        physicalAnswerFinalGuardReason: "inferred_blank_passthrough",
        physicalEvidenceGuardApplied: false,
        physicalEvidenceGuardPassed: false,
        physicalEvidenceReasons: [],
        physicalEvidenceLetter: null,
        blankSuppressionPrevented: false,
        falseBlankPrevented: false,
      }
      rowTelemetry.push(tel)
      unchanged++
      return row
    }

    // ── CASO 1: Hay evidencia física → respuesta debe ser física, NO BLANK ──
    if (evidence.ok && physicalLetter) {
      const answerChanged = selectedBefore !== physicalLetter
      const wasFalseBlank = isBlankLike && answerChanged
      const bridgeSuppressed =
        bridgeSuggested != null &&
        bridgeSuggested !== physicalLetter &&
        decisionSourceBefore != null &&
        (decisionSourceBefore.includes("bridge") ||
          decisionSourceBefore.includes("azure_layout_family"))

      let reason: string
      if (wasFalseBlank) {
        reason = `false_blank_corrected_to_${physicalLetter}`
      } else if (answerChanged) {
        reason = `physical_override_from_${selectedBefore}_to_${physicalLetter}`
      } else if (bridgeSuppressed) {
        reason = "physical_confirmed_bridge_suppressed"
      } else {
        reason = "physical_matches_current"
      }

      if (wasFalseBlank) falseBlanksPrevented++

      const tel: PhysicalAnswerFinalGuardRowTelemetry = {
        questionNumber: qn,
        canonicalId,
        physicalIndex,
        hasDirectPhysicalEvidence: true,
        nearestColumnLetterByX: typeof row.nearestColumnLetterByX === "string" ? row.nearestColumnLetterByX : null,
        assignedDetectionIndicesFinal: indices as number[],
        selectedAnswerBeforePhysicalGuard: selectedBefore,
        selectedAnswerAfterPhysicalGuard: physicalLetter,
        decisionSourceBeforePhysicalGuard: decisionSourceBefore,
        decisionSourceAfterPhysicalGuard: "physical_final_guard",
        bridgeSuggestedAnswer: bridgeSuggested,
        bridgeSuppressedByPhysicalGuard: bridgeSuppressed,
        physicalAnswerFinalGuardApplied: answerChanged || bridgeSuppressed,
        physicalAnswerFinalGuardReason: reason,
        physicalEvidenceGuardApplied: evidenceGuardEnabled,
        physicalEvidenceGuardPassed: true,
        physicalEvidenceReasons: evidence.reasons,
        physicalEvidenceLetter: physicalLetter,
        blankSuppressionPrevented: wasFalseBlank,
        falseBlankPrevented: wasFalseBlank,
      }
      rowTelemetry.push(tel)

      if (answerChanged) corrected++
      else unchanged++

      const baseTelemetry =
        (row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}

      return {
        ...row,
        selectedAnswer: physicalLetter,
        interleavedReviewRecommended: false,
        interleavedAmbiguityTelemetry: {
          ...baseTelemetry,
          decisionSource: "physical_final_guard",
          ...(bridgeSuppressed
            ? {
                bridgeSuggestedAnswer: bridgeSuggested,
                bridgeSuppressedByPhysicalGuard: true,
              }
            : {}),
        },
        ...(wasFalseBlank ? { physicalEvidenceFalseBlankPrevented: true } : {}),
      }
    }

    // ── CASO 2: Evidencia ok pero sin letra resoluble → mantener respuesta si era letra válida ──
    if (evidence.ok && !physicalLetter && !isBlankLike && isLetter(selectedBefore)) {
      const tel: PhysicalAnswerFinalGuardRowTelemetry = {
        questionNumber: qn,
        canonicalId,
        physicalIndex,
        hasDirectPhysicalEvidence: true,
        nearestColumnLetterByX: typeof row.nearestColumnLetterByX === "string" ? row.nearestColumnLetterByX : null,
        assignedDetectionIndicesFinal: indices as number[],
        selectedAnswerBeforePhysicalGuard: selectedBefore,
        selectedAnswerAfterPhysicalGuard: selectedBefore,
        decisionSourceBeforePhysicalGuard: decisionSourceBefore,
        decisionSourceAfterPhysicalGuard: "physical_final_guard",
        bridgeSuggestedAnswer: bridgeSuggested,
        bridgeSuppressedByPhysicalGuard: false,
        physicalAnswerFinalGuardApplied: false,
        physicalAnswerFinalGuardReason: "evidence_ok_no_letter_resolved_keep_current",
        physicalEvidenceGuardApplied: evidenceGuardEnabled,
        physicalEvidenceGuardPassed: true,
        physicalEvidenceReasons: evidence.reasons,
        physicalEvidenceLetter: null,
        blankSuppressionPrevented: false,
        falseBlankPrevented: false,
      }
      rowTelemetry.push(tel)
      unchanged++

      const baseTelemetry =
        (row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}

      return {
        ...row,
        interleavedAmbiguityTelemetry: {
          ...baseTelemetry,
          decisionSource: "physical_final_guard",
        },
      }
    }

    // ── CASO 3: Sin evidencia física y respuesta no blank → forzar BLANK ──
    if (!evidence.ok && !isBlankLike) {
      const bridgeSuppressed = bridgeSuggested != null || (
        decisionSourceBefore != null &&
        (decisionSourceBefore.includes("bridge") ||
          decisionSourceBefore.includes("azure_layout_family"))
      )

      const tel: PhysicalAnswerFinalGuardRowTelemetry = {
        questionNumber: qn,
        canonicalId,
        physicalIndex,
        hasDirectPhysicalEvidence: false,
        nearestColumnLetterByX: typeof row.nearestColumnLetterByX === "string" ? row.nearestColumnLetterByX : null,
        assignedDetectionIndicesFinal: indices as number[],
        selectedAnswerBeforePhysicalGuard: selectedBefore,
        selectedAnswerAfterPhysicalGuard: "BLANK",
        decisionSourceBeforePhysicalGuard: decisionSourceBefore,
        decisionSourceAfterPhysicalGuard: "blank_no_physical_evidence",
        bridgeSuggestedAnswer: bridgeSuggested ?? selectedBefore,
        bridgeSuppressedByPhysicalGuard: bridgeSuppressed,
        physicalAnswerFinalGuardApplied: true,
        physicalAnswerFinalGuardReason: `forced_blank_no_physical_evidence_was_${selectedBefore}`,
        physicalEvidenceGuardApplied: evidenceGuardEnabled,
        physicalEvidenceGuardPassed: false,
        physicalEvidenceReasons: [],
        physicalEvidenceLetter: null,
        blankSuppressionPrevented: false,
        falseBlankPrevented: false,
      }
      rowTelemetry.push(tel)
      blanked++

      const baseTelemetry =
        (row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}

      return {
        ...row,
        selectedAnswer: "BLANK",
        interleavedReviewRecommended: true,
        interleavedAmbiguityTelemetry: {
          ...baseTelemetry,
          decisionSource: "blank_no_physical_evidence",
          bridgeSuggestedAnswer: bridgeSuggested ?? selectedBefore,
          bridgeSuppressedByPhysicalGuard: true,
        },
      }
    }

    // ── CASO 4: Ya es blank y sin evidencia → pasar sin cambio ──
    const tel: PhysicalAnswerFinalGuardRowTelemetry = {
      questionNumber: qn,
      canonicalId,
      physicalIndex,
      hasDirectPhysicalEvidence: evidence.ok,
      nearestColumnLetterByX: typeof row.nearestColumnLetterByX === "string" ? row.nearestColumnLetterByX : null,
      assignedDetectionIndicesFinal: indices as number[],
      selectedAnswerBeforePhysicalGuard: selectedBefore,
      selectedAnswerAfterPhysicalGuard: selectedBefore,
      decisionSourceBeforePhysicalGuard: decisionSourceBefore,
      decisionSourceAfterPhysicalGuard: decisionSourceBefore ?? "unchanged",
      bridgeSuggestedAnswer: bridgeSuggested,
      bridgeSuppressedByPhysicalGuard: false,
      physicalAnswerFinalGuardApplied: false,
      physicalAnswerFinalGuardReason: "already_blank_no_evidence",
      physicalEvidenceGuardApplied: evidenceGuardEnabled,
      physicalEvidenceGuardPassed: evidence.ok,
      physicalEvidenceReasons: evidence.reasons,
      physicalEvidenceLetter: evidence.physicalLetter,
      blankSuppressionPrevented: false,
      falseBlankPrevented: false,
    }
    rowTelemetry.push(tel)
    unchanged++
    return row
  })

  // ── Validación defensiva post-guard: prevenir falsos BLANK residuales ──
  if (evidenceGuardEnabled) {
    for (let i = 0; i < result.length; i++) {
      const row = result[i]!
      const sel = String(row.selectedAnswer ?? "").trim().toUpperCase()
      if (sel !== "BLANK" && sel !== "" && sel !== "SIN_RESPUESTA") continue

      const ev = hasStrongPhysicalEvidence(row)
      if (!ev.ok) continue

      const letter = ev.physicalLetter ?? resolvePhysicalLetter(row)
      if (!letter) continue

      falseBlanksPrevented++
      corrected++
      unchanged = Math.max(0, unchanged - 1)

      const baseTelemetry =
        (row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}

      result[i] = {
        ...row,
        selectedAnswer: letter,
        interleavedReviewRecommended: false,
        interleavedAmbiguityTelemetry: {
          ...baseTelemetry,
          decisionSource: "physical_evidence_guard_corrected_false_blank",
        },
        physicalEvidenceFalseBlankPrevented: true,
      }

      const existing = rowTelemetry.find(
        (t) => t.questionNumber === Number(row.questionNumber ?? 0),
      )
      if (existing) {
        existing.selectedAnswerAfterPhysicalGuard = letter
        existing.decisionSourceAfterPhysicalGuard = "physical_evidence_guard_corrected_false_blank"
        existing.falseBlankPrevented = true
        existing.blankSuppressionPrevented = true
        existing.physicalEvidenceLetter = letter
        existing.physicalEvidenceReasons = ev.reasons
        existing.physicalEvidenceGuardPassed = true
        existing.hasDirectPhysicalEvidence = true
        existing.physicalAnswerFinalGuardApplied = true
        existing.physicalAnswerFinalGuardReason = `defensive_false_blank_corrected_to_${letter}`
      }
    }
  }

  const applied = corrected > 0 || blanked > 0

  return {
    perQuestion: result,
    telemetry: {
      physicalAnswerFinalGuardEnabled: true,
      physicalAnswerFinalGuardApplied: applied,
      physicalAnswerFinalGuardRowsProcessed: perQuestion.length,
      physicalAnswerFinalGuardRowsCorrected: corrected,
      physicalAnswerFinalGuardRowsBlanked: blanked,
      physicalAnswerFinalGuardRowsUnchanged: unchanged,
      physicalAnswerFinalGuardFalseBlanksPrevented: falseBlanksPrevented,
      physicalAnswerFinalGuardRowTelemetry: rowTelemetry,
    },
  }
}
