/**
 * Orquestador multimodal Artes — Camino B, fail-open, sin scoring propio.
 * Happy path: 1 llamada Vision vía requestEvaluationVisionCompletion.
 */

import {
  adaptMultimodalEvidenceToCriteriosEvaluados,
  criteriosEvaluadosAreValid,
  enforceNoObservableStatusInvariant,
  projectCriteriosIntoRespuestasDesarrollo,
} from "@/app/lib/multimodal/adapter-to-criterios"
import {
  diagnoseAllImages,
  qualityBlocksObservation,
} from "@/app/lib/multimodal/image-quality"
import { shouldRunMultimodalArtsPath } from "@/app/lib/multimodal/flag"
import { buildMultimodalArtsPrompt } from "@/app/lib/multimodal/multimodal-prompt"
import {
  requestMultimodalArtsVision,
  selectPrimaryMultimodalImage,
} from "@/app/lib/multimodal/multimodal-vision-provider"
import type {
  MultimodalArtsEvaluationInput,
  MultimodalArtsEvaluationResult,
  MultimodalCriterionEvidence,
  MultimodalNivelLogro,
  MultimodalObservationStatus,
} from "@/app/lib/multimodal/types"

function failResult(
  reason: string,
  diagnostics: string[] = [],
  extras?: Partial<MultimodalArtsEvaluationResult>,
): MultimodalArtsEvaluationResult {
  return {
    ok: false,
    criterios_evaluados: [],
    diagnostics: [reason, ...diagnostics],
    fallback_recommended: true,
    ...extras,
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x ?? "").trim()).filter(Boolean)
}

function normalizeObservationStatus(raw: unknown): MultimodalObservationStatus {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
  if (s === "OBSERVED") return "OBSERVED"
  if (s === "PARTIALLY_OBSERVED" || s === "PARTIAL") return "PARTIALLY_OBSERVED"
  if (s === "IMAGE_QUALITY_INSUFFICIENT" || s === "QUALITY_INSUFFICIENT") {
    return "IMAGE_QUALITY_INSUFFICIENT"
  }
  return "NOT_OBSERVABLE"
}

function normalizeNivel(raw: unknown): MultimodalNivelLogro | undefined {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  if (s === "LOGRADO") return "LOGRADO"
  if (s === "PARCIALMENTE_LOGRADO" || s === "PARCIAL") return "PARCIALMENTE_LOGRADO"
  if (s === "INSUFICIENTE" || s === "NO_LOGRADO") return "INSUFICIENTE"
  if (s === "NO_OBSERVABLE") return "NO_OBSERVABLE"
  return undefined
}

function parseEvidenceList(raw: unknown): MultimodalCriterionEvidence[] {
  if (!Array.isArray(raw)) return []
  const out: MultimodalCriterionEvidence[] = []
  for (const row of raw) {
    if (!row || typeof row !== "object") continue
    const o = row as Record<string, unknown>
    const observation_status = normalizeObservationStatus(o.observation_status)
    let nivel_logro = normalizeNivel(o.nivel_logro)
    if (
      observation_status === "NOT_OBSERVABLE" ||
      observation_status === "IMAGE_QUALITY_INSUFFICIENT"
    ) {
      nivel_logro = "NO_OBSERVABLE"
    }
    const confidence_raw = String(o.confidence ?? "MEDIUM")
      .trim()
      .toUpperCase()
    const confidence =
      confidence_raw === "LOW" || confidence_raw === "HIGH"
        ? confidence_raw
        : "MEDIUM"

    out.push(
      enforceNoObservableStatusInvariant({
        criterion_id: String(o.criterion_id ?? "").trim() || "criterio",
        criterion_label: String(o.criterion_label ?? "").trim() || "Criterio",
        observed_content: asStringArray(o.observed_content),
        interpreted_content: asStringArray(o.interpreted_content),
        observation_status,
        confidence,
        inference_used: Boolean(o.inference_used),
        source_image_ids: asStringArray(o.source_image_ids),
        justification: String(o.justification ?? "").trim(),
        nivel_logro,
      }),
    )
  }
  return out
}

function extractJsonObject(content: string): Record<string, unknown> | null {
  const s = String(content ?? "").trim()
  if (!s) return null
  try {
    const parsed = JSON.parse(s)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // try embedded
  }
  const start = s.indexOf("{")
  const end = s.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(s.slice(start, end + 1))
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

export type RunMultimodalArtsEvaluationParams = {
  input: MultimodalArtsEvaluationInput
  areaConocimiento?: string | null
  tipoPruebaReal?: string | null
  allowOmr?: boolean | null
  /** Override de flag (tests). */
  enabled?: boolean
}

/**
 * Ejecuta evidencia multimodal y adapta a criterios_evaluados.
 * Si falla: ok=false, fallback_recommended=true → caller usa camino oficial.
 */
export async function runMultimodalArtsEvaluation(
  params: RunMultimodalArtsEvaluationParams,
): Promise<MultimodalArtsEvaluationResult> {
  const itemKey = String(params.input.item_key || "P1").trim() || "P1"
  const diagnostics: string[] = []

  if (
    !shouldRunMultimodalArtsPath({
      enabled: params.enabled,
      areaConocimiento: params.areaConocimiento,
      tipoPruebaReal: params.tipoPruebaReal,
      allowOmr: params.allowOmr,
    })
  ) {
    return failResult("multimodal_flag_or_gate_off", diagnostics)
  }

  const images = Array.isArray(params.input.images) ? params.input.images : []
  if (!images.length) {
    return failResult("no_images", diagnostics)
  }

  let imageQuality
  try {
    imageQuality = await diagnoseAllImages(images)
    for (const q of imageQuality) {
      if (q.notes.length) {
        diagnostics.push(`quality:${q.image_id}:${q.notes.join(",")}`)
      }
    }
  } catch (e) {
    console.warn("[multimodal-arts] image quality diagnosis failed (fail-open)", e)
    return failResult("image_quality_diagnosis_failed", diagnostics)
  }

  const allBlocked =
    imageQuality.length > 0 &&
    imageQuality.every((q) => qualityBlocksObservation(q))
  if (allBlocked) {
    diagnostics.push("all_images_quality_insufficient")
    // Fail-open: no inventar criterios; camino oficial anterior.
    return failResult("all_images_quality_insufficient", diagnostics)
  }

  let primaryImageId: string
  let secondaryImageIds: string[]
  try {
    const sel = selectPrimaryMultimodalImage(images)
    primaryImageId = sel.primary.image_id
    secondaryImageIds = sel.secondary.map((s) => s.image_id)
    if (secondaryImageIds.length) {
      diagnostics.push(
        `secondary_images_metadata_only:${secondaryImageIds.join(",")}`,
      )
    }
  } catch {
    return failResult("multimodal_vision_no_images", diagnostics)
  }

  const promptBuild = buildMultimodalArtsPrompt({
    input: params.input,
    imageQuality,
    primaryImageId,
    secondaryImageIds,
  })
  diagnostics.push(`rubric_parse:${promptBuild.rubric_parse_status}`)

  if (!promptBuild.rubric_usable && promptBuild.criterion_labels.length === 0) {
    return failResult("rubric_criteria_not_verifiable", diagnostics)
  }

  try {
    const vision = await requestMultimodalArtsVision({
      images,
      prompt: promptBuild.prompt,
      maxTokens: 4096,
      temperature: 0.1,
    })
    diagnostics.push(`vision_calls:${vision.vision_calls}`)
    diagnostics.push(`provider:${vision.provider_used}`)
    diagnostics.push(`primary_image:${vision.primary_image_id}`)

    const parsed = extractJsonObject(vision.content)
    if (!parsed) {
      return failResult("multimodal_json_parse_failed", diagnostics, {
        provider_used: vision.provider_used,
        primary_image_id: vision.primary_image_id,
      })
    }

    let evidence = parseEvidenceList(parsed.evidence)
    const blockedIds = new Set(
      imageQuality.filter(qualityBlocksObservation).map((q) => q.image_id),
    )
    evidence = evidence.map((ev) => {
      const onlyBlocked =
        ev.source_image_ids.length > 0 &&
        ev.source_image_ids.every((id) => blockedIds.has(id))
      if (
        onlyBlocked ||
        (blockedIds.size === images.length &&
          qualityBlocksObservation(imageQuality[0]!))
      ) {
        return enforceNoObservableStatusInvariant({
          ...ev,
          observation_status: "IMAGE_QUALITY_INSUFFICIENT" as const,
          nivel_logro: "NO_OBSERVABLE" as const,
          justification:
            ev.justification ||
            "Calidad de imagen insuficiente para observar el criterio; no se interpreta como bajo logro.",
        })
      }
      return enforceNoObservableStatusInvariant(ev)
    })

    if (!evidence.length) {
      return failResult("multimodal_empty_evidence", diagnostics, {
        provider_used: vision.provider_used,
        primary_image_id: vision.primary_image_id,
      })
    }

    const criterios_evaluados =
      adaptMultimodalEvidenceToCriteriosEvaluados(evidence)
    if (!criteriosEvaluadosAreValid(criterios_evaluados)) {
      return failResult("multimodal_invalid_criterios", diagnostics, {
        provider_used: vision.provider_used,
        primary_image_id: vision.primary_image_id,
      })
    }

    const texto_estudiante =
      typeof parsed.texto_estudiante === "string"
        ? parsed.texto_estudiante.trim()
        : evidence
            .flatMap((e) => e.observed_content)
            .filter(Boolean)
            .join(" ")
            .slice(0, 2000)

    return {
      ok: true,
      criterios_evaluados,
      diagnostics,
      provider_used: vision.provider_used,
      fallback_recommended: false,
      texto_estudiante: texto_estudiante || undefined,
      primary_image_id: vision.primary_image_id,
    }
  } catch (e) {
    console.warn("[multimodal-arts] evaluation failed (fail-open)", e)
    return failResult(
      `multimodal_provider_failed:${e instanceof Error ? e.message : "unknown"}`,
      diagnostics,
    )
  }
}

/**
 * Helper de wiring: si ok, proyecta a respuestas_desarrollo; si fail-open, existing.
 */
export function mergeMultimodalIntoRespuestasDesarrollo(params: {
  multimodal: MultimodalArtsEvaluationResult
  itemKey?: string
  existing?: Record<string, unknown> | null
}): {
  respuestasDesarrollo: Record<string, unknown>
  usedMultimodal: boolean
} {
  if (
    !params.multimodal.ok ||
    !criteriosEvaluadosAreValid(params.multimodal.criterios_evaluados)
  ) {
    return {
      respuestasDesarrollo:
        params.existing && typeof params.existing === "object"
          ? { ...params.existing }
          : {},
      usedMultimodal: false,
    }
  }
  return {
    respuestasDesarrollo: projectCriteriosIntoRespuestasDesarrollo({
      itemKey: params.itemKey || "P1",
      criterios_evaluados: params.multimodal.criterios_evaluados,
      texto_estudiante: params.multimodal.texto_estudiante,
      existing: params.existing,
    }),
    usedMultimodal: true,
  }
}
