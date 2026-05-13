/**
 * RESPUESTAS_FINALES_ESTUDIANTE — selección de fuente para evaluación (regla de oro).
 *
 * Aísla la fusión de respuestas consolidadas (post-OMR/OCR, correcciones y edición)
 * sobre el estado ya alineado a inventario/pauta. No invoca OMR, OCR ni modelos.
 */
import { normalizeToCanonicalId } from "@/app/lib/canonical-closed-id"

/** Identificador de documentación: la evaluación debe basarse en este estado consolidado cuando se envía en el body. */
export const RESPUESTAS_FINALES_ESTUDIANTE = "respuestas_finales_consolidadas" as const

export type CerradaRowForFinalEvaluation = {
  pregunta: string
  respuesta_detectada: string
  confianza?: number
  _omr_legacy_read?: boolean
}

function sortCerradasByCanonicalOrder(rows: CerradaRowForFinalEvaluation[]): CerradaRowForFinalEvaluation[] {
  return [...rows].sort((a, b) => {
    const ca = normalizeToCanonicalId(String(a.pregunta ?? ""))
    const cb = normalizeToCanonicalId(String(b.pregunta ?? ""))
    const na = ca ? parseInt(ca.slice(1), 10) : Number.MAX_SAFE_INTEGER
    const nb = cb ? parseInt(cb.slice(1), 10) : Number.MAX_SAFE_INTEGER
    if (na !== nb) return na - nb
    return String(a.pregunta ?? "").localeCompare(String(b.pregunta ?? ""))
  })
}

/**
 * Prioriza `alternativas_corregidas` / `respuestasAlternativas` del body como respuesta final
 * del estudiante por ítem cerrado (sobre lectura OMR ya mapeada).
 */
export function applyConsolidatedStudentClosedAnswers(
  cerradas: CerradaRowForFinalEvaluation[],
  alternativasCorregidas: unknown[] | null | undefined,
): { cerradas: CerradaRowForFinalEvaluation[]; applied: boolean } {
  if (!Array.isArray(alternativasCorregidas) || alternativasCorregidas.length === 0) {
    return { cerradas, applied: false }
  }

  const byCanon = new Map<string, string>()
  for (let idx = 0; idx < alternativasCorregidas.length; idx++) {
    const r = alternativasCorregidas[idx] as Record<string, unknown>
    const preguntaSrc = String(r?.pregunta ?? "").trim()
    if (!preguntaSrc) continue
    const preguntaId = preguntaSrc || `Q${idx + 1}`
    const mapKey = normalizeToCanonicalId(preguntaId) ?? preguntaId.toUpperCase()
    const raw = (r?.respuesta_estudiante ?? r?.respuesta ?? "").toString().trim()
    const upper = raw.toUpperCase()
    byCanon.set(mapKey, upper === "" ? "SIN_RESPUESTA" : upper)
  }

  if (byCanon.size === 0) {
    return { cerradas, applied: false }
  }

  let applied = false
  const out: CerradaRowForFinalEvaluation[] = cerradas.map((row) => {
    const canon =
      normalizeToCanonicalId(String(row.pregunta ?? "")) ?? String(row.pregunta ?? "").trim().toUpperCase()
    if (!byCanon.has(canon)) return row
    applied = true
    return {
      ...row,
      respuesta_detectada: byCanon.get(canon) ?? row.respuesta_detectada,
      confianza: 1,
      _omr_legacy_read: false,
    }
  })

  const existing = new Set(
    out.map(
      (row) =>
        normalizeToCanonicalId(String(row.pregunta ?? "")) ?? String(row.pregunta ?? "").trim().toUpperCase(),
    ),
  )

  for (const [canon, answer] of byCanon) {
    if (existing.has(canon)) continue
    existing.add(canon)
    out.push({
      pregunta: canon,
      respuesta_detectada: answer,
      confianza: 1,
      _omr_legacy_read: false,
    })
    applied = true
  }

  return { cerradas: sortCerradasByCanonicalOrder(out), applied }
}

/**
 * Fusiona texto/puntaje/justificación consolidados (p. ej. tabla de desarrollo editada)
 * sobre el detalle proveniente del pipeline de evaluación.
 */
export function mergeConsolidatedDesarrolloFinales(
  base: Record<string, unknown>,
  fines: unknown,
): { merged: Record<string, unknown>; applied: boolean } {
  if (!fines || typeof fines !== "object" || Array.isArray(fines)) {
    return { merged: base, applied: false }
  }
  let applied = false
  const merged: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(fines as Record<string, unknown>)) {
    if (v == null || typeof v !== "object" || Array.isArray(v)) continue
    const prev = merged[k]
    const prevObj = (prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {}) as Record<string, unknown>
    merged[k] = { ...prevObj, ...(v as Record<string, unknown>) }
    applied = true
  }
  return { merged, applied }
}
