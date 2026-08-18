/**
 * M8 — Dos vistas del mismo trabajo (Camino B). OFFLINE. Fetch mockeado.
 * Sin Pixtral/Anthropic reales, sin créditos, sin Supabase/Redis/Railway.
 *
 * Ejecutar: npx tsx app/lib/__tests__/multimodal-m8-multiview.test.ts
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  buildAnthropicVisionMultiMessageContent,
  buildMistralVisionMultiMessageContent,
  requestEvaluationVisionCompletion,
  requestEvaluationVisionCompletionMulti,
} from "../ai-evaluation-provider"
import { buildMultimodalArtsPrompt } from "../multimodal/multimodal-prompt"
import {
  requestMultimodalArtsVision,
  selectMultimodalVisionViews,
  selectPrimaryMultimodalImage,
} from "../multimodal/multimodal-vision-provider"
import type { MultimodalArtsImageInput } from "../multimodal/types"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = path.resolve(__dirname, "../../..")
const PRE_DIR = path.join(ROOT, "_audit_multimodal_m8_multiview", "PRE")
const HASHES_PRE = path.join(PRE_DIR, "HASHES-PRE.txt")
const N1_PROMPT_PRE = path.join(PRE_DIR, "N1-PROMPT.txt")
const N1_PAYLOAD_PRE = path.join(PRE_DIR, "N1-VISION-PAYLOAD.json")

const OK_VISION_BODY = JSON.stringify({
  id: "cmpl-m8-vision",
  choices: [{ message: { content: '{"ok":true,"vision":true}' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
})

const OK_ANTHROPIC_BODY = JSON.stringify({
  id: "msg_m8_test",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-6",
  content: [{ type: "text", text: '{"ok":true,"anthropic":true}' }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
})

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

function nImages(n: number): MultimodalArtsImageInput[] {
  return Array.from({ length: n }, (_, i) => ({
    image_id: `img_${i + 1}`,
    order: i,
    base64: `b64-${i + 1}`,
    role: i === n - 1 ? "FINAL" : "UNKNOWN",
  }))
}

function countImageUrl(body: unknown): number {
  const content = (body as { messages?: Array<{ content?: Array<{ type?: string }> }> })?.messages?.[0]
    ?.content
  if (!Array.isArray(content)) return 0
  return content.filter((c) => c.type === "image_url").length
}

function countText(body: unknown): number {
  const content = (body as { messages?: Array<{ content?: Array<{ type?: string }> }> })?.messages?.[0]
    ?.content
  if (!Array.isArray(content)) return 0
  return content.filter((c) => c.type === "text").length
}

type FetchCall = { url: string; body: unknown; status: number }

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } })
}

async function withMistralEnv<T>(fn: () => Promise<T>, opts?: { anthropic?: boolean }): Promise<T> {
  const prevMistral = process.env.MISTRAL_API_KEY
  const prevAnthropic = process.env.ANTHROPIC_API_KEY
  const prevFallback = process.env.AI_FALLBACK_PROVIDER
  process.env.MISTRAL_API_KEY = "test-mistral-key-m8"
  if (opts?.anthropic) {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key-m8"
    process.env.AI_FALLBACK_PROVIDER = "anthropic"
  } else {
    delete process.env.ANTHROPIC_API_KEY
    process.env.AI_FALLBACK_PROVIDER = "off"
  }
  try {
    return await fn()
  } finally {
    if (prevMistral === undefined) delete process.env.MISTRAL_API_KEY
    else process.env.MISTRAL_API_KEY = prevMistral
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prevAnthropic
    if (prevFallback === undefined) delete process.env.AI_FALLBACK_PROVIDER
    else process.env.AI_FALLBACK_PROVIDER = prevFallback
  }
}

function installTimeoutSpy(): { abortMs: number[]; restore: () => void } {
  const origSetTimeout = globalThis.setTimeout
  const origClearTimeout = globalThis.clearTimeout
  const abortMs: number[] = []
  const pending = new Set<ReturnType<typeof origSetTimeout>>()
  globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const delay = typeof ms === "number" ? ms : 0
    if (delay >= 10_000) {
      abortMs.push(delay)
      const id = origSetTimeout(() => {}, 1_000_000)
      pending.add(id)
      return id
    }
    const id = origSetTimeout(fn as (...a: unknown[]) => void, 0, ...args)
    pending.add(id)
    return id
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((id: ReturnType<typeof origSetTimeout>) => {
    pending.delete(id)
    return origClearTimeout(id)
  }) as unknown as typeof clearTimeout
  return {
    abortMs,
    restore() {
      for (const id of pending) origClearTimeout(id)
      pending.clear()
      globalThis.setTimeout = origSetTimeout
      globalThis.clearTimeout = origClearTimeout
    },
  }
}

async function withMockedFetch<T>(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
  fn: () => Promise<T>,
): Promise<{ result: T; abortMs: number[]; calls: FetchCall[] }> {
  const origFetch = globalThis.fetch
  const spy = installTimeoutSpy()
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" || input instanceof URL ? input : input.url)
    let body: unknown = null
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    const res = await handler(url, init)
    calls.push({ url, body, status: res.status })
    return res
  }) as typeof fetch
  try {
    const result = await fn()
    return { result, abortMs: spy.abortMs.slice(), calls }
  } finally {
    globalThis.fetch = origFetch
    spy.restore()
  }
}

function n1PromptInput() {
  return {
    input: {
      item_key: "P1",
      question_text: "Crea un afiche",
      rubric_text:
        "1\tClaridad del mensaje\tExcelente (4 pts): mensaje claro\tBueno (3 pts): casi claro\tRegular (2 pts): parcial\tInsuficiente (1 pts): no se entiende",
      images: [
        {
          image_id: "img_1",
          order: 1,
          base64: "data:image/jpeg;base64,/9j/4AAQ",
          role: "FINAL" as const,
        },
      ],
    },
    imageQuality: [{ image_id: "img_1", available: true, notes: [] as string[] }],
    primaryImageId: "img_1",
    secondaryImageIds: [] as string[],
  }
}

test("T1 N=1 usa exactamente la ruta M4 (payload PRE≡POST)", async () => {
  const prePayload = JSON.parse(fs.readFileSync(N1_PAYLOAD_PRE, "utf8")) as {
    caminoB: unknown
  }
  const prePrompt = fs.readFileSync(N1_PROMPT_PRE, "utf8")
  const built = buildMultimodalArtsPrompt(n1PromptInput())
  assert.equal(built.prompt, prePrompt)

  await withMistralEnv(async () => {
    const { result, calls } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestMultimodalArtsVision({
          images: [{ image_id: "img_1", order: 1, base64: "aaaa", role: "FINAL" }],
          prompt: "lee imagen N=1",
          maxTokens: 4096,
          temperature: 0.1,
          timeoutMs: 40_000,
        }),
    )
    assert.equal(calls.length, 1)
    assert.equal(countImageUrl(calls[0]!.body), 1)
    assert.deepEqual(calls[0]!.body, prePayload.caminoB)
    assert.equal(result.vision_calls, 1)
    assert.equal(result.primary_image_id, "img_1")
    assert.equal(result.secondary_image_ids.length, 0)

    const direct = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestEvaluationVisionCompletion({
          imageBase64: "aaaa",
          prompt: "lee imagen N=1",
          maxTokens: 4096,
          temperature: 0.1,
          timeoutMs: 40_000,
        }),
    )
    assert.deepEqual(direct.calls[0]!.body, calls[0]!.body)
  })
})

test("T2 N=2 produce dos bloques de imagen", async () => {
  await withMistralEnv(async () => {
    const { calls } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestMultimodalArtsVision({
          images: nImages(2),
          prompt: "dos vistas",
          maxTokens: 4096,
        }),
    )
    assert.equal(countImageUrl(calls[0]!.body), 2)
    const content = buildMistralVisionMultiMessageContent(["v1", "v2"], "p")
    assert.equal(content.filter((c) => c.type === "image_url").length, 2)
  })
})

test("T3 N=2 produce UNA sola llamada", async () => {
  await withMistralEnv(async () => {
    const { result, calls } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestMultimodalArtsVision({
          images: nImages(2),
          prompt: "una llamada",
          maxTokens: 4096,
        }),
    )
    assert.equal(calls.length, 1)
    assert.equal(result.vision_calls, 1)
  })
})

test("T4 orden de vistas estable (primera + FINAL)", () => {
  const sel = selectMultimodalVisionViews(nImages(2))
  assert.equal(sel.views.length, 2)
  assert.equal(sel.views[0]!.image_id, "img_1")
  assert.equal(sel.views[1]!.image_id, "img_2")
  assert.equal(sel.views[1]!.role, "FINAL")
  const again = selectMultimodalVisionViews(nImages(2))
  assert.deepEqual(
    again.views.map((v) => v.image_id),
    sel.views.map((v) => v.image_id),
  )
})

test("T5 N=3 cap = 2", async () => {
  const sel = selectMultimodalVisionViews(nImages(3))
  assert.equal(sel.views.length, 2)
  assert.equal(sel.unused.length, 1)
  assert.equal(sel.views[0]!.image_id, "img_1")
  assert.equal(sel.views[1]!.image_id, "img_3")
  assert.equal(sel.unused[0]!.image_id, "img_2")
  await withMistralEnv(async () => {
    const { calls } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () => requestMultimodalArtsVision({ images: nImages(3), prompt: "cap3", maxTokens: 16 }),
    )
    assert.equal(countImageUrl(calls[0]!.body), 2)
    const urls = (calls[0]!.body as { messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> })
      .messages[0]!.content.filter((c) => c.type === "image_url")
      .map((c) => c.image_url!.url)
    assert.ok(urls[0]!.includes("b64-1"))
    assert.ok(urls[1]!.includes("b64-3"))
    assert.equal(urls.some((u) => u.includes("b64-2")), false)
  })
})

test("T6 N=5 cap = 2", async () => {
  const sel = selectMultimodalVisionViews(nImages(5))
  assert.equal(sel.views.length, 2)
  assert.equal(sel.unused.length, 3)
  assert.equal(sel.views[0]!.image_id, "img_1")
  assert.equal(sel.views[1]!.image_id, "img_5")
  await withMistralEnv(async () => {
    const { calls } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () => requestMultimodalArtsVision({ images: nImages(5), prompt: "cap5", maxTokens: 16 }),
    )
    assert.equal(countImageUrl(calls[0]!.body), 2)
  })
})

test("T7 no se duplica prompt", async () => {
  await withMistralEnv(async () => {
    const { calls } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestMultimodalArtsVision({
          images: nImages(2),
          prompt: "PROMPT_UNICO_M8",
          maxTokens: 16,
        }),
    )
    assert.equal(countText(calls[0]!.body), 1)
    const texts = (
      calls[0]!.body as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }
    ).messages[0]!.content.filter((c) => c.type === "text")
    assert.equal(texts[0]!.text, "PROMPT_UNICO_M8")
  })
})

test("T8 no se duplica adapter", () => {
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  assert.equal((arts.match(/adaptMultimodalEvidenceToCriteriosEvaluados\(/g) || []).length, 1)
  assert.equal((arts.match(/requestMultimodalArtsVision\(/g) || []).length, 1)
})

test("T9 no se duplica scoring", () => {
  const vision = readSrc("app/lib/multimodal/multimodal-vision-provider.ts")
  const prompt = readSrc("app/lib/multimodal/multimodal-prompt.ts")
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  assert.doesNotMatch(vision, /applyMechanicalDevelopmentScoreToAnalysis|LEVEL_TO_FRACTION/)
  assert.doesNotMatch(prompt, /applyMechanicalDevelopmentScoreToAnalysis|LEVEL_TO_FRACTION/)
  assert.doesNotMatch(arts, /applyMechanicalDevelopmentScoreToAnalysis|LEVEL_TO_FRACTION/)
})

test("T10 no se duplica persistencia", () => {
  const vision = readSrc("app/lib/multimodal/multimodal-vision-provider.ts")
  const prompt = readSrc("app/lib/multimodal/multimodal-prompt.ts")
  const arts = readSrc("app/lib/multimodal/evaluate-multimodal-arts.ts")
  assert.doesNotMatch(vision, /persistEvaluation/)
  assert.doesNotMatch(prompt, /persistEvaluation/)
  assert.doesNotMatch(arts, /persistEvaluation/)
})

test("T11 fallback Anthropic recibe las mismas 2 vistas", async () => {
  const built = buildAnthropicVisionMultiMessageContent(["AAA", "BBB"], "mismo juicio")
  assert.equal(built.filter((b) => b.type === "image").length, 2)
  assert.equal(built.filter((b) => b.type === "text").length, 1)
  const imgs = built.filter((b) => b.type === "image")
  assert.equal(imgs[0]!.source.data, "AAA")
  assert.equal(imgs[1]!.source.data, "BBB")

  await withMistralEnv(async () => {
    const { result, calls } = await withMockedFetch(
      async (url) => {
        if (url.includes("mistral.ai")) {
          return jsonResponse(401, JSON.stringify({ message: "unauthorized billing" }))
        }
        return jsonResponse(200, OK_ANTHROPIC_BODY)
      },
      () =>
        requestEvaluationVisionCompletionMulti({
          imageBase64List: ["vista-uno", "vista-dos"],
          prompt: "mismo juicio",
          maxTokens: 16,
        }),
    )
    const mistral = calls.filter((c) => String(c.url).includes("mistral.ai"))
    assert.equal(mistral.length, 1)
    assert.equal(countImageUrl(mistral[0]!.body), 2)
    const anthropicCalls = calls.filter((c) => String(c.url).includes("anthropic"))
    assert.ok(anthropicCalls.length >= 1, "debe haber llamada Anthropic de fallback")
    const anthBody = JSON.stringify(anthropicCalls[0]!.body)
    assert.match(anthBody, /vista-uno/)
    assert.match(anthBody, /vista-dos/)
    assert.equal(result.trace.provider_used, "anthropic_fallback")
  }, { anthropic: true })
})

test("T12 401/403/billing conserva fallback existente", async () => {
  const src = readSrc("app/lib/ai-evaluation-provider.ts")
  assert.match(src, /function shouldFallbackFromMistralError/)
  assert.match(src, /requestEvaluationVisionCompletionMulti/)
  assert.match(
    src.slice(src.indexOf("export async function requestEvaluationVisionCompletionMulti")),
    /withAnthropicFallbackOnMistralAuth/,
  )
  await withMistralEnv(async () => {
    await assert.rejects(
      () =>
        withMockedFetch(
          async () => jsonResponse(401, JSON.stringify({ message: "unauthorized" })),
          () =>
            requestEvaluationVisionCompletionMulti({
              imageBase64List: ["a", "b"],
              prompt: "x",
              maxTokens: 8,
            }),
        ),
      (e: unknown) => {
        assert.ok(e instanceof Error)
        return true
      },
    )
  })
})

test("T13 400 multi-image no produce doble evaluación", async () => {
  await withMistralEnv(async () => {
    const { calls } = await withMockedFetch(
      async () => jsonResponse(400, JSON.stringify({ message: "bad request" })),
      async () => {
        await assert.rejects(
          () =>
            requestEvaluationVisionCompletionMulti({
              imageBase64List: ["a", "b"],
              prompt: "x",
              maxTokens: 8,
            }),
          (e: unknown) => e instanceof Error && /Mistral API error: 400/.test(e.message),
        )
      },
    )
    assert.equal(calls.filter((c) => String(c.url).includes("anthropic")).length, 0)
    assert.ok(calls.length >= 1)
    for (const c of calls) {
      assert.match(String(c.url), /mistral\.ai/)
      assert.equal(countImageUrl(c.body), 2)
    }
  })
})

test("T14 timeout NO cambia (N=2 = 40s)", async () => {
  await withMistralEnv(async () => {
    const { abortMs } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestMultimodalArtsVision({
          images: nImages(2),
          prompt: "t",
          maxTokens: 8,
        }),
    )
    assert.equal(abortMs[0], 40_000)
  })
})

test("T15 N=1 timeout PRE≡POST (40s)", async () => {
  await withMistralEnv(async () => {
    const { abortMs } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestMultimodalArtsVision({
          images: nImages(1),
          prompt: "t",
          maxTokens: 8,
          timeoutMs: 40_000,
        }),
    )
    assert.equal(abortMs[0], 40_000)
    const vision = readSrc("app/lib/multimodal/multimodal-vision-provider.ts")
    assert.match(vision, /MULTIMODAL_VISION_TIMEOUT_MS = 40_000/)
  })
})

test("T16 Desarrollo no importa sibling", () => {
  const dev = readSrc("app/lib/desarrollo-pipeline.ts")
  const core = readSrc("app/lib/development-core/development-criteria-core.ts")
  assert.doesNotMatch(dev, /requestEvaluationVisionCompletionMulti/)
  assert.doesNotMatch(core, /requestEvaluationVisionCompletionMulti/)
  assert.doesNotMatch(dev, /selectMultimodalVisionViews/)
})

test("T17 Artes A no importa sibling", () => {
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  assert.doesNotMatch(logic, /requestEvaluationVisionCompletionMulti/)
  assert.match(logic, /requestEvaluationVisionCompletion/)
})

test("T18 Mixtas no importan sibling", () => {
  const logic = readSrc("app/api/evaluate/evaluation-logic.ts")
  assert.doesNotMatch(logic, /buildMistralVisionMultiMessageContent|requestEvaluationVisionCompletionMulti/)
})

test("T19 OMR/N1/N2 no importan sibling", () => {
  const n1 = readSrc("app/lib/omr-shared/azure-visual-blank-rescue.ts")
  const n2 = readSrc("app/lib/omr-shared/azure-visual-blank-rescue-n2.ts")
  const omr = readSrc("app/lib/omr-libelia-reader.ts")
  assert.doesNotMatch(n1, /requestEvaluationVisionCompletionMulti|selectMultimodalVisionViews/)
  assert.doesNotMatch(n2, /requestEvaluationVisionCompletionMulti|selectMultimodalVisionViews/)
  assert.doesNotMatch(omr, /requestEvaluationVisionCompletionMulti|selectMultimodalVisionViews/)
})

test("T20 QR/Móvil no modificados", () => {
  const pre = parsePreHashes()
  for (const rel of [
    "app/(main)/docente/movil-scan/MovilScanClient.tsx",
    "app/escaneo/[batchId]/EstacionMovilClient.tsx",
    "app/lib/docente/batch-slot-link.ts",
    "app/lib/docente/mobile-scan-constants.ts",
  ]) {
    assert.equal(sha256File(rel), pre.get(rel), rel)
  }
})

test("T21 evaluation-logic no modificado", () => {
  const pre = parsePreHashes()
  assert.equal(
    sha256File("app/api/evaluate/evaluation-logic.ts"),
    pre.get("app/api/evaluate/evaluation-logic.ts"),
  )
})

test("T22 scoring no modificado", () => {
  const pre = parsePreHashes()
  assert.equal(sha256File("app/lib/desarrollo-pipeline.ts"), pre.get("app/lib/desarrollo-pipeline.ts"))
})

test("T23 persistencia no modificada", () => {
  const pre = parsePreHashes()
  assert.equal(sha256File("app/lib/persist-evaluation.ts"), pre.get("app/lib/persist-evaluation.ts"))
})

test("T24 M4 niveles siguen intactos", () => {
  const p = buildMultimodalArtsPrompt(n1PromptInput()).prompt
  assert.match(p, /LOGRADO, PARCIALMENTE_LOGRADO, INSUFICIENTE o NO_OBSERVABLE/)
  assert.match(
    p,
    /"nivel_logro": "LOGRADO" \| "PARCIALMENTE_LOGRADO" \| "INSUFICIENTE" \| "NO_OBSERVABLE"/,
  )
  const n2 = buildMultimodalArtsPrompt({
    ...n1PromptInput(),
    input: {
      ...n1PromptInput().input,
      images: nImages(2).map((im, i) => ({
        ...im,
        base64: i === 0 ? "data:image/jpeg;base64,/9j/AAAA" : "data:image/jpeg;base64,/9j/BBBB",
      })),
    },
    imageQuality: [
      { image_id: "img_1", available: true, notes: [] },
      { image_id: "img_2", available: true, notes: [] },
    ],
    primaryImageId: "img_2",
    secondaryImageIds: ["img_1"],
  }).prompt
  assert.match(
    n2,
    /"nivel_logro": "LOGRADO" \| "PARCIALMENTE_LOGRADO" \| "INSUFICIENTE" \| "NO_OBSERVABLE"/,
  )
})

test("T25 dos vistas se describen como mismo objeto", () => {
  const p = buildMultimodalArtsPrompt({
    ...n1PromptInput(),
    input: {
      ...n1PromptInput().input,
      images: nImages(2).map((im, i) => ({
        ...im,
        base64: `data:image/jpeg;base64,/9j/${i}`,
      })),
    },
    imageQuality: [
      { image_id: "img_1", available: true, notes: [] },
      { image_id: "img_2", available: true, notes: [] },
    ],
    primaryImageId: "img_2",
    secondaryImageIds: ["img_1"],
  }).prompt
  assert.match(p, /distintas vistas del MISMO trabajo físico/)
  assert.match(p, /VIEW_1_SENT_TO_VISION/)
  assert.match(p, /VIEW_2_SENT_TO_VISION/)
  assert.doesNotMatch(p, /GENERAL_SENT_TO_VISION|DETAIL_SENT_TO_VISION/)
})

test("T26 prompt prohíbe doble conteo", () => {
  const p = buildMultimodalArtsPrompt({
    ...n1PromptInput(),
    input: {
      ...n1PromptInput().input,
      images: nImages(2).map((im, i) => ({
        ...im,
        base64: `data:image/jpeg;base64,/9j/${i}`,
      })),
    },
    imageQuality: [
      { image_id: "img_1", available: true, notes: [] },
      { image_id: "img_2", available: true, notes: [] },
    ],
    primaryImageId: "img_2",
    secondaryImageIds: ["img_1"],
  }).prompt
  assert.match(p, /No cuentes dos veces un elemento/)
})

test("T27 cantidad de imágenes no altera score directamente", () => {
  const p = buildMultimodalArtsPrompt({
    ...n1PromptInput(),
    input: {
      ...n1PromptInput().input,
      images: nImages(2).map((im, i) => ({
        ...im,
        base64: `data:image/jpeg;base64,/9j/${i}`,
      })),
    },
    imageQuality: [
      { image_id: "img_1", available: true, notes: [] },
      { image_id: "img_2", available: true, notes: [] },
    ],
    primaryImageId: "img_2",
    secondaryImageIds: ["img_1"],
  }).prompt
  assert.match(p, /No otorgues mayor nivel de logro por el simple hecho de existir más fotografías/)
  assert.match(p, /NO calcules puntaje/)
  const vision = readSrc("app/lib/multimodal/multimodal-vision-provider.ts")
  assert.doesNotMatch(vision, /LEVEL_TO_FRACTION|puntaje/)
})

test("T28 rollback snapshots válidos", () => {
  for (const name of [
    "multimodal-vision-provider.ts",
    "multimodal-prompt.ts",
    "ai-evaluation-provider.ts",
    "ROLLBACK.txt",
    "HASHES-PRE.txt",
  ]) {
    const p = path.join(PRE_DIR, name)
    assert.ok(fs.existsSync(p), `falta snapshot ${name}`)
    assert.ok(fs.statSync(p).size > 0, `snapshot vacío ${name}`)
  }
  const rollback = fs.readFileSync(path.join(PRE_DIR, "ROLLBACK.txt"), "utf8")
  assert.match(rollback, /NO git reset/)
  assert.match(rollback, /persist-evaluation/)
})

test("T extra: selectPrimary N>=2 intacto (FINAL primary)", () => {
  const sel = selectPrimaryMultimodalImage([
    { image_id: "process", order: 0, base64: "aaa", role: "PROCESS" },
    { image_id: "final", order: 1, base64: "bbb", role: "FINAL" },
  ])
  assert.equal(sel.primary.image_id, "final")
  assert.equal(sel.secondary.length, 1)
})

test("T extra: wrapper N=1 no mutado (función original presente)", () => {
  const src = readSrc("app/lib/ai-evaluation-provider.ts")
  const start = src.indexOf("export async function requestEvaluationVisionCompletion(")
  const end = src.indexOf("/** Parte image_url idéntica al wrapper N=1")
  const orig = src.slice(start, end)
  assert.match(orig, /params\.imageBase64/)
  assert.match(orig, /visionPart\(params\.imageBase64\)/)
  assert.doesNotMatch(orig, /imageBase64List/)
  assert.doesNotMatch(orig, /buildMistralVisionMultiMessageContent/)
})

async function run(): Promise<void> {
  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`PASS ${t.name}`)
    } catch (err) {
      failed += 1
      console.error(`FAIL ${t.name}`)
      console.error(err)
    }
  }
  console.log(`\nM8-MULTIVIEW: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void run()
