/**
 * Motor SIMCE ensayo (proyección referencial) — capa P1.
 * Delega en funciones existentes; no altera scoring escolar ni evaluate.
 */

import { agencyAchievementLevelFromLogroPct } from "@/app/lib/chile-standards/agency-level-cuts"
import {
  SIMCE_PROJECTION_DISCLAIMER,
  SIMCE_PROJECTION_TYPE_REFERENTIAL,
  projectCanonicalSimce,
  simceProjectionMetadata,
} from "@/app/lib/simceProjectionCanonical"
import { simceLevelFromLogroPct, type SimceLevel } from "@/app/lib/standard-scale-converters"
import type { ScoredResult, ScoringResultMetadata } from "@/app/lib/standardized/types"

export type SimcePracticeMode = "basic_practice_score" | "item_parameterized"

export type SimcePracticeScoreInput = {
  logroPct: number
  mode?: SimcePracticeMode
  /** Reservado: parámetros por ítem (IRT/dificultad) — no implementado en P1. */
  itemParameters?: ReadonlyArray<Record<string, unknown>>
}

const BASIC_METADATA: ScoringResultMetadata = {
  scoring_engine: "simce_practice",
  confidence_level: "low",
  methodology: "referential_scale",
}

const ITEM_PARAM_STUB_METADATA: ScoringResultMetadata = {
  scoring_engine: "simce_practice",
  confidence_level: "low",
  methodology: "item_parameterized",
}

/**
 * Puntaje SIMCE referencial (200–400) desde % de logro.
 * Equivalente a projectSimceFromLogroPct / projectCanonicalSimce.
 */
export function scoreSimcePractice(input: SimcePracticeScoreInput): ScoredResult<number> {
  const mode = input.mode ?? "basic_practice_score"
  const hasItemParams =
    mode === "item_parameterized" &&
    Array.isArray(input.itemParameters) &&
    input.itemParameters.length > 0

  if (hasItemParams) {
    // P1: stub — motor parametrizado pendiente; mismo valor que basic hasta implementar IRT.
    return {
      value: projectCanonicalSimce(input.logroPct),
      metadata: ITEM_PARAM_STUB_METADATA,
    }
  }

  return {
    value: projectCanonicalSimce(input.logroPct),
    metadata: BASIC_METADATA,
  }
}

/** Atajo sin objeto de entrada (mismo valor que scoreSimcePractice basic). */
export function scoreSimceFromLogroPct(logroPct: number): ScoredResult<number> {
  return scoreSimcePractice({ logroPct, mode: "basic_practice_score" })
}

/** Nivel Agencia (&lt;50 / 50–69 / ≥70) con metadata SIMCE. */
export function simceLevelWithMetadata(logroPct: number): ScoredResult<SimceLevel> {
  return {
    value: simceLevelFromLogroPct(logroPct),
    metadata: {
      scoring_engine: "simce_practice",
      confidence_level: "medium",
      methodology: "referential_scale",
    },
  }
}

/** Re-export de disclaimer canónico (sin duplicar texto). */
export {
  SIMCE_PROJECTION_DISCLAIMER,
  SIMCE_PROJECTION_TYPE_REFERENTIAL,
  simceProjectionMetadata,
  agencyAchievementLevelFromLogroPct,
}
