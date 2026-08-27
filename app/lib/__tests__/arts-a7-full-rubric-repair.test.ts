/**
 * ARTS-A7 — Rúbrica completa N/N + repair pedagógico informado.
 * OFFLINE. Sin IA real, sin créditos, sin Supabase/Redis/Railway.
 *
 * Ejecutar: npx tsx app/lib/__tests__/arts-a7-full-rubric-repair.test.ts
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
import {
  buildMultimodalArtsPrompt,
  buildMultimodalArtsRepairPrompt,
} from "../multimodal/multimodal-prompt"
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
const HASHES_PRE = path.join(
  ROOT,
  "_audit_arts_a7_full_rubric_repair",
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

const LABELS_5 = [
  "Expresión Concepto / Simbolismo",
  "Dominio Técnico y Textura",
  "Composición y Espacio",
  "Creatividad y Originalidad",
  "Presentación y Limpieza",
] as const

const IMG1: MultimodalArtsImageInput[] = [
  {
    image_id: "img_1",
    order: 0,
    base64: "dGVzdC1pbWFnZS1ub3QtdGlueS1lbm91Z2gtZm9yLXNlbGVjdA==",
    role: "FINAL",
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

function rubricN(n: number): string {
  return Array.from({ length: n }, (_, i) => `${i + 1}. Criterio ${i + 1}`).join(
    "\n",
  )
}

function imagesFor(student: string, count = 1): MultimodalArtsImageInput[] {
  return Array.from({ length: count }, (_, i) => ({
    image_id: `${student}_img_${i + 1}`,
    order: i,
    base64: `dGVzdC1pbWFnZS1ub3QtdGlueS1lbm91Z2gtZm9yLXNlbGVjdA==${student}${i}`,
    role: i === count - 1 ? ("FINAL" as const) : ("UNKNOWN" as const),
  }))
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

function healthyN(n: number, sourceImageIds?: string[]) {
  return jsonEvidence(
    Array.from({ length: n }, (_, i) => ({
      criterion_id: String(i + 1),
      criterion_label: n === 5 ? LABELS_5[i]! : `Criterio ${i + 1}`,
      nivel_logro: i === 3 ? "LOGRADO" : "PARCIALMENTE_LOGRADO",
    })),
    sourceImageIds,
  )
}

function oneOfN(n: number, sourceImageIds?: string[]) {
  const label = n === 5 ? LABELS_5[0]! : "Criterio 1"
  return jsonEvidence(
    [{ criterion_id: "1", criterion_label: label, nivel_logro: "PARCIALMENTE_LOGRADO" }],
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

type CapturedCall = {
  imageIds: string[]
  prompt: string
}

function queueVision(payloads: Array<string | Error>) {
  const captured: CapturedCall[] = []
  let n = 0
  const fn: RunMultimodalArtsEvaluationParams["requestVision"] = async (params) => {
    captured.push({
      imageIds: params.images.map((im) => im.image_id),
      prompt: params.prompt,
    })
    const cur = payloads[Math.min(n, payloads.length - 1)]!
    n++
    if (cur instanceof Error) throw cur
    return visionResult(cur, params.images[params.images.length - 1]?.image_id || "img_1")
  }
  return {
    get calls() {
      return n
    },
    captured,
    fn,
  }
}

async function runArts(opts: {
  payloads: Array<string | Error>
  rubric?: string
  images?: MultimodalArtsImageInput[]
  enabled?: boolean
  subject?: string
}) {
  const q = queueVision(opts.payloads)
  const result = await runMultimodalArtsEvaluation({
    input: {
      item_key: "P1",
      question_text: "Evidencia visual de Artes",
      rubric_text: opts.rubric ?? RUBRIC_5,
      images: opts.images ?? IMG1,
      subject: opts.subject,
    },
    areaConocimiento: "artes",
    tipoPruebaReal: "solo_desarrollo",
    allowOmr: false,
    enabled: opts.enabled ?? true,
    requestVision: q.fn,
  })
  return { result, calls: q.calls, captured: q.captured }
}

const PLAN = {
  applies: true,
  mode: "SINGLE_EVIDENCE_VISUAL" as const,
  scoringMode: "GLOBAL_MECHANICAL" as const,
  allowOmr: false,
  reason: "solo_desarrollo_artes",
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

test("T1 N=5 first 5 → 5, no repair", async () => {
  const { result, calls, captured } = await runArts({ payloads: [healthyN(5)] })
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
  assert.equal(
    result.diagnostics.includes("pedagogical_retry:incomplete_rubric"),
    false,
  )
  assert.doesNotMatch(captured[0]!.prompt, /REPAIR PEDAGÓGICO/)
})

test("T2 5→1→5", async () => {
  const { result, calls, captured } = await runArts({
    payloads: [oneOfN(5), healthyN(5)],
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
  assert.ok(result.diagnostics.includes("pedagogical_repair:full_informed"))
  assert.ok(captured[1]!.prompt.includes("REPAIR PEDAGÓGICO"))
  assert.ok(captured[1]!.prompt.includes("Faltaron:"))
  assert.ok(/2/.test(captured[1]!.prompt))
})

test("T3 5→4→5", async () => {
  const four = jsonEvidence(
    LABELS_5.slice(0, 4).map((label, i) => ({
      criterion_id: String(i + 1),
      criterion_label: label,
    })),
  )
  const { result, calls } = await runArts({ payloads: [four, healthyN(5)] })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
})

test("T4 5→1→1 A5", async () => {
  const { result, calls } = await runArts({ payloads: [oneOfN(5), oneOfN(5)] })
  assert.equal(calls, 2)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, false)
  assert.ok(result.diagnostics.includes("multimodal_incomplete_rubric"))
  assert.equal(result.criterios_evaluados.length, 0)
})

test("T5 reordered 5 válidos: no repair", async () => {
  const shuffled = jsonEvidence([
    { criterion_id: "5", criterion_label: LABELS_5[4]! },
    { criterion_id: "2", criterion_label: LABELS_5[1]! },
    { criterion_id: "1", criterion_label: LABELS_5[0]! },
    { criterion_id: "4", criterion_label: LABELS_5[3]!, nivel_logro: "LOGRADO" },
    { criterion_id: "3", criterion_label: LABELS_5[2]! },
  ])
  const { result, calls } = await runArts({ payloads: [shuffled] })
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.deepEqual(
    result.criterios_evaluados.map((c) => c.criterio_id),
    ["1", "2", "3", "4", "5"],
  )
  assert.equal(result.criterios_evaluados[3]!.nivel_logro, "LOGRADO")
})

test("T6 duplicate → repair", async () => {
  const dup = jsonEvidence([
    { criterion_id: "1", criterion_label: LABELS_5[0]! },
    { criterion_id: "1", criterion_label: LABELS_5[0]! },
    { criterion_id: "3", criterion_label: LABELS_5[2]! },
    { criterion_id: "4", criterion_label: LABELS_5[3]! },
    { criterion_id: "5", criterion_label: LABELS_5[4]! },
  ])
  const { result, calls, captured } = await runArts({
    payloads: [dup, healthyN(5)],
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
  assert.ok(captured[1]!.prompt.includes("Duplicados:"))
})

test("T7 extra ignored", async () => {
  const extra = jsonEvidence([
    ...LABELS_5.map((label, i) => ({
      criterion_id: String(i + 1),
      criterion_label: label,
    })),
    { criterion_id: "99", criterion_label: "Criterio inventado extra" },
  ])
  const { result, calls } = await runArts({ payloads: [extra] })
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
  assert.equal(
    result.criterios_evaluados.some((c) => c.criterio_id === "99"),
    false,
  )
  const scored = calculateMechanicalDevelopmentScore({
    criteriosEvaluados: result.criterios_evaluados,
    respuestasDesarrollo: {},
    rubrica: RUBRIC_5,
    puntajeTotal: 15,
    plan: PLAN,
  })
  assert.equal(scored.puntaje.endsWith("/15"), true)
})

test("T8 ambiguous → repair", async () => {
  const ambRubric = [
    "1. Dominio Técnico y Textura",
    "2. Dominio Técnico y Textura",
  ].join("\n")
  const amb = jsonEvidence([
    { criterion_id: "x", criterion_label: "Dominio Técnico y Textura" },
  ])
  const repair = jsonEvidence([
    { criterion_id: "1", criterion_label: "Dominio Técnico y Textura" },
    { criterion_id: "2", criterion_label: "Dominio Técnico y Textura" },
  ])
  const { result, calls, captured } = await runArts({
    payloads: [amb, repair],
    rubric: ambRubric,
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 2)
  assert.ok(captured[1]!.prompt.includes("Ambiguos:"))
})

test("T9 N=1", async () => {
  const rubric = rubricN(1)
  const built = buildMultimodalArtsPrompt(promptInput(rubric))
  assert.equal(built.slot_count, 1)
  assert.equal((built.prompt.match(/^SLOT \d+:/gm) || []).length, 1)
  const { result, calls } = await runArts({
    payloads: [healthyN(1)],
    rubric,
  })
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 1)
})

test("T10 N=3", async () => {
  const rubric = rubricN(3)
  const built = buildMultimodalArtsPrompt(promptInput(rubric))
  assert.equal(built.slot_count, 3)
  assert.equal((built.prompt.match(/^SLOT \d+:/gm) || []).length, 3)
  assert.doesNotMatch(built.prompt, /criterio aplicable/)
  const { result, calls } = await runArts({
    payloads: [healthyN(3)],
    rubric,
  })
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 3)
})

test("T11 N=5 slots dinámicos", async () => {
  const built = buildMultimodalArtsPrompt(promptInput(RUBRIC_5))
  assert.equal(built.slot_count, 5)
  assert.equal((built.prompt.match(/^SLOT \d+:/gm) || []).length, 5)
  assert.ok(built.prompt.includes("N=5"))
  assert.doesNotMatch(built.prompt, /"criterion_id": "id estable de la rúbrica"/)
})

test("T12 N=8", async () => {
  const rubric = rubricN(8)
  const built = buildMultimodalArtsPrompt(promptInput(rubric))
  assert.equal(built.slot_count, 8)
  assert.equal((built.prompt.match(/^SLOT \d+:/gm) || []).length, 8)
  const { result, calls } = await runArts({
    payloads: [healthyN(8)],
    rubric,
  })
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 8)
})

test("T13 same images repair", async () => {
  const { captured, calls } = await runArts({
    payloads: [oneOfN(5), healthyN(5)],
  })
  assert.equal(calls, 2)
  assert.deepEqual(captured[0]!.imageIds, captured[1]!.imageIds)
  assert.deepEqual(captured[0]!.imageIds, ["img_1"])
})

test("T14 multi-image 3 vistas, mismas en repair", async () => {
  const imgs = imagesFor("stuA", 3)
  const ids = imgs.map((im) => im.image_id)
  const { result, calls, captured } = await runArts({
    payloads: [oneOfN(5, ids), healthyN(5, ids)],
    images: imgs,
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.deepEqual(captured[0]!.imageIds, ids)
  assert.deepEqual(captured[1]!.imageIds, ids)
  assert.equal(captured[0]!.imageIds.length, 3)
})

test("T15 individual 1→5", async () => {
  const { result, calls } = await runArts({
    payloads: [oneOfN(5), healthyN(5)],
    subject: "individual",
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
})

test("T16 batch 1→5 (mismo motor)", async () => {
  const { result, calls } = await runArts({
    payloads: [oneOfN(5), healthyN(5)],
    subject: "batch",
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.equal(result.criterios_evaluados.length, 5)
})

test("T17 individual/batch parity", async () => {
  const ind = await runArts({ payloads: [oneOfN(5), healthyN(5)] })
  const batch = await runArts({ payloads: [oneOfN(5), healthyN(5)] })
  assert.equal(ind.result.ok, batch.result.ok)
  assert.equal(ind.calls, batch.calls)
  assert.deepEqual(
    ind.result.criterios_evaluados.map((c) => c.criterio_id),
    batch.result.criterios_evaluados.map((c) => c.criterio_id),
  )
  const client = readSrc("app/EvaluatorClient.tsx")
  assert.match(client, /handleEvaluateSingleGroup/)
  assert.match(client, /handleEvaluateGroupsSequential/)
  assert.ok(
    client.indexOf("handleEvaluateGroupsSequential") >
      client.indexOf("const handleEvaluateSingleGroup"),
  )
})

test("T18 3-student mixed lot", async () => {
  const aImgs = imagesFor("A", 1)
  const bImgs = imagesFor("B", 1)
  const cImgs = imagesFor("C", 1)
  const a = await runArts({
    payloads: [oneOfN(5, ["A_img_1"]), healthyN(5, ["A_img_1"])],
    images: aImgs,
    subject: "A",
  })
  const b = await runArts({
    payloads: [healthyN(5, ["B_img_1"])],
    images: bImgs,
    subject: "B",
  })
  const c = await runArts({
    payloads: [
      jsonEvidence(
        LABELS_5.slice(0, 4).map((label, i) => ({
          criterion_id: String(i + 1),
          criterion_label: label,
        })),
        ["C_img_1"],
      ),
      healthyN(5, ["C_img_1"]),
    ],
    images: cImgs,
    subject: "C",
  })
  assert.equal(a.result.ok && b.result.ok && c.result.ok, true)
  assert.equal(a.result.criterios_evaluados.length, 5)
  assert.equal(b.result.criterios_evaluados.length, 5)
  assert.equal(c.result.criterios_evaluados.length, 5)
  assert.equal(a.calls, 2)
  assert.equal(b.calls, 1)
  assert.equal(c.calls, 2)
})

test("T19 20-job isolation", async () => {
  const jobs = []
  for (let i = 0; i < 20; i++) {
    const sid = `J${i}`
    const imgs = imagesFor(sid, 1)
    const kind = i % 4
    const payloads =
      kind === 0
        ? [healthyN(5, [`${sid}_img_1`])]
        : kind === 1
          ? [oneOfN(5, [`${sid}_img_1`]), healthyN(5, [`${sid}_img_1`])]
          : kind === 2
            ? [
                jsonEvidence(
                  LABELS_5.slice(0, 4).map((label, j) => ({
                    criterion_id: String(j + 1),
                    criterion_label: label,
                  })),
                  [`${sid}_img_1`],
                ),
                healthyN(5, [`${sid}_img_1`]),
              ]
            : [
                jsonEvidence(
                  [
                    { criterion_id: "5", criterion_label: LABELS_5[4]! },
                    { criterion_id: "4", criterion_label: LABELS_5[3]! },
                    { criterion_id: "3", criterion_label: LABELS_5[2]! },
                    { criterion_id: "2", criterion_label: LABELS_5[1]! },
                    { criterion_id: "1", criterion_label: LABELS_5[0]! },
                  ],
                  [`${sid}_img_1`],
                ),
              ]
    jobs.push(await runArts({ payloads, images: imgs, subject: sid }))
  }
  for (let i = 0; i < 20; i++) {
    assert.equal(jobs[i]!.result.ok, true, `job ${i}`)
    assert.equal(jobs[i]!.result.criterios_evaluados.length, 5, `job ${i}`)
    const kind = i % 4
    if (kind === 0 || kind === 3) assert.equal(jobs[i]!.calls, 1, `job ${i} healthy/reorder`)
    else assert.equal(jobs[i]!.calls, 2, `job ${i} repair`)
  }
})

test("T20 no cross-student state", async () => {
  const a = await runArts({
    payloads: [oneOfN(5, ["A_img_1"]), healthyN(5, ["A_img_1"])],
    images: imagesFor("A"),
    subject: "A",
  })
  const b = await runArts({
    payloads: [healthyN(5, ["B_img_1"])],
    images: imagesFor("B"),
    subject: "B",
  })
  assert.equal(b.calls, 1)
  assert.deepEqual(b.captured[0]!.imageIds, ["B_img_1"])
  assert.equal(b.captured[0]!.imageIds.includes("A_img_1"), false)
  assert.doesNotMatch(b.captured[0]!.prompt, /REPAIR PEDAGÓGICO/)
  assert.ok(a.captured[1]!.prompt.includes("Faltaron:"))
  assert.equal(b.captured[0]!.prompt.includes(a.captured[1]!.prompt), false)
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  assert.doesNotMatch(arts, /let missingIds\s*=/)
  assert.doesNotMatch(arts, /globalThis/)
})

test("T21 timeout fallback PRE≡POST", async () => {
  const { result, calls } = await runArts({
    payloads: [new Error("ERROR_MISTRAL_TIMEOUT")],
  })
  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, true)
  assert.equal(result.diagnostics.includes("multimodal_incomplete_rubric"), false)
  assert.equal(result.diagnostics.includes("pedagogical_repair:full_informed"), false)
})

test("T22 5xx fallback PRE≡POST", async () => {
  const { result, calls } = await runArts({ payloads: [new Error("HTTP 503")] })
  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, true)
  assert.equal(result.diagnostics.includes("pedagogical_repair:full_informed"), false)
})

test("T23 malformed PRE≡POST", async () => {
  const { result, calls } = await runArts({ payloads: ["NOT-JSON {{{"] })
  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, true)
  assert.ok(result.diagnostics.includes("multimodal_json_parse_failed"))
  assert.equal(result.diagnostics.includes("pedagogical_repair:full_informed"), false)
})

test("T24 flag OFF PRE≡POST", async () => {
  const { result, calls } = await runArts({
    payloads: [healthyN(5)],
    enabled: false,
  })
  assert.equal(calls, 0)
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, true)
  assert.ok(result.diagnostics.includes("multimodal_flag_or_gate_off"))
})

test("T25 healthy model calls=1", async () => {
  const { calls } = await runArts({ payloads: [healthyN(5)] })
  assert.equal(calls, 1)
})

test("T26 incomplete max calls=2", async () => {
  const { calls, result } = await runArts({
    payloads: [oneOfN(5), oneOfN(5), healthyN(5)],
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, false)
})

test("T27 A5 final safety", async () => {
  const { result } = await runArts({ payloads: [oneOfN(5), oneOfN(5)] })
  assert.equal(result.ok, false)
  assert.equal(result.fallback_recommended, false)
  assert.equal(result.criterios_evaluados.length, 0)
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  const i422 = logic.indexOf("status: 422")
  const iCaminoA = logic.indexOf("if (!multimodalArtsSucceeded) for")
  assert.ok(i422 > 0 && i422 < iCaminoA)
})

test("T28 no scoring before N/N", async () => {
  const { result } = await runArts({ payloads: [oneOfN(5), oneOfN(5)] })
  assert.equal(result.criterios_evaluados.length, 0)
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  const gate = arts.indexOf("assessArtsRubricCompleteness")
  const adapt = arts.indexOf("adaptMultimodalEvidenceToCriteriosEvaluados(")
  assert.ok(gate > 0 && adapt > gate)
  assert.doesNotMatch(arts, /calculateMechanicalDevelopmentScore|LEVEL_TO_FRACTION/)
})

test("T29 no persistence before N/N", async () => {
  const { result } = await runArts({ payloads: [oneOfN(5), oneOfN(5)] })
  assert.equal(result.ok, false)
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  const prompt = readSrc("app/lib/multimodal/multimodal-prompt.ts")
  assert.doesNotMatch(arts, /persistEvaluation/)
  assert.doesNotMatch(prompt, /persistEvaluation/)
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  assert.ok(logic.indexOf("status: 422") < logic.indexOf("await persistEvaluation("))
})

test("T30 no double credit", async () => {
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  const prompt = readSrc("app/lib/multimodal/multimodal-prompt.ts")
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  assert.doesNotMatch(arts, /useOneCredit|credits\/consumir|consume_credits/)
  assert.doesNotMatch(prompt, /useOneCredit|credits\/consumir|consume_credits/)
  assert.equal((logic.match(/await runMultimodalArtsEvaluation\(/g) || []).length, 1)
  assertHashUnchanged("app/lib/credits.ts")
  assertHashUnchanged("app/api/credits/consumir/route.ts")
})

test("T31 Camino A untouched", () => {
  assertHashUnchanged("app/api/evaluate/evaluation-logic.ts")
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  assert.match(logic, /analyzeWithMistralVision/)
})

test("T32 Multimodal general untouched", () => {
  assertHashUnchanged("app/lib/ai-evaluation-provider.ts")
  assertHashUnchanged("app/lib/multimodal/flag.ts")
})

test("T33 Development untouched", () => {
  assertHashUnchanged("app/lib/development-core/development-criteria-core.ts")
  assertHashUnchanged("app/lib/development-core/parse-rubric-criteria.ts")
})

test("T34 M8 untouched", () => {
  assertHashUnchanged("app/lib/multimodal/multimodal-vision-provider.ts")
  assertHashUnchanged("app/lib/__tests__/multimodal-m8-multiview.test.ts")
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  assert.equal((arts.match(/requestMultimodalArtsVision\(/g) || []).length, 1)
  assert.doesNotMatch(arts, /requestEvaluationVisionCompletionMulti/)
})

test("T35 scoring untouched", () => {
  assertHashUnchanged("app/lib/desarrollo-pipeline.ts")
  assertHashUnchanged("app/lib/scoring/chileanGradeEngine.ts")
})

test("T36 persistence untouched", () => {
  assertHashUnchanged("app/lib/persist-evaluation.ts")
})

test("T37 B1 untouched", () => {
  assertHashUnchanged("app/lib/persist-evaluation.ts")
})

test("T38 Course Contexts untouched", () => {
  assertHashUnchanged("app/lib/course-contexts/flag.ts")
  assertHashUnchanged("app/lib/course-contexts/store.ts")
  assertHashUnchanged("app/lib/course-contexts/helpers.ts")
})

test("T39 QR untouched", () => {
  assertHashUnchanged("app/(main)/docente/movil-scan/MovilScanClient.tsx")
  assertHashUnchanged("app/lib/docente/batch-slot-link.ts")
})

test("T40 OMR/BLANK/SCALE untouched", () => {
  assertHashUnchanged("app/lib/omr-libelia-reader.ts")
  assertHashUnchanged("app/lib/omr-shared/azure-visual-blank-rescue.ts")
  assertHashUnchanged("app/lib/omr-shared/azure-visual-blank-rescue-n2.ts")
  assertHashUnchanged("app/lib/standard-scale/converters.ts")
  assertHashUnchanged("app/lib/standard-scale-converters.ts")
})

test("T-extra identity parseRubricCriteria + repair informed + no fuzzy", () => {
  const parsed = parseRubricCriteria(RUBRIC_5)
  assert.equal(parsed.criteria.length, 5)
  assert.deepEqual(
    parsed.criteria.map((c) => c.criterion_id),
    ["1", "2", "3", "4", "5"],
  )
  assert.ok(parsed.criteria.every((c) => c.criterion_id_source === "explicit_rubric_id"))
  const first = buildMultimodalArtsPrompt(promptInput(RUBRIC_5))
  const repair = buildMultimodalArtsRepairPrompt({
    ...promptInput(RUBRIC_5),
    completeness: {
      expectedCount: 5,
      missing: ["2", "3", "4", "5"],
      duplicates: [],
      extras: [],
      ambiguous: [],
      matched: 1,
    },
  })
  assert.ok(repair.prompt.startsWith("REPAIR PEDAGÓGICO"))
  assert.ok(repair.prompt.includes("IDs esperados: 1,2,3,4,5"))
  assert.ok(repair.prompt.includes("Faltaron: 2,3,4,5"))
  assert.ok(repair.prompt.includes(first.prompt))
  const rubric = parsed.criteria
  const c = assessArtsRubricCompleteness(rubric, [
    {
      criterion_id: "x",
      criterion_label: "Dominio técnico",
      observed_content: ["obs"],
      observation_status: "OBSERVED",
      confidence: "MEDIUM",
      inference_used: false,
      source_image_ids: ["img_1"],
      justification: "j",
      nivel_logro: "PARCIALMENTE_LOGRADO",
    },
  ])
  assert.equal(c.complete, false)
  assert.equal(c.matched, 0)
})

test("T-extra EvaluatorClient / worker / package no tocados", () => {
  assertHashUnchanged("app/EvaluatorClient.tsx")
  assertHashUnchanged("app/hooks/useEvaluator.ts")
  assertHashUnchanged("app/useEvaluator.ts")
  assertHashUnchanged("app/lib/evaluation-job-runner.ts")
  assertHashUnchanged("package.json")
  assertHashUnchanged("package-lock.json")
  assertHashUnchanged("supabase/schema.sql")
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
  console.log(`\nA7-FULL-RUBRIC: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed) process.exit(1)
}

void main()
