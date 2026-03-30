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
const QUESTION_TYPES = ["multiple_choice", "true_false", "short_answer", "essay", "completion"] as const

type PartsResult = { parts: string[]; separator: string }

function isOptionContinuationLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  return /^(?:[A-Ea-e]|[VvFf])\s*(?:[\)\.:\-–—]|\()/.test(t)
}

function hasAlternativeMarkers(text: string): boolean {
  const t = text.toUpperCase()
  const letters: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"]
  let hits = 0
  for (const L of letters) {
    const re = new RegExp(String.raw`(?:^|\s)${L}\s*(?:[\)\.:\-–—]|\()`, "i")
    if (re.test(t)) hits++
  }
  return hits >= 2
}

function extractDeclaredClosedAnswer(text: string): string | null {
  const blob = String(text ?? "")
  const vf = blob.match(/(?:clave|respuesta|opci[oó]n|alternativa)\s*(?:correcta)?\s*[:\.]\s*\b([VF])\b/i)
  if (vf?.[1]) return vf[1].toUpperCase()
  const patterns = [
    /respuesta\s+correcta\s*[:\.]\s*([A-E])\b/i,
    /alternativa\s+correcta\s*[:\.]\s*([A-E])\b/i,
    /clave\s*(?:de\s*correcci[oó]n|docente|profesor)?\s*[:\.]\s*([A-E])\b/i,
    /opci[oó]n\s+correcta\s*[:\.]\s*([A-E])\b/i,
    /letra\s+correcta\s*[:\.]\s*([A-E])\b/i,
  ]
  for (const re of patterns) {
    const m = blob.match(re)
    if (m?.[1]) return m[1].toUpperCase()
  }
  return null
}

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

function normalizeSimceAlternativeToken(raw: string): string | null {
  const t = raw.trim().replace(/\.$/, "").toUpperCase()
  if (/^[A-E]$/.test(t)) return t
  if (t === "V" || t === "F") return t
  return null
}

/**
 * SIMCE / tabla de alternativas: Nº, CORRECTA (A–E / V / F), PTJE, [EJE…].
 * Acepta 3 columnas mínimas; el eje es opcional (listados sin columna final).
 */
function trySimceFromParts(parts: string[], joinSep: string): ParsedLine | null {
  if (parts.length < 3) return null
  const num = parseInt(parts[0], 10)
  if (Number.isNaN(num) || num < 1) return null
  const corrTok = normalizeSimceAlternativeToken(parts[1] ?? "")
  const ptje = parseInt(parts[2], 10)
  if (!corrTok || Number.isNaN(ptje) || ptje < 0) return null
  const axisRest = parts.length > 3 ? parts.slice(3).join(joinSep).trim() : ""
  const axis_label = axisRest.length > 0 ? axisRest : null
  const isVf = corrTok === "V" || corrTok === "F"
  return {
    item_number: num,
    item_text: `Ítem ${num}`,
    axis_label,
    skill_label: null,
    competence: null,
    difficulty: null,
    question_type: isVf ? "true_false" : "multiple_choice",
    correct_answer: corrTok,
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

function closedAnswerStrength(p: ParsedLine): number {
  const c = (p.correct_answer ?? "").trim().toUpperCase()
  if (/^[A-E]$/.test(c) || c === "V" || c === "F") return 4
  if (c.length > 0 && c.length <= 8) return 2
  return 0
}

function isStructuredClosedType(p: ParsedLine): boolean {
  const t = (p.question_type ?? "").toLowerCase()
  return t === "multiple_choice" || t === "true_false"
}

/**
 * Elige la fila canónica para un mismo item_number: prioriza cerrada con clave válida,
 * luego tipo SIMCE explícito, luego riqueza de texto/rúbrica (sin dejar que un essay pise una cerrada con pauta).
 */
function pickRicherParsedLine(a: ParsedLine, b: ParsedLine): ParsedLine {
  const score = (p: ParsedLine) => {
    let s = closedAnswerStrength(p) * 10_000
    if (isStructuredClosedType(p)) s += 1_000
    s += Math.min((p.item_text?.length ?? 0) + (p.rubric_text?.length ?? 0), 50_000)
    return s
  }
  const sa = score(a)
  const sb = score(b)
  if (sb > sa) return b
  if (sa > sb) return a
  const aC = !!(a.correct_answer?.trim())
  const bC = !!(b.correct_answer?.trim())
  if (aC !== bC) return aC ? a : b
  const len = (p: ParsedLine) => (p.item_text?.length ?? 0) + (p.rubric_text?.length ?? 0)
  return len(b) > len(a) ? b : a
}

/** Evita duplicar el mismo Nº al fusionar listado tabular + bloques de desarrollo. */
export function dedupeParsedLinesByItemNumber(items: ParsedLine[]): ParsedLine[] {
  const map = new Map<number, ParsedLine>()
  for (const it of items) {
    const n = it.item_number
    const ex = map.get(n)
    if (!ex) {
      map.set(n, it)
      continue
    }
    map.set(n, pickRicherParsedLine(ex, it))
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)
}

export function parseBulkItemsText(text: string): ParseResult {
  const valid: ParsedLine[] = []
  const invalid: { line: string; reason: string }[] = []
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  // Tolerancia a saltos de línea en alternativas: une incisos "A) ...", "B. ...", etc. al ítem previo.
  const lines: string[] = []
  for (const line of rawLines) {
    if (isOptionContinuationLine(line) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${line}`.replace(/\s+/g, " ").trim()
    } else {
      lines.push(line)
    }
  }

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

    // Modo universal tolerante: línea numerada no-tabular.
    const loose = line.match(/^\s*(\d{1,3})\s*(?:[\.\)\-–—:]|\s)\s*(.+)$/)
    if (loose) {
      const num = parseInt(loose[1], 10)
      const rest = (loose[2] ?? "").trim()
      if (!Number.isNaN(num) && num >= 1 && rest.length > 0) {
        const corr = extractDeclaredClosedAnswer(rest)
        const isVf = corr === "V" || corr === "F"
        const hasAlts = hasAlternativeMarkers(rest)
        valid.push({
          item_number: num,
          item_text: rest,
          axis_label: null,
          skill_label: null,
          competence: null,
          difficulty: null,
          question_type: isVf ? "true_false" : hasAlts ? "multiple_choice" : null,
          correct_answer: corr,
          max_score: null,
          rubric_text: null,
        })
        continue
      }
    }

    invalid.push({
      line,
      reason: "Formato no reconocido. Use: Nº CORRECTA PTJE EJE (separado por |, tab, coma o espacios) o formato estándar con ' | '.",
    })
  }
  return { valid: dedupeParsedLinesByItemNumber(valid), invalid }
}
