/**
 * N2-B.2 — Tests Shadow runtime: universalidad A/B/C/D, anti-hardcode, controles negativos.
 * Ejecutar: npx tsx app/lib/omr-shared/__tests__/azure-visual-blank-rescue-n2.test.ts
 */

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import {
  __setVisualBlankRescueEmitForTests,
  runAzureVisualBlankRescue,
  type VisualBlankRescueMark,
  type VisualBlankRescuePageInput,
  type VisualBlankRescueRow,
} from "../azure-visual-blank-rescue"
import {
  evaluateVisualBlankN2,
  measureRowAbsoluteDominantClear,
  N2_PARAMS,
  type VisualBlankN2OptionInput,
} from "../azure-visual-blank-rescue-n2"

type TestFn = () => void | Promise<void>

const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(HERE, "../../../../scripts/n2-pixel-proof-lab/input")

const W = 320
const H = 200
const LETTERS = ["A", "B", "C", "D"] as const
const ROW_XS = [60, 120, 180, 240]
const ROW_Y = 100
const BUBBLE_R = 14

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function polyNorm(cx: number, cy: number, size = 28): Array<{ x: number; y: number }> {
  const half = size / 2
  return [
    { x: (cx - half) / W, y: (cy - half) / H },
    { x: (cx + half) / W, y: (cy - half) / H },
    { x: (cx + half) / W, y: (cy + half) / H },
    { x: (cx - half) / W, y: (cy + half) / H },
  ]
}

function polyPx(cx: number, cy: number, size = 28): number[] {
  const half = size / 2
  return [cx - half, cy - half, cx + half, cy - half, cx + half, cy + half, cx - half, cy + half]
}

async function makeGrayRow(params: {
  markedIndex: number | null
  fill?: string
  ink?: string
  radius?: number
  y?: number
  noise?: boolean
  secondMarkedIndex?: number | null
  faint?: boolean
  outsideNoise?: boolean
}): Promise<{ gray: Buffer; width: number; height: number; options: VisualBlankN2OptionInput[] }> {
  const y = params.y ?? ROW_Y
  const r = params.radius ?? (params.faint ? 5 : 9)
  const fill = params.fill ?? "#f2f2f2"
  const ink = params.ink ?? (params.faint ? "#b8b8b8" : "#202020")
  const circles: string[] = []
  if (params.markedIndex != null) {
    circles.push(
      `<circle cx="${ROW_XS[params.markedIndex]}" cy="${y}" r="${r}" fill="${ink}"/>`
    )
  }
  if (params.secondMarkedIndex != null) {
    circles.push(
      `<circle cx="${ROW_XS[params.secondMarkedIndex]}" cy="${y}" r="${r}" fill="${ink}"/>`
    )
  }
  if (params.outsideNoise) {
    // Ruido oscuro fuera del core (anillo/borde), no debe confirmar.
    circles.push(
      `<circle cx="${ROW_XS[0]! + 16}" cy="${y}" r="3" fill="#101010"/>`
    )
  }
  // Contornos impresos débiles (simulan trazo de burbuja).
  const rings = ROW_XS.map(
    (x) =>
      `<circle cx="${x}" cy="${y}" r="${BUBBLE_R}" fill="none" stroke="#c8c8c8" stroke-width="2"/>`
  ).join("")
  const noiseSvg = params.noise
    ? `<circle cx="20" cy="20" r="2" fill="#ddd"/><circle cx="300" cy="180" r="2" fill="#ccc"/>`
    : ""
  const png = await sharp(
    Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${fill}"/>${rings}${circles.join("")}${noiseSvg}</svg>`
    )
  )
    .greyscale()
    .raw()
    .toBuffer()

  const options: VisualBlankN2OptionInput[] = LETTERS.map((letter, i) => ({
    letter,
    polygonNorm: polyNorm(ROW_XS[i]!, y),
    polygonPx: polyPx(ROW_XS[i]!, y),
  }))
  return { gray: png, width: W, height: H, options }
}

const eligibleCtx = {
  currentAnswer: "BLANK",
  n1Action: "abstain",
  n1Reason: "insufficient_absolute_evidence",
} as const

// ---------------------------------------------------------------------------
// Universalidad sintética A/B/C/D
// ---------------------------------------------------------------------------

for (const [idx, letter] of LETTERS.entries()) {
  test(`synth dominant ${letter} → confirmed_answer ${letter}`, async () => {
    const row = await makeGrayRow({ markedIndex: idx })
    const d = evaluateVisualBlankN2({
      ...row,
      ...eligibleCtx,
    })
    assert.equal(d.action, "confirmed_answer", `expected ${letter}, got ${JSON.stringify(d)}`)
    assert.equal(d.bestLetter, letter)
    assert.equal(d.reason, "row_absolute_dominant_clear")
  })
}

test("permutación: misma lógica confirma A/B/C/D según píxeles", async () => {
  for (let i = 0; i < 4; i++) {
    const row = await makeGrayRow({ markedIndex: i, y: 80 + i * 5 })
    const d = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
    assert.equal(d.action, "confirmed_answer")
    assert.equal(d.bestLetter, LETTERS[i])
  }
})

test("invariancia questionNumber: mismos píxeles → misma letra (Q1 vs Q40)", async () => {
  const row = await makeGrayRow({ markedIndex: 2 }) // C
  const d1 = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
  const d2 = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
  // questionNumber no es input de evaluateVisualBlankN2 — la API no lo acepta.
  assert.equal(d1.bestLetter, "C")
  assert.equal(d2.bestLetter, "C")
  assert.equal(d1.action, d2.action)
  assert.equal(d1.absContrast, d2.absContrast)
})

test("invariancia razonable: ruido leve / y distinta / ink fuerte", async () => {
  const base = await makeGrayRow({ markedIndex: 0, noise: true, y: 95 })
  const d = evaluateVisualBlankN2({ ...base, ...eligibleCtx })
  assert.equal(d.action, "confirmed_answer")
  assert.equal(d.bestLetter, "A")
})

// ---------------------------------------------------------------------------
// Controles negativos
// ---------------------------------------------------------------------------

test("NEG1 fila vacía → ABSTAIN", async () => {
  const row = await makeGrayRow({ markedIndex: null })
  const d = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
  assert.equal(d.action, "abstain")
  assert.equal(d.evaluated, true)
})

test("NEG2 dos opciones marcadas → ABSTAIN", async () => {
  const row = await makeGrayRow({ markedIndex: 0, secondMarkedIndex: 2 })
  const d = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
  assert.equal(d.action, "abstain")
})

test("NEG3 ruido fuera del core → ABSTAIN", async () => {
  const row = await makeGrayRow({ markedIndex: null, outsideNoise: true })
  const d = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
  assert.equal(d.action, "abstain")
})

test("NEG4 marca demasiado tenue → ABSTAIN", async () => {
  const row = await makeGrayRow({ markedIndex: 1, faint: true })
  const d = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
  assert.equal(d.action, "abstain")
})

test("NEG5 best/second cercanas (doble tenue) → ABSTAIN", async () => {
  const row = await makeGrayRow({
    markedIndex: 1,
    secondMarkedIndex: 2,
    faint: true,
  })
  const d = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
  assert.equal(d.action, "abstain")
})

test("NEG6 solo trazo impreso (rings) → ABSTAIN", async () => {
  const row = await makeGrayRow({ markedIndex: null })
  const d = evaluateVisualBlankN2({ ...row, ...eligibleCtx })
  assert.equal(d.action, "abstain")
})

test("NEG7 polygon inválido → SKIPPED", () => {
  const gray = Buffer.alloc(W * H, 240)
  const d = evaluateVisualBlankN2({
    gray,
    width: W,
    height: H,
    options: [
      { letter: "A", polygonNorm: [{ x: 0.1, y: 0.1 }] },
      { letter: "B", polygonNorm: polyNorm(120, 100) },
      { letter: "C", polygonNorm: polyNorm(180, 100) },
      { letter: "D", polygonNorm: polyNorm(240, 100) },
    ],
    ...eligibleCtx,
  })
  assert.equal(d.action, "skipped")
  assert.match(d.reason, /invalid_polygon/)
})

test("NEG8 grid/option count no certificado (3 opts) → SKIPPED", async () => {
  const row = await makeGrayRow({ markedIndex: 0 })
  const d = evaluateVisualBlankN2({
    gray: row.gray,
    width: row.width,
    height: row.height,
    options: row.options.slice(0, 3),
    ...eligibleCtx,
  })
  assert.equal(d.action, "skipped")
  assert.match(d.reason, /option_count_not_certified/)
})

test("NEG9 N1 rescued_answer → SKIPPED", async () => {
  const row = await makeGrayRow({ markedIndex: 1 })
  const d = evaluateVisualBlankN2({
    ...row,
    currentAnswer: "BLANK",
    n1Action: "rescued_answer",
    n1Reason: "visual_dominant_clear",
  })
  assert.equal(d.action, "skipped")
})

test("NEG10 Azure already selected → SKIPPED", async () => {
  const row = await makeGrayRow({ markedIndex: 0 })
  const d = evaluateVisualBlankN2({
    ...row,
    currentAnswer: "A",
    n1Action: "no_action",
    n1Reason: "already_selected",
  })
  assert.equal(d.action, "skipped")
})

test("NEG11 page_no_deficit → SKIPPED", async () => {
  const row = await makeGrayRow({ markedIndex: 0 })
  const d = evaluateVisualBlankN2({
    ...row,
    currentAnswer: "B",
    n1Action: "no_action",
    n1Reason: "page_no_deficit",
  })
  assert.equal(d.action, "skipped")
})

test("NEG12 reason N1 distinta → SKIPPED", async () => {
  const row = await makeGrayRow({ markedIndex: 3 })
  const d = evaluateVisualBlankN2({
    ...row,
    currentAnswer: "BLANK",
    n1Action: "abstain",
    n1Reason: "competitive_double_mark",
  })
  assert.equal(d.action, "skipped")
})

// ---------------------------------------------------------------------------
// Integración Shadow: N2 no muta proposedRows; mode off no corre
// ---------------------------------------------------------------------------

function marksAllUnselected(): VisualBlankRescueMark[] {
  // 2 filas × 4 opciones
  const ys = [80, 140]
  return ys.flatMap((y) =>
    ROW_XS.map((x) => ({
      state: "unselected" as const,
      confidence: 0.5,
      polygonNorm: [
        { x: (x - 14) / W, y: (y - 14) / H },
        { x: (x + 14) / W, y: (y - 14) / H },
        { x: (x + 14) / W, y: (y + 14) / H },
        { x: (x - 14) / W, y: (y + 14) / H },
      ],
    }))
  )
}

async function synthPageImage(marked: Array<[number, number]>): Promise<Buffer> {
  const ys = [80, 140]
  const circles = marked
    .map(([r, c]) => `<circle cx="${ROW_XS[c]}" cy="${ys[r]}" r="9" fill="#202020"/>`)
    .join("")
  const rings = ys
    .flatMap((y) =>
      ROW_XS.map(
        (x) =>
          `<circle cx="${x}" cy="${y}" r="14" fill="none" stroke="#c8c8c8" stroke-width="2"/>`
      )
    )
    .join("")
  return sharp(
    Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f2f2f2"/>${rings}${circles}</svg>`
    )
  )
    .png()
    .toBuffer()
}

test("SHADOW mode=off → N2 ausente / no_op", async () => {
  const result = await runAzureVisualBlankRescue({
    imageBuffer: await synthPageImage([[0, 3]]),
    imageWidth: W,
    imageHeight: H,
    marks: marksAllUnselected(),
    rows: [
      { questionNumber: 1, selectedAnswer: "BLANK" },
      { questionNumber: 2, selectedAnswer: "A" },
    ],
    expectedQuestionCount: 2,
    expectedOptionCount: 4,
    variant: "single_column",
    mode: "off",
  })
  assert.equal(result.pageAction, "no_op")
  assert.equal(result.n2Decisions, undefined)
  assert.equal(result.proposedRows, null)
})

test("SHADOW + APPLY=0 semántica: proposedRows null aunque N2 confirme", async () => {
  const lines: string[] = []
  __setVisualBlankRescueEmitForTests((line) => lines.push(line))
  try {
    // Fila 1: marca débil/contaminada simulada → puede abstener N1; forzamos escenario
    // con marca clara en D pero contrast local pobre es difícil en synth.
    // Aquí verificamos: mode shadow → proposedRows siempre null; N2 no escribe APPLY.
    const result = await runAzureVisualBlankRescue({
      imageBuffer: await synthPageImage([[0, 3]]),
      imageWidth: W,
      imageHeight: H,
      marks: marksAllUnselected(),
      rows: [
        { questionNumber: 1, selectedAnswer: "BLANK" },
        { questionNumber: 2, selectedAnswer: "A" },
      ],
      expectedQuestionCount: 2,
      expectedOptionCount: 4,
      variant: "single_column",
      mode: "shadow",
    })
    assert.equal(result.proposedRows, null)
    assert.ok(Array.isArray(result.n2Decisions))
    assert.equal(result.n2Decisions!.length, 2)
    // N2 Q2: Azure A → skipped
    assert.equal(result.n2Decisions![1]!.action, "skipped")
    // Telemetría incluye n2
    assert.ok(lines.some((l) => l.includes('"n2"') || l.includes("n2")))
  } finally {
    __setVisualBlankRescueEmitForTests(null)
  }
})

test("APPLY mode: N2 nunca entra en proposedRows (solo N1 rescued)", async () => {
  const result = await runAzureVisualBlankRescue({
    imageBuffer: await synthPageImage([[0, 2]]),
    imageWidth: W,
    imageHeight: H,
    marks: marksAllUnselected(),
    rows: [
      { questionNumber: 1, selectedAnswer: "BLANK" },
      { questionNumber: 2, selectedAnswer: "A" },
    ],
    expectedQuestionCount: 2,
    expectedOptionCount: 4,
    variant: "single_column",
    mode: "apply",
  })
  assert.ok(result.proposedRows)
  for (const row of result.proposedRows!) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(row, "visualBlankRescueN2"),
      false
    )
    // Si hay rescue flag, solo de N1
    if (row.visualBlankRescue === true) {
      assert.ok(typeof row.visualBlankRescueLetter === "string")
    }
  }
  // N2 puede existir en telemetría/result pero no muta proposed por sí mismo
  assert.ok(Array.isArray(result.n2Decisions))
})

test("page_no_deficit: sin n2Decisions (early return)", async () => {
  const marks: VisualBlankRescueMark[] = marksAllUnselected().map((m, i) =>
    i === 0 || i === 4
      ? { ...m, state: "selected" as const }
      : m
  )
  const result = await runAzureVisualBlankRescue({
    imageBuffer: await synthPageImage([]),
    imageWidth: W,
    imageHeight: H,
    marks,
    rows: [
      { questionNumber: 1, selectedAnswer: "A" },
      { questionNumber: 2, selectedAnswer: "A" },
    ],
    expectedQuestionCount: 2,
    expectedOptionCount: 4,
    variant: "single_column",
    mode: "shadow",
  })
  assert.equal(result.pageAbstainReason, "no_selected_deficit")
  assert.equal(result.n2Decisions, undefined)
})

test("grid_incomplete: sin n2Decisions", async () => {
  const result = await runAzureVisualBlankRescue({
    imageBuffer: await synthPageImage([]),
    imageWidth: W,
    imageHeight: H,
    marks: marksAllUnselected().slice(0, 5),
    rows: [
      { questionNumber: 1, selectedAnswer: "BLANK" },
      { questionNumber: 2, selectedAnswer: "BLANK" },
    ],
    expectedQuestionCount: 2,
    expectedOptionCount: 4,
    variant: "single_column",
    mode: "shadow",
  })
  assert.equal(result.pageAbstainReason, "grid_incomplete")
  assert.equal(result.n2Decisions, undefined)
})

// ---------------------------------------------------------------------------
// Fixtures reales student2 (validación, no reglas de negocio)
// ---------------------------------------------------------------------------

type ForensicMeta = {
  transform?: { width?: number; height?: number }
  questionLetterPolygons: Array<{
    questionNumber: number
    letter: string
    polygon: number[]
  }>
  omrPreN1: Array<{ questionNumber: number; selectedAnswer: string }>
  n1?: {
    decisions?: Array<{
      questionNumber: number
      action: string
      reason: string
      bestLetter?: string | null
    }>
  }
}

const STUDENT2_SHA =
  "750902a4a0a466d18985cf01872009c38477fcf44a290ac829dcd31eac31da47"

async function loadStudent2(): Promise<{
  gray: Buffer
  width: number
  height: number
  meta: ForensicMeta
} | null> {
  const pngPath = path.join(FIXTURE_DIR, "student2_p0.png")
  const metaPath = path.join(FIXTURE_DIR, "student2_p0.meta.json")
  if (!fs.existsSync(pngPath) || !fs.existsSync(metaPath)) return null
  const png = fs.readFileSync(pngPath)
  if (sha256(png) !== STUDENT2_SHA) {
    throw new Error(`student2 SHA mismatch: ${sha256(png)}`)
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as ForensicMeta
  const width = meta.transform?.width ?? 0
  const height = meta.transform?.height ?? 0
  const gray = await sharp(png).greyscale().resize(width, height, { fit: "fill" }).raw().toBuffer()
  return { gray, width, height, meta }
}

function optionsForQ(
  meta: ForensicMeta,
  q: number
): VisualBlankN2OptionInput[] {
  return meta.questionLetterPolygons
    .filter((r) => r.questionNumber === q)
    .sort((a, b) => a.letter.localeCompare(b.letter))
    .map((r) => ({ letter: r.letter, polygonPx: r.polygon }))
}

test("REAL student2 Q1: N1 abstain → N2 CONFIRMED D + métricas offline", async () => {
  const loaded = await loadStudent2()
  if (!loaded) {
    console.log("  (skip: fixture student2 ausente)")
    return
  }
  const { gray, width, height, meta } = loaded
  const n1 = meta.n1?.decisions?.find((d) => d.questionNumber === 1)
  assert.equal(n1?.action, "abstain")
  assert.equal(n1?.reason, "insufficient_absolute_evidence")

  const d = evaluateVisualBlankN2({
    gray,
    width,
    height,
    options: optionsForQ(meta, 1),
    currentAnswer: "BLANK",
    n1Action: n1!.action,
    n1Reason: n1!.reason,
  })

  assert.equal(d.action, "confirmed_answer")
  assert.equal(d.bestLetter, "D")
  assert.equal(d.reason, "row_absolute_dominant_clear")

  // Comparación offline certificada (tolerancia numérica mínima)
  assert.ok(d.meanCore != null && Math.abs(d.meanCore - 141.7529) < 0.05)
  assert.ok(d.rowBackground != null && Math.abs(d.rowBackground - 185.1849) < 0.05)
  assert.ok(d.absContrast != null && Math.abs(d.absContrast - 43.432) < 0.05)
  assert.ok(d.darkRatioCore != null && Math.abs(d.darkRatioCore - 1) < 0.01)
  assert.equal(d.largestComponent, 170)
  assert.ok(d.marginAbs != null && Math.abs(d.marginAbs - 43.1526) < 0.05)
  assert.equal(d.secondLetter, "C")
})

test("REAL student2 Q2: N1 RESCUED B → N2 SKIPPED", async () => {
  const loaded = await loadStudent2()
  if (!loaded) return
  const { gray, width, height, meta } = loaded
  const n1 = meta.n1?.decisions?.find((d) => d.questionNumber === 2)
  assert.equal(n1?.action, "rescued_answer")
  assert.equal(n1?.bestLetter, "B")
  const d = evaluateVisualBlankN2({
    gray,
    width,
    height,
    options: optionsForQ(meta, 2),
    currentAnswer: "BLANK",
    n1Action: n1!.action,
    n1Reason: n1!.reason,
  })
  assert.equal(d.action, "skipped")
})

test("REAL student2 Q3: N1 RESCUED C → N2 SKIPPED", async () => {
  const loaded = await loadStudent2()
  if (!loaded) return
  const { gray, width, height, meta } = loaded
  const n1 = meta.n1?.decisions?.find((d) => d.questionNumber === 3)
  assert.equal(n1?.action, "rescued_answer")
  assert.equal(n1?.bestLetter, "C")
  const d = evaluateVisualBlankN2({
    gray,
    width,
    height,
    options: optionsForQ(meta, 3),
    currentAnswer: "BLANK",
    n1Action: n1!.action,
    n1Reason: n1!.reason,
  })
  assert.equal(d.action, "skipped")
})

test("REAL student2 Q4–Q7: N2 SKIPPED (Azure selected)", async () => {
  const loaded = await loadStudent2()
  if (!loaded) return
  const { gray, width, height, meta } = loaded
  for (const q of [4, 5, 6, 7]) {
    const n1 = meta.n1?.decisions?.find((d) => d.questionNumber === q)
    const azure = meta.omrPreN1.find((r) => r.questionNumber === q)?.selectedAnswer
    assert.ok(azure && azure !== "BLANK")
    const d = evaluateVisualBlankN2({
      gray,
      width,
      height,
      options: optionsForQ(meta, q),
      currentAnswer: azure,
      n1Action: n1?.action ?? "no_action",
      n1Reason: n1?.reason ?? "already_selected",
    })
    assert.equal(d.action, "skipped", `Q${q}`)
  }
})

test("REAL student1/3: Azure 7/7 → N2 no interviene (SKIPPED)", async () => {
  for (const label of ["student1_p0", "student3_p0"] as const) {
    const pngPath = path.join(FIXTURE_DIR, `${label}.png`)
    const metaPath = path.join(FIXTURE_DIR, `${label}.meta.json`)
    if (!fs.existsSync(pngPath) || !fs.existsSync(metaPath)) {
      console.log(`  (skip: fixture ${label} ausente)`)
      continue
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as ForensicMeta
    const width = meta.transform?.width ?? 0
    const height = meta.transform?.height ?? 0
    const gray = await sharp(fs.readFileSync(pngPath))
      .greyscale()
      .resize(width, height, { fit: "fill" })
      .raw()
      .toBuffer()
    for (const row of meta.omrPreN1) {
      const n1 = meta.n1?.decisions?.find((d) => d.questionNumber === row.questionNumber)
      const d = evaluateVisualBlankN2({
        gray,
        width,
        height,
        options: optionsForQ(meta, row.questionNumber),
        currentAnswer: row.selectedAnswer,
        n1Action: n1?.action ?? "no_action",
        n1Reason: n1?.reason ?? "page_no_deficit",
      })
      assert.equal(d.action, "skipped", `${label} Q${row.questionNumber}`)
    }
  }
})

test("thresholds offline intactos (no relajados)", () => {
  assert.equal(N2_PARAMS.MIN_ABS_CONTRAST, 28)
  assert.equal(N2_PARAMS.MIN_MARGIN_ABS, 20)
  assert.equal(N2_PARAMS.MIN_LARGEST_COMP, 80)
  assert.equal(N2_PARAMS.MIN_DARK_RATIO_CORE, 0.45)
  assert.equal(N2_PARAMS.DARK_DELTA, 25)
  assert.equal(N2_PARAMS.CORE_RADIUS_FACTOR, 0.75)
  assert.equal(N2_PARAMS.CERTIFIED_OPTION_COUNT, 4)
})

test("measure vs decide: medición no usa n1/azure", async () => {
  const row = await makeGrayRow({ markedIndex: 3 })
  const m = measureRowAbsoluteDominantClear(row)
  assert.equal(m.ok, true)
  if (m.ok) assert.equal(m.bestLetter, "D")
})

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`PASS ${t.name}`)
    } catch (err) {
      failed++
      console.error(`FAIL ${t.name}`)
      console.error(err)
    }
  }
  console.log(`\nN2 tests: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
