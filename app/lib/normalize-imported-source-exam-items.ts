import type { ParsedLine } from "@/app/lib/parse-bulk-items"

type TranslationReason =
  | "normalized_from_correct_answer"
  | "inferred_from_options_structure"
  | "inferred_from_vf_text_evidence"
  | "inferred_from_mc_text_evidence"
  | "kept_original_question_type"
  | "fallback_essay_by_rubric"
  | "fallback_short_answer"

type CorrectAnswerSource = "original_parser" | "text_extraction" | "none"

export type CanonicalImportTrace = {
  item_number: number
  original_question_type: string | null
  canonical_question_type: string | null
  canonicalizationSource: string
  promptDetected: boolean
  rubricDetected: boolean
  developmentDetected: boolean
  original_correct_answer: string | null
  canonical_correct_answer: string | null
  correct_answer_source: CorrectAnswerSource
  correct_answer_pattern: string | null
  optionsDetected: boolean
  optionsCount: number
  optionsExtractionSource: string
  optionsPreview: Array<{ letter: "A" | "B" | "C" | "D" | "E"; text: string }>
  warnings: string[]
  mc_text_evidence: boolean
  vf_text_evidence: boolean
  reason: TranslationReason
}

function normalizeClosedAnswer(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toUpperCase()
  if (/^[A-E]$/.test(t)) return t
  if (t === "V" || t === "F") return t
  return null
}

function hasMultipleChoiceEvidence(text: string | null | undefined): boolean {
  const t = (text ?? "").toUpperCase()
  if (!t.trim()) return false
  const letters: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"]
  let hits = 0
  for (const L of letters) {
    const re = new RegExp(String.raw`(?:^|\s)${L}\s*(?:[\)\.:\-–—]|\()`, "i")
    if (re.test(t)) hits++
  }
  return hits >= 2
}

type OptionLetter = "A" | "B" | "C" | "D" | "E"
type ExtractedOption = { letter: OptionLetter; text: string }

function normalizeOptionText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function extractOptionsFromText(text: string): {
  options: ExtractedOption[]
  source: string
  warnings: string[]
} {
  const warnings: string[] = []
  const raw = String(text ?? "")
  if (!raw.trim()) return { options: [], source: "none", warnings }

  // Delimitadores flexibles:
  // a) / a. / a: / a - / a ( / A... y variantes con saltos de línea.
  const marker = /(?:^|\n|\r|\s)([A-Ea-e])\s*(?:[\)\.:\-–—]|\()(?=\s|$)/g
  const hits: Array<{ idx: number; letter: OptionLetter; markerEnd: number }> = []
  let m: RegExpExecArray | null
  while ((m = marker.exec(raw)) !== null) {
    const full = m[0] ?? ""
    const letter = String(m[1] ?? "").toUpperCase() as OptionLetter
    const idx = m.index + (full.length - 1) - 1 // posición aproximada de la letra dentro del match
    const markerEnd = marker.lastIndex
    hits.push({ idx, letter, markerEnd })
  }

  if (hits.length === 0) return { options: [], source: "no_marker_found", warnings }

  // Deduplicar por letra, conservando la primera aparición.
  const seen = new Set<OptionLetter>()
  const orderedHits: typeof hits = []
  for (const h of hits) {
    if (seen.has(h.letter)) continue
    seen.add(h.letter)
    orderedHits.push(h)
  }

  const options: ExtractedOption[] = []
  for (let i = 0; i < orderedHits.length; i++) {
    const cur = orderedHits[i]
    const next = i + 1 < orderedHits.length ? orderedHits[i + 1] : null
    const start = cur.markerEnd
    const end = next ? Math.max(next.idx - 1, start) : raw.length
    const candidate = normalizeOptionText(raw.slice(start, end))
    options.push({ letter: cur.letter, text: candidate })
  }

  // Filtrar opciones completamente vacías y dejar aviso si hubo extracción parcial.
  const nonEmpty = options.filter((o) => o.text.length > 0)
  if (nonEmpty.length < options.length) {
    warnings.push("Se detectaron marcadores de alternativas sin contenido de texto en una o más letras.")
  }

  if (nonEmpty.length > 0 && nonEmpty.length < 2) {
    warnings.push("Se detectó solo una alternativa con contenido; extracción parcial.")
  }

  return {
    options: nonEmpty,
    source: "marker_letter_plus_delimiter",
    warnings,
  }
}

function hasDevelopmentEvidence(itemText: string, rubricText: string): boolean {
  const merged = `${itemText}\n${rubricText}`.toLowerCase()
  if (!merged.trim()) return false
  if (rubricText.trim().length >= 12) return true
  return (
    /(?:criterio|rúbrica|rubrica|pauta|justifica|explica|desarrolla|fundamenta|argumenta|respuesta esperada)/i.test(
      merged,
    ) || /\b\d+\s*puntos?\b/i.test(merged)
  )
}

function splitPromptFromOptions(
  itemText: string,
  options: ExtractedOption[],
): { prompt: string; source: string; warning: string | null } {
  const raw = String(itemText ?? "")
  if (!raw.trim() || options.length === 0) {
    return { prompt: raw.trim(), source: "prompt_without_options_split", warning: null }
  }

  // Intento conservador: si detectamos el primer marcador de alternativa, cortamos prompt antes de él.
  const firstMarker = raw.search(/(?:^|\n|\r|\s)[A-Ea-e]\s*(?:[\)\.:\-–—]|\()(?=\s|$)/)
  if (firstMarker <= 0) {
    return {
      prompt: raw.trim(),
      source: "prompt_options_not_split_kept_original",
      warning: "No se pudo separar prompt/opciones con seguridad; se conserva item_text original.",
    }
  }
  const prompt = raw.slice(0, firstMarker).trim()
  if (!prompt) {
    return {
      prompt: raw.trim(),
      source: "prompt_empty_after_split_kept_original",
      warning: "Separación de opciones dejó prompt vacío; se conserva item_text original.",
    }
  }
  return { prompt, source: "prompt_split_before_first_option_marker", warning: null }
}

function hasVfEvidence(text: string | null | undefined): boolean {
  const t = (text ?? "").toUpperCase()
  if (!t.trim()) return false
  return (
    /\bVERDADERO\b/.test(t) ||
    /\bFALSO\b/.test(t) ||
    /V\s*\/\s*F/.test(t) ||
    /\bV\s*(?:[\)\.:\-–—]|\()/.test(t) ||
    /\bF\s*(?:[\)\.:\-–—]|\()/.test(t)
  )
}

function normalizeQuestionType(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toLowerCase()
  if (!t) return null
  if (
    t === "multiple_choice" ||
    t === "true_false" ||
    t === "short_answer" ||
    t === "essay" ||
    t === "completion"
  ) {
    return t
  }
  return null
}

function isClosedQuestionType(t: string | null | undefined): boolean {
  return t === "multiple_choice" || t === "true_false"
}

function extractCorrectAnswerFromText(
  text: string,
  canonicalType: string | null,
): { answer: string | null; pattern: string | null } {
  if (!text.trim() || !isClosedQuestionType(canonicalType)) return { answer: null, pattern: null }

  if (canonicalType === "true_false") {
    const vfPatterns: Array<{ name: string; re: RegExp }> = [
      {
        name: "vf:clave_respuesta_correcta",
        re: /(?:clave|respuesta|opci[oó]n|alternativa)\s*(?:correcta)?\s*[:\.]\s*\b([VF])\b/i,
      },
      {
        name: "vf:letra_correcta",
        re: /letra\s+correcta\s*[:\.]\s*\b([VF])\b/i,
      },
    ]
    for (const p of vfPatterns) {
      const m = text.match(p.re)
      const normalized = normalizeClosedAnswer(m?.[1] ?? null)
      if (normalized === "V" || normalized === "F") {
        return { answer: normalized, pattern: p.name }
      }
    }
    return { answer: null, pattern: null }
  }

  const mcPatterns: Array<{ name: string; re: RegExp }> = [
    {
      name: "mc:respuesta_correcta",
      re: /respuesta\s+correcta\s*[:\.]\s*([A-E])\b/i,
    },
    {
      name: "mc:alternativa_correcta",
      re: /alternativa\s+correcta\s*[:\.]\s*([A-E])\b/i,
    },
    {
      name: "mc:clave_docente",
      re: /clave\s*(?:de\s*correcci[oó]n|docente|profesor)?\s*[:\.]\s*([A-E])\b/i,
    },
    {
      name: "mc:opcion_correcta",
      re: /opci[oó]n\s+correcta\s*[:\.]\s*([A-E])\b/i,
    },
    {
      name: "mc:letra_correcta",
      re: /letra\s+correcta\s*[:\.]\s*([A-E])\b/i,
    },
  ]
  for (const p of mcPatterns) {
    const m = text.match(p.re)
    const normalized = normalizeClosedAnswer(m?.[1] ?? null)
    if (normalized && /^[A-E]$/.test(normalized)) {
      return { answer: normalized, pattern: p.name }
    }
  }
  return { answer: null, pattern: null }
}

export function normalizeImportedSourceExamItems(items: ParsedLine[]): {
  items: ParsedLine[]
  trace: CanonicalImportTrace[]
} {
  const out: ParsedLine[] = []
  const trace: CanonicalImportTrace[] = []

  for (const item of items) {
    const itemText = String(item.item_text ?? "")
    const rubricText = String(item.rubric_text ?? "")
    const fullText = `${itemText}\n${rubricText}`

    const originalType = normalizeQuestionType(item.question_type)
    const explicitOpenOrCompletion =
      originalType === "essay" ||
      originalType === "short_answer" ||
      originalType === "completion"
    const normalizedAnswer = normalizeClosedAnswer(item.correct_answer)
    const mcEvidence = hasMultipleChoiceEvidence(fullText)
    const vfEvidence = hasVfEvidence(fullText)
    const optionsExtracted = extractOptionsFromText(fullText)
    const optionsDetected = optionsExtracted.options.length >= 2
    const rubricDetected = rubricText.trim().length > 0
    const developmentDetected = hasDevelopmentEvidence(itemText, rubricText)
    const promptSplit = splitPromptFromOptions(itemText, optionsExtracted.options)
    const promptDetected = promptSplit.prompt.trim().length > 0

    let canonicalType: string | null = originalType
    let reason: TranslationReason = "kept_original_question_type"
    let canonicalizationSource = "original_question_type"
    const warnings = [...optionsExtracted.warnings]
    if (promptSplit.warning) warnings.push(promptSplit.warning)

    // Prioridad: evidencia fuerte de cerrada o clave cerrada explícita.
    if (normalizedAnswer === "V" || normalizedAnswer === "F") {
      canonicalType = "true_false"
      reason = "normalized_from_correct_answer"
      canonicalizationSource = "closed_from_correct_answer_vf"
    } else if (normalizedAnswer && /^[A-E]$/.test(normalizedAnswer)) {
      canonicalType = "multiple_choice"
      reason = "normalized_from_correct_answer"
      canonicalizationSource = "closed_from_correct_answer_mc"
    } else if (explicitOpenOrCompletion) {
      canonicalType = originalType
      reason = "kept_original_question_type"
      canonicalizationSource = "preserve_explicit_open_or_completion_type"
    } else if (vfEvidence) {
      canonicalType = "true_false"
      reason = "inferred_from_vf_text_evidence"
      canonicalizationSource = "closed_from_vf_text_evidence"
    } else if (optionsDetected) {
      canonicalType = "multiple_choice"
      reason = "inferred_from_options_structure"
      canonicalizationSource = "closed_from_options_structure"
    } else if (mcEvidence) {
      canonicalType = "multiple_choice"
      reason = "inferred_from_mc_text_evidence"
      canonicalizationSource = "closed_from_mc_text_evidence"
    } else if (!canonicalType) {
      if (developmentDetected) {
        canonicalType = "essay"
        reason = "fallback_essay_by_rubric"
        canonicalizationSource = "development_from_rubric_or_prompt_evidence"
      } else {
        canonicalType = "short_answer"
        reason = "fallback_short_answer"
        canonicalizationSource = "fallback_short_answer_no_strong_evidence"
      }
    }

    // Si venía como cerrada válida desde origen, no degradar a desarrollo por ausencia de clave.
    if (
      (originalType === "multiple_choice" || originalType === "true_false") &&
      canonicalType !== "multiple_choice" &&
      canonicalType !== "true_false"
    ) {
      canonicalType = originalType
      canonicalizationSource = "preserve_original_closed_type"
      warnings.push("Se preserva tipo cerrado original para evitar degradación a desarrollo.")
    }

    let canonicalCorrectAnswer: string | null = normalizedAnswer ?? null
    let correctAnswerSource: CorrectAnswerSource = normalizedAnswer ? "original_parser" : "none"
    let correctAnswerPattern: string | null = null
    if (!canonicalCorrectAnswer && isClosedQuestionType(canonicalType)) {
      const extracted = extractCorrectAnswerFromText(fullText, canonicalType)
      if (extracted.answer) {
        canonicalCorrectAnswer = extracted.answer
        correctAnswerSource = "text_extraction"
        correctAnswerPattern = extracted.pattern
      }
    }

    const itemTextOut = explicitOpenOrCompletion ? itemText : promptSplit.prompt || itemText
    out.push({
      ...item,
      item_text: itemTextOut,
      question_type: canonicalType,
      correct_answer: canonicalCorrectAnswer,
    })

    trace.push({
      item_number: item.item_number,
      original_question_type: item.question_type ?? null,
      canonical_question_type: canonicalType,
      canonicalizationSource,
      promptDetected,
      rubricDetected,
      developmentDetected,
      original_correct_answer: item.correct_answer ?? null,
      canonical_correct_answer: canonicalCorrectAnswer,
      correct_answer_source: correctAnswerSource,
      correct_answer_pattern: correctAnswerPattern,
      optionsDetected,
      optionsCount: optionsExtracted.options.length,
      optionsExtractionSource: `${optionsExtracted.source}|${promptSplit.source}`,
      optionsPreview: optionsExtracted.options.slice(0, 5),
      warnings,
      mc_text_evidence: mcEvidence,
      vf_text_evidence: vfEvidence,
      reason,
    })
  }

  return { items: out, trace }
}
