/**
 * Recuperación final ultra restringida: solo reemplaza BLANK cuando ya existe
 * evidencia física A–D + assignedDetectionIndices en el diagnóstico interleaved
 * de la misma fila o de otra fila coherente (sin teacher_key / sin inventar).
 *
 * Reversible: INTERLEAVED_FINAL_BLANK_RECOVERY_FROM_PHYSICAL_EVIDENCE=0 (defecto).
 */
import { normalizeToCanonicalId } from "../canonical-closed-id"
import {
  getInterleavedFinalBlankRecoveryMinConfidence,
  isInterleavedFinalBlankRecoveryFromPhysicalEvidenceEnabled,
} from "./env"

const LETTER_RE = /^[A-D]$/

function isBlankAnswer(row: Record<string, unknown>): boolean {
  const s = String(row.selectedAnswer ?? "").trim().toUpperCase()
  return s === "" || s === "BLANK" || s === "SIN_RESPUESTA"
}

function readDiag(row: Record<string, unknown>): Record<string, unknown> | null {
  const d = row.interleavedColumnGeometryDiagnostic
  if (d && typeof d === "object") return d as Record<string, unknown>
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

/** Evidencia en otra fila: el portador debe seguir alineado con el canonical del diagnóstico (evita diag stale). */
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

export type FinalBlankRecoveryTelemetry = {
  finalBlankRecoveryFromPhysicalEvidenceEnabled: boolean
  finalBlankRecoveryFromPhysicalEvidenceApplied: boolean
  finalBlankRecoveryEntries: Array<Record<string, unknown>>
}

const emptyTelemetry: FinalBlankRecoveryTelemetry = {
  finalBlankRecoveryFromPhysicalEvidenceEnabled: false,
  finalBlankRecoveryFromPhysicalEvidenceApplied: false,
  finalBlankRecoveryEntries: [],
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

export function applyFinalBlankRecoveryFromPhysicalEvidence(params: {
  perQuestion: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  /**
   * Snapshot inmutable del paso column-geometry (`interleavedColumnGeometryTelemetryRows`):
   * misma forma que `interleavedColumnGeometryDiagnostic` por fila.
   */
  rawInterleavedGeometryRows?: ReadonlyArray<Record<string, unknown>>
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: FinalBlankRecoveryTelemetry
} {
  // [TEMP_C30_C31_AUDIT_DIAG] Confirma invocación efectiva del recovery (reversible).
  const __recoveryRawEnv = process.env.INTERLEAVED_FINAL_BLANK_RECOVERY_FROM_PHYSICAL_EVIDENCE ?? null
  const __recoveryResolved = isInterleavedFinalBlankRecoveryFromPhysicalEvidenceEnabled()
  console.log("[C30_RECOVERY_INVOKED]", {
    rawEnv: __recoveryRawEnv,
    enabledResolved: __recoveryResolved,
    perQuestionCount: Array.isArray(params.perQuestion) ? params.perQuestion.length : -1,
    closedQuestionIdsCount: Array.isArray(params.closedQuestionIds) ? params.closedQuestionIds.length : -1,
    rawInterleavedGeometryRowsCount: Array.isArray(params.rawInterleavedGeometryRows)
      ? params.rawInterleavedGeometryRows.length
      : -1,
  })
  if (!__recoveryResolved) {
    return { perQuestion: params.perQuestion, telemetry: emptyTelemetry }
  }

  const minConf = getInterleavedFinalBlankRecoveryMinConfidence()
  const closedNorm = new Set<string>()
  for (const id of params.closedQuestionIds) {
    const n = normalizeToCanonicalId(id)
    if (n) closedNorm.add(n)
  }

  const entries: Array<Record<string, unknown>> = []
  const usedDetectionIndices = new Set<number>()
  for (const r of params.perQuestion) {
    if (isBlankAnswer(r)) continue
    const idx = Array.isArray(r.assignedDetectionIndices)
      ? (r.assignedDetectionIndices as unknown[]).filter(
          (x): x is number => typeof x === "number" && Number.isFinite(x),
        )
      : []
    for (const d of idx) usedDetectionIndices.add(d)
  }

  const blankIndices: number[] = []
  for (let i = 0; i < params.perQuestion.length; i++) {
    const row = params.perQuestion[i]!
    if (!isBlankAnswer(row)) continue
    if (row.inferredBlank === true || row.completedByExpectation === true) continue
    const cid = normalizeToCanonicalId(row.canonicalId)
    if (!cid || !closedNorm.has(cid)) continue
    blankIndices.push(i)
  }

  blankIndices.sort(
    (a, b) =>
      Number(params.perQuestion[a]!.questionNumber ?? 0) - Number(params.perQuestion[b]!.questionNumber ?? 0),
  )

  let applied = false
  const out = params.perQuestion.map((r) => ({ ...r }))
  const localUsed = new Set(usedDetectionIndices)

  const log = (payload: Record<string, unknown>) => {
    entries.push(payload)
    console.log(`OMR_INTERLEAVED_FINAL_BLANK_RECOVERY: ${JSON.stringify(payload)}`)
  }

  for (const bi of blankIndices) {
    const blank = out[bi]!
    const blankCanon = normalizeToCanonicalId(blank.canonicalId)
    const blankPhys =
      typeof blank.physicalIndex === "number" && Number.isFinite(blank.physicalIndex)
        ? blank.physicalIndex
        : null

    type Cand = { answer: string; indices: number[]; sourceRowIndex: number }
    const candidates: Cand[] = []

    for (let k = 0; k < out.length; k++) {
      const carrier = out[k]!
      const diag = readDiag(carrier)
      if (!diag) continue
      if (!slotMatchesBlank(blank, diag)) continue
      if (!carrierCoherentWithDiagnostic(carrier, diag, k === bi)) continue

      const ans = String(diag.selectedAnswer ?? "").trim().toUpperCase()
      if (!LETTER_RE.test(ans)) continue
      const indices = normIndices(diag.assignedDetectionIndices)
      if (indices.length === 0) continue

      candidates.push({ answer: ans, indices, sourceRowIndex: k })
    }

    const rawRows = params.rawInterleavedGeometryRows
    if (rawRows && rawRows.length > 0) {
      for (const snap of rawRows) {
        if (!snap || typeof snap !== "object") continue
        const d = snap as Record<string, unknown>
        if (!slotMatchesBlank(blank, d)) continue
        const ans = String(d.selectedAnswer ?? "").trim().toUpperCase()
        if (!LETTER_RE.test(ans)) continue
        const indices = normIndices(d.assignedDetectionIndices)
        if (indices.length === 0) continue
        const sourceRowIndex = resolveSourceRowIndexForGeometrySnapshot(out, bi, d)
        candidates.push({ answer: ans, indices, sourceRowIndex })
      }
    }

    if (candidates.length === 0) {
      log({
        canonicalId: blankCanon,
        physicalIndex: blankPhys,
        finalWasBlank: true,
        action: "kept_blank",
        reason: "no_candidate_found",
      })
      continue
    }

    const byKey = new Map<string, Cand>()
    for (const c of candidates) {
      const key = `${c.answer}|${indicesKey(c.indices)}`
      if (!byKey.has(key)) byKey.set(key, c)
    }
    const unique = [...byKey.values()]
    if (unique.length !== 1) {
      log({
        canonicalId: blankCanon,
        physicalIndex: blankPhys,
        finalWasBlank: true,
        action: "kept_blank",
        reason: "no_unique_physical_evidence",
      })
      continue
    }

    const chosen = unique[0]!
    const sourceRow = out[chosen.sourceRowIndex]!
    let reused = false
    for (const di of chosen.indices) {
      if (localUsed.has(di)) {
        reused = true
        break
      }
    }
    if (reused) {
      log({
        canonicalId: blankCanon,
        physicalIndex: blankPhys,
        finalWasBlank: true,
        action: "kept_blank",
        reason: "detection_already_used",
      })
      continue
    }

    const conf = letterConfidence(sourceRow, chosen.answer)
    if (minConf >= 0 && (conf < 0 || conf < minConf)) {
      log({
        canonicalId: blankCanon,
        physicalIndex: blankPhys,
        finalWasBlank: true,
        action: "kept_blank",
        reason: "low_confidence",
      })
      continue
    }

    const baseTel = (blank.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}
    out[bi] = {
      ...blank,
      selectedAnswer: chosen.answer,
      assignedDetectionIndices: [...chosen.indices],
      interleavedReviewRecommended: false,
      interleavedAmbiguityTelemetry: {
        ...baseTel,
        decisionSource: "interleaved_final_blank_recovery_from_physical_evidence",
      },
    }
    for (const di of chosen.indices) localUsed.add(di)
    applied = true

    log({
      canonicalId: blankCanon,
      physicalIndex: blankPhys,
      finalWasBlank: true,
      recoveredAnswer: chosen.answer,
      recoveredAssignedDetectionIndices: [...chosen.indices],
      source: "existing_interleaved_physical_diagnostic",
      reason: "blank_recovered_from_same_slot_physical_evidence",
      rejectedBecause: null,
    })
  }

  return {
    perQuestion: out,
    telemetry: {
      finalBlankRecoveryFromPhysicalEvidenceEnabled: true,
      finalBlankRecoveryFromPhysicalEvidenceApplied: applied,
      finalBlankRecoveryEntries: entries,
    },
  }
}
