/**
 * Universal Physical Row → Canonical Question Mapping Layer.
 *
 * Evaluates multiple ordering strategies for mapping detected physical OMR rows
 * to the official closed question inventory. Selects the best strategy based on
 * structural evidence (geometry, OCR, panel distribution) without contaminating
 * with correct answers or scoring.
 *
 * Reversible: INTERLEAVED_UNIVERSAL_PHYSICAL_MAP=0 disables entirely.
 * Does NOT touch OMR clásico, azure-layout-omr-pipeline.ts, scoring, UI, or OCR general.
 */

import {
  getInterleavedGeometryBandTolerance,
  isInterleavedPhysicalNumberPreservedMapEnabled,
  isInterleavedDiagnosticCanonicalReconciliationEnabled,
  isInterleavedDescriptorPhysicalMappingEnabled,
  isInterleavedPaddedBlankPhysicalEvidenceGuardEnabled,
} from "./env"
import { sortDecodedForRebuild, type RebuildQuestionSortOrder } from "./rebuildQuestionSequence"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"
import type { HybridSlotDescriptor } from "./hybrid-slot-topology"
import {
  type DescriptorMappingForensics,
  createDescriptorMappingForensicsCollector,
  buildForensicRowDump,
  buildForensicSnapshot,
  buildForensicRollbackEvent,
  buildRollbackDiff,
  dumpClosedSlotsPerPanel,
} from "./descriptor-mapping-forensics"

export type PhysicalRowDescriptor = {
  visualIndex: number
  panelIndex: number
  rowIndexWithinPanel: number
  rowCenterY: number
  selectedAnswer: string
  selectedMarkX: number | null
  selectedMarkY: number | null
  confidence: number | null
  ocrNumber: number | null
}

export type StrategyCandidate = {
  name: string
  sortOrder: RebuildQuestionSortOrder
  score: number
  reasons: string[]
  orderedIndices: number[]
  yMonotonicity: number
  panelBalance: number
  ocrConsistency: number
  noDuplicates: boolean
}

export type GeometryBandPairingAnalysis = {
  pairedRowBandsCount: number
  averagePairedYDistance: number
  leftPanelRows: number
  rightPanelRows: number
  rowBandPairingConfidence: number
  suggestedPhysicalOrderByGeometry: string
  bandDetails: Array<{
    leftY: number
    rightY: number
    yDistance: number
    paired: boolean
  }>
}

export type AuditRowTracked = {
  visualIndex: number
  panelIndex: number
  rowIndexWithinPanel: number
  rowCenterY: number
  selectedAnswer: string
  detectionIndex: number | null
  selectedMarkX: number | null
  selectedMarkY: number | null
  ocrNumber: number | null
  canonicalIdBefore: string | null
  physicalIndexBefore: number | null
  canonicalIdAfterPanelThenY: string
  physicalIndexAfterPanelThenY: number
  canonicalIdAfterYThenPanel: string
  physicalIndexAfterYThenPanel: number
  canonicalIdChosen: string
  physicalIndexChosen: number
}

export type InterleavedFinalMappingAudit = {
  rowsTracked: AuditRowTracked[]
  strategies: {
    panel_then_y: StrategyCandidate
    y_then_panel: StrategyCandidate
  }
  geometryAnalysis: GeometryBandPairingAnalysis
  geometrySuggestion: string
  strategyChosen: string
  strategyReason: string
  contradictionDetected: boolean
  contradictionReason: string
  recommendedFix: string
  bandToleranceApplied: number
}

export type PhysicalNumberPreservedRowTelemetry = {
  physicalRowNumber: number
  expectedCanonicalFromPhysicalNumber: string | null
  skippedBecauseDevelopment: boolean
  rowWasSkippedBecauseNotClosed: boolean
  selectedAnswer: string
  assignedCanonicalId: string | null
  panelIndex: number
  rowIndexWithinPanel: number
  physicalNumberMappingReason: string
}

export type PhysicalNumberPreservedTelemetry = {
  physicalNumberPreservedMapping: boolean
  compactClosedInventoryMappingUsed: boolean
  totalPhysicalSlots: number
  closedSlotCount: number
  developmentSlotCount: number
  detectedMode: "physical_number_preserved" | "compact_closed_only" | "disabled"
  rowDetails: PhysicalNumberPreservedRowTelemetry[]
  physicalNumberMappingActivatedDespiteRowsCountMismatch: boolean
  physicalNumberMappingReason: string
  paddedBlankCount: number
}

export type DescriptorPhysicalMappingRowTelemetry = {
  physicalRowNumber: number
  physicalNumberSource: "hybridSlotDescriptors" | "formula_fallback"
  descriptorSlotType: "closed" | "development"
  descriptorItemNumber: number
  descriptorCanonicalId: string
  physicalSlotMatched: boolean
  skippedBecauseDevelopment: boolean
  compactMappingPrevented: boolean
  selectedAnswer: string
  assignedCanonicalId: string | null
  panelIndex: number
  rowIndexWithinPanel: number
}

export type DescriptorPhysicalMappingTelemetry = {
  descriptorMappingEnabled: boolean
  descriptorMappingApplied: boolean
  descriptorMappingFallbackReason: string | null
  totalDescriptorSlots: number
  closedDescriptorSlots: number
  developmentDescriptorSlots: number
  invariantRollbackReason: string | null
  rowDetails: DescriptorPhysicalMappingRowTelemetry[]
  paddedBlankCount: number
  compactMappingPreventedCount: number
}

export type UniversalMappingTelemetry = {
  enabled: boolean
  strategyCandidates: StrategyCandidate[]
  strategyChosen: string | null
  strategyReason: string | null
  mappingBefore: Array<{ idx: number; canonicalId: string | null; physicalIndex: number | null }>
  mappingAfter: Array<{ idx: number; canonicalId: string; physicalIndex: number }>
  rowsCount: number
  closedInventoryCount: number
  duplicatedCanonicalIds: string[]
  missingCanonicalIds: string[]
  extraCanonicalIds: string[]
  rollbackReason: string | null
  applied: boolean
  finalMappingAudit?: InterleavedFinalMappingAudit
  physicalNumberPreserved?: PhysicalNumberPreservedTelemetry
  descriptorPhysicalMapping?: DescriptorPhysicalMappingTelemetry
  descriptorMappingAttempted?: boolean
  descriptorMappingApplied?: boolean
  descriptorMappingRollback?: boolean
  descriptorMappingRollbackReason?: string | null
  descriptorSlotsTotal?: number
  descriptorClosedSlotsCount?: number
  descriptorDevelopmentSlotsCount?: number
  rowsBeforeDescriptorMapping?: number
  rowsAfterDescriptorMapping?: number
  closedQuestionIdsCount?: number
  physicalSlotsVsClosedSlotsOk?: boolean
  descriptorMappingForensics?: DescriptorMappingForensics
}

function extractNumeric(row: Record<string, unknown>, key: string): number | null {
  const v = row[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  return null
}

function extractString(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  return typeof v === "string" ? v : ""
}

function buildPhysicalRows(rows: Array<Record<string, unknown>>): PhysicalRowDescriptor[] {
  return rows.map((row, i) => ({
    visualIndex: i,
    panelIndex: extractNumeric(row, "panelIndex") ?? 0,
    rowIndexWithinPanel: extractNumeric(row, "rowIndexWithinPanel") ?? i,
    rowCenterY: extractNumeric(row, "rowCenterY") ?? 0,
    selectedAnswer: extractString(row, "selectedAnswer") || "BLANK",
    selectedMarkX: extractNumeric(row, "rowCenterX"),
    selectedMarkY: extractNumeric(row, "rowCenterY"),
    confidence: extractNumeric(row, "winnerMargin") ?? extractNumeric(row, "confidence"),
    ocrNumber: extractNumeric(row, "ocrQuestionNumber"),
  }))
}

/**
 * Measures how monotonically increasing Y values are within each panel.
 * Returns 0..1 where 1 = perfectly monotonic.
 */
function measureYMonotonicity(rows: Array<Record<string, unknown>>, orderedIndices: number[]): number {
  if (orderedIndices.length <= 1) return 1

  const panels = new Map<number, number[]>()
  for (const idx of orderedIndices) {
    const row = rows[idx]!
    const panel = extractNumeric(row, "panelIndex") ?? 0
    if (!panels.has(panel)) panels.set(panel, [])
    panels.get(panel)!.push(idx)
  }

  let totalPairs = 0
  let monotonePairs = 0

  for (const [, indices] of panels) {
    for (let i = 1; i < indices.length; i++) {
      const yPrev = extractNumeric(rows[indices[i - 1]!]!, "rowCenterY") ?? 0
      const yCurr = extractNumeric(rows[indices[i]!]!, "rowCenterY") ?? 0
      totalPairs++
      if (yCurr >= yPrev - 0.005) monotonePairs++
    }
  }

  return totalPairs === 0 ? 1 : monotonePairs / totalPairs
}

/**
 * Measures how balanced left/right panels are (close to N/2 each for dual column).
 * Returns 0..1 where 1 = perfectly balanced.
 */
function measurePanelBalance(rows: Array<Record<string, unknown>>, orderedIndices: number[]): number {
  if (orderedIndices.length === 0) return 1

  let left = 0
  let right = 0
  for (const idx of orderedIndices) {
    const panel = extractNumeric(rows[idx]!, "panelIndex") ?? 0
    if (panel === 0) left++
    else right++
  }

  if (left === 0 || right === 0) return 1
  const ratio = Math.min(left, right) / Math.max(left, right)
  return ratio
}

/**
 * Measures consistency with OCR-detected question numbers.
 * Returns 0..1 where 1 = all OCR numbers match expected sequence position.
 */
function measureOcrConsistency(
  rows: Array<Record<string, unknown>>,
  orderedIndices: number[],
  closedQuestionIds: string[],
): number {
  let ocrHits = 0
  let ocrMatches = 0

  for (let pos = 0; pos < orderedIndices.length; pos++) {
    const row = rows[orderedIndices[pos]!]!
    const ocrNum = extractNumeric(row, "ocrQuestionNumber")
    if (ocrNum == null || ocrNum < 1) continue
    ocrHits++

    const expectedId = closedQuestionIds[pos]
    if (!expectedId) continue
    const expectedNum = parseClosedIdNumericSlot(expectedId)
    if (expectedNum != null && expectedNum === ocrNum) {
      ocrMatches++
    }
  }

  return ocrHits === 0 ? 0.5 : ocrMatches / ocrHits
}

/**
 * Evaluates a single strategy: sorts rows, then scores the result.
 */
function evaluateStrategy(
  name: string,
  sortOrder: RebuildQuestionSortOrder,
  rows: Array<Record<string, unknown>>,
  closedQuestionIds: string[],
): StrategyCandidate {
  const sorted = sortDecodedForRebuild([...rows], sortOrder)
  const orderedIndices = sorted.map((sortedRow) => {
    return rows.findIndex((r) => r === sortedRow)
  })

  const yMono = measureYMonotonicity(rows, orderedIndices)
  const panelBal = measurePanelBalance(rows, orderedIndices)
  const ocrCons = measureOcrConsistency(rows, orderedIndices, closedQuestionIds)

  const seenCanonicals = new Set<string>()
  let noDuplicates = true
  for (let i = 0; i < orderedIndices.length && i < closedQuestionIds.length; i++) {
    const cid = closedQuestionIds[i]!
    if (seenCanonicals.has(cid)) {
      noDuplicates = false
      break
    }
    seenCanonicals.add(cid)
  }

  const reasons: string[] = []
  let score = 0

  score += yMono * 40
  reasons.push(`y_monotonicity=${yMono.toFixed(3)} (weight=40)`)

  score += ocrCons * 35
  reasons.push(`ocr_consistency=${ocrCons.toFixed(3)} (weight=35)`)

  score += panelBal * 15
  reasons.push(`panel_balance=${panelBal.toFixed(3)} (weight=15)`)

  if (noDuplicates) {
    score += 10
    reasons.push("no_duplicates=true (weight=10)")
  }

  return {
    name,
    sortOrder,
    score,
    reasons,
    orderedIndices,
    yMonotonicity: yMono,
    panelBalance: panelBal,
    ocrConsistency: ocrCons,
    noDuplicates,
  }
}

export type UniversalPhysicalMappingResult = {
  orderedRows: Array<Record<string, unknown>>
  strategy: StrategyCandidate | null
  telemetry: UniversalMappingTelemetry
  success: boolean
}

/**
 * Detects whether closedQuestionIds represent a non-contiguous set of physical
 * positions (gaps indicate interleaved development questions on the sheet).
 */
function detectNonContiguousClosedSlots(closedQuestionIds: string[]): {
  isNonContiguous: boolean
  numericSlots: number[]
  maxSlot: number
  closedSlotMap: Map<number, string>
} {
  const numericSlots: number[] = []
  const closedSlotMap = new Map<number, string>()
  for (const cid of closedQuestionIds) {
    const n = parseClosedIdNumericSlot(cid)
    if (n != null && n >= 1) {
      numericSlots.push(n)
      closedSlotMap.set(n, cid)
    }
  }
  if (numericSlots.length === 0) {
    return { isNonContiguous: false, numericSlots, maxSlot: 0, closedSlotMap }
  }
  const maxSlot = Math.max(...numericSlots)
  const isNonContiguous = numericSlots.length < maxSlot
  return { isNonContiguous, numericSlots, maxSlot, closedSlotMap }
}

/**
 * Computes the 1-based physical row number on the answer sheet from a row's
 * panel position and index within that panel.
 *
 * sequential_dual_column: panel 0 → rows 1..rowsPerPanel,
 *                         panel 1 → rows (rowsPerPanel+1)..totalPhysicalSlots
 * odd_even_dual_column:   panel 0 → odd rows (1,3,5,...),
 *                         panel 1 → even rows (2,4,6,...)
 */
function computePhysicalRowNumber(
  panelIndex: number,
  rowIndexWithinPanel: number,
  preferredVariant: string,
  totalPhysicalSlots: number,
): number {
  if (preferredVariant === "odd_even_dual_column") {
    return panelIndex === 0
      ? 2 * rowIndexWithinPanel + 1
      : 2 * (rowIndexWithinPanel + 1)
  }
  const rowsPerPanel = Math.ceil(totalPhysicalSlots / 2)
  return panelIndex * rowsPerPanel + rowIndexWithinPanel + 1
}

const INTERLEAVED_VALID_LETTER_ANSWER_RE = /^[A-D]$/

function extractRowPhysicalSlotNumber(row: Record<string, unknown>): number {
  const pr = Number(row.physicalRowNumberOnSheet ?? 0)
  if (Number.isFinite(pr) && pr > 0) return pr
  const pi = Number(row.physicalIndex ?? 0)
  if (Number.isFinite(pi) && pi > 0) return pi
  const qn = Number(row.questionNumber ?? 0)
  if (Number.isFinite(qn) && qn > 0) return qn
  return 0
}

function resolveRowPhysicalForGuard(
  row: Record<string, unknown>,
  preferredVariant: string,
  totalPhysicalSlots: number,
): number {
  const direct = extractRowPhysicalSlotNumber(row)
  if (direct > 0) return direct
  return computePhysicalRowNumber(
    extractNumeric(row, "panelIndex") ?? 0,
    extractNumeric(row, "rowIndexWithinPanel") ?? 0,
    preferredVariant,
    totalPhysicalSlots,
  )
}

function rowHasValidInterleavedBubbleEvidence(row: Record<string, unknown>): boolean {
  const ans = typeof row.selectedAnswer === "string" ? row.selectedAnswer.trim().toUpperCase() : ""
  if (!INTERLEAVED_VALID_LETTER_ANSWER_RE.test(ans)) return false
  const det = row.assignedDetectionIndices
  return Array.isArray(det) && det.filter((x): x is number => typeof x === "number").length > 0
}

function readDiagnosticCanonicalIdFromRow(row: Record<string, unknown>): string {
  const diag = row.interleavedColumnGeometryDiagnostic
  if (!diag || typeof diag !== "object") return ""
  const cid = (diag as Record<string, unknown>).canonicalId
  return typeof cid === "string" ? cid.trim() : ""
}

function resolveInventoryPhysicalRowForClosedId(
  closedId: string,
  closedSlotMap: Map<number, string>,
  hybridSlotDescriptors: HybridSlotDescriptor[] | undefined,
): number | null {
  for (const [phys, cid] of closedSlotMap.entries()) {
    if (cid === closedId && phys > 0) return phys
  }
  if (hybridSlotDescriptors) {
    const d = hybridSlotDescriptors.find((x) => x.slotType === "closed" && x.canonicalId === closedId)
    if (d && d.physicalIndex > 0) return d.physicalIndex
  }
  const n = parseClosedIdNumericSlot(closedId)
  return n != null && n > 0 ? n : null
}

function inventoryConfirmsClosedAtPhysical(
  closedId: string,
  expectedPhysical: number,
  closedSlotMap: Map<number, string>,
  hybridSlotDescriptors: HybridSlotDescriptor[] | undefined,
): boolean {
  if (expectedPhysical <= 0) return false
  const fromMap = closedSlotMap.get(expectedPhysical)
  if (fromMap != null) return fromMap === closedId
  if (hybridSlotDescriptors) {
    const d = hybridSlotDescriptors.find(
      (x) => x.physicalIndex === expectedPhysical && x.slotType === "closed",
    )
    if (d) return d.canonicalId === closedId
  }
  const n = parseClosedIdNumericSlot(closedId)
  return n != null && n === expectedPhysical
}

function logOmrInterleavedPaddedBlankGuard(payload: Record<string, unknown>): void {
  console.log(`OMR_INTERLEAVED_PADDED_BLANK_GUARD: ${JSON.stringify(payload)}`)
}

type PaddedBlankGuardMode = "descriptor_physical_mapping" | "physical_number_preserved"

/**
 * Si hay evidencia física real (A–D + detection indices) alineada al slot de inventario
 * de `closedId`, evita crear padded BLANK: relabel en mappedRows o recupera fila de entrada.
 */
function trySuppressPaddedBlankDueToPhysicalEvidence(params: {
  mode: PaddedBlankGuardMode
  closedId: string
  closedSlotMap: Map<number, string>
  hybridSlotDescriptors: HybridSlotDescriptor[] | undefined
  mappedRows: Array<Record<string, unknown>>
  seenCanonicals: Set<string>
  seenPhysicalNumbers: Set<number>
  rows: Array<Record<string, unknown>>
  preferredVariant: string
  totalPhysicalSlots: number
}): boolean {
  if (!isInterleavedPaddedBlankPhysicalEvidenceGuardEnabled()) return false

  const {
    mode,
    closedId,
    closedSlotMap,
    hybridSlotDescriptors,
    mappedRows,
    seenCanonicals,
    seenPhysicalNumbers,
    rows,
    preferredVariant,
    totalPhysicalSlots,
  } = params

  const expectedPhysical = resolveInventoryPhysicalRowForClosedId(
    closedId,
    closedSlotMap,
    hybridSlotDescriptors,
  )
  if (expectedPhysical == null || expectedPhysical <= 0) return false

  if (!inventoryConfirmsClosedAtPhysical(closedId, expectedPhysical, closedSlotMap, hybridSlotDescriptors)) {
    const n = parseClosedIdNumericSlot(closedId)
    if (n == null || n !== expectedPhysical) return false
  }

  const rowMatchesEvidenceSlot = (row: Record<string, unknown>): boolean => {
    if (!rowHasValidInterleavedBubbleEvidence(row)) return false
    const rowCid = String(row.canonicalId ?? "").trim()
    const diagCid = readDiagnosticCanonicalIdFromRow(row)
    if (rowCid === closedId) return true
    if (diagCid === closedId) {
      const rp = resolveRowPhysicalForGuard(row, preferredVariant, totalPhysicalSlots)
      return rp === 0 || rp === expectedPhysical
    }
    const rp = resolveRowPhysicalForGuard(row, preferredVariant, totalPhysicalSlots)
    return (
      rp === expectedPhysical &&
      inventoryConfirmsClosedAtPhysical(closedId, expectedPhysical, closedSlotMap, hybridSlotDescriptors)
    )
  }

  for (let i = 0; i < mappedRows.length; i++) {
    const row = mappedRows[i]!
    if (row.physicalNumberPreservedPaddedBlank === true) continue
    if (!rowMatchesEvidenceSlot(row)) continue

    const preservedAnswer =
      typeof row.selectedAnswer === "string" ? row.selectedAnswer.trim().toUpperCase() : ""
    const det = row.assignedDetectionIndices
    const preservedDet = Array.isArray(det)
      ? det.filter((x): x is number => typeof x === "number")
      : []

    const oldCid = String(row.canonicalId ?? "").trim()
    const targetNumeric = parseClosedIdNumericSlot(closedId) ?? expectedPhysical

    mappedRows[i] = {
      ...row,
      canonicalId: closedId,
      questionNumber: targetNumeric,
      physicalIndex: targetNumeric,
      physicalRowNumberOnSheet: expectedPhysical,
      ...(mode === "descriptor_physical_mapping"
        ? {
            universalMappingStrategy: "descriptor_physical_mapping",
            descriptorPhysicalMappingApplied: true,
          }
        : {
            universalMappingStrategy: "physical_number_preserved",
          }),
      paddedBlankGuardPreservedPhysicalAnswer: true,
      ...(oldCid !== closedId ? { paddedBlankGuardRelabeledFromCanonicalId: oldCid } : {}),
    }

    if (oldCid && oldCid !== closedId) seenCanonicals.delete(oldCid)
    seenCanonicals.add(closedId)

    logOmrInterleavedPaddedBlankGuard({
      canonicalId: closedId,
      physicalIndex: expectedPhysical,
      attemptedPaddedBlank: true,
      existingPhysicalAnswerFound: true,
      preservedSelectedAnswer: preservedAnswer,
      preservedAssignedDetectionIndices: preservedDet,
      action: "preserved_physical_answer_over_padded_blank",
      guardMode: mode,
      relabeledFromCanonicalId: oldCid !== closedId ? oldCid : undefined,
    })
    return true
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (!rowMatchesEvidenceSlot(row)) continue
    if (seenPhysicalNumbers.has(expectedPhysical)) continue

    const preservedAnswer =
      typeof row.selectedAnswer === "string" ? row.selectedAnswer.trim().toUpperCase() : ""
    const det = row.assignedDetectionIndices
    const preservedDet = Array.isArray(det)
      ? det.filter((x): x is number => typeof x === "number")
      : []

    const targetNumeric = parseClosedIdNumericSlot(closedId) ?? expectedPhysical
    const recovered =
      mode === "descriptor_physical_mapping"
        ? {
            ...row,
            questionNumber: targetNumeric,
            physicalIndex: targetNumeric,
            canonicalId: closedId,
            closedInventoryMapped: true,
            universalMappingStrategy: "descriptor_physical_mapping",
            physicalRowNumberOnSheet: expectedPhysical,
            descriptorPhysicalMappingApplied: true,
            interleavedPipeline: true,
            paddedBlankGuardRecoveredFromInputRow: true,
          }
        : {
            ...row,
            questionNumber: targetNumeric,
            physicalIndex: targetNumeric,
            canonicalId: closedId,
            closedInventoryMapped: true,
            universalMappingStrategy: "physical_number_preserved",
            physicalRowNumberOnSheet: expectedPhysical,
            interleavedPipeline: true,
            paddedBlankGuardRecoveredFromInputRow: true,
          }

    mappedRows.push(recovered)
    seenCanonicals.add(closedId)
    seenPhysicalNumbers.add(expectedPhysical)

    logOmrInterleavedPaddedBlankGuard({
      canonicalId: closedId,
      physicalIndex: expectedPhysical,
      attemptedPaddedBlank: true,
      existingPhysicalAnswerFound: true,
      preservedSelectedAnswer: preservedAnswer,
      preservedAssignedDetectionIndices: preservedDet,
      action: "recovered_input_row_over_padded_blank",
      guardMode: mode,
      sourceInputRowIndex: i,
    })
    return true
  }

  return false
}

/**
 * Builds the physical slot lookup from hybridSlotDescriptors.
 * Returns closed slots ordered by physical index for each panel, allowing
 * correct mapping of detected row N within panel to the Nth closed slot
 * in that panel (skipping development slots).
 *
 * This is the source of truth for the physical layout of the sheet.
 */
function buildClosedSlotsPerPanel(
  hybridSlotDescriptors: HybridSlotDescriptor[],
  preferredVariant: string,
  totalPhysicalSlots: number,
): Map<number, HybridSlotDescriptor[]> {
  const slotsByPanel = new Map<number, HybridSlotDescriptor[]>()

  for (const desc of hybridSlotDescriptors) {
    let panel: number
    if (preferredVariant === "odd_even_dual_column") {
      panel = desc.physicalIndex % 2 === 1 ? 0 : 1
    } else if (preferredVariant === "sequential_dual_column") {
      const rowsPerPanel = Math.ceil(totalPhysicalSlots / 2)
      panel = desc.physicalIndex <= rowsPerPanel ? 0 : 1
    } else {
      panel = 0
    }

    if (!slotsByPanel.has(panel)) slotsByPanel.set(panel, [])
    slotsByPanel.get(panel)!.push(desc)
  }

  for (const [panel, slots] of slotsByPanel) {
    slotsByPanel.set(
      panel,
      slots.sort((a, b) => a.physicalIndex - b.physicalIndex),
    )
  }

  return slotsByPanel
}

/**
 * Resolves the physical row number for a detected row using hybridSlotDescriptors
 * as source of truth instead of the formula.
 *
 * Logic: within each panel, the Nth detected closed row corresponds to the
 * Nth closed slot (skipping development slots) in physical order.
 *
 * Returns the descriptor for the matched slot, or null if no match found.
 */
function resolveDescriptorForDetectedRow(
  panelIndex: number,
  rowIndexWithinPanel: number,
  closedSlotsPerPanel: Map<number, HybridSlotDescriptor[]>,
): HybridSlotDescriptor | null {
  const panelSlots = closedSlotsPerPanel.get(panelIndex)
  if (!panelSlots) return null

  const closedSlotsInPanel = panelSlots.filter((d) => d.slotType === "closed")

  if (rowIndexWithinPanel < 0 || rowIndexWithinPanel >= closedSlotsInPanel.length) {
    return null
  }

  return closedSlotsInPanel[rowIndexWithinPanel] ?? null
}

/**
 * Validates hybridSlotDescriptors are reliable for descriptor-based mapping.
 * Returns null if valid, or an error reason string if not suitable.
 */
function validateDescriptorsForMapping(
  hybridSlotDescriptors: HybridSlotDescriptor[] | undefined,
  closedQuestionIds: string[],
): string | null {
  if (!hybridSlotDescriptors || hybridSlotDescriptors.length === 0) {
    return "no_hybrid_slot_descriptors_available"
  }

  const closedDescriptors = hybridSlotDescriptors.filter((d) => d.slotType === "closed")
  if (closedDescriptors.length === 0) {
    return "no_closed_descriptors_found"
  }

  if (closedDescriptors.length !== closedQuestionIds.length) {
    return `closed_descriptor_count_mismatch: descriptors=${closedDescriptors.length} inventory=${closedQuestionIds.length}`
  }

  const hasDevelopment = hybridSlotDescriptors.some((d) => d.slotType === "development")
  if (!hasDevelopment) {
    return "no_development_slots_in_descriptors_formula_is_adequate"
  }

  const physicalIndices = hybridSlotDescriptors.map((d) => d.physicalIndex).sort((a, b) => a - b)
  for (let i = 0; i < physicalIndices.length; i++) {
    if (physicalIndices[i] !== i + 1) {
      return `non_contiguous_physical_indices_at_position_${i}`
    }
  }

  return null
}

/**
 * Descriptor-based physical mapping: uses hybridSlotDescriptors as the
 * source of truth for the physical layout. Maps each detected row to
 * its correct physical slot based on panel position and row order within
 * the panel (skipping development slots).
 *
 * Prevents the compaction bug where rowIndexWithinPanel only counts
 * detected (closed) rows but the formula assumes it counts ALL rows.
 *
 * ROLLBACK FUERTE: nunca devuelve [] si existían rows detectadas antes.
 * Si el mapping produce 0 filas, menos filas con respuestas válidas que
 * las originales, o más paddedBlank de lo razonable → retorna null para
 * que el caller use el fallback estable.
 */
function applyDescriptorPhysicalMapping(params: {
  rows: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  closedSlotMap: Map<number, string>
  totalPhysicalSlots: number
  preferredVariant: string
  hybridSlotDescriptors: HybridSlotDescriptor[]
}): UniversalPhysicalMappingResult | null {
  const { rows, closedQuestionIds, closedSlotMap, totalPhysicalSlots, preferredVariant, hybridSlotDescriptors } = params

  // ── FORENSIC COLLECTOR (observability-only, no functional effect) ──
  const forensics = createDescriptorMappingForensicsCollector()

  const mappingBefore = rows.map((r, i) => ({
    idx: i,
    canonicalId: typeof r.canonicalId === "string" ? r.canonicalId : null,
    physicalIndex: typeof r.physicalIndex === "number" ? r.physicalIndex : null,
  }))

  const closedSlotsPerPanel = buildClosedSlotsPerPanel(
    hybridSlotDescriptors,
    preferredVariant,
    totalPhysicalSlots,
  )

  // ── FORENSIC: dump closedSlotsPerPanel ──
  forensics.closedSlotsPerPanelDump = dumpClosedSlotsPerPanel(closedSlotsPerPanel)

  const VALID_ANSWER_RE = /^[A-D]$/
  const validAnswersBefore = rows.filter((r) => {
    const ans = typeof r.selectedAnswer === "string" ? r.selectedAnswer.trim().toUpperCase() : ""
    return VALID_ANSWER_RE.test(ans)
  }).length
  const rowsWithDetectionsBefore = rows.filter((r) => {
    const det = r.assignedDetectionIndices
    return Array.isArray(det) && det.length > 0
  }).length

  const descriptorRowDetails: DescriptorPhysicalMappingRowTelemetry[] = []
  const mappedRows: Array<Record<string, unknown>> = []
  const seenCanonicals = new Set<string>()
  const seenPhysicalNumbers = new Set<number>()
  let compactMappingPreventedCount = 0

  // ── FORENSIC helper: build rollback context & return null ──
  const forensicRollbackNull = (
    stage: string,
    reason: string,
    condition: string,
    failCid?: string | null,
    failPhysical?: number | null,
    paddedBefore?: number,
    paddedAfter?: number,
  ): null => {
    const snapshotParams = {
      rows, mappedRows, closedQuestionIds, hybridSlotDescriptors,
      preferredVariant, totalPhysicalSlots,
      seenCanonicals, seenPhysicalNumbers,
      paddedBlankCount: paddedAfter ?? 0,
    }
    forensics.snapshots.push(
      buildForensicSnapshot("last_healthy_state", { ...snapshotParams, mappedRows: rows }),
      buildForensicSnapshot("immediately_before_return_null", snapshotParams),
    )
    forensics.rollbackEvents.push(buildForensicRollbackEvent(stage, reason, condition, {
      rowsBefore: rows, rowsAfter: mappedRows, closedQuestionIds, hybridSlotDescriptors,
      preferredVariant, seenCanonicals, seenPhysicalNumbers,
      paddedBlankBefore: paddedBefore ?? 0, paddedBlankAfter: paddedAfter ?? 0,
      failingCanonicalId: failCid, failingPhysicalRowNumber: failPhysical,
    }))
    if (forensics.snapshots.length >= 2) {
      forensics.rollbackDiff = buildRollbackDiff(forensics.snapshots[0]!, forensics.snapshots[1]!, closedQuestionIds)
    }
    // Attach forensics to a well-known key on the first input row so the caller can retrieve it
    if (rows.length > 0) {
      (rows[0] as Record<string, unknown>).__descriptorMappingForensics = forensics
    }
    return null
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const panelIndex = extractNumeric(row, "panelIndex") ?? 0
    const rowIndexWithinPanel = extractNumeric(row, "rowIndexWithinPanel") ?? i

    const descriptor = resolveDescriptorForDetectedRow(
      panelIndex,
      rowIndexWithinPanel,
      closedSlotsPerPanel,
    )

    // ── FORENSIC: trace every resolve attempt ──
    forensics.resolveDescriptorTrace.push({
      rowIndex: i,
      panelIndex,
      rowIndexWithinPanel,
      resolvedDescriptor: descriptor
        ? { physicalIndex: descriptor.physicalIndex, canonicalId: descriptor.canonicalId, slotType: descriptor.slotType }
        : null,
      fallbackPhysicalNumber: !descriptor
        ? computePhysicalRowNumber(panelIndex, rowIndexWithinPanel, preferredVariant, totalPhysicalSlots)
        : null,
    })

    if (!descriptor) {
      const formulaPhysical = computePhysicalRowNumber(panelIndex, rowIndexWithinPanel, preferredVariant, totalPhysicalSlots)
      const isDevByFormula = !closedSlotMap.has(formulaPhysical)

      descriptorRowDetails.push({
        physicalRowNumber: formulaPhysical,
        physicalNumberSource: "formula_fallback",
        descriptorSlotType: isDevByFormula ? "development" : "closed",
        descriptorItemNumber: formulaPhysical,
        descriptorCanonicalId: closedSlotMap.get(formulaPhysical) ?? `unknown_${formulaPhysical}`,
        physicalSlotMatched: false,
        skippedBecauseDevelopment: isDevByFormula,
        compactMappingPrevented: true,
        selectedAnswer: typeof row.selectedAnswer === "string" ? row.selectedAnswer : "BLANK",
        assignedCanonicalId: null,
        panelIndex,
        rowIndexWithinPanel,
      })
      compactMappingPreventedCount++
      continue
    }

    const physicalRowNumber = descriptor.physicalIndex
    const isDevelopment = descriptor.slotType === "development"
    const selectedAnswer = typeof row.selectedAnswer === "string" ? row.selectedAnswer : "BLANK"

    descriptorRowDetails.push({
      physicalRowNumber,
      physicalNumberSource: "hybridSlotDescriptors",
      descriptorSlotType: descriptor.slotType,
      descriptorItemNumber: descriptor.physicalIndex,
      descriptorCanonicalId: descriptor.canonicalId,
      physicalSlotMatched: true,
      skippedBecauseDevelopment: isDevelopment,
      compactMappingPrevented: false,
      selectedAnswer,
      assignedCanonicalId: isDevelopment ? null : descriptor.canonicalId,
      panelIndex,
      rowIndexWithinPanel,
    })

    if (isDevelopment) continue

    if (seenPhysicalNumbers.has(physicalRowNumber)) {
      console.error(
        `[omr-interleaved][DESCRIPTOR_MAPPING_ROLLBACK] Duplicate physical number ${physicalRowNumber}`,
      )
      return forensicRollbackNull(
        "row_loop_duplicate_physical", `duplicate_physical_number_${physicalRowNumber}`,
        `seenPhysicalNumbers.has(${physicalRowNumber})`, null, physicalRowNumber,
      )
    }
    seenPhysicalNumbers.add(physicalRowNumber)

    if (seenCanonicals.has(descriptor.canonicalId)) {
      console.error(
        `[omr-interleaved][DESCRIPTOR_MAPPING_ROLLBACK] Duplicate canonical ${descriptor.canonicalId}`,
      )
      return forensicRollbackNull(
        "row_loop_duplicate_canonical", `duplicate_canonical_${descriptor.canonicalId}`,
        `seenCanonicals.has(${descriptor.canonicalId})`, descriptor.canonicalId, physicalRowNumber,
      )
    }
    seenCanonicals.add(descriptor.canonicalId)

    const targetNumeric = parseClosedIdNumericSlot(descriptor.canonicalId) ?? physicalRowNumber
    mappedRows.push({
      ...row,
      questionNumber: targetNumeric,
      physicalIndex: targetNumeric,
      canonicalId: descriptor.canonicalId,
      closedInventoryMapped: true,
      universalMappingStrategy: "descriptor_physical_mapping",
      physicalRowNumberOnSheet: physicalRowNumber,
      descriptorPhysicalMappingApplied: true,
    })
  }

  // ── ROLLBACK FUERTE: nunca producir 0 filas si había filas detectadas ──
  if (mappedRows.length === 0 && rows.length > 0) {
    console.error(
      `[omr-interleaved][DESCRIPTOR_ZERO_ROWS_ROLLBACK] Descriptor mapping produced 0 rows ` +
      `from ${rows.length} input rows (${validAnswersBefore} with valid answers). ` +
      `compactPrevented=${compactMappingPreventedCount}. Aborting descriptor mapping.`,
    )
    return forensicRollbackNull(
      "zero_rows_rollback", "descriptor_produced_zero_rows",
      `mappedRows.length===0 && rows.length===${rows.length}`,
    )
  }

  // ── Anti-compaction guard ──
  const developmentDescriptors = hybridSlotDescriptors.filter((d) => d.slotType === "development")
  if (developmentDescriptors.length > 0 && mappedRows.length > 0) {
    for (let i = 0; i < mappedRows.length; i++) {
      const row = mappedRows[i]!
      const assignedCid = String(row.canonicalId ?? "")
      const assignedPhysical = Number(row.physicalRowNumberOnSheet ?? 0)

      if (assignedPhysical > 0) {
        const descAtPos = hybridSlotDescriptors.find((d) => d.physicalIndex === assignedPhysical)
        if (descAtPos && descAtPos.slotType === "development") {
          console.error(
            `[omr-interleaved][DESCRIPTOR_ANTI_COMPACTION] Row ${i} mapped to ` +
            `physical position ${assignedPhysical} which is a DEVELOPMENT slot ` +
            `(${descAtPos.canonicalId}). This should never happen. Rolling back.`,
          )
          return forensicRollbackNull(
            "anti_compaction_development_slot",
            `row_${i}_mapped_to_development_slot_${assignedPhysical}`,
            `descAtPos.slotType==="development"`, descAtPos.canonicalId, assignedPhysical,
          )
        }
        if (descAtPos && descAtPos.canonicalId !== assignedCid) {
          console.error(
            `[omr-interleaved][DESCRIPTOR_ANTI_COMPACTION] Row ${i} mapped to ` +
            `physical position ${assignedPhysical} -> canonical ${assignedCid} ` +
            `but descriptor says position ${assignedPhysical} -> ${descAtPos.canonicalId}. Rolling back.`,
          )
          return forensicRollbackNull(
            "anti_compaction_canonical_mismatch",
            `row_${i}_canonical_${assignedCid}_vs_descriptor_${descAtPos.canonicalId}`,
            `descAtPos.canonicalId!==${assignedCid}`, assignedCid, assignedPhysical,
          )
        }
      }
    }
  }

  // ── Pad missing closed questions with BLANK ──
  let paddedBlankCount = 0
  const diagDetectionsByCanonical = new Map<string, { answer: string; detections: number[] }>()
  for (const row of rows) {
    const diag = row.interleavedColumnGeometryDiagnostic
    if (!diag || typeof diag !== "object") continue
    const diagObj = diag as Record<string, unknown>
    const diagCid = typeof diagObj.canonicalId === "string" ? diagObj.canonicalId.trim() : ""
    if (!diagCid) continue
    const diagAnswer = typeof diagObj.selectedAnswer === "string" ? diagObj.selectedAnswer.trim().toUpperCase() : ""
    if (!/^[A-D]$/.test(diagAnswer)) continue
    const diagDet = Array.isArray(diagObj.assignedDetectionIndices)
      ? (diagObj.assignedDetectionIndices as unknown[]).filter((x): x is number => typeof x === "number")
      : []
    if (diagDet.length === 0) continue
    if (!diagDetectionsByCanonical.has(diagCid)) {
      diagDetectionsByCanonical.set(diagCid, { answer: diagAnswer, detections: diagDet })
    }
  }

  for (const closedId of closedQuestionIds) {
    if (!seenCanonicals.has(closedId)) {
      if (
        trySuppressPaddedBlankDueToPhysicalEvidence({
          mode: "descriptor_physical_mapping",
          closedId,
          closedSlotMap,
          hybridSlotDescriptors,
          mappedRows,
          seenCanonicals,
          seenPhysicalNumbers,
          rows,
          preferredVariant,
          totalPhysicalSlots,
        })
      ) {
        continue
      }

      const targetNumeric = parseClosedIdNumericSlot(closedId) ?? 0
      const diagEvidence = diagDetectionsByCanonical.get(closedId)

      if (diagEvidence) {
        console.error(
          `[omr-interleaved][DESCRIPTOR_PADDED_BLANK_VIOLATION] ` +
          `About to pad ${closedId} as BLANK but diagnostic has ` +
          `answer=${diagEvidence.answer} detections=[${diagEvidence.detections.join(",")}]`,
        )
      }

      const expectedPhysicalForTelemetry =
        resolveInventoryPhysicalRowForClosedId(closedId, closedSlotMap, hybridSlotDescriptors) ??
        targetNumeric
      logOmrInterleavedPaddedBlankGuard({
        canonicalId: closedId,
        physicalIndex: expectedPhysicalForTelemetry,
        attemptedPaddedBlank: true,
        existingPhysicalAnswerFound: false,
        action: "created_padded_blank_no_prior_physical_evidence",
        guardMode: "descriptor_physical_mapping",
      })

      paddedBlankCount++
      mappedRows.push({
        selectedAnswer: "BLANK",
        questionNumber: targetNumeric,
        physicalIndex: targetNumeric,
        canonicalId: closedId,
        closedInventoryMapped: true,
        universalMappingStrategy: "descriptor_physical_mapping",
        physicalRowNumberOnSheet: targetNumeric,
        physicalNumberPreservedPaddedBlank: true,
        interleavedPipeline: true,
        descriptorPhysicalMappingApplied: true,
        ...(diagEvidence ? {
          paddedBlankDiagnosticViolation: true,
          paddedBlankDiagnosticAnswer: diagEvidence.answer,
          paddedBlankDiagnosticDetections: diagEvidence.detections,
        } : {}),
      })
    }
  }

  // ── ROLLBACK FUERTE: no perder respuestas válidas ni detections ──
  const validAnswersAfterMapping = mappedRows.filter((r) => {
    const ans = typeof r.selectedAnswer === "string" ? r.selectedAnswer.trim().toUpperCase() : ""
    return VALID_ANSWER_RE.test(ans)
  }).length
  const rowsWithDetectionsAfter = mappedRows.filter((r) => {
    const det = r.assignedDetectionIndices
    return Array.isArray(det) && det.length > 0
  }).length

  if (validAnswersAfterMapping < validAnswersBefore) {
    console.error(
      `[omr-interleaved][DESCRIPTOR_VALID_ANSWERS_ROLLBACK] ` +
      `Valid answers decreased: before=${validAnswersBefore} after=${validAnswersAfterMapping}. ` +
      `paddedBlank=${paddedBlankCount}. Rolling back.`,
    )
    return forensicRollbackNull(
      "valid_answers_rollback",
      `valid_answers_decreased_${validAnswersBefore}_to_${validAnswersAfterMapping}`,
      `validAnswersAfterMapping(${validAnswersAfterMapping}) < validAnswersBefore(${validAnswersBefore})`,
      null, null, 0, paddedBlankCount,
    )
  }

  if (rowsWithDetectionsAfter < rowsWithDetectionsBefore) {
    console.error(
      `[omr-interleaved][DESCRIPTOR_DETECTIONS_ROLLBACK] ` +
      `Rows with assignedDetectionIndices decreased: before=${rowsWithDetectionsBefore} after=${rowsWithDetectionsAfter}. ` +
      `Rolling back.`,
    )
    return forensicRollbackNull(
      "detections_rollback",
      `detections_decreased_${rowsWithDetectionsBefore}_to_${rowsWithDetectionsAfter}`,
      `rowsWithDetectionsAfter(${rowsWithDetectionsAfter}) < rowsWithDetectionsBefore(${rowsWithDetectionsBefore})`,
      null, null, 0, paddedBlankCount,
    )
  }

  // ── Invariant validations ──
  const invariantViolation = validateMappingInvariants(mappedRows, rows, closedQuestionIds, diagDetectionsByCanonical)
  if (invariantViolation) {
    console.error(
      `[omr-interleaved][DESCRIPTOR_INVARIANT_ROLLBACK] ${invariantViolation}`,
    )
    return forensicRollbackNull(
      "invariant_rollback", invariantViolation, invariantViolation,
      null, null, 0, paddedBlankCount,
    )
  }

  mappedRows.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))

  const mappingAfter = mappedRows.map((r, i) => ({
    idx: i,
    canonicalId: String(r.canonicalId ?? ""),
    physicalIndex: Number(r.physicalIndex ?? 0),
  }))

  const sortOrder: RebuildQuestionSortOrder =
    preferredVariant === "sequential_dual_column" ? "panel_then_y" : "y_then_panel"

  const descriptorTelemetry: DescriptorPhysicalMappingTelemetry = {
    descriptorMappingEnabled: true,
    descriptorMappingApplied: true,
    descriptorMappingFallbackReason: null,
    totalDescriptorSlots: hybridSlotDescriptors.length,
    closedDescriptorSlots: hybridSlotDescriptors.filter((d) => d.slotType === "closed").length,
    developmentDescriptorSlots: developmentDescriptors.length,
    invariantRollbackReason: null,
    rowDetails: descriptorRowDetails,
    paddedBlankCount,
    compactMappingPreventedCount,
  }

  // ── FORENSIC: success path — record healthy snapshot ──
  forensics.snapshots.push(buildForensicSnapshot("last_healthy_state", {
    rows, mappedRows, closedQuestionIds, hybridSlotDescriptors,
    preferredVariant, totalPhysicalSlots,
    seenCanonicals, seenPhysicalNumbers,
    paddedBlankCount,
  }))

  return {
    orderedRows: mappedRows,
    strategy: {
      name: "descriptor_physical_mapping",
      sortOrder,
      score: 100,
      reasons: [
        "physical_row_from_hybridSlotDescriptors",
        `development_slots_skipped=${developmentDescriptors.length}`,
        paddedBlankCount > 0 ? `padded_${paddedBlankCount}_blank_entries` : "no_padding_needed",
        compactMappingPreventedCount > 0 ? `compact_mapping_prevented=${compactMappingPreventedCount}` : "no_compact_prevented",
      ],
      orderedIndices: mappedRows.map((_, i) => i),
      yMonotonicity: 1,
      panelBalance: 1,
      ocrConsistency: 1,
      noDuplicates: true,
    },
    success: true,
    telemetry: {
      enabled: true,
      strategyCandidates: [],
      strategyChosen: "descriptor_physical_mapping",
      strategyReason: "hybridSlotDescriptors_source_of_truth",
      mappingBefore,
      mappingAfter,
      rowsCount: rows.length,
      closedInventoryCount: closedQuestionIds.length,
      duplicatedCanonicalIds: [],
      missingCanonicalIds: [],
      extraCanonicalIds: [],
      rollbackReason: null,
      applied: true,
      descriptorPhysicalMapping: descriptorTelemetry,
      descriptorMappingForensics: forensics,
    },
  }
}

/**
 * Validates invariants that must hold after descriptor-based mapping:
 * - No closed question with prior real physical evidence can become BLANK
 * - No increase in paddedBlank count vs input
 * - Valid answer count must not decrease
 * Returns null if all invariants pass, or a violation description.
 */
function validateMappingInvariants(
  mappedRows: Array<Record<string, unknown>>,
  originalRows: Array<Record<string, unknown>>,
  closedQuestionIds: string[],
  diagDetectionsByCanonical: Map<string, { answer: string; detections: number[] }>,
): string | null {
  const VALID_ANSWER_RE = /^[A-D]$/

  const validAnswersBefore = originalRows.filter((r) => {
    const ans = typeof r.selectedAnswer === "string" ? r.selectedAnswer.trim().toUpperCase() : ""
    return VALID_ANSWER_RE.test(ans)
  }).length

  const validAnswersAfter = mappedRows.filter((r) => {
    const ans = typeof r.selectedAnswer === "string" ? r.selectedAnswer.trim().toUpperCase() : ""
    return VALID_ANSWER_RE.test(ans)
  }).length

  if (validAnswersAfter < validAnswersBefore) {
    return `valid_answers_decreased: before=${validAnswersBefore} after=${validAnswersAfter}`
  }

  const paddedBlankAfter = mappedRows.filter((r) => r.physicalNumberPreservedPaddedBlank === true).length

  for (const closedId of closedQuestionIds) {
    const diagEvidence = diagDetectionsByCanonical.get(closedId)
    if (!diagEvidence) continue

    const mappedRow = mappedRows.find((r) => String(r.canonicalId ?? "") === closedId)
    if (!mappedRow) {
      return `closed_id_${closedId}_has_diagnostic_evidence_but_not_in_mapped_output`
    }

    const mappedAnswer = typeof mappedRow.selectedAnswer === "string"
      ? mappedRow.selectedAnswer.trim().toUpperCase() : "BLANK"

    if (mappedAnswer === "BLANK" && mappedRow.physicalNumberPreservedPaddedBlank === true) {
      return `closed_id_${closedId}_has_real_evidence_answer=${diagEvidence.answer}_but_became_paddedBlank`
    }
  }

  return null
}

/**
 * Physical-number-preserved mapping: maps each row by its computed physical
 * position on the sheet (from panelIndex + rowIndexWithinPanel + variant).
 * Rows at development positions are skipped. Missing closed positions are
 * padded with BLANK entries.
 *
 * CRITICAL: Does NOT use loop index as physicalRowNumber. Uses row metadata.
 * This prevents compaction bugs when rows.length != totalPhysicalSlots.
 */
function applyPhysicalNumberPreservedMapping(params: {
  rows: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  closedSlotMap: Map<number, string>
  totalPhysicalSlots: number
  preferredVariant: string
  hybridSlotDescriptors?: HybridSlotDescriptor[]
}): UniversalPhysicalMappingResult {
  const { rows, closedQuestionIds, closedSlotMap, totalPhysicalSlots, preferredVariant } = params

  // ── Telemetry for descriptor mapping attempt ──
  let descriptorMappingAttempted = false
  let descriptorMappingApplied = false
  let descriptorMappingRollback = false
  let descriptorMappingRollbackReason: string | null = null
  let capturedDescriptorForensics: DescriptorMappingForensics | null = null

  // ── Try descriptor-based mapping first (source of truth) ──
  if (isInterleavedDescriptorPhysicalMappingEnabled() && params.hybridSlotDescriptors) {
    descriptorMappingAttempted = true
    const validationError = validateDescriptorsForMapping(params.hybridSlotDescriptors, closedQuestionIds)
    if (!validationError) {
      const descriptorResult = applyDescriptorPhysicalMapping({
        rows,
        closedQuestionIds,
        closedSlotMap,
        totalPhysicalSlots,
        preferredVariant,
        hybridSlotDescriptors: params.hybridSlotDescriptors,
      })
      if (descriptorResult) {
        descriptorMappingApplied = true
        console.log(
          `[omr-interleaved][DESCRIPTOR_PHYSICAL_MAPPING] Successfully applied. ` +
          `Rows=${rows.length}, closedSlots=${closedQuestionIds.length}, ` +
          `devSlots=${params.hybridSlotDescriptors.filter((d) => d.slotType === "development").length}`,
        )
        return descriptorResult
      }
      descriptorMappingRollback = true
      descriptorMappingRollbackReason = "invariant_violation_or_collision"
      // ── FORENSIC: recover forensics attached by applyDescriptorPhysicalMapping on null ──
      if (rows.length > 0 && (rows[0] as Record<string, unknown>).__descriptorMappingForensics) {
        capturedDescriptorForensics = (rows[0] as Record<string, unknown>).__descriptorMappingForensics as DescriptorMappingForensics
        delete (rows[0] as Record<string, unknown>).__descriptorMappingForensics
      }
      console.log(
        `[omr-interleaved][DESCRIPTOR_PHYSICAL_MAPPING] Returned null (invariant violation or collision). ` +
        `Falling back to formula-based mapping.`,
      )
    } else {
      descriptorMappingRollbackReason = validationError
      // ── FORENSIC: record validation rejection ──
      capturedDescriptorForensics = createDescriptorMappingForensicsCollector()
      capturedDescriptorForensics.validationResult = validationError
      console.log(
        `[omr-interleaved][DESCRIPTOR_PHYSICAL_MAPPING] Descriptors not suitable: ${validationError}. ` +
        `Falling back to formula-based mapping.`,
      )
    }
  }

  const rowsCountMismatch = rows.length !== totalPhysicalSlots

  const mappingBefore = rows.map((r, i) => ({
    idx: i,
    canonicalId: typeof r.canonicalId === "string" ? r.canonicalId : null,
    physicalIndex: typeof r.physicalIndex === "number" ? r.physicalIndex : null,
  }))

  const rowTelemetryDetails: PhysicalNumberPreservedRowTelemetry[] = []
  const mappedRows: Array<Record<string, unknown>> = []
  const seenCanonicals = new Set<string>()
  const seenPhysicalNumbers = new Set<number>()

  const buildPreservedTelemetry = (
    success: boolean,
    paddedCount: number,
  ): PhysicalNumberPreservedTelemetry => ({
    physicalNumberPreservedMapping: success,
    compactClosedInventoryMappingUsed: false,
    totalPhysicalSlots,
    closedSlotCount: closedSlotMap.size,
    developmentSlotCount: totalPhysicalSlots - closedSlotMap.size,
    detectedMode: "physical_number_preserved",
    rowDetails: rowTelemetryDetails,
    physicalNumberMappingActivatedDespiteRowsCountMismatch: rowsCountMismatch,
    physicalNumberMappingReason: rowsCountMismatch
      ? `activated_with_rows=${rows.length}_totalSlots=${totalPhysicalSlots}`
      : "rows_count_matches_total_slots",
    paddedBlankCount: paddedCount,
  })

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const panelIndex = extractNumeric(row, "panelIndex") ?? 0
    const rowIndexWithinPanel = extractNumeric(row, "rowIndexWithinPanel") ?? i

    const physicalRowNumber = computePhysicalRowNumber(
      panelIndex,
      rowIndexWithinPanel,
      preferredVariant,
      totalPhysicalSlots,
    )

    const closedId = closedSlotMap.get(physicalRowNumber) ?? null
    const isDevelopment = closedId === null
    const selectedAnswer = typeof row.selectedAnswer === "string" ? row.selectedAnswer : "BLANK"

    rowTelemetryDetails.push({
      physicalRowNumber,
      expectedCanonicalFromPhysicalNumber: closedId,
      skippedBecauseDevelopment: isDevelopment,
      rowWasSkippedBecauseNotClosed: isDevelopment,
      selectedAnswer,
      assignedCanonicalId: isDevelopment ? null : closedId,
      panelIndex,
      rowIndexWithinPanel,
      physicalNumberMappingReason: isDevelopment
        ? `physical_row_${physicalRowNumber}_is_development`
        : `physical_row_${physicalRowNumber}_maps_to_${closedId}`,
    })

    if (isDevelopment) continue

    if (seenPhysicalNumbers.has(physicalRowNumber)) {
      return {
        orderedRows: rows,
        strategy: null,
        success: false,
        telemetry: {
          ...buildEmptyTelemetry(
            rows,
            closedQuestionIds,
            mappingBefore,
            `physical_preserved_duplicate_physical_number: ${physicalRowNumber} (panel=${panelIndex} rowIdx=${rowIndexWithinPanel})`,
          ),
          physicalNumberPreserved: buildPreservedTelemetry(false, 0),
          ...(capturedDescriptorForensics ? { descriptorMappingForensics: capturedDescriptorForensics } : {}),
        },
      }
    }
    seenPhysicalNumbers.add(physicalRowNumber)

    if (seenCanonicals.has(closedId)) {
      return {
        orderedRows: rows,
        strategy: null,
        success: false,
        telemetry: {
          ...buildEmptyTelemetry(
            rows,
            closedQuestionIds,
            mappingBefore,
            `physical_preserved_duplicate_canonical: "${closedId}" at physical row ${physicalRowNumber}`,
          ),
          physicalNumberPreserved: buildPreservedTelemetry(false, 0),
          ...(capturedDescriptorForensics ? { descriptorMappingForensics: capturedDescriptorForensics } : {}),
        },
      }
    }
    seenCanonicals.add(closedId)

    const targetNumeric = parseClosedIdNumericSlot(closedId) ?? physicalRowNumber
    mappedRows.push({
      ...row,
      questionNumber: targetNumeric,
      physicalIndex: targetNumeric,
      canonicalId: closedId,
      closedInventoryMapped: true,
      universalMappingStrategy: "physical_number_preserved",
      physicalRowNumberOnSheet: physicalRowNumber,
    })
  }

  // --- Defensive assertion: detect compaction corruption ---
  // If a mixed exam with gaps has rowIndexWithinPanel 1 in panel 0 mapping
  // to C3, that signals the old compact mapping leaked through.
  for (const detail of rowTelemetryDetails) {
    if (
      detail.panelIndex === 0 &&
      detail.rowIndexWithinPanel === 1 &&
      detail.assignedCanonicalId != null
    ) {
      const assignedNum = parseClosedIdNumericSlot(detail.assignedCanonicalId)
      if (assignedNum != null && assignedNum > 2 && detail.physicalRowNumber === 2) {
        console.error(
          `[omr-interleaved][PHYSICAL_NUMBER_PRESERVED_ASSERTION] ` +
          `Panel 0, rowIndexWithinPanel 1 mapped to ${detail.assignedCanonicalId} ` +
          `but physicalRowNumber=2 which should be development. ` +
          `This indicates compaction corruption — rolling back.`,
        )
        return {
          orderedRows: rows,
          strategy: null,
          success: false,
          telemetry: {
            ...buildEmptyTelemetry(
              rows,
              closedQuestionIds,
              mappingBefore,
              `physical_preserved_assertion_failed: rowIdxPanel=1 panel=0 -> ${detail.assignedCanonicalId} at physRow=2`,
            ),
            physicalNumberPreserved: buildPreservedTelemetry(false, 0),
            ...(capturedDescriptorForensics ? { descriptorMappingForensics: capturedDescriptorForensics } : {}),
          },
        }
      }
    }
  }

  // ── Diagnostic Canonical Reconciliation ──────────────────────────────────
  // When a row's interleavedColumnGeometryDiagnostic.canonicalId (set by
  // column-geometry-validation with correct physical evidence) differs from
  // the canonicalId assigned by computePhysicalRowNumber, AND the diagnostic
  // canonical is missing from seenCanonicals, trust the diagnostic and
  // reassign the row. This prevents the bug where a row with real physical
  // detection ends up with a wrong canonical (e.g., C25 instead of C27)
  // while the correct canonical gets created as a paddedBlank.
  //
  // Reversible: INTERLEAVED_DIAGNOSTIC_CANONICAL_RECONCILIATION=0
  let diagnosticReconciliationCount = 0
  const diagnosticReconciliationLog: Array<{
    rowIdx: number
    fromCanonical: string
    toCanonical: string
    diagnosticAnswer: string
    diagnosticDetections: number[]
  }> = []

  if (isInterleavedDiagnosticCanonicalReconciliationEnabled()) {
    const VALID_ANSWER_RE = /^[A-D]$/

    const diagClaims = new Map<
      string,
      { rowIdx: number; answer: string; detections: number[] }
    >()

    for (let i = 0; i < mappedRows.length; i++) {
      const row = mappedRows[i]!
      const diag = row.interleavedColumnGeometryDiagnostic
      if (!diag || typeof diag !== "object") continue
      const diagObj = diag as Record<string, unknown>
      const diagCid =
        typeof diagObj.canonicalId === "string" ? diagObj.canonicalId.trim() : ""
      if (!diagCid) continue
      const diagAnswer =
        typeof diagObj.selectedAnswer === "string"
          ? diagObj.selectedAnswer.trim().toUpperCase()
          : ""
      if (!VALID_ANSWER_RE.test(diagAnswer)) continue
      const diagDetections = Array.isArray(diagObj.assignedDetectionIndices)
        ? (diagObj.assignedDetectionIndices as unknown[]).filter(
            (x): x is number => typeof x === "number",
          )
        : []
      if (diagDetections.length === 0) continue

      const currentCid = String(row.canonicalId ?? "")
      if (currentCid === diagCid) continue

      if (!diagClaims.has(diagCid)) {
        diagClaims.set(diagCid, { rowIdx: i, answer: diagAnswer, detections: diagDetections })
      }
    }

    let reconciliationChanged = true
    let maxPasses = 5
    while (reconciliationChanged && maxPasses > 0) {
      reconciliationChanged = false
      maxPasses--

      for (const closedId of closedQuestionIds) {
        if (seenCanonicals.has(closedId)) continue
        const claim = diagClaims.get(closedId)
        if (!claim) continue

        const { rowIdx, answer, detections } = claim
        const row = mappedRows[rowIdx]!
        const oldCid = String(row.canonicalId ?? "")
        if (oldCid === closedId) continue

        seenCanonicals.delete(oldCid)
        seenCanonicals.add(closedId)

        const targetNumeric = parseClosedIdNumericSlot(closedId) ?? 0

        mappedRows[rowIdx] = {
          ...row,
          canonicalId: closedId,
          physicalIndex: targetNumeric,
          questionNumber: targetNumeric,
          diagnosticCanonicalReconciled: true,
          diagnosticCanonicalReconciledFrom: oldCid,
          diagnosticCanonicalReconciledTo: closedId,
        }

        diagClaims.delete(closedId)
        diagnosticReconciliationCount++
        diagnosticReconciliationLog.push({
          rowIdx,
          fromCanonical: oldCid,
          toCanonical: closedId,
          diagnosticAnswer: answer,
          diagnosticDetections: detections,
        })

        rowTelemetryDetails.push({
          physicalRowNumber: targetNumeric,
          expectedCanonicalFromPhysicalNumber: closedId,
          skippedBecauseDevelopment: false,
          rowWasSkippedBecauseNotClosed: false,
          selectedAnswer: answer,
          assignedCanonicalId: closedId,
          panelIndex: typeof row.panelIndex === "number" ? (row.panelIndex as number) : -1,
          rowIndexWithinPanel:
            typeof row.rowIndexWithinPanel === "number"
              ? (row.rowIndexWithinPanel as number)
              : -1,
          physicalNumberMappingReason:
            `diagnostic_canonical_reconciled_from_${oldCid}_to_${closedId}`,
        })

        reconciliationChanged = true
      }
    }

    if (diagnosticReconciliationCount > 0) {
      console.log(
        `[omr-interleaved][DIAGNOSTIC_CANONICAL_RECONCILIATION] ` +
        `Reconciled ${diagnosticReconciliationCount} row(s): ` +
        diagnosticReconciliationLog
          .map((r) => `${r.fromCanonical}->${r.toCanonical}(answer=${r.diagnosticAnswer})`)
          .join(", "),
      )
    }
  }

  // ── Assertion: build diagnostic detection index for paddedBlank guard ──
  const diagDetectionsByCanonical = new Map<string, { answer: string; detections: number[] }>()
  for (const row of rows) {
    const diag = row.interleavedColumnGeometryDiagnostic
    if (!diag || typeof diag !== "object") continue
    const diagObj = diag as Record<string, unknown>
    const diagCid = typeof diagObj.canonicalId === "string" ? diagObj.canonicalId.trim() : ""
    if (!diagCid) continue
    const diagAnswer =
      typeof diagObj.selectedAnswer === "string"
        ? diagObj.selectedAnswer.trim().toUpperCase()
        : ""
    if (!/^[A-D]$/.test(diagAnswer)) continue
    const diagDet = Array.isArray(diagObj.assignedDetectionIndices)
      ? (diagObj.assignedDetectionIndices as unknown[]).filter(
          (x): x is number => typeof x === "number",
        )
      : []
    if (diagDet.length === 0) continue
    if (!diagDetectionsByCanonical.has(diagCid)) {
      diagDetectionsByCanonical.set(diagCid, { answer: diagAnswer, detections: diagDet })
    }
  }

  // Pad missing closed questions with BLANK entries so output count matches
  let paddedBlankCount = 0
  for (const closedId of closedQuestionIds) {
    if (!seenCanonicals.has(closedId)) {
      if (
        trySuppressPaddedBlankDueToPhysicalEvidence({
          mode: "physical_number_preserved",
          closedId,
          closedSlotMap,
          hybridSlotDescriptors: params.hybridSlotDescriptors,
          mappedRows,
          seenCanonicals,
          seenPhysicalNumbers,
          rows,
          preferredVariant,
          totalPhysicalSlots,
        })
      ) {
        continue
      }

      const targetNumeric = parseClosedIdNumericSlot(closedId) ?? 0

      // ── Assertion: prohibit paddedBlank when a diagnostic detection exists ──
      const diagEvidence = diagDetectionsByCanonical.get(closedId)
      if (diagEvidence) {
        console.error(
          `[omr-interleaved][PADDED_BLANK_ASSERTION_VIOLATION] ` +
          `About to create physicalNumberPreservedPaddedBlank for ${closedId} ` +
          `but interleavedColumnGeometryDiagnostic has canonicalId=${closedId} ` +
          `with selectedAnswer=${diagEvidence.answer} and ` +
          `assignedDetectionIndices=[${diagEvidence.detections.join(",")}]. ` +
          `This indicates the diagnostic canonical reconciliation did not fully resolve. ` +
          `diagnosticReconciliationCount=${diagnosticReconciliationCount} ` +
          `reconciliationLog=${JSON.stringify(diagnosticReconciliationLog)}`,
        )
      }

      const expectedPhysicalForTelemetry =
        resolveInventoryPhysicalRowForClosedId(closedId, closedSlotMap, params.hybridSlotDescriptors) ??
        targetNumeric
      logOmrInterleavedPaddedBlankGuard({
        canonicalId: closedId,
        physicalIndex: expectedPhysicalForTelemetry,
        attemptedPaddedBlank: true,
        existingPhysicalAnswerFound: false,
        action: "created_padded_blank_no_prior_physical_evidence",
        guardMode: "physical_number_preserved",
      })

      paddedBlankCount++
      mappedRows.push({
        selectedAnswer: "BLANK",
        questionNumber: targetNumeric,
        physicalIndex: targetNumeric,
        canonicalId: closedId,
        closedInventoryMapped: true,
        universalMappingStrategy: "physical_number_preserved",
        physicalRowNumberOnSheet: targetNumeric,
        physicalNumberPreservedPaddedBlank: true,
        interleavedPipeline: true,
        ...(diagEvidence
          ? {
              paddedBlankDiagnosticViolation: true,
              paddedBlankDiagnosticAnswer: diagEvidence.answer,
              paddedBlankDiagnosticDetections: diagEvidence.detections,
            }
          : {}),
      })
      rowTelemetryDetails.push({
        physicalRowNumber: targetNumeric,
        expectedCanonicalFromPhysicalNumber: closedId,
        skippedBecauseDevelopment: false,
        rowWasSkippedBecauseNotClosed: false,
        selectedAnswer: "BLANK",
        assignedCanonicalId: closedId,
        panelIndex: -1,
        rowIndexWithinPanel: -1,
        physicalNumberMappingReason: diagEvidence
          ? `padded_blank_DIAGNOSTIC_VIOLATION_for_${closedId}`
          : `padded_blank_no_detected_row_for_${closedId}`,
      })
    }
  }

  // ── ROLLBACK FUERTE (formula path): no producir 0 filas si había rows detectadas ──
  const VALID_ANSWER_RE = /^[A-D]$/
  const validAnswersBefore = rows.filter((r) => {
    const ans = typeof r.selectedAnswer === "string" ? r.selectedAnswer.trim().toUpperCase() : ""
    return VALID_ANSWER_RE.test(ans)
  }).length

  const nonPaddedMapped = mappedRows.filter((r) => r.physicalNumberPreservedPaddedBlank !== true)
  const validAnswersAfter = nonPaddedMapped.filter((r) => {
    const ans = typeof r.selectedAnswer === "string" ? r.selectedAnswer.trim().toUpperCase() : ""
    return VALID_ANSWER_RE.test(ans)
  }).length

  if (nonPaddedMapped.length === 0 && rows.length > 0) {
    console.error(
      `[omr-interleaved][PHYSICAL_PRESERVED_ZERO_ROWS_ROLLBACK] Formula mapping ` +
      `produced 0 real rows from ${rows.length} input rows (${validAnswersBefore} valid). ` +
      `paddedBlank=${paddedBlankCount}. ` +
      `descriptorAttempted=${descriptorMappingAttempted} descriptorRollbackReason=${descriptorMappingRollbackReason}. ` +
      `Aborting physical_number_preserved mapping.`,
    )
    return {
      orderedRows: rows,
      strategy: null,
      success: false,
      telemetry: {
        ...buildEmptyTelemetry(
          rows,
          closedQuestionIds,
          mappingBefore,
          `physical_preserved_zero_real_rows: input=${rows.length} paddedBlank=${paddedBlankCount} descriptorRollback=${descriptorMappingRollbackReason}`,
        ),
        physicalNumberPreserved: buildPreservedTelemetry(false, paddedBlankCount),
        ...(capturedDescriptorForensics ? { descriptorMappingForensics: capturedDescriptorForensics } : {}),
      },
    }
  }

  if (validAnswersAfter < validAnswersBefore && validAnswersBefore > 0) {
    console.error(
      `[omr-interleaved][PHYSICAL_PRESERVED_ANSWERS_ROLLBACK] Valid answers decreased: ` +
      `before=${validAnswersBefore} after=${validAnswersAfter} (paddedBlank=${paddedBlankCount}). ` +
      `Aborting physical_number_preserved mapping.`,
    )
    return {
      orderedRows: rows,
      strategy: null,
      success: false,
      telemetry: {
        ...buildEmptyTelemetry(
          rows,
          closedQuestionIds,
          mappingBefore,
          `physical_preserved_valid_answers_decreased: before=${validAnswersBefore} after=${validAnswersAfter}`,
        ),
        physicalNumberPreserved: buildPreservedTelemetry(false, paddedBlankCount),
        ...(capturedDescriptorForensics ? { descriptorMappingForensics: capturedDescriptorForensics } : {}),
      },
    }
  }

  mappedRows.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))

  const mappingAfter = mappedRows.map((r, i) => ({
    idx: i,
    canonicalId: String(r.canonicalId ?? ""),
    physicalIndex: Number(r.physicalIndex ?? 0),
  }))

  const sortOrder: RebuildQuestionSortOrder =
    preferredVariant === "sequential_dual_column" ? "panel_then_y" : "y_then_panel"

  return {
    orderedRows: mappedRows,
    strategy: {
      name: "physical_number_preserved",
      sortOrder,
      score: 100,
      reasons: [
        "physical_row_number_from_panel_and_rowIndex",
        rowsCountMismatch
          ? `activated_despite_rows_count_mismatch_${rows.length}_vs_${totalPhysicalSlots}`
          : "rows_count_matches_total_slots",
        paddedBlankCount > 0 ? `padded_${paddedBlankCount}_blank_entries` : "no_padding_needed",
        ...(diagnosticReconciliationCount > 0
          ? [`diagnostic_canonical_reconciliation_applied_${diagnosticReconciliationCount}_rows`]
          : []),
        ...(descriptorMappingAttempted
          ? [`descriptor_mapping_attempted=${descriptorMappingApplied ? "applied" : "rollback"}`]
          : []),
      ],
      orderedIndices: mappedRows.map((_, i) => i),
      yMonotonicity: 1,
      panelBalance: 1,
      ocrConsistency: 1,
      noDuplicates: true,
    },
    success: true,
    telemetry: {
      enabled: true,
      strategyCandidates: [],
      strategyChosen: "physical_number_preserved",
      strategyReason: "physical_row_number_preserved_from_metadata",
      mappingBefore,
      mappingAfter,
      rowsCount: rows.length,
      closedInventoryCount: closedQuestionIds.length,
      duplicatedCanonicalIds: [],
      missingCanonicalIds: [],
      extraCanonicalIds: [],
      rollbackReason: null,
      applied: true,
      physicalNumberPreserved: buildPreservedTelemetry(true, paddedBlankCount),
      descriptorMappingAttempted,
      descriptorMappingApplied,
      descriptorMappingRollback,
      descriptorMappingRollbackReason,
      descriptorSlotsTotal: params.hybridSlotDescriptors?.length ?? 0,
      descriptorClosedSlotsCount: params.hybridSlotDescriptors?.filter((d) => d.slotType === "closed").length ?? 0,
      descriptorDevelopmentSlotsCount: params.hybridSlotDescriptors?.filter((d) => d.slotType === "development").length ?? 0,
      rowsBeforeDescriptorMapping: rows.length,
      rowsAfterDescriptorMapping: mappedRows.length,
      closedQuestionIdsCount: closedQuestionIds.length,
      physicalSlotsVsClosedSlotsOk: totalPhysicalSlots >= closedQuestionIds.length,
      ...(capturedDescriptorForensics ? { descriptorMappingForensics: capturedDescriptorForensics } : {}),
    },
  }
}

/**
 * Universal entry point: evaluates multiple ordering strategies and picks
 * the best one based on structural evidence. Does NOT use correct answers.
 *
 * When the sheet has physical numbering 1..N with interleaved development slots,
 * uses physical-number-preserved mapping (row N → question N) instead of
 * compacting closed IDs onto consecutive rows.
 */
export function resolveUniversalPhysicalMapping(params: {
  rows: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  preferredVariant: string
  templateKey?: string
  totalPhysicalSlots?: number
  hybridSlotDescriptors?: HybridSlotDescriptor[]
}): UniversalPhysicalMappingResult {
  const { rows, closedQuestionIds, preferredVariant } = params

  const mappingBefore = rows.map((r, i) => ({
    idx: i,
    canonicalId: typeof r.canonicalId === "string" ? r.canonicalId : null,
    physicalIndex: typeof r.physicalIndex === "number" ? r.physicalIndex : null,
  }))

  if (rows.length === 0 || closedQuestionIds.length === 0) {
    return {
      orderedRows: rows,
      strategy: null,
      success: false,
      telemetry: buildEmptyTelemetry(rows, closedQuestionIds, mappingBefore, "empty_input"),
    }
  }

  // --- Physical-number-preserved mode detection ---
  // Activates when closed question IDs are non-contiguous (gaps from
  // interleaved development questions) OR when hybrid slot descriptors
  // indicate development slots exist.
  // CRITICAL: Does NOT require rows.length === totalSlots. The physical
  // row number is computed from each row's panelIndex + rowIndexWithinPanel,
  // not from the loop index.
  if (isInterleavedPhysicalNumberPreservedMapEnabled()) {
    const detection = detectNonContiguousClosedSlots(closedQuestionIds)

    const totalSlots = params.totalPhysicalSlots ?? detection.maxSlot
    const hasHybridDevelopment = (params.hybridSlotDescriptors ?? []).some(
      (d) => d.slotType === "development",
    )
    const shouldUsePhysicalPreserved =
      (detection.isNonContiguous || hasHybridDevelopment) &&
      totalSlots > closedQuestionIds.length

    if (shouldUsePhysicalPreserved) {
      return applyPhysicalNumberPreservedMapping({
        rows,
        closedQuestionIds,
        closedSlotMap: detection.closedSlotMap,
        totalPhysicalSlots: totalSlots,
        preferredVariant,
        hybridSlotDescriptors: params.hybridSlotDescriptors,
      })
    }
  }

  if (rows.length !== closedQuestionIds.length) {
    return {
      orderedRows: rows,
      strategy: null,
      success: false,
      telemetry: buildEmptyTelemetry(
        rows,
        closedQuestionIds,
        mappingBefore,
        `count_mismatch: rows=${rows.length} inventory=${closedQuestionIds.length}`,
      ),
    }
  }

  const strategies: StrategyCandidate[] = []

  strategies.push(evaluateStrategy("panel_then_y", "panel_then_y", rows, closedQuestionIds))
  strategies.push(evaluateStrategy("y_then_panel", "y_then_panel", rows, closedQuestionIds))

  strategies.sort((a, b) => b.score - a.score)

  const best = strategies[0]!
  const preferredOrder: RebuildQuestionSortOrder =
    preferredVariant === "sequential_dual_column" ? "panel_then_y" : "y_then_panel"
  const preferredStrategy = strategies.find((s) => s.sortOrder === preferredOrder)

  const CONFIDENCE_THRESHOLD = 5
  let chosen: StrategyCandidate

  if (
    preferredStrategy &&
    best.sortOrder !== preferredOrder &&
    best.score - preferredStrategy.score < CONFIDENCE_THRESHOLD
  ) {
    chosen = preferredStrategy
    chosen.reasons.push(
      `preferred_by_variant_tiebreak (delta=${(best.score - preferredStrategy.score).toFixed(2)})`,
    )
  } else {
    chosen = best
  }

  const sorted = sortDecodedForRebuild([...rows], chosen.sortOrder)

  const mappedRows: Array<Record<string, unknown>> = []
  const seenCanonicals = new Set<string>()
  const duplicatedCanonicalIds: string[] = []
  const extraCanonicalIds: string[] = []
  const closedIdSet = new Set(closedQuestionIds)

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!
    const targetClosedId = closedQuestionIds[i]!
    const targetNumeric = parseClosedIdNumericSlot(targetClosedId)

    if (targetNumeric == null || targetNumeric < 1) {
      return {
        orderedRows: rows,
        strategy: chosen,
        success: false,
        telemetry: buildEmptyTelemetry(
          rows,
          closedQuestionIds,
          mappingBefore,
          `invalid_numeric_in_closed_id: "${targetClosedId}" at index ${i}`,
        ),
      }
    }

    if (seenCanonicals.has(targetClosedId)) {
      duplicatedCanonicalIds.push(targetClosedId)
    }
    seenCanonicals.add(targetClosedId)

    mappedRows.push({
      ...row,
      questionNumber: targetNumeric,
      physicalIndex: targetNumeric,
      canonicalId: targetClosedId,
      closedInventoryMapped: true,
      universalMappingStrategy: chosen.name,
    })
  }

  if (duplicatedCanonicalIds.length > 0) {
    return {
      orderedRows: rows,
      strategy: chosen,
      success: false,
      telemetry: {
        enabled: true,
        strategyCandidates: strategies,
        strategyChosen: chosen.name,
        strategyReason: `rollback_duplicate_canonicals: ${duplicatedCanonicalIds.join(",")}`,
        mappingBefore,
        mappingAfter: [],
        rowsCount: rows.length,
        closedInventoryCount: closedQuestionIds.length,
        duplicatedCanonicalIds,
        missingCanonicalIds: [],
        extraCanonicalIds,
        rollbackReason: `duplicate_canonical_ids: ${duplicatedCanonicalIds.join(",")}`,
        applied: false,
      },
    }
  }

  for (const mr of mappedRows) {
    const cid = String(mr.canonicalId ?? "")
    if (!closedIdSet.has(cid)) {
      extraCanonicalIds.push(cid)
    }
  }
  if (extraCanonicalIds.length > 0) {
    return {
      orderedRows: rows,
      strategy: chosen,
      success: false,
      telemetry: {
        enabled: true,
        strategyCandidates: strategies,
        strategyChosen: chosen.name,
        strategyReason: `rollback_extra_canonical: ${extraCanonicalIds.join(",")}`,
        mappingBefore,
        mappingAfter: [],
        rowsCount: rows.length,
        closedInventoryCount: closedQuestionIds.length,
        duplicatedCanonicalIds: [],
        missingCanonicalIds: [],
        extraCanonicalIds,
        rollbackReason: `canonical_outside_inventory: ${extraCanonicalIds.join(",")}`,
        applied: false,
      },
    }
  }

  const mappingAfter = mappedRows.map((r, i) => ({
    idx: i,
    canonicalId: String(r.canonicalId ?? ""),
    physicalIndex: Number(r.physicalIndex ?? 0),
  }))

  const missingCanonicalIds = closedQuestionIds.filter(
    (cid) => !mappedRows.some((r) => r.canonicalId === cid),
  )

  mappedRows.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))

  const bandTolerance = getInterleavedGeometryBandTolerance()
  const finalMappingAudit = buildFinalMappingAudit({
    rows,
    closedQuestionIds,
    strategies,
    chosen,
    bandTolerance,
  })

  if (finalMappingAudit.contradictionDetected) {
    console.log(
      `[omr-interleaved][universal-physical-mapping] ${finalMappingAudit.contradictionReason}`,
    )
  }

  return {
    orderedRows: mappedRows,
    strategy: chosen,
    success: true,
    telemetry: {
      enabled: true,
      strategyCandidates: strategies,
      strategyChosen: chosen.name,
      strategyReason: chosen.reasons.join("; "),
      mappingBefore,
      mappingAfter,
      rowsCount: rows.length,
      closedInventoryCount: closedQuestionIds.length,
      duplicatedCanonicalIds: [],
      missingCanonicalIds,
      extraCanonicalIds: [],
      rollbackReason: null,
      applied: true,
      finalMappingAudit,
    },
  }
}

export { buildPhysicalRows }

// ─────────────────────────────────────────────────────────────────────────────
// Geometry Band Pairing Analysis — auditoría de bandas horizontales L/R
// ─────────────────────────────────────────────────────────────────────────────

const GEOMETRY_BAND_PAIR_THRESHOLD = 0.015

function measureRowBandPairing(
  rows: Array<Record<string, unknown>>,
): GeometryBandPairingAnalysis {
  const leftYs = rows
    .filter((r) => (extractNumeric(r, "panelIndex") ?? 0) === 0)
    .map((r) => extractNumeric(r, "rowCenterY") ?? 0)
    .sort((a, b) => a - b)

  const rightYs = rows
    .filter((r) => (extractNumeric(r, "panelIndex") ?? 0) === 1)
    .map((r) => extractNumeric(r, "rowCenterY") ?? 0)
    .sort((a, b) => a - b)

  if (leftYs.length === 0 || rightYs.length === 0) {
    return {
      pairedRowBandsCount: 0,
      averagePairedYDistance: 0,
      leftPanelRows: leftYs.length,
      rightPanelRows: rightYs.length,
      rowBandPairingConfidence: 0,
      suggestedPhysicalOrderByGeometry: "panel_then_y",
      bandDetails: [],
    }
  }

  const bandDetails: GeometryBandPairingAnalysis["bandDetails"] = []
  const usedRight = new Set<number>()
  let pairedCount = 0
  let totalDistance = 0

  for (const leftY of leftYs) {
    let bestIdx = -1
    let bestDist = Infinity
    for (let r = 0; r < rightYs.length; r++) {
      if (usedRight.has(r)) continue
      const dist = Math.abs(leftY - rightYs[r]!)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = r
      }
    }
    if (bestIdx >= 0) {
      const paired = bestDist < GEOMETRY_BAND_PAIR_THRESHOLD
      bandDetails.push({ leftY, rightY: rightYs[bestIdx]!, yDistance: bestDist, paired })
      totalDistance += bestDist
      if (paired) pairedCount++
      usedRight.add(bestIdx)
    }
  }

  const maxPairs = Math.min(leftYs.length, rightYs.length)
  const avgDistance = maxPairs > 0 ? totalDistance / maxPairs : 0
  const confidence = maxPairs > 0 ? pairedCount / maxPairs : 0

  return {
    pairedRowBandsCount: pairedCount,
    averagePairedYDistance: avgDistance,
    leftPanelRows: leftYs.length,
    rightPanelRows: rightYs.length,
    rowBandPairingConfidence: confidence,
    suggestedPhysicalOrderByGeometry: confidence >= 0.6 ? "y_then_panel" : "panel_then_y",
    bandDetails,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Mapping Audit — traza end-to-end para diagnóstico
// ─────────────────────────────────────────────────────────────────────────────

function buildFinalMappingAudit(params: {
  rows: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  strategies: StrategyCandidate[]
  chosen: StrategyCandidate
  bandTolerance: number
}): InterleavedFinalMappingAudit {
  const { rows, closedQuestionIds, strategies, chosen, bandTolerance } = params

  const panelThenY = strategies.find((s) => s.name === "panel_then_y")!
  const yThenPanel = strategies.find((s) => s.name === "y_then_panel")!

  const sortedPTY = sortDecodedForRebuild([...rows], "panel_then_y")
  const sortedYTP = sortDecodedForRebuild([...rows], "y_then_panel")

  const geometryAnalysis = measureRowBandPairing(rows)

  const rowsTracked: AuditRowTracked[] = rows.map((row, i) => {
    const posInPTY = sortedPTY.indexOf(row)
    const posInYTP = sortedYTP.indexOf(row)

    const cidPTY = posInPTY >= 0 && posInPTY < closedQuestionIds.length
      ? closedQuestionIds[posInPTY]! : ""
    const cidYTP = posInYTP >= 0 && posInYTP < closedQuestionIds.length
      ? closedQuestionIds[posInYTP]! : ""

    const numPTY = parseClosedIdNumericSlot(cidPTY) ?? 0
    const numYTP = parseClosedIdNumericSlot(cidYTP) ?? 0

    const sortedChosen = chosen.sortOrder === "panel_then_y" ? sortedPTY : sortedYTP
    const posChosen = sortedChosen.indexOf(row)
    const cidChosen = posChosen >= 0 && posChosen < closedQuestionIds.length
      ? closedQuestionIds[posChosen]! : ""
    const numChosen = parseClosedIdNumericSlot(cidChosen) ?? 0

    const assignedIndices = row.assignedDetectionIndices
    const detectionIndex = Array.isArray(assignedIndices) && assignedIndices.length > 0
      ? (assignedIndices[0] as number) : null

    return {
      visualIndex: i,
      panelIndex: extractNumeric(row, "panelIndex") ?? 0,
      rowIndexWithinPanel: extractNumeric(row, "rowIndexWithinPanel") ?? i,
      rowCenterY: extractNumeric(row, "rowCenterY") ?? 0,
      selectedAnswer: extractString(row, "selectedAnswer") || "BLANK",
      detectionIndex,
      selectedMarkX: extractNumeric(row, "rowCenterX"),
      selectedMarkY: extractNumeric(row, "rowCenterY"),
      ocrNumber: extractNumeric(row, "ocrQuestionNumber"),
      canonicalIdBefore: typeof row.canonicalId === "string" ? row.canonicalId : null,
      physicalIndexBefore: typeof row.physicalIndex === "number" ? row.physicalIndex : null,
      canonicalIdAfterPanelThenY: cidPTY,
      physicalIndexAfterPanelThenY: numPTY,
      canonicalIdAfterYThenPanel: cidYTP,
      physicalIndexAfterYThenPanel: numYTP,
      canonicalIdChosen: cidChosen,
      physicalIndexChosen: numChosen,
    }
  })

  const geoSuggestion = geometryAnalysis.suggestedPhysicalOrderByGeometry
  const chosenName = chosen.name

  const contradictionDetected =
    geoSuggestion !== chosenName && geometryAnalysis.rowBandPairingConfidence >= 0.6
  const contradictionReason = contradictionDetected
    ? `ORDER_STRATEGY_CONTRADICTION: geometry suggests ${geoSuggestion} ` +
      `(confidence=${geometryAnalysis.rowBandPairingConfidence.toFixed(3)}, ` +
      `avgYDist=${geometryAnalysis.averagePairedYDistance.toFixed(5)}) ` +
      `but chosen strategy is ${chosenName}`
    : ""

  let recommendedFix = "No contradiction detected — current strategy appears consistent with geometry."
  if (contradictionDetected) {
    recommendedFix =
      `Set INTERLEAVED_GEOMETRY_ORDER_OVERRIDE=1 to enable band tolerance ` +
      `in y_then_panel sorting. This prevents L/R inversions within horizontal ` +
      `bands caused by scan noise or skew.`
  }

  return {
    rowsTracked,
    strategies: { panel_then_y: panelThenY, y_then_panel: yThenPanel },
    geometryAnalysis,
    geometrySuggestion: geoSuggestion,
    strategyChosen: chosenName,
    strategyReason: chosen.reasons.join("; "),
    contradictionDetected,
    contradictionReason,
    recommendedFix,
    bandToleranceApplied: bandTolerance,
  }
}

function buildEmptyTelemetry(
  rows: Array<Record<string, unknown>>,
  closedQuestionIds: string[],
  mappingBefore: Array<{ idx: number; canonicalId: string | null; physicalIndex: number | null }>,
  reason: string,
): UniversalMappingTelemetry {
  return {
    enabled: true,
    strategyCandidates: [],
    strategyChosen: null,
    strategyReason: null,
    mappingBefore,
    mappingAfter: [],
    rowsCount: rows.length,
    closedInventoryCount: closedQuestionIds.length,
    duplicatedCanonicalIds: [],
    missingCanonicalIds: [],
    extraCanonicalIds: [],
    rollbackReason: reason,
    applied: false,
  }
}
