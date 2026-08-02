/**
 * Photo → OMR Diagnostic Flight Recorder (FASE B — módulo aislado e inerte).
 *
 * No importar desde runtime / pipeline / UI. Sin efectos al cargarse.
 * Emisión únicamente con LIBELIA_PHOTO_OMR_PIPELINE_DIAG=1 (exacto).
 */

export const PHOTO_OMR_DIAG_LOG_PREFIX = "[PHOTO_OMR_DIAG]" as const

export const PHOTO_OMR_PIPELINE_DIAG_FLAG = "LIBELIA_PHOTO_OMR_PIPELINE_DIAG" as const

export type PhotoOmrDiagnosticEventName =
  | "PHOTO_SYNCED_TO_PREVIEW"
  | "GROUP_FILES_AFTER_SORT"
  | "FILE_URLS_RESOLVED"
  | "VALID_FILE_URLS_READY"
  | "IMAGE_RESOLUTION_RESULT"
  | "IMAGE_ENTERING_OMR"
  | "OMR_PAGE_RESULT"
  | "QUESTION_CANDIDATE_AFTER_MERGE"
  | "QUESTION_FINALIZED_AS_BLANK"
  | "EVALUATION_DIAGNOSTIC_COMPLETE"
  | "DIAGNOSTIC_INTERNAL_FAILURE"

export type MergeDecisionDiag = "kept_current" | "took_incoming"

export type SafeDiagnosticSnapshot = {
  schemaVersion: 1
  event: PhotoOmrDiagnosticEventName
  timestamp: string
  pilotId?: string
  diagnosticSessionId?: string
  evaluationBatchId?: string
  sourcePhotoId?: string
  studentIndex?: number
  batchStudentIndex?: number
  sourceFileIndex?: number
  resolvedUrlIndex?: number
  validUrlIndex?: number
  imageListIndex?: number
  pdfPageIndex?: number
  omrAttemptIndex?: number
  questionNumber?: number
  pageIndex?: number
  pathHash?: string
  urlHash?: string
  contentHash?: string
  mime?: string
  byteLength?: number
  width?: number
  height?: number
  engine?: string
  detectedAnswer?: string
  confidence?: number
  blankStage?: string
  mergeDecision?: MergeDecisionDiag
  totalFiles?: number
  totalImages?: number
  totalQuestions?: number
  truncated?: boolean
  truncatedReason?: string
}

const EVENT_NAMES: ReadonlySet<string> = new Set<PhotoOmrDiagnosticEventName>([
  "PHOTO_SYNCED_TO_PREVIEW",
  "GROUP_FILES_AFTER_SORT",
  "FILE_URLS_RESOLVED",
  "VALID_FILE_URLS_READY",
  "IMAGE_RESOLUTION_RESULT",
  "IMAGE_ENTERING_OMR",
  "OMR_PAGE_RESULT",
  "QUESTION_CANDIDATE_AFTER_MERGE",
  "QUESTION_FINALIZED_AS_BLANK",
  "EVALUATION_DIAGNOSTIC_COMPLETE",
  "DIAGNOSTIC_INTERNAL_FAILURE",
])

const MERGE_DECISIONS: ReadonlySet<string> = new Set<MergeDecisionDiag>([
  "kept_current",
  "took_incoming",
])

const SAFE_DETECTED_ANSWERS: ReadonlySet<string> = new Set([
  "A",
  "B",
  "C",
  "D",
  "E",
  "BLANK",
  "NONE",
  "?",
])

const MAX_ID_LEN = 64
const MAX_HASH_LEN = 128
const MAX_MIME_LEN = 64
const MAX_ENGINE_LEN = 48
const MAX_STAGE_LEN = 64
const MAX_REASON_LEN = 96
const MAX_EVENT_JSON_LEN = 4096
const MAX_EVENTS_PER_PROCESS = 500

const HASH_RE = /^[a-fA-F0-9]+$/
const MIME_RE = /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]{0,62}\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]{0,62}$/
const ISO_TS_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

let emittedCount = 0

/** Solo el valor exacto "1" habilita. Ausencia / "" / "0" / "false" / "true" → OFF. */
export function isPhotoOmrPipelineDiagnosticEnabled(): boolean {
  try {
    const raw = process.env[PHOTO_OMR_PIPELINE_DIAG_FLAG]
    return raw === "1"
  } catch {
    return false
  }
}

/**
 * Construye un snapshot plano y redactado. No muta `input`.
 * Ante datos inválidos: omite campos o retorna null (snapshot rechazado).
 */
export function buildSafeDiagnosticSnapshot(
  input: unknown,
): SafeDiagnosticSnapshot | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return null
    }

    const src = input as Record<string, unknown>

    if (src.schemaVersion !== 1) {
      return null
    }

    const eventRaw = src.event
    if (typeof eventRaw !== "string" || !EVENT_NAMES.has(eventRaw)) {
      return null
    }
    const event = eventRaw as PhotoOmrDiagnosticEventName

    const timestamp = readIsoTimestamp(src.timestamp)
    if (timestamp === undefined) {
      return null
    }

    const out: SafeDiagnosticSnapshot = {
      schemaVersion: 1,
      event,
      timestamp,
    }

    assignOptionalId(out, "pilotId", src.pilotId)
    assignOptionalId(out, "diagnosticSessionId", src.diagnosticSessionId)
    assignOptionalId(out, "evaluationBatchId", src.evaluationBatchId)
    assignOptionalId(out, "sourcePhotoId", src.sourcePhotoId)

    assignOptionalNonNegInt(out, "studentIndex", src.studentIndex)
    assignOptionalNonNegInt(out, "batchStudentIndex", src.batchStudentIndex)
    assignOptionalNonNegInt(out, "sourceFileIndex", src.sourceFileIndex)
    assignOptionalNonNegInt(out, "resolvedUrlIndex", src.resolvedUrlIndex)
    assignOptionalNonNegInt(out, "validUrlIndex", src.validUrlIndex)
    assignOptionalNonNegInt(out, "imageListIndex", src.imageListIndex)
    assignOptionalNonNegInt(out, "pdfPageIndex", src.pdfPageIndex)
    assignOptionalNonNegInt(out, "omrAttemptIndex", src.omrAttemptIndex)
    assignOptionalNonNegInt(out, "questionNumber", src.questionNumber)
    assignOptionalNonNegInt(out, "pageIndex", src.pageIndex)

    assignOptionalHash(out, "pathHash", src.pathHash)
    assignOptionalHash(out, "urlHash", src.urlHash)
    assignOptionalHash(out, "contentHash", src.contentHash)

    assignOptionalMime(out, src.mime)
    assignOptionalNonNegInt(out, "byteLength", src.byteLength)
    assignOptionalPositiveInt(out, "width", src.width)
    assignOptionalPositiveInt(out, "height", src.height)

    assignOptionalBoundedString(out, "engine", src.engine, MAX_ENGINE_LEN)
    assignOptionalDetectedAnswer(out, src.detectedAnswer)
    assignOptionalConfidence(out, src.confidence)
    assignOptionalBoundedString(out, "blankStage", src.blankStage, MAX_STAGE_LEN)
    assignOptionalMergeDecision(out, src.mergeDecision)

    assignOptionalNonNegInt(out, "totalFiles", src.totalFiles)
    assignOptionalNonNegInt(out, "totalImages", src.totalImages)
    assignOptionalNonNegInt(out, "totalQuestions", src.totalQuestions)

    if (src.truncated === true) {
      out.truncated = true
    }
    assignOptionalBoundedString(out, "truncatedReason", src.truncatedReason, MAX_REASON_LEN)

    return out
  } catch {
    return null
  }
}

/**
 * Emite un evento diagnóstico estructurado (una línea JSON). Retorna void.
 * Fail-soft absoluto: nunca lanza al consumidor; no muta argumentos; no async.
 * Sin flag = no-op.
 */
export function safeDiagnosticEvent(snapshot: SafeDiagnosticSnapshot): void {
  try {
    if (!isPhotoOmrPipelineDiagnosticEnabled()) {
      return
    }

    if (emittedCount >= MAX_EVENTS_PER_PROCESS) {
      return
    }

    const safe = buildSafeDiagnosticSnapshot(snapshot)
    if (safe === null) {
      emitLineOnce({
        schemaVersion: 1,
        event: "DIAGNOSTIC_INTERNAL_FAILURE",
        timestamp: new Date().toISOString(),
        truncated: true,
        truncatedReason: "invalid_snapshot",
      })
      return
    }

    emitLineOnce(safe)
  } catch {
    // invisible para el consumidor
  }
}

function emitLineOnce(event: SafeDiagnosticSnapshot): void {
  try {
    if (emittedCount >= MAX_EVENTS_PER_PROCESS) {
      return
    }

    let line = JSON.stringify(event)
    if (typeof line !== "string") {
      return
    }

    if (line.length > MAX_EVENT_JSON_LEN) {
      const truncated: SafeDiagnosticSnapshot = {
        schemaVersion: 1,
        event: event.event === "DIAGNOSTIC_INTERNAL_FAILURE"
          ? "DIAGNOSTIC_INTERNAL_FAILURE"
          : event.event,
        timestamp: event.timestamp,
        truncated: true,
        truncatedReason: "event_too_large",
      }
      line = JSON.stringify(truncated)
      if (typeof line !== "string" || line.length > MAX_EVENT_JSON_LEN) {
        return
      }
    }

    emittedCount += 1
    console.info(`${PHOTO_OMR_DIAG_LOG_PREFIX} ${line}`)
  } catch {
    // no re-emitir el fallo del logger
  }
}

function readIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (value.length < 20 || value.length > 40) return undefined
  if (!ISO_TS_RE.test(value)) return undefined
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return undefined
  return value
}

function assignOptionalId(
  out: SafeDiagnosticSnapshot,
  key:
    | "pilotId"
    | "diagnosticSessionId"
    | "evaluationBatchId"
    | "sourcePhotoId",
  value: unknown,
): void {
  const s = readBoundedPlainString(value, MAX_ID_LEN)
  if (s !== undefined) {
    out[key] = s
  }
}

function assignOptionalHash(
  out: SafeDiagnosticSnapshot,
  key: "pathHash" | "urlHash" | "contentHash",
  value: unknown,
): void {
  if (typeof value !== "string") return
  if (value.length < 8 || value.length > MAX_HASH_LEN) return
  if (!HASH_RE.test(value)) return
  out[key] = value
}

function assignOptionalMime(out: SafeDiagnosticSnapshot, value: unknown): void {
  if (typeof value !== "string") return
  if (value.length < 3 || value.length > MAX_MIME_LEN) return
  if (!MIME_RE.test(value)) return
  out.mime = value
}

function assignOptionalDetectedAnswer(
  out: SafeDiagnosticSnapshot,
  value: unknown,
): void {
  if (typeof value !== "string") return
  if (!SAFE_DETECTED_ANSWERS.has(value)) return
  out.detectedAnswer = value
}

function assignOptionalConfidence(
  out: SafeDiagnosticSnapshot,
  value: unknown,
): void {
  if (typeof value !== "number") return
  if (!Number.isFinite(value)) return
  if (value < 0 || value > 1) return
  out.confidence = value
}

function assignOptionalMergeDecision(
  out: SafeDiagnosticSnapshot,
  value: unknown,
): void {
  if (typeof value !== "string") return
  if (!MERGE_DECISIONS.has(value)) return
  out.mergeDecision = value as MergeDecisionDiag
}

function assignOptionalBoundedString(
  out: SafeDiagnosticSnapshot,
  key: "engine" | "blankStage" | "truncatedReason",
  value: unknown,
  maxLen: number,
): void {
  const s = readBoundedPlainString(value, maxLen)
  if (s !== undefined) {
    out[key] = s
  }
}

function assignOptionalNonNegInt(
  out: SafeDiagnosticSnapshot,
  key:
    | "studentIndex"
    | "batchStudentIndex"
    | "sourceFileIndex"
    | "resolvedUrlIndex"
    | "validUrlIndex"
    | "imageListIndex"
    | "pdfPageIndex"
    | "omrAttemptIndex"
    | "questionNumber"
    | "pageIndex"
    | "byteLength"
    | "totalFiles"
    | "totalImages"
    | "totalQuestions",
  value: unknown,
): void {
  const n = readNonNegInt(value)
  if (n !== undefined) {
    out[key] = n
  }
}

function assignOptionalPositiveInt(
  out: SafeDiagnosticSnapshot,
  key: "width" | "height",
  value: unknown,
): void {
  const n = readNonNegInt(value)
  if (n === undefined || n <= 0) return
  out[key] = n
}

function readNonNegInt(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined
  if (!Number.isFinite(value)) return undefined
  if (!Number.isInteger(value)) return undefined
  if (value < 0) return undefined
  if (value > Number.MAX_SAFE_INTEGER) return undefined
  return value
}

/**
 * Strings planos acotados. Rechaza URLs, data-URLs y material obviamente no redactado.
 * No corrige: omite.
 */
function readBoundedPlainString(
  value: unknown,
  maxLen: number,
): string | undefined {
  if (typeof value !== "string") return undefined
  if (value.length === 0 || value.length > maxLen) return undefined
  if (value.includes("://")) return undefined
  if (value.includes("data:")) return undefined
  if (/\s/.test(value)) return undefined
  return value
}
