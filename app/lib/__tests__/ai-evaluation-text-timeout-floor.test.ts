/**
 * AI-RESILIENCE-A2 — Piso 40s SOLO en requestEvaluationTextCompletion.
 * OFFLINE. Sin Azure/OMR/Railway/Supabase prod. Fetch mockeado.
 *
 * Ejecutar: npx tsx app/lib/__tests__/ai-evaluation-text-timeout-floor.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  EVALUATION_TEXT_TIMEOUT_FLOOR_MS,
  EvaluationIaUnavailableError,
  requestEvaluationTextCompletion,
  requestEvaluationVisionCompletion,
  resolveEvaluationTextTimeoutMs,
  DEFAULT_EVALUATION_PROVIDER_TRACE,
} from "../ai-evaluation-provider"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = path.resolve(__dirname, "../../..")
const PROVIDER_SRC = path.resolve(__dirname, "../ai-evaluation-provider.ts")
const EVAL_LOGIC_SRC = path.resolve(__dirname, "../../api/evaluate/evaluation-logic.ts")
const DEV_CORE_SRC = path.resolve(__dirname, "../development-core/development-criteria-core.ts")
const ARTS_SRC = path.resolve(__dirname, "../multimodal/evaluate-multimodal-arts.ts")
const ARTS_VISION_SRC = path.resolve(__dirname, "../multimodal/multimodal-vision-provider.ts")
const N1_SRC = path.resolve(__dirname, "../omr-shared/azure-visual-blank-rescue.ts")
const N2_SRC = path.resolve(__dirname, "../omr-shared/azure-visual-blank-rescue-n2.ts")
const PERSIST_HEAD = path.resolve(ROOT, "app/lib/persist-evaluation.ts")
const SELECTIVE_RETRY_SRC = path.resolve(__dirname, "../../useEvaluator.ts")

const OK_TEXT_BODY = JSON.stringify({
  id: "cmpl-a2-text",
  choices: [{ message: { content: '{"ok":true,"item":"P1"}' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
})
const OK_VISION_BODY = JSON.stringify({
  id: "cmpl-a2-vision",
  choices: [{ message: { content: '{"ok":true,"vision":true}' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
})

function readSrc(p: string): string {
  return fs.readFileSync(p, "utf8")
}

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

type FetchCall = { url: string; body: unknown; abortMs: number[] }

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } })
}

async function withMistralEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevMistral = process.env.MISTRAL_API_KEY
  const prevAnthropic = process.env.ANTHROPIC_API_KEY
  const prevFallback = process.env.AI_FALLBACK_PROVIDER
  process.env.MISTRAL_API_KEY = "test-mistral-key-a2"
  delete process.env.ANTHROPIC_API_KEY
  process.env.AI_FALLBACK_PROVIDER = "off"
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

function installTimeoutSpy(opts: { fireAbortImmediately?: boolean }): {
  abortMs: number[]
  restore: () => void
} {
  const origSetTimeout = globalThis.setTimeout
  const origClearTimeout = globalThis.clearTimeout
  const abortMs: number[] = []
  const pending = new Set<ReturnType<typeof origSetTimeout>>()
  globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const delay = typeof ms === "number" ? ms : 0
    if (delay >= 10_000) {
      abortMs.push(delay)
      if (opts.fireAbortImmediately) {
        const id = origSetTimeout(fn as (...a: unknown[]) => void, 0, ...args)
        pending.add(id)
        return id
      }
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
  opts?: { fireAbortImmediately?: boolean },
): Promise<{ result: T; abortMs: number[]; calls: FetchCall[] }> {
  const origFetch = globalThis.fetch
  const spy = installTimeoutSpy({ fireAbortImmediately: opts?.fireAbortImmediately === true })
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
    calls.push({ url, body, abortMs: spy.abortMs.slice() })
    if (init?.signal?.aborted) {
      const err = new Error("The operation was aborted")
      err.name = "AbortError"
      throw err
    }
    return handler(url, init)
  }) as typeof fetch
  try {
    const result = await fn()
    return { result, abortMs: spy.abortMs.slice(), calls }
  } finally {
    globalThis.fetch = origFetch
    spy.restore()
  }
}

function hangingFetch(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const onAbort = () => {
      const err = new Error("The operation was aborted")
      err.name = "AbortError"
      reject(err)
    }
    if (init?.signal?.aborted) onAbort()
    else init?.signal?.addEventListener("abort", onAbort, { once: true })
  })
}

test("T1 timeout solicitado 25s → efectivo 40s", () => {
  assert.equal(resolveEvaluationTextTimeoutMs(25_000), 40_000)
  assert.equal(EVALUATION_TEXT_TIMEOUT_FLOOR_MS, 40_000)
})

test("T2 timeout solicitado 30s → efectivo 40s", () => {
  assert.equal(resolveEvaluationTextTimeoutMs(30_000), 40_000)
})

test("T3 timeout solicitado 40s → 40s", () => {
  assert.equal(resolveEvaluationTextTimeoutMs(40_000), 40_000)
})

test("T4 timeout solicitado 90s → 90s", () => {
  assert.equal(resolveEvaluationTextTimeoutMs(90_000), 90_000)
})

test("T1-T4 integración: abort timer real 25/30/40/90", async () => {
  await withMistralEnv(async () => {
    const cases: Array<{ requested: number | undefined; expected: number }> = [
      { requested: 25_000, expected: 40_000 },
      { requested: 30_000, expected: 40_000 },
      { requested: 40_000, expected: 40_000 },
      { requested: 90_000, expected: 90_000 },
      { requested: undefined, expected: 40_000 },
    ]
    for (const c of cases) {
      const { abortMs } = await withMockedFetch(
        async () => jsonResponse(200, OK_TEXT_BODY),
        () =>
          requestEvaluationTextCompletion({
            prompt: "ping",
            maxTokens: 16,
            timeoutMs: c.requested,
          }),
      )
      assert.equal(abortMs[0], c.expected, `requested=${String(c.requested)}`)
    }
  })
})

test("T5 respuesta Mistral normal: payload/modelo/trace PRE≡POST", async () => {
  await withMistralEnv(async () => {
    const { result, calls } = await withMockedFetch(
      async () => jsonResponse(200, OK_TEXT_BODY),
      () =>
        requestEvaluationTextCompletion({
          prompt: "evalúa P1",
          maxTokens: 8192,
          temperature: 0.1,
          timeoutMs: 25_000,
        }),
    )
    assert.equal(result.content, '{"ok":true,"item":"P1"}')
    assert.deepEqual(result.trace, DEFAULT_EVALUATION_PROVIDER_TRACE)
    assert.equal(result.trace.provider_used, "mistral")
    assert.equal(calls.length, 1)
    const body = calls[0]!.body as Record<string, unknown>
    assert.equal(body.model, "mistral-large-latest")
    assert.deepEqual(body.messages, [{ role: "user", content: "evalúa P1" }])
    assert.equal(body.temperature, 0.1)
    assert.deepEqual(body.response_format, { type: "json_object" })
    assert.equal(body.max_tokens, 8192)
    assert.match(calls[0]!.url, /api\.mistral\.ai\/v1\/chat\/completions/)
  })
})

test("T6 401/403: fallback existente (sin Anthropic) PRE≡POST", async () => {
  await withMistralEnv(async () => {
    for (const status of [401, 403]) {
      await assert.rejects(
        () =>
          withMockedFetch(
            async () => jsonResponse(status, "unauthorized billing"),
            () =>
              requestEvaluationTextCompletion({
                prompt: "x",
                maxTokens: 16,
                timeoutMs: 25_000,
              }),
          ),
        (e: unknown) => {
          assert.ok(e instanceof EvaluationIaUnavailableError)
          assert.equal(e.provider_trace.provider_used, "mistral")
          assert.equal(e.provider_trace.provider_fallback_reason, "mistral_unauthorized")
          assert.equal(e.provider_trace.provider_error_stage, "mistral")
          assert.equal(e.provider_trace.anthropic_attempted, false)
          return true
        },
      )
    }
  })
})

test("T7 429: retry existente PRE≡POST", async () => {
  await withMistralEnv(async () => {
    let n = 0
    const { result, calls } = await withMockedFetch(async () => {
      n += 1
      if (n < 3) return jsonResponse(429, "rate limited")
      return jsonResponse(200, OK_TEXT_BODY)
    }, () =>
      requestEvaluationTextCompletion({
        prompt: "x",
        maxTokens: 16,
        timeoutMs: 25_000,
      }),
    )
    assert.equal(n, 3)
    assert.equal(calls.length, 3)
    assert.equal(result.content, '{"ok":true,"item":"P1"}')
    assert.equal(result.trace.provider_used, "mistral")
  })
})

test("T8 502/503: retry existente PRE≡POST", async () => {
  await withMistralEnv(async () => {
    for (const status of [502, 503]) {
      let n = 0
      const { result, calls } = await withMockedFetch(async () => {
        n += 1
        if (n === 1) return jsonResponse(status, "upstream")
        return jsonResponse(200, OK_TEXT_BODY)
      }, () =>
        requestEvaluationTextCompletion({
          prompt: "x",
          maxTokens: 16,
        }),
      )
      assert.equal(n, 2)
      assert.equal(calls.length, 2)
      assert.equal(result.trace.provider_used, "mistral")
      assert.equal(result.content, '{"ok":true,"item":"P1"}')
    }
  })
})

test("T9 timeout >40s: sigue produciendo ERROR_MISTRAL_TIMEOUT", async () => {
  await withMistralEnv(async () => {
    await assert.rejects(
      () =>
        withMockedFetch(
          async (_url, init) => hangingFetch(init),
          () =>
            requestEvaluationTextCompletion({
              prompt: "x",
              maxTokens: 16,
              timeoutMs: 25_000,
            }),
          { fireAbortImmediately: true },
        ),
      (e: unknown) => {
        assert.ok(e instanceof Error)
        assert.equal(e.message, "ERROR_MISTRAL_TIMEOUT")
        assert.equal(e instanceof EvaluationIaUnavailableError, false)
        return true
      },
    )
  })
})

test("T10 malformed response: comportamiento PRE≡POST", async () => {
  await withMistralEnv(async () => {
    await assert.rejects(
      () =>
        withMockedFetch(
          async () => jsonResponse(200, JSON.stringify({ id: "x", choices: [] })),
          () =>
            requestEvaluationTextCompletion({
              prompt: "x",
              maxTokens: 16,
            }),
        ),
      (e: unknown) => {
        assert.ok(e instanceof Error)
        assert.equal(e.message, "Respuesta vacía de Mistral")
        return true
      },
    )
  })
})

test("T11 visión: timeout sigue exactamente 40s y flujo intacto", async () => {
  await withMistralEnv(async () => {
    const { result, abortMs, calls } = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestEvaluationVisionCompletion({
          imageBase64: "aaaa",
          prompt: "lee imagen",
          maxTokens: 4096,
          timeoutMs: 40_000,
        }),
    )
    assert.equal(abortMs[0], 40_000)
    assert.equal(result.content, '{"ok":true,"vision":true}')
    assert.equal(result.trace.provider_used, "mistral")
    const body = calls[0]!.body as Record<string, unknown>
    assert.equal(body.model, "pixtral-12b-2409")
    assert.deepEqual(body.response_format, { type: "json_object" })

    const low = await withMockedFetch(
      async () => jsonResponse(200, OK_VISION_BODY),
      () =>
        requestEvaluationVisionCompletion({
          imageBase64: "aaaa",
          prompt: "lee imagen",
          maxTokens: 16,
          timeoutMs: 25_000,
        }),
    )
    assert.equal(low.abortMs[0], 25_000, "visión NO recibe el piso de texto")
  })
})

test("T12 Artes: flujo intacto (visión, no texto)", () => {
  const arts = readSrc(ARTS_SRC)
  const vision = readSrc(ARTS_VISION_SRC)
  assert.match(arts, /requestEvaluationVisionCompletion|requestMultimodalArtsVision/)
  assert.doesNotMatch(arts, /requestEvaluationTextCompletion/)
  assert.match(vision, /requestEvaluationVisionCompletion/)
  assert.doesNotMatch(vision, /requestEvaluationTextCompletion/)
  assert.match(vision, /MULTIMODAL_VISION_TIMEOUT_MS = 40_000/)
  assert.match(vision, /timeoutMs: params\.timeoutMs \?\? MULTIMODAL_VISION_TIMEOUT_MS/)
})

test("T13 PDF/Word: usa nuevo piso vía analyzeWithMistralText", () => {
  const src = readSrc(EVAL_LOGIC_SRC)
  const code = codeOnly(src)
  assert.match(src, /async function analyzeWithMistralText/)
  assert.match(code, /requestEvaluationTextCompletion\(\{/)
  assert.match(code, /timeoutMs:\s*MISTRAL_FETCH_TIMEOUT_MS/)
  assert.match(src, /Evalúa usando solo el texto extraído por Azure \(PDF\/Word/)
  const provider = readSrc(PROVIDER_SRC)
  assert.match(provider, /resolveEvaluationTextTimeoutMs\(params\.timeoutMs\)/)
  assert.match(provider, /EVALUATION_TEXT_TIMEOUT_FLOOR_MS = 40_000/)
})

test("T14 Mixtas: una sola llamada texto Azure; sin doble scoring/persistencia", () => {
  const src = readSrc(EVAL_LOGIC_SRC)
  const azureBlock = src.slice(src.indexOf("if (useAzurePath)"), src.indexOf("combinedAnalysis = await analyzeWithMistralText"))
  const after = src.slice(src.indexOf("combinedAnalysis = await analyzeWithMistralText"))
  const firstClose = after.indexOf("} catch (e: unknown) {")
  const callBlock = after.slice(0, firstClose)
  assert.equal((callBlock.match(/analyzeWithMistralText\(/g) || []).length, 1)
  assert.doesNotMatch(callBlock, /persistEvaluation|saveEvaluation/)
  assert.doesNotMatch(azureBlock, /analyzeWithMistralText\(/)
})

test("T15 OMR: no entra en este cambio", () => {
  const src = readSrc(EVAL_LOGIC_SRC)
  const n1 = readSrc(N1_SRC)
  const n2 = readSrc(N2_SRC)
  assert.match(src, /async function fetchMistralWithRetry/)
  assert.doesNotMatch(n1, /requestEvaluationTextCompletion/)
  assert.doesNotMatch(n2, /requestEvaluationTextCompletion/)
  assert.doesNotMatch(n1, /ai-evaluation-provider/)
  assert.doesNotMatch(n2, /ai-evaluation-provider/)
  const omrVision = src.slice(src.indexOf("const res = await fetchMistralWithRetry("))
  assert.match(omrVision.slice(0, 800), /pixtral-12b-2409/)
})

test("T16 N1/N2: no entra en este cambio", () => {
  const n1 = readSrc(N1_SRC)
  const n2 = readSrc(N2_SRC)
  assert.doesNotMatch(n1, /resolveEvaluationTextTimeoutMs|EVALUATION_TEXT_TIMEOUT_FLOOR_MS/)
  assert.doesNotMatch(n2, /resolveEvaluationTextTimeoutMs|EVALUATION_TEXT_TIMEOUT_FLOOR_MS/)
  assert.doesNotMatch(n1, /requestEvaluationTextCompletion|requestEvaluationVisionCompletion/)
  assert.doesNotMatch(n2, /requestEvaluationTextCompletion|requestEvaluationVisionCompletion/)
})

test("T17 P0: persistencia no tocada por A2", () => {
  const persist = readSrc(PERSIST_HEAD)
  assert.doesNotMatch(persist, /ai-evaluation-provider|requestEvaluationTextCompletion|EVALUATION_TEXT_TIMEOUT_FLOOR/)
})

test("T18 SCALE-R3: useEvaluator no tocado por A2", () => {
  const src = readSrc(SELECTIVE_RETRY_SRC)
  assert.doesNotMatch(src, /ai-evaluation-provider|requestEvaluationTextCompletion|EVALUATION_TEXT_TIMEOUT_FLOOR/)
})

test("lab 90s conserva 90s; visión no usa el piso; fetchMistralWithRetry global intacto", () => {
  const lab = readSrc(DEV_CORE_SRC)
  assert.match(lab, /timeoutMs: Number\(process\.env\.DEVELOPMENT_CORE_LAB_TIMEOUT_MS \?\? "90000"\) \|\| 90_000/)
  assert.equal(resolveEvaluationTextTimeoutMs(90_000), 90_000)
  const provider = codeOnly(readSrc(PROVIDER_SRC))
  assert.match(provider, /timeoutMs: params\.timeoutMs \?\? MISTRAL_FETCH_TIMEOUT_MS_VISION/)
  assert.doesNotMatch(
    provider.slice(provider.indexOf("async function fetchMistralWithRetry")),
    /EVALUATION_TEXT_TIMEOUT_FLOOR_MS/,
  )
  const fetchFn = provider.slice(
    provider.indexOf("async function fetchMistralWithRetry"),
    provider.indexOf("function anthropicEvaluationModel"),
  )
  assert.doesNotMatch(fetchFn, /Math\.max/)
  assert.match(fetchFn, /options\?\.timeoutMs \?\? MISTRAL_FETCH_TIMEOUT_MS/)
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
  console.log(`\nAI-RESILIENCE-A2: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void run()
