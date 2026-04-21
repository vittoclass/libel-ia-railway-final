/**
 * Segmentación institucional por asignatura + familia de instrumento (solo lectura / filtros).
 * Reutiliza getInstrumentAnalyticsModeFromEvaluationTags; no toca persistencia ni OMR.
 */
import {
  getInstrumentAnalyticsModeFromEvaluationTags,
  type InstrumentAnalyticsMode,
} from "@/app/lib/assessment-category"

export type EvalTagRow = {
  id: string
  subject?: string | null
  exam_type?: string | null
  assessment_category?: string | null
}

export function normalizeSubjectKey(v: unknown): string {
  const s = String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  return s || "sin_asignatura"
}

export function parseInstrumentFamilyQueryParam(raw: string | null | undefined): InstrumentAnalyticsMode | null {
  const u = String(raw ?? "").trim().toUpperCase()
  if (u === "SIMCE") return "SIMCE"
  if (u === "PAES") return "PAES"
  if (u === "INSTITUTIONAL_OTHER" || u === "INTERNAS" || u === "INTERNA") return "INSTITUTIONAL_OTHER"
  return null
}

export function instrumentFamilyForEval(e: EvalTagRow): InstrumentAnalyticsMode {
  return getInstrumentAnalyticsModeFromEvaluationTags(e.exam_type, e.assessment_category)
}

export type SegmentBucket = {
  subject_key: string
  subject_display: string
  instrument_family: InstrumentAnalyticsMode
  evaluation_count: number
  evaluation_ids: string[]
}

export function buildSegmentBuckets(evals: EvalTagRow[]): SegmentBucket[] {
  const map = new Map<string, SegmentBucket>()
  for (const e of evals) {
    const fam = instrumentFamilyForEval(e)
    const disp = String(e.subject ?? "").trim() || "Sin asignatura"
    const sk = normalizeSubjectKey(e.subject)
    const key = `${sk}\0${fam}`
    const cur = map.get(key)
    if (!cur) {
      map.set(key, {
        subject_key: sk,
        subject_display: disp,
        instrument_family: fam,
        evaluation_count: 1,
        evaluation_ids: [e.id],
      })
    } else {
      cur.evaluation_count += 1
      cur.evaluation_ids.push(e.id)
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      a.subject_display.localeCompare(b.subject_display, "es") ||
      a.instrument_family.localeCompare(b.instrument_family),
  )
}

export type ResolvedInstitutionalScope =
  | { mode: "segmentation_only" }
  | { mode: "full"; subject_key: string; family: InstrumentAnalyticsMode; auto_selected: boolean }

/**
 * Si hay subject + familia explícitos → resumen completo filtrado.
 * Si hay un solo segmento en el curso → auto-selección (compatibilidad ZIP / cursos simples).
 * Si hay varios segmentos pero un único bloque SIMCE o PAES (p. ej. PAES real + varias internas) →
 * auto-selección de ese bloque nacional sin mezclar con INSTITUTIONAL_OTHER cuando
 * `autoSelectSingleNationalAmongMixed` está activo (vistas institucionales).
 */
export function resolveInstitutionalScope(params: {
  segments: SegmentBucket[]
  subjectParam: string
  familyParam: InstrumentAnalyticsMode | null
  autoSelectSingleNationalAmongMixed?: boolean
}): ResolvedInstitutionalScope {
  const subjTrim = params.subjectParam.trim()
  if (subjTrim && params.familyParam) {
    return {
      mode: "full",
      subject_key: normalizeSubjectKey(subjTrim),
      family: params.familyParam,
      auto_selected: false,
    }
  }
  if (params.segments.length === 1) {
    const s = params.segments[0]
    return {
      mode: "full",
      subject_key: s.subject_key,
      family: s.instrument_family,
      auto_selected: true,
    }
  }
  if (params.autoSelectSingleNationalAmongMixed) {
    const nationalSegments = params.segments.filter(
      (s) => s.instrument_family === "SIMCE" || s.instrument_family === "PAES",
    )
    if (nationalSegments.length === 1) {
      const s = nationalSegments[0]
      return {
        mode: "full",
        subject_key: s.subject_key,
        family: s.instrument_family,
        auto_selected: true,
      }
    }
  }
  return { mode: "segmentation_only" }
}

export function evalMatchesSubjectAndFamily(e: EvalTagRow, subject_key: string, family: InstrumentAnalyticsMode): boolean {
  const sk = normalizeSubjectKey(e.subject)
  return sk === subject_key && instrumentFamilyForEval(e) === family
}
