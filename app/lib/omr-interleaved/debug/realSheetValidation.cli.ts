/**
 * Validación REAL contra Supabase + Azure (misma hoja / sourceExamId que tmp/interleaved-real-validation).
 * Aislado en debug/; no se importa desde producción.
 *
 * npx tsx app/lib/omr-interleaved/debug/realSheetValidation.cli.ts
 */
import fs from "fs"
import path from "path"
import { createClient } from "@supabase/supabase-js"
import { runInterleavedAzureLayoutOmrPipeline } from "../run-interleaved-pipeline"
import { omrTemplateKeyForClosedQuestionCount } from "../../source-exam-omr-metadata"
import {
  diffRowsVsBaseline,
  extractValidationFromPipelineOutput,
  loadEnvFile,
  type ValidationTableRow,
} from "./interleavedValidationMetrics"

type BaselineRow = { q: number; match: string; detected: string; expected: string }

function loadBaselineRows(repoRoot: string): BaselineRow[] | null {
  const p = path.join(repoRoot, "tmp/interleaved-validation-table.json")
  if (!fs.existsSync(p)) return null
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { rows?: BaselineRow[] }
    return Array.isArray(j.rows) ? j.rows : null
  } catch {
    return null
  }
}

async function main() {
  const repoRoot = process.cwd()
  const baselineRows = loadBaselineRows(repoRoot)
  const baselineByQ = new Map<number, ValidationTableRow>()
  if (baselineRows) {
    for (const r of baselineRows) {
      baselineByQ.set(r.q, {
        q: r.q,
        detected: r.detected,
        expected: r.expected,
        match: r.match as "match" | "mismatch",
        confidence: null,
        ambiguous: false,
      })
    }
  }

  const env = {
    ...loadEnvFile(path.join(repoRoot, ".env.local")),
    ...loadEnvFile(path.join(repoRoot, ".env")),
    ...process.env,
  }
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

  const sourceExamId = "dc037cd6-7c4c-49ba-9719-c58cacd38ebc"
  const photoPath =
    "dc64bd01-5b57-403f-b4b8-8aec3808b206/d3f52c65-4930-4afe-81d3-b0827f11ce12/s1_p1_ecb9a9f9-43ba-4e1f-81be-16d4b6f03c78.jpg"
  const variant = "odd_even_dual_column" as const

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: imageBlob, error: imageErr } = await supabase.storage.from("batch-scans").download(photoPath)
  if (imageErr || !imageBlob) throw new Error(`No se pudo descargar imagen: ${imageErr?.message ?? "unknown"}`)
  const imageBuffer = Buffer.from(await imageBlob.arrayBuffer())

  const { data: sourceItems, error: itemsErr } = await supabase
    .from("source_exam_items")
    .select("item_number,correct_answer,question_type")
    .eq("source_exam_id", sourceExamId)
    .order("item_number", { ascending: true })
  if (itemsErr) throw new Error(`No se pudo cargar source_exam_items: ${itemsErr.message}`)

  const closedItems = (sourceItems ?? []).filter((r: any) => !String(r.question_type ?? "").toLowerCase().includes("desarrollo"))
  const closedQuestionIds = closedItems.map((r: any) => `C${Number(r.item_number)}`)
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
    omrTemplateVariant: variant,
    closedQuestionIds,
  })
  if (!out?.success) throw new Error(`Pipeline falló: ${out?.errorCode ?? out?.error ?? "unknown"}`)

  const { metrics, rows, extras } = extractValidationFromPipelineOutput({
    out,
    closedQuestionIds,
    correctByQuestion,
  })
  const {
    totalMatch,
    totalMismatch,
    totalBLANKs,
    avgConfidence,
    realAmbiguities,
    pairsFormed,
    orphanRatio,
    repetitiveMismatchQuestions,
    cycleRatio,
    suspiciousWindows,
  } = metrics
  const seqPattern = { cycleRatio, suspiciousWindows }
  const ambiguityRejectedRows = extras.ambiguityRejectedInsufficientMarginOrNonNeighbor

  const snap = out?.interleavedDebugSnapshot as Record<string, unknown> | undefined
  const tpt = snap?.targetedPhysicalTraceReport as Record<string, unknown> | undefined
  const tiering = tpt?.tieringPartialCollapse as Record<string, unknown> | undefined

  const { recoveredToMatch: recoveredNew } = baselineByQ.size
    ? diffRowsVsBaseline(rows, baselineByQ)
    : { recoveredToMatch: [] as Array<{ q: number; before: string; after: string; expected: string }> }

  const baselineComparison = {
    baselinesOutOf40: { five: 5, seven: 7, eight: 8 },
    currentMatchOutOf40: `${totalMatch}/40`,
    deltaVsBaselines: {
      vs_5_40: totalMatch - 5,
      vs_7_40: totalMatch - 7,
      vs_8_40: totalMatch - 8,
    },
    diffFromPreviousTmpRun: baselineByQ.size
      ? {
          previousMatchCount: baselineRows!.filter((x) => x.match === "match").length,
          recoveredToMatchCount: recoveredNew.length,
        }
      : null,
  }

  const report = {
    sourceExamId,
    variant,
    photoPath,
    totalQuestions: rows.length,
    totalMatch,
    totalMismatch,
    totalBLANKs,
    orphanRatio,
    pairsFormed,
    cycleRatio: seqPattern.cycleRatio,
    suspiciousWindows: seqPattern.suspiciousWindows,
    repetitiveMismatchQuestions,
    ambiguityRejectedInsufficientMarginOrNonNeighbor: ambiguityRejectedRows,
    baselineComparison,
    recoveredNewMatchVsPreviousTmp: recoveredNew,
    avgConfidence,
    realAmbiguities,
    seqPattern,
    tieringPartialCollapse: tiering ?? null,
    rows,
  }
  const outPath = path.join(repoRoot, "tmp/interleaved-validation-table.json")
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
