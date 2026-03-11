/**
 * Resuelve el provider OMR desde variable de entorno.
 * Solo para uso en servidor (API routes). Por defecto: "libelia".
 * NO toca compare, scoring ni persistencia.
 */

export type OMRProvider = "libelia" | "leadtools" | "opencv" | "veryfi"

const DEFAULT_PROVIDER: OMRProvider = "libelia"

/**
 * Devuelve el provider OMR configurado (solo servidor).
 * OMR_PROVIDER=opencv → opencv, leadtools → leadtools, veryfi → veryfi, en caso contrario libelia.
 */
export function getOMRProvider(): OMRProvider {
  if (typeof process === "undefined" || !process.env) return DEFAULT_PROVIDER
  const v = process.env.OMR_PROVIDER
  if (v === "opencv") return "opencv"
  if (v === "leadtools") return "leadtools"
  if (v === "veryfi") return "veryfi"
  return DEFAULT_PROVIDER
}
