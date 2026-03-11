/**
 * Detecta bloques de preguntas de desarrollo/rúbrica en texto normalizado (p. ej. extraído de PDF).
 * Soporta:
 * - Cabecera tipo "39 2 Números y Operaciones" (item_number, max_score, axis_label).
 * - Inicio clásico "39." o "39)" con enunciado y rúbrica.
 * Solo lectura estructural; no usa IA. No toca evaluación, scoring ni OCR.
 */
import type { ParsedLine } from "@/app/lib/parse-bulk-items"

export interface ParseDevelopmentBlocksResult {
  items: ParsedLine[]
  warnings: string[]
  /** Líneas que fueron absorbidas por bloques de desarrollo (no mostrarlas como inválidas). */
  consumedLines: string[]
}

const MIN_ENUNCIADO_LENGTH = 10
const MAX_ITEM_NUMBER = 999
const MIN_AXIS_LENGTH = 2

const DEBUG_DEV_BLOCKS =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production"

/** Patrón: inicio de ítem (número seguido de punto o paréntesis). */
const RE_ITEM_START = /^\s*(\d+)[\.\)]\s*(.*)$/
/** Patrón: cabecera desarrollo "39 2 Números y Operaciones" → item_number, max_score, axis_label. */
const RE_DEV_HEADER = /^\s*(\d+)\s+(\d+)\s+(.+)$/
/** Patrón: puntaje explícito (N puntos o Puntaje: N). */
const RE_MAX_SCORE = /(?:^|\s)(\d+)\s*puntos?\s*$/i
const RE_PUNTAJE_LABEL = /puntaje\s*:\s*(\d+)/i
/** Patrón: línea de criterio (2 puntos:, 1 punto:, 0 punto(s):, respuesta completa, etc.). */
const RE_RUBRIC_LINE =
  /(\d+)\s*puntos?\s*[:\.]|respuesta\s+completa|parcial|incorrecta|correcta|totalmente|parcialmente/i
/** Patrón: Eje: ... */
const RE_EJE = /^eje\s*:\s*(.+)$/i

function matchItemStart(line: string): { num: number; rest: string } | null {
  const m = line.match(RE_ITEM_START)
  if (!m) return null
  const num = parseInt(m[1], 10)
  if (Number.isNaN(num) || num < 1 || num > MAX_ITEM_NUMBER) return null
  return { num, rest: (m[2] ?? "").trim() }
}

/**
 * Detecta cabecera de desarrollo: "39 2 Números y Operaciones".
 * Exige que el eje (tercer grupo) tenga longitud mínima para no confundir con "39 A 2".
 */
function matchDevHeader(line: string): { itemNumber: number; maxScore: number; axisLabel: string } | null {
  const m = line.trim().match(RE_DEV_HEADER)
  if (!m) return null
  const itemNumber = parseInt(m[1], 10)
  const maxScore = parseInt(m[2], 10)
  const axisLabel = (m[3] ?? "").trim()
  if (
    Number.isNaN(itemNumber) ||
    itemNumber < 1 ||
    itemNumber > MAX_ITEM_NUMBER ||
    Number.isNaN(maxScore) ||
    maxScore < 0 ||
    maxScore > 100 ||
    axisLabel.length < MIN_AXIS_LENGTH
  )
    return null
  return { itemNumber, maxScore, axisLabel }
}

function extractMaxScore(lines: string[]): number | null {
  for (const line of lines) {
    const t = line.trim()
    const mPuntos = t.match(RE_MAX_SCORE)
    if (mPuntos) return parseInt(mPuntos[1], 10)
    const mLabel = t.match(RE_PUNTAJE_LABEL)
    if (mLabel) return parseInt(mLabel[1], 10)
  }
  return null
}

function extractAxis(lines: string[]): string | null {
  for (const line of lines) {
    const t = line.trim()
    const m = t.match(RE_EJE)
    if (m && m[1]) return m[1].trim()
  }
  return null
}

function looksLikeRubricLine(line: string): boolean {
  const t = line.trim()
  if (t.length < 2) return false
  if (/^(criterio|rúbrica|pauta)\s*[:\.]?\s*$/i.test(t)) return true
  if (/^(criterio|rúbrica|pauta)\s*[:\.]\s*.+/i.test(t)) return true
  if (RE_RUBRIC_LINE.test(t)) return true
  if (/^\d+\s*puntos?\s*[:\.]/i.test(t)) return true
  if (/^[•·\-*]?\s*\d+\s*puntos?\s*[:\.]/i.test(t)) return true
  if (/\d+\s*ptos?\.?\s*[:\.]/i.test(t)) return true
  return false
}

/** Verdadero si la línea es ancla "Pregunta N:" (cualquier N). Devuelve el número o 0. */
function getAnchorNumber(line: string): number {
  const t = line.trim()
  const m = t.match(/Pregunta\s+(\d+)\s*:?\s*$/i) || t.match(/^[•·\-*]?\s*Pregunta\s+(\d+)\s*:?\s*$/i)
  if (!m) return 0
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= MAX_ITEM_NUMBER ? n : 0
}

/** Verdadero si la línea es ancla para el ítem dado. */
function isPreguntaAnchor(line: string, itemNumber: number): boolean {
  return getAnchorNumber(line) === itemNumber
}

/**
 * FASE 2: Busca en todo el texto anclas "Pregunta N" y extrae el bloque de contenido (enunciado + rúbrica)
 * hasta la siguiente ancla o cabecera. Devuelve un mapa número → { item_text, rubric_text, lineIndices }.
 * Solo guarda la primera aparición por número para no sobrescribir.
 */
function findAnchorContentBlocks(
  lines: string[],
  headerLineIndices: Set<number>
): Map<number, { item_text: string; rubric_text: string | null; lineIndices: number[] }> {
  const result = new Map<number, { item_text: string; rubric_text: string | null; lineIndices: number[] }>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const n = getAnchorNumber(line)
    if (n === 0) continue
    if (result.has(n)) continue
    let end = i + 1
    while (end < lines.length) {
      const nextLine = lines[end] ?? ""
      if (getAnchorNumber(nextLine) !== 0 || matchDevHeader(nextLine)) break
      end++
    }
    const blockLines = lines.slice(i, end).map((l) => (l ?? "").trim()).filter(Boolean)
    const restLines = blockLines.slice(1)
    let item_text = `Pregunta ${n}`
    let rubric_text: string | null = null
    const afterAnchor = 0
    let idx = afterAnchor
    while (idx < restLines.length && !looksLikeRubricLine(restLines[idx])) {
      const ln = restLines[idx]
      if (ln && !looksLikeSectionHeader(ln) && !looksLikePreguntaAnchorLine(ln)) {
        if (ln.length >= MIN_ENUNCIADO_LENGTH) item_text = ln
        else item_text = item_text === `Pregunta ${n}` ? ln : item_text
      }
      idx++
    }
    if (item_text === `Pregunta ${n}` && restLines[0] && !looksLikePreguntaAnchorLine(restLines[0]) && !looksLikeRubricLine(restLines[0]) && restLines[0].length >= MIN_ENUNCIADO_LENGTH) {
      item_text = restLines[0]
      idx = 1
      while (idx < restLines.length && !looksLikeRubricLine(restLines[idx])) idx++
    }
    const rubricRaw: string[] = []
    for (let j = idx; j < restLines.length; j++) {
      const ln = restLines[j]
      if (!ln) continue
      if (!looksLikeSectionHeader(ln) || /\d\s*puntos?/i.test(ln)) rubricRaw.push(ln)
    }
    const rubricMerged = mergeRubricContinuations(rubricRaw)
    if (rubricMerged.length > 0) rubric_text = rubricMerged.join("\n").trim()
    const lineIndices: number[] = []
    for (let k = i; k < end; k++) lineIndices.push(k)
    result.set(n, { item_text, rubric_text, lineIndices })
  }
  return result
}

/** Verdadero si la línea parece encabezado de sección (no debe entrar a item_text ni rubric_text). No aplica a líneas de rúbrica. */
function looksLikeSectionHeader(line: string): boolean {
  const t = line.trim()
  if (t.length < 2) return true
  if (looksLikeRubricLine(t)) return false
  const upper = t.replace(/\s/g, "")
  if (upper.length < 2) return false
  const upperRatio = (t.match(/[A-ZÁÉÍÓÚÑ]/g)?.length ?? 0) / upper.length
  if (upperRatio >= 0.85 && t.length <= 80) return true
  const known = [
    /^pauta\s+de\s+correcci[oó]n$/i,
    /^pregunta\s+abierta$/i,
    /^pauta\s+de\s+desarrollo$/i,
    /^r[uú]brica$/i,
    /^criterios?\s*$/i,
    /^instrucciones?\s*$/i,
  ]
  return known.some((r) => r.test(t))
}

/** Verdadero si la línea es solo o termina en "Pregunta N:" (ancla; no usar como enunciado). */
function looksLikePreguntaAnchorLine(line: string): boolean {
  const t = line.trim()
  return /Pregunta\s+\d+\s*:?\s*$/i.test(t) || /^[•·\-*]?\s*Pregunta\s+\d+\s*:?\s*$/i.test(t)
}

/**
 * Une líneas de rúbrica que son continuación de la anterior (no inician un nuevo criterio).
 */
function mergeRubricContinuations(rubricLines: string[]): string[] {
  if (rubricLines.length <= 1) return rubricLines.filter(Boolean).map((l) => l.trim())
  const out: string[] = []
  for (const line of rubricLines) {
    const t = line.trim()
    if (!t) continue
    const startsNewCriterion =
      /^[•·\-*]?\s*\d+\s*puntos?\s*[:\.]/i.test(t) ||
      /^\d+\s*ptos?\.?\s*[:\.]/i.test(t) ||
      /^(respuesta\s+completa|respuesta\s+parcial|respuesta\s+incorrecta|criterio|rúbrica|pauta)\s*[:\.]?\s*/i.test(t)
    if (startsNewCriterion && out.length > 0 && out[out.length - 1] !== "") {
      out.push(t)
    } else if (out.length > 0) {
      out[out.length - 1] = (out[out.length - 1] + " " + t).replace(/\s+/g, " ").trim()
    } else {
      out.push(t)
    }
  }
  return out.filter(Boolean)
}

type BlockStart =
  | { type: "classic"; lineIndex: number; itemNumber: number; rest: string }
  | { type: "header"; lineIndex: number; itemNumber: number; maxScore: number; axisLabel: string }

/**
 * Encuentra todos los inicios de bloque (clásico "N." / "N)" o cabecera "N M Eje").
 */
function findBlockStarts(lines: string[]): BlockStart[] {
  const starts: BlockStart[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const classic = matchItemStart(line)
    if (classic) {
      starts.push({
        type: "classic",
        lineIndex: i,
        itemNumber: classic.num,
        rest: classic.rest,
      })
      continue
    }
    const header = matchDevHeader(line)
    if (header) {
      starts.push({
        type: "header",
        lineIndex: i,
        itemNumber: header.itemNumber,
        maxScore: header.maxScore,
        axisLabel: header.axisLabel,
      })
    }
  }
  return starts
}

/**
 * Para un bloque que empieza en startIndex y termina antes de nextStartIndex,
 * extrae enunciado y rúbrica según el tipo de inicio.
 */
function buildItemFromBlock(
  lines: string[],
  start: BlockStart,
  lineIndices: number[],
  warnings: string[]
): ParsedLine | null {
  const blockLines = lineIndices.map((i) => lines[i] ?? "").map((l) => l.trim())

  if (start.type === "header") {
    // Cabecera "39 2 Números y Operaciones"; resto = posible ancla "Pregunta N:" + enunciado + rúbrica.
    const restLines = blockLines.slice(1).map((l) => l.trim()).filter((l) => l.length > 0)

    let item_text = `Pregunta ${start.itemNumber}`
    let rubric_text: string | null = null

    const anchorIndex = restLines.findIndex((l) => isPreguntaAnchor(l, start.itemNumber))
    const afterAnchor = anchorIndex >= 0 ? anchorIndex + 1 : 0

    const enunciadoParts: string[] = []
    let i = afterAnchor
    while (i < restLines.length && !looksLikeRubricLine(restLines[i])) {
      const line = restLines[i]
      if (
        line &&
        !isPreguntaAnchor(line, start.itemNumber) &&
        !looksLikeSectionHeader(line) &&
        !looksLikePreguntaAnchorLine(line)
      ) {
        enunciadoParts.push(line)
      }
      i++
    }
    const enunciadoStr = enunciadoParts.join(" ").replace(/\s+/g, " ").trim()
    if (enunciadoStr.length >= MIN_ENUNCIADO_LENGTH) {
      item_text = enunciadoStr
    }

    const rubricRaw: string[] = []
    for (let j = i; j < restLines.length; j++) {
      const line = restLines[j]
      if (!line) continue
      const isSection = looksLikeSectionHeader(line)
      const hasPuntos = /\d\s*puntos?/i.test(line)
      if (!isSection || hasPuntos) rubricRaw.push(line)
    }
    const rubricMerged = mergeRubricContinuations(rubricRaw)
    if (rubricMerged.length > 0) {
      rubric_text = rubricMerged.join("\n").trim()
    } else if (restLines.length > afterAnchor + 1) {
      const fallback = restLines
        .slice(afterAnchor)
        .filter(
          (l) =>
            l &&
            !isPreguntaAnchor(l, start.itemNumber) &&
            !looksLikePreguntaAnchorLine(l) &&
            !looksLikeSectionHeader(l)
        )
      if (fallback.length > 0) {
        rubric_text = fallback.join("\n").trim()
      }
    }
    if (DEBUG_DEV_BLOCKS && (start.itemNumber === 39 || start.itemNumber === 40)) {
      console.log(`[parse-development-blocks] Bloque ${start.itemNumber}:`, {
        cabecera: blockLines[0],
        restLinesCount: restLines.length,
        restLines: restLines.map((l, idx) => `${idx}: "${l.slice(0, 80)}${l.length > 80 ? "…" : ""}"`),
        anchorIndex,
        afterAnchor,
        enunciadoParts,
        i_despues_enunciado: i,
        rubricRawCount: rubricRaw.length,
        rubricRaw: rubricRaw.map((l) => l.slice(0, 60) + (l.length > 60 ? "…" : "")),
        rubricMergedCount: rubricMerged.length,
        rubric_text_len: rubric_text?.length ?? 0,
      })
    }

    return {
      item_number: start.itemNumber,
      item_text,
      axis_label: start.axisLabel,
      skill_label: null,
      competence: null,
      difficulty: null,
      question_type: item_text.length <= 120 ? "short_answer" : "essay",
      correct_answer: null,
      max_score: start.maxScore,
      rubric_text,
    }
  }

  // Bloque clásico: "N. enunciado" + rúbrica.
  const firstLine = lines[start.lineIndex] ?? ""
  const itemStart = matchItemStart(firstLine)
  if (!itemStart) return null

  const { num: itemNumber, rest: firstLineRest } = itemStart
  const maxScore = extractMaxScore(blockLines) ?? extractMaxScore([firstLineRest])
  const axis_label = extractAxis(blockLines)
  const { enunciado, rubricLines } = extractEnunciadoAndRubric(lines, lineIndices, firstLineRest)
  const rubric_text = rubricLines.length > 0 ? rubricLines.join("\n").trim() : null

  const hasEnoughEnunciado = enunciado.length >= MIN_ENUNCIADO_LENGTH
  const hasRubric = rubric_text && rubric_text.length >= 5
  if (!hasEnoughEnunciado && !hasRubric) return null

  const item_text = hasEnoughEnunciado ? enunciado : `Pregunta ${itemNumber}`
  if (!hasEnoughEnunciado && hasRubric) {
    warnings.push(`Ítem ${itemNumber}: enunciado muy corto; se usó "Pregunta ${itemNumber}". Revise si corresponde.`)
  }

  let finalMaxScore = maxScore
  if (finalMaxScore == null && hasRubric) {
    const fromRubric = rubricLines.join(" ").match(/(\d+)\s*puntos?/i)
    if (fromRubric) {
      const inferred = parseInt(fromRubric[1], 10)
      if (!Number.isNaN(inferred) && inferred <= 20) {
        finalMaxScore = inferred
        warnings.push(`Puntaje del ítem ${itemNumber} inferido desde la rúbrica (${inferred} puntos). Revise si corresponde.`)
      }
    }
  }

  return {
    item_number: itemNumber,
    item_text,
    axis_label,
    skill_label: null,
    competence: null,
    difficulty: null,
    question_type: enunciado.length <= 120 ? "short_answer" : "essay",
    correct_answer: null,
    max_score: finalMaxScore,
    rubric_text,
  }
}

function extractEnunciadoAndRubric(
  lines: string[],
  lineIndices: number[],
  firstLineRest: string
): { enunciado: string; rubricLines: string[] } {
  const rubricLines: string[] = []
  const enunciadoParts: string[] = []
  if (firstLineRest.length >= 0) enunciadoParts.push(firstLineRest)

  let foundRubric = false
  for (let k = 1; k < lineIndices.length; k++) {
    const idx = lineIndices[k]
    const line = lines[idx] ?? ""
    const t = line.trim()
    if (RE_EJE.test(t)) break
    if (looksLikeRubricLine(line)) {
      foundRubric = true
      rubricLines.push(line)
    } else if (foundRubric) {
      rubricLines.push(line)
    } else {
      if (enunciadoParts.length > 0 || t.length > 0) enunciadoParts.push(t)
    }
  }

  const enunciado = enunciadoParts.join(" ").replace(/\s+/g, " ").trim()
  return { enunciado, rubricLines }
}

export function parseDevelopmentBlocksFromText(normalizedText: string): ParseDevelopmentBlocksResult {
  const warnings: string[] = []
  const items: ParsedLine[] = []
  const consumedLines: string[] = []
  const text = typeof normalizedText === "string" ? normalizedText : ""
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd())

  const starts = findBlockStarts(lines)
  if (starts.length === 0) return { items, warnings, consumedLines }

  const headerLineIndices = new Set(
    starts.filter((s): s is typeof s & { type: "header" } => s.type === "header").map((s) => s.lineIndex)
  )
  const contentByNumber = findAnchorContentBlocks(lines, headerLineIndices)

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]
    const nextStartIndex = s + 1 < starts.length ? starts[s + 1].lineIndex : lines.length
    const lineIndices: number[] = []
    for (let i = start.lineIndex; i < nextStartIndex; i++) {
      lineIndices.push(i)
      const raw = (lines[i] ?? "").trim()
      if (raw && !consumedLines.includes(raw)) consumedLines.push(raw)
    }
    if (DEBUG_DEV_BLOCKS && start.type === "header" && (start.itemNumber === 39 || start.itemNumber === 40)) {
      console.log(`[parse-development-blocks] Bloque ${start.itemNumber} límites: lineIndices ${start.lineIndex}..${nextStartIndex - 1} (${lineIndices.length} líneas)`)
    }

    if (start.type === "header") {
      const blockLines = lineIndices.map((i) => (lines[i] ?? "").trim())
      const restLines = blockLines.slice(1).map((l) => l.trim()).filter((l) => l.length > 0)

      let item_text = `Pregunta ${start.itemNumber}`
      let rubric_text: string | null = null

      if (restLines.length > 0) {
        const anchorIndex = restLines.findIndex((l) => isPreguntaAnchor(l, start.itemNumber))
        const afterAnchor = anchorIndex >= 0 ? anchorIndex + 1 : 0
        const enunciadoParts: string[] = []
        let i = afterAnchor
        while (i < restLines.length && !looksLikeRubricLine(restLines[i])) {
          const line = restLines[i]
          if (
            line &&
            !isPreguntaAnchor(line, start.itemNumber) &&
            !looksLikeSectionHeader(line) &&
            !looksLikePreguntaAnchorLine(line)
          ) {
            enunciadoParts.push(line)
          }
          i++
        }
        const enunciadoStr = enunciadoParts.join(" ").replace(/\s+/g, " ").trim()
        if (enunciadoStr.length >= MIN_ENUNCIADO_LENGTH) item_text = enunciadoStr
        const rubricRaw: string[] = []
        for (let j = i; j < restLines.length; j++) {
          const line = restLines[j]
          if (!line) continue
          const isSection = looksLikeSectionHeader(line)
          const hasPuntos = /\d\s*puntos?/i.test(line)
          if (!isSection || hasPuntos) rubricRaw.push(line)
        }
        const rubricMerged = mergeRubricContinuations(rubricRaw)
        if (rubricMerged.length > 0) rubric_text = rubricMerged.join("\n").trim()
        else if (restLines.length > afterAnchor + 1) {
          const fallback = restLines
            .slice(afterAnchor)
            .filter(
              (l) =>
                l &&
                !isPreguntaAnchor(l, start.itemNumber) &&
                !looksLikePreguntaAnchorLine(l) &&
                !looksLikeSectionHeader(l)
            )
          if (fallback.length > 0) rubric_text = fallback.join("\n").trim()
        }
      } else {
        const linked = contentByNumber.get(start.itemNumber)
        if (linked) {
          item_text = linked.item_text
          rubric_text = linked.rubric_text
          for (const idx of linked.lineIndices) {
            const raw = (lines[idx] ?? "").trim()
            if (raw && !consumedLines.includes(raw)) consumedLines.push(raw)
          }
        }
      }

      if (DEBUG_DEV_BLOCKS && (start.itemNumber === 39 || start.itemNumber === 40)) {
        console.log(`[parse-development-blocks] Bloque ${start.itemNumber}:`, {
          restLinesCount: restLines.length,
          linked: !!contentByNumber.get(start.itemNumber),
          rubric_text_len: rubric_text?.length ?? 0,
        })
      }

      items.push({
        item_number: start.itemNumber,
        item_text,
        axis_label: start.axisLabel,
        skill_label: null,
        competence: null,
        difficulty: null,
        question_type: item_text.length <= 120 ? "short_answer" : "essay",
        correct_answer: null,
        max_score: start.maxScore,
        rubric_text,
      })
      continue
    }

    const item = buildItemFromBlock(lines, start, lineIndices, warnings)
    if (item && item.item_number >= 1) {
      const alreadyEmitted = items.some((x) => x.item_number === item.item_number)
      if (!alreadyEmitted) items.push(item)
    }
  }

  return { items, warnings, consumedLines }
}
