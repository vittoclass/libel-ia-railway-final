/**
 * SCALE-R4 — Identidad de intento + reintento selectivo (quién se encola).
 * OFFLINE. Sin Azure/OMR/IA. Sin Supabase prod. Sin Railway.
 *
 * Ejecutar: npx tsx app/lib/__tests__/selective-retry-selection.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  applySelectiveRetryCompletedHydration,
  beginSelectiveRetryAttempt,
  classifyEvaluateError,
  classifySelectiveRetryGroup,
  computeSelectiveRetryFileFingerprint,
  computeSelectiveRetryGroupFingerprint,
  createSyncOnceGuard,
  ensureSelectiveRetryAttempt,
  rememberSelectiveRetryCompletedSlot,
  rememberSelectiveRetryGroupCount,
  readSelectiveRetryCompletedState,
  readSelectiveRetryCurrentState,
  compareQrSyncGeneration,
  shouldApplyQrSyncPhotos,
  shouldPromoteApiIsEvaluatedToCurrentAttempt,
  shouldRememberCompletedFromQrSyncHistory,
  selectGroupIdsToEvaluate,
  shouldEnqueueSelectiveRetry,
  SELECTIVE_RETRY_COMPLETED_KEY,
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

const ATTEMPT_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ATTEMPT_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const BATCH_A = "11111111-1111-4111-8111-111111111111"
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const FP_PDF = "f:prueba.pdf|1200|1700000000000|application/pdf"
const FP_JPEG = "f:hoja.jpg|800|1700000000001|image/jpeg"
const FP_PNG = "f:hoja.png|900|1700000000002|image/png"
const FP_MOBILE = "m:photo-stable-1"

function snap(partial: Partial<SelectiveRetryGroupSnapshot> & { id: string }): SelectiveRetryGroupSnapshot {
  return {
    hasFiles: true,
    isEvaluated: false,
    isEvaluating: false,
    ...partial,
  }
}

function completed(
  id: string,
  evaluationId: string,
  extra?: Partial<SelectiveRetryGroupSnapshot>,
): SelectiveRetryGroupSnapshot {
  return snap({ id, isEvaluated: true, evaluationId, hasFiles: true, ...extra })
}

function retryableFailed(id: string, extra?: Partial<SelectiveRetryGroupSnapshot>): SelectiveRetryGroupSnapshot {
  return snap({ id, error: "La evaluación asíncrona falló", hasFiles: true, ...extra })
}

function neverEvaluated(id: string, extra?: Partial<SelectiveRetryGroupSnapshot>): SelectiveRetryGroupSnapshot {
  return snap({ id, hasFiles: true, ...extra })
}

function sameAttemptCompleted(id: string, evaluationId: string, fp = FP_PDF): SelectiveRetryGroupSnapshot {
  return completed(id, evaluationId, {
    currentAttemptId: ATTEMPT_A,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: fp,
    completedFingerprint: fp,
  })
}

function sameAttemptFailed(id: string, fp = FP_PDF): SelectiveRetryGroupSnapshot {
  return retryableFailed(id, {
    currentAttemptId: ATTEMPT_A,
    inputFingerprint: fp,
  })
}

function sameAttemptFresh(id: string, fp = FP_PDF): SelectiveRetryGroupSnapshot {
  return neverEvaluated(id, {
    currentAttemptId: ATTEMPT_A,
    inputFingerprint: fp,
  })
}

function buildMix(total: number, failedCount: number, extra?: Partial<SelectiveRetryGroupSnapshot>): SelectiveRetryGroupSnapshot[] {
  const groups: SelectiveRetryGroupSnapshot[] = []
  const completedCount = total - failedCount
  for (let i = 0; i < completedCount; i++) {
    groups.push(completed(`c-${i}`, `eval-${i}`, extra))
  }
  for (let i = 0; i < failedCount; i++) {
    groups.push(retryableFailed(`f-${i}`, extra))
  }
  return groups
}

function buildSameAttemptMix(total: number, failedCount: number): SelectiveRetryGroupSnapshot[] {
  return buildMix(total, failedCount, {
    currentAttemptId: ATTEMPT_A,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: FP_PDF,
    completedFingerprint: FP_PDF,
  }).map((g, i) => {
    if (g.error) {
      return { ...g, completedAttemptId: undefined, completedFingerprint: undefined }
    }
    return { ...g, inputFingerprint: `${FP_PDF}|${i}`, completedFingerprint: `${FP_PDF}|${i}` }
  })
}

test("T1: nuevo archivo nunca evaluado → enqueue 1", () => {
  const g = sameAttemptFresh("fresh")
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["fresh"])
})

test("T2: mismo attempt + mismo input + completed → enqueue 0", () => {
  const g = sameAttemptCompleted("done", "e-done")
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
  assert.equal(selectGroupIdsToEvaluate([g]).length, 0)
})

test("T3: mismo attempt + mismo input + failed retryable → enqueue 1", () => {
  const g = sameAttemptFailed("fail")
  assert.equal(classifySelectiveRetryGroup(g), "FAILED_RETRYABLE")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["fail"])
})

test("T4: mismo attempt + in-flight → enqueue 0", () => {
  const pending = snap({
    id: "p1",
    isEvaluating: true,
    hasFiles: true,
    currentAttemptId: ATTEMPT_A,
    inputFingerprint: FP_PDF,
  })
  assert.equal(classifySelectiveRetryGroup(pending), "IN_FLIGHT")
  assert.equal(selectGroupIdsToEvaluate([pending]).length, 0)
})

test("T5: 25 / 22 completed + 3 failed / mismo attempt → enqueue exactamente 3", () => {
  const ids = selectGroupIdsToEvaluate(buildSameAttemptMix(25, 3))
  assert.equal(ids.length, 3)
  assert.deepEqual(ids, ["f-0", "f-1", "f-2"])
})

test("T6: 25 completed / mismo attempt → enqueue 0", () => {
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(25, 0)).length, 0)
})

test("T7: NUEVA CORRIDA / mismas 25 pruebas → enqueue exactamente 25", () => {
  const groups = Array.from({ length: 25 }, (_, i) =>
    snap({
      id: `n-${i}`,
      hasFiles: true,
      isEvaluated: false,
      evaluationId: `hist-${i}`,
      currentAttemptId: ATTEMPT_B,
      completedAttemptId: ATTEMPT_A,
      inputFingerprint: FP_PDF,
      completedFingerprint: FP_PDF,
    }),
  )
  assert.equal(selectGroupIdsToEvaluate(groups).length, 25)
})

test("T8: NUEVA CORRIDA / mismo fingerprint → permitido", () => {
  const g = snap({
    id: "same-fp",
    hasFiles: true,
    evaluationId: "hist",
    currentAttemptId: ATTEMPT_B,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: FP_PDF,
    completedFingerprint: FP_PDF,
  })
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["same-fp"])
})

test("T9: nueva corrida NO hereda evaluation_id histórica → permitido", () => {
  const g = snap({
    id: "hist-id",
    hasFiles: true,
    isEvaluated: true,
    evaluationId: "eval-historica",
    promotedEvaluationId: "promo-historica",
    currentAttemptId: ATTEMPT_B,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: FP_JPEG,
    completedFingerprint: FP_JPEG,
  })
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["hist-id"])
})

test("T10: después de nueva corrida, completed de ESA corrida → protegida", () => {
  const g = snap({
    id: "new-done",
    hasFiles: true,
    isEvaluated: true,
    evaluationId: "eval-new",
    currentAttemptId: ATTEMPT_B,
    completedAttemptId: ATTEMPT_B,
    inputFingerprint: FP_PDF,
    completedFingerprint: FP_PDF,
  })
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
  assert.equal(selectGroupIdsToEvaluate([g]).length, 0)
})

test("T11: mismo attempt / archivo reemplazado → evaluable", () => {
  const g = snap({
    id: "replaced",
    hasFiles: true,
    isEvaluated: true,
    evaluationId: "old-eval",
    currentAttemptId: ATTEMPT_A,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: FP_PNG,
    completedFingerprint: FP_PDF,
  })
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["replaced"])
})

test("T12: mismo nombre / size-lastModified distinto → evaluable", () => {
  const a = computeSelectiveRetryFileFingerprint({
    name: "prueba.pdf",
    size: 1200,
    lastModified: 1,
    type: "application/pdf",
  })
  const b = computeSelectiveRetryFileFingerprint({
    name: "prueba.pdf",
    size: 1201,
    lastModified: 2,
    type: "application/pdf",
  })
  assert.notEqual(a, b)
  const g = snap({
    id: "same-name",
    hasFiles: true,
    evaluationId: "old",
    currentAttemptId: ATTEMPT_A,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: b,
    completedFingerprint: a,
  })
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
})

test("T13: sessionStorage legacy sin attempt identity → no bloquear nueva corrida", () => {
  const store = memoryStore()
  store.setItem(
    SELECTIVE_RETRY_COMPLETED_KEY,
    JSON.stringify({
      batchId: BATCH_A,
      groupCount: 25,
      completedByIndex: { "1": "eval-legacy-1", "2": "eval-legacy-2" },
    }),
  )
  const state = readSelectiveRetryCompletedState(store, BATCH_A)
  assert.ok(state)
  assert.equal(state!.isLegacy, true)
  assert.deepEqual(state!.completedByIndex, {})
  const raw = [
    neverEvaluated("g1", { currentAttemptId: ATTEMPT_B, inputFingerprint: FP_PDF }),
    neverEvaluated("g2", { currentAttemptId: ATTEMPT_B, inputFingerprint: FP_PDF }),
  ]
  const hydrated = applySelectiveRetryCompletedHydration(raw, state!.completedByIndex, {
    currentAttemptId: ATTEMPT_B,
    isLegacy: state!.isLegacy,
  })
  assert.equal(selectGroupIdsToEvaluate(hydrated).length, 2)
  const leftoverId = snap({
    id: "legacy-id",
    hasFiles: true,
    evaluationId: "eval-legacy-1",
    currentAttemptId: ATTEMPT_B,
    inputFingerprint: FP_PDF,
  })
  assert.equal(classifySelectiveRetryGroup(leftoverId), "NEVER_EVALUATED")
})

test("T14: refresh mismo attempt → estados preservados", () => {
  const store = memoryStore()
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: BATCH_A,
    studentIndex: 1,
    evaluationId: "eval-hydrated-1",
    groupCount: 3,
    attemptId: ATTEMPT_A,
    fingerprint: FP_PDF,
  })
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: BATCH_A,
    studentIndex: 2,
    evaluationId: "eval-hydrated-2",
    groupCount: 3,
    attemptId: ATTEMPT_A,
    fingerprint: FP_PDF,
  })
  const raw: SelectiveRetryGroupSnapshot[] = [
    neverEvaluated("g1", { currentAttemptId: ATTEMPT_A, inputFingerprint: FP_PDF }),
    neverEvaluated("g2", { currentAttemptId: ATTEMPT_A, inputFingerprint: FP_PDF }),
    retryableFailed("g3", { currentAttemptId: ATTEMPT_A, inputFingerprint: FP_PDF }),
  ]
  const state = readSelectiveRetryCompletedState(store, BATCH_A)
  assert.ok(state)
  assert.equal(state!.isLegacy, false)
  assert.equal(state!.attemptId, ATTEMPT_A)
  const hydrated = applySelectiveRetryCompletedHydration(raw, state!.completedByIndex, {
    currentAttemptId: ATTEMPT_A,
  })
  assert.deepEqual(selectGroupIdsToEvaluate(hydrated), ["g3"])
  assert.equal(classifySelectiveRetryGroup(hydrated[0]), "COMPLETED")
  assert.equal(classifySelectiveRetryGroup(hydrated[1]), "COMPLETED")
})

test("T15: refresh nueva corrida → nueva corrida preservada", () => {
  const store = memoryStore()
  const attempt = beginSelectiveRetryAttempt(store, { batchId: "", groupCount: 0 })
  const current = readSelectiveRetryCurrentState(store)
  assert.ok(current)
  assert.equal(current!.attemptId, attempt)
  assert.equal(current!.isLegacy, false)
  const attached = ensureSelectiveRetryAttempt(store, { batchId: BATCH_B, groupCount: 25 })
  assert.equal(attached.attemptId, attempt)
  assert.equal(attached.state.batchId, BATCH_B)
  assert.deepEqual(attached.state.completedByIndex, {})
  const groups = Array.from({ length: 3 }, (_, i) =>
    sameAttemptFresh(`n-${i}`, FP_PDF),
  ).map((g) => ({ ...g, currentAttemptId: attempt }))
  assert.equal(selectGroupIdsToEvaluate(groups).length, 3)
})

test("T16: doble clic mismo attempt → máximo 1 job", () => {
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

test("T17: botón individual completed mismo attempt → 0", () => {
  const g = sameAttemptCompleted("done", "e-done")
  assert.equal(shouldEnqueueSelectiveRetry(classifySelectiveRetryGroup(g)), false)
})

test("T18: botón individual failed mismo attempt → 1", () => {
  const g = sameAttemptFailed("fail")
  assert.equal(shouldEnqueueSelectiveRetry(classifySelectiveRetryGroup(g)), true)
})

test("T19: botón individual nueva corrida → 1", () => {
  const g = snap({
    id: "ind-new",
    hasFiles: true,
    evaluationId: "hist",
    currentAttemptId: ATTEMPT_B,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: FP_PDF,
    completedFingerprint: FP_PDF,
  })
  assert.equal(shouldEnqueueSelectiveRetry(classifySelectiveRetryGroup(g)), true)
})

test("T20: 1 total / 1 fail → retry 1", () => {
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(1, 1)).length, 1)
})

test("T21: 25 / 3 → retry 3", () => {
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(25, 3)).length, 3)
})

test("T22: 100 / 17 → retry 17", () => {
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(100, 17)).length, 17)
})

test("T23: 1000 / 250 → retry 250", () => {
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(1000, 250)).length, 250)
})

test("T24: 0 fallidas → no-op", () => {
  assert.deepEqual(selectGroupIdsToEvaluate([]), [])
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(1, 0)).length, 0)
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(3, 0)).length, 0)
})

test("T25: todas fallidas → retry todas", () => {
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(25, 25)).length, 25)
})

test("T26: PDF → selección correcta", () => {
  const groups = [
    sameAttemptCompleted("pdf-done", "e1", FP_PDF),
    sameAttemptFailed("pdf-fail", FP_PDF),
  ]
  assert.deepEqual(selectGroupIdsToEvaluate(groups), ["pdf-fail"])
})

test("T27: JPEG/PNG → selección correcta", () => {
  const groups = [
    sameAttemptCompleted("jpg-done", "e1", FP_JPEG),
    sameAttemptFailed("png-fail", FP_PNG),
  ]
  assert.deepEqual(selectGroupIdsToEvaluate(groups), ["png-fail"])
})

test("T28: foto móvil → identidad estable", () => {
  const a = computeSelectiveRetryFileFingerprint({ mobileBatchPhotoId: "photo-stable-1" })
  const b = computeSelectiveRetryFileFingerprint({ mobileBatchPhotoId: "photo-stable-1", name: "otro.jpg", size: 9 })
  assert.equal(a, FP_MOBILE)
  assert.equal(a, b)
  const g = sameAttemptCompleted("mob", "e-m", FP_MOBILE)
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
})

function assertBranchAgnostic(label: string): void {
  const groups = [
    sameAttemptCompleted(`${label}-done`, "e1"),
    sameAttemptFailed(`${label}-fail`),
    snap({ id: `${label}-pending`, isEvaluating: true, hasFiles: true, currentAttemptId: ATTEMPT_A }),
  ]
  assert.deepEqual(selectGroupIdsToEvaluate(groups), [`${label}-fail`], label)
}

test("T29: OMR clásico → solo selección cambia", () => {
  assertBranchAgnostic("omr-clasico")
})

test("T30: OMR intercalado → solo selección cambia", () => {
  assertBranchAgnostic("omr-intercalado")
})

test("T31: Mixtas → selección correcta", () => {
  assertBranchAgnostic("mixta")
})

test("T32: Desarrollo → selección correcta", () => {
  assertBranchAgnostic("desarrollo")
})

test("T33: Artes → selección correcta", () => {
  assertBranchAgnostic("artes")
})

test("T34: A3 intacto (selector no importa provider)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /ai-evaluation-provider|requestEvaluationTextCompletion|EVALUATION_TEXT_TIMEOUT_FLOOR/)
})

test("T35: P0 intacto (selector no importa job-runner)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /evaluation-job-runner/)
})

test("T36: N1/N2 intactos (selector no los referencia)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /n2-observer|azure-layout-omr-pipeline/)
})

test("T37: Cursos intactos (selector no toca list/chunking)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /evaluations\/list|TeacherOverview|merge-assignment-overview-courses/)
})

test("T38: B1 intacto/no publicado (selector no importa persist-evaluation)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /persist-evaluation/)
})

test("compat: completed + Evaluar Todo → nunca enqueue completed", () => {
  const groups = [
    completed("done-1", "e1"),
    completed("done-2", "e2"),
    retryableFailed("fail-1"),
  ]
  const ids = selectGroupIdsToEvaluate(groups)
  assert.deepEqual(ids, ["fail-1"])
})

test("compat: pending/processing → no duplicar", () => {
  const pending = snap({ id: "p1", isEvaluating: true, hasFiles: true })
  const processing = snap({ id: "p2", isEvaluating: true, isEvaluated: false, hasFiles: true })
  assert.equal(classifySelectiveRetryGroup(pending), "IN_FLIGHT")
  assert.equal(classifySelectiveRetryGroup(processing), "IN_FLIGHT")
  assert.deepEqual(selectGroupIdsToEvaluate([pending, processing, retryableFailed("f")]), ["f"])
})

test("compat: failed non-retryable → no enqueue automático", () => {
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

test("compat: ambiguous → fail-safe no enqueue", () => {
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

test("compat: profesor A y B → sin mezcla", () => {
  const teacherA = [completed("a1", "ea"), retryableFailed("a-fail")]
  const teacherB = [completed("b1", "eb"), retryableFailed("b-fail"), retryableFailed("b-fail-2")]
  assert.deepEqual(selectGroupIdsToEvaluate(teacherA), ["a-fail"])
  assert.deepEqual(selectGroupIdsToEvaluate(teacherB), ["b-fail", "b-fail-2"])
})

test("compat: batch A y B → sin mezcla", () => {
  const store = memoryStore()
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: BATCH_A,
    studentIndex: 1,
    evaluationId: "only-a",
    groupCount: 1,
    attemptId: ATTEMPT_A,
    fingerprint: FP_PDF,
  })
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: BATCH_B,
    studentIndex: 1,
    evaluationId: "only-b",
    groupCount: 1,
    attemptId: ATTEMPT_B,
    fingerprint: FP_PDF,
  })
  const readA = readSelectiveRetryCompletedState(store, BATCH_A)
  const readB = readSelectiveRetryCompletedState(store, BATCH_B)
  assert.equal(readA, null)
  assert.ok(readB)
  assert.equal(readB!.completedByIndex["1"]?.evaluationId, "only-b")
  assert.notEqual(readB!.completedByIndex["1"]?.evaluationId, "only-a")
})

test("compat: COMPLETED por evaluation_id aunque isEvaluated=false (mismo attempt implícito)", () => {
  const g = snap({ id: "x", isEvaluated: false, evaluationId: "persisted", hasFiles: true })
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
  assert.equal(selectGroupIdsToEvaluate([g]).length, 0)
})

test("compat B1 residual: padre/evaluation_id existente NO reenvía motor", () => {
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

test("compat: promotedEvaluationId cuenta como persistida (mismo attempt implícito)", () => {
  const g = snap({ id: "promo", promotedEvaluationId: "promo-eval", hasFiles: true })
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
})

test("compat: in-session isEvaluated sin id → COMPLETED", () => {
  const g = snap({ id: "mem", isEvaluated: true, hasFiles: true })
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
})

test("compat: classifyEvaluateError 429/408 retryable; 401/403 no", () => {
  assert.equal(classifyEvaluateError("HTTP 429"), "retryable")
  assert.equal(classifyEvaluateError("HTTP 408"), "retryable")
  assert.equal(classifyEvaluateError("HTTP 500"), "retryable")
  assert.equal(classifyEvaluateError("401"), "non_retryable")
  assert.equal(classifyEvaluateError("403"), "non_retryable")
  assert.equal(classifyEvaluateError("mensaje opaco"), "unknown")
})

test("compat: hidratación no pisa evaluation_id ya presente", () => {
  const groups = [
    snap({
      id: "g1",
      evaluationId: "keep-me",
      hasFiles: true,
      inputFingerprint: FP_PDF,
      currentAttemptId: ATTEMPT_A,
    }),
  ]
  const out = applySelectiveRetryCompletedHydration(groups, {
    "1": { evaluationId: "other", fingerprint: FP_PDF, attemptId: ATTEMPT_A },
  }, { currentAttemptId: ATTEMPT_A })
  assert.equal(out[0].evaluationId, "keep-me")
})

test("compat: rememberSelectiveRetryGroupCount no mezcla batches", () => {
  const store = memoryStore()
  rememberSelectiveRetryGroupCount(store, "batch-a", 25, ATTEMPT_A)
  rememberSelectiveRetryGroupCount(store, "batch-b", 40, ATTEMPT_B)
  assert.equal(readSelectiveRetryCompletedState(store, "batch-a"), null)
  assert.equal(readSelectiveRetryCompletedState(store, "batch-b")?.groupCount, 40)
})

test("compat: selector preserva orden original", () => {
  const groups = [
    retryableFailed("f1"),
    completed("c1", "e1"),
    retryableFailed("f2"),
    neverEvaluated("n1"),
  ]
  assert.deepEqual(selectGroupIdsToEvaluate(groups), ["f1", "f2", "n1"])
})

test("compat: hidratación sin fingerprint del grupo no hereda completed", () => {
  const store = memoryStore()
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: BATCH_A,
    studentIndex: 1,
    evaluationId: "should-not-apply",
    groupCount: 1,
    attemptId: ATTEMPT_A,
    fingerprint: FP_PDF,
  })
  const state = readSelectiveRetryCompletedState(store, BATCH_A)
  const empty = [neverEvaluated("empty", { currentAttemptId: ATTEMPT_A })]
  const hydrated = applySelectiveRetryCompletedHydration(empty, state!.completedByIndex, {
    currentAttemptId: ATTEMPT_A,
  })
  assert.equal(hydrated[0].evaluationId, undefined)
  assert.equal(classifySelectiveRetryGroup(hydrated[0]), "NEVER_EVALUATED")
})

test("fingerprint de grupo local no guarda base64", () => {
  const fp = computeSelectiveRetryGroupFingerprint([
    { file: { name: "a.pdf", size: 10, lastModified: 1, type: "application/pdf" } },
  ])
  assert.match(fp, /^f:a\.pdf\|10\|1\|application\/pdf$/)
  assert.doesNotMatch(fp, /base64|data:/i)
})

test("ensureSelectiveRetryAttempt reutiliza attempt en el mismo batch", () => {
  const store = memoryStore()
  const first = ensureSelectiveRetryAttempt(store, { batchId: BATCH_A, groupCount: 2 })
  const second = ensureSelectiveRetryAttempt(store, { batchId: BATCH_A, groupCount: 2 })
  assert.equal(first.attemptId, second.attemptId)
})

test("ensureSelectiveRetryAttempt no reutiliza attempt de otro batch", () => {
  const store = memoryStore()
  const first = ensureSelectiveRetryAttempt(store, { batchId: BATCH_A, groupCount: 1 })
  const second = ensureSelectiveRetryAttempt(store, { batchId: BATCH_B, groupCount: 1 })
  assert.notEqual(first.attemptId, second.attemptId)
})

function snapshotAfterQrHistory(args: {
  id: string
  hasFiles?: boolean
  apiIsEvaluated: boolean
  apiEvaluationId?: string | null
  currentAttemptId: string
  completedAttemptId?: string | null
  inputFingerprint?: string | null
  completedFingerprint?: string | null
  inSessionIsEvaluated?: boolean
  inSessionEvaluationId?: string | null
  sameAttempt: boolean
  sameBatch: boolean
  isEvaluating?: boolean
  error?: string
}): SelectiveRetryGroupSnapshot {
  const promote = shouldPromoteApiIsEvaluatedToCurrentAttempt({
    apiIsEvaluated: args.apiIsEvaluated,
    sameAttempt: args.sameAttempt,
    sameBatch: args.sameBatch,
    groupAlreadyCompletedInCurrentAttempt: args.inSessionIsEvaluated === true,
  })
  return snap({
    id: args.id,
    hasFiles: args.hasFiles !== false,
    isEvaluated: promote,
    isEvaluating: args.isEvaluating === true,
    error: args.error,
    evaluationId: promote ? args.inSessionEvaluationId ?? undefined : undefined,
    currentAttemptId: args.currentAttemptId,
    completedAttemptId: args.completedAttemptId,
    inputFingerprint: args.inputFingerprint,
    completedFingerprint: args.completedFingerprint,
  })
}

function readClientSource(): string {
  return fs.readFileSync(path.resolve(__dirname, "../../EvaluatorClient.tsx"), "utf8")
}

function readSyncRouteSource(): string {
  return fs.readFileSync(path.resolve(__dirname, "../../api/docente/batch-evaluar-sync/route.ts"), "utf8")
}

test("QR-R4 T1: same attempt + same QR photo completed → enqueue 0", () => {
  const g = sameAttemptCompleted("qr-done", "e-qr", FP_MOBILE)
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
  assert.equal(selectGroupIdsToEvaluate([g]).length, 0)
})

test("QR-R4 T2: same attempt + failed retryable → enqueue 1", () => {
  const g = sameAttemptFailed("qr-fail", FP_MOBILE)
  assert.equal(classifySelectiveRetryGroup(g), "FAILED_RETRYABLE")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["qr-fail"])
})

test("QR-R4 T3: same attempt + in-flight → enqueue 0", () => {
  const g = snap({
    id: "qr-fly",
    isEvaluating: true,
    hasFiles: true,
    currentAttemptId: ATTEMPT_A,
    inputFingerprint: FP_MOBILE,
  })
  assert.equal(selectGroupIdsToEvaluate([g]).length, 0)
})

test("QR-R4 T4: new attempt + same QR photo → enqueue 1", () => {
  const g = snap({
    id: "qr-new",
    hasFiles: true,
    currentAttemptId: ATTEMPT_B,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: FP_MOBILE,
    completedFingerprint: FP_MOBILE,
  })
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["qr-new"])
})

test("QR-R4 T5: new attempt + API is_evaluated=true history → enqueue 1", () => {
  const g = snapshotAfterQrHistory({
    id: "hist-eval",
    apiIsEvaluated: true,
    apiEvaluationId: "eval-A",
    currentAttemptId: ATTEMPT_B,
    sameAttempt: true,
    sameBatch: true,
    inputFingerprint: FP_MOBILE,
  })
  assert.equal(g.isEvaluated, false)
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
  assert.deepEqual(selectGroupIdsToEvaluate([g]), ["hist-eval"])
})

test("QR-R4 T6: new attempt + API evaluation_id=A → enqueue 1", () => {
  const g = snapshotAfterQrHistory({
    id: "hist-id",
    apiIsEvaluated: true,
    apiEvaluationId: "evaluation-A",
    currentAttemptId: ATTEMPT_B,
    sameAttempt: true,
    sameBatch: true,
    inputFingerprint: FP_MOBILE,
  })
  assert.equal(g.evaluationId, undefined)
  assert.equal(g.promotedEvaluationId, undefined)
  assert.equal(selectGroupIdsToEvaluate([g]).length, 1)
})

test("QR-R4 T7: same attempt refresh + valid session → completed 0", () => {
  const store = memoryStore()
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: BATCH_A,
    studentIndex: 1,
    evaluationId: "eval-session-a",
    groupCount: 1,
    attemptId: ATTEMPT_A,
    fingerprint: FP_MOBILE,
  })
  const raw = [
    snapshotAfterQrHistory({
      id: "refresh",
      apiIsEvaluated: true,
      apiEvaluationId: "eval-A-history",
      currentAttemptId: ATTEMPT_A,
      sameAttempt: true,
      sameBatch: true,
      inputFingerprint: FP_MOBILE,
    }),
  ]
  const state = readSelectiveRetryCompletedState(store, BATCH_A)
  const hydrated = applySelectiveRetryCompletedHydration(raw, state!.completedByIndex, {
    currentAttemptId: ATTEMPT_A,
  })
  assert.equal(classifySelectiveRetryGroup(hydrated[0]), "COMPLETED")
  assert.equal(selectGroupIdsToEvaluate(hydrated).length, 0)
})

test("QR-R4 T8: session lost + historical API → no permanent block", () => {
  const g = snapshotAfterQrHistory({
    id: "lost",
    apiIsEvaluated: true,
    apiEvaluationId: "eval-A",
    currentAttemptId: ATTEMPT_B,
    sameAttempt: true,
    sameBatch: true,
    inputFingerprint: FP_MOBILE,
  })
  assert.equal(shouldPromoteApiIsEvaluatedToCurrentAttempt({
    apiIsEvaluated: true,
    sameAttempt: true,
    sameBatch: true,
    groupAlreadyCompletedInCurrentAttempt: false,
  }), false)
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
  assert.equal(selectGroupIdsToEvaluate([g]).length, 1)
})

test("QR-R4 T9: new photo same slot → evaluable", () => {
  const g = snap({
    id: "new-photo",
    hasFiles: true,
    isEvaluated: true,
    evaluationId: "old",
    currentAttemptId: ATTEMPT_A,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: "m:photo-new",
    completedFingerprint: FP_MOBILE,
  })
  assert.equal(classifySelectiveRetryGroup(g), "NEVER_EVALUATED")
})

test("QR-R4 T10: 2 photos same student → fingerprint stable", () => {
  const files = [
    { mobileBatchPhotoId: "p1" },
    { mobileBatchPhotoId: "p2" },
  ]
  const a = computeSelectiveRetryGroupFingerprint(files)
  const b = computeSelectiveRetryGroupFingerprint(files)
  assert.equal(a, "m:p1||m:p2")
  assert.equal(a, b)
})

test("QR-R4 T11: new attempt same 2 photos → evaluable", () => {
  const fp = computeSelectiveRetryGroupFingerprint([
    { mobileBatchPhotoId: "p1" },
    { mobileBatchPhotoId: "p2" },
  ])
  const g = snap({
    id: "mp",
    hasFiles: true,
    currentAttemptId: ATTEMPT_B,
    completedAttemptId: ATTEMPT_A,
    inputFingerprint: fp,
    completedFingerprint: fp,
    promotedEvaluationId: "eval-A",
  })
  assert.equal(selectGroupIdsToEvaluate([g]).length, 1)
})

test("QR-R4 T12: 22 completed + 3 failed → exactly 3", () => {
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(25, 3)).length, 3)
})

test("QR-R4 T13: 25 completed same attempt → 0", () => {
  assert.equal(selectGroupIdsToEvaluate(buildSameAttemptMix(25, 0)).length, 0)
})

test("QR-R4 T14: new run same 25 → 25", () => {
  const groups = Array.from({ length: 25 }, (_, i) =>
    snapshotAfterQrHistory({
      id: `nr-${i}`,
      apiIsEvaluated: true,
      apiEvaluationId: `hist-${i}`,
      currentAttemptId: ATTEMPT_B,
      completedAttemptId: ATTEMPT_A,
      sameAttempt: true,
      sameBatch: true,
      inputFingerprint: FP_MOBILE,
      completedFingerprint: FP_MOBILE,
    }),
  )
  assert.equal(selectGroupIdsToEvaluate(groups).length, 25)
})

test("QR-R4 T15: double click → max 1 enqueue", () => {
  const guard = createSyncOnceGuard()
  assert.equal(guard.tryAcquire(), true)
  assert.equal(guard.tryAcquire(), false)
})

test("QR-R4 T16: sync A starts, attempt switches to B, response A → B not poisoned", () => {
  const gen = compareQrSyncGeneration(
    { attemptId: ATTEMPT_A, batchId: BATCH_A },
    { attemptId: ATTEMPT_B, batchId: BATCH_A },
  )
  assert.equal(gen.sameAttempt, false)
  assert.equal(gen.sameBatch, true)
  assert.equal(shouldApplyQrSyncPhotos(gen), true)
  assert.equal(
    shouldPromoteApiIsEvaluatedToCurrentAttempt({
      apiIsEvaluated: true,
      sameAttempt: gen.sameAttempt,
      sameBatch: gen.sameBatch,
      groupAlreadyCompletedInCurrentAttempt: false,
    }),
    false,
  )
  const g = snapshotAfterQrHistory({
    id: "late",
    apiIsEvaluated: true,
    apiEvaluationId: "eval-A",
    currentAttemptId: ATTEMPT_B,
    sameAttempt: gen.sameAttempt,
    sameBatch: gen.sameBatch,
    inputFingerprint: FP_MOBILE,
  })
  assert.equal(g.isEvaluated, false)
  assert.equal(selectGroupIdsToEvaluate([g]).length, 1)
})

test("QR-R4 T17: batch switches during sync → old response not applied as completed", () => {
  const gen = compareQrSyncGeneration(
    { attemptId: ATTEMPT_A, batchId: BATCH_A },
    { attemptId: ATTEMPT_B, batchId: BATCH_B },
  )
  assert.equal(shouldApplyQrSyncPhotos(gen), false)
  assert.equal(
    shouldPromoteApiIsEvaluatedToCurrentAttempt({
      apiIsEvaluated: true,
      sameAttempt: gen.sameAttempt,
      sameBatch: gen.sameBatch,
      groupAlreadyCompletedInCurrentAttempt: false,
    }),
    false,
  )
})

test("QR-R4 T18: historical API does not trigger remember for B", () => {
  assert.equal(shouldRememberCompletedFromQrSyncHistory(), false)
  const store = memoryStore()
  beginSelectiveRetryAttempt(store, { batchId: BATCH_A, groupCount: 1, attemptId: ATTEMPT_B })
  if (shouldRememberCompletedFromQrSyncHistory()) {
    rememberSelectiveRetryCompletedSlot(store, {
      batchId: BATCH_A,
      studentIndex: 1,
      evaluationId: "eval-A",
      groupCount: 1,
      attemptId: ATTEMPT_B,
      fingerprint: FP_MOBILE,
    })
  }
  const state = readSelectiveRetryCompletedState(store, BATCH_A)
  assert.deepEqual(state?.completedByIndex ?? {}, {})
})

test("QR-R4 T19: real evaluate success in B → remember B correctly", () => {
  const store = memoryStore()
  beginSelectiveRetryAttempt(store, { batchId: BATCH_A, groupCount: 1, attemptId: ATTEMPT_B })
  rememberSelectiveRetryCompletedSlot(store, {
    batchId: BATCH_A,
    studentIndex: 1,
    evaluationId: "eval-B",
    groupCount: 1,
    attemptId: ATTEMPT_B,
    fingerprint: FP_MOBILE,
  })
  const raw = [neverEvaluated("b-done", { currentAttemptId: ATTEMPT_B, inputFingerprint: FP_MOBILE })]
  const state = readSelectiveRetryCompletedState(store, BATCH_A)
  const hydrated = applySelectiveRetryCompletedHydration(raw, state!.completedByIndex, {
    currentAttemptId: ATTEMPT_B,
  })
  assert.equal(classifySelectiveRetryGroup(hydrated[0]), "COMPLETED")
  assert.equal(hydrated[0].evaluationId, "eval-B")
})

test("QR-R4 T20: 403 sync → fail-soft (no merge / no completed)", () => {
  const src = readClientSource()
  const fetchIdx = src.indexOf("batch-evaluar-sync?")
  const mergeIdx = src.lastIndexOf("mergeMobileBatchIntoEvaluatorState(")
  const notOkIdx = src.indexOf("if (!r.ok)", fetchIdx)
  assert.ok(fetchIdx > 0 && mergeIdx > fetchIdx)
  assert.ok(notOkIdx > fetchIdx && notOkIdx < mergeIdx)
  assert.match(src.slice(notOkIdx, mergeIdx), /reason:\s*"api_error"/)
})

test("QR-R4 T21: sync unavailable → safe local state", () => {
  const src = readClientSource()
  assert.match(src, /reason:\s*"no_batch"/)
  assert.match(src, /reason:\s*"busy"/)
  assert.match(src, /No se pudo conectar con el servidor/)
})

test("QR-R4 T22: legacy R3 storage → no block", () => {
  const store = memoryStore()
  store.setItem(
    SELECTIVE_RETRY_COMPLETED_KEY,
    JSON.stringify({ batchId: BATCH_A, groupCount: 1, completedByIndex: { "1": "legacy" } }),
  )
  const state = readSelectiveRetryCompletedState(store, BATCH_A)
  assert.equal(state!.isLegacy, true)
  const g = snapshotAfterQrHistory({
    id: "legacy-qr",
    apiIsEvaluated: true,
    apiEvaluationId: "legacy",
    currentAttemptId: ATTEMPT_B,
    sameAttempt: true,
    sameBatch: true,
    inputFingerprint: FP_MOBILE,
  })
  assert.equal(selectGroupIdsToEvaluate([g]).length, 1)
})

test("QR-R4 T23: desktop file fingerprint unchanged", () => {
  const fp = computeSelectiveRetryFileFingerprint({
    name: "prueba.pdf",
    size: 1200,
    lastModified: 1700000000000,
    type: "application/pdf",
  })
  assert.equal(fp, FP_PDF)
})

test("QR-R4 T24: PDF selector unchanged", () => {
  const groups = [sameAttemptCompleted("pdf-done", "e1", FP_PDF), sameAttemptFailed("pdf-fail", FP_PDF)]
  assert.deepEqual(selectGroupIdsToEvaluate(groups), ["pdf-fail"])
})

test("QR-R4 T25: OMR classic selector unchanged", () => {
  assertBranchAgnostic("qr-omr-clasico")
})

test("QR-R4 T26: OMR interleaved selector unchanged", () => {
  assertBranchAgnostic("qr-omr-intercalado")
})

test("QR-R4 T27: Mixtas selector unchanged", () => {
  assertBranchAgnostic("qr-mixta")
})

test("QR-R4 T28: Desarrollo selector unchanged", () => {
  assertBranchAgnostic("qr-desarrollo")
})

test("QR-R4 T29: Artes selector unchanged", () => {
  assertBranchAgnostic("qr-artes")
})

test("QR-R4 T30: A3 intacto", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /ai-evaluation-provider|requestEvaluationTextCompletion/)
})

test("QR-R4 T31: P0 intacto", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /evaluation-job-runner/)
})

test("QR-R4 T32: N1/N2 intactos", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /n2-observer|azure-layout-omr-pipeline|azure-visual-blank-rescue/)
})

test("QR-R4 T33: Cursos intactos", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../useEvaluator.ts"), "utf8")
  assert.doesNotMatch(src, /evaluations\/list|TeacherOverview/)
})

test("QR-R4 T34: API caller compatibility — flag explícita, default filtrado", () => {
  const client = readClientSource()
  const route = readSyncRouteSource()
  assert.match(client, /include_evaluated_photos=1/)
  assert.match(route, /include_evaluated_photos/)
  assert.match(route, /if \(!includeEvaluatedPhotos\)/)
  assert.match(route, /photosForEvaluar = withUrls/)
})

test("QR-R4 T35: payload motor PRE≡POST (sync no altera evaluate payload)", () => {
  const src = readClientSource()
  assert.match(src, /fileUrls: evaluateFileUrls/)
  assert.match(src, /omrClosedLayoutMode/)
  assert.match(src, /evaluation_batch_id: evaluationBatchIdRef/)
  assert.doesNotMatch(src, /is_evaluated === true[\s\S]{0,80}isEvaluated:\s*true/)
})

test("QR-R4 T36: multi-page grouping fingerprint 3 pages", () => {
  const fp = computeSelectiveRetryGroupFingerprint([
    { mobileBatchPhotoId: "s1p1" },
    { mobileBatchPhotoId: "s1p2" },
    { mobileBatchPhotoId: "s1p3" },
  ])
  assert.equal(fp, "m:s1p1||m:s1p2||m:s1p3")
  const g = snapshotAfterQrHistory({
    id: "pages",
    apiIsEvaluated: true,
    apiEvaluationId: "eval-A",
    currentAttemptId: ATTEMPT_B,
    sameAttempt: true,
    sameBatch: true,
    inputFingerprint: fp,
    completedFingerprint: fp,
  })
  assert.equal(selectGroupIdsToEvaluate([g]).length, 1)
})

test("QR-R4 T37: race poll/realtime/broadcast — generation check is deterministic", () => {
  const started = { attemptId: ATTEMPT_A, batchId: BATCH_A }
  const arrivals = [
    { attemptId: ATTEMPT_A, batchId: BATCH_A },
    { attemptId: ATTEMPT_B, batchId: BATCH_A },
    { attemptId: ATTEMPT_B, batchId: BATCH_B },
  ]
  const gens = arrivals.map((cur) => compareQrSyncGeneration(started, cur))
  assert.deepEqual(gens[0], { sameAttempt: true, sameBatch: true })
  assert.deepEqual(gens[1], { sameAttempt: false, sameBatch: true })
  assert.deepEqual(gens[2], { sameAttempt: false, sameBatch: false })
  assert.equal(shouldApplyQrSyncPhotos(gens[0]), true)
  assert.equal(shouldApplyQrSyncPhotos(gens[1]), true)
  assert.equal(shouldApplyQrSyncPhotos(gens[2]), false)
  for (const gen of gens) {
    assert.equal(
      shouldPromoteApiIsEvaluatedToCurrentAttempt({
        apiIsEvaluated: true,
        sameAttempt: gen.sameAttempt,
        sameBatch: gen.sameBatch,
        groupAlreadyCompletedInCurrentAttempt: false,
      }),
      false,
    )
  }
})

test("QR-R4 T38: in-session completed se preserva aunque API history llegue", () => {
  assert.equal(
    shouldPromoteApiIsEvaluatedToCurrentAttempt({
      apiIsEvaluated: true,
      sameAttempt: true,
      sameBatch: true,
      groupAlreadyCompletedInCurrentAttempt: true,
    }),
    true,
  )
  const g = snapshotAfterQrHistory({
    id: "keep",
    apiIsEvaluated: true,
    apiEvaluationId: "hist",
    currentAttemptId: ATTEMPT_A,
    completedAttemptId: ATTEMPT_A,
    sameAttempt: true,
    sameBatch: true,
    inSessionIsEvaluated: true,
    inSessionEvaluationId: "eval-session",
    inputFingerprint: FP_MOBILE,
    completedFingerprint: FP_MOBILE,
  })
  assert.equal(g.isEvaluated, true)
  assert.equal(classifySelectiveRetryGroup(g), "COMPLETED")
})

test("QR-R4 T39: remember after evaluate sigue en EvaluatorClient; no tras merge sync", () => {
  const src = readClientSource()
  const rememberHits: number[] = []
  let from = 0
  while (from < src.length) {
    const idx = src.indexOf("rememberSelectiveRetryCompletedSlot(", from)
    if (idx < 0) break
    rememberHits.push(idx)
    from = idx + 1
  }
  assert.equal(rememberHits.length, 1)
  const mergeIdx = src.indexOf("mergeMobileBatchIntoEvaluatorState(")
  const lastMerge = src.lastIndexOf("mergeMobileBatchIntoEvaluatorState(")
  const rememberIdx = rememberHits[0]
  assert.ok(rememberIdx > lastMerge)
  const window = src.slice(mergeIdx, rememberIdx)
  assert.match(window, /persistedEvalId/)
})

test("QR-R4 T40: client pide fotos evaluated; route default sigue filtrando", () => {
  const client = readClientSource()
  const route = readSyncRouteSource()
  assert.match(client, /include_evaluated_photos=1/)
  assert.doesNotMatch(client, /evaluatedStudentIndexes\.has\(p\.student_index\)/)
  assert.match(
    route,
    /includeEvaluatedPhotos = req\.nextUrl\.searchParams\.get\("include_evaluated_photos"\) === "1"/,
  )
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
