/**
 * Prompt multimodal Artes — etapa única estructurada:
 * A. OBSERVACIÓN (sin nivel / sin juicio artístico / sin intención)
 * B. EVALUACIÓN POR CRITERIO (rúbrica real únicamente)
 *
 * A7: N slots explícitos derivados de parseRubricCriteria.
 * La IA COMPLETA esa estructura; no decide la longitud de evidence[].
 */

import { parseRubricCriteria } from "@/app/lib/development-core/parse-rubric-criteria"
import type { ImageQualityDiagnosis } from "@/app/lib/multimodal/image-quality"
import { selectMultimodalVisionViews } from "@/app/lib/multimodal/multimodal-vision-provider"
import type { MultimodalArtsEvaluationInput } from "@/app/lib/multimodal/types"

export type ArtsRubricSlot = {
  criterion_id: string
  criterion_label: string
  order: number
}

export type MultimodalPromptBuildResult = {
  prompt: string
  rubric_parse_status: string
  criterion_labels: string[]
  rubric_usable: boolean
  slot_count: number
}

export type ArtsRepairCompletenessInput = {
  expectedCount: number
  missing: string[]
  duplicates: string[]
  extras: string[]
  ambiguous: string[]
  matched: number
}

function deriveSlots(
  criteria: Array<{ criterion_id: string; criterion_label: string; position: number }>,
): ArtsRubricSlot[] {
  return criteria.map((c, i) => ({
    criterion_id: c.criterion_id,
    criterion_label: c.criterion_label,
    order: c.position || i + 1,
  }))
}

function buildEvidenceJsonExample(
  slots: ArtsRubricSlot[],
  sourceImageIdsJson: string,
): string {
  if (slots.length === 0) return "[]"
  const objs = slots.map(
    (s) => `{
      "criterion_id": ${JSON.stringify(s.criterion_id)},
      "criterion_label": ${JSON.stringify(s.criterion_label)},
      "observed_content": ["hechos observables"],
      "interpreted_content": ["solo si hubo inferencia"],
      "observation_status": "OBSERVED" | "PARTIALLY_OBSERVED" | "NOT_OBSERVABLE" | "IMAGE_QUALITY_INSUFFICIENT",
      "confidence": "LOW" | "MEDIUM" | "HIGH",
      "inference_used": false,
      "source_image_ids": ${sourceImageIdsJson},
      "justification": "por qué ese juicio según la rúbrica y la observación",
      "nivel_logro": "LOGRADO" | "PARCIALMENTE_LOGRADO" | "INSUFICIENTE" | "NO_OBSERVABLE"
    }`,
  )
  return `[\n    ${objs.join(",\n    ")}\n  ]`
}

export function buildMultimodalArtsPrompt(params: {
  input: MultimodalArtsEvaluationInput
  imageQuality: ImageQualityDiagnosis[]
  primaryImageId: string
  secondaryImageIds: string[]
}): MultimodalPromptBuildResult {
  const parsed = parseRubricCriteria(params.input.rubric_text ?? "")
  const rubricUsable =
    parsed.status === "PARSED_EXPLICIT" || parsed.status === "PARSED_HOLISTIC"
  const slots = deriveSlots(parsed.criteria)
  const n = slots.length

  const criteriaBlock =
    parsed.criteria.length > 0
      ? parsed.criteria
          .map(
            (c, i) =>
              `${i + 1}. id=${c.criterion_id} | label=${c.criterion_label}\n${c.rubric_slice}`,
          )
          .join("\n\n")
      : params.input.rubric_text || "(rúbrica sin criterios verificables)"

  const slotBlock =
    n > 0
      ? `SLOTS OBLIGATORIOS (N=${n}). Debes COMPLETAR exactamente estos ${n} slots. No decidas la longitud de evidence[]. Conserva cada criterion_id. No omitas criterios. No agregues criterios nuevos. No combines dos criterios. No dupliques criterios. Evalúa la obra completa. Usa todas las imágenes pertenecientes a ESTE estudiante. Si el desempeño respecto de un criterio es débil o insuficiente, EVALÚALO igualmente. "Poca evidencia de logro" NO significa omitir el criterio.

${slots
  .map(
    (s) =>
      `SLOT ${s.order}: criterion_id=${JSON.stringify(s.criterion_id)} | criterion_label=${JSON.stringify(s.criterion_label)}`,
  )
  .join("\n")}
`
      : ""

  const qualityBlock = params.imageQuality
    .map((q) => {
      const dims = q.width && q.height ? `${q.width}x${q.height}` : "unknown"
      return `- ${q.image_id}: available=${q.available} dims=${dims} blur=${q.blur_score ?? "n/a"} contrast=${q.contrast_score ?? "n/a"} exposure=${q.exposure ?? "n/a"} notes=${(q.notes || []).join(",") || "none"}`
    })
    .join("\n")

  const isMultiview = params.secondaryImageIds.length > 0
  let view1Id: string | null = null
  let view2Id: string | null = null
  if (isMultiview) {
    try {
      const sel = selectMultimodalVisionViews(params.input.images)
      if (sel.views.length >= 2) {
        view1Id = sel.views[0]!.image_id
        view2Id = sel.views[1]!.image_id
      }
    } catch {
      view1Id = null
      view2Id = null
    }
  }

  const imageIds = params.input.images
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((im) => {
      if (isMultiview && view1Id && view2Id) {
        const sent =
          im.image_id === view1Id
            ? ", VIEW_1_SENT_TO_VISION"
            : im.image_id === view2Id
              ? ", VIEW_2_SENT_TO_VISION"
              : ", associated_not_sent_to_vision"
        return `${im.image_id} (order=${im.order}, role=${im.role ?? "UNKNOWN"}${sent})`
      }
      return `${im.image_id} (order=${im.order}, role=${im.role ?? "UNKNOWN"}${im.image_id === params.primaryImageId ? ", PRIMARY_SENT_TO_VISION" : ", metadata_only"})`
    })
    .join(", ")

  const studentText = String(params.input.student_text ?? "").trim()
  const secondaryNote = isMultiview
    ? view1Id && view2Id
      ? `Se envían exactamente dos vistas del mismo trabajo a Vision (VIEW_1=${view1Id}, VIEW_2=${view2Id}). Las fotografías adicionales, si existen, permanecen asociadas al trabajo y no se envían en esta llamada. No interpretes más fotografías como mayor puntaje.`
      : `Imágenes adicionales (solo metadatos/calidad en este mensaje; el proveedor oficial acepta 1 imagen por llamada): ${params.secondaryImageIds.join(", ")}.`
    : ""
  const sourceImageIdsJson =
    isMultiview && view1Id && view2Id
      ? `["${view1Id}", "${view2Id}"]`
      : `["${params.primaryImageId}"]`
  const evidenceExample = buildEvidenceJsonExample(slots, sourceImageIdsJson)
  const multiviewBlock = isMultiview
    ? `REGLAS MULTIVISTA (obligatorias):
- Estas imágenes son distintas vistas del MISMO trabajo físico.
- No cuentes dos veces un elemento porque aparezca en ambas imágenes.
- Utiliza todas las vistas únicamente para aumentar la evidencia observable.
- Una vista puede confirmar, complementar o contradecir evidencia de otra.
- No otorgues mayor nivel de logro por el simple hecho de existir más fotografías.
- No asumas que una imagen diferente es un trabajo diferente.
- Utiliza la vista más clara para resolver discrepancias.
- No concluyas que un contenido no existe solamente porque no sea visible en una vista si otra vista podría contenerlo. Esto no cambia la semántica de NO_OBSERVABLE: si tras integrar las vistas la evidencia necesaria sigue sin poder observarse, usa NO_OBSERVABLE.
`
    : ""

  const prompt = `Eres un evaluador pedagógico multimodal de Artes. Una sola etapa estructurada con dos secciones claras.

REGLAS UNIVERSALES (obligatorias):
1. Usa SOLO los criterios de la rúbrica entregada. NO inventes criterios.
2. La rúbrica del profesor (criterios, descriptores, puntajes máximos) es la fuente pedagógica. Juzga la evidencia contra esos descriptores. DESPUÉS expresa el resultado en nivel_logro usando EXCLUSIVAMENTE el contrato técnico interno: LOGRADO, PARCIALMENTE_LOGRADO, INSUFICIENTE o NO_OBSERVABLE. NO copies al campo nivel_logro un nombre de banda de la rúbrica que no pertenezca a ese contrato. NO inventes equivalencias rígidas entre nombres externos y niveles canónicos. NO ignores los descriptores originales.
3. NO uses pesos fijos universales ni lista fija de composición/color/creatividad salvo que aparezcan en la rúbrica.
4. Separa observación de inferencia. Si inferiste, inference_used=true.
5. NO infieras intención artística sin evidencia observable.
6. NO penalices mala calidad de cámara como bajo logro artístico.
7. Si no puedes observar un criterio: observation_status = NOT_OBSERVABLE o IMAGE_QUALITY_INSUFFICIENT y nivel_logro = NO_OBSERVABLE.
8. Distingue NOT_OBSERVABLE / NO_OBSERVABLE de INSUFICIENTE (no logrado).
9. Puede haber una o varias imágenes del MISMO estudiante/obra. No mezcles alumnos.
10. Preserva provenance: source_image_ids con los image_id usados.
11. NO calcules puntaje, porcentaje ni nota. LibelIA calculará el puntaje mecánicamente.
${multiviewBlock}
CONTEXTO:
- item_key: ${params.input.item_key}
- pregunta/consigna: ${params.input.question_text || "(no especificada)"}
- subject: ${params.input.subject || "(n/a)"}
- context: ${params.input.context || "(n/a)"}
- imágenes: ${imageIds || "(ninguna)"}
- imagen primaria enviada a Vision: ${params.primaryImageId}
- ${secondaryNote || "sin imágenes secundarias"}
- texto del estudiante (si hay): ${studentText || "(sin texto)"}

RÚBRICA (fuente de verdad de criterios y descriptores):
${criteriaBlock}

${slotBlock}
DIAGNÓSTICO DE CALIDAD (informativo; NUNCA bajar nivel por cámara):
${qualityBlock || "(sin diagnóstico)"}

=== A. OBSERVACIÓN ===
Antes de juzgar, lista hechos visuales/textuales VERIFICABLES:
- elementos visibles (formas, colores, texto en la obra, disposición, materiales aparentes);
- SIN asignar nivel_logro;
- SIN juicio artístico de calidad;
- SIN inferir intención del estudiante.
Incluye estos hechos en observed_content de cada criterio de la rúbrica (cada slot).

=== B. EVALUACIÓN POR CRITERIO ===
Para CADA criterio de la rúbrica (y solo esos), EXACTAMENTE un resultado por slot:
- usa el criterion_id y el label reales del slot;
- vincula observaciones de A;
- determina el grado de cumplimiento observable respecto de esos descriptores;
- asigna nivel_logro SOLO con el contrato técnico interno (LOGRADO | PARCIALMENTE_LOGRADO | INSUFICIENTE | NO_OBSERVABLE);
- NO copies el nombre de banda original al campo nivel_logro;
- NO inventes una tabla de equivalencias de nombres;
- si no es observable: observation_status NOT_OBSERVABLE o IMAGE_QUALITY_INSUFFICIENT y nivel_logro NO_OBSERVABLE.

Contrato técnico de nivel_logro (no deformar):
- LOGRADO = evidencia suficiente de cumplimiento del criterio.
- PARCIALMENTE_LOGRADO = evidencia observable de cumplimiento parcial/intermedio.
- INSUFICIENTE = existe evidencia observable, pero el criterio no alcanza el nivel requerido.
- NO_OBSERVABLE = la evidencia necesaria no puede observarse de manera suficiente. NO significa automáticamente trabajo malo. NO lo uses como fallback de una etiqueta desconocida. No generes etiquetas fuera de este contrato.

FORMATO JSON ESTRICTO:
{
  "texto_estudiante": "descripción observable de la evidencia (sin inventar)",
  "observations_summary": ["hechos observables sin juicio"],
  "evidence": ${evidenceExample}
}

${
  n > 0
    ? `Devuelve EXACTAMENTE ${n} elementos en evidence: uno por cada slot, con su criterion_id. No omitas ninguno.`
    : "La rúbrica no tiene criterios claros verificables: si no puedes mapear criterios, devuelve evidence=[] y explica en texto_estudiante. NO inventes criterios."
}`

  return {
    prompt,
    rubric_parse_status: parsed.status,
    criterion_labels: parsed.criteria.map((c) => c.criterion_label),
    rubric_usable: rubricUsable,
    slot_count: n,
  }
}

/**
 * Repair pedagógico informado (1 sola pasada). Misma rúbrica, mismos slots, misma obra.
 * No es resiliencia técnica: solo cobertura N/N incompleta.
 */
export function buildMultimodalArtsRepairPrompt(params: {
  input: MultimodalArtsEvaluationInput
  imageQuality: ImageQualityDiagnosis[]
  primaryImageId: string
  secondaryImageIds: string[]
  completeness: ArtsRepairCompletenessInput
}): MultimodalPromptBuildResult {
  const first = buildMultimodalArtsPrompt({
    input: params.input,
    imageQuality: params.imageQuality,
    primaryImageId: params.primaryImageId,
    secondaryImageIds: params.secondaryImageIds,
  })
  const parsed = parseRubricCriteria(params.input.rubric_text ?? "")
  const expectedIds = parsed.criteria.map((c) => c.criterion_id)
  const n = parsed.criteria.length
  const header = `REPAIR PEDAGÓGICO (una sola pasada; respuesta completa N/N).

La respuesta anterior fue incompleta respecto de la rúbrica.
N esperado = ${n}
IDs esperados: ${expectedIds.join(",") || "(ninguno)"}
Faltaron: ${params.completeness.missing.join(",") || "(ninguno)"}
Duplicados: ${params.completeness.duplicates.join(",") || "(ninguno)"}
Ambiguos: ${params.completeness.ambiguous.join(",") || "(ninguno)"}
Extras (no puntúan; no los incluyas como criterios): ${params.completeness.extras.join(",") || "(ninguno)"}
Emparejados válidos en el primer paso: ${params.completeness.matched}/${n}

Vuelve a observar la MISMA obra completa, con las MISMAS imágenes de ESTE estudiante.
Devuelve una evaluación completa para TODOS los ${n} slots.
Reemplaza la respuesta anterior. No reenvíes un evidence[] truncado.
No omitas un criterio porque el desempeño sea débil o la evidencia de logro sea poca.

`
  return {
    ...first,
    prompt: header + first.prompt,
  }
}
