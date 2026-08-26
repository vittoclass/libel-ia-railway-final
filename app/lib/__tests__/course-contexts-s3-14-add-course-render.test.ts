/**
 * S3.14 — Re-render mínimo al liberar refs de course context (botón «+ Curso» stale).
 * Camino real: store createContext + deriveCourseContextSwitchBlocked + CourseContextSwitcher
 * + contrato de applyCourseContextWorkspace leído de EvaluatorClient.tsx.
 * No monta EvaluatorClient (harness React de 11k líneas inexistente).
 * Ejecutar: npx tsx app/lib/__tests__/course-contexts-s3-14-add-course-render.test.ts
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
import { buildInstrumentFingerprint } from "../course-contexts/helpers"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = process.cwd()
const EVALUATOR_CLIENT = path.join(ROOT, "app", "EvaluatorClient.tsx")
const SWITCHER = path.join(ROOT, "app", "components", "evaluator", "CourseContextSwitcher.tsx")
const STORE = path.join(ROOT, "app", "lib", "course-contexts", "store.ts")
const TYPES = path.join(ROOT, "app", "lib", "course-contexts", "types.ts")
const PRE_SNAP = path.join(
  ROOT,
  "_audit_course_contexts_s3_14_add_course_render",
  "PRE",
  "EvaluatorClient.tsx.pre-snap",
)
const INSTRUMENT = buildInstrumentFingerprint("exam-S314", "mixta")
const IDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
]

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

function emptyGroup(index: number): CourseContextGroupLike {
  return group({ id: `student-empty-${index}`, studentName: `Alumno ${index + 1}` })
}

function preview(name: string): CourseContextFileLike {
  const file = new File([`s314-${name}`], name, { type: "image/jpeg", lastModified: 1_700_000_000_000 })
  return {
    id: `fp-${name}`,
    file,
    previewUrl: `blob:${name}`,
    dataUrl: "data:image/jpeg;base64,S314",
  }
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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

function extractApplySource(src: string): string {
  const start = src.indexOf("const applyCourseContextWorkspace")
  const end = src.indexOf("const handleCreateCourseContext")
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("No se pudo extraer applyCourseContextWorkspace")
  }
  return src.slice(start, end)
}

function extractCreateSource(src: string): string {
  const start = src.indexOf("const handleCreateCourseContext")
  const end = src.indexOf("const handleSwitchCourseContext")
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("No se pudo extraer handleCreateCourseContext")
  }
  return src.slice(start, end)
}

function extractSwitchSource(src: string): string {
  const start = src.indexOf("const handleSwitchCourseContext")
  const end = src.indexOf("const handleConfirmCourseContext")
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("No se pudo extraer handleSwitchCourseContext")
  }
  return src.slice(start, end)
}

function extractTimeoutBody(applySrc: string): string {
  const m = applySrc.match(/window\.setTimeout\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*0\s*\)/)
  if (!m) throw new Error("setTimeout(0) de apply no encontrado")
  return m[1]
}

function timeoutReleasesThenBumps(applySrc: string): boolean {
  const body = stripComments(extractTimeoutBody(applySrc))
  const restFalse = body.search(/restoringCourseContextRef\.current\s*=\s*false/)
  const swFalse = body.search(/switchingCourseContextRef\.current\s*=\s*false/)
  const bump = body.search(/bumpCourseContextRender\(\s*\(\s*v\s*\)\s*=>\s*v\s*\+\s*1\s*\)/)
  return restFalse >= 0 && swFalse >= 0 && bump >= 0 && bump > restFalse && bump > swFalse
}

function timeoutReleasesWithoutBump(applySrc: string): boolean {
  const body = stripComments(extractTimeoutBody(applySrc))
  const restFalse = body.search(/restoringCourseContextRef\.current\s*=\s*false/)
  const swFalse = body.search(/switchingCourseContextRef\.current\s*=\s*false/)
  const bump = body.search(/bumpCourseContextRender/)
  return restFalse >= 0 && swFalse >= 0 && bump < 0
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

function flattenText(node: unknown): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join("")
  if (React.isValidElement(node)) return flattenText((node.props as { children?: unknown }).children)
  return ""
}

function addCourseButton(tree: unknown): React.ReactElement<{ disabled?: boolean; onClick?: () => void; children?: unknown }> {
  const found = collect(tree).find((el) => flattenText(el.props.children).trim() === "+ Curso")
  assert.ok(found, "falta botón + Curso")
  return found as React.ReactElement<{ disabled?: boolean; onClick?: () => void; children?: unknown }>
}

type Paint = {
  canCreate: boolean
  switchBlocked: boolean
  disabled: boolean
  renderCount: number
}

function paintButton(opts: {
  contextsLength: number
  switching: boolean
  restoring: boolean
  foreign?: Partial<{
    isLoading: boolean
    mobileBatchSyncing: boolean
    isExtractingNames: boolean
    poll13s: boolean
    formWatch: boolean
    qrStorage: boolean
  }>
}): Omit<Paint, "renderCount"> {
  const canCreate = opts.contextsLength < MAX_COURSE_CONTEXTS
  const blocked = deriveCourseContextSwitchBlocked(
    idleInFlightGuards({
      switchInProgress: opts.switching,
      restoring: opts.restoring,
      isLoading: opts.foreign?.isLoading ?? false,
      mobileBatchSyncing: opts.foreign?.mobileBatchSyncing ?? false,
      isExtractingNames: opts.foreign?.isExtractingNames ?? false,
    }),
  )
  return {
    canCreate,
    switchBlocked: blocked.blocked,
    disabled: !canCreate || blocked.blocked,
  }
}

/**
 * Modelo del contrato React demostrado en S3.13:
 * setState de apply pinta con refs=true; setTimeout(0) libera refs;
 * solo un bump/setState posterior recalcula disabled.
 */
class RenderHarness {
  switching = false
  restoring = false
  contextsLength = 0
  lastPaint: Paint = { canCreate: true, switchBlocked: false, disabled: false, renderCount: 0 }
  renderCount = 0
  foreignPoll = 0
  foreignFormWatch = 0
  foreignQr = 0

  paint(): Paint {
    this.renderCount += 1
    const p = paintButton({
      contextsLength: this.contextsLength,
      switching: this.switching,
      restoring: this.restoring,
    })
    this.lastPaint = { ...p, renderCount: this.renderCount }
    return this.lastPaint
  }

  /** Camino real create/switch ok → apply. */
  applyBegin(): Paint {
    this.switching = true
    this.restoring = true
    return this.paint()
  }

  /** Cleanup timeout(0). hasBump = POST S3.14; false = PRE R3. */
  timeoutCleanup(hasBump: boolean): Paint {
    this.switching = false
    this.restoring = false
    if (hasBump) return this.paint()
    return this.lastPaint
  }
}

function renderSwitcher(opts: {
  items: Array<{ contextId: string; courseValue: string; classSize: number; displayStatus: "DRAFT" | "ACTIVE"; batchId: string }>
  activeContextId: string | null
  switchBlocked: boolean
  canCreate: boolean
  onCreate?: () => void
}) {
  return CourseContextSwitcher({
    items: opts.items,
    activeContextId: opts.activeContextId,
    switchBlocked: opts.switchBlocked,
    switchBlockedReason: opts.switchBlocked ? "Cambio bloqueado" : null,
    rosterLocked: false,
    instrumentLocked: false,
    canCreate: opts.canCreate,
    onCreate: opts.onCreate ?? (() => undefined),
    onSwitch: () => {
      throw new Error("switch no debe dispararse en este test")
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

test("S3.14 source: hook tick existe a nivel de componente y timeout bump AFTER refs false", () => {
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  assert.match(src, /const\s*\[\s*,\s*bumpCourseContextRender\s*\]\s*=\s*useState\(\s*0\s*\)/)
  const apply = extractApplySource(src)
  assert.equal(timeoutReleasesThenBumps(apply), true)
  const timeout = stripComments(extractTimeoutBody(apply))
  assert.doesNotMatch(timeout, /form\.setValue/)
  assert.doesNotMatch(timeout, /setInterval/)
  assert.doesNotMatch(timeout, /requestAnimationFrame/)
  assert.doesNotMatch(timeout, /syncMobileBatchPhotos/)
  assert.doesNotMatch(timeout, /poll/i)
  const create = extractCreateSource(src)
  assert.match(create, /switchingCourseContextRef\.current\s*=\s*true/)
  assert.match(create, /applyCourseContextWorkspace/)
  const sw = extractSwitchSource(src)
  assert.match(sw, /if\s*\(\s*switchingCourseContextRef\.current\s*\)\s*return/)
})

test("S3.14 PRE_REPRO: snapshot PRE timeout libera refs SIN bump (FAIL del contrato POST)", () => {
  assert.equal(fs.existsSync(PRE_SNAP), true, "falta snapshot PRE")
  const pre = fs.readFileSync(PRE_SNAP, "utf8")
  const apply = extractApplySource(pre)
  assert.equal(timeoutReleasesWithoutBump(apply), true)
  assert.doesNotMatch(pre, /bumpCourseContextRender/)
  const ui = new RenderHarness()
  ui.contextsLength = 1
  const during = ui.applyBegin()
  assert.equal(during.disabled, true)
  const after = ui.timeoutCleanup(false)
  assert.equal(ui.switching, false)
  assert.equal(ui.restoring, false)
  assert.equal(after.disabled, true, "PRE: DOM stale sigue disabled tras timeout")
  assert.equal(after.renderCount, during.renderCount, "PRE: no hay render al liberar refs")
})

test("T1 0 contexts → +Curso habilitable", () => {
  const tree = renderSwitcher({
    items: [],
    activeContextId: null,
    switchBlocked: false,
    canCreate: 0 < MAX_COURSE_CONTEXTS,
  })
  const btn = addCourseButton(tree)
  assert.equal(btn.props.disabled, false)
})

test("T2-T11 create A/B/C/D settle habilita; quinto bloqueado por max 4", () => {
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  assert.equal(timeoutReleasesThenBumps(extractApplySource(src)), true)
  const scale = memoryStore()
  let state = createEmptyCourseContextsState()
  const snapshots: Array<{ id: string; groups: number; course: string; files: number }> = []
  const ui = new RenderHarness()

  const idleTree = renderSwitcher({
    items: [],
    activeContextId: null,
    switchBlocked: false,
    canCreate: true,
  })
  assert.equal(addCourseButton(idleTree).props.disabled, false)

  const labels = ["Curso A", "Curso B", "Curso C", "Curso D"]
  for (let i = 0; i < 4; i++) {
    const groups =
      i === 0
        ? [group({ id: `g-A-0`, studentName: "A1", files: [preview("a0.jpg")] })]
        : [emptyGroup(0)]
    const live = liveOf(labels[i], groups, IDS[i], `attempt-${labels[i]}`)
    if (i > 0) {
      live.studentGroups = [emptyGroup(0)]
      live.classSize = 1
    }
    const result = createContext({
      state,
      live: i === 0 ? live : liveOf(labels[i - 1], state.contexts[i - 1] ? state.contexts[i - 1].studentGroups : groups, IDS[i - 1], `attempt-${labels[i - 1]}`),
      scaleStore: scale,
      newBatchId: IDS[i],
      emptyGroupFactory: emptyGroup,
      inFlight: idleInFlightGuards(),
    })
    assert.equal(result.ok, true, `create ${labels[i]} debe ok, got ${JSON.stringify(result)}`)
    if (!result.ok) throw new Error("create fail")
    state = result.state
    assert.equal(state.contexts.length, i + 1)
    ui.contextsLength = state.contexts.length
    const during = ui.applyBegin()
    const duringTree = renderSwitcher({
      items: itemsFromState(state),
      activeContextId: state.activeContextId,
      switchBlocked: during.switchBlocked,
      canCreate: during.canCreate,
    })
    assert.equal(addCourseButton(duringTree).props.disabled, true, `T3/T12 durante apply ${labels[i]} disabled`)
    const after = ui.timeoutCleanup(true)
    assert.equal(ui.switching, false)
    assert.equal(ui.restoring, false)
    assert.equal(after.renderCount, during.renderCount + 1, "T14 release provoca render")
    const afterTree = renderSwitcher({
      items: itemsFromState(state),
      activeContextId: state.activeContextId,
      switchBlocked: after.switchBlocked,
      canCreate: after.canCreate,
    })
    const expectDisabled = state.contexts.length >= MAX_COURSE_CONTEXTS
    assert.equal(
      addCourseButton(afterTree).props.disabled,
      expectDisabled,
      `tras settle ${labels[i]} disabled=${expectDisabled}`,
    )
    assert.equal(after.disabled, expectDisabled)
    const parked = state.contexts.find((c) => c.contextId === state.contexts[i].contextId)
    snapshots.push({
      id: parked!.contextId,
      groups: parked!.studentGroups.length,
      course: parked!.courseValue,
      files: parked!.studentGroups.reduce((n, g) => n + g.files.length, 0),
    })
  }

  assert.equal(state.contexts.length, 4)
  assert.equal(MAX_COURSE_CONTEXTS, 4)
  const fifth = createContext({
    state,
    live: liveOf("Curso E", [emptyGroup(0)], IDS[4], "attempt-E"),
    scaleStore: scale,
    newBatchId: IDS[4],
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(fifth.ok, false)
  if (!fifth.ok) {
    assert.equal(fifth.code, "MAX_CONTEXTS")
  }
  assert.equal(state.contexts.length, 4)
  const maxTree = renderSwitcher({
    items: itemsFromState(state),
    activeContextId: state.activeContextId,
    switchBlocked: false,
    canCreate: state.contexts.length < MAX_COURSE_CONTEXTS,
  })
  const maxBtn = addCourseButton(maxTree)
  assert.equal(maxBtn.props.disabled, true)
  assert.equal(state.contexts.length >= MAX_COURSE_CONTEXTS, true)
  assert.equal(snapshots.length, 4)
  assert.equal(snapshots[0].files, 1, "T20 A conserva foto")
  assert.equal(state.contexts[0].studentGroups[0].files[0].id, "fp-a0.jpg")
})

test("T12 switching guard sigue bloqueando temporalmente", () => {
  const p = paintButton({ contextsLength: 1, switching: true, restoring: false })
  assert.equal(p.switchBlocked, true)
  assert.equal(p.canCreate, true)
  assert.equal(p.disabled, true)
  const tree = renderSwitcher({
    items: [{ contextId: IDS[0], courseValue: "A", classSize: 1, displayStatus: "ACTIVE", batchId: IDS[0] }],
    activeContextId: IDS[0],
    switchBlocked: true,
    canCreate: true,
  })
  assert.equal(addCourseButton(tree).props.disabled, true)
})

test("T13 restoring guard sigue bloqueando temporalmente", () => {
  const p = paintButton({ contextsLength: 2, switching: false, restoring: true })
  assert.equal(p.switchBlocked, true)
  assert.equal(p.disabled, true)
})

test("T14-T17 POST settle habilita SIN poll / form.watch / QR", () => {
  const ui = new RenderHarness()
  ui.contextsLength = 1
  ui.applyBegin()
  const after = ui.timeoutCleanup(true)
  assert.equal(after.disabled, false)
  assert.equal(ui.foreignPoll, 0)
  assert.equal(ui.foreignFormWatch, 0)
  assert.equal(ui.foreignQr, 0)
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  const timeout = stripComments(extractTimeoutBody(extractApplySource(src)))
  assert.doesNotMatch(timeout, /13000/)
  assert.doesNotMatch(timeout, /form\.watch/)
  assert.doesNotMatch(timeout, /BroadcastChannel/)
  assert.doesNotMatch(timeout, /addEventListener\(\s*["']storage["']/)
})

test("T18 double-click: botón disabled durante apply impide segundo onCreate", () => {
  let creates = 0
  const tree = renderSwitcher({
    items: [{ contextId: IDS[0], courseValue: "A", classSize: 1, displayStatus: "ACTIVE", batchId: IDS[0] }],
    activeContextId: IDS[0],
    switchBlocked: true,
    canCreate: true,
    onCreate: () => {
      creates += 1
    },
  })
  const btn = addCourseButton(tree)
  assert.equal(btn.props.disabled, true)
  if (!btn.props.disabled && btn.props.onClick) btn.props.onClick()
  assert.equal(creates, 0)
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  const sw = extractSwitchSource(src)
  assert.match(stripComments(sw), /if\s*\(\s*switchingCourseContextRef\.current\s*\)\s*return/)
})

test("T19 invalid/fail-soft no deja guard pegado (create fail / switch fail)", () => {
  const scale = memoryStore()
  const empty = createEmptyCourseContextsState()
  const first = createContext({
    state: empty,
    live: liveOf("A", [group({ id: "g0", files: [] })], IDS[0], "att-A"),
    scaleStore: scale,
    newBatchId: IDS[0],
    inFlight: idleInFlightGuards({ switchInProgress: true }),
  })
  assert.equal(first.ok, true, "primer contexto ignora inFlight")

  const blockedCreate = createContext({
    state: first.ok ? first.state : empty,
    live: liveOf("B", [emptyGroup(0)], IDS[1], "att-B"),
    scaleStore: scale,
    newBatchId: IDS[1],
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards({ switchInProgress: true }),
  })
  assert.equal(blockedCreate.ok, false)
  if (!blockedCreate.ok) assert.equal(blockedCreate.code, "SWITCH_BLOCKED")

  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  const sw = stripComments(extractSwitchSource(src))
  assert.match(sw, /if\s*\(\s*!result\.ok\)[\s\S]*switchingCourseContextRef\.current\s*=\s*false/)
  assert.match(sw, /catch[\s\S]*switchingCourseContextRef\.current\s*=\s*false/)

  const seeded = first.ok ? first.state : empty
  const badSwitch = executeSwitch({
    state: seeded,
    targetId: IDS[4],
    live: liveOf("A", seeded.contexts[0].studentGroups, IDS[0], "att-A"),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(badSwitch.ok, false)
  const ui = new RenderHarness()
  ui.contextsLength = 1
  ui.switching = false
  ui.restoring = false
  const idle = ui.paint()
  assert.equal(idle.disabled, false)
})

test("T20 A/B/C/D snapshots intactos tras ciclo create+settle", () => {
  const scale = memoryStore()
  const groupsA = [
    group({ id: "ga", studentName: "Ana", studentRut: "1-9", files: [preview("ana.jpg")], isEvaluated: true }),
  ]
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: liveOf("8A", groupsA, IDS[0], "att-A"),
    scaleStore: scale,
    newBatchId: IDS[0],
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) throw new Error("A")
  const b = createContext({
    state: a.state,
    live: liveOf("8A", groupsA, IDS[0], "att-A"),
    scaleStore: scale,
    newBatchId: IDS[1],
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(b.ok, true)
  if (!b.ok) throw new Error("B")
  const parkedA = b.state.contexts.find((c) => c.contextId === IDS[0] || c.batchId === IDS[0])
  assert.ok(parkedA)
  assert.equal(parkedA!.studentGroups[0].studentName, "Ana")
  assert.equal(parkedA!.studentGroups[0].studentRut, "1-9")
  assert.equal(parkedA!.studentGroups[0].files[0].id, "fp-ana.jpg")
  assert.equal(parkedA!.studentGroups[0].isEvaluated, true)
  assert.equal(parkedA!.courseValue, "8A")
})

test("S3.14 Switcher/store/max4 no se parchearon", () => {
  const switcher = fs.readFileSync(SWITCHER, "utf8")
  assert.match(switcher, /disabled=\{\s*!props\.canCreate\s*\|\|\s*props\.switchBlocked\s*\}/)
  assert.doesNotMatch(switcher, /disabled=\{\s*!props\.canCreate\s*\}/)
  const types = fs.readFileSync(TYPES, "utf8")
  assert.match(types, /MAX_COURSE_CONTEXTS\s*=\s*4/)
  const store = fs.readFileSync(STORE, "utf8")
  assert.match(store, /if\s*\(\s*state\.contexts\.length\s*>=\s*MAX_COURSE_CONTEXTS\s*\)/)
  assert.equal(MAX_COURSE_CONTEXTS, 4)
})

test("S3.14 tick no es negocio: no persiste, no entra a snapshot, no muta batch", () => {
  const src = fs.readFileSync(EVALUATOR_CLIENT, "utf8")
  const apply = extractApplySource(src)
  const timeout = stripComments(extractTimeoutBody(apply))
  assert.doesNotMatch(timeout, /setStudentGroups/)
  assert.doesNotMatch(timeout, /setClassSize/)
  assert.doesNotMatch(timeout, /setEvaluationBatchIdUi/)
  assert.doesNotMatch(timeout, /writeDocenteActiveBatchId/)
  assert.doesNotMatch(timeout, /createContext/)
  assert.doesNotMatch(timeout, /executeSwitch/)
  assert.doesNotMatch(timeout, /beginSelectiveRetry/)
  assert.match(src, /Sin significado de negocio/)
  const hookIdx = src.search(/const\s*\[\s*,\s*bumpCourseContextRender\s*\]\s*=\s*useState\(\s*0\s*\)/)
  const applyIdx = src.indexOf("const applyCourseContextWorkspace")
  assert.ok(hookIdx >= 0 && hookIdx < applyIdx, "hook no es condicional dentro de apply")
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
