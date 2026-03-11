/**
 * Recálculo centralizado tras la decisión final del profesor (edición manual en el informe).
 * La decisión del profesor es la verdad máxima: actualiza evaluation_summaries y skills derivados.
 * No toca /api/evaluate, OCR, Azure, Mistral ni flujos existentes.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { recomputeSkillsForEvaluation } from "@/app/lib/backfill-skill-results"

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"
const EXIGENCIA_DEFAULT = 60 // 60% para nota 4.0 (igual que app/api/evaluate)

/**
 * Calcula nota Chile 1–7 a partir de puntaje obtenido y máximo.
 * Misma fórmula que app/api/evaluate/route.ts (calculateGrade).
 */
function calculateGradeChile(score: number, maxScore: number, porcentajeExigencia: number = EXIGENCIA_DEFAULT): number {
  if (maxScore <= 0 || porcentajeExigencia <= 0) return 1.0
  const exigenciaDecimal = Math.min(100, Math.max(1, porcentajeExigencia)) / 100
  const puntosAprobacion = Math.ceil(maxScore * exigenciaDecimal)
  const puntajeEfectivo = Math.max(0, score)
  if (puntajeEfectivo === 0) return 1.0
  let grade: number
  if (puntajeEfectivo <= puntosAprobacion) {
    const ratio = Math.min(1, puntajeEfectivo / puntosAprobacion)
    grade = 1.0 + 3.0 * Math.pow(ratio, 0.95)
    grade = Math.min(4.0, grade)
  } else {
    const remainingPoints = maxScore - puntosAprobacion
    if (remainingPoints === 0) return 7.0
    grade = 4.0 + 3.0 * ((puntajeEfectivo - puntosAprobacion) / remainingPoints)
  }
  return Math.min(7.0, Math.round(grade * 10) / 10)
}

export interface RecomputeAfterTeacherDecisionResult {
  ok: boolean
  evaluation_id: string
  score_total?: number
  score_max?: number
  grade_chile?: number
  skills_recomputed?: boolean
  error?: string
}

/**
 * Ejecutar SIEMPRE después de una edición manual del profesor en el informe.
 * Recalcula score_total, score_max, grade_chile; actualiza evaluation_summaries;
 * si existe capa pedagógica, recalcula skills/ejes.
 * Si se pasan porcentajeExigencia y/o puntajeTotalMax, se usan para la nota (igual que el frontend).
 */
export async function recomputeEvaluationAfterTeacherDecision(
  supabase: SupabaseClient,
  evaluationId: string,
  opts?: { porcentajeExigencia?: number; puntajeTotalMax?: number }
): Promise<RecomputeAfterTeacherDecisionResult> {
  if (isDev) console.info("[RECOMPUTE] teacher decision", evaluationId)

  const { data: items, error: itemsErr } = await supabase
    .from("evaluation_items")
    .select("score_obtained, score_max")
    .eq("evaluation_id", evaluationId)

  if (itemsErr) {
    if (isDev) console.info("[RECOMPUTE] evaluation_items error", itemsErr.message)
    return { ok: false, evaluation_id: evaluationId, error: itemsErr.message }
  }

  const rows = Array.isArray(items) ? items : []
  let scoreTotal = 0
  let scoreMax = 0
  for (const r of rows) {
    scoreTotal += Number(r?.score_obtained ?? 0) || 0
    scoreMax += Number(r?.score_max ?? 0) || 0
  }

  const maxParaNota = opts?.puntajeTotalMax != null && opts.puntajeTotalMax > 0 ? opts.puntajeTotalMax : scoreMax
  const exigenciaParaNota = opts?.porcentajeExigencia != null && opts.porcentajeExigencia > 0 ? opts.porcentajeExigencia : EXIGENCIA_DEFAULT
  const gradeChile = maxParaNota > 0 ? calculateGradeChile(scoreTotal, maxParaNota, exigenciaParaNota) : 1.0

  if (isDev) {
    console.info("[RECOMPUTE] score_total", scoreTotal)
    console.info("[RECOMPUTE] score_max", scoreMax)
    if (opts?.puntajeTotalMax != null) console.info("[RECOMPUTE] puntaje_total_max (form)", opts.puntajeTotalMax)
    if (opts?.porcentajeExigencia != null) console.info("[RECOMPUTE] porcentaje_exigencia (form)", opts.porcentajeExigencia)
    console.info("[RECOMPUTE] grade_chile", gradeChile)
  }

  const updatePayload: Record<string, unknown> = {
    grade_chile: gradeChile,
  }
  const { data: summaryRow } = await supabase
    .from("evaluation_summaries")
    .select("id")
    .eq("evaluation_id", evaluationId)
    .maybeSingle()

  if (!summaryRow?.id) {
    const { error: insErr } = await supabase.from("evaluation_summaries").insert({
      evaluation_id: evaluationId,
      grade_chile: gradeChile,
    })
    if (insErr && isDev) console.warn("[RECOMPUTE] insert summary failed", insErr.message)
    return {
      ok: !insErr,
      evaluation_id: evaluationId,
      score_total: scoreTotal,
      score_max: scoreMax,
      grade_chile: gradeChile,
    }
  }

  const { error: updateErr } = await supabase
    .from("evaluation_summaries")
    .update(updatePayload)
    .eq("evaluation_id", evaluationId)

  if (updateErr) {
    const fallback = await supabase
      .from("evaluation_summaries")
      .update({ grade_chile: gradeChile })
      .eq("evaluation_id", evaluationId)
    if (fallback.error && isDev) console.warn("[RECOMPUTE] update summary (fallback) failed", fallback.error.message)
  }

  let skillsRecomputed = false
  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("teacher_id")
    .eq("id", evaluationId)
    .maybeSingle()
  const teacherId = (evaluation as { teacher_id?: string } | null)?.teacher_id
  if (teacherId) {
    try {
      const skillResult = await recomputeSkillsForEvaluation(supabase, evaluationId, teacherId)
      skillsRecomputed = skillResult.ok
    } catch (e) {
      if (isDev) console.warn("[RECOMPUTE] recomputeSkillsForEvaluation threw", e)
    }
  }

  return {
    ok: true,
    evaluation_id: evaluationId,
    score_total: scoreTotal,
    score_max: scoreMax,
    grade_chile: gradeChile,
    skills_recomputed: skillsRecomputed,
  }
}

/** @deprecated Use recomputeEvaluationAfterTeacherDecision */
export const recomputeEvaluationAfterManualEdit = recomputeEvaluationAfterTeacherDecision
