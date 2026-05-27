/**
 * Resolución segura de materia PAES desde contexto de evaluación (P4B.2).
 * Solo lectura/heurística: no persiste, no altera scoring ni tablas DEMRE.
 *
 * Regla de oro: no inferir PAES Lectora desde “Lenguaje” genérico sin señales PAES/ensayo.
 */

export const PAES_SUBJECTS = [
  "COMPETENCIA_LECTORA",
  "MATEMATICA_M1",
  "MATEMATICA_M2",
  "HISTORIA",
  "CIENCIAS",
] as const

export type PaesSubject = (typeof PAES_SUBJECTS)[number]

export type PaesSubjectConfidence = "low" | "medium" | "high"

export interface PaesSubjectResolverInput {
  exam_type?: string | null
  assessment_category?: string | null
  subject?: string | null
  source_exam_title?: string | null
  source_exam_subject?: string | null
  source_exam_tags?: string[] | string | null
  course_label?: string | null
  /** Texto de pauta / instrucciones del instrumento */
  pauta_text?: string | null
  evaluation_title?: string | null
}

export interface PaesSubjectResolverResult {
  paesSubject: PaesSubject | null
  confidence: PaesSubjectConfidence
  reasons: string[]
}

const CANONICAL_SUBJECT_SET = new Set<string>(PAES_SUBJECTS)

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

function collectTextFragments(input: PaesSubjectResolverInput): string[] {
  const tags = input.source_exam_tags
  const tagText = Array.isArray(tags) ? tags.join(" ") : String(tags ?? "")

  return [
    input.exam_type,
    input.assessment_category,
    input.subject,
    input.source_exam_title,
    input.source_exam_subject,
    tagText,
    input.course_label,
    input.pauta_text,
    input.evaluation_title,
  ]
    .map((s) => normalizeText(s))
    .filter(Boolean)
}

function joinedContext(fragments: string[]): string {
  return fragments.join(" | ")
}

function hasPaesContext(input: PaesSubjectResolverInput, ctx: string): { active: boolean; reasons: string[] } {
  const reasons: string[] = []

  const examType = normalizeText(input.exam_type)
  const assessment = normalizeText(input.assessment_category)

  if (examType === "paes" || examType === "ensayo_paes" || examType.includes("paes")) {
    reasons.push(`exam_type indica familia PAES (${input.exam_type})`)
  }
  if (assessment === "paes" || assessment === "ensayo_paes") {
    reasons.push(`assessment_category indica ensayo PAES (${input.assessment_category})`)
  }

  const subjectCanon = String(input.subject ?? "")
    .trim()
    .toUpperCase()
  if (CANONICAL_SUBJECT_SET.has(subjectCanon)) {
    reasons.push(`subject ya es código PAES canónico (${subjectCanon})`)
  }

  if (/\bpaes\b/.test(ctx)) {
    reasons.push("texto de contexto contiene «PAES»")
  }
  if (/\bensayo\s+paes\b/.test(ctx) || /\bprueba\s+paes\b/.test(ctx) || /\bfacsimil\s+paes\b/.test(ctx)) {
    reasons.push("texto de contexto indica ensayo/prueba PAES")
  }

  return { active: reasons.length > 0, reasons }
}

function matchCanonicalFromFields(input: PaesSubjectResolverInput): PaesSubject | null {
  for (const raw of [input.subject, input.source_exam_subject]) {
    const canon = String(raw ?? "")
      .trim()
      .toUpperCase()
    if (CANONICAL_SUBJECT_SET.has(canon)) {
      return canon as PaesSubject
    }
  }
  return null
}

/** M2 antes que M1; Historia (ciencias sociales) antes que Ciencias naturales. */
function detectSubjectFromText(ctx: string): { subject: PaesSubject | null; reasons: string[] } {
  const reasons: string[] = []

  if (
    /\bm\s*2\b/.test(ctx) ||
    /\bmatematica\s*2\b/.test(ctx) ||
    /\bcompetencia\s+matematica\s*2\b/.test(ctx) ||
    /\bcompetencia\s+matematica\s+m2\b/.test(ctx)
  ) {
    reasons.push("coincide patrón Matemática M2 / M2")
    return { subject: "MATEMATICA_M2", reasons }
  }

  if (
    /\bm\s*1\b/.test(ctx) ||
    /\bmatematica\s*1\b/.test(ctx) ||
    /\bcompetencia\s+matematica\s*1\b/.test(ctx) ||
    /\bcompetencia\s+matematica\s+m1\b/.test(ctx)
  ) {
    reasons.push("coincide patrón Matemática M1 / M1")
    return { subject: "MATEMATICA_M1", reasons }
  }

  if (/\bhistoria\b/.test(ctx) || /\bciencias\s+sociales\b/.test(ctx)) {
    reasons.push("coincide Historia o Ciencias Sociales")
    return { subject: "HISTORIA", reasons }
  }

  if (
    /\bbiolog/.test(ctx) ||
    /\bfisic/.test(ctx) ||
    /\bquimic/.test(ctx) ||
    (/\bciencias\b/.test(ctx) && !/\bciencias\s+sociales\b/.test(ctx))
  ) {
    reasons.push("coincide Ciencias (naturales) o asignatura científica")
    return { subject: "CIENCIAS", reasons }
  }

  if (
    /\bcompetencia\s+lectora\b/.test(ctx) ||
    /\bcomprension\s+lectora\b/.test(ctx) ||
    /\blectura\b/.test(ctx) ||
    (/\blenguaje\b/.test(ctx) && /\bpaes\b/.test(ctx))
  ) {
    reasons.push("coincide Competencia Lectora / lectura (con señal PAES si aplica lenguaje)")
    return { subject: "COMPETENCIA_LECTORA", reasons }
  }

  return { subject: null, reasons }
}

/**
 * Infiere la materia PAES real a partir de metadatos de evaluación/examen.
 * Devuelve null si no hay contexto PAES suficiente (evita falsos positivos en Lenguaje escolar).
 */
export function resolvePaesSubjectFromContext(
  input: PaesSubjectResolverInput
): PaesSubjectResolverResult {
  const fragments = collectTextFragments(input)
  const ctx = joinedContext(fragments)
  const paesGate = hasPaesContext(input, ctx)
  const reasons: string[] = []

  const canonicalField = matchCanonicalFromFields(input)
  if (canonicalField && paesGate.active) {
    return {
      paesSubject: canonicalField,
      confidence: "high",
      reasons: [...paesGate.reasons, `código canónico en metadatos: ${canonicalField}`],
    }
  }

  if (!paesGate.active) {
    if (canonicalField) {
      reasons.push(
        `código ${canonicalField} presente pero sin señales PAES; no se asume ensayo PAES`
      )
    } else {
      const soft = detectSubjectFromText(ctx)
      if (soft.subject) {
        reasons.push(
          `patrón de materia (${soft.subject}) sin contexto PAES; se rechaza para evitar falso positivo`
        )
      } else {
        reasons.push("sin señales PAES ni ensayo PAES en el contexto")
      }
    }
    return { paesSubject: null, confidence: "low", reasons }
  }

  reasons.push(...paesGate.reasons)

  if (canonicalField) {
    return {
      paesSubject: canonicalField,
      confidence: "high",
      reasons: [...reasons, `código canónico en metadatos: ${canonicalField}`],
    }
  }

  const detected = detectSubjectFromText(ctx)
  if (detected.subject) {
    const confidence: PaesSubjectConfidence =
      paesGate.reasons.some((r) => r.includes("assessment_category") || r.includes("exam_type"))
        ? "high"
        : "medium"
    return {
      paesSubject: detected.subject,
      confidence,
      reasons: [...reasons, ...detected.reasons],
    }
  }

  return {
    paesSubject: null,
    confidence: "low",
    reasons: [...reasons, "contexto PAES presente pero materia no identificable"],
  }
}
