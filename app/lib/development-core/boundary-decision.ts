/**
 * Sprint 34 — Regla universal de frontera entre niveles adyacentes (Etapa B).
 * Determinista a partir de checks estructurados. Sin hardcodes por criterio.
 * No elige al azar: empate real → BOUNDARY_AMBIGUOUS.
 */

import type { LevelRequirementPack } from "@/app/lib/development-core/extract-level-requirements"

export type RequirementCheckStatus = "PRESENT" | "ABSENT" | "NOT_OBSERVABLE"

export interface RequirementCheck {
  requirement: string
  status: RequirementCheckStatus
  evidence_quote?: string
  reason: string
  /** ordinal del nivel al que pertenece el requisito */
  level_ordinal: number
  kind: "positive" | "problem_condition"
}

export type BoundaryDecisionKind =
  | "LEVEL"
  | "BOUNDARY_AMBIGUOUS"
  | "INSUFFICIENT_EVIDENCE"

/** Niveles Solo Desarrollo + ambigüedad explícita de frontera. */
export type BoundaryNivelLogro =
  | "LOGRADO"
  | "PARCIALMENTE_LOGRADO"
  | "INSUFICIENTE"
  | "NO_OBSERVABLE"
  | "BOUNDARY_AMBIGUOUS"

export interface BoundaryDecisionResult {
  decision: BoundaryDecisionKind
  /** Nivel canónico si decision === LEVEL; BOUNDARY_AMBIGUOUS si ambigüedad. */
  selected_level: BoundaryNivelLogro
  selected_ordinal: number | null
  recommended_level?: BoundaryNivelLogro
  alternate_level?: BoundaryNivelLogro
  recommended_ordinal?: number
  alternate_ordinal?: number
  ambiguity_reason?: string
  descriptor_selected?: string
  present_requirements: string[]
  absent_requirements: string[]
  not_observable_requirements: string[]
  justification: string
}

function mapOrdinalToNivel(
  ordinal: number,
  bandCount: number,
): Exclude<BoundaryNivelLogro, "BOUNDARY_AMBIGUOUS"> {
  if (bandCount <= 0) return "INSUFICIENTE"
  if (bandCount === 1) return "LOGRADO"
  if (bandCount === 2) {
    return ordinal <= 0 ? "LOGRADO" : "INSUFICIENTE"
  }
  if (bandCount === 3) {
    if (ordinal <= 0) return "LOGRADO"
    if (ordinal === 1) return "PARCIALMENTE_LOGRADO"
    return "INSUFICIENTE"
  }
  // 4+ bandas: superior / intermedio-alto / intermedio-bajo / inferior(+)
  if (ordinal <= 0) return "LOGRADO"
  if (ordinal === 1) return "PARCIALMENTE_LOGRADO"
  return "INSUFICIENTE"
}

function findCheck(
  checks: RequirementCheck[],
  levelOrdinal: number,
  requirement: string,
): RequirementCheck | undefined {
  const want = requirement.toLowerCase()
  return checks.find(
    (c) =>
      c.level_ordinal === levelOrdinal &&
      c.requirement.toLowerCase() === want,
  )
}

function statusOf(
  checks: RequirementCheck[],
  levelOrdinal: number,
  requirement: string,
): RequirementCheckStatus {
  return findCheck(checks, levelOrdinal, requirement)?.status ?? "NOT_OBSERVABLE"
}

/** ¿Todos los requisitos positivos esenciales están PRESENT (ninguno ABSENT/unknown)? */
function allPositivePresent(
  pack: LevelRequirementPack,
  checks: RequirementCheck[],
): boolean {
  const positives = pack.observable_requirements
  if (positives.length === 0) return false
  return positives.every((r) => statusOf(checks, pack.ordinal, r) === "PRESENT")
}

function anyPositiveAbsent(
  pack: LevelRequirementPack,
  checks: RequirementCheck[],
): boolean {
  return pack.observable_requirements.some(
    (r) => statusOf(checks, pack.ordinal, r) === "ABSENT",
  )
}

function anyPositiveUnknown(
  pack: LevelRequirementPack,
  checks: RequirementCheck[],
): boolean {
  return pack.observable_requirements.some(
    (r) => statusOf(checks, pack.ordinal, r) === "NOT_OBSERVABLE",
  )
}

/**
 * Nivel inferior “cumplido” de forma demostrable:
 * - si tiene positivos → todos PRESENT
 * - si solo tiene problem_conditions → al menos una PRESENT (caracteriza el nivel)
 * - si tiene ambos → positivos PRESENT O (si positivos fallan) problems presentes
 */
function lowerLevelDemonstrated(
  pack: LevelRequirementPack,
  checks: RequirementCheck[],
): boolean {
  const problems = pack.prohibited_or_absent_conditions ?? []
  const positives = pack.observable_requirements

  if (positives.length > 0 && allPositivePresent(pack, checks)) return true

  if (problems.length > 0) {
    const anyProblem = problems.some(
      (r) => statusOf(checks, pack.ordinal, r) === "PRESENT",
    )
    if (positives.length === 0) return anyProblem
    // Positivos no todos presentes: el nivel inferior se demuestra por problemas observados
    if (anyPositiveAbsent(pack, checks) || anyPositiveUnknown(pack, checks)) {
      return anyProblem
    }
  }

  return false
}

function summarizeLists(checks: RequirementCheck[]) {
  const present_requirements: string[] = []
  const absent_requirements: string[] = []
  const not_observable_requirements: string[] = []
  for (const c of checks) {
    if (c.status === "PRESENT") present_requirements.push(c.requirement)
    else if (c.status === "ABSENT") absent_requirements.push(c.requirement)
    else not_observable_requirements.push(c.requirement)
  }
  return { present_requirements, absent_requirements, not_observable_requirements }
}

/**
 * Decisión universal por checklist. No usa impresión global.
 */
export function decideBoundaryLevel(params: {
  packs: LevelRequirementPack[]
  checks: RequirementCheck[]
  /** Si true y no hay checks PRESENT en absoluto → evidencia insuficiente */
  hasAnyStudentEvidence?: boolean
}): BoundaryDecisionResult {
  const { packs, checks } = params
  const lists = summarizeLists(checks)
  const bandCount = packs.length

  if (bandCount === 0) {
    return {
      decision: "INSUFFICIENT_EVIDENCE",
      selected_level: "NO_OBSERVABLE",
      selected_ordinal: null,
      ambiguity_reason: "Sin descriptores/requisitos parseables",
      ...lists,
      justification: "No hay packs de requisitos derivados de la rúbrica.",
    }
  }

  const anyPresent = checks.some((c) => c.status === "PRESENT")
  if (params.hasAnyStudentEvidence === false || (!anyPresent && checks.every((c) => c.status === "NOT_OBSERVABLE"))) {
    return {
      decision: "INSUFFICIENT_EVIDENCE",
      selected_level: "NO_OBSERVABLE",
      selected_ordinal: null,
      ambiguity_reason: "Ningún requisito observable pudo marcarse PRESENT",
      ...lists,
      justification:
        "Evidencia insuficiente o no observable: no se asume ningún requisito presente.",
    }
  }

  // Recorrer de superior → inferior aplicando la regla de frontera adyacente.
  for (let i = 0; i < bandCount; i++) {
    const upper = packs[i]
    const lower = i + 1 < bandCount ? packs[i + 1] : null

    const upperAll = allPositivePresent(upper, checks)
    const upperAbsent = anyPositiveAbsent(upper, checks)
    const upperUnknown = anyPositiveUnknown(upper, checks)

    // Caso: nivel solo caracterizado por problemas (sin positivos)
    if (upper.observable_requirements.length === 0) {
      const dem = lowerLevelDemonstrated(upper, checks)
      if (dem && lower) {
        // Si el superior problemático está demostrado pero el inferior también,
        // y no hay discriminación → ambigüedad; si solo este → elegir este.
        const lowerDem = lowerLevelDemonstrated(lower, checks)
        if (lowerDem && !upperAbsent) {
          return ambiguousBetween(upper, lower, packs, lists, bandCount)
        }
      }
      if (dem) {
        return levelResult(upper, packs, lists, bandCount, "Requisitos/problemas del descriptor demostrados por evidencia.")
      }
      continue
    }

    // 1) Todos los esenciales del superior PRESENT → superior
    //    Salvo que el inferior adyacente también quede demostrado por
    //    condiciones-problema (frontera real) → BOUNDARY_AMBIGUOUS.
    if (upperAll && !upperUnknown) {
      if (lower) {
        const lowerProblems = lower.prohibited_or_absent_conditions ?? []
        const lowerProblemHits = lowerProblems.filter(
          (r) => statusOf(checks, lower.ordinal, r) === "PRESENT",
        )
        const lowerAlsoFits =
          lowerProblemHits.length > 0 &&
          (lower.observable_requirements.length === 0
            ? lowerProblemHits.length >= Math.ceil(lowerProblems.length / 2)
            : lowerLevelDemonstrated(lower, checks))
        if (lowerAlsoFits) {
          return ambiguousBetween(
            upper,
            lower,
            packs,
            lists,
            bandCount,
            "Nivel superior cumplido y nivel inferior también demostrado por evidencia: frontera indistinguible.",
          )
        }
      }
      return levelResult(
        upper,
        packs,
        lists,
        bandCount,
        "Todos los requisitos esenciales del descriptor superior están PRESENT.",
      )
    }

    // 2) Falta al menos un esencial del superior y el inferior se cumple → seguir / elegir inferior
    if (upperAbsent && lower) {
      const lowerOk = lowerLevelDemonstrated(lower, checks)
      if (lowerOk) {
        // Regla: falta esencial superior + inferior cumplido → no empatar; bajar
        continue
      }
      // Superior falló; inferior no demostrado → mirar si ambigüedad con inferior
      if (upperUnknown || partialOverlap(upper, lower, checks)) {
        return ambiguousBetween(upper, lower, packs, lists, bandCount)
      }
      continue
    }

    // 3) Requisito esencial no comprobable → no asumir PRESENT
    if (upperUnknown && !upperAbsent) {
      if (lower && lowerLevelDemonstrated(lower, checks)) {
        // No asumir superior; inferior sí demostrado
        continue
      }
      if (lower) {
        return ambiguousBetween(
          upper,
          lower,
          packs,
          lists,
          bandCount,
          "Requisito esencial del nivel superior NOT_OBSERVABLE; no se asume presente.",
        )
      }
      continue
    }

    // Superior falló parcialmente sin lower claro
    if (upperAbsent && !lower) {
      return levelResult(
        upper,
        packs,
        lists,
        bandCount,
        "Última banda disponible tras fallos en superiores.",
      )
    }
  }

  // Ningún nivel superior quedó limpio: elegir la banda inferior demostrada más alta,
  // o ambigüedad entre las dos últimas candidatas con solapamiento.
  for (let i = 0; i < bandCount - 1; i++) {
    const a = packs[i]
    const b = packs[i + 1]
    if (partialOverlap(a, b, checks) && !allPositivePresent(a, checks)) {
      const aDem =
        allPositivePresent(a, checks) || lowerLevelDemonstrated(a, checks)
      const bDem = lowerLevelDemonstrated(b, checks)
      if ((aDem && bDem) || (!aDem && !bDem && hasMixedSignals(a, b, checks))) {
        return ambiguousBetween(a, b, packs, lists, bandCount)
      }
    }
  }

  // Última banda demostrable
  for (let i = bandCount - 1; i >= 0; i--) {
    if (
      allPositivePresent(packs[i], checks) ||
      lowerLevelDemonstrated(packs[i], checks)
    ) {
      return levelResult(
        packs[i],
        packs,
        lists,
        bandCount,
        "Descriptor cuyos requisitos demostrados coinciden mejor con la evidencia (sin asumir no observados).",
      )
    }
  }

  return {
    decision: "BOUNDARY_AMBIGUOUS",
    selected_level: "BOUNDARY_AMBIGUOUS",
    selected_ordinal: null,
    recommended_level: mapOrdinalToNivel(Math.min(1, bandCount - 1), bandCount),
    alternate_level: mapOrdinalToNivel(Math.min(2, bandCount - 1), bandCount),
    ambiguity_reason:
      "Ningún descriptor quedó unívocamente demostrado; frontera no resoluble sin inventar certeza.",
    ...lists,
    justification:
      "Indistinguible con la evidencia marcada: se declara BOUNDARY_AMBIGUOUS.",
  }
}

function hasMixedSignals(
  a: LevelRequirementPack,
  b: LevelRequirementPack,
  checks: RequirementCheck[],
): boolean {
  const aPos = a.observable_requirements.some(
    (r) => statusOf(checks, a.ordinal, r) === "PRESENT",
  )
  const aAbs = anyPositiveAbsent(a, checks)
  const bProb = (b.prohibited_or_absent_conditions ?? []).some(
    (r) => statusOf(checks, b.ordinal, r) === "PRESENT",
  )
  return (aPos || aAbs) && bProb
}

function partialOverlap(
  a: LevelRequirementPack,
  b: LevelRequirementPack,
  checks: RequirementCheck[],
): boolean {
  const aPartial =
    a.observable_requirements.some(
      (r) => statusOf(checks, a.ordinal, r) === "PRESENT",
    ) && anyPositiveAbsent(a, checks)
  const bPartial = lowerLevelDemonstrated(b, checks)
  return aPartial || bPartial
}

function levelResult(
  pack: LevelRequirementPack,
  allPacks: LevelRequirementPack[],
  lists: ReturnType<typeof summarizeLists>,
  bandCount: number,
  justification: string,
): BoundaryDecisionResult {
  return {
    decision: "LEVEL",
    selected_level: mapOrdinalToNivel(pack.ordinal, bandCount),
    selected_ordinal: pack.ordinal,
    descriptor_selected: pack.descriptor_text,
    ...lists,
    justification,
  }
}

function ambiguousBetween(
  upper: LevelRequirementPack,
  lower: LevelRequirementPack,
  allPacks: LevelRequirementPack[],
  lists: ReturnType<typeof summarizeLists>,
  bandCount: number,
  extraReason?: string,
): BoundaryDecisionResult {
  const recommended = mapOrdinalToNivel(lower.ordinal, bandCount)
  const alternate = mapOrdinalToNivel(upper.ordinal, bandCount)
  return {
    decision: "BOUNDARY_AMBIGUOUS",
    selected_level: "BOUNDARY_AMBIGUOUS",
    selected_ordinal: null,
    recommended_level: recommended,
    alternate_level: alternate,
    recommended_ordinal: lower.ordinal,
    alternate_ordinal: upper.ordinal,
    descriptor_selected: lower.descriptor_text,
    ambiguity_reason:
      extraReason ??
      `Descriptores adyacentes indistinguibles con la evidencia: «${upper.level_label}» vs «${lower.level_label}».`,
    ...lists,
    justification:
      extraReason ??
      "Empate real entre niveles adyacentes: no se elige al azar; BOUNDARY_AMBIGUOUS.",
  }
}

/**
 * Normaliza checks del proveedor: PRESENT sin cita → usa evidencia del criterio
 * si existe; si no, NOT_OBSERVABLE (no asumir presencia sin ancla verificable).
 */
export function sanitizeRequirementChecks(
  checks: RequirementCheck[],
  fallbackEvidence?: string,
): RequirementCheck[] {
  const fb = String(fallbackEvidence ?? "").trim()
  return checks.map((c) => {
    if (c.status === "PRESENT") {
      const quote = String(c.evidence_quote ?? "").trim()
      if (!quote) {
        if (fb.length >= 12) {
          return {
            ...c,
            evidence_quote: fb.slice(0, 280),
            reason: `${c.reason} [evidence_quote desde evidencia del criterio]`,
          }
        }
        return {
          ...c,
          status: "NOT_OBSERVABLE" as const,
          reason: `${c.reason} [sanitized: PRESENT sin evidence_quote → NOT_OBSERVABLE]`,
        }
      }
    }
    return c
  })
}
