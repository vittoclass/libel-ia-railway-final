/**
 * Entrada del worker de evaluación asíncrona (servicio Railway separado).
 *
 * Comando reproducible (package.json):
 *   "worker:evaluate": "tsx scripts/evaluation-worker.ts"
 *   "worker:evaluate:selftest": "tsx scripts/evaluation-worker.ts --selftest"
 *   "worker:evaluate:validate": "tsx scripts/evaluation-worker.ts --validate-only"
 *
 * Requiere `tsx` en dependencies (no npx: no descarga dinámica).
 *
 * Variables:
 *   ASYNC_EVALUATION_WRAPPER_ENABLED=true|1  (obligatoria para consumo)
 *   REDIS_URL (obligatoria; nunca se imprime)
 *   EVAL_JOB_REDIS_PREFIX (opcional; tests: eval:v1:test:<uuid>)
 *
 * Modos:
 *   --selftest / --security-test   tests mock (sin cola productiva)
 *   --validate-only / SELFTEST     valida flag+REDIS_URL+ping; no consume
 *   --once                         un ciclo BRPOP
 *   (default)                      loop de consumo (flag on)
 */
import { existsSync, readFileSync } from "fs"
import { resolve } from "path"

/** Carga .env sin imprimir valores. No sobreescribe env ya definidas. */
function loadEnvFileQuiet(filePath: string): void {
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, "utf8")
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFileQuiet(resolve(process.cwd(), ".env.local"))
loadEnvFileQuiet(resolve(process.cwd(), ".env"))

async function runValidateOnly(): Promise<void> {
  const { isAsyncEvaluationServerEnabled } = await import("../app/lib/async-evaluation-flags")
  const { pingEvaluationRedis, getEvaluationRedis } = await import("../app/api/evaluate/jobStore")
  const { evalJobKeyPrefix } = await import("../app/lib/evaluation-job-contract")

  if (!isAsyncEvaluationServerEnabled()) {
    console.info(
      "[evaluation-worker] VALIDATE_ONLY: ASYNC_EVALUATION_WRAPPER_ENABLED=off → no consumo (OK)",
    )
    console.info("[evaluation-worker] VALIDATE_ONLY: exit 0 (disabled)")
    return
  }

  if (!process.env.REDIS_URL?.trim()) {
    throw new Error("[evaluation-worker] VALIDATE_ONLY: REDIS_URL ausente (no se imprime valor)")
  }

  const ok = await pingEvaluationRedis()
  if (!ok || !getEvaluationRedis()) {
    throw new Error(
      `[evaluation-worker] VALIDATE_ONLY: Redis no responde (prefix=${evalJobKeyPrefix()})`,
    )
  }

  console.info("[evaluation-worker] VALIDATE_ONLY: flag on + redis ping OK; no se consume la cola", {
    prefix: evalJobKeyPrefix(),
  })
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const validateOnly =
    args.has("--validate-only") ||
    process.env.EVAL_WORKER_MODE === "VALIDATE_ONLY" ||
    process.env.EVAL_WORKER_MODE === "SELFTEST"

  if (args.has("--selftest") || args.has("--security-test")) {
    if (!process.env.EVAL_JOB_REDIS_PREFIX) {
      process.env.EVAL_JOB_REDIS_PREFIX = `eval:v1:test:selftest-${crypto.randomUUID()}`
    }
    const { runSecurityAndParitySelfTests } = await import("./evaluation-wrapper-selftest")
    const code = await runSecurityAndParitySelfTests()
    process.exit(code)
    return
  }

  if (validateOnly) {
    await runValidateOnly()
    return
  }

  const { isAsyncEvaluationServerEnabled } = await import("../app/lib/async-evaluation-flags")
  if (!isAsyncEvaluationServerEnabled()) {
    console.error(
      "[evaluation-worker] ASYNC_EVALUATION_WRAPPER_ENABLED no activo (true|1). Abortando sin consumo.",
    )
    process.exit(1)
  }

  if (!process.env.REDIS_URL?.trim()) {
    console.error("[evaluation-worker] REDIS_URL no configurada. Abortando. (URL no se imprime)")
    process.exit(1)
  }

  const ac = new AbortController()
  const onSignal = (sig: string) => {
    console.info(`[evaluation-worker] señal ${sig}; shutdown limpio`)
    ac.abort()
  }
  process.once("SIGTERM", () => onSignal("SIGTERM"))
  process.once("SIGINT", () => onSignal("SIGINT"))

  const { runEvaluationWorkerLoop } = await import("../app/lib/evaluation-worker")
  await runEvaluationWorkerLoop({
    once: args.has("--once"),
    brpopTimeoutSeconds: args.has("--once") ? 2 : 5,
    signal: ac.signal,
    requireServerFlag: true,
  })
}

main().catch((err) => {
  console.error("[evaluation-worker] fatal:", err instanceof Error ? err.message : err)
  process.exit(1)
})
