import type { SupabaseClient } from "@supabase/supabase-js"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { normalizeRutCanonical } from "@/app/lib/student-identity/rut"

export type PromoteBatchStudentResult =
  | { ok: true; evaluation_id: string; already_existed?: false }
  | { ok: true; evaluation_id: string; already_existed: true }
  | { ok: false; error: string; code?: string }

type SessionRow = {
  teacher_id: string
  school_id: string
  expected_pages_per_student: number | null
  source_exam_id: string | null
}

type PhotoRow = {
  id: string
  storage_path: string | null
  page_index: number | null
  student_index: number | null
  evaluation_id: string | null
}

function buildPathsByDistinctPage(list: PhotoRow[]): string[] {
  const byPage = new Map<number, PhotoRow[]>()
  for (const row of list) {
    const p = row.page_index != null ? Math.floor(Number(row.page_index)) : null
    if (p == null || !Number.isFinite(p) || p < 1) continue
    const arr = byPage.get(p) ?? []
    arr.push(row)
    byPage.set(p, arr)
  }
  const pageKeys = [...byPage.keys()].sort((a, b) => a - b)
  const pathsOrdered: string[] = []
  for (const p of pageKeys) {
    const first = (byPage.get(p) ?? []).find((r) => r.storage_path)
    if (first?.storage_path) pathsOrdered.push(first.storage_path)
  }
  return pathsOrdered
}

/** Vincula fotos huérfanas del alumno a una evaluación ya existente y fusiona scan_image_paths. */
async function linkOrphanPhotosToEvaluation(
  supabase: SupabaseClient,
  evaluationId: string,
  batchId: string,
  studentIndex: number,
): Promise<string | null> {
  const { data: photos, error: pErr } = await supabase
    .from("batch_photo_uploads")
    .select("id, storage_path, page_index, student_index, evaluation_id")
    .eq("batch_id", batchId)
    .eq("student_index", studentIndex)
    .is("evaluation_id", null)
    .order("page_index", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(200)

  if (pErr) return pErr.message
  const list = (photos ?? []) as PhotoRow[]
  if (list.length === 0) return null

  const pathsOrdered = buildPathsByDistinctPage(list)
  if (pathsOrdered.length === 0) return null

  const { data: evRow, error: evErr } = await supabase
    .from("evaluations")
    .select("scan_image_paths")
    .eq("id", evaluationId)
    .maybeSingle()
  if (evErr) return evErr.message

  const rawPrev = (evRow as { scan_image_paths?: unknown } | null)?.scan_image_paths
  const prev = Array.isArray(rawPrev)
    ? rawPrev.filter((p): p is string => typeof p === "string" && p.length > 0)
    : []
  const merged: string[] = [...prev]
  for (const p of pathsOrdered) {
    if (!merged.includes(p)) merged.push(p)
  }

  const { error: upEv } = await supabase
    .from("evaluations")
    .update({ scan_image_paths: merged })
    .eq("id", evaluationId)
  if (upEv) return upEv.message

  const photoIds = list.map((r) => r.id).filter(Boolean)
  const { error: upPh } = await supabase
    .from("batch_photo_uploads")
    .update({
      evaluation_id: evaluationId,
      processed_at: new Date().toISOString(),
      status: "linked",
      processing_error: null,
    })
    .in("id", photoIds)
  if (upPh) return upPh.message
  return null
}

/**
 * Crea una fila en evaluations (y resumen mínimo + estudiante) a partir de las fotos
 * de un alumno en el lote, si hay suficientes page_index distintas.
 */
export async function promoteBatchStudentToEvaluation(opts: {
  supabase: SupabaseClient
  userId: string
  teacherId: string
  schoolId: string
  batchId: string
  studentIndex: number
  department?: string | null
  course_label?: string | null
  subject?: string | null
  /** RUT detectado en móvil/OCR (opcional): busca nombre en public.students y guarda student_identifier. */
  student_rut?: string | null
}): Promise<PromoteBatchStudentResult> {
  const {
    supabase,
    userId,
    teacherId,
    schoolId,
    batchId,
    studentIndex,
    department,
    course_label: courseLabel,
    subject,
    student_rut: studentRutOpt,
  } = opts

  if (!Number.isFinite(studentIndex) || studentIndex < 1) {
    return { ok: false, error: "student_index inválido" }
  }

  const { data: session, error: sErr } = await supabase
    .from("batch_scan_sessions")
    .select("teacher_id, school_id, expected_pages_per_student, source_exam_id")
    .eq("batch_id", batchId)
    .maybeSingle()

  if (sErr) return { ok: false, error: sErr.message, code: sErr.code }
  const sess = session as SessionRow | null
  if (!sess) return { ok: false, error: "Lote no registrado" }
  if (String(sess.teacher_id) !== String(teacherId)) {
    return { ok: false, error: "El lote no pertenece a tu perfil docente" }
  }

  const expectedPages = Math.max(
    1,
    Math.min(50, Number(sess.expected_pages_per_student ?? 2) || 2),
  )

  const { data: existingEval } = await supabase
    .from("evaluations")
    .select("id")
    .eq("batch_id", batchId)
    .eq("batch_student_index", studentIndex)
    .maybeSingle()

  if (existingEval?.id) {
    const eid = String(existingEval.id)
    const linkErr = await linkOrphanPhotosToEvaluation(supabase, eid, batchId, studentIndex)
    if (linkErr) {
      return { ok: false, error: linkErr }
    }
    return { ok: true, evaluation_id: eid, already_existed: true }
  }

  const { data: photos, error: pErr } = await supabase
    .from("batch_photo_uploads")
    .select("id, storage_path, page_index, student_index, evaluation_id")
    .eq("batch_id", batchId)
    .eq("student_index", studentIndex)
    .is("evaluation_id", null)
    .order("page_index", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(200)

  if (pErr) return { ok: false, error: pErr.message, code: pErr.code }

  const list = (photos ?? []) as PhotoRow[]
  const pathsOrdered = buildPathsByDistinctPage(list)
  if (pathsOrdered.length < expectedPages) {
    return {
      ok: false,
      error: `Faltan fotos: hay ${pathsOrdered.length} página(s) distinta(s), se requieren ${expectedPages}.`,
      code: "INCOMPLETE_PAGES",
    }
  }

  let displayStudentName = `Alumno lote · índice ${studentIndex}`
  let studentIdentifier: string | null = null
  const rutRaw = studentRutOpt != null ? String(studentRutOpt).trim() : ""
  if (rutRaw) {
    const rutNorm = normalizeRutCanonical(rutRaw)
    if (rutNorm) {
      studentIdentifier = rutRaw
      const { data: stuRow } = await supabase.from("students").select("full_name").eq("rut_norm", rutNorm).maybeSingle()
      const fn = (stuRow as { full_name?: string | null } | null)?.full_name?.trim()
      if (fn) displayStudentName = fn
    }
  }

  const titleParts = [displayStudentName, `Índice ${studentIndex}`]
  if (courseLabel?.trim()) titleParts.push(courseLabel.trim())
  const title = titleParts.join(" · ").slice(0, 500)
  const subjectFinal = (subject?.trim() || "Escaneo móvil").slice(0, 200)
  const courseLabelFinal = courseLabel?.trim() || null
  const sourceExamId = sess.source_exam_id ? String(sess.source_exam_id) : null

  const scanPathsJson = pathsOrdered

  const { data: inserted, error: insErr } = await supabase
    .from("evaluations")
    .insert({
      school_id: schoolId,
      teacher_id: teacherId,
      user_id: userId,
      batch_id: batchId,
      batch_student_index: studentIndex,
      title,
      subject: subjectFinal,
      course_label: courseLabelFinal,
      evaluated_at: new Date().toISOString(),
      status: "draft",
      source_exam_id: sourceExamId,
      scan_image_paths: scanPathsJson,
      capture_source: "batch_scan",
    })
    .select("id")
    .single()

  if (insErr || !inserted?.id) {
    if (String(insErr?.code) === "23505") {
      const { data: again } = await supabase
        .from("evaluations")
        .select("id")
        .eq("batch_id", batchId)
        .eq("batch_student_index", studentIndex)
        .maybeSingle()
      if (again?.id) return { ok: true, evaluation_id: String(again.id), already_existed: true }
    }
    return { ok: false, error: insErr?.message ?? "No se pudo crear la evaluación" }
  }

  const evaluationId = String(inserted.id)

  const rawMeta = {
    capture_source: "batch_scan",
    batch_id: batchId,
    batch_student_index: studentIndex,
    scan_bucket: BATCH_SCANS_BUCKET,
    scan_storage_paths: scanPathsJson,
    department: department ?? null,
  }

  const { error: sumErr } = await supabase.from("evaluation_summaries").insert({
    evaluation_id: evaluationId,
    grade_chile: null,
    strengths: null,
    improvements: null,
    raw: rawMeta,
  })

  if (sumErr) {
    await supabase.from("evaluations").delete().eq("id", evaluationId)
    return { ok: false, error: sumErr.message, code: sumErr.code }
  }

  const studentNormalized = displayStudentName.trim().toLowerCase()
  const { error: stErr } = await supabase.from("evaluation_students").insert({
    evaluation_id: evaluationId,
    student_name: displayStudentName,
    student_normalized: studentNormalized,
    course_label: courseLabelFinal,
    ...(studentIdentifier ? { student_identifier: studentIdentifier } : {}),
  })

  if (stErr) {
    await supabase.from("evaluation_summaries").delete().eq("evaluation_id", evaluationId)
    await supabase.from("evaluations").delete().eq("id", evaluationId)
    return { ok: false, error: stErr.message, code: stErr.code }
  }

  const photoIds = list.map((r) => r.id).filter(Boolean)
  const { error: upErr } = await supabase
    .from("batch_photo_uploads")
    .update({
      evaluation_id: evaluationId,
      processed_at: new Date().toISOString(),
      status: "linked",
      processing_error: null,
    })
    .in("id", photoIds)

  if (upErr) {
    return { ok: false, error: `Evaluación creada pero no se vincularon fotos: ${upErr.message}` }
  }

  return { ok: true, evaluation_id: evaluationId }
}
