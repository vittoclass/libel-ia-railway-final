/**
 * Resúmenes de bandas Y para diagnóstico (pipeline interleaved). Sin efecto en scoring.
 */
import type { IndexedMark } from "../types"
import { meanYOfRow, type SharedVerticalBand } from "../detectVerticalClosedBlocks"

export type InterleavedBandSummary = {
  bandIndex: number
  yMin: number
  yMax: number
  leftRowCount: number
  rightRowCount: number
}

export function summarizeSharedVerticalBands(bands: SharedVerticalBand[]): InterleavedBandSummary[] {
  return bands.map((b) => ({
    bandIndex: b.blockIndex,
    yMin: b.yMin,
    yMax: b.yMax,
    leftRowCount: b.leftRows.length,
    rightRowCount: b.rightRows.length,
  }))
}

/** Bloques por gap vertical en columna única (una “banda” por bloque). */
export function summarizeSingleColumnGapBlocks(blocks: IndexedMark[][][]): InterleavedBandSummary[] {
  return blocks.map((block, bandIndex) => {
    const ys = block.map((row) => meanYOfRow(row))
    return {
      bandIndex,
      yMin: ys.length ? Math.min(...ys) : 0,
      yMax: ys.length ? Math.max(...ys) : 0,
      leftRowCount: block.length,
      rightRowCount: 0,
    }
  })
}
