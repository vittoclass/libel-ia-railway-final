/**
 * Sprint 34 — Extracción estructural de requisitos por nivel (Etapa A).
 * Determinista: solo fragmenta el descriptor original; no inventa requisitos.
 * Universal: sin hardcodes por criterio/rúbrica/estudiante.
 */

import type { ParsedRubricDescriptorBand } from "@/app/lib/development-core/parse-rubric-criteria"

export type RequirementKind = "positive" | "problem_condition"

export interface ObservableRequirement {
  /** Texto trazable al descriptor (fragmento). */
  requirement: string
  kind: RequirementKind
}

export interface LevelRequirementPack {
  level_label: string
  ordinal: number
  descriptor_text: string
  observable_requirements: string[]
  prohibited_or_absent_conditions?: string[]
  /** Detalle interno para decisión (mismos strings que arriba). */
  items: ObservableRequirement[]
}

function normalizeSpaces(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim()
}

/** Parte cláusulas sin inventar contenido; conserva fragmentos del descriptor. */
function splitDescriptorFragments(text: string): string[] {
  const raw = normalizeSpaces(text)
  if (!raw) return []

  const parts: string[] = []
  // Primero: oraciones / puntos / punto y coma
  const sentences = raw
    .split(/(?<=[.!?])\s+|;\s+/)
    .map(normalizeSpaces)
    .filter(Boolean)

  for (const sentence of sentences) {
    // Separar "X, pero Y" / "X; sin embargo Y" sin perder ambos lados
    const peroSplit = sentence.split(
      /\s*,?\s*(?:pero|sin embargo|aunque|no obstante)\s+/i,
    )
    if (peroSplit.length > 1) {
      for (const p of peroSplit) {
        const t = normalizeSpaces(p.replace(/^[,:.\s]+|[,:.\s]+$/g, ""))
        if (t) parts.push(t)
      }
      continue
    }

    // "debido a A, B o C" → conservar la frase completa + subpartes tras "debido a"
    const debido = /\bdebido a\s+(.+)$/i.exec(sentence)
    if (debido) {
      parts.push(normalizeSpaces(sentence))
      const subs = debido[1]
        .split(/\s*,\s*|\s+o\s+|\s+y\s+/i)
        .map((x) => normalizeSpaces(x.replace(/^[,:.\s]+|[,:.\s]+$/g, "")))
        .filter((x) => x.length >= 8)
      parts.push(...subs)
      continue
    }

    // Coordinación ligera: "A y B" solo si ambos lados son cláusulas sustanciales
    const yParts = sentence.split(/\s+y\s+/i)
    if (yParts.length === 2 && yParts.every((p) => p.trim().length >= 12)) {
      parts.push(...yParts.map((p) => normalizeSpaces(p)))
      continue
    }

    parts.push(sentence)
  }

  // Deduplicar preservando orden
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    if (p.length < 6) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function looksLikeProblemCondition(fragment: string): boolean {
  const f = fragment.toLowerCase()
  return (
    /\b(falta|carece|cuesta|dificulta|confus|incomplet|redundan|abrupt|demasiado|no se|no hay|sin |problemas? de|dispers|vago|mecánic|impide)\b/i.test(
      f,
    ) || /\bno\s+[a-záéíóú]/i.test(f)
  )
}

/**
 * Genera packs de requisitos por nivel a partir de descriptores ordenados
 * (superior → inferior). Trazable al texto original.
 */
export function extractLevelRequirementPacks(
  descriptors: ParsedRubricDescriptorBand[],
): LevelRequirementPack[] {
  return descriptors.map((d) => {
    const fragments = splitDescriptorFragments(d.text)
    const items: ObservableRequirement[] = fragments.map((requirement) => ({
      requirement,
      kind: looksLikeProblemCondition(requirement) ? "problem_condition" : "positive",
    }))

    // Si el descriptor es casi solo problemas y no hubo positivos, el fragmento
    // completo también cuenta como condición caracterizante.
    if (items.length === 0 && d.text.trim()) {
      items.push({
        requirement: normalizeSpaces(d.text),
        kind: looksLikeProblemCondition(d.text) ? "problem_condition" : "positive",
      })
    }

    const observable_requirements = items
      .filter((i) => i.kind === "positive")
      .map((i) => i.requirement)
    const prohibited_or_absent_conditions = items
      .filter((i) => i.kind === "problem_condition")
      .map((i) => i.requirement)

    return {
      level_label: d.level_label || `band_${d.ordinal}`,
      ordinal: d.ordinal,
      descriptor_text: d.text,
      observable_requirements,
      prohibited_or_absent_conditions:
        prohibited_or_absent_conditions.length > 0
          ? prohibited_or_absent_conditions
          : undefined,
      items,
    }
  })
}

/** Firma determinista de requisitos (para asserts 10/10). */
export function requirementsFingerprint(packs: LevelRequirementPack[]): string {
  return packs
    .map((p) => {
      const pos = p.observable_requirements.join("||")
      const neg = (p.prohibited_or_absent_conditions ?? []).join("||")
      return `${p.ordinal}::${p.level_label}::${pos}::${neg}`
    })
    .join("\n")
}
