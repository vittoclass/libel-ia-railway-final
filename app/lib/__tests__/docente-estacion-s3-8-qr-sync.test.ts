/**
 * S3.8 — QR: estado de sincronización + actualizar desde Evaluador.
 * Ejecutar: npx tsx app/lib/__tests__/docente-estacion-s3-8-qr-sync.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  deriveQrEvaluatorSyncStatus,
  formatQrBatchIdShort,
  planAdoptEvaluatorActiveBatch,
  runAdoptFromEvaluator,
  shouldShowQrEvaluatorSyncUi,
} from "../../(main)/docente/estacion/DocenteEstacionClient"
import { isDocenteBatchUuid } from "../docente/active-batch-id"
import { isCourseContextsEnabled } from "../course-contexts/flag"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const BATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const CLIENT = path.join(
  process.cwd(),
  "app",
  "(main)",
  "docente",
  "estacion",
  "DocenteEstacionClient.tsx",
)

function clientSrc(): string {
  return fs.readFileSync(CLIENT, "utf8")
}

test("T1 local A / shared A → SYNCED", () => {
  assert.equal(deriveQrEvaluatorSyncStatus(BATCH_A, BATCH_A), "synced")
})

test("T2 local A / shared B → STALE", () => {
  assert.equal(deriveQrEvaluatorSyncStatus(BATCH_A, BATCH_B), "stale")
})

test("T3 stale muestra acción de actualizar", () => {
  const stale = deriveQrEvaluatorSyncStatus(BATCH_A, BATCH_B)
  assert.equal(stale, "stale")
  const src = clientSrc()
  assert.match(src, /data-s38-sync=\{syncStatus\}/)
  assert.match(src, /data-s38-action="adopt"/)
  assert.match(src, /Actualizar desde Evaluador/)
  assert.match(src, /syncStatus === "stale"/)
})

test("T4 pulsar actualizar relee helper", () => {
  let reads = 0
  const result = runAdoptFromEvaluator({
    readShared: () => {
      reads += 1
      return BATCH_B
    },
    localBatch: BATCH_A,
    setBatchId: () => {},
  })
  assert.equal(reads, 1)
  assert.equal(result.readCount, 1)
  const src = clientSrc()
  assert.match(src, /onAdoptFromEvaluator = useCallback\([\s\S]*readDocenteActiveBatchId\(\)/)
})

test("T5 helper devuelve B → set/adopta B", () => {
  const calls: string[] = []
  const result = runAdoptFromEvaluator({
    readShared: () => BATCH_B,
    localBatch: BATCH_A,
    setBatchId: (id) => calls.push(id),
  })
  assert.deepEqual(calls, [BATCH_B])
  assert.equal(result.adopted, BATCH_B)
})

test("T6 NO crea UUID nuevo", () => {
  const plan = planAdoptEvaluatorActiveBatch({ localBatch: BATCH_A, sharedBatch: BATCH_B })
  assert.equal(plan.createsNewUuid, false)
  assert.equal(plan.nextBatchId, BATCH_B)
  assert.equal(isDocenteBatchUuid(plan.nextBatchId), true)
  const src = clientSrc()
  const start = src.indexOf("const onAdoptFromEvaluator")
  assert.ok(start >= 0)
  const adoptFn = src.slice(start, src.indexOf("}, [batchId])", start) + 20)
  assert.doesNotMatch(adoptFn, /crypto\.randomUUID/)
})

test("T7 NO llama Nuevo lote", () => {
  const plan = planAdoptEvaluatorActiveBatch({ localBatch: BATCH_A, sharedBatch: BATCH_B })
  assert.equal(plan.callsRegenerateBatch, false)
  const src = clientSrc()
  const start = src.indexOf("const onAdoptFromEvaluator")
  assert.ok(start >= 0)
  const adoptFn = src.slice(start, src.indexOf("}, [batchId])", start) + 20)
  assert.doesNotMatch(adoptFn, /onRegenerateBatch/)
  assert.doesNotMatch(adoptFn, /crypto\.randomUUID/)
})

test("T8 local B / shared B después → SYNCED", () => {
  let local = BATCH_A
  runAdoptFromEvaluator({
    readShared: () => BATCH_B,
    localBatch: local,
    setBatchId: (id) => {
      local = id
    },
  })
  assert.equal(local, BATCH_B)
  assert.equal(deriveQrEvaluatorSyncStatus(local, BATCH_B), "synced")
})

test("T9 shared ausente/inválido → no cambio destructivo", () => {
  const calls: string[] = []
  const r1 = runAdoptFromEvaluator({
    readShared: () => null,
    localBatch: BATCH_A,
    setBatchId: (id) => calls.push(id),
  })
  const r2 = runAdoptFromEvaluator({
    readShared: () => "not-a-uuid",
    localBatch: BATCH_A,
    setBatchId: (id) => calls.push(id),
  })
  const r3 = runAdoptFromEvaluator({
    readShared: () => "",
    localBatch: BATCH_A,
    setBatchId: (id) => calls.push(id),
  })
  assert.deepEqual(calls, [])
  assert.equal(r1.adopted, null)
  assert.equal(r2.adopted, null)
  assert.equal(r3.adopted, null)
  assert.equal(deriveQrEvaluatorSyncStatus(BATCH_A, null), "unknown")
})

test("T10 feature OFF → UI PRE", () => {
  assert.equal(shouldShowQrEvaluatorSyncUi(false), false)
  assert.equal(shouldShowQrEvaluatorSyncUi(true), true)
  assert.equal(isCourseContextsEnabled({}), false)
  assert.equal(isCourseContextsEnabled({ NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED: undefined }), false)
  const src = clientSrc()
  assert.match(src, /shouldShowQrEvaluatorSyncUi\(courseContextsOn\)/)
  assert.match(src, /isCourseContextsEnabled\(\)/)
})

test("T11 upload in-flight: no hay guard en esta unidad → no se inventa bloqueo", () => {
  const src = clientSrc()
  const adoptBtn = src.slice(src.indexOf('data-s38-action="adopt"'))
  const btnChunk = adoptBtn.slice(0, 400)
  assert.doesNotMatch(btnChunk, /disabled=\{/)
  assert.doesNotMatch(src, /uploading.*onAdoptFromEvaluator|onAdoptFromEvaluator.*uploading/)
})

test("T12 batch short display nunca se usa como UUID técnico", () => {
  const short = formatQrBatchIdShort(BATCH_A)
  assert.equal(short, "AAAAAA")
  assert.equal(short.includes("-"), false)
  assert.notEqual(short, BATCH_A)
  assert.equal(isDocenteBatchUuid(short), false)
  const src = clientSrc()
  assert.match(src, /batchId=\{batchId\}/)
  assert.match(src, /key=\{batchId\}/)
  assert.doesNotMatch(src, /batchId=\{formatQrBatchIdShort/)
  assert.doesNotMatch(src, /key=\{formatQrBatchIdShort/)
  assert.doesNotMatch(src, /writeDocenteActiveBatchId\(formatQrBatchIdShort/)
})

test("NO AUTO-SWITCH: shared A→B sin click deja local A", () => {
  let local = BATCH_A
  const shared = BATCH_B
  assert.equal(deriveQrEvaluatorSyncStatus(local, shared), "stale")
  assert.equal(local, BATCH_A)
  const src = clientSrc()
  const marker = "if (e.key !== DOCENTE_ACTIVE_BATCH_ID_KEY) return"
  const idx = src.indexOf(marker)
  assert.ok(idx >= 0, "storage listener must key on active-batch helper key")
  const chunk = src.slice(idx, idx + 280)
  assert.match(chunk, /setSharedBatchId\(readDocenteActiveBatchId\(\)\)/)
  assert.doesNotMatch(chunk, /setBatchId\(/)
  assert.match(src, /addEventListener\("storage", onStorage\)/)
  assert.doesNotMatch(src, /visibilitychange/)
  assert.doesNotMatch(src, /setInterval\(/)
})

test("CLICK MANUAL: A local / B shared → B local exactamente una vez", () => {
  let local: string | null = BATCH_A
  const calls: string[] = []
  const click = () =>
    runAdoptFromEvaluator({
      readShared: () => BATCH_B,
      localBatch: local,
      setBatchId: (id) => {
        calls.push(id)
        local = id
      },
    })
  click()
  click()
  assert.deepEqual(calls, [BATCH_B])
  assert.equal(local, BATCH_B)
  assert.equal(deriveQrEvaluatorSyncStatus(local, BATCH_B), "synced")
})

test("mismo batch en click → noop", () => {
  const calls: string[] = []
  runAdoptFromEvaluator({
    readShared: () => BATCH_A,
    localBatch: BATCH_A,
    setBatchId: (id) => calls.push(id),
  })
  assert.deepEqual(calls, [])
})

async function main(): Promise<void> {
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
  console.log(`${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void main()
