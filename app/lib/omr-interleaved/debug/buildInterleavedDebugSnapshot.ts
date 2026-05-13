/**
 * Snapshot JSON solo para diagnóstico interleaved (no usar en scoring).
 */
import { nearestOcrHitForRow, type OcrNumberHit } from "../ocr-question-numbers"
import type { RebuildQuestionTraceEvent } from "../rebuildQuestionSequence"
import type { StructuralHybridIntegrityReport } from "../structural-hybrid-guard"
import type { HybridTopologySnapshotForensics } from "../hybrid-slot-topology"
import type { InterleavedPipelineForensicReport } from "../interleaved-pipeline-forensics"
import type { OmrTemplateVariantInterleaved } from "../types"
import type { InterleavedBandSummary } from "./summarizeInterleavedBands"

export type InterleavedDebugPairing = {
  bandIndex: number
  tierIndexGlobal: number
  rowCenterY: number
  leftPresent: boolean
  rightPresent: boolean
  leftOrphan: boolean
  rightOrphan: boolean
}

export type InterleavedDebugAnchor = {
  rowCenterY: number
  panel: 0 | 1
  /** Slot 1..N tras `rebuildQuestionSequence` (mismo índice que `questionNumber` final). */
  assignedSlot: number
  ocrValue: number | null
  ocrDeltaYNorm: number | null
  confidenceApprox: number | null
  reassignedQuestionNumber: number
  assignment: RebuildQuestionTraceEvent["assignment"]
}

export type InterleavedDebugReassigned = {
  originalQuestionNumber: number
  reassignedQuestionNumber: number
  panel: 0 | 1
  bandIndex: number | null
  rowCenterY: number
}

export type InterleavedDebugOrphan = {
  side: "left" | "right"
  rowCenterY: number
  bandIndex: number
  reason: string
}

export type InterleavedDebugConflict = {
  kind: "duplicate_slot" | "empty_slot" | "completed_expectation"
  detail: string
  slots?: number[]
}

export type InterleavedDebugReconstructionRow = {
  questionNumber: number
  originalQuestionNumber: number | null
  panel: 0 | 1
  bandIndex: number | null
  rowCenterY: number
  completedByExpectation?: boolean
}

export type InterleavedDebugSnapshot = {
  bands: InterleavedBandSummary[]
  pairings: InterleavedDebugPairing[]
  anchors: InterleavedDebugAnchor[]
  reassignedQuestions: InterleavedDebugReassigned[]
  orphanRows: InterleavedDebugOrphan[]
  conflicts: InterleavedDebugConflict[]
  reconstructionFinal: InterleavedDebugReconstructionRow[]
  geometryDiagnostics?: {
    expectedBubbleCenters: Array<{ x: number; y: number; panelIndex: 0 | 1; questionNumber: number; column: string }>
    detectedBubbleCenters: Array<{ x: number; y: number; idx: number; panelIndex: 0 | 1; questionNumber: number }>
    rowVerticalDelta: Array<{ panelIndex: 0 | 1; questionNumber: number; expectedY: number; observedY: number; delta: number }>
    rawDetectionDiagnostics: Array<{
      detectionIdx: number
      centerX: number
      centerY: number
      normalizedX: number
      normalizedY: number
      width: number
      height: number
      fillScore: number | null
      darknessScore: number | null
      contourArea: number
      confidence: number
      panelIndexCandidate: 0 | 1
      rowIndexCandidate: number
      columnIndexCandidate: number
      columnLetterCandidate: string
      rejectedBeforeDecode: boolean
      rejectionReason: string | null
      survivedToDecode: boolean
      nearestColumnCenterDistance: number
      nearestRowCenterDistance: number
    }>
    columnDiagnostics: Array<{
      panelIndex: 0 | 1
      columnCenters: number[]
      horizontalSpacing: number[]
      horizontalDeviation: number
      assignmentHistogram: Array<{ column: string; count: number }>
      conflictsABCD: Array<{ columns: string[]; overlapRatio: number }>
      collapsedColumns: Array<{ column: string; reason: string }>
      horizontalOverlap: number
      clusteringConfidence: number
      perRowHorizontalDrift: Array<{ rowIndex: number; drift: number }>
    }>
    pipelineStageCounters: {
      rawContoursDetected: number
      candidateBubblesDetected: number
      rejectedByAspectRatio: number
      rejectedByArea: number
      rejectedByFillThreshold: number
      rejectedBeforeClustering: number
      survivedClustering: number
      survivedColumnAssignment: number
      survivedRowAssignment: number
      finalAssignedAnswers: number
    }
    candidateLifecycleTrace: Array<{
      detectionIdx: number
      candidateId: string
      panelIndex: 0 | 1
      rowIndex: number
      columnLetter: string
      enteredColumnAssignment: boolean
      survivedColumnAssignment: boolean
      enteredRowAssignment: boolean
      survivedRowAssignment: boolean
      enteredBandGate: boolean
      survivedBandGate: boolean
      enteredRanking: boolean
      survivedRanking: boolean
      attachedToQuestion: boolean
      attachedQuestionNumber: number | null
      reachedPerQuestionRaw: boolean
      selectedFinal: boolean
      rejectionStage: string | null
      rejectionReason: string | null
    }>
    questionAssemblyDiagnostics: Array<{
      questionNumber: number
      candidateIdsSeen: string[]
      candidateIdsAfterColumnStage: string[]
      candidateIdsAfterRowStage: string[]
      candidateIdsAfterBandStage: string[]
      candidateIdsAfterRanking: string[]
      attachedCandidateIds: string[]
      finalSelectedCandidateId: string | null
      whyNoAssignment: string | null
      whyNoConfidences: string | null
      whyObservedFromSensorsFalse: string | null
      // --- Forensic continuity (interleaved-only, optional) ---
      // Persisted regardless of finalSelectedCandidateId, to preserve
      // traceability of the best-ranked candidate when materialization fails.
      bestRankedCandidateId?: string | null
      bestRankedCompositeScore?: number | null
      chosenCandidateBeforeNullification?: {
        candidateId: string
        optionLetter: string
        compositeScore: number
        confidence: number
      } | null
      explicitFinalNullificationReason?: string | null
      finalMaterializationFailure?: boolean
      materializedDespiteAmbiguity?: boolean
    }>
    candidateLostBetweenStages: Array<{
      candidateId: string
      lostBetween: string
      previousStage: string
      nextStage: string
      lastKnownState: string
    }>
    pipelineInvariantViolations: Array<{
      invariant: string
      questionNumber: number
      detail: string
    }>
    pipelineForensicCounters: {
      candidatesEnteringRanking: number
      candidatesAfterRanking: number
      candidatesAttachedToQuestions: number
      questionsWithCandidates: number
      questionsWithoutCandidates: number
      questionsWithEmptyConfidences: number
      questionsWithObservedFromSensorsFalse: number
    }
    questionDiagnostics: Array<{
      panelIndex: 0 | 1
      questionNumber: number
      rowIndexWithinPanel: number
      expectedLogicalRow?: number
      expectedPhysicalRow?: number
      expectedPhysicalY?: number
      observedDetectionY?: number
      nearestPhysicalRows?: Array<{ rowIndex: number; centerY: number; dy: number }>
      verticalResidual?: number
      rowBandAccepted?: boolean
      rowBandRejectedReason?: string | null
      driftApplied?: number
      physicalGapDetected?: boolean
      expectedCenterByOption: Array<{ column: string; x: number; y: number }>
      detectedCenters: Array<{ idx: number; x: number; y: number; confidence: number; state: "selected" | "unselected" }>
      rowSnapped: number
      rowDelta: number
      rowDistanceToExpected: number
      rowDistanceToSnapped: number
      nearestCandidates: Array<{
        detectionIdx: number
        optionIdx: number
        dx: number
        dy: number
        distanceScore: number
        confidence: number
        rowSnapped: number
        reason: string
      }>
      candidateScores?: Array<{
        detectionIdx: number
        optionIdx: number
        finalCandidateScore: number
        columnDistanceScore: number
        rowDistanceScore: number
        fillConfidenceScore: number
        bandPenaltyScore: number
        neighborConflictPenalty: number
        bandPenaltyApplied: boolean
        bandPenaltyValue: number
        hardRejectedByBand: boolean
      }>
      selectedCandidateScore?: number | null
      rejectedCandidateScores?: Array<{
        detectionIdx: number
        optionIdx: number
        finalCandidateScore: number
        reason: string
      }>
      ambiguityResolutionTriggered?: boolean
      ambiguityWinnerMargin?: number | null
      resolvedAmbiguity?: boolean
      ambiguityResolutionReason?: string | null
      safeToMaterializeDespiteAmbiguity?: boolean
      materializedDespiteAmbiguity?: boolean
      bandPenaltyApplied?: boolean
      hardRejectedByBand?: boolean
      candidateRankings?: Array<{
        rank: number
        detectionIdx: number
        optionIdx: number
        finalCandidateScore: number
      }>
      candidateConflictReason?: string | null
      finalAssignmentReason?: string
      selectedAnswer: string
      selectedDetectionIdx: number | null
      blankReason: string | null
      interleavedAmbiguityTelemetry?: {
        winnerMargin: number | null
        bestScore: number | null
        secondBestScore: number | null
        confidenceDifference: number | null
        decisionSource: string
        ambiguityResolutionReason: string | null
      }
      interleavedTightMarginResolution?: Record<string, unknown> | null
    }>
    xOffsetEstimated: number
    yOffsetEstimated: number
    averageRowError: number
    averageColumnError: number
    warpedWidth: number
    warpedHeight: number
  }
  variant: OmrTemplateVariantInterleaved
  /** Diagnóstico estructural híbrido (opcional, append-only). */
  structuralHybridIntegrity?: StructuralHybridIntegrityReport
  /** Topología física vs OMR (solo pipeline interleaved híbrido). */
  hybridTopologyForensics?: HybridTopologySnapshotForensics
  /** Traza forense etapa por etapa (colapso / supervivencia parcial). */
  pipelineForensics?: InterleavedPipelineForensicReport
  /** Diagnóstico físico completo focalizado en preguntas conflictivas interleaved. */
  targetedPhysicalTraceReport?: {
    targetQuestions: number[]
    questionTraces: Array<{
      questionNumber: number
      panelIndex: 0 | 1 | null
      detectionsRawCandidates: Array<{
        detectionIdx: number
        centerY: number
        state: "selected" | "unselected" | "unknown"
        confidence: number | null
        source: "question_detected_centers" | "raw_detection_same_panel"
      }>
      centerY: number | null
      snappedRow: number | null
      calibratedExpectedY: number | null
      dyResidual: number | null
      bandAssignment: number | null
      passedStages: {
        clusterRowsByYIndexed: boolean
        pairLeftRightRowsIntoTiers: boolean
        decodeBubbleRow: boolean
      }
      rejectedBecause: string | null
      endedBlank: boolean
      selectedMarkEvidence: {
        existsSelectedMarkState: boolean
        selectedDetectionIdxs: number[]
        selectedFromRawCandidatePool: number
      }
      textualTrace: string
    }>
    repetitiveMismatchQuestions: number[]
    oddEvenSystematicOffset: {
      oddMeanResidual: number | null
      evenMeanResidual: number | null
      deltaOddMinusEven: number | null
      appearsSystematic: boolean
    }
    verticalPanelSplitDisplacement: {
      panel0MeanResidualX: number | null
      panel1MeanResidualX: number | null
      deltaPanels: number | null
      appearsDisplaced: boolean
      confidence: number
    }
    tieringPartialCollapse: {
      totalTiers: number
      leftOrphans: number
      rightOrphans: number
      orphanRatio: number
      appearsCollapsed: boolean
    }
    hypothesis: {
      dominantHypothesis: string
      confidencePercent: number
      nextLossPointExact: string
    }
    textualSummary: string
  }
  verticalOrderingTrace?: Array<{
    questionNumber: number
    panelIndex: 0 | 1
    physicalIndex: number
    rowIndexWithinPanel: number
    visualIndex: number
    rowCenterY: number
    previousAssigned: number | null
    verticalOrderingSuspicious: boolean
  }>
  verticalOrderingWarnings?: string[]
  /** Forensic trace of descriptor-based physical mapping attempts/rollbacks. */
  descriptorMappingForensics?: import("../descriptor-mapping-forensics").DescriptorMappingForensics
}

export type InterleavedPipelineDebugAcc = {
  variant: OmrTemplateVariantInterleaved
  bands: InterleavedBandSummary[]
  pairings: InterleavedDebugPairing[]
  rebuildTrace: RebuildQuestionTraceEvent[]
  geometryDiagnostics?: InterleavedDebugSnapshot["geometryDiagnostics"]
  verticalOrderingTrace?: Array<{
    questionNumber: number
    panelIndex: 0 | 1
    physicalIndex: number
    rowIndexWithinPanel: number
    visualIndex: number
    rowCenterY: number
    previousAssigned: number | null
    verticalOrderingSuspicious: boolean
  }>
  verticalOrderingWarnings?: string[]
}

export function createEmptyDebugAcc(variant: OmrTemplateVariantInterleaved): InterleavedPipelineDebugAcc {
  return { variant, bands: [], pairings: [], rebuildTrace: [] }
}

function bandIndexForRow(
  bands: InterleavedBandSummary[],
  y: number,
  panel: 0 | 1,
  variant: OmrTemplateVariantInterleaved,
): number | null {
  if (variant === "sequential_dual_column") return panel === 0 ? 0 : 1
  const eps = 1e-4
  for (const b of bands) {
    if (y + eps >= b.yMin && y - eps <= b.yMax) return b.bandIndex
  }
  return null
}

function buildAnchors(
  trace: RebuildQuestionTraceEvent[],
  ocrHits: OcrNumberHit[],
  maxDyOcr: number,
): InterleavedDebugAnchor[] {
  return trace.map((t) => {
    const hit = nearestOcrHitForRow({
      hits: ocrHits,
      rowCenterY: t.rowCenterY,
      panel: t.panel === 0 ? "left" : "right",
      maxDy: maxDyOcr,
    })
    const dy = hit?.dy ?? null
    const conf = dy != null && maxDyOcr > 0 ? Math.max(0, Math.min(1, 1 - dy / maxDyOcr)) : null
    return {
      rowCenterY: t.rowCenterY,
      panel: t.panel,
      assignedSlot: t.newQuestionNumber,
      ocrValue: t.ocrValue,
      ocrDeltaYNorm: dy,
      confidenceApprox: conf,
      reassignedQuestionNumber: t.newQuestionNumber,
      assignment: t.assignment,
    }
  })
}

function buildOrphans(pairings: InterleavedDebugPairing[]): InterleavedDebugOrphan[] {
  const out: InterleavedDebugOrphan[] = []
  for (const p of pairings) {
    if (p.leftOrphan) {
      out.push({
        side: "left",
        rowCenterY: p.rowCenterY,
        bandIndex: p.bandIndex,
        reason: "fila_izquierda_sin_pareja_derecha",
      })
    }
    if (p.rightOrphan) {
      out.push({
        side: "right",
        rowCenterY: p.rowCenterY,
        bandIndex: p.bandIndex,
        reason: "fila_derecha_sin_pareja_izquierda",
      })
    }
  }
  return out
}

function buildReconstructionFinal(
  trace: RebuildQuestionTraceEvent[],
  bands: InterleavedBandSummary[],
  finalPerQuestion: Array<Record<string, unknown>>,
  variant: OmrTemplateVariantInterleaved,
): InterleavedDebugReconstructionRow[] {
  const rows: InterleavedDebugReconstructionRow[] = []
  for (const row of finalPerQuestion) {
    const qn = Number(row.questionNumber ?? 0)
    if (!Number.isFinite(qn) || qn < 1) continue
    const panel = Number(row.panelIndex ?? 0) === 1 ? 1 : 0
    const y = Number(row.rowCenterY ?? 0)
    const tmatch = trace.find(
      (t) => t.newQuestionNumber === qn && t.panel === (panel as 0 | 1) && Math.abs(t.rowCenterY - y) < 1e-3,
    )
    const orig = tmatch ? tmatch.oldQuestionNumber : null
    rows.push({
      questionNumber: qn,
      originalQuestionNumber: orig,
      panel: panel as 0 | 1,
      bandIndex: bandIndexForRow(bands, y, panel as 0 | 1, variant),
      rowCenterY: y,
      completedByExpectation: row.completedByExpectation === true,
    })
  }
  rows.sort((a, b) => a.questionNumber - b.questionNumber)
  return rows
}

function buildConflicts(
  finalPerQuestion: Array<Record<string, unknown>>,
  closedQuestionIds: string[],
): InterleavedDebugConflict[] {
  const conflicts: InterleavedDebugConflict[] = []
  const n = closedQuestionIds.length
  const counts = new Map<number, number>()
  for (const row of finalPerQuestion) {
    const qn = Number(row.questionNumber ?? 0)
    if (!Number.isFinite(qn) || qn < 1) continue
    counts.set(qn, (counts.get(qn) ?? 0) + 1)
    if (row.completedByExpectation === true) {
      conflicts.push({
        kind: "completed_expectation",
        detail: `Pregunta ${qn} completada por expectativa (sin fila detectada previa).`,
        slots: [qn],
      })
    }
  }
  if (n > 0) {
    for (let s = 1; s <= n; s++) {
      const c = counts.get(s) ?? 0
      if (c === 0) {
        conflicts.push({
          kind: "empty_slot",
          detail: `Slot ${s} sin fila en salida final.`,
          slots: [s],
        })
      } else if (c > 1) {
        conflicts.push({
          kind: "duplicate_slot",
          detail: `Slot ${s} aparece ${c} veces en perQuestion.`,
          slots: [s],
        })
      }
    }
  }
  return conflicts
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function normalizeCandidateIdToDetectionIdx(candidateId: string): number | null {
  const m = String(candidateId).match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function buildTargetedPhysicalTraceReport(snapshot: InterleavedDebugSnapshot): InterleavedDebugSnapshot["targetedPhysicalTraceReport"] {
  const targets = [3, 14, 17, 34, 39]
  const gd = snapshot.geometryDiagnostics
  const pairings = snapshot.pairings ?? []
  const bands = snapshot.bands ?? []
  const qd = gd?.questionDiagnostics ?? []
  const qa = gd?.questionAssemblyDiagnostics ?? []
  const raw = gd?.rawDetectionDiagnostics ?? []
  const lifecycles = gd?.candidateLifecycleTrace ?? []

  const questionTraces = targets.map((qn) => {
    const diag = qd.find((x) => x.questionNumber === qn)
    const asm = qa.find((x) => x.questionNumber === qn)
    const panelIndex = typeof diag?.panelIndex === "number" ? diag.panelIndex : null
    const centerY = typeof diag?.observedDetectionY === "number" ? diag.observedDetectionY : null
    const snappedRow = typeof diag?.rowSnapped === "number" ? diag.rowSnapped : null
    const calibratedExpectedY =
      typeof diag?.expectedCenterByOption?.[0]?.y === "number"
        ? diag.expectedCenterByOption[0].y
        : typeof diag?.expectedPhysicalY === "number"
          ? diag.expectedPhysicalY
          : null
    const dyResidual =
      typeof centerY === "number" && typeof calibratedExpectedY === "number" ? centerY - calibratedExpectedY : null

    const bandAssignment =
      typeof centerY === "number" && panelIndex != null
        ? (bands.find((b) => centerY >= b.yMin - 1e-4 && centerY <= b.yMax + 1e-4)?.bandIndex ?? null)
        : null

    const decodedDetections = (diag?.detectedCenters ?? []).map((d) => ({
      detectionIdx: d.idx,
      centerY: d.y,
      state: d.state,
      confidence: d.confidence,
      source: "question_detected_centers" as const,
    }))
    const rawSamePanel = panelIndex == null ? [] : raw.filter((r) => r.panelIndexCandidate === panelIndex).slice(0, 60)
    const mergedRawCandidates = [
      ...decodedDetections,
      ...rawSamePanel
        .filter((r) => !decodedDetections.some((d) => d.detectionIdx === r.detectionIdx))
        .map((r) => ({
          detectionIdx: r.detectionIdx,
          centerY: r.centerY,
          state: "unknown" as const,
          confidence: r.confidence,
          source: "raw_detection_same_panel" as const,
        })),
    ]

    const selectedIdsFromDetected = decodedDetections.filter((d) => d.state === "selected").map((d) => d.detectionIdx)
    const selectedIdsFromLifecycle = lifecycles
      .filter((l) => l.attachedQuestionNumber === qn && l.selectedFinal)
      .map((l) => l.detectionIdx)
    const selectedDetectionIdxs = Array.from(new Set([...selectedIdsFromDetected, ...selectedIdsFromLifecycle]))
    const selectedFromRawCandidatePool = mergedRawCandidates.filter((d) => d.state === "selected").length

    const finalSelectedId = asm?.finalSelectedCandidateId ? normalizeCandidateIdToDetectionIdx(asm.finalSelectedCandidateId) : null
    const rejectedBecause =
      diag?.blankReason ??
      diag?.candidateConflictReason ??
      asm?.explicitFinalNullificationReason ??
      asm?.whyNoAssignment ??
      null
    const endedBlank = String(diag?.selectedAnswer ?? "BLANK").toUpperCase() === "BLANK"

    const passedCluster = !!diag
    const passedPair = (() => {
      if (snapshot.variant === "single_column") return passedCluster
      if (panelIndex == null || centerY == null) return false
      const closestPair = pairings
        .filter((p) => (panelIndex === 0 ? p.leftPresent : p.rightPresent))
        .sort((a, b) => Math.abs(a.rowCenterY - centerY) - Math.abs(b.rowCenterY - centerY))[0]
      return !!closestPair && Math.abs(closestPair.rowCenterY - centerY) <= 0.03
    })()
    const passedDecode = asm != null || (diag?.detectedCenters?.length ?? 0) > 0

    const textualTrace =
      `q${qn}\n` +
      `expectedRowY=${calibratedExpectedY != null ? calibratedExpectedY.toFixed(6) : "null"}\n` +
      `candidateYs=[${mergedRawCandidates
        .slice(0, 12)
        .map((c) => c.centerY.toFixed(6))
        .join(", ")}]\n` +
      `chosen=${finalSelectedId != null ? finalSelectedId : "BLANK"}\n` +
      `rejectedBecause=${rejectedBecause ?? "null"}`

    return {
      questionNumber: qn,
      panelIndex,
      detectionsRawCandidates: mergedRawCandidates,
      centerY,
      snappedRow,
      calibratedExpectedY,
      dyResidual,
      bandAssignment,
      passedStages: {
        clusterRowsByYIndexed: passedCluster,
        pairLeftRightRowsIntoTiers: passedPair,
        decodeBubbleRow: passedDecode,
      },
      rejectedBecause,
      endedBlank,
      selectedMarkEvidence: {
        existsSelectedMarkState: selectedDetectionIdxs.length > 0 || selectedFromRawCandidatePool > 0,
        selectedDetectionIdxs,
        selectedFromRawCandidatePool,
      },
      textualTrace,
    }
  })

  const repetitiveMismatchQuestions = qd
    .filter((x) => String(x.selectedAnswer).toUpperCase() === "BLANK" && ((x.detectedCenters?.length ?? 0) > 0 || (x.nearestCandidates?.length ?? 0) > 0))
    .map((x) => x.questionNumber)
    .sort((a, b) => a - b)

  const oddResiduals = qd.filter((x) => x.questionNumber % 2 === 1).map((x) => x.rowDelta)
  const evenResiduals = qd.filter((x) => x.questionNumber % 2 === 0).map((x) => x.rowDelta)
  const oddMeanResidual = mean(oddResiduals)
  const evenMeanResidual = mean(evenResiduals)
  const deltaOddMinusEven =
    oddMeanResidual != null && evenMeanResidual != null ? oddMeanResidual - evenMeanResidual : null
  const appearsSystematic = deltaOddMinusEven != null ? Math.abs(deltaOddMinusEven) >= 0.0075 : false

  const panel0ResidualX = (gd?.detectedBubbleCenters ?? [])
    .map((d) => {
      const expected = (gd?.expectedBubbleCenters ?? []).find(
        (e) => e.panelIndex === d.panelIndex && e.questionNumber === d.questionNumber,
      )
      if (!expected || d.panelIndex !== 0) return null
      return d.x - expected.x
    })
    .filter((v): v is number => typeof v === "number")
  const panel1ResidualX = (gd?.detectedBubbleCenters ?? [])
    .map((d) => {
      const expected = (gd?.expectedBubbleCenters ?? []).find(
        (e) => e.panelIndex === d.panelIndex && e.questionNumber === d.questionNumber,
      )
      if (!expected || d.panelIndex !== 1) return null
      return d.x - expected.x
    })
    .filter((v): v is number => typeof v === "number")
  const panel0MeanResidualX = mean(panel0ResidualX)
  const panel1MeanResidualX = mean(panel1ResidualX)
  const deltaPanels =
    panel0MeanResidualX != null && panel1MeanResidualX != null ? panel1MeanResidualX - panel0MeanResidualX : null
  const splitAppearsDisplaced = deltaPanels != null ? Math.abs(deltaPanels) >= 0.012 : false
  const splitConfidence =
    deltaPanels == null
      ? 0
      : Math.max(
          0,
          Math.min(1, Math.abs(deltaPanels) / 0.03) * Math.min(1, Math.max(panel0ResidualX.length, panel1ResidualX.length) / 35),
        )

  const leftOrphans = pairings.filter((p) => p.leftOrphan).length
  const rightOrphans = pairings.filter((p) => p.rightOrphan).length
  const totalTiers = pairings.length
  const orphanRatio = totalTiers > 0 ? (leftOrphans + rightOrphans) / totalTiers : 0
  const tieringAppearsCollapsed = orphanRatio >= 0.18

  const dominantHypothesis = appearsSystematic
    ? "Existe offset vertical sistemático odd/even que empuja filas cercanas al borde de banda y deriva en BLANK por conflicto de fila."
    : splitAppearsDisplaced
      ? "El split vertical entre paneles parece desplazado y contamina el assignment de columnas/filas en un panel."
      : tieringAppearsCollapsed
        ? "Hay colapso parcial en tiering (alto ratio de orphans) que rompe el pareo left/right antes de materializar respuesta."
        : "La pérdida dominante ocurre en materialización por ambiguedad/conflicto local de candidatos, no por ausencia física de marcas."
  const confidencePercent = Math.round(
    Math.max(
      0.35,
      Math.min(0.97, appearsSystematic ? 0.74 : splitAppearsDisplaced ? 0.7 : tieringAppearsCollapsed ? 0.68 : 0.6),
    ) * 100,
  )
  const nextLossPointExact = (() => {
    const withFailure = qa.find((x) => x.finalMaterializationFailure || x.explicitFinalNullificationReason)
    if (withFailure) {
      return `decodeBubbleRow -> questionAssemblyDiagnostics (question=${withFailure.questionNumber}, reason=${withFailure.explicitFinalNullificationReason ?? withFailure.whyNoAssignment ?? "unknown"})`
    }
    return "decodeBubbleRow (candidate filtering/ranking previo a finalSelectedCandidateId)"
  })()

  const textualSummary = questionTraces.map((q) => q.textualTrace).join("\n\n")

  return {
    targetQuestions: targets,
    questionTraces,
    repetitiveMismatchQuestions,
    oddEvenSystematicOffset: {
      oddMeanResidual,
      evenMeanResidual,
      deltaOddMinusEven,
      appearsSystematic,
    },
    verticalPanelSplitDisplacement: {
      panel0MeanResidualX,
      panel1MeanResidualX,
      deltaPanels,
      appearsDisplaced: splitAppearsDisplaced,
      confidence: Number(splitConfidence.toFixed(3)),
    },
    tieringPartialCollapse: {
      totalTiers,
      leftOrphans,
      rightOrphans,
      orphanRatio,
      appearsCollapsed: tieringAppearsCollapsed,
    },
    hypothesis: {
      dominantHypothesis,
      confidencePercent,
      nextLossPointExact,
    },
    textualSummary,
  }
}

export function finalizeInterleavedDebugSnapshot(
  acc: InterleavedPipelineDebugAcc,
  params: {
    ocrHits: OcrNumberHit[]
    closedQuestionIds: string[]
    maxDyOcr: number
    finalPerQuestion: Array<Record<string, unknown>>
    structuralHybridIntegrity?: StructuralHybridIntegrityReport
    hybridTopologyForensics?: HybridTopologySnapshotForensics
    pipelineForensics?: InterleavedPipelineForensicReport
    descriptorMappingForensics?: import("../descriptor-mapping-forensics").DescriptorMappingForensics
  },
): InterleavedDebugSnapshot {
  const {
    ocrHits,
    closedQuestionIds,
    maxDyOcr,
    finalPerQuestion,
    structuralHybridIntegrity,
    hybridTopologyForensics,
    pipelineForensics,
  } = params
  const reassignedQuestions: InterleavedDebugReassigned[] = []
  for (const t of acc.rebuildTrace) {
    if (t.oldQuestionNumber !== t.newQuestionNumber) {
      reassignedQuestions.push({
        originalQuestionNumber: t.oldQuestionNumber,
        reassignedQuestionNumber: t.newQuestionNumber,
        panel: t.panel,
        bandIndex: bandIndexForRow(acc.bands, t.rowCenterY, t.panel, acc.variant),
        rowCenterY: t.rowCenterY,
      })
    }
  }
  return {
    variant: acc.variant,
    bands: acc.bands,
    pairings: acc.pairings,
    anchors: buildAnchors(acc.rebuildTrace, ocrHits, maxDyOcr),
    reassignedQuestions,
    orphanRows: buildOrphans(acc.pairings),
    conflicts: buildConflicts(finalPerQuestion, closedQuestionIds),
    reconstructionFinal: buildReconstructionFinal(acc.rebuildTrace, acc.bands, finalPerQuestion, acc.variant),
    ...(acc.geometryDiagnostics ? { geometryDiagnostics: acc.geometryDiagnostics } : {}),
    ...(structuralHybridIntegrity ? { structuralHybridIntegrity } : {}),
    ...(hybridTopologyForensics ? { hybridTopologyForensics } : {}),
    ...(pipelineForensics ? { pipelineForensics } : {}),
    ...(params.descriptorMappingForensics ? { descriptorMappingForensics: params.descriptorMappingForensics } : {}),
    ...(acc.verticalOrderingTrace?.length ? { verticalOrderingTrace: acc.verticalOrderingTrace } : {}),
    ...(acc.verticalOrderingWarnings?.length ? { verticalOrderingWarnings: acc.verticalOrderingWarnings } : {}),
    targetedPhysicalTraceReport: buildTargetedPhysicalTraceReport({
      variant: acc.variant,
      bands: acc.bands,
      pairings: acc.pairings,
      anchors: [],
      reassignedQuestions: [],
      orphanRows: [],
      conflicts: [],
      reconstructionFinal: [],
      ...(acc.geometryDiagnostics ? { geometryDiagnostics: acc.geometryDiagnostics } : {}),
    }),
  }
}
