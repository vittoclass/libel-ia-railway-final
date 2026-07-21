/**
 * Adaptador: evidencia multimodal → criterios_evaluados oficial.
 * No calcula puntaje ni nota; solo proyecta el shape del motor actual.
 */

import type {
  MultimodalCriterionEvidence,
  MultimodalNivelLogro,
  MultimodalObservationStatus,
  OfficialCriterioEvaluado,
} from "@/app/lib/multimodal/types"

function isNonObservableStatus(status: MultimodalObservationStatus): boolean {
  return (
    status === "NOT_OBSERVABLE" || status === "IMAGE_QUALITY_INSUFFICIENT"
  )
}

/**
 * Invariante obligatoria:
 * - nivel NO_OBSERVABLE ↔ status NOT_OBSERVABLE | IMAGE_QUALITY_INSUFFICIENT
 * - OBSERVED / PARTIALLY_OBSERVED nunca con nivel NO_OBSERVABLE
 * - no convertir NO_OBSERVABLE en INSUFICIENTE / NO_LOGRADO
 */
export function enforceNoObservableStatusInvariant(
  ev: MultimodalCriterionEvidence,
): MultimodalCriterionEvidence {
  let observation_status = ev.observation_status
  let nivel_logro = ev.nivel_logro

  if (isNonObservableStatus(observation_status)) {
    return { ...ev, observation_status, nivel_logro: "NO_OBSERVABLE" }
  }

  // OBSERVED / PARTIALLY_OBSERVED
  if (nivel_logro === "NO_OBSERVABLE") {
    return {
      ...ev,
      observation_status: "NOT_OBSERVABLE",
      nivel_logro: "NO_OBSERVABLE",
    }
  }

  if (!nivel_logro) {
    if (observation_status === "PARTIALLY_OBSERVED") {
      return { ...ev, nivel_logro: "PARCIALMENTE_LOGRADO" }
    }
    // OBSERVED sin nivel: no inventar logro ni emitir NO_OBSERVABLE+OBSERVED.
    return {
      ...ev,
      observation_status: "NOT_OBSERVABLE",
      nivel_logro: "NO_OBSERVABLE",
    }
  }

  return { ...ev, observation_status, nivel_logro }
}

function nivelFromObservation(
  status: MultimodalObservationStatus,
  suggested?: MultimodalNivelLogro,
): MultimodalNivelLogro {
  if (isNonObservableStatus(status)) {
    return "NO_OBSERVABLE"
  }
  // status observado: nunca NO_OBSERVABLE (ya coercido en enforce*).
  if (suggested === "LOGRADO") return "LOGRADO"
  if (suggested === "PARCIALMENTE_LOGRADO") return "PARCIALMENTE_LOGRADO"
  if (suggested === "INSUFICIENTE") return "INSUFICIENTE"
  if (status === "PARTIALLY_OBSERVED") return "PARCIALMENTE_LOGRADO"
  // No default a NO_OBSERVABLE bajo status observado.
  return "PARCIALMENTE_LOGRADO"
}

function buildEvidenciaText(ev: MultimodalCriterionEvidence): string {
  const observed = (ev.observed_content ?? [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
  const interpreted = (ev.interpreted_content ?? [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)

  const parts: string[] = []
  if (observed.length) {
    parts.push(`Observado: ${observed.join("; ")}`)
  }
  if (interpreted.length && ev.inference_used) {
    parts.push(`Interpretado (inferencia): ${interpreted.join("; ")}`)
  }
  if (ev.source_image_ids?.length) {
    parts.push(`Fuentes: ${ev.source_image_ids.join(", ")}`)
  }
  parts.push(`Estado observación: ${ev.observation_status}`)
  parts.push(`Confianza: ${ev.confidence}`)
  return parts.join(" | ")
}

export function adaptMultimodalEvidenceToCriteriosEvaluados(
  evidence: MultimodalCriterionEvidence[],
): OfficialCriterioEvaluado[] {
  return evidence.map((raw) => {
    const ev = enforceNoObservableStatusInvariant(raw)
    const nivel_logro = nivelFromObservation(
      ev.observation_status,
      ev.nivel_logro,
    )
    // Doble cierre: si por cualquier vía el nivel es NO_OBSERVABLE, status coherente.
    const observation_status =
      nivel_logro === "NO_OBSERVABLE" &&
      !isNonObservableStatus(ev.observation_status)
        ? ("NOT_OBSERVABLE" as const)
        : ev.observation_status

    const qualityNote =
      observation_status === "IMAGE_QUALITY_INSUFFICIENT"
        ? " La calidad de imagen impide observar este criterio; no se interpreta como bajo logro artístico."
        : observation_status === "NOT_OBSERVABLE"
          ? " Criterio no observable en la evidencia disponible; distinto de no logrado."
          : ""

    return {
      criterio_id: String(ev.criterion_id || "").trim() || "criterio",
      criterio_label: String(ev.criterion_label || "").trim() || "Criterio",
      nivel_logro,
      evidencia: buildEvidenciaText({ ...ev, observation_status }),
      justificacion: `${String(ev.justification || "").trim()}${qualityNote}`.trim(),
      observation_status,
      confidence: ev.confidence,
      source_image_ids: ev.source_image_ids,
      inference_used: ev.inference_used,
    }
  })
}

/**
 * Inyecta criterios_evaluados en el shape de respuestas_desarrollo oficial
 * sin tocar puntaje (LibelIA lo calculará mecánicamente).
 */
export function projectCriteriosIntoRespuestasDesarrollo(params: {
  itemKey?: string
  criterios_evaluados: OfficialCriterioEvaluado[]
  texto_estudiante?: string
  existing?: Record<string, unknown> | null
}): Record<string, unknown> {
  const key = String(params.itemKey || "P1").trim() || "P1"
  const prev =
    params.existing && typeof params.existing === "object"
      ? { ...(params.existing[key] as Record<string, unknown> | undefined) }
      : {}

  const texto =
    (params.texto_estudiante && params.texto_estudiante.trim()) ||
    (typeof prev.texto_estudiante === "string" ? prev.texto_estudiante : "") ||
    "Evidencia visual observada (multimodal)."

  return {
    ...(params.existing && typeof params.existing === "object"
      ? { ...params.existing }
      : {}),
    [key]: {
      ...prev,
      texto_estudiante: texto,
      cita_estudiante: texto,
      criterios_evaluados: params.criterios_evaluados,
    },
  }
}

/** ¿Los criterios son utilizables por el scoring mecánico? */
export function criteriosEvaluadosAreValid(
  criterios: OfficialCriterioEvaluado[] | null | undefined,
): boolean {
  if (!Array.isArray(criterios) || criterios.length === 0) return false
  return criterios.every(
    (c) =>
      String(c.criterio_id ?? "").trim().length > 0 &&
      String(c.nivel_logro ?? "").trim().length > 0,
  )
}
