/**
 * Feature flags del Async Evaluation Wrapper V1.
 *
 * Server-only: ASYNC_EVALUATION_WRAPPER_ENABLED
 * Client-only: NEXT_PUBLIC_ASYNC_EVALUATION_WRAPPER_ENABLED
 *
 * Ambos deben ser true para usar el flujo async.
 * Nunca confiar solo en NEXT_PUBLIC_* en lógica server-side.
 */

/** Valores explícitos seguros: "true" | "1" (case-insensitive). Default: false. */
function parseExplicitEnableFlag(raw: string | undefined): boolean {
  if (raw == null) return false
  const v = raw.trim().toLowerCase()
  return v === "true" || v === "1"
}

/**
 * Flag server-only. Default false.
 * No lee NEXT_PUBLIC_*.
 */
export function isAsyncEvaluationServerEnabled(): boolean {
  return parseExplicitEnableFlag(process.env.ASYNC_EVALUATION_WRAPPER_ENABLED)
}

/**
 * Flag embebido en el cliente (build-time). Solo para elegir ruta UI.
 * No autoriza endpoints ni worker.
 */
export function isAsyncEvaluationClientFlagEnabled(): boolean {
  return parseExplicitEnableFlag(process.env.NEXT_PUBLIC_ASYNC_EVALUATION_WRAPPER_ENABLED)
}

/** Ambos activos → flujo async habilitable. */
export function isAsyncEvaluationFullyEnabled(): boolean {
  return isAsyncEvaluationServerEnabled() && isAsyncEvaluationClientFlagEnabled()
}
