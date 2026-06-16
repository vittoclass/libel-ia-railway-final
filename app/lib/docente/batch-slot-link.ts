import type { SupabaseClient } from "@supabase/supabase-js"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "" && UUID_REGEX.test(value.trim())
}

function isValidBatchStudentIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 500
}

export type LinkFinalEvaluationToBatchSlotInput = {
  supabase: SupabaseClient
  teacherId: string
  batchId: string
  batchStudentIndex: number
  finalEvaluationId: string
}

export type LinkFinalEvaluationToBatchSlotResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  draftEvaluationId?: string | null
  finalEvaluationId: string
  relinkedPhotoCount?: number
}

export async function linkFinalEvaluationToBatchSlot(
  input: LinkFinalEvaluationToBatchSlotInput,
): Promise<LinkFinalEvaluationToBatchSlotResult> {
  const { supabase, teacherId, batchId, batchStudentIndex, finalEvaluationId } = input

  if (process.env.BATCH_SLOT_LINK_ENABLED !== "true") {
    return { ok: false, skipped: true, reason: "disabled", finalEvaluationId }
  }

  if (
    !isValidUuid(batchId) ||
    !isValidUuid(finalEvaluationId) ||
    !isValidUuid(teacherId) ||
    !isValidBatchStudentIndex(batchStudentIndex)
  ) {
    return { ok: false, skipped: true, reason: "missing_or_invalid_input", finalEvaluationId }
  }

  const { data: finalRow, error: finalErr } = await supabase
    .from("evaluations")
    .select("id, batch_student_index")
    .eq("id", finalEvaluationId)
    .eq("teacher_id", teacherId)
    .eq("batch_id", batchId)
    .maybeSingle()

  if (finalErr) {
    return { ok: false, reason: finalErr.message, finalEvaluationId }
  }
  if (!finalRow?.id) {
    return { ok: false, skipped: true, reason: "final_evaluation_not_found", finalEvaluationId }
  }

  const { data: draftRows, error: draftErr } = await supabase
    .from("evaluations")
    .select("id")
    .eq("batch_id", batchId)
    .eq("batch_student_index", batchStudentIndex)
    .eq("teacher_id", teacherId)
    .neq("id", finalEvaluationId)
    .limit(1)

  if (draftErr) {
    return { ok: false, reason: draftErr.message, finalEvaluationId }
  }

  const draftEvaluationId = draftRows?.[0]?.id ? String(draftRows[0].id) : null

  const { data: slotPhotos, error: photosErr } = await supabase
    .from("batch_photo_uploads")
    .select("id, evaluation_id")
    .eq("batch_id", batchId)
    .eq("student_index", batchStudentIndex)
    .eq("teacher_id", teacherId)

  if (photosErr) {
    return { ok: false, reason: photosErr.message, finalEvaluationId }
  }

  const photos = (slotPhotos ?? []) as Array<{ id: string; evaluation_id: string | null }>
  const finalSlotIndex = (finalRow as { batch_student_index?: number | null }).batch_student_index ?? null
  const photosNeedingRelink = photos.filter((photo) => {
    const eid = photo.evaluation_id
    return eid == null || eid === draftEvaluationId || eid === finalEvaluationId
  })
  const photosAlreadyLinked =
    photos.length === 0 ||
    photos.every((photo) => photo.evaluation_id === finalEvaluationId)

  if (
    finalSlotIndex === batchStudentIndex &&
    !draftEvaluationId &&
    photosAlreadyLinked &&
    photosNeedingRelink.every((photo) => photo.evaluation_id === finalEvaluationId)
  ) {
    return {
      ok: true,
      skipped: true,
      reason: "already_linked",
      draftEvaluationId: null,
      finalEvaluationId,
      relinkedPhotoCount: 0,
    }
  }

  if (draftEvaluationId) {
    const { error: archiveErr } = await supabase
      .from("evaluations")
      .update({ batch_student_index: null, status: "archived" })
      .eq("id", draftEvaluationId)
      .eq("teacher_id", teacherId)
      .eq("batch_id", batchId)

    if (archiveErr) {
      return { ok: false, reason: archiveErr.message, draftEvaluationId, finalEvaluationId }
    }
  }

  if (finalSlotIndex !== batchStudentIndex) {
    const { error: slotErr } = await supabase
      .from("evaluations")
      .update({ batch_student_index: batchStudentIndex })
      .eq("id", finalEvaluationId)
      .eq("teacher_id", teacherId)
      .eq("batch_id", batchId)

    if (slotErr) {
      return { ok: false, reason: slotErr.message, draftEvaluationId, finalEvaluationId }
    }
  }

  const photoIdsToRelink = photosNeedingRelink
    .filter((photo) => photo.evaluation_id !== finalEvaluationId)
    .map((photo) => photo.id)

  let relinkedPhotoCount = 0
  if (photoIdsToRelink.length > 0) {
    const nowIso = new Date().toISOString()
    const { data: relinkedRows, error: relinkErr } = await supabase
      .from("batch_photo_uploads")
      .update({
        evaluation_id: finalEvaluationId,
        status: "linked",
        processed_at: nowIso,
      })
      .eq("batch_id", batchId)
      .eq("student_index", batchStudentIndex)
      .eq("teacher_id", teacherId)
      .in("id", photoIdsToRelink)
      .select("id")

    if (relinkErr) {
      return { ok: false, reason: relinkErr.message, draftEvaluationId, finalEvaluationId }
    }
    relinkedPhotoCount = (relinkedRows ?? []).length
  }

  return {
    ok: true,
    draftEvaluationId,
    finalEvaluationId,
    relinkedPhotoCount,
  }
}
