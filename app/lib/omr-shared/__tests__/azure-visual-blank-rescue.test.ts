/**
 * Pruebas offline de FASE R.20.
 * Ejecutar: npx tsx app/lib/omr-shared/__tests__/azure-visual-blank-rescue.test.ts
 */

import assert from "node:assert/strict"
import sharp from "sharp"
import {
  __setVisualBlankRescueEmitForTests,
  resolveVisualBlankRescueModeFromEnv,
  runAzureVisualBlankRescue,
  VISUAL_BLANK_RESCUE_APPLY_FLAG,
  VISUAL_BLANK_RESCUE_SHADOW_FLAG,
  type VisualBlankRescueMark,
  type VisualBlankRescuePageInput,
  type VisualBlankRescueRow,
} from "../azure-visual-blank-rescue"

type TestFn = () => void | Promise<void>

const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

function withFlags(
  shadow: string | undefined,
  apply: string | undefined,
  fn: () => void
): void {
  const beforeShadow = process.env[VISUAL_BLANK_RESCUE_SHADOW_FLAG]
  const beforeApply = process.env[VISUAL_BLANK_RESCUE_APPLY_FLAG]
  try {
    if (shadow === undefined) delete process.env[VISUAL_BLANK_RESCUE_SHADOW_FLAG]
    else process.env[VISUAL_BLANK_RESCUE_SHADOW_FLAG] = shadow
    if (apply === undefined) delete process.env[VISUAL_BLANK_RESCUE_APPLY_FLAG]
    else process.env[VISUAL_BLANK_RESCUE_APPLY_FLAG] = apply
    fn()
  } finally {
    if (beforeShadow === undefined) delete process.env[VISUAL_BLANK_RESCUE_SHADOW_FLAG]
    else process.env[VISUAL_BLANK_RESCUE_SHADOW_FLAG] = beforeShadow
    if (beforeApply === undefined) delete process.env[VISUAL_BLANK_RESCUE_APPLY_FLAG]
    else process.env[VISUAL_BLANK_RESCUE_APPLY_FLAG] = beforeApply
  }
}

const width = 400
const height = 300
const xs = [80, 140, 200, 260]
const ys = [100, 200]

function polygon(cx: number, cy: number, size = 16): Array<{ x: number; y: number }> {
  const half = size / 2
  return [
    { x: (cx - half) / width, y: (cy - half) / height },
    { x: (cx + half) / width, y: (cy - half) / height },
    { x: (cx + half) / width, y: (cy + half) / height },
    { x: (cx - half) / width, y: (cy + half) / height },
  ]
}

function marks(selected: Array<[number, number]> = []): VisualBlankRescueMark[] {
  return ys.flatMap((y, row) =>
    xs.map((x, column) => ({
      state: selected.some(([r, c]) => r === row && c === column) ? "selected" : "unselected",
      confidence: 0.9,
      polygonNorm: polygon(x, y),
    }))
  )
}

async function imageWithDark(...dark: Array<[number, number]>): Promise<Buffer> {
  const circles = dark
    .map(([row, column]) => `<circle cx="${xs[column]}" cy="${ys[row]}" r="7" fill="black"/>`)
    .join("")
  return sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${circles}</svg>`))
    .png()
    .toBuffer()
}

function baseRows(): VisualBlankRescueRow[] {
  return [
    { questionNumber: 1, selectedAnswer: "BLANK" },
    { questionNumber: 2, selectedAnswer: "A" },
  ]
}

async function input(
  overrides: Partial<VisualBlankRescuePageInput> = {},
  dark: Array<[number, number]> = [[0, 2]]
): Promise<VisualBlankRescuePageInput> {
  return {
    imageBuffer: await imageWithDark(...dark),
    imageWidth: width,
    imageHeight: height,
    marks: marks([[1, 0]]),
    rows: baseRows(),
    expectedQuestionCount: 2,
    expectedOptionCount: 4,
    variant: "single_column",
    mode: "shadow",
    ...overrides,
  }
}

test("1. flags/mode off: no-op y cero logs", async () => {
  const lines: string[] = []
  __setVisualBlankRescueEmitForTests((line) => lines.push(line))
  withFlags(undefined, undefined, () => {
    assert.equal(resolveVisualBlankRescueModeFromEnv(), "off")
  })
  const result = await runAzureVisualBlankRescue(await input({ mode: "off" }))
  assert.equal(result.pageAction, "no_op")
  assert.equal(lines.length, 0)
})

test("2. página sana: Azure ya cubre todas las preguntas", async () => {
  const result = await runAzureVisualBlankRescue(
    await input({ marks: marks([[0, 0], [1, 0]]) })
  )
  assert.equal(result.pageGatesPassed, false)
  assert.equal(result.pageAbstainReason, "no_selected_deficit")
  assert.equal(result.decisions.filter((d) => d.action === "rescued_answer").length, 0)
})

test("3. fila con respuesta existente no se toca", async () => {
  const rows = baseRows()
  rows[0] = { questionNumber: 1, selectedAnswer: "B" }
  const result = await runAzureVisualBlankRescue(await input({ rows }))
  assert.deepEqual(result.decisions[0], {
    action: "no_action",
    questionNumber: 1,
    reason: "already_selected",
  })
})

test("4. BLANK dominante claro se rescata en shadow", async () => {
  const result = await runAzureVisualBlankRescue(await input())
  assert.equal(result.decisions[0]?.action, "rescued_answer")
  assert.equal(result.decisions[0]?.action === "rescued_answer" && result.decisions[0].letter, "C")
  assert.equal(result.proposedRows, null)
})

test("5. empate visual abstiene", async () => {
  const result = await runAzureVisualBlankRescue(await input({}, [[0, 2], [0, 3]]))
  assert.equal(result.decisions[0]?.action, "abstain")
})

test("6. doble marca competitiva abstiene", async () => {
  const result = await runAzureVisualBlankRescue(await input({}, [[0, 1], [0, 2]]))
  assert.equal(result.decisions[0]?.action, "abstain")
  assert.equal(result.decisions[0]?.action === "abstain" && result.decisions[0].reason, "competitive_double_mark")
})

test("7. grilla incompleta es no-op", async () => {
  const result = await runAzureVisualBlankRescue(await input({ marks: marks().slice(0, 5) }))
  assert.equal(result.pageAction, "no_op")
  assert.equal(result.pageAbstainReason, "grid_incomplete")
})

test("8. inferredBlank abstiene", async () => {
  const rows = baseRows()
  rows[0] = { questionNumber: 1, selectedAnswer: "BLANK", inferredBlank: true }
  const result = await runAzureVisualBlankRescue(await input({ rows }))
  assert.equal(result.decisions[0]?.action, "abstain")
  assert.equal(result.decisions[0]?.action === "abstain" && result.decisions[0].reason, "inferred_blank")
})

test("9. completedByExpectation abstiene", async () => {
  const rows = baseRows()
  rows[0] = { questionNumber: 1, selectedAnswer: "BLANK", completedByExpectation: true }
  const result = await runAzureVisualBlankRescue(await input({ rows }))
  assert.equal(result.decisions[0]?.action, "abstain")
  assert.equal(result.decisions[0]?.action === "abstain" && result.decisions[0].reason, "completed_by_expectation")
})

test("10. MULTIPLE abstiene", async () => {
  const rows = baseRows()
  rows[0] = { questionNumber: 1, selectedAnswer: "MULTIPLE" }
  const result = await runAzureVisualBlankRescue(await input({ rows }))
  assert.equal(result.decisions[0]?.action, "abstain")
  assert.equal(result.decisions[0]?.action === "abstain" && result.decisions[0].reason, "multiple")
})

test("11. polígono inválido abstiene", async () => {
  const bad = marks([[1, 0]])
  bad[2] = { ...bad[2]!, polygonNorm: polygon(xs[2]!, ys[0]!).map((p) => ({ ...p, x: p.x + 2 })) }
  const result = await runAzureVisualBlankRescue(await input({ marks: bad }))
  assert.equal(result.decisions[0]?.action, "abstain")
  assert.equal(result.decisions[0]?.action === "abstain" && result.decisions[0].reason, "invalid_polygon")
})

test("12. buffer corrupto falla de forma segura", async () => {
  const result = await runAzureVisualBlankRescue(
    await input({ imageBuffer: Buffer.from("not-an-image"), mode: "shadow" })
  )
  assert.equal(result.pageAction, "no_op")
  assert.equal(result.pageAbstainReason, "internal_error_fail_soft")
})

test("13. las entradas permanecen inmutables", async () => {
  const original = await input()
  const before = {
    marks: JSON.parse(JSON.stringify(original.marks)),
    rows: JSON.parse(JSON.stringify(original.rows)),
    image: Buffer.from(original.imageBuffer),
  }
  await runAzureVisualBlankRescue(original)
  assert.deepEqual(original.marks, before.marks)
  assert.deepEqual(original.rows, before.rows)
  assert.deepEqual(original.imageBuffer, before.image)
})

test("14. shadow no propone; apply propone solo BLANK", async () => {
  const shadow = await runAzureVisualBlankRescue(await input({ mode: "shadow" }))
  assert.equal(shadow.proposedRows, null)
  const applied = await runAzureVisualBlankRescue(await input({ mode: "apply" }))
  assert.equal(applied.proposedRows?.[0]?.selectedAnswer, "C")
  assert.equal(applied.proposedRows?.[1]?.selectedAnswer, "A")
})

test("15. una letra existente nunca cambia en proposedRows", async () => {
  const rows: VisualBlankRescueRow[] = [
    { questionNumber: 1, selectedAnswer: "B" },
    { questionNumber: 2, selectedAnswer: "BLANK" },
  ]
  const result = await runAzureVisualBlankRescue(
    await input({ mode: "apply", rows, marks: marks([[0, 0]]) }, [[1, 2]])
  )
  assert.equal(result.proposedRows?.[0]?.selectedAnswer, "B")
  assert.equal(result.proposedRows?.[1]?.selectedAnswer, "C")
})

/** R.25 — helpers de telemetría absoluta (sin cambiar umbrales del algoritmo). */
async function grayPng(
  paint: (set: (x: number, y: number, g: number) => void) => void
): Promise<Buffer> {
  const buf = Buffer.alloc(width * height, 255)
  const set = (x: number, y: number, g: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) buf[y * width + x] = g
  }
  paint(set)
  return sharp(buf, { raw: { width, height, channels: 1 } }).png().toBuffer()
}

function fillDisk(
  set: (x: number, y: number, g: number) => void,
  cx: number,
  cy: number,
  r: number,
  g: number
): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, g)
    }
  }
}

function fillDiskPattern(
  set: (x: number, y: number, g: number) => void,
  cx: number,
  cy: number,
  r: number,
  darkG: number,
  fraction: number
): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0
        set(x, y, h % 1000 < fraction * 1000 ? darkG : 255)
      }
    }
  }
}

function parseShadowDecision(line: string): Record<string, unknown> {
  assert.ok(line.startsWith("[AZURE_VISUAL_BLANK_RESCUE_SHADOW] "))
  const payload = JSON.parse(line.slice("[AZURE_VISUAL_BLANK_RESCUE_SHADOW] ".length)) as {
    decisions: Array<Record<string, unknown>>
  }
  const d = payload.decisions[0]
  assert.ok(d)
  return d
}

function bestSecondFromMetrics(metrics: {
  perOption: Array<{ letter: string; darkRatio: number; contrast: number }>
  bestLetter: string | null
  secondLetter: string | null
}): {
  bestDarkRatio: number
  bestContrast: number
  secondDarkRatio: number | undefined
  secondContrast: number | undefined
} {
  const best = metrics.perOption.find((o) => o.letter === metrics.bestLetter)
  assert.ok(best)
  const second =
    metrics.secondLetter != null
      ? metrics.perOption.find((o) => o.letter === metrics.secondLetter)
      : undefined
  return {
    bestDarkRatio: best.darkRatio,
    bestContrast: best.contrast,
    secondDarkRatio: second?.darkRatio,
    secondContrast: second?.contrast,
  }
}

test("R.25-1. abstain por darkRatio: failedAbsoluteDark=true, contrast=false", async () => {
  const lines: string[] = []
  __setVisualBlankRescueEmitForTests((line) => lines.push(line))
  const result = await runAzureVisualBlankRescue(
    await input({ imageBuffer: await grayPng((set) => fillDisk(set, xs[2]!, ys[0]!, 7, 230)) })
  )
  const d0 = result.decisions[0]
  assert.equal(d0?.action, "abstain")
  assert.equal(d0?.action === "abstain" && d0.reason, "insufficient_absolute_evidence")
  assert.ok(d0 && d0.action === "abstain" && d0.metrics)
  const abs = bestSecondFromMetrics(d0.metrics)
  assert.ok(abs.bestDarkRatio < 0.22)
  assert.ok(abs.bestContrast >= 18)
  const log = parseShadowDecision(lines[0]!)
  assert.equal(log.failedAbsoluteDark, true)
  assert.equal(log.failedAbsoluteContrast, false)
  assert.equal(log.bestDarkRatio, abs.bestDarkRatio)
  assert.equal(log.bestContrast, abs.bestContrast)
  assert.equal(log.secondDarkRatio, abs.secondDarkRatio)
  assert.equal(log.secondContrast, abs.secondContrast)
  assert.equal(log.action, "abstain")
  assert.equal(log.reason, "insufficient_absolute_evidence")
})

test("R.25-2. abstain por contraste: failedAbsoluteDark=false, contrast=true", async () => {
  const lines: string[] = []
  __setVisualBlankRescueEmitForTests((line) => lines.push(line))
  const result = await runAzureVisualBlankRescue(
    await input({
      imageBuffer: await grayPng((set) => fillDiskPattern(set, xs[2]!, ys[0]!, 7, 200, 0.3)),
    })
  )
  const d0 = result.decisions[0]
  assert.equal(d0?.action, "abstain")
  assert.equal(d0?.action === "abstain" && d0.reason, "insufficient_absolute_evidence")
  assert.ok(d0 && d0.action === "abstain" && d0.metrics)
  const abs = bestSecondFromMetrics(d0.metrics)
  assert.ok(abs.bestDarkRatio >= 0.22)
  assert.ok(abs.bestContrast < 18)
  const log = parseShadowDecision(lines[0]!)
  assert.equal(log.failedAbsoluteDark, false)
  assert.equal(log.failedAbsoluteContrast, true)
  assert.equal(log.bestDarkRatio, abs.bestDarkRatio)
  assert.equal(log.bestContrast, abs.bestContrast)
  assert.equal(log.action, d0.action)
  assert.equal(log.reason, d0.reason)
})

test("R.25-3. abstain por ambos absolutos", async () => {
  const lines: string[] = []
  __setVisualBlankRescueEmitForTests((line) => lines.push(line))
  const result = await runAzureVisualBlankRescue(
    await input({ imageBuffer: await grayPng(() => {}) })
  )
  const d0 = result.decisions[0]
  assert.equal(d0?.action, "abstain")
  assert.equal(d0?.action === "abstain" && d0.reason, "insufficient_absolute_evidence")
  assert.ok(d0 && d0.action === "abstain" && d0.metrics)
  const abs = bestSecondFromMetrics(d0.metrics)
  assert.ok(abs.bestDarkRatio < 0.22)
  assert.ok(abs.bestContrast < 18)
  const log = parseShadowDecision(lines[0]!)
  assert.equal(log.failedAbsoluteDark, true)
  assert.equal(log.failedAbsoluteContrast, true)
  assert.equal(log.bestDarkRatio, abs.bestDarkRatio)
  assert.equal(log.bestContrast, abs.bestContrast)
})

test("R.25-4. métricas absolutas aparecen en log abstain y coinciden con d.metrics", async () => {
  const lines: string[] = []
  __setVisualBlankRescueEmitForTests((line) => lines.push(line))
  const result = await runAzureVisualBlankRescue(
    await input({ imageBuffer: await grayPng((set) => fillDisk(set, xs[2]!, ys[0]!, 7, 230)) })
  )
  const d0 = result.decisions[0]
  assert.ok(d0 && d0.action === "abstain" && d0.metrics)
  const abs = bestSecondFromMetrics(d0.metrics)
  const log = parseShadowDecision(lines[0]!)
  for (const key of [
    "bestDarkRatio",
    "bestContrast",
    "secondDarkRatio",
    "secondContrast",
    "failedAbsoluteDark",
    "failedAbsoluteContrast",
    "bestLetter",
    "secondLetter",
    "marginDarkRatio",
    "marginContrast",
  ] as const) {
    assert.ok(key in log, `falta ${key} en log`)
  }
  assert.equal(log.bestLetter, d0.metrics.bestLetter)
  assert.equal(log.secondLetter, d0.metrics.secondLetter)
  assert.equal(log.marginDarkRatio, d0.metrics.marginDarkRatio)
  assert.equal(log.marginContrast, d0.metrics.marginContrast)
  assert.equal(log.bestDarkRatio, abs.bestDarkRatio)
  assert.equal(log.bestContrast, abs.bestContrast)
  assert.equal(log.secondDarkRatio, abs.secondDarkRatio)
  assert.equal(log.secondContrast, abs.secondContrast)
  assert.equal(log.failedAbsoluteDark, abs.bestDarkRatio < 0.22)
  assert.equal(log.failedAbsoluteContrast, abs.bestContrast < 18)
})

test("R.25-5. decisiones y reason idénticos; respuesta oficial intacta (rescued sintético)", async () => {
  const lines: string[] = []
  __setVisualBlankRescueEmitForTests((line) => lines.push(line))
  const original = await input()
  const rowsBefore = JSON.parse(JSON.stringify(original.rows))
  const result = await runAzureVisualBlankRescue(original)
  assert.equal(result.decisions[0]?.action, "rescued_answer")
  assert.equal(
    result.decisions[0]?.action === "rescued_answer" && result.decisions[0].letter,
    "C"
  )
  assert.equal(
    result.decisions[0]?.action === "rescued_answer" && result.decisions[0].reason,
    "visual_dominant_clear"
  )
  assert.equal(result.proposedRows, null)
  assert.deepEqual(original.rows, rowsBefore)
  assert.ok(lines[0]?.startsWith("[AZURE_VISUAL_BLANK_RESCUE_SHADOW] "))
  const log = parseShadowDecision(lines[0]!)
  assert.equal(log.action, "rescued_answer")
  assert.equal(log.reason, "visual_dominant_clear")
  assert.equal("failedAbsoluteDark" in log, false)
})

test("R.25-6. página sana conserva no_action; grilla incompleta no_op", async () => {
  const sana = await runAzureVisualBlankRescue(
    await input({ marks: marks([
      [0, 0],
      [1, 0],
    ]) })
  )
  assert.equal(sana.pageGatesPassed, false)
  assert.equal(sana.pageAbstainReason, "no_selected_deficit")
  assert.ok(sana.decisions.every((d) => d.action === "no_action"))

  const incomplete = await runAzureVisualBlankRescue(
    await input({ marks: marks().slice(0, 5) })
  )
  assert.equal(incomplete.pageAction, "no_op")
  assert.equal(incomplete.pageAbstainReason, "grid_incomplete")
})

test("R.25-7. inputs no mutados tras abstain absoluto", async () => {
  const original = await input({
    imageBuffer: await grayPng((set) => fillDisk(set, xs[2]!, ys[0]!, 7, 230)),
  })
  const before = {
    marks: JSON.parse(JSON.stringify(original.marks)),
    rows: JSON.parse(JSON.stringify(original.rows)),
    image: Buffer.from(original.imageBuffer),
  }
  await runAzureVisualBlankRescue(original)
  assert.deepEqual(original.marks, before.marks)
  assert.deepEqual(original.rows, before.rows)
  assert.deepEqual(original.imageBuffer, before.image)
})

test("R.25-8. Shadow apagado: cero telemetría", async () => {
  const lines: string[] = []
  __setVisualBlankRescueEmitForTests((line) => lines.push(line))
  const result = await runAzureVisualBlankRescue(await input({ mode: "off" }))
  assert.equal(result.pageAction, "no_op")
  assert.equal(lines.length, 0)
})

test("R.25-9. APPLY sin efecto en call site existente (fuerza shadow, ignora proposedRows)", async () => {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const pipelinePath = path.join(
    process.cwd(),
    "app/lib/omr/experimental/azure-layout-omr-pipeline.ts"
  )
  const src = fs.readFileSync(pipelinePath, "utf8")
  assert.ok(src.includes('mode: "shadow"'))
  assert.ok(src.includes("Intentionally ignore proposedRows; do not assign to out."))
  assert.ok(src.includes("force shadow so out is never modified"))
  withFlags("1", "1", () => {
    assert.equal(resolveVisualBlankRescueModeFromEnv(), "apply")
  })
  const moduleApply = await runAzureVisualBlankRescue(await input({ mode: "apply" }))
  assert.equal(moduleApply.pageAction, "apply_proposals")
  assert.ok(moduleApply.proposedRows)
  assert.equal(moduleApply.proposedRows?.[0]?.selectedAnswer, "C")
})

async function run(): Promise<void> {
  for (const t of tests) {
    __setVisualBlankRescueEmitForTests(() => {})
    try {
      await t.fn()
      passed += 1
      console.log(`ok - ${t.name}`)
    } catch (err) {
      failed += 1
      console.error(`FAIL - ${t.name}`)
      console.error(err)
    } finally {
      __setVisualBlankRescueEmitForTests(null)
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void run()
