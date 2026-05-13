/**
 * Detección de bloques verticales de ítems cerrados (huecos = desarrollo / zona sin burbujas).
 * Aislado del OMR clásico; solo usado bajo feature flag + modo interleaved_development.
 */
import type { IndexedMark } from "./types"

export function meanYOfRow(row: IndexedMark[]): number {
  if (!row.length) return 0
  return row.reduce((s, it) => s + it.mark.centerY, 0) / row.length
}

function medianPositive(nums: number[]): number {
  const s = nums.filter((n) => n > 0).sort((a, b) => a - b)
  if (!s.length) return 0.02
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export type SharedVerticalBand = {
  blockIndex: number
  yMin: number
  yMax: number
  leftRows: IndexedMark[][]
  rightRows: IndexedMark[][]
}

type TaggedRow = { y: number; side: "left" | "right"; row: IndexedMark[] }

/**
 * Agrupa filas izquierda y derecha en las mismas bandas verticales según continuidad en Y mezclada.
 * Evita que un hueco grande en una columna desalinee la otra cuando los cortes son independientes.
 */
export function partitionLeftRightRowsBySharedVerticalBands(
  leftRows: IndexedMark[][],
  rightRows: IndexedMark[][],
  gapFactor = 2.65,
  minCut = 0.028,
): SharedVerticalBand[] {
  const tagged: TaggedRow[] = [
    ...leftRows.map((row) => ({ y: meanYOfRow(row), side: "left" as const, row })),
    ...rightRows.map((row) => ({ y: meanYOfRow(row), side: "right" as const, row })),
  ]
  if (tagged.length === 0) return []

  tagged.sort((a, b) => a.y - b.y)
  const ys = tagged.map((t) => t.y)
  const deltas: number[] = []
  for (let i = 0; i < ys.length - 1; i++) deltas.push(ys[i + 1]! - ys[i]!)
  const med = medianPositive(deltas.length ? deltas : [0.02])
  const cut = Math.max(med * gapFactor, minCut)

  const clusters: TaggedRow[][] = []
  let cur: TaggedRow[] = [tagged[0]!]
  for (let i = 1; i < tagged.length; i++) {
    if (ys[i]! - ys[i - 1]! > cut && cur.length) {
      clusters.push(cur)
      cur = [tagged[i]!]
    } else {
      cur.push(tagged[i]!)
    }
  }
  if (cur.length) clusters.push(cur)

  return clusters.map((cl, blockIndex) => {
    const yMin = Math.min(...cl.map((t) => t.y))
    const yMax = Math.max(...cl.map((t) => t.y))
    return {
      blockIndex,
      yMin,
      yMax,
      leftRows: cl.filter((t) => t.side === "left").map((t) => t.row),
      rightRows: cl.filter((t) => t.side === "right").map((t) => t.row),
    }
  })
}

/**
 * Segmenta filas ya agrupadas por Y (una columna o panel) en bloques por salto vertical atípico.
 * Equivalente al comportamiento previo de segmentRowsIntoGapBlocks, centralizado aquí.
 */
export function segmentRowClustersByVerticalGap(
  rows: IndexedMark[][],
  gapFactor = 2.65,
  minCut = 0.028,
): IndexedMark[][][] {
  if (rows.length === 0) return []
  const yMeans = rows.map((r) => meanYOfRow(r))
  const order = rows.map((_, i) => i).sort((a, b) => yMeans[a]! - yMeans[b]!)
  const deltas: number[] = []
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i]!
    const b = order[i + 1]!
    deltas.push(yMeans[b]! - yMeans[a]!)
  }
  const med = medianPositive(deltas)
  const cut = Math.max(med * gapFactor, minCut)

  const blocks: IndexedMark[][][] = []
  let cur: IndexedMark[][] = []
  for (let k = 0; k < order.length; k++) {
    if (k > 0) {
      const prev = order[k - 1]!
      const curI = order[k]!
      const dy = yMeans[curI]! - yMeans[prev]!
      if (dy > cut && cur.length) {
        blocks.push(cur)
        cur = []
      }
    }
    cur.push(rows[order[k]!]!)
  }
  if (cur.length) blocks.push(cur)
  return blocks
}
