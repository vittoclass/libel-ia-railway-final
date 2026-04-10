/**
 * Formato legible para informes PDF / UI pedagógica (sin tocar scoring ni OMR).
 * Sanitiza escapes, aplica title case y listas en español.
 */

/** Quita secuencias escapadas, comillas envolventes y normaliza espacios. */
export function sanitizePedagogicalRaw(text: string): string {
  let s = String(text ?? "")
  s = s.replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/\\t/g, " ")
  s = s.replace(/\\"/g, '"').replace(/\\'/g, "'")
  s = s.replace(/^["'`]+|["'`]+$/g, "")
  return s.replace(/\s+/g, " ").trim()
}

const SMALL_WORDS_ES = new Set(["de", "del", "la", "las", "los", "y", "e", "o", "u", "en", "al", "el", "a"])

/** Title case amable para frases pedagógicas (evita TODO EN MAYÚSCULAS). */
export function toTitleCaseSpanishPhrase(text: string): string {
  const s = sanitizePedagogicalRaw(text)
  if (!s) return s
  if (/[a-záéíóúñ]/.test(s) && !/^[A-ZÁÉÍÓÚÑ0-9\s\-_.]+$/.test(s)) {
    return s.charAt(0).toLocaleUpperCase("es") + s.slice(1)
  }
  return s
    .toLocaleLowerCase("es")
    .split(/\s+/)
    .map((w, i) => {
      if (!w) return w
      if (i > 0 && SMALL_WORDS_ES.has(w)) return w
      return w.charAt(0).toLocaleUpperCase("es") + w.slice(1)
    })
    .join(" ")
}

/** Etiqueta de eje/habilidad para tablas e informes. */
export function formatPedagogicalReadableText(text: string): string {
  return toTitleCaseSpanishPhrase(sanitizePedagogicalRaw(text))
}

/** "18, 7, 10 y 12" en lugar de "18 y 7 y 10 y 12". */
export function formatQuestionNumbersSpanish(nums: number[]): string {
  const u = [...new Set(nums.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
  if (u.length === 0) return ""
  if (u.length === 1) return String(u[0])
  return `${u.slice(0, -1).join(", ")} y ${u[u.length - 1]}`
}
