/**
 * Reconstruye questionNumber 1..N alineado a closedQuestionIds usando orden visual + OCR cuando existe.
 * Mantiene biyección con filas emitidas (misma longitud que entrada).
 */
import { getInterleavedGeometryBandTolerance } from "./env"
import { nearestOcrNumberForRow, type OcrNumberHit } from "./ocr-question-numbers"
import { anchorUnusedSlotFromOcr, parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"

export type RebuildQuestionSortOrder = "y_then_panel" | "panel_then_y"

/** Solo si se pasa desde modo debug interleaved; no afecta la lógica de asignación. */
export type RebuildQuestionTraceEvent = {
  oldQuestionNumber: number
  newQuestionNumber: number
  rowCenterY: number
  panel: 0 | 1
  ocrValue: number | null
  assignment: "anchor" | "min_remaining" | "none"
}

function rowCenterYFromDecoded(r: Record<string, unknown>): number {
  const y = r.rowCenterY
  if (typeof y === "number" && Number.isFinite(y)) return y
  return 0
}

function panelFromDecoded(r: Record<string, unknown>): 0 | 1 {
  const p = Number(r.panelIndex ?? 0)
  return p === 1 ? 1 : 0
}

export function sortDecodedForRebuild(
  decoded: Array<Record<string, unknown>>,
  order: RebuildQuestionSortOrder,
): Array<Record<string, unknown>> {
  const bandTol = getInterleavedGeometryBandTolerance()
  return [...decoded].sort((a, b) => {
    if (order === "panel_then_y") {
      const dp = panelFromDecoded(a) - panelFromDecoded(b)
      if (dp !== 0) return dp
      return rowCenterYFromDecoded(a) - rowCenterYFromDecoded(b)
    }
    // y_then_panel: con tolerancia de banda, filas con |ΔY| ≤ tol
    // se tratan como misma banda horizontal → desempate por panel.
    const dy = rowCenterYFromDecoded(a) - rowCenterYFromDecoded(b)
    if (bandTol > 0 && Math.abs(dy) <= bandTol) {
      return panelFromDecoded(a) - panelFromDecoded(b)
    }
    if (dy !== 0) return dy
    return panelFromDecoded(a) - panelFromDecoded(b)
  })
}

/**
 * - y_then_panel: rejilla impar/par (misma altura ~Y, desempate izquierda).
 * - panel_then_y: columna completa izquierda y luego derecha (secuencial).
 */
export function rebuildQuestionSequence(params: {
  decoded: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  ocrHits: OcrNumberHit[]
  /** Un poco más tolerante que el mapa fila-a-fila. */
  maxDyOcr?: number
  sortOrder?: RebuildQuestionSortOrder
  /** Opcional: traza de reasignación (debug interleaved únicamente). */
  onTrace?: (e: RebuildQuestionTraceEvent) => void
}): Array<Record<string, unknown>> {
  const { decoded, closedQuestionIds, ocrHits } = params
  const onTrace = params.onTrace
  const maxDyOcr = typeof params.maxDyOcr === "number" && params.maxDyOcr > 0 ? params.maxDyOcr : 0.055
  const sortOrder: RebuildQuestionSortOrder = params.sortOrder ?? "y_then_panel"
  const nClosed = closedQuestionIds.length
  if (decoded.length === 0) return decoded

  const sorted = sortDecodedForRebuild(decoded, sortOrder)

  const used = new Set<number>()
  const remaining = new Set<number>()
  for (const id of closedQuestionIds) {
    const num = parseClosedIdNumericSlot(id)
    if (num != null) remaining.add(num)
  }

  const out: Array<Record<string, unknown>> = []

  for (const row of sorted) {
    const y = rowCenterYFromDecoded(row)
    const panel = panelFromDecoded(row)
    const ocr = nearestOcrNumberForRow({
      hits: ocrHits,
      rowCenterY: y,
      panel: panel === 0 ? "left" : "right",
      maxDy: maxDyOcr,
    })

    let slot: number | null = null
    let assignment: RebuildQuestionTraceEvent["assignment"] = "none"
    if (ocr != null) {
      slot = anchorUnusedSlotFromOcr(ocr, closedQuestionIds, used)
      if (slot != null) assignment = "anchor"
    }
    if (slot == null && remaining.size > 0) {
      slot = Math.min(...remaining)
      if (slot != null) assignment = "min_remaining"
    }
    if (slot == null) {
      const oldQn = Number(row.questionNumber ?? 0)
      onTrace?.({
        oldQuestionNumber: oldQn,
        newQuestionNumber: oldQn,
        rowCenterY: y,
        panel,
        ocrValue: ocr,
        assignment: "none",
      })
      out.push({ ...row })
      continue
    }
    used.add(slot)
    remaining.delete(slot)
    const oldQn = Number(row.questionNumber ?? 0)
    onTrace?.({
      oldQuestionNumber: oldQn,
      newQuestionNumber: slot,
      rowCenterY: y,
      panel,
      ocrValue: ocr,
      assignment,
    })
    out.push({
      ...row,
      questionNumber: slot,
    })
  }

  return out.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))
}
