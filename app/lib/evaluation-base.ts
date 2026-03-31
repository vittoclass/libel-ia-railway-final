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

/**
 * Slot canónico alineado con la pauta estructurada del evaluador y con `parsePautaEstructurada` del servidor:
 * - C{n} = ítem cerrado (OMR / alternativas / VF en slot n)
 * - P{n} = desarrollo / abierta en slot n
 * El UUID de BD permanece en `metadata.rowId` para trazabilidad; el `id` del ítem es siempre el slot.
 */
export function canonicalSlotIdForSourceItem(type: EvaluationBaseItemType, itemNumber: number): string {
  const n = Math.floor(itemNumber)
  if (!Number.isFinite(n) || n < 1) return `item-${itemNumber}`
  return type === "DES" ? `P${n}` : `C${n}`
}

function canonicalIdForSourceRow(
  type: EvaluationBaseItemType,
  itemNumber: number | null | undefined,
  rowId: string,
  seq: number,
): string {
  const n = Number(itemNumber)
  if (Number.isFinite(n) && n >= 1) return canonicalSlotIdForSourceItem(type, n)
  return stableItemId(rowId, seq)
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
  if (
    t === "des" ||
    t === "dev" ||
    t === "desarrollo" ||
    t === "open" ||
    t === "abierta" ||
    t === "essay" ||
    t === "short_answer" ||
    t === "open_ended" ||
    t === "respuesta_abierta"
  ) {
    return "DES"
  }
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

const INFER_TYPE_FROM_FORM_ITEM_TRACE_VERSION = "v2_altEvidence";

type AltEvidenceScan = {
  ok: boolean
  foundLetters: Array<"A" | "B" | "C" | "D">
  /**
   * Texto real usado para el scan (para trazabilidad en UI).
   * Ojo: puede ser largo; se muestra con scroll en el panel.
   */
  evaluatedText: string
}

function looksLikeMultipleChoiceAlternatives(text: string | null | undefined): boolean {
  // Mantener firma booleana para no romper usos externos (por ahora solo se usa internamente).
  return looksLikeMultipleChoiceAlternativesWithTrace(text).ok
}

function looksLikeMultipleChoiceAlternativesWithTrace(text: string | null | undefined): AltEvidenceScan {
  const raw = text ?? ""
  const t = raw.toUpperCase()
  if (!t.trim()) {
    return { ok: false, foundLetters: [], evaluatedText: raw }
  }

  // Detección SOLO por patrón:
  // "A (1 PTJE)", "B (2 pts)", etc.
  // Equivalente a /[A-D]\s*\(/i (letra + espacios + "("), sin depender de ")" ni ".".
  const foundLetters: AltEvidenceScan["foundLetters"] = []
  const letters: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"]

  for (const L of letters) {
    // Requerimos letra + "(" (con espacios opcionales) para evitar falsos positivos.
    const re = new RegExp(String.raw`(?:^|\s)${L}\s*\(`, "i")
    if (re.test(t)) foundLetters.push(L)
  }

  const ok = foundLetters.length >= 2

  // Trace interno: muestra el texto real evaluado (con truncado seguro en consola).
  const consoleText = raw.length > 2000 ? raw.slice(0, 2000) + "\n...[TRUNCATED]" : raw
  console.log("[ALT_EVIDENCE_SCAN]", { ok, foundLetters, evaluatedTextConsole: consoleText })

  return { ok, foundLetters, evaluatedText: raw }
}

function looksLikeVerdaderoFalso(text: string | null | undefined): boolean {
  const t = (text ?? "").toUpperCase()
  if (!t.trim()) return false
  // Evidencia mínima para VF en textos reales (Verdadero/Falso o V/F).
  return (
    /\bVERDADERO\b/.test(t) ||
    /\bFALSO\b/.test(t) ||
    /V\s*\/\s*F/.test(t) ||
    /\bV\)\s*/.test(t) ||
    /\bF\)\s*/.test(t) ||
    /\bV\.\s*/.test(t) ||
    /\bF\.\s*/.test(t)
  )
}

/**
 * Ítem incluible en inventario OMR / cerradas alineadas: no abiertas, no desarrollo, sin OTHER ambiguo.
 */
export function isEvaluationBaseItemClosedForOmr(it: EvaluationBaseItem): boolean {
  if (it.type === "DES") return false
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
  traceOut?: { source?: string },
): EvaluationBaseItemType {
  if (tipoPrueba === "solo_desarrollo") {
    if (traceOut) traceOut.source = `inferTypeFromFormItem:${INFER_TYPE_FROM_FORM_ITEM_TRACE_VERSION}:solo_desarrollo`
    return "DES"
  }
  const corr = (correctUpper ?? "").trim().toUpperCase()

  // Evidencia de cerrada SIN depender exclusivamente de correctAnswer:
  // - si la pauta/ids ya sugieren cerrada (C{n}, SM{n}, VF{n})
  // - si el modo es solo_alternativas
  // - si existe correctAnswer reconocible (A-E / V-F / 0-9)
  if (hasBubbleOrClosedKeyAnswer(corr)) {
    if (traceOut) traceOut.source = `inferTypeFromFormItem:${INFER_TYPE_FROM_FORM_ITEM_TRACE_VERSION}:hasBubbleOrClosedKeyAnswer`
    return inferClosedTypeFromCorrectAnswer(corr)
  }

  const idU = String(_id ?? "").trim().toUpperCase()
  const idSuggestClosed =
    /^C\s*\d+$/.test(idU) || // pauta estructurada con slot cerrado
    /^SM\s*\d+$/.test(idU) ||
    /^VF\s*\d+$/.test(idU) ||
    /^SM\d+$/.test(idU) ||
    /^VF\d+$/.test(idU)

  if (tipoPrueba === "solo_alternativas") {
    // Sin correctAnswer: por defecto tratamos como SM (alternativas), VF solo si el id lo indica.
    if (/^VF\s*\d+$/.test(idU) || /^VF\d+$/.test(idU)) return "VF"
    if (traceOut) traceOut.source = `inferTypeFromFormItem:${INFER_TYPE_FROM_FORM_ITEM_TRACE_VERSION}:solo_alternativas_noCorrectAnswer_defaultSM`
    return "SM"
  }

  if (idSuggestClosed) {
    if (/^VF\s*\d+$/.test(idU) || /^VF\d+$/.test(idU)) {
      if (traceOut) traceOut.source = `inferTypeFromFormItem:${INFER_TYPE_FROM_FORM_ITEM_TRACE_VERSION}:idSuggestClosed_VF`
      return "VF"
    }
    if (traceOut) traceOut.source = `inferTypeFromFormItem:${INFER_TYPE_FROM_FORM_ITEM_TRACE_VERSION}:idSuggestClosed_defaultSM`
    return "SM"
  }

  // Modo mixto: sin evidencia de cerrada (id/estructura) y sin correctAnswer reconocible -> desarrollo.
  if (traceOut) traceOut.source = `inferTypeFromFormItem:${INFER_TYPE_FROM_FORM_ITEM_TRACE_VERSION}:default_DES`
  return "DES"
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
  const direct = map.get(u)
  if (direct) return direct
  if (/^P\d+$/.test(u)) return map.get(u)
  const sm = u.match(/^SM(\d+)$/i)
  if (sm) {
    const n = sm[1]
    return map.get(`C${n}`) ?? map.get(n) ?? map.get(`SM${n}`)
  }
  const c = u.match(/^C(\d+)$/i)
  if (c) {
    const n = c[1]
    return map.get(`C${n}`) ?? map.get(n) ?? map.get(`SM${n}`)
  }
  if (/^\d+$/.test(u)) {
    return map.get(`C${u}`) ?? map.get(u) ?? map.get(`SM${u}`)
  }
  return map.get(`SM${u}`)
}

/** Índice ordinal de ítem cerrado en pauta (C12 / SM12 / 12 / VF12). */
function extractClosedItemOrdinalFromPautaId(id: string): number | null {
  const t = id.trim().toUpperCase()
  const m = t.match(/^(?:C|SM|VF|TP)?(\d+)$/)
  if (m) return parseInt(m[1], 10)
  return null
}

function isDevelopmentPautaRowId(id: string): boolean {
  const idLower = id.trim().toLowerCase()
  return idLower.includes("desarrollo") || /^p\d+/.test(idLower)
}

/**
 * Plantilla de clave docente compatible con `answerKeyFromTemplate` del cliente cuando solo hay
 * pauta estructurada + alternativas correctas (p. ej. rellenadas desde Prueba Base), sin escaneo OMR previo.
 * Permite que el servidor reciba `teacherAnswerKeyLength` > 0 y compare contra respuestas SM1… detectadas.
 */
export function buildTeacherAnswerKeyFromFormPauta(
  pautaEstructurada: string,
  pautaCorrectaAlternativas: string,
  tipoPrueba?: "mixta" | "solo_desarrollo" | "solo_alternativas",
): {
  respuestas: Array<{ pregunta: number; respuestaCorrecta: string; confianza: number; metodo: "manual" }>
  totalPreguntas: number
} | null {
  const pe = String(pautaEstructurada ?? "").trim()
  const pa = String(pautaCorrectaAlternativas ?? "").trim()
  if (!pe || !pa) return null
  const rows = parsePautaEstructurada(pe)
  if (rows.length === 0) return null
  const tipo: EvaluationBaseFormInput["tipoPrueba"] =
    tipoPrueba === "solo_desarrollo"
      ? "solo_desarrollo"
      : tipoPrueba === "solo_alternativas"
        ? "solo_alternativas"
        : "mixta"
  const respuestas: Array<{ pregunta: number; respuestaCorrecta: string; confianza: number; metodo: "manual" }> = []
  const seen = new Set<number>()
  for (const row of rows) {
    if (isDevelopmentPautaRowId(row.id)) continue
    const corr = getFormItemCorrectAnswer(pa, row.id)
    if (!corr || !hasBubbleOrClosedKeyAnswer(corr)) continue
    if (!isFormStructuredRowClosedForOmr({ maxScore: row.maxScore, correctAnswer: corr, tipoPrueba: tipo })) continue
    const num = extractClosedItemOrdinalFromPautaId(row.id)
    if (num == null || num < 1 || seen.has(num)) continue
    seen.add(num)
    respuestas.push({
      pregunta: num,
      respuestaCorrecta: corr.trim().toUpperCase(),
      confianza: 1,
      metodo: "manual",
    })
  }
  respuestas.sort((a, b) => a.pregunta - b.pregunta)
  if (respuestas.length === 0) return null
  const totalPreguntas = Math.max(...respuestas.map((r) => r.pregunta), respuestas.length)
  return { respuestas, totalPreguntas }
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
    // Para OTHER, usar la presencia de clave cerrada válida como criterio (no el puntaje).
    // Así cerradas multi-puntaje (maxScore > 1) no se cuentan como desarrollo.
    if (hasBubbleOrClosedKeyAnswer(it.correctAnswer)) closed++
    else dev++
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
    const qType = mapSourceQuestionType(it.question_type)
    let type: EvaluationBaseItemType = qType
    let typeSource = `mapSourceQuestionType:${String(it.question_type ?? "")}->${type}`
    const max = it.max_score != null && Number.isFinite(Number(it.max_score)) ? Number(it.max_score) : null
    const rub = (it.rubric_text ?? "").trim()

    // Evidencia textual para clasificar cerradas incluso cuando correct_answer viene vacío/no reconocible.
    const altEvidenceScan = looksLikeMultipleChoiceAlternativesWithTrace(it.item_text ?? it.rubric_text ?? null)
    const altEvidence = altEvidenceScan.ok
    const vfEvidence = looksLikeVerdaderoFalso(it.item_text ?? it.rubric_text ?? null)

    // Prioridad requerida:
    // 1) Si hay evidencia de alternativas -> cerrada SM
    // 2) Si hay evidencia VF -> cerrada VF
    // 3) Si NO hay evidencia -> respetar qType (mapSourceQuestionType), p.ej. short_answer->DES.
    if (altEvidence) {
      type = "SM"
      typeSource = "buildFromSourceExam:override->SM:altEvidence"
    } else if (vfEvidence) {
      type = "VF"
      typeSource = "buildFromSourceExam:override->VF:vfEvidence"
    }

    if (type === "OTHER") {
      // 1) Si hay evidencia de alternativas o VF, forzar cerrado.
      if (vfEvidence) {
        type = "VF"
        typeSource = `buildFromSourceExam:OTHER->VF:vfEvidence`
      } else if (altEvidence) {
        type = "SM"
        typeSource = `buildFromSourceExam:OTHER->SM:altEvidence`
      }
      // 2) Si no hay evidencia y max_score es > 1, mantenemos fallback a DES (sin contaminar OMR).
      else if (max != null && max > 1) {
        type = "DES"
        typeSource = `buildFromSourceExam:OTHER->DES:max_score>1 && noClosedEvidence`
      }
      // 3) Si existe correct_answer reconocido, clasificar por la clave.
      else if ((it.correct_answer ?? "").trim() && (max == null || max <= 1)) {
        type = inferClosedTypeFromCorrectAnswer(it.correct_answer)
        typeSource = `buildFromSourceExam:OTHER->${type}:correct_answer(recognized) && max<=1`
      }
    }

    // 4) Si parece desarrollo por rubrica larga y no hay evidencia de cerrada, forzar DES.
    if (type === "OTHER" && rub.length >= 20 && !hasBubbleOrClosedKeyAnswer(it.correct_answer) && !altEvidence && !vfEvidence) {
      type = "DES"
      typeSource = `buildFromSourceExam:OTHER->DES:rubricLen>=20 && noClosedEvidence`
    }
    const id = canonicalIdForSourceRow(type, it.item_number, it.rowId, seq)
    const metadata: Record<string, unknown> = {
      source: "source_exam",
      item_number: it.item_number ?? null,
      rowId: it.rowId,
      typeInferenceSource: typeSource,
      typeInferenceVersion: "mapSourceQuestionType/buildFromSourceExam",
      altEvidenceResult: altEvidenceScan.ok,
      altEvidenceFoundLetters: altEvidenceScan.foundLetters.join(","),
      altEvidenceEvaluatedText: altEvidenceScan.evaluatedText,
    }
    if (it.item_number != null && Number(it.item_number) >= 1) {
      metadata.canonical_slot = canonicalSlotIdForSourceItem(type, Number(it.item_number))
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
      metadata,
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
    const typeTrace: { source?: string } = {}
    const type = inferTypeFromFormItem(id, maxScore, corrRaw, form.tipoPrueba, typeTrace)
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
        typeInferenceSource: typeTrace.source ?? "inferTypeFromFormItem:unknown",
        typeInferenceVersion: INFER_TYPE_FROM_FORM_ITEM_TRACE_VERSION,
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
 * Fusiona dos filas que comparten el mismo slot canónico (misma clave C{n} o P{n}).
 */
function mergeDupEvaluationBaseItemsForCanonicalSlot(
  a: EvaluationBaseItem,
  b: EvaluationBaseItem,
  canonicalKey: string,
): EvaluationBaseItem {
  const order = Math.min(a.order, b.order)
  const maxCandidates = [a.maxScore, b.maxScore].filter(
    (x): x is number => x != null && Number.isFinite(x) && x > 0,
  )
  const maxScore =
    maxCandidates.length > 0 ? Math.max(...maxCandidates) : (a.maxScore ?? b.maxScore ?? null)

  const ca = (a.correctAnswer ?? "").trim()
  const cb = (b.correctAnswer ?? "").trim()
  const correctAnswer = (ca || cb || null) as string | null

  const ra = (a.rubricText ?? "").trim()
  const rb = (b.rubricText ?? "").trim()
  let rubricText: string | null = null
  if (ra && rb && ra !== rb) rubricText = `${ra}\n\n${rb}`
  else rubricText = ra || rb || null

  const metaA = a.metadata as Record<string, unknown> | undefined
  const metaB = b.metadata as Record<string, unknown> | undefined
  const metadata = {
    ...(metaA ?? {}),
    ...(metaB ?? {}),
    source: "source_exam",
    canonical_slot: canonicalKey,
    merged_row_ids: [metaA?.rowId, metaB?.rowId].filter(Boolean),
  }

  return { ...a, id: canonicalKey, order, maxScore, correctAnswer, rubricText, metadata }
}

/**
 * Colapsa ítems de prueba base al modelo canónico del evaluador: un único `EvaluationBaseItem` por slot C{n} o P{n}.
 * Filas duplicadas en BD (mismo número y misma rama) se fusionan; `id` queda siempre en formato C/P.
 * Filas sin `item_number` se conservan con id estable (p. ej. UUID) como huérfanas.
 */
export function collapseSourceExamEvaluationBaseItems(items: EvaluationBaseItem[]): EvaluationBaseItem[] {
  const sorted = sortByOrder(items)
  const map = new Map<string, EvaluationBaseItem>()
  const orderKeys: string[] = []
  const orphans: EvaluationBaseItem[] = []

  for (const it of sorted) {
    const meta = it.metadata as { item_number?: number | null } | undefined
    const n = Number(meta?.item_number)
    if (!Number.isFinite(n) || n < 1) {
      orphans.push(it)
      continue
    }
    const key = canonicalSlotIdForSourceItem(it.type, n)
    const normalized = { ...it, id: key, metadata: { ...it.metadata, canonical_slot: key } }
    const prev = map.get(key)
    if (!prev) {
      map.set(key, normalized)
      orderKeys.push(key)
    } else {
      map.set(key, mergeDupEvaluationBaseItemsForCanonicalSlot(prev, normalized, key))
    }
  }

  return sortByOrder([...orderKeys.map((k) => map.get(k)!), ...orphans])
}

/**
 * Solo ítems con número asignado (excluye huérfanos) para generar segmentos de pauta.
 */
function dedupeItemsByFormHintKey(items: EvaluationBaseItem[]): EvaluationBaseItem[] {
  return collapseSourceExamEvaluationBaseItems(items).filter((it) => {
    const n = Number((it.metadata as { item_number?: number | null })?.item_number)
    return Number.isFinite(n) && n >= 1
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
    items = collapseSourceExamEvaluationBaseItems(buildFromSourceExam(input.sourceExam))
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

/** Sugerencia de tipo de prueba a partir de conteos estructurales (sin leer nombres de ítems). */
export function inferTipoPruebaFromEvaluationBase(
  eb: EvaluationBase,
): "mixta" | "solo_desarrollo" | "solo_alternativas" {
  if (eb.closedItems > 0 && eb.developmentItems === 0) return "solo_alternativas"
  if (eb.developmentItems > 0 && eb.closedItems === 0) return "solo_desarrollo"
  return "mixta"
}

/**
 * Genera cadenas compatibles con el formulario del evaluador desde ítems de prueba base.
 * Usa P{n} para desarrollo y C{n} para cerradas (C no coincide con /^p\d+/ de desarrollo en parsePauta del servidor).
 */
export function sourceExamInputToFormHints(input: EvaluationBaseSourceExamInput): {
  pautaEstructurada: string
  pautaCorrectaAlternativas: string
  rubricaNotes: string
  suggestedTipoPrueba: "mixta" | "solo_desarrollo" | "solo_alternativas"
} {
  const eb = buildEvaluationBase({ sourceExam: input })
  const hintItems = dedupeItemsByFormHintKey(eb.items)
  const counts = computeCounts(hintItems)
  const ebForTipo: EvaluationBase = {
    ...eb,
    items: hintItems,
    totalItems: counts.totalItems,
    closedItems: counts.closedItems,
    developmentItems: counts.developmentItems,
  }

  const segs: string[] = []
  const corr: string[] = []
  const rubricLines: string[] = []
  for (const it of hintItems) {
    const meta = it.metadata as { item_number?: number | null } | undefined
    const n = Number(meta?.item_number)
    if (!Number.isFinite(n) || n < 1) continue
    const max = it.maxScore != null && it.maxScore > 0 ? it.maxScore : 1
    const idStr = it.type === "DES" ? `P${n}` : `C${n}`
    segs.push(`${idStr}:${max}`)
    if (hasBubbleOrClosedKeyAnswer(it.correctAnswer) && it.correctAnswer) {
      const ca = String(it.correctAnswer).trim().toUpperCase()
      corr.push(`${idStr}:${ca}`)
      if (it.type !== "DES" && Number.isFinite(n)) {
        corr.push(`SM${n}:${ca}`)
        corr.push(`${n}:${ca}`)
      }
    }
    const rt = (it.rubricText ?? "").trim()
    if (rt) rubricLines.push(`Ítem ${n}: ${rt}`)
  }
  return {
    pautaEstructurada: segs.join("; "),
    pautaCorrectaAlternativas: corr.join("; "),
    rubricaNotes: rubricLines.join("\n\n"),
    suggestedTipoPrueba: inferTipoPruebaFromEvaluationBase(ebForTipo),
  }
}

/**
 * Canonicaliza la pauta (pautaEstructurada y pautaCorrectaAlternativas) desde
 * ítems de {@link EvaluationBase} ya colapsados (slot canónico C{n} / P{n}).
 *
 * Uso en cliente (canonicalize-on-payload): el servidor construye la corrección
 * a partir de estas strings; aquí aseguramos que reflejen la verdad de la prueba base.
 *
 * Reglas:
 * - Ignora ítems sin número válido (metadata.item_number).
 * - Para pautaEstructurada: C{n} para no-DES, P{n} para DES.
 * - Para pautaCorrectaAlternativas: solo cerradas con correctAnswer reconocible.
 */
export function toCanonicalPautaFromEvaluationBaseItems(
  items: EvaluationBaseItem[],
): { pautaEstructurada: string; pautaCorrectaAlternativas: string } {
  const segs: string[] = []
  const corr: string[] = []

  const seenSlot = new Set<string>()
  const seenClosed = new Set<number>()

  for (const it of items) {
    const meta = it.metadata as { item_number?: number | null } | undefined
    const n = Number(meta?.item_number)
    if (!Number.isFinite(n) || n < 1) continue

    const max = it.maxScore != null && it.maxScore > 0 ? it.maxScore : 1
    const idStr = it.type === "DES" ? `P${n}` : `C${n}`

    if (!seenSlot.has(idStr)) {
      segs.push(`${idStr}:${max}`)
      seenSlot.add(idStr)
    }

    if (it.type === "DES") continue
    const caRaw = it.correctAnswer ?? null
    if (!caRaw) continue
    const ca = String(caRaw).trim().toUpperCase()
    if (!hasBubbleOrClosedKeyAnswer(ca)) continue

    if (!seenClosed.has(n)) {
      // Formato compatible con el servidor: "n:LETTER"
      corr.push(`${n}:${ca}`)
      seenClosed.add(n)
    }
  }

  return {
    pautaEstructurada: segs.join("; "),
    pautaCorrectaAlternativas: corr.join("; "),
  }
}
