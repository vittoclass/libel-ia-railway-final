/**
 * N2-B.2 — Motor visual row_absolute_dominant_clear.
 *
 * Cubre el agujero de clase: BLANK + N1 abstain(insufficient_absolute_evidence).
 * Este módulo SOLO decide (confirmed_answer / abstain / skipped).
 * No muta selectedAnswer, scoring ni persistencia.
 * APPLY (si está activo) consume la decisión certificada desde azure-visual-blank-rescue
 * sin recalcular umbrales aquí.
 *
 * Universales: no usa questionNumber, studentId, teacher_key, pauta ni letter hardcode.
 * Certificado offline para filas de exactamente 4 alternativas.
 */

export const N2_ALGORITHM = "row_absolute_dominant_clear" as const

/** Umbrales certificados offline N2-B.1 — no relajar. */
export const N2_PARAMS = {
  CORE_RADIUS_FACTOR: 0.75,
  DARK_DELTA: 25,
  MIN_ABS_CONTRAST: 28,
  MIN_MARGIN_ABS: 20,
  MIN_LARGEST_COMP: 80,
  MIN_DARK_RATIO_CORE: 0.45,
  /** Cantidad de opciones certificada offline. Otras → SKIPPED. */
  CERTIFIED_OPTION_COUNT: 4,
} as const

export type VisualBlankN2Action = "confirmed_answer" | "abstain" | "skipped"

export type VisualBlankN2OptionMetric = {
  letter: string
  meanCore: number
  absContrast: number
  darkRatioCore: number
  largestComponent: number
}

export type VisualBlankN2Decision = {
  evaluated: boolean
  action: VisualBlankN2Action
  reason: string
  bestLetter?: string
  secondLetter?: string
  absContrast?: number
  marginAbs?: number
  darkRatioCore?: number
  largestComponent?: number
  rowBackground?: number
  meanCore?: number
  algorithm?: typeof N2_ALGORITHM
}

export type VisualBlankN2OptionInput = {
  letter: string
  /** Polígono normalizado [0..1] (ruta runtime N1). */
  polygonNorm?: ReadonlyArray<{ x: number; y: number }>
  /** Polígono en píxeles absolutos flat [x,y,...] (fixtures/offline). */
  polygonPx?: ReadonlyArray<number>
}

export type EvaluateVisualBlankN2Input = {
  gray: Buffer
  width: number
  height: number
  options: ReadonlyArray<VisualBlankN2OptionInput>
  currentAnswer: string | undefined
  n1Action: string
  n1Reason: string
}

function round4(n: number): number {
  return Number(n.toFixed(4))
}

function mean(xs: number[]): number {
  if (!xs.length) return 255
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

function median(xs: number[]): number {
  if (!xs.length) return 255
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function isBlankLike(answer: string | undefined): boolean {
  const a = String(answer ?? "").trim().toUpperCase()
  return a === "" || a === "BLANK"
}

function skipped(reason: string): VisualBlankN2Decision {
  return { evaluated: false, action: "skipped", reason }
}

function abstain(reason: string, partial?: Partial<VisualBlankN2Decision>): VisualBlankN2Decision {
  return {
    evaluated: true,
    action: "abstain",
    reason,
    algorithm: N2_ALGORITHM,
    ...partial,
  }
}

function optionGeomFromPoints(pts: Array<{ x: number; y: number }>): {
  cx: number
  cy: number
  radiusPx: number
} | null {
  if (pts.length < 3) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let sx = 0
  let sy = 0
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    sx += p.x
    sy += p.y
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const bw = maxX - minX
  const bh = maxY - minY
  if (!(bw > 1) || !(bh > 1)) return null
  return {
    cx: sx / pts.length,
    cy: sy / pts.length,
    radiusPx: Math.max(2, Math.min(bw, bh) * 0.35),
  }
}

function resolveOptionPoints(
  opt: VisualBlankN2OptionInput,
  width: number,
  height: number
): Array<{ x: number; y: number }> | null {
  if (opt.polygonPx && opt.polygonPx.length >= 6) {
    const pts: Array<{ x: number; y: number }> = []
    for (let i = 0; i + 1 < opt.polygonPx.length; i += 2) {
      const x = opt.polygonPx[i]
      const y = opt.polygonPx[i + 1]
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }
      pts.push({ x, y })
    }
    return pts.length >= 3 ? pts : null
  }
  const poly = opt.polygonNorm
  if (!poly || poly.length < 3) return null
  const pts: Array<{ x: number; y: number }> = []
  for (const p of poly) {
    if (
      typeof p?.x !== "number" ||
      typeof p?.y !== "number" ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    ) {
      return null
    }
    pts.push({ x: p.x * width, y: p.y * height })
  }
  return pts
}

function sampleDisk(
  data: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): number[] {
  const r2 = radiusPx * radiusPx
  const vals: number[] = []
  const x0 = Math.max(0, Math.floor(cx - radiusPx))
  const y0 = Math.max(0, Math.floor(cy - radiusPx))
  const x1 = Math.min(width, Math.ceil(cx + radiusPx))
  const y1 = Math.min(height, Math.ceil(cy + radiusPx))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r2) vals.push(data[y * width + x] ?? 255)
    }
  }
  return vals
}

function connectedDarkCore(
  data: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number,
  darkThr: number
): { darkRatio: number; largestComp: number; coreCount: number } {
  const rCore = radiusPx * N2_PARAMS.CORE_RADIUS_FACTOR
  const r2 = rCore * rCore
  const x0 = Math.max(0, Math.floor(cx - rCore))
  const y0 = Math.max(0, Math.floor(cy - rCore))
  const x1 = Math.min(width, Math.ceil(cx + rCore))
  const y1 = Math.min(height, Math.ceil(cy + rCore))

  let coreCount = 0
  const darkPixels: Array<{ x: number; y: number }> = []
  const mask = new Uint8Array(Math.max(0, (y1 - y0) * (x1 - x0)))
  const idx = (x: number, y: number) => (y - y0) * (x1 - x0) + (x - x0)

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > r2) continue
      coreCount++
      const g = data[y * width + x] ?? 255
      if (g <= darkThr) {
        mask[idx(x, y)] = 1
        darkPixels.push({ x, y })
      }
    }
  }

  if (!darkPixels.length) {
    return { darkRatio: 0, largestComp: 0, coreCount }
  }

  const seen = new Uint8Array(mask.length)
  let largest = 0
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const
  for (const p of darkPixels) {
    const start = idx(p.x, p.y)
    if (seen[start]) continue
    let size = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const k = stack.pop()!
      size++
      const x = x0 + (k % (x1 - x0))
      const y = y0 + Math.floor(k / (x1 - x0))
      for (const [dx, dy] of dirs) {
        const nx = x + dx
        const ny = y + dy
        if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue
        const nk = idx(nx, ny)
        if (seen[nk] || !mask[nk]) continue
        seen[nk] = 1
        stack.push(nk)
      }
    }
    if (size > largest) largest = size
  }

  return {
    darkRatio: coreCount > 0 ? darkPixels.length / coreCount : 0,
    largestComp: largest,
    coreCount,
  }
}

/**
 * Gate de elegibilidad N1→N2 (clase certificada).
 * No usa questionNumber ni letter conocidos.
 */
export function isN2EligibleGate(params: {
  currentAnswer: string | undefined
  n1Action: string
  n1Reason: string
}): boolean {
  return (
    isBlankLike(params.currentAnswer) &&
    params.n1Action === "abstain" &&
    params.n1Reason === "insufficient_absolute_evidence"
  )
}

/**
 * Medición pura N2 sobre una fila (4 opciones certificadas).
 * No decide elegibilidad N1 — solo mide y aplica umbrales de dominancia.
 */
export function measureRowAbsoluteDominantClear(params: {
  gray: Buffer
  width: number
  height: number
  options: ReadonlyArray<VisualBlankN2OptionInput>
}): {
  ok: true
  metrics: VisualBlankN2OptionMetric[]
  rowBackground: number
  bestLetter: string
  secondLetter: string
  marginAbs: number
  best: VisualBlankN2OptionMetric
  second: VisualBlankN2OptionMetric
} | { ok: false; reason: string } {
  const { gray, width, height, options } = params
  if (!Buffer.isBuffer(gray) || gray.length === 0) {
    return { ok: false, reason: "missing_buffer" }
  }
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { ok: false, reason: "invalid_dims" }
  }
  if (options.length !== N2_PARAMS.CERTIFIED_OPTION_COUNT) {
    return { ok: false, reason: `option_count_not_certified:${options.length}` }
  }

  const geoms: Array<{ letter: string; cx: number; cy: number; radiusPx: number }> = []
  for (const opt of options) {
    const letter = String(opt.letter ?? "").trim().toUpperCase()
    if (!/^[A-H]$/.test(letter)) {
      return { ok: false, reason: "invalid_letter" }
    }
    const pts = resolveOptionPoints(opt, width, height)
    if (!pts) return { ok: false, reason: "invalid_polygon" }
    const geom = optionGeomFromPoints(pts)
    if (!geom) return { ok: false, reason: "invalid_polygon_geom" }
    geoms.push({ letter, ...geom })
  }

  const coreMeans = geoms.map((g) => {
    const coreR = g.radiusPx * N2_PARAMS.CORE_RADIUS_FACTOR
    const vals = sampleDisk(gray, width, height, g.cx, g.cy, coreR)
    return { ...g, meanCore: mean(vals) }
  })

  // Fondo de fila robusto: mediana de las 3 opciones visualmente más claras.
  const brightest3 = [...coreMeans.map((m) => m.meanCore)].sort((a, b) => b - a).slice(0, 3)
  const rowBg = median(brightest3)
  const darkThr = rowBg - N2_PARAMS.DARK_DELTA

  const metrics: VisualBlankN2OptionMetric[] = coreMeans.map((m) => {
    const mass = connectedDarkCore(gray, width, height, m.cx, m.cy, m.radiusPx, darkThr)
    return {
      letter: m.letter,
      meanCore: round4(m.meanCore),
      absContrast: round4(rowBg - m.meanCore),
      darkRatioCore: round4(mass.darkRatio),
      largestComponent: mass.largestComp,
    }
  })

  const ranked = [...metrics].sort((a, b) => {
    if (b.absContrast !== a.absContrast) return b.absContrast - a.absContrast
    if (b.largestComponent !== a.largestComponent) {
      return b.largestComponent - a.largestComponent
    }
    return b.darkRatioCore - a.darkRatioCore
  })
  const best = ranked[0]!
  const second = ranked[1]!
  const marginAbs = round4(best.absContrast - second.absContrast)

  return {
    ok: true,
    metrics,
    rowBackground: round4(rowBg),
    bestLetter: best.letter,
    secondLetter: second.letter,
    marginAbs,
    best,
    second,
  }
}

/**
 * Decisión N2 pura. Fail-soft: nunca lanza.
 * No muta inputs. No conoce teacher_key / scoring / questionNumber.
 */
export function evaluateVisualBlankN2(input: EvaluateVisualBlankN2Input): VisualBlankN2Decision {
  try {
    if (!isN2EligibleGate({
      currentAnswer: input.currentAnswer,
      n1Action: input.n1Action,
      n1Reason: input.n1Reason,
    })) {
      return skipped("not_blank_or_not_n1_insufficient")
    }

    const measured = measureRowAbsoluteDominantClear({
      gray: input.gray,
      width: input.width,
      height: input.height,
      options: input.options,
    })

    if (!measured.ok) {
      return skipped(measured.reason)
    }

    const { best, marginAbs, rowBackground } = measured
    const passAbs = best.absContrast >= N2_PARAMS.MIN_ABS_CONTRAST
    const passMargin = marginAbs >= N2_PARAMS.MIN_MARGIN_ABS
    const passMass = best.largestComponent >= N2_PARAMS.MIN_LARGEST_COMP
    const passDark = best.darkRatioCore >= N2_PARAMS.MIN_DARK_RATIO_CORE

    const partial: Partial<VisualBlankN2Decision> = {
      bestLetter: measured.bestLetter,
      secondLetter: measured.secondLetter,
      absContrast: best.absContrast,
      marginAbs,
      darkRatioCore: best.darkRatioCore,
      largestComponent: best.largestComponent,
      rowBackground,
      meanCore: best.meanCore,
      algorithm: N2_ALGORITHM,
    }

    if (passAbs && passMargin && passMass && passDark) {
      return {
        evaluated: true,
        action: "confirmed_answer",
        reason: N2_ALGORITHM,
        ...partial,
      }
    }

    const failed: string[] = []
    if (!passAbs) failed.push("abs_contrast")
    if (!passMargin) failed.push("margin_abs")
    if (!passMass) failed.push("largest_comp")
    if (!passDark) failed.push("dark_ratio_core")
    return abstain(`insufficient_n2_evidence:${failed.join("+")}`, partial)
  } catch {
    return skipped("n2_internal_error_fail_soft")
  }
}

/** Telemetría Shadow segura (sin PII / teacher_key / imagen). */
export function toN2ShadowTelemetry(d: VisualBlankN2Decision): Record<string, unknown> {
  return {
    evaluated: d.evaluated,
    action: d.action,
    reason: d.reason,
    bestLetter: d.bestLetter ?? null,
    secondLetter: d.secondLetter ?? null,
    meanCore: d.meanCore ?? null,
    rowBackground: d.rowBackground ?? null,
    absContrast: d.absContrast ?? null,
    marginAbs: d.marginAbs ?? null,
    darkRatioCore: d.darkRatioCore ?? null,
    largestComponent: d.largestComponent ?? null,
    algorithm: d.algorithm ?? N2_ALGORITHM,
  }
}
