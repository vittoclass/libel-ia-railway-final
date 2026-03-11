/**
 * Normalización estructural del texto extraído de una prueba base (PDF o pegado).
 * Prepara el texto para el parser de importación: limpia espacios, saltos de línea y opcionalmente
 * detecta bloques (ítem, encabezado, instrucción). No hace inferencias pedagógicas ni usa IA.
 * Solo reglas y regex. Usado únicamente en el flujo de importación de source_exam_items.
 */
export interface DetectedBlock {
  type: "item" | "header" | "instruction" | "unknown"
  lineIndex: number
  content: string
  hint?: string
}

export interface NormalizeSourceExamTextResult {
  raw_text: string
  normalized_text: string
  detected_blocks: DetectedBlock[]
  warnings: string[]
}

/**
 * Detecta si una línea parece ítem tipo SIMCE/alternativa: Nº CORRECTA PTJE EJE (números y letra).
 */
function looksLikeSimceLine(line: string): boolean {
  const t = line.trim()
  if (t.length < 5) return false
  const parts = t.split(/\s+/)
  if (parts.length < 4) return false
  const n1 = parseInt(parts[0], 10)
  const n2 = parseInt(parts[2], 10)
  const letter = parts[1]
  return (
    !Number.isNaN(n1) &&
    n1 >= 1 &&
    letter.length >= 1 &&
    letter.length <= 2 &&
    !Number.isNaN(n2) &&
    n2 >= 0
  )
}

/**
 * Detecta si una línea parece numeración de ítem: "1.", "1)", "Ítem 1", etc.
 */
function looksLikeItemNumber(line: string): boolean {
  const t = line.trim()
  return /^\d+[\.\)]\s*/.test(t) || /^ítem\s*\d+/i.test(t) || /^nº?\s*\d+/i.test(t)
}

/**
 * Detecta si una línea parece encabezado (todo mayúsculas, corta) o instrucción.
 */
function looksLikeHeaderOrInstruction(line: string): boolean {
  const t = line.trim()
  if (t.length > 120) return false
  const upperRatio = (t.match(/[A-ZÁÉÍÓÚÑ]/g)?.length ?? 0) / Math.max(t.replace(/\s/g, "").length, 1)
  if (upperRatio > 0.7 && t.length > 10) return true
  if (/^(instrucciones?|enunciado|preguntas?|sección|parte)\s*[:\d]?/i.test(t)) return true
  return false
}

export function normalizeSourceExamText(raw_text: string): NormalizeSourceExamTextResult {
  const warnings: string[] = []
  const raw = typeof raw_text === "string" ? raw_text : ""

  let normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")

  normalized = normalized.replace(/\n{3,}/g, "\n\n").trim()

  const lines = normalized.split("\n").map((l) => l.trim())
  const detected_blocks: DetectedBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (looksLikeSimceLine(line)) {
      detected_blocks.push({ type: "item", lineIndex: i, content: line, hint: "SIMCE/alternativa" })
    } else if (looksLikeItemNumber(line)) {
      detected_blocks.push({ type: "item", lineIndex: i, content: line })
    } else if (looksLikeHeaderOrInstruction(line)) {
      detected_blocks.push({ type: "header", lineIndex: i, content: line })
    } else if (line.length > 0 && line.length < 100 && /^[A-Z][a-záéíóúñ\s,]+\.?$/i.test(line)) {
      detected_blocks.push({ type: "instruction", lineIndex: i, content: line })
    } else if (line.length > 0) {
      detected_blocks.push({ type: "unknown", lineIndex: i, content: line })
    }
  }

  if (normalized.length > 0 && lines.filter((l) => l.length > 0).length === 0) {
    warnings.push("El texto no contiene líneas con contenido después de normalizar.")
  }

  return {
    raw_text: raw,
    normalized_text: normalized,
    detected_blocks,
    warnings,
  }
}
