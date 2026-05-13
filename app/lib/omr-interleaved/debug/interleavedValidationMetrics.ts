/**
 * Métricas y filas de validación para CLI de hojas reales (solo omr-interleaved/debug).
 */
import fs from "fs"
import path from "path"

export type EnvMap = Record<string, string>

export type InterleavedCaseSpec = {
  sourceExamId: string
  photoPath: string
  variant: string
  /** Clave estable para diff entre corridas; por defecto se deriva de los tres campos. */
  label?: string
}

export function loadEnvFile(filePath: string): EnvMap {
  const out: EnvMap = {}
  if (!fs.existsSync(filePath)) return out
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const idx = line.indexOf("=")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    out[key] = value
  }
  return out
}

export function loadEnvMerged(repoRoot: string): EnvMap {
  return {
    ...loadEnvFile(path.join(repoRoot, ".env.local")),
    ...loadEnvFile(path.join(repoRoot, ".env")),
    ...(process.env as EnvMap),
  }
}

export function selectedConfidence(row: any): number | null {
  const sel = String(row?.selectedAnswer ?? "BLANK").toUpperCase()
  const byCol = row?.confidencesByColumn ?? {}
  if (sel === "BLANK") return null
  const v = Number(byCol?.[sel])
  return Number.isFinite(v) ? v : null
}

export function computeSequentialPatternRatio(rows: Array<{ detected: string }>): {
  cycleRatio: number
  suspiciousWindows: number
} {
  const vals = rows.map((r) => r.detected.toUpperCase())
  const cycle = ["A", "B", "C", "D"]
  let matched = 0
  let counted = 0
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]
    if (v === "BLANK") continue
    counted++
    if (v === cycle[i % 4]) matched++
  }
  let suspiciousWindows = 0
  for (let i = 0; i + 7 < vals.length; i++) {
    let ok = 0
    let nonBlank = 0
    for (let j = 0; j < 8; j++) {
      const v = vals[i + j]
      if (v === "BLANK") continue
      nonBlank++
      if (v === cycle[(i + j) % 4]) ok++
    }
    if (nonBlank >= 6 && ok / nonBlank >= 0.8) suspiciousWindows++
  }
  return { cycleRatio: counted ? Number((matched / counted).toFixed(4)) : 0, suspiciousWindows }
}

export type ValidationTableRow = {
  q: number
  detected: string
  expected: string
  match: "match" | "mismatch"
  confidence: number | null
  ambiguous: boolean
}

export type CaseValidationMetrics = {
  totalQuestions: number
  totalMatch: number
  totalMismatch: number
  totalBLANKs: number
  pairsFormed: number
  orphanRatio: number | null
  cycleRatio: number
  suspiciousWindows: number
  repetitiveMismatchQuestions: number[]
  avgConfidence: number
  realAmbiguities: number
}

export type CaseValidationExtras = {
  ambiguityRejectedInsufficientMarginOrNonNeighbor: Array<{
    questionNumber: number
    explicitFinalNullificationReason: string
    selectedAnswer: string
    chosenBeforeNullify: unknown
  }>
}

export function caseKey(spec: InterleavedCaseSpec): string {
  return spec.label ?? `${spec.sourceExamId}|${spec.photoPath}|${spec.variant}`
}

export function extractValidationFromPipelineOutput(params: {
  out: any
  closedQuestionIds: string[]
  correctByQuestion: Map<number, string>
}): {
  metrics: CaseValidationMetrics
  rows: ValidationTableRow[]
  extras: CaseValidationExtras
} {
  const { out, closedQuestionIds, correctByQuestion } = params
  const perQuestion = Array.isArray(out?.perQuestion) ? out.perQuestion : []
  const gd = out?.interleavedDebugSnapshot?.geometryDiagnostics as Record<string, unknown> | undefined
  const qd = Array.isArray(gd?.questionDiagnostics) ? (gd.questionDiagnostics as any[]) : []
  const qa = Array.isArray(gd?.questionAssemblyDiagnostics) ? (gd.questionAssemblyDiagnostics as any[]) : []
  const qdByQ = new Map<number, any>()
  for (const q of qd) qdByQ.set(Number(q.questionNumber), q)

  const rows: ValidationTableRow[] = closedQuestionIds.map((cid) => {
    const q = Number(cid.slice(1))
    const detectedRow = perQuestion.find((x: any) => Number(x.questionNumber) === q) ?? null
    const detected = String(detectedRow?.selectedAnswer ?? "BLANK").toUpperCase()
    const expected = String(correctByQuestion.get(q) ?? "").toUpperCase() || "?"
    const conf = selectedConfidence(detectedRow)
    const diag = qdByQ.get(q)
    const ambiguous = Boolean(
      diag?.ambiguityResolutionTriggered ||
        String(diag?.candidateConflictReason ?? "").includes("AMBIGUOUS") ||
        String(diag?.blankReason ?? "").includes("AMBIGUOUS"),
    )
    return {
      q,
      detected,
      expected,
      match: detected === expected ? "match" : "mismatch",
      confidence: conf,
      ambiguous,
    }
  })

  const totalMatch = rows.filter((r) => r.match === "match").length
  const totalMismatch = rows.length - totalMatch
  const totalBLANKs = rows.filter((r) => r.detected === "BLANK").length
  const confValues = rows.map((r) => r.confidence).filter((v): v is number => v != null)
  const avgConfidence = confValues.length
    ? Number((confValues.reduce((a, b) => a + b, 0) / confValues.length).toFixed(4))
    : 0
  const realAmbiguities = rows.filter((r) => r.ambiguous).length
  const seqPattern = computeSequentialPatternRatio(rows)

  const snap = out?.interleavedDebugSnapshot as Record<string, unknown> | undefined
  const pairings = Array.isArray(snap?.pairings) ? (snap.pairings as Array<Record<string, unknown>>) : []
  const pairsFormed = pairings.filter((p) => p.leftPresent && p.rightPresent).length
  const tpt = snap?.targetedPhysicalTraceReport as Record<string, unknown> | undefined
  const tiering = tpt?.tieringPartialCollapse as Record<string, unknown> | undefined
  const orphanRatio = typeof tiering?.orphanRatio === "number" ? tiering.orphanRatio : null
  const repetitiveMismatchQuestions = Array.isArray(tpt?.repetitiveMismatchQuestions)
    ? (tpt.repetitiveMismatchQuestions as number[])
    : []

  const rejectSubstring = "AMBIGUITY_RESOLUTION_REJECTED_INSUFFICIENT_MARGIN_OR_NON_NEIGHBOR_ROWS"
  const ambiguityRejectedInsufficientMarginOrNonNeighbor = qa
    .filter((a: any) => String(a?.explicitFinalNullificationReason ?? "") === rejectSubstring)
    .map((a: any) => {
      const qn = Number(a.questionNumber)
      const diag = qd.find((d: any) => Number(d.questionNumber) === qn)
      return {
        questionNumber: qn,
        explicitFinalNullificationReason: String(a.explicitFinalNullificationReason ?? ""),
        selectedAnswer: String(diag?.selectedAnswer ?? ""),
        chosenBeforeNullify: a.chosenCandidateBeforeNullification ?? null,
      }
    })
    .sort((x, y) => x.questionNumber - y.questionNumber)

  return {
    metrics: {
      totalQuestions: rows.length,
      totalMatch,
      totalMismatch,
      totalBLANKs,
      pairsFormed,
      orphanRatio,
      cycleRatio: seqPattern.cycleRatio,
      suspiciousWindows: seqPattern.suspiciousWindows,
      repetitiveMismatchQuestions,
      avgConfidence,
      realAmbiguities,
    },
    rows,
    extras: { ambiguityRejectedInsufficientMarginOrNonNeighbor },
  }
}

export function diffRowsVsBaseline(
  rows: ValidationTableRow[],
  baselineByQ: Map<number, ValidationTableRow>,
): {
  recoveredToMatch: Array<{ q: number; before: string; after: string; expected: string }>
  newRegressions: Array<{ q: number; before: string; after: string; expected: string }>
} {
  const recoveredToMatch: Array<{ q: number; before: string; after: string; expected: string }> = []
  const newRegressions: Array<{ q: number; before: string; after: string; expected: string }> = []
  for (const r of rows) {
    const b = baselineByQ.get(r.q)
    if (!b) continue
    if (b.match !== "match" && r.match === "match") {
      recoveredToMatch.push({ q: r.q, before: b.detected, after: r.detected, expected: r.expected })
    }
    if (b.match === "match" && r.match !== "match") {
      newRegressions.push({ q: r.q, before: b.detected, after: r.detected, expected: r.expected })
    }
  }
  return { recoveredToMatch, newRegressions }
}

export function rowsToBaselineMap(rows: ValidationTableRow[]): Map<number, ValidationTableRow> {
  const m = new Map<number, ValidationTableRow>()
  for (const r of rows) m.set(r.q, r)
  return m
}
