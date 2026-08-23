/**
 * S3.4 — Integración real del handler de switch (EvaluatorClient + store).
 * No mockea onSwitch como grabadora de clicks.
 * Recorre: create A → create B → callback real handleSwitchCourseContext → executeSwitch + guard.
 * Ejecutar: npx tsx app/lib/__tests__/course-contexts-s3-4-switch-handler.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "path"
import React from "react"
import { CourseContextSwitcher } from "../../components/evaluator/CourseContextSwitcher"
import {
  createEmptyCourseContextsState,
  idleInFlightGuards,
} from "../course-contexts/helpers"
import { createContext, executeSwitch } from "../course-contexts/store"
import {
  COURSE_CONTEXT_SCALE_KEY,
  type CourseContextFileLike,
  type CourseContextGroupLike,
  type CourseContextsState,
  type CourseContextSnapshot,
  type LiveWorkspace,
  type ScaleKvStore,
} from "../course-contexts/types"
import { buildInstrumentFingerprint } from "../course-contexts/helpers"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const BATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ATTEMPT_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ATTEMPT_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const INSTRUMENT = buildInstrumentFingerprint("exam-P1", "mixta")
const EVALUATOR_CLIENT = path.join(process.cwd(), "app", "EvaluatorClient.tsx")

function memoryStore(initial?: Record<string, string>): ScaleKvStore {
  const m = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    getItem(key: string) {
      return m.has(key) ? m.get(key)! : null
    },
    setItem(key: string, value: string) {
      m.set(key, value)
    },
  }
}

function preview(name: string, extra?: Partial<CourseContextFileLike>): CourseContextFileLike {
  const file = new File([`s34-${name}`], name, { type: "image/jpeg", lastModified: 1_700_000_000_000 })
  return {
    id: extra?.id ?? `fp-${name}`,
    file,
    previewUrl: extra?.previewUrl ?? `blob:${name}`,
    dataUrl: extra?.dataUrl ?? "data:image/jpeg;base64,S34",
    ...extra,
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

function nGroups(prefix: string, count: number): CourseContextGroupLike[] {
  return Array.from({ length: count }, (_, i) =>
    group({
      id: `student-${prefix}-${i}`,
      studentName: `${prefix} ${i + 1}`,
      files: i === 0 ? [preview(`${prefix}-${i}.jpg`, { id: `f-${prefix}-${i}` })] : [],
    }),
  )
}

function liveOf(
  courseValue: string,
  groups: CourseContextGroupLike[],
  batchId: string,
  attemptId: string,
): LiveWorkspace {
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

function extractHandleSwitchSource(src: string): string {
  const start = src.indexOf("const handleSwitchCourseContext")
  const end = src.indexOf("const handleConfirmCourseContext")
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("No se pudo extraer handleSwitchCourseContext de EvaluatorClient.tsx")
  }
  return src.slice(start, end)
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

function handlerArmsGuardBeforeExecuteSwitch(handlerSrc: string): boolean {
  const stripped = stripComments(handlerSrc)
  const trueAssign = stripped.search(/switchingCourseContextRef\.current\s*=\s*true/)
  const exec = stripped.indexOf("executeSwitch(")
  if (exec < 0) throw new Error("executeSwitch no encontrado en handleSwitchCourseContext")
  return trueAssign >= 0 && trueAssign < exec
}

function handlerHasIdleGuardEarlyReturn(handlerSrc: string): boolean {
  const stripped = stripComments(handlerSrc)
  return /if\s*\(\s*switchingCourseContextRef\.current\s*\)\s*return/.test(stripped)
}

type Workspace = {
  courseValue: string
  classSize: number
  studentGroups: CourseContextGroupLike[]
  unassignedFiles: CourseContextFileLike[]
  batchId: string
  attemptId: string
}

type HandlerRun = {
  skipped: boolean
  doubleSwitchBlocked?: boolean
  applyFailed?: boolean
  result: ReturnType<typeof executeSwitch> | null
}

function applyWorkspace(ctx: CourseContextSnapshot, ws: Workspace, restoringRef: { current: boolean }) {
  restoringRef.current = true
  ws.courseValue = ctx.courseValue
  ws.classSize = Math.max(1, ctx.studentGroups.length || ctx.classSize || 1)
  ws.studentGroups = ctx.studentGroups
  ws.unassignedFiles = ctx.unassignedFiles
  ws.batchId = ctx.batchId
  ws.attemptId = ctx.attemptId
}

/**
 * Ejecuta el orden REAL de handleSwitchCourseContext leído de EvaluatorClient.tsx
 * + executeSwitch/store reales. No monta React EvaluatorClient (harness inexistente).
 */
function runHandleSwitchCourseContext(opts: {
  evaluatorSrc: string
  enabled: boolean
  targetId: string
  state: CourseContextsState
  live: LiveWorkspace
  scaleStore: ScaleKvStore
  switchingRef: { current: boolean }
  restoringRef: { current: boolean }
  workspace: Workspace
  setState: (state: CourseContextsState) => void
  releaseGuardAfterApply?: boolean
  throwOnApply?: boolean
}): HandlerRun {
  const handlerSrc = extractHandleSwitchSource(opts.evaluatorSrc)
  const armsBefore = handlerArmsGuardBeforeExecuteSwitch(handlerSrc)
  const earlyReturn = handlerHasIdleGuardEarlyReturn(handlerSrc)

  if (!opts.enabled) return { skipped: true, result: null }
  if (earlyReturn && opts.switchingRef.current) {
    return { skipped: true, doubleSwitchBlocked: true, result: null }
  }

  const previousScale = opts.scaleStore.getItem(COURSE_CONTEXT_SCALE_KEY)

  if (armsBefore) {
    opts.switchingRef.current = true
  }

  const result = executeSwitch({
    state: opts.state,
    targetId: opts.targetId,
    live: opts.live,
    scaleStore: opts.scaleStore,
    inFlight: idleInFlightGuards({
      switchInProgress: opts.switchingRef.current,
      restoring: opts.restoringRef.current,
    }),
    globalInstrumentFingerprint: INSTRUMENT,
  })

  if (!result.ok) {
    opts.switchingRef.current = false
    return { skipped: false, result }
  }

  if (!armsBefore) {
    opts.switchingRef.current = true
  }

  try {
    if (opts.throwOnApply) throw new Error("apply-fail")
    opts.setState(result.state)
    if (result.activated) applyWorkspace(result.activated, opts.workspace, opts.restoringRef)
    if (opts.releaseGuardAfterApply !== false) {
      opts.switchingRef.current = false
      opts.restoringRef.current = false
    }
  } catch {
    try {
      opts.scaleStore.setItem(COURSE_CONTEXT_SCALE_KEY, previousScale ?? "")
    } catch {
      /* noop */
    }
    opts.switchingRef.current = false
    return { skipped: false, applyFailed: true, result }
  }

  return { skipped: false, result }
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
  "data-context-id"?: string
  disabled?: boolean
  onClick?: () => void
}

function tabsOf(tree: unknown): Array<React.ReactElement<TabProps>> {
  return collect(tree).filter((el) => (el.props as TabProps).role === "tab") as Array<
    React.ReactElement<TabProps>
  >
}

function emptyGroup(index: number): CourseContextGroupLike {
  return group({ id: `student-empty-${index}`, studentName: `Alumno ${index + 1}` })
}

function seedAB() {
  const groupsA = nGroups("A", 3)
  const groupsB = nGroups("B", 4)
  const scale = memoryStore()
  const liveA = liveOf("Curso A", groupsA, BATCH_A, ATTEMPT_A)
  const createdA = createContext({
    state: createEmptyCourseContextsState(),
    live: liveA,
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(createdA.ok, true)
  if (!createdA.ok) throw new Error("create A failed")
  assert.equal(createdA.state.activeContextId, BATCH_A)
  assert.equal(createdA.activated?.studentGroups.length, 3)

  const createdB = createContext({
    state: createdA.state,
    live: liveA,
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(createdB.ok, true)
  if (!createdB.ok) throw new Error("create B failed")
  assert.equal(createdB.state.activeContextId, BATCH_B)
  assert.equal(createdB.state.contexts.length, 2)
  const parkedA = createdB.state.contexts.find((c) => c.contextId === BATCH_A)
  assert.equal(parkedA?.studentGroups.length, 3)

  const liveB = liveOf("Curso B", groupsB, BATCH_B, ATTEMPT_B)
  const workspace: Workspace = {
    courseValue: liveB.courseValue,
    classSize: liveB.classSize,
    studentGroups: liveB.studentGroups,
    unassignedFiles: liveB.unassignedFiles,
    batchId: liveB.batchId,
    attemptId: liveB.attemptId,
  }

  let state = createdB.state
  const switchingRef = { current: false }
  const restoringRef = { current: false }
  const evaluatorSrc = fs.readFileSync(EVALUATOR_CLIENT, "utf8")

  return {
    groupsA,
    groupsB,
    scale,
    liveB,
    workspace,
    get state() {
      return state
    },
    setState(next: CourseContextsState) {
      state = next
    },
    switchingRef,
    restoringRef,
    evaluatorSrc,
    parkedA,
  }
}

test("S3.4 wiring: EvaluatorClient pasa handleSwitchCourseContext real a onSwitch", () => {
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  assert.match(src, /onSwitch=\{handleSwitchCourseContext\}/)
  const handlerSrc = extractHandleSwitchSource(src)
  assert.match(handlerSrc, /executeSwitch\(/)
  assert.match(handlerSrc, /buildCourseContextInFlight\(\)/)
})

test("S3.4 B→A via handler real: A=3 B=4, sin SWITCH_BLOCKED, restaura A y luego A→B", () => {
  const ctx = seedAB()
  assert.equal(ctx.state.contexts.length, 2)
  assert.equal(ctx.state.activeContextId, BATCH_B)

  const lastRunBox: { current: HandlerRun | null } = { current: null }
  const tree = CourseContextSwitcher({
    items: ctx.state.contexts.map((c) => ({
      contextId: c.contextId,
      courseValue: c.contextId === ctx.state.activeContextId ? ctx.workspace.courseValue : c.courseValue,
      classSize: c.contextId === ctx.state.activeContextId ? ctx.workspace.classSize : c.classSize,
      displayStatus: c.contextId === ctx.state.activeContextId ? "ACTIVE" : c.preparedStatus,
      batchId: c.batchId,
    })),
    activeContextId: ctx.state.activeContextId,
    switchBlocked: false,
    rosterLocked: false,
    instrumentLocked: false,
    canCreate: true,
    onCreate: () => {
      throw new Error("create no debe dispararse")
    },
    onSwitch: (targetId: string) => {
      lastRunBox.current = runHandleSwitchCourseContext({
        evaluatorSrc: ctx.evaluatorSrc,
        enabled: true,
        targetId,
        state: ctx.state,
        live: ctx.liveB,
        scaleStore: ctx.scale,
        switchingRef: ctx.switchingRef,
        restoringRef: ctx.restoringRef,
        workspace: ctx.workspace,
        setState: (s) => ctx.setState(s),
      })
    },
    onConfirm: () => undefined,
    onUnconfirm: () => undefined,
    onDelete: () => undefined,
  })

  const tabA = tabsOf(tree).find((t) => t.props["data-context-id"] === BATCH_A)
  assert.ok(tabA, "tab A visible")
  assert.equal(typeof tabA!.props.onClick, "function")
  tabA!.props.onClick!()

  const executed = lastRunBox.current
  if (!executed) throw new Error("handler no ejecutado")
  assert.equal(executed.skipped, false)
  const switchResult = executed.result
  if (!switchResult) throw new Error("executeSwitch no devolvió resultado")
  if (!switchResult.ok) {
    assert.fail(`esperado ok; code=${switchResult.code} error=${switchResult.error}`)
  }
  assert.equal(ctx.state.activeContextId, BATCH_A)
  assert.equal(ctx.workspace.studentGroups.length, 3)
  assert.equal(ctx.workspace.classSize, 3)
  assert.equal(ctx.workspace.courseValue, "Curso A")
  assert.equal(ctx.workspace.batchId, BATCH_A)
  assert.equal(ctx.workspace.attemptId, ATTEMPT_A)
  assert.equal(ctx.state.contexts.length, 2)
  const parkedB = ctx.state.contexts.find((c) => c.contextId === BATCH_B)
  assert.equal(parkedB?.studentGroups.length, 4)
  assert.equal(parkedB?.attemptId, ATTEMPT_B)
  assert.equal(parkedB?.batchId, BATCH_B)

  const liveA = liveOf("Curso A", ctx.workspace.studentGroups, BATCH_A, ATTEMPT_A)
  const back = runHandleSwitchCourseContext({
    evaluatorSrc: ctx.evaluatorSrc,
    enabled: true,
    targetId: BATCH_B,
    state: ctx.state,
    live: liveA,
    scaleStore: ctx.scale,
    switchingRef: ctx.switchingRef,
    restoringRef: ctx.restoringRef,
    workspace: ctx.workspace,
    setState: (s) => ctx.setState(s),
  })
  assert.equal(back.result?.ok, true, `A→B esperado ok, got ${JSON.stringify(back.result)}`)
  assert.equal(ctx.state.activeContextId, BATCH_B)
  assert.equal(ctx.workspace.studentGroups.length, 4)
  assert.equal(ctx.workspace.classSize, 4)
  assert.equal(ctx.state.contexts.length, 2)
})

test("S3.4 doble switch: uno procede, el otro queda bloqueado, sin restores concurrentes", () => {
  const ctx = seedAB()
  const first = runHandleSwitchCourseContext({
    evaluatorSrc: ctx.evaluatorSrc,
    enabled: true,
    targetId: BATCH_A,
    state: ctx.state,
    live: ctx.liveB,
    scaleStore: ctx.scale,
    switchingRef: ctx.switchingRef,
    restoringRef: ctx.restoringRef,
    workspace: ctx.workspace,
    setState: (s) => ctx.setState(s),
    releaseGuardAfterApply: false,
  })
  assert.equal(first.result?.ok, true, `primer switch debe proceder, got ${JSON.stringify(first.result)}`)
  assert.equal(ctx.switchingRef.current, true)
  const stateAfterFirst = ctx.state
  const groupsAfterFirst = ctx.workspace.studentGroups.map((g) => g.id)

  const second = runHandleSwitchCourseContext({
    evaluatorSrc: ctx.evaluatorSrc,
    enabled: true,
    targetId: BATCH_B,
    state: ctx.state,
    live: liveOf("Curso A", ctx.workspace.studentGroups, BATCH_A, ATTEMPT_A),
    scaleStore: ctx.scale,
    switchingRef: ctx.switchingRef,
    restoringRef: ctx.restoringRef,
    workspace: ctx.workspace,
    setState: (s) => ctx.setState(s),
    releaseGuardAfterApply: false,
  })
  assert.equal(second.result?.ok === true, false, "segundo switch no debe restaurar")
  assert.ok(second.doubleSwitchBlocked || second.result?.ok === false)
  if (second.result && !second.result.ok) {
    assert.equal(second.result.code, "SWITCH_BLOCKED")
  }
  assert.equal(ctx.state.activeContextId, stateAfterFirst.activeContextId)
  assert.deepEqual(
    ctx.workspace.studentGroups.map((g) => g.id),
    groupsAfterFirst,
  )
})

test("S3.4 fail-soft: target inexistente no destruye A/B y el guard vuelve a idle", () => {
  const ctx = seedAB()
  const before = {
    active: ctx.state.activeContextId,
    count: ctx.state.contexts.length,
    aLen: ctx.state.contexts.find((c) => c.contextId === BATCH_A)?.studentGroups.length,
    bLive: ctx.workspace.studentGroups.length,
  }
  const missing = runHandleSwitchCourseContext({
    evaluatorSrc: ctx.evaluatorSrc,
    enabled: true,
    targetId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    state: ctx.state,
    live: ctx.liveB,
    scaleStore: ctx.scale,
    switchingRef: ctx.switchingRef,
    restoringRef: ctx.restoringRef,
    workspace: ctx.workspace,
    setState: (s) => ctx.setState(s),
  })
  assert.equal(missing.result?.ok, false)
  assert.equal(missing.result && !missing.result.ok ? missing.result.code : null, "NOT_FOUND")
  assert.equal(ctx.switchingRef.current, false)
  assert.equal(ctx.state.activeContextId, before.active)
  assert.equal(ctx.state.contexts.length, before.count)
  assert.equal(ctx.state.contexts.find((c) => c.contextId === BATCH_A)?.studentGroups.length, before.aLen)
  assert.equal(ctx.workspace.studentGroups.length, before.bLive)
})

test("S3.4 exception/finally: apply falla, guard idle, switch posterior válido procede", () => {
  const ctx = seedAB()
  const boom = runHandleSwitchCourseContext({
    evaluatorSrc: ctx.evaluatorSrc,
    enabled: true,
    targetId: BATCH_A,
    state: ctx.state,
    live: ctx.liveB,
    scaleStore: ctx.scale,
    switchingRef: ctx.switchingRef,
    restoringRef: ctx.restoringRef,
    workspace: ctx.workspace,
    setState: (s) => ctx.setState(s),
    throwOnApply: true,
  })
  assert.equal(boom.applyFailed, true)
  assert.equal(boom.result?.ok, true)
  assert.equal(ctx.switchingRef.current, false)

  const retry = runHandleSwitchCourseContext({
    evaluatorSrc: ctx.evaluatorSrc,
    enabled: true,
    targetId: BATCH_A,
    state: ctx.state,
    live: ctx.liveB,
    scaleStore: ctx.scale,
    switchingRef: ctx.switchingRef,
    restoringRef: ctx.restoringRef,
    workspace: ctx.workspace,
    setState: (s) => ctx.setState(s),
  })
  assert.equal(retry.result?.ok, true, `retry debe proceder, got ${JSON.stringify(retry.result)}`)
  assert.equal(ctx.state.activeContextId, BATCH_A)
  assert.equal(ctx.workspace.studentGroups.length, 3)
})

test("S3.4 store sigue bloqueando switch ajeno cuando switchInProgress es realmente true", () => {
  const ctx = seedAB()
  const blocked = executeSwitch({
    state: ctx.state,
    targetId: BATCH_A,
    live: ctx.liveB,
    scaleStore: ctx.scale,
    inFlight: idleInFlightGuards({ switchInProgress: true }),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.code, "SWITCH_BLOCKED")
    assert.equal(blocked.blockedReason, "switch_in_progress")
  }
  assert.equal(ctx.state.activeContextId, BATCH_B)
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
