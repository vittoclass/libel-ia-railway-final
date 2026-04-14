/**
 * Paginación segura para listados de batch_photo_uploads (lotes grandes sin truncar).
 * No toca OMR ni evaluación; solo límites de lectura.
 */

export const DEFAULT_BATCH_PHOTO_PAGE_SIZE = 90
export const MAX_BATCH_PHOTO_PAGE_SIZE = 120
/** Tope de desplazamiento para evitar abusos en un solo cliente. */
export const BATCH_PHOTO_MAX_OFFSET = 4000

export function parseBatchPhotoPageParams(searchParams: URLSearchParams): { offset: number; limit: number } {
  const rawOff = searchParams.get("offset")
  const rawLim = searchParams.get("limit")
  let offset = rawOff != null ? Number.parseInt(rawOff, 10) : 0
  if (!Number.isFinite(offset) || offset < 0) offset = 0
  if (offset > BATCH_PHOTO_MAX_OFFSET) offset = BATCH_PHOTO_MAX_OFFSET

  let limit = rawLim != null ? Number.parseInt(rawLim, 10) : DEFAULT_BATCH_PHOTO_PAGE_SIZE
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_BATCH_PHOTO_PAGE_SIZE
  if (limit > MAX_BATCH_PHOTO_PAGE_SIZE) limit = MAX_BATCH_PHOTO_PAGE_SIZE

  return { offset, limit }
}
