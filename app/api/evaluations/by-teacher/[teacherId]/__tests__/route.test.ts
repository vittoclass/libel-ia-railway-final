/**
 * P0-B / FASE 0-B3 — Cierre POST-FIX de
 * GET /api/evaluations/by-teacher/[teacherId]
 *
 * OFFLINE. Sin Supabase prod. Sin Railway. Sin red. Sin BD. Sin RLS. Sin Storage.
 *
 * Convenciones: mismo runner que app/api/evaluations/list/__tests__/list-chunk.test.ts
 * (npx tsx + node:assert). No Jest. No paquetes nuevos.
 *
 * CATEGORÍAS:
 *   A. CONTRATO A PRESERVAR — 200, shape, campos, orden pedido a la query,
 *      teacher inexistente AUTORIZADO → [], teacherId faltante → 400.
 *   B. POST_FIX — sesión, ownership propio, mismo colegio, cross-tenant.
 *
 * Ejecutar:
 *   npx tsx "app/api/evaluations/by-teacher/[teacherId]/__tests__/route.test.ts"
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import Module from "node:module"
import path from "node:path"
import { NextRequest } from "next/server"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn; category: "CONTRATO" | "POST_FIX" }> = []
let passed = 0
let failed = 0

function test(
  name: string,
  fn: TestFn,
  category: "CONTRATO" | "POST_FIX" = "CONTRATO",
): void {
  tests.push({ name, fn, category })
}

type EvalRow = {
  id: string
  title: string
  subject: string
  evaluated_at: string
  created_at: string
}

type ProfileRow = {
  user_id: string
  teacher_id: string | null
  school_id: string | null
}

type QueryLog = {
  from: string | null
  select: string | null
  eq: { column: string; value: string } | null
  eqs: Array<{ column: string; value: string }>
  order: { column: string; options: { ascending?: boolean } | undefined } | null
}

const USER_A = "aa000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const USER_B_SAME = "bb000000-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER_FOREIGN = "cc000000-cccc-4ccc-8ccc-cccccccccccc"

const TEACHER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TEACHER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const TEACHER_SAME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const UNKNOWN_TEACHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

const SCHOOL_A = "11111111-1111-4111-8111-111111111111"
const SCHOOL_B = "22222222-2222-4222-8222-222222222222"

const FIXTURE_A_NEW: EvalRow = {
  id: "e-new",
  title: "Prueba reciente",
  subject: "Lenguaje",
  evaluated_at: "2026-06-02T12:00:00.000Z",
  created_at: "2026-06-02T11:00:00.000Z",
}
const FIXTURE_A_OLD: EvalRow = {
  id: "e-old",
  title: "Prueba antigua",
  subject: "Matemática",
  evaluated_at: "2026-01-01T12:00:00.000Z",
  created_at: "2026-01-01T11:00:00.000Z",
}

/** Filas ya ordenadas evaluated_at DESC (simula PostgREST). */
const FIXTURE_ORDERED_DESC: EvalRow[] = [FIXTURE_A_NEW, FIXTURE_A_OLD]

const PROFILE_A: ProfileRow = { user_id: USER_A, teacher_id: TEACHER_A, school_id: SCHOOL_A }
const PROFILE_SAME: ProfileRow = { user_id: USER_B_SAME, teacher_id: TEACHER_SAME, school_id: SCHOOL_A }
const PROFILE_FOREIGN: ProfileRow = { user_id: USER_FOREIGN, teacher_id: TEACHER_B, school_id: SCHOOL_B }

const state: {
  configured: boolean
  clientNull: boolean
  authUser: { id: string } | null
  profiles: ProfileRow[]
  rows: EvalRow[] | null
  error: { message: string } | null
  query: QueryLog
} = {
  configured: true,
  clientNull: false,
  authUser: { id: USER_A },
  profiles: [PROFILE_A, PROFILE_SAME, PROFILE_FOREIGN],
  rows: [],
  error: null,
  query: { from: null, select: null, eq: null, eqs: [], order: null },
}

function resetState(overrides?: {
  rows?: EvalRow[] | null
  configured?: boolean
  clientNull?: boolean
  authUser?: { id: string } | null
  profiles?: ProfileRow[]
}): void {
  state.configured = overrides?.configured ?? true
  state.clientNull = overrides?.clientNull ?? false
  state.authUser = overrides?.authUser === undefined ? { id: USER_A } : overrides.authUser
  state.profiles = overrides?.profiles ?? [PROFILE_A, PROFILE_SAME, PROFILE_FOREIGN]
  state.rows = overrides?.rows === undefined ? [] : overrides.rows
  state.error = null
  state.query = { from: null, select: null, eq: null, eqs: [], order: null }
}

let networkForbiddenCalls = 0
const originalFetch = globalThis.fetch

function installOfflineGuards(): void {
  delete process.env.SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_ANON_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    networkForbiddenCalls += 1
    throw new Error(`NETWORK_FORBIDDEN: ${String(input)}`)
  }) as typeof fetch
}

function installSupabaseServerMock(): void {
  const origLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load
  ;(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
    request: unknown,
    parent: unknown,
    isMain: unknown,
  ) {
    const r = String(request).replace(/\\/g, "/")
    if (r === "@/app/lib/supabase-server" || r.endsWith("/app/lib/supabase-server")) {
      return {
        isSupabaseConfigured: () => state.configured,
        getSupabaseServer: () => {
          if (state.clientNull) return null
          return {
            from(table: string) {
              if (table === "profiles") {
                const filters: Record<string, string> = {}
                const chain = {
                  select() {
                    return chain
                  },
                  eq(column: string, value: string) {
                    filters[column] = value
                    return chain
                  },
                  maybeSingle() {
                    const row =
                      state.profiles.find((p) => {
                        if (filters.user_id != null && p.user_id !== filters.user_id) return false
                        if (filters.teacher_id != null && p.teacher_id !== filters.teacher_id) return false
                        return true
                      }) ?? null
                    return Promise.resolve({ data: row, error: null })
                  },
                }
                return chain
              }
              const chain = {
                from(t: string) {
                  state.query.from = t
                  return chain
                },
                select(cols: string) {
                  state.query.select = cols
                  return chain
                },
                eq(column: string, value: string) {
                  const pair = { column, value }
                  state.query.eq = pair
                  state.query.eqs.push(pair)
                  return chain
                },
                order(column: string, options?: { ascending?: boolean }) {
                  state.query.order = { column, options }
                  return Promise.resolve({ data: state.rows, error: state.error })
                },
              }
              return chain.from(table)
            },
          }
        },
      }
    }
    if (r === "@/app/lib/supabase-route" || r.endsWith("/app/lib/supabase-route")) {
      return {
        getAuthUser: async () => state.authUser,
      }
    }
    return origLoad.call(this, request, parent, isMain)
  }
}

installOfflineGuards()
installSupabaseServerMock()

type RouteGET = (
  req: NextRequest,
  ctx: { params: { teacherId: string } },
) => Promise<Response>

const ROUTE_PATH = path.resolve(__dirname, "../route.ts")
const { GET } = require(ROUTE_PATH) as { GET: RouteGET }

assert.equal(typeof GET, "function", "GET debe exportarse desde route.ts")

async function invokeGet(
  teacherId: string | undefined,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const segment = teacherId ?? ""
  const url = `http://libelia.test/api/evaluations/by-teacher/${encodeURIComponent(segment)}`
  const req = new NextRequest(url, headers ? { headers } : undefined)
  const res = await GET(req, { params: { teacherId: teacherId as string } })
  const body = await res.json()
  return { status: res.status, body }
}

function asSuccess(body: unknown): { success: true; evaluations: EvalRow[] } {
  assert.ok(body !== null && typeof body === "object", "body debe ser objeto")
  const rec = body as Record<string, unknown>
  assert.equal(rec.success, true)
  assert.ok(Array.isArray(rec.evaluations), "evaluations debe ser array")
  return body as { success: true; evaluations: EvalRow[] }
}

function asDenied(body: unknown): Record<string, unknown> {
  assert.ok(body !== null && typeof body === "object", "body debe ser objeto")
  const rec = body as Record<string, unknown>
  assert.equal(rec.success, false)
  assert.equal(rec.error, "No autorizado")
  assert.equal("evaluations" in rec, false, "403/401 no debe incluir evaluations")
  return rec
}

function assertQueryContract(teacherId: string): void {
  assert.equal(state.query.from, "evaluations")
  assert.equal(state.query.select, "id, title, subject, evaluated_at, created_at")
  assert.deepEqual(
    state.query.eqs.find((e) => e.column === "teacher_id"),
    { column: "teacher_id", value: teacherId },
  )
  assert.equal(state.query.order?.column, "evaluated_at")
  assert.deepEqual(state.query.order?.options, { ascending: false })
}

function assertEvaluationsNotQueried(): void {
  assert.equal(state.query.from, null, "no debe consultar evaluations")
  assert.deepEqual(state.query.eqs, [])
}

/* -------------------------------------------------------------------------- */
/* A. CONTRATO A PRESERVAR                                                      */
/* -------------------------------------------------------------------------- */

test("CONTRATO: 200 + { success: true, evaluations: [...] }", async () => {
  resetState({ rows: FIXTURE_ORDERED_DESC })
  const { status, body } = await invokeGet(TEACHER_A)
  assert.equal(status, 200)
  const ok = asSuccess(body)
  assert.equal(ok.evaluations.length, 2)
  assertQueryContract(TEACHER_A)
})

test("CONTRATO: cada evaluación conserva id, title, subject, evaluated_at, created_at", async () => {
  resetState({ rows: FIXTURE_ORDERED_DESC })
  const { status, body } = await invokeGet(TEACHER_A)
  assert.equal(status, 200)
  const ok = asSuccess(body)
  for (const row of ok.evaluations) {
    assert.equal(typeof row.id, "string")
    assert.equal(typeof row.title, "string")
    assert.equal(typeof row.subject, "string")
    assert.equal(typeof row.evaluated_at, "string")
    assert.equal(typeof row.created_at, "string")
    assert.deepEqual(Object.keys(row).sort(), ["created_at", "evaluated_at", "id", "subject", "title"])
  }
  assert.deepEqual(ok.evaluations[0], FIXTURE_A_NEW)
  assert.deepEqual(ok.evaluations[1], FIXTURE_A_OLD)
})

test("CONTRATO: la query pide order evaluated_at DESC y el payload conserva ese orden", async () => {
  resetState({ rows: FIXTURE_ORDERED_DESC })
  const { status, body } = await invokeGet(TEACHER_A)
  assert.equal(status, 200)
  const ok = asSuccess(body)
  assertQueryContract(TEACHER_A)
  assert.deepEqual(
    ok.evaluations.map((e) => e.id),
    ["e-new", "e-old"],
  )
  assert.ok(ok.evaluations[0]!.evaluated_at > ok.evaluations[1]!.evaluated_at)
})

test("CONTRATO: teacher inexistente autorizado (propio, mock data=[]) → 200 + evaluations []", async () => {
  resetState({ rows: [] })
  const { status, body } = await invokeGet(TEACHER_A)
  assert.equal(status, 200)
  const ok = asSuccess(body)
  assert.deepEqual(ok.evaluations, [])
  assertQueryContract(TEACHER_A)
})

test("CONTRATO: teacher inexistente autorizado con data null → 200 + evaluations [] (?? [])", async () => {
  resetState({ rows: null })
  const { status, body } = await invokeGet(TEACHER_A)
  assert.equal(status, 200)
  const ok = asSuccess(body)
  assert.deepEqual(ok.evaluations, [])
})

test("CONTRATO: teacherId faltante (string vacío) → 400", async () => {
  resetState({ authUser: null })
  const { status, body } = await invokeGet("")
  assert.equal(status, 400)
  assert.ok(body !== null && typeof body === "object")
  const rec = body as Record<string, unknown>
  assert.equal(rec.success, false)
  assert.equal(rec.error, "Falta teacherId")
  assertEvaluationsNotQueried()
})

test("CONTRATO: teacherId undefined en params → 400", async () => {
  resetState({ authUser: null })
  const req = new NextRequest("http://libelia.test/api/evaluations/by-teacher/")
  const res = await GET(req, { params: {} as { teacherId: string } })
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.success, false)
  assert.equal(body.error, "Falta teacherId")
  assertEvaluationsNotQueried()
})

test("CONTRATO fuente: select/eq/order, auth+scope, sin imports pedagógicos/persistencia", () => {
  const src = fs.readFileSync(ROUTE_PATH, "utf8")
  assert.match(src, /\.from\(\s*["']evaluations["']\s*\)/)
  assert.match(src, /\.select\(\s*["']id, title, subject, evaluated_at, created_at["']\s*\)/)
  assert.match(src, /\.eq\(\s*["']teacher_id["']\s*,\s*teacherId\s*\)/)
  assert.match(src, /\.order\(\s*["']evaluated_at["']\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/)
  assert.match(src, /getAuthUser/)
  assert.match(src, /profileScopeFromRow/)
  assert.match(src, /getSupabaseServer/)
  assert.doesNotMatch(src, /getSupabaseRouteClient/)
  assert.doesNotMatch(src, /persist-evaluation/)
  assert.doesNotMatch(src, /from ["']@\/app\/lib\/omr/)
  assert.doesNotMatch(src, /arts-/)
})

/* -------------------------------------------------------------------------- */
/* B. POST_FIX — sesión + ownership (reemplaza CURRENT_VULNERABLE_BEHAVIOR)     */
/* -------------------------------------------------------------------------- */

test("T1 POST_FIX: sin sesión → 401", async () => {
  resetState({ rows: [FIXTURE_A_NEW], authUser: null })
  const { status, body } = await invokeGet(TEACHER_A)
  assert.equal(status, 401)
  asDenied(body)
  assertEvaluationsNotQueried()
}, "POST_FIX")

test("T2 POST_FIX: Profesor A → teacher A → 200", async () => {
  resetState({ rows: FIXTURE_ORDERED_DESC })
  const { status, body } = await invokeGet(TEACHER_A)
  assert.equal(status, 200)
  const ok = asSuccess(body)
  assert.equal(ok.evaluations.length, 2)
  assertQueryContract(TEACHER_A)
  assert.equal(
    state.query.eqs.some((e) => e.column === "school_id"),
    false,
    "propio teacher: query original sin filtro extra school_id",
  )
}, "POST_FIX")

test("T3 POST_FIX: Profesor A → teacher B otro colegio → 403 sin fuga", async () => {
  resetState({
    rows: [
      {
        id: "e-b",
        title: "Eval de B",
        subject: "Historia",
        evaluated_at: "2026-03-01T00:00:00.000Z",
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ],
  })
  const { status, body } = await invokeGet(TEACHER_B)
  assert.equal(status, 403)
  asDenied(body)
  assertEvaluationsNotQueried()
}, "POST_FIX")

test("T4 POST_FIX: Profesor A → teacher mismo colegio → 200 (política list/me por school_id)", async () => {
  resetState({
    rows: [
      {
        id: "e-same",
        title: "Eval colega",
        subject: "Historia",
        evaluated_at: "2026-04-01T00:00:00.000Z",
        created_at: "2026-04-01T00:00:00.000Z",
      },
    ],
  })
  const { status, body } = await invokeGet(TEACHER_SAME)
  assert.equal(status, 200)
  const ok = asSuccess(body)
  assert.equal(ok.evaluations.length, 1)
  assert.equal(ok.evaluations[0]?.id, "e-same")
  assertQueryContract(TEACHER_SAME)
  assert.deepEqual(
    state.query.eqs.find((e) => e.column === "school_id"),
    { column: "school_id", value: SCHOOL_A },
  )
}, "POST_FIX")

test("T5 POST_FIX: teacher UUID sin perfil en scope → 403 (no 200 con datos ajenos)", async () => {
  resetState({ rows: [FIXTURE_A_NEW] })
  const { status, body } = await invokeGet(UNKNOWN_TEACHER)
  assert.equal(status, 403)
  asDenied(body)
  assertEvaluationsNotQueried()
}, "POST_FIX")

test("POST_FIX fuente: route.ts llama getAuthUser y no usa cliente JWT de ruta", () => {
  const src = fs.readFileSync(ROUTE_PATH, "utf8")
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  assert.match(codeOnly, /getAuthUser/)
  assert.match(codeOnly, /profileScopeFromRow/)
  assert.match(codeOnly, /normUuid/)
  assert.doesNotMatch(codeOnly, /getOrCreateProfile/)
  assert.doesNotMatch(codeOnly, /getServerSession/)
  assert.doesNotMatch(codeOnly, /getSupabaseRouteClient/)
  assert.doesNotMatch(codeOnly, /isMasterEmail/)
}, "POST_FIX")

test("aislamiento: cero llamadas de red (fetch parcheado)", () => {
  assert.equal(networkForbiddenCalls, 0)
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`  PASS  [${t.category}]  ${t.name}`)
    } catch (e) {
      failed++
      console.error(`  FAIL  [${t.category}]  ${t.name}`)
      console.error(e)
    }
  }
  if (originalFetch) globalThis.fetch = originalFetch
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

main()
