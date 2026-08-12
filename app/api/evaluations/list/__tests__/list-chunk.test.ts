/**
 * EVAL-LIST-CHUNK-B1 — Chunking seguro de `.in("evaluation_id", ids)`.
 * OFFLINE. Sin Supabase prod. Sin Railway. Sin red.
 *
 * Next.js prohíbe exports auxiliares en route.ts → el algoritmo se valida aquí
 * (espejo del helper privado) + contrato de fuente sobre route.ts.
 *
 * Ejecutar: npx tsx app/api/evaluations/list/__tests__/list-chunk.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

/** Espejo del helper privado en route.ts (Next no permite exportarlo). */
const EVALUATION_ID_IN_CHUNK = 100
const EVALUATION_ID_IN_HEADER_SAFE_MAX = 350

function chunkIds<T>(ids: T[], chunkSize: number = EVALUATION_ID_IN_CHUNK): T[][] {
  if (ids.length === 0) return []
  const size = Math.max(1, Math.floor(chunkSize))
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size))
  }
  return out
}

function estimateInFilterBytes(ids: string[]): number {
  if (ids.length === 0) return 0
  const joined = ids.join(",")
  return "evaluation_id=in.(".length + joined.length + 1
}

type ChunkQueryError = { message: string; details?: string | null } | null

async function fetchInEvaluationIdChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<{ data: T[] | null; error: ChunkQueryError }>,
  opts?: { chunkSize?: number; abortOnError?: boolean },
): Promise<{ data: T[]; error: ChunkQueryError; chunkCount: number; maxInFilterBytes: number }> {
  const chunkSize = opts?.chunkSize ?? EVALUATION_ID_IN_CHUNK
  const abortOnError = opts?.abortOnError ?? true
  if (ids.length === 0) {
    return { data: [], error: null, chunkCount: 0, maxInFilterBytes: 0 }
  }
  const chunks = chunkIds(ids, chunkSize)
  const out: T[] = []
  let maxInFilterBytes = 0
  for (const chunk of chunks) {
    maxInFilterBytes = Math.max(maxInFilterBytes, estimateInFilterBytes(chunk))
    const res = await fetchChunk(chunk)
    if (res.error) {
      if (abortOnError) {
        return { data: out, error: res.error, chunkCount: chunks.length, maxInFilterBytes }
      }
      continue
    }
    if (res.data?.length) out.push(...res.data)
  }
  return { data: out, error: null, chunkCount: chunks.length, maxInFilterBytes }
}

function makeIds(n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const hex = i.toString(16).padStart(12, "0")
    out.push(`00000000-0000-4000-8000-${hex}`)
  }
  return out
}

function wouldOverflowHeaders(ids: string[]): boolean {
  return ids.length >= 400 || estimateInFilterBytes(ids) > 14_000
}

type SummaryRow = {
  evaluation_id: string
  grade_chile: number | null
  student_name_raw: string | null
  raw: unknown
}

type StudentRow = {
  evaluation_id: string
  student_name: string | null
}

function buildFixture(ids: string[]): { summaries: SummaryRow[]; students: StudentRow[] } {
  const summaries: SummaryRow[] = ids.map((id, i) => ({
    evaluation_id: id,
    grade_chile: (i % 7) + 1,
    student_name_raw: i % 11 === 0 ? null : `Raw ${i}`,
    raw: null,
  }))
  const students: StudentRow[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    const count = i % 3
    for (let s = 0; s < count; s++) {
      students.push({ evaluation_id: id, student_name: `Alumno ${i}-${String.fromCharCode(65 + s)}` })
    }
  }
  return { summaries, students }
}

function filterByIds<T extends { evaluation_id: string }>(rows: T[], chunk: string[]): T[] {
  const set = new Set(chunk)
  return rows.filter((r) => set.has(r.evaluation_id))
}

async function runChunkedBoth(ids: string[], fixture: ReturnType<typeof buildFixture>) {
  const inCalls: string[][] = []
  const sumRes = await fetchInEvaluationIdChunks<SummaryRow>(
    ids,
    async (chunk) => {
      inCalls.push([...chunk])
      assert.ok(chunk.length <= EVALUATION_ID_IN_CHUNK, `chunk summaries > ${EVALUATION_ID_IN_CHUNK}`)
      assert.ok(!wouldOverflowHeaders(chunk), "chunk summaries overflow")
      return { data: filterByIds(fixture.summaries, chunk), error: null }
    },
    { abortOnError: true },
  )
  const stuRes = await fetchInEvaluationIdChunks<StudentRow>(
    ids,
    async (chunk) => {
      inCalls.push([...chunk])
      assert.ok(chunk.length <= EVALUATION_ID_IN_CHUNK, `chunk students > ${EVALUATION_ID_IN_CHUNK}`)
      assert.ok(!wouldOverflowHeaders(chunk), "chunk students overflow")
      return { data: filterByIds(fixture.students, chunk), error: null }
    },
    { abortOnError: false },
  )
  return { sumRes, stuRes, inCalls }
}

function assertNoDupEvaluationIds(rows: Array<{ evaluation_id: string }>) {
  const seen = new Set<string>()
  for (const r of rows) {
    assert.equal(seen.has(r.evaluation_id), false, `dup summary ${r.evaluation_id}`)
    seen.add(r.evaluation_id)
  }
}

function assertSameMultiset(
  a: Array<{ evaluation_id: string; student_name: string | null }>,
  b: Array<{ evaluation_id: string; student_name: string | null }>,
) {
  const key = (r: { evaluation_id: string; student_name: string | null }) =>
    `${r.evaluation_id}\0${r.student_name ?? ""}`
  const ca = new Map<string, number>()
  const cb = new Map<string, number>()
  for (const r of a) ca.set(key(r), (ca.get(key(r)) ?? 0) + 1)
  for (const r of b) cb.set(key(r), (cb.get(key(r)) ?? 0) + 1)
  assert.equal(ca.size, cb.size)
  for (const [k, v] of ca) assert.equal(cb.get(k), v, `student multiset mismatch ${k}`)
}

const SIZES = [0, 1, 50, 100, 310, 399, 400, 569, 1000] as const
const ROUTE_PATH = path.resolve(__dirname, "../route.ts")

test("contrato fuente route.ts: chunk=100, helpers privados, sin .in monolítico", () => {
  const src = fs.readFileSync(ROUTE_PATH, "utf8")
  // Ignorar comentarios de bloque/línea para no falsos positivos del JSDoc.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
  assert.match(src, /const EVALUATION_ID_IN_CHUNK = 100/)
  assert.match(src, /async function fetchInEvaluationIdChunks/)
  assert.match(src, /function chunkIds/)
  assert.match(src, /fetchInEvaluationIdChunks\(/)
  assert.doesNotMatch(codeOnly, /\.in\(\s*["']evaluation_id["']\s*,\s*ids\s*\)/)
  assert.match(codeOnly, /\.in\(\s*["']evaluation_id["']\s*,\s*chunk\s*\)/)
  assert.doesNotMatch(
    codeOnly,
    /export (const|function|async function) (EVALUATION_ID_IN_CHUNK|chunkIds|fetchInEvaluationIdChunks|estimateInFilterBytes)/,
  )
  assert.ok(EVALUATION_ID_IN_HEADER_SAFE_MAX < 400)
})

test("chunk size constante = 100", () => {
  assert.equal(EVALUATION_ID_IN_CHUNK, 100)
})

test("chunkIds: 0 → []", () => {
  assert.deepEqual(chunkIds([], 100), [])
})

test("chunkIds: bordes 1/50/100/101/399/400/569/1000", () => {
  assert.equal(chunkIds(makeIds(1), 100).length, 1)
  assert.equal(chunkIds(makeIds(50), 100).length, 1)
  assert.equal(chunkIds(makeIds(100), 100).length, 1)
  assert.equal(chunkIds(makeIds(101), 100).length, 2)
  assert.equal(chunkIds(makeIds(399), 100).length, 4)
  assert.equal(chunkIds(makeIds(400), 100).length, 4)
  assert.equal(chunkIds(makeIds(569), 100).length, 6)
  assert.equal(chunkIds(makeIds(1000), 100).length, 10)
  assert.deepEqual(
    chunkIds(makeIds(400), 100).map((c) => c.length),
    [100, 100, 100, 100],
  )
  assert.deepEqual(
    chunkIds(makeIds(569), 100).map((c) => c.length),
    [100, 100, 100, 100, 100, 69],
  )
})

for (const n of SIZES) {
  test(`N=${n}: sin overflow de headers en ningún .in()`, async () => {
    const ids = makeIds(n)
    if (n >= 400) {
      assert.ok(wouldOverflowHeaders(ids), `monolítico N=${n} debería overflow`)
    } else if (n > 0) {
      assert.ok(estimateInFilterBytes(ids.slice(0, Math.min(ids.length, EVALUATION_ID_IN_CHUNK))) < 8_000)
    }
    const fixture = buildFixture(ids)
    const { sumRes, stuRes, inCalls } = await runChunkedBoth(ids, fixture)
    assert.equal(sumRes.error, null)
    assert.equal(stuRes.error, null)
    for (const call of inCalls) {
      assert.ok(call.length <= EVALUATION_ID_IN_CHUNK)
      assert.ok(estimateInFilterBytes(call) < 8_000)
      assert.ok(!wouldOverflowHeaders(call))
    }
    if (n === 0) {
      assert.equal(sumRes.chunkCount, 0)
      assert.equal(stuRes.chunkCount, 0)
      assert.equal(inCalls.length, 0)
    } else {
      const expectedChunks = Math.ceil(n / EVALUATION_ID_IN_CHUNK)
      assert.equal(sumRes.chunkCount, expectedChunks)
      assert.equal(stuRes.chunkCount, expectedChunks)
      assert.equal(inCalls.length, expectedChunks * 2)
    }
  })

  test(`N=${n}: summaries/students sin pérdida ni duplicados (PRE≡POST)`, async () => {
    const ids = makeIds(n)
    const fixture = buildFixture(ids)
    const { sumRes, stuRes } = await runChunkedBoth(ids, fixture)
    assert.equal(sumRes.data.length, fixture.summaries.length)
    assert.equal(stuRes.data.length, fixture.students.length)
    assertNoDupEvaluationIds(sumRes.data)
    assertSameMultiset(stuRes.data, fixture.students)
    assert.deepEqual(
      sumRes.data.map((s) => s.evaluation_id),
      fixture.summaries.map((s) => s.evaluation_id),
    )
  })
}

test("summaries: abortOnError detiene y propaga error", async () => {
  const ids = makeIds(250)
  let calls = 0
  const res = await fetchInEvaluationIdChunks(
    ids,
    async () => {
      calls++
      if (calls === 2) return { data: null, error: { message: "simulated", details: null } }
      return { data: [], error: null }
    },
    { abortOnError: true },
  )
  assert.equal(res.error?.message, "simulated")
  assert.equal(calls, 2)
})

test("students: abortOnError=false continúa (semántica previa)", async () => {
  const ids = makeIds(250)
  let calls = 0
  const res = await fetchInEvaluationIdChunks(
    ids,
    async (chunk) => {
      calls++
      if (calls === 2) return { data: null, error: { message: "ignored", details: null } }
      return { data: chunk.map((id) => ({ evaluation_id: id })), error: null }
    },
    { abortOnError: false },
  )
  assert.equal(res.error, null)
  assert.equal(calls, 3)
  assert.equal(res.data.length, 150)
})

test("include_archived no afecta chunking (filtro previo a .in)", () => {
  const activeIds = makeIds(310)
  const archivedExtra = makeIds(50).map((id) => id.replace("00000000", "aaaaaaaa"))
  const includeArchivedFalse = activeIds
  const includeArchivedTrue = [...activeIds, ...archivedExtra]
  assert.equal(chunkIds(includeArchivedFalse, 100).length, 4)
  assert.equal(chunkIds(includeArchivedTrue, 100).length, 4)
  assert.ok(chunkIds(includeArchivedTrue, 100).every((c) => c.length <= 100))
})

test("569 IDs: monolítico overflow; chunked maxInFilterBytes seguro", async () => {
  const ids = makeIds(569)
  assert.ok(wouldOverflowHeaders(ids))
  assert.ok(estimateInFilterBytes(ids) > 20_000)
  const fixture = buildFixture(ids)
  const { sumRes, stuRes } = await runChunkedBoth(ids, fixture)
  assert.ok(sumRes.maxInFilterBytes < 8_000)
  assert.ok(stuRes.maxInFilterBytes < 8_000)
  assert.equal(sumRes.data.length, 569)
  assert.equal(stuRes.data.length, fixture.students.length)
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`  PASS  ${t.name}`)
    } catch (e) {
      failed++
      console.error(`  FAIL  ${t.name}`)
      console.error(e)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

main()
