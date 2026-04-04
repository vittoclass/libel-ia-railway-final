/**
 * Mismo batch_id en /docente/estacion (QR, grilla) y en /evaluar (Paso 2).
 * Persistido en localStorage para alinear pestañas y recargas.
 */
export const DOCENTE_ACTIVE_BATCH_ID_KEY = "libelia_docente_active_batch_id_v1"

/** Canal entre pestañas: la grilla avisa al evaluador cuando cambia batch_photo_uploads. */
export const BATCH_PHOTO_ACTIVITY_CHANNEL = "libelia_batch_photo_activity_v1"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isDocenteBatchUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim())
}

export function readDocenteActiveBatchId(): string | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(DOCENTE_ACTIVE_BATCH_ID_KEY)
    if (raw == null || raw === "") return null
    const parsed = JSON.parse(raw) as unknown
    const id = typeof parsed === "string" ? parsed : raw
    const t = String(id).trim()
    return isDocenteBatchUuid(t) ? t : null
  } catch {
    try {
      const raw = window.localStorage.getItem(DOCENTE_ACTIVE_BATCH_ID_KEY)
      const t = String(raw ?? "").replace(/^"|"$/g, "").trim()
      return isDocenteBatchUuid(t) ? t : null
    } catch {
      return null
    }
  }
}

export function writeDocenteActiveBatchId(id: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (id == null || id === "") {
      window.localStorage.removeItem(DOCENTE_ACTIVE_BATCH_ID_KEY)
      return
    }
    if (!isDocenteBatchUuid(id)) return
    window.localStorage.setItem(DOCENTE_ACTIVE_BATCH_ID_KEY, JSON.stringify(id.trim()))
  } catch {
    /* storage lleno o modo privado */
  }
}

/** Notifica otras pestañas (p. ej. /evaluar) que hubo actividad en este lote. */
export function broadcastBatchPhotoActivity(batchId: string): void {
  if (typeof window === "undefined" || !isDocenteBatchUuid(batchId)) return
  try {
    const ch = new BroadcastChannel(BATCH_PHOTO_ACTIVITY_CHANNEL)
    ch.postMessage({ type: "batch_photo_change", batchId: batchId.trim() })
    ch.close()
  } catch {
    /* BroadcastChannel no disponible */
  }
}
