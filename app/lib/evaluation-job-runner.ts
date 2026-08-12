/**
 * Orquestador mínimo: auth interno + executeEvaluatePostBody SIN modificarlo.
 * No scoring, no persistencia manual, no copia de lógica pedagógica.
 *
 * SCALE-B0: identidad de persistencia = job_id (ALS → persistEvaluation).
 * Checkpoint evaluation_id en Redis antes de markJobCompleted para reconciliar
 * crash post-persist / pre-completed sin re-ejecutar el motor.
 */
import { NextResponse } from "next/server"
import { executeEvaluatePostBody } from "@/app/api/evaluate/evaluation-logic"
import { runWithInternalAuthUser } from "@/app/lib/supabase-route"
import {
  extractEvaluationIdFromResult,
  isUuid,
  safeErrorMessage,
} from "@/app/lib/evaluation-job-contract"
import { runWithEvaluationJobPersistIdentity } from "@/app/lib/persist-evaluation"
import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
  readJob,
  readPayload,
  releaseJobLock,
  removeFromProcessing,
  tryAcquireJobLock,
  writeJob,
} from "@/app/api/evaluate/jobStore"

export type RunEvaluationJobOutcome =
  | { ok: true; jobId: string; statusCode: number; result: unknown }
  | { ok: false; jobId: string; skipped?: boolean; error: { code: string; message: string; retryable: boolean } }

export type EvaluateExecuteFn = (payload: unknown) => Promise<NextResponse>

async function nextResponseToJson(response: NextResponse): Promise<{
  ok: boolean
  status: number
  body: unknown
}> {
  const status = response.status
  const ok = response.ok
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { success: false, error: "Respuesta no JSON del motor de evaluación" }
    }
  }
  return { ok, status, body }
}

/**
 * Ejecuta un job ya en processing list.
 * Solo un worker con lock gana.
 * `executeFn` solo para self-tests de paridad (runner falso); producción usa el motor.
 */
export async function runEvaluationJobOnce(args: {
  jobId: string
  workerId: string
  ownerUserIdExpected?: string
  /** Self-test only: no llama al motor real. */
  executeFn?: EvaluateExecuteFn
}): Promise<RunEvaluationJobOutcome> {
  const { jobId, workerId, ownerUserIdExpected, executeFn } = args

  const acquired = await tryAcquireJobLock(jobId, workerId)
  if (!acquired) {
    return {
      ok: false,
      jobId,
      skipped: true,
      error: { code: "LOCK_HELD", message: "Otro worker está procesando este job", retryable: true },
    }
  }

  try {
    const job = await readJob(jobId)
    if (!job) {
      await removeFromProcessing(jobId)
      return {
        ok: false,
        jobId,
        error: { code: "JOB_NOT_FOUND", message: "Job no encontrado", retryable: false },
      }
    }

    if (job.status === "completed") {
      await removeFromProcessing(jobId)
      return { ok: true, jobId, statusCode: 200, result: job.result }
    }

    if (ownerUserIdExpected && job.owner_user_id !== ownerUserIdExpected) {
      await markJobFailed(job, {
        code: "OWNERSHIP_MISMATCH",
        message: "Ownership inválido",
        retryable: false,
      })
      return {
        ok: false,
        jobId,
        error: { code: "OWNERSHIP_MISMATCH", message: "Ownership inválido", retryable: false },
      }
    }

    // SCALE-B0: crash post-persist / pre-completed → reconciliar sin re-ejecutar motor
    if (
      job.status !== "failed" &&
      typeof job.evaluation_id === "string" &&
      isUuid(job.evaluation_id)
    ) {
      const reconciledBody =
        job.result !== undefined && job.result !== null
          ? job.result
          : { success: true, evaluation_id: job.evaluation_id, reconciled_after_persist: true }
      const processing =
        job.status === "processing" ? job : await markJobProcessing(job)
      await markJobCompleted(processing, reconciledBody, job.evaluation_id)
      return { ok: true, jobId, statusCode: 200, result: reconciledBody }
    }

    const payload = await readPayload(jobId)
    if (payload == null) {
      await markJobFailed(job, {
        code: "PAYLOAD_MISSING",
        message: "Payload expirado o ausente",
        retryable: false,
      })
      return {
        ok: false,
        jobId,
        error: { code: "PAYLOAD_MISSING", message: "Payload expirado o ausente", retryable: false },
      }
    }

    const processing = await markJobProcessing(job)

    // Única invocación del motor (o runner de prueba): mismo camino auth interno
    // + identidad de persistencia = job_id (idempotencia PK sin schema).
    const response = await runWithEvaluationJobPersistIdentity(jobId, () =>
      runWithInternalAuthUser({ userId: processing.owner_user_id }, async () => {
        if (executeFn) return executeFn(payload)
        return executeEvaluatePostBody(payload)
      }),
    )

    const parsed = await nextResponseToJson(response)

    if (parsed.ok) {
      const evaluationId = extractEvaluationIdFromResult(parsed.body)
      // Checkpoint durable antes de markJobCompleted (ventana crash P0).
      if (evaluationId && isUuid(evaluationId)) {
        await writeJob({ ...processing, evaluation_id: evaluationId })
      }
      await markJobCompleted(processing, parsed.body, evaluationId)
      return { ok: true, jobId, statusCode: parsed.status, result: parsed.body }
    }

    const msg =
      parsed.body &&
      typeof parsed.body === "object" &&
      typeof (parsed.body as { error?: unknown }).error === "string"
        ? String((parsed.body as { error: string }).error).slice(0, 400)
        : `Motor respondió HTTP ${parsed.status}`

    await markJobFailed(processing, {
      code: `HTTP_${parsed.status}`,
      message: msg,
      retryable: parsed.status >= 500,
    })
    return {
      ok: false,
      jobId,
      error: { code: `HTTP_${parsed.status}`, message: msg, retryable: parsed.status >= 500 },
    }
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : ""
    const code =
      name === "PayloadTooLargeError"
        ? "PAYLOAD_TOO_LARGE"
        : name === "RedisUnavailableError"
          ? "REDIS_UNAVAILABLE"
          : "WORKER_EXCEPTION"
    const message = safeErrorMessage(err)
    try {
      const job = await readJob(jobId)
      if (job && job.status !== "completed") {
        await markJobFailed(job, { code, message, retryable: code === "REDIS_UNAVAILABLE" })
      } else {
        await removeFromProcessing(jobId)
      }
    } catch {
      // best-effort
    }
    return { ok: false, jobId, error: { code, message, retryable: code === "REDIS_UNAVAILABLE" } }
  } finally {
    await releaseJobLock(jobId, workerId)
  }
}

/** Paridad: ejecuta payload bajo auth interno y devuelve status+body exactos (sin Redis). */
export async function executeEvaluateWithInternalAuth(args: {
  userId: string
  payload: unknown
  executeFn?: EvaluateExecuteFn
}): Promise<{ status: number; ok: boolean; body: unknown }> {
  const response = await runWithInternalAuthUser({ userId: args.userId }, async () => {
    if (args.executeFn) return args.executeFn(args.payload)
    return executeEvaluatePostBody(args.payload)
  })
  return nextResponseToJson(response)
}
