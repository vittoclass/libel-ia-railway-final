/**
 * Borrador local de validación asistida para importación de ítems de prueba base.
 * Solo memoria / cliente: no persiste field_status ni toca BD.
 */
import type { ParsedLine } from "@/app/lib/parse-bulk-items"

/** Estados visuales por campo (no se envían al servidor). */
export type FieldStatus =
  | "detected"
  | "inferred"
  | "missing"
  | "needs_review"
  | "edited_by_user"
  | "completed_from_pauta"
  | "completed_from_rubric"

export type DraftFieldKey =
  | "item_number"
  | "item_text"
  | "question_type"
  | "correct_answer"
  | "max_score"
  | "axis_label"
  | "skill_label"
  | "cognitive_level"
  | "rubric_text"
  | "competence"
  | "difficulty"

export type DraftFieldEntry<T> = { value: T; status: FieldStatus }

/** Traza de fusión por campo (respuesta smart-extract + pauta/rúbrica); no se persiste. */
export type MergeFieldOverlayEntry = { status: FieldStatus; conflict_note?: string }
export type MergeDraftOverlayByItem = Partial<Record<DraftFieldKey, MergeFieldOverlayEntry>>

export type SourceExamItemDraft = {
  item_number: DraftFieldEntry<number>
  item_text: DraftFieldEntry<string>
  question_type: DraftFieldEntry<string | null>
  correct_answer: DraftFieldEntry<string | null>
  max_score: DraftFieldEntry<number | null>
  axis_label: DraftFieldEntry<string | null>
  skill_label: DraftFieldEntry<string | null>
  cognitive_level: DraftFieldEntry<string | null>
  rubric_text: DraftFieldEntry<string | null>
  competence: DraftFieldEntry<string | null>
  difficulty: DraftFieldEntry<string | null>
  /** El docente marcó este ítem como revisado/aceptado. */
  itemConfirmed: boolean
  /** Notas de conflicto por campo tras fusión pauta/rúbrica (solo cliente). */
  mergeConflictNotes?: Partial<Record<DraftFieldKey, string>>
}

const EDITABLE_KEYS = [
  "correct_answer",
  "max_score",
  "axis_label",
  "skill_label",
  "cognitive_level",
  "rubric_text",
] as const satisfies readonly DraftFieldKey[]

export type EditableDraftKey = (typeof EDITABLE_KEYS)[number]

export function isEditableDraftKey(k: DraftFieldKey): k is EditableDraftKey {
  return (EDITABLE_KEYS as readonly string[]).includes(k)
}

function emptyStr(v: string | null | undefined): boolean {
  return String(v ?? "").trim().length === 0
}

function statusForStringField(
  value: string | null | undefined,
  opts: { inferred?: boolean },
): FieldStatus {
  if (!emptyStr(value)) return opts.inferred ? "inferred" : "detected"
  return "missing"
}

function statusForNumberField(value: number | null | undefined): FieldStatus {
  if (value != null && typeof value === "number" && Number.isFinite(value)) return "detected"
  return "missing"
}

function needsReviewCorrectAnswer(line: ParsedLine): boolean {
  const qt = line.question_type
  if (qt === "multiple_choice" || qt === "true_false") return emptyStr(line.correct_answer)
  return false
}

function needsReviewMaxScore(line: ParsedLine): boolean {
  const qt = line.question_type
  if (qt === "essay" || qt === "short_answer") return line.max_score == null
  return false
}

/**
 * Construye borrador inicial desde ítems ya mapeados a ParsedLine (vista manual / previsualizar).
 */
export function buildDraftFromParsedLines(lines: ParsedLine[]): SourceExamItemDraft[] {
  return lines.map((line) => draftFromParsedLine(line, { pedagogyInferred: false }))
}

/**
 * Tras smart-extract: empareja por `item_number` con la respuesta del API (tras dedupe/reorden no coincide el índice).
 */
export function buildDraftFromParsedLinesWithSmartMeta(
  lines: ParsedLine[],
  apiItems: Array<{ item_number?: unknown; pedagogy_inferred?: boolean }> | null | undefined,
): SourceExamItemDraft[] {
  const byNum = new Map<number, boolean>()
  for (const it of apiItems ?? []) {
    const raw = it?.item_number
    const n =
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.floor(raw)
        : parseInt(String(raw ?? ""), 10)
    if (!Number.isFinite(n) || n < 1) continue
    byNum.set(n, Boolean(it?.pedagogy_inferred))
  }
  return lines.map((line) =>
    draftFromParsedLine(line, {
      pedagogyInferred: byNum.get(line.item_number) ?? false,
    }),
  )
}

/** Aplica trazas de fusión pauta/rúbrica sobre borradores ya alineados a los valores fusionados. */
export function draftsApplyMergeOverlay(
  drafts: SourceExamItemDraft[],
  overlay: Map<number, MergeDraftOverlayByItem>,
): SourceExamItemDraft[] {
  return drafts.map((d) => {
    const layer = overlay.get(d.item_number.value)
    if (!layer) return d

    const notes: Partial<Record<DraftFieldKey, string>> = {}
    const pick = <T>(key: DraftFieldKey, entry: DraftFieldEntry<T>): DraftFieldEntry<T> => {
      const ent = layer[key]
      if (!ent) return entry
      if (ent.conflict_note) notes[key] = ent.conflict_note
      return { ...entry, status: ent.status }
    }

    return {
      ...d,
      item_number: pick("item_number", d.item_number),
      item_text: pick("item_text", d.item_text),
      question_type: pick("question_type", d.question_type),
      correct_answer: pick("correct_answer", d.correct_answer),
      max_score: pick("max_score", d.max_score),
      axis_label: pick("axis_label", d.axis_label),
      skill_label: pick("skill_label", d.skill_label),
      cognitive_level: pick("cognitive_level", d.cognitive_level),
      rubric_text: pick("rubric_text", d.rubric_text),
      competence: pick("competence", d.competence),
      difficulty: pick("difficulty", d.difficulty),
      mergeConflictNotes: Object.keys(notes).length > 0 ? notes : undefined,
    }
  })
}

function draftFromParsedLine(line: ParsedLine, ctx: { pedagogyInferred: boolean }): SourceExamItemDraft {
  const pedInf = ctx.pedagogyInferred

  const axis = statusForStringField(line.axis_label, { inferred: pedInf })
  const skill = statusForStringField(line.skill_label, { inferred: pedInf })
  const cog = statusForStringField(line.cognitive_level, { inferred: pedInf })

  let correctStatus: FieldStatus = emptyStr(line.correct_answer) ? "missing" : "detected"
  if (needsReviewCorrectAnswer(line) && correctStatus === "missing") correctStatus = "needs_review"

  let scoreStatus = statusForNumberField(line.max_score)
  if (needsReviewMaxScore(line) && scoreStatus === "missing") scoreStatus = "needs_review"

  const qtEmpty = emptyStr(line.question_type)
  const rubEmpty = emptyStr(line.rubric_text)

  return {
    item_number: { value: line.item_number, status: "detected" },
    item_text: { value: line.item_text, status: emptyStr(line.item_text) ? "missing" : "detected" },
    question_type: {
      value: line.question_type,
      status: qtEmpty ? "missing" : "detected",
    },
    correct_answer: { value: line.correct_answer, status: correctStatus },
    max_score: { value: line.max_score, status: scoreStatus },
    axis_label: { value: line.axis_label, status: axis },
    skill_label: { value: line.skill_label, status: skill },
    cognitive_level: { value: line.cognitive_level, status: cog },
    rubric_text: { value: line.rubric_text, status: rubEmpty ? "missing" : "detected" },
    competence: {
      value: line.competence,
      status: emptyStr(line.competence) ? "missing" : "detected",
    },
    difficulty: {
      value: line.difficulty,
      status: emptyStr(line.difficulty) ? "missing" : "detected",
    },
    itemConfirmed: false,
  }
}

/** Convierte borrador a ParsedLine (payload de importación; sin field_status). */
export function draftRowToParsedLine(d: SourceExamItemDraft): ParsedLine {
  return {
    item_number: d.item_number.value,
    item_text: d.item_text.value,
    axis_label: d.axis_label.value,
    skill_label: d.skill_label.value,
    cognitive_level: d.cognitive_level.value,
    competence: d.competence.value,
    difficulty: d.difficulty.value,
    question_type: d.question_type.value,
    correct_answer: d.correct_answer.value,
    max_score: d.max_score.value,
    rubric_text: d.rubric_text.value,
  }
}

export function draftsToParsedLines(drafts: SourceExamItemDraft[]): ParsedLine[] {
  return drafts.map(draftRowToParsedLine)
}

/** Actualiza un campo editable y marca edited_by_user. */
export function updateDraftEditableField(
  draft: SourceExamItemDraft,
  key: EditableDraftKey,
  value: string | number | null,
): SourceExamItemDraft {
  const next = { ...draft }
  if (key === "max_score") {
    const n = value as number | null
    next.max_score = {
      value: n,
      status: "edited_by_user",
    }
    return next
  }
  const strVal = value === null || value === undefined ? null : String(value).trim() || null
  const upperCorrect = key === "correct_answer" && strVal ? strVal.toUpperCase() : strVal
  const entry: DraftFieldEntry<string | null> = {
    value: key === "correct_answer" ? upperCorrect : strVal,
    status: "edited_by_user",
  }
  if (key === "correct_answer") next.correct_answer = entry
  else if (key === "axis_label") next.axis_label = entry
  else if (key === "skill_label") next.skill_label = entry
  else if (key === "cognitive_level") next.cognitive_level = entry
  else if (key === "rubric_text") next.rubric_text = entry
  return next
}

function valuesEqualForField(key: DraftFieldKey, a: unknown, b: unknown): boolean {
  if (key === "max_score") return a === b
  if (key === "item_number") return Number(a) === Number(b)
  return String(a ?? "") === String(b ?? "")
}

function pickParsedField(pl: ParsedLine, key: DraftFieldKey): unknown {
  switch (key) {
    case "item_number":
      return pl.item_number
    case "item_text":
      return pl.item_text
    case "question_type":
      return pl.question_type
    case "correct_answer":
      return pl.correct_answer
    case "max_score":
      return pl.max_score
    case "axis_label":
      return pl.axis_label
    case "skill_label":
      return pl.skill_label
    case "cognitive_level":
      return pl.cognitive_level
    case "rubric_text":
      return pl.rubric_text
    case "competence":
      return pl.competence
    case "difficulty":
      return pl.difficulty
    default:
      return undefined
  }
}

/**
 * Tras editar la tabla (ParsedLine), fusiona valores y marca **edited_by_user** solo en campos que cambiaron.
 */
export function mergeParsedLineIntoDraft(prev: SourceExamItemDraft, line: ParsedLine): SourceExamItemDraft {
  const cur = draftRowToParsedLine(prev)
  const keys: DraftFieldKey[] = [
    "item_number",
    "item_text",
    "question_type",
    "correct_answer",
    "max_score",
    "axis_label",
    "skill_label",
    "cognitive_level",
    "rubric_text",
    "competence",
    "difficulty",
  ]
  let next: SourceExamItemDraft = { ...prev }
  const changedKeys = new Set<DraftFieldKey>()
  for (const key of keys) {
    const ov = pickParsedField(cur, key)
    const nv = pickParsedField(line, key)
    if (valuesEqualForField(key, ov, nv)) continue
    changedKeys.add(key)
    if (key === "item_number") {
      next = { ...next, item_number: { value: line.item_number, status: "edited_by_user" } }
      continue
    }
    if (key === "max_score") {
      next = { ...next, max_score: { value: line.max_score, status: "edited_by_user" } }
      continue
    }
    if (key === "item_text") {
      next = { ...next, item_text: { value: line.item_text, status: "edited_by_user" } }
      continue
    }
    const strVal = nv == null ? null : String(nv).trim() || null
    const finalStr =
      key === "correct_answer" && strVal ? strVal.toUpperCase() : strVal
    const entry: DraftFieldEntry<string | null> = { value: finalStr, status: "edited_by_user" }
    next = { ...next, [key]: entry }
  }
  let mergeConflictNotes = prev.mergeConflictNotes
  if (mergeConflictNotes && changedKeys.size > 0) {
    const copy = { ...mergeConflictNotes }
    for (const k of changedKeys) delete copy[k]
    mergeConflictNotes = Object.keys(copy).length > 0 ? copy : undefined
  }
  return { ...next, mergeConflictNotes }
}

/** Asigna 1 punto a ítems cuyo max_score sigue vacío (acción masiva explícita del docente). */
export function assignOnePointToMissingMaxScores(drafts: SourceExamItemDraft[]): SourceExamItemDraft[] {
  return drafts.map((d) => {
    if (d.max_score.value != null && Number.isFinite(d.max_score.value)) return d
    return { ...d, max_score: { value: 1, status: "edited_by_user" } }
  })
}

/**
 * Trata como aceptados los campos rellenados desde pauta/rúbrica (badges → detectado).
 * No altera valores; solo estados visuales para revisión rápida.
 */
export function acceptSupplementCompletedFields(drafts: SourceExamItemDraft[]): SourceExamItemDraft[] {
  return drafts.map((d) => {
    let next = d
    const bump = <T>(
      entry: DraftFieldEntry<T>,
      cond: boolean,
    ): DraftFieldEntry<T> =>
      cond && (entry.status === "completed_from_pauta" || entry.status === "completed_from_rubric")
        ? { ...entry, status: "detected" }
        : entry
    next = {
      ...next,
      correct_answer: bump(next.correct_answer, !emptyStr(next.correct_answer.value)),
      max_score: bump(next.max_score, next.max_score.value != null),
      rubric_text: bump(next.rubric_text, !emptyStr(next.rubric_text.value)),
    }
    return next
  })
}

/** Confirma un ítem: si los campos inferidos siguen siendo inferidos, pasan a detected (aceptación docente). */
export function confirmDraftItem(draft: SourceExamItemDraft): SourceExamItemDraft {
  const mark = (e: DraftFieldEntry<string | null>): DraftFieldEntry<string | null> =>
    e.status === "inferred" && !emptyStr(e.value) ? { ...e, status: "detected" } : e
  const markNum = (e: DraftFieldEntry<number | null>): DraftFieldEntry<number | null> =>
    e.status === "inferred" && e.value != null ? { ...e, status: "detected" } : e

  return {
    ...draft,
    axis_label: mark(draft.axis_label),
    skill_label: mark(draft.skill_label),
    cognitive_level: mark(draft.cognitive_level),
    itemConfirmed: true,
  }
}

/** Hay conflicto explícito de fusión o campo en revisión. */
export function draftRowHasConflictOrReview(d: SourceExamItemDraft): boolean {
  if (d.mergeConflictNotes && Object.keys(d.mergeConflictNotes).length > 0) return true
  return (
    d.correct_answer.status === "needs_review" ||
    d.max_score.status === "needs_review" ||
    d.rubric_text.status === "needs_review"
  )
}

/**
 * Falta puntaje o (para alternativas / V-F) falta clave; útil para filtrar la tabla.
 */
export function draftRowHasMissingCritical(d: SourceExamItemDraft): boolean {
  if (d.max_score.value == null) return true
  const qt = d.question_type.value
  if (qt === "multiple_choice" || qt === "true_false") {
    if (emptyStr(d.correct_answer.value)) return true
  }
  return false
}

/** Ítem “completo” para confirmación masiva: texto, tipo, puntaje, eje, habilidad, nivel; clave solo si aplica al tipo. */
export function isDraftRowCompleteForBulkConfirm(d: SourceExamItemDraft): boolean {
  if (emptyStr(d.item_text.value)) return false
  if (emptyStr(d.question_type.value)) return false
  if (d.max_score.value == null) return false
  if (emptyStr(d.axis_label.value)) return false
  if (emptyStr(d.skill_label.value)) return false
  if (emptyStr(d.cognitive_level.value)) return false
  const qt = d.question_type.value
  if (qt === "multiple_choice" || qt === "true_false") {
    if (emptyStr(d.correct_answer.value)) return false
  }
  return true
}

/** Estado único para la tabla docente (sin exponer FieldStatus internos). */
export type TeacherFacingRowStatus = "Completo" | "Falta revisar" | "Sin puntaje" | "Sin respuesta"

export function teacherFacingRowStatus(d: SourceExamItemDraft): TeacherFacingRowStatus {
  if (d.max_score.value == null) return "Sin puntaje"
  const qt = d.question_type.value
  if ((qt === "multiple_choice" || qt === "true_false") && emptyStr(d.correct_answer.value)) {
    return "Sin respuesta"
  }
  if (d.mergeConflictNotes && Object.keys(d.mergeConflictNotes).length > 0) return "Falta revisar"
  if (
    d.correct_answer.status === "needs_review" ||
    d.max_score.status === "needs_review" ||
    d.rubric_text.status === "needs_review"
  ) {
    return "Falta revisar"
  }
  if (emptyStr(d.axis_label.value) || emptyStr(d.skill_label.value)) return "Falta revisar"
  return "Completo"
}

export type DraftImportSummary = {
  total: number
  sinPuntaje: number
  sinRespuestaCorrecta: number
  ejeHabilidadInferidos: number
  requierenRevision: number
  /** Ítems con nota de conflicto de fusión pauta/rúbrica. */
  conflictosFusion: number
}

/** Resumen no bloqueante antes de importar. */
export function summarizeDraftsForImport(drafts: SourceExamItemDraft[]): DraftImportSummary {
  let sinPuntaje = 0
  let sinRespuestaCorrecta = 0
  let ejeHabilidadInferidos = 0
  let requierenRevision = 0
  let conflictosFusion = 0

  for (const d of drafts) {
    if (d.max_score.value == null || d.max_score.status === "missing") sinPuntaje++
    if (emptyStr(d.correct_answer.value)) sinRespuestaCorrecta++

    const infAxis = d.axis_label.status === "inferred"
    const infSkill = d.skill_label.status === "inferred"
    const infCog = d.cognitive_level.status === "inferred"
    if (infAxis || infSkill || infCog) ejeHabilidadInferidos++

    if (d.mergeConflictNotes && Object.keys(d.mergeConflictNotes).length > 0) conflictosFusion++

    const needs =
      !d.itemConfirmed &&
      (d.axis_label.status === "needs_review" ||
        d.skill_label.status === "needs_review" ||
        d.cognitive_level.status === "needs_review" ||
        d.correct_answer.status === "needs_review" ||
        d.max_score.status === "needs_review" ||
        d.rubric_text.status === "needs_review" ||
        d.axis_label.status === "inferred" ||
        d.skill_label.status === "inferred" ||
        d.cognitive_level.status === "inferred" ||
        emptyStr(d.correct_answer.value) ||
        d.max_score.value == null)
    if (needs) requierenRevision++
  }

  return {
    total: drafts.length,
    sinPuntaje,
    sinRespuestaCorrecta,
    ejeHabilidadInferidos,
    requierenRevision,
    conflictosFusion,
  }
}

/** Etiqueta corta en español para badges de UI. */
export function fieldStatusLabel(status: FieldStatus): string {
  switch (status) {
    case "detected":
      return "Detectado"
    case "inferred":
      return "Inferido por IA"
    case "missing":
      return "Falta dato"
    case "needs_review":
      return "Falta validar"
    case "edited_by_user":
      return "Editado"
    case "completed_from_pauta":
      return "Desde pauta"
    case "completed_from_rubric":
      return "Desde rúbrica"
    default:
      return status
  }
}
