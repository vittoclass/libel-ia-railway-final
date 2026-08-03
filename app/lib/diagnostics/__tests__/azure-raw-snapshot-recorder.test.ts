/**
 * Pruebas offline del Azure Raw Snapshot Recorder (FASE R.10).
 * Ejecutar sin tocar package.json:
 *   npx tsx app/lib/diagnostics/__tests__/azure-raw-snapshot-recorder.test.ts
 *
 * Solo fixtures sintéticos. No Azure. No datos reales.
 */

import assert from "node:assert/strict"
import {
  AZURE_RAW_SNAPSHOT_FLAG,
  buildSanitizedAzureRawPageSnapshot,
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

// --- Flag ---
test("flag: ausencia → OFF y no emite", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag(undefined, () => {
    assert.equal(isAzureRawSnapshotEnabled(), false)
    recordAzureRawSnapshot(dirtyAnalyzeResult)
    assert.equal(lines.length, 0)
    assert.equal(__getAzureRawSnapshotWrittenCountForTests(), 0)
  })
})

test('flag: "0" → OFF y no emite', () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag("0", () => {
    assert.equal(isAzureRawSnapshotEnabled(), false)
    recordAzureRawSnapshot(dirtyAnalyzeResult)
    assert.equal(lines.length, 0)
  })
})

test('flag: "1" → snapshot sanitizado por console.log', () => {
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
    assert.equal(snap.schemaVersion, 1)
    assert.equal(snap.pageIndex, 0)
    assert.equal(snap.technicalBatchId, "batch-tech-001")
    assert.equal(snap.batchStudentIndex, 2)
    assert.equal(snap.selectionMarksTotal, 2)
    assert.equal(snap.selectionMarks.length, 2)
    assert.ok(typeof snap.timestamp === "string" && snap.timestamp.length > 10)
  })
})

test("elimina campos prohibidos (OCR, texto, tablas, span, content)", () => {
  const page = dirtyAnalyzeResult.pages[0]!
  const snap = buildSanitizedAzureRawPageSnapshot(page, 0)
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

  const keys = Object.keys(snap).sort()
  assert.deepEqual(keys, [
    "pageIndex",
    "schemaVersion",
    "selectionMarks",
    "selectionMarksTotal",
    "timestamp",
  ])
})

test("conserva state / confidence / polygon", () => {
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

test("límite de eventos con emit forzado único por llamada", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  withFlag("1", () => {
    for (let i = 0; i < 30; i++) {
      recordAzureRawSnapshot(dirtyAnalyzeResult)
    }
    assert.equal(__getAzureRawSnapshotWrittenCountForTests(), 20)
    assert.equal(lines.length, 20)
  })
})

test("fail-soft ante error de emisión", () => {
  __resetAzureRawSnapshotStateForTests()
  __setAzureRawSnapshotEmitForTests(() => {
    throw new Error("stdout closed")
  })
  withFlag("1", () => {
    assert.doesNotThrow(() => {
      recordAzureRawSnapshot(dirtyAnalyzeResult)
    })
    assert.equal(__getAzureRawSnapshotWrittenCountForTests(), 0)
  })
})

test("no muta el objeto de entrada", () => {
  __resetAzureRawSnapshotStateForTests()
  const lines: string[] = []
  __setAzureRawSnapshotEmitForTests((line) => {
    lines.push(line)
  })
  const input = JSON.parse(JSON.stringify(dirtyAnalyzeResult)) as typeof dirtyAnalyzeResult
  const before = JSON.parse(JSON.stringify(input))
  withFlag("1", () => {
    recordAzureRawSnapshot(input)
  })
  assert.deepEqual(input, before)
  const page = input.pages[0]!
  const pageBefore = JSON.parse(JSON.stringify(page))
  buildSanitizedAzureRawPageSnapshot(page, 0)
  assert.deepEqual(page, pageBefore)
  assert.equal(lines.length, 1)
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
    assert.equal(snap.schemaVersion, 1)
    assert.equal(snap.pageIndex, 0)
    assert.equal(snap.selectionMarksTotal, 2)
  } finally {
    console.log = originalLog
  }
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

