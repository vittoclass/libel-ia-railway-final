/**
 * Validación y realineación estructural post-interleaving (solo pipeline interleaved).
 * Corrige desfases fila→pregunta cuando la zip visual↔slot OMR queda corrida tras ítems de desarrollo.
 * No toca OMR clásico ni azure-layout-omr-pipeline.
 */
import type { HybridSlotTopology } from "./hybrid-slot-topology"
import { getOmrSlotsInPhysicalOrder } from "./hybrid-slot-topology"
import { validateHybridPostMapPhysicalIntegrity } from "./hybrid-physical-integrity"
import { nearestOcrNumberForRow, type OcrNumberHit } from "./ocr-question-numbers"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"
import { sortDecodedForRebuild } from "./rebuildQuestionSequence"
import type { RebuildQuestionSortOrder } from "./rebuildQuestionSequence"
import { isInterleavedStructuralRealignmentEnabled } from "./env"

function normId(id: string): string {
  return String(id ?? "").trim()
}

function canonicalNumericId(canonicalId: string): number | null {
  return parseClosedIdNumericSlot(canonicalId)
}

/** Asignación coste mínimo n×n (Hungarian). Entrada/salida 0-based; matriz cuadrada. */
function minCostAssignment(cost: number[][]): number[] {
  const n = cost.length
  if (n === 0) return []
  if (cost[0]?.length !== n) throw new Error("minCostAssignment: matriz no cuadrada")
  const INF = Number.POSITIVE_INFINITY
  const u = new Array(n + 1).fill(0)
  const v = new Array(n + 1).fill(0)
  const p = new Array(n + 1).fill(0)
  const way = new Array(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(n + 1).fill(INF)
    const used = new Array(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]!
      let delta = INF
      let j1 = 0
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!
          if (cur < minv[j]!) {
            minv[j] = cur
            way[j] = j0
          }
          if (minv[j]! < delta) {
            delta = minv[j]!
            j1 = j
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!]! += delta
          v[j]! -= delta
        } else {
          minv[j]! -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]!
      p[j0] = p[j1]!
      j0 = j1
    } while (j0)
  }
  const assignment = new Array(n).fill(-1)
  for (let j = 1; j <= n; j++) {
    if (p[j] !== 0) assignment[p[j]! - 1] = j - 1
  }
  return assignment
}

function panelSide(row: Record<string, unknown>): "left" | "right" {
  return Number(row.panelIndex ?? 0) === 1 ? "right" : "left"
}

function rowCenterY(row: Record<string, unknown>): number {
  const y = row.rowCenterY
  return typeof y === "number" && Number.isFinite(y) ? y : 0
}

function identityPermutation(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function isIdentity(perm: number[]): boolean {
  return perm.every((j, i) => j === i)
}

/** Si perm[i]=j y j-i es constante, devuelve ese desfase; si no, null. */
function uniformShiftOffset(perm: number[]): number | null {
  if (perm.length === 0) return null
  const d0 = perm[0]! - 0
  for (let i = 1; i < perm.length; i++) {
    if (perm[i]! - i !== d0) return null
  }
  return d0
}

function longestConsecutiveMismatchRun(flags: boolean[]): number {
  let best = 0
  let cur = 0
  for (const f of flags) {
    if (f) {
      cur++
      best = Math.max(best, cur)
    } else {
      cur = 0
    }
  }
  return best
}

function totalCost(cost: number[][], perm: number[]): number {
  let s = 0
  for (let i = 0; i < perm.length; i++) s += cost[i]![perm[i]!]!
  return s
}

export type InterleavedStructuralRealignmentTelemetry = {
  interleavedStructuralShiftDetected: boolean
  interleavedStructuralShiftOffset: number | null
  interleavedStructuralRealignmentApplied: boolean
}

/**
 * Tras `mapInterleavedByVariant` + validación híbrida OK: re-evalúa fila↔slot usando
 * OCR (si hay), suavizado posicional y topología canónica; reasigna solo metadatos de pregunta.
 */
export function applyInterleavedStructuralRealignment(params: {
  perQuestion: Array<Record<string, unknown>>
  topology: HybridSlotTopology
  closedQuestionIds: string[]
  ocrHits: OcrNumberHit[]
  strictHybridPostMap: boolean
  rebuildSortOrder?: RebuildQuestionSortOrder
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: InterleavedStructuralRealignmentTelemetry
} {
  const emptyTelemetry: InterleavedStructuralRealignmentTelemetry = {
    interleavedStructuralShiftDetected: false,
    interleavedStructuralShiftOffset: null,
    interleavedStructuralRealignmentApplied: false,
  }

  const { topology, closedQuestionIds, ocrHits, strictHybridPostMap } = params
  let { perQuestion } = params

  if (!isInterleavedStructuralRealignmentEnabled() || !topology.hasInterleavedDevelopment) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  const closedIds = closedQuestionIds.map(normId).filter(Boolean)
  const omrSlots = getOmrSlotsInPhysicalOrder(topology)
  const n = omrSlots.length
  if (n < 2 || perQuestion.length !== n) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  const sortedRows = sortDecodedForRebuild(perQuestion, params.rebuildSortOrder ?? "y_then_panel")
  const maxDy = 0.055
  const positionalWeight = 0.018

  const ocrByRow: (number | null)[] = sortedRows.map((row) =>
    ocrHits.length
      ? nearestOcrNumberForRow({
          hits: ocrHits,
          rowCenterY: rowCenterY(row),
          panel: panelSide(row),
          maxDy,
        })
      : null,
  )

  const slotNumeric: (number | null)[] = omrSlots.map((s) => parseClosedIdNumericSlot(s.canonicalId))

  const cost: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    const ocr = ocrByRow[i]
    for (let j = 0; j < n; j++) {
      const sn = slotNumeric[j]
      let c = positionalWeight * Math.abs(i - j)
      if (ocr != null && sn != null) {
        c += ocr === sn ? 0 : 1.15
      } else if (ocr != null || sn != null) {
        c += 0.32
      } else {
        c += 0.08
      }
      row.push(c)
    }
    cost.push(row)
  }

  const identity = identityPermutation(n)
  const identityCostVal = totalCost(cost, identity)

  /** Inconsistencia explícita pregunta vs canonical en la fila materializada. */
  const structuralMismatch: boolean[] = sortedRows.map((row) => {
    const qn = Number(row.questionNumber ?? 0)
    const cid = String(row.canonicalId ?? "")
    const expectedNum = cid ? canonicalNumericId(cid) : null
    if (!Number.isFinite(qn) || qn < 1 || expectedNum == null) return false
    return qn !== expectedNum
  })

  /** Par físico↔canónico de la fila vs descriptor oficial en topología (mismo physicalIndex). */
  const topologyPairMismatch: boolean[] = sortedRows.map((row) => {
    const pi = row.physicalIndex
    const cid = normId(String(row.canonicalId ?? ""))
    if (typeof pi !== "number" || !Number.isFinite(pi) || !cid) return false
    const desc = topology.hybridSlotDescriptors.find((d) => d.physicalIndex === pi)
    if (!desc || !desc.participatesInOmr) return false
    return normId(desc.canonicalId) !== cid
  })

  const ocrMismatchIdentity: boolean[] = identity.map((j, i) => {
    const ocr = ocrByRow[i]
    const sn = slotNumeric[j]
    return ocr != null && sn != null && ocr !== sn
  })

  const runStruct = longestConsecutiveMismatchRun(structuralMismatch)
  const runTopo = longestConsecutiveMismatchRun(topologyPairMismatch)
  const runOcr = longestConsecutiveMismatchRun(ocrMismatchIdentity)
  const mismatchRate = ocrMismatchIdentity.filter(Boolean).length / Math.max(1, n)
  const topoRate = topologyPairMismatch.filter(Boolean).length / Math.max(1, n)

  const gateByStructure =
    (structuralMismatch.some(Boolean) && (runStruct >= 2 || structuralMismatch.filter(Boolean).length >= 2)) ||
    (topologyPairMismatch.some(Boolean) && (runTopo >= 2 || topoRate >= 0.15))
  const gateByOcr =
    ocrHits.length > 0 &&
    (runOcr >= 2 || (n >= 5 && mismatchRate >= 0.18) || (n >= 4 && mismatchRate >= 0.12))

  if (!gateByStructure && !gateByOcr) {
    return { perQuestion, telemetry: emptyTelemetry }
  }

  const optimal = minCostAssignment(cost)
  const optimalCostVal = totalCost(cost, optimal)
  const improvement = identityCostVal - optimalCostVal

  if (!isIdentity(optimal) && improvement <= 1e-4) {
    return {
      perQuestion,
      telemetry: {
        interleavedStructuralShiftDetected: true,
        interleavedStructuralShiftOffset: uniformShiftOffset(optimal),
        interleavedStructuralRealignmentApplied: false,
      },
    }
  }

  if (isIdentity(optimal) || improvement < 0.35) {
    return {
      perQuestion,
      telemetry: {
        interleavedStructuralShiftDetected: false,
        interleavedStructuralShiftOffset: null,
        interleavedStructuralRealignmentApplied: false,
      },
    }
  }

  const rebuilt: Array<Record<string, unknown>> = []
  for (let i = 0; i < n; i++) {
    const j = optimal[i]!
    const slot = omrSlots[j]!
    const numericId = canonicalNumericId(slot.canonicalId)
    if (numericId == null || numericId < 1) continue
    const base: Record<string, unknown> = { ...(sortedRows[i] as Record<string, unknown>) }
    delete base.hybridOcrNumericHintMismatch
    rebuilt.push({
      ...base,
      questionNumber: numericId,
      physicalIndex: numericId,
      canonicalId: slot.canonicalId,
      hybridOmrParticipation: true,
    })
  }

  if (rebuilt.length !== n) {
    return {
      perQuestion,
      telemetry: {
        interleavedStructuralShiftDetected: true,
        interleavedStructuralShiftOffset: uniformShiftOffset(optimal),
        interleavedStructuralRealignmentApplied: false,
      },
    }
  }

  rebuilt.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))

  const post = validateHybridPostMapPhysicalIntegrity({
    perQuestion: rebuilt,
    topology,
    closedQuestionIds: closedIds,
    strictHybrid: strictHybridPostMap,
  })

  if (!post.ok) {
    return {
      perQuestion,
      telemetry: {
        interleavedStructuralShiftDetected: true,
        interleavedStructuralShiftOffset: uniformShiftOffset(optimal),
        interleavedStructuralRealignmentApplied: false,
      },
    }
  }

  return {
    perQuestion: rebuilt,
    telemetry: {
      interleavedStructuralShiftDetected: true,
      interleavedStructuralShiftOffset: uniformShiftOffset(optimal),
      interleavedStructuralRealignmentApplied: true,
    },
  }
}
