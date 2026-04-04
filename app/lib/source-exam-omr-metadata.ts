/**
 * Metadatos OMR desde prueba base (source_exam): prioriza total_questions en BD,
 * si no existe cuenta ítems cerrados con la misma lógica que evaluation-base.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buildEvaluationBase,
  isEvaluationBaseItemClosedForOmr,
  type EvaluationBaseSourceExamInput,
} from "./evaluation-base"

export type ResolvedSourceExamOmrMetadata = {
  totalQuestionsAuthoritative: number
  source: "source_exam.total_questions" | "source_exam_items_omr_closed"
  sourceExamId: string
  itemsClosedCount: number
}

export async function resolveSourceExamOmrMetadata(
  supabase: SupabaseClient,
  params: { sourceExamId: string; teacherId: string },
): Promise<ResolvedSourceExamOmrMetadata | null> {
  const id = params.sourceExamId.trim()
  if (!id || !String(params.teacherId ?? "").trim()) return null

  const { data: exam, error: examErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id, total_questions")
    .eq("id", id)
    .maybeSingle()

  if (examErr || !exam) return null

  if (String(exam.teacher_id) !== String(params.teacherId)) {
    console.warn("[source-exam-omr-metadata] source_exam_id no pertenece al docente; ignorado", { id })
    return null
  }

  const { data: rows, error: itemsErr } = await supabase
    .from("source_exam_items")
    .select("id, item_number, item_text, question_type, correct_answer, max_score, rubric_text")
    .eq("source_exam_id", id)

  if (itemsErr) {
    console.warn("[source-exam-omr-metadata] lectura source_exam_items:", itemsErr.message)
  }

  const input: EvaluationBaseSourceExamInput = {
    items: (rows ?? []).map((r) => ({
      rowId: String(r.id),
      item_number: r.item_number,
      item_text: r.item_text,
      question_type: r.question_type,
      correct_answer: r.correct_answer,
      max_score: r.max_score,
      rubric_text: r.rubric_text,
    })),
  }

  const eb = buildEvaluationBase({ sourceExam: input })
  const itemsClosedCount = eb.items.filter(isEvaluationBaseItemClosedForOmr).length

  const rawCol = (exam as { total_questions?: number | null }).total_questions
  const nCol =
    rawCol != null && Number.isFinite(Number(rawCol)) && Number(rawCol) > 0 ? Math.round(Number(rawCol)) : null

  if (nCol != null) {
    if (itemsClosedCount > 0 && nCol !== itemsClosedCount) {
      console.info(
        "[source-exam-omr-metadata] total_questions ≠ conteo ítems OMR cerrados; el mapa usa total_questions",
        { sourceExamId: id, total_questions: nCol, itemsClosedCount },
      )
    }
    return {
      totalQuestionsAuthoritative: nCol,
      source: "source_exam.total_questions",
      sourceExamId: id,
      itemsClosedCount,
    }
  }

  if (itemsClosedCount > 0) {
    return {
      totalQuestionsAuthoritative: itemsClosedCount,
      source: "source_exam_items_omr_closed",
      sourceExamId: id,
      itemsClosedCount,
    }
  }

  return null
}

/** Clave de plantilla para el pipeline: solo template_38_4 cuando hay exactamente 38 cerradas declaradas. */
export function omrTemplateKeyForClosedQuestionCount(n: number): string {
  const k = Math.max(1, Math.round(n))
  if (k === 38) return "template_38_4"
  return `template_nc_${k}_4`
}
