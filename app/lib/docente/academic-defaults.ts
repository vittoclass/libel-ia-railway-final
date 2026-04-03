/** Valores por defecto para filtrar teacher_assignments (sin acoplar a evaluaciones). */

export function defaultAcademicYear(now = new Date()): number {
  return now.getFullYear()
}
