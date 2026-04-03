import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { getSourceExamForEvaluation } from "@/app/lib/source-exam-db"
import { convertToNationalScore, nationalLevelLabel } from "@/app/lib/standard-scale/converters"

export const dynamic = "force-dynamic"

const PEDAGOGY_ENABLED = process.env.ENABLE_PEDAGOGY === "true"

function simceLevel(accuracy: number): "Avanzado" | "Intermedio" | "Inicial" {
  if (accuracy >= 0.75) return "Avanzado"
  if (accuracy >= 0.5) return "Intermedio"
  return "Inicial"
}

function isOmittedAnswer(answer: string | null | undefined): boolean {
  return answer == null || String(answer).trim() === ""
}

/**
 * GET /api/evaluations/[id]/analysis?mode=simce
 * Usa evaluation_items (is_correct) + evaluation_question_tags.
 * Retorna bySkill, byAxis, y opcionalmente simceLevels si mode=simce.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!PEDAGOGY_ENABLED) {
    return NextResponse.json({ step: "config", message: "Pedagogy no habilitado" }, { status: 404 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ step: "auth", message: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ step: "config", message: "Supabase no configurado" }, { status: 503 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ step: "validation", message: "Falta id" }, { status: 400 })
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacher_id = profileRow?.teacher_id ?? profile?.teacher_id ?? null
  if (!teacher_id) {
    return NextResponse.json({ step: "profile", message: "Perfil incompleto" }, { status: 403 })
  }

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id")
    .eq("id", id)
    .eq("teacher_id", teacher_id)
    .maybeSingle()

  if (!evaluation) {
    return NextResponse.json({ step: "evaluation", message: "No encontrada o sin permiso" }, { status: 404 })
  }

  const modeSimce = req.nextUrl.searchParams.get("mode") === "simce"
  // PHASE_2_SCALES_V1
  const requestedYear = Number(req.nextUrl.searchParams.get("year") || 2026)
  const scaleYear = Number.isFinite(requestedYear) && requestedYear > 0 ? Math.floor(requestedYear) : 2026

  const sourceExamId = await getSourceExamForEvaluation(supabase, id)

  const [itemsRes, tagsRes, sourceItemsRes] = await Promise.all([
    // LOGICA_ANTERIOR_LOCAL: .select("question_number, is_correct")
    // DATA_SCIENCE_FIX_V1: incluir respuesta y puntajes para clasificar omitidas y logro fiel.
    supabase
      .from("evaluation_items")
      .select("question_number, is_correct, student_answer, score_obtained, score_max")
      .eq("evaluation_id", id),
    supabase.from("evaluation_question_tags").select("question_number, axis_id, skill_id").eq("evaluation_id", id),
    sourceExamId
      ? supabase.from("source_exam_items").select("item_number, max_score").eq("source_exam_id", sourceExamId)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])

  if (itemsRes.error) {
    return NextResponse.json({ step: "items", message: itemsRes.error.message }, { status: 500 })
  }
  if (tagsRes.error) {
    return NextResponse.json({ step: "tags", message: tagsRes.error.message }, { status: 500 })
  }

  const items = (itemsRes.data ?? []) as Array<{
    question_number: number
    is_correct: boolean | null
    student_answer: string | null
    score_obtained: number | null
    score_max: number | null
  }>
  const tags = (tagsRes.data ?? []) as Array<{ question_number: number; axis_id: string | null; skill_id: string | null }>
  const sourceItems = (sourceItemsRes.data ?? []) as Array<{ item_number: number | null; max_score: number | null }>

  const itemByQuestion = new Map(items.map((i) => [i.question_number, i]))
  const sourceMaxByQuestion = new Map<number, number>()
  for (const s of sourceItems) {
    const q = Number(s.item_number)
    if (!Number.isFinite(q) || q <= 0) continue
    sourceMaxByQuestion.set(q, Number(s.max_score) || 0)
  }
  const pautaTotalMaxRaw = sourceItems.reduce((acc, s) => acc + (Number(s.max_score) || 0), 0)

  if (tags.length === 0) {
    return NextResponse.json({
      bySkill: [],
      byAxis: [],
      counts: { correct: 0, incorrect: 0, omitted: 0, answered: 0, total: 0 },
      logro_pct: 0,
      pauta_total_max: pautaTotalMaxRaw > 0 ? pautaTotalMaxRaw : 0,
      // PHASE_2_SCALES_V1
      projections: {
        simce_estimated: null,
        paes_estimated: null,
        level_label: null,
        year: scaleYear,
      },
      simceLevels: modeSimce ? { bySkill: [], byAxis: [] } : undefined,
      message: "Sin etiquetado pedagógico",
    })
  }

  const skillStats = new Map<string, { correct: number; incorrect: number; omitted: number; total: number; answered: number }>()
  const axisStats = new Map<string, { correct: number; incorrect: number; omitted: number; total: number; answered: number }>()
  const skillNames = new Map<string, string>()
  const axisNames = new Map<string, string>()
  let totalCorrect = 0
  let totalIncorrect = 0
  let totalOmitted = 0
  let totalObtained = 0
  let totalMaxFromTags = 0

  for (const t of tags) {
    const item = itemByQuestion.get(t.question_number)
    const correct = item?.is_correct === true
    const omitted = isOmittedAnswer(item?.student_answer)
    const incorrect = !correct && !omitted
    const scoreObtained = Number(item?.score_obtained) || 0
    const scoreMaxFromSource = sourceMaxByQuestion.get(t.question_number) ?? 0
    const scoreMaxItem = Number(item?.score_max) || 0
    const scoreMax = scoreMaxFromSource > 0 ? scoreMaxFromSource : scoreMaxItem
    totalObtained += scoreObtained
    totalMaxFromTags += scoreMax > 0 ? scoreMax : 0
    if (correct) totalCorrect++
    else if (incorrect) totalIncorrect++
    else totalOmitted++
    if (t.skill_id) {
      const s = skillStats.get(t.skill_id) ?? { correct: 0, incorrect: 0, omitted: 0, total: 0, answered: 0 }
      s.total++
      if (correct) s.correct++
      if (incorrect) s.incorrect++
      if (omitted) s.omitted++
      s.answered = s.correct + s.incorrect
      skillStats.set(t.skill_id, s)
    }
    if (t.axis_id) {
      const a = axisStats.get(t.axis_id) ?? { correct: 0, incorrect: 0, omitted: 0, total: 0, answered: 0 }
      a.total++
      if (correct) a.correct++
      if (incorrect) a.incorrect++
      if (omitted) a.omitted++
      a.answered = a.correct + a.incorrect
      axisStats.set(t.axis_id, a)
    }
  }

  const skillIds = Array.from(skillStats.keys())
  const axisIds = Array.from(axisStats.keys())
  if (skillIds.length > 0) {
    const { data: skills } = await supabase.from("pedagogy_skills").select("id, name, axis_id").in("id", skillIds)
    for (const s of skills ?? []) {
      skillNames.set(s.id, s.name)
    }
  }
  if (axisIds.length > 0) {
    const { data: axes } = await supabase.from("pedagogy_axes").select("id, name").in("id", axisIds)
    for (const a of axes ?? []) {
      axisNames.set(a.id, a.name)
    }
  }

  const bySkill = Array.from(skillStats.entries()).map(([skill_id, s]) => {
    // LOGICA_ANTERIOR_LOCAL: const accuracy = s.total > 0 ? s.correct / s.total : 0
    // DATA_SCIENCE_FIX_V1: omisiones fuera del denominador de precision.
    const accuracy = s.answered > 0 ? s.correct / s.answered : 0
    return {
      skill_id,
      skill_name: skillNames.get(skill_id) ?? skill_id,
      correct: s.correct,
      incorrect: s.incorrect,
      omitted: s.omitted,
      answered: s.answered,
      total: s.total,
      accuracy,
      ...(modeSimce && { level: simceLevel(accuracy) }),
    }
  })

  const byAxis = Array.from(axisStats.entries()).map(([axis_id, a]) => {
    // LOGICA_ANTERIOR_LOCAL: const accuracy = a.total > 0 ? a.correct / a.total : 0
    // DATA_SCIENCE_FIX_V1: omisiones fuera del denominador de precision.
    const accuracy = a.answered > 0 ? a.correct / a.answered : 0
    return {
      axis_id,
      axis_name: axisNames.get(axis_id) ?? axis_id,
      correct: a.correct,
      incorrect: a.incorrect,
      omitted: a.omitted,
      answered: a.answered,
      total: a.total,
      accuracy,
      ...(modeSimce && { level: simceLevel(accuracy) }),
    }
  })

  const pautaTotalMax = pautaTotalMaxRaw > 0 ? pautaTotalMaxRaw : totalMaxFromTags
  const logroPct = pautaTotalMax > 0 ? Math.round((totalObtained / pautaTotalMax) * 100) : 0
  // PHASE_2_SCALES_V1
  const simceEstimated = convertToNationalScore(logroPct, "simce", scaleYear)
  const paesEstimated = convertToNationalScore(logroPct, "paes", scaleYear)
  const levelLabel = nationalLevelLabel(logroPct)

  return NextResponse.json({
    bySkill,
    byAxis,
    counts: {
      correct: totalCorrect,
      incorrect: totalIncorrect,
      omitted: totalOmitted,
      answered: totalCorrect + totalIncorrect,
      total: totalCorrect + totalIncorrect + totalOmitted,
    },
    logro_pct: logroPct,
    pauta_total_max: pautaTotalMax,
    // PHASE_2_SCALES_V1
    projections: {
      simce_estimated: simceEstimated,
      paes_estimated: paesEstimated,
      level_label: levelLabel,
      year: scaleYear,
    },
    ...(modeSimce && {
      simceLevels: {
        bySkill: bySkill.map((s) => ({ skill_id: s.skill_id, skill_name: s.skill_name, level: s.level })),
        byAxis: byAxis.map((a) => ({ axis_id: a.axis_id, axis_name: a.axis_name, level: a.level })),
      },
    }),
  })
}
