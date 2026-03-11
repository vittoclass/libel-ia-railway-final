/**
 * Parser para importación masiva de ítems (source_exam_items).
 * Detecta automáticamente el separador (|, tab, coma, múltiples espacios) y acepta:
 * - Estándar: número | enunciado | axis_label | skill_label | competence | difficulty
 * - SIMCE/alternativas: Nº CORRECTA PTJE EJE (con |, tab, coma o espacios). axis_label = resto de la línea.
 * - Desarrollo: Nº | TIPO | PTJE | EJE | HABILIDAD | ENUNCIADO
 */
export interface ParsedLine {
  item_number: number
  item_text: string
  axis_label: string | null
  skill_label: string | null
  competence: string | null
  difficulty: string | null
  question_type: string | null
  correct_answer: string | null
  max_score: number | null
  rubric_text: string | null
}

export interface ParseResult {
  valid: ParsedLine[]
  invalid: { line: string; reason: string }[]
}

const SEP_PIPE = " | "
const QUESTION_TYPES = ["multiple_choice", "true_false", "short_answer", "essay"] as const

type PartsResult = { parts: string[]; separator: string }

function getParts(line: string): PartsResult {
  const t = line.trim()
  if (t.includes(SEP_PIPE)) {
    return { parts: t.split(SEP_PIPE).map((p) => p.trim()), separator: SEP_PIPE }
  }
  if (t.includes("\t")) {
    return { parts: t.split(/\t/).map((p) => p.trim()), separator: "\t" }
  }
  if (t.includes(",")) {
    return { parts: t.split(",").map((p) => p.trim()), separator: "," }
  }
  return { parts: t.split(/\s+/).map((p) => p.trim()).filter(Boolean), separator: " " }
}

/** Verifica si la línea parece SIMCE/alternativas: Nº, CORRECTA (1-2 chars), PTJE, EJE (resto). */
function trySimceFromParts(parts: string[], joinSep: string): ParsedLine | null {
  if (parts.length < 4) return null
  const num = parseInt(parts[0], 10)
  if (Number.isNaN(num) || num < 1) return null
  const correct = parts[1]
  if (!correct || correct.length > 2) return null
  const ptje = parseInt(parts[2], 10)
  if (Number.isNaN(ptje) || ptje < 0) return null
  const axis_label = parts.slice(3).join(joinSep).trim()
  if (!axis_label) return null
  return {
    item_number: num,
    item_text: `Ítem ${num}`,
    axis_label,
    skill_label: null,
    competence: null,
    difficulty: null,
    question_type: "multiple_choice",
    correct_answer: correct,
    max_score: ptje,
    rubric_text: null,
  }
}

function tryDesarrollo(parts: string[]): ParsedLine | null {
  if (parts.length < 6) return null
  const type = parts[1].toLowerCase().trim()
  if (!QUESTION_TYPES.includes(type as (typeof QUESTION_TYPES)[number])) return null
  const num = parseInt(parts[0], 10)
  if (Number.isNaN(num) || num < 1) return null
  const ptje = parseInt(parts[2], 10)
  if (Number.isNaN(ptje) || ptje < 0) return null
  const item_text = parts.slice(5).join(SEP_PIPE).trim()
  if (!item_text) return null
  return {
    item_number: num,
    item_text,
    axis_label: parts[3]?.trim() || null,
    skill_label: parts[4]?.trim() || null,
    competence: null,
    difficulty: null,
    question_type: type,
    correct_answer: null,
    max_score: ptje,
    rubric_text: null,
  }
}

export function parseBulkItemsText(text: string): ParseResult {
  const valid: ParsedLine[] = []
  const invalid: { line: string; reason: string }[] = []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  for (const line of lines) {
    const { parts, separator } = getParts(line)

    if (parts.length >= 6 && separator === SEP_PIPE) {
      const desarrollo = tryDesarrollo(parts)
      if (desarrollo) {
        valid.push(desarrollo)
        continue
      }
    }

    const simce = trySimceFromParts(parts, separator)
    if (simce) {
      valid.push(simce)
      continue
    }

    if (separator === SEP_PIPE && parts.length >= 2) {
      const num = parseInt(parts[0], 10)
      if (Number.isNaN(num) || num < 1) {
        invalid.push({ line, reason: "item_number debe ser un número entero ≥ 1" })
        continue
      }
      const item_text = parts[1]
      if (!item_text) {
        invalid.push({ line, reason: "item_text no puede estar vacío" })
        continue
      }
      valid.push({
        item_number: num,
        item_text,
        axis_label: parts[2] ?? null,
        skill_label: parts[3] ?? null,
        competence: parts[4] ?? null,
        difficulty: parts[5] ?? null,
        question_type: null,
        correct_answer: null,
        max_score: null,
        rubric_text: null,
      })
      continue
    }

    invalid.push({
      line,
      reason: "Formato no reconocido. Use: Nº CORRECTA PTJE EJE (separado por |, tab, coma o espacios) o formato estándar con ' | '.",
    })
  }
  return { valid, invalid }
}
