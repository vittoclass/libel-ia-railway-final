/**
 * Normalización canónica de course_label para reportes institucionales.
 * Mantiene letras y números (ej: 2T, 2A, 2MEDIO, 4MEDIO) sin truncar.
 * Solo se usa para agrupación/llaves de reporte (no reemplaza la etiqueta de UI original).
 */
export function normalizeCourseLabelForReports(value: string | null | undefined): string {
  const raw = String(value ?? "").trim()
  if (!raw) return "Sin curso"
  const noAccents = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
  const compact = noAccents
    .replace(/[°º˚]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim()
  return compact || "Sin curso"
}
