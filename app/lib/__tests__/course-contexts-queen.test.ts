/**
 * S3 — Prueba reina A→B→A (25 / 22+3).
 * Ejecutar: npx tsx app/lib/__tests__/course-contexts-queen.test.ts
 */
import assert from "node:assert/strict"
import {
  createEmptyCourseContextsState,
  durableContextView,
  idleInFlightGuards,
} from "../course-contexts/helpers"
import { createContext, executeSwitch } from "../course-contexts/store"
import {
  COURSE_CONTEXT_SCALE_KEY,
  type CourseContextFileLike,
  type CourseContextGroupLike,
  type LiveWorkspace,
} from "../course-contexts/types"
import {
  computeSelectiveRetryFileFingerprint,
  computeSelectiveRetryGroupFingerprint,
  selectGroupIdsToEvaluate,
  shouldApplyQrSyncPhotos,
  type SelectiveRetryGroupSnapshot,
} from "../../useEvaluator"
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
const INSTRUMENT = buildInstrumentFingerprint("P1", "mixta")

function memoryStore() {
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

function makeFile(name: string, lastModified: number): File {
  return new File([`queen-${name}`], name, { type: "image/jpeg", lastModified })
}

function preview(file: File, extra?: Partial<CourseContextFileLike>): CourseContextFileLike {
  return {
    id: extra?.id ?? `fp-${file.name}`,
    file,
    previewUrl: extra?.previewUrl ?? `blob:${file.name}`,
    dataUrl: extra?.dataUrl ?? "data:image/jpeg;base64,QUEEN",
    ...extra,
  }
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
      currentAttemptId: attemptId,
      inputFingerprint: fp || undefined,
      completedAttemptId: g.selectiveRetryAttemptId ?? undefined,
      completedFingerprint: g.selectiveRetryInputFingerprint ?? undefined,
    }
  })
}

function buildCourseA(): { live: LiveWorkspace; files: File[]; blob: string } {
  const groups: CourseContextGroupLike[] = []
  const files: File[] = []
  const completedByIndex: Record<string, { evaluationId: string; fingerprint: string; attemptId: string }> = {}
  for (let i = 0; i < 22; i++) {
    const file = makeFile(`A-ok-${i}.jpg`, 1_700_000_000_000 + i)
    files.push(file)
    const fp = computeSelectiveRetryFileFingerprint({ file })
    completedByIndex[String(i + 1)] = { evaluationId: `eval-A-${i}`, fingerprint: fp, attemptId: ATTEMPT_A }
    groups.push({
      id: `student-A-${i}`,
      studentName: i === 0 ? "Ana A" : `Alumno ${i + 1}`,
      observedOcrName: i === 0 ? "ANA A OCR" : null,
      studentRut: i === 0 ? "11111111-1" : "",
      files: [
        preview(file, {
          id: `fa-${i}`,
          mobileBatchPageIndex: 0,
          mobileBatchProcessedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
        }),
      ],
      decimasAdicionales: 0,
      isEvaluated: true,
      isEvaluating: false,
      evaluation_id: `eval-A-${i}`,
      selectiveRetryAttemptId: ATTEMPT_A,
      selectiveRetryInputFingerprint: fp,
    })
  }
  for (let i = 0; i < 3; i++) {
    const file = makeFile(`A-fail-${i}.jpg`, 1_800_000_000_000 + i)
    files.push(file)
    const err =
      i === 0
        ? "BLANK_RESCUE_RESULT: hoja en blanco / failed"
        : "La evaluación asíncrona falló"
    groups.push({
      id: `student-A-fail-${i}`,
      studentName: `Fail ${i + 1}`,
      observedOcrName: null,
      studentRut: i === 1 ? "22222222-2" : "",
      files: [preview(file, { id: `ff-${i}` })],
      decimasAdicionales: 0,
      isEvaluated: false,
      isEvaluating: false,
      error: err,
    })
  }
  const blob = JSON.stringify({
    v: 2,
    batchId: BATCH_A,
    attemptId: ATTEMPT_A,
    groupCount: 25,
    completedByIndex,
  })
  const unassigned = [preview(makeFile("A-unassigned.jpg", 9), { id: "ua-A" })]
  return {
    files,
    blob,
    live: {
      courseValue: "Curso A",
      classSize: 25,
      imagesPerStudent: 1,
      studentGroups: groups,
      unassignedFiles: unassigned,
      batchId: BATCH_A,
      attemptId: ATTEMPT_A,
      captureMode: "desktop",
      instrumentFingerprint: INSTRUMENT,
    },
  }
}

function buildCourseB(): LiveWorkspace {
  const file = makeFile("B-only.jpg", 42)
  return {
    courseValue: "Curso B",
    classSize: 25,
    imagesPerStudent: 2,
    studentGroups: Array.from({ length: 25 }, (_, i) => ({
      id: `student-B-${i}`,
      studentName: `Beto ${i + 1}`,
      observedOcrName: i === 0 ? "BETO B OCR" : null,
      studentRut: i === 0 ? "33333333-3" : "",
      files: i === 0 ? [preview(file, { id: "fb-0" })] : [],
      decimasAdicionales: 0,
      isEvaluated: false,
      isEvaluating: false,
    })),
    unassignedFiles: [],
    batchId: BATCH_B,
    attemptId: ATTEMPT_B,
    captureMode: null,
    instrumentFingerprint: INSTRUMENT,
  }
}

test("PRUEBA REINA: A 25/22+3 → B independiente → A exacto → enqueue 3", () => {
  const { live: liveA, files, blob } = buildCourseA()
  const liveB = buildCourseB()
  const scale = memoryStore()
  scale.setItem(COURSE_CONTEXT_SCALE_KEY, blob)

  const createdA = createContext({
    state: createEmptyCourseContextsState(),
    live: liveA,
    scaleStore: scale,
    newBatchId: BATCH_A,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(createdA.ok, true)
  if (!createdA.ok) return

  const createdB = createContext({
    state: createdA.state,
    live: liveA,
    scaleStore: scale,
    newBatchId: BATCH_B,
    emptyGroupFactory: () => liveB.studentGroups[0]!,
    inFlight: idleInFlightGuards(),
  })
  assert.equal(createdB.ok, true)
  if (!createdB.ok) return

  const activateB = executeSwitch({
    state: {
      contexts: createdB.state.contexts.map((c) =>
        c.contextId === BATCH_B
          ? { ...c, ...liveB, contextId: BATCH_B, scaleBlob: JSON.stringify({ v: 2, batchId: BATCH_B, attemptId: ATTEMPT_B, groupCount: 25, completedByIndex: {} }), preparedStatus: "DRAFT", classSize: 25 }
          : c,
      ),
      activeContextId: BATCH_B,
    },
    targetId: BATCH_B,
    live: liveB,
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(activateB.ok, true)
  if (!activateB.ok) return
  assert.equal(activateB.activated?.courseValue, "Curso B")
  assert.equal(activateB.activated?.studentGroups[0]?.observedOcrName, "BETO B OCR")
  assert.notEqual(activateB.activated?.batchId, BATCH_A)

  const backA = executeSwitch({
    state: activateB.state,
    targetId: BATCH_A,
    live: liveB,
    scaleStore: scale,
    inFlight: idleInFlightGuards(),
    globalInstrumentFingerprint: INSTRUMENT,
  })
  assert.equal(backA.ok, true)
  if (!backA.ok) return

  const restored = backA.activated!
  assert.equal(restored.batchId, BATCH_A)
  assert.equal(restored.attemptId, ATTEMPT_A)
  assert.equal(restored.courseValue, "Curso A")
  assert.equal(restored.studentGroups.length, 25)
  assert.equal(restored.classSize, 25)
  assert.equal(restored.studentGroups.filter((g) => g.isEvaluated).length, 22)
  assert.equal(restored.studentGroups.filter((g) => g.error).length, 3)
  assert.equal(restored.studentGroups[0]?.observedOcrName, "ANA A OCR")
  assert.equal(restored.studentGroups[0]?.studentRut, "11111111-1")
  assert.equal(restored.studentGroups[23]?.studentRut, "22222222-2")
  assert.equal(restored.studentGroups[22]?.error, "BLANK_RESCUE_RESULT: hoja en blanco / failed")
  assert.equal(restored.unassignedFiles.length, 1)
  assert.equal(restored.instrumentFingerprint, INSTRUMENT)
  assert.equal(scale.getItem(COURSE_CONTEXT_SCALE_KEY), blob)

  for (let i = 0; i < 22; i++) {
    assert.equal(restored.studentGroups[i]!.files[0]!.file, files[i])
    assert.equal(restored.studentGroups[i]!.files[0]!.file.lastModified, 1_700_000_000_000 + i)
    assert.equal(restored.studentGroups[i]!.evaluation_id, `eval-A-${i}`)
  }
  assert.deepEqual(
    restored.studentGroups.map((g) => g.id),
    liveA.studentGroups.map((g) => g.id),
  )
  assert.deepEqual(
    restored.studentGroups.map((g) => g.files.map((f) => f.id)),
    liveA.studentGroups.map((g) => g.files.map((f) => f.id)),
  )

  const expectedParked = durableContextView(createdB.state.contexts.find((c) => c.contextId === BATCH_A)!)
  assert.deepEqual(durableContextView(restored), expectedParked)

  const ids = selectGroupIdsToEvaluate(toSnaps(restored.studentGroups, ATTEMPT_A))
  assert.equal(ids.length, 3)
  assert.deepEqual(ids, ["student-A-fail-0", "student-A-fail-1", "student-A-fail-2"])

  assert.equal(shouldApplyQrSyncPhotos({ sameBatch: false }), false)
  assert.ok(!restored.studentGroups.some((g) => g.id.startsWith("student-B")))
  assert.ok(!restored.studentGroups.some((g) => g.observedOcrName === "BETO B OCR"))
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
