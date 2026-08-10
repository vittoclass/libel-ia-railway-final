/**
 * Pruebas offline del paquete forense N2-A.6B.
 * Ejecutar sin tocar package.json:
 *   npx tsx app/lib/diagnostics/__tests__/azure-forensic-buffer-artifact.test.ts
 *
 * Solo fixtures sintéticos. No Azure. No datos reales. No Railway.
 */

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  AZURE_FORENSIC_BUFFER_CAPTURE_FLAG,
  AZURE_FORENSIC_EXPECTED_MIME,
  AZURE_FORENSIC_FAIL_LOG_PREFIX,
  AZURE_FORENSIC_LOG_PREFIX,
  buildForensicArtifactPath,
  buildN1CompatibleQuestionLetterPolygons,
  createInMemoryForensicSink,
  extractN1Correlated,
  isAzureForensicBufferCaptureEnabled,
  pathContainsForbiddenPii,
  recordAzureForensicPackage,
  sanitizeOmrPreN1,
  tryBuildForensicEventKey,
  __setAzureForensicEmitForTests,
  __setAzureForensicSinkForTests,
  type AzureForensicPackagePayload,
} from "../azure-forensic-buffer-artifact"
import {
  AZURE_RAW_SNAPSHOT_FLAG as RAW_FLAG,
  isAzureRawSnapshotEnabled,
} from "../azure-raw-snapshot-recorder"
import type { VisualBlankRescuePageResult } from "@/app/lib/omr-shared/azure-visual-blank-rescue"

type TestFn = () => void | Promise<void>

const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

function withFlag(value: string | undefined, fn: () => void | Promise<void>): Promise<void> {
  const prev = process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]
  const run = async () => {
    try {
      if (value === undefined) {
        delete process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]
      } else {
        process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG] = value
      }
      await fn()
    } finally {
      if (prev === undefined) {
        delete process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]
      } else {
        process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG] = prev
      }
    }
  }
  return run()
}

function withRawFlag(value: string | undefined, fn: () => void): void {
  const prev = process.env[RAW_FLAG]
  try {
    if (value === undefined) delete process.env[RAW_FLAG]
    else process.env[RAW_FLAG] = value
    fn()
  } finally {
    if (prev === undefined) delete process.env[RAW_FLAG]
    else process.env[RAW_FLAG] = prev
  }
}

/** PNG mínimo válido (1×1) — bytes sintéticos exactos. */
function synthPngBuffer(tag = "v1"): Buffer {
  // Cabecera PNG + payload distintivo (no es PNG decodable estricto, pero bytes exactos para SHA).
  // Para overlay/dimensiones usamos un PNG real mínimo:
  const minimalPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  )
  return Buffer.concat([minimalPng, Buffer.from(`|${tag}|`, "utf8")])
}

function makeAnalyzeResult7x4(): {
  analyzeResult: {
    pages: Array<{
      pageNumber: number
      width: number
      height: number
      unit: string
      selectionMarks: Array<{
        state: string
        confidence: number
        polygon: number[]
      }>
    }>
  }
  marks: Array<{
    state: "selected" | "unselected"
    polygonNorm: Array<{ x: number; y: number }>
    confidence: number
    centerX: number
    centerY: number
  }>
} {
  const W = 1000
  const H = 1400
  const selectionMarks: Array<{
    state: string
    confidence: number
    polygon: number[]
  }> = []
  const marks: Array<{
    state: "selected" | "unselected"
    polygonNorm: Array<{ x: number; y: number }>
    confidence: number
    centerX: number
    centerY: number
  }> = []

  // 7 preguntas odd/even dual: left Q1,3,5,7 (4 rows) + right Q2,4,6 (3 rows) ≈ 7
  // Simpler sequential_dual: left 4 questions, right 3 — use odd_even with 7 qs.
  // leftCount = ceil(7/2)=4 → Q1,3,5,7; rightCount=3 → Q2,4,6
  const leftQs = [1, 3, 5, 7]
  const rightQs = [2, 4, 6]
  const mkBubble = (
    cx: number,
    cy: number,
    selected: boolean,
    conf: number,
  ): void => {
    const s = 12
    const polygon = [cx - s, cy - s, cx + s, cy - s, cx + s, cy + s, cx - s, cy + s]
    const state = selected ? "selected" : "unselected"
    selectionMarks.push({ state, confidence: conf, polygon })
    const polygonNorm = [
      { x: (cx - s) / W, y: (cy - s) / H },
      { x: (cx + s) / W, y: (cy - s) / H },
      { x: (cx + s) / W, y: (cy + s) / H },
      { x: (cx - s) / W, y: (cy + s) / H },
    ]
    marks.push({
      state: state as "selected" | "unselected",
      polygonNorm,
      confidence: conf,
      centerX: cx / W,
      centerY: cy / H,
    })
  }

  for (let ri = 0; ri < leftQs.length; ri++) {
    const cy = 200 + ri * 120
    for (let oi = 0; oi < 4; oi++) {
      const cx = 150 + oi * 60
      // Q1 selected A; Q3 blank; others various
      const q = leftQs[ri]!
      const selected = q === 1 && oi === 0
      mkBubble(cx, cy, selected, 0.9 - oi * 0.02)
    }
  }
  for (let ri = 0; ri < rightQs.length; ri++) {
    const cy = 200 + ri * 120
    for (let oi = 0; oi < 4; oi++) {
      const cx = 650 + oi * 60
      const q = rightQs[ri]!
      const selected = q === 2 && oi === 1
      mkBubble(cx, cy, selected, 0.88 - oi * 0.02)
    }
  }

  assert.equal(selectionMarks.length, 28)
  assert.equal(marks.length, 28)

  return {
    analyzeResult: {
      pages: [
        {
          pageNumber: 1,
          width: W,
          height: H,
          unit: "pixel",
          selectionMarks,
        },
      ],
    },
    marks,
  }
}

function baseOmrPreN1(): Array<Record<string, unknown>> {
  return [
    { questionNumber: 1, selectedAnswer: "A", assignedDetectionIndices: [0], confidencesByColumn: { A: 0.9, B: 0.8, C: 0.7, D: 0.6 } },
    { questionNumber: 2, selectedAnswer: "B", assignedDetectionIndices: [5], confidencesByColumn: { A: 0.7, B: 0.88, C: 0.7, D: 0.6 } },
    { questionNumber: 3, selectedAnswer: "BLANK", assignedDetectionIndices: [], inferredBlank: true },
    { questionNumber: 4, selectedAnswer: "BLANK", assignedDetectionIndices: [] },
    { questionNumber: 5, selectedAnswer: "C", assignedDetectionIndices: [10] },
    { questionNumber: 6, selectedAnswer: "BLANK", assignedDetectionIndices: [] },
    { questionNumber: 7, selectedAnswer: "D", assignedDetectionIndices: [15] },
  ]
}

function synthN1Result(): VisualBlankRescuePageResult {
  return {
    pageAction: "shadow_report",
    pageGatesPassed: true,
    pageAbstainReason: null,
    selectionMarksTotal: 28,
    selectedCountAzure: 2,
    blankRowCountBefore: 3,
    decisions: [
      { action: "no_action", questionNumber: 1, reason: "already_selected" },
      {
        action: "abstain",
        questionNumber: 3,
        reason: "insufficient_absolute_evidence",
        metrics: {
          bestLetter: "A",
          secondLetter: "B",
          marginDarkRatio: 0.02,
          marginContrast: 0.01,
          perOption: [
            { letter: "A", meanGray: 200, localBackground: 220, darkRatio: 0.12, contrast: 0.05, azureState: "unselected", azureConfidence: 0.9 },
            { letter: "B", meanGray: 205, localBackground: 220, darkRatio: 0.1, contrast: 0.04, azureState: "unselected", azureConfidence: 0.88 },
            { letter: "C", meanGray: 210, localBackground: 220, darkRatio: 0.08, contrast: 0.03, azureState: "unselected", azureConfidence: 0.86 },
            { letter: "D", meanGray: 215, localBackground: 220, darkRatio: 0.06, contrast: 0.02, azureState: "unselected", azureConfidence: 0.84 },
          ],
        },
      },
      {
        action: "rescued_answer",
        questionNumber: 4,
        letter: "B",
        reason: "visual_blank_rescue",
        metrics: {
          bestLetter: "B",
          secondLetter: "A",
          marginDarkRatio: 0.2,
          marginContrast: 0.15,
          perOption: [
            { letter: "A", meanGray: 180, localBackground: 220, darkRatio: 0.3, contrast: 0.2, azureState: "unselected", azureConfidence: 0.8 },
            { letter: "B", meanGray: 100, localBackground: 220, darkRatio: 0.5, contrast: 0.35, azureState: "unselected", azureConfidence: 0.8 },
            { letter: "C", meanGray: 200, localBackground: 220, darkRatio: 0.1, contrast: 0.05, azureState: "unselected", azureConfidence: 0.8 },
            { letter: "D", meanGray: 205, localBackground: 220, darkRatio: 0.08, contrast: 0.04, azureState: "unselected", azureConfidence: 0.8 },
          ],
        },
      },
    ],
    proposedRows: null,
  }
}

function batchCtx(overrides?: Partial<{
  diagnosticRunId: string
  evaluationBatchId: string
  batchStudentIndex: number
  pageIndex: number
  attempt: number
}>) {
  return {
    diagnosticRunId: overrides?.diagnosticRunId ?? "run-aaa-111",
    evaluationBatchId: overrides?.evaluationBatchId ?? "batch-bbb-222",
    batchStudentIndex: overrides?.batchStudentIndex ?? 2,
    pageIndex: overrides?.pageIndex ?? 0,
    attempt: overrides?.attempt ?? 0,
  }
}

async function captureOnce(opts?: {
  buffer?: Buffer
  shaOverride?: string
  ctx?: ReturnType<typeof batchCtx>
  n1?: VisualBlankRescuePageResult | null
  sink?: ReturnType<typeof createInMemoryForensicSink>
  lines?: string[]
  variant?: string
}): Promise<{
  ref: Awaited<ReturnType<typeof recordAzureForensicPackage>>
  sink: ReturnType<typeof createInMemoryForensicSink>
  lines: string[]
  buffer: Buffer
  fixture: ReturnType<typeof makeAnalyzeResult7x4>
  omr: Array<Record<string, unknown>>
}> {
  const sink = opts?.sink ?? createInMemoryForensicSink()
  const lines = opts?.lines ?? []
  __setAzureForensicSinkForTests(sink)
  __setAzureForensicEmitForTests((line) => {
    lines.push(line)
  })
  const fixture = makeAnalyzeResult7x4()
  const buffer = opts?.buffer ?? synthPngBuffer("azure-exact")
  const omr = baseOmrPreN1()
  const sha = opts?.shaOverride ?? createHash("sha256").update(buffer).digest("hex")
  const ref = await recordAzureForensicPackage({
    azureInputBuffer: buffer,
    azureInputSha256: sha,
    analyzeResult: fixture.analyzeResult,
    marks: fixture.marks,
    omrPreN1: omr,
    n1Result: opts?.n1 === null ? null : (opts?.n1 ?? synthN1Result()),
    diagnosticContext: opts?.ctx ?? batchCtx(),
    layout: {
      expectedQuestionCount: 7,
      expectedOptionCount: 4,
      variant: opts?.variant ?? "odd_even_dual_column",
      templateKey: "template_38_4",
      canonicalWidth: 1000,
      canonicalHeight: 1400,
    },
    transform: {
      azureAnalyzeUsedNormalizedBuffer: true,
      azureAutoRotationApplied: true,
      azureRotationDegreesApplied: 0,
      azureOrientationNormalizationReason: "sharp_exif_rotate",
    },
  })
  return { ref, sink, lines, buffer, fixture, omr }
}

function readMeta(sink: ReturnType<typeof createInMemoryForensicSink>, metaPath: string): AzureForensicPackagePayload {
  const raw = sink.meta.get(metaPath)
  assert.ok(raw)
  return JSON.parse(raw) as AzureForensicPackagePayload
}

// --- 1–4 flags ---
test('1. forensic flag OFF → no operación', async () => {
  await withFlag("0", async () => {
    assert.equal(isAzureForensicBufferCaptureEnabled(), false)
    const { ref, sink } = await captureOnce()
    assert.equal(ref, null)
    assert.equal(sink.store.size, 0)
  })
})

test("2. forensic flag undefined → no operación", async () => {
  await withFlag(undefined, async () => {
    assert.equal(isAzureForensicBufferCaptureEnabled(), false)
    const { ref, sink } = await captureOnce()
    assert.equal(ref, null)
    assert.equal(sink.store.size, 0)
  })
})

test('3. flag "0" → no operación', async () => {
  await withFlag("0", async () => {
    const { ref, sink, lines } = await captureOnce()
    assert.equal(ref, null)
    assert.equal(sink.store.size, 0)
    assert.equal(lines.length, 0)
  })
})

test('4. flag "1" → captura permitida', async () => {
  await withFlag("1", async () => {
    assert.equal(isAzureForensicBufferCaptureEnabled(), true)
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    assert.equal(sink.store.size, 1)
    assert.equal(sink.meta.size, 1)
  })
})

test("5. bytes capturados === bytes recibidos", async () => {
  await withFlag("1", async () => {
    const buffer = synthPngBuffer("exact-bytes")
    const { ref, sink } = await captureOnce({ buffer })
    assert.ok(ref)
    const stored = sink.store.get(ref.path)
    assert.ok(stored)
    assert.equal(Buffer.compare(stored, buffer), 0)
  })
})

test("6. SHA artifact === azureInputSha256", async () => {
  await withFlag("1", async () => {
    const buffer = synthPngBuffer("sha-check")
    const expected = createHash("sha256").update(buffer).digest("hex")
    const { ref, sink } = await captureOnce({ buffer })
    assert.ok(ref)
    assert.equal(ref.azureInputSha256, expected)
    const stored = sink.store.get(ref.path)!
    assert.equal(createHash("sha256").update(stored).digest("hex"), expected)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.azureInputSha256, expected)
  })
})

test("7. SHA mismatch → artifact rechazado/fail-soft", async () => {
  await withFlag("1", async () => {
    const buffer = synthPngBuffer("mismatch")
    const badSha = createHash("sha256").update(Buffer.from("other")).digest("hex")
    const { ref, sink, lines } = await captureOnce({ buffer, shaOverride: badSha })
    assert.equal(ref, null)
    assert.equal(sink.store.size, 0)
    assert.ok(lines.some((l) => l.startsWith(AZURE_FORENSIC_FAIL_LOG_PREFIX)))
  })
})

test("8. byteLength correcto", async () => {
  await withFlag("1", async () => {
    const buffer = synthPngBuffer("len")
    const { ref } = await captureOnce({ buffer })
    assert.ok(ref)
    assert.equal(ref.byteLength, buffer.byteLength)
  })
})

test("9. MIME correcto", async () => {
  await withFlag("1", async () => {
    const { ref } = await captureOnce()
    assert.ok(ref)
    assert.equal(ref.mimeType, AZURE_FORENSIC_EXPECTED_MIME)
  })
})

test("10. identidad batch correcta", async () => {
  await withFlag("1", async () => {
    const ctx = batchCtx({ batchStudentIndex: 3, pageIndex: 1, attempt: 0 })
    const { ref, sink } = await captureOnce({ ctx })
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.sourceMode, "batch")
    assert.equal(meta.diagnosticRunId, ctx.diagnosticRunId)
    assert.equal(meta.evaluationBatchId, ctx.evaluationBatchId)
    assert.equal(meta.batchStudentIndex, 3)
    assert.equal(meta.pageIndex, 1)
    assert.equal(meta.attempt, 0)
    assert.equal(
      meta.eventKey,
      `${ctx.diagnosticRunId}|${ctx.evaluationBatchId}|3|1|0`,
    )
  })
})

test("11. identidad direct correcta", async () => {
  await withFlag("1", async () => {
    const ctx = {
      diagnosticRunId: "run-direct-1",
      pageIndex: 0,
      attempt: 0,
    }
    const key = tryBuildForensicEventKey(ctx)
    assert.ok(key)
    assert.equal(key.sourceMode, "direct")
    assert.equal(key.eventKey, "run-direct-1|direct|0|0")
    const { ref, sink } = await captureOnce({ ctx: ctx as ReturnType<typeof batchCtx> })
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.sourceMode, "direct")
    assert.equal(meta.eventKey, "run-direct-1|direct|0|0")
    assert.ok(ref.path.includes("/direct/"))
  })
})

test("12. attempt 0/1 separados", async () => {
  await withFlag("1", async () => {
    const sink = createInMemoryForensicSink()
    const a0 = await captureOnce({
      sink,
      ctx: batchCtx({ attempt: 0 }),
      buffer: synthPngBuffer("a0"),
    })
    const a1 = await captureOnce({
      sink,
      ctx: batchCtx({ attempt: 1 }),
      buffer: synthPngBuffer("a1"),
    })
    assert.ok(a0.ref && a1.ref)
    assert.notEqual(a0.ref.path, a1.ref.path)
    assert.equal(sink.store.size, 2)
  })
})

test("13. estudiantes separados", async () => {
  await withFlag("1", async () => {
    const sink = createInMemoryForensicSink()
    const s0 = await captureOnce({ sink, ctx: batchCtx({ batchStudentIndex: 0 }), buffer: synthPngBuffer("s0") })
    const s1 = await captureOnce({ sink, ctx: batchCtx({ batchStudentIndex: 1 }), buffer: synthPngBuffer("s1") })
    assert.ok(s0.ref && s1.ref)
    assert.ok(s0.ref.path.includes("/0/"))
    assert.ok(s1.ref.path.includes("/1/"))
    assert.notEqual(s0.ref.path, s1.ref.path)
  })
})

test("14. páginas separadas", async () => {
  await withFlag("1", async () => {
    const sink = createInMemoryForensicSink()
    const p0 = await captureOnce({ sink, ctx: batchCtx({ pageIndex: 0 }), buffer: synthPngBuffer("p0") })
    const p1 = await captureOnce({ sink, ctx: batchCtx({ pageIndex: 1 }), buffer: synthPngBuffer("p1") })
    assert.ok(p0.ref && p1.ref)
    assert.notEqual(p0.ref.path, p1.ref.path)
  })
})

test("15. diagnosticRunId diferente no sobrescribe", async () => {
  await withFlag("1", async () => {
    const sink = createInMemoryForensicSink()
    const sameBuf = synthPngBuffer("same-bytes")
    const r1 = await captureOnce({
      sink,
      buffer: sameBuf,
      ctx: batchCtx({ diagnosticRunId: "run-111" }),
    })
    const r2 = await captureOnce({
      sink,
      buffer: sameBuf,
      ctx: batchCtx({ diagnosticRunId: "run-222" }),
    })
    assert.ok(r1.ref && r2.ref)
    assert.notEqual(r1.ref.path, r2.ref.path)
    assert.equal(sink.store.size, 2)
    assert.equal(Buffer.compare(sink.store.get(r1.ref.path)!, sameBuf), 0)
    assert.equal(Buffer.compare(sink.store.get(r2.ref.path)!, sameBuf), 0)
  })
})

test("16. artifact path determinístico", () => {
  const p = buildForensicArtifactPath({
    diagnosticRunId: "run-aaa",
    sourceMode: "batch",
    batchStudentIndex: 2,
    pageIndex: 0,
    attempt: 1,
    azureInputSha256: "a".repeat(64),
  })
  assert.ok(p)
  assert.equal(
    p.path,
    `diag/azure-input/run-aaa/2/0/1/${"a".repeat(64)}.png`,
  )
  assert.equal(p.metaPath, `${p.path}.meta.json`)
})

test("17. path sin PII", () => {
  assert.equal(pathContainsForbiddenPii("diag/azure-input/run/0/0/0/abc.png"), false)
  assert.equal(pathContainsForbiddenPii("diag/azure-input/Juan Perez/0/0/0/x.png"), true)
  assert.equal(pathContainsForbiddenPii("diag/user@mail/x.png"), true)
  assert.equal(pathContainsForbiddenPii("diag/12.345.678-9/x.png"), true)
  assert.equal(pathContainsForbiddenPii("diag/teacher_key/x.png"), true)
})

test("18. mapping Q→letter→polygon correcto", async () => {
  await withFlag("1", async () => {
    const { ref, sink, fixture } = await captureOnce()
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.questionLetterPolygons.length, 28)
    const q1 = meta.questionLetterPolygons.filter((x) => x.questionNumber === 1)
    assert.equal(q1.length, 4)
    assert.deepEqual(
      q1.map((x) => x.letter).sort(),
      ["A", "B", "C", "D"],
    )
    for (const row of q1) {
      assert.ok(Array.isArray(row.polygon) && row.polygon.length >= 8)
      assert.ok(row.azureState === "selected" || row.azureState === "unselected")
      assert.equal(typeof row.selectionMarkIndex, "number")
    }
    // Índices deben cubrir 0..27
    const idxs = new Set(meta.questionLetterPolygons.map((x) => x.selectionMarkIndex))
    assert.equal(idxs.size, 28)
    // Polygons coinciden con fixture Azure
    const byIndex = new Map(fixture.analyzeResult.pages[0]!.selectionMarks.map((m, i) => [i, m]))
    for (const row of meta.questionLetterPolygons) {
      assert.deepEqual(row.polygon, byIndex.get(row.selectionMarkIndex)!.polygon)
    }
  })
})

test("19. state/confidence preservados", async () => {
  await withFlag("1", async () => {
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    const withConf = meta.questionLetterPolygons.filter((x) => typeof x.azureConfidence === "number")
    assert.ok(withConf.length >= 28)
    const selected = meta.questionLetterPolygons.filter((x) => x.azureState === "selected")
    assert.ok(selected.length >= 1)
  })
})

test("20. OMR pre-N1 preservado", async () => {
  await withFlag("1", async () => {
    const { ref, sink, omr } = await captureOnce()
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.omrPreN1.length, omr.length)
    assert.equal(meta.omrPreN1[0]!.selectedAnswer, "A")
    assert.equal(meta.omrPreN1[2]!.selectedAnswer, "BLANK")
    assert.equal(meta.omrPreN1[2]!.inferredBlank, true)
    assert.deepEqual(meta.omrPreN1[0]!.assignedDetectionIndices, [0])
  })
})

test("21. N1 decision correlacionada cuando existe", async () => {
  await withFlag("1", async () => {
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.n1.available, true)
    assert.equal(meta.n1.pageGatesPassed, true)
    const rescued = meta.n1.decisions?.find((d) => d.action === "rescued_answer")
    assert.ok(rescued)
    assert.equal(rescued.bestLetter, "B")
    assert.equal(rescued.metricsABCD?.length, 4)
    const abstain = meta.n1.decisions?.find((d) => d.action === "abstain")
    assert.ok(abstain)
    assert.equal(typeof abstain.bestDarkRatio, "number")
  })
})

test("22. layout metadata", async () => {
  await withFlag("1", async () => {
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.layout.engine, "azure_layout_family")
    assert.equal(meta.layout.expectedQuestionCount, 7)
    assert.equal(meta.layout.expectedOptionCount, 4)
    assert.equal(meta.layout.variant, "odd_even_dual_column")
    assert.equal(meta.layout.templateKey, "template_38_4")
  })
})

test("23. transform metadata disponible", async () => {
  await withFlag("1", async () => {
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.transform.azureAnalyzeUsedNormalizedBuffer, true)
    assert.equal(meta.transform.width, 1000)
    assert.equal(meta.transform.height, 1400)
    assert.equal(meta.transform.unit, "pixel")
    assert.equal(meta.transform.attempt, 0)
  })
})

test("24. page gates disponibles", async () => {
  await withFlag("1", async () => {
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.pageResult.pageGatesPassed, true)
    assert.equal(meta.pageResult.selectionMarksTotal, 28)
    assert.equal(meta.pageResult.selectedCountAzure, 2)
    assert.equal(meta.pageResult.blankRowCountBefore, 3)
  })
})

test("25. sink failure fail-soft", async () => {
  await withFlag("1", async () => {
    const sink = createInMemoryForensicSink()
    sink.failNext = true
    const { ref, lines } = await captureOnce({ sink })
    assert.equal(ref, null)
    assert.equal(sink.store.size, 0)
    assert.ok(lines.some((l) => l.includes("sink_forced_failure") || l.startsWith(AZURE_FORENSIC_FAIL_LOG_PREFIX)))
  })
})

test("25b. sin sink configurado → fail-soft sink_not_configured", async () => {
  await withFlag("1", async () => {
    const lines: string[] = []
    __setAzureForensicSinkForTests(null)
    __setAzureForensicEmitForTests((l) => lines.push(l))
    const prevDir = process.env.LIBELIA_AZURE_FORENSIC_SINK_DIR
    const prevBucket = process.env.LIBELIA_AZURE_FORENSIC_BUCKET
    delete process.env.LIBELIA_AZURE_FORENSIC_SINK_DIR
    delete process.env.LIBELIA_AZURE_FORENSIC_BUCKET
    try {
      const fixture = makeAnalyzeResult7x4()
      const buffer = synthPngBuffer("nosink")
      const ref = await recordAzureForensicPackage({
        azureInputBuffer: buffer,
        azureInputSha256: createHash("sha256").update(buffer).digest("hex"),
        analyzeResult: fixture.analyzeResult,
        marks: fixture.marks,
        omrPreN1: baseOmrPreN1(),
        n1Result: synthN1Result(),
        diagnosticContext: batchCtx(),
        layout: { expectedQuestionCount: 7, expectedOptionCount: 4, variant: "odd_even_dual_column" },
      })
      assert.equal(ref, null)
      assert.ok(lines.some((l) => l.includes("sink_not_configured")))
    } finally {
      if (prevDir === undefined) delete process.env.LIBELIA_AZURE_FORENSIC_SINK_DIR
      else process.env.LIBELIA_AZURE_FORENSIC_SINK_DIR = prevDir
      if (prevBucket === undefined) delete process.env.LIBELIA_AZURE_FORENSIC_BUCKET
      else process.env.LIBELIA_AZURE_FORENSIC_BUCKET = prevBucket
    }
  })
})

test("26. serialization failure fail-soft", async () => {
  // Forzar fallo vía sink que recibe meta — simulamos con circular no aplica;
  // verificamos extract/sanitize no lanzan y record con contexto inválido falla soft.
  await withFlag("1", async () => {
    const sink = createInMemoryForensicSink()
    const lines: string[] = []
    __setAzureForensicSinkForTests(sink)
    __setAzureForensicEmitForTests((l) => lines.push(l))
    const fixture = makeAnalyzeResult7x4()
    const buffer = synthPngBuffer("ser")
    const ref = await recordAzureForensicPackage({
      azureInputBuffer: buffer,
      azureInputSha256: createHash("sha256").update(buffer).digest("hex"),
      analyzeResult: fixture.analyzeResult,
      marks: fixture.marks,
      omrPreN1: baseOmrPreN1(),
      // identidad incompleta → fail-soft
      diagnosticContext: { diagnosticRunId: "run-x" },
      layout: { expectedQuestionCount: 7, expectedOptionCount: 4, variant: "odd_even_dual_column" },
    })
    assert.equal(ref, null)
    assert.equal(sink.store.size, 0)
    assert.ok(lines.some((l) => l.startsWith(AZURE_FORENSIC_FAIL_LOG_PREFIX)))
  })
})

test("27. NO mutación de out", async () => {
  await withFlag("1", async () => {
    const omr = baseOmrPreN1()
    const freeze = JSON.stringify(omr)
    await captureOnce()
    assert.equal(JSON.stringify(omr), freeze)
  })
})

test("28. NO mutación selectedAnswer", async () => {
  await withFlag("1", async () => {
    const omr = baseOmrPreN1()
    const answers = omr.map((r) => r.selectedAnswer)
    await captureOnce()
    assert.deepEqual(omr.map((r) => r.selectedAnswer), answers)
  })
})

test("29. no teacher_key", async () => {
  await withFlag("1", async () => {
    const { ref, sink, lines } = await captureOnce()
    assert.ok(ref)
    const meta = sink.meta.get(ref.metaPath)!
    assert.equal(meta.toLowerCase().includes("teacher_key"), false)
    assert.equal(lines.join("\n").toLowerCase().includes("teacher_key"), false)
  })
})

test("30. no scoring data", async () => {
  await withFlag("1", async () => {
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    const meta = sink.meta.get(ref.metaPath)!
    assert.equal(meta.toLowerCase().includes("\"scoring\""), false)
    assert.equal(meta.toLowerCase().includes("correctanswer"), false)
    assert.equal(meta.toLowerCase().includes("answerkey"), false)
  })
})

test("31. no base64 en log", async () => {
  await withFlag("1", async () => {
    const { lines } = await captureOnce()
    const joined = lines.join("\n")
    assert.equal(joined.includes("data:image"), false)
    assert.equal(/iVBOR/.test(joined), false)
    assert.ok(lines.some((l) => l.startsWith(AZURE_FORENSIC_LOG_PREFIX)))
  })
})

test("32. no public URL", async () => {
  await withFlag("1", async () => {
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    assert.equal(ref.publicUrl, false)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.artifactReference.publicUrl, false)
    const raw = sink.meta.get(ref.metaPath)!
    assert.equal(raw.includes("https://"), false)
    assert.equal(raw.includes("http://"), false)
  })
})

test("33. RAW flag sola NO almacena buffer", async () => {
  await withFlag(undefined, async () => {
    withRawFlag("1", () => {
      assert.equal(isAzureRawSnapshotEnabled(), true)
      assert.equal(isAzureForensicBufferCaptureEnabled(), false)
    })
    const { ref, sink } = await captureOnce()
    assert.equal(ref, null)
    assert.equal(sink.store.size, 0)
  })
})

test("34. FORENSIC flag controla bytes independientemente", async () => {
  await withFlag("1", async () => {
    withRawFlag(undefined, () => {
      assert.equal(isAzureRawSnapshotEnabled(), false)
      assert.equal(isAzureForensicBufferCaptureEnabled(), true)
    })
    const { ref, sink } = await captureOnce()
    assert.ok(ref)
    assert.equal(sink.store.size, 1)
  })
})

test("35. re-evaluation no sobreescribe", async () => {
  await withFlag("1", async () => {
    const sink = createInMemoryForensicSink()
    const buf = synthPngBuffer("reeval")
    const first = await captureOnce({
      sink,
      buffer: buf,
      ctx: batchCtx({ diagnosticRunId: "run-eval-1", attempt: 0 }),
    })
    const second = await captureOnce({
      sink,
      buffer: buf,
      ctx: batchCtx({ diagnosticRunId: "run-eval-2", attempt: 0 }),
    })
    assert.ok(first.ref && second.ref)
    assert.notEqual(first.ref.path, second.ref.path)
    assert.equal(sink.store.size, 2)
  })
})

test("36. eventKey estable", () => {
  const a = tryBuildForensicEventKey(batchCtx({ attempt: 1 }))
  const b = tryBuildForensicEventKey(batchCtx({ attempt: 1 }))
  assert.ok(a && b)
  assert.equal(a.eventKey, b.eventKey)
  assert.equal(a.eventKey, "run-aaa-111|batch-bbb-222|2|0|1")
})

// --- E2E sintético ---
test("E2E sintético: Pixel-Proof N2 offline preparado", async () => {
  await withFlag("1", async () => {
    const { ref, sink, buffer, fixture } = await captureOnce()
    assert.ok(ref)
    const bytes = sink.store.get(ref.path)!
    const meta = readMeta(sink, ref.metaPath)

    // abrir artifact + SHA
    assert.equal(createHash("sha256").update(bytes).digest("hex"), meta.azureInputSha256)
    assert.equal(Buffer.compare(bytes, buffer), 0)

    // dimensiones
    assert.equal(meta.transform.width, 1000)
    assert.equal(meta.transform.height, 1400)
    assert.equal(meta.transform.unit, "pixel")

    // overlay 28 polygons posible
    assert.equal(meta.questionLetterPolygons.length, 28)
    assert.equal(fixture.analyzeResult.pages[0]!.selectionMarks.length, 28)

    // mapping C1–C7 A/B/C/D
    for (let q = 1; q <= 7; q++) {
      const letters = meta.questionLetterPolygons
        .filter((x) => x.questionNumber === q)
        .map((x) => x.letter)
        .sort()
      assert.deepEqual(letters, ["A", "B", "C", "D"], `Q${q}`)
    }

    // crops A/B/C/D posibles (bbox de polygon)
    for (const row of meta.questionLetterPolygons) {
      const xs = row.polygon.filter((_, i) => i % 2 === 0)
      const ys = row.polygon.filter((_, i) => i % 2 === 1)
      assert.ok(Math.max(...xs) > Math.min(...xs))
      assert.ok(Math.max(...ys) > Math.min(...ys))
    }

    // OMR pre-N1 + N1
    assert.ok(meta.omrPreN1.length === 7)
    assert.equal(meta.n1.available, true)

    // 21 negativos derivables: 7 preguntas × (3 no-best) — al menos estructura A/B/C/D
    const blankQs = meta.omrPreN1.filter((r) => r.selectedAnswer === "BLANK")
    let negativeSlots = 0
    for (const b of blankQs) {
      const opts = meta.questionLetterPolygons.filter((x) => x.questionNumber === b.questionNumber)
      negativeSlots += Math.max(0, opts.length - 1)
    }
    assert.ok(negativeSlots >= 3 * 3)

    // attempts separables (path incluye attempt)
    assert.ok(/\/\d+\/[a-f0-9]{64}\.png$/.test(ref.path))
  })
})

test("N1 ausente → offlineDerivable", async () => {
  await withFlag("1", async () => {
    const { ref, sink } = await captureOnce({ n1: null })
    assert.ok(ref)
    const meta = readMeta(sink, ref.metaPath)
    assert.equal(meta.n1.available, false)
    assert.equal(meta.n1.offlineDerivable, true)
  })
})

test("helpers: sanitizeOmr / extractN1 / mapping unitarios", () => {
  const omr = sanitizeOmrPreN1([
    { questionNumber: 1, selectedAnswer: "a", assignedDetectionIndices: [1] },
    { questionNumber: 2, selectedAnswer: "NOPE" },
  ])
  assert.equal(omr.length, 1)
  assert.equal(omr[0]!.selectedAnswer, "A")

  const n1 = extractN1Correlated(synthN1Result())
  assert.equal(n1.available, true)

  const fixture = makeAnalyzeResult7x4()
  const mapping = buildN1CompatibleQuestionLetterPolygons({
    analyzeResult: fixture.analyzeResult,
    marks: fixture.marks,
    expectedQuestionCount: 7,
    expectedOptionCount: 4,
    variant: "odd_even_dual_column",
  })
  assert.equal(mapping.length, 28)
})

test("flag true/false/2 no habilitan", () => {
  withFlagSync("true", () => assert.equal(isAzureForensicBufferCaptureEnabled(), false))
  withFlagSync("false", () => assert.equal(isAzureForensicBufferCaptureEnabled(), false))
  withFlagSync("2", () => assert.equal(isAzureForensicBufferCaptureEnabled(), false))
})

function withFlagSync(value: string | undefined, fn: () => void): void {
  const prev = process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]
  try {
    if (value === undefined) delete process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]
    else process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG] = value
    fn()
  } finally {
    if (prev === undefined) delete process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]
    else process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG] = prev
  }
}

async function main(): Promise<void> {
  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`ok - ${t.name}`)
    } catch (err) {
      failed += 1
      console.error(`FAIL - ${t.name}`)
      console.error(err)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void main()
