/**
 * Alcance de lectura de evaluaciones: alineado con GET /api/evaluations/list
 * y permisos por fila (creador / profesor / mismo colegio).
 * Reversible: eliminar este archivo y volver a la lógica anterior en cada ruta.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normUuid(s: string | null | undefined): string | null {
  const t = s != null ? String(s).trim().toLowerCase() : ""
  return t && UUID_RE.test(t) ? t : null
}

export type EvaluationAuthRow = {
  teacher_id?: string | null
  user_id?: string | null
  school_id?: string | null
}

/**
 * true si el usuario puede leer esta evaluación (informe, ítems, análisis pedagógico, estudiantes).
 */
export function canReadEvaluationInAppScope(params: {
  userId: string
  evaluation: EvaluationAuthRow
  teacher_id_used: string | null
  school_id_used: string | null
}): boolean {
  const ev = params.evaluation
  const evalUserId = ev.user_id != null ? String(ev.user_id).trim() : ""
  if (evalUserId !== "" && evalUserId === params.userId) return true

  const evalTeacher = normUuid(ev.teacher_id ?? null)
  const evalSchool = normUuid(ev.school_id ?? null)
  const { teacher_id_used, school_id_used } = params

  if (teacher_id_used && evalTeacher === teacher_id_used) return true
  if (school_id_used && evalSchool === school_id_used) return true
  return false
}

export function profileScopeFromRow(row: { teacher_id?: string | null; school_id?: string | null } | null | undefined): {
  teacher_id_used: string | null
  school_id_used: string | null
} {
  return {
    teacher_id_used: normUuid(row?.teacher_id ?? null),
    school_id_used: normUuid(row?.school_id ?? null),
  }
}

/** Alineado con `current_scope_org_id()` y columnas `organization_id` en proyecciones / auditoría. */
export function institutionalTenantScopeFromProfile(
  row: { organization_id?: string | null; school_id?: string | null; teacher_id?: string | null } | null | undefined
): string | null {
  return normUuid(row?.organization_id ?? null) ?? normUuid(row?.school_id ?? null) ?? normUuid(row?.teacher_id ?? null)
}
