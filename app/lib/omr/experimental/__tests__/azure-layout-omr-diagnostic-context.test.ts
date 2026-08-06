/**
 * FASE 2A-2 — contrato de propagación de contexto técnico readonly (+ diagnosticRunId).
 * Ejecutar: npx tsx app/lib/omr/experimental/__tests__/azure-layout-omr-diagnostic-context.test.ts
 *
 * No llama Azure. No activa Shadow/APPLY/PREVALENCE. Solo contrato + eventKey + identidad.
 */

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import type { AzureLayoutOmrDiagnosticContext } from "../azure-layout-omr-pipeline"
import { tryBuildPrevalenceEventKey } from "@/app/lib/diagnostics/visual-verification-prevalence-recorder"

type TestFn = () => void | Promise<void>

const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

/** Params funcionales del pipeline (sin diagnosticContext). */
type FunctionalPipelineParams = {
  imageBuffer: Buffer
  templateKey: string
  expectedQuestionCount?: number
  expectedOptionCount?: number
  canonicalWidth: number
  canonicalHeight: number
  omrTemplateVariant?: string
}

function stripDiagnosticContext<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "diagnosticContext"> {
  const { diagnosticContext: _drop, ...rest } = params as T & {
    diagnosticContext?: unknown
  }
  void _drop
  return rest
}

test("eventKey batch completo es determinístico y exacto", () => {
  const ctx: AzureLayoutOmrDiagnosticContext = {
    diagnosticRunId: "run-1",
    evaluationBatchId: "batch-uuid-1",
    batchStudentIndex: 3,
    pageIndex: 0,
    attempt: 1,
  }
  const k = tryBuildPrevalenceEventKey(ctx)
  assert.deepEqual(k, {
    sourceMode: "batch",
    eventKey: "run-1|batch-uuid-1|3|0|1",
  })
  assert.deepEqual(tryBuildPrevalenceEventKey(ctx), tryBuildPrevalenceEventKey({ ...ctx }))
})

test("eventKey omite si falta diagnosticRunId", () => {
  assert.equal(
    tryBuildPrevalenceEventKey({
      evaluationBatchId: "b",
      batchStudentIndex: 1,
      pageIndex: 0,
      attempt: 0,
    }),
    null,
  )
})

test("eventKey: evaluationBatchId vacío/whitespace → direct (no inventa batchId)", () => {
  assert.deepEqual(
    tryBuildPrevalenceEventKey({
      diagnosticRunId: "r",
      evaluationBatchId: "",
      batchStudentIndex: 1,
      pageIndex: 0,
      attempt: 0,
    }),
    { sourceMode: "direct", eventKey: "r|direct|0|0" },
  )
  assert.deepEqual(
    tryBuildPrevalenceEventKey({
      diagnosticRunId: "r",
      evaluationBatchId: "   ",
      batchStudentIndex: 1,
      pageIndex: 0,
      attempt: 0,
    }),
    { sourceMode: "direct", eventKey: "r|direct|0|0" },
  )
})

test("carga directa sin batchId usa sourceMode direct (no inventa batchId)", () => {
  const k = tryBuildPrevalenceEventKey({
    diagnosticRunId: "run-d",
    pageIndex: 1,
    attempt: 0,
  })
  assert.deepEqual(k, { sourceMode: "direct", eventKey: "run-d|direct|1|0" })
})

test("eventKey omite si falta pageIndex / attempt o son inválidos", () => {
  const base = {
    diagnosticRunId: "r",
    evaluationBatchId: "b",
    batchStudentIndex: 1,
    pageIndex: 0,
    attempt: 0,
  }
  assert.equal(tryBuildPrevalenceEventKey({ ...base, pageIndex: undefined }), null)
  assert.equal(tryBuildPrevalenceEventKey({ ...base, attempt: undefined }), null)
  assert.equal(tryBuildPrevalenceEventKey({ ...base, pageIndex: -1 }), null)
  assert.equal(tryBuildPrevalenceEventKey({ ...base, attempt: 1.5 }), null)
  assert.equal(tryBuildPrevalenceEventKey(null), null)
  assert.equal(tryBuildPrevalenceEventKey(undefined), null)
})

test("batch con evaluationBatchId requiere batchStudentIndex", () => {
  assert.equal(
    tryBuildPrevalenceEventKey({
      diagnosticRunId: "r",
      evaluationBatchId: "b",
      pageIndex: 0,
      attempt: 0,
    }),
    null,
  )
})

test("identidad: params funcionales idénticos con/sin diagnosticContext", () => {
  const imageBuffer = Buffer.from([1, 2, 3])
  const withoutCtx: FunctionalPipelineParams = {
    imageBuffer,
    templateKey: "template_38_4",
    expectedQuestionCount: 10,
    expectedOptionCount: 4,
    canonicalWidth: 1200,
    canonicalHeight: 1700,
    omrTemplateVariant: "odd_even_dual_column",
  }
  const withCtx = {
    ...withoutCtx,
    diagnosticContext: {
      diagnosticRunId: "run-x",
      evaluationBatchId: "batch-x",
      batchStudentIndex: 2,
      pageIndex: 1,
      attempt: 0,
    } satisfies AzureLayoutOmrDiagnosticContext,
  }
  assert.deepEqual(stripDiagnosticContext(withCtx), withoutCtx)
  assert.equal(withCtx.imageBuffer, withoutCtx.imageBuffer)
})

test("contrato readonly: campos todos opcionales; parcial no inventa defaults", () => {
  const partial: AzureLayoutOmrDiagnosticContext = { pageIndex: 0, attempt: 0 }
  assert.equal(partial.diagnosticRunId, undefined)
  assert.equal(partial.evaluationBatchId, undefined)
  assert.equal(partial.batchStudentIndex, undefined)
  assert.equal(tryBuildPrevalenceEventKey(partial), null)
})

test("attempt 0 vs 1 producen eventKeys distintos", () => {
  const a = tryBuildPrevalenceEventKey({
    diagnosticRunId: "r",
    evaluationBatchId: "b",
    batchStudentIndex: 1,
    pageIndex: 0,
    attempt: 0,
  })
  const b = tryBuildPrevalenceEventKey({
    diagnosticRunId: "r",
    evaluationBatchId: "b",
    batchStudentIndex: 1,
    pageIndex: 0,
    attempt: 1,
  })
  assert.ok(a && b)
  assert.notEqual(a.eventKey, b.eventKey)
})

test("un solo diagnosticRunId por ejecución; reevaluación genera otro", () => {
  const runA = randomUUID()
  const runB = randomUUID()
  assert.notEqual(runA, runB)
  const pages = [0, 1, 2].map((pageIndex) =>
    tryBuildPrevalenceEventKey({
      diagnosticRunId: runA,
      evaluationBatchId: "b",
      batchStudentIndex: 1,
      pageIndex,
      attempt: 0,
    }),
  )
  assert.ok(pages.every((p) => p && p.eventKey.startsWith(runA + "|")))
  const reeval = tryBuildPrevalenceEventKey({
    diagnosticRunId: runB,
    evaluationBatchId: "b",
    batchStudentIndex: 1,
    pageIndex: 0,
    attempt: 0,
  })
  assert.ok(reeval)
  assert.notEqual(reeval.eventKey, pages[0]!.eventKey)
})

async function main(): Promise<void> {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`ok - ${t.name}`)
    } catch (e) {
      failed++
      console.error(`fail - ${t.name}`)
      console.error(e)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
