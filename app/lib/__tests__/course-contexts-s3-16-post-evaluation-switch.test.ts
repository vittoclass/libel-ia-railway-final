/**
 * S3.16 — Contrato post-evaluación / course context switch.
 * Ejecuta el predicado REAL de buildCourseContextInFlight (EvaluatorClient.tsx)
 * + idleInFlightGuards + deriveCourseContextSwitchBlocked + executeSwitch + Switcher UI.
 * No monta EvaluatorClient. No evalúa. No toca sesión humana. No credits.
 * Ejecutar: npx tsx app/lib/__tests__/course-contexts-s3-16-post-evaluation-switch.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "path"
import React from "react"
import { CourseContextSwitcher } from "../../components/evaluator/CourseContextSwitcher"
import {
  createEmptyCourseContextsState,
  deriveCourseContextSwitchBlocked,
  idleInFlightGuards,
  buildInstrumentFingerprint,
} from "../course-contexts/helpers"
import { createContext, executeSwitch } from "../course-contexts/store"
import {
  MAX_COURSE_CONTEXTS,
  type CourseContextFileLike,
  type CourseContextGroupLike,
  type CourseContextsState,
  type LiveWorkspace,
  type ScaleKvStore,
} from "../course-contexts/types"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = process.cwd()
const EVALUATOR_CLIENT = path.join(ROOT, "app", "EvaluatorClient.tsx")
const USE_EVALUATOR = path.join(ROOT, "app", "useEvaluator.ts")
const SWITCHER = path.join(ROOT, "app", "components", "evaluator", "CourseContextSwitcher.tsx")
const STORE = path.join(ROOT, "app", "lib", "course-contexts", "store.ts")
const HELPERS = path.join(ROOT, "app", "lib", "course-contexts", "helpers.ts")
const FLAG = path.join(ROOT, "app", "lib", "course-contexts", "flag.ts")
const INSTRUMENT = buildInstrumentFingerprint("exam-S316", "mixta")

/** Fases verdaderamente IN-FLIGHT según contrato S3.16. El resto del union es terminal. */
const EXPECTED_IN_FLIGHT = new Set(["starting", "pending", "processing", "waiting_timeout"])
const EXPECTED_TERMINAL = new Set(["idle", "completed", "failed"])

function memoryStore(): ScaleKvStore {
  const m = new Map<string, string>()
  return {
    getItem(key: string) {
      return m.has(key) ? m.get(key)! : null
    },
    setItem(key: string, value: string) {
      m.set(key, value)
    },
  }
}

function group(partial: Partial<CourseContextGroupLike> & { id: string }): CourseContextGroupLike {
  return {
    studentName: "Alumno",
    studentRut: "",
    files: [],
    decimasAdicionales: 0,
    isEvaluated: false,
    isEvaluating: false,
    ...partial,
  }
}

function preview(name: string): CourseContextFileLike {
  const file = new File([`s316-${name}`], name, { type: "image/jpeg", lastModified: 1_700_000_000_000 })
  return {
    id: `fp-${name}`,
    file,
    previewUrl: `blob:${name}`,
    dataUrl: "data:image/jpeg;base64,S316",
  }
}

function liveOf(courseValue: string, groups: CourseContextGroupLike[], batchId: string, attemptId: string): LiveWorkspace {
  return {
    courseValue,
    classSize: groups.length,
    imagesPerStudent: 1,
    studentGroups: groups,
    unassignedFiles: [],
    batchId,
    attemptId,
    captureMode: null,
    instrumentFingerprint: INSTRUMENT,
  }
}

function extractBuildCourseContextInFlight(src: string): string {
  const start = src.indexOf("const buildCourseContextInFlight")
  const end = src.indexOf("const applyCourseContextWorkspace")
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("No se pudo extraer buildCourseContextInFlight de EvaluatorClient.tsx")
  }
  return src.slice(start, end)
}

function extractAsyncJobActiveBooleanArg(src: string): string {
  const block = extractBuildCourseContextInFlight(src)
  const key = "asyncJobActive:"
  const i = block.indexOf(key)
  if (i < 0) throw new Error("asyncJobActive no encontrado en buildCourseContextInFlight")
  const boolIdx = block.indexOf("Boolean(", i)
  if (boolIdx < 0) throw new Error("Boolean( no encontrado tras asyncJobActive")
  let pos = boolIdx + "Boolean(".length
  let depth = 1
  const start = pos
  while (pos < block.length && depth > 0) {
    const ch = block[pos]
    if (ch === "(") depth += 1
    else if (ch === ")") depth -= 1
    pos += 1
  }
  if (depth !== 0) throw new Error("Boolean( desbalanceado en asyncJobActive")
  return block.slice(start, pos - 1).trim()
}

/**
 * Ejecuta el predicado de producción extraído de EvaluatorClient.tsx.
 * No es un clon: evalúa la expresión real contra wrapper + phase.
 */
function productionAsyncJobActive(wrapperEnabled: boolean, phase: string): boolean {
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  const expr = extractAsyncJobActiveBooleanArg(src)
  const fn = new Function(
    "asyncEvaluationWrapperEnabled",
    "asyncEvaluationStatus",
    `"use strict"; return Boolean(${expr});`,
  )
  return Boolean(fn(wrapperEnabled, { phase }))
}

function extractRealPhases(useEvaluatorSrc: string): string[] {
  const m = useEvaluatorSrc.match(/export type AsyncEvaluationUiStatus = \{[\s\S]*?phase:\s*([^;]+);/)
  if (!m) throw new Error("No se pudo leer AsyncEvaluationUiStatus.phase en useEvaluator.ts")
  const phases = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  if (phases.length === 0) throw new Error("Union de phase vacío")
  return phases
}

function switchFromProduction(wrapperEnabled: boolean, phase: string) {
  const asyncJobActive = productionAsyncJobActive(wrapperEnabled, phase)
  const inFlight = idleInFlightGuards({ asyncJobActive })
  const guard = deriveCourseContextSwitchBlocked(inFlight)
  return { asyncJobActive, inFlight, guard }
}

function collect(node: unknown): React.ReactElement[] {
  const out: React.ReactElement[] = []
  const walk = (n: unknown): void => {
    if (n == null || typeof n === "boolean") return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (!React.isValidElement(n)) return
    out.push(n)
    walk((n.props as { children?: unknown }).children)
  }
  walk(node)
  return out
}

type TabProps = {
  role?: string
  "aria-selected"?: boolean
  "data-context-id"?: string
  disabled?: boolean
  title?: string
  children?: unknown
}

function tabsOf(tree: unknown): Array<React.ReactElement<TabProps>> {
  return collect(tree).filter((el) => (el.props as TabProps).role === "tab") as Array<React.ReactElement<TabProps>>
}

function tabById(tree: unknown, contextId: string): React.ReactElement<TabProps> {
  const found = tabsOf(tree).find((el) => el.props["data-context-id"] === contextId)
  assert.ok(found, `falta tab ${contextId}`)
  return found
}

function renderSwitcher(opts: {
  items: Array<{ contextId: string; courseValue: string; classSize: number; displayStatus: "DRAFT" | "ACTIVE"; batchId: string }>
  activeContextId: string | null
  switchBlocked: boolean
  switchBlockedReason?: string | null
}) {
  return CourseContextSwitcher({
    items: opts.items,
    activeContextId: opts.activeContextId,
    switchBlocked: opts.switchBlocked,
    switchBlockedReason: opts.switchBlockedReason ?? null,
    rosterLocked: false,
    instrumentLocked: false,
    canCreate: opts.items.length < MAX_COURSE_CONTEXTS,
    onCreate: () => undefined,
    onSwitch: () => {
      throw new Error("switch UI no debe dispararse en este test")
    },
    onConfirm: () => undefined,
    onUnconfirm: () => undefined,
    onDelete: () => undefined,
  })
}

function itemsFromState(state: CourseContextsState): Array<{
  contextId: string
  courseValue: string
  classSize: number
  displayStatus: "DRAFT" | "ACTIVE"
  batchId: string
}> {
  return state.contexts.map((c) => ({
    contextId: c.contextId,
    courseValue: c.courseValue,
    classSize: c.classSize,
    displayStatus: c.contextId === state.activeContextId ? "ACTIVE" : "DRAFT",
    batchId: c.batchId,
  }))
}

function buildAbcState(): {
  state: CourseContextsState
  scale: ScaleKvStore
  ids: { a: string; b: string; c: string }
} {
  const scale = memoryStore()
  const batches = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ]
  const labels = ["Curso A", "Curso B", "Curso C"]
  let state = createEmptyCourseContextsState()
  for (let i = 0; i < 3; i++) {
    const groups =
      i === 0
        ? [group({ id: "g-A-0", studentName: "A1", files: [preview("a0.jpg")], isEvaluated: true })]
        : [group({ id: `g-${labels[i]}-0`, studentName: `${labels[i]}1`, files: [preview(`${i}.jpg`)] })]
    const live =
      i === 0
        ? liveOf(labels[i], groups, batches[i], `attempt-${i}`)
        : liveOf(
            labels[i - 1],
            state.contexts[i - 1].studentGroups,
            state.contexts[i - 1].batchId,
            state.contexts[i - 1].attemptId,
          )
    const result = createContext({
      state,
      live,
      scaleStore: scale,
      newBatchId: batches[i],
      emptyGroupFactory: (idx) => group({ id: `empty-${i}-${idx}`, studentName: `Nuevo ${idx + 1}` }),
      inFlight: idleInFlightGuards(),
    })
    assert.equal(result.ok, true, `create ${labels[i]} debe ok`)
    if (!result.ok) throw new Error("create fail")
    state = result.state
  }
  const a = state.contexts[0]
  const b = state.contexts[1]
  const c = state.contexts[2]
  const backToA = executeSwitch({
    state,
    targetId: a.contextId,
    live: liveOf(c.courseValue, c.studentGroups, c.batchId, c.attemptId),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(backToA.ok, true, "setup: C→A idle debe permitir switch")
  if (!backToA.ok) throw new Error("setup switch fail")
  return { state: backToA.state, scale, ids: { a: a.contextId, b: b.contextId, c: c.contextId } }
}

function handlerSwitch(opts: {
  state: CourseContextsState
  targetId: string
  scale: ScaleKvStore
  wrapperEnabled: boolean
  phase: string
}) {
  const { asyncJobActive, inFlight, guard } = switchFromProduction(opts.wrapperEnabled, opts.phase)
  const active = opts.state.contexts.find((x) => x.contextId === opts.state.activeContextId)!
  const result = executeSwitch({
    state: opts.state,
    targetId: opts.targetId,
    live: liveOf(active.courseValue, active.studentGroups, active.batchId, active.attemptId),
    scaleStore: opts.scale,
    inFlight,
    globalInstrumentFingerprint: INSTRUMENT,
  })
  return { asyncJobActive, guard, result }
}

test("S3.16 fases reales enumeradas desde AsyncEvaluationUiStatus (no inventadas)", () => {
  const phases = extractRealPhases(fs.readFileSync(USE_EVALUATOR, "utf8"))
  assert.deepEqual(
    [...phases].sort(),
    ["completed", "failed", "idle", "pending", "processing", "starting", "waiting_timeout"],
  )
  for (const p of phases) {
    const classified = EXPECTED_IN_FLIGHT.has(p) || EXPECTED_TERMINAL.has(p)
    assert.equal(classified, true, `fase real no clasificada: ${p}`)
  }
})

test("S3.16 predicado vive solo en buildCourseContextInFlight y se ejecuta de verdad", () => {
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  const block = extractBuildCourseContextInFlight(src)
  const expr = extractAsyncJobActiveBooleanArg(src)
  assert.match(block, /asyncJobActive:\s*Boolean\(/)
  assert.ok(expr.includes("asyncEvaluationWrapperEnabled"), "wrapper forma parte del predicado")
  assert.ok(expr.includes("asyncEvaluationStatus.phase"), "phase forma parte del predicado")
  const executed = productionAsyncJobActive(true, "processing")
  assert.equal(typeof executed, "boolean")
  assert.equal(executed, true, "processing debe ser in-flight (ejecución real)")
})

test("PRE-REPRO contrato: wrapper ON + processing → switch BLOCKED (PASS PRE y POST)", () => {
  const { asyncJobActive, guard } = switchFromProduction(true, "processing")
  assert.equal(asyncJobActive, true)
  assert.equal(guard.blocked, true)
  assert.equal(guard.reason, "async_job")
})

test("PRE-REPRO bug: wrapper ON + completed → switch DEBE permitir (FAIL PRE / PASS POST)", () => {
  const { asyncJobActive, guard } = switchFromProduction(true, "completed")
  assert.equal(asyncJobActive, false, "completed NO es in-flight")
  assert.equal(guard.blocked, false, "completed NO debe bloquear switch")
  assert.equal(guard.reason, null)
})

test("S3.16 tabla completa de fases reales → asyncJobActive + switchBlocked", () => {
  const phases = extractRealPhases(fs.readFileSync(USE_EVALUATOR, "utf8"))
  for (const phase of phases) {
    const expectActive = EXPECTED_IN_FLIGHT.has(phase)
    const { asyncJobActive, guard } = switchFromProduction(true, phase)
    assert.equal(asyncJobActive, expectActive, `wrapper ON phase=${phase} asyncJobActive`)
    assert.equal(guard.blocked, expectActive, `wrapper ON phase=${phase} switchBlocked`)
    if (expectActive) assert.equal(guard.reason, "async_job")
    else assert.equal(guard.reason, null)
  }
})

test("S3.16 wrapper OFF → PRE intacto: ninguna phase bloquea por async_job", () => {
  const phases = extractRealPhases(fs.readFileSync(USE_EVALUATOR, "utf8"))
  for (const phase of phases) {
    const { asyncJobActive, guard } = switchFromProduction(false, phase)
    assert.equal(asyncJobActive, false, `wrapper OFF phase=${phase}`)
    assert.equal(guard.blocked, false)
  }
})

test("S3.16 UI: processing deshabilita tabs inactivos; completed no", () => {
  const { state, ids } = buildAbcState()
  const proc = switchFromProduction(true, "processing")
  const procTree = renderSwitcher({
    items: itemsFromState(state),
    activeContextId: state.activeContextId,
    switchBlocked: proc.guard.blocked,
    switchBlockedReason: proc.guard.reason,
  })
  assert.equal(tabById(procTree, ids.a).props.disabled, false, "tab activo A no se deshabilita")
  assert.equal(tabById(procTree, ids.b).props.disabled, true, "processing: tab B disabled")
  assert.equal(tabById(procTree, ids.c).props.disabled, true, "processing: tab C disabled")

  const done = switchFromProduction(true, "completed")
  const doneTree = renderSwitcher({
    items: itemsFromState(state),
    activeContextId: state.activeContextId,
    switchBlocked: done.guard.blocked,
    switchBlockedReason: done.guard.reason,
  })
  assert.equal(done.guard.blocked, false, "completed: switchBlocked false")
  assert.equal(tabById(doneTree, ids.b).props.disabled, false, "completed: tab B enabled")
  assert.equal(tabById(doneTree, ids.c).props.disabled, false, "completed: tab C enabled")
})

test("S3.16 HANDLER: processing → SWITCH_BLOCKED async_job; completed → ALLOWED", () => {
  const abc = buildAbcState()
  const blocked = handlerSwitch({
    state: abc.state,
    targetId: abc.ids.b,
    scale: abc.scale,
    wrapperEnabled: true,
    phase: "processing",
  })
  assert.equal(blocked.result.ok, false)
  if (!blocked.result.ok) {
    assert.equal(blocked.result.code, "SWITCH_BLOCKED")
    assert.equal(blocked.result.blockedReason, "async_job")
  }
  assert.equal(abc.state.activeContextId, abc.ids.a, "fail-soft: A sigue activo")

  const allowed = handlerSwitch({
    state: abc.state,
    targetId: abc.ids.b,
    scale: abc.scale,
    wrapperEnabled: true,
    phase: "completed",
  })
  assert.equal(allowed.result.ok, true, "completed: A→B ALLOWED")
  if (!allowed.result.ok) throw new Error("completed switch fail")
  assert.equal(allowed.result.state.activeContextId, abc.ids.b)
})

test("S3.16 HANDLER A/B/C: completed A→B, B→C, C→A ALLOWED; pending/waiting_timeout BLOCKED", () => {
  const abc = buildAbcState()
  const aToB = handlerSwitch({
    state: abc.state,
    targetId: abc.ids.b,
    scale: abc.scale,
    wrapperEnabled: true,
    phase: "completed",
  })
  assert.equal(aToB.result.ok, true, "A→B completed ALLOWED")
  if (!aToB.result.ok) throw new Error("A→B fail")

  const bToC = handlerSwitch({
    state: aToB.result.state,
    targetId: abc.ids.c,
    scale: abc.scale,
    wrapperEnabled: true,
    phase: "completed",
  })
  assert.equal(bToC.result.ok, true, "B→C completed ALLOWED")
  if (!bToC.result.ok) throw new Error("B→C fail")

  const cToA = handlerSwitch({
    state: bToC.result.state,
    targetId: abc.ids.a,
    scale: abc.scale,
    wrapperEnabled: true,
    phase: "idle",
  })
  assert.equal(cToA.result.ok, true, "C→A idle ALLOWED")

  for (const phase of ["starting", "pending", "processing", "waiting_timeout"] as const) {
    const blocked = handlerSwitch({
      state: abc.state,
      targetId: abc.ids.b,
      scale: abc.scale,
      wrapperEnabled: true,
      phase,
    })
    assert.equal(blocked.result.ok, false, `${phase} debe bloquear A→B`)
    if (!blocked.result.ok) assert.equal(blocked.result.blockedReason, "async_job")
  }
})

test("S3.16 NO-GO: fases activas siguen bloqueando (starting/pending/processing/waiting_timeout)", () => {
  for (const phase of EXPECTED_IN_FLIGHT) {
    const { asyncJobActive, guard } = switchFromProduction(true, phase)
    assert.equal(asyncJobActive, true, `NO-GO ${phase} asyncJobActive`)
    assert.equal(guard.blocked, true, `NO-GO ${phase} switchBlocked`)
    assert.equal(guard.reason, "async_job")
  }
})

test("S3.16 failed es terminal: no in-flight (no usar phase!==completed)", () => {
  const { asyncJobActive, guard } = switchFromProduction(true, "failed")
  assert.equal(asyncJobActive, false, "failed no es in-flight")
  assert.equal(guard.blocked, false)
})

test("S3.16 idle habilita switch", () => {
  const { asyncJobActive, guard } = switchFromProduction(true, "idle")
  assert.equal(asyncJobActive, false)
  assert.equal(guard.blocked, false)
})

test("S3.16 handler sigue pasando buildCourseContextInFlight a executeSwitch; UI sigue usando switchBlocked", () => {
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  const handlerStart = src.indexOf("const handleSwitchCourseContext")
  const handlerEnd = src.indexOf("const handleConfirmCourseContext")
  const handler = src.slice(handlerStart, handlerEnd)
  assert.match(handler, /inFlight:\s*buildCourseContextInFlight\(\)/)
  assert.match(src, /switchBlocked=\{courseContextSwitchGuard\.blocked\}/)
  const switcher = fs.readFileSync(SWITCHER, "utf8")
  assert.match(switcher, /disabled=\{\s*!isActive\s*&&\s*props\.switchBlocked\s*\}/)
})

test("S3.16 no-regresión S3.14: bump + switching/restoring + max4 intactos", () => {
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  assert.match(src, /const\s*\[\s*,\s*bumpCourseContextRender\s*\]\s*=\s*useState\(\s*0\s*\)/)
  const applyStart = src.indexOf("const applyCourseContextWorkspace")
  const applyEnd = src.indexOf("const handleCreateCourseContext")
  const apply = src.slice(applyStart, applyEnd)
  assert.match(apply, /bumpCourseContextRender\(\(v\)\s*=>\s*v\s*\+\s*1\)/)
  const switching = deriveCourseContextSwitchBlocked(idleInFlightGuards({ switchInProgress: true }))
  const restoring = deriveCourseContextSwitchBlocked(idleInFlightGuards({ restoring: true }))
  assert.equal(switching.blocked, true)
  assert.equal(switching.reason, "switch_in_progress")
  assert.equal(restoring.blocked, true)
  assert.equal(restoring.reason, "switch_in_progress")
  assert.equal(MAX_COURSE_CONTEXTS, 4)
  const types = fs.readFileSync(path.join(ROOT, "app", "lib", "course-contexts", "types.ts"), "utf8")
  assert.match(types, /MAX_COURSE_CONTEXTS\s*=\s*4/)
})

test("S3.16 no toca store/helpers/flag/Switcher; predicado no resetea phase", () => {
  const block = extractBuildCourseContextInFlight(fs.readFileSync(EVALUATOR_CLIENT, "utf8"))
  assert.doesNotMatch(block, /setAsyncEvaluationStatus/)
  assert.doesNotMatch(block, /phase:\s*["']idle["']/)
  assert.ok(fs.existsSync(STORE))
  assert.ok(fs.existsSync(HELPERS))
  assert.ok(fs.existsSync(FLAG))
  const helpers = fs.readFileSync(HELPERS, "utf8")
  assert.match(helpers, /if\s*\(\s*g\.asyncJobActive\)\s*return\s*\{\s*blocked:\s*true,\s*reason:\s*"async_job"\s*\}/)
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`PASS ${t.name}`)
    } catch (e) {
      failed += 1
      console.error(`FAIL ${t.name}`)
      console.error(e)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void main()
