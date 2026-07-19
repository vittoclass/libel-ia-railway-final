/**
 * Sprint 33 — Parser estructural de criterios de rúbrica (rubric-first).
 * Universal: sin taxonomías por prueba/alumno/asignatura.
 * Solo LAB / núcleo; no scoring ni Matcher.
 */

export type CriterionIdSource =
  | "explicit_rubric_id"
  | "explicit_position"
  | "stable_label_position"

export type RubricParseStatus =
  | "PARSED_EXPLICIT"
  | "PARSED_HOLISTIC"
  | "RUBRIC_CRITERIA_NOT_VERIFIABLE"
  | "RUBRIC_EMPTY"

export interface ParsedRubricDescriptorBand {
  /** Etiqueta original del nivel en la rúbrica (si se detectó). */
  level_label: string
  /** Texto del descriptor. */
  text: string
  /** Índice ordinal 0 = superior … N-1 = inferior. */
  ordinal: number
}

export interface ParsedRubricCriterion {
  criterion_id: string
  criterion_label: string
  criterion_id_source: CriterionIdSource
  position: number
  /** Descriptores ordenados de superior a inferior cuando se pudieron segmentar. */
  descriptors: ParsedRubricDescriptorBand[]
  /** Fragmento de rúbrica asociado al criterio (para el prompt). */
  rubric_slice: string
}

export interface ParseRubricCriteriaResult {
  status: RubricParseStatus
  format:
    | "numbered_tab_row"
    | "block_colon_scale"
    | "holistic"
    | "none"
  criteria: ParsedRubricCriterion[]
  warnings: string[]
}

const LEVEL_MARKER_RE =
  /(Logrado|Medianamente\s+Logrado|Por\s+Lograr|No\s+Logrado|Excelente|Bueno|Regular|Insuficiente)\s*\(\s*\d+\s*pts?\s*\)\s*:?/gi

function normalizeSpaces(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim()
}

function normalizeLabelKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
}

function stableIdFromLabelPosition(label: string, position: number): string {
  const key = normalizeLabelKey(label) || "criterion"
  return `${key}__p${position}`
}

function splitDescriptorBands(slice: string): ParsedRubricDescriptorBand[] {
  const markers: Array<{ label: string; start: number; endMarker: number }> = []
  const re = new RegExp(LEVEL_MARKER_RE.source, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(slice)) != null) {
    markers.push({
      label: normalizeSpaces(m[1] ?? m[0]),
      start: m.index,
      endMarker: m.index + m[0].length,
    })
  }
  if (markers.length < 2) return []

  const bands: ParsedRubricDescriptorBand[] = []
  for (let i = 0; i < markers.length; i++) {
    const textStart = markers[i].endMarker
    const textEnd = i + 1 < markers.length ? markers[i + 1].start : slice.length
    const text = normalizeSpaces(slice.slice(textStart, textEnd)).replace(/\.\s*$/, "")
    if (!text) continue
    bands.push({
      level_label: markers[i].label,
      text,
      ordinal: bands.length,
    })
  }
  return bands
}

/**
 * Filas tabuladas tipo:
 * 1. Label\tdesc1\tdesc2\tdesc3\tdesc4
 */
function parseNumberedTabRows(rubricText: string): ParsedRubricCriterion[] {
  const lines = rubricText.split(/\r?\n/)
  const out: ParsedRubricCriterion[] = []
  for (const line of lines) {
    if (!line.includes("\t")) continue
    const cols = line.split("\t").map((c) => c.trim()).filter(Boolean)
    if (cols.length < 3) continue
    const head = cols[0]
    const numbered = /^(\d{1,2})\s*[.)]\s*(.+)$/.exec(head)
    if (!numbered) continue
    const explicitId = numbered[1]
    const label = normalizeSpaces(numbered[2])
    if (label.length < 3 || label.length > 160) continue
    // Evitar fila de encabezado
    if (/^criterio$/i.test(label)) continue

    const position = out.length + 1
    const descriptorCols = cols.slice(1)
    const descriptors: ParsedRubricDescriptorBand[] = descriptorCols.map((text, i) => ({
      level_label: "",
      text: normalizeSpaces(text),
      ordinal: i,
    }))

    out.push({
      criterion_id: explicitId,
      criterion_label: label,
      criterion_id_source: "explicit_rubric_id",
      position,
      descriptors,
      rubric_slice: line,
    })
  }
  return out
}

/**
 * Bloques "Label: Logrado (N pts): … Medianamente …"
 */
function parseBlockColonScale(rubricText: string): ParsedRubricCriterion[] {
  const blocks = rubricText
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean)

  const out: ParsedRubricCriterion[] = []

  for (const block of blocks) {
    const firstLine = block.split(/\r?\n/)[0] ?? block
    // Label termina en ":" antes del primer marcador de nivel, o al inicio del bloque.
    const labelMatch =
      /^([^\n]{3,160}?)\s*:\s*(?=Logrado|Medianamente|Por\s+Lograr|No\s+Logrado|Excelente|Bueno)/i.exec(
        firstLine,
      ) ??
      /^([^\n]{3,160}?)\s*:\s*(?=Logrado|Medianamente|Por\s+Lograr|No\s+Logrado|Excelente|Bueno)/i.exec(
        block,
      )

    if (!labelMatch) continue
    let label = normalizeSpaces(labelMatch[1])
    // Quitar numeración explícita del label si existe
    const numbered = /^(\d{1,2})\s*[.)]\s*(.+)$/.exec(label)
    let idSource: CriterionIdSource = "stable_label_position"
    let criterionId = ""
    if (numbered) {
      criterionId = numbered[1]
      label = normalizeSpaces(numbered[2])
      idSource = "explicit_rubric_id"
    }

    const descriptors = splitDescriptorBands(block)
    if (descriptors.length < 2) continue

    const position = out.length + 1
    if (!criterionId) {
      criterionId = stableIdFromLabelPosition(label, position)
      idSource = "stable_label_position"
    }

    out.push({
      criterion_id: criterionId,
      criterion_label: label,
      criterion_id_source: idSource,
      position,
      descriptors,
      rubric_slice: block,
    })
  }

  return out
}

/**
 * Detecta rúbrica holística: un solo bloque de escala sin encabezados de criterio múltiples.
 */
function tryHolistic(rubricText: string): ParsedRubricCriterion | null {
  const descriptors = splitDescriptorBands(rubricText)
  if (descriptors.length < 2) return null
  // Si hay varios títulos con ":" + escala, no es holística.
  const blockCount = parseBlockColonScale(rubricText).length
  if (blockCount >= 2) return null
  const tabCount = parseNumberedTabRows(rubricText).length
  if (tabCount >= 2) return null

  return {
    criterion_id: "holistic_item",
    criterion_label: "holistic_item",
    criterion_id_source: "stable_label_position",
    position: 1,
    descriptors,
    rubric_slice: rubricText.trim(),
  }
}

/**
 * Parsea criterios explícitos de la rúbrica.
 * No inventa taxonomías. Si no puede verificar estructura → NOT_VERIFIABLE.
 */
export function parseRubricCriteria(rubricText: string): ParseRubricCriteriaResult {
  const text = String(rubricText ?? "").trim()
  const warnings: string[] = []

  if (!text) {
    return {
      status: "RUBRIC_EMPTY",
      format: "none",
      criteria: [],
      warnings: ["rubric_text_empty"],
    }
  }

  const tab = parseNumberedTabRows(text)
  if (tab.length >= 1) {
    return {
      status: "PARSED_EXPLICIT",
      format: "numbered_tab_row",
      criteria: tab,
      warnings,
    }
  }

  const blocks = parseBlockColonScale(text)
  if (blocks.length >= 1) {
    return {
      status: "PARSED_EXPLICIT",
      format: "block_colon_scale",
      criteria: blocks,
      warnings,
    }
  }

  const holistic = tryHolistic(text)
  if (holistic) {
    return {
      status: "PARSED_HOLISTIC",
      format: "holistic",
      criteria: [holistic],
      warnings: ["holistic_fallback"],
    }
  }

  return {
    status: "RUBRIC_CRITERIA_NOT_VERIFIABLE",
    format: "none",
    criteria: [],
    warnings: ["structure_not_verifiable"],
  }
}

/** ¿La evidencia del estudiante es vacía o no observable? */
export function isStudentEvidenceNotObservable(studentText: string): boolean {
  const t = String(studentText ?? "").trim()
  if (!t) return true
  if (t.length < 8) return true
  const lower = t.toLowerCase()
  return /^(ilegible|no\s+legible|sin\s+respuesta|n\/?a|null|undefined)[\s.]*$/i.test(lower)
}
