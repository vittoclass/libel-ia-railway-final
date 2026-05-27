/**
 * Metadata profesional para proyección PAES ensayo (P3B).
 * No altera fórmulas ni valores numéricos; solo trazabilidad de metodología.
 */

import type { ConfidenceLevel, ScoringMethodology, ScoringResultMetadata } from "@/app/lib/standardized/types"

export type PaesProjectionMethodology = "demre_table" | "linear_fallback" | "anchor_table"

export type PaesProjectionMeta = {
  scoring_engine: "paes_practice"
  methodology: PaesProjectionMethodology
  confidence_level: ConfidenceLevel
  source_label: string
}

const METHODOLOGY_SOURCE_LABEL: Record<PaesProjectionMethodology, string> = {
  demre_table: "Tabla DEMRE",
  anchor_table: "Tabla de anclas nacional",
  linear_fallback: "Proyección lineal desde % logro",
}

const METHODOLOGY_CONFIDENCE: Record<PaesProjectionMethodology, ConfidenceLevel> = {
  demre_table: "high",
  anchor_table: "medium",
  linear_fallback: "low",
}

export function paesProjectionMetaForMethodology(
  methodology: PaesProjectionMethodology,
  sourceLabelOverride?: string,
): PaesProjectionMeta {
  return {
    scoring_engine: "paes_practice",
    methodology,
    confidence_level: METHODOLOGY_CONFIDENCE[methodology],
    source_label: sourceLabelOverride?.trim() || METHODOLOGY_SOURCE_LABEL[methodology],
  }
}

export function paesProjectionMetaFromScoringMetadata(
  metadata: ScoringResultMetadata,
): PaesProjectionMeta | null {
  if (metadata.scoring_engine !== "paes_practice") return null
  const m = metadata.methodology
  if (m === "demre_table" || m === "linear_fallback" || m === "anchor_table") {
    return paesProjectionMetaForMethodology(m)
  }
  return null
}

/** Frase corta para UI cuando ya hay bloque de proyección PAES visible. */
export function paesMethodologyUiPhrase(meta: PaesProjectionMeta | null | undefined): string | null {
  if (!meta) return null
  const label = meta.source_label.toLowerCase()
  if (meta.methodology === "demre_table") return `PAES estimado según metodología: DEMRE (${label})`
  if (meta.methodology === "anchor_table") return `PAES estimado según metodología: anclas (${label})`
  return `PAES estimado según metodología: lineal (${label})`
}

/** Solo metodologías PAES válidas en ScoringMethodology. */
export function isPaesProjectionMethodology(m: ScoringMethodology): m is PaesProjectionMethodology {
  return m === "demre_table" || m === "linear_fallback" || m === "anchor_table"
}
