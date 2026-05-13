/**
 * Reasignación estructural híbrida: zip orden visual ↔ slots OMR en orden físico.
 * Sin recompactación silenciosa 1..N; preserva physicalIndex del descriptor.
 */
import type { HybridSlotTopology } from "./hybrid-slot-topology"
import { getOmrSlotsInPhysicalOrder } from "./hybrid-slot-topology"
import { nearestOcrNumberForRow, type OcrNumberHit } from "./ocr-question-numbers"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"
import type { RebuildQuestionSortOrder } from "./rebuildQuestionSequence"
import { sortDecodedForRebuild } from "./rebuildQuestionSequence"

function normId(id: string): string {
  return String(id ?? "").trim()
}

function canonicalNumericId(canonicalId: string): number | null {
  return parseClosedIdNumericSlot(canonicalId)
}

export function rebuildHybridClosedAssignment(params: {
  decoded: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  topology: HybridSlotTopology
  ocrHits: OcrNumberHit[]
  sortOrder?: RebuildQuestionSortOrder
  /** Diagnóstico: OCR vs canonical del mapa (no altera asignación estructural). */
  recordOcrForensic?: boolean
}): Array<Record<string, unknown>> {
  const { decoded, closedQuestionIds, topology, ocrHits } = params
  const sortOrder: RebuildQuestionSortOrder = params.sortOrder ?? "y_then_panel"
  const omrSlots = getOmrSlotsInPhysicalOrder(topology)
  const sorted = sortDecodedForRebuild(decoded, sortOrder)
  const n = Math.min(sorted.length, omrSlots.length)
  const out: Array<Record<string, unknown>> = []

  for (let j = 0; j < n; j++) {
    const row = sorted[j]!
    const slotDesc = omrSlots[j]!
    const numericId = canonicalNumericId(slotDesc.canonicalId)
    if (numericId == null || numericId < 1) {
      out.push({ ...row, hybridAssignmentFailure: true, expectedCanonical: slotDesc.canonicalId })
      continue
    }

    const y = typeof row.rowCenterY === "number" && Number.isFinite(row.rowCenterY) ? row.rowCenterY : 0
    const panelNum = Number(row.panelIndex ?? 0)
    const panel = panelNum === 1 ? 1 : 0
    let ocrForensicMismatch = false
    if (params.recordOcrForensic !== false && ocrHits.length) {
      const ocr = nearestOcrNumberForRow({
        hits: ocrHits,
        rowCenterY: y,
        panel: panel === 0 ? "left" : "right",
        maxDy: 0.055,
      })
      if (ocr != null && ocr !== numericId) ocrForensicMismatch = true
    }

    out.push({
      ...row,
      questionNumber: numericId,
      physicalIndex: numericId,
      canonicalId: slotDesc.canonicalId,
      hybridOmrParticipation: true,
      ...(ocrForensicMismatch ? { hybridOcrNumericHintMismatch: true } : {}),
    })
  }

  return out.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))
}
