/**
 * Pipeline Row Tracing — telemetría de identidad física por fila.
 *
 * Cada fila cerrada recibe un traceId estable desde el inicio del pipeline.
 * Cada etapa que modifique canonicalId, physicalIndex, selectedAnswer,
 * assignedDetectionIndices o decisionSource debe registrar un snapshot
 * antes/después usando recordMutation().
 *
 * Reversible: INTERLEAVED_PIPELINE_ROW_TRACING=0 desactiva completamente.
 * No altera comportamiento del pipeline; solo añade metadatos observacionales.
 * Aislado dentro de omr-interleaved/.
 */

// ─────── Feature flag ────────────────────────────────────────────────────────

export function isInterleavedPipelineRowTracingEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_PIPELINE_ROW_TRACING ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

// ─────── Types ───────────────────────────────────────────────────────────────

export type RowMutationRecord = {
  stage: string
  canonicalIdBefore: string | null
  canonicalIdAfter: string | null
  physicalIndexBefore: number | null
  physicalIndexAfter: number | null
  questionNumberBefore: number | null
  questionNumberAfter: number | null
  selectedAnswerBefore: string | null
  selectedAnswerAfter: string | null
  assignedDetectionIndicesBefore: number[]
  assignedDetectionIndicesAfter: number[]
  decisionSourceBefore: string | null
  decisionSourceAfter: string | null
  mutationReason: string
  rowCenterYAtMutation: number | null
  panelIndexAtMutation: number | null
}

export type RowTraceRecord = {
  traceId: string
  originalDetectionIndices: number[]
  originalSelectedMarkX: number | null
  originalSelectedMarkY: number | null
  originalRowCenterY: number | null
  originalPanelIndex: number | null
  originalCanonicalId: string | null
  originalPhysicalIndex: number | null
  originalQuestionNumber: number | null
  originalSelectedAnswer: string | null
  originalDecisionSource: string | null
  traceHistory: RowMutationRecord[]
  finalCanonicalId: string | null
  finalPhysicalIndex: number | null
  finalQuestionNumber: number | null
  finalSelectedAnswer: string | null
  finalAssignedDetectionIndices: number[]
  finalDecisionSource: string | null
  identityBroken: boolean
  identityBrokenAtStage: string | null
  answerSubstitutedWithoutPhysicalEvidence: boolean
  answerSubstitutionStage: string | null
}

// ─────── Trace session ───────────────────────────────────────────────────────

let traceCounter = 0

function nextTraceId(): string {
  traceCounter++
  return `row-trace-${traceCounter}-${Date.now()}`
}

export function resetTraceCounter(): void {
  traceCounter = 0
}

function extractDetectionIndices(row: Record<string, unknown>): number[] {
  const v = row.assignedDetectionIndices
  if (Array.isArray(v)) return v.filter((x): x is number => typeof x === "number")
  return []
}

function extractString(row: Record<string, unknown>, key: string): string | null {
  const v = row[key]
  if (typeof v === "string" && v.length > 0) return v
  return null
}

function extractNumber(row: Record<string, unknown>, key: string): number | null {
  const v = row[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  return null
}

function extractDecisionSource(row: Record<string, unknown>): string | null {
  const amb = row.interleavedAmbiguityTelemetry as Record<string, unknown> | undefined
  if (amb && typeof amb.decisionSource === "string") return amb.decisionSource
  return null
}

// ─────── Public API ──────────────────────────────────────────────────────────

/**
 * Stamp initial trace onto every row emitted from the first stage (mapInterleavedByVariant).
 * Call ONCE right after mapInterleavedByVariant returns.
 */
export function stampInitialTraces(
  rows: Array<Record<string, unknown>>,
  stage: string = "initial_decode",
): void {
  if (!isInterleavedPipelineRowTracingEnabled()) return
  for (const row of rows) {
    if (row.__rowTrace) continue
    const trace: RowTraceRecord = {
      traceId: nextTraceId(),
      originalDetectionIndices: extractDetectionIndices(row),
      originalSelectedMarkX: extractNumber(row, "rowCenterX"),
      originalSelectedMarkY: extractNumber(row, "rowCenterY"),
      originalRowCenterY: extractNumber(row, "rowCenterY"),
      originalPanelIndex: extractNumber(row, "panelIndex"),
      originalCanonicalId: extractString(row, "canonicalId"),
      originalPhysicalIndex: extractNumber(row, "physicalIndex"),
      originalQuestionNumber: extractNumber(row, "questionNumber"),
      originalSelectedAnswer: extractString(row, "selectedAnswer"),
      originalDecisionSource: extractDecisionSource(row),
      traceHistory: [],
      finalCanonicalId: null,
      finalPhysicalIndex: null,
      finalQuestionNumber: null,
      finalSelectedAnswer: null,
      finalAssignedDetectionIndices: [],
      finalDecisionSource: null,
      identityBroken: false,
      identityBrokenAtStage: null,
      answerSubstitutedWithoutPhysicalEvidence: false,
      answerSubstitutionStage: null,
    }
    row.__rowTrace = trace
  }
}

/**
 * Record a mutation on a single row. Call BEFORE overwriting fields.
 * The caller provides 'after' values; this function reads 'before' from the row.
 */
export function recordMutation(
  row: Record<string, unknown>,
  after: {
    canonicalId?: string | null
    physicalIndex?: number | null
    questionNumber?: number | null
    selectedAnswer?: string | null
    assignedDetectionIndices?: number[]
    decisionSource?: string | null
  },
  stage: string,
  mutationReason: string,
): void {
  if (!isInterleavedPipelineRowTracingEnabled()) return
  const trace = row.__rowTrace as RowTraceRecord | undefined
  if (!trace) return

  const before: RowMutationRecord = {
    stage,
    canonicalIdBefore: extractString(row, "canonicalId"),
    canonicalIdAfter: after.canonicalId !== undefined ? after.canonicalId : extractString(row, "canonicalId"),
    physicalIndexBefore: extractNumber(row, "physicalIndex"),
    physicalIndexAfter: after.physicalIndex !== undefined ? after.physicalIndex : extractNumber(row, "physicalIndex"),
    questionNumberBefore: extractNumber(row, "questionNumber"),
    questionNumberAfter: after.questionNumber !== undefined ? after.questionNumber : extractNumber(row, "questionNumber"),
    selectedAnswerBefore: extractString(row, "selectedAnswer"),
    selectedAnswerAfter: after.selectedAnswer !== undefined ? after.selectedAnswer : extractString(row, "selectedAnswer"),
    assignedDetectionIndicesBefore: extractDetectionIndices(row),
    assignedDetectionIndicesAfter: after.assignedDetectionIndices !== undefined
      ? after.assignedDetectionIndices
      : extractDetectionIndices(row),
    decisionSourceBefore: extractDecisionSource(row),
    decisionSourceAfter: after.decisionSource !== undefined ? after.decisionSource : extractDecisionSource(row),
    mutationReason,
    rowCenterYAtMutation: extractNumber(row, "rowCenterY"),
    panelIndexAtMutation: extractNumber(row, "panelIndex"),
  }
  trace.traceHistory.push(before)

  // Detect identity breakage: canonicalId changed
  if (
    before.canonicalIdBefore != null &&
    before.canonicalIdAfter != null &&
    before.canonicalIdBefore !== before.canonicalIdAfter &&
    !trace.identityBroken
  ) {
    trace.identityBroken = true
    trace.identityBrokenAtStage = stage
  }

  // Detect answer substitution without physical evidence
  if (
    before.selectedAnswerBefore !== before.selectedAnswerAfter &&
    before.selectedAnswerAfter != null &&
    before.selectedAnswerAfter !== "BLANK" &&
    before.assignedDetectionIndicesAfter.length === 0 &&
    !trace.answerSubstitutedWithoutPhysicalEvidence
  ) {
    trace.answerSubstitutedWithoutPhysicalEvidence = true
    trace.answerSubstitutionStage = stage
  }
}

/**
 * Transfer trace from an old row object to a new row object (spread creates new obj).
 * Use when doing { ...oldRow, ...newFields }.
 */
export function transferTrace(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  if (!isInterleavedPipelineRowTracingEnabled()) return
  if (source.__rowTrace && !target.__rowTrace) {
    target.__rowTrace = source.__rowTrace
  }
}

/**
 * Batch-record mutations when an entire stage replaces perQuestion array.
 * Compares old vs new arrays by questionNumber or array index.
 */
export function recordBatchMutation(
  oldRows: Array<Record<string, unknown>>,
  newRows: Array<Record<string, unknown>>,
  stage: string,
  mutationReason: string,
): void {
  if (!isInterleavedPipelineRowTracingEnabled()) return

  const oldByQn = new Map<number, Record<string, unknown>>()
  for (const r of oldRows) {
    const qn = extractNumber(r, "questionNumber")
    if (qn != null) oldByQn.set(qn, r)
  }

  for (let i = 0; i < newRows.length; i++) {
    const newRow = newRows[i]!
    const qn = extractNumber(newRow, "questionNumber")
    const oldRow = qn != null ? oldByQn.get(qn) : (i < oldRows.length ? oldRows[i] : undefined)

    if (oldRow) {
      // Transfer trace from old to new
      transferTrace(oldRow, newRow)

      // Check if anything actually changed
      const canonicalChanged = extractString(oldRow, "canonicalId") !== extractString(newRow, "canonicalId")
      const physicalChanged = extractNumber(oldRow, "physicalIndex") !== extractNumber(newRow, "physicalIndex")
      const questionChanged = extractNumber(oldRow, "questionNumber") !== extractNumber(newRow, "questionNumber")
      const answerChanged = extractString(oldRow, "selectedAnswer") !== extractString(newRow, "selectedAnswer")
      const oldIndices = extractDetectionIndices(oldRow)
      const newIndices = extractDetectionIndices(newRow)
      const indicesChanged = oldIndices.length !== newIndices.length ||
        oldIndices.some((v, j) => v !== newIndices[j])
      const decisionChanged = extractDecisionSource(oldRow) !== extractDecisionSource(newRow)

      if (canonicalChanged || physicalChanged || questionChanged || answerChanged || indicesChanged || decisionChanged) {
        recordMutation(newRow, {
          canonicalId: extractString(newRow, "canonicalId"),
          physicalIndex: extractNumber(newRow, "physicalIndex"),
          questionNumber: extractNumber(newRow, "questionNumber"),
          selectedAnswer: extractString(newRow, "selectedAnswer"),
          assignedDetectionIndices: newIndices,
          decisionSource: extractDecisionSource(newRow),
        }, stage, mutationReason)
      }
    } else {
      stampInitialTraces([newRow], stage)
    }
  }
}

/**
 * Finalize all traces: snapshot final state into the trace record.
 * Call at the very end before returning from the pipeline.
 */
export function finalizeTraces(rows: Array<Record<string, unknown>>): void {
  if (!isInterleavedPipelineRowTracingEnabled()) return
  for (const row of rows) {
    const trace = row.__rowTrace as RowTraceRecord | undefined
    if (!trace) continue
    trace.finalCanonicalId = extractString(row, "canonicalId")
    trace.finalPhysicalIndex = extractNumber(row, "physicalIndex")
    trace.finalQuestionNumber = extractNumber(row, "questionNumber")
    trace.finalSelectedAnswer = extractString(row, "selectedAnswer")
    trace.finalAssignedDetectionIndices = extractDetectionIndices(row)
    trace.finalDecisionSource = extractDecisionSource(row)
  }
}

/**
 * Extract all traces from rows for inclusion in the pipeline output.
 * Removes __rowTrace from each row to keep output clean.
 */
export function extractAndCleanTraces(rows: Array<Record<string, unknown>>): RowTraceRecord[] {
  if (!isInterleavedPipelineRowTracingEnabled()) return []
  const traces: RowTraceRecord[] = []
  for (const row of rows) {
    const trace = row.__rowTrace as RowTraceRecord | undefined
    if (trace) {
      traces.push(trace)
      delete row.__rowTrace
    }
  }
  return traces
}

/**
 * Summary diagnostics from traces: which rows had identity broken,
 * which had answer substituted without evidence, etc.
 */
export function buildTraceSummary(traces: RowTraceRecord[]): {
  totalRows: number
  rowsWithIdentityBroken: number
  firstIdentityBreakStage: string | null
  rowsWithAnswerSubstitutedWithoutEvidence: number
  firstAnswerSubstitutionStage: string | null
  stagesWithMutations: string[]
  mutationCountByStage: Record<string, number>
  rowsWithEmptyDetectionButNonBlankAnswer: Array<{
    traceId: string
    finalQuestionNumber: number | null
    finalSelectedAnswer: string | null
    finalDecisionSource: string | null
    answerSubstitutionStage: string | null
    traceHistoryLength: number
  }>
} {
  const mutationCountByStage: Record<string, number> = {}
  const stagesSet = new Set<string>()
  let rowsWithIdentityBroken = 0
  let firstIdentityBreakStage: string | null = null
  let rowsWithAnswerSubstitutedWithoutEvidence = 0
  let firstAnswerSubstitutionStage: string | null = null
  const suspicious: Array<{
    traceId: string
    finalQuestionNumber: number | null
    finalSelectedAnswer: string | null
    finalDecisionSource: string | null
    answerSubstitutionStage: string | null
    traceHistoryLength: number
  }> = []

  for (const trace of traces) {
    if (trace.identityBroken) {
      rowsWithIdentityBroken++
      if (!firstIdentityBreakStage) firstIdentityBreakStage = trace.identityBrokenAtStage
    }
    if (trace.answerSubstitutedWithoutPhysicalEvidence) {
      rowsWithAnswerSubstitutedWithoutEvidence++
      if (!firstAnswerSubstitutionStage) firstAnswerSubstitutionStage = trace.answerSubstitutionStage
    }
    for (const m of trace.traceHistory) {
      stagesSet.add(m.stage)
      mutationCountByStage[m.stage] = (mutationCountByStage[m.stage] ?? 0) + 1
    }
    if (
      trace.finalAssignedDetectionIndices.length === 0 &&
      trace.finalSelectedAnswer != null &&
      trace.finalSelectedAnswer !== "BLANK" &&
      trace.finalSelectedAnswer !== "SIN_RESPUESTA"
    ) {
      suspicious.push({
        traceId: trace.traceId,
        finalQuestionNumber: trace.finalQuestionNumber,
        finalSelectedAnswer: trace.finalSelectedAnswer,
        finalDecisionSource: trace.finalDecisionSource,
        answerSubstitutionStage: trace.answerSubstitutionStage,
        traceHistoryLength: trace.traceHistory.length,
      })
    }
  }

  const result = {
    totalRows: traces.length,
    rowsWithIdentityBroken,
    firstIdentityBreakStage,
    rowsWithAnswerSubstitutedWithoutEvidence,
    firstAnswerSubstitutionStage,
    stagesWithMutations: [...stagesSet],
    mutationCountByStage,
    rowsWithEmptyDetectionButNonBlankAnswer: suspicious,
  }
  return result
}
