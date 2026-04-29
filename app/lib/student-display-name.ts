/**
 * Resolución de nombre visible para dashboards (evaluation_students + respaldo en summary).
 */

export function extractStudentNameFromSummaryRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const candidates = [o.nombreEstudianteDetectado, o.nombre_estudiante, o.nombreEstudiante, o.student_name, o.alumno]
  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

export function resolveStudentDisplayName(parts: {
  student_name?: string | null
  student_name_raw?: string | null
  raw?: unknown
}): string {
  const fromRaw = extractStudentNameFromSummaryRaw(parts.raw)
  return (
    (parts.student_name && String(parts.student_name).trim()) ||
    (parts.student_name_raw && String(parts.student_name_raw).trim()) ||
    (fromRaw && fromRaw.trim()) ||
    ""
  )
}

/** Aproxima nota Chile 1–7 desde % de logro ítems cuando falta grade_chile en summary. */
export function approxGradeChileFromLogroPct(logroPct: number | null | undefined): number | null {
  if (logroPct == null || !Number.isFinite(Number(logroPct))) return null
  const p = Math.max(0, Math.min(100, Number(logroPct)))
  const g = 1 + (p / 100) * 6
  return Math.round(g * 10) / 10
}

/** Mismo texto que `retroalimentacionEjecutivaSoloAlternativas` en evaluation-logic (solo lectura / display). */
const EXECUTIVE_CLOSED_ANSWERS_PLACEHOLDER = "evaluación de respuestas cerradas finalizada"

function normalizeSummaryCompareToken(s: string): string {
  return s.trim().toLowerCase().replace(/\.+$/, "")
}

/** true si el texto es el informe ejecutivo mínimo de solo alternativas (no es análisis pedagógico real). */
export function isExecutiveClosedAnswersPlaceholder(text: string | null | undefined): boolean {
  if (text == null) return false
  const t = normalizeSummaryCompareToken(String(text))
  return t === EXECUTIVE_CLOSED_ANSWERS_PLACEHOLDER
}

/**
 * Lee fortalezas / áreas de mejora desde `evaluation_summaries.raw` (persistencia de corrección).
 * Sin generar texto nuevo.
 */
export function extractResumenGeneralFromEvaluationRaw(raw: unknown): {
  fortalezas?: string
  areas_mejora?: string
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const retro = o.retroalimentacion
  if (!retro || typeof retro !== "object" || Array.isArray(retro)) return {}
  const rg = (retro as Record<string, unknown>).resumen_general
  if (!rg || typeof rg !== "object" || Array.isArray(rg)) return {}
  const g = rg as Record<string, unknown>
  const f = g.fortalezas
  const a = g.areas_mejora
  const out: { fortalezas?: string; areas_mejora?: string } = {}
  if (typeof f === "string" && f.trim()) out.fortalezas = f.trim()
  if (typeof a === "string" && a.trim()) out.areas_mejora = a.trim()
  return out
}

/**
 * Prioriza columnas strengths/improvements; si son placeholder o vacías, usa `raw.retroalimentacion.resumen_general`.
 * Solo para lectura en informes / dashboards.
 */
export function mergePedagogicalSummaryDisplayFields(params: {
  strengths: string | null | undefined
  improvements: string | null | undefined
  raw: unknown
}): { strengths: string | null; improvements: string | null } {
  const fromRaw = extractResumenGeneralFromEvaluationRaw(params.raw)
  let s = params.strengths != null && String(params.strengths).trim() !== "" ? String(params.strengths).trim() : null
  let im =
    params.improvements != null && String(params.improvements).trim() !== "" ? String(params.improvements).trim() : null
  if (isExecutiveClosedAnswersPlaceholder(s)) s = null
  if (isExecutiveClosedAnswersPlaceholder(im)) im = null
  if (!s && fromRaw.fortalezas && !isExecutiveClosedAnswersPlaceholder(fromRaw.fortalezas)) {
    s = fromRaw.fortalezas.trim()
  }
  if (!im && fromRaw.areas_mejora && !isExecutiveClosedAnswersPlaceholder(fromRaw.areas_mejora)) {
    im = fromRaw.areas_mejora.trim()
  }
  return { strengths: s, improvements: im }
}
