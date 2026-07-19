/**
 * Job store durable Redis para Evaluation Job V1.
 * Reemplaza el Map en memoria (mocks eliminados).
 */
import type Redis from "ioredis"
import { redis as sharedRedis } from "@/app/lib/redis"
import {
  EVALUATION_JOB_VERSION,
  JOB_TTL_SECONDS,
  LOCK_TTL_SECONDS,
  MAX_PAYLOAD_BYTES,
  PAYLOAD_TTL_SECONDS,
  keyJob,
  keyLock,
  keyPayload,
  keyProcessing,
  keyQueue,
  keyReq,
  utf8ByteLength,
  type EvaluationJobV1,
  type EvaluationJobError,
} from "@/app/lib/evaluation-job-contract"

/**
 * Override solo para self-tests (Redis mock). undefined = usar sharedRedis.
 * Nunca usar en producción.
 */
let redisForTests: Redis | null | undefined = undefined

/** @internal — self-tests únicamente. Pasar undefined para restaurar. */
export function setEvaluationRedisForTests(client: Redis | null | undefined): void {
  redisForTests = client
}

function activeRedis(): Redis | null {
  if (redisForTests !== undefined) return redisForTests
  return sharedRedis
}

export class RedisUnavailableError extends Error {
  constructor(message = "Redis no disponible") {
    super(message)
    this.name = "RedisUnavailableError"
  }
}

export class PayloadTooLargeError extends Error {
  readonly byteLength: number
  readonly limit: number
  constructor(byteLength: number, limit = MAX_PAYLOAD_BYTES) {
    super(
      `Payload de evaluación excede el límite Redis (${byteLength} > ${limit} bytes). No se trunca. Se requiere almacenamiento alternativo.`,
    )
    this.name = "PayloadTooLargeError"
    this.byteLength = byteLength
    this.limit = limit
  }
}

function requireRedis(): Redis {
  const r = activeRedis()
  if (!r) {
    throw new RedisUnavailableError(
      "REDIS_URL no configurada o Redis desconectado. No se puede encolar evaluación asíncrona.",
    )
  }
  return r
}

export function getEvaluationRedis(): Redis | null {
  return activeRedis()
}

export async function pingEvaluationRedis(): Promise<boolean> {
  const r = activeRedis()
  if (!r) return false
  try {
    const pong = await r.ping()
    return pong === "PONG"
  } catch {
    return false
  }
}

export async function readJob(jobId: string): Promise<EvaluationJobV1 | null> {
  const r = requireRedis()
  const raw = await r.get(keyJob(jobId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as EvaluationJobV1
  } catch {
    return null
  }
}

export async function writeJob(job: EvaluationJobV1, ttlSeconds = JOB_TTL_SECONDS): Promise<void> {
  const r = requireRedis()
  await r.set(keyJob(job.job_id), JSON.stringify(job), "EX", ttlSeconds)
}

export async function readPayload(jobId: string): Promise<unknown | null> {
  const r = requireRedis()
  const raw = await r.get(keyPayload(jobId))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function deletePayload(jobId: string): Promise<void> {
  const r = requireRedis()
  await r.del(keyPayload(jobId))
}

/**
 * Idempotencia: owner_user_id + client_request_id → job_id (SET NX).
 * Crea job + payload + encola una sola vez.
 */
export async function enqueueEvaluationJob(args: {
  ownerUserId: string
  clientRequestId: string
  payload: unknown
}): Promise<{ job: EvaluationJobV1; reused_existing_job: boolean }> {
  const r = requireRedis()
  const { ownerUserId, clientRequestId, payload } = args
  const reqKey = keyReq(ownerUserId, clientRequestId)

  const existingJobId = await r.get(reqKey)
  if (existingJobId) {
    const existing = await readJob(existingJobId)
    if (existing) {
      return { job: existing, reused_existing_job: true }
    }
    // Clave huérfana: permitir recrear
  }

  const payloadJson = JSON.stringify(payload)
  const bytes = utf8ByteLength(payloadJson)
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new PayloadTooLargeError(bytes)
  }

  const jobId = crypto.randomUUID()
  const now = new Date().toISOString()
  const job: EvaluationJobV1 = {
    version: EVALUATION_JOB_VERSION,
    job_id: jobId,
    client_request_id: clientRequestId,
    owner_user_id: ownerUserId,
    status: "pending",
    created_at: now,
    attempt_count: 0,
    payload_key: keyPayload(jobId),
  }

  // SET NX atómico para la clave de idempotencia
  const nx = await r.set(reqKey, jobId, "EX", JOB_TTL_SECONDS, "NX")
  if (nx !== "OK") {
    const winnerId = await r.get(reqKey)
    if (winnerId) {
      const winner = await readJob(winnerId)
      if (winner) return { job: winner, reused_existing_job: true }
    }
    // Carrera rara: reintentar lectura breve
    await new Promise((res) => setTimeout(res, 50))
    const againId = await r.get(reqKey)
    if (againId) {
      const again = await readJob(againId)
      if (again) return { job: again, reused_existing_job: true }
    }
    throw new Error("No se pudo resolver idempotencia de evaluación")
  }

  const pipe = r.pipeline()
  pipe.set(keyJob(jobId), JSON.stringify(job), "EX", JOB_TTL_SECONDS)
  pipe.set(keyPayload(jobId), payloadJson, "EX", PAYLOAD_TTL_SECONDS)
  pipe.lpush(keyQueue(), jobId)
  await pipe.exec()

  return { job, reused_existing_job: false }
}

export async function tryAcquireJobLock(jobId: string, workerId: string): Promise<boolean> {
  const r = requireRedis()
  const ok = await r.set(keyLock(jobId), workerId, "EX", LOCK_TTL_SECONDS, "NX")
  return ok === "OK"
}

export async function releaseJobLock(jobId: string, workerId: string): Promise<void> {
  const r = requireRedis()
  const lockKey = keyLock(jobId)
  const current = await r.get(lockKey)
  if (current === workerId) {
    await r.del(lockKey)
  }
}

export async function refreshJobLock(jobId: string, workerId: string): Promise<boolean> {
  const r = requireRedis()
  const lockKey = keyLock(jobId)
  const current = await r.get(lockKey)
  if (current !== workerId) return false
  await r.expire(lockKey, LOCK_TTL_SECONDS)
  return true
}

/** BRPOPLPUSH queue → processing (recuperable). */
export async function popJobToProcessing(timeoutSeconds = 5): Promise<string | null> {
  const r = requireRedis()
  const jobId = await r.brpoplpush(keyQueue(), keyProcessing(), timeoutSeconds)
  return typeof jobId === "string" && jobId ? jobId : null
}

export async function removeFromProcessing(jobId: string): Promise<void> {
  const r = requireRedis()
  await r.lrem(keyProcessing(), 0, jobId)
}

export async function requeueFromProcessing(jobId: string): Promise<void> {
  const r = requireRedis()
  await r.lrem(keyProcessing(), 0, jobId)
  await r.lpush(keyQueue(), jobId)
}

/**
 * Recupera jobs abandonados en processing (sin lock o lock expirado, no completed).
 * No ejecuta el motor; solo reencola.
 */
export async function recoverAbandonedProcessingJobs(opts?: {
  staleAfterMs?: number
  maxScan?: number
}): Promise<string[]> {
  const r = requireRedis()
  const staleAfterMs = opts?.staleAfterMs ?? LOCK_TTL_SECONDS * 1000
  const maxScan = opts?.maxScan ?? 50
  const list = await r.lrange(keyProcessing(), 0, maxScan - 1)
  const recovered: string[] = []

  for (const jobId of list) {
    if (!jobId) continue
    const job = await readJob(jobId)
    if (!job) {
      await r.lrem(keyProcessing(), 0, jobId)
      continue
    }
    if (job.status === "completed" || job.status === "failed") {
      await r.lrem(keyProcessing(), 0, jobId)
      continue
    }
    const lock = await r.get(keyLock(jobId))
    if (lock) continue // otro worker lo tiene

    const anchor = job.started_at || job.created_at
    const age = Date.now() - new Date(anchor).getTime()
    if (Number.isFinite(age) && age < staleAfterMs && job.status === "processing") {
      // recién tomado; dar margen
      continue
    }

    // Reencolar solo si no completed
    await requeueFromProcessing(jobId)
    recovered.push(jobId)
  }

  return recovered
}

export async function markJobProcessing(job: EvaluationJobV1): Promise<EvaluationJobV1> {
  const next: EvaluationJobV1 = {
    ...job,
    status: "processing",
    started_at: job.started_at ?? new Date().toISOString(),
    attempt_count: (job.attempt_count ?? 0) + 1,
  }
  await writeJob(next)
  return next
}

export async function markJobCompleted(
  job: EvaluationJobV1,
  result: unknown,
  evaluationId?: string,
): Promise<EvaluationJobV1> {
  const next: EvaluationJobV1 = {
    ...job,
    status: "completed",
    completed_at: new Date().toISOString(),
    result,
    evaluation_id: evaluationId,
    error: undefined,
  }
  await writeJob(next)
  await deletePayload(job.job_id)
  await removeFromProcessing(job.job_id)
  return next
}

export async function markJobFailed(
  job: EvaluationJobV1,
  error: EvaluationJobError,
): Promise<EvaluationJobV1> {
  const next: EvaluationJobV1 = {
    ...job,
    status: "failed",
    failed_at: new Date().toISOString(),
    error,
  }
  await writeJob(next)
  await deletePayload(job.job_id)
  await removeFromProcessing(job.job_id)
  return next
}

/**
 * API compatible mínima: getJobStore ya no usa Map.
 * Conservada por si algún import residual espera el nombre.
 */
export function getJobStore(): never {
  throw new Error(
    "getJobStore (Map en memoria) eliminado. Use Redis durable (enqueueEvaluationJob / readJob).",
  )
}
