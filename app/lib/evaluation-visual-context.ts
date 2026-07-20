/**
 * Contexto visual de UI para revisión OMR (previews locales / rutas móvil).
 * No forma parte del motor ni del scoring: solo preserva lo que el cliente ya tenía
 * antes de un evaluate async (polling / refresh).
 */

export const ASYNC_EVAL_VISUAL_SESSION_KEY = "libelia_async_eval_visual_v1"

/** Límite blando para dataUrls en sessionStorage (evitar QuotaExceeded). */
const MAX_SESSION_DATA_URL_CHARS = 1_200_000

export type EvaluationVisualFileMeta = {
  id: string
  fileName: string
  mimeType: string
  /** Solo si no hay batchScanStoragePath (archivos locales / cámara). */
  dataUrl?: string
  batchScanStoragePath?: string | null
  mobileBatchPhotoId?: string
  fromMobileBatch?: boolean
  mobileBatchPageIndex?: number | null
  mobileBatchProcessedAt?: string | null
}

export type EvaluationVisualSessionV1 = {
  version: 1
  job_id?: string
  client_request_id?: string
  group_id: string
  student_index?: number | null
  saved_at: string
  files: EvaluationVisualFileMeta[]
}

export type VisualFileLike = {
  id: string
  previewUrl: string
  dataUrl: string
  file: { name: string; type: string }
  batchScanStoragePath?: string | null
  mobileBatchPhotoId?: string
  fromMobileBatch?: boolean
  mobileBatchPageIndex?: number | null
  mobileBatchProcessedAt?: string | null
}

/** Src para “Ver imagen original” / miniaturas: preferir dataUrl estable sobre blob: revocable. */
export function resolveReviewImageSrc(file: {
  previewUrl?: string | null
  dataUrl?: string | null
}): string {
  const dataUrl = typeof file.dataUrl === "string" ? file.dataUrl.trim() : ""
  if (dataUrl.startsWith("data:")) return dataUrl
  const preview = typeof file.previewUrl === "string" ? file.previewUrl.trim() : ""
  if (preview) return preview
  return "/placeholder.svg"
}

export function serializeVisualFiles(files: VisualFileLike[]): EvaluationVisualFileMeta[] {
  const out: EvaluationVisualFileMeta[] = []
  let dataUrlBudget = MAX_SESSION_DATA_URL_CHARS
  for (const f of files) {
    const storagePath = f.batchScanStoragePath?.trim() || null
    const meta: EvaluationVisualFileMeta = {
      id: f.id,
      fileName: f.file?.name || "scan.jpg",
      mimeType: f.file?.type || "image/jpeg",
      batchScanStoragePath: storagePath,
      mobileBatchPhotoId: f.mobileBatchPhotoId,
      fromMobileBatch: f.fromMobileBatch,
      mobileBatchPageIndex: f.mobileBatchPageIndex ?? null,
      mobileBatchProcessedAt: f.mobileBatchProcessedAt ?? null,
    }
    if (!storagePath) {
      const du = typeof f.dataUrl === "string" ? f.dataUrl : ""
      if (du.startsWith("data:") && du.length <= dataUrlBudget) {
        meta.dataUrl = du
        dataUrlBudget -= du.length
      }
    }
    out.push(meta)
  }
  return out
}

export function saveEvaluationVisualSession(session: EvaluationVisualSessionV1): void {
  try {
    sessionStorage.setItem(ASYNC_EVAL_VISUAL_SESSION_KEY, JSON.stringify(session))
  } catch {
    // Quota / privado: el ref en memoria sigue siendo la fuente principal.
  }
}

export function loadEvaluationVisualSession(): EvaluationVisualSessionV1 | null {
  try {
    const raw = sessionStorage.getItem(ASYNC_EVAL_VISUAL_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as EvaluationVisualSessionV1
    if (parsed?.version !== 1 || !parsed.group_id || !Array.isArray(parsed.files)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearEvaluationVisualSession(): void {
  try {
    sessionStorage.removeItem(ASYNC_EVAL_VISUAL_SESSION_KEY)
  } catch {
    // ignore
  }
}

export function bindVisualSessionJobIds(args: {
  job_id: string
  client_request_id?: string
  group_id?: string
}): void {
  const cur = loadEvaluationVisualSession()
  if (!cur) return
  if (args.group_id && cur.group_id !== args.group_id) return
  saveEvaluationVisualSession({
    ...cur,
    job_id: args.job_id,
    client_request_id: args.client_request_id || cur.client_request_id,
  })
}

/** Si el grupo quedó sin archivos, restaurar el snapshot visual original. */
export function pickPreservedVisualFiles<T extends { id: string }>(
  currentFiles: T[] | null | undefined,
  snapshotFiles: T[] | null | undefined,
): T[] {
  const cur = Array.isArray(currentFiles) ? currentFiles : []
  const snap = Array.isArray(snapshotFiles) ? snapshotFiles : []
  if (cur.length > 0) return cur
  if (snap.length > 0) return snap
  return cur
}

async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

/**
 * Rehidrata FilePreview-like desde metadata de session (refresh).
 * No inventa imágenes: solo storage path firmado o dataUrl ya guardado.
 */
export async function rehydrateVisualFiles(
  metas: EvaluationVisualFileMeta[],
): Promise<
  Array<{
    id: string
    file: File
    previewUrl: string
    dataUrl: string
    batchScanStoragePath?: string | null
    mobileBatchPhotoId?: string
    fromMobileBatch?: boolean
    mobileBatchPageIndex?: number | null
    mobileBatchProcessedAt?: string | null
  }>
> {
  const out: Array<{
    id: string
    file: File
    previewUrl: string
    dataUrl: string
    batchScanStoragePath?: string | null
    mobileBatchPhotoId?: string
    fromMobileBatch?: boolean
    mobileBatchPageIndex?: number | null
    mobileBatchProcessedAt?: string | null
  }> = []

  for (const meta of metas) {
    const storagePath = meta.batchScanStoragePath?.trim() || ""
    try {
      if (storagePath) {
        const signRes = await fetch(
          `/api/docente/batch-photo-sign?path=${encodeURIComponent(storagePath)}`,
        )
        const signJson = (await signRes.json().catch(() => ({}))) as { signed_url?: string }
        if (!signRes.ok || typeof signJson.signed_url !== "string" || !signJson.signed_url) continue
        const imgRes = await fetch(signJson.signed_url)
        if (!imgRes.ok) continue
        const blob = await imgRes.blob()
        const file = new File([blob], meta.fileName || "scan.jpg", {
          type: meta.mimeType || blob.type || "image/jpeg",
        })
        out.push({
          id: meta.id,
          file,
          previewUrl: URL.createObjectURL(file),
          dataUrl: "",
          batchScanStoragePath: storagePath,
          mobileBatchPhotoId: meta.mobileBatchPhotoId,
          fromMobileBatch: meta.fromMobileBatch,
          mobileBatchPageIndex: meta.mobileBatchPageIndex ?? null,
          mobileBatchProcessedAt: meta.mobileBatchProcessedAt ?? null,
        })
        continue
      }

      const dataUrl = typeof meta.dataUrl === "string" ? meta.dataUrl : ""
      if (!dataUrl.startsWith("data:")) continue
      const blob = await blobFromDataUrl(dataUrl)
      const file = new File([blob], meta.fileName || "scan.jpg", {
        type: meta.mimeType || blob.type || "image/jpeg",
      })
      out.push({
        id: meta.id,
        file,
        previewUrl: URL.createObjectURL(file),
        dataUrl,
        batchScanStoragePath: null,
        mobileBatchPhotoId: meta.mobileBatchPhotoId,
        fromMobileBatch: meta.fromMobileBatch,
        mobileBatchPageIndex: meta.mobileBatchPageIndex ?? null,
        mobileBatchProcessedAt: meta.mobileBatchProcessedAt ?? null,
      })
    } catch {
      // best-effort por archivo
    }
  }

  return out
}
