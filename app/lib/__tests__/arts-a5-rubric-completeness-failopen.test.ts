/**
 * ARTS-A5 — Completitud de rúbrica + bloqueo fail-open pedagógico.
 * OFFLINE. Sin IA real, sin créditos, sin Supabase/Redis/Railway.
 *
 * Ejecutar: npx tsx app/lib/__tests__/arts-a5-rubric-completeness-failopen.test.ts
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
  normalizedExactArtsLabel,
  runMultimodalArtsEvaluation,
} from "../multimodal/evaluate-multimodal-arts"
import type { MultimodalCriterionEvidence } from "../multimodal/types"
import type { MultimodalVisionRequestResult } from "../multimodal/multimodal-vision-provider"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = path.resolve(__dirname, "../../..")
const HASHES_PRE = path.join(
  ROOT,
  "_audit_arts_a5_local_impl",
  "PRE",
  "HASHES-PRE.txt",
)

const RUBRIC_5 = [
  "1. Expresión Concepto / Simbolismo",
  "2. Dominio Técnico y Textura",
  "3. Composición y Espacio",
  "4. Creatividad y Originalidad",
  "5. Presentación y Limpieza",
].join("\n")

const LABELS = [
  "Expresión Concepto / Simbolismo",
  "Dominio Técnico y Textura",
  "Composición y Espacio",
  "Creatividad y Originalidad",
  "Presentación y Limpieza",
] as const

const NIVELES = [
  "PARCIALMENTE_LOGRADO",
  "PARCIALMENTE_LOGRADO",
  "PARCIALMENTE_LOGRADO",
  "LOGRADO",
  "PARCIALMENTE_LOGRADO",
] as const

const IMG = [
  {
    image_id: "img_1",
    order: 0,
    base64: "dGVzdC1pbWFnZS1ub3QtdGlueS1lbm91Z2gtZm9yLXNlbGVjdA==",
    role: "FINAL" as const,
  },
]

function sha256File(rel: string): string {
  const buf = fs.readFileSync(path.join(ROOT, rel))
  return createHash("sha256").update(buf).digest("hex").toUpperCase()
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8")
}

function parsePreHashes(): Map<string, string> {
  const map = new Map<string, string>()
  const text = fs.readFileSync(HASHES_PRE, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-F0-9]{64})\s+\S+\s+(.+)$/.exec(line.trim())
    if (m) map.set(m[2]!.replace(/\\/g, "/"), m[1]!)
  }
  return map
}

function assertHashUnchanged(rel: string): void {
  const pre = parsePreHashes()
  assert.equal(sha256File(rel), pre.get(rel), rel)
}

function ev(
  id: string,
  label: string,
  nivel: MultimodalCriterionEvidence["nivel_logro"] = "PARCIALMENTE_LOGRADO",
  extra?: Partial<MultimodalCriterionEvidence>,
): MultimodalCriterionEvidence {
  return {
    criterion_id: id,
    criterion_label: label,
    observed_content: [`obs-${id}`],
    observation_status: "OBSERVED",
    confidence: "MEDIUM",
    inference_used: false,
    source_image_ids: ["img_1"],
    justification: `just-${id}`,
    nivel_logro: nivel,
    ...extra,
  }
}

function healthy5(): MultimodalCriterionEvidence[] {
  return LABELS.map((label, i) =>
    ev(String(i + 1), label, NIVELES[i]!),
  )
}

function visionResult(content: string): MultimodalVisionRequestResult {
  return {
    content,
    provider_used: "mistral",
    primary_image_id: "img_1",
    secondary_image_ids: [],
    vision_calls: 1,
    trace: DEFAULT_EVALUATION_PROVIDER_TRACE,
  }
}

function jsonEvidence(
  list: Array<{
    criterion_id: string
    criterion_label: string
    nivel_logro?: string
    observation_status?: string
    justification?: string
    observed_content?: string[]
  }>,
): string {
  return JSON.stringify({
    texto_estudiante: "obra observada",
    evidence: list.map((row) => ({
      observation_status: "OBSERVED",
      confidence: "MEDIUM",
      inference_used: false,
      source_image_ids: ["img_1"],
      justification: row.justification ?? `just-${row.criterion_id}`,
      observed_content: row.observed_content ?? [`obs-${row.criterion_id}`],
      ...row,
    })),
  })
}

function queueVision(payloads: Array<string | Error>) {
  let n = 0
  return {
    get calls() {
      return n
    },
    fn: async () => {
      const cur = payloads[Math.min(n, payloads.length - 1)]!
      n++
      if (cur instanceof Error) throw cur
      return visionResult(cur)
    },
  }
}

function artsInput(rubric = RUBRIC_5) {
  return {
    item_key: "P1",
    question_text: "Evidencia visual de Artes",
    rubric_text: rubric,
    images: IMG,
  }
}

async function runArts(
  payloads: Array<string | Error>,
  extra?: { enabled?: boolean; rubric?: string },
) {
  const q = queueVision(payloads)
  const result = await runMultimodalArtsEvaluation({
    input: artsInput(extra?.rubric),
    areaConocimiento: "artes",
    tipoPruebaReal: "solo_desarrollo",
    allowOmr: false,
    enabled: extra?.enabled ?? true,
    requestVision: q.fn,
  })
  return { result, calls: q.calls }
}

const PLAN = {
  applies: true,
  mode: "SINGLE_EVIDENCE_VISUAL" as const,
  scoringMode: "GLOBAL_MECHANICAL" as const,
  allowOmr: false,
  reason: "solo_desarrollo_artes",
}

test("T1 5→5 healthy PRE≡POST (1 call, no retry)", async () => {
  const parsed = parseRubricCriteria(RUBRIC_5)
  assert.equal(parsed.criteria.length, 5)
  const { result, calls } = await runArts([jsonEvidence(healthy5())])
  assert.equal(calls, 1, "healthy no extra model call")
  assert.equal(result.ok, true)
  assert.equal(result.fallback_recommended, false)
  assert.equal(result.criterios_evaluados.length, 5)
  assert.equal(
    result.diagnostics.includes("pedagogical_retry:incomplete_rubric"),
    false,
  )
  for (let i = 0; i < 5; i++) {
    const c = result.criterios_evaluados[i]!
    assert.equal(c.criterio_id, String(i + 1))
    assert.equal(c.criterio_label, LABELS[i])
    assert.equal(c.nivel_logro, NIVELES[i])
    assert.match(c.justificacion, new RegExp(`just-${i + 1}`))
  }
})

test("T2 5→1 blocks initial scoring", async () => {
  const one = jsonEvidence([
    {
      criterion_id: "1",
      criterion_label: LABELS[0]!,
      nivel_logro: "PARCIALMENTE_LOGRADO",
    },
  ])
  const { result, calls } = await runArts([one, one])
  assert.equal(calls, 2)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, false)
  assert.ok(result.diagnostics.includes("multimodal_incomplete_rubric"))
  assert.equal(result.criterios_evaluados.length, 0)
})

test("T3 5→1 retry success", async () => {
  const one = jsonEvidence([
    {
      criterion_id: "1",
      criterion_label: LABELS[0]!,
      nivel_logro: "PARCIALMENTE_LOGRADO",
    },
  ])
  const { result, calls } = await runArts([one, jsonEvidence(healthy5())])
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
  assert.ok(result.diagnostics.includes("pedagogical_retry:incomplete_rubric"))
})

test("T4 5→1 retry incomplete → error, no Camino A signal", async () => {
  const one = jsonEvidence([
    {
      criterion_id: "1",
      criterion_label: LABELS[0]!,
      nivel_logro: "PARCIALMENTE_LOGRADO",
    },
  ])
  const { result } = await runArts([one, one])
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, false)
  assert.ok(result.diagnostics.includes("multimodal_incomplete_rubric"))
})

test("T5 5→4 block", async () => {
  const four = jsonEvidence(
    healthy5()
      .slice(0, 4)
      .map((e) => ({
        criterion_id: e.criterion_id,
        criterion_label: e.criterion_label,
        nivel_logro: e.nivel_logro,
      })),
  )
  const { result, calls } = await runArts([four, four])
  assert.equal(calls, 2)
  assert.equal(result.ok, false)
  assert.equal(result.criterios_evaluados.length, 0)
})

test("T6 reordered 5→5 align", () => {
  const rubric = parseRubricCriteria(RUBRIC_5).criteria
  const shuffled = [
    ev("3", LABELS[2]!, "PARCIALMENTE_LOGRADO"),
    ev("5", LABELS[4]!, "PARCIALMENTE_LOGRADO"),
    ev("1", LABELS[0]!, "PARCIALMENTE_LOGRADO"),
    ev("4", LABELS[3]!, "LOGRADO"),
    ev("2", LABELS[1]!, "PARCIALMENTE_LOGRADO"),
  ]
  const c = assessArtsRubricCompleteness(rubric, shuffled)
  assert.equal(c.complete, true)
  assert.ok(c.aligned)
  assert.deepEqual(
    c.aligned!.map((e) => e.criterion_id),
    ["1", "2", "3", "4", "5"],
  )
  assert.equal(c.aligned![3]!.nivel_logro, "LOGRADO")
  assert.equal(c.aligned![3]!.justification, "just-4")
})

test("T7 duplicate detect", () => {
  const rubric = parseRubricCriteria(RUBRIC_5).criteria
  const c = assessArtsRubricCompleteness(rubric, [
    ev("1", LABELS[0]!),
    ev("1", LABELS[0]!),
    ev("3", LABELS[2]!),
    ev("4", LABELS[3]!),
    ev("5", LABELS[4]!),
  ])
  assert.equal(c.complete, false)
  assert.ok(c.duplicates.includes("1"))
  assert.ok(c.missing.includes("2"))
  assert.equal(c.aligned, null)
})

test("T8 extra ignored for score", () => {
  const rubric = parseRubricCriteria(RUBRIC_5).criteria
  const c = assessArtsRubricCompleteness(rubric, [
    ...healthy5(),
    ev("99", "Criterio inventado extra"),
  ])
  assert.equal(c.complete, true)
  assert.equal(c.extras.length, 1)
  assert.equal(c.aligned!.length, 5)
  assert.equal(
    c.aligned!.some((e) => e.criterion_id === "99"),
    false,
  )
})

test("T9 ambiguous/substring blocked", () => {
  assert.notEqual(
    normalizedExactArtsLabel("Dominio técnico"),
    normalizedExactArtsLabel("Dominio Técnico y Textura"),
  )
  const rubric = parseRubricCriteria("1. Dominio Técnico y Textura").criteria
  assert.equal(rubric.length, 1)
  const c = assessArtsRubricCompleteness(rubric, [
    ev("x", "Dominio técnico"),
  ])
  assert.equal(c.complete, false)
  assert.equal(c.matched, 0)
  assert.ok(c.missing.length >= 1)
})

test("T10 empty blocked + retry", async () => {
  const empty = JSON.stringify({ evidence: [] })
  const { result, calls } = await runArts([empty, empty])
  assert.equal(calls, 2)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, false)
  assert.ok(result.diagnostics.includes("multimodal_incomplete_rubric"))
  assert.equal(result.criterios_evaluados.length, 0)
})

test("T11 timeout fallback preserved", async () => {
  const { result, calls } = await runArts([
    new Error("ERROR_MISTRAL_TIMEOUT"),
  ])
  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, true)
  assert.equal(result.diagnostics.includes("multimodal_incomplete_rubric"), false)
  assert.ok(
    result.diagnostics.some((d) => d.includes("ERROR_MISTRAL_TIMEOUT")),
  )
})

test("T12 5xx fallback preserved", async () => {
  const { result } = await runArts([new Error("HTTP 503")])
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, true)
  assert.equal(result.diagnostics.includes("multimodal_incomplete_rubric"), false)
})

test("T13 malformed JSON fallback preserved", async () => {
  const { result, calls } = await runArts(["NOT-JSON {{{"])
  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, true)
  assert.ok(result.diagnostics.includes("multimodal_json_parse_failed"))
  assert.equal(result.diagnostics.includes("multimodal_incomplete_rubric"), false)
})

test("T14 flag OFF PRE≡POST", async () => {
  let visionCalls = 0
  const result = await runMultimodalArtsEvaluation({
    input: artsInput(),
    areaConocimiento: "artes",
    tipoPruebaReal: "solo_desarrollo",
    allowOmr: false,
    enabled: false,
    requestVision: async () => {
      visionCalls++
      return visionResult("{}")
    },
  })
  assert.equal(visionCalls, 0)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, true)
  assert.ok(result.diagnostics.includes("multimodal_flag_or_gate_off"))
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  assert.match(logic, /if \(runMultimodalArts\)/)
  assert.match(logic, /shouldRunMultimodalArtsPath/)
})

test("T15 no Camino A for incomplete rubric", () => {
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  const i422 = logic.indexOf("status: 422")
  const iCaminoA = logic.indexOf("if (!multimodalArtsSucceeded) for")
  const iIncomplete = logic.indexOf("multimodal_incomplete_rubric")
  assert.ok(i422 > 0 && iCaminoA > 0 && iIncomplete > 0)
  assert.ok(i422 < iCaminoA, "422 must return before Camino A")
  assert.match(
    logic,
    /fallback_recommended === false[\s\S]*multimodal_incomplete_rubric/,
  )
})

test("T16 no 9/15 from Camino B incomplete; scoring itself PRE≡POST", async () => {
  const one = jsonEvidence([
    {
      criterion_id: "1",
      criterion_label: LABELS[0]!,
      nivel_logro: "PARCIALMENTE_LOGRADO",
    },
  ])
  const { result } = await runArts([one, one])
  assert.equal(result.criterios_evaluados.length, 0)
  const still = calculateMechanicalDevelopmentScore({
    criteriosEvaluados: [
      {
        criterio_id: "1",
        criterio_label: LABELS[0],
        nivel_logro: "PARCIALMENTE_LOGRADO",
        evidencia: "x",
        justificacion: "x",
      },
    ],
    respuestasDesarrollo: {},
    rubrica: RUBRIC_5,
    puntajeTotal: 15,
    plan: PLAN,
  })
  assert.equal(still.puntaje, "9/15", "scoring global unchanged")
  assertHashUnchanged("app/lib/desarrollo-pipeline.ts")
})

test("T17 no fake 1.0 — 422 before scoring/grade", () => {
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  const i422 = logic.indexOf("status: 422")
  const iScore = logic.indexOf("const scores = calculateFinalScore(")
  const iGrade = logic.lastIndexOf("function calculateGrade")
  assert.ok(i422 > 0 && iScore > i422)
  assert.ok(iGrade >= 0 && iGrade < i422)
})

test("T18 no persistence incomplete", () => {
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  const i422 = logic.indexOf("status: 422")
  const iPersist = logic.indexOf("await persistEvaluation(")
  assert.ok(i422 > 0 && iPersist > i422)
  assertHashUnchanged("app/lib/persist-evaluation.ts")
})

test("T19 no final score incomplete", async () => {
  const { result } = await runArts([
    jsonEvidence([
      {
        criterion_id: "1",
        criterion_label: LABELS[0]!,
        nivel_logro: "PARCIALMENTE_LOGRADO",
      },
    ]),
    jsonEvidence([
      {
        criterion_id: "1",
        criterion_label: LABELS[0]!,
        nivel_logro: "PARCIALMENTE_LOGRADO",
      },
    ]),
  ])
  assert.equal(result.ok, false)
  assert.equal(result.criterios_evaluados.length, 0)
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  const gate = arts.indexOf("assessArtsRubricCompleteness")
  const adapt = arts.indexOf("adaptMultimodalEvidenceToCriteriosEvaluados(")
  assert.ok(gate > 0 && adapt > gate)
})

test("T20 healthy persistence unchanged", () => {
  assertHashUnchanged("app/lib/persist-evaluation.ts")
})

test("T21 N=1", async () => {
  const rubric = "1. Dominio Técnico y Textura"
  const { result, calls } = await runArts(
    [
      jsonEvidence([
        {
          criterion_id: "1",
          criterion_label: "Dominio Técnico y Textura",
          nivel_logro: "LOGRADO",
        },
      ]),
    ],
    { rubric },
  )
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 1)
})

test("T22 N≥2 contract at common gate (not M8)", () => {
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  assert.match(arts, /assessArtsRubricCompleteness/)
  assert.doesNotMatch(arts, /requestEvaluationVisionCompletionMulti/)
  assertHashUnchanged("app/lib/multimodal/multimodal-vision-provider.ts")
})

test("T23 M8 prod unchanged", () => {
  assertHashUnchanged("app/lib/multimodal/multimodal-vision-provider.ts")
  assertHashUnchanged("app/lib/multimodal/multimodal-prompt.ts")
  assertHashUnchanged("app/lib/__tests__/multimodal-m8-multiview.test.ts")
})

test("T24 Development unchanged", () => {
  assertHashUnchanged("app/lib/development-core/development-criteria-core.ts")
  assertHashUnchanged("app/lib/development-core/parse-rubric-criteria.ts")
})

test("T25 Multimodal general / Solo Desarrollo contract", () => {
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  const iRun = logic.indexOf("if (runMultimodalArts)")
  const i422 = logic.indexOf("status: 422")
  const iEndRun = logic.indexOf("if (!multimodalArtsSucceeded) for")
  assert.ok(iRun > 0 && i422 > iRun && i422 < iEndRun)
  assert.match(logic, /shouldRunMultimodalArtsPath/)
  assert.doesNotMatch(
    logic.slice(0, iRun),
    /multimodal_incomplete_rubric/,
  )
})

test("T26 scoring hash unchanged", () => {
  assertHashUnchanged("app/lib/desarrollo-pipeline.ts")
  assertHashUnchanged("app/lib/scoring/chileanGradeEngine.ts")
})

test("T27 persistence hash unchanged", () => {
  assertHashUnchanged("app/lib/persist-evaluation.ts")
})

test("T28 B1 unchanged", () => {
  assertHashUnchanged("app/lib/persist-evaluation.ts")
})

test("T29 OMR unchanged", () => {
  assertHashUnchanged("app/lib/omr-libelia-reader.ts")
  assertHashUnchanged("app/lib/omr-shared/azure-visual-blank-rescue.ts")
})

test("T30 BLANK/SCALE unchanged", () => {
  assertHashUnchanged("app/lib/omr-shared/azure-visual-blank-rescue.ts")
  assertHashUnchanged("app/lib/omr-shared/azure-visual-blank-rescue-n2.ts")
  assertHashUnchanged("app/lib/standard-scale/converters.ts")
  assertHashUnchanged("app/lib/standard-scale-converters.ts")
})

test("T-extra identity no fuzzy + HTTP 422 contract + M8 T8 source counts", () => {
  assert.equal(
    normalizedExactArtsLabel("  Dominio   Técnico y Textura "),
    normalizedExactArtsLabel("dominio tecnico y textura"),
  )
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  assert.match(logic, /Error en la evaluación/)
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  assert.equal(
    (arts.match(/requestMultimodalArtsVision\(/g) || []).length,
    1,
  )
  assert.equal(
    (arts.match(/adaptMultimodalEvidenceToCriteriosEvaluados\(/g) || []).length,
    1,
  )
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
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed) process.exit(1)
}

void main()
