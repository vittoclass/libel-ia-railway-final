/**
 * Pruebas offline del Flight Recorder (aislado).
 * Ejecutar sin tocar package.json:
 *   npx tsx app/lib/diagnostics/__tests__/photo-omr-pipeline-diag.test.ts
 *
 * Solo fixtures sintéticos. No datos reales.
 */

import assert from "node:assert/strict"
import {
  PHOTO_OMR_DIAG_LOG_PREFIX,
  PHOTO_OMR_PIPELINE_DIAG_FLAG,
  buildSafeDiagnosticSnapshot,
  isPhotoOmrPipelineDiagnosticEnabled,
  safeDiagnosticEvent,
  type SafeDiagnosticSnapshot,
} from "../photo-omr-pipeline-diag"

type TestFn = () => void

const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

function deepFreezeClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function assertUnchanged(before: unknown, after: unknown): void {
  assert.deepEqual(after, before)
  if (before !== null && typeof before === "object") {
    assert.deepEqual(Object.keys(after as object).sort(), Object.keys(before as object).sort())
  }
}

function withFlag(value: string | undefined, fn: () => void): void {
  const prev = process.env[PHOTO_OMR_PIPELINE_DIAG_FLAG]
  try {
    if (value === undefined) {
      delete process.env[PHOTO_OMR_PIPELINE_DIAG_FLAG]
    } else {
      process.env[PHOTO_OMR_PIPELINE_DIAG_FLAG] = value
    }
    fn()
  } finally {
    if (prev === undefined) {
      delete process.env[PHOTO_OMR_PIPELINE_DIAG_FLAG]
    } else {
      process.env[PHOTO_OMR_PIPELINE_DIAG_FLAG] = prev
    }
  }
}

function captureInfo(fn: () => void): string[] {
  const lines: string[] = []
  const original = console.info
  console.info = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "))
  }
  try {
    fn()
  } finally {
    console.info = original
  }
  return lines
}

const baseSnapshot: SafeDiagnosticSnapshot = {
  schemaVersion: 1,
  event: "IMAGE_ENTERING_OMR",
  timestamp: "2026-07-28T12:00:00.000Z",
  diagnosticSessionId: "diag-test-session",
  sourceFileIndex: 0,
  imageListIndex: 0,
  contentHash: "abc123def456",
}

// --- Flag ---
test("flag: ausencia → OFF", () => {
  withFlag(undefined, () => {
    assert.equal(isPhotoOmrPipelineDiagnosticEnabled(), false)
  })
})

test('flag: "0" → OFF', () => {
  withFlag("0", () => {
    assert.equal(isPhotoOmrPipelineDiagnosticEnabled(), false)
  })
})

test('flag: "false" → OFF', () => {
  withFlag("false", () => {
    assert.equal(isPhotoOmrPipelineDiagnosticEnabled(), false)
  })
})

test('flag: "true" → OFF', () => {
  withFlag("true", () => {
    assert.equal(isPhotoOmrPipelineDiagnosticEnabled(), false)
  })
})

test('flag: "1" → ON', () => {
  withFlag("1", () => {
    assert.equal(isPhotoOmrPipelineDiagnosticEnabled(), true)
  })
})

test("flag OFF: safeDiagnosticEvent no emite", () => {
  withFlag(undefined, () => {
    const lines = captureInfo(() => {
      safeDiagnosticEvent(baseSnapshot)
    })
    assert.equal(lines.length, 0)
  })
})

// --- Fail-soft ---
test("fail-soft: snapshot inválido no lanza", () => {
  withFlag("1", () => {
    assert.doesNotThrow(() => {
      safeDiagnosticEvent({} as SafeDiagnosticSnapshot)
    })
  })
})

test("fail-soft: input null en builder no lanza", () => {
  assert.doesNotThrow(() => {
    assert.equal(buildSafeDiagnosticSnapshot(null), null)
  })
})

test("fail-soft: input inesperado no lanza", () => {
  assert.doesNotThrow(() => {
    assert.equal(buildSafeDiagnosticSnapshot("x"), null)
    assert.equal(buildSafeDiagnosticSnapshot(42), null)
    assert.equal(buildSafeDiagnosticSnapshot([]), null)
  })
})

test("fail-soft: logger que lanza no se propaga", () => {
  withFlag("1", () => {
    const original = console.info
    console.info = () => {
      throw { message: "logger_boom" }
    }
    try {
      assert.doesNotThrow(() => {
        safeDiagnosticEvent(baseSnapshot)
      })
    } finally {
      console.info = original
    }
  })
})

test("fail-soft: serialización problemática no lanza al consumidor", () => {
  withFlag("1", () => {
    const weird = {
      ...baseSnapshot,
      // campo desconocido circular no debe entrar al contrato
    }
    assert.doesNotThrow(() => {
      safeDiagnosticEvent(weird)
    })
  })
})

// --- Seguridad / redacción ---
test("seguridad: URL firmada no aparece en output", () => {
  withFlag("1", () => {
    const malicious = {
      schemaVersion: 1,
      event: "FILE_URLS_RESOLVED",
      timestamp: "2026-07-28T12:00:00.000Z",
      diagnosticSessionId: "https://example.invalid/path?signed_url=abc&token=xyz",
      pathHash: "deadbeefdeadbeef",
    }
    const before = deepFreezeClone(malicious)
    const lines = captureInfo(() => {
      const built = buildSafeDiagnosticSnapshot(malicious)
      assert.equal(built?.diagnosticSessionId, undefined)
      if (built) safeDiagnosticEvent(built)
    })
    assertUnchanged(before, malicious)
    const joined = lines.join("\n")
    assert.equal(joined.includes("signed_url"), false)
    assert.equal(joined.includes("https://"), false)
    assert.equal(joined.includes("token="), false)
  })
})

test("seguridad: data URL no aparece", () => {
  const malicious = {
    schemaVersion: 1,
    event: "IMAGE_RESOLUTION_RESULT",
    timestamp: "2026-07-28T12:00:00.000Z",
    engine: "data:image/png;base64,AAAA",
    contentHash: "ffeeddccbbaa9988",
  }
  const built = buildSafeDiagnosticSnapshot(malicious)
  assert.equal(built?.engine, undefined)
  withFlag("1", () => {
    const lines = captureInfo(() => {
      if (built) safeDiagnosticEvent(built)
    })
    assert.equal(lines.join("\n").includes("data:image"), false)
    assert.equal(lines.join("\n").includes("base64"), false)
  })
})

test("seguridad: cadena base64 extensa no entra al contrato", () => {
  const longB64 = "A".repeat(200)
  const malicious = {
    schemaVersion: 1,
    event: "OMR_PAGE_RESULT",
    timestamp: "2026-07-28T12:00:00.000Z",
    pathHash: longB64,
    contentHash: "aabbccddeeff0011",
  }
  const built = buildSafeDiagnosticSnapshot(malicious)
  assert.equal(built?.pathHash, undefined)
  assert.ok(built?.contentHash)
})

test("seguridad: nombre no autorizado no entra al contrato", () => {
  const malicious = {
    schemaVersion: 1,
    event: "PHOTO_SYNCED_TO_PREVIEW",
    timestamp: "2026-07-28T12:00:00.000Z",
    studentName: "Juan Perez",
    email: "juan@example.com",
    rut: "12.345.678-9",
    contentHash: "1122334455667788",
  }
  const before = deepFreezeClone(malicious)
  const built = buildSafeDiagnosticSnapshot(malicious)
  assertUnchanged(before, malicious)
  assert.ok(built)
  const keys = Object.keys(built)
  assert.equal(keys.includes("studentName"), false)
  assert.equal(keys.includes("email"), false)
  assert.equal(keys.includes("rut"), false)
  assert.equal(JSON.stringify(built).includes("Juan"), false)
  assert.equal(JSON.stringify(built).includes("juan@"), false)
})

test("seguridad: campo desconocido no se serializa", () => {
  const malicious = {
    schemaVersion: 1,
    event: "EVALUATION_DIAGNOSTIC_COMPLETE",
    timestamp: "2026-07-28T12:00:00.000Z",
    password: "secret-value",
    authorization: "Bearer abc",
    cookie: "sid=1",
    contentHash: "9988776655443322",
  }
  const built = buildSafeDiagnosticSnapshot(malicious)
  assert.ok(built)
  const json = JSON.stringify(built)
  assert.equal(json.includes("password"), false)
  assert.equal(json.includes("secret-value"), false)
  assert.equal(json.includes("authorization"), false)
  assert.equal(json.includes("Bearer"), false)
  assert.equal(json.includes("cookie"), false)
})

test("seguridad: objeto anidado no se serializa", () => {
  const malicious = {
    schemaVersion: 1,
    event: "QUESTION_CANDIDATE_AFTER_MERGE",
    timestamp: "2026-07-28T12:00:00.000Z",
    mergeDecision: { nested: true, decision: "kept_current" },
    contentHash: "0102030405060708",
  }
  const built = buildSafeDiagnosticSnapshot(malicious)
  assert.ok(built)
  assert.equal(built.mergeDecision, undefined)
  assert.equal(JSON.stringify(built).includes("nested"), false)
})

// --- Límites ---
test("límites: string excesivo se omite", () => {
  const built = buildSafeDiagnosticSnapshot({
    schemaVersion: 1,
    event: "GROUP_FILES_AFTER_SORT",
    timestamp: "2026-07-28T12:00:00.000Z",
    diagnosticSessionId: "x".repeat(200),
    contentHash: "0a1b2c3d4e5f6789",
  })
  assert.ok(built)
  assert.equal(built.diagnosticSessionId, undefined)
})

test("límites: número infinito se omite", () => {
  const built = buildSafeDiagnosticSnapshot({
    schemaVersion: 1,
    event: "IMAGE_ENTERING_OMR",
    timestamp: "2026-07-28T12:00:00.000Z",
    sourceFileIndex: Number.POSITIVE_INFINITY,
    confidence: Number.NaN,
    contentHash: "abcdef0123456789",
  })
  assert.ok(built)
  assert.equal(built.sourceFileIndex, undefined)
  assert.equal(built.confidence, undefined)
})

test("límites: índice negativo se omite", () => {
  const built = buildSafeDiagnosticSnapshot({
    schemaVersion: 1,
    event: "IMAGE_ENTERING_OMR",
    timestamp: "2026-07-28T12:00:00.000Z",
    sourceFileIndex: -1,
    contentHash: "fedcba9876543210",
  })
  assert.ok(built)
  assert.equal(built.sourceFileIndex, undefined)
})

test("límites: confianza fuera de rango se omite", () => {
  const built = buildSafeDiagnosticSnapshot({
    schemaVersion: 1,
    event: "OMR_PAGE_RESULT",
    timestamp: "2026-07-28T12:00:00.000Z",
    confidence: 1.5,
    detectedAnswer: "A",
    contentHash: "aabb1122ccdd3344",
  })
  assert.ok(built)
  assert.equal(built.confidence, undefined)
  assert.equal(built.detectedAnswer, "A")
})

test("límites: evento desconocido se rechaza", () => {
  assert.equal(
    buildSafeDiagnosticSnapshot({
      schemaVersion: 1,
      event: "SCORE_COMPUTED",
      timestamp: "2026-07-28T12:00:00.000Z",
    }),
    null,
  )
})

// --- No mutación ---
test("no mutación: objeto y arrays de entrada intactos", () => {
  const input = {
    schemaVersion: 1 as const,
    event: "VALID_FILE_URLS_READY" as const,
    timestamp: "2026-07-28T12:00:00.000Z",
    diagnosticSessionId: "diag-test-session",
    sourceFileIndex: 2,
    contentHash: "aa11bb22cc33dd44",
    extraList: [1, 2, 3],
    nested: { a: 1 },
  }
  const before = deepFreezeClone(input)
  const keysBefore = Object.keys(input).sort()
  const listBefore = [...input.extraList]

  const built = buildSafeDiagnosticSnapshot(input)
  withFlag("1", () => {
    if (built) {
      const ret = safeDiagnosticEvent(built)
      assert.equal(ret, undefined)
    }
  })

  assertUnchanged(before, input)
  assert.deepEqual(Object.keys(input).sort(), keysBefore)
  assert.deepEqual(input.extraList, listBefore)
  assert.equal(Object.isFrozen(input), false)
  assert.equal(Object.isFrozen(input.extraList), false)
  assert.equal(input.sourceFileIndex, 2)
})

// --- Retorno ---
test("retorno: safeDiagnosticEvent siempre undefined", () => {
  withFlag("1", () => {
    const ret = safeDiagnosticEvent(baseSnapshot)
    assert.equal(ret, undefined)
  })
  withFlag(undefined, () => {
    const ret = safeDiagnosticEvent(baseSnapshot)
    assert.equal(ret, undefined)
  })
})

test("emisión: una línea JSON con prefijo estable", () => {
  withFlag("1", () => {
    const lines = captureInfo(() => {
      safeDiagnosticEvent(baseSnapshot)
    })
    assert.ok(lines.length >= 1)
    const line = lines[lines.length - 1] ?? ""
    assert.ok(line.startsWith(`${PHOTO_OMR_DIAG_LOG_PREFIX} `))
    const jsonPart = line.slice(PHOTO_OMR_DIAG_LOG_PREFIX.length + 1)
    const parsed = JSON.parse(jsonPart) as SafeDiagnosticSnapshot
    assert.equal(parsed.schemaVersion, 1)
    assert.equal(parsed.event, "IMAGE_ENTERING_OMR")
    assert.equal(parsed.contentHash, "abc123def456")
  })
})

// runner
for (const t of tests) {
  try {
    t.fn()
    passed += 1
    console.log(`ok - ${t.name}`)
  } catch (err) {
    failed += 1
    console.error(`fail - ${t.name}`)
    console.error(err)
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
if (failed > 0) {
  process["exitCode"] = 1
}
