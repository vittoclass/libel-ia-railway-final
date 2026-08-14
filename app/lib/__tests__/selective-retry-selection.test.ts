/**
 * SCALE-R2 — Reintento selectivo universal (quién se encola).
 * OFFLINE. Sin Azure/OMR/IA. Sin Supabase prod. Sin Railway.
 *
 * Ejecutar: npx tsx app/lib/__tests__/selective-retry-selection.test.ts
 */
import assert from "node:assert/strict"
import {
  applySelectiveRetryCompletedHydration,
  classifyEvaluateError,
  classifySelectiveRetryGroup,
  createSyncOnceGuard,
  rememberSelectiveRetryCompletedSlot,
  rememberSelectiveRetryGroupCount,
  readSelectiveRetryCompletedState,
  selectGroupIdsToEvaluate,
  shouldEnqueueSelectiveRetry,
  type SelectiveRetryGroupSnapshot,
  type SelectiveRetryKvStore,
} from "../../useEvaluator"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

function memoryStore(): SelectiveRetryKvStore {
  const m = new Map<string, string>()
  return {
    getItem(key: string) {
      return m.has(key) ? m.get(key)! : null
    },
    setItem(key: string, value: string) {
      m.set(key, value)
    },
  }
}

function snap(partial: Partial<SelectiveRetryGroupSnapshot> & { id: string }): SelectiveRetryGroupSnapshot {
  return {
    hasFiles: true,
    isEvaluated: false,
    isEvaluating: false,
    ...partial,
  }
}

function completed(id: string, evaluationId: string): SelectiveRetryGroupSnapshot {
  return snap({ id, isEvaluated: true, evaluationId, hasFiles: true })
}

function retryableFailed(id: string): SelectiveRetryGroupSnapshot {
  return snap({ id, error: "La evaluación asíncrona falló", hasFiles: true })
}

function neverEvaluated(id: string): SelectiveRetryGroupSnapshot {
  return snap({ id, hasFiles: true })
}

function buildMix(total: number, failedCount: number): SelectiveRetryGroupSnapshot[] {
  const groups: SelectiveRetryGroupSnapshot[] = []
  const completedCount = total - failedCount
  for (let i = 0; i < completedCount; i++) {
    groups.push(completed(`c-${i}`, `eval-${i}`))
  }
  for (let i = 0; i < failedCount; i++) {
    groups.push(retryableFailed(`f-${i}`))
  }
  return groups
}

test("T1: N=25 con 3 fallidas retryable → enqueue exactamente 3", () => {
  const ids = selectGroupIdsToEvaluate(buildMix(25, 3))
  assert.equal(ids.length, 3)
  assert.deepEqual(ids, ["f-0", "f-1", "f-2"])
})

test("T2: 25 completed → enqueue 0", () => {
  assert.equal(selectGroupIdsToEvaluate(buildMix(25, 0)).length, 0)
})

test("T3: 25 failed retryable → enqueue 25", () => {
  assert.equal(selectGroupIdsToEvaluate(buildMix(25, 25)).length, 25)
})

test("T4: completed + Evaluar Todo → nunca enqueue completed", () => {
  const groups = [
    completed("done-1", "e1"),
    completed("done-2", "e2"),
    retryableFailed("fail-1"),
  ]
  const ids = selectGroupIdsToEvaluate(groups)
  assert.deepEqual(ids, ["fail-1"])
  assert.ok(!ids.includes("done-1"))
  assert.ok(!ids.includes("done-2"))
})

test("T5: completed + botón individual → no enqueue accidental", () => {
  const g = completed("done", "e-done")
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
  assert.equal(shouldEnqueueSelectiveRetry("COMPLETED"), false)
})

test("T6: pending/processing → no duplicar", () => {
  const pending = snap({ id: "p1", isEvaluating: true, hasFiles: true })
  const processing = snap({ id: "p2", isEvaluating: true, isEvaluated: false, hasFiles: true })
  assert.equal(classifySelectiveRetryGroup(pending), "IN_FLIGHT")
  assert.equal(classifySelectiveRetryGroup(processing), "IN_FLIGHT")
  assert.deepEqual(selectGroupIdsToEvaluate([pending, processing, retryableFailed("f")]), ["f"])
})

test("T7: failed non-retryable → no enqueue automático", () => {
  const cases: SelectiveRetryGroupSnapshot[] = [
    snap({ id: "a", error: "401 Unauthorized", hasFiles: true }),
    snap({ id: "b", error: "No autorizado", hasFiles: true }),
    snap({ id: "c", error: "403 Forbidden", hasFiles: true }),
    snap({ id: "d", error: "Este lote no pertenece a tu sesión docente", hasFiles: true }),
    snap({ id: "e", error: "input ausente", hasFiles: true }),
    snap({ id: "f", error: "foto inexistente", hasFiles: true }),
    snap({ id: "g", error: "HTTP 400 payload inválido", hasFiles: true }),
    snap({ id: "h", hasFiles: false, error: "sin archivos" }),
  ]
  for (const g of cases) {
    assert.equal(classifySelectiveRetryGroup(g), "FAILED_NON_RETRYABLE", g.id)
  }
  assert.equal(selectGroupIdsToEvaluate(cases).length, 0)
})

test("T8: ambiguous → fail-safe no enqueue", () => {
  const ambiguous: SelectiveRetryGroupSnapshot[] = [
    snap({ id: "a1", isEvaluated: true, error: "algo raro", hasFiles: true }),
    snap({ id: "a2", error: "mensaje no clasificado xyz", hasFiles: true }),
    snap({ id: "a3", hasFiles: false }),
  ]
  for (const g of ambiguous) {
    assert.equal(classifySelectiveRetryGroup(g), "AMBIGUOUS", g.id)
  }
  assert.equal(selectGroupIdsToEvaluate(ambiguous).length, 0)
})

test("T9: refresh completed hidratadas → no enqueue", () => {
  const store = memoryStore()
  const batchA = "11111111-1111-4111-8111-111111111111"
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: batchA,
    studentIndex: 1,
    evaluationId: "eval-hydrated-1",
    groupCount: 3,
  })
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: batchA,
    studentIndex: 2,
    evaluationId: "eval-hydrated-2",
    groupCount: 3,
  })
  const raw: SelectiveRetryGroupSnapshot[] = [
    neverEvaluated("g1"),
    neverEvaluated("g2"),
    retryableFailed("g3"),
  ]
  const state = readSelectiveRetryCompletedState(store, batchA)
  assert.ok(state)
  const hydrated = applySelectiveRetryCompletedHydration(raw, state!.completedByIndex)
  const ids = selectGroupIdsToEvaluate(hydrated)
  assert.deepEqual(ids, ["g3"])
  assert.equal(classifySelectiveRetryGroup(hydrated[0]), "COMPLETED")
  assert.equal(classifySelectiveRetryGroup(hydrated[1]), "COMPLETED")
})

test("T10: refresh failed recuperable → retry permitido", () => {
  const afterRefresh = snap({
    id: "lost-react-state",
    hasFiles: true,
    isEvaluated: false,
    isEvaluating: false,
    error: "Trabajo de evaluación no encontrado",
  })
  assert.equal(classifySelectiveRetryGroup(afterRefresh), "FAILED_RETRYABLE")
  assert.deepEqual(selectGroupIdsToEvaluate([afterRefresh]), ["lost-react-state"])
})

test("T11: doble clic → máximo 1 intento por grupo", () => {
  const guard = createSyncOnceGuard()
  let starts = 0
  const attempt = () => {
    if (!guard.tryAcquire()) return false
    starts += 1
    return true
  }
  assert.equal(attempt(), true)
  assert.equal(attempt(), false)
  assert.equal(attempt(), false)
  assert.equal(starts, 1)
  guard.release()
  assert.equal(attempt(), true)
  assert.equal(starts, 2)
})

test("T12: profesor A y B → sin mezcla", () => {
  const teacherA = [completed("a1", "ea"), retryableFailed("a-fail")]
  const teacherB = [completed("b1", "eb"), retryableFailed("b-fail"), retryableFailed("b-fail-2")]
  assert.deepEqual(selectGroupIdsToEvaluate(teacherA), ["a-fail"])
  assert.deepEqual(selectGroupIdsToEvaluate(teacherB), ["b-fail", "b-fail-2"])
})

test("T13: batch A y B → sin mezcla", () => {
  const store = memoryStore()
  const batchA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const batchB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: batchA,
    studentIndex: 1,
    evaluationId: "only-a",
    groupCount: 1,
  })
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: batchB,
    studentIndex: 1,
    evaluationId: "only-b",
    groupCount: 1,
  })
  const readA = readSelectiveRetryCompletedState(store, batchA)
  const readB = readSelectiveRetryCompletedState(store, batchB)
  assert.equal(readA, null)
  assert.ok(readB)
  assert.equal(readB!.completedByIndex["1"], "only-b")
  assert.notEqual(readB!.completedByIndex["1"], "only-a")
})

function assertBranchAgnostic(label: string): void {
  const groups = [
    completed(`${label}-done`, "e1"),
    retryableFailed(`${label}-fail`),
    snap({ id: `${label}-pending`, isEvaluating: true, hasFiles: true }),
  ]
  assert.deepEqual(selectGroupIdsToEvaluate(groups), [`${label}-fail`], label)
}

test("T14: OMR clásico → selección de retry correcta", () => {
  assertBranchAgnostic("omr-clasico")
})

test("T15: OMR intercalado → selección correcta", () => {
  assertBranchAgnostic("omr-intercalado")
})

test("T16: Mixta → selección correcta", () => {
  assertBranchAgnostic("mixta")
})

test("T17: Desarrollo → selección correcta", () => {
  assertBranchAgnostic("desarrollo")
})

test("T18: Artes → selección correcta", () => {
  assertBranchAgnostic("artes")
})

test("T19: 1000/250 fake → exactamente 250", () => {
  const ids = selectGroupIdsToEvaluate(buildMix(1000, 250))
  assert.equal(ids.length, 250)
})

test("T20: 0 fallidas → no-op seguro", () => {
  assert.deepEqual(selectGroupIdsToEvaluate([]), [])
  assert.deepEqual(selectGroupIdsToEvaluate(buildMix(1, 0)), [])
  assert.deepEqual(selectGroupIdsToEvaluate(buildMix(3, 0)), [])
})

test("escala adicional: 1/0, 1/1, 3/1, 40/5, 100/17, 500/50", () => {
  const cases: Array<[number, number]> = [
    [1, 0],
    [1, 1],
    [3, 1],
    [40, 5],
    [100, 17],
    [500, 50],
  ]
  for (const [total, failed] of cases) {
    assert.equal(selectGroupIdsToEvaluate(buildMix(total, failed)).length, failed, `${total}/${failed}`)
  }
})

test("COMPLETED por evaluation_id aunque isEvaluated=false (refresh)", () => {
  const g = snap({ id: "x", isEvaluated: false, evaluationId: "persisted", hasFiles: true })
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
  assert.equal(selectGroupIdsToEvaluate([g]).length, 0)
})

test("B1 residual: padre/evaluation_id existente NO reenvía motor", () => {
  const g = snap({
    id: "parent",
    isEvaluated: false,
    evaluationId: "parent-eval",
    hasFiles: true,
    error: "children incompletos",
  })
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
  assert.equal(selectGroupIdsToEvaluate([g]).length, 0)
})

test("promotedEvaluationId cuenta como persistida", () => {
  const g = snap({ id: "promo", promotedEvaluationId: "promo-eval", hasFiles: true })
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
})

test("in-session isEvaluated sin id → COMPLETED (no rellamar Azure)", () => {
  const g = snap({ id: "mem", isEvaluated: true, hasFiles: true })
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
})

test("never evaluated con fotos → enqueue", () => {
  const g = neverEvaluated("fresh")
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["fresh"])
})

test("classifyEvaluateError: 429/408 retryable; 401/403 no", () => {
  assert.equal(classifyEvaluateError("HTTP 429"), "retryable")
  assert.equal(classifyEvaluateError("HTTP 408"), "retryable")
  assert.equal(classifyEvaluateError("HTTP 500"), "retryable")
  assert.equal(classifyEvaluateError("401"), "non_retryable")
  assert.equal(classifyEvaluateError("403"), "non_retryable")
  assert.equal(classifyEvaluateError("mensaje opaco"), "unknown")
})

test("hidratación no pisa evaluation_id ya presente", () => {
  const groups = [snap({ id: "g1", evaluationId: "keep-me", hasFiles: true })]
  const out = applySelectiveRetryCompletedHydration(groups, { "1": "other" })
  assert.equal(out[0].evaluationId, "keep-me")
})

test("rememberSelectiveRetryGroupCount no mezcla batches", () => {
  const store = memoryStore()
  rememberSelectiveRetryGroupCount(store, "batch-a", 25)
  rememberSelectiveRetryGroupCount(store, "batch-b", 40)
  assert.equal(readSelectiveRetryCompletedState(store, "batch-a"), null)
  assert.equal(readSelectiveRetryCompletedState(store, "batch-b")?.groupCount, 40)
})

test("selector preserva orden original", () => {
  const groups = [
    retryableFailed("f1"),
    completed("c1", "e1"),
    retryableFailed("f2"),
    neverEvaluated("n1"),
  ]
  assert.deepEqual(selectGroupIdsToEvaluate(groups), ["f1", "f2", "n1"])
})

test("COMPLETED omitida no aparece en enqueue (proxy: no llamaría /api/evaluate/start)", () => {
  const calls: string[] = []
  const groups = buildMix(25, 3)
  for (const id of selectGroupIdsToEvaluate(groups)) calls.push(id)
  assert.equal(calls.length, 3)
  for (const g of groups) {
    if (classifySelectiveRetryGroup(g) === "COMPLETED") {
      assert.ok(!calls.includes(g.id))
    }
  }
})

async function run(): Promise<void> {
  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`PASS ${t.name}`)
    } catch (err) {
      failed += 1
      console.error(`FAIL ${t.name}`)
      console.error(err)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void run()
