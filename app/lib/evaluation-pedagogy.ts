import type { SupabaseClient } from "@supabase/supabase-js"
import { analyzeLearningResults, type EvaluationItemRow, type SourceExamItemWithPedagogy } from "@/app/lib/analyze-learning-results"
import { enrichItemsWithPedagogy } from "@/app/lib/analyze-pedagogical-structure"
import { extractQuestionNumber } from "@/app/lib/extract-question-number"
import { getSourceExamForEvaluation } from "@/app/lib/source-exam-db"

type EvalInput = { id: string }

type ResolveOptions = {
  evaluationItems?: EvaluationItemRow[]
  sourceExamItems?: SourceExamItemWithPedagogy[]
}

export type EvaluationPedagogyResolution = {
  evaluation_id: string
  source_exam_id: string | null
  has_source_exam: boolean
  has_evaluation_items: boolean
  has_source_exam_items: boolean
  matched_items_count: number
  skills_count: number
  analysis_available: boolean
  reason_missing:
    | "ok"
    | "missing_source_exam"
    | "missing_evaluation_items"
    | "missing_source_exam_items"
    | "missing_item_matches"
    | "missing_skill_groups"
  evaluation_items: EvaluationItemRow[]
  source_exam_items: SourceExamItemWithPedagogy[]
  analysis: ReturnType<typeof analyzeLearningResults>
}

function countMatchedItems(evaluationItems: EvaluationItemRow[], sourceExamItems: SourceExamItemWithPedagogy[]): number {
  const sourceNumbers = new Set<number>()
  for (const s of sourceExamItems) {
    const n = extractQuestionNumber(s.item_number)
    if (n != null) sourceNumbers.add(n)
  }
  let matched = 0
  for (const e of evaluationItems) {
    const qn = extractQuestionNumber(e.question_number)
    if (qn != null && sourceNumbers.has(qn)) matched += 1
  }
  return matched
}

export async function resolveEvaluationPedagogy(
  supabase: SupabaseClient,
  evaluation: EvalInput,
  options?: ResolveOptions,
): Promise<EvaluationPedagogyResolution> {
  const evaluationId = String(evaluation.id ?? "").trim()
  const sourceExamId = await getSourceExamForEvaluation(supabase, evaluationId)

  const evaluationItems =
    options?.evaluationItems ??
    (
      (
        await supabase
          .from("evaluation_items")
          .select("question_number, score_obtained, score_max")
          .eq("evaluation_id", evaluationId)
      ).data ?? []
    ).map((row) => ({
      question_number: extractQuestionNumber((row as { question_number?: unknown }).question_number) ?? Number.NaN,
      score_obtained: Number((row as { score_obtained?: unknown }).score_obtained),
      score_max: Number((row as { score_max?: unknown }).score_max),
    }))

  let sourceExamItems = options?.sourceExamItems ?? []
  if (!options?.sourceExamItems && sourceExamId) {
    const { data: sourceRows } = await supabase
      .from("source_exam_items")
      .select("item_number, item_text, axis_label, skill_label, cognitive_level, max_score, rubric_text, question_type")
      .eq("source_exam_id", sourceExamId)
    sourceExamItems = enrichItemsWithPedagogy((sourceRows ?? []) as SourceExamItemWithPedagogy[])
  }

  const analysis = analyzeLearningResults(evaluationId, evaluationItems, sourceExamItems)
  const matchedItemsCount = countMatchedItems(evaluationItems, sourceExamItems)
  const skillsCount = analysis.by_skill.length

  const hasSourceExam = Boolean(sourceExamId)
  const hasEvaluationItems = evaluationItems.length > 0
  const hasSourceExamItems = sourceExamItems.length > 0
  const analysisAvailable = hasSourceExam && hasEvaluationItems && hasSourceExamItems && skillsCount > 0

  let reasonMissing: EvaluationPedagogyResolution["reason_missing"] = "ok"
  if (!hasSourceExam) reasonMissing = "missing_source_exam"
  else if (!hasEvaluationItems) reasonMissing = "missing_evaluation_items"
  else if (!hasSourceExamItems) reasonMissing = "missing_source_exam_items"
  else if (matchedItemsCount === 0) reasonMissing = "missing_item_matches"
  else if (skillsCount === 0) reasonMissing = "missing_skill_groups"

  return {
    evaluation_id: evaluationId,
    source_exam_id: sourceExamId,
    has_source_exam: hasSourceExam,
    has_evaluation_items: hasEvaluationItems,
    has_source_exam_items: hasSourceExamItems,
    matched_items_count: matchedItemsCount,
    skills_count: skillsCount,
    analysis_available: analysisAvailable,
    reason_missing: reasonMissing,
    evaluation_items: evaluationItems,
    source_exam_items: sourceExamItems,
    analysis,
  }
}
