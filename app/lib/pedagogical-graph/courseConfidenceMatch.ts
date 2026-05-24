/**
 * Comparación de curso para confianza nominal (solo memoria docente / UX).
 * No asume mismo curso por texto bruto: normaliza etiquetas equivalentes.
 */

export type CourseConfidenceMatch = "same" | "other" | "unknown"

export type CourseMatchInput = {
  courseId?: string | null
  courseLabel?: string | null
}

function cleanCourseId(id: string | null | undefined): string {
  return String(id ?? "").trim()
}

function levelTokenToCode(token: string): string | null {
  const t = token.replace(/\s/g, "")
  if (!t) return null
  if (/^(basico|bas|b)$/.test(t)) return "b"
  if (/^(medio|med|m)$/.test(t)) return "m"
  if (/^(humanidades|humano|hum|h)$/.test(t)) return "h"
  return null
}

/**
 * Clave canónica para equivalencias tipo "4 BASICO" ≈ "4°BASICO" ≈ "4B".
 * Devuelve null si no se puede inferir grado/nivel.
 */
export function canonicalCourseLabelKey(label: string | null | undefined): string | null {
  let s = String(label ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
  if (!s) return null

  s = s.replace(/[°ºª.]/g, " ")
  s = s.replace(/\s+/g, " ").trim()

  const compact = s.replace(/[^a-z0-9]/g, "")
  const compactMatch = compact.match(/^(\d{1,2})(basico|bas|b|medio|med|m|humanidades|humano|hum|h)?$/)
  if (compactMatch) {
    const grade = compactMatch[1]
    const level = levelTokenToCode(compactMatch[2] ?? "")
    return level ? `${grade}${level}` : grade
  }

  const tokens = s.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
  if (!tokens.length) return null

  const gradeMatch = tokens[0].match(/^(\d{1,2})$/)
  if (!gradeMatch) return compact || null

  const grade = gradeMatch[1]
  const rest = tokens.slice(1).join("")
  const level = levelTokenToCode(rest)
  if (level) return `${grade}${level}`

  if (tokens.length === 1 && /^\d{1,2}[a-z]$/.test(tokens[0])) {
    const m = tokens[0].match(/^(\d{1,2})([a-z])$/)
    if (m) {
      const code = levelTokenToCode(m[2])
      if (code) return `${m[1]}${code}`
    }
  }

  return compact || null
}

/**
 * 1. Si ambos tienen courseId → same u other.
 * 2. Si no, compara etiquetas normalizadas.
 * 3. Si no puede determinar → unknown (no cuenta como mismo curso).
 */
export function courseConfidenceMatch(a: CourseMatchInput, b: CourseMatchInput): CourseConfidenceMatch {
  const idA = cleanCourseId(a.courseId)
  const idB = cleanCourseId(b.courseId)

  if (idA && idB) {
    return idA === idB ? "same" : "other"
  }

  const keyA = canonicalCourseLabelKey(a.courseLabel)
  const keyB = canonicalCourseLabelKey(b.courseLabel)

  if (idA && !idB && !keyB) return "unknown"
  if (idB && !idA && !keyA) return "unknown"
  if ((idA && keyB) || (idB && keyA)) return "unknown"

  if (keyA && keyB) {
    return keyA === keyB ? "same" : "other"
  }

  return "unknown"
}

export function isCurrentCourseContextKnown(ctx: CourseMatchInput): boolean {
  return Boolean(cleanCourseId(ctx.courseId) || canonicalCourseLabelKey(ctx.courseLabel))
}
