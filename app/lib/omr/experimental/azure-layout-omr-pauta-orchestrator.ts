/**
 * Orquestador externo: reproyección Y por bloques de desarrollo en la pauta (sin tocar visión de bajo nivel).
 * Desactivación total (modo espejo): OMR_PAUTA_SEGMENTATION=0
 *
 * Solo odd_even_dual_column con ≥2 segmentos en al menos un panel; si no aplica → legacyMapDual.
 *
 * clusterRowsByY aquí es copia literal (umbral 0.018) de azure-layout-omr-pipeline para evitar import
 * circular; si se cambia allí, sincronizar manualmente o extraer módulo compartido.
 */
export type OmrTemplateVariantOrchestrator =
  | "odd_even_dual_column"
  | "sequential_dual_column"
  | "single_column"

type OmrLayoutMark = {
  state: "selected" | "unselected"
  polygonNorm: { x: number; y: number }[]
  centerX: number
  centerY: number
  confidence: number
}

export type PautaItemOmSegmentation = { isDevelopment: boolean }

export type PanelSegmentPlan = { left: number[]; right: number[]; hasDevelopmentGaps: boolean }

/** Orden de instrumento: impares en columna izq., pares en der.; flush al encontrar desarrollo. */
export function buildOddEvenPanelSegmentPlan(items: PautaItemOmSegmentation[]): PanelSegmentPlan {
  let leftRun = 0
  let rightRun = 0
  const leftSegs: number[] = []
  const rightSegs: number[] = []
  let nextClosedGoesLeft = true
  let sawDev = false

  const flush = () => {
    if (leftRun > 0) {
      leftSegs.push(leftRun)
      leftRun = 0
    }
    if (rightRun > 0) {
      rightSegs.push(rightRun)
      rightRun = 0
    }
  }

  for (const it of items) {
    if (it.isDevelopment) {
      sawDev = true
      flush()
      continue
    }
    if (nextClosedGoesLeft) leftRun++
    else rightRun++
    nextClosedGoesLeft = !nextClosedGoesLeft
  }
  flush()

  const hasDevelopmentGaps = sawDev && (leftSegs.length > 1 || rightSegs.length > 1)

  return { left: leftSegs, right: rightSegs, hasDevelopmentGaps }
}

type Indexed = { idx: number; mark: OmrLayoutMark }

/** Copia de clusterRowsByY del pipeline (no modificar umbral sin alinear ambos archivos). */
function clusterRowsByYOrchestratorCopy(items: Indexed[]): Indexed[][] {
  const sorted = [...items].sort((a, b) => a.mark.centerY - b.mark.centerY)
  const rows: Indexed[][] = []
  const threshold = 0.018
  for (const it of sorted) {
    let placed = false
    for (const row of rows) {
      const ry = row[0]!.mark.centerY
      if (Math.abs(it.mark.centerY - ry) < threshold) {
        row.push(it)
        placed = true
        break
      }
    }
    if (!placed) rows.push([it])
  }
  for (const row of rows) {
    row.sort((a, b) => a.mark.centerX - b.mark.centerX)
  }
  return rows
}

function letter(i: number): string {
  return ["A", "B", "C", "D", "E", "F", "G", "H"][i] ?? "?"
}

function kmeans1d(values: number[], k: number): number[] {
  if (!values.length) return Array.from({ length: k }, (_, i) => (i + 0.5) / k)
  const sorted = [...values].sort((a, b) => a - b)
  const centers = Array.from({ length: k }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / Math.max(1, k - 1))]!)
  for (let iter = 0; iter < 10; iter++) {
    const buckets: number[][] = Array.from({ length: k }, () => [])
    for (const v of sorted) {
      let best = 0
      let dist = Number.POSITIVE_INFINITY
      for (let i = 0; i < k; i++) {
        const d = Math.abs(v - centers[i]!)
        if (d < dist) {
          dist = d
          best = i
        }
      }
      buckets[best]!.push(v)
    }
    for (let i = 0; i < k; i++) {
      const b = buckets[i]!
      if (b.length > 0) centers[i] = b.reduce((s, v) => s + v, 0) / b.length
    }
  }
  return centers.sort((a, b) => a - b)
}

function nearestCenterIndex(x: number, centers: number[]): number {
  let best = 0
  let dist = Number.POSITIVE_INFINITY
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(x - centers[i]!)
    if (d < dist) {
      dist = d
      best = i
    }
  }
  return best
}

function mkSegmentedPanel(
  panelItems: Indexed[],
  segmentSizes: number[],
  panelIndex: 0 | 1,
  side: "left" | "right",
  startClosedOffset: number,
  expectedOptionCount: number,
  splitX: number,
): Array<Record<string, unknown>> {
  const rows = clusterRowsByYOrchestratorCopy(panelItems)
  rows.sort((a, b) => a[0]!.mark.centerY - b[0]!.mark.centerY)
  const needRows = segmentSizes.reduce((s, n) => s + n, 0)
  if (rows.length < needRows || segmentSizes.length < 2) {
    return []
  }

  const rowGroups: Indexed[][] = []
  let ri = 0
  for (const sz of segmentSizes) {
    const chunk: Indexed[] = []
    for (let j = 0; j < sz && ri < rows.length; j++, ri++) {
      chunk.push(...rows[ri]!)
    }
    rowGroups.push(chunk)
  }
  if (ri < rows.length) {
    const last = rowGroups[rowGroups.length - 1]
    if (last) for (; ri < rows.length; ri++) last.push(...rows[ri]!)
  }

  const out: Array<Record<string, unknown>> = []
  let globalRow = 0
  let closedOffset = startClosedOffset

  for (let si = 0; si < segmentSizes.length; si++) {
    const sz = segmentSizes[si]!
    if (si > 0) {
      console.log(
        `Aplicando offset por desarrollo en Item [panel ${side === "left" ? "izquierdo" : "derecho"} · segmento ${si + 1}/${segmentSizes.length}]`,
      )
    }

    const flat = rowGroups[si] ?? []
    if (flat.length === 0) {
      closedOffset += sz
      globalRow += sz
      continue
    }

    const xs = flat.map((it) => it.mark.centerX)
    const ys = flat.map((it) => it.mark.centerY)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const minX = xs.length ? Math.min(...xs) : panelIndex === 0 ? 0 : splitX
    const maxX = xs.length ? Math.max(...xs) : panelIndex === 0 ? splitX : 1
    const dy = Math.max(1e-6, maxY - minY)
    const dx = Math.max(1e-6, maxX - minX)

    const panelNoiseBaseCandidates = flat
      .filter((it) => it.mark.state !== "selected")
      .map((it) => it.mark.confidence)
      .sort((a, b) => a - b)
    const panelNoiseBase =
      panelNoiseBaseCandidates.length > 0
        ? panelNoiseBaseCandidates[Math.floor(panelNoiseBaseCandidates.length * 0.7)]!
        : 0.7
    const sensitivityThreshold = Math.max(0.55, Math.min(0.92, panelNoiseBase + 0.1))
    const centers = kmeans1d(
      flat.map((it) => (it.mark.centerX - minX) / dx),
      expectedOptionCount,
    )

    const rowBuckets: Array<Array<{ idx: number; mark: OmrLayoutMark; localX: number }>> = Array.from(
      { length: sz },
      () => [],
    )
    for (const it of flat) {
      const rowNorm = (it.mark.centerY - minY) / dy
      const rowIdx = Math.max(0, Math.min(sz - 1, Math.round(rowNorm * Math.max(0, sz - 1))))
      const localX = (it.mark.centerX - minX) / dx
      rowBuckets[rowIdx]!.push({ idx: it.idx, mark: it.mark, localX })
    }

    for (let rowIdx = 0; rowIdx < sz; rowIdx++) {
      const q =
        side === "left"
          ? 2 * (closedOffset + rowIdx) + 1
          : 2 * (closedOffset + rowIdx + 1)
      const bucket = rowBuckets[rowIdx] ?? []
      const byOption = new Map<number, { idx: number; confidence: number; state: "selected" | "unselected" }>()
      for (const mark of bucket) {
        const optionIdx = nearestCenterIndex(mark.localX, centers)
        const prev = byOption.get(optionIdx)
        if (!prev || mark.mark.confidence > prev.confidence) {
          byOption.set(optionIdx, {
            idx: mark.idx,
            confidence: mark.mark.confidence,
            state: mark.mark.state,
          })
        }
      }
      const confidencesByColumn: Record<string, number> = {}
      for (let i = 0; i < expectedOptionCount; i++) {
        const hit = byOption.get(i)
        if (hit) confidencesByColumn[letter(i)] = Number(hit.confidence.toFixed(4))
      }
      const candidates = Array.from(byOption.entries()).sort((a, b) => b[1].confidence - a[1].confidence)
      const selectedCandidates = candidates.filter(([, v]) => v.state === "selected")
      let chosen = selectedCandidates[0]?.[1] ?? null
      let chosenIdx = selectedCandidates[0]?.[0] ?? -1
      if (!chosen && candidates.length > 0) {
        const best = candidates[0]!
        if (best[1].confidence >= sensitivityThreshold) {
          chosen = best[1]
          chosenIdx = best[0]
        }
      }
      const selectedAnswer = chosen && chosenIdx >= 0 ? letter(chosenIdx) : "BLANK"
      out.push({
        questionNumber: q,
        panelIndex,
        rowIndexWithinPanel: globalRow,
        selectedAnswer,
        assignedDetectionIndices: chosen ? [chosen.idx] : [],
        confidencesByColumn,
        observedFromSensors: bucket.length > 0,
        pautaSegmentIndex: si,
        yResyncSegment: si > 0,
      })
      globalRow++
    }
    closedOffset += sz
  }

  return out
}

export function mapDualPanelsWithPautaOrchestrator(params: {
  items: Indexed[]
  variant: OmrTemplateVariantOrchestrator
  expectedQuestionCount?: number
  expectedOptionCount?: number
  pautaItems: PautaItemOmSegmentation[]
  legacyMapDual: (p: {
    items: Indexed[]
    variant: OmrTemplateVariantOrchestrator
    expectedQuestionCount?: number
    expectedOptionCount?: number
  }) => Array<Record<string, unknown>>
}): { perQuestion: Array<Record<string, unknown>>; usedPautaSegmentation: boolean; questionOrderSource: string } {
  const disabled = process.env.OMR_PAUTA_SEGMENTATION === "0"
  console.log("Validando integridad de línea original... OK")

  const totalExpected =
    typeof params.expectedQuestionCount === "number" && params.expectedQuestionCount > 0
      ? params.expectedQuestionCount
      : Math.max(1, Math.ceil(params.items.length / 4))
  const leftCount = Math.ceil(totalExpected / 2)
  const rightCount = totalExpected - leftCount
  const expectedOptionCount =
    typeof params.expectedOptionCount === "number" && params.expectedOptionCount >= 2
      ? Math.max(2, Math.min(8, Math.round(params.expectedOptionCount)))
      : 4

  const mirror = () =>
    ({
      perQuestion: params.legacyMapDual({
        items: params.items,
        variant: params.variant,
        expectedQuestionCount: params.expectedQuestionCount,
        expectedOptionCount: params.expectedOptionCount,
      }),
      usedPautaSegmentation: false,
      questionOrderSource: "azure_table_rows_then_x_columns",
    }) as const

  if (disabled || params.variant !== "odd_even_dual_column" || !params.pautaItems?.length) {
    return mirror()
  }

  if (!params.pautaItems.some((p) => p.isDevelopment)) {
    return { ...mirror(), questionOrderSource: "azure_table_rows_then_x_columns_mirror_no_dev" }
  }

  const plan = buildOddEvenPanelSegmentPlan(params.pautaItems)
  const sumL = plan.left.reduce((a, b) => a + b, 0)
  const sumR = plan.right.reduce((a, b) => a + b, 0)

  if (!plan.hasDevelopmentGaps || sumL !== leftCount || sumR !== rightCount) {
    console.log("[omr-pauta-orchestrator] sin huecos de desarrollo en columnas o sumas ≠ esperado; modo espejo", {
      hasDevelopmentGaps: plan.hasDevelopmentGaps,
      sumL,
      leftCount,
      sumR,
      rightCount,
      plan,
    })
    return mirror()
  }

  const needLeft = plan.left.length >= 2
  const needRight = plan.right.length >= 2
  if (!needLeft && !needRight) {
    return { ...mirror(), questionOrderSource: "azure_table_rows_then_x_columns_mirror_single_segment" }
  }

  const splitX = 0.5
  const leftItems = params.items.filter((it) => it.mark.centerX <= splitX)
  const rightItems = params.items.filter((it) => it.mark.centerX > splitX)

  const leftOut = needLeft
    ? mkSegmentedPanel(leftItems, plan.left, 0, "left", 0, expectedOptionCount, splitX)
    : []
  const rightOut = needRight
    ? mkSegmentedPanel(rightItems, plan.right, 1, "right", 0, expectedOptionCount, splitX)
    : []

  /** Ambos paneles deben multi-segmentar; si no, modo espejo (sin mezcla legacy/segmento por panel). */
  if ((needLeft && leftOut.length === 0) || (needRight && rightOut.length === 0) || (needLeft !== needRight)) {
    if (needLeft !== needRight) {
      console.log("[omr-pauta-orchestrator] segmentación asimétrica (solo un panel); modo espejo por seguridad")
    } else {
      console.log("[omr-pauta-orchestrator] filas cluster insuficientes para segmentos; modo espejo")
    }
    return mirror()
  }

  const perQ = [...leftOut, ...rightOut].sort(
    (a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0),
  )

  return {
    perQuestion: perQ,
    usedPautaSegmentation: true,
    questionOrderSource: "pauta_orchestrator_odd_even_y_resync",
  }
}
