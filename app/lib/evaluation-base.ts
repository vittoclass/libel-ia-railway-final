/**
 * Capa estructural: modelo unificado de "evaluación base" (instrumento / pauta).
 * FASE 1: solo tipos y constructoras; no integrado al flujo de evaluación, OMR ni persistencia.
 */

export type EvaluationBaseItemType = "SM" | "VF" | "DES" | "OTHER"

export type EvaluationBaseSource = "source_exam" | "structured_form" | "text_form" | "unknown"

export type EvaluationBaseItem = {
  id: string
  order: number
  type: EvaluationBaseItemType
  prompt?: string
  correctAnswer?: string | null
  maxScore?: number | null
  rubricText?: string | null
  axisId?: string | null
  skillId?: string | null
  metadata?: Record<string, unknown>
}

export type EvaluationBase = {
  source: EvaluationBaseSource
  title?: string | null
  totalItems: number
  closedItems: number
  developmentItems: number
  items: EvaluationBaseItem[]
}

/** Fila de prueba base alineada con source_exam_items (campos opcionales según migraciones). */
export type EvaluationBaseSourceExamItemInput = {
  /** id UUID de fila en BD; preferido como id estable. */
  rowId: string
  item_number?: number | null
  item_text?: string | null
  axis_id?: string | null
  skill_id?: string | null
  question_type?: string | null
  correct_answer?: string | null
  max_score?: number | null
  rubric_text?: string | null
}

export type EvaluationBaseSourceExamInput = {
  title?: string | null
  items: EvaluationBaseSourceExamItemInput[]
}

/** Campos equivalentes al formulario del evaluador (solo strings; sin React). */
export type EvaluationBaseFormInput = {
  pautaEstructurada?: string
  pautaCorrectaAlternativas?: string
  rubrica?: string
  tipoPrueba?: "mixta" | "solo_desarrollo" | "solo_alternativas"
  title?: string | null
}

export type BuildEvaluationBaseInput = {
  sourceExam?: EvaluationBaseSourceExamInput | null
  form?: EvaluationBaseFormInput | null
}

const ORDER_SCALE = 1000

function clampOrder(n: number): number {
  if (!Number.isFinite(n) || n < 1) return ORDER_SCALE
  return Math.min(Math.floor(n), 999_999)
}

/** Id estable: usa el identificador dado; si vacío, fallback neutro por orden. */
export function stableItemId(preferred: string | undefined, order: number): string {
  const t = (preferred ?? "").trim()
  if (t.length > 0) return t
  return `item-${order}`
}

function parseSemicolonPairs(text: string | undefined): Array<{ key: string; value: string }> {
  if (!text || !String(text).trim()) return []
  const out: Array<{ key: string; value: string }> = []
  for (const part of String(text).split(";")) {
    const p = part.trim()
    if (!p) continue
    const idx = p.indexOf(":")
    if (idx <= 0) continue
    const key = p.slice(0, idx).trim()
    const value = p.slice(idx + 1).trim()
    if (key) out.push({ key, value })
  }
  return out
}

function parsePautaEstructurada(pautaEstructurada: string | undefined): Array<{ id: string; maxScore: number }> {
  const pairs = parseSemicolonPairs(pautaEstructurada)
  const items: Array<{ id: string; maxScore: number }> = []
  for (const { key, value } of pairs) {
    const maxScore = Number.parseInt(value, 10)
    if (!key || Number.isNaN(maxScore) || maxScore <= 0) continue
    items.push({ id: key.trim(), maxScore })
  }
  return items
}

function parseCorrectAlternatives(pautaCorrectaAlternativas: string | undefined): Map<string, string> {
  const m = new Map<string, string>()
  for (const { key, value } of parseSemicolonPairs(pautaCorrectaAlternativas)) {
    if (!key || !value) continue
    m.set(key.trim().toUpperCase(), value.trim())
  }
  return m
}

/** Mapeo explícito de question_type en BD (sin inferir desde el enunciado). */
function mapSourceQuestionType(raw: string | null | undefined): EvaluationBaseItemType {
  const t = (raw ?? "").trim().toLowerCase()
  if (!t) return "OTHER"
  if (t === "vf" || t === "true_false" || t === "verdadero_falso") return "VF"
  if (t === "sm" || t === "mc" || t === "multiple_choice" || t === "seleccion" || t === "alternativa") return "SM"
  if (t === "des" || t === "dev" || t === "desarrollo" || t === "open" || t === "abierta") return "DES"
  return "OTHER"
}

/**
 * Subtipo de ítem cerrado a partir del valor de respuesta correcta (no del texto del enunciado).
 */
function inferClosedTypeFromCorrectAnswer(correct: string | null | undefined): EvaluationBaseItemType {
  const u = (correct ?? "").trim().toUpperCase()
  if (u === "V" || u === "F") return "VF"
  if (/^[A-E]$/.test(u)) return "SM"
  return "OTHER"
}

/**
 * Respuesta correcta reconocible como ítem de marcar (OMR / burbuja / VF), sin mirar el id del ítem.
 * Excluye textos largos o abiertos que no son una clave de opción única.
 */
export function hasBubbleOrClosedKeyAnswer(correct: string | null | undefined): boolean {
  const u = (correct ?? "").trim().toUpperCase()
  if (!u) return false
  if (u.length > 8) return false
  if (u === "V" || u === "F") return true
  if (/^[A-E]$/.test(u)) return true
  if (/^[0-9]$/.test(u)) return true
  return false
}

/**
 * Ítem incluible en inventario OMR / cerradas alineadas: no abiertas, no desarrollo, sin OTHER ambiguo.
 */
export function isEvaluationBaseItemClosedForOmr(it: EvaluationBaseItem): boolean {
  if (it.type === "DES") return false
  if (it.maxScore != null && it.maxScore > 1) return false
  if (it.type === "SM" || it.type === "VF") return true
  if (it.type === "OTHER") {
    return hasBubbleOrClosedKeyAnswer(it.correctAnswer)
  }
  return false
}

export function getFormItemCorrectAnswer(
  pautaCorrectaAlternativas: string | undefined,
  itemId: string,
): string | undefined {
  const m = parseCorrectAlternatives(pautaCorrectaAlternativas)
  return lookupCorrect(m, itemId)
}

function inferTypeFromFormItem(
  _id: string,
  maxScore: number,
  correctUpper: string | undefined,
  tipoPrueba: EvaluationBaseFormInput["tipoPrueba"],
): EvaluationBaseItemType {
  if (tipoPrueba === "solo_desarrollo") return "DES"
  if (maxScore > 1) return "DES"
  if (tipoPrueba === "solo_alternativas") {
    const fromAns = inferClosedTypeFromCorrectAnswer(correctUpper ?? "")
    /** No asumir SM sin evidencia de opción marcable (evita mezclar abiertas mal cargadas). */
    return fromAns
  }
  if (maxScore === 1) {
    const fromAns = inferClosedTypeFromCorrectAnswer(correctUpper ?? "")
    if (fromAns !== "OTHER") return fromAns
    return "OTHER"
  }
  return "OTHER"
}

/**
 * Clasificación estructural desde pauta numérica + respuesta correcta (sin depender del nombre del id).
 */
export function isFormStructuredRowClosedForOmr(params: {
  maxScore: number
  correctAnswer: string | null | undefined
  tipoPrueba?: EvaluationBaseFormInput["tipoPrueba"]
}): boolean {
  const tipo = inferTypeFromFormItem(
    "",
    params.maxScore,
    params.correctAnswer != null ? String(params.correctAnswer).trim().toUpperCase() : undefined,
    params.tipoPrueba,
  )
  if (tipo === "DES") return false
  if (tipo === "SM" || tipo === "VF") return true
  return hasBubbleOrClosedKeyAnswer(params.correctAnswer)
}

function lookupCorrect(map: Map<string, string>, id: string): string | undefined {
  const u = id.trim().toUpperCase()
  return map.get(u) ?? map.get(`SM${u}`.toUpperCase())
}

function computeCounts(items: EvaluationBaseItem[]): Pick<EvaluationBase, "closedItems" | "developmentItems" | "totalItems"> {
  let closed = 0
  let dev = 0
  for (const it of items) {
    if (it.type === "DES") {
      dev++
      continue
    }
    if (it.type === "SM" || it.type === "VF") {
      closed++
      continue
    }
    const max = it.maxScore ?? 0
    if (max > 1) dev++
    else closed++
  }
  return { totalItems: items.length, closedItems: closed, developmentItems: dev }
}

function sortByOrder(items: EvaluationBaseItem[]): EvaluationBaseItem[] {
  return [...items].sort((a, b) => a.order - b.order)
}

function buildFromSourceExam(exam: EvaluationBaseSourceExamInput): EvaluationBaseItem[] {
  const rows: EvaluationBaseItem[] = []
  let seq = 0
  for (const it of exam.items) {
    seq++
    const order = clampOrder(Number(it.item_number) > 0 ? Number(it.item_number) : seq)
    const id = stableItemId(it.rowId, seq)
    const qType = mapSourceQuestionType(it.question_type)
    let type: EvaluationBaseItemType = qType
    const max = it.max_score != null && Number.isFinite(Number(it.max_score)) ? Number(it.max_score) : null
    if (type === "OTHER" && max != null && max > 1) type = "DES"
    if (type === "OTHER" && (it.correct_answer ?? "").trim() && (max == null || max <= 1)) {
      type = inferClosedTypeFromCorrectAnswer(it.correct_answer)
    }
    const rub = (it.rubric_text ?? "").trim()
    if (type === "OTHER" && rub.length >= 40 && !hasBubbleOrClosedKeyAnswer(it.correct_answer)) {
      type = "DES"
    }
    rows.push({
      id,
      order,
      type,
      prompt: it.item_text ?? undefined,
      correctAnswer: it.correct_answer != null ? String(it.correct_answer).trim() || null : null,
      maxScore: max,
      rubricText: it.rubric_text != null ? String(it.rubric_text).trim() || null : null,
      axisId: it.axis_id ?? null,
      skillId: it.skill_id ?? null,
      metadata: {
        source: "source_exam",
        item_number: it.item_number ?? null,
        rowId: it.rowId,
      },
    })
  }
  return sortByOrder(rows)
}

function buildFromForm(form: EvaluationBaseFormInput): EvaluationBaseItem[] {
  const structured = parsePautaEstructurada(form.pautaEstructurada)
  const correctMap = parseCorrectAlternatives(form.pautaCorrectaAlternativas)
  const rubric = (form.rubrica ?? "").trim() || null
  const rows: EvaluationBaseItem[] = []
  let seq = 0
  for (const { id, maxScore } of structured) {
    seq++
    const order = clampOrder(seq)
    const stableId = stableItemId(id, seq)
    const corrRaw = lookupCorrect(correctMap, id)
    const type = inferTypeFromFormItem(id, maxScore, corrRaw, form.tipoPrueba)
    rows.push({
      id: stableId,
      order,
      type,
      prompt: undefined,
      correctAnswer: corrRaw ?? null,
      maxScore,
      rubricText: type === "DES" && rubric ? rubric : null,
      axisId: null,
      skillId: null,
      metadata: {
        source: "structured_form",
        formId: id,
      },
    })
  }
  if (rows.length === 0 && rubric && form.tipoPrueba === "solo_desarrollo") {
    rows.push({
      id: "item-1",
      order: ORDER_SCALE,
      type: "DES",
      rubricText: rubric,
      maxScore: null,
      correctAnswer: null,
      metadata: { source: "text_form", note: "solo_desarrollo_sin_pauta_estructurada" },
    })
  }
  return sortByOrder(rows)
}

/**
 * Enlaza respuestas correctas del formulario a ítems de prueba base por número de ítem o por clave.
 */
function overlayFormCorrectAnswers(items: EvaluationBaseItem[], form: EvaluationBaseFormInput): EvaluationBaseItem[] {
  const correctMap = parseCorrectAlternatives(form.pautaCorrectaAlternativas)
  if (correctMap.size === 0) return items
  return items.map((it) => {
    const meta = it.metadata ?? {}
    const num = meta.item_number != null ? Number(meta.item_number) : NaN
    const keys: string[] = []
    if (typeof meta.formId === "string") keys.push(meta.formId)
    if (Number.isFinite(num) && num >= 1) keys.push(String(num), `P${num}`, `SM${num}`)
    let corr: string | undefined
    for (const k of keys) {
      corr = lookupCorrect(correctMap, k)
      if (corr) break
    }
    if (!corr) return it
    const merged = { ...it, correctAnswer: corr }
    if (it.type === "OTHER" && (it.maxScore ?? 1) <= 1) {
      merged.type = inferClosedTypeFromCorrectAnswer(corr)
    }
    return merged
  })
}

/**
 * Construye un {@link EvaluationBase} a partir de datos ya disponibles (prueba base y/o formulario).
 * No llama APIs, no persiste ni modifica el flujo actual.
 *
 * Prioridad: si hay ítems en `sourceExam`, se usan como lista principal; se enriquecen con
 * `form.pautaCorrectaAlternativas` cuando las claves coinciden. Si no hay source, se usa solo el formulario.
 */
export function buildEvaluationBase(input: BuildEvaluationBaseInput): EvaluationBase {
  const title = input.sourceExam?.title ?? input.form?.title ?? null
  let items: EvaluationBaseItem[] = []
  let source: EvaluationBaseSource = "unknown"

  if (input.sourceExam?.items?.length) {
    items = buildFromSourceExam(input.sourceExam)
    source = "source_exam"
    if (input.form) {
      items = overlayFormCorrectAnswers(items, input.form)
    }
  } else if (input.form && (input.form.pautaEstructurada?.trim() || input.form.tipoPrueba === "solo_desarrollo")) {
    items = buildFromForm(input.form)
    source =
      parsePautaEstructurada(input.form.pautaEstructurada).length > 0 ? "structured_form" : "text_form"
  }

  const counts = computeCounts(items)
  return {
    source,
    title,
    ...counts,
    items,
  }
}
