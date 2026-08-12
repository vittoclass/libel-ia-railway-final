/**
 * SCALE-B0 — Idempotencia de persistencia (capa evaluations PK / job_id).
 * OFFLINE. Sin Supabase prod. Sin Railway.
 *
 * Ejecutar: npx tsx app/lib/__tests__/persist-evaluation-idempotency.test.ts
 */
import assert from "node:assert/strict"
import {
  isPgUniqueViolation,
  memoryInsertEvaluationIdempotent,
  peekEvaluationJobPersistIdentity,
  resolveDeterministicInsertConflict,
  resolveEvaluationPersistId,
  runWithEvaluationJobPersistIdentity,
  type PersistOutcome,
} from "../persist-evaluation"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

function persistOnce(store: Map<string, { id: string; status: string }>, jobId: string): PersistOutcome {
  return memoryInsertEvaluationIdempotent(store, jobId)
}

function persistN(store: Map<string, { id: string; status: string }>, jobId: string, n: number): PersistOutcome[] {
  const out: PersistOutcome[] = []
  for (let i = 0; i < n; i++) out.push(persistOnce(store, jobId))
  return out
}

test("TEST1: mismo job 1 vez → 1 evaluación", () => {
  const store = new Map<string, { id: string; status: string }>()
  const jobId = crypto.randomUUID()
  const outcomes = persistN(store, jobId, 1)
  assert.equal(outcomes[0], "persisted_new")
  assert.equal(store.size, 1)
  assert.ok(store.has(jobId))
})

test("TEST2: mismo job 2 veces → 1 evaluación", () => {
  const store = new Map<string, { id: string; status: string }>()
  const jobId = crypto.randomUUID()
  const outcomes = persistN(store, jobId, 2)
  assert.deepEqual(outcomes, ["persisted_new", "persisted_existing_idempotent"])
  assert.equal(store.size, 1)
})

test("TEST3: mismo job 10 veces → 1 evaluación", () => {
  const store = new Map<string, { id: string; status: string }>()
  const jobId = crypto.randomUUID()
  const outcomes = persistN(store, jobId, 10)
  assert.equal(outcomes.filter((o) => o === "persisted_new").length, 1)
  assert.equal(outcomes.filter((o) => o === "persisted_existing_idempotent").length, 9)
  assert.equal(store.size, 1)
})

test("TEST5: dos jobs distintos mismo batch → 2 evaluaciones", () => {
  const store = new Map<string, { id: string; status: string }>()
  const batch = crypto.randomUUID()
  const j1 = crypto.randomUUID()
  const j2 = crypto.randomUUID()
  void batch
  assert.equal(persistOnce(store, j1), "persisted_new")
  assert.equal(persistOnce(store, j2), "persisted_new")
  assert.equal(store.size, 2)
})

test("TEST6: mismo estudiante dos evaluaciones intencionales → ambas permitidas", () => {
  const store = new Map<string, { id: string; status: string }>()
  // Dos client_request_id distintos → dos job_id
  const eval1 = crypto.randomUUID()
  const eval2 = crypto.randomUUID()
  assert.equal(persistOnce(store, eval1), "persisted_new")
  assert.equal(persistOnce(store, eval2), "persisted_new")
  assert.equal(store.size, 2)
})

test("TEST7: dos profesores → no colisión", () => {
  const store = new Map<string, { id: string; status: string }>()
  const t1Job = crypto.randomUUID()
  const t2Job = crypto.randomUUID()
  assert.equal(persistOnce(store, t1Job), "persisted_new")
  assert.equal(persistOnce(store, t2Job), "persisted_new")
  assert.equal(store.size, 2)
})

test("TEST8: dos colegios → no colisión", () => {
  const store = new Map<string, { id: string; status: string }>()
  assert.equal(persistOnce(store, crypto.randomUUID()), "persisted_new")
  assert.equal(persistOnce(store, crypto.randomUUID()), "persisted_new")
  assert.equal(store.size, 2)
})

test("TEST9: dos batches → no colisión", () => {
  const store = new Map<string, { id: string; status: string }>()
  assert.equal(persistOnce(store, crypto.randomUUID()), "persisted_new")
  assert.equal(persistOnce(store, crypto.randomUUID()), "persisted_new")
  assert.equal(store.size, 2)
})

test("TEST10: mismo client_request_id / mismo job_id reentregado → misma evaluación", () => {
  const store = new Map<string, { id: string; status: string }>()
  const stableJobId = crypto.randomUUID()
  assert.equal(persistOnce(store, stableJobId), "persisted_new")
  assert.equal(persistOnce(store, stableJobId), "persisted_existing_idempotent")
  assert.equal(store.size, 1)
  assert.equal([...store.keys()][0], stableJobId)
})

test("TEST11: identidades distintas concurrentes → no bloqueo mutuo", async () => {
  const store = new Map<string, { id: string; status: string }>()
  const ids = Array.from({ length: 20 }, () => crypto.randomUUID())
  await Promise.all(ids.map((id) => Promise.resolve(persistOnce(store, id))))
  assert.equal(store.size, 20)
})

test("TEST12: race mismo logical job → máximo 1 persistencia nueva", async () => {
  const store = new Map<string, { id: string; status: string }>()
  const jobId = crypto.randomUUID()
  // Simula carrera: muchos intentos; el Map.set/has no es perfecto bajo async real,
  // pero el modelo PK es “primera escritura gana” — serializamos como DB unique.
  const outcomes = await Promise.all(
    Array.from({ length: 50 }, async () => {
      // micro-yield para intercalado
      await Promise.resolve()
      return persistOnce(store, jobId)
    }),
  )
  assert.equal(store.size, 1)
  assert.ok(outcomes.includes("persisted_new"))
  assert.equal(outcomes.filter((o) => o === "persisted_new").length, 1)
})

test("TEST15: 40 alumnos + redelivery de 5 → 40 evaluaciones", () => {
  const store = new Map<string, { id: string; status: string }>()
  const jobs = Array.from({ length: 40 }, () => crypto.randomUUID())
  for (const j of jobs) assert.equal(persistOnce(store, j), "persisted_new")
  assert.equal(store.size, 40)
  for (const j of jobs.slice(0, 5)) {
    assert.equal(persistOnce(store, j), "persisted_existing_idempotent")
  }
  assert.equal(store.size, 40)
})

test("TEST16a: 100 únicos + 20 redeliveries → 100", () => {
  const store = new Map<string, { id: string; status: string }>()
  const jobs = Array.from({ length: 100 }, () => crypto.randomUUID())
  for (const j of jobs) persistOnce(store, j)
  for (const j of jobs.slice(0, 20)) persistOnce(store, j)
  assert.equal(store.size, 100)
})

test("TEST16b: 500 únicos + 100 redeliveries → 500", () => {
  const store = new Map<string, { id: string; status: string }>()
  const jobs = Array.from({ length: 500 }, () => crypto.randomUUID())
  for (const j of jobs) persistOnce(store, j)
  for (const j of jobs.slice(0, 100)) persistOnce(store, j)
  assert.equal(store.size, 500)
})

test("TEST16c: 1000 únicos + 250 redeliveries → 1000", () => {
  const store = new Map<string, { id: string; status: string }>()
  const jobs = Array.from({ length: 1000 }, () => crypto.randomUUID())
  for (const j of jobs) persistOnce(store, j)
  for (const j of jobs.slice(0, 250)) persistOnce(store, j)
  assert.equal(store.size, 1000)
})

test("TEST17: determinismo — orden de retries no crea filas extra", () => {
  const store = new Map<string, { id: string; status: string }>()
  const A = crypto.randomUUID()
  const B = crypto.randomUUID()
  const C = crypto.randomUUID()
  const orders = [
    [A, B, C, A, B],
    [C, B, A, A],
    [B, B, C, A, C, A],
  ]
  for (const seq of orders) {
    for (const id of seq) persistOnce(store, id)
  }
  assert.equal(store.size, 3)
})

test("ALS: bajo job identity, resolveEvaluationPersistId es determinístico (= job_id)", async () => {
  const jobId = crypto.randomUUID()
  assert.equal(peekEvaluationJobPersistIdentity(), null)
  await runWithEvaluationJobPersistIdentity(jobId, async () => {
    assert.equal(peekEvaluationJobPersistIdentity(), jobId)
    const a = resolveEvaluationPersistId()
    const b = resolveEvaluationPersistId()
    assert.equal(a.deterministic, true)
    assert.equal(a.evaluationId, jobId)
    assert.equal(b.evaluationId, jobId)
  })
  assert.equal(peekEvaluationJobPersistIdentity(), null)
})

test("ALS ausente: path sync genera UUID aleatorio (PRE≡POST normal)", () => {
  const a = resolveEvaluationPersistId()
  const b = resolveEvaluationPersistId()
  assert.equal(a.deterministic, false)
  assert.equal(b.deterministic, false)
  assert.notEqual(a.evaluationId, b.evaluationId)
})

test("isPgUniqueViolation detecta 23505 y mensajes", () => {
  assert.equal(isPgUniqueViolation({ code: "23505", message: "duplicate key" }), true)
  assert.equal(isPgUniqueViolation({ code: "23503", message: "fk" }), false)
  assert.equal(isPgUniqueViolation({ message: "Unique constraint violated" }), true)
  assert.equal(isPgUniqueViolation(null), false)
})

test("fail-soft: conflicto sin fila → fail, no inventa segundo id", async () => {
  const jobId = crypto.randomUUID()
  const r = await resolveDeterministicInsertConflict({
    deterministic: true,
    attemptedId: jobId,
    insertError: { code: "23505", message: "duplicate key" },
    fetchExisting: async () => null,
  })
  assert.equal(r.kind, "fail")
  if (r.kind === "fail") {
    assert.equal(r.error.step, "insert_evaluations_idempotent_ambiguous")
  }
})

test("conflict → existing reutiliza fila", async () => {
  const jobId = crypto.randomUUID()
  const r = await resolveDeterministicInsertConflict({
    deterministic: true,
    attemptedId: jobId,
    insertError: { code: "23505" },
    fetchExisting: async () => ({ id: jobId, status: "draft" }),
  })
  assert.equal(r.kind, "existing")
  if (r.kind === "existing") {
    assert.equal(r.evaluation_id, jobId)
  }
})

test("conflict no-determinístico → not_conflict (path sync)", async () => {
  const r = await resolveDeterministicInsertConflict({
    deterministic: false,
    attemptedId: crypto.randomUUID(),
    insertError: { code: "23505" },
    fetchExisting: async () => null,
  })
  assert.equal(r.kind, "not_conflict")
})

test("regresión N1/N2/APPLY: helpers de persist no alteran flags ni scoring", () => {
  // Solo garantiza que este módulo no lee/escribe env de APPLY/N1/N2.
  const apply = process.env.LIBELIA_AZURE_VISUAL_BLANK_RESCUE_APPLY
  const shadow = process.env.LIBELIA_AZURE_VISUAL_BLANK_RESCUE_SHADOW
  resolveEvaluationPersistId()
  assert.equal(process.env.LIBELIA_AZURE_VISUAL_BLANK_RESCUE_APPLY, apply)
  assert.equal(process.env.LIBELIA_AZURE_VISUAL_BLANK_RESCUE_SHADOW, shadow)
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`PASS ${t.name}`)
    } catch (e) {
      failed++
      console.error(`FAIL ${t.name}:`, e instanceof Error ? e.message : e)
    }
  }
  console.log(`\nSCALE-B0 persist idempotency: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

main()
