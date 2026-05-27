/**
 * Motor PAES ensayo — capa P1.
 * Delega en conversores existentes; no altera nota chilena ni evaluate.
 */

import { paesFromCorrectas, type DemreRow } from "@/app/lib/services/pedagogical"
import { convertToNationalScore } from "@/app/lib/standard-scale/converters"
import { projectPaesFromLogroPct } from "@/app/lib/standard-scale-converters"
import type { ScoredResult, ScoringResultMetadata } from "@/app/lib/standardized/types"

export type PaesPracticeMode = "linear_from_logro" | "anchor_table" | "demre_from_correctas"

const LINEAR_METADATA: ScoringResultMetadata = {
  scoring_engine: "paes_practice",
  confidence_level: "low",
  methodology: "linear_fallback",
}

const ANCHOR_METADATA: ScoringResultMetadata = {
  scoring_engine: "paes_practice",
  confidence_level: "medium",
  methodology: "anchor_table",
}

const DEMRE_METADATA: ScoringResultMetadata = {
  scoring_engine: "paes_practice",
  confidence_level: "high",
  methodology: "demre_table",
}

const DEMRE_FALLBACK_METADATA: ScoringResultMetadata = {
  scoring_engine: "paes_practice",
  confidence_level: "low",
  methodology: "linear_fallback",
}

/**
 * PAES lineal 100–1000 desde % logro.
 * Equivalente a projectPaesFromLogroPct.
 */
export function scorePaesFromLogroPctLinear(logroPct: number): ScoredResult<number> {
  return {
    value: projectPaesFromLogroPct(logroPct),
    metadata: LINEAR_METADATA,
  }
}

/**
 * PAES vía tabla de anclas versionada (convertToNationalScore).
 * Equivalente a informes pedagógicos con scaleYear.
 */
export function scorePaesFromLogroPctAnchors(
  logroPct: number,
  year: number = 2026,
): ScoredResult<number | null> {
  const value = convertToNationalScore(logroPct, "paes", year)
  return {
    value,
    metadata: ANCHOR_METADATA,
  }
}

export type PaesDemreInput = {
  correctas: number
  demreRows: DemreRow[]
  /** Fallback lineal si no hay filas DEMRE (misma política que student-projection-upsert). */
  logroPctFallback?: number
}

/**
 * PAES desde tabla DEMRE por número de correctas.
 * Si no hay tabla, cae a lineal desde logroPctFallback (o null sin fallback).
 */
export function scorePaesFromDemre(input: PaesDemreInput): ScoredResult<number | null> {
  const demreScore = paesFromCorrectas(input.correctas, input.demreRows)

  if (demreScore != null) {
    return {
      value: Math.max(100, demreScore),
      metadata: DEMRE_METADATA,
    }
  }

  if (input.logroPctFallback != null && Number.isFinite(input.logroPctFallback)) {
    return {
      value: projectPaesFromLogroPct(input.logroPctFallback),
      metadata: DEMRE_FALLBACK_METADATA,
    }
  }

  return {
    value: null,
    metadata: DEMRE_FALLBACK_METADATA,
  }
}

/** Selector explícito de modo (preparado para migración futura de consumidores). */
export function scorePaesPractice(
  mode: PaesPracticeMode,
  input: {
    logroPct?: number
    year?: number
    correctas?: number
    demreRows?: DemreRow[]
  },
): ScoredResult<number | null> {
  switch (mode) {
    case "linear_from_logro":
      return scorePaesFromLogroPctLinear(Number(input.logroPct ?? 0))
    case "anchor_table":
      return scorePaesFromLogroPctAnchors(Number(input.logroPct ?? 0), input.year ?? 2026)
    case "demre_from_correctas":
      return scorePaesFromDemre({
        correctas: Number(input.correctas ?? 0),
        demreRows: input.demreRows ?? [],
        logroPctFallback: input.logroPct,
      })
    default:
      return scorePaesFromLogroPctLinear(Number(input.logroPct ?? 0))
  }
}
