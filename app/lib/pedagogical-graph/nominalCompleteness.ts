/**
 * Completitud nominal (solo ranking/UX). No toca OCR ni persistencia de identidad.
 */
import { normalizeNominalName } from "@/app/lib/pedagogical-graph/nominalIdentity"

const NOMINAL_STOPWORDS = new Set(["de", "del", "la", "las", "los", "y"])

export type NominalCompletenessMetrics = {
  completeness_score: number
  useful_token_count: number
  non_initial_token_count: number
  single_letter_token_count: number
  has_single_letter_tokens: boolean
  is_likely_abbreviated: boolean
}

function nameTokens(normalized: string): string[] {
  return normalized.split(/\s+/).filter(Boolean)
}

/** Score 0–1: más tokens útiles, menos iniciales sueltas. */
export function scoreNominalCompleteness(raw: string): NominalCompletenessMetrics {
  const norm = normalizeNominalName(raw).normalized
  const tokens = nameTokens(norm)
  let useful = 0
  let nonInitial = 0
  let singleLetter = 0

  for (const t of tokens) {
    if (t.length === 1) {
      singleLetter += 1
      continue
    }
    if (!NOMINAL_STOPWORDS.has(t)) useful += 1
    if (t.length >= 2) nonInitial += 1
  }

  const charLen = norm.replace(/\s+/g, "").length
  let completeness_score =
    Math.min(1, useful * 0.22 + nonInitial * 0.12 + Math.min(charLen, 28) / 36 - singleLetter * 0.18)
  if (tokens.length === 0) completeness_score = 0

  const is_likely_abbreviated =
    singleLetter > 0 &&
    (tokens.length <= 2 || useful < Math.max(2, tokens.length - singleLetter))

  return {
    completeness_score: Math.max(0, Math.min(1, completeness_score)),
    useful_token_count: useful,
    non_initial_token_count: nonInitial,
    single_letter_token_count: singleLetter,
    has_single_letter_tokens: singleLetter > 0,
    is_likely_abbreviated,
  }
}

/** Abreviatura por prefijo (F→Franchesca, Fran→Franchesca, Franch→Franchesca). */
export function isPartialTokenAbbreviation(shortToken: string, longToken: string): boolean {
  if (!shortToken || !longToken) return false
  if (shortToken === longToken) return true
  return (
    shortToken.length >= 1 &&
    longToken.startsWith(shortToken) &&
    longToken.length - shortToken.length >= 3
  )
}

function tokenMatchesAsInitialOrFull(shortToken: string, fullToken: string): boolean {
  if (!shortToken || !fullToken) return false
  if (shortToken === fullToken) return true
  return isPartialTokenAbbreviation(shortToken, fullToken)
}

/** Alineación token a token con al menos un prefijo abreviado (ej. colomba fran → colomba franchesca). */
export function hasPartialAbbreviationBetweenNames(shorterNorm: string, fullerNorm: string): boolean {
  const sTokens = nameTokens(shorterNorm)
  const fTokens = nameTokens(fullerNorm)
  if (!sTokens.length || !fTokens.length || sTokens.length > fTokens.length) return false

  let fi = 0
  let hasPartial = false
  for (const st of sTokens) {
    let matched = false
    while (fi < fTokens.length) {
      const ft = fTokens[fi]!
      if (st === ft) {
        matched = true
        fi += 1
        break
      }
      if (isPartialTokenAbbreviation(st, ft) && st !== ft) {
        matched = true
        hasPartial = true
        fi += 1
        break
      }
      fi += 1
    }
    if (!matched) return false
  }
  return hasPartial
}

/**
 * El nombre corto es una abreviatura/expansión parcial del largo (ej. "colomba f" → "colomba franchesca").
 */
export function isNominalExpansionOf(shorterNorm: string, fullerNorm: string): boolean {
  const s = String(shorterNorm ?? "").trim()
  const f = String(fullerNorm ?? "").trim()
  if (!s || !f || s === f) return false

  const sTokens = nameTokens(s)
  const fTokens = nameTokens(f)

  const partialAbbrevStructure = hasPartialAbbreviationBetweenNames(s, f)
  const sMetrics = scoreNominalCompleteness(s)
  const fMetrics = scoreNominalCompleteness(f)
  if (
    !partialAbbrevStructure &&
    fMetrics.completeness_score <= sMetrics.completeness_score + 0.06
  ) {
    return false
  }
  if (partialAbbrevStructure && f.length > s.length) return true
  if (
    f.length <= s.length &&
    fMetrics.useful_token_count <= sMetrics.useful_token_count &&
    fMetrics.non_initial_token_count <= sMetrics.non_initial_token_count
  ) {
    return false
  }

  let fi = 0
  for (const st of sTokens) {
    let matched = false
    while (fi < fTokens.length) {
      if (tokenMatchesAsInitialOrFull(st, fTokens[fi]!)) {
        matched = true
        fi += 1
        break
      }
      fi += 1
    }
    if (!matched) return false
  }
  return true
}

/** El candidato es claramente incompleto frente a una alternativa confirmada más completa. */
export function isClearlyIncompleteVs(candidateNorm: string, alternativeNorm: string): boolean {
  if (!candidateNorm || !alternativeNorm || candidateNorm === alternativeNorm) return false
  if (!isNominalExpansionOf(candidateNorm, alternativeNorm)) return false
  const cand = scoreNominalCompleteness(candidateNorm)
  const alt = scoreNominalCompleteness(alternativeNorm)
  return (
    alt.completeness_score > cand.completeness_score + 0.05 ||
    (cand.is_likely_abbreviated && !alt.is_likely_abbreviated) ||
    hasPartialAbbreviationBetweenNames(candidateNorm, alternativeNorm) ||
    alternativeNorm.length >= candidateNorm.length + 3
  )
}

export function completenessRankBonus(raw: string): number {
  return scoreNominalCompleteness(raw).completeness_score * 0.1
}
