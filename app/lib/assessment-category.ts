/**
 * Clasificación plana de pruebas para vínculo UTP y trazabilidad institucional.
 * Reversible: constantes y normalización; no afecta corrección OMR.
 *
 * Legado en JSON existente: SIMCE, PAES, INTERNA → se normalizan al leer/guardar.
 */

export const FLAT_ASSESSMENT_TYPES = ["MENSUAL", "LIBRO", "SEMESTRAL", "ENSAYO_SIMCE", "ENSAYO_PAES"] as const
export type FlatAssessmentType = (typeof FLAT_ASSESSMENT_TYPES)[number]

/** Valores que el PATCH acepta (planos + alias legado que se normalizan al persistir). */
export const PATCH_ASSESSMENT_ALIASES = [
  ...FLAT_ASSESSMENT_TYPES,
  "SIMCE",
  "PAES",
  "INTERNA",
] as const

export function isFlatAssessmentType(s: string): s is FlatAssessmentType {
  return (FLAT_ASSESSMENT_TYPES as readonly string[]).includes(s)
}

/**
 * Convierte valor guardado o legado al tipo plano canónico.
 * INTERNA → MENSUAL (espacio común institucional por defecto).
 */
export function parseAssessmentTypeToFlat(raw: string | null | undefined): FlatAssessmentType | null {
  const a = String(raw ?? "").trim().toUpperCase()
  if (a === "SIMCE" || a === "ENSAYO_SIMCE") return "ENSAYO_SIMCE"
  if (a === "PAES" || a === "ENSAYO_PAES") return "ENSAYO_PAES"
  if (a === "INTERNA") return "MENSUAL"
  if (isFlatAssessmentType(a)) return a
  return null
}

/** Para KPI estilo SIMCE (escala 200–350). */
export function isSimceFamilyFlat(t: FlatAssessmentType): boolean {
  return t === "ENSAYO_SIMCE"
}

/** Para KPI estilo PAES (escala 100–1000). */
export function isPaesFamilyFlat(t: FlatAssessmentType): boolean {
  return t === "ENSAYO_PAES"
}

/** Pruebas del espacio común institucional (ejes/habilidades futuros). */
export function isInstitutionalCommonFlat(t: FlatAssessmentType): boolean {
  return t === "MENSUAL" || t === "LIBRO" || t === "SEMESTRAL"
}

function rankForMerge(t: FlatAssessmentType): number {
  if (t === "ENSAYO_SIMCE") return 4
  if (t === "ENSAYO_PAES") return 3
  return 2
}

/** Si un mismo evaluation_id aparece en varios informes con distinto tipo, gana el de mayor “peso” nacional. */
export function mergeFlatAssessmentType(
  current: FlatAssessmentType | undefined,
  next: FlatAssessmentType,
): FlatAssessmentType {
  if (!current) return next
  return rankForMerge(next) > rankForMerge(current) ? next : current
}

/**
 * Marco de proyección en informes pedagógicos (exclusión cruzada SIMCE/PAES vs prueba propia).
 * Para filas `evaluations` completas, preferir `getInstrumentAnalyticsModeFromEvaluationTags` (alinea con dashboard/direccion).
 */
export type InstrumentAnalyticsMode = "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"

export function getInstrumentAnalyticsModeFromExamType(raw: string | null | undefined): InstrumentAnalyticsMode {
  const flat = parseAssessmentTypeToFlat(raw)
  if (flat === "ENSAYO_SIMCE") return "SIMCE"
  if (flat === "ENSAYO_PAES") return "PAES"
  return "INSTITUTIONAL_OTHER"
}

/**
 * Misma regla que `app/api/dashboard/direccion/route.ts` al armar `evalTypeMap`:
 * fusiona `exam_type` y `assessment_category` con `mergeFlatAssessmentType` (p. ej. vínculo UTP por lote solo rellena categoría).
 */
export function getInstrumentAnalyticsModeFromEvaluationTags(
  examType: string | null | undefined,
  assessmentCategory: string | null | undefined,
): InstrumentAnalyticsMode {
  let current: FlatAssessmentType | undefined
  const flatExam = parseAssessmentTypeToFlat(String(examType ?? ""))
  const flatCat = parseAssessmentTypeToFlat(String(assessmentCategory ?? ""))
  for (const flat of [flatExam, flatCat].filter(Boolean) as FlatAssessmentType[]) {
    current = mergeFlatAssessmentType(current, flat)
  }
  if (current === "ENSAYO_SIMCE") return "SIMCE"
  if (current === "ENSAYO_PAES") return "PAES"
  return "INSTITUTIONAL_OTHER"
}

/**
 * Inferencia desde título/nombre de archivo de prueba base (sin tocar OMR).
 * Prioridad PAES > SIMCE > ENSAYO genérico (→ MENSUAL).
 */
export function inferFlatAssessmentCategoryFromExamLabel(raw: string | null | undefined): FlatAssessmentType | null {
  const u = String(raw ?? "").toUpperCase()
  if (!u.trim()) return null
  if (u.includes("PAES")) return "ENSAYO_PAES"
  if (u.includes("SIMCE")) return "ENSAYO_SIMCE"
  if (u.includes("ENSAYO")) return "MENSUAL"
  return null
}
