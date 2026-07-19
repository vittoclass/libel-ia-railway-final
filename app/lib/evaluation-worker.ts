/**
 * Worker consumidor durable de la cola eval:v1.
 * Prefijo de test: EVAL_JOB_REDIS_PREFIX (nunca consumir producción sin querer).
 *
 * Requiere ASYNC_EVALUATION_WRAPPER_ENABLED=true|1. Default: no inicia consumo.
 * Concurrencia fija V1: 1 (no aumentar sin pruebas).
 */
import {
  popJobToProcessing,
  recoverAbandonedProcessingJobs,
  pingEvaluationRedis,
  getEvaluationRedis,
} from "@/app/api/evaluate/jobStore"
import { runEvaluationJobOnce } from "@/app/lib/evaluation-job-runner"
import { evalJobKeyPrefix } from "@/app/lib/evaluation-job-contract"
import { isAsyncEvaluationServerEnabled } from "@/app/lib/async-evaluation-flags"

/** Concurrencia inicial V1 — no aumentar sin pruebas. */
export const EVALUATION_WORKER_CONCURRENCY = 1

export type EvaluationWorkerOptions = {
  workerId?: string
  /** Si true, un solo ciclo (tests). */
  once?: boolean
  /** Intervalo de recovery (ms). */
  recoveryEveryMs?: number
  brpopTimeoutSeconds?: number
  /** Abort signal para tests / shutdown. */
  signal?: AbortSignal
  onJobDone?: (info: { jobId: string; ok: boolean }) => void
  /** Si false, omite el chequeo de flag (solo self-tests controlados). */
  requireServerFlag?: boolean
}

export async function runEvaluationWorkerLoop(opts: EvaluationWorkerOptions = {}): Promise<void> {
  const requireFlag = opts.requireServerFlag !== false
  if (requireFlag && !isAsyncEvaluationServerEnabled()) {
    throw new Error(
      "[evaluation-worker] ASYNC_EVALUATION_WRAPPER_ENABLED no está activo (true|1). No se inicia consumo.",
    )
  }

  if (!process.env.REDIS_URL?.trim()) {
    throw new Error(
      "[evaluation-worker] REDIS_URL no configurada. No se inicia el worker. (URL no se imprime)",
    )
  }

  const workerId = opts.workerId ?? `worker_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
  const recoveryEveryMs = opts.recoveryEveryMs ?? 60_000
  const brpopTimeoutSeconds = opts.brpopTimeoutSeconds ?? 5

  const okRedis = await pingEvaluationRedis()
  if (!okRedis || !getEvaluationRedis()) {
    throw new Error(
      `[evaluation-worker] Redis no disponible (prefix=${evalJobKeyPrefix()}). No se inicia el worker.`,
    )
  }

  console.info("[evaluation-worker] iniciado", {
    workerId,
    prefix: evalJobKeyPrefix(),
    once: !!opts.once,
    concurrency: EVALUATION_WORKER_CONCURRENCY,
  })

  let lastRecovery = 0
  let inFlight = false
  let shuttingDown = false

  const onAbort = () => {
    shuttingDown = true
    console.info("[evaluation-worker] shutdown solicitado; no se tomarán jobs nuevos")
  }
  opts.signal?.addEventListener("abort", onAbort, { once: true })
  if (opts.signal?.aborted) onAbort()

  try {
    while (!opts.signal?.aborted && !shuttingDown) {
      const now = Date.now()
      if (now - lastRecovery >= recoveryEveryMs) {
        lastRecovery = now
        try {
          const recovered = await recoverAbandonedProcessingJobs()
          if (recovered.length) {
            console.info("[evaluation-worker] jobs recuperados", { count: recovered.length })
          }
        } catch (e) {
          console.warn(
            "[evaluation-worker] recovery error:",
            e instanceof Error ? e.message : "unknown",
          )
        }
      }

      if (shuttingDown || opts.signal?.aborted) break

      // Concurrencia 1: no tomar otro job si hay uno en vuelo
      if (inFlight) {
        await new Promise((r) => setTimeout(r, 50))
        continue
      }

      let jobId: string | null = null
      try {
        jobId = await popJobToProcessing(brpopTimeoutSeconds)
      } catch (e) {
        console.warn(
          "[evaluation-worker] brpoplpush error:",
          e instanceof Error ? e.message : "unknown",
        )
        await new Promise((r) => setTimeout(r, 1000))
        if (opts.once) break
        continue
      }

      if (!jobId) {
        if (opts.once || shuttingDown) break
        continue
      }

      // Si shutdown llegó durante BRPOP, no procesar: reencolar no es trivial aquí;
      // el job está en processing y recovery lo recuperará si no hay lock.
      if (shuttingDown || opts.signal?.aborted) {
        console.info("[evaluation-worker] job omitido por shutdown (queda en processing)", { jobId })
        break
      }

      console.info("[evaluation-worker] job tomado", { jobId })
      inFlight = true
      try {
        const outcome = await runEvaluationJobOnce({ jobId, workerId })
        opts.onJobDone?.({ jobId, ok: outcome.ok })
        if (outcome.ok) {
          console.info("[evaluation-worker] job completed", { jobId })
        } else if (outcome.skipped) {
          console.info("[evaluation-worker] job skipped (lock)", { jobId })
        } else {
          console.warn("[evaluation-worker] job failed", {
            jobId,
            code: outcome.error.code,
            message: outcome.error.message,
          })
        }
      } finally {
        inFlight = false
      }

      if (opts.once) break
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort)
  }

  console.info("[evaluation-worker] detenido", { workerId, shuttingDown })
}
