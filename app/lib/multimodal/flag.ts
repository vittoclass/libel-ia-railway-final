/**
 * Feature flag — evaluación multimodal Artes (default OFF).
 * Con false: el flujo productivo no invoca esta capa.
 */

export const MULTIMODAL_ARTS_FLAG_ENV = "MULTIMODAL_ARTS_EVALUATION_ENABLED"

export function isMultimodalArtsEvaluationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = String(env[MULTIMODAL_ARTS_FLAG_ENV] ?? "")
    .trim()
    .toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

/**
 * Gate estricto Camino B:
 * - flag ON
 * - areaConocimiento normalizada === "artes"
 * - tipoPruebaReal === "solo_desarrollo"
 * - allowOmr === false
 * Jamás mixta / solo_alternativas / OMR.
 */
export function shouldRunMultimodalArtsPath(params: {
  enabled?: boolean
  areaConocimiento?: string | null
  tipoPruebaReal?: string | null
  allowOmr?: boolean | null
}): boolean {
  const enabled = params.enabled ?? isMultimodalArtsEvaluationEnabled()
  if (!enabled) return false

  const area = String(params.areaConocimiento ?? "")
    .trim()
    .toLowerCase()
  if (area !== "artes") return false

  const tipo = String(params.tipoPruebaReal ?? "")
    .trim()
    .toLowerCase()
  if (tipo !== "solo_desarrollo") return false

  if (params.allowOmr !== false) return false

  return true
}
