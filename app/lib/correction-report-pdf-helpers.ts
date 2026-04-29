/**
 * Helpers compartidos para el PDF de informe de corrección (mismo criterio que el evaluador).
 * Solo presentación; no toca OMR ni persistencia.
 */
import type { CorrectionReportGroupForPdf } from "@/app/lib/correction-report-from-evaluation-detail"
import { pickStudentDesarrolloVisibleText } from "@/app/lib/pick-student-desarrollo-text"

/** Adjuntos compatibles con `StudentGroup.files` / API; solo tipado para el PDF. */
export type CorrectionReportPdfFileLike = {
  id?: string
  name?: string
  filename?: string
  fileName?: string
  url?: string
  previewUrl?: string
  dataUrl?: string
  size?: number
  type?: string
  mimeType?: string
  file?: File
  mobileBatchPhotoId?: string
  fromMobileBatch?: boolean
  batchScanStoragePath?: string | null
}

/**
 * `group` aceptado por el documento PDF: `files` como arreglo (p. ej. FilePreview[]), no tupla `[]`.
 */
export type CorrectionReportPdfGroupInput = Omit<CorrectionReportGroupForPdf, "files"> & {
  files?: Array<CorrectionReportPdfFileLike | unknown>
}

export function renderForWeb(value: unknown): string {
  if (value === null || value === undefined) return ""
  const t = typeof value
  if (t === "string" || t === "number" || t === "boolean") return String(value)
  if (Array.isArray(value)) {
    return value.map((v) => renderForWeb(v)).join(", ")
  }
  try {
    if (typeof value === "object" && value !== null) {
      const v = value as Record<string, unknown>
      if (
        v.justificacion &&
        ("puntaje" in v || "texto_estudiante" in v || "cita_estudiante" in v)
      ) {
        const q = pickStudentDesarrolloVisibleText(v)
        const pRaw = v.puntaje
        const pStr =
          pRaw != null && String(renderForWeb(pRaw)).trim() !== "" ? renderForWeb(pRaw) : "N/A"
        return `Puntaje: ${pStr} - Respuesta: "${q}" - ${renderForWeb(v.justificacion)}`
      }
      if (v.area && v.detalles) {
        return `${v.area}: ${renderForWeb(v.detalles)}`
      }
      if (v.descripcion != null && v.descripcion !== "") return renderForWeb(v.descripcion)
      if (v.detalle != null && v.detalle !== "") return renderForWeb(v.detalle)
      if (v.detalles != null && v.detalles !== "") return renderForWeb(v.detalles)
      if (v.texto != null && v.texto !== "") return renderForWeb(v.texto)
      if (v.seccion) return `${v.seccion}: ${renderForWeb(v.detalle || v.detalles || "")}`
      if (v.mensaje) return String(v.mensaje)
      const entries = Object.entries(v)
      if (entries.length > 0) {
        return entries.map(([k, val]) => `${k}: ${renderForWeb(val)}`).join("; ")
      }
    }
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function pdfSafe(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    if (Array.isArray(value)) {
      const arr = value as unknown[]
      if (arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null && ("aspecto" in arr[0] || "detalle" in arr[0])) {
        return arr
          .map(
            (x: unknown) =>
              `• ${(x as { aspecto?: string; seccion?: string }).aspecto ?? (x as { seccion?: string }).seccion ?? "Item"}: ${pdfSafe((x as { detalle?: unknown; detalles?: unknown }).detalle ?? (x as { detalles?: unknown }).detalles ?? "")}`,
          )
          .join("\n")
      }
      return arr.map((v) => pdfSafe(v)).join(", ")
    }
    if (
      typeof value === "object" &&
      value !== null &&
      (value as { justificacion?: unknown }).justificacion &&
      ("puntaje" in value || "texto_estudiante" in value || "cita_estudiante" in value)
    ) {
      const v = value as Record<string, unknown>
      const q = pickStudentDesarrolloVisibleText(v)
      const pRaw = v.puntaje
      const pStr = pRaw != null && String(pdfSafe(pRaw)).trim() !== "" ? pdfSafe(pRaw) : "N/A"
      return `Puntaje: ${pStr}
Respuesta Estudiante: "${q}"
Justificación: ${pdfSafe(v.justificacion)}`
    }
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatDetalleDesarrolloPdf(raw: unknown): string {
  if (raw == null) return ""
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return String(raw)
  if (Array.isArray(raw)) return raw.map((x) => formatDetalleDesarrolloPdf(x)).filter(Boolean).join(" — ")
  if (typeof raw !== "object") return String(raw)
  const o = raw as Record<string, unknown>
  const pVal = o.puntaje
  const p =
    pVal != null && String(pVal).trim() !== ""
      ? `Puntaje: ${String(pVal).trim()}`
      : ""
  const txt = pickStudentDesarrolloVisibleText(o as Record<string, unknown>)
  const txtPart = txt ? `Respuesta: "${txt.replace(/"/g, "'")}"` : ""
  const jVal = o.justificacion
  const j = jVal != null ? renderForWeb(jVal).trim() : ""
  const jPart = j ? `Justificación: ${j}` : ""
  const main = [p, txtPart, jPart].filter(Boolean).join("\n")
  if (main) return main
  const fallback = Object.entries(o)
    .filter(([, v]) => v != null && typeof v !== "object" && typeof v !== "function")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" — ")
  return fallback || "(Sin detalle estructurado disponible)"
}

export function splitCorreccionForTwoPages<T>(lista: T[] | undefined) {
  if (!lista || lista.length === 0) return { first: [] as T[], rest: [] as T[] }
  const MAX_P1 = Math.min(5, lista.length)
  return { first: lista.slice(0, MAX_P1), rest: lista.slice(MAX_P1) }
}

export function filterCorreccionDetalladaParaDesarrolloUnico(group: {
  retroalimentacion?: { correccion_detallada?: unknown[] }
  detalle_desarrollo?: Record<string, unknown>
}): Array<{ seccion?: string; detalle?: string; detalles?: string }> {
  const devKeys = Object.keys(group.detalle_desarrollo || {})
  if (devKeys.length > 0) return []
  return (group.retroalimentacion?.correccion_detallada || []) as Array<{
    seccion?: string
    detalle?: string
    detalles?: string
  }>
}
