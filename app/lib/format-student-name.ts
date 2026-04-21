/**
 * Formato exclusivamente visual para nombres de estudiante (UI, PDF, ZIP de informes).
 * No modifica datos persistidos, OCR, matching ni normalización interna.
 */

function titleCaseWord(word: string): string {
  if (!word) return word
  const lower = word.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Normaliza mayúsculas/minúsculas para mostrar: primera letra de cada palabra en mayúscula.
 * Separa por espacios (colapsa espacios múltiples); no altera el orden ni elimina palabras.
 */
export function formatStudentDisplayName(name: string | null | undefined): string {
  if (name == null) return ""
  const s = String(name).trim()
  if (s === "") return ""
  return s.split(/\s+/).map(titleCaseWord).join(" ")
}
