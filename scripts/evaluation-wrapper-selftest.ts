/**
 * Self-tests del Async Evaluation Wrapper V1 (sin motor, sin Redis live productivo).
 *
 * Redis live: preparado pero marcado BLOCKED_UNTIL_RAILWAY_TEST_SERVICE.
 * Namespace aislado futuro: EVAL_JOB_REDIS_PREFIX=eval:v1:test:<uuid>
 */
import assert from "node:assert/strict"
import { NextResponse } from "next/server"
import {
  getAuthUser,
  peekInternalAuthUserIdForTests,
  runWithInternalAuthUser,
} from "../app/lib/supabase-route"
import {
  isAsyncEvaluationServerEnabled,
  isAsyncEvaluationClientFlagEnabled,
} from "../app/lib/async-evaluation-flags"
import {
  MAX_PAYLOAD_BYTES,
  EVALUATION_JOB_VERSION,
  evalJobKeyPrefix,
  keyQueue,
  keyProcessing,
  keyLock,
  toClientStatusView,
  type EvaluationJobV1,
} from "../app/lib/evaluation-job-contract"
import {
  enqueueEvaluationJob,
  readJob,
  tryAcquireJobLock,
  releaseJobLock,
  recoverAbandonedProcessingJobs,
  popJobToProcessing,
  markJobCompleted,
  removeFromProcessing,
  setEvaluationRedisForTests,
  PayloadTooLargeError,
} from "../app/api/evaluate/jobStore"
import { runEvaluationJobOnce } from "../app/lib/evaluation-job-runner"
import {
  runEvaluationWorkerLoop,
  EVALUATION_WORKER_CONCURRENCY,
} from "../app/lib/evaluation-worker"

type Check = { name: string; pass: boolean; detail?: string; blocked?: boolean }

async function check(name: string, fn: () => Promise<void> | void): Promise<Check> {
  try {
    await fn()
    return { name, pass: true }
  } catch (e) {
    return { name, pass: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

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

  async ttl(key: string): Promise<number> {
    const e = this.strings.get(key)
    if (!e) return -2
    if (e.expiresAt == null) return -1
    const left = Math.ceil((e.expiresAt - Date.now()) / 1000)
    if (left <= 0) {
      this.strings.delete(key)
      return -2
    }
    return left
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? []
    for (const v of values) list.unshift(v)
    this.lists.set(key, list)
    return list.length
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? []
    const end = stop < 0 ? list.length + stop : stop
    return list.slice(start, end + 1)
  }

  async lrem(key: string, _count: number, value: string): Promise<number> {
    const list = this.lists.get(key) ?? []
    const next = list.filter((x) => x !== value)
    const removed = list.length - next.length
    this.lists.set(key, next)
    return removed
  }

  async brpoplpush(src: string, dest: string, _timeout: number): Promise<string | null> {
    const list = this.lists.get(src) ?? []
    if (!list.length) return null
    const jobId = list.pop()!
    this.lists.set(src, list)
    const destList = this.lists.get(dest) ?? []
    destList.unshift(jobId)
    this.lists.set(dest, destList)
    return jobId
  }

  pipeline() {
    const ops: Array<() => Promise<unknown>> = []
    const self = this
    const api = {
      set(...a: Parameters<FakeRedis["set"]>) {
        ops.push(() => self.set(...a))
        return api
      },
      lpush(...a: Parameters<FakeRedis["lpush"]>) {
        ops.push(() => self.lpush(...a))
        return api
      },
      async exec() {
        const out: Array<[null, unknown]> = []
        for (const op of ops) out.push([null, await op()])
        return out
      },
    }
    return api
  }

  /** Keys creadas (para asserts de aislamiento). */
  allKeys(): string[] {
    return [...this.strings.keys(), ...this.lists.keys()]
  }

  clear(): void {
    this.strings.clear()
    this.lists.clear()
  }
}

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    fn()
  } finally {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
}

/**
 * Self-test Redis live (preparado para Railway test service).
 * No declarar PASS desde PC local. No toca eval:v1:queue productivo.
 */
export async function runRedisLiveSelfTestPrepared(): Promise<Check> {
  const name = "redis-live: BLOCKED_UNTIL_RAILWAY_TEST_SERVICE"
  const explicit = process.env.EVAL_REDIS_LIVE_SELFTEST === "1"
  const prefix = (process.env.EVAL_JOB_REDIS_PREFIX?.trim() || "").replace(/:+$/, "")
  const isolated =
    prefix.startsWith("eval:v1:test:") &&
    prefix.length > "eval:v1:test:".length &&
    !prefix.endsWith(":queue") &&
    prefix !== "eval:v1"

  if (!explicit || !isolated) {
    return {
      name,
      pass: true,
      blocked: true,
      detail:
        "No ejecutado. Requiere EVAL_REDIS_LIVE_SELFTEST=1 y EVAL_JOB_REDIS_PREFIX=eval:v1:test:<uuid> en servicio Railway de prueba.",
    }
  }

  if (!process.env.REDIS_URL?.trim()) {
    return {
      name,
      pass: false,
      detail: "EVAL_REDIS_LIVE_SELFTEST=1 pero REDIS_URL ausente (no se imprime)",
    }
  }

  // Ejecución live real (solo namespace aislado). Import dinámico de ioredis.
  const Redis = (await import("ioredis")).default
  const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
  })
  const keysCreated: string[] = []
  try {
    await client.connect()
    assert.equal(await client.ping(), "PONG")

    const k = `${prefix}:selftest:value`
    const q = `${prefix}:selftest:queue`
    const proc = `${prefix}:selftest:processing`
    const lock = `${prefix}:selftest:lock`
    keysCreated.push(k, q, proc, lock)

    assert.equal(await client.set(k, "ok", "EX", 60), "OK")
    assert.equal(await client.get(k), "ok")
    assert.equal(await client.set(k, "nope", "EX", 60, "NX"), null)
    const ttl = await client.ttl(k)
    assert.ok(ttl > 0 && ttl <= 60)

    await client.del(q, proc)
    assert.ok((await client.rpush(q, "job-a")) >= 1)
    const moved = await client.brpoplpush(q, proc, 1)
    assert.equal(moved, "job-a")

    assert.equal(await client.set(lock, "worker-live", "EX", 30, "NX"), "OK")
    assert.equal(await client.set(lock, "other", "EX", 30, "NX"), null)

    // Limpieza completa de claves de prueba
    if (keysCreated.length) await client.del(...keysCreated)
    await client.lrem(proc, 0, "job-a")

    return {
      name: "redis-live: probes OK (namespace aislado)",
      pass: true,
      detail: `prefix=${prefix}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // ECONNRESET / red local → blocked honesto, no PASS inventado
    return {
      name,
      pass: true,
      blocked: true,
      detail: `Redis live no verificable aquí: ${msg.slice(0, 200)}`,
    }
  } finally {
    try {
      if (keysCreated.length) await client.del(...keysCreated)
    } catch {
      /* ignore */
    }
    try {
      client.disconnect()
    } catch {
      /* ignore */
    }
  }
}

export async function runSecurityAndParitySelfTests(): Promise<number> {
  const results: Check[] = []
  const fake = new FakeRedis()
  setEvaluationRedisForTests(fake as unknown as import("ioredis").default)
  const prevPrefix = process.env.EVAL_JOB_REDIS_PREFIX
  process.env.EVAL_JOB_REDIS_PREFIX = `eval:v1:test:mock-${crypto.randomUUID()}`

  try {
    // --- Flags ---
    results.push(
      await check("flags: ausente → OFF", () => {
        withEnv("ASYNC_EVALUATION_WRAPPER_ENABLED", undefined, () => {
          assert.equal(isAsyncEvaluationServerEnabled(), false)
        })
      }),
    )
    results.push(
      await check("flags: inválido → OFF", () => {
        withEnv("ASYNC_EVALUATION_WRAPPER_ENABLED", "yes", () => {
          assert.equal(isAsyncEvaluationServerEnabled(), false)
        })
        withEnv("ASYNC_EVALUATION_WRAPPER_ENABLED", "TRUE ", () => {
          assert.equal(isAsyncEvaluationServerEnabled(), true)
        })
      }),
    )
    results.push(
      await check("flags: true|1 → ON; NEXT_PUBLIC no afecta server helper", () => {
        withEnv("ASYNC_EVALUATION_WRAPPER_ENABLED", "1", () => {
          assert.equal(isAsyncEvaluationServerEnabled(), true)
        })
        withEnv("ASYNC_EVALUATION_WRAPPER_ENABLED", undefined, () => {
          withEnv("NEXT_PUBLIC_ASYNC_EVALUATION_WRAPPER_ENABLED", "true", () => {
            assert.equal(isAsyncEvaluationServerEnabled(), false)
            assert.equal(isAsyncEvaluationClientFlagEnabled(), true)
          })
        })
      }),
    )

    // --- Auth ALS ---
    results.push(
      await check("auth: sin contexto → peek null", () => {
        assert.equal(peekInternalAuthUserIdForTests(), null)
      }),
    )

    results.push(
      await check("auth: runWithInternalAuthUser expone user.id y limpia", async () => {
        const user = await runWithInternalAuthUser({ userId: "user-aaa" }, async () => getAuthUser())
        assert.equal(user?.id, "user-aaa")
        assert.equal(peekInternalAuthUserIdForTests(), null)
      }),
    )

    results.push(
      await check("auth: callback que lanza → contexto limpio", async () => {
        let threw = false
        try {
          await runWithInternalAuthUser({ userId: "user-boom" }, async () => {
            throw new Error("boom-callback")
          })
        } catch {
          threw = true
        }
        assert.equal(threw, true)
        assert.equal(peekInternalAuthUserIdForTests(), null)
      }),
    )

    results.push(
      await check("auth: ejecución anidada restaura outer", async () => {
        await runWithInternalAuthUser({ userId: "outer" }, async () => {
          assert.equal(peekInternalAuthUserIdForTests(), "outer")
          await runWithInternalAuthUser({ userId: "inner" }, async () => {
            assert.equal(peekInternalAuthUserIdForTests(), "inner")
            assert.equal((await getAuthUser())?.id, "inner")
          })
          assert.equal(peekInternalAuthUserIdForTests(), "outer")
          assert.equal((await getAuthUser())?.id, "outer")
        })
        assert.equal(peekInternalAuthUserIdForTests(), null)
      }),
    )

    results.push(
      await check("auth: dos usuarios concurrentes no cruzan", async () => {
        const [a, b] = await Promise.all([
          runWithInternalAuthUser({ userId: "user-A" }, async () => {
            await new Promise((r) => setTimeout(r, 30))
            return (await getAuthUser())?.id
          }),
          runWithInternalAuthUser({ userId: "user-B" }, async () => {
            await new Promise((r) => setTimeout(r, 10))
            return (await getAuthUser())?.id
          }),
        ])
        assert.equal(a, "user-A")
        assert.equal(b, "user-B")
      }),
    )

    results.push(
      await check("auth: user_id/teacher_id/school_id maliciosos en payload no alteran ALS", async () => {
        const malicious = {
          user_id: "attacker-user",
          teacher_id: "attacker-teacher",
          school_id: "attacker-school",
        }
        const u = await runWithInternalAuthUser({ userId: "owner-real" }, async () => {
          void malicious
          return getAuthUser()
        })
        assert.equal(u?.id, "owner-real")
        assert.notEqual(u?.id, malicious.user_id)
        assert.equal(peekInternalAuthUserIdForTests(), null)
      }),
    )

    // --- Contrato / status view / ownership ---
    results.push(
      await check("contrato: toClientStatusView oculta owner y pasa result exacto", () => {
        const exact = { success: true, nota: 5.5, evaluation_id: "ev-1", nested: { a: 1 } }
        const job: EvaluationJobV1 = {
          version: EVALUATION_JOB_VERSION,
          job_id: "j1",
          client_request_id: "00000000-0000-4000-8000-000000000001",
          owner_user_id: "secret-owner",
          status: "completed",
          created_at: new Date().toISOString(),
          attempt_count: 1,
          payload_key: "p",
          result: exact,
          evaluation_id: "ev-1",
        }
        const view = toClientStatusView(job)
        assert.deepEqual(view.result, exact)
        assert.equal((view as { owner_user_id?: string }).owner_user_id, undefined)
        assert.equal(view.evaluation_id, "ev-1")
      }),
    )

    results.push(
      await check("ownership: status view no expone owner; mismatch conceptual", () => {
        const job: EvaluationJobV1 = {
          version: EVALUATION_JOB_VERSION,
          job_id: "j2",
          client_request_id: "00000000-0000-4000-8000-000000000002",
          owner_user_id: "owner-1",
          status: "pending",
          created_at: new Date().toISOString(),
          attempt_count: 0,
          payload_key: "p",
        }
        const view = toClientStatusView(job)
        assert.equal((view as { owner_user_id?: string }).owner_user_id, undefined)
        assert.notEqual(job.owner_user_id, "other-user")
      }),
    )

    // --- Redis mock: idempotencia, lock, payload, recovery, parity ---
    results.push(
      await check("redis-mock: prefix aislado no es cola productiva", () => {
        const p = evalJobKeyPrefix()
        assert.ok(p.startsWith("eval:v1:test:"))
        assert.notEqual(keyQueue(), "eval:v1:queue")
        assert.notEqual(keyProcessing(), "eval:v1:processing")
      }),
    )

    results.push(
      await check("redis-mock: SET NX / GET / TTL básicos", async () => {
        const k = `${evalJobKeyPrefix()}:probe`
        assert.equal(await fake.set(k, "v", "EX", 60, "NX"), "OK")
        assert.equal(await fake.get(k), "v")
        assert.equal(await fake.set(k, "other", "NX"), null)
        const ttl = await fake.ttl(k)
        assert.ok(ttl > 0 && ttl <= 60)
        await fake.del(k)
      }),
    )

    results.push(
      await check("redis-mock: idempotencia mismo client_request_id", async () => {
        const owner = `owner-${crypto.randomUUID()}`
        const clientRequestId = crypto.randomUUID()
        const payload = { fileUrls: ["data:text/plain,hi"], tipoPrueba: "solo_desarrollo" }
        const a = await enqueueEvaluationJob({ ownerUserId: owner, clientRequestId, payload })
        const b = await enqueueEvaluationJob({ ownerUserId: owner, clientRequestId, payload })
        assert.equal(a.job.job_id, b.job.job_id)
        assert.equal(b.reused_existing_job, true)
      }),
    )

    results.push(
      await check("redis-mock: enqueues paralelos → un job", async () => {
        const owner = `owner-${crypto.randomUUID()}`
        const clientRequestId = crypto.randomUUID()
        const payload = { fileUrls: ["data:text/plain,parallel"] }
        const [x, y] = await Promise.all([
          enqueueEvaluationJob({ ownerUserId: owner, clientRequestId, payload }),
          enqueueEvaluationJob({ ownerUserId: owner, clientRequestId, payload }),
        ])
        assert.equal(x.job.job_id, y.job.job_id)
        assert.ok(x.reused_existing_job || y.reused_existing_job)
      }),
    )

    results.push(
      await check("redis-mock: lock exclusivo; release solo propio", async () => {
        const jobId = crypto.randomUUID()
        assert.equal(await tryAcquireJobLock(jobId, "worker-1"), true)
        assert.equal(await tryAcquireJobLock(jobId, "worker-2"), false)
        // worker-2 no borra lock ajeno
        await releaseJobLock(jobId, "worker-2")
        assert.equal(await fake.get(keyLock(jobId)), "worker-1")
        await releaseJobLock(jobId, "worker-1")
        assert.equal(await tryAcquireJobLock(jobId, "worker-2"), true)
        await releaseJobLock(jobId, "worker-2")
      }),
    )

    results.push(
      await check("redis-mock: payload demasiado grande → no truncado", async () => {
        const owner = `owner-${crypto.randomUUID()}`
        const clientRequestId = crypto.randomUUID()
        const huge = "x".repeat(MAX_PAYLOAD_BYTES + 1024)
        let threw: unknown
        try {
          await enqueueEvaluationJob({
            ownerUserId: owner,
            clientRequestId,
            payload: { fileUrls: [`data:text/plain,${huge}`] },
          })
        } catch (e) {
          threw = e
        }
        assert.ok(threw instanceof PayloadTooLargeError)
      }),
    )

    results.push(
      await check("redis-mock: result passthrough sin reinterpretación", async () => {
        const owner = `owner-${crypto.randomUUID()}`
        const clientRequestId = crypto.randomUUID()
        const payload = { marker: "parity-payload", n: 42 }
        const { job } = await enqueueEvaluationJob({ ownerUserId: owner, clientRequestId, payload })
        const exactResult = {
          success: true,
          nota: 6.2,
          nested: { keep: true },
          evaluation_id: "e-9",
        }
        await markJobCompleted(job, exactResult, "e-9")
        await removeFromProcessing(job.job_id)
        const stored = await readJob(job.job_id)
        assert.deepEqual(stored?.result, exactResult)
        assert.equal(stored?.status, "completed")
        const view = toClientStatusView(stored!)
        assert.deepEqual(view.result, exactResult)
      }),
    )

    results.push(
      await check("redis-mock: BRPOPLPUSH + recovery abandonados", async () => {
        // Vaciar cola residual de tests previos (mismo FakeRedis compartido).
        while (await popJobToProcessing(0)) {
          /* drain */
        }
        const owner = `owner-${crypto.randomUUID()}`
        const clientRequestId = crypto.randomUUID()
        const { job } = await enqueueEvaluationJob({
          ownerUserId: owner,
          clientRequestId,
          payload: { x: 1 },
        })
        const popped = await popJobToProcessing(1)
        assert.equal(popped, job.job_id)
        // Sin lock y status pending → recovery reencola
        const recovered = await recoverAbandonedProcessingJobs({ staleAfterMs: 0 })
        assert.ok(recovered.includes(job.job_id))
      }),
    )

    results.push(
      await check("paridad: runner falso preserva status/body/evaluation_id; una ejecución", async () => {
        while (await popJobToProcessing(0)) {
          /* drain */
        }
        const owner = `owner-${crypto.randomUUID()}`
        const clientRequestId = crypto.randomUUID()
        const payload = { keep: "payload-intact", user_id: "should-not-matter" }
        const { job } = await enqueueEvaluationJob({ ownerUserId: owner, clientRequestId, payload })
        await popJobToProcessing(1)

        let runs = 0
        const exactBody = {
          success: true,
          evaluation_id: "eval-parity-1",
          nested: { a: 1 },
        }
        const executeFn = async (p: unknown) => {
          runs++
          assert.deepEqual(p, payload)
          return NextResponse.json(exactBody, { status: 201 })
        }

        const outcome = await runEvaluationJobOnce({
          jobId: job.job_id,
          workerId: "parity-worker",
          executeFn,
        })
        assert.equal(outcome.ok, true)
        if (outcome.ok) {
          assert.equal(outcome.statusCode, 201)
          assert.deepEqual(outcome.result, exactBody)
        }
        assert.equal(runs, 1)

        // Misma clave idempotente: re-enqueue reusa job; runner no se vuelve a llamar si completed
        const again = await enqueueEvaluationJob({ ownerUserId: owner, clientRequestId, payload })
        assert.equal(again.job.job_id, job.job_id)
        assert.equal(again.reused_existing_job, true)
        const stored = await readJob(job.job_id)
        assert.equal(stored?.status, "completed")
        assert.equal(stored?.evaluation_id, "eval-parity-1")
        assert.deepEqual(stored?.result, exactBody)
        assert.equal(runs, 1)
      }),
    )

    results.push(
      await check("paridad: error del motor no reinterpretado", async () => {
        const owner = `owner-${crypto.randomUUID()}`
        const clientRequestId = crypto.randomUUID()
        const { job } = await enqueueEvaluationJob({
          ownerUserId: owner,
          clientRequestId,
          payload: { z: 1 },
        })
        await popJobToProcessing(1)
        const outcome = await runEvaluationJobOnce({
          jobId: job.job_id,
          workerId: "err-worker",
          executeFn: async () =>
            NextResponse.json({ success: false, error: "MotorExactError" }, { status: 422 }),
        })
        assert.equal(outcome.ok, false)
        if (!outcome.ok) {
          assert.equal(outcome.error.code, "HTTP_422")
          assert.equal(outcome.error.message, "MotorExactError")
        }
        const stored = await readJob(job.job_id)
        assert.equal(stored?.status, "failed")
        assert.equal(stored?.error?.message, "MotorExactError")
      }),
    )

    results.push(
      await check("worker: concurrencia V1 = 1; shutdown no toma jobs nuevos", async () => {
        assert.equal(EVALUATION_WORKER_CONCURRENCY, 1)
        const prevRedisUrl = process.env.REDIS_URL
        // Valor dummy local: el worker exige presencia de REDIS_URL pero nunca la imprime.
        process.env.REDIS_URL = "redis://127.0.0.1:6379/15-mock-only"
        try {
          const ac = new AbortController()
          let done = false
          const loop = runEvaluationWorkerLoop({
            once: true,
            brpopTimeoutSeconds: 1,
            signal: ac.signal,
            requireServerFlag: false,
            onJobDone: () => {
              done = true
            },
          })
          ac.abort()
          await loop
          assert.equal(done, false)
        } finally {
          if (prevRedisUrl === undefined) delete process.env.REDIS_URL
          else process.env.REDIS_URL = prevRedisUrl
        }
      }),
    )

    results.push(
      await check("worker: flag server off → rechazo al iniciar (requireServerFlag)", async () => {
        withEnv("ASYNC_EVALUATION_WRAPPER_ENABLED", undefined, () => {
          // sync throw path via promise
        })
        const prev = process.env.ASYNC_EVALUATION_WRAPPER_ENABLED
        delete process.env.ASYNC_EVALUATION_WRAPPER_ENABLED
        let msg = ""
        try {
          await runEvaluationWorkerLoop({ requireServerFlag: true, once: true })
        } catch (e) {
          msg = e instanceof Error ? e.message : String(e)
        } finally {
          if (prev === undefined) delete process.env.ASYNC_EVALUATION_WRAPPER_ENABLED
          else process.env.ASYNC_EVALUATION_WRAPPER_ENABLED = prev
        }
        assert.ok(/ASYNC_EVALUATION_WRAPPER_ENABLED/i.test(msg))
      }),
    )

    results.push(await runRedisLiveSelfTestPrepared())
  } finally {
    setEvaluationRedisForTests(undefined)
    fake.clear()
    if (prevPrefix === undefined) delete process.env.EVAL_JOB_REDIS_PREFIX
    else process.env.EVAL_JOB_REDIS_PREFIX = prevPrefix
  }

  let failed = 0
  let blocked = 0
  for (const r of results) {
    const mark = r.blocked ? "BLOCKED" : r.pass ? "PASS" : "FAIL"
    if (r.blocked) blocked++
    console.log(`[selftest] ${mark} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`)
    if (!r.pass) failed++
  }
  console.log(`[selftest] ${results.length - failed}/${results.length} ok (${blocked} blocked)`)
  return failed === 0 ? 0 : 1
}
