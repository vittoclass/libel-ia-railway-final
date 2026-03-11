/**
 * Normalización de course_label solo para comparación (no para mostrar en UI).
 * - trim
 * - lowercase
 * - colapsar múltiples espacios a uno
 * - si vacío/null -> "sin curso"
 */
export function normalizeCourseLabel(value: string | null | undefined): string {
  if (value == null || typeof value !== "string") return "sin curso"
  const t = value.trim()
  if (t === "") return "sin curso"
  return t.toLowerCase().replace(/\s+/g, " ")
}
