/**
 * Selftest focalizado — capa multimodal Artes.
 * Uso: npx tsx scripts/multimodal-arts-selftest.ts
 */

import {
  isMultimodalArtsEvaluationEnabled,
  shouldRunMultimodalArtsPath,
} from "../app/lib/multimodal/flag"
import {
  adaptMultimodalEvidenceToCriteriosEvaluados,
  criteriosEvaluadosAreValid,
  projectCriteriosIntoRespuestasDesarrollo,
} from "../app/lib/multimodal/adapter-to-criterios"
import { buildMultimodalArtsPrompt } from "../app/lib/multimodal/multimodal-prompt"
import { selectPrimaryMultimodalImage } from "../app/lib/multimodal/multimodal-vision-provider"
import type { MultimodalCriterionEvidence } from "../app/lib/multimodal/types"

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

function section(title: string) {
  console.log(`\n=== ${title} ===`)
}

async function main() {
  section("flag default OFF")
  const prev = process.env.MULTIMODAL_ARTS_EVALUATION_ENABLED
  delete process.env.MULTIMODAL_ARTS_EVALUATION_ENABLED
  assert(isMultimodalArtsEvaluationEnabled() === false, "flag must default false")
  assert(
    shouldRunMultimodalArtsPath({
      areaConocimiento: "artes",
      tipoPruebaReal: "solo_desarrollo",
      allowOmr: false,
    }) === false,
    "gate must be false when flag off",
  )

  process.env.MULTIMODAL_ARTS_EVALUATION_ENABLED = "true"
  assert(isMultimodalArtsEvaluationEnabled() === true, "flag true")
  assert(
    shouldRunMultimodalArtsPath({
      enabled: true,
      areaConocimiento: "artes",
      tipoPruebaReal: "solo_desarrollo",
      allowOmr: false,
    }) === true,
    "artes solo_desarrollo allowOmr=false must pass",
  )
  assert(
    shouldRunMultimodalArtsPath({
      enabled: true,
      areaConocimiento: "Artes",
      tipoPruebaReal: "solo_desarrollo",
      allowOmr: false,
    }) === true,
    "area normalized case-insensitive",
  )
  assert(
    shouldRunMultimodalArtsPath({
      enabled: true,
      areaConocimiento: "matematica",
      tipoPruebaReal: "solo_desarrollo",
      allowOmr: false,
    }) === false,
    "non-artes must isolate",
  )
  assert(
    shouldRunMultimodalArtsPath({
      enabled: true,
      areaConocimiento: "artes",
      tipoPruebaReal: "mixta",
      allowOmr: false,
    }) === false,
    "mixta must isolate",
  )
  assert(
    shouldRunMultimodalArtsPath({
      enabled: true,
      areaConocimiento: "artes",
      tipoPruebaReal: "solo_alternativas",
      allowOmr: false,
    }) === false,
    "solo_alternativas must isolate",
  )
  assert(
    shouldRunMultimodalArtsPath({
      enabled: true,
      areaConocimiento: "artes",
      tipoPruebaReal: "solo_desarrollo",
      allowOmr: true,
    }) === false,
    "allowOmr true must isolate",
  )
  console.log("ok")

  section("adapter: quality != bajo logro")
  const evidence: MultimodalCriterionEvidence[] = [
    {
      criterion_id: "c1",
      criterion_label: "Composición (de la rúbrica)",
      observed_content: [],
      observation_status: "IMAGE_QUALITY_INSUFFICIENT",
      confidence: "LOW",
      inference_used: false,
      source_image_ids: ["img_1"],
      justification: "Imagen borrosa",
      nivel_logro: "INSUFICIENTE",
    },
    {
      criterion_id: "c2",
      criterion_label: "Criterio observable",
      observed_content: ["figura central visible"],
      observation_status: "OBSERVED",
      confidence: "HIGH",
      inference_used: false,
      source_image_ids: ["img_1"],
      justification: "Coincide con descriptor Logrado",
      nivel_logro: "LOGRADO",
    },
    {
      criterion_id: "c3",
      criterion_label: "No visible",
      observed_content: [],
      observation_status: "NOT_OBSERVABLE",
      confidence: "LOW",
      inference_used: false,
      source_image_ids: ["img_1"],
      justification: "No aparece en la imagen",
      nivel_logro: "INSUFICIENTE",
    },
  ]
  const criterios = adaptMultimodalEvidenceToCriteriosEvaluados(evidence)
  assert(criterios[0]!.nivel_logro === "NO_OBSERVABLE", "quality → NO_OBSERVABLE")
  assert(criterios[1]!.nivel_logro === "LOGRADO", "observed logrado preserved")
  assert(criterios[2]!.nivel_logro === "NO_OBSERVABLE", "NOT_OBSERVABLE ≠ INSUFICIENTE")
  assert(
    criterios[0]!.justificacion.includes("no se interpreta como bajo logro"),
    "quality note present",
  )
  assert(criteriosEvaluadosAreValid(criterios), "criterios valid")
  console.log("ok", criterios.map((c) => c.nivel_logro))

  section("DEFECTO B: NO_OBSERVABLE coherente con observation_status")
  const badCombo = adaptMultimodalEvidenceToCriteriosEvaluados([
    {
      criterion_id: "x",
      criterion_label: "X",
      observed_content: [],
      observation_status: "OBSERVED",
      confidence: "LOW",
      inference_used: false,
      source_image_ids: ["img_1"],
      justification: "modelo inconsistente",
      nivel_logro: "NO_OBSERVABLE",
    },
  ])
  assert(badCombo[0]!.nivel_logro === "NO_OBSERVABLE", "nivel preserved as NO_OBSERVABLE")
  assert(
    badCombo[0]!.observation_status === "NOT_OBSERVABLE" ||
      badCombo[0]!.observation_status === "IMAGE_QUALITY_INSUFFICIENT",
    "status coerced away from OBSERVED",
  )
  assert(
    String(badCombo[0]!.nivel_logro) !== "INSUFICIENTE",
    "no convert to NO_LOGRADO",
  )
  console.log("ok", badCombo[0]!.observation_status, badCombo[0]!.nivel_logro)

  section("DEFECTO A: parser analítico no colapsa; holístico sigue 1")
  const { parseRubricCriteria } = await import(
    "../app/lib/development-core/parse-rubric-criteria"
  )
  const analytic = parseRubricCriteria(`1. Claridad del mensaje
Logrado (2 pts): mensaje claro y legible.
Por Lograr (0 pts): no se entiende.
2. Composición visual
Logrado (2 pts): equilibrada.
Por Lograr (0 pts): desordenada.
3. Uso del color
Logrado (2 pts): intencional.
Por Lograr (0 pts): arbitrario.`)
  assert(analytic.status === "PARSED_EXPLICIT", "analytic explicit")
  assert(analytic.criteria.length === 3, "three analytic criteria")
  assert(
    analytic.criteria.map((c) => c.criterion_label).join("|") ===
      "Claridad del mensaje|Composición visual|Uso del color",
    "labels preserved",
  )
  assert(
    !analytic.criteria.some((c) => c.criterion_label === "holistic_item"),
    "no holistic collapse",
  )

  const holistic = parseRubricCriteria(
    `Logrado (2 pts): obra completa y coherente. Medianamente Logrado (1 pts): parcialmente resuelta. Por Lograr (0 pts): sin evidencia suficiente.`,
  )
  assert(holistic.status === "PARSED_HOLISTIC", "truly holistic")
  assert(holistic.criteria.length === 1, "one holistic criterion")
  console.log("ok analytic", analytic.criteria.length, "holistic", holistic.criteria.length)

  section("project into respuestas_desarrollo shape")
  const projected = projectCriteriosIntoRespuestasDesarrollo({
    itemKey: "P1",
    criterios_evaluados: criterios,
    texto_estudiante: "Obra visual observada",
  })
  const p1 = projected.P1 as Record<string, unknown>
  assert(Array.isArray(p1.criterios_evaluados), "criterios_evaluados present")
  assert(p1.texto_estudiante === "Obra visual observada", "texto preserved")
  console.log("ok keys", Object.keys(projected))

  section("fail-open projection")
  const existing = { P1: { texto_estudiante: "camino actual", puntaje: "5/10" } }
  const usedMultimodal = false
  const respuestasDesarrollo = usedMultimodal
    ? projectCriteriosIntoRespuestasDesarrollo({
        itemKey: "P1",
        criterios_evaluados: criterios,
        texto_estudiante: "nuevo",
        existing,
      })
    : { ...existing }
  assert(
    (respuestasDesarrollo.P1 as Record<string, unknown>).texto_estudiante ===
      "camino actual",
    "existing path preserved",
  )
  console.log("ok")

  section("prompt: A observación + B evaluación + rubric-first")
  const prompt = buildMultimodalArtsPrompt({
    input: {
      item_key: "P1",
      question_text: "Crea un afiche",
      rubric_text:
        "1\tClaridad del mensaje\tLogrado (2 pts): mensaje claro\tPor Lograr (0 pts): no se entiende",
      images: [
        {
          image_id: "img_1",
          order: 1,
          base64: "data:image/jpeg;base64,/9j/4AAQ",
          role: "FINAL",
        },
      ],
    },
    imageQuality: [
      {
        image_id: "img_1",
        available: true,
        notes: [],
      },
    ],
    primaryImageId: "img_1",
    secondaryImageIds: [],
  })
  assert(prompt.prompt.includes("Claridad"), "rubric label in prompt")
  assert(prompt.prompt.includes("=== A. OBSERVACIÓN ==="), "section A")
  assert(prompt.prompt.includes("=== B. EVALUACIÓN POR CRITERIO ==="), "section B")
  assert(
    prompt.prompt.includes("NO uses pesos fijos universales"),
    "no fixed weights",
  )
  console.log("ok status", prompt.rubric_parse_status)

  section("primary image selection (FINAL preferred)")
  const sel = selectPrimaryMultimodalImage([
    { image_id: "process", order: 0, base64: "aaa", role: "PROCESS" },
    { image_id: "final", order: 1, base64: "bbb", role: "FINAL" },
  ])
  assert(sel.primary.image_id === "final", "FINAL is primary")
  assert(sel.secondary.length === 1, "one secondary")
  console.log("ok primary", sel.primary.image_id)

  if (prev === undefined) delete process.env.MULTIMODAL_ARTS_EVALUATION_ENABLED
  else process.env.MULTIMODAL_ARTS_EVALUATION_ENABLED = prev

  console.log("\nALL MULTIMODAL SELFTESTS PASSED")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
