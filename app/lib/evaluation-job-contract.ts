/**
 * Contrato durable Evaluation Job V1 (Redis).
 * No incluye cookies, JWT, service-role, secrets ni stack traces.
 */

export const EVALUATION_JOB_VERSION = "evaluation-job-v1" as const

export type EvaluationJobStatus = "pending" | "processing" | "completed" | "failed"

export type EvaluationJobError = {
  code: string
  message: string
  retryable: boolean
}

export type EvaluationJobV1 = {
  version: typeof EVALUATION_JOB_VERSION
  job_id: string
  client_request_id: string
  owner_user_id: string
  status: EvaluationJobStatus
  created_at: string
  started_at?: string
  completed_at?: string
  failed_at?: string
  attempt_count: number
  payload_key: string
  evaluation_id?: string
  result?: unknown
  error?: EvaluationJobError
}

/** Prefijo versionado. Override con EVAL_JOB_REDIS_PREFIX para tests (nunca producción). */
export function evalJobKeyPrefix(): string {
  const override = process.env.EVAL_JOB_REDIS_PREFIX?.trim()
  if (override) return override.replace(/:+$/, "")
  return "eval:v1"
}

export function keyReq(ownerUserId: string, clientRequestId: string): string {
  return `${evalJobKeyPrefix()}:req:${ownerUserId}:${clientRequestId}`
}

export function keyJob(jobId: string): string {
  return `${evalJobKeyPrefix()}:job:${jobId}`
}

export function keyPayload(jobId: string): string {
  return `${evalJobKeyPrefix()}:payload:${jobId}`
}

export function keyLock(jobId: string): string {
  return `${evalJobKeyPrefix()}:lock:${jobId}`
}

export function keyQueue(): string {
  return `${evalJobKeyPrefix()}:queue`
}

export function keyProcessing(): string {
  return `${evalJobKeyPrefix()}:processing`
}

/** TTL job + idempotencia (24h). */
export const JOB_TTL_SECONDS = 60 * 60 * 24

/** TTL payload (6h); se borra al completar/fallar. */
export const PAYLOAD_TTL_SECONDS = 60 * 60 * 6

/** Lease del lock de ejecución. */
export const LOCK_TTL_SECONDS = 60 * 15

/**
 * Límite de tamaño del payload en Redis (bytes UTF-8 del JSON).
 * Redis admite hasta ~512MB por valor; aquí se corta antes por seguridad operativa.
 * Si se excede: NO truncar ni bajar calidad — error técnico y diseño de storage alternativo.
 */
export const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim())
}

export function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf8")
}

/** Respuesta cliente de /status (sin payload ni owner_user_id). */
export type EvaluationJobStatusClientView = {
  success: boolean
  job_id: string
  client_request_id: string
  status: EvaluationJobStatus
  created_at: string
  started_at?: string
  completed_at?: string
  failed_at?: string
  attempt_count: number
  evaluation_id?: string
  result?: unknown
  error?: EvaluationJobError
  progress?: number
}

export function toClientStatusView(job: EvaluationJobV1): EvaluationJobStatusClientView {
  const view: EvaluationJobStatusClientView = {
    success: true,
    job_id: job.job_id,
    client_request_id: job.client_request_id,
    status: job.status,
    created_at: job.created_at,
    attempt_count: job.attempt_count,
  }
  if (job.started_at) view.started_at = job.started_at
  if (job.completed_at) view.completed_at = job.completed_at
  if (job.failed_at) view.failed_at = job.failed_at
  if (job.evaluation_id) view.evaluation_id = job.evaluation_id
  if (job.status === "completed" && job.result !== undefined) view.result = job.result
  if (job.status === "failed" && job.error) view.error = job.error
  if (job.status === "pending") view.progress = 5
  if (job.status === "processing") view.progress = 55
  if (job.status === "completed") view.progress = 100
  if (job.status === "failed") view.progress = 100
  return view
}

export function extractEvaluationIdFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  const id = (result as { evaluation_id?: unknown }).evaluation_id
  return typeof id === "string" && id.trim() ? id.trim() : undefined
}

export function safeErrorMessage(err: unknown, fallback = "Error técnico en evaluación asíncrona"): string {
  if (err instanceof Error && err.message) {
    const msg = err.message.replace(/\s+/g, " ").trim().slice(0, 400)
    // No filtrar HTML/stack largos
    if (/<html|traceback|at\s+\S+\s+\(/i.test(msg)) return fallback
    return msg
  }
  return fallback
}
