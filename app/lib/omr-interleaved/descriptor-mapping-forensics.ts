/**
 * Forensic instrumentation for descriptor-based physical mapping.
 *
 * READ-ONLY OBSERVABILITY: does NOT alter any functional result.
 * 100% reversible — delete this file and remove imports to undo.
 *
 * Captures structured telemetry for every rollback / null return in
 * applyDescriptorPhysicalMapping, validateDescriptorsForMapping,
 * validateMappingInvariants, and related guards.
 */

import type { HybridSlotDescriptor } from "./hybrid-slot-topology"

// ─────────────────────────────────────────────────────────
// Per-row dump
// ─────────────────────────────────────────────────────────
export interface DescriptorForensicRowDump {
  canonicalId: string | null
  physicalIndex: number | null
  panelIndex: number
  rowIndexWithinPanel: number
  selectedAnswer: string
  assignedDetectionIndices: number[]
  nearestColumnLetterByX: string | null
  selectedAnswerMatchesNearestColumn: boolean | null
  selectedMarkX: number | null
  selectedMarkY: number | null
  decisionSource: string | null
  skippedBecauseDevelopment: boolean
  paddedBlank: boolean
  physicalNumberPreservedPaddedBlank: boolean
  descriptorSlotType: string | null
  descriptorItemNumber: number | null
  physicalSlotMatched: boolean
  mappingSource: string | null
  observedFromSensors: boolean | null
}

// ─────────────────────────────────────────────────────────
// Snapshot (pre-rollback / post-rollback)
// ─────────────────────────────────────────────────────────
export interface DescriptorForensicSnapshot {
  snapshotLabel: "last_healthy_state" | "immediately_before_return_null"
  timestamp: string

  rowsCount: number
  validAnswersCount: number
  detectionsCount: number
  paddedBlankCount: number

  closedQuestionIdsCount: number
  descriptorSlotsTotal: number
  descriptorClosedSlotsCount: number
  descriptorDevelopmentSlotsCount: number

  preferredVariant: string
  totalPhysicalSlots: number
  mappingStrategy: string

  seenCanonicals: string[]
  seenPhysicalNumbers: number[]

  duplicateCanonicals: string[]
  duplicateDetectionIndexes: number[]
  orphanCanonicals: string[]
  lostCanonicals: string[]

  rowsDump: DescriptorForensicRowDump[]
}

// ─────────────────────────────────────────────────────────
// Rollback event
// ─────────────────────────────────────────────────────────
export interface DescriptorForensicRollbackEvent {
  rollbackReason: string
  rollbackStage: string
  rollbackTimestamp: string

  rowsBefore: number
  rowsAfter: number

  validAnswersBefore: number
  validAnswersAfter: number

  detectionsBefore: number
  detectionsAfter: number

  paddedBlankBefore: number
  paddedBlankAfter: number

  closedQuestionIdsCount: number
  descriptorSlotsTotal: number
  descriptorClosedSlotsCount: number
  descriptorDevelopmentSlotsCount: number

  preferredVariant: string
  mappingStrategy: string

  duplicateCanonicals: string[]
  duplicateDetectionIndexes: number[]
  orphanCanonicals: string[]
  lostCanonicals: string[]

  canonicalBefore: string[]
  canonicalAfter: string[]

  physicalBefore: number[]
  physicalAfter: number[]

  rowIndexBefore: number[]
  rowIndexAfter: number[]

  failingCanonicalId: string | null
  failingPhysicalRowNumber: number | null
  failingCondition: string

  rowsDump: DescriptorForensicRowDump[]
}

// ─────────────────────────────────────────────────────────
// Rollback diff
// ─────────────────────────────────────────────────────────
export interface DescriptorRollbackDiff {
  canonicalsLost: string[]
  canonicalsGained: string[]
  detectionIndexesLost: number[]
  detectionIndexesGained: number[]
  rowsConvertedToBlank: string[]
  rowsPaddedNew: string[]
  rowsOrphan: string[]
  rowsDuplicated: string[]
}

// ─────────────────────────────────────────────────────────
// Full forensic report
// ─────────────────────────────────────────────────────────
export interface DescriptorMappingForensics {
  descriptorMappingForensicsVersion: 1
  collectedAt: string
  validationResult: string | null
  rollbackEvents: DescriptorForensicRollbackEvent[]
  snapshots: DescriptorForensicSnapshot[]
  rollbackDiff: DescriptorRollbackDiff | null
  closedSlotsPerPanelDump: Array<{
    panel: number
    slots: Array<{ physicalIndex: number; canonicalId: string; slotType: string }>
  }>
  resolveDescriptorTrace: Array<{
    rowIndex: number
    panelIndex: number
    rowIndexWithinPanel: number
    resolvedDescriptor: { physicalIndex: number; canonicalId: string; slotType: string } | null
    fallbackPhysicalNumber: number | null
  }>
}

// ─────────────────────────────────────────────────────────
// Builder helper (accumulator)
// ─────────────────────────────────────────────────────────
export function createDescriptorMappingForensicsCollector(): DescriptorMappingForensics {
  return {
    descriptorMappingForensicsVersion: 1,
    collectedAt: new Date().toISOString(),
    validationResult: null,
    rollbackEvents: [],
    snapshots: [],
    rollbackDiff: null,
    closedSlotsPerPanelDump: [],
    resolveDescriptorTrace: [],
  }
}

// ─────────────────────────────────────────────────────────
// Build a per-row dump from a raw row
// ─────────────────────────────────────────────────────────
export function buildForensicRowDump(
  row: Record<string, unknown>,
  overrides?: Partial<DescriptorForensicRowDump>,
): DescriptorForensicRowDump {
  const det = Array.isArray(row.assignedDetectionIndices)
    ? (row.assignedDetectionIndices as unknown[]).filter((x): x is number => typeof x === "number")
    : []

  const geo =
    row.interleavedColumnGeometryDiagnostic && typeof row.interleavedColumnGeometryDiagnostic === "object"
      ? (row.interleavedColumnGeometryDiagnostic as Record<string, unknown>)
      : null
  const amb =
    row.interleavedAmbiguityTelemetry && typeof row.interleavedAmbiguityTelemetry === "object"
      ? (row.interleavedAmbiguityTelemetry as Record<string, unknown>)
      : null

  const nearestFromRow = typeof row.nearestColumnLetterByX === "string" ? row.nearestColumnLetterByX : null
  const nearestFromGeo = geo && typeof geo.nearestColumnLetterByX === "string" ? (geo.nearestColumnLetterByX as string) : null

  const matchFromRow = typeof row.selectedAnswerMatchesNearestColumn === "boolean" ? row.selectedAnswerMatchesNearestColumn : null
  const matchFromGeo = geo && typeof geo.selectedAnswerMatchesNearestColumn === "boolean"
    ? (geo.selectedAnswerMatchesNearestColumn as boolean)
    : null

  const decisionFromRow = typeof row.decisionSource === "string" ? row.decisionSource : null
  const decisionFromAmb = amb && typeof amb.decisionSource === "string" ? (amb.decisionSource as string) : null
  const decisionFromGeo = geo && typeof geo.decisionSource === "string" ? (geo.decisionSource as string) : null

  const physicalIndex =
    typeof row.physicalIndex === "number"
      ? row.physicalIndex
      : typeof row.questionNumber === "number"
        ? row.questionNumber
        : typeof row.physicalRowNumberOnSheet === "number"
          ? row.physicalRowNumberOnSheet
          : null

  return {
    canonicalId: typeof row.canonicalId === "string" ? row.canonicalId : null,
    physicalIndex,
    panelIndex: typeof row.panelIndex === "number" ? row.panelIndex : 0,
    rowIndexWithinPanel: typeof row.rowIndexWithinPanel === "number" ? row.rowIndexWithinPanel : -1,
    selectedAnswer: typeof row.selectedAnswer === "string" ? row.selectedAnswer : "BLANK",
    assignedDetectionIndices: det,
    nearestColumnLetterByX: nearestFromRow ?? nearestFromGeo,
    selectedAnswerMatchesNearestColumn: matchFromRow ?? matchFromGeo,
    selectedMarkX: typeof row.selectedMarkX === "number" ? row.selectedMarkX : null,
    selectedMarkY: typeof row.selectedMarkY === "number" ? row.selectedMarkY : null,
    decisionSource: decisionFromRow ?? decisionFromAmb ?? decisionFromGeo,
    skippedBecauseDevelopment: row.skippedBecauseDevelopment === true,
    paddedBlank: row.physicalNumberPreservedPaddedBlank === true,
    physicalNumberPreservedPaddedBlank: row.physicalNumberPreservedPaddedBlank === true,
    descriptorSlotType: typeof row.descriptorSlotType === "string" ? row.descriptorSlotType : null,
    descriptorItemNumber: typeof row.descriptorItemNumber === "number" ? row.descriptorItemNumber : null,
    physicalSlotMatched: row.physicalSlotMatched === true || row.descriptorPhysicalMappingApplied === true,
    mappingSource: typeof row.universalMappingStrategy === "string" ? row.universalMappingStrategy : null,
    observedFromSensors: typeof row.observedFromSensors === "boolean" ? row.observedFromSensors : null,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────
// Build snapshot from current state
// ─────────────────────────────────────────────────────────
export function buildForensicSnapshot(
  label: DescriptorForensicSnapshot["snapshotLabel"],
  params: {
    rows: Array<Record<string, unknown>>
    mappedRows: Array<Record<string, unknown>>
    closedQuestionIds: string[]
    hybridSlotDescriptors: HybridSlotDescriptor[]
    preferredVariant: string
    totalPhysicalSlots: number
    seenCanonicals: Set<string>
    seenPhysicalNumbers: Set<number>
    paddedBlankCount: number
  },
): DescriptorForensicSnapshot {
  const VALID_ANSWER_RE = /^[A-D]$/
  const allRows = label === "last_healthy_state" ? params.rows : params.mappedRows

  const validAnswersCount = allRows.filter((r) => {
    const ans = typeof r.selectedAnswer === "string" ? r.selectedAnswer.trim().toUpperCase() : ""
    return VALID_ANSWER_RE.test(ans)
  }).length

  const detectionsCount = allRows.filter((r) => {
    const det = r.assignedDetectionIndices
    return Array.isArray(det) && det.length > 0
  }).length

  const allCanonicals = allRows.map((r) => typeof r.canonicalId === "string" ? r.canonicalId : "").filter(Boolean)
  const canonicalCounts = new Map<string, number>()
  for (const c of allCanonicals) {
    canonicalCounts.set(c, (canonicalCounts.get(c) ?? 0) + 1)
  }
  const duplicateCanonicals = [...canonicalCounts.entries()].filter(([, ct]) => ct > 1).map(([c]) => c)

  const allDetIndices: number[] = []
  for (const r of allRows) {
    if (Array.isArray(r.assignedDetectionIndices)) {
      for (const d of r.assignedDetectionIndices as unknown[]) {
        if (typeof d === "number") allDetIndices.push(d)
      }
    }
  }
  const detCounts = new Map<number, number>()
  for (const d of allDetIndices) {
    detCounts.set(d, (detCounts.get(d) ?? 0) + 1)
  }
  const duplicateDetectionIndexes = [...detCounts.entries()].filter(([, ct]) => ct > 1).map(([d]) => d)

  const expectedCanonicals = new Set(params.closedQuestionIds)
  const presentCanonicals = new Set(allCanonicals)
  const orphanCanonicals = [...presentCanonicals].filter((c) => !expectedCanonicals.has(c))
  const lostCanonicals = [...expectedCanonicals].filter((c) => !presentCanonicals.has(c))

  return {
    snapshotLabel: label,
    timestamp: new Date().toISOString(),
    rowsCount: allRows.length,
    validAnswersCount,
    detectionsCount,
    paddedBlankCount: params.paddedBlankCount,
    closedQuestionIdsCount: params.closedQuestionIds.length,
    descriptorSlotsTotal: params.hybridSlotDescriptors.length,
    descriptorClosedSlotsCount: params.hybridSlotDescriptors.filter((d) => d.slotType === "closed").length,
    descriptorDevelopmentSlotsCount: params.hybridSlotDescriptors.filter((d) => d.slotType === "development").length,
    preferredVariant: params.preferredVariant,
    totalPhysicalSlots: params.totalPhysicalSlots,
    mappingStrategy: "descriptor_physical_mapping",
    seenCanonicals: [...params.seenCanonicals],
    seenPhysicalNumbers: [...params.seenPhysicalNumbers],
    duplicateCanonicals,
    duplicateDetectionIndexes,
    orphanCanonicals,
    lostCanonicals,
    rowsDump: allRows.map((r) => buildForensicRowDump(r)),
  }
}

// ─────────────────────────────────────────────────────────
// Build rollback event
// ─────────────────────────────────────────────────────────
export function buildForensicRollbackEvent(
  stage: string,
  reason: string,
  failingCondition: string,
  params: {
    rowsBefore: Array<Record<string, unknown>>
    rowsAfter: Array<Record<string, unknown>>
    closedQuestionIds: string[]
    hybridSlotDescriptors: HybridSlotDescriptor[]
    preferredVariant: string
    seenCanonicals: Set<string>
    seenPhysicalNumbers: Set<number>
    paddedBlankBefore: number
    paddedBlankAfter: number
    failingCanonicalId?: string | null
    failingPhysicalRowNumber?: number | null
  },
): DescriptorForensicRollbackEvent {
  const VALID_ANSWER_RE = /^[A-D]$/
  const countValid = (rows: Array<Record<string, unknown>>) =>
    rows.filter((r) => VALID_ANSWER_RE.test(
      typeof r.selectedAnswer === "string" ? r.selectedAnswer.trim().toUpperCase() : "",
    )).length
  const countDetections = (rows: Array<Record<string, unknown>>) =>
    rows.filter((r) => Array.isArray(r.assignedDetectionIndices) && (r.assignedDetectionIndices as unknown[]).length > 0).length

  const canonicalsBefore = params.rowsBefore.map((r) => typeof r.canonicalId === "string" ? r.canonicalId : "").filter(Boolean)
  const canonicalsAfter = params.rowsAfter.map((r) => typeof r.canonicalId === "string" ? r.canonicalId : "").filter(Boolean)

  const physicalBefore = params.rowsBefore.map((r) => typeof r.physicalIndex === "number" ? r.physicalIndex : -1)
  const physicalAfter = params.rowsAfter.map((r) => typeof r.physicalIndex === "number" ? r.physicalIndex : -1)

  const rowIndexBefore = params.rowsBefore.map((_, i) => i)
  const rowIndexAfter = params.rowsAfter.map((_, i) => i)

  const canonicalSetBefore = new Set(canonicalsBefore)
  const canonicalSetAfter = new Set(canonicalsAfter)
  const orphanCanonicals = [...canonicalSetAfter].filter((c) => !new Set(params.closedQuestionIds).has(c))
  const lostCanonicals = [...new Set(params.closedQuestionIds)].filter((c) => !canonicalSetAfter.has(c))

  const canonicalCountsAfter = new Map<string, number>()
  for (const c of canonicalsAfter) canonicalCountsAfter.set(c, (canonicalCountsAfter.get(c) ?? 0) + 1)
  const duplicateCanonicals = [...canonicalCountsAfter.entries()].filter(([, ct]) => ct > 1).map(([c]) => c)

  const allDetAfter: number[] = []
  for (const r of params.rowsAfter) {
    if (Array.isArray(r.assignedDetectionIndices)) {
      for (const d of r.assignedDetectionIndices as unknown[]) {
        if (typeof d === "number") allDetAfter.push(d)
      }
    }
  }
  const detCountsAfter = new Map<number, number>()
  for (const d of allDetAfter) detCountsAfter.set(d, (detCountsAfter.get(d) ?? 0) + 1)
  const duplicateDetectionIndexes = [...detCountsAfter.entries()].filter(([, ct]) => ct > 1).map(([d]) => d)

  return {
    rollbackReason: reason,
    rollbackStage: stage,
    rollbackTimestamp: new Date().toISOString(),
    rowsBefore: params.rowsBefore.length,
    rowsAfter: params.rowsAfter.length,
    validAnswersBefore: countValid(params.rowsBefore),
    validAnswersAfter: countValid(params.rowsAfter),
    detectionsBefore: countDetections(params.rowsBefore),
    detectionsAfter: countDetections(params.rowsAfter),
    paddedBlankBefore: params.paddedBlankBefore,
    paddedBlankAfter: params.paddedBlankAfter,
    closedQuestionIdsCount: params.closedQuestionIds.length,
    descriptorSlotsTotal: params.hybridSlotDescriptors.length,
    descriptorClosedSlotsCount: params.hybridSlotDescriptors.filter((d) => d.slotType === "closed").length,
    descriptorDevelopmentSlotsCount: params.hybridSlotDescriptors.filter((d) => d.slotType === "development").length,
    preferredVariant: params.preferredVariant,
    mappingStrategy: "descriptor_physical_mapping",
    duplicateCanonicals,
    duplicateDetectionIndexes,
    orphanCanonicals,
    lostCanonicals,
    canonicalBefore: canonicalsBefore,
    canonicalAfter: canonicalsAfter,
    physicalBefore,
    physicalAfter,
    rowIndexBefore,
    rowIndexAfter,
    failingCanonicalId: params.failingCanonicalId ?? null,
    failingPhysicalRowNumber: params.failingPhysicalRowNumber ?? null,
    failingCondition,
    rowsDump: params.rowsAfter.map((r) => buildForensicRowDump(r)),
  }
}

// ─────────────────────────────────────────────────────────
// Build rollback diff comparing two snapshots
// ─────────────────────────────────────────────────────────
export function buildRollbackDiff(
  healthy: DescriptorForensicSnapshot,
  broken: DescriptorForensicSnapshot,
  closedQuestionIds: string[],
): DescriptorRollbackDiff {
  const inventory = new Set(closedQuestionIds)
  const healthyCanonicals = new Set(healthy.rowsDump.map((r) => r.canonicalId).filter(Boolean) as string[])
  const brokenCanonicals = new Set(broken.rowsDump.map((r) => r.canonicalId).filter(Boolean) as string[])
  const canonicalsLost = [...healthyCanonicals].filter((c) => !brokenCanonicals.has(c))
  const canonicalsGained = [...brokenCanonicals].filter((c) => !healthyCanonicals.has(c))

  const healthyDetections = new Set(healthy.rowsDump.flatMap((r) => r.assignedDetectionIndices))
  const brokenDetections = new Set(broken.rowsDump.flatMap((r) => r.assignedDetectionIndices))
  const detectionIndexesLost = [...healthyDetections].filter((d) => !brokenDetections.has(d))
  const detectionIndexesGained = [...brokenDetections].filter((d) => !healthyDetections.has(d))

  const healthyNonBlank = new Set(
    healthy.rowsDump.filter((r) => r.selectedAnswer !== "BLANK" && r.canonicalId).map((r) => r.canonicalId!),
  )
  const rowsConvertedToBlank = broken.rowsDump
    .filter((r) => r.selectedAnswer === "BLANK" && r.canonicalId && healthyNonBlank.has(r.canonicalId))
    .map((r) => r.canonicalId!)

  const healthyPadded = new Set(
    healthy.rowsDump.filter((r) => r.paddedBlank).map((r) => r.canonicalId ?? "?"),
  )
  const rowsPaddedNew = broken.rowsDump
    .filter((r) => r.paddedBlank && !healthyPadded.has(r.canonicalId ?? "?"))
    .map((r) => r.canonicalId ?? "?")

  const rowsOrphan = broken.rowsDump
    .filter((r) => r.canonicalId && !inventory.has(r.canonicalId))
    .map((r) => r.canonicalId!)

  const brokenCanonicalCounts = new Map<string, number>()
  for (const r of broken.rowsDump) {
    if (r.canonicalId) brokenCanonicalCounts.set(r.canonicalId, (brokenCanonicalCounts.get(r.canonicalId) ?? 0) + 1)
  }
  const rowsDuplicated = [...brokenCanonicalCounts.entries()].filter(([, ct]) => ct > 1).map(([c]) => c)

  return {
    canonicalsLost,
    canonicalsGained,
    detectionIndexesLost,
    detectionIndexesGained,
    rowsConvertedToBlank,
    rowsPaddedNew,
    rowsOrphan,
    rowsDuplicated,
  }
}

// ─────────────────────────────────────────────────────────
// Dump closedSlotsPerPanel for forensics
// ─────────────────────────────────────────────────────────
export function dumpClosedSlotsPerPanel(
  closedSlotsPerPanel: Map<number, HybridSlotDescriptor[]>,
): DescriptorMappingForensics["closedSlotsPerPanelDump"] {
  const dump: DescriptorMappingForensics["closedSlotsPerPanelDump"] = []
  for (const [panel, slots] of closedSlotsPerPanel) {
    dump.push({
      panel,
      slots: slots.map((s) => ({ physicalIndex: s.physicalIndex, canonicalId: s.canonicalId, slotType: s.slotType })),
    })
  }
  return dump.sort((a, b) => a.panel - b.panel)
}
