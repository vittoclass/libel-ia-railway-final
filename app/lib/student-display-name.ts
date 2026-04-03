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
