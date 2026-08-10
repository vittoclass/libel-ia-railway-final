/**
 * Pruebas offline del adapter remoto forense N2-A.8.
 * Ejecutar sin tocar package.json:
 *   npx tsx app/lib/diagnostics/__tests__/azure-forensic-remote-sink.test.ts
 *
 * Sin red real. Mock Storage. Sin bucket real. Sin Railway. Sin PII.
 */

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  AZURE_FORENSIC_BUFFER_CAPTURE_FLAG,
  AZURE_FORENSIC_SINK_DIR_ENV,
  buildForensicArtifactPath,
  recordAzureForensicPackage,
  __getActiveForensicSinkForTests,
  __setAzureForensicEmitForTests,
  __setAzureForensicSinkForTests,
} from "../azure-forensic-buffer-artifact"
import {
  AZURE_FORENSIC_BUCKET_ENV,
  AZURE_FORENSIC_FORBIDDEN_BUCKETS,
  AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
  createRemoteForensicSink,
  isForensicBucketAllowed,
  resolveForensicBucketName,
  tryCreateConfiguredRemoteForensicSink,
  __setForensicRemoteClientForTests,
  type ForensicRemoteStorageBucket,
  type ForensicRemoteStorageClient,
} from "../azure-forensic-remote-sink"
import {
  AZURE_RAW_SNAPSHOT_FLAG as RAW_FLAG,
  isAzureRawSnapshotEnabled,
} from "../azure-raw-snapshot-recorder"
import type { AzureLayoutOmrDiagnosticContext } from "@/app/lib/omr/experimental/azure-layout-omr-pipeline"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

type MockUploadCall = {
  path: string
  body: Buffer
  options: { contentType: string; upsert: boolean }
}

function createMockClient(opts?: {
  failUploadPath?: string | ((path: string) => string | null)
  failDownload?: boolean
  failRemove?: boolean
  corruptDownload?: boolean
}): ForensicRemoteStorageClient & {
  objects: Map<string, Buffer>
  uploadCalls: MockUploadCall[]
  removeCalls: string[][]
  fromCalls: string[]
  publicUrlCalls: number
} {
  const objects = new Map<string, Buffer>()
  const uploadCalls: MockUploadCall[] = []
  const removeCalls: string[][] = []
  const fromCalls: string[] = []
  let publicUrlCalls = 0

  const bucketApi: ForensicRemoteStorageBucket & {
    getPublicUrl?: (path: string) => unknown
  } = {
    async upload(path, body, options) {
      uploadCalls.push({ path, body: Buffer.from(body), options })
      let forced: string | null = null
      if (typeof opts?.failUploadPath === "function") {
        forced = opts.failUploadPath(path)
      } else if (typeof opts?.failUploadPath === "string" && path === opts.failUploadPath) {
        forced = "forced upload error"
      }
      if (forced) {
        return { data: null, error: { message: forced } }
      }
      if (objects.has(path)) {
        return {
          data: null,
          error: { message: "The resource already exists", statusCode: "409" },
        }
      }
      if (options.upsert !== false) {
        return { data: null, error: { message: "upsert must be false" } }
      }
      objects.set(path, Buffer.from(body))
      return { data: { path }, error: null }
    },
    async download(path) {
      if (opts?.failDownload) {
        return { data: null, error: { message: "download error" } }
      }
      const found = objects.get(path)
      if (!found) return { data: null, error: { message: "not found" } }
      if (opts?.corruptDownload) {
        return { data: Buffer.from("CORRUPTED"), error: null }
      }
      return { data: Buffer.from(found), error: null }
    },
    async remove(paths) {
      removeCalls.push([...paths])
      if (opts?.failRemove) {
        return { data: null, error: { message: "remove error" } }
      }
      for (const p of paths) objects.delete(p)
      return { data: paths.map((p) => ({ name: p })), error: null }
    },
    getPublicUrl(path: string) {
      publicUrlCalls += 1
      return { data: { publicUrl: `https://example.invalid/${path}` } }
    },
  }

  return {
    objects,
    uploadCalls,
    removeCalls,
    fromCalls,
    get publicUrlCalls() {
      return publicUrlCalls
    },
    storage: {
      from(bucket: string) {
        fromCalls.push(bucket)
        return bucketApi
      },
    },
  }
}

function synthPng(tag: string): Buffer {
  // Cabecera PNG mínima + payload sintético determinístico (no imagen real de alumno).
  const prefix = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([prefix, Buffer.from(`synth-${tag}`, "utf8")])
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function metaJson(extra?: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 1,
    timestamp: "2026-08-10T00:00:00.000Z",
    eventKey: "run-a|batch-b|1|0|0",
    diagnosticRunId: "run-a",
    evaluationBatchId: "batch-b",
    batchStudentIndex: 1,
    pageIndex: 0,
    attempt: 0,
    azureInputSha256: extra?.azureInputSha256 ?? "0".repeat(64),
    byteLength: extra?.byteLength ?? 16,
    mimeType: "image/png",
    retention: { maxDays: 7, suggestedBucket: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET },
    ...extra,
  })
}

function pathsFor(params: {
  runId: string
  student: number
  page: number
  attempt: number
  buf: Buffer
}) {
  const azureInputSha256 = sha(params.buf)
  const built = buildForensicArtifactPath({
    diagnosticRunId: params.runId,
    sourceMode: "batch",
    batchStudentIndex: params.student,
    pageIndex: params.page,
    attempt: params.attempt,
    azureInputSha256,
  })
  assert.ok(built)
  return { ...built, azureInputSha256 }
}

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(patch)) prev[k] = process.env[k]
  try {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await fn()
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

function resetResolvers(): void {
  __setAzureForensicSinkForTests(null)
  __setForensicRemoteClientForTests(undefined)
}

// --- 1–3 bucket guards ---
test("1. bucket faltante → fail-soft", () => {
  const r = resolveForensicBucketName("")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.errorCode, "bucket_missing")
  const created = createRemoteForensicSink({
    bucketName: "",
    client: createMockClient(),
  })
  assert.equal(created.ok, false)
})

test("2. bucket batch-scans → rechazado", () => {
  assert.equal(isForensicBucketAllowed("batch-scans"), false)
  assert.ok(AZURE_FORENSIC_FORBIDDEN_BUCKETS.has("batch-scans"))
  const r = resolveForensicBucketName("batch-scans")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.errorCode, "bucket_forbidden")
  const created = createRemoteForensicSink({
    bucketName: "batch-scans",
    client: createMockClient(),
  })
  assert.equal(created.ok, false)
  if (!created.ok) assert.equal(created.errorCode, "bucket_forbidden")
})

test("3. bucket diagnóstico permitido", () => {
  assert.equal(isForensicBucketAllowed(AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET), true)
  const r = resolveForensicBucketName(AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET)
  assert.equal(r.ok, true)
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client: createMockClient(),
  })
  assert.equal(created.ok, true)
})

test("utp-audit-private también bloqueado", () => {
  const r = resolveForensicBucketName("utp-audit-private")
  assert.equal(r.ok, false)
})

// --- write/read/sha/delete ---
test("4-8. upload PNG+meta correctos (contentType, upsert=false, bytes)", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("upload")
  const p = pathsFor({ runId: "run-up", student: 1, page: 0, attempt: 0, buf })
  const meta = metaJson({ azureInputSha256: p.azureInputSha256, byteLength: buf.byteLength })
  const wr = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(wr.ok, true)
  if (wr.ok) assert.equal(wr.sinkKind, "configured_private")
  assert.equal(client.uploadCalls.length, 2)
  assert.equal(client.uploadCalls[0]!.options.contentType, "image/png")
  assert.equal(client.uploadCalls[0]!.options.upsert, false)
  assert.equal(client.uploadCalls[1]!.options.contentType, "application/json")
  assert.equal(client.uploadCalls[1]!.options.upsert, false)
  assert.equal(Buffer.compare(client.objects.get(p.path)!, buf), 0)
  assert.equal(client.objects.get(p.metaPath)!.toString("utf8"), meta)
  assert.deepEqual(client.fromCalls, [AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET])
})

test("9-10. read bytes exactos + SHA coincide", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("read")
  const p = pathsFor({ runId: "run-rd", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rd = await created.sink.read({ path: p.path, azureInputSha256: p.azureInputSha256 })
  assert.equal(rd.ok, true)
  if (!rd.ok) return
  assert.equal(Buffer.compare(rd.bytes, buf), 0)
  assert.equal(rd.azureInputSha256, p.azureInputSha256)
})

test("11. SHA mismatch rechazado", async () => {
  const client = createMockClient({ corruptDownload: true })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("mismatch")
  const p = pathsFor({ runId: "run-mm", student: 1, page: 0, attempt: 0, buf })
  client.objects.set(p.path, buf)
  const rd = await created.sink.read({ path: p.path, azureInputSha256: p.azureInputSha256 })
  assert.equal(rd.ok, false)
  if (!rd.ok) assert.equal(rd.errorCode, "SHA_MISMATCH")
})

test("12. no overwrite (mismo path dos veces)", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("ow")
  const p = pathsFor({ runId: "run-ow", student: 1, page: 0, attempt: 0, buf })
  const input = {
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  }
  const first = await created.sink.write(input)
  const second = await created.sink.write(input)
  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.errorCode, "already_exists")
  assert.equal(client.objects.size, 2)
})

test("13-16. paths separados student/page/attempt/runId", () => {
  const buf = synthPng("paths")
  const a = pathsFor({ runId: "run-1", student: 1, page: 0, attempt: 0, buf })
  const b = pathsFor({ runId: "run-1", student: 2, page: 0, attempt: 0, buf })
  const c = pathsFor({ runId: "run-1", student: 1, page: 1, attempt: 0, buf })
  const d = pathsFor({ runId: "run-1", student: 1, page: 0, attempt: 1, buf })
  const e = pathsFor({ runId: "run-2", student: 1, page: 0, attempt: 0, buf })
  assert.notEqual(a.path, b.path)
  assert.notEqual(a.path, c.path)
  assert.notEqual(a.path, d.path)
  assert.notEqual(a.path, e.path)
  assert.ok(a.path.includes("/1/0/0/"))
  assert.ok(b.path.includes("/2/0/0/"))
  assert.ok(d.path.includes("/1/0/1/"))
  assert.ok(e.path.includes("run-2"))
})

test("17. reevaluación no overwrite (runId nuevo → path distinto)", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("reeval")
  const p1 = pathsFor({ runId: "run-eval-1", student: 1, page: 0, attempt: 0, buf })
  const p2 = pathsFor({ runId: "run-eval-2", student: 1, page: 0, attempt: 0, buf })
  assert.notEqual(p1.path, p2.path)
  const w1 = await created.sink.write({
    path: p1.path,
    metaPath: p1.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p1.azureInputSha256 }),
    azureInputSha256: p1.azureInputSha256,
  })
  const w2 = await created.sink.write({
    path: p2.path,
    metaPath: p2.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p2.azureInputSha256 }),
    azureInputSha256: p2.azureInputSha256,
  })
  assert.equal(w1.ok, true)
  assert.equal(w2.ok, true)
  assert.equal(client.objects.size, 4)
})

test("18-20. remove PNG+meta exactos, no recursive", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("rm")
  const p = pathsFor({ runId: "run-rm", student: 1, page: 0, attempt: 0, buf })
  const other = pathsFor({ runId: "run-rm", student: 2, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  await created.sink.write({
    path: other.path,
    metaPath: other.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: other.azureInputSha256 }),
    azureInputSha256: other.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, true)
  assert.equal(client.removeCalls.length, 1)
  assert.deepEqual(client.removeCalls[0], [p.path, p.metaPath])
  assert.equal(client.objects.has(p.path), false)
  assert.equal(client.objects.has(p.metaPath), false)
  assert.equal(client.objects.has(other.path), true)
  assert.equal(client.objects.has(other.metaPath), true)
  // No prefijo recursive: solo exactamente 2 paths
  assert.equal(client.removeCalls[0]!.length, 2)
  assert.equal(client.removeCalls[0]!.some((x) => x.endsWith("/")), false)
})

test("21. upload error fail-soft", async () => {
  const client = createMockClient({
    failUploadPath: (path) => (path.endsWith(".png") ? "network boom" : null),
  })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("uperr")
  const p = pathsFor({ runId: "run-ue", student: 1, page: 0, attempt: 0, buf })
  const wr = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(wr.ok, false)
  if (!wr.ok) assert.equal(wr.errorCode, "upload_failed")
})

test("22. download error fail-soft", async () => {
  const client = createMockClient({ failDownload: true })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const rd = await created.sink.read({
    path: "diag/azure-input/x/1/0/0/" + "a".repeat(64) + ".png",
    azureInputSha256: "a".repeat(64),
  })
  assert.equal(rd.ok, false)
  if (!rd.ok) assert.equal(rd.errorCode, "download_failed")
})

test("23. remove error fail-soft", async () => {
  const client = createMockClient({ failRemove: true })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const rm = await created.sink.remove({
    path: "diag/azure-input/x/1/0/0/" + "a".repeat(64) + ".png",
    metaPath: "diag/azure-input/x/1/0/0/" + "a".repeat(64) + ".png.meta.json",
  })
  assert.equal(rm.ok, false)
  if (!rm.ok) assert.equal(rm.errorCode, "remove_failed")
})

test("24. meta upload failure → partial_artifact (sin auto-delete)", async () => {
  const client = createMockClient({
    failUploadPath: (path) => (path.endsWith(".meta.json") ? "meta boom" : null),
  })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("partial")
  const p = pathsFor({ runId: "run-pa", student: 1, page: 0, attempt: 0, buf })
  const wr = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(wr.ok, false)
  if (!wr.ok) assert.equal(wr.errorCode, "partial_artifact")
  // PNG quedó; política documentada: no auto-delete
  assert.equal(client.objects.has(p.path), true)
  assert.equal(client.objects.has(p.metaPath), false)
  assert.equal(client.removeCalls.length, 0)
})

test("25-29. no public URL / no base64 / no PII / no teacher_key / no scoring", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("priv")
  const p = pathsFor({ runId: "run-priv", student: 1, page: 0, attempt: 0, buf })
  const meta = metaJson({ azureInputSha256: p.azureInputSha256, byteLength: buf.byteLength })
  assert.equal(meta.toLowerCase().includes("teacher_key"), false)
  assert.equal(meta.toLowerCase().includes("\"scoring\""), false)
  assert.equal(meta.includes("data:image"), false)
  assert.equal(meta.includes("https://"), false)
  assert.equal(meta.includes("@"), false)
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  // El adapter no llama getPublicUrl
  assert.equal(client.publicUrlCalls, 0)
  const fs = await import("node:fs")
  const path = await import("node:path")
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/lib/diagnostics/azure-forensic-remote-sink.ts"),
    "utf8",
  )
  assert.equal(/getPublicUrl\s*\(/.test(src), false)
  assert.equal(/createSignedUrl\s*\(/.test(src), false)
})

test("30. no mutation del payload de write", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("imut")
  const freeze = Buffer.from(buf)
  const p = pathsFor({ runId: "run-imut", student: 1, page: 0, attempt: 0, buf })
  const meta = metaJson({ azureInputSha256: p.azureInputSha256 })
  const metaFreeze = meta
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(Buffer.compare(buf, freeze), 0)
  assert.equal(meta, metaFreeze)
})

// --- wiring con buffer-artifact ---
function batchCtx(over?: Partial<AzureLayoutOmrDiagnosticContext>): AzureLayoutOmrDiagnosticContext {
  return {
    diagnosticRunId: "run-wire-001",
    evaluationBatchId: "batch-wire-001",
    batchStudentIndex: 1,
    pageIndex: 0,
    attempt: 0,
    ...over,
  }
}

function minimalCaptureInput(buf: Buffer) {
  const marks = Array.from({ length: 4 }, (_, i) => ({
    state: (i === 0 ? "selected" : "unselected") as "selected" | "unselected",
    polygonNorm: [
      { x: 0.1 + i * 0.05, y: 0.1 },
      { x: 0.12 + i * 0.05, y: 0.1 },
      { x: 0.12 + i * 0.05, y: 0.12 },
      { x: 0.1 + i * 0.05, y: 0.12 },
    ],
    confidence: 0.9,
  }))
  return {
    azureInputBuffer: buf,
    azureInputSha256: sha(buf),
    analyzeResult: {
      pages: [
        {
          width: 100,
          height: 100,
          unit: "pixel",
          selectionMarks: marks.map((m, i) => ({
            state: m.state,
            confidence: m.confidence,
            polygon: [
              m.polygonNorm[0]!.x * 100,
              m.polygonNorm[0]!.y * 100,
              m.polygonNorm[1]!.x * 100,
              m.polygonNorm[1]!.y * 100,
              m.polygonNorm[2]!.x * 100,
              m.polygonNorm[2]!.y * 100,
              m.polygonNorm[3]!.x * 100,
              m.polygonNorm[3]!.y * 100,
            ],
          })),
        },
      ],
    },
    marks,
    omrPreN1: [{ questionNumber: 1, selectedAnswer: "A" }],
    n1Result: null,
    diagnosticContext: batchCtx(),
    layout: { expectedQuestionCount: 1, expectedOptionCount: 4, variant: "single_column" },
  }
}

test("31. raw flag sola no captura", async () => {
  await withEnv(
    {
      [AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]: undefined,
      [RAW_FLAG]: "1",
      [AZURE_FORENSIC_BUCKET_ENV]: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
      [AZURE_FORENSIC_SINK_DIR_ENV]: undefined,
      NODE_ENV: "test",
    },
    async () => {
      resetResolvers()
      const client = createMockClient()
      __setForensicRemoteClientForTests(client)
      assert.equal(isAzureRawSnapshotEnabled(), true)
      const lines: string[] = []
      __setAzureForensicEmitForTests((l) => lines.push(l))
      const buf = synthPng("rawonly")
      const ref = await recordAzureForensicPackage(minimalCaptureInput(buf))
      assert.equal(ref, null)
      assert.equal(client.objects.size, 0)
    },
  )
})

test("32. forensic flag off no sink remoto", async () => {
  await withEnv(
    {
      [AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]: "0",
      [AZURE_FORENSIC_BUCKET_ENV]: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
      NODE_ENV: "test",
    },
    async () => {
      resetResolvers()
      const client = createMockClient()
      __setForensicRemoteClientForTests(client)
      const buf = synthPng("flagoff")
      const ref = await recordAzureForensicPackage(minimalCaptureInput(buf))
      assert.equal(ref, null)
      assert.equal(client.objects.size, 0)
    },
  )
})

test("33. forensic on + remote config usa remote", async () => {
  await withEnv(
    {
      [AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]: "1",
      [AZURE_FORENSIC_BUCKET_ENV]: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
      [AZURE_FORENSIC_SINK_DIR_ENV]: undefined,
      NODE_ENV: "test",
    },
    async () => {
      resetResolvers()
      const client = createMockClient()
      __setForensicRemoteClientForTests(client)
      const lines: string[] = []
      __setAzureForensicEmitForTests((l) => lines.push(l))
      const buf = synthPng("remoteon")
      const ref = await recordAzureForensicPackage(minimalCaptureInput(buf))
      assert.ok(ref)
      assert.equal(ref!.sinkKind, "configured_private")
      assert.equal(ref!.publicUrl, false)
      assert.equal(client.objects.size, 2)
      assert.ok(client.uploadCalls.every((c) => c.options.upsert === false))
    },
  )
})

test("34. remote config ausente → sink_not_configured", async () => {
  await withEnv(
    {
      [AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]: "1",
      [AZURE_FORENSIC_BUCKET_ENV]: undefined,
      [AZURE_FORENSIC_SINK_DIR_ENV]: undefined,
      NODE_ENV: "test",
    },
    async () => {
      resetResolvers()
      __setForensicRemoteClientForTests(null)
      const lines: string[] = []
      __setAzureForensicEmitForTests((l) => lines.push(l))
      const buf = synthPng("nosink")
      const ref = await recordAzureForensicPackage(minimalCaptureInput(buf))
      assert.equal(ref, null)
      assert.ok(lines.some((l) => l.includes("sink_not_configured")))
      assert.equal(tryCreateConfiguredRemoteForensicSink(), null)
    },
  )
})

test("35. nunca fallback a /tmp en producción", async () => {
  await withEnv(
    {
      [AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]: "1",
      [AZURE_FORENSIC_BUCKET_ENV]: undefined,
      [AZURE_FORENSIC_SINK_DIR_ENV]: "/tmp/forensics-should-not-use",
      NODE_ENV: "production",
    },
    async () => {
      resetResolvers()
      __setForensicRemoteClientForTests(null)
      const sink = __getActiveForensicSinkForTests()
      assert.equal(sink, null)
      const lines: string[] = []
      __setAzureForensicEmitForTests((l) => lines.push(l))
      const buf = synthPng("notmp")
      const ref = await recordAzureForensicPackage(minimalCaptureInput(buf))
      assert.equal(ref, null)
      assert.ok(lines.some((l) => l.includes("sink_not_configured")))
    },
  )
})

test("E2E sintético: WRITE/READ/SHA/DELETE/NO_OVERWRITE/PRIVATE/NO_BATCH_SCANS", async () => {
  // NO BATCH-SCANS
  assert.equal(isForensicBucketAllowed("batch-scans"), false)

  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("e2e")
  const p = pathsFor({ runId: "run-e2e", student: 1, page: 0, attempt: 0, buf })
  const meta = metaJson({ azureInputSha256: p.azureInputSha256, byteLength: buf.byteLength })

  const wr = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(wr.ok, true, "WRITE PASS")

  const rd = await created.sink.read({ path: p.path, azureInputSha256: p.azureInputSha256 })
  assert.equal(rd.ok, true, "READ PASS")
  if (rd.ok) {
    assert.equal(rd.azureInputSha256, p.azureInputSha256, "SHA PASS")
    assert.equal(Buffer.compare(rd.bytes, buf), 0)
  }

  const ow = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(ow.ok, false, "NO OVERWRITE PASS")
  if (!ow.ok) assert.equal(ow.errorCode, "already_exists")

  assert.equal(client.publicUrlCalls, 0, "PRIVATE MODE PASS")

  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, true, "DELETE PASS")
  assert.equal(client.objects.has(p.path), false)
  assert.equal(client.objects.has(p.metaPath), false)

  const missing = await created.sink.read({ path: p.path, azureInputSha256: p.azureInputSha256 })
  assert.equal(missing.ok, false)
})

test("identidad funcional flags OFF: record retorna null sin side-effects", async () => {
  await withEnv(
    {
      [AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]: undefined,
      [AZURE_FORENSIC_BUCKET_ENV]: undefined,
      NODE_ENV: "test",
    },
    async () => {
      resetResolvers()
      const client = createMockClient()
      __setForensicRemoteClientForTests(client)
      const buf = synthPng("idoff")
      const input = minimalCaptureInput(buf)
      const freeze = JSON.stringify(input.omrPreN1)
      const ref = await recordAzureForensicPackage(input)
      assert.equal(ref, null)
      assert.equal(client.objects.size, 0)
      assert.equal(JSON.stringify(input.omrPreN1), freeze)
    },
  )
})

async function main(): Promise<void> {
  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`ok - ${t.name}`)
    } catch (err) {
      failed += 1
      console.error(`FAIL - ${t.name}`)
      console.error(err)
    } finally {
      resetResolvers()
      __setAzureForensicEmitForTests(null)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void main()
