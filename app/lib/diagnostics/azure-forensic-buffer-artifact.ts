/**
 * Azure Forensic Buffer Artifact (FASE N2-A.6B — diagnóstico, local, reversible).
 *
 * Captura el buffer EXACTO enviado a Azure (orientation.buffer) + metadata forense
 * necesaria para Pixel-Proof N2 offline, SIN mutar evaluación.
 *
 * Flag exclusiva: LIBELIA_AZURE_FORENSIC_BUFFER_CAPTURE === "1"
 * OFF por defecto. Independiente de LIBELIA_AZURE_RAW_SNAPSHOT.
 *
 * Sink: abstracción privada configurable. En local/tests → InMemory / LocalFs mock.
 * NO conecta bucket remoto en esta fase. Bucket sugerido futuro: libelia-omr-forensics.
 *
 * Retención diseñada (NO automatizada aquí): máximo 7 días.
 * Identificar: path diag/azure-input/.../{sha256}.png + .meta.json
 * Descargar / verificar SHA / eliminar: procedimiento manual post-GO.
 *
 * Fail-soft absoluto: nunca lanza hacia el pipeline; no muta out/selectedAnswer.
 * Privacidad: sin PII, sin OCR, sin teacher_key, sin base64 en logs, sin URL pública.
 *
 * Mapping Q→letra→polygon: asociación geométrica compatible con N1
 * (associateMarksToQuestions: paneles + sort X). Solo observación diagnóstica.
 */

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  computeAzureInputSha256,
} from "@/app/lib/diagnostics/azure-raw-snapshot-recorder"
import type { AzureLayoutOmrDiagnosticContext } from "@/app/lib/omr/experimental/azure-layout-omr-pipeline"
import type { VisualBlankRescuePageResult } from "@/app/lib/omr-shared/azure-visual-blank-rescue"

export const AZURE_FORENSIC_BUFFER_CAPTURE_FLAG =
  "LIBELIA_AZURE_FORENSIC_BUFFER_CAPTURE" as const

export const AZURE_FORENSIC_PACKAGE_SCHEMA_VERSION = 1 as const
export const AZURE_FORENSIC_RETENTION_MAX_DAYS = 7 as const
export const AZURE_FORENSIC_SUGGESTED_BUCKET = "libelia-omr-forensics" as const
export const AZURE_FORENSIC_EXPECTED_MIME = "image/png" as const
export const AZURE_FORENSIC_LOG_PREFIX = "[AZURE_FORENSIC_BUFFER]" as const
export const AZURE_FORENSIC_FAIL_LOG_PREFIX = "[AZURE_FORENSIC_BUFFER_FAILED]" as const

const MAX_ID_LEN = 64
const MAX_POLYGON_NUMBERS = 64
const MAX_MARKS = 2000
const MAX_QUESTIONS = 500
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const

export type ForensicSourceMode = "batch" | "direct"

export type ForensicArtifactReference = {
  /** Path determinístico relativo al sink privado. Nunca URL pública. */
  path: string
  metaPath: string
  sinkKind: "memory" | "local_fs" | "configured_private"
  azureInputSha256: string
  byteLength: number
  mimeType: typeof AZURE_FORENSIC_EXPECTED_MIME
  /** false siempre en esta fase local; nunca exponer URL pública. */
  publicUrl: false
}

export type ForensicQuestionLetterPolygon = {
  questionNumber: number
  letter: string
  selectionMarkIndex: number
  polygon: number[]
  azureState: "selected" | "unselected"
  azureConfidence?: number
}

export type ForensicOmrPreN1Row = {
  questionNumber: number
  selectedAnswer: string
  assignedDetectionIndices?: number[]
  inferredBlank?: boolean
  source?: string
  confidenceRelevant?: Record<string, number>
}

export type ForensicN1DecisionDiag = {
  questionNumber: number
  action: string
  reason: string
  bestLetter?: string | null
  secondLetter?: string | null
  bestDarkRatio?: number
  bestContrast?: number
  secondDarkRatio?: number
  secondContrast?: number
  marginDarkRatio?: number | null
  marginContrast?: number | null
  metricsABCD?: Array<{
    letter: string
    darkRatio: number
    contrast: number
    meanGray?: number
    localBackground?: number
    azureState?: string
    azureConfidence?: number
  }>
}

export type ForensicN1Correlated = {
  available: boolean
  /** Si N1 no corrió en runtime: reproducible offline con buffer+polygons+código versionado. */
  offlineDerivable: boolean
  pageGatesPassed?: boolean
  pageAbstainReason?: string | null
  pageAction?: string
  selectionMarksTotal?: number
  selectedCountAzure?: number
  blankRowCountBefore?: number
  decisions?: ForensicN1DecisionDiag[]
}

export type ForensicLayoutContext = {
  engine: "azure_layout_family"
  layoutMode: "standard"
  expectedQuestionCount?: number
  expectedOptionCount?: number
  variant?: string
  templateKey?: string
  canonicalWidth?: number
  canonicalHeight?: number
}

export type ForensicTransformMeta = {
  attempt?: number
  azureAnalyzeUsedNormalizedBuffer?: boolean
  azureAutoRotationApplied?: boolean
  azureRotationDegreesApplied?: number
  azureOrientationNormalizationReason?: string
  width?: number
  height?: number
  unit?: string
}

export type ForensicPageResultMeta = {
  selectionMarksTotal?: number
  selectedCountAzure?: number
  blankRowCountBefore?: number
  pageGatesPassed?: boolean
  pageAbstainReason?: string | null
  pageUsefulness?: string
}

export type AzureForensicPackagePayload = {
  schemaVersion: typeof AZURE_FORENSIC_PACKAGE_SCHEMA_VERSION
  timestamp: string
  eventKey: string
  sourceMode: ForensicSourceMode
  diagnosticRunId: string
  evaluationBatchId?: string
  batchStudentIndex?: number
  pageIndex: number
  attempt: number
  azureInputSha256: string
  byteLength: number
  mimeType: typeof AZURE_FORENSIC_EXPECTED_MIME
  artifactReference: ForensicArtifactReference
  questionLetterPolygons: ForensicQuestionLetterPolygon[]
  omrPreN1: ForensicOmrPreN1Row[]
  n1: ForensicN1Correlated
  layout: ForensicLayoutContext
  transform: ForensicTransformMeta
  pageResult: ForensicPageResultMeta
  retention: {
    maxDays: typeof AZURE_FORENSIC_RETENTION_MAX_DAYS
    suggestedBucket: typeof AZURE_FORENSIC_SUGGESTED_BUCKET
    note: string
  }
  /** Documentación: batch≠QR, direct≠PC. captureChannel no implementado. */
  sourceModeSemantics: {
    batchNote: string
    directNote: string
    captureChannel: null
  }
  geometryN1: {
    reproducibleOfflineFrom: string
    note: string
  }
}

export type ForensicSinkWriteInput = Readonly<{
  path: string
  metaPath: string
  bytes: Buffer
  metaJson: string
  azureInputSha256: string
}>

export type ForensicSinkWriteResult = Readonly<{
  ok: true
  sinkKind: ForensicArtifactReference["sinkKind"]
}> | Readonly<{
  ok: false
  errorCode: string
}>

export type AzureForensicSink = {
  write(input: ForensicSinkWriteInput): Promise<ForensicSinkWriteResult> | ForensicSinkWriteResult
}

export type RecordAzureForensicPackageInput = Readonly<{
  azureInputBuffer: Buffer
  /** SHA precomputado opcional; se verifica contra bytes. */
  azureInputSha256?: string
  analyzeResult: unknown
  /** Marks en el mismo orden/coords que recibe N1 (parseMarks, pre-affine). */
  marks: ReadonlyArray<{
    state: "selected" | "unselected"
    polygonNorm: ReadonlyArray<{ x: number; y: number }>
    confidence: number
  }>
  omrPreN1: ReadonlyArray<Record<string, unknown>>
  n1Result?: VisualBlankRescuePageResult | null
  diagnosticContext?: AzureLayoutOmrDiagnosticContext
  layout?: Partial<ForensicLayoutContext> & {
    expectedQuestionCount?: number
    expectedOptionCount?: number
    variant?: string
    templateKey?: string
    canonicalWidth?: number
    canonicalHeight?: number
  }
  transform?: ForensicTransformMeta
}>

type EmitFn = (line: string) => void

let emitFn: EmitFn = (line) => {
  console.log(line)
}

/**
 * Sink activo: tests inyectan memoria; runtime usa resolveDefaultForensicSink().
 * Sin LIBELIA_AZURE_FORENSIC_SINK_DIR → fail-soft sink_not_configured (no finge persistencia).
 */
let activeSink: AzureForensicSink | null = null
let sinkOverrideForTests: AzureForensicSink | null = null

export const AZURE_FORENSIC_SINK_DIR_ENV = "LIBELIA_AZURE_FORENSIC_SINK_DIR" as const

/** Solo el valor exacto "1" habilita. Ausencia / "" / "0" / "true" → OFF. */
export function isAzureForensicBufferCaptureEnabled(): boolean {
  try {
    return process.env[AZURE_FORENSIC_BUFFER_CAPTURE_FLAG] === "1"
  } catch {
    return false
  }
}

/**
 * eventKey batch:
 *   diagnosticRunId|evaluationBatchId|batchStudentIndex|pageIndex|attempt
 * eventKey direct:
 *   diagnosticRunId|direct|pageIndex|attempt
 */
export function tryBuildForensicEventKey(
  ctx: AzureLayoutOmrDiagnosticContext | null | undefined,
): { eventKey: string; sourceMode: ForensicSourceMode } | null {
  try {
    if (ctx == null || typeof ctx !== "object") return null
    const diagnosticRunId = readBoundedPlainId(ctx.diagnosticRunId)
    if (!diagnosticRunId) return null
    if (!isNonNegInt(ctx.pageIndex) || !isNonNegInt(ctx.attempt)) return null

    const evaluationBatchId = readBoundedPlainId(ctx.evaluationBatchId)
    if (evaluationBatchId) {
      if (!isNonNegInt(ctx.batchStudentIndex)) return null
      return {
        sourceMode: "batch",
        eventKey: `${diagnosticRunId}|${evaluationBatchId}|${ctx.batchStudentIndex}|${ctx.pageIndex}|${ctx.attempt}`,
      }
    }
    return {
      sourceMode: "direct",
      eventKey: `${diagnosticRunId}|direct|${ctx.pageIndex}|${ctx.attempt}`,
    }
  } catch {
    return null
  }
}

/**
 * Path determinístico sin PII:
 * diag/azure-input/{diagnosticRunId}/{studentOrDirect}/{pageIndex}/{attempt}/{sha256}.png
 */
export function buildForensicArtifactPath(params: {
  diagnosticRunId: string
  sourceMode: ForensicSourceMode
  batchStudentIndex?: number
  pageIndex: number
  attempt: number
  azureInputSha256: string
}): { path: string; metaPath: string } | null {
  try {
    const runId = readBoundedPlainId(params.diagnosticRunId)
    const sha = readSha256Hex(params.azureInputSha256)
    if (!runId || !sha) return null
    if (!isNonNegInt(params.pageIndex) || !isNonNegInt(params.attempt)) return null

    const studentSeg =
      params.sourceMode === "batch" && isNonNegInt(params.batchStudentIndex)
        ? String(params.batchStudentIndex)
        : "direct"

    const path =
      `diag/azure-input/${runId}/${studentSeg}/${params.pageIndex}/${params.attempt}/${sha}.png`
    if (pathContainsForbiddenPii(path)) return null
    return { path, metaPath: `${path}.meta.json` }
  } catch {
    return null
  }
}

export function pathContainsForbiddenPii(path: string): boolean {
  try {
    if (typeof path !== "string" || path.length === 0) return true
    if (path.includes("..")) return true
    if (path.includes("@")) return true
    if (/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/.test(path)) return true
    if (/teacher[_-]?key/i.test(path)) return true
    if (/[A-Za-z]+\s+[A-Za-z]+/.test(path)) return true
    if (/email|rut|nombre|student_name|ocr/i.test(path)) return true
    return false
  } catch {
    return true
  }
}

/**
 * Mapping Q→letra→polygon compatible con N1 (paneles + sort X).
 * Observación diagnóstica; no altera OMR funcional.
 */
export function buildN1CompatibleQuestionLetterPolygons(params: {
  analyzeResult: unknown
  marks: RecordAzureForensicPackageInput["marks"]
  expectedQuestionCount: number
  expectedOptionCount: number
  variant: string
}): ForensicQuestionLetterPolygon[] {
  try {
    const flat = flattenAzureSelectionMarks(params.analyzeResult)
    const K = Math.max(2, Math.min(8, Math.round(params.expectedOptionCount)))
    const Q = Math.max(1, Math.round(params.expectedQuestionCount))
    const association = associateMarksLikeN1({
      marks: params.marks,
      expectedQuestionCount: Q,
      expectedOptionCount: K,
      variant: params.variant,
    })

    const out: ForensicQuestionLetterPolygon[] = []
    for (const [questionNumber, opts] of association) {
      for (const opt of opts) {
        const flatMark = flat[opt.markIndex]
        if (!flatMark) continue
        const row: ForensicQuestionLetterPolygon = {
          questionNumber,
          letter: opt.letter,
          selectionMarkIndex: opt.markIndex,
          polygon: flatMark.polygon,
          azureState: flatMark.state,
        }
        if (flatMark.confidence !== undefined) {
          row.azureConfidence = flatMark.confidence
        }
        out.push(row)
      }
    }
    return out
  } catch {
    return []
  }
}

export function sanitizeOmrPreN1(
  rows: ReadonlyArray<Record<string, unknown>>,
): ForensicOmrPreN1Row[] {
  try {
    const out: ForensicOmrPreN1Row[] = []
    const limit = Math.min(rows.length, MAX_QUESTIONS)
    for (let i = 0; i < limit; i++) {
      const row = rows[i]
      if (!row || typeof row !== "object") continue
      const qn = row.questionNumber
      const ans = row.selectedAnswer
      if (typeof qn !== "number" || !Number.isInteger(qn) || qn < 1) continue
      if (typeof ans !== "string") continue
      const selectedAnswer = normalizeOmrAnswer(ans)
      if (!selectedAnswer) continue
      const entry: ForensicOmrPreN1Row = { questionNumber: qn, selectedAnswer }
      if (Array.isArray(row.assignedDetectionIndices)) {
        const idxs = row.assignedDetectionIndices.filter(
          (x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0,
        )
        entry.assignedDetectionIndices = idxs
      }
      if (row.inferredBlank === true) entry.inferredBlank = true
      if (typeof row.source === "string" && row.source.length <= 64) {
        entry.source = row.source
      }
      if (
        row.confidencesByColumn &&
        typeof row.confidencesByColumn === "object" &&
        !Array.isArray(row.confidencesByColumn)
      ) {
        const conf: Record<string, number> = {}
        for (const [k, v] of Object.entries(row.confidencesByColumn as Record<string, unknown>)) {
          if (/^[A-H]$/.test(k) && typeof v === "number" && Number.isFinite(v)) {
            conf[k] = v
          }
        }
        if (Object.keys(conf).length > 0) entry.confidenceRelevant = conf
      }
      out.push(entry)
    }
    return out
  } catch {
    return []
  }
}

export function extractN1Correlated(
  n1Result: VisualBlankRescuePageResult | null | undefined,
): ForensicN1Correlated {
  try {
    if (!n1Result || typeof n1Result !== "object") {
      return {
        available: false,
        offlineDerivable: true,
      }
    }
    const decisions: ForensicN1DecisionDiag[] = []
    for (const d of n1Result.decisions ?? []) {
      const base: ForensicN1DecisionDiag = {
        questionNumber: d.questionNumber,
        action: d.action,
        reason: d.reason,
      }
      if (d.action === "rescued_answer") {
        base.bestLetter = d.letter
        base.secondLetter = d.metrics.secondLetter
        base.marginDarkRatio = d.metrics.marginDarkRatio
        base.marginContrast = d.metrics.marginContrast
        base.metricsABCD = d.metrics.perOption.map((o) => ({
          letter: o.letter,
          darkRatio: o.darkRatio,
          contrast: o.contrast,
          meanGray: o.meanGray,
          localBackground: o.localBackground,
          azureState: o.azureState,
          azureConfidence: o.azureConfidence,
        }))
        const best = d.metrics.perOption.find((o) => o.letter === d.letter)
        const second =
          d.metrics.secondLetter != null
            ? d.metrics.perOption.find((o) => o.letter === d.metrics.secondLetter)
            : undefined
        if (best) {
          base.bestDarkRatio = best.darkRatio
          base.bestContrast = best.contrast
        }
        if (second) {
          base.secondDarkRatio = second.darkRatio
          base.secondContrast = second.contrast
        }
      } else if (d.action === "abstain" && d.metrics) {
        base.bestLetter = d.metrics.bestLetter
        base.secondLetter = d.metrics.secondLetter
        base.marginDarkRatio = d.metrics.marginDarkRatio
        base.marginContrast = d.metrics.marginContrast
        base.metricsABCD = d.metrics.perOption.map((o) => ({
          letter: o.letter,
          darkRatio: o.darkRatio,
          contrast: o.contrast,
          meanGray: o.meanGray,
          localBackground: o.localBackground,
          azureState: o.azureState,
          azureConfidence: o.azureConfidence,
        }))
        const best = d.metrics.perOption.find((o) => o.letter === d.metrics!.bestLetter)
        const second =
          d.metrics.secondLetter != null
            ? d.metrics.perOption.find((o) => o.letter === d.metrics!.secondLetter)
            : undefined
        if (best) {
          base.bestDarkRatio = best.darkRatio
          base.bestContrast = best.contrast
        }
        if (second) {
          base.secondDarkRatio = second.darkRatio
          base.secondContrast = second.contrast
        }
      }
      decisions.push(base)
    }
    return {
      available: true,
      offlineDerivable: true,
      pageGatesPassed: n1Result.pageGatesPassed,
      pageAbstainReason: n1Result.pageAbstainReason,
      pageAction: n1Result.pageAction,
      selectionMarksTotal: n1Result.selectionMarksTotal,
      selectedCountAzure: n1Result.selectedCountAzure,
      blankRowCountBefore: n1Result.blankRowCountBefore,
      decisions,
    }
  } catch {
    return { available: false, offlineDerivable: true }
  }
}

/**
 * Escribe bytes exactos + metadata. Fail-soft: nunca lanza.
 * Retorna artifactReference o null si OFF / fallo.
 */
export async function recordAzureForensicPackage(
  input: RecordAzureForensicPackageInput,
): Promise<ForensicArtifactReference | null> {
  try {
    if (!isAzureForensicBufferCaptureEnabled()) {
      return null
    }

    const keyInfo = tryBuildForensicEventKey(input.diagnosticContext)
    if (!keyInfo || !input.diagnosticContext) {
      emitFailSoft("missing_identity")
      return null
    }

    if (!Buffer.isBuffer(input.azureInputBuffer) || input.azureInputBuffer.length === 0) {
      emitFailSoft("empty_buffer")
      return null
    }

    const shaFromBytes = computeAzureInputSha256(input.azureInputBuffer)
    if (!shaFromBytes) {
      emitFailSoft("sha_compute_failed")
      return null
    }
    if (input.azureInputSha256) {
      const provided = readSha256Hex(input.azureInputSha256)
      if (!provided || provided !== shaFromBytes) {
        emitFailSoft("sha_mismatch")
        return null
      }
    }

    const paths = buildForensicArtifactPath({
      diagnosticRunId: input.diagnosticContext.diagnosticRunId!,
      sourceMode: keyInfo.sourceMode,
      batchStudentIndex: input.diagnosticContext.batchStudentIndex,
      pageIndex: input.diagnosticContext.pageIndex!,
      attempt: input.diagnosticContext.attempt!,
      azureInputSha256: shaFromBytes,
    })
    if (!paths) {
      emitFailSoft("path_rejected")
      return null
    }

    const expectedQ =
      typeof input.layout?.expectedQuestionCount === "number" &&
      input.layout.expectedQuestionCount > 0
        ? input.layout.expectedQuestionCount
        : Math.max(1, input.omrPreN1.length)
    const expectedOpt =
      typeof input.layout?.expectedOptionCount === "number" &&
      input.layout.expectedOptionCount >= 2
        ? input.layout.expectedOptionCount
        : 4
    const variant = typeof input.layout?.variant === "string"
      ? input.layout.variant
      : "odd_even_dual_column"

    const pageDims = readFirstPageDims(input.analyzeResult)
    const questionLetterPolygons = buildN1CompatibleQuestionLetterPolygons({
      analyzeResult: input.analyzeResult,
      marks: input.marks,
      expectedQuestionCount: expectedQ,
      expectedOptionCount: expectedOpt,
      variant,
    })
    const omrPreN1 = sanitizeOmrPreN1(input.omrPreN1)
    const n1 = extractN1Correlated(input.n1Result)

    const artifactReference: ForensicArtifactReference = {
      path: paths.path,
      metaPath: paths.metaPath,
      sinkKind: "memory",
      azureInputSha256: shaFromBytes,
      byteLength: input.azureInputBuffer.byteLength,
      mimeType: AZURE_FORENSIC_EXPECTED_MIME,
      publicUrl: false,
    }

    const transform: ForensicTransformMeta = {
      ...(input.transform ?? {}),
      attempt: input.diagnosticContext.attempt,
      width: input.transform?.width ?? pageDims?.width,
      height: input.transform?.height ?? pageDims?.height,
      unit: input.transform?.unit ?? pageDims?.unit,
    }

    const pageResult: ForensicPageResultMeta = {
      selectionMarksTotal: n1.selectionMarksTotal,
      selectedCountAzure: n1.selectedCountAzure,
      blankRowCountBefore: n1.blankRowCountBefore,
      pageGatesPassed: n1.pageGatesPassed,
      pageAbstainReason: n1.pageAbstainReason,
    }

    const payload: AzureForensicPackagePayload = {
      schemaVersion: AZURE_FORENSIC_PACKAGE_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      eventKey: keyInfo.eventKey,
      sourceMode: keyInfo.sourceMode,
      diagnosticRunId: readBoundedPlainId(input.diagnosticContext.diagnosticRunId)!,
      pageIndex: input.diagnosticContext.pageIndex!,
      attempt: input.diagnosticContext.attempt!,
      azureInputSha256: shaFromBytes,
      byteLength: input.azureInputBuffer.byteLength,
      mimeType: AZURE_FORENSIC_EXPECTED_MIME,
      artifactReference,
      questionLetterPolygons,
      omrPreN1,
      n1,
      layout: {
        engine: "azure_layout_family",
        layoutMode: "standard",
        expectedQuestionCount: expectedQ,
        expectedOptionCount: expectedOpt,
        variant,
        templateKey: input.layout?.templateKey,
        canonicalWidth: input.layout?.canonicalWidth,
        canonicalHeight: input.layout?.canonicalHeight,
      },
      transform,
      pageResult,
      retention: {
        maxDays: AZURE_FORENSIC_RETENTION_MAX_DAYS,
        suggestedBucket: AZURE_FORENSIC_SUGGESTED_BUCKET,
        note:
          "Identificar por path/sha; descargar; verificar sha256(bytes)===azureInputSha256; eliminar ≤7d. Sin cron automático en esta fase.",
      },
      sourceModeSemantics: {
        batchNote: "batch ≠ necesariamente QR",
        directNote: "direct ≠ necesariamente PC",
        captureChannel: null,
      },
      geometryN1: {
        reproducibleOfflineFrom:
          "artifactBytes + questionLetterPolygons.polygon + page width/height/unit + código N1 versionado (ROI/radio/muestreo)",
        note: "No se duplica el algoritmo N1 en el payload.",
      },
    }

    if (keyInfo.sourceMode === "batch") {
      payload.evaluationBatchId = readBoundedPlainId(input.diagnosticContext.evaluationBatchId)
      payload.batchStudentIndex = input.diagnosticContext.batchStudentIndex
    }

    // Privacidad: rechazar si el JSON accidentalmente incluye claves prohibidas.
    let metaJson: string
    try {
      metaJson = JSON.stringify(payload)
    } catch {
      emitFailSoft("serialization_failed")
      return null
    }
    if (metaContainsForbidden(metaJson)) {
      emitFailSoft("forbidden_fields")
      return null
    }

    // Copia defensiva de bytes (exactos) para el sink; no retiene referencia mutable del caller.
    const bytesCopy = Buffer.from(input.azureInputBuffer)

    const sink = resolveActiveForensicSink()
    if (!sink) {
      emitFailSoft("sink_not_configured")
      return null
    }

    let writeResult: ForensicSinkWriteResult
    try {
      writeResult = await Promise.resolve(
        sink.write({
          path: paths.path,
          metaPath: paths.metaPath,
          bytes: bytesCopy,
          metaJson,
          azureInputSha256: shaFromBytes,
        }),
      )
    } catch {
      emitFailSoft("sink_threw")
      return null
    }

    if (!writeResult.ok) {
      emitFailSoft(writeResult.errorCode || "sink_failed")
      return null
    }

    artifactReference.sinkKind = writeResult.sinkKind

    try {
      // Log compacto SIN bytes / SIN base64.
      emitFn(
        `${AZURE_FORENSIC_LOG_PREFIX} ${JSON.stringify({
          eventKey: keyInfo.eventKey,
          azureInputSha256: shaFromBytes,
          byteLength: bytesCopy.byteLength,
          path: paths.path,
          questionLetterPolygons: questionLetterPolygons.length,
          omrPreN1: omrPreN1.length,
          n1Available: n1.available,
        })}`,
      )
    } catch {
      // fail-soft: captura ya escrita
    }

    return artifactReference
  } catch {
    try {
      emitFailSoft("unexpected")
    } catch {
      // invisible
    }
    return null
  }
}

function emitFailSoft(errorCode: string): void {
  try {
    emitFn(`${AZURE_FORENSIC_FAIL_LOG_PREFIX} ${JSON.stringify({ errorCode })}`)
  } catch {
    // invisible
  }
}

function metaContainsForbidden(json: string): boolean {
  const lower = json.toLowerCase()
  if (lower.includes("teacher_key")) return true
  if (lower.includes("\"scoring\"")) return true
  if (lower.includes("correctanswer")) return true
  if (lower.includes("answerkey")) return true
  if (lower.includes("data:image")) return true
  if (lower.includes("https://")) return true
  if (lower.includes("http://")) return true
  return false
}

type FlatAzureMark = {
  index: number
  state: "selected" | "unselected"
  confidence?: number
  polygon: number[]
}

function flattenAzureSelectionMarks(analyzeResult: unknown): FlatAzureMark[] {
  const out: FlatAzureMark[] = []
  try {
    if (!analyzeResult || typeof analyzeResult !== "object") return out
    const pages = (analyzeResult as { pages?: unknown }).pages
    if (!Array.isArray(pages)) return out
    let index = 0
    for (const page of pages) {
      if (!page || typeof page !== "object") continue
      const marks = (page as { selectionMarks?: unknown }).selectionMarks
      if (!Array.isArray(marks)) continue
      for (const sm of marks) {
        if (out.length >= MAX_MARKS) return out
        if (!sm || typeof sm !== "object") continue
        const poly = readNumericArray((sm as { polygon?: unknown }).polygon)
        if (!poly || poly.length < 4) {
          // parseMarks también salta polygons cortos → no avanzar índice de marks N1
          continue
        }
        const st = String((sm as { state?: unknown }).state ?? "").toLowerCase()
        const state: "selected" | "unselected" =
          st === "selected" ? "selected" : "unselected"
        const entry: FlatAzureMark = { index, state, polygon: poly }
        const conf = (sm as { confidence?: unknown }).confidence
        if (typeof conf === "number" && Number.isFinite(conf)) {
          entry.confidence = conf
        }
        out.push(entry)
        index += 1
      }
    }
  } catch {
    return out
  }
  return out
}

function associateMarksLikeN1(params: {
  marks: RecordAzureForensicPackageInput["marks"]
  expectedQuestionCount: number
  expectedOptionCount: number
  variant: string
}): Map<number, Array<{ letter: string; markIndex: number }>> {
  const out = new Map<number, Array<{ letter: string; markIndex: number }>>()
  const K = params.expectedOptionCount
  const Q = params.expectedQuestionCount

  type Internal = { markIndex: number; centerX: number; centerY: number }
  const internals: Internal[] = []
  for (let i = 0; i < params.marks.length; i++) {
    const m = params.marks[i]!
    const c = markCenter(m.polygonNorm)
    if (!c) continue
    internals.push({ markIndex: i, centerX: c.centerX, centerY: c.centerY })
  }

  const pushRow = (q: number, rowMarks: Internal[]): void => {
    const sorted = [...rowMarks].sort((a, b) => a.centerX - b.centerX)
    const opts: Array<{ letter: string; markIndex: number }> = []
    for (let i = 0; i < sorted.length && i < K; i++) {
      const letter = LETTERS[i]
      if (!letter) break
      opts.push({ letter, markIndex: sorted[i]!.markIndex })
    }
    out.set(q, opts)
  }

  if (params.variant === "single_column") {
    const sorted = [...internals].sort((a, b) => a.centerY - b.centerY)
    const threshold = 0.018
    const rows: Internal[][] = []
    for (const m of sorted) {
      let placed = false
      for (const row of rows) {
        if (Math.abs(m.centerY - row[0]!.centerY) < threshold) {
          row.push(m)
          placed = true
          break
        }
      }
      if (!placed) rows.push([m])
    }
    for (let i = 0; i < rows.length && i < Q; i++) {
      pushRow(i + 1, rows[i]!)
    }
    return out
  }

  const splitX = 0.5
  const half = Math.ceil(Q / 2)
  const leftCount =
    params.variant === "sequential_dual_column" ? half : Math.ceil(Q / 2)
  const rightCount = Q - leftCount
  const leftItems = internals.filter((m) => m.centerX <= splitX)
  const rightItems = internals.filter((m) => m.centerX > splitX)

  const assignPanel = (
    panelItems: Internal[],
    panelQuestionCount: number,
    qResolver: (rowIndex: number) => number,
  ): void => {
    if (panelQuestionCount <= 0 || panelItems.length === 0) return
    const ys = panelItems.map((m) => m.centerY)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const dy = Math.max(1e-6, maxY - minY)
    const buckets: Internal[][] = Array.from({ length: panelQuestionCount }, () => [])
    for (const m of panelItems) {
      const rowNorm = (m.centerY - minY) / dy
      const rowIdx = Math.max(
        0,
        Math.min(panelQuestionCount - 1, Math.round(rowNorm * (panelQuestionCount - 1))),
      )
      buckets[rowIdx]!.push(m)
    }
    for (let rowIdx = 0; rowIdx < panelQuestionCount; rowIdx++) {
      pushRow(qResolver(rowIdx), buckets[rowIdx]!)
    }
  }

  if (params.variant === "sequential_dual_column") {
    assignPanel(leftItems, leftCount, (rowIdx) => rowIdx + 1)
    assignPanel(rightItems, rightCount, (rowIdx) => leftCount + rowIdx + 1)
  } else {
    assignPanel(leftItems, leftCount, (rowIdx) => rowIdx * 2 + 1)
    assignPanel(rightItems, rightCount, (rowIdx) => (rowIdx + 1) * 2)
  }

  return out
}

function markCenter(
  poly: ReadonlyArray<{ x: number; y: number }> | undefined,
): { centerX: number; centerY: number } | null {
  if (!poly || poly.length < 2) return null
  let sx = 0
  let sy = 0
  let n = 0
  for (const p of poly) {
    if (
      typeof p?.x !== "number" ||
      typeof p?.y !== "number" ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    ) {
      return null
    }
    sx += p.x
    sy += p.y
    n++
  }
  if (n < 2) return null
  return { centerX: sx / n, centerY: sy / n }
}

function readFirstPageDims(
  analyzeResult: unknown,
): { width?: number; height?: number; unit?: string } | null {
  try {
    if (!analyzeResult || typeof analyzeResult !== "object") return null
    const pages = (analyzeResult as { pages?: unknown }).pages
    if (!Array.isArray(pages) || pages.length === 0) return null
    const page = pages[0]
    if (!page || typeof page !== "object") return null
    const p = page as Record<string, unknown>
    const out: { width?: number; height?: number; unit?: string } = {}
    if (typeof p.width === "number" && Number.isFinite(p.width)) out.width = p.width
    if (typeof p.height === "number" && Number.isFinite(p.height)) out.height = p.height
    if (typeof p.unit === "string" && /^[a-zA-Z0-9_-]+$/.test(p.unit.trim())) {
      out.unit = p.unit.trim()
    }
    return out
  } catch {
    return null
  }
}

function normalizeOmrAnswer(value: string): string | undefined {
  const t = value.trim().toUpperCase()
  if (t === "BLANK" || t === "MULTIPLE") return t
  if (/^[A-H]$/.test(t)) return t
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

function readSha256Hex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const t = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(t)) return undefined
  return t
}

function readBoundedPlainId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LEN) return undefined
  if (!/^[a-zA-Z0-9_.:-]+$/.test(trimmed)) return undefined
  return trimmed
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && Number.isFinite(v) && v >= 0
}

/** Sink en memoria para tests / local. No filesystem remoto. */
export function createInMemoryForensicSink(): AzureForensicSink & {
  store: Map<string, Buffer>
  meta: Map<string, string>
  clear: () => void
  failNext?: boolean
} {
  const store = new Map<string, Buffer>()
  const meta = new Map<string, string>()
  const sink: AzureForensicSink & {
    store: Map<string, Buffer>
    meta: Map<string, string>
    clear: () => void
    failNext?: boolean
  } = {
    store,
    meta,
    clear: () => {
      store.clear()
      meta.clear()
      sink.failNext = false
    },
    failNext: false,
    write(input) {
      if (sink.failNext) {
        sink.failNext = false
        return { ok: false, errorCode: "sink_forced_failure" }
      }
      const verify = createHash("sha256").update(input.bytes).digest("hex")
      if (verify !== input.azureInputSha256) {
        return { ok: false, errorCode: "sink_sha_mismatch" }
      }
      // Reevaluación / otro runId: path distinto → no sobrescribe identity distinta.
      store.set(input.path, Buffer.from(input.bytes))
      meta.set(input.metaPath, input.metaJson)
      return { ok: true, sinkKind: "memory" }
    },
  }
  return sink
}

/**
 * Sink filesystem local privado (diagnóstico).
 * Solo si LIBELIA_AZURE_FORENSIC_SINK_DIR apunta a un directorio absoluto.
 * NO crea bucket remoto. Paths relativos al root configurado.
 */
export function createLocalFsForensicSink(rootDir: string): AzureForensicSink {
  const root = path.resolve(rootDir)
  return {
    write(input) {
      try {
        if (input.path.includes("..") || input.metaPath.includes("..")) {
          return { ok: false, errorCode: "path_traversal" }
        }
        const absFile = path.join(root, input.path)
        const absMeta = path.join(root, input.metaPath)
        if (!absFile.startsWith(root) || !absMeta.startsWith(root)) {
          return { ok: false, errorCode: "path_outside_root" }
        }
        const verify = createHash("sha256").update(input.bytes).digest("hex")
        if (verify !== input.azureInputSha256) {
          return { ok: false, errorCode: "sink_sha_mismatch" }
        }
        fs.mkdirSync(path.dirname(absFile), { recursive: true })
        fs.writeFileSync(absFile, input.bytes)
        fs.writeFileSync(absMeta, input.metaJson, "utf8")
        return { ok: true, sinkKind: "local_fs" }
      } catch {
        return { ok: false, errorCode: "local_fs_write_failed" }
      }
    },
  }
}

function resolveActiveForensicSink(): AzureForensicSink | null {
  if (sinkOverrideForTests) return sinkOverrideForTests
  if (activeSink) return activeSink
  try {
    const dir = process.env[AZURE_FORENSIC_SINK_DIR_ENV]
    if (typeof dir === "string" && dir.trim().length > 0) {
      // Solo paths absolutos (evitar escribir relativo accidental en CWD de prod).
      const trimmed = dir.trim()
      if (
        trimmed.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(trimmed)
      ) {
        activeSink = createLocalFsForensicSink(trimmed)
        return activeSink
      }
    }
  } catch {
    return null
  }
  return null
}

/** Solo tests. */
export function __setAzureForensicSinkForTests(sink: AzureForensicSink | null): void {
  sinkOverrideForTests = sink
  activeSink = null
}

/** Solo tests. */
export function __setAzureForensicEmitForTests(fn: EmitFn | null): void {
  emitFn = fn ?? ((line) => console.log(line))
}

/** Solo tests. */
export function __getActiveForensicSinkForTests(): AzureForensicSink | null {
  return resolveActiveForensicSink()
}
