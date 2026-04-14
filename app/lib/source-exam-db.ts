/**
 * Utilidades de acceso a prueba base (source_exam) y asociación con evaluaciones.
 * Capa aditiva: no modifica flujos existentes. Lectura/escritura a tablas source_exams,
 * source_exam_items y evaluation_source_exams. evaluations.source_exam_id se mantiene
 * por compatibilidad con generateSkillsFromSourceExam y backfill.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SourceExamRow, SourceExamItemRow, EvaluationSourceExamRow } from "@/app/lib/source-exam-types"

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

/**
 * Obtiene una prueba base por id. Solo lectura; no toca evaluations.
 */
export async function getSourceExamById(
  supabase: SupabaseClient,
  sourceExamId: string
): Promise<SourceExamRow | null> {
  const { data, error } = await supabase
    .from("source_exams")
    .select("*")
    .eq("id", sourceExamId)
    .maybeSingle()
  if (error && isDev) console.warn("[source-exam-db] getSourceExamById", error.message)
  return (data as SourceExamRow | null) ?? null
}

/**
 * Obtiene los ítems de una prueba base, ordenados por item_number.
 * No mezcla con evaluation_items.
 */
export async function getSourceExamItems(
  supabase: SupabaseClient,
  sourceExamId: string
): Promise<SourceExamItemRow[]> {
  const { data, error } = await supabase
    .from("source_exam_items")
    .select("*")
    .eq("source_exam_id", sourceExamId)
    .order("item_number", { ascending: true })
  if (error && isDev) console.warn("[source-exam-db] getSourceExamItems", error.message)
  return (data as SourceExamItemRow[]) ?? []
}

/**
 * Obtiene el source_exam_id asociado a una evaluación.
 * Lee `evaluation_source_exams` y `evaluations.source_exam_id`.
 * Si ambos existen y difieren, gana la columna `evaluations.source_exam_id` (la escriben persistencia y PATCH /meta;
 * la puente obsoleta no debe ocultar el vínculo real del docente).
 * No modifica ningún documento.
 */
export async function getSourceExamForEvaluation(
  supabase: SupabaseClient,
  evaluationId: string
): Promise<string | null> {
  let bridgeId: string | null = null
  try {
    const { data: bridge, error: bridgeErr } = await supabase
      .from("evaluation_source_exams")
      .select("source_exam_id")
      .eq("evaluation_id", evaluationId)
      .maybeSingle()
    if (!bridgeErr && bridge && (bridge as EvaluationSourceExamRow).source_exam_id) {
      const raw = String((bridge as EvaluationSourceExamRow).source_exam_id).trim()
      bridgeId = raw || null
    }
  } catch {
    if (isDev) console.warn("[source-exam-db] getSourceExamForEvaluation bridge read skipped (table may not exist)")
  }

  const { data: ev } = await supabase
    .from("evaluations")
    .select("source_exam_id")
    .eq("id", evaluationId)
    .maybeSingle()
  const colRaw = (ev as { source_exam_id?: string | null } | null)?.source_exam_id
  const columnId = colRaw != null && String(colRaw).trim() !== "" ? String(colRaw).trim() : null

  if (columnId && bridgeId && columnId !== bridgeId) {
    if (isDev) {
      console.warn("[source-exam-db] getSourceExamForEvaluation mismatch; using evaluations.source_exam_id", {
        evaluationId,
        evaluation_source_exams: bridgeId,
        evaluations_column: columnId,
      })
    }
    return columnId
  }
  if (bridgeId) {
    return bridgeId
  }
  return columnId
}

/**
 * Asocia una evaluación a una prueba base de forma segura.
 * Escribe en evaluation_source_exams (si la tabla existe) y en evaluations.source_exam_id.
 * Si la tabla puente no existe aún, solo actualiza evaluations.source_exam_id para no romper nada.
 * No toca evaluation_items ni el flujo de corrección.
 */
export async function associateEvaluationToSourceExam(
  supabase: SupabaseClient,
  payload: { evaluation_id: string; source_exam_id: string }
): Promise<{ ok: boolean; error?: string }> {
  const { evaluation_id, source_exam_id } = payload
  try {
    const { error: bridgeErr } = await supabase.from("evaluation_source_exams").upsert(
      { evaluation_id, source_exam_id },
      { onConflict: "evaluation_id" }
    )
    if (bridgeErr && isDev) console.warn("[source-exam-db] associateEvaluationToSourceExam bridge", bridgeErr.message)
    const { error: evErr } = await supabase
      .from("evaluations")
      .update({ source_exam_id })
      .eq("id", evaluation_id)
    if (evErr) {
      if (isDev) console.warn("[source-exam-db] associateEvaluationToSourceExam evaluations", evErr.message)
      return { ok: false, error: evErr.message }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isDev) console.warn("[source-exam-db] associateEvaluationToSourceExam", msg)
    return { ok: false, error: msg }
  }
}

/**
 * Desasocia la prueba base de una evaluación.
 * Borra de evaluation_source_exams (si existe) y pone evaluations.source_exam_id = null.
 * Si la tabla puente no existe, solo actualiza evaluations.
 */
export async function disassociateEvaluationFromSourceExam(
  supabase: SupabaseClient,
  evaluationId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await supabase.from("evaluation_source_exams").delete().eq("evaluation_id", evaluationId)
  } catch {
    if (isDev) console.warn("[source-exam-db] disassociateEvaluationFromSourceExam bridge delete skipped")
  }
  const { error: evErr } = await supabase
    .from("evaluations")
    .update({ source_exam_id: null })
    .eq("id", evaluationId)
  if (evErr) {
    if (isDev) console.warn("[source-exam-db] disassociateEvaluationFromSourceExam", evErr.message)
    return { ok: false, error: evErr.message }
  }
  return { ok: true }
}
