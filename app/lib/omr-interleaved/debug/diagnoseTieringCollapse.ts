/**
 * Diagnóstico forense AISLADO del pareo izquierda/derecha en bandas verticales
 * compartidas. NO modifica producción, NO se integra al pipeline. Sólo expone
 * funciones puras que re-ejecutan localmente `clusterRowsByYIndexed`,
 * `partitionLeftRightRowsBySharedVerticalBands` y `pairLeftRightRowsIntoTiers`
 * sobre el mismo input físico para emitir evidencia comparativa contra una
 * "expectativa física" derivada del pitch real, sin tocar la lógica original.
 *
 * Reglas de oro aplicadas:
 *   - Reversibilidad: este archivo se puede borrar sin efectos colaterales.
 *   - Aislamiento: no exporta nada hacia rutas de scoring/teacher-wizard.
 *   - Producción intacta: las funciones de cluster/partition/pair se importan
 *     READ-ONLY desde sus módulos originales y se invocan sin mutarlas.
 *
 * El objetivo: para cada banda, comparar el tier construido vs el tier
 * esperado y reportar cómo, dónde y por qué se rompe el pareo (clustering,
 * partición de bandas, o umbral de pareo).
 */
import type { IndexedMark, LayoutMark } from "../types"
import { clusterRowsByYIndexed, pairLeftRightRowsIntoTiers, type Tier } from "../cluster-and-decode"
import {
  meanYOfRow,
  partitionLeftRightRowsBySharedVerticalBands,
  type SharedVerticalBand,
} from "../detectVerticalClosedBlocks"
import { bandVerticalSpan, effectivePairingYThreshold } from "../normalizeRowsPerBlock"
import type { InterleavedDebugSnapshot } from "./buildInterleavedDebugSnapshot"

export type TieringCollapsePhase =
  | "none"
  | "clustering_left_right_imbalance"
  | "band_partition_separated_sides"
  | "pairing_threshold_too_narrow"
  | "rows_genuinely_unmatched"

export type TieringPairingFailureCause =
  | "OK_PAIRED"
  | "BAND_THRESHOLD_TOO_NARROW"
  | "ROW_TOO_FAR_FROM_NEIGHBOR"
  | "ORPHAN_NO_NEIGHBOR_IN_BAND"
  | "BAND_HAS_ONLY_ONE_SIDE"
  | "ROW_BELONGS_TO_OTHER_BAND"

export type TieringObservedTier = {
  bandIndex: number
  tierIndexGlobal: number
  rowCenterY: number
  leftPresent: boolean
  rightPresent: boolean
  leftMeanY: number | null
  rightMeanY: number | null
  leftItemCount: number
  rightItemCount: number
  bandHeight: number
  thresholdUsed: number
  distanceLeftRight: number | null
  failureCause: TieringPairingFailureCause
}

export type TieringExpectedTier = {
  expectedTierIndex: number
  expectedY: number
  leftItemCount: number
  rightItemCount: number
  leftMeanY: number | null
  rightMeanY: number | null
  bothSidesPresent: boolean
  pitchUsed: number
}

export type TieringPerRowEvidence = {
  side: "left" | "right"
  rowIndexInSide: number
  meanY: number
  itemIndices: number[]
  itemCount: number
  bandIndex: number | null
  pairedWithSide: "left" | "right" | null
  pairedRowMeanY: number | null
  distanceToPair: number | null
  thresholdUsed: number | null
  isOrphanInObserved: boolean
  isOrphanInExpected: boolean
  orphanReason: TieringPairingFailureCause | null
  expectedNeighborMeanY: number | null
  expectedNeighborSide: "left" | "right" | null
  expectedNeighborDistance: number | null
}

export type TieringRerunWithFixedThreshold = {
  threshold: number
  pairsFormed: number
  leftOrphans: number
  rightOrphans: number
  totalTiers: number
  orphanRatio: number
  pairsRecoveredVsObserved: number
}

export type TieringCollapseDiagnostic = {
  inputSummary: {
    totalItems: number
    leftItemCount: number
    rightItemCount: number
    expectedOptionCount: number
    splitX: number
  }
  clusteringSummary: {
    leftRowCountObserved: number
    rightRowCountObserved: number
    leftRowMeanYs: number[]
    rightRowMeanYs: number[]
    estimatedRowPitch: number
    expectedRowCountFromPitch: number
  }
  bandsSummary: Array<{
    bandIndex: number
    yMin: number
    yMax: number
    bandHeight: number
    leftRowCount: number
    rightRowCount: number
    thresholdComputed: number
    leftMeanY: number | null
    rightMeanY: number | null
    distanceLeftRight: number | null
    pairWouldFormAtFixedThreshold0024: boolean
    pairFormedAtComputedThreshold: boolean
    failureCauseIfNotPaired: TieringPairingFailureCause | null
  }>
  observedTiers: TieringObservedTier[]
  expectedTiers: TieringExpectedTier[]
  observedSummary: {
    totalTiers: number
    pairsFormed: number
    leftOrphans: number
    rightOrphans: number
    orphanRatio: number
  }
  expectedSummary: {
    totalExpectedTiers: number
    expectedPairsBothSides: number
    expectedLeftOnly: number
    expectedRightOnly: number
  }
  perRowEvidence: TieringPerRowEvidence[]
  rerunWithFixedThreshold: TieringRerunWithFixedThreshold
  collapsePhase: TieringCollapsePhase
  collapseEvidence: {
    leftRowCountFromCluster: number
    rightRowCountFromCluster: number
    bandCount: number
    bandsWithBothSides: number
    bandsWithOnlyLeft: number
    bandsWithOnlyRight: number
    bandsThresholdTooNarrowForBothSides: number
    pairsLostDueToBandThreshold: number
    pairsLostDueToBandPartition: number
    rowsWithoutPhysicalNeighbor: number
  }
  collapseExplanation: string
}

export type TieringCollapseComparison = {
  current: TieringCollapseDiagnostic
  previous: {
    leftOrphans: number | null
    rightOrphans: number | null
    totalTiers: number | null
    orphanRatio: number | null
    appearsCollapsed: boolean | null
  } | null
  delta: {
    leftOrphansDelta: number | null
    rightOrphansDelta: number | null
    orphanRatioDelta: number | null
    pairsFormedDelta: number | null
  }
}

function nonZeroPositive(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v) && v > 0)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function estimateRowPitchFromMeans(rowMeans: number[]): number {
  if (rowMeans.length < 2) return 0.05
  const sorted = [...rowMeans].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]! - sorted[i - 1]!)
  const positive = nonZeroPositive(gaps)
  const med = median(positive)
  return Math.max(0.005, med || 0.05)
}

function buildExpectedTiers(
  leftRowMeans: number[],
  rightRowMeans: number[],
  pitch: number,
): TieringExpectedTier[] {
  const halfPitch = pitch * 0.5
  const allMeans = [...leftRowMeans, ...rightRowMeans].sort((a, b) => a - b)
  if (!allMeans.length) return []
  const groups: Array<{ left: number[]; right: number[] }> = []
  let currentY = allMeans[0]!
  let currentGroup: { left: number[]; right: number[] } = { left: [], right: [] }
  groups.push(currentGroup)
  const place = (y: number, side: "left" | "right") => {
    if (Math.abs(y - currentY) > halfPitch) {
      currentGroup = { left: [], right: [] }
      groups.push(currentGroup)
      currentY = y
    }
    if (side === "left") currentGroup.left.push(y)
    else currentGroup.right.push(y)
    currentY = (currentY + y) / 2
  }
  const leftSet = new Set(leftRowMeans)
  for (const y of allMeans) {
    place(y, leftSet.has(y) ? "left" : "right")
  }
  return groups.map((g, idx) => {
    const all = [...g.left, ...g.right]
    const expectedY = all.length ? all.reduce((s, v) => s + v, 0) / all.length : 0
    const leftMeanY = g.left.length ? g.left.reduce((s, v) => s + v, 0) / g.left.length : null
    const rightMeanY = g.right.length ? g.right.reduce((s, v) => s + v, 0) / g.right.length : null
    return {
      expectedTierIndex: idx,
      expectedY,
      leftItemCount: g.left.length,
      rightItemCount: g.right.length,
      leftMeanY,
      rightMeanY,
      bothSidesPresent: g.left.length > 0 && g.right.length > 0,
      pitchUsed: pitch,
    }
  })
}

function classifyFailure(params: {
  leftPresent: boolean
  rightPresent: boolean
  bandHeight: number
  thresholdUsed: number
  distance: number | null
  fixedThresholdWouldPair: boolean
}): TieringPairingFailureCause {
  const { leftPresent, rightPresent, distance, thresholdUsed, fixedThresholdWouldPair } = params
  if (leftPresent && rightPresent) {
    if (distance != null && distance <= thresholdUsed) return "OK_PAIRED"
    if (distance != null && fixedThresholdWouldPair) return "BAND_THRESHOLD_TOO_NARROW"
    return "ROW_TOO_FAR_FROM_NEIGHBOR"
  }
  if (leftPresent && !rightPresent) return "BAND_HAS_ONLY_ONE_SIDE"
  if (!leftPresent && rightPresent) return "BAND_HAS_ONLY_ONE_SIDE"
  return "ORPHAN_NO_NEIGHBOR_IN_BAND"
}

function pickFirstBand(
  bands: SharedVerticalBand[],
  side: "left" | "right",
  rowMean: number,
): number | null {
  for (const b of bands) {
    const sideRows = side === "left" ? b.leftRows : b.rightRows
    for (const r of sideRows) {
      if (Math.abs(meanYOfRow(r) - rowMean) < 1e-6) return b.blockIndex
    }
  }
  return null
}

function nearestExpectedNeighbor(
  expected: TieringExpectedTier[],
  rowMean: number,
  side: "left" | "right",
): { neighborMeanY: number | null; neighborSide: "left" | "right" | null; distance: number | null } {
  const otherSide = side === "left" ? "right" : "left"
  let best: { y: number; d: number } | null = null
  for (const tier of expected) {
    const candidate = otherSide === "left" ? tier.leftMeanY : tier.rightMeanY
    if (candidate == null) continue
    if (Math.abs(tier.expectedY - rowMean) > Math.max(0.05, tier.pitchUsed)) continue
    const d = Math.abs(candidate - rowMean)
    if (!best || d < best.d) best = { y: candidate, d }
  }
  if (!best) return { neighborMeanY: null, neighborSide: null, distance: null }
  return { neighborMeanY: best.y, neighborSide: otherSide, distance: best.d }
}

export function diagnoseTieringFromIndexedMarks(params: {
  items: IndexedMark[]
  expectedOptionCount?: number
  splitX?: number
  fixedThreshold?: number
}): TieringCollapseDiagnostic {
  const expectedOptionCount = params.expectedOptionCount ?? 4
  const splitX = params.splitX ?? 0.5
  const fixedThreshold = params.fixedThreshold ?? 0.024
  const items = params.items
  const leftItems = items.filter((it) => it.mark.centerX <= splitX)
  const rightItems = items.filter((it) => it.mark.centerX > splitX)

  const leftRows = clusterRowsByYIndexed(leftItems)
  const rightRows = clusterRowsByYIndexed(rightItems)
  const leftRowMeans = leftRows.map((r) => meanYOfRow(r))
  const rightRowMeans = rightRows.map((r) => meanYOfRow(r))
  const allRowMeans = [...leftRowMeans, ...rightRowMeans]
  const pitch = estimateRowPitchFromMeans(allRowMeans)
  const expectedRowCountFromPitch = Math.max(
    1,
    Math.round(((allRowMeans.length ? Math.max(...allRowMeans) : 0) - (allRowMeans.length ? Math.min(...allRowMeans) : 0)) / Math.max(1e-6, pitch)) + 1,
  )

  const bands = partitionLeftRightRowsBySharedVerticalBands(leftRows, rightRows)
  const observedTiers: TieringObservedTier[] = []
  const observedTiersByFixed: Tier[] = []
  let tierIndexGlobal = 0
  const bandsSummary: TieringCollapseDiagnostic["bandsSummary"] = []

  for (const band of bands) {
    const h = bandVerticalSpan(band.yMin, band.yMax)
    const yTh = effectivePairingYThreshold(h)
    const tiers = pairLeftRightRowsIntoTiers(band.leftRows, band.rightRows, yTh)
    const tiersFixed = pairLeftRightRowsIntoTiers(band.leftRows, band.rightRows, fixedThreshold)
    observedTiersByFixed.push(...tiersFixed)
    const leftMeanY = band.leftRows.length
      ? band.leftRows.reduce((s, r) => s + meanYOfRow(r), 0) / band.leftRows.length
      : null
    const rightMeanY = band.rightRows.length
      ? band.rightRows.reduce((s, r) => s + meanYOfRow(r), 0) / band.rightRows.length
      : null
    const distanceLeftRight =
      leftMeanY != null && rightMeanY != null ? Math.abs(leftMeanY - rightMeanY) : null
    const pairFormedAtComputedThreshold = tiers.some((t) => !!t.left && !!t.right)
    const pairWouldFormAtFixedThreshold = tiersFixed.some((t) => !!t.left && !!t.right)
    const failureCauseIfNotPaired: TieringPairingFailureCause | null = pairFormedAtComputedThreshold
      ? null
      : classifyFailure({
          leftPresent: band.leftRows.length > 0,
          rightPresent: band.rightRows.length > 0,
          bandHeight: h,
          thresholdUsed: yTh,
          distance: distanceLeftRight,
          fixedThresholdWouldPair: pairWouldFormAtFixedThreshold,
        })

    bandsSummary.push({
      bandIndex: band.blockIndex,
      yMin: band.yMin,
      yMax: band.yMax,
      bandHeight: h,
      leftRowCount: band.leftRows.length,
      rightRowCount: band.rightRows.length,
      thresholdComputed: yTh,
      leftMeanY,
      rightMeanY,
      distanceLeftRight,
      pairWouldFormAtFixedThreshold0024: pairWouldFormAtFixedThreshold,
      pairFormedAtComputedThreshold,
      failureCauseIfNotPaired,
    })

    for (const t of tiers) {
      const lY = t.left ? meanYOfRow(t.left) : null
      const rY = t.right ? meanYOfRow(t.right) : null
      const dist = lY != null && rY != null ? Math.abs(lY - rY) : null
      const cause = classifyFailure({
        leftPresent: !!t.left,
        rightPresent: !!t.right,
        bandHeight: h,
        thresholdUsed: yTh,
        distance: dist,
        fixedThresholdWouldPair: pairWouldFormAtFixedThreshold,
      })
      observedTiers.push({
        bandIndex: band.blockIndex,
        tierIndexGlobal,
        rowCenterY: t.y,
        leftPresent: !!t.left,
        rightPresent: !!t.right,
        leftMeanY: lY,
        rightMeanY: rY,
        leftItemCount: t.left?.length ?? 0,
        rightItemCount: t.right?.length ?? 0,
        bandHeight: h,
        thresholdUsed: yTh,
        distanceLeftRight: dist,
        failureCause: cause,
      })
      tierIndexGlobal++
    }
  }

  const expectedTiers = buildExpectedTiers(leftRowMeans, rightRowMeans, pitch)

  const perRowEvidence: TieringPerRowEvidence[] = []
  const sideRows: Array<{ side: "left" | "right"; rowIdx: number; row: IndexedMark[] }> = [
    ...leftRows.map((row, rowIdx) => ({ side: "left" as const, rowIdx, row })),
    ...rightRows.map((row, rowIdx) => ({ side: "right" as const, rowIdx, row })),
  ]
  for (const { side, rowIdx, row } of sideRows) {
    const my = meanYOfRow(row)
    const itemIndices = row.map((it) => it.idx)
    const bandIdx = pickFirstBand(bands, side, my)
    const tier = observedTiers.find((t) => {
      if (side === "left") return t.leftPresent && t.leftMeanY != null && Math.abs(t.leftMeanY - my) < 1e-6
      return t.rightPresent && t.rightMeanY != null && Math.abs(t.rightMeanY - my) < 1e-6
    })
    const isOrphanInObserved = tier ? !(tier.leftPresent && tier.rightPresent) : true
    const expectedNeighbor = nearestExpectedNeighbor(expectedTiers, my, side)
    const isOrphanInExpected = (() => {
      const expectedTier = expectedTiers.find(
        (e) => Math.abs(e.expectedY - my) <= Math.max(pitch * 0.5, 0.005),
      )
      if (!expectedTier) return true
      return !expectedTier.bothSidesPresent
    })()
    let orphanReason: TieringPairingFailureCause | null = null
    if (isOrphanInObserved) {
      // Evaluación a nivel de BANDA primero: si la banda contiene ambos lados
      // pero no se formó el par, la causa real es el umbral, NO la unilateralidad
      // del tier (los tiers izq/der huérfanos derivan de esa misma falla).
      const bandLevel = bandIdx != null ? bandsSummary.find((b) => b.bandIndex === bandIdx) : null
      if (
        bandLevel &&
        bandLevel.leftRowCount > 0 &&
        bandLevel.rightRowCount > 0 &&
        !bandLevel.pairFormedAtComputedThreshold &&
        bandLevel.pairWouldFormAtFixedThreshold0024
      ) {
        orphanReason = "BAND_THRESHOLD_TOO_NARROW"
      } else if (
        bandLevel &&
        bandLevel.leftRowCount > 0 &&
        bandLevel.rightRowCount > 0 &&
        !bandLevel.pairFormedAtComputedThreshold
      ) {
        orphanReason = "ROW_TOO_FAR_FROM_NEIGHBOR"
      } else if (tier?.failureCause === "BAND_THRESHOLD_TOO_NARROW") {
        orphanReason = "BAND_THRESHOLD_TOO_NARROW"
      } else if (tier?.failureCause === "BAND_HAS_ONLY_ONE_SIDE") {
        orphanReason = "BAND_HAS_ONLY_ONE_SIDE"
      } else if (tier?.failureCause === "ROW_TOO_FAR_FROM_NEIGHBOR") {
        orphanReason = "ROW_TOO_FAR_FROM_NEIGHBOR"
      } else if (!tier) {
        orphanReason = "ROW_BELONGS_TO_OTHER_BAND"
      } else {
        orphanReason = "ORPHAN_NO_NEIGHBOR_IN_BAND"
      }
    }
    perRowEvidence.push({
      side,
      rowIndexInSide: rowIdx,
      meanY: my,
      itemIndices,
      itemCount: row.length,
      bandIndex: bandIdx,
      pairedWithSide: tier && tier.leftPresent && tier.rightPresent ? (side === "left" ? "right" : "left") : null,
      pairedRowMeanY:
        tier && tier.leftPresent && tier.rightPresent
          ? side === "left"
            ? tier.rightMeanY
            : tier.leftMeanY
          : null,
      distanceToPair: tier ? tier.distanceLeftRight : null,
      thresholdUsed: tier ? tier.thresholdUsed : null,
      isOrphanInObserved,
      isOrphanInExpected,
      orphanReason,
      expectedNeighborMeanY: expectedNeighbor.neighborMeanY,
      expectedNeighborSide: expectedNeighbor.neighborSide,
      expectedNeighborDistance: expectedNeighbor.distance,
    })
  }

  const observedPaired = observedTiers.filter((t) => t.leftPresent && t.rightPresent).length
  const observedLeftOrphans = observedTiers.filter((t) => t.leftPresent && !t.rightPresent).length
  const observedRightOrphans = observedTiers.filter((t) => !t.leftPresent && t.rightPresent).length
  const observedTotalTiers = observedTiers.length
  const observedOrphanRatio =
    observedTotalTiers > 0
      ? (observedLeftOrphans + observedRightOrphans) / observedTotalTiers
      : 0

  const fixedPaired = observedTiersByFixed.filter((t) => t.left && t.right).length
  const fixedLeftOrphans = observedTiersByFixed.filter((t) => t.left && !t.right).length
  const fixedRightOrphans = observedTiersByFixed.filter((t) => !t.left && t.right).length
  const fixedTotalTiers = observedTiersByFixed.length
  const fixedOrphanRatio =
    fixedTotalTiers > 0 ? (fixedLeftOrphans + fixedRightOrphans) / fixedTotalTiers : 0

  const bandsBoth = bandsSummary.filter((b) => b.leftRowCount > 0 && b.rightRowCount > 0).length
  const bandsLeftOnly = bandsSummary.filter((b) => b.leftRowCount > 0 && b.rightRowCount === 0).length
  const bandsRightOnly = bandsSummary.filter((b) => b.leftRowCount === 0 && b.rightRowCount > 0).length
  const bandsThresholdTooNarrow = bandsSummary.filter(
    (b) =>
      b.leftRowCount > 0 &&
      b.rightRowCount > 0 &&
      !b.pairFormedAtComputedThreshold &&
      b.pairWouldFormAtFixedThreshold0024,
  ).length
  const pairsLostDueToBandThreshold = bandsThresholdTooNarrow
  const pairsLostDueToBandPartition = bandsLeftOnly + bandsRightOnly
  const rowsWithoutPhysicalNeighbor = perRowEvidence.filter(
    (r) => r.expectedNeighborDistance == null || r.expectedNeighborDistance > pitch * 0.6,
  ).length

  const collapsePhase: TieringCollapsePhase = (() => {
    if (
      Math.abs(leftRows.length - rightRows.length) >
      Math.max(2, Math.round(Math.max(leftRows.length, rightRows.length) * 0.25))
    ) {
      return "clustering_left_right_imbalance"
    }
    if (pairsLostDueToBandThreshold >= Math.max(3, Math.round(bandsBoth * 0.3))) {
      return "pairing_threshold_too_narrow"
    }
    if (pairsLostDueToBandPartition >= Math.max(3, Math.round(bandsSummary.length * 0.3))) {
      return "band_partition_separated_sides"
    }
    if (rowsWithoutPhysicalNeighbor >= Math.max(3, Math.round(allRowMeans.length * 0.3))) {
      return "rows_genuinely_unmatched"
    }
    return "none"
  })()

  const collapseExplanation = (() => {
    switch (collapsePhase) {
      case "pairing_threshold_too_narrow":
        return (
          "El colapso de tiering se produce DESPUÉS del clustering y de la partición en bandas. " +
          "`partitionLeftRightRowsBySharedVerticalBands` agrupa correctamente filas izquierda+derecha en la misma banda, " +
          "pero `effectivePairingYThreshold(bandHeight)` retorna `min(0.024, bandHeight*0.25)`: cuando una banda contiene " +
          "exactamente una fila por lado con dy pequeño, bandHeight ≈ dy, por lo que el umbral resulta ≈ dy/4 < dy y " +
          "`pairLeftRightRowsIntoTiers` no puede formar el par. La consecuencia es que prácticamente cada banda con 2 lados " +
          "produce 2 órfanos en lugar de 1 par."
        )
      case "clustering_left_right_imbalance":
        return (
          "El colapso ocurre DENTRO de `clusterRowsByYIndexed`: el conteo de filas izquierda y derecha es asimétrico, lo que " +
          "indica que el ancla por primer ítem (row[0].centerY) está desfasando la asignación de filas y la partición de " +
          "bandas no puede recuperar la simetría."
        )
      case "band_partition_separated_sides":
        return (
          "El clustering por lado funciona, pero `partitionLeftRightRowsBySharedVerticalBands` está separando los lados en " +
          "bandas distintas. Esto sugiere que el `gapFactor` (2.65) o `minCut` (0.028) están cortando entre filas left/right " +
          "muy próximas en lugar de mantenerlas en la misma banda."
        )
      case "rows_genuinely_unmatched":
        return (
          "Los huérfanos son físicamente reales: muchas filas en un lado no tienen vecino físico cercano en el otro lado " +
          "según el pitch estimado. No es un bug, es la geometría real del template (interleaved development con desbalance)."
        )
      case "none":
      default:
        return "No se detecta colapso significativo de tiering bajo los heurísticos actuales."
    }
  })()

  const expectedPairsBothSides = expectedTiers.filter((t) => t.bothSidesPresent).length
  const expectedLeftOnly = expectedTiers.filter(
    (t) => t.leftItemCount > 0 && t.rightItemCount === 0,
  ).length
  const expectedRightOnly = expectedTiers.filter(
    (t) => t.leftItemCount === 0 && t.rightItemCount > 0,
  ).length

  return {
    inputSummary: {
      totalItems: items.length,
      leftItemCount: leftItems.length,
      rightItemCount: rightItems.length,
      expectedOptionCount,
      splitX,
    },
    clusteringSummary: {
      leftRowCountObserved: leftRows.length,
      rightRowCountObserved: rightRows.length,
      leftRowMeanYs: leftRowMeans,
      rightRowMeanYs: rightRowMeans,
      estimatedRowPitch: pitch,
      expectedRowCountFromPitch,
    },
    bandsSummary,
    observedTiers,
    expectedTiers,
    observedSummary: {
      totalTiers: observedTotalTiers,
      pairsFormed: observedPaired,
      leftOrphans: observedLeftOrphans,
      rightOrphans: observedRightOrphans,
      orphanRatio: observedOrphanRatio,
    },
    expectedSummary: {
      totalExpectedTiers: expectedTiers.length,
      expectedPairsBothSides,
      expectedLeftOnly,
      expectedRightOnly,
    },
    perRowEvidence,
    rerunWithFixedThreshold: {
      threshold: fixedThreshold,
      pairsFormed: fixedPaired,
      leftOrphans: fixedLeftOrphans,
      rightOrphans: fixedRightOrphans,
      totalTiers: fixedTotalTiers,
      orphanRatio: fixedOrphanRatio,
      pairsRecoveredVsObserved: Math.max(0, fixedPaired - observedPaired),
    },
    collapsePhase,
    collapseEvidence: {
      leftRowCountFromCluster: leftRows.length,
      rightRowCountFromCluster: rightRows.length,
      bandCount: bandsSummary.length,
      bandsWithBothSides: bandsBoth,
      bandsWithOnlyLeft: bandsLeftOnly,
      bandsWithOnlyRight: bandsRightOnly,
      bandsThresholdTooNarrowForBothSides: bandsThresholdTooNarrow,
      pairsLostDueToBandThreshold,
      pairsLostDueToBandPartition,
      rowsWithoutPhysicalNeighbor,
    },
    collapseExplanation,
  }
}

function syntheticLayoutMark(centerX: number, centerY: number, confidence: number): LayoutMark {
  return {
    state: "unselected",
    polygonNorm: [
      { x: centerX, y: centerY },
      { x: centerX, y: centerY },
      { x: centerX, y: centerY },
      { x: centerX, y: centerY },
    ],
    centerX,
    centerY,
    confidence,
  }
}

export function reconstructIndexedMarksFromSnapshot(
  snapshot: InterleavedDebugSnapshot,
): IndexedMark[] {
  const gd = snapshot.geometryDiagnostics
  const raw = gd?.rawDetectionDiagnostics ?? []
  if (raw.length > 0) {
    return raw
      .map(
        (r): IndexedMark => ({
          idx: r.detectionIdx,
          mark: syntheticLayoutMark(r.centerX, r.centerY, r.confidence),
        }),
      )
      .sort((a, b) => a.idx - b.idx)
  }
  const dbc = gd?.detectedBubbleCenters ?? []
  return dbc
    .map(
      (d): IndexedMark => ({
        idx: d.idx,
        mark: syntheticLayoutMark(d.x, d.y, 1),
      }),
    )
    .sort((a, b) => a.idx - b.idx)
}

export function diagnoseTieringFromSnapshot(
  snapshot: InterleavedDebugSnapshot,
  options?: { expectedOptionCount?: number; splitX?: number; fixedThreshold?: number },
): TieringCollapseComparison {
  const items = reconstructIndexedMarksFromSnapshot(snapshot)
  const current = diagnoseTieringFromIndexedMarks({
    items,
    expectedOptionCount: options?.expectedOptionCount,
    splitX: options?.splitX,
    fixedThreshold: options?.fixedThreshold,
  })
  const previousReport = snapshot.targetedPhysicalTraceReport?.tieringPartialCollapse
  const pairings = Array.isArray(snapshot.pairings) ? snapshot.pairings : []
  const fallbackPreviousFromPairings = pairings.length
    ? {
        leftOrphans: pairings.filter((p) => p.leftOrphan).length,
        rightOrphans: pairings.filter((p) => p.rightOrphan).length,
        totalTiers: pairings.length,
        orphanRatio:
          pairings.length > 0
            ? (pairings.filter((p) => p.leftOrphan).length +
                pairings.filter((p) => p.rightOrphan).length) /
              pairings.length
            : 0,
        appearsCollapsed: null as boolean | null,
      }
    : null
  const previous = previousReport
    ? {
        leftOrphans: previousReport.leftOrphans,
        rightOrphans: previousReport.rightOrphans,
        totalTiers: previousReport.totalTiers,
        orphanRatio: previousReport.orphanRatio,
        appearsCollapsed: previousReport.appearsCollapsed as boolean | null,
      }
    : fallbackPreviousFromPairings
  return {
    current,
    previous,
    delta: {
      leftOrphansDelta:
        previous?.leftOrphans != null ? current.observedSummary.leftOrphans - previous.leftOrphans : null,
      rightOrphansDelta:
        previous?.rightOrphans != null
          ? current.observedSummary.rightOrphans - previous.rightOrphans
          : null,
      orphanRatioDelta:
        previous?.orphanRatio != null
          ? current.observedSummary.orphanRatio - previous.orphanRatio
          : null,
      pairsFormedDelta:
        previous?.totalTiers != null && previous?.leftOrphans != null && previous?.rightOrphans != null
          ? current.observedSummary.pairsFormed -
            (previous.totalTiers - previous.leftOrphans - previous.rightOrphans)
          : null,
    },
  }
}
