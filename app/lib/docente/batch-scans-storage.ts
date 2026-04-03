/**
 * Bucket privado de Storage para fotos de lote (móvil → PC).
 * Debe existir en Supabase (`storage.buckets`) con id y name iguales a este valor.
 */
export const BATCH_SCANS_BUCKET = "batch-scans" as const
