/**
 * Validación por lotes: lee casos JSON, ejecuta el pipeline interleaved por cada uno,
 * compara con clave en Supabase y escribe resumen + métricas por caso.
 *
 * Uso:
 *   npx tsx app/lib/omr-interleaved/debug/runInterleavedBatchValidation.cli.ts
 *   npx tsx app/lib/omr-interleaved/debug/runInterleavedBatchValidation.cli.ts path/casos.json --out tmp/mi-reporte.json --baseline tmp/reporte-anterior.json
 */
import fs from "fs"
import path from "path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { runInterleavedAzureLayoutOmrPipeline } from "../run-interleaved-pipeline"
import { omrTemplateKeyForClosedQuestionCount } from "../../source-exam-omr-metadata"
import {
  caseKey,
  diffRowsVsBaseline,
  extractValidationFromPipelineOutput,
  loadEnvMerged,
  rowsToBaselineMap,
  type InterleavedCaseSpec,
  type ValidationTableRow,
} from "./interleavedValidationMetrics"

type BatchCaseResult = {
  key: string
  label?: string
  sourceExamId: string
  photoPath: string
  variant: string
  /** Variante efectiva tras auto-detección en pipeline (si aplica). */
  pipelineVariantEffective?: string
  /** Diagnóstico auto variant (pares Δ=1 vs Δ≈half, paridad, etc.). */
  pipelineVariantAutoDiagnostics?: Record<string, unknown> | null
  success: boolean
  error?: string
  metrics: ReturnType<typeof extractValidationFromPipelineOutput>["metrics"] | null
  rows: ValidationTableRow[] | null
  extras: ReturnType<typeof extractValidationFromPipelineOutput>["extras"] | null
  tieringPartialCollapse: Record<string, unknown> | null
  vsBaseline: {
    recoveredToMatch: Array<{ q: number; before: string; after: string; expected: string }>
    newRegressions: Array<{ q: number; before: string; after: string; expected: string }>
  } | null
}

type RegressionRow = { q: number; before: string; after: string; expected: string }

type BatchReport = {
  generatedAt: string
  casesFile: string
  baselineFile: string | null
  cases: BatchCaseResult[]
  summary: {
    casesOk: number
    casesFailed: number
    totals: {
      totalMatch: number
      totalMismatch: number
      totalBLANKs: number
      totalQuestions: number
    }
    averages: {
      orphanRatio: number | null
      cycleRatio: number
      suspiciousWindows: number
      pairsFormed: number
    }
    antiRegressionFlags: {
      anyCycleRatioWorseThanBaseline: boolean
      anySuspiciousWindowsAboveBaseline: boolean
      anyOrphanRatioWorseThanBaseline: boolean
    }
    consolidatedRegressions: Array<{ key: string; newRegressions: RegressionRow[] }>
    recoveredToMatchAllCases: Array<{ key: string; recoveredToMatch: RegressionRow[] }>
  }
}

function parseArgs(argv: string[]): { casesPath: string; outPath: string; baselinePath: string | null } {
  const args = argv.slice(2).filter((a) => a !== "--")
  let outPath = path.join(process.cwd(), "tmp/interleaved-batch-validation-report.json")
  let baselinePath: string | null = null
  const filtered: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outPath = path.resolve(process.cwd(), args[++i]!)
      continue
    }
    if (args[i] === "--baseline" && args[i + 1]) {
      baselinePath = path.resolve(process.cwd(), args[++i]!)
      continue
    }
    filtered.push(args[i]!)
  }
  const repoRoot = process.cwd()
  const defaultCases = path.join(repoRoot, "app/lib/omr-interleaved/debug/interleaved-cases.json")
  const casesPath = filtered[0] ? path.resolve(repoRoot, filtered[0]) : defaultCases
  return { casesPath, outPath, baselinePath }
}

function loadCasesJson(filePath: string): InterleavedCaseSpec[] {
  const raw = fs.readFileSync(filePath, "utf8")
  const data = JSON.parse(raw) as unknown
  if (!Array.isArray(data)) throw new Error(`Se esperaba un array de casos en ${filePath}`)
  for (const c of data) {
    if (!c || typeof c !== "object") throw new Error("Caso inválido (no objeto)")
    const o = c as Record<string, unknown>
    if (typeof o.sourceExamId !== "string" || typeof o.photoPath !== "string" || typeof o.variant !== "string") {
      throw new Error(`Caso incompleto: sourceExamId, photoPath y variant son obligatorios (${filePath})`)
    }
  }
  return data as InterleavedCaseSpec[]
}

function loadBaselineMap(
  baselinePath: string | null,
): Map<string, Map<number, ValidationTableRow>> | null {
  if (!baselinePath || !fs.existsSync(baselinePath)) return null
  try {
    const j = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as { cases?: BatchCaseResult[] }
    if (!Array.isArray(j.cases)) return null
    const out = new Map<string, Map<number, ValidationTableRow>>()
    for (const c of j.cases) {
      if (!c?.key || !Array.isArray(c.rows)) continue
      out.set(c.key, rowsToBaselineMap(c.rows as ValidationTableRow[]))
    }
    return out.size ? out : null
  } catch {
    return null
  }
}

type LooseSupabase = SupabaseClient<any, "public", any>

async function runOneCase(params: {
  supabase: LooseSupabase
  spec: InterleavedCaseSpec
  baselineByQ: Map<number, ValidationTableRow> | null
}): Promise<BatchCaseResult> {
  const { supabase, spec, baselineByQ } = params
  const key = caseKey(spec)
  const base: BatchCaseResult = {
    key,
    label: spec.label,
    sourceExamId: spec.sourceExamId,
    photoPath: spec.photoPath,
    variant: spec.variant,
    success: false,
    metrics: null,
    rows: null,
    extras: null,
    tieringPartialCollapse: null,
    vsBaseline: null,
  }
  try {
    const { data: imageBlob, error: imageErr } = await supabase.storage.from("batch-scans").download(spec.photoPath)
    if (imageErr || !imageBlob) throw new Error(`Imagen: ${imageErr?.message ?? "unknown"}`)

    const imageBuffer = Buffer.from(await imageBlob.arrayBuffer())
    const { data: sourceItems, error: itemsErr } = await supabase
      .from("source_exam_items")
      .select("item_number,correct_answer,question_type")
      .eq("source_exam_id", spec.sourceExamId)
      .order("item_number", { ascending: true })
    if (itemsErr) throw new Error(`source_exam_items: ${itemsErr.message}`)

    const examRows = (sourceItems ?? []) as Array<{
      item_number: number
      correct_answer: string | null
      question_type: string | null
    }>
    const closedItems = examRows.filter(
      (r) => !String(r.question_type ?? "").toLowerCase().includes("desarrollo"),
    )
    const closedQuestionIds = closedItems.map((r) => `C${Number(r.item_number)}`)
    const correctByQuestion = new Map<number, string>()
    for (const item of closedItems) {
      correctByQuestion.set(Number(item.item_number), String(item.correct_answer ?? "").toUpperCase())
    }

    const templateKey = omrTemplateKeyForClosedQuestionCount(closedQuestionIds.length || 40)
    const out: any = await runInterleavedAzureLayoutOmrPipeline({
      imageBuffer,
      templateKey,
      expectedQuestionCount: closedQuestionIds.length || 40,
      expectedOptionCount: 4,
      canonicalWidth: 1200,
      canonicalHeight: 1700,
      omrTemplateVariant: spec.variant as
        | "odd_even_dual_column"
        | "sequential_dual_column"
        | "single_column",
      closedQuestionIds,
    })
    if (!out?.success) throw new Error(`${out?.errorCode ?? out?.error ?? "pipeline failed"}`)

    const { metrics, rows, extras } = extractValidationFromPipelineOutput({
      out,
      closedQuestionIds,
      correctByQuestion,
    })
    const snap = out?.interleavedDebugSnapshot as Record<string, unknown> | undefined
    const tpt = snap?.targetedPhysicalTraceReport as Record<string, unknown> | undefined
    const tiering = tpt?.tieringPartialCollapse as Record<string, unknown> | undefined

    let vsBaseline: BatchCaseResult["vsBaseline"] = null
    if (baselineByQ && baselineByQ.size) {
      const { recoveredToMatch, newRegressions } = diffRowsVsBaseline(rows, baselineByQ)
      vsBaseline = { recoveredToMatch, newRegressions }
    }

    return {
      ...base,
      success: true,
      pipelineVariantEffective:
        typeof out?.omrTemplateVariantEffective === "string" ? out.omrTemplateVariantEffective : undefined,
      pipelineVariantAutoDiagnostics:
        out?.omrTemplateVariantAutoDiagnostics &&
        typeof out.omrTemplateVariantAutoDiagnostics === "object"
          ? (out.omrTemplateVariantAutoDiagnostics as Record<string, unknown>)
          : null,
      metrics,
      rows,
      extras,
      tieringPartialCollapse: tiering ?? null,
      vsBaseline,
    }
  } catch (e: any) {
    return { ...base, error: String(e?.message ?? e) }
  }
}

async function main() {
  const repoRoot = process.cwd()
  const { casesPath, outPath, baselinePath } = parseArgs(process.argv)

  if (!fs.existsSync(casesPath)) {
    throw new Error(`No existe el archivo de casos: ${casesPath}`)
  }

  const cases = loadCasesJson(casesPath)
  const env = loadEnvMerged(repoRoot)
  const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  }

  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT =
    env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
  process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY =
    env.AZURE_DOCUMENT_INTELLIGENCE_KEY || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
  process.env.NEXT_PUBLIC_OMR_INTERLEAVED = "1"
  process.env.NEXT_PUBLIC_OMR_INTERLEAVED_DEBUG = "1"

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as LooseSupabase
  const baselineByKey = loadBaselineMap(baselinePath)

  const results: BatchCaseResult[] = []
  for (const spec of cases) {
    const k = caseKey(spec)
    const baselineForCase = baselineByKey?.get(k) ?? null
    const r = await runOneCase({ supabase, spec, baselineByQ: baselineForCase })
    results.push(r)
  }

  const ok = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  let totalMatch = 0
  let totalMismatch = 0
  let totalBLANKs = 0
  let totalQuestions = 0
  let sumOrphan = 0
  let orphanCount = 0
  let sumCycle = 0
  let sumSuspicious = 0
  let sumPairs = 0

  for (const r of ok) {
    if (!r.metrics) continue
    totalMatch += r.metrics.totalMatch
    totalMismatch += r.metrics.totalMismatch
    totalBLANKs += r.metrics.totalBLANKs
    totalQuestions += r.metrics.totalQuestions
    if (r.metrics.orphanRatio != null) {
      sumOrphan += r.metrics.orphanRatio
      orphanCount++
    }
    sumCycle += r.metrics.cycleRatio
    sumSuspicious += r.metrics.suspiciousWindows
    sumPairs += r.metrics.pairsFormed
  }

  const nOk = ok.length || 1
  let anyCycleWorse = false
  let anySuspiciousWorse = false
  let anyOrphanWorse = false

  if (baselinePath && fs.existsSync(baselinePath)) {
    const prevReport = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as { cases: BatchCaseResult[] }
    for (const r of ok) {
      if (!r.metrics) continue
      const oldCase = prevReport.cases?.find((c) => c.key === r.key)
      if (!oldCase?.metrics || !r.metrics) continue
      if (r.metrics.cycleRatio > oldCase.metrics.cycleRatio + 1e-6) anyCycleWorse = true
      if (r.metrics.suspiciousWindows > oldCase.metrics.suspiciousWindows) anySuspiciousWorse = true
      if (
        oldCase.metrics.orphanRatio != null &&
        r.metrics.orphanRatio != null &&
        r.metrics.orphanRatio > oldCase.metrics.orphanRatio + 1e-6
      ) {
        anyOrphanWorse = true
      }
    }
  }

  const consolidatedRegressions = results
    .filter((r) => r.success && r.vsBaseline?.newRegressions?.length)
    .map((r) => ({ key: r.key, newRegressions: r.vsBaseline!.newRegressions }))

  const recoveredToMatchAllCases = results
    .filter((r) => r.success && r.vsBaseline?.recoveredToMatch?.length)
    .map((r) => ({ key: r.key, recoveredToMatch: r.vsBaseline!.recoveredToMatch }))

  const report: BatchReport = {
    generatedAt: new Date().toISOString(),
    casesFile: casesPath,
    baselineFile: baselinePath && fs.existsSync(baselinePath) ? baselinePath : null,
    cases: results,
    summary: {
      casesOk: ok.length,
      casesFailed: failed.length,
      totals: { totalMatch, totalMismatch, totalBLANKs, totalQuestions },
      averages: {
        orphanRatio: orphanCount ? Number((sumOrphan / orphanCount).toFixed(6)) : null,
        cycleRatio: Number((sumCycle / nOk).toFixed(4)),
        suspiciousWindows: Number((sumSuspicious / nOk).toFixed(4)),
        pairsFormed: Number((sumPairs / nOk).toFixed(4)),
      },
      antiRegressionFlags: {
        anyCycleRatioWorseThanBaseline: anyCycleWorse,
        anySuspiciousWindowsAboveBaseline: anySuspiciousWorse,
        anyOrphanRatioWorseThanBaseline: anyOrphanWorse,
      },
      consolidatedRegressions,
      recoveredToMatchAllCases,
    },
  }

  const outDir = path.dirname(outPath)
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
