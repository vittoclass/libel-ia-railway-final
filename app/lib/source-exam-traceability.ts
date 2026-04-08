import type { SupabaseClient } from "@supabase/supabase-js"
import { recomputeSkillsForEvaluation } from "@/app/lib/backfill-skill-results"

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

/** Formato UUID estándar (Postgres); rechaza texto que no sea UUID para no romper el insert. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function sanitizeUuidOrNull(v: string | null | undefined): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return UUID_RE.test(s) ? s : null
}

export async function validateAxisSkillPair(
  supabase: SupabaseClient,
  axisId: string,
  skillId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const axis = axisId.trim()
  const skill = skillId.trim()
  if (!axis || !skill) {
    return { ok: false, error: "axis_id y skill_id son obligatorios" }
  }

  const [{ data: axisRow, error: axisErr }, { data: skillRow, error: skillErr }] = await Promise.all([
    supabase.from("pedagogy_axes").select("id").eq("id", axis).maybeSingle(),
    supabase.from("pedagogy_skills").select("id, axis_id").eq("id", skill).maybeSingle(),
  ])

  if (axisErr || !axisRow) return { ok: false, error: "axis_id inválido (no existe en el diccionario)" }
  if (skillErr || !skillRow) return { ok: false, error: "skill_id inválido (no existe en el diccionario)" }
  if (String((skillRow as { axis_id: string }).axis_id) !== axis) {
    return { ok: false, error: "skill_id no pertenece al axis_id informado" }
  }
  return { ok: true }
}

export async function resolveAxisSkillIdsFromLabels(
  supabase: SupabaseClient,
  params: {
    subject?: string | null
    axis_label?: string | null
    skill_label?: string | null
  }
): Promise<{ axis_id: string; skill_id: string } | null> {
  const axisLabel = String(params.axis_label ?? "").trim()
  const skillLabel = String(params.skill_label ?? "").trim()
  if (!axisLabel || !skillLabel) return null

  const subjectNorm = String(params.subject ?? "").trim()
  let axisQuery = supabase.from("pedagogy_axes").select("id, subject, name").eq("name", axisLabel)
  if (subjectNorm) axisQuery = axisQuery.eq("subject", subjectNorm)
  const { data: axes } = await axisQuery.limit(1)
  const axisId = (axes?.[0] as { id?: string } | undefined)?.id
  if (!axisId) return null

  const { data: skills } = await supabase
    .from("pedagogy_skills")
    .select("id")
    .eq("axis_id", axisId)
    .eq("name", skillLabel)
    .limit(1)
  const skillId = (skills?.[0] as { id?: string } | undefined)?.id
  if (!skillId) return null

  return { axis_id: axisId, skill_id: skillId }
}

export async function refreshLinkedEvaluationSkillsForSourceExam(
  supabase: SupabaseClient,
  sourceExamId: string,
  options?: { skipLinkedRecompute?: boolean }
): Promise<{ linked: number; recomputed_ok: number; recomputed_fail: number; recompute_deferred?: boolean }> {
  const sourceExam = await supabase
    .from("source_exams")
    .select("id")
    .eq("id", sourceExamId)
    .maybeSingle()
  if (!sourceExam.data) return { linked: 0, recomputed_ok: 0, recomputed_fail: 0 }

  const [bridgeRes, directRes] = await Promise.all([
    supabase.from("evaluation_source_exams").select("evaluation_id").eq("source_exam_id", sourceExamId),
    supabase.from("evaluations").select("id, teacher_id").eq("source_exam_id", sourceExamId),
  ])

  const linkedByBridge = (bridgeRes.data ?? []).map((r) => String((r as { evaluation_id: string }).evaluation_id))
  const linkedByDirect = (directRes.data ?? []).map((r) => ({
    id: String((r as { id: string }).id),
    teacher_id: String((r as { teacher_id?: string | null }).teacher_id ?? ""),
  }))

  const mergedIds = [...new Set([...linkedByBridge, ...linkedByDirect.map((r) => r.id)])]
  if (mergedIds.length === 0) return { linked: 0, recomputed_ok: 0, recomputed_fail: 0 }

  /** Importación masiva: no bloquear la respuesta HTTP recorriendo decenas de evaluaciones (recomputeSkillsForEvaluation). */
  if (options?.skipLinkedRecompute) {
    if (isDev) {
      console.info("[source-exam-traceability] skipLinkedRecompute (import rápido)", {
        sourceExamId,
        linked_evaluations: mergedIds.length,
      })
    }
    return {
      linked: mergedIds.length,
      recomputed_ok: 0,
      recomputed_fail: 0,
      recompute_deferred: true,
    }
  }

  const teacherByEvalId = new Map<string, string>()
  for (const row of linkedByDirect) {
    if (row.teacher_id) teacherByEvalId.set(row.id, row.teacher_id)
  }
  if (teacherByEvalId.size < mergedIds.length) {
    const missingIds = mergedIds.filter((id) => !teacherByEvalId.has(id))
    if (missingIds.length > 0) {
      const { data: evRows } = await supabase
        .from("evaluations")
        .select("id, teacher_id")
        .in("id", missingIds)
      for (const row of evRows ?? []) {
        const r = row as { id?: string; teacher_id?: string | null }
        if (r.id && r.teacher_id) teacherByEvalId.set(r.id, r.teacher_id)
      }
    }
  }

  let recomputedOk = 0
  let recomputedFail = 0
  for (const evaluationId of mergedIds) {
    const teacherId = teacherByEvalId.get(evaluationId)
    if (!teacherId) {
      recomputedFail++
      continue
    }
    try {
      const r = await recomputeSkillsForEvaluation(supabase, evaluationId, teacherId)
      if (r.ok) recomputedOk++
      else recomputedFail++
    } catch {
      recomputedFail++
    }
  }

  if (isDev) {
    console.info("[source-exam-traceability] refreshed linked evaluations", {
      sourceExamId,
      linked: mergedIds.length,
      recomputedOk,
      recomputedFail,
    })
  }
  return { linked: mergedIds.length, recomputed_ok: recomputedOk, recomputed_fail: recomputedFail }
}
