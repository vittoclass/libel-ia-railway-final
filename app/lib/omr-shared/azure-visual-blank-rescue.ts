/**
 * FASE R.20 — Rescate visual anti-BLANK (módulo aislado, fail-soft, inmutable).
 *
 * Revisa filas que terminarían en BLANK cuando Azure detectó la grilla pero
 * subclasificó marcas como unselected. No conoce pauta, scoring, estudiante,
 * lote, BD, UI ni persistencia.
 *
 * Flags (solo lectura de env; valor exacto "1"):
 *   LIBELIA_AZURE_VISUAL_BLANK_RESCUE_SHADOW
 *   LIBELIA_AZURE_VISUAL_BLANK_RESCUE_APPLY
 *
 * Defaults: ambos ausentes/0 → no-op. APPLY no se activa por defecto.
 * Usa sharp ya existente en el proyecto (sin dependencia nueva).
 */

import sharp from "sharp"
import {
  evaluateVisualBlankN2,
  toN2ShadowTelemetry,
  type VisualBlankN2Decision,
} from "./azure-visual-blank-rescue-n2"

export const VISUAL_BLANK_RESCUE_SHADOW_FLAG =
  "LIBELIA_AZURE_VISUAL_BLANK_RESCUE_SHADOW" as const
export const VISUAL_BLANK_RESCUE_APPLY_FLAG =
  "LIBELIA_AZURE_VISUAL_BLANK_RESCUE_APPLY" as const

const LOG_PREFIX = "[AZURE_VISUAL_BLANK_RESCUE_SHADOW]"

/** Umbrales internos (conservadores; preferencia = abstener). */
const LOCAL_DARK_THRESHOLD = 25
const MIN_DARK_RATIO = 0.22
const MIN_CONTRAST = 18
const MARGIN_DARK_RATIO = 0.1
const MARGIN_CONTRAST = 8
const COMPETITIVE_SECOND_DARK_RATIO = 0.18
const COMPETITIVE_SECOND_CONTRAST = 15
const GRID_ABS_TOLERANCE = 2

export type VisualBlankRescueMode = "off" | "shadow" | "apply"

export type VisualBlankRescueMark = {
  state: "selected" | "unselected"
  confidence: number
  polygonNorm: ReadonlyArray<{ x: number; y: number }>
}

export type VisualBlankRescueRow = {
  questionNumber: number
  selectedAnswer?: string
  panelIndex?: number
  rowIndexWithinPanel?: number
  observedFromSensors?: boolean
  inferredBlank?: boolean
  completedByExpectation?: boolean
  confidencesByColumn?: Readonly<Record<string, number>>
  assignedDetectionIndices?: ReadonlyArray<number>
}

export type VisualBlankRescuePageInput = {
  imageBuffer: Buffer
  imageWidth: number
  imageHeight: number
  marks: ReadonlyArray<VisualBlankRescueMark>
  rows: ReadonlyArray<VisualBlankRescueRow>
  expectedQuestionCount: number
  expectedOptionCount: number
  variant: "odd_even_dual_column" | "sequential_dual_column" | "single_column"
  mode: VisualBlankRescueMode
}

export type VisualOptionMetrics = {
  letter: string
  meanGray: number
  localBackground: number
  darkRatio: number
  contrast: number
  azureState: "selected" | "unselected"
  azureConfidence: number
}

export type VisualMetrics = {
  perOption: VisualOptionMetrics[]
  bestLetter: string | null
  secondLetter: string | null
  marginDarkRatio: number | null
  marginContrast: number | null
}

export type VisualBlankRescueRowDecision =
  | { action: "no_action"; questionNumber: number; reason: string }
  | {
      action: "abstain"
      questionNumber: number
      reason: string
      metrics?: VisualMetrics
    }
  | {
      action: "rescued_answer"
      questionNumber: number
      letter: string
      reason: string
      metrics: VisualMetrics
    }

export type VisualBlankRescuePageResult = {
  pageAction: "no_op" | "shadow_report" | "apply_proposals"
  pageGatesPassed: boolean
  pageAbstainReason: string | null
  selectionMarksTotal: number
  selectedCountAzure: number
  blankRowCountBefore: number
  decisions: VisualBlankRescueRowDecision[]
  proposedRows: ReadonlyArray<Record<string, unknown>> | null
  /**
   * Decisiones N2 certificadas (post-N1). En mode=shadow solo observación.
   * En mode=apply, buildProposedRows puede consumir confirmed_answer elegibles
   * (sin recalcular umbrales). Ausente cuando mode=off o page gates fallan.
   */
  n2Decisions?: ReadonlyArray<VisualBlankN2Decision>
}

type InternalMark = VisualBlankRescueMark & {
  centerX: number
  centerY: number
}

type EmitFn = (line: string) => void

let emitShadowFn: EmitFn = (line) => {
  console.log(line)
}

/** Solo tests. */
export function __setVisualBlankRescueEmitForTests(fn: EmitFn | null): void {
  emitShadowFn = fn ?? ((line) => console.log(line))
}

export function isVisualBlankRescueShadowEnabled(): boolean {
  try {
    return process.env[VISUAL_BLANK_RESCUE_SHADOW_FLAG] === "1"
  } catch {
    return false
  }
}

export function isVisualBlankRescueApplyEnabled(): boolean {
  try {
    return process.env[VISUAL_BLANK_RESCUE_APPLY_FLAG] === "1"
  } catch {
    return false
  }
}

/**
 * Precedencia:
 * - ambos ausentes/0 → off
 * - APPLY=1 → apply (puede proponer BLANK→letra; el call site decide si aplica)
 * - solo SHADOW=1 → shadow
 */
export function resolveVisualBlankRescueModeFromEnv(): VisualBlankRescueMode {
  const apply = isVisualBlankRescueApplyEnabled()
  const shadow = isVisualBlankRescueShadowEnabled()
  if (apply) return "apply"
  if (shadow) return "shadow"
  return "off"
}

function letterAt(i: number): string {
  return ["A", "B", "C", "D", "E", "F", "G", "H"][i] ?? "?"
}

function emptyResult(
  partial?: Partial<VisualBlankRescuePageResult>
): VisualBlankRescuePageResult {
  return {
    pageAction: "no_op",
    pageGatesPassed: false,
    pageAbstainReason: partial?.pageAbstainReason ?? "off_or_gate",
    selectionMarksTotal: partial?.selectionMarksTotal ?? 0,
    selectedCountAzure: partial?.selectedCountAzure ?? 0,
    blankRowCountBefore: partial?.blankRowCountBefore ?? 0,
    decisions: partial?.decisions ?? [],
    proposedRows: null,
  }
}

function markCenter(m: VisualBlankRescueMark): { centerX: number; centerY: number } | null {
  const poly = m.polygonNorm
  if (!poly || poly.length < 2) return null
  let sx = 0
  let sy = 0
  let n = 0
  for (const p of poly) {
    if (
      typeof p?.x !== "number" ||
      typeof p?.y !== "number" ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    ) {
      return null
    }
    sx += p.x
    sy += p.y
    n++
  }
  if (n < 2) return null
  return { centerX: sx / n, centerY: sy / n }
}

function isValidPolygon(poly: ReadonlyArray<{ x: number; y: number }> | undefined): boolean {
  if (!poly || poly.length < 3) return false
  for (const p of poly) {
    if (
      typeof p?.x !== "number" ||
      typeof p?.y !== "number" ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < -0.05 ||
      p.x > 1.05 ||
      p.y < -0.05 ||
      p.y > 1.05
    ) {
      return false
    }
  }
  return true
}

function isBlankLike(answer: string | undefined): boolean {
  const a = String(answer ?? "").trim().toUpperCase()
  return a === "" || a === "BLANK"
}

function isMultiple(answer: string | undefined): boolean {
  return String(answer ?? "").trim().toUpperCase() === "MULTIPLE"
}

function isLetterAnswer(answer: string | undefined): boolean {
  const a = String(answer ?? "").trim().toUpperCase()
  return /^[A-H]$/.test(a)
}

function sampleCircleGray(
  data: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): { mean: number; darkRatio: number; localBackground: number; contrast: number } {
  const rInner = Math.max(1, radiusPx)
  const rOuter = Math.max(rInner + 2, rInner * 2)
  const r2 = rInner * rInner
  const rInner2 = r2
  const rOuter2 = rOuter * rOuter

  let sum = 0
  let count = 0
  let darkCount = 0
  let bgSum = 0
  let bgCount = 0

  const x0 = Math.max(0, Math.floor(cx - rOuter))
  const y0 = Math.max(0, Math.floor(cy - rOuter))
  const x1 = Math.min(width, Math.ceil(cx + rOuter))
  const y1 = Math.min(height, Math.ceil(cy + rOuter))

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx
      const dy = y - cy
      const d2 = dx * dx + dy * dy
      const gray = data[y * width + x] ?? 255
      if (d2 <= r2) {
        sum += gray
        count++
      } else if (d2 >= rInner2 && d2 <= rOuter2) {
        bgSum += gray
        bgCount++
      }
    }
  }

  const meanGray = count > 0 ? sum / count : 255
  const localBackground = bgCount > 0 ? bgSum / bgCount : 255
  const contrast = localBackground - meanGray
  const darkThreshold = Math.max(0, localBackground - LOCAL_DARK_THRESHOLD)

  for (
    let y = Math.max(0, Math.floor(cy - rInner));
    y < Math.min(height, Math.ceil(cy + rInner));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(cx - rInner));
      x < Math.min(width, Math.ceil(cx + rInner));
      x++
    ) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r2) {
        const gray = data[y * width + x] ?? 255
        if (gray <= darkThreshold) darkCount++
      }
    }
  }

  const darkRatio = count > 0 ? darkCount / count : 0
  return { mean: meanGray, darkRatio, localBackground, contrast }
}

function polygonPixelGeom(
  poly: ReadonlyArray<{ x: number; y: number }>,
  imageWidth: number,
  imageHeight: number
): { cx: number; cy: number; radiusPx: number } | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let sx = 0
  let sy = 0
  for (const p of poly) {
    const x = p.x * imageWidth
    const y = p.y * imageHeight
    sx += x
    sy += y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const n = poly.length
  if (n < 3) return null
  const bw = maxX - minX
  const bh = maxY - minY
  if (!(bw > 1) || !(bh > 1)) return null
  return {
    cx: sx / n,
    cy: sy / n,
    radiusPx: Math.max(2, Math.min(bw, bh) * 0.35),
  }
}

/**
 * Reasocia marcas → (pregunta, letra) desde geometría + variant.
 * No muta marks. Usa coordenadas normalizadas de página (pre-affine).
 */
function associateMarksToQuestions(params: {
  marks: ReadonlyArray<VisualBlankRescueMark>
  expectedQuestionCount: number
  expectedOptionCount: number
  variant: VisualBlankRescuePageInput["variant"]
}): Map<number, Array<{ letter: string; mark: InternalMark }>> {
  const out = new Map<number, Array<{ letter: string; mark: InternalMark }>>()
  const K = Math.max(2, Math.min(8, Math.round(params.expectedOptionCount)))
  const Q = Math.max(1, Math.round(params.expectedQuestionCount))

  const internals: InternalMark[] = []
  for (const m of params.marks) {
    const c = markCenter(m)
    if (!c) continue
    internals.push({ ...m, centerX: c.centerX, centerY: c.centerY })
  }

  const pushRow = (q: number, rowMarks: InternalMark[]): void => {
    const sorted = [...rowMarks].sort((a, b) => a.centerX - b.centerX)
    const opts: Array<{ letter: string; mark: InternalMark }> = []
    for (let i = 0; i < sorted.length && i < K; i++) {
      opts.push({ letter: letterAt(i), mark: sorted[i]! })
    }
    out.set(q, opts)
  }

  if (params.variant === "single_column") {
    const sorted = [...internals].sort((a, b) => a.centerY - b.centerY)
    const threshold = 0.018
    const rows: InternalMark[][] = []
    for (const m of sorted) {
      let placed = false
      for (const row of rows) {
        if (Math.abs(m.centerY - row[0]!.centerY) < threshold) {
          row.push(m)
          placed = true
          break
        }
      }
      if (!placed) rows.push([m])
    }
    for (let i = 0; i < rows.length && i < Q; i++) {
      pushRow(i + 1, rows[i]!)
    }
    return out
  }

  const splitX = 0.5
  const half = Math.ceil(Q / 2)
  const leftCount =
    params.variant === "sequential_dual_column" ? half : Math.ceil(Q / 2)
  const rightCount = Q - leftCount
  const leftItems = internals.filter((m) => m.centerX <= splitX)
  const rightItems = internals.filter((m) => m.centerX > splitX)

  const assignPanel = (
    panelItems: InternalMark[],
    panelQuestionCount: number,
    qResolver: (rowIndex: number) => number
  ): void => {
    if (panelQuestionCount <= 0 || panelItems.length === 0) return
    const ys = panelItems.map((m) => m.centerY)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const dy = Math.max(1e-6, maxY - minY)
    const buckets: InternalMark[][] = Array.from({ length: panelQuestionCount }, () => [])
    for (const m of panelItems) {
      const rowNorm = (m.centerY - minY) / dy
      const rowIdx = Math.max(
        0,
        Math.min(panelQuestionCount - 1, Math.round(rowNorm * (panelQuestionCount - 1)))
      )
      buckets[rowIdx]!.push(m)
    }
    for (let rowIdx = 0; rowIdx < panelQuestionCount; rowIdx++) {
      pushRow(qResolver(rowIdx), buckets[rowIdx]!)
    }
  }

  if (params.variant === "sequential_dual_column") {
    assignPanel(leftItems, leftCount, (rowIdx) => rowIdx + 1)
    assignPanel(rightItems, rightCount, (rowIdx) => leftCount + rowIdx + 1)
  } else {
    assignPanel(leftItems, leftCount, (rowIdx) => rowIdx * 2 + 1)
    assignPanel(rightItems, rightCount, (rowIdx) => (rowIdx + 1) * 2)
  }

  return out
}

function pageGridNearlyComplete(
  marksTotal: number,
  expectedQuestionCount: number,
  expectedOptionCount: number
): boolean {
  const expected = expectedQuestionCount * expectedOptionCount
  if (expected <= 0) return false
  if (marksTotal <= 0) return false
  return Math.abs(marksTotal - expected) <= GRID_ABS_TOLERANCE
}

function decideRow(params: {
  row: VisualBlankRescueRow
  options: Array<{ letter: string; mark: InternalMark }>
  gray: Buffer
  imageWidth: number
  imageHeight: number
  expectedOptionCount: number
}): VisualBlankRescueRowDecision {
  const q = params.row.questionNumber
  const answer = params.row.selectedAnswer

  if (params.row.inferredBlank === true) {
    return { action: "abstain", questionNumber: q, reason: "inferred_blank" }
  }
  if (params.row.completedByExpectation === true) {
    return { action: "abstain", questionNumber: q, reason: "completed_by_expectation" }
  }
  if (isMultiple(answer)) {
    return { action: "abstain", questionNumber: q, reason: "multiple" }
  }
  if (isLetterAnswer(answer)) {
    return { action: "no_action", questionNumber: q, reason: "already_selected" }
  }
  if (!isBlankLike(answer)) {
    return { action: "no_action", questionNumber: q, reason: "not_blank" }
  }

  const K = params.expectedOptionCount
  if (params.options.length !== K) {
    return {
      action: "abstain",
      questionNumber: q,
      reason: `option_count_neq_k:${params.options.length}!=${K}`,
    }
  }

  for (const opt of params.options) {
    if (!isValidPolygon(opt.mark.polygonNorm)) {
      return { action: "abstain", questionNumber: q, reason: "invalid_polygon" }
    }
  }

  const hasAzureSelected = params.options.some((o) => o.mark.state === "selected")
  if (hasAzureSelected) {
    return { action: "no_action", questionNumber: q, reason: "azure_selected_present" }
  }

  const perOption: VisualOptionMetrics[] = []
  for (const opt of params.options) {
    const geom = polygonPixelGeom(opt.mark.polygonNorm, params.imageWidth, params.imageHeight)
    if (!geom) {
      return { action: "abstain", questionNumber: q, reason: "invalid_polygon_geom" }
    }
    const s = sampleCircleGray(
      params.gray,
      params.imageWidth,
      params.imageHeight,
      geom.cx,
      geom.cy,
      geom.radiusPx
    )
    perOption.push({
      letter: opt.letter,
      meanGray: Number(s.mean.toFixed(4)),
      localBackground: Number(s.localBackground.toFixed(4)),
      darkRatio: Number(s.darkRatio.toFixed(4)),
      contrast: Number(s.contrast.toFixed(4)),
      azureState: opt.mark.state,
      azureConfidence: opt.mark.confidence,
    })
  }

  const ranked = [...perOption].sort((a, b) => {
    if (b.darkRatio !== a.darkRatio) return b.darkRatio - a.darkRatio
    return b.contrast - a.contrast
  })
  const best = ranked[0]!
  const second = ranked[1] ?? null
  const marginDarkRatio = second ? best.darkRatio - second.darkRatio : best.darkRatio
  const marginContrast = second ? best.contrast - second.contrast : best.contrast

  const metrics: VisualMetrics = {
    perOption,
    bestLetter: best.letter,
    secondLetter: second?.letter ?? null,
    marginDarkRatio: Number(marginDarkRatio.toFixed(4)),
    marginContrast: Number(marginContrast.toFixed(4)),
  }

  if (best.darkRatio < MIN_DARK_RATIO || best.contrast < MIN_CONTRAST) {
    return {
      action: "abstain",
      questionNumber: q,
      reason: "insufficient_absolute_evidence",
      metrics,
    }
  }

  if (
    second &&
    second.darkRatio >= COMPETITIVE_SECOND_DARK_RATIO &&
    second.contrast >= COMPETITIVE_SECOND_CONTRAST &&
    marginDarkRatio < MARGIN_DARK_RATIO
  ) {
    return {
      action: "abstain",
      questionNumber: q,
      reason: "competitive_double_mark",
      metrics,
    }
  }

  if (marginDarkRatio < MARGIN_DARK_RATIO && marginContrast < MARGIN_CONTRAST) {
    return {
      action: "abstain",
      questionNumber: q,
      reason: "insufficient_margin",
      metrics,
    }
  }

  if (!second) {
    return {
      action: "abstain",
      questionNumber: q,
      reason: "no_second_for_relative_compare",
      metrics,
    }
  }

  return {
    action: "rescued_answer",
    questionNumber: q,
    letter: best.letter,
    reason: "visual_dominant_clear",
    metrics,
  }
}

/**
 * APPLY merge mínimo. Una sola fuente de verdad por motor:
 * - N1: decisions.action === rescued_answer
 * - N2: n2Decisions.action === confirmed_answer (ya gateado por evaluateVisualBlankN2)
 * Precedencia: Azure válida > N1 > N2. No recalcula umbrales N2.
 */
export function buildVisualBlankRescueProposedRows(
  rows: ReadonlyArray<VisualBlankRescueRow>,
  decisions: ReadonlyArray<VisualBlankRescueRowDecision>,
  n2Decisions?: ReadonlyArray<VisualBlankN2Decision>
): Record<string, unknown>[] {
  const n1RescueByQ = new Map<number, string>()
  const n1ByQ = new Map<number, VisualBlankRescueRowDecision>()
  for (const d of decisions) {
    n1ByQ.set(d.questionNumber, d)
    if (d.action === "rescued_answer") n1RescueByQ.set(d.questionNumber, d.letter)
  }

  return rows.map((row, i) => {
    const copy: Record<string, unknown> = { ...row }
    const blankEligible =
      isBlankLike(row.selectedAnswer) &&
      !isMultiple(row.selectedAnswer) &&
      !isLetterAnswer(row.selectedAnswer) &&
      row.inferredBlank !== true &&
      row.completedByExpectation !== true

    if (!blankEligible) return copy

    const n1Letter = n1RescueByQ.get(row.questionNumber)
    if (n1Letter && /^[A-H]$/.test(n1Letter)) {
      copy.selectedAnswer = n1Letter
      copy.visualBlankRescue = true
      copy.visualBlankRescueLetter = n1Letter
      copy.visualBlankRescueSource = "N1"
      return copy
    }

    // N2 solo si N1 abstuvo por insufficient_absolute_evidence y N2 confirmó.
    const n1 = n1ByQ.get(row.questionNumber) ?? decisions[i]
    const n2 = n2Decisions?.[i]
    if (
      n1 &&
      n1.action === "abstain" &&
      n1.reason === "insufficient_absolute_evidence" &&
      n2 &&
      n2.action === "confirmed_answer" &&
      typeof n2.bestLetter === "string" &&
      /^[A-H]$/.test(n2.bestLetter)
    ) {
      copy.selectedAnswer = n2.bestLetter
      copy.visualBlankRescue = true
      copy.visualBlankRescueLetter = n2.bestLetter
      copy.visualBlankRescueSource = "N2"
    }
    return copy
  })
}

function emitShadowTelemetry(result: VisualBlankRescuePageResult): void {
  try {
    const payload = {
      pageAction: result.pageAction,
      pageGatesPassed: result.pageGatesPassed,
      pageAbstainReason: result.pageAbstainReason,
      selectionMarksTotal: result.selectionMarksTotal,
      selectedCountAzure: result.selectedCountAzure,
      blankRowCountBefore: result.blankRowCountBefore,
      decisions: result.decisions.map((d) => {
        const base: Record<string, unknown> = {
          questionNumber: d.questionNumber,
          action: d.action,
          reason: d.reason,
        }
        if (d.action === "rescued_answer") {
          base.bestLetter = d.letter
          base.secondLetter = d.metrics.secondLetter
          base.marginDarkRatio = d.metrics.marginDarkRatio
          base.marginContrast = d.metrics.marginContrast
          base.metrics = d.metrics.perOption.map((o) => ({
            letter: o.letter,
            darkRatio: o.darkRatio,
            contrast: o.contrast,
            meanGray: o.meanGray,
            localBackground: o.localBackground,
            azureState: o.azureState,
            azureConfidence: o.azureConfidence,
          }))
        } else if (d.action === "abstain" && d.metrics) {
          base.bestLetter = d.metrics.bestLetter
          base.secondLetter = d.metrics.secondLetter
          base.marginDarkRatio = d.metrics.marginDarkRatio
          base.marginContrast = d.metrics.marginContrast
          const bestOpt = d.metrics.perOption.find((o) => o.letter === d.metrics!.bestLetter)
          const secondOpt =
            d.metrics.secondLetter != null
              ? d.metrics.perOption.find((o) => o.letter === d.metrics!.secondLetter)
              : undefined
          if (bestOpt) {
            base.bestDarkRatio = bestOpt.darkRatio
            base.bestContrast = bestOpt.contrast
            base.failedAbsoluteDark = bestOpt.darkRatio < MIN_DARK_RATIO
            base.failedAbsoluteContrast = bestOpt.contrast < MIN_CONTRAST
          }
          if (secondOpt) {
            base.secondDarkRatio = secondOpt.darkRatio
            base.secondContrast = secondOpt.contrast
          }
        }
        return base
      }),
      // N2: telemetría de decisiones certificadas (APPLY las consume solo vía buildProposedRows).
      n2: (result.n2Decisions ?? []).map((d) => toN2ShadowTelemetry(d)),
    }
    emitShadowFn(`${LOG_PREFIX} ${JSON.stringify(payload)}`)
  } catch {
    // fail-soft: nunca romper por telemetría
  }
}

/**
 * N2 post-N1. Fail-soft por fila. Produce decisiones certificadas;
 * proposedRows solo las consume en mode=apply vía buildProposedRows.
 */
function runN2ShadowAfterN1(params: {
  rows: ReadonlyArray<VisualBlankRescueRow>
  decisions: ReadonlyArray<VisualBlankRescueRowDecision>
  assoc: Map<number, Array<{ letter: string; mark: InternalMark }>>
  gray: Buffer
  imageWidth: number
  imageHeight: number
}): VisualBlankN2Decision[] {
  const out: VisualBlankN2Decision[] = []
  for (let i = 0; i < params.rows.length; i++) {
    const row = params.rows[i]!
    const d = params.decisions[i]
    try {
      if (!d) {
        out.push({
          evaluated: false,
          action: "skipped",
          reason: "missing_n1_decision",
        })
        continue
      }
      const options = params.assoc.get(row.questionNumber) ?? []
      out.push(
        evaluateVisualBlankN2({
          gray: params.gray,
          width: params.imageWidth,
          height: params.imageHeight,
          options: options.map((o) => ({
            letter: o.letter,
            polygonNorm: o.mark.polygonNorm,
          })),
          currentAnswer: row.selectedAnswer,
          n1Action: d.action,
          n1Reason: d.reason,
        })
      )
    } catch {
      out.push({
        evaluated: false,
        action: "skipped",
        reason: "n2_internal_error_fail_soft",
      })
    }
  }
  return out
}

/**
 * Entrada principal. Fail-soft: cualquier excepción → no_op.
 * No muta imageBuffer, marks ni rows.
 */
export async function runAzureVisualBlankRescue(
  input: VisualBlankRescuePageInput
): Promise<VisualBlankRescuePageResult> {
  try {
    if (!input || input.mode === "off") {
      return emptyResult({ pageAbstainReason: "mode_off" })
    }

    const expectedQ = Math.round(input.expectedQuestionCount)
    const expectedOpt = Math.max(2, Math.min(8, Math.round(input.expectedOptionCount)))
    const marks = input.marks ?? []
    const rows = input.rows ?? []
    const selectionMarksTotal = marks.length
    const selectedCountAzure = marks.filter((m) => m.state === "selected").length
    const blankRowCountBefore = rows.filter((r) => isBlankLike(r.selectedAnswer)).length

    if (
      !Buffer.isBuffer(input.imageBuffer) ||
      input.imageBuffer.length === 0 ||
      !(input.imageWidth > 0) ||
      !(input.imageHeight > 0) ||
      !Number.isFinite(input.imageWidth) ||
      !Number.isFinite(input.imageHeight)
    ) {
      const r = emptyResult({
        pageAbstainReason: "invalid_buffer_or_dims",
        selectionMarksTotal,
        selectedCountAzure,
        blankRowCountBefore,
      })
      if (input.mode === "shadow" || input.mode === "apply") emitShadowTelemetry(r)
      return r
    }

    if (!pageGridNearlyComplete(selectionMarksTotal, expectedQ, expectedOpt)) {
      const r = emptyResult({
        pageAbstainReason: "grid_incomplete",
        selectionMarksTotal,
        selectedCountAzure,
        blankRowCountBefore,
      })
      if (input.mode === "shadow" || input.mode === "apply") emitShadowTelemetry(r)
      return r
    }

    if (selectedCountAzure >= expectedQ) {
      const r: VisualBlankRescuePageResult = {
        pageAction: input.mode === "apply" ? "apply_proposals" : "shadow_report",
        pageGatesPassed: false,
        pageAbstainReason: "no_selected_deficit",
        selectionMarksTotal,
        selectedCountAzure,
        blankRowCountBefore,
        decisions: rows.map((row) => ({
          action: "no_action" as const,
          questionNumber: row.questionNumber,
          reason: "page_no_deficit",
        })),
        proposedRows: null,
      }
      emitShadowTelemetry(r)
      return r
    }

    const { data, info } = await sharp(input.imageBuffer)
      .greyscale()
      .resize(input.imageWidth, input.imageHeight, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true })

    if (info.width !== input.imageWidth || info.height !== input.imageHeight) {
      const r = emptyResult({
        pageAbstainReason: "gray_dims_mismatch",
        selectionMarksTotal,
        selectedCountAzure,
        blankRowCountBefore,
      })
      emitShadowTelemetry(r)
      return r
    }

    const assoc = associateMarksToQuestions({
      marks,
      expectedQuestionCount: expectedQ,
      expectedOptionCount: expectedOpt,
      variant: input.variant,
    })

    const decisions: VisualBlankRescueRowDecision[] = []
    for (const row of rows) {
      const options = assoc.get(row.questionNumber) ?? []
      decisions.push(
        decideRow({
          row,
          options,
          gray: data,
          imageWidth: input.imageWidth,
          imageHeight: input.imageHeight,
          expectedOptionCount: expectedOpt,
        })
      )
    }

    // N2: solo tras N1, con píxeles/mapping disponibles.
    // mode=shadow → observación; mode=apply → buildProposedRows puede consumir confirmed_answer.
    const n2Decisions = runN2ShadowAfterN1({
      rows,
      decisions,
      assoc,
      gray: data,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
    })

    const proposedRows =
      input.mode === "apply"
        ? buildVisualBlankRescueProposedRows(rows, decisions, n2Decisions)
        : null

    const result: VisualBlankRescuePageResult = {
      pageAction: input.mode === "apply" ? "apply_proposals" : "shadow_report",
      pageGatesPassed: true,
      pageAbstainReason: null,
      selectionMarksTotal,
      selectedCountAzure,
      blankRowCountBefore,
      decisions,
      proposedRows,
      n2Decisions,
    }
    emitShadowTelemetry(result)
    return result
  } catch {
    const result = emptyResult({ pageAbstainReason: "internal_error_fail_soft" })
    if (input?.mode === "shadow" || input?.mode === "apply") emitShadowTelemetry(result)
    return result
  }
}
