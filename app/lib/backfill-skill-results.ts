/**
 * Backfill de evaluation_skill_results para evaluaciones antiguas.
 * Reutiliza generateSkillsFromEvaluationItems (desde evaluation_items) para recálculo;
 * para backfill masivo sigue iterando evaluaciones y evitando duplicados.
 * No toca el flujo de evaluación ni persist-evaluation.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { evaluateSkillsFromEvaluation } from "@/app/lib/skill-evaluator"
import type { EvaluationResultForSkills } from "@/app/lib/skill-evaluator"
import { normalizeCourseLabel } from "@/app/lib/course-utils"
import { generateSkillsFromTextItems, type GenerateSkillsFromItemsResult } from "@/app/lib/generate-skills-from-items"
import { generateSkillsFromStructuredBlueprint } from "@/app/lib/generate-skills-structured"
import { generateSkillsFromSourceExam } from "@/app/lib/generate-skills-from-source-exam"
import { resolvePedagogyMode, hasEnoughTextInItems } from "@/app/lib/pedagogy-mode"

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

export interface BackfillSkillResultsOpts {
  supabase: SupabaseClient
  teacher_id: string
  course_label?: string | null
}

export interface BackfillSkillResultsResult {
  ok: boolean
  scanned_evaluations: number
  updated_evaluations: number
  inserted_rows: number
  error?: string
}

type ItemRow = {
  question_number?: number | null
  student_answer?: string | null
  correct_answer?: string | null
  is_correct?: boolean | null
  score_obtained?: number | null
  score_max?: number | null
}

/**
 * Construye un objeto mínimo compatible con evaluateSkillsFromEvaluation a partir de evaluation_items.
 */
function buildResultFromItems(items: ItemRow[]): EvaluationResultForSkills {
  const alternativas_corregidas = items
    .filter((i) => Number(i.score_max) === 1)
    .map((i) => ({
      pregunta: "Pregunta " + (i.question_number ?? 0),
      respuesta_estudiante: String(i.student_answer ?? ""),
      respuesta_correcta: String(i.correct_answer ?? ""),
    }))

  const detalle_desarrollo: Record<string, { puntaje?: string; texto_estudiante?: string }> = {}
  for (const i of items.filter((i) => Number(i.score_max) > 1)) {
    const key = "Pregunta " + (i.question_number ?? 0)
    detalle_desarrollo[key] = {
      puntaje: String(i.score_obtained ?? 0) + "/" + String(i.score_max ?? 0),
      texto_estudiante: String(i.student_answer ?? ""),
    }
  }

  return { alternativas_corregidas, detalle_desarrollo }
}

/**
 * Ejecuta backfill: por cada evaluación del profesor (opcionalmente filtrada por curso),
 * construye result desde evaluation_items, llama evaluateSkillsFromEvaluation e inserta
 * en evaluation_skill_results por cada student_profile_id, evitando duplicados.
 */
export async function backfillSkillResults(
  opts: BackfillSkillResultsOpts
): Promise<BackfillSkillResultsResult> {
  const { supabase, teacher_id, course_label } = opts
  let scanned_evaluations = 0
  let updated_evaluations = 0
  let inserted_rows = 0

  const normalizedCourse =
    course_label != null && String(course_label).trim() !== ""
      ? normalizeCourseLabel(String(course_label).trim())
      : null

  const { data: evaluations, error: evErr } = await supabase
    .from("evaluations")
    .select("id, subject, course_label")
    .eq("teacher_id", teacher_id)

  if (evErr) {
    return { ok: false, scanned_evaluations: 0, updated_evaluations: 0, inserted_rows: 0, error: evErr.message }
  }

  const evList = (evaluations ?? []).filter((e) => {
    if (normalizedCourse == null) return true
    return normalizeCourseLabel((e as { course_label?: string | null }).course_label) === normalizedCourse
  })

  for (const ev of evList) {
    const evaluationId = ev.id as string
    const subject = (ev as { subject?: string | null }).subject ?? "Lenguaje"
    scanned_evaluations++

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
    if (profileIds.length === 0) continue

    const { data: items } = await supabase
      .from("evaluation_items")
      .select("question_number, student_answer, correct_answer, is_correct, score_obtained, score_max")
      .eq("evaluation_id", evaluationId)
      .order("question_number", { ascending: true })

    const result = buildResultFromItems((items ?? []) as ItemRow[])
    let skillRows: Awaited<ReturnType<typeof evaluateSkillsFromEvaluation>> = []
    try {
      skillRows = await evaluateSkillsFromEvaluation(result, subject)
    } catch (e) {
      if (isDev) console.warn("[backfill] evaluateSkillsFromEvaluation failed", evaluationId, e)
      continue
    }
    if (skillRows.length === 0) continue

    let evalUpdated = false
    for (const profileId of profileIds) {
      const { data: existing } = await supabase
        .from("evaluation_skill_results")
        .select("id")
        .eq("evaluation_id", evaluationId)
        .eq("student_profile_id", profileId)
        .limit(1)
      if ((existing ?? []).length > 0) continue

      for (const row of skillRows) {
        const { error: insErr } = await supabase.from("evaluation_skill_results").insert({
          evaluation_id: evaluationId,
          student_profile_id: profileId,
          axis_id: row.axis_id,
          skill_id: row.skill_id,
          score_obtained: row.score_obtained,
          score_max: row.score_max,
          accuracy: row.accuracy,
        })
        if (!insErr) {
          inserted_rows++
          evalUpdated = true
        } else if (isDev) console.warn("[backfill] insert failed", insErr.message)
      }
    }
    if (evalUpdated) updated_evaluations++
  }

  return { ok: true, scanned_evaluations, updated_evaluations, inserted_rows }
}

export interface RecomputeSkillsForEvaluationResult {
  ok: boolean
  evaluation_id?: string
  title?: string | null
  subject?: string
  items_count?: number
  linked_profiles_count?: number
  deleted_existing_rows_count?: number
  computed_skill_rows_count?: number
  rows_to_insert_count?: number
  inserted_skill_rows_count?: number
  pedagogy_mode_used?: string
  exam_type?: string | null
  reason?: "NO_ITEMS" | "NO_LINKED_PROFILES" | "NO_COMPUTED_SKILLS" | "NO_ROWS_TO_INSERT" | "INSERT_FAILED" | "INSERTED_OK"
  sample_item_texts?: string[]
  sample_computed_rows?: Array<{ axis_id: string; skill_id: string; score_obtained: number; score_max: number; accuracy: number | null }>
  sample_rows_to_insert?: Array<{ student_profile_id: string; axis_id: string; skill_id: string; accuracy: number | null }>
  message: string
  error?: string
}

/**
 * Recalcula habilidades para una evaluación: borra filas existentes en evaluation_skill_results
 * e inserta nuevas por cada student_profile_id vinculado.
 * Modo pedagógico: source_exam > structured > text (resuelto con resolvePedagogyMode).
 * Respuesta auditable: pedagogy_mode_used, exam_type, reason, sample_*.
 */
export async function recomputeSkillsForEvaluation(
  supabase: SupabaseClient,
  evaluationId: string,
  teacher_id: string
): Promise<RecomputeSkillsForEvaluationResult> {
  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select("id, subject, title, teacher_id, source_exam_id, pedagogy_mode, exam_type")
    .eq("id", evaluationId)
    .eq("teacher_id", teacher_id)
    .maybeSingle()

  if (evErr || !evaluation) {
    return {
      ok: false,
      evaluation_id: evaluationId,
      message: evErr?.message ?? "Evaluación no encontrada o sin permiso",
      error: evErr?.message,
      reason: "NO_ITEMS",
      items_count: 0,
      linked_profiles_count: 0,
      deleted_existing_rows_count: 0,
      computed_skill_rows_count: 0,
      rows_to_insert_count: 0,
      inserted_skill_rows_count: 0,
      sample_item_texts: [],
      sample_computed_rows: [],
      sample_rows_to_insert: [],
    }
  }

  const title = (evaluation as { title?: string | null }).title ?? null
  const examType = (evaluation as { exam_type?: string | null }).exam_type ?? null

  const { data: itemsForMode } = await supabase
    .from("evaluation_items")
    .select("question_number, student_answer, correct_answer, question, question_text, prompt, item_text")
    .eq("evaluation_id", evaluationId)
  const hasText = hasEnoughTextInItems((itemsForMode ?? []) as Array<Record<string, unknown>>)

  const pedagogyMode = resolvePedagogyMode(
    {
      source_exam_id: (evaluation as { source_exam_id?: string | null }).source_exam_id,
      exam_type: examType,
      pedagogy_mode: (evaluation as { pedagogy_mode?: string | null }).pedagogy_mode,
      subject: (evaluation as { subject?: string | null }).subject,
    },
    { hasEnoughTextInItems: hasText }
  )

  let generated: GenerateSkillsFromItemsResult | null = null
  const subjectForCall = (evaluation as { subject?: string | null }).subject ?? "Lenguaje"

  if (pedagogyMode === "source_exam") {
    generated = await generateSkillsFromSourceExam(supabase, evaluationId)
  } else if (pedagogyMode === "structured") {
    generated = await generateSkillsFromStructuredBlueprint(supabase, evaluationId, subjectForCall, examType)
  } else {
    generated = await generateSkillsFromTextItems(supabase, evaluationId)
  }

  if (!generated) {
    return {
      ok: false,
      evaluation_id: evaluationId,
      title,
      pedagogy_mode_used: pedagogyMode,
      exam_type: examType,
      message: "No se pudo generar datos para la evaluación",
      error: "generated null",
      reason: "NO_ITEMS",
      items_count: 0,
      linked_profiles_count: 0,
      deleted_existing_rows_count: 0,
      computed_skill_rows_count: 0,
      rows_to_insert_count: 0,
      inserted_skill_rows_count: 0,
      sample_item_texts: [],
      sample_computed_rows: [],
      sample_rows_to_insert: [],
    }
  }

  const { profileIds, skillRows, subject: subjectFromGen, items_count, sample_item_texts, sample_computed_rows } = generated
  const linked_profiles_count = profileIds.length
  const computed_skill_rows_count = skillRows.length
  const subject = subjectFromGen

  if (items_count === 0) {
    return {
      ok: false,
      evaluation_id: evaluationId,
      title,
      subject,
      pedagogy_mode_used: pedagogyMode,
      exam_type: examType,
      message: "La evaluación no tiene items para analizar",
      error: "items_count 0",
      reason: "NO_ITEMS",
      items_count: 0,
      linked_profiles_count,
      deleted_existing_rows_count: 0,
      computed_skill_rows_count,
      rows_to_insert_count: 0,
      inserted_skill_rows_count: 0,
      sample_item_texts: sample_item_texts ?? [],
      sample_computed_rows: sample_computed_rows ?? [],
      sample_rows_to_insert: [],
    }
  }

  if (linked_profiles_count === 0) {
    return {
      ok: false,
      evaluation_id: evaluationId,
      title,
      subject,
      pedagogy_mode_used: pedagogyMode,
      exam_type: examType,
      message: "No hay estudiantes vinculados (student_profile_id) a esta evaluación",
      error: "no linked profiles",
      reason: "NO_LINKED_PROFILES",
      items_count,
      linked_profiles_count: 0,
      computed_skill_rows_count,
      rows_to_insert_count: 0,
      inserted_skill_rows_count: 0,
      sample_item_texts: sample_item_texts ?? [],
      sample_computed_rows: sample_computed_rows ?? [],
      sample_rows_to_insert: [],
    }
  }

  if (computed_skill_rows_count === 0) {
    return {
      ok: false,
      evaluation_id: evaluationId,
      title,
      subject,
      pedagogy_mode_used: pedagogyMode,
      exam_type: examType,
      message: "El generador no produjo filas de habilidades",
      error: "no computed skills",
      reason: "NO_COMPUTED_SKILLS",
      items_count,
      linked_profiles_count,
      computed_skill_rows_count: 0,
      rows_to_insert_count: 0,
      inserted_skill_rows_count: 0,
      sample_item_texts: sample_item_texts ?? [],
      sample_computed_rows: sample_computed_rows ?? [],
      sample_rows_to_insert: [],
    }
  }

  const rowsToInsert: Array<{
    evaluation_id: string
    student_profile_id: string
    axis_id: string
    skill_id: string
    score_obtained: number
    score_max: number
    accuracy: number | null
  }> = []
  for (const profileId of profileIds) {
    for (const row of skillRows) {
      rowsToInsert.push({
        evaluation_id: evaluationId,
        student_profile_id: profileId,
        axis_id: row.axis_id,
        skill_id: row.skill_id,
        score_obtained: row.score_obtained,
        score_max: row.score_max,
        accuracy: row.accuracy,
      })
    }
  }
  const rows_to_insert_count = rowsToInsert.length

  if (rows_to_insert_count === 0) {
    return {
      ok: false,
      evaluation_id: evaluationId,
      title,
      subject,
      pedagogy_mode_used: pedagogyMode,
      exam_type: examType,
      message: "No hay filas a insertar (perfiles x skills = 0)",
      error: "no rows to insert",
      reason: "NO_ROWS_TO_INSERT",
      items_count,
      linked_profiles_count,
      computed_skill_rows_count,
      rows_to_insert_count: 0,
      inserted_skill_rows_count: 0,
      sample_item_texts: sample_item_texts ?? [],
      sample_computed_rows: sample_computed_rows ?? [],
      sample_rows_to_insert: [],
    }
  }

  const { data: deletedRows, error: delErr } = await supabase
    .from("evaluation_skill_results")
    .delete()
    .eq("evaluation_id", evaluationId)
    .select("id")

  const deleted_existing_rows_count = deletedRows?.length ?? 0
  if (delErr && isDev) console.warn("[recompute] delete existing failed", delErr.message)

  for (const row of rowsToInsert) {
    const { error: insErr } = await supabase.from("evaluation_skill_results").insert({
      evaluation_id: row.evaluation_id,
      student_profile_id: row.student_profile_id,
      axis_id: row.axis_id,
      skill_id: row.skill_id,
      score_obtained: row.score_obtained,
      score_max: row.score_max,
      accuracy: row.accuracy,
    })
    if (insErr && isDev) console.warn("[recompute] insert failed", insErr.message)
  }

  const { count: insertedCount } = await supabase
    .from("evaluation_skill_results")
    .select("id", { count: "exact", head: true })
    .eq("evaluation_id", evaluationId)

  const inserted_skill_rows_count = insertedCount ?? 0

  let reason: RecomputeSkillsForEvaluationResult["reason"] = "INSERTED_OK"
  if (rows_to_insert_count > 0 && inserted_skill_rows_count === 0) reason = "INSERT_FAILED"
  else if (inserted_skill_rows_count > 0) reason = "INSERTED_OK"

  const sample_rows_to_insert = rowsToInsert.slice(0, 5).map((r) => ({
    student_profile_id: r.student_profile_id,
    axis_id: r.axis_id,
    skill_id: r.skill_id,
    accuracy: r.accuracy,
  }))

  return {
    ok: inserted_skill_rows_count > 0,
    evaluation_id: evaluationId,
    title,
    subject,
    pedagogy_mode_used: pedagogyMode,
    exam_type: examType,
    items_count,
    linked_profiles_count,
    deleted_existing_rows_count,
    computed_skill_rows_count,
    rows_to_insert_count,
    inserted_skill_rows_count,
    reason,
    sample_item_texts: sample_item_texts ?? [],
    sample_computed_rows: sample_computed_rows ?? [],
    sample_rows_to_insert,
    message:
      inserted_skill_rows_count > 0
        ? "Habilidades recalculadas correctamente"
        : "Inserción falló o no se persistieron filas",
  }
}
