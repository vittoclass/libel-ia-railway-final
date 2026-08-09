/**
 * Pruebas offline del Azure Raw Snapshot Recorder (FASE R.10 + N2-A.3).
 * Ejecutar sin tocar package.json:
 *   npx tsx app/lib/diagnostics/__tests__/azure-raw-snapshot-recorder.test.ts
 *
 * Solo fixtures sintéticos. No Azure. No datos reales.
 */

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  AZURE_RAW_SNAPSHOT_FLAG,
  AZURE_RAW_SNAPSHOT_SCHEMA_VERSION,
  buildSanitizedAzureRawPageSnapshot,
  computeAzureInputSha256,
  isAzureRawSnapshotEnabled,
  recordAzureRawSnapshot,
  __getAzureRawSnapshotWrittenCountForTests,
  __resetAzureRawSnapshotStateForTests,
  __setAzureRawSnapshotEmitForTests,
  type AzureRawSnapshotPayload,
} from "../azure-raw-snapshot-recorder"

type TestFn = () => void

const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

function withFlag(value: string | undefined, fn: () => void): void {
  const prev = process.env[AZURE_RAW_SNAPSHOT_FLAG]
  try {
    if (value === undefined) {
      delete process.env[AZURE_RAW_SNAPSHOT_FLAG]
    } else {
      process.env[AZURE_RAW_SNAPSHOT_FLAG] = value
    }
    fn()
  } finally {
    if (prev === undefined) {
      delete process.env[AZURE_RAW_SNAPSHOT_FLAG]
    } else {
      process.env[AZURE_RAW_SNAPSHOT_FLAG] = prev
    }
  }
}

function parseSnapshotLine(line: string): AzureRawSnapshotPayload {
  assert.ok(line.startsWith("[AZURE_RAW_SNAPSHOT] "))
  const json = line.slice("[AZURE_RAW_SNAPSHOT] ".length)
  return JSON.parse(json) as AzureRawSnapshotPayload
}

const dirtyAnalyzeResult = {
  pages: [
    {
      pageNumber: 1,
      width: 1000,
      height: 1400,
      unit: "pixel",
      lines: [{ content: "Juan Pérez RUT 12.345.678-9", polygon: [1, 2, 3, 4] }],
      words: [{ content: "secreto", confidence: 0.9 }],
      tables: [{ rowCount: 1 }],
      paragraphs: [{ content: "párrafo OCR" }],
      selectionMarks: [
        {
          state: "selected",
          confidence: 0.97,
          polygon: [10, 20, 30, 20, 30, 40, 10, 40],
          span: { offset: 0, length: 1 },
        },
        {
          state: "unselected",
          confidence: 0.88,
          polygon: [50, 60, 70, 60, 70, 80, 50, 80],
        },
      ],
    },
  ],
  content: "texto OCR completo prohibido",
  styles: [],
  apiVersion: "2024-11-30",
}

const forensicContext = {
  diagnosticRunId: "run-aaa-111",
  evaluationBatchId: "batch-bbb-222",
  batchStudentIndex: 2,
  pageIndex: 0,
  attempt: 1,
  azureInputSha256: createHash("sha256").update(Buffer.from("azure-input-v1")).digest("hex"),
  omrPerQuestion: [
    { questionNumber: 1, selectedAnswer: "A" },
    { questionNumber: 2, selectedAnswer: "BLANK" },
    { questionNumber: 3, selectedAnswer: "MULTIPLE" },
  ],
}

// --- Flag ---
test("1. flag OFF (ausencia) → no evento", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag(undefined, () => {
    assert.equal(isAzureRawSnapshotEnabled(), false)
    recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
    assert.equal(lines.length, 0)
    assert.equal(__getAzureRawSnapshotWrittenCountForTests(), 0)
  })
})

test('1b. flag "0" → OFF y no emite', () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag("0", () => {
    assert.equal(isAzureRawSnapshotEnabled(), false)
    recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
    assert.equal(lines.length, 0)
  })
})

test("2. flag ON → evento [AZURE_RAW_SNAPSHOT]", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag("1", () => {
    assert.equal(isAzureRawSnapshotEnabled(), true)
    recordAzureRawSnapshot(dirtyAnalyzeResult, {
      technicalBatchId: "batch-tech-001",
      batchStudentIndex: 2,
    })
    assert.equal(lines.length, 1)
    assert.ok(lines[0]!.startsWith("[AZURE_RAW_SNAPSHOT] "))
    assert.equal(lines[0]!.includes("\n"), false)
    const snap = parseSnapshotLine(lines[0]!)
    assert.equal(snap.schemaVersion, AZURE_RAW_SNAPSHOT_SCHEMA_VERSION)
    assert.equal(snap.pageIndex, 0)
    assert.equal(snap.technicalBatchId, "batch-tech-001")
    assert.equal(snap.evaluationBatchId, "batch-tech-001")
    assert.equal(snap.batchStudentIndex, 2)
    assert.equal(snap.selectionMarksTotal, 2)
    assert.equal(snap.selectionMarks.length, 2)
    assert.ok(typeof snap.timestamp === "string" && snap.timestamp.length > 10)
  })
})

test("3. SHA determinístico", () => {
  const buf = Buffer.from([1, 2, 3, 4, 5])
  const a = computeAzureInputSha256(buf)
  const b = computeAzureInputSha256(Buffer.from([1, 2, 3, 4, 5]))
  const expected = createHash("sha256").update(buf).digest("hex")
  assert.equal(a, expected)
  assert.equal(b, expected)
  assert.equal(a, b)
  assert.match(a!, /^[a-f0-9]{64}$/)
})

test("4. SHA cambia si cambia buffer", () => {
  const a = computeAzureInputSha256(Buffer.from("orientation-buffer-v1"))
  const b = computeAzureInputSha256(Buffer.from("orientation-buffer-v2"))
  assert.notEqual(a, b)
  assert.ok(a && b)
})

test("5. IDs completos presentes", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag("1", () => {
    recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
    const snap = parseSnapshotLine(lines[0]!)
    assert.equal(snap.diagnosticRunId, "run-aaa-111")
    assert.equal(snap.evaluationBatchId, "batch-bbb-222")
    assert.equal(snap.batchStudentIndex, 2)
    assert.equal(snap.pageIndex, 0)
    assert.equal(snap.attempt, 1)
    assert.equal(snap.azureInputSha256, forensicContext.azureInputSha256)
  })
})

test("6. attempt distinto produce evento distinto", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag("1", () => {
    recordAzureRawSnapshot(dirtyAnalyzeResult, { ...forensicContext, attempt: 0 })
    recordAzureRawSnapshot(dirtyAnalyzeResult, { ...forensicContext, attempt: 1 })
    assert.equal(lines.length, 2)
    const a = parseSnapshotLine(lines[0]!)
    const b = parseSnapshotLine(lines[1]!)
    assert.equal(a.attempt, 0)
    assert.equal(b.attempt, 1)
    assert.notEqual(JSON.stringify(a), JSON.stringify(b))
  })
})

test("7. width/height presentes", () => {
  const snap = buildSanitizedAzureRawPageSnapshot(dirtyAnalyzeResult.pages[0]!, 0)
  assert.ok(snap)
  assert.equal(snap.width, 1000)
  assert.equal(snap.height, 1400)
})

test("8. unit presente si runtime la entrega", () => {
  const snap = buildSanitizedAzureRawPageSnapshot(dirtyAnalyzeResult.pages[0]!, 0)
  assert.ok(snap)
  assert.equal(snap.unit, "pixel")
})

test("9. unit ausente → fail-soft (no inventa)", () => {
  const page = {
    pageNumber: 1,
    width: 800,
    height: 600,
    selectionMarks: [
      { state: "selected", confidence: 0.9, polygon: [0, 0, 1, 0, 1, 1, 0, 1] },
    ],
  }
  const snap = buildSanitizedAzureRawPageSnapshot(page, 0)
  assert.ok(snap)
  assert.equal(snap.width, 800)
  assert.equal(snap.height, 600)
  assert.equal(snap.unit, undefined)
  assert.equal("unit" in snap, false)
})

test("10. polygon/state/confidence presentes", () => {
  const snap = buildSanitizedAzureRawPageSnapshot(dirtyAnalyzeResult.pages[0]!, 0)
  assert.ok(snap)
  const m0 = snap.selectionMarks[0]!
  const m1 = snap.selectionMarks[1]!
  assert.equal(m0.index, 0)
  assert.equal(m0.state, "selected")
  assert.equal(m0.confidence, 0.97)
  assert.deepEqual(m0.polygon, [10, 20, 30, 20, 30, 40, 10, 40])
  assert.equal(m0.pageNumber, 1)
  assert.equal(m1.index, 1)
  assert.equal(m1.state, "unselected")
  assert.equal(m1.confidence, 0.88)
  assert.deepEqual(m1.polygon, [50, 60, 70, 60, 70, 80, 50, 80])
})

test("11. omrPerQuestion presente", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag("1", () => {
    recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
    const snap = parseSnapshotLine(lines[0]!)
    assert.deepEqual(snap.omrPerQuestion, [
      { questionNumber: 1, selectedAnswer: "A" },
      { questionNumber: 2, selectedAnswer: "BLANK" },
      { questionNumber: 3, selectedAnswer: "MULTIPLE" },
    ])
  })
})

test("12-15. sin PII / base64 / URL / texto OCR", () => {
  const page = dirtyAnalyzeResult.pages[0]!
  const snap = buildSanitizedAzureRawPageSnapshot(page, 0, {
    ...forensicContext,
    omrPerQuestion: [
      { questionNumber: 1, selectedAnswer: "B" },
      { questionNumber: 2, selectedAnswer: "http://evil.example/leak" },
      { questionNumber: 3, selectedAnswer: "data:image/png;base64,AAAA" },
    ],
  })
  assert.ok(snap)
  const json = JSON.stringify(snap)
  assert.equal(json.includes("Juan"), false)
  assert.equal(json.includes("RUT"), false)
  assert.equal(json.includes("secreto"), false)
  assert.equal(json.includes("párrafo"), false)
  assert.equal(json.includes("lines"), false)
  assert.equal(json.includes("words"), false)
  assert.equal(json.includes("tables"), false)
  assert.equal(json.includes("paragraphs"), false)
  assert.equal(json.includes("span"), false)
  assert.equal(json.includes("content"), false)
  assert.equal(json.includes("base64"), false)
  assert.equal(json.includes("http"), false)
  assert.equal(json.includes("evil"), false)
  assert.equal(snap.omrPerQuestion?.length, 1)
  assert.equal(snap.omrPerQuestion?.[0]?.selectedAnswer, "B")
})

test("16. recorder exception → no lanza (pipeline intacto)", () => {
  __resetAzureRawSnapshotStateForTests()
  __setAzureRawSnapshotEmitForTests(() => {
    throw new Error("stdout closed")
  })
  withFlag("1", () => {
    assert.doesNotThrow(() => {
      recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
    })
    assert.equal(__getAzureRawSnapshotWrittenCountForTests(), 0)
  })
  assert.equal(computeAzureInputSha256(null), undefined)
  assert.equal(computeAzureInputSha256(undefined), undefined)
  assert.equal(computeAzureInputSha256("not-a-buffer"), undefined)
})

test("17. out / analyzeResult no mutados", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  const input = JSON.parse(JSON.stringify(dirtyAnalyzeResult)) as typeof dirtyAnalyzeResult
  const before = JSON.parse(JSON.stringify(input))
  const omr = [
    { questionNumber: 1, selectedAnswer: "C" },
    { questionNumber: 2, selectedAnswer: "BLANK" },
  ]
  const omrBefore = JSON.parse(JSON.stringify(omr))
  withFlag("1", () => {
    recordAzureRawSnapshot(input, { ...forensicContext, omrPerQuestion: omr })
  })
  assert.deepEqual(input, before)
  assert.deepEqual(omr, omrBefore)
  const page = input.pages[0]!
  const pageBefore = JSON.parse(JSON.stringify(page))
  buildSanitizedAzureRawPageSnapshot(page, 0, forensicContext)
  assert.deepEqual(page, pageBefore)
  assert.equal(lines.length, 1)
})

test("18. selectedAnswer no mutado por sanitización", () => {
  const omr = [
    { questionNumber: 1, selectedAnswer: "a" },
    { questionNumber: 2, selectedAnswer: "blank" },
  ]
  const before = JSON.parse(JSON.stringify(omr))
  const snap = buildSanitizedAzureRawPageSnapshot(dirtyAnalyzeResult.pages[0]!, 0, {
    omrPerQuestion: omr,
  })
  assert.ok(snap)
  assert.deepEqual(omr, before)
  assert.deepEqual(snap.omrPerQuestion, [
    { questionNumber: 1, selectedAnswer: "A" },
    { questionNumber: 2, selectedAnswer: "BLANK" },
  ])
})

test("19. retry / attempt en contexto no altera marks ni inventa IDs", () => {
  const snap0 = buildSanitizedAzureRawPageSnapshot(dirtyAnalyzeResult.pages[0]!, 0, {
    attempt: 0,
    diagnosticRunId: "run-1",
  })
  const snap1 = buildSanitizedAzureRawPageSnapshot(dirtyAnalyzeResult.pages[0]!, 0, {
    attempt: 1,
    diagnosticRunId: "run-1",
  })
  assert.ok(snap0 && snap1)
  assert.deepEqual(snap0.selectionMarks, snap1.selectionMarks)
  assert.equal(snap0.attempt, 0)
  assert.equal(snap1.attempt, 1)
  assert.equal(snap0.evaluationBatchId, undefined)
})

test("20. comportamiento flag OFF idéntico (cero evento / cero side-effects)", () => {
  __resetAzureRawSnapshotStateForTests()
  let emitCalls = 0
  __setAzureRawSnapshotEmitForTests(() => {
    emitCalls += 1
  })
  withFlag(undefined, () => {
    recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
    recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
  })
  withFlag("0", () => {
    recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
  })
  withFlag("true", () => {
    recordAzureRawSnapshot(dirtyAnalyzeResult, forensicContext)
  })
  assert.equal(emitCalls, 0)
  assert.equal(__getAzureRawSnapshotWrittenCountForTests(), 0)
})

test("elimina campos prohibidos (OCR, texto, tablas, span, content)", () => {
  const page = dirtyAnalyzeResult.pages[0]!
  const snap = buildSanitizedAzureRawPageSnapshot(page, 0)
  assert.ok(snap)
  const keys = Object.keys(snap).sort()
  assert.deepEqual(keys, [
    "height",
    "pageIndex",
    "schemaVersion",
    "selectionMarks",
    "selectionMarksTotal",
    "timestamp",
    "unit",
    "width",
  ])
})

test("límite de eventos: máx 20 snapshots por proceso", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag("1", () => {
    for (let i = 0; i < 25; i++) {
      recordAzureRawSnapshot({
        pages: [
          {
            pageNumber: 1,
            selectionMarks: [
              {
                state: "selected",
                confidence: 0.9,
                polygon: [0, 0, 1, 0, 1, 1, 0, 1],
              },
            ],
          },
        ],
      })
    }
    assert.equal(__getAzureRawSnapshotWrittenCountForTests(), 20)
    assert.equal(lines.length, 20)
  })
})

test("emite a console.log, no a filesystem", () => {
  __resetAzureRawSnapshotStateForTests()
  const captured: string[] = []
  const originalLog = console.log
  console.log = ((...args: unknown[]) => {
    captured.push(String(args[0] ?? ""))
  }) as typeof console.log
  try {
    withFlag("1", () => {
      recordAzureRawSnapshot(dirtyAnalyzeResult)
    })
    assert.equal(captured.length, 1)
    assert.ok(captured[0]!.startsWith("[AZURE_RAW_SNAPSHOT] "))
    const snap = parseSnapshotLine(captured[0]!)
    assert.equal(snap.schemaVersion, AZURE_RAW_SNAPSHOT_SCHEMA_VERSION)
    assert.equal(snap.pageIndex, 0)
    assert.equal(snap.selectionMarksTotal, 2)
    assert.equal(snap.azurePageIndex, 0)
  } finally {
    console.log = originalLog
  }
})

test("SHA inválido en contexto se omite fail-soft", () => {
  const snap = buildSanitizedAzureRawPageSnapshot(dirtyAnalyzeResult.pages[0]!, 0, {
    azureInputSha256: "not-a-hash",
  })
  assert.ok(snap)
  assert.equal(snap.azureInputSha256, undefined)
})

// --- runner ---
for (const t of tests) {
  __resetAzureRawSnapshotStateForTests()
  try {
    t.fn()
    passed += 1
    console.log(`ok - ${t.name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL - ${t.name}`)
    console.error(err)
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
if (failed > 0) {
  process.exit(1)
}
