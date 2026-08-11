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
  options: { contentType: string; upsert: boolean; cacheControl?: string }
}

function createMockClient(opts?: {
  failUploadPath?: string | ((path: string) => string | null)
  failDownload?: boolean
  failRemove?: boolean
  failList?: boolean
  /** list() ausente en el bucket (simula cliente incompleto). */
  omitList?: boolean
  corruptDownload?: boolean
  /** remove → error:null pero no borra origen (simula incidente N2-A.9B). */
  removeNoOp?: boolean
  /** remove solo borra paths que terminen con el sufijo indicado. */
  removeOnlySuffix?: ".png" | ".meta.json"
  /**
   * Tras remove real en origen, download sigue sirviendo bytes (CDN residual).
   * list() ya no ve el objeto.
   */
  cdnResidualAfterRemove?: boolean
}): ForensicRemoteStorageClient & {
  objects: Map<string, Buffer>
  cdnGhosts: Map<string, Buffer>
  uploadCalls: MockUploadCall[]
  removeCalls: string[][]
  downloadCalls: string[]
  listCalls: Array<{ path: string; options?: { limit?: number; search?: string } }>
  fromCalls: string[]
  publicUrlCalls: number
} {
  const objects = new Map<string, Buffer>()
  const cdnGhosts = new Map<string, Buffer>()
  const uploadCalls: MockUploadCall[] = []
  const removeCalls: string[][] = []
  const downloadCalls: string[] = []
  const listCalls: Array<{ path: string; options?: { limit?: number; search?: string } }> = []
  const fromCalls: string[] = []
  let publicUrlCalls = 0

  const bucketApi: ForensicRemoteStorageBucket & {
    getPublicUrl?: (path: string) => unknown
    list?: ForensicRemoteStorageBucket["list"]
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
      downloadCalls.push(path)
      if (opts?.failDownload) {
        return { data: null, error: { message: "download error" } }
      }
      const found = objects.get(path) ?? cdnGhosts.get(path)
      if (!found) {
        return { data: null, error: { message: "not found", statusCode: "404" } }
      }
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
      if (opts?.removeNoOp) {
        return { data: paths.map((p) => ({ name: p })), error: null }
      }
      if (opts?.removeOnlySuffix) {
        for (const p of paths) {
          if (p.endsWith(opts.removeOnlySuffix)) {
            if (opts.cdnResidualAfterRemove && objects.has(p)) {
              cdnGhosts.set(p, Buffer.from(objects.get(p)!))
            }
            objects.delete(p)
          }
        }
        return { data: paths.map((p) => ({ name: p })), error: null }
      }
      for (const p of paths) {
        if (opts?.cdnResidualAfterRemove && objects.has(p)) {
          cdnGhosts.set(p, Buffer.from(objects.get(p)!))
        }
        objects.delete(p)
      }
      return { data: paths.map((p) => ({ name: p })), error: null }
    },
    getPublicUrl(path: string) {
      publicUrlCalls += 1
      return { data: { publicUrl: `https://example.invalid/${path}` } }
    },
  }

  if (!opts?.omitList) {
    bucketApi.list = async (path, options) => {
      listCalls.push({ path: path ?? "", options })
      if (opts?.failList) {
        return { data: null, error: { message: "list error" } }
      }
      const folder = path ?? ""
      const search = typeof options?.search === "string" ? options.search : ""
      const entries: Array<{ name: string }> = []
      for (const key of objects.keys()) {
        const lastSlash = key.lastIndexOf("/")
        const keyFolder = lastSlash >= 0 ? key.slice(0, lastSlash) : ""
        const keyName = lastSlash >= 0 ? key.slice(lastSlash + 1) : key
        if (keyFolder !== folder) continue
        if (search && !keyName.includes(search)) continue
        entries.push({ name: keyName })
      }
      const limit = options?.limit ?? 100
      return { data: entries.slice(0, limit), error: null }
    }
  }

  return {
    objects,
    cdnGhosts,
    uploadCalls,
    removeCalls,
    downloadCalls,
    listCalls,
    fromCalls,
    get publicUrlCalls() {
      return publicUrlCalls
    },
    storage: {
      from(bucket: string) {
        fromCalls.push(bucket)
        return bucketApi as ForensicRemoteStorageBucket
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
  assert.equal(client.uploadCalls[0]!.options.cacheControl, "0")
  assert.equal(client.uploadCalls[1]!.options.contentType, "application/json")
  assert.equal(client.uploadCalls[1]!.options.upsert, false)
  assert.equal(client.uploadCalls[1]!.options.cacheControl, undefined)
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
  if (rm.ok) {
    assert.equal(rm.originDeleted, true)
    assert.equal(rm.cdnResidualReadable, false)
  }
  assert.equal(client.removeCalls.length, 1)
  assert.deepEqual(client.removeCalls[0], [p.path, p.metaPath])
  assert.equal(client.objects.has(p.path), false)
  assert.equal(client.objects.has(p.metaPath), false)
  assert.equal(client.objects.has(other.path), true)
  assert.equal(client.objects.has(other.metaPath), true)
  // No prefijo recursive: solo exactamente 2 paths
  assert.equal(client.removeCalls[0]!.length, 2)
  assert.equal(client.removeCalls[0]!.some((x) => x.endsWith("/")), false)
  // Post-delete verifica ORIGEN vía list (no download como autoridad)
  assert.ok(client.listCalls.length >= 2)
  assert.equal(client.publicUrlCalls, 0)
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

test("23. remove API error → fail-soft (no throw)", async () => {
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

test("N2-A.9B-1. remove + origen ausente → PASS", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("rm-ok")
  const p = pathsFor({ runId: "run-rm-ok", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, true)
  if (rm.ok) {
    assert.equal(rm.originDeleted, true)
    assert.equal(rm.cdnResidualReadable, false)
  }
  assert.equal(client.objects.has(p.path), false)
  assert.equal(client.objects.has(p.metaPath), false)
})

test("N2-A.9B-2. remove error:null + objeto sigue en origen → FAIL delete_not_effective", async () => {
  const client = createMockClient({ removeNoOp: true })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("rm-noop")
  const p = pathsFor({ runId: "run-rm-noop", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, false)
  if (!rm.ok) {
    assert.equal(rm.errorCode, "delete_not_effective")
    assert.equal(rm.originDeleted, false)
  }
  assert.equal(client.objects.has(p.path), true)
  assert.equal(client.objects.has(p.metaPath), true)
  // Aún recuperable vía read
  const rd = await created.sink.read({ path: p.path, azureInputSha256: p.azureInputSha256 })
  assert.equal(rd.ok, true)
})

test("N2-A.9G. origen ausente + download CDN HIT → ORIGIN PASS + residual separado", async () => {
  const client = createMockClient({ cdnResidualAfterRemove: true })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("rm-cdn")
  const p = pathsFor({ runId: "run-rm-cdn", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, true, "ORIGIN_DELETE PASS pese a CDN HIT")
  if (rm.ok) {
    assert.equal(rm.originDeleted, true)
    assert.equal(rm.cdnResidualReadable, true)
  }
  assert.equal(client.objects.has(p.path), false)
  assert.equal(client.objects.has(p.metaPath), false)
  assert.equal(client.cdnGhosts.has(p.path), true)
  // list fue autoridad; download solo informó residual
  assert.ok(client.listCalls.length >= 2)
  assert.ok(client.downloadCalls.includes(p.path))
})

test("N2-A.9B-4. objeto nunca desaparece del origen → FAIL delete_not_effective", async () => {
  const client = createMockClient({ removeNoOp: true })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("rm-never")
  const p = pathsFor({ runId: "run-rm-never", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, false)
  if (!rm.ok) assert.equal(rm.errorCode, "delete_not_effective")
  // Verificación origen: list exacto (sin retry loop 0/50/100)
  assert.ok(client.listCalls.length >= 1)
  assert.ok(client.listCalls.length <= 4)
})

test("N2-A.9B-5. PNG borrado / meta sigue en origen → FAIL", async () => {
  const client = createMockClient({ removeOnlySuffix: ".png" })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("rm-png-only")
  const p = pathsFor({ runId: "run-rm-png", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, false)
  if (!rm.ok) {
    assert.equal(rm.errorCode, "delete_not_effective")
    assert.equal(rm.originDeleted, false)
  }
  assert.equal(client.objects.has(p.path), false)
  assert.equal(client.objects.has(p.metaPath), true)
})

test("N2-A.9B-6. meta borrada / PNG sigue en origen → FAIL", async () => {
  const client = createMockClient({ removeOnlySuffix: ".meta.json" })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("rm-meta-only")
  const p = pathsFor({ runId: "run-rm-meta", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, false)
  if (!rm.ok) {
    assert.equal(rm.errorCode, "delete_not_effective")
    assert.equal(rm.originDeleted, false)
  }
  assert.equal(client.objects.has(p.path), true)
  assert.equal(client.objects.has(p.metaPath), false)
})

test("N2-A.9B-7. ambos desaparecen en origen → PASS", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("rm-both")
  const p = pathsFor({ runId: "run-rm-both", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, true)
  if (rm.ok) assert.equal(rm.originDeleted, true)
  const missingPng = await created.sink.read({
    path: p.path,
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(missingPng.ok, false)
})

test("N2-A.9B-8. no recursive delete / solo paths exactos / no batch-scans / no public URL / no PII / no throw", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  assert.equal(isForensicBucketAllowed("batch-scans"), false)
  const buf = synthPng("rm-guards")
  const p = pathsFor({ runId: "run-rm-guards", student: 1, page: 0, attempt: 0, buf })
  const otherStudent = pathsFor({ runId: "run-rm-guards", student: 9, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  await created.sink.write({
    path: otherStudent.path,
    metaPath: otherStudent.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: otherStudent.azureInputSha256 }),
    azureInputSha256: otherStudent.azureInputSha256,
  })
  let threw = false
  let rm: Awaited<ReturnType<typeof created.sink.remove>> | null = null
  try {
    rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  } catch {
    threw = true
  }
  assert.equal(threw, false)
  assert.ok(rm)
  assert.equal(rm!.ok, true)
  assert.deepEqual(client.removeCalls[0], [p.path, p.metaPath])
  assert.equal(client.removeCalls[0]!.length, 2)
  assert.equal(
    client.removeCalls.some((call) => call.some((x) => x.endsWith("/") || x.includes("*"))),
    false,
  )
  assert.equal(client.objects.has(otherStudent.path), true)
  assert.equal(client.objects.has(otherStudent.metaPath), true)
  assert.equal(client.publicUrlCalls, 0)
  assert.equal(client.fromCalls.includes("batch-scans"), false)
  const meta = client.objects.get(otherStudent.metaPath)!.toString("utf8")
  assert.equal(meta.includes("@"), false)
  assert.equal(meta.toLowerCase().includes("teacher_key"), false)
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
  if (rm.ok) {
    assert.equal(rm.originDeleted, true)
    assert.equal(rm.cdnResidualReadable, false)
  }
  assert.equal(client.objects.has(p.path), false)
  assert.equal(client.objects.has(p.metaPath), false)

  const missing = await created.sink.read({ path: p.path, azureInputSha256: p.azureInputSha256 })
  assert.equal(missing.ok, false)
})

// --- N2-A.9E: cacheControl='0' exclusivo del PNG forense ---
test("N2-A.9E-1. PNG upload usa cacheControl='0' + contentType=image/png + upsert=false", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("cc0")
  const p = pathsFor({ runId: "run-cc0", student: 1, page: 0, attempt: 0, buf })
  const wr = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256, byteLength: buf.byteLength }),
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(wr.ok, true, "WRITE PASS")
  const pngUpload = client.uploadCalls.find((c) => c.path === p.path)
  assert.ok(pngUpload)
  assert.equal(pngUpload!.options.cacheControl, "0")
  assert.equal(pngUpload!.options.contentType, "image/png")
  assert.equal(pngUpload!.options.upsert, false)
})

test("N2-A.9E-2. meta no recibe cacheControl; bucket funcional y batch-scans intactos", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("cc-meta")
  const p = pathsFor({ runId: "run-cc-meta", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const metaUpload = client.uploadCalls.find((c) => c.path === p.metaPath)
  assert.ok(metaUpload)
  assert.equal(metaUpload!.options.cacheControl, undefined)
  assert.equal(metaUpload!.options.contentType, "application/json")
  assert.equal(metaUpload!.options.upsert, false)
  assert.equal(client.fromCalls.includes("batch-scans"), false)
  assert.equal(client.fromCalls.includes("utp-audit-private"), false)
  assert.deepEqual(client.fromCalls, [AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET])
  assert.equal(isForensicBucketAllowed("batch-scans"), false)
  const forbidden = createRemoteForensicSink({
    bucketName: "batch-scans",
    client: createMockClient(),
  })
  assert.equal(forbidden.ok, false)
})

test("N2-A.9E-3. metadata sin PII + flag OFF no ejecuta sink", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("cc-pii")
  const p = pathsFor({ runId: "run-cc-pii", student: 1, page: 0, attempt: 0, buf })
  const meta = metaJson({ azureInputSha256: p.azureInputSha256, byteLength: buf.byteLength })
  assert.equal(meta.includes("@"), false)
  assert.equal(meta.toLowerCase().includes("teacher_key"), false)
  assert.equal(meta.includes("data:image"), false)
  assert.equal(meta.includes("https://"), false)
  assert.equal(meta.toLowerCase().includes("base64"), false)
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  const storedMeta = client.objects.get(p.metaPath)!.toString("utf8")
  assert.equal(storedMeta.includes("@"), false)
  assert.equal(storedMeta.toLowerCase().includes("teacher_key"), false)
  assert.equal(storedMeta.includes("data:image"), false)

  await withEnv(
    {
      [AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]: "0",
      [AZURE_FORENSIC_BUCKET_ENV]: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
      NODE_ENV: "test",
    },
    async () => {
      resetResolvers()
      const offClient = createMockClient()
      __setForensicRemoteClientForTests(offClient)
      const ref = await recordAzureForensicPackage(minimalCaptureInput(synthPng("flagoff-cc")))
      assert.equal(ref, null)
      assert.equal(offClient.objects.size, 0)
      assert.equal(offClient.uploadCalls.length, 0)
    },
  )
})

test("N2-A.9E-4. write/read/SHA/no-overwrite/remove siguen PASS", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("cc-cycle")
  const p = pathsFor({ runId: "run-cc-cycle", student: 1, page: 0, attempt: 0, buf })
  const meta = metaJson({ azureInputSha256: p.azureInputSha256, byteLength: buf.byteLength })
  const wr = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(wr.ok, true, "WRITE PASS")
  assert.equal(client.uploadCalls[0]!.options.cacheControl, "0")

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

  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, true, "REMOVE PASS")
  if (rm.ok) assert.equal(rm.originDeleted, true)
  assert.equal(client.objects.has(p.path), false)
  assert.equal(client.objects.has(p.metaPath), false)
})

test("N2-A.9E-5. delete_not_effective si origen sigue; residual CDN no oculta; no public URL", async () => {
  const client = createMockClient({ removeNoOp: true })
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("cc-dne")
  const p = pathsFor({ runId: "run-cc-dne", student: 1, page: 0, attempt: 0, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, false)
  if (!rm.ok) {
    assert.equal(rm.errorCode, "delete_not_effective")
    assert.equal(rm.originDeleted, false)
  }
  assert.equal(client.objects.has(p.path), true)
  const still = await created.sink.read({ path: p.path, azureInputSha256: p.azureInputSha256 })
  assert.equal(still.ok, true)
  assert.equal(client.publicUrlCalls, 0)
  const fs = await import("node:fs")
  const path = await import("node:path")
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/lib/diagnostics/azure-forensic-remote-sink.ts"),
    "utf8",
  )
  assert.equal(/getPublicUrl\s*\(/.test(src), false)
  assert.equal(/createSignedUrl\s*\(/.test(src), false)
  assert.equal(/toString\(\s*["']base64["']\s*\)/.test(src), false)
})

test("N2-A.9E-6. read sin cambio; remove usa list origen; cacheControl solo en upload PNG", async () => {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/lib/diagnostics/azure-forensic-remote-sink.ts"),
    "utf8",
  )
  const pngUploadIdx = src.indexOf("contentType: PNG_CONTENT_TYPE")
  const metaUploadIdx = src.indexOf('contentType: "application/json"')
  const cacheIdx = src.indexOf('cacheControl: "0"')
  assert.ok(pngUploadIdx > 0)
  assert.ok(metaUploadIdx > pngUploadIdx)
  assert.ok(cacheIdx > pngUploadIdx)
  assert.ok(cacheIdx < metaUploadIdx)
  // N2-A.9G: sin retries download 0/50/100; autoridad = list origen
  assert.equal(src.includes("POST_DELETE_VERIFY_ATTEMPTS"), false)
  assert.equal(src.includes("POST_DELETE_RETRY_DELAYS_MS"), false)
  assert.equal(src.includes("confirmExactPathsAbsentAtOrigin"), true)
  assert.equal(src.includes("probeCdnResidualReadable"), true)
  // cacheControl solo en tipo upload + PNG; no en read/remove.
  const readFn = src.slice(
    src.indexOf("async function readRemoteArtifact"),
    src.indexOf("async function removeRemoteArtifact"),
  )
  const removeFn = src.slice(src.indexOf("async function removeRemoteArtifact"))
  assert.equal(readFn.includes("cacheControl"), false)
  assert.equal(removeFn.includes("cacheControl"), false)
  // remove no usa download como autoridad de origen
  assert.equal(removeFn.includes("confirmExactPathsAbsentAtOrigin"), true)
})

test("N2-A.9G. list exacto / no recursive / no prefix / omitList → origin_verify_failed", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("list-exact")
  const p = pathsFor({ runId: "run-list-exact", student: 1, page: 0, attempt: 0, buf })
  const neighbor = pathsFor({ runId: "run-list-exact", student: 1, page: 0, attempt: 1, buf })
  await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: p.azureInputSha256 }),
    azureInputSha256: p.azureInputSha256,
  })
  await created.sink.write({
    path: neighbor.path,
    metaPath: neighbor.metaPath,
    bytes: buf,
    metaJson: metaJson({ azureInputSha256: neighbor.azureInputSha256 }),
    azureInputSha256: neighbor.azureInputSha256,
  })
  const rm = await created.sink.remove({ path: p.path, metaPath: p.metaPath })
  assert.equal(rm.ok, true)
  for (const call of client.listCalls) {
    assert.equal(typeof call.options?.search === "string" && call.options.search.length > 0, true)
    assert.equal(call.path.includes("*"), false)
    assert.equal(call.path.endsWith("/"), false)
  }
  assert.equal(client.objects.has(neighbor.path), true)
  assert.deepEqual(client.removeCalls[0], [p.path, p.metaPath])

  const noList = createMockClient({ omitList: true })
  const created2 = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client: noList,
  })
  assert.ok(created2.ok)
  if (!created2.ok) return
  const buf2 = synthPng("nolist")
  const p2 = pathsFor({ runId: "run-nolist", student: 1, page: 0, attempt: 0, buf: buf2 })
  await created2.sink.write({
    path: p2.path,
    metaPath: p2.metaPath,
    bytes: buf2,
    metaJson: metaJson({ azureInputSha256: p2.azureInputSha256 }),
    azureInputSha256: p2.azureInputSha256,
  })
  const rm2 = await created2.sink.remove({ path: p2.path, metaPath: p2.metaPath })
  assert.equal(rm2.ok, false)
  if (!rm2.ok) assert.equal(rm2.errorCode, "origin_verify_failed")
})

test("N2-A.9G. batch-scans + utp-audit-private imposibles; flags OFF identidad", async () => {
  assert.equal(isForensicBucketAllowed("batch-scans"), false)
  assert.equal(isForensicBucketAllowed("utp-audit-private"), false)
  assert.equal(resolveForensicBucketName("batch-scans").ok, false)
  assert.equal(resolveForensicBucketName("utp-audit-private").ok, false)
  const forbiddenA = createRemoteForensicSink({
    bucketName: "batch-scans",
    client: createMockClient(),
  })
  const forbiddenB = createRemoteForensicSink({
    bucketName: "utp-audit-private",
    client: createMockClient(),
  })
  assert.equal(forbiddenA.ok, false)
  assert.equal(forbiddenB.ok, false)

  await withEnv(
    {
      [AZURE_FORENSIC_BUFFER_CAPTURE_FLAG]: undefined,
      [AZURE_FORENSIC_BUCKET_ENV]: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
      NODE_ENV: "test",
    },
    async () => {
      resetResolvers()
      const client = createMockClient()
      __setForensicRemoteClientForTests(client)
      const ref = await recordAzureForensicPackage(minimalCaptureInput(synthPng("9g-off")))
      assert.equal(ref, null)
      assert.equal(client.objects.size, 0)
      assert.equal(client.uploadCalls.length, 0)
      assert.equal(client.removeCalls.length, 0)
    },
  )
})

test("N2-A.9G. WRITE/READ/SHA/no-overwrite intactos tras contrato origin", async () => {
  const client = createMockClient()
  const created = createRemoteForensicSink({
    bucketName: AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET,
    client,
  })
  assert.ok(created.ok)
  if (!created.ok) return
  const buf = synthPng("9g-wrs")
  const p = pathsFor({ runId: "run-9g-wrs", student: 1, page: 0, attempt: 0, buf })
  const meta = metaJson({ azureInputSha256: p.azureInputSha256, byteLength: buf.byteLength })
  const wr = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(wr.ok, true)
  const rd = await created.sink.read({ path: p.path, azureInputSha256: p.azureInputSha256 })
  assert.equal(rd.ok, true)
  if (rd.ok) assert.equal(rd.azureInputSha256, p.azureInputSha256)
  const ow = await created.sink.write({
    path: p.path,
    metaPath: p.metaPath,
    bytes: buf,
    metaJson: meta,
    azureInputSha256: p.azureInputSha256,
  })
  assert.equal(ow.ok, false)
  if (!ow.ok) assert.equal(ow.errorCode, "already_exists")
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
