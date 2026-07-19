/**
 * Merge seguro de contribuciones OMR multipágina (capa de integración pura).
 * No modifica motores OMR, decode, Azure, scoring ni calculateFinalScore.
 */

import type {
  IgnoredOmrPage,
  IgnoredOmrRow,
  MergedOmrQuestion,
  MergeMultipageOmrResult,
  MultipageOmrConflict,
  OfficialOmrRawRowWithProvenance,
  OmrPageContribution,
  OmrPageEvidenceClass,
  OmrPageQuestionContribution,
  OmrQuestionProvenance,
  OmrRowEvidenceClass,
} from "./merge-multipage-omr.types"

export type {
  IgnoredOmrPage,
  IgnoredOmrRow,
  MergedOmrQuestion,
  MergeMultipageOmrResult,
  MultipageOmrConflict,
  OfficialOmrRawRowWithProvenance,
  OmrPageContribution,
  OmrPageQuestionContribution,
  OmrQuestionProvenance,
} from "./merge-multipage-omr.types"

/** Feature flag: default false → comportamiento previo intacto. */
export function isOmrMultipageSafeMergeEnabled(
  envValue: string | undefined | null = process.env.OMR_MULTIPAGE_SAFE_MERGE_ENABLED,
): boolean {
  const v = String(envValue ?? "false").trim().toLowerCase()
  return v === "true"
}

export function isBlankLikeAnswer(value: unknown): boolean {
  const norm = String(value ?? "")
    .trim()
    .toUpperCase()
  return norm === "" || norm === "BLANK" || norm === "SIN_RESPUESTA"
}

export function normalizeOmrAnswerLetter(value: unknown): string {
  const norm = String(value ?? "")
    .trim()
    .toUpperCase()
  if (isBlankLikeAnswer(norm)) return "BLANK"
  return norm
}

function hasRealConfidences(conf: Record<string, number> | undefined | null): boolean {
  if (!conf || typeof conf !== "object") return false
  return Object.values(conf).some((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
}

/** Evidencia sensorial observable del pipeline (universal; sin reglas por prueba). */
export function classifyRowEvidence(row: OmrPageQuestionContribution): OmrRowEvidenceClass {
  if (row.observed_from_sensors === true) return "HAS_SENSOR_EVIDENCE"
  if (Array.isArray(row.assigned_detection_indices) && row.assigned_detection_indices.length > 0) {
    return "HAS_SENSOR_EVIDENCE"
  }
  if (hasRealConfidences(row.confidences_by_column)) return "HAS_SENSOR_EVIDENCE"
  // Letra no-BLANK con telemetría equivalente: confidences/indices ya cubiertos arriba.
  // Legacy sin esquema sensorial: el builder marca índices sintéticos o confidences.
  return "NO_SENSOR_EVIDENCE"
}

export function rowCanContribute(row: OmrPageQuestionContribution): boolean {
  return classifyRowEvidence(row) === "HAS_SENSOR_EVIDENCE"
}

export function classifyPageEvidence(page: OmrPageContribution): OmrPageEvidenceClass {
  const anyContributable = page.per_question.some((r) => rowCanContribute(r))
  if (!anyContributable) return "NON_OMR_OR_EMPTY_PAGE"
  return "HAS_OMR_EVIDENCE"
}

function emptyConfidences(): Record<string, number> {
  return {}
}

function cloneConfidences(c: Record<string, number> | undefined): Record<string, number> {
  if (!c || typeof c !== "object") return emptyConfidences()
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(c)) {
    const key = String(k).toUpperCase()
    const n = Number(v)
    if (/^[A-Z]$/.test(key) && Number.isFinite(n)) out[key] = n
  }
  return out
}

function uniqNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b)
}

/**
 * Construye contribución de página desde raw oficial Azure/interleaved (campos sensoriales).
 */
export function buildOmrPageContributionFromAzureRaw(params: {
  page_index: number
  source_filename?: string
  officialOmrPerQuestionRaw: unknown[]
  closedQuestionIds?: string[]
  engine: string
  variant?: string
}): OmrPageContribution {
  const raw = Array.isArray(params.officialOmrPerQuestionRaw) ? params.officialOmrPerQuestionRaw : []
  const sorted = [...raw].sort(
    (a, b) =>
      Number((a as { questionNumber?: unknown })?.questionNumber ?? 0) -
      Number((b as { questionNumber?: unknown })?.questionNumber ?? 0),
  )
  const per_question: OmrPageQuestionContribution[] = []
  let rowOrdinal = 0
  let observed_count = 0
  let nonblank_count = 0
  let blank_count = 0
  let sensor_count = 0

  for (const rowUnknown of sorted) {
    const row = rowUnknown as Record<string, unknown>
    const qn = Number(row?.questionNumber ?? 0)
    if (qn < 1) continue
    const canonRaw = typeof row.canonicalId === "string" ? row.canonicalId.trim() : ""
    const fromClosed = params.closedQuestionIds?.[rowOrdinal]
    rowOrdinal++
    const question_id =
      (canonRaw && /^C\d+$/i.test(canonRaw) ? canonRaw.toUpperCase() : null) ||
      (fromClosed && String(fromClosed).trim()) ||
      `C${qn}`

    const ans = normalizeOmrAnswerLetter(row.selectedAnswer)
    const observed = row.observedFromSensors === true
    const indices = Array.isArray(row.assignedDetectionIndices)
      ? row.assignedDetectionIndices.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      : []
    const confidences_by_column = cloneConfidences(
      row.confidencesByColumn && typeof row.confidencesByColumn === "object"
        ? (row.confidencesByColumn as Record<string, number>)
        : undefined,
    )
    const confFromRow =
      typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : null
    const confidence = confFromRow != null ? confFromRow : isBlankLikeAnswer(ans) ? 0.4 : 0.92

    if (observed) observed_count++
    if (isBlankLikeAnswer(ans)) blank_count++
    else nonblank_count++
    sensor_count += indices.length
    if (hasRealConfidences(confidences_by_column)) {
      sensor_count += Object.keys(confidences_by_column).length
    }

    const idNorm = String(question_id).trim().toUpperCase()
    const idMatch = idNorm.match(/(\d+)/)
    per_question.push({
      question_id: idMatch ? `C${Number(idMatch[1])}` : idNorm || `C${qn}`,
      selected_answer: ans,
      confidence,
      observed_from_sensors: observed,
      assigned_detection_indices: indices,
      confidences_by_column,
    })
  }

  return {
    page_index: params.page_index,
    source_filename: params.source_filename,
    per_question,
    observed_count,
    nonblank_count,
    blank_count,
    sensor_count,
    engine: params.engine,
    variant: params.variant,
  }
}

/**
 * Contribución desde respuestas detectadas (legacy u adaptador) sin raw sensorial.
 * Letras no-BLANK se marcan con telemetría equivalente (confidence en columna).
 * BLANK sin sensores → NO_SENSOR_EVIDENCE.
 */
export function buildOmrPageContributionFromDetectedAnswers(params: {
  page_index: number
  source_filename?: string
  detectedAnswers: Array<{ pregunta: string; respuesta_detectada: string; confianza: number }>
  engine: string
  variant?: string
}): OmrPageContribution {
  const per_question: OmrPageQuestionContribution[] = []
  let nonblank_count = 0
  let blank_count = 0
  let sensor_count = 0
  let observed_count = 0

  for (const item of params.detectedAnswers) {
    const rawId = String(item.pregunta ?? "").trim().toUpperCase()
    const m = rawId.match(/(\d+)/)
    const question_id = m ? `C${Number(m[1])}` : rawId || "C0"
    const ans = normalizeOmrAnswerLetter(item.respuesta_detectada)
    const confidence = Number(item.confianza) || (isBlankLikeAnswer(ans) ? 0.4 : 0.9)
    const isBlank = isBlankLikeAnswer(ans)

    if (isBlank) {
      blank_count++
      per_question.push({
        question_id,
        selected_answer: "BLANK",
        confidence,
        observed_from_sensors: false,
        assigned_detection_indices: [],
        confidences_by_column: {},
      })
      continue
    }

    nonblank_count++
    observed_count++
    sensor_count += 1
    const confidences_by_column: Record<string, number> = {}
    if (/^[A-Z]$/.test(ans)) confidences_by_column[ans] = confidence
    per_question.push({
      question_id,
      selected_answer: ans,
      confidence,
      observed_from_sensors: true,
      assigned_detection_indices: [],
      confidences_by_column,
    })
  }

  return {
    page_index: params.page_index,
    source_filename: params.source_filename,
    per_question,
    observed_count,
    nonblank_count,
    blank_count,
    sensor_count,
    engine: params.engine,
    variant: params.variant,
  }
}

function questionSortKey(id: string): number {
  const m = String(id).toUpperCase().match(/(\d+)/)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

/**
 * Merge puro por pregunta. No elige silenciosamente entre letras distintas con sensores.
 */
export function mergeMultipageOmrContributions(
  contributions: OmrPageContribution[],
): MergeMultipageOmrResult {
  const ignored_pages: IgnoredOmrPage[] = []
  const ignored_rows: IgnoredOmrRow[] = []
  const conflicts: MultipageOmrConflict[] = []
  const byQuestion = new Map<string, MergedOmrQuestion>()

  const pages = Array.isArray(contributions) ? contributions : []

  for (const page of pages) {
    const pageClass = classifyPageEvidence(page)
    if (pageClass === "NON_OMR_OR_EMPTY_PAGE") {
      ignored_pages.push({
        page_index: page.page_index,
        reason: "NON_OMR_OR_EMPTY_PAGE",
        source_filename: page.source_filename,
        engine: page.engine,
      })
      for (const row of page.per_question) {
        ignored_rows.push({
          page_index: page.page_index,
          question_id: row.question_id,
          reason: "NO_SENSOR_EVIDENCE",
          selected_answer: row.selected_answer,
        })
        const existing = byQuestion.get(row.question_id)
        if (existing && !isBlankLikeAnswer(existing.selected_answer)) {
          existing.ignored_blank_pages = uniqNumbers([
            ...existing.ignored_blank_pages,
            page.page_index,
          ])
        }
      }
      continue
    }

    for (const row of page.per_question) {
      const canContribute = rowCanContribute(row)
      const incomingBlank = isBlankLikeAnswer(row.selected_answer)
      const prev = byQuestion.get(row.question_id)

      if (!canContribute) {
        ignored_rows.push({
          page_index: page.page_index,
          question_id: row.question_id,
          reason: "NO_SENSOR_EVIDENCE",
          selected_answer: row.selected_answer,
        })
        if (prev && !isBlankLikeAnswer(prev.selected_answer) && incomingBlank) {
          prev.ignored_blank_pages = uniqNumbers([...prev.ignored_blank_pages, page.page_index])
          ignored_rows.push({
            page_index: page.page_index,
            question_id: row.question_id,
            reason: "ignored_blank_without_sensor",
            selected_answer: row.selected_answer,
          })
        }
        continue
      }

      // A: sin previa → aceptar si tiene evidencia (incl. BLANK con sensores como diagnóstico no puntuable)
      if (!prev) {
        byQuestion.set(row.question_id, {
          question_id: row.question_id,
          selected_answer: normalizeOmrAnswerLetter(row.selected_answer),
          confidence: row.confidence,
          observed_from_sensors: row.observed_from_sensors,
          assigned_detection_indices: [...row.assigned_detection_indices],
          confidences_by_column: cloneConfidences(row.confidences_by_column),
          source_page_index: page.page_index,
          source_filename: page.source_filename,
          engine: page.engine,
          variant: page.variant,
          ignored_blank_pages: [],
          conflict: false,
        })
        continue
      }

      const prevBlank = isBlankLikeAnswer(prev.selected_answer)
      const incomingAns = normalizeOmrAnswerLetter(row.selected_answer)

      // B: válida previa + BLANK sin sensores → ya filtrado por !canContribute
      // C: BLANK previo + respuesta con sensores → aceptar
      if (prevBlank && !incomingBlank) {
        byQuestion.set(row.question_id, {
          question_id: row.question_id,
          selected_answer: incomingAns,
          confidence: row.confidence,
          observed_from_sensors: row.observed_from_sensors,
          assigned_detection_indices: [...row.assigned_detection_indices],
          confidences_by_column: cloneConfidences(row.confidences_by_column),
          source_page_index: page.page_index,
          source_filename: page.source_filename,
          engine: page.engine,
          variant: page.variant,
          ignored_blank_pages: prev.ignored_blank_pages,
          conflict: false,
        })
        continue
      }

      // B explícito: válida previa + BLANK con sensores (página aportó evidencia pero BLANK en esa pregunta)
      if (!prevBlank && incomingBlank) {
        prev.ignored_blank_pages = uniqNumbers([...prev.ignored_blank_pages, page.page_index])
        ignored_rows.push({
          page_index: page.page_index,
          question_id: row.question_id,
          reason: "ignored_blank_without_sensor",
          selected_answer: row.selected_answer,
        })
        continue
      }

      // Ambos BLANK con sensores: conservar provenance
      if (prevBlank && incomingBlank) {
        prev.assigned_detection_indices = uniqNumbers([
          ...prev.assigned_detection_indices,
          ...row.assigned_detection_indices,
        ])
        continue
      }

      // D / F: misma letra → conservar, acumular provenance
      if (prev.selected_answer === incomingAns) {
        prev.assigned_detection_indices = uniqNumbers([
          ...prev.assigned_detection_indices,
          ...row.assigned_detection_indices,
        ])
        prev.confidences_by_column = {
          ...prev.confidences_by_column,
          ...cloneConfidences(row.confidences_by_column),
        }
        if (row.confidence > prev.confidence) prev.confidence = row.confidence
        prev.observed_from_sensors = prev.observed_from_sensors || row.observed_from_sensors
        continue
      }

      // E: letras distintas con sensores → conflicto; no elegir por orden
      const candidates = [
        {
          page_index: prev.source_page_index ?? -1,
          selected_answer: prev.selected_answer,
          confidence: prev.confidence,
          source_filename: prev.source_filename,
          engine: prev.engine,
        },
        {
          page_index: page.page_index,
          selected_answer: incomingAns,
          confidence: row.confidence,
          source_filename: page.source_filename,
          engine: page.engine,
        },
      ]
      prev.conflict = true
      prev.selected_answer = "BLANK"
      prev.confidence = 0
      prev.conflict_candidates = candidates.map((c) => ({
        page_index: c.page_index,
        selected_answer: c.selected_answer,
        confidence: c.confidence,
        source_filename: c.source_filename,
      }))
      prev.source_page_index = null
      conflicts.push({
        code: "MULTIPAGE_OMR_CONFLICT",
        question_id: row.question_id,
        candidates,
      })
    }
  }

  const merged_per_question = Array.from(byQuestion.values()).sort(
    (a, b) => questionSortKey(a.question_id) - questionSortKey(b.question_id),
  )

  const provenance_by_question: Record<string, OmrQuestionProvenance> = {}
  for (const q of merged_per_question) {
    provenance_by_question[q.question_id] = {
      question_id: q.question_id,
      selected_answer: q.selected_answer,
      source_page_index: q.source_page_index,
      source_filename: q.source_filename,
      engine: q.engine,
      variant: q.variant,
      observed_from_sensors: q.observed_from_sensors,
      assigned_detection_indices: q.assigned_detection_indices,
      confidence: q.confidence,
      ignored_blank_pages: q.ignored_blank_pages,
      conflict: q.conflict,
      conflict_candidates: q.conflict_candidates,
    }
  }

  const ignoredBlankCount = ignored_rows.filter((r) => r.reason === "ignored_blank_without_sensor").length

  return {
    merged_per_question,
    page_contributions: pages,
    conflicts,
    ignored_pages,
    ignored_rows,
    provenance_by_question,
    summary: {
      pages_total: pages.length,
      pages_ignored: ignored_pages.length,
      questions_merged: merged_per_question.length,
      questions_with_answer: merged_per_question.filter((q) => !isBlankLikeAnswer(q.selected_answer)).length,
      conflicts: conflicts.length,
      ignored_blank_without_sensor: ignoredBlankCount,
    },
  }
}

/** Construye officialOmrPerQuestionRaw desde el mismo merge (única fuente). */
export function buildOfficialOmrPerQuestionRawFromMerged(
  merged: MergeMultipageOmrResult,
): OfficialOmrRawRowWithProvenance[] {
  return merged.merged_per_question.map((q, idx) => {
    const n = questionSortKey(q.question_id)
    const questionNumber = Number.isFinite(n) && n < Number.MAX_SAFE_INTEGER ? n : idx + 1
    return {
      questionNumber,
      canonicalId: q.question_id,
      selectedAnswer: q.selected_answer,
      confidence: q.confidence,
      observedFromSensors: q.observed_from_sensors,
      assignedDetectionIndices: q.assigned_detection_indices,
      confidencesByColumn: q.confidences_by_column,
      multipageProvenance: {
        source_page_index: q.source_page_index,
        source_filename: q.source_filename,
        engine: q.engine,
        variant: q.variant,
        ignored_blank_pages: q.ignored_blank_pages,
        conflict: q.conflict,
        conflict_candidates: q.conflict_candidates,
      },
    }
  })
}

/** Construye detectedByPregunta-compatible desde el mismo merge. */
export function buildDetectedAnswersFromMerged(
  merged: MergeMultipageOmrResult,
): Array<{ pregunta: string; respuesta_detectada: string; confianza: number }> {
  return merged.merged_per_question.map((q) => ({
    pregunta: q.question_id,
    respuesta_detectada: q.selected_answer,
    confianza: q.confidence,
  }))
}

export type OmIntegrationInvariantResult =
  | { ok: true }
  | { ok: false; code: "OMR_INTEGRATION_INVARIANT_FAILED"; mismatches: Array<{ question_id: string; raw: string; detected: string }> }

/** Invariante: raw answer Cn === detected Cn (misma consolidación). */
export function assertOmrRawMatchesDetected(
  officialOmrPerQuestionRaw: Array<{ canonicalId?: string; questionNumber?: number; selectedAnswer?: string }>,
  detected: Array<{ pregunta: string; respuesta_detectada: string }>,
): OmIntegrationInvariantResult {
  const rawMap = new Map<string, string>()
  for (const row of officialOmrPerQuestionRaw) {
    const id =
      (typeof row.canonicalId === "string" && row.canonicalId.trim()) ||
      (typeof row.questionNumber === "number" ? `C${row.questionNumber}` : "")
    if (!id) continue
    rawMap.set(String(id).toUpperCase(), normalizeOmrAnswerLetter(row.selectedAnswer))
  }
  const mismatches: Array<{ question_id: string; raw: string; detected: string }> = []
  for (const d of detected) {
    const id = String(d.pregunta ?? "")
      .trim()
      .toUpperCase()
    if (!id) continue
    const det = normalizeOmrAnswerLetter(d.respuesta_detectada)
    const raw = rawMap.get(id)
    if (raw === undefined) continue
    if (raw !== det) {
      mismatches.push({ question_id: id, raw, detected: det })
    }
  }
  if (mismatches.length > 0) {
    return { ok: false, code: "OMR_INTEGRATION_INVARIANT_FAILED", mismatches }
  }
  return { ok: true }
}
