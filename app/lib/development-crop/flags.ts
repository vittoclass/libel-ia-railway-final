/** Feature flag acordado: sin activar, el flujo QR/cámara es idéntico al actual. */
export const DEVELOPMENT_MANUAL_CROP_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEVELOPMENT_MANUAL_CROP === "true" ||
  process.env.ENABLE_DEVELOPMENT_MANUAL_CROP === "true"

export type DevelopmentTipoPrueba = "mixta" | "solo_desarrollo" | "solo_alternativas"

const VALID_TIPO = new Set<string>(["mixta", "solo_desarrollo", "solo_alternativas"])

export function parseTipoPruebaFromQuery(raw: string | null | undefined): DevelopmentTipoPrueba | null {
  const t = String(raw ?? "").trim()
  return VALID_TIPO.has(t) ? (t as DevelopmentTipoPrueba) : null
}

/** Prueba con ítems de desarrollo (no solo alternativas). */
export function isDevelopmentTipoPrueba(tipo: DevelopmentTipoPrueba | null | undefined): boolean {
  return tipo === "solo_desarrollo" || tipo === "mixta"
}

export function shouldOfferDevelopmentManualCrop(tipo: DevelopmentTipoPrueba | null | undefined): boolean {
  return DEVELOPMENT_MANUAL_CROP_ENABLED && isDevelopmentTipoPrueba(tipo)
}

export type DevelopmentCropDebugEvent =
  | "development_crop_enabled"
  | "development_crop_used"
  | "development_crop_dimensions"
  | "development_crop_confirmed"
  | "development_crop_cancelled"
  | "development_crop_sent_to_ocr"

export function emitDevelopmentCropDebug(
  event: DevelopmentCropDebugEvent,
  payload?: Record<string, unknown>,
): void {
  console.info(`[${event}]`, payload ?? {})
}
