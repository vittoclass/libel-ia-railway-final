/**
 * Contrato NDJSON de POST /api/evaluate/batch (líneas por \n).
 * Mantener alineado con app/api/evaluate/batch/route.ts y el lector en EvaluatorClient.
 */

export type EvaluateBatchNdjsonMeta = {
  type: "meta"
  totalItems: number
  totalBatches: number
  batchSize: number
}

export type EvaluateBatchNdjsonDone = {
  type: "done"
  completedCount: number
}

export function isEvaluateBatchMetaMsg(v: unknown): v is EvaluateBatchNdjsonMeta {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    o.type === "meta" &&
    typeof o.totalItems === "number" &&
    typeof o.totalBatches === "number" &&
    typeof o.batchSize === "number" &&
    Number.isFinite(o.totalItems) &&
    Number.isFinite(o.totalBatches) &&
    Number.isFinite(o.batchSize)
  )
}

export function isEvaluateBatchDoneMsg(v: unknown): v is EvaluateBatchNdjsonDone {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return o.type === "done" && typeof o.completedCount === "number" && Number.isFinite(o.completedCount)
}
