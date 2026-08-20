/**
 * S3 — Course contexts (capa aislada). OFFLINE.
 * Ejecutar: npx tsx app/lib/__tests__/course-contexts.test.ts
 */
import assert from "node:assert/strict"
import {
  COURSE_CONTEXTS_ENABLED_DEFAULT,
  isCourseContextsEnabled,
  shouldMountCourseContextSwitcher,
} from "../course-contexts/flag"
import {
  applyClassSizeWorkspaceChange,
  buildInstrumentFingerprint,
  collectContextPreviewUrls,
  collectOwnedPreviewUrls,
  countActiveIds,
  createEmptyCourseContextsState,
  deriveCourseContextSwitchBlocked,
  displayContextStatus,
  durableContextView,
  idleInFlightGuards,
  isInstrumentLocked,
  isRosterLocked,
  isScaleBlobRestorable,
  parkFilePreview,
  parkGroups,
  readScaleBlob,
  revokeOwnedPreviewUrls,
  shouldAdoptStorageActiveBatch,
  shouldMergeQrSyncForActiveBatch,
  shouldSkipClassSizeWorkspaceWipe,
  snapshotFromLive,
} from "../course-contexts/helpers"
import {
  confirmContext,
  createContext,
  deleteContext,
  executeSwitch,
  unconfirmContext,
} from "../course-contexts/store"
import {
  COURSE_CONTEXT_SCALE_KEY,
  MAX_COURSE_CONTEXTS,
  MAX_CONTEXTS_MESSAGE,
  type CourseContextFileLike,
  type CourseContextGroupLike,
  type LiveWorkspace,
  type ScaleKvStore,
} from "../course-contexts/types"
import {
  SELECTIVE_RETRY_COMPLETED_KEY,
  classifyEvaluateError,
  computeSelectiveRetryFileFingerprint,
  computeSelectiveRetryGroupFingerprint,
  selectGroupIdsToEvaluate,
  shouldApplyQrSyncPhotos,
  type SelectiveRetryGroupSnapshot,
} from "../../useEvaluator"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const BATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const BATCH_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const BATCH_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const BATCH_E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const ATTEMPT_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ATTEMPT_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const INSTRUMENT = buildInstrumentFingerprint("exam-P1", "mixta")

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

function makeFile(name: string, lastModified = 1_700_000_000_000): File {
  return new File([`bytes-${name}`], name, { type: "image/jpeg", lastModified })
}

function preview(file: File, extra?: Partial<CourseContextFileLike>): CourseContextFileLike {
  return {
    id: extra?.id ?? `fp-${file.name}`,
    file,
    previewUrl: extra?.previewUrl ?? `blob:${file.name}`,
    dataUrl: extra?.dataUrl ?? "data:image/jpeg;base64,AAAA",
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

function live(partial: Partial<LiveWorkspace> & { batchId: string }): LiveWorkspace {
  return {
    courseValue: "Curso A",
    classSize: 1,
    imagesPerStudent: 1,
    studentGroups: [group({ id: "student-a-0", studentName: "Alumno 1" })],
    unassignedFiles: [],
    attemptId: ATTEMPT_A,
    captureMode: null,
    instrumentFingerprint: INSTRUMENT,
    ...partial,
  }
}

function emptyGroup(index: number): CourseContextGroupLike {
  return group({ id: `student-empty-${index}`, studentName: `Alumno ${index + 1}` })
}

function toSnaps(groups: CourseContextGroupLike[], attemptId: string): SelectiveRetryGroupSnapshot[] {
  return groups.map((g) => {
    const fp = computeSelectiveRetryGroupFingerprint(
      g.files.map((f) => ({ file: f.file, mobileBatchPhotoId: f.mobileBatchPhotoId })),
    )
    return {
      id: g.id,
      hasFiles: g.files.length > 0,
      isEvaluated: g.isEvaluated === true,
      isEvaluating: g.isEvaluating === true,
      evaluationId: g.evaluation_id,
      promotedEvaluationId: g.promotedEvaluationId,
      error: g.error,
      isValidationStep: g.isValidationStep,
      currentAttemptId: attemptId,
      inputFingerprint: fp || undefined,
      completedAttemptId: g.selectiveRetryAttemptId ?? undefined,
      completedFingerprint: g.selectiveRetryInputFingerprint ?? undefined,
    }
  })
}

test("T1 feature OFF PRE≡POST (flag, mount, adopt, wipe actual)", () => {
  assert.equal(COURSE_CONTEXTS_ENABLED_DEFAULT, false)
  assert.equal(isCourseContextsEnabled({}), false)
  assert.equal(isCourseContextsEnabled({ NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED: undefined }), false)
  assert.equal(shouldMountCourseContextSwitcher(false), false)
  assert.equal(
    shouldAdoptStorageActiveBatch({ featureOn: false, incomingBatchId: BATCH_B, activeBatchId: BATCH_A }),
    true,
  )
  const wiped = applyClassSizeWorkspaceChange({
    restoring: false,
    classSize: 3,
    prevGroups: [group({ id: "keep" })],
    prevUnassigned: [preview(makeFile("u.jpg"))],
    buildEmptyGroups: (n) => Array.from({ length: n }, (_, i) => emptyGroup(i)),
  })
  assert.equal(wiped.wiped, true)
  assert.equal(wiped.groups.length, 3)
  assert.equal(wiped.unassigned.length, 0)
})

test("T1b feature ON local env", () => {
  assert.equal(isCourseContextsEnabled({ NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED: "true" }), true)
  assert.equal(shouldMountCourseContextSwitcher(true), true)
})

test("T2 crear context A", () => {
  const store = memoryStore()
  const created = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A, courseValue: "8A" }),
    scaleStore: store,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(created.ok, true)
  if (!created.ok) return
  assert.equal(created.state.contexts.length, 1)
  assert.equal(created.state.activeContextId, BATCH_A)
  assert.equal(created.activated?.courseValue, "8A")
  assert.equal(displayContextStatus(created.activated!.preparedStatus, BATCH_A, BATCH_A), "ACTIVE")
})

test("T3 crear B", () => {
  const scale = memoryStore({ [COURSE_CONTEXT_SCALE_KEY]: JSON.stringify({ v: 2, batchId: BATCH_A, attemptId: ATTEMPT_A }) })
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = createContext({
    state: a.state,
    live: live({ batchId: BATCH_A, studentGroups: [group({ id: "a0", studentName: "Ana" })] }),
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(b.ok, true)
  if (!b.ok) return
  assert.equal(b.state.contexts.length, 2)
  assert.equal(b.state.activeContextId, BATCH_B)
  const parkedA = b.state.contexts.find((c) => c.contextId === BATCH_A)
  assert.equal(parkedA?.studentGroups[0]?.studentName, "Ana")
  assert.equal(b.activated?.batchId, BATCH_B)
  assert.notEqual(parkedA?.batchId, b.activated?.batchId)
})

test("T4 max 4 + T5 no 5º", () => {
  let state = createEmptyCourseContextsState()
  const scale = memoryStore()
  const ids = [BATCH_A, BATCH_B, BATCH_C, BATCH_D, BATCH_E]
  for (let i = 0; i < 4; i++) {
    const r = createContext({
      state,
      live: live({ batchId: i === 0 ? ids[0]! : state.activeContextId || ids[i]!, courseValue: `C${i}` }),
      scaleStore: scale,
      newBatchId: ids[i]!,
      emptyGroupFactory: emptyGroup,
      inFlight: idleInFlightGuards(),
    })
    assert.equal(r.ok, true)
    if (!r.ok) return
    state = r.state
  }
  assert.equal(state.contexts.length, MAX_COURSE_CONTEXTS)
  const fifth = createContext({
    state,
    live: live({ batchId: state.activeContextId || BATCH_D }),
    scaleStore: scale,
    newBatchId: BATCH_E,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(fifth.ok, false)
  if (fifth.ok) return
  assert.equal(fifth.code, "MAX_CONTEXTS")
  assert.equal(fifth.error, MAX_CONTEXTS_MESSAGE)
  assert.equal(fifth.state.contexts.length, 4)
})

test("T6 solo 1 active", () => {
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = createContext({
    state: a.state,
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(b.ok, true)
  if (!b.ok) return
  assert.equal(countActiveIds(b.state.activeContextId), 1)
  const actives = b.state.contexts.filter((c) => c.contextId === b.state.activeContextId)
  assert.equal(actives.length, 1)
})

test("T7 classSize restore no wipe", () => {
  const prev = [group({ id: "keep-1" }), group({ id: "keep-2" })]
  const un = [preview(makeFile("cola.jpg"))]
  const restored = applyClassSizeWorkspaceChange({
    restoring: true,
    classSize: 25,
    prevGroups: prev,
    prevUnassigned: un,
    buildEmptyGroups: (n) => Array.from({ length: n }, (_, i) => emptyGroup(i)),
  })
  assert.equal(restored.wiped, false)
  assert.equal(restored.groups, prev)
  assert.equal(restored.unassigned, un)
  assert.equal(shouldSkipClassSizeWorkspaceWipe(true), true)
  assert.equal(shouldSkipClassSizeWorkspaceWipe(false), false)
})

test("T8 roster lock READY; DRAFT editable; single-course sin contextos no lock", () => {
  assert.equal(isRosterLocked("DRAFT"), false)
  assert.equal(isRosterLocked("READY"), true)
  assert.equal(isInstrumentLocked([]), false)
  const empty = createEmptyCourseContextsState()
  assert.equal(isInstrumentLocked(empty.contexts), false)
})

test("T9 A→B y T10 B→A", () => {
  const scale = memoryStore({
    [COURSE_CONTEXT_SCALE_KEY]: JSON.stringify({ v: 2, batchId: BATCH_A, attemptId: ATTEMPT_A, groupCount: 1, completedByIndex: {} }),
  })
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A, courseValue: "A", studentGroups: [group({ id: "ga", studentName: "Ana" })] }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = createContext({
    state: a.state,
    live: live({ batchId: BATCH_A, courseValue: "A", studentGroups: [group({ id: "ga", studentName: "Ana" })] }),
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(b.ok, true)
  if (!b.ok) return
  assert.equal(b.state.activeContextId, BATCH_B)
  const back = executeSwitch({
    state: b.state,
    targetId: BATCH_A,
    live: live({
      batchId: BATCH_B,
      courseValue: "B",
      attemptId: ATTEMPT_B,
      studentGroups: [group({ id: "gb", studentName: "Beto" })],
    }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(back.state.activeContextId, BATCH_A)
  assert.equal(back.activated?.studentGroups[0]?.studentName, "Ana")
  assert.equal(back.activated?.courseValue, "A")
})

test("T11 A→B→A exact durable", () => {
  const fileA = makeFile("a.jpg", 111)
  const scale = memoryStore()
  const liveA = live({
    batchId: BATCH_A,
    courseValue: "A",
    studentGroups: [
      group({
        id: "ga",
        studentName: "Ana",
        studentRut: "11111111-1",
        observedOcrName: "ANA A",
        files: [preview(fileA, { id: "fa", previewUrl: "blob:a" })],
      }),
    ],
    unassignedFiles: [preview(makeFile("ua.jpg", 222), { id: "ua" })],
  })
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: liveA,
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const confirmed = confirmContext(a.state, BATCH_A)
  assert.equal(confirmed.ok, true)
  if (!confirmed.ok) return
  const toB = createContext({
    state: confirmed.state,
    live: liveA,
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(toB.ok, true)
  if (!toB.ok) return
  const back = executeSwitch({
    state: toB.state,
    targetId: BATCH_A,
    live: live({ batchId: BATCH_B, courseValue: "B", attemptId: ATTEMPT_B, studentGroups: [emptyGroup(0)] }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  const restored = durableContextView(back.activated!)
  const parkedAfterCreateB = durableContextView(toB.state.contexts.find((c) => c.contextId === BATCH_A)!)
  assert.deepEqual(restored.groups, parkedAfterCreateB.groups)
  assert.deepEqual(restored.unassigned, parkedAfterCreateB.unassigned)
  assert.equal(restored.batchId, BATCH_A)
  assert.equal(back.activated?.studentGroups[0]?.files[0]?.file, fileA)
})

test("T12-T14 SCALE park/restore A/B/A", () => {
  const blobA = JSON.stringify({ v: 2, batchId: BATCH_A, attemptId: ATTEMPT_A, groupCount: 2, completedByIndex: { "1": { evaluationId: "e1", fingerprint: "fpA", attemptId: ATTEMPT_A } } })
  const blobB = JSON.stringify({ v: 2, batchId: BATCH_B, attemptId: ATTEMPT_B, groupCount: 1, completedByIndex: {} })
  const scale = memoryStore({ [COURSE_CONTEXT_SCALE_KEY]: blobA })
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const toB = executeSwitch({
    state: {
      contexts: [
        a.state.contexts[0]!,
        snapshotFromLive(live({ batchId: BATCH_B, attemptId: ATTEMPT_B, courseValue: "B" }), blobB, "DRAFT"),
      ],
      activeContextId: BATCH_A,
    },
    targetId: BATCH_B,
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(toB.ok, true)
  if (!toB.ok) return
  assert.equal(readScaleBlob(scale), blobB)
  const back = executeSwitch({
    state: toB.state,
    targetId: BATCH_A,
    live: live({ batchId: BATCH_B, attemptId: ATTEMPT_B, courseValue: "B" }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(readScaleBlob(scale), blobA)
  assert.equal(back.activated?.attemptId, ATTEMPT_A)
})

test("T15 22+3 enqueue exactamente 3 tras restore", () => {
  const groups: CourseContextGroupLike[] = []
  for (let i = 0; i < 22; i++) {
    const f = makeFile(`ok-${i}.jpg`, 1000 + i)
    const fp = computeSelectiveRetryFileFingerprint({ file: f })
    groups.push(
      group({
        id: `c-${i}`,
        studentName: `Ok ${i}`,
        files: [preview(f)],
        isEvaluated: true,
        evaluation_id: `eval-${i}`,
        selectiveRetryAttemptId: ATTEMPT_A,
        selectiveRetryInputFingerprint: fp,
      }),
    )
  }
  for (let i = 0; i < 3; i++) {
    const f = makeFile(`fail-${i}.jpg`, 2000 + i)
    groups.push(
      group({
        id: `f-${i}`,
        studentName: `Fail ${i}`,
        files: [preview(f)],
        isEvaluated: false,
        error: i === 0 ? "BLANK_RESCUE_RESULT: hoja en blanco / failed" : "La evaluación asíncrona falló",
      }),
    )
  }
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A, studentGroups: groups, classSize: 25 }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const toB = createContext({
    state: a.state,
    live: live({ batchId: BATCH_A, studentGroups: groups, classSize: 25 }),
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(toB.ok, true)
  if (!toB.ok) return
  const back = executeSwitch({
    state: toB.state,
    targetId: BATCH_A,
    live: live({ batchId: BATCH_B, attemptId: ATTEMPT_B, studentGroups: [emptyGroup(0)] }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  const ids = selectGroupIdsToEvaluate(toSnaps(back.activated!.studentGroups, ATTEMPT_A))
  assert.equal(ids.length, 3)
  assert.deepEqual(ids, ["f-0", "f-1", "f-2"])
})

test("T16 attempt unchanged + T17 fingerprints unchanged", () => {
  const file = makeFile("same.jpg", 999)
  const fpBefore = computeSelectiveRetryFileFingerprint({ file })
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({
      batchId: BATCH_A,
      attemptId: ATTEMPT_A,
      studentGroups: [
        group({
          id: "g0",
          files: [preview(file)],
          isEvaluated: true,
          evaluation_id: "e0",
          selectiveRetryAttemptId: ATTEMPT_A,
          selectiveRetryInputFingerprint: fpBefore,
        }),
      ],
    }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const toB = createContext({
    state: a.state,
    live: a.activated
      ? {
          courseValue: a.activated.courseValue,
          classSize: a.activated.classSize,
          imagesPerStudent: 1,
          studentGroups: a.activated.studentGroups,
          unassignedFiles: a.activated.unassignedFiles,
          batchId: BATCH_A,
          attemptId: ATTEMPT_A,
          captureMode: null,
          instrumentFingerprint: INSTRUMENT,
        }
      : live({ batchId: BATCH_A }),
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(toB.ok, true)
  if (!toB.ok) return
  const back = executeSwitch({
    state: toB.state,
    targetId: BATCH_A,
    live: live({ batchId: BATCH_B, attemptId: ATTEMPT_B }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(back.activated?.attemptId, ATTEMPT_A)
  const restoredFile = back.activated!.studentGroups[0]!.files[0]!.file
  assert.equal(computeSelectiveRetryFileFingerprint({ file: restoredFile }), fpBefore)
})

test("T18 failed durable; isEvaluating no se parkea true", () => {
  const parked = parkGroups([
    group({ id: "x", isEvaluating: true, error: "La evaluación asíncrona falló", files: [preview(makeFile("f.jpg"))] }),
  ])
  assert.equal(parked[0]!.isEvaluating, false)
  assert.equal(parked[0]!.error, "La evaluación asíncrona falló")
})

test("T19 BLANK contract: error/files/attempt no cambian", () => {
  const f = makeFile("blank.jpg", 5)
  const err = "BLANK_RESCUE_RESULT: failed retryable"
  assert.equal(classifyEvaluateError(err), "retryable")
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({
      batchId: BATCH_A,
      studentGroups: [group({ id: "blank", error: err, files: [preview(f)] })],
    }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const toB = createContext({
    state: a.state,
    live: live({
      batchId: BATCH_A,
      studentGroups: [group({ id: "blank", error: err, files: [preview(f)] })],
    }),
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(toB.ok, true)
  if (!toB.ok) return
  const back = executeSwitch({
    state: toB.state,
    targetId: BATCH_A,
    live: live({ batchId: BATCH_B, attemptId: ATTEMPT_B }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(back.activated?.studentGroups[0]?.error, err)
  assert.equal(back.activated?.studentGroups[0]?.files[0]?.file, f)
})

test("T20 observedOcrName A != B y vuelve A", () => {
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({
      batchId: BATCH_A,
      studentGroups: [group({ id: "ga", observedOcrName: "NOMBRE A", studentName: "Ana" })],
    }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const withB = {
    ...a.state,
    contexts: [
      a.state.contexts[0]!,
      snapshotFromLive(
        live({
          batchId: BATCH_B,
          attemptId: ATTEMPT_B,
          courseValue: "B",
          studentGroups: [group({ id: "gb", observedOcrName: "NOMBRE B", studentName: "Beto" })],
        }),
        null,
        "DRAFT",
      ),
    ],
  }
  const toB = executeSwitch({
    state: withB,
    targetId: BATCH_B,
    live: live({
      batchId: BATCH_A,
      studentGroups: [group({ id: "ga", observedOcrName: "NOMBRE A", studentName: "Ana" })],
    }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(toB.ok, true)
  if (!toB.ok) return
  assert.equal(toB.activated?.studentGroups[0]?.observedOcrName, "NOMBRE B")
  const back = executeSwitch({
    state: toB.state,
    targetId: BATCH_A,
    live: live({
      batchId: BATCH_B,
      attemptId: ATTEMPT_B,
      studentGroups: [group({ id: "gb", observedOcrName: "NOMBRE B" })],
    }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(back.activated?.studentGroups[0]?.observedOcrName, "NOMBRE A")
  assert.notEqual(back.activated?.studentGroups[0]?.observedOcrName, "NOMBRE B")
})

test("T21 RUT A restaurado, no cruza a B", () => {
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({
      batchId: BATCH_A,
      studentGroups: [group({ id: "ga", studentRut: "12345678-5" })],
    }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const withB = {
    ...a.state,
    contexts: [
      a.state.contexts[0]!,
      snapshotFromLive(
        live({
          batchId: BATCH_B,
          attemptId: ATTEMPT_B,
          studentGroups: [group({ id: "gb", studentRut: "99999999-9" })],
        }),
        null,
        "DRAFT",
      ),
    ],
  }
  const toB = executeSwitch({
    state: withB,
    targetId: BATCH_B,
    live: live({ batchId: BATCH_A, studentGroups: [group({ id: "ga", studentRut: "12345678-5" })] }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(toB.ok, true)
  if (!toB.ok) return
  assert.equal(toB.activated?.studentGroups[0]?.studentRut, "99999999-9")
  const back = executeSwitch({
    state: toB.state,
    targetId: BATCH_A,
    live: live({ batchId: BATCH_B, attemptId: ATTEMPT_B, studentGroups: [group({ id: "gb", studentRut: "99999999-9" })] }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(back.activated?.studentGroups[0]?.studentRut, "12345678-5")
})

test("T22 same File identity + T23 lastModified + T24 order + T25 unassigned", () => {
  const f1 = makeFile("p1.jpg", 10)
  const f2 = makeFile("p2.jpg", 20)
  const u = makeFile("u.jpg", 30)
  const parked = parkFilePreview(preview(f1, { dataUrl: "data:xxx" }))
  assert.equal(parked.file, f1)
  assert.equal(parked.dataUrl, "")
  assert.equal(parked.file.lastModified, 10)
  const groups = parkGroups([
    group({
      id: "g",
      files: [
        preview(f1, { id: "1", mobileBatchPageIndex: 0 }),
        preview(f2, { id: "2", mobileBatchPageIndex: 1 }),
      ],
    }),
  ])
  assert.deepEqual(
    groups[0]!.files.map((x) => x.id),
    ["1", "2"],
  )
  assert.equal(groups[0]!.files[0]!.file, f1)
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({
      batchId: BATCH_A,
      studentGroups: [
        group({
          id: "g",
          files: [preview(f1, { id: "1" }), preview(f2, { id: "2" })],
        }),
      ],
      unassignedFiles: [preview(u, { id: "u" })],
    }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const toB = createContext({
    state: a.state,
    live: live({
      batchId: BATCH_A,
      studentGroups: a.activated!.studentGroups,
      unassignedFiles: a.activated!.unassignedFiles,
    }),
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: emptyGroup,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(toB.ok, true)
  if (!toB.ok) return
  const back = executeSwitch({
    state: toB.state,
    targetId: BATCH_A,
    live: live({ batchId: BATCH_B }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(back.activated?.unassignedFiles[0]?.file, u)
  assert.deepEqual(
    back.activated?.studentGroups[0]?.files.map((x) => x.file.name),
    ["p1.jpg", "p2.jpg"],
  )
})

test("T26 batch A/B isolated + T27 QR late sync blocked + T28 mobile photo ids", () => {
  assert.equal(shouldMergeQrSyncForActiveBatch(BATCH_A, BATCH_B), false)
  assert.equal(shouldApplyQrSyncPhotos({ sameBatch: false }), false)
  assert.equal(shouldApplyQrSyncPhotos({ sameBatch: true }), true)
  assert.equal(
    shouldAdoptStorageActiveBatch({ featureOn: true, incomingBatchId: BATCH_A, activeBatchId: BATCH_B }),
    false,
  )
  const mobile = preview(makeFile("m.jpg"), { mobileBatchPhotoId: "photo-A-1", fromMobileBatch: true })
  assert.equal(computeSelectiveRetryFileFingerprint({ file: mobile.file, mobileBatchPhotoId: mobile.mobileBatchPhotoId }), "m:photo-A-1")
  const parked = parkFilePreview(mobile)
  assert.equal(parked.mobileBatchPhotoId, "photo-A-1")
  assert.equal(computeSelectiveRetryFileFingerprint({ file: parked.file, mobileBatchPhotoId: parked.mobileBatchPhotoId }), "m:photo-A-1")
})

test("T35 evaluate in-flight blocks switch + T36 evaluateAll + T37 OCR/upload", () => {
  assert.equal(deriveCourseContextSwitchBlocked(idleInFlightGuards({ evaluatingGroupIdsCount: 1 })).reason, "evaluate_individual")
  assert.equal(deriveCourseContextSwitchBlocked(idleInFlightGuards({ evaluateAllGuard: true })).reason, "evaluate_all")
  assert.equal(deriveCourseContextSwitchBlocked(idleInFlightGuards({ batchProgressActive: true })).reason, "evaluate_all")
  assert.equal(deriveCourseContextSwitchBlocked(idleInFlightGuards({ isExtractingNames: true })).reason, "extracting_names")
  assert.equal(deriveCourseContextSwitchBlocked(idleInFlightGuards({ mobileBatchSyncing: true })).reason, "ocr_or_upload")
  assert.equal(deriveCourseContextSwitchBlocked(idleInFlightGuards({ isLoading: true })).reason, "loading")
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const withB = {
    ...a.state,
    contexts: [
      a.state.contexts[0]!,
      snapshotFromLive(live({ batchId: BATCH_B, attemptId: ATTEMPT_B }), null, "DRAFT"),
    ],
  }
  const blocked = executeSwitch({
    state: withB,
    targetId: BATCH_B,
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    inFlight: idleInFlightGuards({ evaluatingGroupIdsCount: 1 }),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(blocked.ok, false)
  if (blocked.ok) return
  assert.equal(blocked.code, "SWITCH_BLOCKED")
  assert.equal(blocked.state.activeContextId, BATCH_A)
})

test("T38 fail-soft target invalid + T39 A intact", () => {
  const blobA = JSON.stringify({ v: 2, batchId: BATCH_A, attemptId: ATTEMPT_A, groupCount: 1, completedByIndex: {} })
  const scale = memoryStore({ [COURSE_CONTEXT_SCALE_KEY]: blobA })
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A, courseValue: "KEEP-A", studentGroups: [group({ id: "keep" })] }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const missing = executeSwitch({
    state: a.state,
    targetId: BATCH_B,
    live: live({ batchId: BATCH_A, courseValue: "KEEP-A" }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(missing.ok, false)
  if (missing.ok) return
  assert.equal(missing.state.activeContextId, BATCH_A)
  assert.equal(readScaleBlob(scale), blobA)
  const bad = executeSwitch({
    state: {
      contexts: [
        a.state.contexts[0]!,
        { ...snapshotFromLive(live({ batchId: BATCH_B }), "NOT-JSON{{{", "DRAFT"), scaleBlob: "NOT-JSON{{{" },
      ],
      activeContextId: BATCH_A,
    },
    targetId: BATCH_B,
    live: live({ batchId: BATCH_A, courseValue: "KEEP-A" }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(isScaleBlobRestorable("NOT-JSON{{{"), false)
  assert.equal(bad.ok, false)
  if (bad.ok) return
  assert.equal(bad.state.activeContextId, BATCH_A)
  assert.equal(readScaleBlob(scale), blobA)
  assert.equal(a.state.contexts[0]?.courseValue, "KEEP-A")
})

test("T40 same test/rubric fingerprint + T41 lock READY + T42 desconfirm", () => {
  assert.equal(buildInstrumentFingerprint("P1", "mixta"), "P1|mixta")
  const scale = memoryStore()
  const a = createContext({
    state: createEmptyCourseContextsState(),
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(a.ok, true)
  if (!a.ok) return
  const ready = confirmContext(a.state, BATCH_A)
  assert.equal(ready.ok, true)
  if (!ready.ok) return
  assert.equal(isInstrumentLocked(ready.state.contexts), true)
  assert.equal(isRosterLocked(ready.state.contexts[0]!.preparedStatus), true)
  const mismatch = executeSwitch({
    state: {
      contexts: [
        ready.state.contexts[0]!,
        snapshotFromLive(live({ batchId: BATCH_B, instrumentFingerprint: "other|mixta" }), null, "READY"),
      ],
      activeContextId: BATCH_A,
    },
    targetId: BATCH_B,
    live: live({ batchId: BATCH_A }),
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(mismatch.ok, false)
  if (mismatch.ok) return
  assert.equal(mismatch.code, "INSTRUMENT_MISMATCH")
  const draft = unconfirmContext(ready.state, BATCH_A)
  assert.equal(draft.ok, true)
  if (!draft.ok) return
  assert.equal(isRosterLocked(draft.state.contexts[0]!.preparedStatus), false)
  assert.equal(isInstrumentLocked(draft.state.contexts), false)
})

test("T43 current single-course (0 contextos) sigue normal", () => {
  const s = createEmptyCourseContextsState()
  assert.equal(s.contexts.length, 0)
  assert.equal(s.activeContextId, null)
  assert.equal(isInstrumentLocked(s.contexts), false)
  const wipe = applyClassSizeWorkspaceChange({
    restoring: false,
    classSize: 2,
    prevGroups: [group({ id: "old" })],
    prevUnassigned: [],
    buildEmptyGroups: (n) => Array.from({ length: n }, (_, i) => emptyGroup(i)),
  })
  assert.equal(wipe.wiped, true)
})

test("T44-T48 selector/new run/retry/double-click no se reimplementan", () => {
  const failed = toSnaps(
    [
      group({ id: "done", isEvaluated: true, evaluation_id: "e", files: [preview(makeFile("x.jpg"))], selectiveRetryAttemptId: ATTEMPT_A, selectiveRetryInputFingerprint: "f:x.jpg|0|0|image/jpeg" }),
      group({ id: "fail", error: "La evaluación asíncrona falló", files: [preview(makeFile("y.jpg"))] }),
    ],
    ATTEMPT_A,
  )
  failed[0]!.inputFingerprint = failed[0]!.completedFingerprint
  failed[0]!.completedAttemptId = ATTEMPT_A
  failed[0]!.currentAttemptId = ATTEMPT_A
  const ids = selectGroupIdsToEvaluate(failed)
  assert.ok(ids.includes("fail"))
  const inflight = deriveCourseContextSwitchBlocked(idleInFlightGuards({ evaluatingGroupIdsCount: 1, evaluateAllGuard: true }))
  assert.equal(inflight.blocked, true)
})

test("T32 objectURL ownership: park no revoca; delete sí", () => {
  const revoked: string[] = []
  const urls = collectOwnedPreviewUrls([{ previewUrl: "blob:keep" }, { previewUrl: "https://x" }])
  assert.deepEqual(urls, ["blob:keep"])
  revokeOwnedPreviewUrls(["blob:gone"], (u) => {
    revoked.push(u)
  })
  assert.deepEqual(revoked, ["blob:gone"])
  const ctx = snapshotFromLive(
    live({
      batchId: BATCH_A,
      studentGroups: [group({ id: "g", files: [preview(makeFile("z.jpg"), { previewUrl: "blob:z" })] })],
    }),
    null,
    "DRAFT",
  )
  assert.ok(collectContextPreviewUrls(ctx).includes("blob:z"))
  const st = { contexts: [ctx], activeContextId: null }
  const del = deleteContext({
    state: st,
    contextId: BATCH_A,
    collectUrls: collectContextPreviewUrls,
    revokeUrls: (list) => revokeOwnedPreviewUrls(list, (u) => revoked.push(u)),
  })
  assert.equal(del.ok, true)
  assert.ok(revoked.includes("blob:z"))
})

test("SCALE key coincide con SCALE-R4 publicado", () => {
  assert.equal(COURSE_CONTEXT_SCALE_KEY, SELECTIVE_RETRY_COMPLETED_KEY)
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
