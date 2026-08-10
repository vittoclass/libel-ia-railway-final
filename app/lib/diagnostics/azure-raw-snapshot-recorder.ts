/**
 * Azure Raw Snapshot Recorder (FASE R.10 + N2-A.3 — pasivo, stdout, reversible).
 *
 * Captura una instantánea diagnóstica forense mínima:
 * - selectionMarks crudos de Azure (antes de transformaciones OMR)
 * - identidad técnica (diagnosticRunId / batch / page / attempt)
 * - SHA-256 del buffer EXACTO enviado a Azure (orientation.buffer post rotate/png)
 * - width / height / unit de página Azure
 * - omrPerQuestion (questionNumber + selectedAnswer) de esa ejecución
 *
 * Emisión únicamente con LIBELIA_AZURE_RAW_SNAPSHOT=1 (valor exacto).
 * Fail-soft absoluto: nunca lanza; no muta analyzeResult/out; no async.
 * Salida: un console.log por página con prefijo [AZURE_RAW_SNAPSHOT] (sin archivos).
 *
 * IMPORTANTE (N2-A.6B): RAW_SNAPSHOT=1 NO almacena bytes de imagen.
 * El almacenamiento del buffer exacto requiere LIBELIA_AZURE_FORENSIC_BUFFER_CAPTURE=1
 * (módulo azure-forensic-buffer-artifact; independiente).
 *
 * Mapping de contrato (nombres canónicos ↔ payload):
 *   diagnosticRunId     → diagnosticRunId
 *   evaluationBatchId   → evaluationBatchId (legacy: technicalBatchId)
 *   batchStudentIndex   → batchStudentIndex
 *   pageIndex           → pageIndex (identidad lógica; context.pageIndex si 1 página)
 *   azurePageIndex      → azurePageIndex (índice en analyzeResult.pages)
 *   attempt             → attempt
 *   azureInputSha256    → azureInputSha256
 *   width/height/unit   → width / height / unit
 *   selectionMarks      → polygon / state / confidence (+ index / pageNumber)
 *   omrPerQuestion      → questionNumber / selectedAnswer
 */

import { createHash } from "node:crypto"

export const AZURE_RAW_SNAPSHOT_FLAG = "LIBELIA_AZURE_RAW_SNAPSHOT" as const

export const AZURE_RAW_SNAPSHOT_SCHEMA_VERSION = 2 as const

const MAX_SNAPSHOTS_PER_PROCESS = 20
const MAX_LOG_BYTES = 256 * 1024
const MAX_POLYGON_NUMBERS = 64
const MAX_MARKS_PER_PAGE = 2000
const MAX_OMR_ROWS = 500
const MAX_TECH_BATCH_LEN = 64
const MAX_UNIT_LEN = 32
const LOG_PREFIX = "[AZURE_RAW_SNAPSHOT]"

export type AzureRawSnapshotMark = {
  index: number
  state: "selected" | "unselected"
  /** Solo si Azure lo envió; nunca se inventa. */
  confidence?: number
  polygon?: number[]
  boundingRegion?: number[]
  pageNumber?: number
}

export type AzureRawSnapshotOmrRow = {
  questionNumber: number
  selectedAnswer: string
}

export type AzureRawSnapshotPayload = {
  schemaVersion: typeof AZURE_RAW_SNAPSHOT_SCHEMA_VERSION
  timestamp: string
  diagnosticRunId?: string
  evaluationBatchId?: string
  /** @deprecated Prefer evaluationBatchId. Conservado por compatibilidad. */
  technicalBatchId?: string
  batchStudentIndex?: number
  pageIndex: number
  azurePageIndex?: number
  attempt?: number
  azureInputSha256?: string
  width?: number
  height?: number
  /** Solo si Azure lo envió en runtime; nunca se inventa (p. ej. no asumir "pixel"). */
  unit?: string
  selectionMarksTotal: number
  selectionMarks: AzureRawSnapshotMark[]
  omrPerQuestion?: AzureRawSnapshotOmrRow[]
}

export type AzureRawSnapshotContext = {
  diagnosticRunId?: string
  evaluationBatchId?: string
  /** @deprecated Prefer evaluationBatchId. */
  technicalBatchId?: string
  batchStudentIndex?: number
  /** Si se indica, se usa como pageIndex del snapshot (una sola página lógica). */
  pageIndex?: number
  attempt?: number
  /** SHA-256 hex del buffer exacto enviado a Azure (orientation.buffer). */
  azureInputSha256?: string
  /** Resultado OMR por pregunta de esa ejecución (letra / BLANK / MULTIPLE). */
  omrPerQuestion?: ReadonlyArray<{ questionNumber?: unknown; selectedAnswer?: unknown }>
}

type EmitSnapshotFn = (line: string) => void

let writtenCount = 0
let emitSnapshotFn: EmitSnapshotFn = defaultEmitSnapshot

function defaultEmitSnapshot(line: string): void {
  console.log(line)
}

/** Solo el valor exacto "1" habilita. Ausencia / "" / "0" / "false" / "true" → OFF. */
export function isAzureRawSnapshotEnabled(): boolean {
  try {
    return process.env[AZURE_RAW_SNAPSHOT_FLAG] === "1"
  } catch {
    return false
  }
}

/**
 * SHA-256 hexadecimal del buffer exacto enviado a Azure.
 * Fail-soft: nunca lanza; no retiene el buffer.
 */
export function computeAzureInputSha256(buffer: unknown): string | undefined {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return undefined
    }
    return createHash("sha256").update(buffer).digest("hex")
  } catch {
    return undefined
  }
}

/**
 * Construye un snapshot sanitizado de una página. No muta `page`.
 * Solo state / confidence / polygon|boundingRegion / pageNumber / índice / dims / unit.
 */
export function buildSanitizedAzureRawPageSnapshot(
  page: unknown,
  pageIndex: number,
  context?: AzureRawSnapshotContext,
  timestamp?: string,
  azurePageIndex?: number,
): AzureRawSnapshotPayload | null {
  try {
    if (page === null || typeof page !== "object" || Array.isArray(page)) {
      return null
    }
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return null
    }

    const src = page as Record<string, unknown>
    const rawMarks = Array.isArray(src.selectionMarks) ? src.selectionMarks : []
    const pageNumber = readOptionalPositiveInt(src.pageNumber)

    const selectionMarks: AzureRawSnapshotMark[] = []
    const limit = Math.min(rawMarks.length, MAX_MARKS_PER_PAGE)

    for (let i = 0; i < limit; i++) {
      const mark = sanitizeMark(rawMarks[i], i, pageNumber)
      if (mark) {
        selectionMarks.push(mark)
      }
    }

    const out: AzureRawSnapshotPayload = {
      schemaVersion: AZURE_RAW_SNAPSHOT_SCHEMA_VERSION,
      timestamp: typeof timestamp === "string" && timestamp.length > 0
        ? timestamp
        : new Date().toISOString(),
      pageIndex,
      selectionMarksTotal: selectionMarks.length,
      selectionMarks,
    }

    if (
      typeof azurePageIndex === "number" &&
      Number.isInteger(azurePageIndex) &&
      azurePageIndex >= 0
    ) {
      out.azurePageIndex = azurePageIndex
    }

    const width = readOptionalFiniteNumber(src.width)
    if (width !== undefined) out.width = width
    const height = readOptionalFiniteNumber(src.height)
    if (height !== undefined) out.height = height
    const unit = readOptionalUnit(src.unit)
    if (unit !== undefined) out.unit = unit

    const diagnosticRunId = readBoundedPlainId(context?.diagnosticRunId)
    if (diagnosticRunId !== undefined) out.diagnosticRunId = diagnosticRunId

    const evaluationBatchId = readBoundedPlainId(context?.evaluationBatchId)
    if (evaluationBatchId !== undefined) out.evaluationBatchId = evaluationBatchId

    const batchId = readBoundedPlainId(context?.technicalBatchId)
    if (batchId !== undefined) {
      out.technicalBatchId = batchId
      if (out.evaluationBatchId === undefined) {
        out.evaluationBatchId = batchId
      }
    }

    if (
      typeof context?.batchStudentIndex === "number" &&
      Number.isInteger(context.batchStudentIndex) &&
      context.batchStudentIndex >= 0
    ) {
      out.batchStudentIndex = context.batchStudentIndex
    }

    if (
      typeof context?.attempt === "number" &&
      Number.isInteger(context.attempt) &&
      context.attempt >= 0
    ) {
      out.attempt = context.attempt
    }

    const sha = readSha256Hex(context?.azureInputSha256)
    if (sha !== undefined) out.azureInputSha256 = sha

    const omr = sanitizeOmrPerQuestion(context?.omrPerQuestion)
    if (omr !== undefined) out.omrPerQuestion = omr

    return out
  } catch {
    return null
  }
}

/**
 * Registra snapshots sanitizados por página desde analyzeResult crudo.
 * Fail-soft: nunca lanza; no muta analyzeResult; síncrono; sin await.
 * Un log compacto por página: [AZURE_RAW_SNAPSHOT] <JSON>
 */
export function recordAzureRawSnapshot(
  analyzeResult: unknown,
  context?: AzureRawSnapshotContext,
): void {
  try {
    if (!isAzureRawSnapshotEnabled()) {
      return
    }

    if (writtenCount >= MAX_SNAPSHOTS_PER_PROCESS) {
      return
    }

    if (analyzeResult === null || typeof analyzeResult !== "object" || Array.isArray(analyzeResult)) {
      return
    }

    const pages = (analyzeResult as { pages?: unknown }).pages
    if (!Array.isArray(pages) || pages.length === 0) {
      return
    }

    const timestamp = new Date().toISOString()

    const singlePageIndex =
      typeof context?.pageIndex === "number" &&
      Number.isInteger(context.pageIndex) &&
      context.pageIndex >= 0
        ? context.pageIndex
        : undefined

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      if (writtenCount >= MAX_SNAPSHOTS_PER_PROCESS) {
        return
      }

      const effectivePageIndex = singlePageIndex !== undefined && pages.length === 1
        ? singlePageIndex
        : pageIndex

      const snapshot = buildSanitizedAzureRawPageSnapshot(
        pages[pageIndex],
        effectivePageIndex,
        context,
        timestamp,
        pageIndex,
      )
      if (snapshot === null) {
        continue
      }

      let json: string
      try {
        json = JSON.stringify(snapshot)
      } catch {
        continue
      }
      if (typeof json !== "string" || json.length === 0) {
        continue
      }
      if (Buffer.byteLength(json, "utf8") > MAX_LOG_BYTES) {
        continue
      }

      try {
        emitSnapshotFn(`${LOG_PREFIX} ${json}`)
        writtenCount += 1
      } catch {
        // fail-soft: omitir silenciosamente
      }
    }
  } catch {
    // invisible para el consumidor
  }
}

function sanitizeMark(
  raw: unknown,
  index: number,
  pageNumberFallback?: number,
): AzureRawSnapshotMark | null {
  try {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null
    }
    const sm = raw as Record<string, unknown>
    const state = normalizeState(sm.state)
    if (state === undefined) {
      return null
    }

    const polygon = readNumericArray(sm.polygon)
    const boundingRegion = readBoundingRegionNumbers(sm.boundingRegions ?? sm.boundingRegion)

    // Requiere al menos una geometría numérica para ser útil en diagnóstico A/B.
    if (!polygon && !boundingRegion) {
      return null
    }

    const mark: AzureRawSnapshotMark = {
      index,
      state,
    }
    if (typeof sm.confidence === "number" && Number.isFinite(sm.confidence)) {
      mark.confidence = sm.confidence
    }
    if (polygon) {
      mark.polygon = polygon
    }
    if (boundingRegion) {
      mark.boundingRegion = boundingRegion
    }

    const pageNumber =
      readOptionalPositiveInt(sm.pageNumber) ??
      pageNumberFallback
    if (pageNumber !== undefined) {
      mark.pageNumber = pageNumber
    }

    return mark
  } catch {
    return null
  }
}

function sanitizeOmrPerQuestion(
  rows: AzureRawSnapshotContext["omrPerQuestion"],
): AzureRawSnapshotOmrRow[] | undefined {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return undefined
    const out: AzureRawSnapshotOmrRow[] = []
    const limit = Math.min(rows.length, MAX_OMR_ROWS)
    for (let i = 0; i < limit; i++) {
      const row = rows[i]
      if (row === null || typeof row !== "object") continue
      const qn = (row as { questionNumber?: unknown }).questionNumber
      const ans = (row as { selectedAnswer?: unknown }).selectedAnswer
      if (typeof qn !== "number" || !Number.isInteger(qn) || qn < 1) continue
      if (typeof ans !== "string") continue
      const selectedAnswer = normalizeOmrSelectedAnswer(ans)
      if (selectedAnswer === undefined) continue
      out.push({ questionNumber: qn, selectedAnswer })
    }
    return out.length > 0 ? out : undefined
  } catch {
    return undefined
  }
}

function normalizeOmrSelectedAnswer(value: string): string | undefined {
  const t = value.trim().toUpperCase()
  if (t === "BLANK" || t === "MULTIPLE") return t
  if (/^[A-H]$/.test(t)) return t
  return undefined
}

function normalizeState(value: unknown): "selected" | "unselected" | undefined {
  if (typeof value !== "string") return undefined
  const st = value.toLowerCase()
  if (st === "selected") return "selected"
  if (st === "unselected") return "unselected"
  return undefined
}

function readNumericArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length === 0 || value.length > MAX_POLYGON_NUMBERS) return undefined
  const out: number[] = []
  for (const n of value) {
    if (typeof n !== "number" || !Number.isFinite(n)) return undefined
    out.push(n)
  }
  return out
}

function readBoundingRegionNumbers(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    // boundingRegions: [{ pageNumber, polygon }] → primer polygon numérico
    for (const entry of value) {
      if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
        const poly = readNumericArray((entry as { polygon?: unknown }).polygon)
        if (poly) return poly
      }
    }
    // o array numérico directo
    return readNumericArray(value)
  }
  if (value !== null && typeof value === "object") {
    return readNumericArray((value as { polygon?: unknown }).polygon)
  }
  return undefined
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined
  }
  return value
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }
  return value
}

function readOptionalUnit(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_UNIT_LEN) return undefined
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return undefined
  return trimmed
}

function readSha256Hex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const t = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(t)) return undefined
  return t
}

function readBoundedPlainId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TECH_BATCH_LEN) return undefined
  if (!/^[a-zA-Z0-9_.:-]+$/.test(trimmed)) return undefined
  return trimmed
}

/** Solo tests. */
export function __resetAzureRawSnapshotStateForTests(): void {
  writtenCount = 0
  emitSnapshotFn = defaultEmitSnapshot
}

/** Solo tests. */
export function __setAzureRawSnapshotEmitForTests(fn: EmitSnapshotFn | null): void {
  emitSnapshotFn = fn ?? defaultEmitSnapshot
}

/** Solo tests. */
export function __getAzureRawSnapshotWrittenCountForTests(): number {
  return writtenCount
}
