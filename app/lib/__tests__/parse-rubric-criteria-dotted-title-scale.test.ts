/**
 * ARTS-A12 — Parser dotted-title-scale (Título. Excelente (N pts):).
 * OFFLINE. Sin IA real, sin créditos, sin Supabase/Redis/Railway.
 * No modifica A7/A5/scoring. Inyecta rúbrica real N=5 sobre APIs existentes.
 *
 * Ejecutar: npx tsx app/lib/__tests__/parse-rubric-criteria-dotted-title-scale.test.ts
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DEFAULT_EVALUATION_PROVIDER_TRACE } from "../ai-evaluation-provider"
import { calculateMechanicalDevelopmentScore } from "../desarrollo-pipeline"
import { parseRubricCriteria } from "../development-core/parse-rubric-criteria"
import {
  assessArtsRubricCompleteness,
  runMultimodalArtsEvaluation,
} from "../multimodal/evaluate-multimodal-arts"
import { buildMultimodalArtsPrompt } from "../multimodal/multimodal-prompt"
import type { MultimodalArtsImageInput } from "../multimodal/types"
import type { MultimodalVisionRequestResult } from "../multimodal/multimodal-vision-provider"
import type { RunMultimodalArtsEvaluationParams } from "../multimodal/evaluate-multimodal-arts"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = path.resolve(__dirname, "../../..")

const GOLDEN_ITEMS = [
  {
    item_number: 1,
    rubric_text:
      "Expresión Concepto / Simbolismo. Excelente (4 pts): Comunica un mensaje o concepto profundo y evidente. El uso de símbolos/metáforas impacta visualmente. Bueno (3 pts): Expresa un concepto claro con elementos simbólicos comprensibles y coherentes. Suficiente (2 pts): El concepto es incipiente o básico; la intención narrativa o simbólica no queda del todo clara. Por Mejorar (1 pt): Carece de un concepto o mensaje claro. La obra se percibe desconectada o puramente aleatoria.",
  },
  {
    item_number: 2,
    rubric_text:
      "Dominio Técnico y Textura. Excelente (4 pts): Manejo sobresaliente de la técnica elegida. Gran variedad de tramas, achurados, valores tonales o texturas. Bueno (3 pts): Buen dominio técnico. Logra variaciones en los trazos y texturas que aportan al volumen general. Suficiente (2 pts): Manejo técnico elemental. Poca variedad de trazos, valores tonales o texturas de relleno. Por Mejorar (1 pt): Técnica deficiente, descuido en el trazo o falta absoluta de desarrollo de textura y sombras.",
  },
  {
    item_number: 3,
    rubric_text:
      "Composición y Espacio. Excelente (4 pts): Uso equilibrado y dinámico del soporte. Excelente manejo del encuadre, proporciones y puntos focales. Bueno (3 pts): Aprovecha adecuadamente el soporte con una composición clara y buen equilibrio visual. Suficiente (2 pts): Composición algo descompensada o uso vacilante del espacio disponible en la lámina. Por Mejorar (1 pt): Sin estructura compositiva; elementos desproporcionados o con distribución inadecuada.",
  },
  {
    item_number: 4,
    rubric_text:
      "Creatividad y Originalidad. Excelente (4 pts): Propuesta sumamente innovadora. Riesgo creativo distintivo y voz artística propia. Bueno (3 pts): Muestra originalidad en la solución visual y la propuesta estética general. Suficiente (2 pts): Propuesta convencional o con recurrencia a clichés estéticos sin reinterpretación. Por Mejorar (1 pt): Copia directa o falta evidente de iniciativa e interés creativo en el trabajo.",
  },
  {
    item_number: 5,
    rubric_text:
      "Presentación y Limpieza. Excelente (4 pts): Impecable estado del soporte (sin arrugas ni manchas ajenas). Acabado profesional y cuidado. Bueno (3 pts): Buena presentación general, con mínimos detalles marginales de suciedad o pliegues. Suficiente (2 pts): Presenta manchas de grasa/tinta o arrugas menores que distraen de la lectura visual. Por Mejorar (1 pt): Soporte dañado, arrugado o visiblemente sucio, afectando severamente la obra.",
  },
] as const

const LABELS_5 = [
  "Expresión Concepto / Simbolismo",
  "Dominio Técnico y Textura",
  "Composición y Espacio",
  "Creatividad y Originalidad",
  "Presentación y Limpieza",
] as const

const CONCAT_5 = GOLDEN_ITEMS.map((i) => i.rubric_text).join(" ")
const FORM_HINTS_LF = GOLDEN_ITEMS.map(
  (i) => `Ítem ${i.item_number}: ${i.rubric_text}`,
).join("\n\n")
const FORM_HINTS_CRLF = FORM_HINTS_LF.replace(/\n/g, "\r\n")
const NUMBERED_LABELS = GOLDEN_ITEMS.map(
  (i) => `${i.item_number}. ${LABELS_5[i.item_number - 1]}`,
).join("\n")

const TAB =
  "1. Claridad del mensaje\tLogrado (2 pts): mensaje claro\tPor Lograr (0 pts): no se entiende"
const COLON =
  "Claridad del mensaje: Logrado (2 pts): mensaje claro y legible. Medianamente Logrado (1 pts): parcial. Por Lograr (0 pts): no se entiende.\n\nComposición visual: Logrado (2 pts): equilibrada. Medianamente Logrado (1 pts): irregular. Por Lograr (0 pts): desordenada."
const NUMBERED = `1. Claridad del mensaje
Logrado (2 pts): mensaje claro y legible.
Por Lograr (0 pts): no se entiende.
2. Composición visual
Logrado (2 pts): equilibrada.
Por Lograr (0 pts): desordenada.
3. Uso del color
Logrado (2 pts): intencional.
Por Lograr (0 pts): arbitrario.`
const HOLISTIC =
  "Logrado (2 pts): obra completa y coherente. Medianamente Logrado (1 pts): parcialmente resuelta. Por Lograr (0 pts): sin evidencia suficiente."
const HOLISTIC_INTRO =
  "Evaluación general de la obra. Logrado (2 pts): obra completa y coherente. Medianamente Logrado (1 pts): parcialmente resuelta. Por Lograr (0 pts): sin evidencia suficiente."
const M8_TAB =
  "1\tClaridad del mensaje\tExcelente (4 pts): mensaje claro\tBueno (3 pts): casi claro\tRegular (2 pts): parcial\tInsuficiente (1 pts): no se entiende"

const PLAN = {
  applies: true,
  mode: "SINGLE_EVIDENCE_VISUAL" as const,
  scoringMode: "GLOBAL_MECHANICAL" as const,
  allowOmr: false,
  reason: "solo_desarrollo_artes",
}

const IMG1: MultimodalArtsImageInput[] = [
  {
    image_id: "img_1",
    order: 0,
    base64: "dGVzdC1pbWFnZS1ub3QtdGlueS1lbm91Z2gtZm9yLXNlbGVjdA==",
    role: "FINAL",
  },
]

function fp(text: string) {
  const parsed = parseRubricCriteria(text)
  return {
    status: parsed.status,
    format: parsed.format,
    count: parsed.criteria.length,
    ids: parsed.criteria.map((c) => c.criterion_id),
    labels: parsed.criteria.map((c) => c.criterion_label),
    order: parsed.criteria.map((c) => c.position),
    id_sources: parsed.criteria.map((c) => c.criterion_id_source),
    holistic:
      parsed.format === "holistic" ||
      parsed.criteria.some((c) => c.criterion_id === "holistic_item"),
    warnings: parsed.warnings,
  }
}

function dottedN(n: number, withItemPrefix = false): string {
  return Array.from({ length: n }, (_, i) => {
    const title = `Criterio estructural ${i + 1}`
    const body = `${title}. Excelente (4 pts): descriptor excelente del criterio ${i + 1}. Bueno (3 pts): descriptor bueno. Suficiente (2 pts): descriptor suficiente. Por Mejorar (1 pt): descriptor por mejorar.`
    return withItemPrefix ? `Ítem ${i + 1}: ${body}` : body
  }).join(withItemPrefix ? "\n\n" : " ")
}

function jsonEvidence(
  list: Array<{
    criterion_id: string
    criterion_label: string
    nivel_logro?: string
  }>,
  sourceImageIds?: string[],
): string {
  return JSON.stringify({
    texto_estudiante: "obra observada",
    evidence: list.map((row) => ({
      observation_status: "OBSERVED",
      confidence: "MEDIUM",
      inference_used: false,
      source_image_ids: sourceImageIds ?? ["img_1"],
      justification: `just-${row.criterion_id}`,
      observed_content: [`obs-${row.criterion_id}`],
      nivel_logro: row.nivel_logro ?? "PARCIALMENTE_LOGRADO",
      ...row,
    })),
  })
}

function healthyFromParsed(
  parsed: ReturnType<typeof parseRubricCriteria>,
  sourceImageIds?: string[],
) {
  return jsonEvidence(
    parsed.criteria.map((c) => ({
      criterion_id: c.criterion_id,
      criterion_label: c.criterion_label,
      nivel_logro: "PARCIALMENTE_LOGRADO",
    })),
    sourceImageIds,
  )
}

function oneFromParsed(
  parsed: ReturnType<typeof parseRubricCriteria>,
  sourceImageIds?: string[],
) {
  const c = parsed.criteria[0]!
  return jsonEvidence(
    [
      {
        criterion_id: c.criterion_id,
        criterion_label: c.criterion_label,
        nivel_logro: "PARCIALMENTE_LOGRADO",
      },
    ],
    sourceImageIds,
  )
}

function nFromParsed(
  parsed: ReturnType<typeof parseRubricCriteria>,
  count: number,
  sourceImageIds?: string[],
) {
  return jsonEvidence(
    parsed.criteria.slice(0, count).map((c) => ({
      criterion_id: c.criterion_id,
      criterion_label: c.criterion_label,
    })),
    sourceImageIds,
  )
}

function visionResult(
  content: string,
  primary = "img_1",
): MultimodalVisionRequestResult {
  return {
    content,
    provider_used: "mistral",
    primary_image_id: primary,
    secondary_image_ids: [],
    vision_calls: 1,
    trace: DEFAULT_EVALUATION_PROVIDER_TRACE,
  }
}

function queueVision(payloads: Array<string | Error>) {
  const captured: Array<{ imageIds: string[]; prompt: string }> = []
  let n = 0
  const fn: RunMultimodalArtsEvaluationParams["requestVision"] = async (params) => {
    captured.push({
      imageIds: params.images.map((im) => im.image_id),
      prompt: params.prompt,
    })
    const cur = payloads[Math.min(n, payloads.length - 1)]!
    n++
    if (cur instanceof Error) throw cur
    return visionResult(
      cur,
      params.images[params.images.length - 1]?.image_id || "img_1",
    )
  }
  return {
    get calls() {
      return n
    },
    captured,
    fn,
  }
}

function imagesFor(student: string, count = 1): MultimodalArtsImageInput[] {
  return Array.from({ length: count }, (_, i) => ({
    image_id: `${student}_img_${i + 1}`,
    order: i,
    base64: `dGVzdC1pbWFnZS1ub3QtdGlueS1lbm91Z2gtZm9yLXNlbGVjdA==${student}${i}`,
    role: i === count - 1 ? ("FINAL" as const) : ("UNKNOWN" as const),
  }))
}

async function runArts(opts: {
  payloads: Array<string | Error>
  rubric: string
  images?: MultimodalArtsImageInput[]
}) {
  const q = queueVision(opts.payloads)
  const result = await runMultimodalArtsEvaluation({
    input: {
      item_key: "P1",
      question_text: "Evidencia visual de Artes",
      rubric_text: opts.rubric,
      images: opts.images ?? IMG1,
    },
    areaConocimiento: "artes",
    tipoPruebaReal: "solo_desarrollo",
    allowOmr: false,
    enabled: true,
    requestVision: q.fn,
  })
  return { result, calls: q.calls, captured: q.captured }
}

function promptInput(rubric: string, images = IMG1) {
  return {
    input: {
      item_key: "P1",
      question_text: "Evidencia visual de Artes",
      rubric_text: rubric,
      images,
    },
    imageQuality: images.map((im) => ({
      image_id: im.image_id,
      available: true,
      notes: [] as string[],
    })),
    primaryImageId: images[images.length - 1]!.image_id,
    secondaryImageIds: images.slice(0, -1).map((im) => im.image_id),
  }
}

function sha256File(rel: string): string {
  const buf = fs.readFileSync(path.join(ROOT, rel))
  return createHash("sha256").update(buf).digest("hex").toLowerCase()
}

// --- T01–T04 formatos sanos PRE≡POST ---

test("T01 formato numerado PRE≡POST", () => {
  const p = fp(NUMBERED)
  assert.equal(p.format, "numbered_line_blocks")
  assert.equal(p.count, 3)
  assert.deepEqual(p.ids, ["1", "2", "3"])
  assert.deepEqual(p.labels, [
    "Claridad del mensaje",
    "Composición visual",
    "Uso del color",
  ])
  assert.equal(p.holistic, false)
})

test("T02 formato colon PRE≡POST", () => {
  const p = fp(COLON)
  assert.equal(p.format, "block_colon_scale")
  assert.equal(p.count, 2)
  assert.deepEqual(p.ids, ["claridad_del_mensaje__p1", "composicion_visual__p2"])
  assert.deepEqual(p.labels, ["Claridad del mensaje", "Composición visual"])
  assert.equal(p.holistic, false)
})

test("T03 formato tab PRE≡POST", () => {
  const p = fp(TAB)
  assert.equal(p.format, "numbered_tab_row")
  assert.equal(p.count, 1)
  assert.deepEqual(p.ids, ["1"])
  assert.deepEqual(p.labels, ["Claridad del mensaje"])
  assert.equal(p.holistic, false)
  const m8 = fp(M8_TAB)
  assert.equal(m8.format, "holistic")
  assert.equal(m8.count, 1)
  assert.deepEqual(m8.ids, ["holistic_item"])
})

test("T04 holística legítima PRE≡POST N=1", () => {
  const p = fp(HOLISTIC)
  assert.equal(p.format, "holistic")
  assert.equal(p.count, 1)
  assert.deepEqual(p.ids, ["holistic_item"])
  assert.equal(p.holistic, true)
  const intro = fp(HOLISTIC_INTRO)
  assert.equal(intro.format, "holistic")
  assert.equal(intro.count, 1)
  assert.deepEqual(intro.ids, ["holistic_item"])
})

test("T05 Artes real N=5 POST N=5 no holistic_item", () => {
  const p = fp(CONCAT_5)
  assert.equal(p.count, 5)
  assert.equal(p.format, "dotted_title_scale")
  assert.equal(p.holistic, false)
  assert.equal(new Set(p.ids).size, 5)
  assert.deepEqual(p.labels, [...LABELS_5])
  assert.deepEqual(p.order, [1, 2, 3, 4, 5])
  assert.equal(
    p.ids.includes("holistic_item"),
    false,
  )
})

test("T06 nuevo formato N=2", () => {
  const p = fp(dottedN(2))
  assert.equal(p.count, 2)
  assert.equal(p.holistic, false)
  assert.deepEqual(p.labels, ["Criterio estructural 1", "Criterio estructural 2"])
})

test("T07 nuevo formato N=3", () => {
  const p = fp(dottedN(3))
  assert.equal(p.count, 3)
  assert.equal(p.holistic, false)
})

test("T08 nuevo formato N=8", () => {
  const p = fp(dottedN(8))
  assert.equal(p.count, 8)
  assert.equal(p.holistic, false)
  assert.equal(new Set(p.ids).size, 8)
  assert.deepEqual(
    p.labels,
    Array.from({ length: 8 }, (_, i) => `Criterio estructural ${i + 1}`),
  )
})

test("T09 un solo bloque no falso multi", () => {
  const p = fp(GOLDEN_ITEMS[0]!.rubric_text)
  assert.equal(p.count, 1)
  assert.equal(p.format, "holistic")
  assert.deepEqual(p.ids, ["holistic_item"])
})

test("T10 LF form-hints N=5", () => {
  const p = fp(FORM_HINTS_LF)
  assert.equal(p.count, 5)
  assert.deepEqual(p.labels, [...LABELS_5])
  assert.deepEqual(p.ids, ["1", "2", "3", "4", "5"])
  assert.ok(p.id_sources.every((s) => s === "explicit_rubric_id"))
})

test("T11 CRLF form-hints N=5", () => {
  const p = fp(FORM_HINTS_CRLF)
  assert.equal(p.count, 5)
  assert.deepEqual(p.labels, [...LABELS_5])
  assert.deepEqual(p.ids, ["1", "2", "3", "4", "5"])
})

test("T12 espacios adicionales", () => {
  const spaced = CONCAT_5.replace(/\. Excelente/g, ".   Excelente")
  const p = fp(spaced)
  assert.equal(p.count, 5)
  assert.deepEqual(p.labels, [...LABELS_5])
})

test("T13 singular 1 pt", () => {
  const p = fp(CONCAT_5)
  assert.ok(CONCAT_5.includes("(1 pt)"))
  assert.equal(p.count, 5)
})

test("T14 plural 4 pts", () => {
  const p = fp(CONCAT_5)
  assert.ok(CONCAT_5.includes("(4 pts)"))
  assert.equal(p.count, 5)
})

test("T15 títulos con /", () => {
  const p = fp(CONCAT_5)
  assert.equal(p.labels[0], "Expresión Concepto / Simbolismo")
})

test("T16 tildes preservadas", () => {
  const p = fp(CONCAT_5)
  assert.ok(p.labels[0]!.includes("Expresión"))
})

test("T17 título largo ≤160", () => {
  const long = "Título largo de criterio analítico ".repeat(3).trim().slice(0, 80)
  const text = [
    `${long}. Excelente (4 pts): desc a. Bueno (3 pts): desc b.`,
    `Otro criterio. Excelente (4 pts): desc c. Bueno (3 pts): desc d.`,
  ].join(" ")
  const p = fp(text)
  assert.equal(p.count, 2)
  assert.equal(p.labels[0], long)
})

test("T18 descripción contiene Excelente sin ser criterio", () => {
  const p = fp(CONCAT_5)
  assert.ok(GOLDEN_ITEMS[2]!.rubric_text.includes("Excelente manejo del encuadre"))
  assert.equal(p.count, 5)
  assert.deepEqual(p.labels, [...LABELS_5])
})

test("T19 descripción contiene Bueno sin ser criterio", () => {
  const p = fp(CONCAT_5)
  assert.ok(GOLDEN_ITEMS[1]!.rubric_text.includes("Bueno (3 pts)"))
  assert.equal(p.count, 5)
  assert.equal(
    p.labels.some((l) => /^Bueno$/i.test(l)),
    false,
  )
})

test("T20 input vacío PRE≡POST", () => {
  const p = fp("")
  assert.equal(p.status, "RUBRIC_EMPTY")
  assert.equal(p.format, "none")
  assert.equal(p.count, 0)
})

test("T21 malformed PRE≡POST", () => {
  const p = fp("asdf qwer zxcv")
  assert.equal(p.status, "RUBRIC_CRITERIA_NOT_VERIFIABLE")
  assert.equal(p.count, 0)
})

test("T22 texto sin bandas PRE≡POST", () => {
  const p = fp("esto es un texto libre sin escala")
  assert.equal(p.status, "RUBRIC_CRITERIA_NOT_VERIFIABLE")
  assert.equal(p.count, 0)
})

test("T23 orden preservado", () => {
  const p = fp(CONCAT_5)
  assert.deepEqual(p.order, [1, 2, 3, 4, 5])
  assert.deepEqual(p.labels, [...LABELS_5])
})

test("T24 IDs únicos", () => {
  const p = fp(CONCAT_5)
  assert.equal(new Set(p.ids).size, p.count)
  const hints = fp(FORM_HINTS_LF)
  assert.equal(new Set(hints.ids).size, 5)
})

test("T25 parser determinista 100 ejecuciones", () => {
  const first = JSON.stringify(fp(CONCAT_5))
  for (let i = 0; i < 100; i++) {
    assert.equal(JSON.stringify(fp(CONCAT_5)), first)
  }
  const firstHints = JSON.stringify(fp(FORM_HINTS_LF))
  for (let i = 0; i < 100; i++) {
    assert.equal(JSON.stringify(fp(FORM_HINTS_LF)), firstHints)
  }
})

test("T-sane numbered labels A7 fixture PRE≡POST", () => {
  const p = fp(NUMBERED_LABELS)
  assert.equal(p.format, "numbered_line_blocks")
  assert.equal(p.count, 5)
  assert.deepEqual(p.ids, ["1", "2", "3", "4", "5"])
  assert.deepEqual(p.labels, [...LABELS_5])
})

// --- Integración A7 sin modificar A7 ---

test("A7 expected slots N=5 rúbrica real", () => {
  const parsed = parseRubricCriteria(FORM_HINTS_LF)
  assert.equal(parsed.criteria.length, 5)
  const built = buildMultimodalArtsPrompt(promptInput(FORM_HINTS_LF))
  assert.equal(built.criterion_labels.length, 5)
  assert.match(built.prompt, /SLOTS OBLIGATORIOS \(N=5\)/)
  assert.ok(built.prompt.includes("criterion_id=\"1\""))
  assert.ok(built.prompt.includes("criterion_id=\"5\""))
})

test("A7 first 5 → 5/5 repair 0", async () => {
  const parsed = parseRubricCriteria(FORM_HINTS_LF)
  const { result, calls, captured } = await runArts({
    payloads: [healthyFromParsed(parsed)],
    rubric: FORM_HINTS_LF,
  })
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
  assert.equal(
    result.diagnostics.includes("pedagogical_retry:incomplete_rubric"),
    false,
  )
  assert.doesNotMatch(captured[0]!.prompt, /REPAIR PEDAGÓGICO/)
})

test("A7 first 1 → repair → final 5", async () => {
  const parsed = parseRubricCriteria(FORM_HINTS_LF)
  const { result, calls, captured } = await runArts({
    payloads: [oneFromParsed(parsed), healthyFromParsed(parsed)],
    rubric: FORM_HINTS_LF,
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
  assert.ok(captured[1]!.prompt.includes("REPAIR PEDAGÓGICO"))
  assert.ok(captured[1]!.prompt.includes("Faltaron:"))
})

test("A7 first 4 → repair → final 5", async () => {
  const parsed = parseRubricCriteria(FORM_HINTS_LF)
  const { result, calls } = await runArts({
    payloads: [nFromParsed(parsed, 4), healthyFromParsed(parsed)],
    rubric: FORM_HINTS_LF,
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
})

test("A5 airbag first 1 + repair 1 → 422 no nota falsa", async () => {
  const parsed = parseRubricCriteria(FORM_HINTS_LF)
  const { result, calls } = await runArts({
    payloads: [oneFromParsed(parsed), oneFromParsed(parsed)],
    rubric: FORM_HINTS_LF,
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, false)
  assert.ok(result.diagnostics.includes("multimodal_incomplete_rubric"))
  assert.equal(result.criterios_evaluados.length, 0)
  const completeness = assessArtsRubricCompleteness(parsed.criteria, [
    {
      criterion_id: parsed.criteria[0]!.criterion_id,
      criterion_label: parsed.criteria[0]!.criterion_label,
      observed_content: ["obs"],
      observation_status: "OBSERVED",
      confidence: "MEDIUM",
      inference_used: false,
      source_image_ids: ["img_1"],
      justification: "j",
      nivel_logro: "PARCIALMENTE_LOGRADO",
    },
  ])
  assert.equal(completeness.complete, false)
  assert.equal(completeness.expectedCount, 5)
  assert.equal(completeness.matched, 1)
})

test("scoring recibe N=5 sin modificar scoring", async () => {
  const parsed = parseRubricCriteria(FORM_HINTS_LF)
  const { result } = await runArts({
    payloads: [healthyFromParsed(parsed)],
    rubric: FORM_HINTS_LF,
  })
  assert.equal(result.criterios_evaluados.length, 5)
  const scored = calculateMechanicalDevelopmentScore({
    criteriosEvaluados: result.criterios_evaluados,
    respuestasDesarrollo: {},
    rubrica: FORM_HINTS_LF,
    puntajeTotal: 20,
    plan: PLAN,
  })
  assert.equal(scored.ok, true)
  assert.equal(scored.criteria.length, 5)
  assert.equal(scored.puntaje.endsWith("/20"), true)
  assert.equal(
    scored.reason,
    "mechanical_from_criterios_evaluados",
  )
})

test("BATCH 3 estudiantes misma rúbrica N=5", async () => {
  const parsed = parseRubricCriteria(FORM_HINTS_LF)
  const students = ["A", "B", "C"]
  for (const s of students) {
    const p = parseRubricCriteria(FORM_HINTS_LF)
    assert.equal(p.criteria.length, 5)
    const { result } = await runArts({
      payloads: [healthyFromParsed(parsed, [`${s}_img_1`])],
      rubric: FORM_HINTS_LF,
      images: imagesFor(s, 1),
    })
    assert.equal(result.ok, true)
    assert.equal(result.criterios_evaluados.length, 5)
  }
})

test("BATCH 20 jobs parsed N=5 sin contaminación", async () => {
  const first = JSON.stringify(fp(FORM_HINTS_LF))
  for (let i = 0; i < 20; i++) {
    const p = parseRubricCriteria(FORM_HINTS_LF)
    assert.equal(p.criteria.length, 5)
    assert.equal(JSON.stringify(fp(FORM_HINTS_LF)), first)
    const { result } = await runArts({
      payloads: [healthyFromParsed(p, [`job${i}_img_1`])],
      rubric: FORM_HINTS_LF,
      images: imagesFor(`job${i}`, 1),
    })
    assert.equal(result.criterios_evaluados.length, 5)
  }
})

test("MULTI-IMAGE 1/2/3 parsed N invariante", async () => {
  const parsed = parseRubricCriteria(FORM_HINTS_LF)
  for (const nImg of [1, 2, 3]) {
    assert.equal(parseRubricCriteria(FORM_HINTS_LF).criteria.length, 5)
    const imgs = imagesFor("obra", nImg)
    const ids = imgs.map((im) => im.image_id)
    const { result } = await runArts({
      payloads: [healthyFromParsed(parsed, ids)],
      rubric: FORM_HINTS_LF,
      images: imgs,
    })
    assert.equal(result.ok, true)
    assert.equal(result.criterios_evaluados.length, 5)
  }
})

test("N dinámico 2/3/5/8 A7 slots coinciden", async () => {
  for (const n of [2, 3, 5, 8]) {
    const rubric = dottedN(n, true)
    const parsed = parseRubricCriteria(rubric)
    assert.equal(parsed.criteria.length, n)
    const built = buildMultimodalArtsPrompt(promptInput(rubric))
    assert.match(built.prompt, new RegExp(`SLOTS OBLIGATORIOS \\(N=${n}\\)`))
    const { result, calls } = await runArts({
      payloads: [healthyFromParsed(parsed)],
      rubric,
    })
    assert.equal(calls, 1)
    assert.equal(result.ok, true)
    assert.equal(result.criterios_evaluados.length, n)
  }
})

test("concat sin Ítem también N=5 y A7 usa esos IDs", async () => {
  const parsed = parseRubricCriteria(CONCAT_5)
  assert.equal(parsed.criteria.length, 5)
  assert.ok(parsed.criteria.every((c) => c.criterion_id_source === "stable_label_position"))
  const { result } = await runArts({
    payloads: [healthyFromParsed(parsed)],
    rubric: CONCAT_5,
  })
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
})

test("SEPARATE_PEDAGOGICAL_ISSUE Bueno→LOGRADO fuera de alcance", () => {
  const pipeline = fs.readFileSync(
    path.join(ROOT, "app/lib/desarrollo-pipeline.ts"),
    "utf8",
  )
  assert.match(pipeline, /LEVEL_TO_FRACTION/)
  assert.match(pipeline, /calculateMechanicalDevelopmentScore/)
})

test("A12 no toca blacklist hashes", () => {
  const pre = fs.readFileSync(
    path.join(ROOT, "_audit_arts_a12_parser_impl", "PRE", "HASHES-PRE.txt"),
    "utf8",
  )
  const map = new Map<string, string>()
  for (const line of pre.split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\S+\s+(.+)$/.exec(line.trim())
    if (m) map.set(m[2]!, m[1]!)
  }
  const frozen = [
    "app/lib/multimodal/evaluate-multimodal-arts.ts",
    "app/lib/multimodal/multimodal-prompt.ts",
    "app/api/evaluate/evaluation-logic.ts",
    "app/lib/desarrollo-pipeline.ts",
    "app/lib/scoring/chileanGradeEngine.ts",
    "app/lib/persist-evaluation.ts",
    "package.json",
    "package-lock.json",
  ]
  for (const rel of frozen) {
    assert.equal(sha256File(rel), map.get(rel), rel)
  }
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`PASS ${t.name}`)
    } catch (e) {
      failed++
      console.error(`FAIL ${t.name}`)
      console.error(e)
    }
  }
  console.log(
    `\nA12-DOTTED-TITLE: ${passed} passed, ${failed} failed, ${tests.length} total`,
  )
  if (failed) process.exit(1)
}

void main()
