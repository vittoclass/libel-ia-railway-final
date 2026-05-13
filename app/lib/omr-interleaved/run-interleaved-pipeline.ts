/**
 * Pipeline OMR intercalado (aislado). No modifica azure-layout-omr-pipeline.
 */
import sharp from "sharp"
import { analyzeLayoutWithAzure, normalizeToVerticalInterleaved, parseSelectionMarks } from "./azure-layout-client"
import { extractOcrQuestionNumberHits } from "./ocr-question-numbers"
import { mapInterleavedByVariant } from "./cluster-and-decode"
import { createEmptyDebugAcc, finalizeInterleavedDebugSnapshot } from "./debug/buildInterleavedDebugSnapshot"
import { evaluateStructuralHybridGuard, mergeStructuralViolationsIntoDebug } from "./structural-hybrid-guard"
import { renderInterleavedDebugOverlayPng } from "./debug/renderInterleavedDebugOverlay"
import { renderInterleavedGeometryOverlayPng } from "./debug/renderInterleavedGeometryOverlay"
import {
  isInterleavedTightWinnerMarginClassicBridgeEnabled,
  isOmrInterleavedDebugEnabled,
  isInterleavedAutoVariantDisabled,
  isInterleavedUnsafeClassicBridgeGuardEnabled,
  getInterleavedClassicBridgeMinConfidence,
  isInterleavedC30C31AuditEnabled,
} from "./env"
import { normalizeToCanonicalId } from "../canonical-closed-id"
import { runAzureLayoutOmrPipeline } from "../omr/experimental/azure-layout-omr-pipeline"
import type { IndexedMark, OmrTemplateVariantInterleaved, LayoutMark } from "./types"
import {
  buildClosedOnlyHybridTopology,
  buildHybridSlotTopology,
  type HybridSlotTopology,
  type HybridTopologySnapshotForensics,
} from "./hybrid-slot-topology"
import { validateHybridTopologyPreMap, validateHybridPostMapPhysicalIntegrity } from "./hybrid-physical-integrity"
import {
  createInterleavedForensicSession,
  countAmbiguityRejectedFromDebugAcc,
  countMaterializedFromPerQuestion,
  deriveCollapseFromStages,
  filterPartialRowsPassingSlotChecks,
  partialSurvivalIsEligible,
  type InterleavedPipelineForensicReport,
  type InterleavedStructuralIntegrityStatus,
} from "./interleaved-pipeline-forensics"
import { resolveInterleavedDualColumnVariant } from "./detect-dual-column-variant"
import {
  applyInterleavedStructuralRealignment,
  type InterleavedStructuralRealignmentTelemetry,
} from "./interleaved-structural-realignment"
import {
  applyInterleavedDetectionGeometryRefine,
  applyCanonicalGeometryGuard,
  applyInterleavedColumnGeometryValidation,
  type InterleavedDetectionGeometryRefineTelemetry,
  type CanonicalGeometryGuardTelemetry,
  type InterleavedColumnGeometryValidationTelemetry,
} from "./interleaved-detection-geometry-refine"
import {
  applyClosedInventoryFinalMapping,
  type ClosedInventoryFinalMappingTelemetry,
} from "./closed-inventory-final-mapping"
import {
  applyExpectedPhysicalRowPreservation,
  type ExpectedPhysicalRowPreservationTelemetry,
} from "./expected-physical-row-preservation"
import {
  applyPhysicalAnswerFinalGuard,
  type PhysicalAnswerFinalGuardTelemetry,
} from "./physical-answer-final-guard"
import {
  applyDetectionIndexUniquenessGuard,
  assertNoDetectionIndexDuplicates,
  type DetectionIndexUniquenessGuardTelemetry,
} from "./detection-index-uniqueness-guard"
import {
  applyFinalBlankRecoveryFromPhysicalEvidence,
  type FinalBlankRecoveryTelemetry,
} from "./final-blank-recovery-from-physical-evidence"
import { buildInterleavedC30C31Audit } from "./c30-c31-blank-recovery-audit"
import {
  stampInitialTraces,
  recordBatchMutation,
  finalizeTraces,
  extractAndCleanTraces,
  buildTraceSummary,
  isInterleavedPipelineRowTracingEnabled,
  resetTraceCounter,
  type RowTraceRecord,
} from "./pipeline-row-tracing"

function normalizeMarksAffine(marks: LayoutMark[]): LayoutMark[] {
  if (!marks.length) return marks
  const xs = marks.map((m) => m.centerX)
  const ys = marks.map((m) => m.centerY)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const dx = Math.max(1e-6, maxX - minX)
  const dy = Math.max(1e-6, maxY - minY)
  return marks.map((m) => ({
    ...m,
    centerX: (m.centerX - minX) / dx,
    centerY: (m.centerY - minY) / dy,
    polygonNorm: m.polygonNorm.map((p) => ({ x: (p.x - minX) / dx, y: (p.y - minY) / dy })),
  }))
}

function buildHybridTopologyForensicsPayload(params: {
  topology: HybridSlotTopology
  postMap: ReturnType<typeof validateHybridPostMapPhysicalIntegrity>
  syntheticPaddingPrevented: boolean
}): HybridTopologySnapshotForensics {
  const { topology, postMap, syntheticPaddingPrevented } = params
  return {
    hybridPhysicalSlotCount: topology.physicalHybridSlotCount,
    closedOmrQuestionCount: topology.closedOmrQuestionCount,
    developmentSlotCount: topology.developmentSlotCount,
    hybridSlotMapPreview: topology.hybridSlotDescriptors.slice(0, 80),
    physicalIndexPreserved:
      topology.hasInterleavedDevelopment ? (postMap.ok ? postMap.physicalIndexPreserved : false) : null,
    syntheticPaddingPrevented,
    hybridStructuralIntegrity: postMap.ok,
  }
}

async function renderDebugSnapshots(params: {
  debugAcc: ReturnType<typeof createEmptyDebugAcc>
  closedIds: string[]
  ocrHits: ReturnType<typeof extractOcrQuestionNumberHits>
  canonicalWidth: number
  canonicalHeight: number
  perQuestionSnapshot: Array<Record<string, unknown>>
  structural: ReturnType<typeof evaluateStructuralHybridGuard>
  hybridForensics: HybridTopologySnapshotForensics
  orientationBuffer: Buffer
  pipelineForensics?: InterleavedPipelineForensicReport
  descriptorMappingForensics?: import("./descriptor-mapping-forensics").DescriptorMappingForensics
}): Promise<{
  interleavedDebugSnapshot: ReturnType<typeof finalizeInterleavedDebugSnapshot>
  interleavedDebugOverlayPngBase64: string
  interleavedGeometryDebugOverlayPngBase64: string
}> {
  const {
    debugAcc,
    closedIds,
    ocrHits,
    canonicalWidth,
    canonicalHeight,
    perQuestionSnapshot,
    structural,
    hybridForensics,
    orientationBuffer,
    pipelineForensics,
  } = params
  if (debugAcc.geometryDiagnostics) {
    debugAcc.geometryDiagnostics.warpedWidth = canonicalWidth
    debugAcc.geometryDiagnostics.warpedHeight = canonicalHeight
  }
  const interleavedDebugSnapshot = finalizeInterleavedDebugSnapshot(debugAcc, {
    ocrHits,
    closedQuestionIds: closedIds,
    maxDyOcr: 0.055,
    finalPerQuestion: perQuestionSnapshot,
    structuralHybridIntegrity: structural,
    hybridTopologyForensics: hybridForensics,
    pipelineForensics,
    descriptorMappingForensics: params.descriptorMappingForensics,
  })
  const debugPng = await renderInterleavedDebugOverlayPng({
    width: canonicalWidth,
    height: canonicalHeight,
    snapshot: interleavedDebugSnapshot,
  })
  const geometryPng = await renderInterleavedGeometryOverlayPng({
    width: canonicalWidth,
    height: canonicalHeight,
    snapshot: interleavedDebugSnapshot,
    warpedImageBuffer: orientationBuffer,
  })
  return {
    interleavedDebugSnapshot,
    interleavedDebugOverlayPngBase64: debugPng.toString("base64"),
    interleavedGeometryDebugOverlayPngBase64: geometryPng.toString("base64"),
  }
}

function isInterleavedTightMarginPendingRow(row: Record<string, unknown>): boolean {
  const tm = row.interleavedTightMarginResolution
  return !!tm && typeof tm === "object" && (tm as Record<string, unknown>).pendingClassicBridge === true
}

/** Lectura de respuesta desde fila perQuestion del pipeline azure_layout_family (sin modificar ese pipeline). */
function normalizeClassicFamilyAnswer(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null
  const ansRaw = String(row.selectedAnswer ?? "").trim().toUpperCase()
  const confidenceMapRaw =
    row.confidencesByColumn && typeof row.confidencesByColumn === "object"
      ? (row.confidencesByColumn as Record<string, unknown>)
      : {}
  const confidenceEntries = Object.entries(confidenceMapRaw)
    .map(([k, v]) => [String(k).toUpperCase(), Number(v)] as const)
    .filter(([k, v]) => /^[A-Z]$/.test(k) && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])
  const bestByConfidence = confidenceEntries[0]?.[0] ?? ""
  if (ansRaw === "MULTIPLE") {
    return /^[A-Z]$/.test(bestByConfidence) ? bestByConfidence : null
  }
  if (ansRaw === "" || ansRaw === "SIN_RESPUESTA" || ansRaw === "BLANK") return null
  if (/^[A-Z]$/.test(ansRaw)) return ansRaw
  return null
}

/**
 * Completa filas suprimidas por margen top-2: una pasada opcional por runAzureLayoutOmrPipeline (OMR clásico intacto)
 * o BLANK + revisión recomendada.
 */
async function resolveInterleavedTightMarginWithOptionalClassicFamily(params: {
  rows: Array<Record<string, unknown>>
  imageBuffer: Buffer
  templateKey: string
  expectedQuestionCount: number
  expectedOptionCount: number
  variant: OmrTemplateVariantInterleaved
  hybridStructuredQuestionOrder: string[] | undefined
  closedQuestionIds: string[]
  bridgeEnabled: boolean
}): Promise<Array<Record<string, unknown>>> {
  if (!params.rows.some(isInterleavedTightMarginPendingRow)) return params.rows

  const baseTelemetry = (row: Record<string, unknown>) =>
    (row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}

  if (!params.bridgeEnabled) {
    return params.rows.map((row) => {
      if (!isInterleavedTightMarginPendingRow(row)) return row
      const tm = row.interleavedTightMarginResolution as Record<string, unknown>
      return {
        ...row,
        selectedAnswer: "BLANK",
        assignedDetectionIndices: [],
        interleavedReviewRecommended: true,
        interleavedTightMarginResolution: { ...tm, pendingClassicBridge: false, resolvedBy: "bridge_disabled" },
        interleavedAmbiguityTelemetry: {
          ...baseTelemetry(row),
          decisionSource: "blank_tight_margin_no_classic_bridge",
          ambiguityResolutionReason: "TIGHT_MARGIN_CLASSIC_BRIDGE_DISABLED",
        },
      }
    })
  }

  const closedNorm = new Set(
    params.closedQuestionIds
      .map((id) => normalizeToCanonicalId(String(id ?? "").trim()))
      .filter((s): s is string => s != null && s.length > 0),
  )
  const pautaSegmentationItems =
    params.hybridStructuredQuestionOrder?.length && closedNorm.size > 0
      ? params.hybridStructuredQuestionOrder.map((raw) => {
          const id = normalizeToCanonicalId(String(raw ?? "").trim())
          return { isDevelopment: id != null && id.length > 0 ? !closedNorm.has(id) : false }
        })
      : undefined

  const classic = await runAzureLayoutOmrPipeline({
    imageBuffer: params.imageBuffer,
    templateKey: params.templateKey,
    expectedQuestionCount: params.expectedQuestionCount,
    expectedOptionCount: params.expectedOptionCount,
    canonicalWidth: 1200,
    canonicalHeight: 1700,
    omrTemplateVariant: params.variant,
    ...(pautaSegmentationItems?.length ? { pautaSegmentationItems } : {}),
  })

  if (!classic || (classic as Record<string, unknown>).success !== true) {
    const errCode = String((classic as Record<string, unknown> | undefined)?.errorCode ?? "CLASSIC_PIPELINE_FAILED")
    return params.rows.map((row) => {
      if (!isInterleavedTightMarginPendingRow(row)) return row
      const tm = row.interleavedTightMarginResolution as Record<string, unknown>
      return {
        ...row,
        selectedAnswer: "BLANK",
        assignedDetectionIndices: [],
        interleavedReviewRecommended: true,
        interleavedTightMarginResolution: { ...tm, pendingClassicBridge: false, classicBridgeError: errCode },
        interleavedAmbiguityTelemetry: {
          ...baseTelemetry(row),
          decisionSource: "blank_tight_margin_classic_unavailable",
          ambiguityResolutionReason: "AZURE_LAYOUT_FAMILY_BRIDGE_FAILED",
        },
      }
    })
  }

  const classicRows = Array.isArray((classic as Record<string, unknown>).perQuestion)
    ? ((classic as Record<string, unknown>).perQuestion as Array<Record<string, unknown>>)
    : []
  const byQn = new Map<number, Record<string, unknown>>()
  for (const r of classicRows) {
    const qn = Number(r?.questionNumber ?? 0)
    if (qn >= 1) byQn.set(qn, r)
  }

  const guardEnabled = isInterleavedUnsafeClassicBridgeGuardEnabled()
  const minBridgeConfidence = getInterleavedClassicBridgeMinConfidence()

  // Pre-build: índices ya usados por filas interleaved no-pending (evidencia local confirmada)
  const alreadyClaimedIndices = new Map<number, number>() // detectionIdx → questionNumber owner
  for (const row of params.rows) {
    if (isInterleavedTightMarginPendingRow(row)) continue
    const qn = Number(row.questionNumber ?? 0)
    const indices = Array.isArray(row.assignedDetectionIndices)
      ? (row.assignedDetectionIndices as unknown[]).filter((x): x is number => typeof x === "number")
      : []
    for (const idx of indices) alreadyClaimedIndices.set(idx, qn)
  }

  let bridgeOverrideAccepted = 0
  let bridgeOverrideRejected = 0
  let bridgeRejectedDueToMissingPhysicalEvidence = 0
  let bridgeRejectedDueToNonLocalDetection = 0

  const result = params.rows.map((row) => {
    if (!isInterleavedTightMarginPendingRow(row)) return row
    const tm = row.interleavedTightMarginResolution as Record<string, unknown>
    const qn = Number(row.questionNumber ?? 0)
    const classicRow = qn >= 1 ? byQn.get(qn) : undefined
    const letterAns = normalizeClassicFamilyAnswer(classicRow)

    if (letterAns) {
      const classicConf =
        classicRow && typeof classicRow.confidencesByColumn === "object" && classicRow.confidencesByColumn
          ? (classicRow.confidencesByColumn as Record<string, number>)
          : {}
      const classicDetectionIndices = classicRow && Array.isArray(classicRow.assignedDetectionIndices)
        ? (classicRow.assignedDetectionIndices as number[]).filter((x): x is number => typeof x === "number")
        : []

      const bestConfidence = Object.values(classicConf)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => b - a)[0] ?? 0
      const confValues = Object.values(classicConf)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => b - a)
      const confidenceMargin = confValues.length >= 2 ? (confValues[0]! - confValues[1]!) : 0

      const hasPhysicalDetection = classicDetectionIndices.length > 0
      const hasStrongConfidence = bestConfidence >= minBridgeConfidence && confidenceMargin >= 0.15

      // ── Validación de localidad: detectar si el bridge propone índices ya usados ──
      const nonLocalIndices = classicDetectionIndices.filter((idx) => {
        const owner = alreadyClaimedIndices.get(idx)
        return owner != null && owner !== qn
      })
      const bridgeCandidateBelongsToAnotherRow = nonLocalIndices.length > 0
      const localIndicesOnly = classicDetectionIndices.filter((idx) => !nonLocalIndices.includes(idx))
      const rowCenterY = typeof row.rowCenterY === "number" ? row.rowCenterY : -1
      const classicRowCenterY = classicRow && typeof classicRow.rowCenterY === "number" ? classicRow.rowCenterY : -1
      const rowCenterYCompatible =
        rowCenterY < 0 || classicRowCenterY < 0 || Math.abs(rowCenterY - classicRowCenterY) < 0.04

      const bridgeCandidateTelemetry = {
        bridgeCandidateAnswer: letterAns,
        bridgeCandidateConfidence: bestConfidence,
        bridgeCandidateConfidenceMargin: confidenceMargin,
        bridgeCandidateDetectionIndices: classicDetectionIndices,
        bridgeHasPhysicalDetection: hasPhysicalDetection,
        bridgeHasStrongConfidence: hasStrongConfidence,
        bridgeGuardEnabled: guardEnabled,
        bridgeCandidateBelongsToAnotherRow,
        bridgeNonLocalIndices: nonLocalIndices,
        bridgeLocalIndicesOnly: localIndicesOnly,
        bridgeRowCenterYCompatible: rowCenterYCompatible,
      }

      // Reject: bridge propone índices que pertenecen a otra fila interleaved
      if (guardEnabled && bridgeCandidateBelongsToAnotherRow && localIndicesOnly.length === 0) {
        bridgeOverrideRejected++
        bridgeRejectedDueToNonLocalDetection++
        const rowConf = row.confidencesByColumn && typeof row.confidencesByColumn === "object"
          ? row.confidencesByColumn : {}
        return {
          ...row,
          selectedAnswer: "BLANK",
          assignedDetectionIndices: [],
          confidencesByColumn: rowConf as Record<string, number>,
          interleavedReviewRecommended: true,
          interleavedTightMarginResolution: {
            ...tm,
            pendingClassicBridge: false,
            substitutedFromClassic: false,
            bridgeRejectedByGuard: true,
            bridgeRejectedDueToNonLocalDetection: true,
          },
          interleavedAmbiguityTelemetry: {
            ...baseTelemetry(row),
            decisionSource: "blank_bridge_rejected_non_local_detection",
            ambiguityResolutionReason: "BRIDGE_REJECTED_DETECTION_BELONGS_TO_ANOTHER_ROW",
            ...bridgeCandidateTelemetry,
            bridgeOverrideRejected: true,
            bridgeRejectedDueToNonLocalDetection: true,
          },
        }
      }

      if (guardEnabled && !hasPhysicalDetection && !hasStrongConfidence) {
        bridgeOverrideRejected++
        bridgeRejectedDueToMissingPhysicalEvidence++
        const rowConf = row.confidencesByColumn && typeof row.confidencesByColumn === "object"
          ? row.confidencesByColumn : {}
        return {
          ...row,
          selectedAnswer: "BLANK",
          assignedDetectionIndices: [],
          confidencesByColumn: rowConf as Record<string, number>,
          interleavedReviewRecommended: true,
          interleavedTightMarginResolution: {
            ...tm,
            pendingClassicBridge: false,
            substitutedFromClassic: false,
            bridgeRejectedByGuard: true,
          },
          interleavedAmbiguityTelemetry: {
            ...baseTelemetry(row),
            decisionSource: "blank_bridge_rejected_no_physical_evidence",
            ambiguityResolutionReason: "BRIDGE_REJECTED_MISSING_PHYSICAL_EVIDENCE",
            ...bridgeCandidateTelemetry,
            bridgeOverrideRejected: true,
            bridgeRejectedDueToMissingPhysicalEvidence: true,
          },
        }
      }

      // Si tenemos evidencia local, usar solo los índices locales (no los de otra fila)
      const safeDetectionIndices = bridgeCandidateBelongsToAnotherRow ? localIndicesOnly : classicDetectionIndices
      const hasSafePhysical = safeDetectionIndices.length > 0

      bridgeOverrideAccepted++
      // Reclamar índices aceptados para evitar doble-uso por otra fila pending
      for (const idx of safeDetectionIndices) alreadyClaimedIndices.set(idx, qn)

      const rowConf = row.confidencesByColumn && typeof row.confidencesByColumn === "object" ? row.confidencesByColumn : {}
      return {
        ...row,
        selectedAnswer: letterAns,
        assignedDetectionIndices: hasSafePhysical ? safeDetectionIndices : [],
        confidencesByColumn: Object.keys(classicConf).length > 0 ? classicConf : (rowConf as Record<string, number>),
        interleavedReviewRecommended: !hasSafePhysical,
        interleavedTightMarginResolution: {
          ...tm,
          pendingClassicBridge: false,
          substitutedFromClassic: true,
          bridgeAcceptedWithEvidence: hasSafePhysical || hasStrongConfidence,
          ...(bridgeCandidateBelongsToAnotherRow ? { bridgeNonLocalIndicesStripped: nonLocalIndices } : {}),
        },
        interleavedAmbiguityTelemetry: {
          ...baseTelemetry(row),
          decisionSource: "azure_layout_family_bridge",
          ambiguityResolutionReason: hasSafePhysical
            ? "SUBSTITUTED_FROM_AZURE_LAYOUT_FAMILY_WITH_PHYSICAL_EVIDENCE"
            : "SUBSTITUTED_FROM_AZURE_LAYOUT_FAMILY_STRONG_CONFIDENCE",
          ...bridgeCandidateTelemetry,
          bridgeOverrideAccepted: true,
        },
      }
    }
    return {
      ...row,
      selectedAnswer: "BLANK",
      assignedDetectionIndices: [],
      interleavedReviewRecommended: true,
      interleavedTightMarginResolution: { ...tm, pendingClassicBridge: false, classicHadNoLetter: true },
      interleavedAmbiguityTelemetry: {
        ...baseTelemetry(row),
        decisionSource: "blank_tight_margin",
        ambiguityResolutionReason: "TIGHT_MARGIN_CLASSIC_BLANK_OR_INVALID",
      },
    }
  })

  // ── Rollback automático: detectar contaminación post-bridge ──
  const postBridgeAnswered = result.filter(
    (r) => typeof r.selectedAnswer === "string" && r.selectedAnswer !== "BLANK" && r.selectedAnswer !== "SIN_RESPUESTA",
  )
  const postBridgeGhostAnswers = postBridgeAnswered.filter((r) => {
    const indices = Array.isArray(r.assignedDetectionIndices) ? r.assignedDetectionIndices : []
    const src = (r.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined)?.decisionSource
    return indices.length === 0 && src === "azure_layout_family_bridge"
  })

  const canonicalIds = result
    .map((r) => (typeof r.canonicalId === "string" ? r.canonicalId : null))
    .filter((s): s is string => s != null && s.length > 0)
  const canonicalDuplicates = canonicalIds.length - new Set(canonicalIds).size

  const preBridgeAnswered = params.rows.filter(
    (r) => typeof r.selectedAnswer === "string" && r.selectedAnswer !== "BLANK" && r.selectedAnswer !== "SIN_RESPUESTA",
  )
  const mismatchIncrease = postBridgeGhostAnswers.length

  const needsRollback =
    mismatchIncrease > 0 ||
    canonicalDuplicates > 0 ||
    postBridgeGhostAnswers.length > 0

  if (needsRollback && guardEnabled) {
    return params.rows.map((row) => {
      if (!isInterleavedTightMarginPendingRow(row)) return row
      const tmOrig = row.interleavedTightMarginResolution as Record<string, unknown>
      return {
        ...row,
        selectedAnswer: "BLANK",
        assignedDetectionIndices: [],
        interleavedReviewRecommended: true,
        interleavedTightMarginResolution: {
          ...tmOrig,
          pendingClassicBridge: false,
          rolledBackByPostBridgeGuard: true,
        },
        interleavedAmbiguityTelemetry: {
          ...baseTelemetry(row),
          decisionSource: "blank_bridge_rollback_post_guard",
          ambiguityResolutionReason: "BRIDGE_ROLLBACK_CONTAMINATION_DETECTED",
          bridgeRollbackTrigger: {
            ghostAnswerCount: postBridgeGhostAnswers.length,
            canonicalDuplicates,
            mismatchIncrease,
          },
          bridgeOverrideAccepted,
          bridgeOverrideRejected,
          bridgeRejectedDueToMissingPhysicalEvidence,
        },
      }
    })
  }

  return result
}

function finalizePipelineForensics(
  forensics: ReturnType<typeof createInterleavedForensicSession>,
  structuralIntegrityStatus: InterleavedStructuralIntegrityStatus,
  extraDiagnostics: string[] = [],
): InterleavedPipelineForensicReport {
  const derived = deriveCollapseFromStages(forensics.stages)
  return forensics.finalizeReport({
    firstFailedStage: derived.firstFailedStage,
    collapseStage: derived.collapseStage,
    collapseReason: derived.collapseReason,
    collapseDiagnostics: [...derived.diagnostics, ...extraDiagnostics],
    structuralIntegrityStatus,
  })
}

export async function runInterleavedAzureLayoutOmrPipeline(params: {
  imageBuffer: Buffer
  templateKey: string
  /** Cantidad esperada solo de preguntas cerradas OMR (no cap físico híbrida). Opcional pero si se omite no se valida cierre duro contra declared. */
  expectedQuestionCount?: number
  expectedOptionCount?: number
  canonicalWidth: number
  canonicalHeight: number
  omrTemplateVariant?: OmrTemplateVariantInterleaved
  /** Orden de ítems cerrados (mismo orden que officialClosedOrderIds en evaluate). */
  closedQuestionIds: string[]
  /**
   * Orden físico completo de la pauta estructurada (cerradas + desarrollo).
   * Si falta y no hay modo híbrido inferible aquí, se asume solo cerradas con índices 1..N.
   */
  hybridStructuredQuestionOrder?: string[]
}): Promise<Record<string, unknown>> {
  // [TEMP_C30_C31_AUDIT_DIAG] Logs reversibles para verificar lectura de flags en runtime.
  // Reversibilidad: borrar este bloque restaura la pipeline al estado anterior.
  const __c30AuditRawEnv = process.env.INTERLEAVED_C30_C31_AUDIT ?? null
  const __c30RecoveryRawEnv = process.env.INTERLEAVED_FINAL_BLANK_RECOVERY_FROM_PHYSICAL_EVIDENCE ?? null
  console.log("[C30_AUDIT_FLAG]", __c30AuditRawEnv)
  console.log("[C30_RECOVERY_FLAG]", __c30RecoveryRawEnv)
  console.log("[OMR_INTERLEAVED_PIPELINE_ENTRY]", {
    templateKey: params.templateKey,
    closedCount: Array.isArray(params.closedQuestionIds) ? params.closedQuestionIds.length : -1,
    c30AuditEnabledResolved: isInterleavedC30C31AuditEnabled(),
  })
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
  if (!endpoint || !key) {
    return {
      success: false,
      omrMode: "azure_layout_omr_interleaved",
      errorCode: "AZURE_LAYOUT_NOT_CONFIGURED",
      error: "Faltan AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT o AZURE_DOCUMENT_INTELLIGENCE_KEY",
    }
  }

  const apiVersion = "2024-11-30"
  const orientation = await normalizeToVerticalInterleaved(params.imageBuffer)
  const analyze = await analyzeLayoutWithAzure({
    endpoint,
    key,
    imageBuffer: orientation.buffer,
    apiVersion,
    apiVersionFallbacks: ["2024-07-31-preview", "2023-07-31"],
  })

  if (!analyze.ok) {
    return {
      success: false,
      omrMode: "azure_layout_omr_interleaved",
      errorCode: analyze.errorCode,
      error: analyze.error,
      azureInputOrientationNormalized: orientation.azureOrientationNormalizationReason,
      azureAnalyzeUsedNormalizedBuffer: orientation.azureAnalyzeUsedNormalizedBuffer,
    }
  }

  const parsed = parseSelectionMarks(analyze.analyzeResult)
  const normalizedMarks = normalizeMarksAffine(parsed.marks)
  const indexedMarks: IndexedMark[] = normalizedMarks.map((m, i) => ({ idx: i, mark: m }))

  let expectedClosedOmr: number | undefined
  if (typeof params.expectedQuestionCount === "number" && params.expectedQuestionCount > 0) {
    expectedClosedOmr = Math.floor(params.expectedQuestionCount)
  }

  const expectedOptionCount =
    typeof params.expectedOptionCount === "number" && params.expectedOptionCount >= 2
      ? Math.max(2, Math.min(8, Math.round(params.expectedOptionCount)))
      : 4

  const ocrHits = extractOcrQuestionNumberHits(analyze.analyzeResult)
  const closedIds = params.closedQuestionIds.filter((s) => String(s).trim().length > 0)
  if (!closedIds.length) {
    return {
      success: false,
      omrMode: "azure_layout_omr_interleaved",
      errorCode: "INTERLEAVED_MISSING_CLOSED_IDS",
      error: "closedQuestionIds vacío",
    }
  }

  const variantRequested: OmrTemplateVariantInterleaved =
    params.omrTemplateVariant === "single_column"
      ? "single_column"
      : params.omrTemplateVariant === "sequential_dual_column"
        ? "sequential_dual_column"
        : "odd_even_dual_column"

  const disableVariantAuto = isInterleavedAutoVariantDisabled()

  const variantAutoDiagnostics = resolveInterleavedDualColumnVariant({
    requested: variantRequested,
    ocrHits,
    closedQuestionCount: closedIds.length,
    disableAuto: disableVariantAuto,
  })
  const variant = variantAutoDiagnostics.variantEffective

  const forensics = createInterleavedForensicSession()
  forensics.recordStage("image_loaded", {
    inputCount: 1,
    outputCount: 1,
    droppedCount: 0,
    collapsed: false,
    collapseReason: null,
    invariantViolations: [],
  })
  forensics.recordStage("anchors_detected", {
    inputCount: Math.max(1, parsed.marks.length),
    outputCount: ocrHits.length,
    droppedCount: 0,
    collapsed: false,
    collapseReason: null,
    invariantViolations: [],
  })
  forensics.recordStage("candidate_bubbles_detected", {
    inputCount: parsed.marks.length,
    outputCount: indexedMarks.length,
    droppedCount: Math.max(0, parsed.marks.length - indexedMarks.length),
    collapsed: indexedMarks.length === 0,
    collapseReason: indexedMarks.length === 0 ? "no_indexed_marks_after_affine_norm" : null,
    invariantViolations: [],
  })

  const orderInput = params.hybridStructuredQuestionOrder?.map((s) => String(s).trim()).filter(Boolean)

  let topology: HybridSlotTopology
  if (orderInput?.length) {
    const hybridBuilt = buildHybridSlotTopology({
      closedQuestionIds: closedIds,
      fullStructuredQuestionOrder: orderInput,
    })
    if (!hybridBuilt.ok) {
      return {
        success: false,
        omrMode: "azure_layout_omr_interleaved",
        errorCode: hybridBuilt.errorCode,
        error: hybridBuilt.error,
        templateKey: params.templateKey,
        omrTemplateVariant: variant,
        azureInputOrientationNormalized: orientation.azureOrientationNormalizationReason,
        azureAnalyzeUsedNormalizedBuffer: orientation.azureAnalyzeUsedNormalizedBuffer,
        interleavedPipelineForensics: finalizePipelineForensics(forensics, "invalid_inconsistent", [
          "topology_build_failed_pre_map",
          hybridBuilt.error,
        ]),
      }
    }
    topology = hybridBuilt.topology
  } else {
    topology = buildClosedOnlyHybridTopology(closedIds)
  }

  const closedOmrQuestionCount = topology.closedOmrQuestionCount
  if (expectedClosedOmr != null && expectedClosedOmr !== closedOmrQuestionCount) {
    return {
      success: false,
      omrMode: "azure_layout_omr_interleaved",
      errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
      error:
        `expectedQuestionCount (${expectedClosedOmr}) no coincide con cerradas OMR (${closedOmrQuestionCount}). ` +
        "Use expectedQuestionCount solo como conteo cerrado evaluable.",
      hybridStructuralForensics: {
        hybridPhysicalSlotCount: topology.physicalHybridSlotCount,
        closedOmrQuestionCount: topology.closedOmrQuestionCount,
        developmentSlotCount: topology.developmentSlotCount,
        hybridSlotMapPreview: topology.hybridSlotDescriptors.slice(0, 40),
        physicalIndexPreserved: null,
        syntheticPaddingPrevented: true,
        hybridStructuralIntegrity: false,
      },
      templateKey: params.templateKey,
      omrTemplateVariant: variant,
      azureInputOrientationNormalized: orientation.azureOrientationNormalizationReason,
      azureAnalyzeUsedNormalizedBuffer: orientation.azureAnalyzeUsedNormalizedBuffer,
      interleavedPipelineForensics: finalizePipelineForensics(forensics, "invalid_inconsistent", [
        `expected_closed_omr_mismatch expected=${expectedClosedOmr} topology_closed=${closedOmrQuestionCount}`,
      ]),
    }
  }

  const preHybridMap = validateHybridTopologyPreMap(topology, closedIds)
  if (!preHybridMap.ok) {
    return {
      success: false,
      omrMode: "azure_layout_omr_interleaved",
      errorCode: preHybridMap.errorCode,
      error: preHybridMap.error,
      templateKey: params.templateKey,
      omrTemplateVariant: variant,
      hybridStructuralForensics: {
        hybridPhysicalSlotCount: topology.physicalHybridSlotCount,
        closedOmrQuestionCount: topology.closedOmrQuestionCount,
        developmentSlotCount: topology.developmentSlotCount,
        hybridSlotMapPreview: topology.hybridSlotDescriptors.slice(0, 40),
        physicalIndexPreserved: null,
        syntheticPaddingPrevented: true,
        hybridStructuralIntegrity: false,
      },
      azureInputOrientationNormalized: orientation.azureOrientationNormalizationReason,
      azureAnalyzeUsedNormalizedBuffer: orientation.azureAnalyzeUsedNormalizedBuffer,
      interleavedPipelineForensics: finalizePipelineForensics(forensics, "invalid_inconsistent", [
        "pre_hybrid_topology_validation_failed",
        preHybridMap.error,
      ]),
    }
  }

  const preStructural = evaluateStructuralHybridGuard({
    closedQuestionIds: closedIds,
    expectedQuestionCount:
      typeof expectedClosedOmr === "number" ? expectedClosedOmr : closedOmrQuestionCount,
    templateKey: params.templateKey,
    phase: "pre_map",
  })
  if (preStructural.structuralHybridCollapseDetected) {
    return {
      success: false,
      omrMode: "azure_layout_omr_interleaved",
      errorCode: "INTERLEAVED_STRUCTURAL_HYBRID_COLLAPSE",
      error:
        preStructural.structuralCollapseReason ??
        "Inconsistencia estructural: la dimensión declarada no cubre la pauta cerrada (pre-map).",
      templateKey: params.templateKey,
      omrTemplateVariant: variant,
      structuralHybridIntegrity: preStructural,
      hybridStructuralForensics: {
        hybridPhysicalSlotCount: topology.physicalHybridSlotCount,
        closedOmrQuestionCount: topology.closedOmrQuestionCount,
        developmentSlotCount: topology.developmentSlotCount,
        hybridSlotMapPreview: topology.hybridSlotDescriptors.slice(0, 40),
        physicalIndexPreserved: null,
        syntheticPaddingPrevented: topology.hasInterleavedDevelopment,
        hybridStructuralIntegrity: false,
      },
      azureInputOrientationNormalized: orientation.azureOrientationNormalizationReason,
      azureAnalyzeUsedNormalizedBuffer: orientation.azureAnalyzeUsedNormalizedBuffer,
      interleavedPipelineForensics: finalizePipelineForensics(forensics, "invalid_inconsistent", [
        preStructural.structuralCollapseReason ?? "pre_map_structural_guard",
      ]),
    }
  }

  const debugAcc = isOmrInterleavedDebugEnabled() ? createEmptyDebugAcc(variant) : undefined
  if (debugAcc) {
    debugAcc.geometryDiagnostics = {
      expectedBubbleCenters: [],
      detectedBubbleCenters: [],
      rowVerticalDelta: [],
      rawDetectionDiagnostics: [],
      columnDiagnostics: [],
      pipelineStageCounters: {
        rawContoursDetected: parsed.marks.length,
        candidateBubblesDetected: indexedMarks.length,
        rejectedByAspectRatio: 0,
        rejectedByArea: 0,
        rejectedByFillThreshold: 0,
        rejectedBeforeClustering: 0,
        survivedClustering: 0,
        survivedColumnAssignment: 0,
        survivedRowAssignment: 0,
        finalAssignedAnswers: 0,
      },
      candidateLifecycleTrace: [],
      questionAssemblyDiagnostics: [],
      candidateLostBetweenStages: [],
      pipelineInvariantViolations: [],
      pipelineForensicCounters: {
        candidatesEnteringRanking: 0,
        candidatesAfterRanking: 0,
        candidatesAttachedToQuestions: 0,
        questionsWithCandidates: 0,
        questionsWithoutCandidates: 0,
        questionsWithEmptyConfidences: 0,
        questionsWithObservedFromSensorsFalse: 0,
      },
      xOffsetEstimated: 0,
      yOffsetEstimated: 0,
      averageRowError: 0,
      averageColumnError: 0,
      warpedWidth: params.canonicalWidth,
      warpedHeight: params.canonicalHeight,
      questionDiagnostics: [],
    }
  }

  let partialStructuralSurvival = false

  let interleavedStructuralRealignTelemetry: InterleavedStructuralRealignmentTelemetry = {
    interleavedStructuralShiftDetected: false,
    interleavedStructuralShiftOffset: null,
    interleavedStructuralRealignmentApplied: false,
  }

  let interleavedDetectionGeometryRefineTelemetry: InterleavedDetectionGeometryRefineTelemetry = {
    interleavedDetectionGeometryRefineApplied: false,
    interleavedDetectionGeometryRefineRollback: false,
    interleavedDetectionGeometryRefinePanelsProcessed: 0,
  }

  let canonicalGeometryGuardTelemetry: CanonicalGeometryGuardTelemetry = {
    canonicalGeometryGuardEnabled: false,
    canonicalGeometryGuardApplied: false,
    canonicalGeometryGuardRollback: false,
    canonicalGeometryGuardMismatchCount: 0,
  }

  let columnGeometryValidationTelemetry: InterleavedColumnGeometryValidationTelemetry = {
    interleavedColumnGeometryValidationEnabled: false,
    interleavedColumnGeometryValidationApplied: false,
    interleavedColumnGeometryValidationRollback: false,
    interleavedColumnGeometryMismatchCount: 0,
    interleavedColumnGeometryCorrectedCount: 0,
    interleavedColumnGeometryTelemetryRows: [],
  }

  let closedInventoryFinalMapTelemetry: ClosedInventoryFinalMappingTelemetry = {
    closedInventoryFinalMapEnabled: false,
    closedInventoryFinalMapApplied: false,
    closedInventoryFinalMapRollback: false,
    closedInventoryFinalMapRollbackReason: null,
    closedInventoryRowCount: 0,
    closedInventoryExpectedCount: 0,
    closedInventoryMismatchCountBefore: 0,
    closedInventoryMismatchCountAfter: 0,
    closedInventoryAllMatchAfter: false,
    closedInventoryRowTelemetry: [],
  }

  let physicalAnswerFinalGuardTelemetry: PhysicalAnswerFinalGuardTelemetry = {
    physicalAnswerFinalGuardEnabled: false,
    physicalAnswerFinalGuardApplied: false,
    physicalAnswerFinalGuardRowsProcessed: 0,
    physicalAnswerFinalGuardRowsCorrected: 0,
    physicalAnswerFinalGuardRowsBlanked: 0,
    physicalAnswerFinalGuardRowsUnchanged: 0,
    physicalAnswerFinalGuardFalseBlanksPrevented: 0,
    physicalAnswerFinalGuardRowTelemetry: [],
  }

  let detectionIndexUniquenessGuardTelemetry: DetectionIndexUniquenessGuardTelemetry = {
    detectionIndexUniquenessGuardEnabled: false,
    detectionIndexUniquenessGuardApplied: false,
    reusedDetectionIndexDetected: false,
    reusedDetectionIndexCount: 0,
    reusedDetectionIndices: [],
    reusedByCanonicalIds: [],
    finalPhysicalUniquenessGuardApplied: false,
    finalPhysicalUniquenessGuardRejectedCount: 0,
    bridgeRejectedDueToNonLocalDetection: 0,
    rowTelemetry: [],
  }

  let finalBlankRecoveryTelemetry: FinalBlankRecoveryTelemetry = {
    finalBlankRecoveryFromPhysicalEvidenceEnabled: false,
    finalBlankRecoveryFromPhysicalEvidenceApplied: false,
    finalBlankRecoveryEntries: [],
  }

  let expectedPhysicalRowPreservationTelemetry: ExpectedPhysicalRowPreservationTelemetry = {
    physicalRowPreservationEnabled: false,
    physicalRowPreservationApplied: false,
    expectedPhysicalRowsCount: closedIds.length,
    detectedPhysicalRowsCount: 0,
    missingPhysicalRowsBeforePreservation: 0,
    preservedWeakPhysicalRows: 0,
    bottomRowsPreserved: 0,
    rowTelemetry: [],
  }

  if (isInterleavedPipelineRowTracingEnabled()) resetTraceCounter()

  let perQuestion = mapInterleavedByVariant({
    variant,
    items: indexedMarks,
    closedQuestionIds: closedIds,
    expectedOptionCount,
    ocrHits,
    debugAcc,
    hybridTopology: topology,
    forensics,
  })

  // ── Fallback: si mapInterleavedByVariant devuelve 0 filas con topología híbrida,
  // reintentar con closed-only topology. Los slots de desarrollo pueden confundir
  // al rebuildHybridClosedAssignment si los descriptores o la geometría no son fiables. ──
  if (perQuestion.length === 0 && topology.hasInterleavedDevelopment && indexedMarks.length > 0) {
    console.log(
      `[omr-interleaved][HYBRID_MAP_ZERO_ROWS_FALLBACK] mapInterleavedByVariant returned 0 rows ` +
      `with hybrid topology (${topology.developmentSlotCount} dev slots). ` +
      `Retrying with closed-only topology. marks=${indexedMarks.length}`,
    )
    const closedOnlyTopology = buildClosedOnlyHybridTopology(closedIds)
    const retryRows = mapInterleavedByVariant({
      variant,
      items: indexedMarks,
      closedQuestionIds: closedIds,
      expectedOptionCount,
      ocrHits,
      hybridTopology: closedOnlyTopology,
      forensics,
    })
    if (retryRows.length > 0) {
      console.log(
        `[omr-interleaved][HYBRID_MAP_ZERO_ROWS_FALLBACK] Closed-only retry produced ${retryRows.length} rows.`,
      )
      perQuestion = retryRows
      forensics.recordStage("hybrid_map_zero_rows_fallback", {
        inputCount: indexedMarks.length,
        outputCount: retryRows.length,
        droppedCount: 0,
        collapsed: false,
        collapseReason: null,
        invariantViolations: [{
          invariant: "hybrid_map_zero_rows_fallback",
          detail: `hybrid_topology_produced_0_rows_closed_only_recovered_${retryRows.length}`,
        }],
      })
    }
  }

  stampInitialTraces(perQuestion, "mapInterleavedByVariant")

  forensics.rowsBeforeCollapse = perQuestion.length
  const ambRej = countAmbiguityRejectedFromDebugAcc(debugAcc)
  forensics.ambiguityRejectedRows = ambRej
  forensics.materializedRows = countMaterializedFromPerQuestion(perQuestion)
  forensics.recordStage("ambiguity_resolved", {
    inputCount: perQuestion.length,
    outputCount: Math.max(0, perQuestion.length - ambRej),
    droppedCount: ambRej,
    collapsed: false,
    collapseReason: null,
    invariantViolations: [],
  })
  forensics.recordStage("materialized", {
    inputCount: perQuestion.length,
    outputCount: forensics.materializedRows ?? 0,
    droppedCount: Math.max(0, perQuestion.length - (forensics.materializedRows ?? 0)),
    collapsed: perQuestion.length === 0,
    collapseReason: perQuestion.length === 0 ? "zero_perquestion_after_map" : null,
    invariantViolations: [],
  })

  const strictHybridRebuild = topology.hasInterleavedDevelopment
  let postMapPhysical = validateHybridPostMapPhysicalIntegrity({
    perQuestion,
    topology,
    closedQuestionIds: closedIds,
    strictHybrid: strictHybridRebuild,
  })

  // ── Fallback: si la validación estricta falla con desarrollo intercalado,
  // reintentar con closed-only topology (non-strict). Los slots de desarrollo
  // se cuentan como skipped, no como filas faltantes. ──
  if (!postMapPhysical.ok && topology.hasInterleavedDevelopment && perQuestion.length > 0) {
    const originalStrictError = postMapPhysical.error
    const originalStrictErrorCode = postMapPhysical.errorCode
    const closedOnlyFallbackTopology = buildClosedOnlyHybridTopology(closedIds)
    const nonStrictValidation = validateHybridPostMapPhysicalIntegrity({
      perQuestion,
      topology: closedOnlyFallbackTopology,
      closedQuestionIds: closedIds,
      strictHybrid: false,
    })
    if (nonStrictValidation.ok) {
      console.log(
        `[omr-interleaved][HYBRID_STRICT_FALLBACK] Strict hybrid validation failed ` +
        `(${originalStrictErrorCode}: ${originalStrictError}) but non-strict ` +
        `closed-only validation passed. Continuing with ${perQuestion.length} rows. ` +
        `developmentSlots=${topology.developmentSlotCount} totalPhysical=${topology.physicalHybridSlotCount}`,
      )
      postMapPhysical = nonStrictValidation
      forensics.recordStage("hybrid_strict_fallback", {
        inputCount: perQuestion.length,
        outputCount: perQuestion.length,
        droppedCount: 0,
        collapsed: false,
        collapseReason: null,
        invariantViolations: [
          { invariant: "hybrid_strict_fallback", detail: `original_strict_error: ${originalStrictErrorCode}: ${originalStrictError}` },
          { invariant: "hybrid_strict_fallback", detail: "fallback_to_non_strict_closed_only" },
        ],
      })
    }
  }

  let hybridForensics = buildHybridTopologyForensicsPayload({
    topology,
    postMap: postMapPhysical,
    syntheticPaddingPrevented: topology.hasInterleavedDevelopment,
  })

  if (!postMapPhysical.ok) {
    const partialRows = filterPartialRowsPassingSlotChecks({
      perQuestion,
      topology,
      closedQuestionIds: closedIds,
      strictHybrid: strictHybridRebuild,
    })
    const clusterRowCount = forensics.clustersAfterCollapse ?? forensics.clustersBeforeCollapse ?? 0
    const canSurvive =
      partialSurvivalIsEligible({
        partialRowCount: partialRows.length,
        azureMarkCount: parsed.marks.length,
        clusterRowCount,
      }) && partialRows.length > 0

    if (canSurvive) {
      partialStructuralSurvival = true
      forensics.partialStructuralSurvivalApplied = true
      forensics.partialStructuralSurvivalReason = `${postMapPhysical.errorCode}: ${postMapPhysical.error} | kept_rows=${partialRows.length}`
      forensics.rowsAfterCollapse = partialRows.length
      perQuestion = partialRows
      postMapPhysical = validateHybridPostMapPhysicalIntegrity({
        perQuestion,
        topology,
        closedQuestionIds: closedIds,
        strictHybrid: strictHybridRebuild,
      })
      hybridForensics = buildHybridTopologyForensicsPayload({
        topology,
        postMap: postMapPhysical,
        syntheticPaddingPrevented: topology.hasInterleavedDevelopment,
      })
    } else {
      const derivedFail = deriveCollapseFromStages(forensics.stages)
      forensics.fallbackTriggerStage = derivedFail.collapseStage ?? derivedFail.firstFailedStage
      forensics.fallbackTriggerReason = `${postMapPhysical.errorCode}: ${postMapPhysical.error}`
      const partialStructural = evaluateStructuralHybridGuard({
        closedQuestionIds: closedIds,
        templateKey: params.templateKey,
        phase: "post_map",
        mappedPerQuestion: perQuestion,
        expectedQuestionCount: closedOmrQuestionCount,
      })
      mergeStructuralViolationsIntoDebug(debugAcc, partialStructural)
      if (debugAcc?.geometryDiagnostics) {
        debugAcc.geometryDiagnostics.pipelineInvariantViolations ??= []
        debugAcc.geometryDiagnostics.pipelineInvariantViolations.push({
          invariant: postMapPhysical.errorCode,
          questionNumber: 0,
          detail: postMapPhysical.error,
        })
      }
      const pipelineForensics = finalizePipelineForensics(forensics, "invalid_inconsistent", [
        postMapPhysical.error,
        `partial_filter_kept=${partialRows.length}`,
        `azure_marks=${parsed.marks.length}`,
        `cluster_rows=${clusterRowCount}`,
      ])
      let interleavedDebugSnapshot: ReturnType<typeof finalizeInterleavedDebugSnapshot> | undefined
      let interleavedDebugOverlayPngBase64: string | undefined
      let interleavedGeometryDebugOverlayPngBase64: string | undefined
      if (debugAcc) {
        const rendered = await renderDebugSnapshots({
          debugAcc,
          closedIds,
          ocrHits,
          canonicalWidth: params.canonicalWidth,
          canonicalHeight: params.canonicalHeight,
          perQuestionSnapshot: perQuestion,
          structural: partialStructural,
          hybridForensics,
          orientationBuffer: orientation.buffer,
          pipelineForensics,
        })
        interleavedDebugSnapshot = rendered.interleavedDebugSnapshot
        interleavedDebugOverlayPngBase64 = rendered.interleavedDebugOverlayPngBase64
        interleavedGeometryDebugOverlayPngBase64 = rendered.interleavedGeometryDebugOverlayPngBase64
      }

      /** Passthrough universal: mismas marcas Azure, topología solo-cerradas (pauta cerrada), sin mapa híbrido intercalado. */
      let omrClosedAnswers: Array<Record<string, unknown>> | undefined
      if (postMapPhysical.errorCode === "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE" && indexedMarks.length > 0) {
        const closedOnlyTopology = buildClosedOnlyHybridTopology(closedIds)
        const recoveryRows = mapInterleavedByVariant({
          variant,
          items: indexedMarks,
          closedQuestionIds: closedIds,
          expectedOptionCount,
          ocrHits,
          hybridTopology: closedOnlyTopology,
        })
        const postRecovery = validateHybridPostMapPhysicalIntegrity({
          perQuestion: recoveryRows,
          topology: closedOnlyTopology,
          closedQuestionIds: closedIds,
          strictHybrid: false,
        })
        if (postRecovery.ok && recoveryRows.length > 0) {
          omrClosedAnswers = recoveryRows
        }
      }

      return {
        success: false,
        omrMode: "azure_layout_omr_interleaved",
        errorCode: postMapPhysical.errorCode,
        error: postMapPhysical.error,
        templateKey: params.templateKey,
        omrTemplateVariant: variant,
        hybridStructuralForensics: hybridForensics,
        structuralHybridIntegrity: partialStructural,
        azureLayoutModel: "prebuilt-layout",
        azureApiVersion: analyze.azureApiVersionUsed,
        azureEndpointFlavorUsed: analyze.azureEndpointFlavorUsed,
        interleavedPipelineForensics: pipelineForensics,
        ...(omrClosedAnswers?.length ? { omrClosedAnswers } : {}),
        ...(interleavedDebugSnapshot
          ? { interleavedDebugSnapshot, interleavedDebugOverlayPngBase64, interleavedGeometryDebugOverlayPngBase64 }
          : {}),
        azureInputOrientationNormalized: orientation.azureOrientationNormalizationReason,
        azureAnalyzeUsedNormalizedBuffer: orientation.azureAnalyzeUsedNormalizedBuffer,
      }
    }
  }

  const perQuestionBeforeRealign = [...perQuestion]
  const realignmentOutcome = applyInterleavedStructuralRealignment({
    perQuestion,
    topology,
    closedQuestionIds: closedIds,
    ocrHits,
    strictHybridPostMap: strictHybridRebuild,
    rebuildSortOrder: variant === "sequential_dual_column" ? "panel_then_y" : "y_then_panel",
  })
  perQuestion = realignmentOutcome.perQuestion
  interleavedStructuralRealignTelemetry = realignmentOutcome.telemetry
  recordBatchMutation(perQuestionBeforeRealign, perQuestion, "applyInterleavedStructuralRealignment", "structural_realignment")

  const perQuestionBeforeRefine = [...perQuestion]
  const refineOutcome = applyInterleavedDetectionGeometryRefine({
    perQuestion,
    indexedMarks,
    topology,
    closedQuestionIds: closedIds,
    expectedOptionCount,
    ocrHits,
    strictHybridPostMap: partialStructuralSurvival ? false : strictHybridRebuild,
  })
  perQuestion = refineOutcome.perQuestion
  interleavedDetectionGeometryRefineTelemetry = refineOutcome.telemetry
  recordBatchMutation(perQuestionBeforeRefine, perQuestion, "applyInterleavedDetectionGeometryRefine", "detection_geometry_refine")

  const perQuestionBeforeGeometryGuard = [...perQuestion]
  const geometryGuardOutcome = applyCanonicalGeometryGuard({
    perQuestion,
    topology,
    closedQuestionIds: closedIds,
    strictHybridPostMap: partialStructuralSurvival ? false : strictHybridRebuild,
  })
  perQuestion = geometryGuardOutcome.perQuestion
  canonicalGeometryGuardTelemetry = geometryGuardOutcome.telemetry
  recordBatchMutation(perQuestionBeforeGeometryGuard, perQuestion, "applyCanonicalGeometryGuard", "canonical_geometry_guard")

  const perQuestionBeforeColumnGeometry = [...perQuestion]
  const columnGeometryOutcome = applyInterleavedColumnGeometryValidation({
    perQuestion,
    indexedMarks,
    expectedOptionCount,
  })
  perQuestion = columnGeometryOutcome.perQuestion
  columnGeometryValidationTelemetry = columnGeometryOutcome.telemetry
  recordBatchMutation(perQuestionBeforeColumnGeometry, perQuestion, "applyInterleavedColumnGeometryValidation", "column_geometry_validation")

  const perQuestionBeforeRowPreservation = [...perQuestion]
  const rowPreservationOutcome = applyExpectedPhysicalRowPreservation({
    perQuestion,
    indexedMarks,
    closedQuestionIds: closedIds,
    topology,
    variant,
    expectedOptionCount,
  })
  perQuestion = rowPreservationOutcome.perQuestion
  expectedPhysicalRowPreservationTelemetry = rowPreservationOutcome.telemetry
  recordBatchMutation(perQuestionBeforeRowPreservation, perQuestion, "applyExpectedPhysicalRowPreservation", "expected_physical_row_preservation")

  const perQuestionBeforeClosedInventory = [...perQuestion]
  const closedInventoryOutcome = applyClosedInventoryFinalMapping({
    perQuestion,
    closedQuestionIds: closedIds,
    variant,
    totalPhysicalSlots: topology.physicalHybridSlotCount,
    hybridSlotDescriptors: topology.hybridSlotDescriptors,
  })
  perQuestion = closedInventoryOutcome.perQuestion
  closedInventoryFinalMapTelemetry = closedInventoryOutcome.telemetry
  recordBatchMutation(perQuestionBeforeClosedInventory, perQuestion, "applyClosedInventoryFinalMapping", "closed_inventory_final_mapping")

  const postStructural = evaluateStructuralHybridGuard({
    closedQuestionIds: closedIds,
    expectedQuestionCount:
      typeof expectedClosedOmr === "number" ? expectedClosedOmr : closedOmrQuestionCount,
    templateKey: params.templateKey,
    phase: "post_map",
    mappedPerQuestion: perQuestion,
  })
  if (postStructural.structuralHybridCollapseDetected && !partialStructuralSurvival) {
    const derivedFail = deriveCollapseFromStages(forensics.stages)
    forensics.fallbackTriggerStage = derivedFail.collapseStage ?? derivedFail.firstFailedStage
    forensics.fallbackTriggerReason = postStructural.structuralCollapseReason
    mergeStructuralViolationsIntoDebug(debugAcc, postStructural)
    hybridForensics = buildHybridTopologyForensicsPayload({
      topology,
      postMap: postMapPhysical,
      syntheticPaddingPrevented: topology.hasInterleavedDevelopment,
    })
    const pipelineForensics = finalizePipelineForensics(forensics, "invalid_inconsistent", [
      postStructural.structuralCollapseReason ?? "INTERLEAVED_STRUCTURAL_HYBRID_COLLAPSE",
    ])
    let interleavedDebugSnapshot: ReturnType<typeof finalizeInterleavedDebugSnapshot> | undefined
    let interleavedDebugOverlayPngBase64: string | undefined
    let interleavedGeometryDebugOverlayPngBase64: string | undefined
    if (debugAcc) {
      const rendered = await renderDebugSnapshots({
        debugAcc,
        closedIds,
        ocrHits,
        canonicalWidth: params.canonicalWidth,
        canonicalHeight: params.canonicalHeight,
        perQuestionSnapshot: perQuestion,
        structural: postStructural,
        hybridForensics,
        orientationBuffer: orientation.buffer,
        pipelineForensics,
      })
      interleavedDebugSnapshot = rendered.interleavedDebugSnapshot
      interleavedDebugOverlayPngBase64 = rendered.interleavedDebugOverlayPngBase64
      interleavedGeometryDebugOverlayPngBase64 = rendered.interleavedGeometryDebugOverlayPngBase64
    }
    return {
      success: false,
      omrMode: "azure_layout_omr_interleaved",
      errorCode: "INTERLEAVED_STRUCTURAL_HYBRID_COLLAPSE",
      error:
        postStructural.structuralCollapseReason ??
        "Inconsistencia estructural tras decodificación: colapso híbrido detectado (post-map).",
      templateKey: params.templateKey,
      omrTemplateVariant: variant,
      structuralHybridIntegrity: postStructural,
      hybridStructuralForensics: hybridForensics,
      azureLayoutModel: "prebuilt-layout",
      azureApiVersion: analyze.azureApiVersionUsed,
      azureEndpointFlavorUsed: analyze.azureEndpointFlavorUsed,
      interleavedPipelineForensics: pipelineForensics,
      ...(interleavedDebugSnapshot
        ? { interleavedDebugSnapshot, interleavedDebugOverlayPngBase64, interleavedGeometryDebugOverlayPngBase64 }
        : {}),
      azureInputOrientationNormalized: orientation.azureOrientationNormalizationReason,
      azureAnalyzeUsedNormalizedBuffer: orientation.azureAnalyzeUsedNormalizedBuffer,
      ...interleavedStructuralRealignTelemetry,
      ...interleavedDetectionGeometryRefineTelemetry,
      ...canonicalGeometryGuardTelemetry,
      columnGeometryValidationTelemetry,
      closedInventoryFinalMapTelemetry,
    }
  }
  if (postStructural.structuralHybridCollapseDetected && partialStructuralSurvival) {
    mergeStructuralViolationsIntoDebug(debugAcc, postStructural)
    forensics.fallbackTriggerStage = "finalized"
    forensics.fallbackTriggerReason =
      "partial_survival_post_structural_note: " + (postStructural.structuralCollapseReason ?? "")
  }

  if (debugAcc && postStructural.pipelineInvariantViolations.length) {
    mergeStructuralViolationsIntoDebug(debugAcc, postStructural)
  }

  let syntheticPaddingApplied = false
  const expectedForPadding =
    typeof expectedClosedOmr === "number" && expectedClosedOmr === closedOmrQuestionCount
      ? expectedClosedOmr
      : topology.hasInterleavedDevelopment
        ? undefined
        : typeof expectedClosedOmr === "number"
          ? expectedClosedOmr
          : closedOmrQuestionCount

  let out = [...perQuestion]
  if (
    expectedForPadding != null &&
    out.length < expectedForPadding &&
    !topology.hasInterleavedDevelopment &&
    closedOmrQuestionCount === expectedForPadding &&
    !partialStructuralSurvival
  ) {
    syntheticPaddingApplied = true
    const seen = new Set(out.map((q) => Number(q.questionNumber)))
    for (let q = 1; q <= expectedForPadding; q++) {
      if (!seen.has(q)) {
        out.push({
          questionNumber: q,
          panelIndex: 0,
          rowIndexWithinPanel: out.length,
          selectedAnswer: "BLANK",
          assignedDetectionIndices: [],
          confidencesByColumn: {},
          observedFromSensors: false,
          inferredBlank: true,
          completedByExpectation: true,
          interleavedPipeline: true,
        })
      }
    }
  }

  out.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))

  const outBeforeTightMargin = [...out]
  out = await resolveInterleavedTightMarginWithOptionalClassicFamily({
    rows: out,
    imageBuffer: params.imageBuffer,
    templateKey: params.templateKey,
    expectedQuestionCount:
      typeof expectedClosedOmr === "number" && expectedClosedOmr > 0 ? expectedClosedOmr : closedOmrQuestionCount,
    expectedOptionCount,
    variant,
    hybridStructuredQuestionOrder: orderInput,
    closedQuestionIds: closedIds,
    bridgeEnabled: isInterleavedTightWinnerMarginClassicBridgeEnabled(),
  })
  recordBatchMutation(outBeforeTightMargin, out, "resolveInterleavedTightMarginWithOptionalClassicFamily", "tight_margin_classic_bridge")

  const outBeforePhysicalGuard = [...out]
  const physicalGuardOutcome = applyPhysicalAnswerFinalGuard({ perQuestion: out })
  out = physicalGuardOutcome.perQuestion
  physicalAnswerFinalGuardTelemetry = physicalGuardOutcome.telemetry
  recordBatchMutation(outBeforePhysicalGuard, out, "applyPhysicalAnswerFinalGuard", "physical_answer_final_guard")

  // ── Guard de unicidad de detectionIndex: después de todos los bridges/guards ──
  const outBeforeUniquenessGuard = [...out]
  const uniquenessGuardOutcome = applyDetectionIndexUniquenessGuard({ perQuestion: out })
  out = uniquenessGuardOutcome.perQuestion
  detectionIndexUniquenessGuardTelemetry = uniquenessGuardOutcome.telemetry
  recordBatchMutation(outBeforeUniquenessGuard, out, "applyDetectionIndexUniquenessGuard", "detection_index_uniqueness_guard")

  // ── Assertion defensiva final: si aún hay duplicados, forzar BLANK ──
  const postUniquenessAssertion = assertNoDetectionIndexDuplicates(out)
  if (!postUniquenessAssertion.ok) {
    for (const v of postUniquenessAssertion.violations) {
      for (const ri of v.rowIndices) {
        const row = out[ri]
        if (!row) continue
        const curIndices = Array.isArray(row.assignedDetectionIndices)
          ? (row.assignedDetectionIndices as unknown[]).filter((x): x is number => typeof x === "number")
          : []
        const cleaned = curIndices.filter((i) => i !== v.detIdx)
        const baseTel = (row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined) ?? {}
        out[ri] = {
          ...row,
          assignedDetectionIndices: cleaned,
          ...(cleaned.length === 0
            ? {
                selectedAnswer: "BLANK",
                interleavedReviewRecommended: true,
                interleavedAmbiguityTelemetry: {
                  ...baseTel,
                  decisionSource: "blank_rejected_reused_detection_index",
                  finalAssertionForced: true,
                },
              }
            : {}),
        }
      }
    }
  }

  const outBeforeFinalBlankRecovery = [...out]
  // [TEMP_C30_C31_AUDIT_DIAG] Snapshot mínimo de C30/C31 antes del recovery.
  const __snapshotC30C31 = (rows: ReadonlyArray<Record<string, unknown>>, tag: string) => {
    const pick = (canon: string) => {
      for (const r of rows) {
        const cid = String((r as { canonicalId?: unknown }).canonicalId ?? "").trim().toUpperCase()
        if (cid === canon) {
          return {
            canonicalId: cid,
            selectedAnswer: (r as { selectedAnswer?: unknown }).selectedAnswer ?? null,
            physicalIndex: (r as { physicalIndex?: unknown }).physicalIndex ?? null,
            assignedDetectionIndices: Array.isArray((r as { assignedDetectionIndices?: unknown }).assignedDetectionIndices)
              ? ((r as { assignedDetectionIndices: unknown[] }).assignedDetectionIndices)
              : [],
            hasDiagnostic: !!(r as { interleavedColumnGeometryDiagnostic?: unknown }).interleavedColumnGeometryDiagnostic,
          }
        }
      }
      return { canonicalId: canon, notFound: true }
    }
    return { tag, c30: pick("C30"), c31: pick("C31") }
  }
  console.log(
    "BEFORE_RECOVERY_C30_C31",
    JSON.stringify(__snapshotC30C31(outBeforeFinalBlankRecovery, "before_recovery")),
  )
  const finalBlankRecoveryOutcome = applyFinalBlankRecoveryFromPhysicalEvidence({
    perQuestion: out,
    closedQuestionIds: closedIds,
    rawInterleavedGeometryRows: columnGeometryValidationTelemetry.interleavedColumnGeometryTelemetryRows,
  })
  out = finalBlankRecoveryOutcome.perQuestion
  finalBlankRecoveryTelemetry = finalBlankRecoveryOutcome.telemetry
  console.log(
    "AFTER_RECOVERY_C30_C31",
    JSON.stringify({
      ...__snapshotC30C31(out, "after_recovery"),
      telemetry: {
        enabled: finalBlankRecoveryTelemetry.finalBlankRecoveryFromPhysicalEvidenceEnabled,
        applied: finalBlankRecoveryTelemetry.finalBlankRecoveryFromPhysicalEvidenceApplied,
        entriesCount: Array.isArray(finalBlankRecoveryTelemetry.finalBlankRecoveryEntries)
          ? finalBlankRecoveryTelemetry.finalBlankRecoveryEntries.length
          : 0,
      },
    }),
  )
  let interleavedC30C31Audit: ReturnType<typeof buildInterleavedC30C31Audit> | undefined
  if (isInterleavedC30C31AuditEnabled()) {
    interleavedC30C31Audit = buildInterleavedC30C31Audit({
      perQuestionBeforeRecovery: outBeforeFinalBlankRecovery,
      perQuestionAfterRecovery: out,
      closedQuestionIds: closedIds,
      rawInterleavedGeometryRows: columnGeometryValidationTelemetry.interleavedColumnGeometryTelemetryRows,
      finalBlankRecoveryEnabled: finalBlankRecoveryTelemetry.finalBlankRecoveryFromPhysicalEvidenceEnabled,
    })
    console.log(`OMR_INTERLEAVED_C30_C31_AUDIT: ${JSON.stringify(interleavedC30C31Audit)}`)
  } else {
    // [TEMP_C30_C31_AUDIT_DIAG] Confirma explícitamente cuando el audit no entra.
    console.log("[C30_AUDIT_SKIPPED]", {
      reason: "isInterleavedC30C31AuditEnabled_returned_false",
      rawEnv: process.env.INTERLEAVED_C30_C31_AUDIT ?? null,
    })
  }
  recordBatchMutation(
    outBeforeFinalBlankRecovery,
    out,
    "applyFinalBlankRecoveryFromPhysicalEvidence",
    "final_blank_recovery_physical_evidence",
  )

  hybridForensics = buildHybridTopologyForensicsPayload({
    topology,
    postMap: validateHybridPostMapPhysicalIntegrity({
      perQuestion: out,
      topology,
      closedQuestionIds: closedIds,
      strictHybrid: partialStructuralSurvival ? false : strictHybridRebuild,
    }),
    syntheticPaddingPrevented: topology.hasInterleavedDevelopment || !syntheticPaddingApplied,
  })

  forensics.recordStage("finalized", {
    inputCount: out.length,
    outputCount: out.length,
    droppedCount: 0,
    collapsed: false,
    collapseReason: null,
    invariantViolations: [],
  })
  const pipelineForensics = finalizePipelineForensics(
    forensics,
    partialStructuralSurvival ? "partial_recovered" : "full_valid",
    partialStructuralSurvival && forensics.partialStructuralSurvivalReason
      ? [forensics.partialStructuralSurvivalReason]
      : [],
  )

  let interleavedDebugSnapshot: ReturnType<typeof finalizeInterleavedDebugSnapshot> | undefined
  let interleavedDebugOverlayPngBase64: string | undefined
  let interleavedGeometryDebugOverlayPngBase64: string | undefined
  if (debugAcc) {
    const rendered = await renderDebugSnapshots({
      debugAcc,
      closedIds,
      ocrHits,
      canonicalWidth: params.canonicalWidth,
      canonicalHeight: params.canonicalHeight,
      perQuestionSnapshot: out,
      structural: postStructural,
      hybridForensics,
      orientationBuffer: orientation.buffer,
      pipelineForensics,
      descriptorMappingForensics: closedInventoryFinalMapTelemetry?.universalMapping?.descriptorMappingForensics,
    })
    interleavedDebugSnapshot = rendered.interleavedDebugSnapshot
    interleavedDebugOverlayPngBase64 = rendered.interleavedDebugOverlayPngBase64
    interleavedGeometryDebugOverlayPngBase64 = rendered.interleavedGeometryDebugOverlayPngBase64
  }

  // ── Compute bridge telemetry from resolved rows ──
  const bridgeTelemetry = (() => {
    let accepted = 0
    let rejected = 0
    let rejectedNoEvidence = 0
    let rejectedNonLocal = 0
    let rolledBack = 0
    const candidates: Array<{ questionNumber: number; answer: string; confidence: number; accepted: boolean }> = []
    for (const r of out) {
      const amb = r.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined
      if (!amb) continue
      if (amb.bridgeOverrideAccepted === true) accepted++
      if (amb.bridgeOverrideRejected === true) rejected++
      if (amb.bridgeRejectedDueToMissingPhysicalEvidence === true) rejectedNoEvidence++
      if (amb.bridgeRejectedDueToNonLocalDetection === true) rejectedNonLocal++
      if (amb.decisionSource === "blank_bridge_rollback_post_guard") rolledBack++
      if (amb.bridgeCandidateAnswer) {
        candidates.push({
          questionNumber: Number(r.questionNumber ?? 0),
          answer: String(amb.bridgeCandidateAnswer),
          confidence: Number(amb.bridgeCandidateConfidence ?? 0),
          accepted: amb.bridgeOverrideAccepted === true,
        })
      }
    }
    return {
      classicBridgeGuardEnabled: isInterleavedUnsafeClassicBridgeGuardEnabled(),
      bridgeOverrideAccepted: accepted,
      bridgeOverrideRejected: rejected,
      bridgeRejectedDueToMissingPhysicalEvidence: rejectedNoEvidence,
      bridgeRejectedDueToNonLocalDetection: rejectedNonLocal,
      bridgeRolledBack: rolledBack,
      bridgeCandidates: candidates,
    }
  })()

  finalizeTraces(out)
  const rowTraces = extractAndCleanTraces(out)
  const rowTraceSummary = rowTraces.length > 0 ? buildTraceSummary(rowTraces) : null

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${params.canonicalWidth}" height="${params.canonicalHeight}" viewBox="0 0 ${params.canonicalWidth} ${params.canonicalHeight}">${parsed.marks
    .map((m) => {
      const pts = m.polygonNorm
        .map((p) => `${(p.x * params.canonicalWidth).toFixed(1)},${(p.y * params.canonicalHeight).toFixed(1)}`)
        .join(" ")
      const c = m.state === "selected" ? "#16a34a" : m.state === "unselected" ? "#d97706" : "#64748b"
      return `<polygon points="${pts}" fill="none" stroke="${c}" stroke-width="2"/>`
    })
    .join("")}</svg>`
  const overlay = await sharp(Buffer.from(svg)).png().toBuffer()

  return {
    success: true,
    omrMode: "azure_layout_omr_interleaved",
    azureLayoutModel: "prebuilt-layout",
    azureApiVersion: analyze.azureApiVersionUsed,
    azureEndpointFlavorUsed: analyze.azureEndpointFlavorUsed,
    perQuestion: out,
    hybridStructuralForensics: hybridForensics,
    hybridPhysicalSlotCount: topology.physicalHybridSlotCount,
    closedOmrQuestionCountUsed: topology.closedOmrQuestionCount,
    questionAssignments: [],
    observedQuestionsCount: perQuestion.length,
    completedMissingQuestionsCount: Math.max(0, out.length - perQuestion.length),
    questionOrderSource: "interleaved_gap_blocks_pipeline",
    templateKey: params.templateKey,
    omrTemplateVariant: variant,
    omrTemplateVariantRequested: variantRequested,
    omrTemplateVariantEffective: variant,
    omrTemplateVariantAutoDiagnostics: variantAutoDiagnostics,
    questionBlocksPerRow: variant === "single_column" ? 1 : 2,
    overlayPngBase64: overlay.toString("base64"),
    ...(interleavedDebugSnapshot
      ? { interleavedDebugSnapshot, interleavedDebugOverlayPngBase64, interleavedGeometryDebugOverlayPngBase64 }
      : {}),
    interleavedPipelineForensics: pipelineForensics,
    interleavedPartialStructuralSurvival: partialStructuralSurvival,
    ...interleavedStructuralRealignTelemetry,
    ...interleavedDetectionGeometryRefineTelemetry,
    ...canonicalGeometryGuardTelemetry,
    columnGeometryValidationTelemetry,
    expectedPhysicalRowPreservationTelemetry,
    closedInventoryFinalMapTelemetry,
    physicalAnswerFinalGuardTelemetry,
    detectionIndexUniquenessGuardTelemetry,
    ...finalBlankRecoveryTelemetry,
    ...(interleavedC30C31Audit ? { interleavedC30C31Audit } : {}),
    ...(rowTraces.length > 0 ? { interleavedRowTraces: rowTraces } : {}),
    ...(rowTraceSummary ? { interleavedRowTraceSummary: rowTraceSummary } : {}),
    classicBridgeSafetyTelemetry: bridgeTelemetry,
    ...(closedInventoryFinalMapTelemetry?.universalMapping?.descriptorMappingForensics
      ? { descriptorMappingForensics: closedInventoryFinalMapTelemetry.universalMapping.descriptorMappingForensics }
      : {}),
    ...orientation,
  }
}
