/**
 * Motor prueba base: usa axis_id y skill_id de source_exam_items.
 * Prioridad en la app: source_exam > structured > text (véase resolvePedagogyMode en pedagogy-mode.ts).
 * Cuando evaluation.source_exam_id existe (o asociación en evaluation_source_exams), este motor
 * mapea por item_number, calcula logro por eje/habilidad y devuelve filas para evaluation_skill_results.
 * Capa aditiva: no reemplaza /api/evaluate ni OCR/OMR.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SkillRowForInsert, GenerateSkillsFromItemsResult } from "@/app/lib/generate-skills-from-items"
import { getSourceExamForEvaluation } from "@/app/lib/source-exam-db"

export async function generateSkillsFromSourceExam(
  supabase: SupabaseClient,
  evaluationId: string
): Promise<GenerateSkillsFromItemsResult | null> {
  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select("id, subject, source_exam_id")
    .eq("id", evaluationId)
    .maybeSingle()

  if (evErr || !evaluation) return null

  const sourceExamId =
    (await getSourceExamForEvaluation(supabase, evaluationId)) ??
    (evaluation as { source_exam_id?: string | null }).source_exam_id ??
    null
  if (!sourceExamId) return null
  const subject = (evaluation as { subject?: string | null }).subject ?? "Lenguaje"

  const { data: sourceItems } = await supabase
    .from("source_exam_items")
    .select("item_number, axis_id, skill_id")
    .eq("source_exam_id", sourceExamId)
    .order("item_number", { ascending: true })

  const sourceMap = new Map<number, { axis_id: string; skill_id: string }>()
  for (const it of sourceItems ?? []) {
    const num = Number((it as { item_number?: number | null }).item_number)
    const axisId = (it as { axis_id?: string | null }).axis_id
    const skillId = (it as { skill_id?: string | null }).skill_id
    if (axisId && skillId) sourceMap.set(num, { axis_id: axisId, skill_id: skillId })
  }

  const { data: items } = await supabase
    .from("evaluation_items")
    .select("question_number, score_obtained, score_max, is_correct, student_answer, correct_answer")
    .eq("evaluation_id", evaluationId)
    .order("question_number", { ascending: true })

  const itemsList = (items ?? []) as Array<{
    question_number?: number | null
    score_obtained?: number | null
    score_max?: number | null
    is_correct?: boolean | null
    student_answer?: string | null
    correct_answer?: string | null
  }>
  if (itemsList.length === 0) return null

  const { data: esRows } = await supabase
    .from("evaluation_students")
    .select("student_profile_id")
    .eq("evaluation_id", evaluationId)
    .not("student_profile_id", "is", null)
  const profileIds = [
    ...new Set(
      (esRows ?? []).map((r) => (r as { student_profile_id: string }).student_profile_id).filter(Boolean)
    ),
  ] as string[]

  const agg = new Map<string, { obtained: number; max: number }>()
  const key = (a: string, b: string) => `${a}\t${b}`
  const addScore = (axisId: string, skillId: string, obtained: number, max: number) => {
    const k = key(axisId, skillId)
    const cur = agg.get(k) ?? { obtained: 0, max: 0 }
    agg.set(k, { obtained: cur.obtained + obtained, max: cur.max + (max > 0 ? max : 1) })
  }

  for (const item of itemsList) {
    const num = Number(item.question_number) ?? 0
    const mapping = sourceMap.get(num)
    if (!mapping) continue

    let obtained = 0
    let max = 0
    if (Number(item.score_max) === 1) {
      const isCorrect =
        item.is_correct === true ||
        (item.score_obtained != null && Number(item.score_obtained) >= 1) ||
        (item.student_answer != null &&
          item.correct_answer != null &&
          String(item.student_answer).trim().toUpperCase() === String(item.correct_answer).trim().toUpperCase())
      obtained = isCorrect ? 1 : 0
      max = 1
    } else {
      obtained = Number(item.score_obtained) || 0
      max = Number(item.score_max) || 0
    }
    addScore(mapping.axis_id, mapping.skill_id, obtained, max > 0 ? max : 1)
  }

  const skillRows: SkillRowForInsert[] = []
  for (const [k, v] of agg) {
    const [axis_id, skill_id] = k.split("\t")
    skillRows.push({
      axis_id,
      skill_id,
      score_obtained: v.obtained,
      score_max: v.max,
      accuracy: v.max > 0 ? v.obtained / v.max : null,
    })
  }

  return {
    profileIds,
    skillRows,
    subject,
    items_count: itemsList.length,
    sample_item_texts: [],
    sample_computed_rows: skillRows.slice(0, 5),
  }
}
