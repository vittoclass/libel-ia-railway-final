/**
 * SCALE-B0 — Idempotencia job runner: crash post-persist / pre-completed + recovery.
 * OFFLINE Redis fake. Sin motor real. Sin Railway.
 *
 * Ejecutar: npx tsx app/lib/__tests__/evaluation-job-runner-idempotency.test.ts
 */
import assert from "node:assert/strict"
import { NextResponse } from "next/server"
import {
  enqueueEvaluationJob,
  popJobToProcessing,
  readJob,
  recoverAbandonedProcessingJobs,
  setEvaluationRedisForTests,
  writeJob,
} from "@/app/api/evaluate/jobStore"
import { runEvaluationJobOnce } from "@/app/lib/evaluation-job-runner"
import {
  memoryInsertEvaluationIdempotent,
  peekEvaluationJobPersistIdentity,
  runWithEvaluationJobPersistIdentity,
} from "@/app/lib/persist-evaluation"

/** Redis in-memory mínimo (subset ioredis usado por jobStore). */
class FakeRedis {
  private strings = new Map<string, { value: string; expiresAt?: number }>()
  private lists = new Map<string, string[]>()
  status = "ready"

  private alive(key: string): string | null {
    const e = this.strings.get(key)
    if (!e) return null
    if (e.expiresAt != null && Date.now() >= e.expiresAt) {
      this.strings.delete(key)
      return null
    }
    return e.value
  }

  async ping(): Promise<string> {
    return "PONG"
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key)
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<"OK" | null> {
    let nx = false
    let ex: number | undefined
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase()
      if (a === "NX") nx = true
      if (a === "EX") {
        ex = Number(args[i + 1])
        i++
      }
    }
    if (nx && this.alive(key) != null) return null
    this.strings.set(key, {
      value,
      expiresAt: ex != null ? Date.now() + ex * 1000 : undefined,
    })
    return "OK"
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0
    for (const k of keys) {
      if (this.strings.delete(k) || this.lists.delete(k)) n++
    }
    return n
  }

  async expire(key: string, seconds: number): Promise<number> {
    const v = this.alive(key)
    if (v == null) return 0
    this.strings.set(key, { value: v, expiresAt: Date.now() + seconds * 1000 })
    return 1
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? []
    for (const v of values) list.unshift(v)
    this.lists.set(key, list)
    return list.length
  }

  async lrem(key: string, _count: number, value: string): Promise<number> {
    const list = this.lists.get(key) ?? []
    const next = list.filter((x) => x !== value)
    const removed = list.length - next.length
    this.lists.set(key, next)
    return removed
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? []
    const end = stop < 0 ? list.length + stop + 1 : stop + 1
    return list.slice(start, end)
  }

  async brpoplpush(src: string, dst: string, _timeout: number): Promise<string | null> {
    const list = this.lists.get(src) ?? []
    if (list.length === 0) return null
    const v = list.pop()!
    this.lists.set(src, list)
    const d = this.lists.get(dst) ?? []
    d.unshift(v)
    this.lists.set(dst, d)
    return v
  }

  pipeline() {
    const self = this
    const ops: Array<() => Promise<unknown>> = []
    const api = {
      set(key: string, value: string, ...args: Array<string | number>) {
        ops.push(() => self.set(key, value, ...args))
        return api
      },
      lpush(key: string, ...values: string[]) {
        ops.push(() => self.lpush(key, ...values))
        return api
      },
      async exec() {
        const out = []
        for (const op of ops) out.push([null, await op()])
        return out
      },
    }
    return api
  }
}

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

async function drainProcessing(): Promise<void> {
  while (await popJobToProcessing(0)) {
    /* drain */
  }
}

test("TEST4: crash post-persist/pre-completed + recovery → 1 evaluación, sin re-execute", async () => {
  const fake = new FakeRedis()
  setEvaluationRedisForTests(fake as unknown as import("ioredis").default)
  try {
    await drainProcessing()
    const { keyQueue, keyProcessing } = await import("@/app/lib/evaluation-job-contract")
    const owner = `owner-${crypto.randomUUID()}`
    const clientRequestId = crypto.randomUUID()
    const evalStore = new Map<string, { id: string; status: string }>()
    let executeCount = 0

    const { job } = await enqueueEvaluationJob({
      ownerUserId: owner,
      clientRequestId,
      payload: { student: "A" },
    })
    await popJobToProcessing(1)

    // RUN 1: persist OK (runner completa; luego forzamos ventana P0)
    const outcome1 = await runEvaluationJobOnce({
      jobId: job.job_id,
      workerId: "w-crash-1",
      executeFn: async () => {
        executeCount++
        const identity = peekEvaluationJobPersistIdentity()
        assert.equal(identity, job.job_id)
        memoryInsertEvaluationIdempotent(evalStore, job.job_id)
        return NextResponse.json(
          { success: true, evaluation_id: job.job_id, nota: 6.0 },
          { status: 200 },
        )
      },
    })
    assert.equal(outcome1.ok, true)
    assert.equal(evalStore.size, 1)

    // Forzar estado crash: processing + evaluation_id checkpoint, sin completed
    const storedAfter = await readJob(job.job_id)
    assert.ok(storedAfter)
    await writeJob({
      ...storedAfter!,
      status: "processing",
      evaluation_id: job.job_id,
      result: undefined,
      completed_at: undefined,
    })
    await fake.lpush(keyProcessing(), job.job_id)
    const recovered = await recoverAbandonedProcessingJobs({ staleAfterMs: 0 })
    assert.ok(recovered.includes(job.job_id))
    await popJobToProcessing(1)

    const outcome2 = await runEvaluationJobOnce({
      jobId: job.job_id,
      workerId: "w-crash-2",
      executeFn: async () => {
        executeCount++
        memoryInsertEvaluationIdempotent(evalStore, job.job_id)
        return NextResponse.json({ success: true, evaluation_id: job.job_id }, { status: 200 })
      },
    })
    assert.equal(outcome2.ok, true)
    // Reconcile: no debe re-ejecutar motor
    assert.equal(executeCount, 1)
    assert.equal(evalStore.size, 1)
    const finalJob = await readJob(job.job_id)
    assert.equal(finalJob?.status, "completed")
    assert.equal(finalJob?.evaluation_id, job.job_id)
    void keyQueue
  } finally {
    setEvaluationRedisForTests(undefined)
  }
})

test("mismo job 2 ejecuciones reales (sin checkpoint previo) → persist idempotente por job_id", async () => {
  const fake = new FakeRedis()
  setEvaluationRedisForTests(fake as unknown as import("ioredis").default)
  try {
    await drainProcessing()
    const owner = `owner-${crypto.randomUUID()}`
    const clientRequestId = crypto.randomUUID()
    const evalStore = new Map<string, { id: string; status: string }>()
    let executeCount = 0

    const { job } = await enqueueEvaluationJob({
      ownerUserId: owner,
      clientRequestId,
      payload: { x: 1 },
    })
    await popJobToProcessing(1)

    const run = async (workerId: string) =>
      runEvaluationJobOnce({
        jobId: job.job_id,
        workerId,
        executeFn: async () => {
          executeCount++
          assert.equal(peekEvaluationJobPersistIdentity(), job.job_id)
          memoryInsertEvaluationIdempotent(evalStore, job.job_id)
          return NextResponse.json(
            { success: true, evaluation_id: job.job_id, nota: 5 },
            { status: 200 },
          )
        },
      })

    const o1 = await run("w1")
    assert.equal(o1.ok, true)
    assert.equal(evalStore.size, 1)

    // Simula redelivery sin checkpoint: pending, sin evaluation_id, payload aún vivo
    const done = await readJob(job.job_id)
    assert.ok(done)
    const { keyQueue, keyPayload, PAYLOAD_TTL_SECONDS } = await import(
      "@/app/lib/evaluation-job-contract"
    )
    await writeJob({
      ...done!,
      status: "pending",
      evaluation_id: undefined,
      result: undefined,
      completed_at: undefined,
    })
    await fake.set(keyPayload(job.job_id), JSON.stringify({ x: 1 }), "EX", PAYLOAD_TTL_SECONDS)
    await fake.lpush(keyQueue(), job.job_id)
    await popJobToProcessing(1)

    const o2 = await run("w2")
    assert.equal(o2.ok, true)
    assert.equal(executeCount, 2)
    assert.equal(evalStore.size, 1)
    assert.equal((await readJob(job.job_id))?.evaluation_id, job.job_id)
  } finally {
    setEvaluationRedisForTests(undefined)
  }
})

test("ALS propaga job_id durante executeFn", async () => {
  const jobId = crypto.randomUUID()
  let seen: string | null = null
  await runWithEvaluationJobPersistIdentity(jobId, async () => {
    seen = peekEvaluationJobPersistIdentity()
  })
  assert.equal(seen, jobId)
})

test("jobs distintos no colisionan en store de evaluaciones", async () => {
  const fake = new FakeRedis()
  setEvaluationRedisForTests(fake as unknown as import("ioredis").default)
  try {
    await drainProcessing()
    const evalStore = new Map<string, { id: string; status: string }>()
    const owner = `owner-${crypto.randomUUID()}`
    const jobs = []
    for (let i = 0; i < 2; i++) {
      const { job } = await enqueueEvaluationJob({
        ownerUserId: owner,
        clientRequestId: crypto.randomUUID(),
        payload: { i },
      })
      jobs.push(job)
      await popJobToProcessing(1)
      const out = await runEvaluationJobOnce({
        jobId: job.job_id,
        workerId: `w-${i}`,
        executeFn: async () => {
          memoryInsertEvaluationIdempotent(evalStore, job.job_id)
          return NextResponse.json({ success: true, evaluation_id: job.job_id }, { status: 200 })
        },
      })
      assert.equal(out.ok, true)
    }
    assert.equal(evalStore.size, 2)
    assert.notEqual(jobs[0].job_id, jobs[1].job_id)
  } finally {
    setEvaluationRedisForTests(undefined)
  }
})

test("path normal completed: segunda llamada short-circuit completed sin re-execute", async () => {
  const fake = new FakeRedis()
  setEvaluationRedisForTests(fake as unknown as import("ioredis").default)
  try {
    await drainProcessing()
    let runs = 0
    const owner = `owner-${crypto.randomUUID()}`
    const { job } = await enqueueEvaluationJob({
      ownerUserId: owner,
      clientRequestId: crypto.randomUUID(),
      payload: { ok: true },
    })
    await popJobToProcessing(1)
    const body = { success: true, evaluation_id: job.job_id, nota: 7 }
    const o1 = await runEvaluationJobOnce({
      jobId: job.job_id,
      workerId: "n1",
      executeFn: async () => {
        runs++
        return NextResponse.json(body, { status: 201 })
      },
    })
    assert.equal(o1.ok, true)
    // Re-poner en processing artificialmente; status completed → short-circuit
    const { keyProcessing } = await import("@/app/lib/evaluation-job-contract")
    await fake.lpush(keyProcessing(), job.job_id)
    const o2 = await runEvaluationJobOnce({
      jobId: job.job_id,
      workerId: "n2",
      executeFn: async () => {
        runs++
        return NextResponse.json(body, { status: 201 })
      },
    })
    assert.equal(o2.ok, true)
    assert.equal(runs, 1)
  } finally {
    setEvaluationRedisForTests(undefined)
  }
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
  console.log(`\nSCALE-B0 runner idempotency: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
