/**
 * Auditoría focal C30/C31 para el recovery final por evidencia física.
 * Reversible: INTERLEAVED_C30_C31_AUDIT=0 (defecto). Solo lectura + JSON de salida.
 */
import { normalizeToCanonicalId } from "../canonical-closed-id"
import { getInterleavedFinalBlankRecoveryMinConfidence } from "./env"

const LETTER_RE = /^[A-D]$/
const TARGETS = ["C30", "C31"] as const

function readDiag(row: Record<string, unknown>): Record<string, unknown> | null {
  const d = row.interleavedColumnGeometryDiagnostic
  if (d && typeof d === "object") return d as Record<string, unknown>
  return null
}

/** Filas de `interleavedColumnGeometryTelemetryRows` (planas), no confundir con toda la fila OMR. */
function isFlatColumnGeometryTelemetryRow(row: Record<string, unknown>): boolean {
  return typeof row.geometrySource === "string" || typeof row.decisionSource === "string"
}

/** Diagnóstico anidado por fila, o telemetría plana de geometría de columna. */
function effectiveGeometryRecord(row: Record<string, unknown>): Record<string, unknown> | null {
  const nested = readDiag(row)
  if (nested) return nested
  if (isFlatColumnGeometryTelemetryRow(row)) return row
  return null
}

function normIndices(arr: unknown): number[] {
  if (!Array.isArray(arr)) return []
  return arr
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    .map((n) => Math.trunc(n))
    .sort((a, b) => a - b)
}

function indicesKey(indices: number[]): string {
  return indices.join(",")
}

function isBlankAnswer(row: Record<string, unknown>): boolean {
  const s = String(row.selectedAnswer ?? "").trim().toUpperCase()
  return s === "" || s === "BLANK" || s === "SIN_RESPUESTA"
}

function letterConfidence(row: Record<string, unknown>, letter: string): number {
  const c = row.confidencesByColumn
  if (!c || typeof c !== "object") return -1
  const v = (c as Record<string, unknown>)[letter]
  return typeof v === "number" && Number.isFinite(v) ? v : -1
}

function slotMatchesBlank(blank: Record<string, unknown>, diag: Record<string, unknown>): boolean {
  const blankCanon = normalizeToCanonicalId(blank.canonicalId)
  const diagCanon = normalizeToCanonicalId(diag.canonicalId)
  const physB =
    typeof blank.physicalIndex === "number" && Number.isFinite(blank.physicalIndex)
      ? blank.physicalIndex
      : 0
  const physD =
    typeof diag.physicalIndex === "number" && Number.isFinite(diag.physicalIndex)
      ? diag.physicalIndex
      : 0
  if (blankCanon && diagCanon && blankCanon === diagCanon) return true
  if (physB > 0 && physD > 0 && physB === physD) return true
  return false
}

function carrierCoherentWithDiagnostic(
  carrierRow: Record<string, unknown>,
  diag: Record<string, unknown>,
  isSelf: boolean,
): boolean {
  if (isSelf) return true
  const dc = normalizeToCanonicalId(diag.canonicalId)
  if (!dc) return false
  const kc = normalizeToCanonicalId(carrierRow.canonicalId)
  return kc !== null && kc === dc
}

function resolveSourceRowIndexForGeometrySnapshot(
  out: Array<Record<string, unknown>>,
  blankIndex: number,
  snap: Record<string, unknown>,
): number {
  const phys =
    typeof snap.physicalIndex === "number" && Number.isFinite(snap.physicalIndex) ? snap.physicalIndex : -1
  const panel = Number(snap.panelIndex ?? 0) === 1 ? 1 : 0
  const hits: number[] = []
  for (let k = 0; k < out.length; k++) {
    const row = out[k]!
    const physK =
      typeof row.physicalIndex === "number" && Number.isFinite(row.physicalIndex) ? row.physicalIndex : -1
    const panelK = Number(row.panelIndex ?? 0) === 1 ? 1 : 0
    if (phys > 0 && physK === phys && panelK === panel) hits.push(k)
  }
  if (hits.includes(blankIndex)) return blankIndex
  if (hits.length === 1) return hits[0]!
  if (hits.length > 1) return hits.sort((a, b) => a - b)[0]!
  return blankIndex
}

function dumpRowFields(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null
  const diag = readDiag(row)
  return {
    canonicalId: row.canonicalId ?? null,
    questionNumber: row.questionNumber ?? null,
    physicalIndex: row.physicalIndex ?? null,
    selectedAnswer: row.selectedAnswer ?? null,
    assignedDetectionIndices: Array.isArray(row.assignedDetectionIndices) ? [...row.assignedDetectionIndices] : [],
    physicalNumberPreservedPaddedBlank: row.physicalNumberPreservedPaddedBlank === true,
    descriptorPhysicalMappingApplied: row.descriptorPhysicalMappingApplied === true,
    closedInventoryMapped: row.closedInventoryMapped === true,
    interleavedColumnGeometryDiagnostic: diag,
  }
}

function diagEvidenceSnippet(d: Record<string, unknown>): Record<string, unknown> {
  return {
    canonicalId: d.canonicalId ?? null,
    physicalIndex: d.physicalIndex ?? null,
    selectedAnswer: d.selectedAnswer ?? null,
    assignedDetectionIndices: normIndices(d.assignedDetectionIndices),
    nearestColumnLetterByX: d.nearestColumnLetterByX ?? null,
    selectedMarkX: d.selectedMarkX ?? null,
    selectedMarkY: d.selectedMarkY ?? null,
    panelIndex: d.panelIndex ?? null,
    rowIndexWithinPanel: d.rowIndexWithinPanel ?? null,
  }
}

function slotMismatchDetail(blank: Record<string, unknown>, diag: Record<string, unknown>): Record<string, unknown> {
  const blankCanon = normalizeToCanonicalId(blank.canonicalId)
  const diagCanon = normalizeToCanonicalId(diag.canonicalId)
  const physB =
    typeof blank.physicalIndex === "number" && Number.isFinite(blank.physicalIndex)
      ? Math.trunc(blank.physicalIndex as number)
      : null
  const physD =
    typeof diag.physicalIndex === "number" && Number.isFinite(diag.physicalIndex)
      ? Math.trunc(diag.physicalIndex as number)
      : null
  const canonMatch = !!(blankCanon && diagCanon && blankCanon === diagCanon)
  const physMatch = !!(physB != null && physD != null && physB > 0 && physD > 0 && physB === physD)
  let mismatchKind = "canonical_and_physical_mismatch"
  if (!canonMatch && blankCanon && diagCanon) mismatchKind = "canonical_mismatch"
  else if (!physMatch && physB != null && physD != null && physB > 0 && physD > 0) mismatchKind = "physical_index_mismatch"
  return {
    mismatchKind,
    canonicalMatch: canonMatch,
    physicalMatch: physMatch,
    blankCanonical: blankCanon,
    blankPhysical: physB,
    diagCanonical: diagCanon,
    diagPhysical: physD,
    diagSnippet: diagEvidenceSnippet(diag),
  }
}

function rawRowMatchesTarget(snap: Record<string, unknown>, targetCanon: string, targetPhys: number): boolean {
  const sc = normalizeToCanonicalId(snap.canonicalId)
  const sp =
    typeof snap.physicalIndex === "number" && Number.isFinite(snap.physicalIndex)
      ? Math.trunc(snap.physicalIndex)
      : -1
  if (sc === targetCanon) return true
  if (sp === targetPhys) return true
  const s = JSON.stringify(snap)
  if (s.includes(targetCanon)) return true
  if (targetPhys >= 0 && s.includes(`"physicalIndex":${targetPhys}`)) return true
  if (targetPhys >= 0 && s.includes(`"physicalIndex": ${targetPhys}`)) return true
  return false
}

export type C30C31AuditSlot = {
  finalRow: Record<string, unknown> | null
  priorPhysicalEvidenceRows: Array<Record<string, unknown>>
  recoveryCandidates: {
    finalBlankRecoveryEnabled: boolean
    candidateCountBeforeDedup: number
    candidatesDeduped: Array<Record<string, unknown>>
    carrierAndRawTraces: Array<Record<string, unknown>>
    usedDetectionIndicesBeforeRecovery: number[]
    finalDecision: Record<string, unknown>
    exactReasonWhyStillBlank: string | null
  }
  usedDetectionIndicesBeforeRecovery: number[]
  rawGeometryMatches: {
    byTargetMatch: Array<Record<string, unknown>>
    rightPanelLastRows: Array<Record<string, unknown>>
  }
  finalDecision: Record<string, unknown>
  exactReasonWhyStillBlank: string | null
}

export function buildInterleavedC30C31Audit(params: {
  perQuestionBeforeRecovery: Array<Record<string, unknown>>
  perQuestionAfterRecovery: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  rawInterleavedGeometryRows?: ReadonlyArray<Record<string, unknown>>
  finalBlankRecoveryEnabled: boolean
}): { c30: C30C31AuditSlot; c31: C30C31AuditSlot } {
  // [TEMP_C30_C31_AUDIT_DIAG] Confirma que el audit realmente entra al pipeline.
  console.log("[C30_AUDIT_BUILD_INVOKED]", {
    rawEnv: process.env.INTERLEAVED_C30_C31_AUDIT ?? null,
    beforeCount: Array.isArray(params.perQuestionBeforeRecovery) ? params.perQuestionBeforeRecovery.length : -1,
    afterCount: Array.isArray(params.perQuestionAfterRecovery) ? params.perQuestionAfterRecovery.length : -1,
    closedCount: Array.isArray(params.closedQuestionIds) ? params.closedQuestionIds.length : -1,
    rawGeometryRowsCount: Array.isArray(params.rawInterleavedGeometryRows)
      ? params.rawInterleavedGeometryRows.length
      : -1,
    finalBlankRecoveryEnabled: params.finalBlankRecoveryEnabled,
  })
  const minConf = getInterleavedFinalBlankRecoveryMinConfidence()
  const closedNorm = new Set<string>()
  for (const id of params.closedQuestionIds) {
    const n = normalizeToCanonicalId(id)
    if (n) closedNorm.add(n)
  }

  const usedDetectionIndicesBeforeRecovery: number[] = []
  const usedSet = new Set<number>()
  for (const r of params.perQuestionBeforeRecovery) {
    if (isBlankAnswer(r)) continue
    const idx = Array.isArray(r.assignedDetectionIndices)
      ? (r.assignedDetectionIndices as unknown[]).filter(
          (x): x is number => typeof x === "number" && Number.isFinite(x),
        )
      : []
    for (const d of idx) {
      if (!usedSet.has(d)) {
        usedSet.add(d)
        usedDetectionIndicesBeforeRecovery.push(d)
      }
    }
  }
  usedDetectionIndicesBeforeRecovery.sort((a, b) => a - b)

  const rawRows = params.rawInterleavedGeometryRows ?? []
  const maxRowRightPanel = (() => {
    let m = -1
    for (const snap of rawRows) {
      const o = snap as Record<string, unknown>
      if (Number(o.panelIndex ?? 0) !== 1) continue
      const ri = Number(o.rowIndexWithinPanel ?? -1)
      if (Number.isFinite(ri) && ri > m) m = ri
    }
    return m
  })()

  const auditBundle: { c30: C30C31AuditSlot; c31: C30C31AuditSlot } = {} as {
    c30: C30C31AuditSlot
    c31: C30C31AuditSlot
  }

  for (const targetCanon of TARGETS) {
    const targetPhys = Number(targetCanon.replace(/^C/i, "")) || 0
    const blankTemplate: Record<string, unknown> = {
      canonicalId: targetCanon,
      physicalIndex: targetPhys,
    }

    const priorPhysicalEvidenceRows: Array<Record<string, unknown>> = []

    const scanRow = (row: Record<string, unknown>, rowIndex: number, source: string) => {
      const geom = effectiveGeometryRecord(row)
      const rowLetter = String(row.selectedAnswer ?? "").trim().toUpperCase()
      const rowIdx = normIndices(row.assignedDetectionIndices)
      const diagLetter = geom ? String(geom.selectedAnswer ?? "").trim().toUpperCase() : ""
      const diagIdx = geom ? normIndices(geom.assignedDetectionIndices) : []

      const tiesToSlot =
        (geom && slotMatchesBlank(blankTemplate, geom)) ||
        normalizeToCanonicalId(row.canonicalId) === targetCanon ||
        (typeof row.physicalIndex === "number" && Math.trunc(row.physicalIndex) === targetPhys)

      const hasRowEvidence = LETTER_RE.test(rowLetter) && rowIdx.length > 0
      const hasDiagEvidence = geom != null && LETTER_RE.test(diagLetter) && diagIdx.length > 0
      const hasPartialDiag =
        geom != null &&
        (LETTER_RE.test(diagLetter) ||
          diagIdx.length > 0 ||
          (geom.nearestColumnLetterByX != null && String(geom.nearestColumnLetterByX).trim() !== ""))

      if (tiesToSlot && (hasRowEvidence || hasDiagEvidence || hasPartialDiag)) {
        priorPhysicalEvidenceRows.push({
          source,
          rowIndex,
          row: {
            canonicalId: row.canonicalId ?? null,
            questionNumber: row.questionNumber ?? null,
            physicalIndex: row.physicalIndex ?? null,
            selectedAnswer: row.selectedAnswer ?? null,
            assignedDetectionIndices: rowIdx,
          },
          diagnostic: geom ? diagEvidenceSnippet(geom) : null,
        })
      }

      if (geom && slotMatchesBlank(blankTemplate, geom)) {
        if (LETTER_RE.test(diagLetter) || diagIdx.length > 0) {
          const already = priorPhysicalEvidenceRows.some(
            (p) => p.rowIndex === rowIndex && p.source === `${source}_diag_slot`,
          )
          if (!already) {
            priorPhysicalEvidenceRows.push({
              source: `${source}_diag_slot`,
              rowIndex,
              row: {
                canonicalId: row.canonicalId ?? null,
                questionNumber: row.questionNumber ?? null,
                physicalIndex: row.physicalIndex ?? null,
                selectedAnswer: row.selectedAnswer ?? null,
                assignedDetectionIndices: rowIdx,
              },
              diagnostic: diagEvidenceSnippet(geom),
            })
          }
        }
      }
    }

    for (let i = 0; i < params.perQuestionBeforeRecovery.length; i++) {
      scanRow(params.perQuestionBeforeRecovery[i]!, i, "perQuestionBeforeRecovery")
    }
    for (let i = 0; i < rawRows.length; i++) {
      const snap = rawRows[i] as Record<string, unknown>
      scanRow(snap, i, "interleavedColumnGeometryTelemetryRows")
    }

    let blankIndex = -1
    for (let i = 0; i < params.perQuestionBeforeRecovery.length; i++) {
      const row = params.perQuestionBeforeRecovery[i]!
      if (normalizeToCanonicalId(row.canonicalId) !== targetCanon) continue
      if (!isBlankAnswer(row)) continue
      if (row.inferredBlank === true || row.completedByExpectation === true) continue
      if (!closedNorm.has(targetCanon)) continue
      blankIndex = i
      break
    }

    const finalRowAfter =
      blankIndex >= 0 ? (params.perQuestionAfterRecovery[blankIndex] ?? null) : null
    const finalRowDump = dumpRowFields(finalRowAfter)

    const carrierAndRawTraces: Array<Record<string, unknown>> = []
    type Cand = { answer: string; indices: number[]; sourceRowIndex: number; origin: string }
    const candidates: Cand[] = []

    if (blankIndex >= 0) {
      const outBefore = params.perQuestionBeforeRecovery.map((r) => ({ ...r }))
      const bi = blankIndex
      const blank = outBefore[bi]!

      for (let k = 0; k < outBefore.length; k++) {
        const carrier = outBefore[k]!
        const diag = readDiag(carrier)
        if (!diag) {
          carrierAndRawTraces.push({
            origin: "per_question_row",
            rowIndex: k,
            outcome: "rejected",
            reason: "no_diagnostic_object",
          })
          continue
        }
        if (!slotMatchesBlank(blank, diag)) {
          carrierAndRawTraces.push({
            origin: "per_question_row",
            rowIndex: k,
            outcome: "rejected",
            reason: "slot_mismatch",
            detail: slotMismatchDetail(blank, diag),
          })
          continue
        }
        if (!carrierCoherentWithDiagnostic(carrier, diag, k === bi)) {
          carrierAndRawTraces.push({
            origin: "per_question_row",
            rowIndex: k,
            outcome: "rejected",
            reason: "stale_diagnostic",
            detail: {
              carrierCanonical: normalizeToCanonicalId(carrier.canonicalId),
              diagCanonical: normalizeToCanonicalId(diag.canonicalId),
            },
          })
          continue
        }
        const ans = String(diag.selectedAnswer ?? "").trim().toUpperCase()
        if (!LETTER_RE.test(ans)) {
          carrierAndRawTraces.push({
            origin: "per_question_row",
            rowIndex: k,
            outcome: "rejected",
            reason: "no_letter_in_diagnostic_selectedAnswer",
            diagSnippet: diagEvidenceSnippet(diag),
          })
          continue
        }
        const indices = normIndices(diag.assignedDetectionIndices)
        if (indices.length === 0) {
          carrierAndRawTraces.push({
            origin: "per_question_row",
            rowIndex: k,
            outcome: "rejected",
            reason: "empty_assignedDetectionIndices_in_diagnostic",
            diagSnippet: diagEvidenceSnippet(diag),
          })
          continue
        }
        carrierAndRawTraces.push({
          origin: "per_question_row",
          rowIndex: k,
          outcome: "accepted_as_candidate",
          answer: ans,
          assignedDetectionIndices: indices,
        })
        candidates.push({ answer: ans, indices, sourceRowIndex: k, origin: "per_question_row" })
      }

      if (rawRows.length > 0) {
        for (let ri = 0; ri < rawRows.length; ri++) {
          const snap = rawRows[ri] as Record<string, unknown>
          if (!slotMatchesBlank(blank, snap)) {
            carrierAndRawTraces.push({
              origin: "raw_geometry_row",
              rawRowIndex: ri,
              outcome: "rejected",
              reason: "slot_mismatch",
              detail: slotMismatchDetail(blank, snap),
            })
            continue
          }
          const ans = String(snap.selectedAnswer ?? "").trim().toUpperCase()
          if (!LETTER_RE.test(ans)) {
            carrierAndRawTraces.push({
              origin: "raw_geometry_row",
              rawRowIndex: ri,
              outcome: "rejected",
              reason: "no_letter_in_diagnostic_selectedAnswer",
              rawSnippet: diagEvidenceSnippet(snap),
            })
            continue
          }
          const indices = normIndices(snap.assignedDetectionIndices)
          if (indices.length === 0) {
            carrierAndRawTraces.push({
              origin: "raw_geometry_row",
              rawRowIndex: ri,
              outcome: "rejected",
              reason: "empty_assignedDetectionIndices_in_diagnostic",
              rawSnippet: diagEvidenceSnippet(snap),
            })
            continue
          }
          const sourceRowIndex = resolveSourceRowIndexForGeometrySnapshot(outBefore, bi, snap)
          carrierAndRawTraces.push({
            origin: "raw_geometry_row",
            rawRowIndex: ri,
            outcome: "accepted_as_candidate",
            answer: ans,
            assignedDetectionIndices: indices,
            resolvedSourceRowIndex: sourceRowIndex,
          })
          candidates.push({
            answer: ans,
            indices,
            sourceRowIndex,
            origin: "raw_geometry_row",
          })
        }
      }
    }

    const byKey = new Map<string, Cand>()
    for (const c of candidates) {
      const key = `${c.answer}|${indicesKey(c.indices)}`
      if (!byKey.has(key)) byKey.set(key, c)
    }
    const unique = [...byKey.values()]
    const candidatesDeduped = unique.map((c) => ({
      answer: c.answer,
      assignedDetectionIndices: c.indices,
      sourceRowIndex: c.sourceRowIndex,
      origin: c.origin,
    }))

    let exactReasonWhyStillBlank: string | null = null
    let finalDecision: Record<string, unknown> = { status: "unknown" }

    if (blankIndex < 0) {
      exactReasonWhyStillBlank = "no_blank_row_indexed_for_canonical"
      finalDecision = {
        status: "skipped",
        reason: exactReasonWhyStillBlank,
        inClosedInventory: closedNorm.has(targetCanon),
      }
    } else if (!params.finalBlankRecoveryEnabled) {
      exactReasonWhyStillBlank = "final_blank_recovery_disabled_by_env"
      finalDecision = { status: "recovery_disabled", reason: exactReasonWhyStillBlank }
    } else if (!isBlankAnswer(params.perQuestionBeforeRecovery[blankIndex]!)) {
      exactReasonWhyStillBlank = "row_was_not_blank_before_recovery"
      finalDecision = { status: "not_applicable", reason: exactReasonWhyStillBlank }
    } else if (candidates.length === 0) {
      exactReasonWhyStillBlank = "no_candidate_found"
      finalDecision = {
        status: "kept_blank",
        reason: exactReasonWhyStillBlank,
        note: "See carrierAndRawTraces for per-row rejection codes (slot_mismatch, stale_diagnostic, etc.).",
      }
    } else if (unique.length !== 1) {
      exactReasonWhyStillBlank = "no_unique_physical_evidence"
      finalDecision = {
        status: "kept_blank",
        reason: exactReasonWhyStillBlank,
        ambiguousVariants: candidatesDeduped,
      }
    } else {
      const chosen = unique[0]!
      let reused = false
      for (const di of chosen.indices) {
        if (usedSet.has(di)) {
          reused = true
          break
        }
      }
      if (reused) {
        exactReasonWhyStillBlank = "detection_already_used"
        finalDecision = {
          status: "kept_blank",
          reason: exactReasonWhyStillBlank,
          chosenIfFree: {
            answer: chosen.answer,
            assignedDetectionIndices: chosen.indices,
            overlapWithUsed: chosen.indices.filter((i) => usedSet.has(i)),
          },
        }
      } else {
        const sourceRow = params.perQuestionBeforeRecovery[chosen.sourceRowIndex]!
        const conf = letterConfidence(sourceRow, chosen.answer)
        if (minConf >= 0 && (conf < 0 || conf < minConf)) {
          exactReasonWhyStillBlank = "low_confidence"
          finalDecision = {
            status: "kept_blank",
            reason: exactReasonWhyStillBlank,
            minConfidenceRequired: minConf,
            letterConfidence: conf,
            sourceRowIndex: chosen.sourceRowIndex,
          }
        } else if (!isBlankAnswer(finalRowAfter!)) {
          exactReasonWhyStillBlank = "recovered_ok"
          finalDecision = {
            status: "recovered",
            reason: exactReasonWhyStillBlank,
            answer: chosen.answer,
            assignedDetectionIndices: chosen.indices,
          }
        } else {
          exactReasonWhyStillBlank = "still_blank_after_recovery_pass_unexpected"
          finalDecision = { status: "inconsistent", reason: exactReasonWhyStillBlank }
        }
      }
    }

    if (
      exactReasonWhyStillBlank === "recovered_ok" &&
      finalRowDump &&
      isBlankAnswer(finalRowDump as Record<string, unknown>)
    ) {
      exactReasonWhyStillBlank = "recovery_expected_but_row_still_blank"
      finalDecision = {
        status: "inconsistent",
        reason: exactReasonWhyStillBlank,
        finalRowDump,
      }
    }

    const byTargetMatch: Array<Record<string, unknown>> = []
    const rightPanelLastRows: Array<Record<string, unknown>> = []
    for (let i = 0; i < rawRows.length; i++) {
      const snap = rawRows[i] as Record<string, unknown>
      if (rawRowMatchesTarget(snap, targetCanon, targetPhys)) {
        byTargetMatch.push({ rawRowIndex: i, ...diagEvidenceSnippet(snap), raw: snap })
      }
    }
    for (let i = 0; i < rawRows.length; i++) {
      const snap = rawRows[i] as Record<string, unknown>
      if (Number(snap.panelIndex ?? 0) !== 1) continue
      const ri = Number(snap.rowIndexWithinPanel ?? -1)
      if (maxRowRightPanel >= 0 && ri === maxRowRightPanel) {
        rightPanelLastRows.push({ rawRowIndex: i, ...diagEvidenceSnippet(snap) })
      }
    }

    const slot: C30C31AuditSlot = {
      finalRow: finalRowDump,
      priorPhysicalEvidenceRows,
      recoveryCandidates: {
        finalBlankRecoveryEnabled: params.finalBlankRecoveryEnabled,
        candidateCountBeforeDedup: candidates.length,
        candidatesDeduped,
        carrierAndRawTraces,
        usedDetectionIndicesBeforeRecovery: [...usedDetectionIndicesBeforeRecovery],
        finalDecision: { ...finalDecision },
        exactReasonWhyStillBlank,
      },
      usedDetectionIndicesBeforeRecovery: [...usedDetectionIndicesBeforeRecovery],
      rawGeometryMatches: { byTargetMatch, rightPanelLastRows },
      finalDecision: { ...finalDecision },
      exactReasonWhyStillBlank,
    }

    if (targetCanon === "C30") auditBundle.c30 = slot
    else auditBundle.c31 = slot
  }

  return auditBundle
}
