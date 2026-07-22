/**
 * Captura colaborativa (MVP taller): varios QR → mismo batch_id, un slot por QR.
 * Aislado del flujo tradicional (1 QR → varios alumnos en secuencia).
 * No toca upload, motores ni evaluación: solo construye URL y etiquetas de UI.
 */

export const COLLABORATIVE_QR_PRESETS = [5, 10, 15, 20, 25, 30] as const

export const COLLABORATIVE_QR_MIN = 1
export const COLLABORATIVE_QR_MAX = 50

/** Query corto en /escaneo/{batchId}?s=N — no se muestra al usuario. */
export const COLLABORATIVE_SLOT_QUERY_PARAM = "s"

/** Query de etiqueta visible: profesor | grupo */
export const COLLABORATIVE_LABEL_QUERY_PARAM = "rol"

export type CollaborativeSlotLabel = "profesor" | "grupo"

export type StationCaptureMode = "traditional" | "collaborative"

export function clampCollaborativeQrCount(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 10
  return Math.max(COLLABORATIVE_QR_MIN, Math.min(COLLABORATIVE_QR_MAX, v))
}

export function parseCollaborativeSlotFromSearchParams(
  params: URLSearchParams | { get(name: string): string | null },
): number | null {
  const raw = String(params.get(COLLABORATIVE_SLOT_QUERY_PARAM) ?? "").trim()
  if (!raw) return null
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1 || n > 500) return null
  return n
}

export function parseCollaborativeLabelFromSearchParams(
  params: URLSearchParams | { get(name: string): string | null },
): CollaborativeSlotLabel {
  const raw = String(params.get(COLLABORATIVE_LABEL_QUERY_PARAM) ?? "")
    .trim()
    .toLowerCase()
  return raw === "grupo" ? "grupo" : "profesor"
}

export function collaborativeSlotDisplayName(
  slot: number,
  label: CollaborativeSlotLabel = "profesor",
): string {
  const n = Math.max(1, Math.floor(slot))
  return label === "grupo" ? `Grupo ${n}` : `Profesor ${n}`
}

export function collaborativeQrDisplayName(slot: number): string {
  return `QR ${Math.max(1, Math.floor(slot))}`
}

/** Cursor localStorage distinto por slot para no chocar con el flujo tradicional del mismo batch. */
export function collaborativeMobileCursorStorageKey(batchId: string, slot: number): string {
  return `libelia_mobile_capture_cursor_v1:${batchId}:s${Math.floor(slot)}`
}

export function buildCollaborativeEscaneoUrl(input: {
  origin: string
  batchId: string
  slot: number
  label?: CollaborativeSlotLabel
  tipoPrueba?: string | null
}): string {
  const base = `${input.origin.replace(/\/$/, "")}/escaneo/${encodeURIComponent(input.batchId)}`
  const q = new URLSearchParams()
  q.set(COLLABORATIVE_SLOT_QUERY_PARAM, String(Math.max(1, Math.floor(input.slot))))
  if (input.label === "grupo") {
    q.set(COLLABORATIVE_LABEL_QUERY_PARAM, "grupo")
  }
  const tipo = typeof input.tipoPrueba === "string" ? input.tipoPrueba.trim() : ""
  if (tipo) q.set("tipo", tipo)
  return `${base}?${q.toString()}`
}
