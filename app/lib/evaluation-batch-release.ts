import type { SupabaseClient } from "@supabase/supabase-js"

/** Docente envió el lote; aún no cuenta en trazabilidad institucional. */
export const BATCH_RELEASE_PENDING_UTP = "pending_utp"
/** UTP devolvió el lote al docente. */
export const BATCH_RELEASE_REJECTED = "rejected"
/** Liberado hacia rollups / vista Dirección (trazabilidad). */
export const BATCH_RELEASE_VALIDATED = "validated"

export type BatchInstitutionalReleaseStatus =
  typeof BATCH_RELEASE_PENDING_UTP
  | typeof BATCH_RELEASE_REJECTED
  | typeof BATCH_RELEASE_VALIDATED

export async function getBatchReleaseStatus(
  supabase: SupabaseClient,
  batchId: string,
): Promise<BatchInstitutionalReleaseStatus | null> {
  const bid = String(batchId ?? "").trim()
  if (!bid) return null
  const { data } = await supabase
    .from("evaluation_batch_institutional_release")
    .select("status")
    .eq("batch_id", bid)
    .maybeSingle()
  const s = String((data as { status?: string } | null)?.status ?? "").trim()
  if (s === BATCH_RELEASE_VALIDATED || s === BATCH_RELEASE_PENDING_UTP || s === BATCH_RELEASE_REJECTED) {
    return s as BatchInstitutionalReleaseStatus
  }
  return null
}

/** Solo lotes con fila validated participan en skill_rollup_* institucional. */
export async function isBatchValidatedForInstitutionalRollup(
  supabase: SupabaseClient,
  batchId: string,
): Promise<boolean> {
  const st = await getBatchReleaseStatus(supabase, batchId)
  return st === BATCH_RELEASE_VALIDATED
}

/** batch_id → status (solo ids solicitados). */
export async function mapBatchIdsToReleaseStatus(
  supabase: SupabaseClient,
  batchIds: string[],
): Promise<Map<string, BatchInstitutionalReleaseStatus | null>> {
  const out = new Map<string, BatchInstitutionalReleaseStatus | null>()
  const ids = [...new Set(batchIds.map((b) => String(b ?? "").trim()).filter(Boolean))].slice(0, 500)
  for (const id of ids) out.set(id, null)
  if (ids.length === 0) return out
  const { data } = await supabase
    .from("evaluation_batch_institutional_release")
    .select("batch_id, status")
    .in("batch_id", ids)
  for (const row of data ?? []) {
    const r = row as { batch_id?: string; status?: string }
    const bid = String(r.batch_id ?? "")
    const s = String(r.status ?? "").trim()
    if (!bid) continue
    if (s === BATCH_RELEASE_VALIDATED || s === BATCH_RELEASE_PENDING_UTP || s === BATCH_RELEASE_REJECTED) {
      out.set(bid, s as BatchInstitutionalReleaseStatus)
    }
  }
  return out
}
