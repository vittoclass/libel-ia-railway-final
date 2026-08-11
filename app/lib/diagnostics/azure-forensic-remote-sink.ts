/**
 * Azure Forensic Remote Sink (FASE N2-A.8 — diagnóstico, local, reversible).
 *
 * Adapter remoto PRIVADO para persistir orientation.buffer PNG + .meta.json
 * en un bucket diagnóstico configurable (futuro: libelia-omr-forensics).
 *
 * Contrato: reutiliza AzureForensicSink.write; expone además read/remove.
 * remove(): éxito solo si Storage remove sin error API Y post-delete confirma
 * que PNG + .meta.json exactos ya no son recuperables (download → not found).
 * Si error:null pero el objeto sigue descargable → delete_not_effective.
 *
 * Política de consistencia (escritura parcial detectable):
 *   1) upload PNG (contentType=image/png, upsert=false)
 *   2) upload .meta.json (contentType=application/json, upsert=false)
 * Si (2) falla tras (1): errorCode=partial_artifact.
 * NO se borra automáticamente el PNG (evitar empeorar el estado);
 * limpieza explícita vía remove({ path, metaPath }) cuando el operador lo decida.
 *
 * Retención: soporte para limpieza explícita ≤7 días (createdAt en meta del caller).
 * NO cron. NO job automático en esta fase.
 *
 * Fail-soft absoluto: nunca lanza hacia el pipeline.
 * Privacidad: sin URL pública, sin firmas públicas, sin log de bytes/base64/PII.
 *
 * PROHIBIDO: bucket batch-scans y otros buckets funcionales conocidos.
 * Variable futura: LIBELIA_AZURE_FORENSIC_BUCKET (ausente → sink no disponible).
 */

import { createHash } from "node:crypto"
import type {
  AzureForensicSink,
  ForensicSinkWriteInput,
  ForensicSinkWriteResult,
} from "@/app/lib/diagnostics/azure-forensic-buffer-artifact"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const AZURE_FORENSIC_BUCKET_ENV = "LIBELIA_AZURE_FORENSIC_BUCKET" as const

/** Alineado con AZURE_FORENSIC_SUGGESTED_BUCKET (sin import runtime circular). */
export const AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET = "libelia-omr-forensics" as const

const PNG_CONTENT_TYPE = "image/png" as const

/** Buckets funcionales conocidos: NUNCA usar como sink forense. */
export const AZURE_FORENSIC_FORBIDDEN_BUCKETS: ReadonlySet<string> = new Set([
  "batch-scans",
  "utp-audit-private",
])

export type ForensicRemoteStorageError = {
  message?: string
  statusCode?: string | number
  name?: string
}

/** Superficie mínima de Storage (inyectable / mockeable). Sin URL pública. */
export type ForensicRemoteStorageBucket = {
  upload(
    path: string,
    body: Buffer,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ data: unknown; error: ForensicRemoteStorageError | null }>
  download(
    path: string,
  ): Promise<{ data: Blob | ArrayBuffer | Buffer | Uint8Array | null; error: ForensicRemoteStorageError | null }>
  remove(
    paths: string[],
  ): Promise<{ data: unknown; error: ForensicRemoteStorageError | null }>
}

export type ForensicRemoteStorageClient = {
  storage: {
    from(bucket: string): ForensicRemoteStorageBucket
  }
}

export type ForensicRemoteSinkReadInput = Readonly<{
  path: string
  azureInputSha256: string
}>

export type ForensicRemoteSinkReadResult =
  | Readonly<{
      ok: true
      bytes: Buffer
      azureInputSha256: string
      byteLength: number
    }>
  | Readonly<{
      ok: false
      errorCode: string
    }>

export type ForensicRemoteSinkRemoveInput = Readonly<{
  path: string
  metaPath: string
}>

export type ForensicRemoteSinkRemoveResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; errorCode: string }>

export type AzureForensicRemoteSink = AzureForensicSink & {
  readonly kind: "configured_private"
  readonly bucketName: string
  read(input: ForensicRemoteSinkReadInput): Promise<ForensicRemoteSinkReadResult>
  remove(input: ForensicRemoteSinkRemoveInput): Promise<ForensicRemoteSinkRemoveResult>
}

export type CreateRemoteForensicSinkOptions = Readonly<{
  bucketName: string
  client: ForensicRemoteStorageClient
}>

export type CreateRemoteForensicSinkResult =
  | Readonly<{ ok: true; sink: AzureForensicRemoteSink }>
  | Readonly<{ ok: false; errorCode: string }>

let remoteClientOverrideForTests: ForensicRemoteStorageClient | null | undefined

/** Solo tests: inyecta cliente Storage mock. null fuerza ausencia de cliente. */
export function __setForensicRemoteClientForTests(
  client: ForensicRemoteStorageClient | null | undefined,
): void {
  remoteClientOverrideForTests = client
}

export function isForensicBucketAllowed(bucketName: string): boolean {
  try {
    if (typeof bucketName !== "string") return false
    const name = bucketName.trim()
    if (name.length === 0 || name.length > 128) return false
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) return false
    if (AZURE_FORENSIC_FORBIDDEN_BUCKETS.has(name)) return false
    return true
  } catch {
    return false
  }
}

export function resolveForensicBucketName(
  explicit?: string | null,
): { ok: true; bucketName: string } | { ok: false; errorCode: string } {
  try {
    const raw =
      typeof explicit === "string" && explicit.trim().length > 0
        ? explicit.trim()
        : typeof process.env[AZURE_FORENSIC_BUCKET_ENV] === "string"
          ? process.env[AZURE_FORENSIC_BUCKET_ENV]!.trim()
          : ""
    if (!raw) return { ok: false, errorCode: "bucket_missing" }
    if (raw === "batch-scans" || AZURE_FORENSIC_FORBIDDEN_BUCKETS.has(raw)) {
      return { ok: false, errorCode: "bucket_forbidden" }
    }
    if (!isForensicBucketAllowed(raw)) {
      return { ok: false, errorCode: "bucket_invalid" }
    }
    return { ok: true, bucketName: raw }
  } catch {
    return { ok: false, errorCode: "bucket_resolve_failed" }
  }
}

/**
 * Crea sink remoto. Rechaza buckets prohibidos (batch-scans, etc.).
 * No lanza.
 */
export function createRemoteForensicSink(
  opts: CreateRemoteForensicSinkOptions,
): CreateRemoteForensicSinkResult {
  try {
    const resolved = resolveForensicBucketName(opts.bucketName)
    if (!resolved.ok) return { ok: false, errorCode: resolved.errorCode }
    if (!opts.client || typeof opts.client.storage?.from !== "function") {
      return { ok: false, errorCode: "client_missing" }
    }
    const bucketName = resolved.bucketName
    const client = opts.client

    const sink: AzureForensicRemoteSink = {
      kind: "configured_private",
      bucketName,
      async write(input: ForensicSinkWriteInput): Promise<ForensicSinkWriteResult> {
        try {
          return await writeRemoteArtifact(client, bucketName, input)
        } catch {
          return { ok: false, errorCode: "remote_write_unexpected" }
        }
      },
      async read(input: ForensicRemoteSinkReadInput): Promise<ForensicRemoteSinkReadResult> {
        try {
          return await readRemoteArtifact(client, bucketName, input)
        } catch {
          return { ok: false, errorCode: "remote_read_unexpected" }
        }
      },
      async remove(input: ForensicRemoteSinkRemoveInput): Promise<ForensicRemoteSinkRemoveResult> {
        try {
          return await removeRemoteArtifact(client, bucketName, input)
        } catch {
          return { ok: false, errorCode: "remote_remove_unexpected" }
        }
      },
    }
    return { ok: true, sink }
  } catch {
    return { ok: false, errorCode: "remote_sink_create_failed" }
  }
}

/**
 * Resolución runtime: bucket env + cliente admin existente.
 * Sin bucket / sin cliente / bucket prohibido → null (fail-soft).
 */
export function tryCreateConfiguredRemoteForensicSink(): AzureForensicSink | null {
  try {
    const resolved = resolveForensicBucketName()
    if (!resolved.ok) return null
    const client = resolveRemoteStorageClient()
    if (!client) return null
    const created = createRemoteForensicSink({
      bucketName: resolved.bucketName,
      client,
    })
    return created.ok ? created.sink : null
  } catch {
    return null
  }
}

export function suggestedForensicBucketName(): string {
  return AZURE_FORENSIC_REMOTE_SUGGESTED_BUCKET
}

function resolveRemoteStorageClient(): ForensicRemoteStorageClient | null {
  try {
    if (remoteClientOverrideForTests !== undefined) {
      return remoteClientOverrideForTests
    }
    // Mecanismo backend existente (service role). Sin nueva key / sin secret en repo.
    const client = getSupabaseServer()
    return client as ForensicRemoteStorageClient | null
  } catch {
    return null
  }
}

async function writeRemoteArtifact(
  client: ForensicRemoteStorageClient,
  bucketName: string,
  input: ForensicSinkWriteInput,
): Promise<ForensicSinkWriteResult> {
  if (!isSafeObjectPath(input.path) || !isSafeObjectPath(input.metaPath)) {
    return { ok: false, errorCode: "path_rejected" }
  }
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    return { ok: false, errorCode: "empty_buffer" }
  }
  const verify = createHash("sha256").update(input.bytes).digest("hex")
  if (verify !== input.azureInputSha256) {
    return { ok: false, errorCode: "sink_sha_mismatch" }
  }

  const bucket = client.storage.from(bucketName)

  // 1) PNG exacto — upsert=false obligatorio (no overwrite).
  let pngResult: { data: unknown; error: ForensicRemoteStorageError | null }
  try {
    pngResult = await bucket.upload(input.path, input.bytes, {
      contentType: PNG_CONTENT_TYPE,
      upsert: false,
    })
  } catch {
    return { ok: false, errorCode: "upload_failed" }
  }

  if (pngResult.error) {
    if (isAlreadyExistsError(pngResult.error)) {
      return { ok: false, errorCode: "already_exists" }
    }
    return { ok: false, errorCode: "upload_failed" }
  }

  // 2) Meta correlacionada. Si falla: partial_artifact (PNG ya remoto; sin auto-delete).
  const metaBytes = Buffer.from(input.metaJson, "utf8")
  let metaResult: { data: unknown; error: ForensicRemoteStorageError | null }
  try {
    metaResult = await bucket.upload(input.metaPath, metaBytes, {
      contentType: "application/json",
      upsert: false,
    })
  } catch {
    return { ok: false, errorCode: "partial_artifact" }
  }

  if (metaResult.error) {
    if (isAlreadyExistsError(metaResult.error)) {
      // PNG nuevo + meta ya existía: estado inconsistente detectable.
      return { ok: false, errorCode: "partial_artifact" }
    }
    return { ok: false, errorCode: "partial_artifact" }
  }

  return { ok: true, sinkKind: "configured_private" }
}

async function readRemoteArtifact(
  client: ForensicRemoteStorageClient,
  bucketName: string,
  input: ForensicRemoteSinkReadInput,
): Promise<ForensicRemoteSinkReadResult> {
  if (!isSafeObjectPath(input.path)) {
    return { ok: false, errorCode: "path_rejected" }
  }
  const expected = readSha256Hex(input.azureInputSha256)
  if (!expected) {
    return { ok: false, errorCode: "sha_invalid" }
  }

  const bucket = client.storage.from(bucketName)
  let downloadResult: {
    data: Blob | ArrayBuffer | Buffer | Uint8Array | null
    error: ForensicRemoteStorageError | null
  }
  try {
    downloadResult = await bucket.download(input.path)
  } catch {
    return { ok: false, errorCode: "download_failed" }
  }

  if (downloadResult.error || downloadResult.data == null) {
    return { ok: false, errorCode: "download_failed" }
  }

  let bytes: Buffer
  try {
    bytes = await toBuffer(downloadResult.data)
  } catch {
    return { ok: false, errorCode: "download_failed" }
  }

  const actual = createHash("sha256").update(bytes).digest("hex")
  if (actual !== expected) {
    return { ok: false, errorCode: "SHA_MISMATCH" }
  }

  return {
    ok: true,
    bytes,
    azureInputSha256: actual,
    byteLength: bytes.byteLength,
  }
}

/**
 * Post-delete: Storage puede devolver error:null sin borrar de verdad
 * (incidente N2-A.9B) o mostrar ausencia retardada breve.
 * Verificación acotada vía download de paths exactos — sin recursive/prefix.
 * Delays totales ≪ 1s; adapter diagnóstico (no bloquea evaluación real).
 */
const POST_DELETE_VERIFY_ATTEMPTS = 3 as const
const POST_DELETE_RETRY_DELAYS_MS: readonly number[] = [0, 50, 100]

async function removeRemoteArtifact(
  client: ForensicRemoteStorageClient,
  bucketName: string,
  input: ForensicRemoteSinkRemoveInput,
): Promise<ForensicRemoteSinkRemoveResult> {
  if (!isSafeObjectPath(input.path) || !isSafeObjectPath(input.metaPath)) {
    return { ok: false, errorCode: "path_rejected" }
  }
  // Paths exactos únicamente. NO prefijos. NO recursive delete.
  const exactPaths = [input.path, input.metaPath] as const
  const bucket = client.storage.from(bucketName)
  try {
    const result = await bucket.remove([...exactPaths])
    if (result.error) {
      return { ok: false, errorCode: "remove_failed" }
    }
  } catch {
    return { ok: false, errorCode: "remove_failed" }
  }

  try {
    const absent = await confirmExactPathsAbsent(bucket, exactPaths)
    if (!absent) {
      return { ok: false, errorCode: "delete_not_effective" }
    }
    return { ok: true }
  } catch {
    return { ok: false, errorCode: "delete_not_effective" }
  }
}

async function confirmExactPathsAbsent(
  bucket: ForensicRemoteStorageBucket,
  paths: readonly string[],
): Promise<boolean> {
  for (let attempt = 0; attempt < POST_DELETE_VERIFY_ATTEMPTS; attempt++) {
    const delayMs = POST_DELETE_RETRY_DELAYS_MS[attempt] ?? 100
    if (delayMs > 0) {
      await sleepMs(delayMs)
    }
    let allAbsent = true
    for (const path of paths) {
      const probe = await probePathAbsent(bucket, path)
      if (!probe) {
        allAbsent = false
        break
      }
    }
    if (allAbsent) return true
  }
  return false
}

/**
 * Ausencia válida: not found / data null con error de ausencia.
 * Si aún hay bytes recuperables → no ausente.
 * Error de red u otro (no not-found) → no certificado ausente (fail-soft).
 */
async function probePathAbsent(
  bucket: ForensicRemoteStorageBucket,
  path: string,
): Promise<boolean> {
  let downloadResult: {
    data: Blob | ArrayBuffer | Buffer | Uint8Array | null
    error: ForensicRemoteStorageError | null
  }
  try {
    downloadResult = await bucket.download(path)
  } catch {
    return false
  }
  if (downloadResult.data != null) {
    return false
  }
  if (!downloadResult.error) {
    return true
  }
  return isNotFoundStorageError(downloadResult.error)
}

function isNotFoundStorageError(error: ForensicRemoteStorageError): boolean {
  const status = String(error.statusCode ?? "")
  const msg = String(error.message ?? "").toLowerCase()
  const name = String(error.name ?? "").toLowerCase()
  return (
    status === "404" ||
    msg.includes("not found") ||
    msg.includes("object not found") ||
    msg.includes("does not exist") ||
    name.includes("notfound")
  )
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isAlreadyExistsError(error: ForensicRemoteStorageError): boolean {
  const msg = String(error.message ?? "").toLowerCase()
  const status = String(error.statusCode ?? "")
  const name = String(error.name ?? "").toLowerCase()
  return (
    status === "409" ||
    msg.includes("already exists") ||
    msg.includes("duplicate") ||
    msg.includes("resource already exists") ||
    name.includes("conflict")
  )
}

function isSafeObjectPath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 512) return false
  if (p.includes("..") || p.includes("\\") || p.startsWith("/")) return false
  if (p.includes("@")) return false
  return true
}

function readSha256Hex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const t = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(t)) return undefined
  return t
}

async function toBuffer(
  data: Blob | ArrayBuffer | Buffer | Uint8Array,
): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return Buffer.from(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof (data as Blob).arrayBuffer === "function") {
    const ab = await (data as Blob).arrayBuffer()
    return Buffer.from(ab)
  }
  throw new Error("unsupported_download_body")
}
