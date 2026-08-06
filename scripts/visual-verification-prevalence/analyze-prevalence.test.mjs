/**
 * Tests del analizador offline de prevalencia (FASE 2A-2).
 * Ejecutar: node scripts/visual-verification-prevalence/analyze-prevalence.test.mjs
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  analyzeBatch,
  analyzeFiles,
  assessSampleQuality,
  classifyZone,
  dedupeEvents,
  formatExecutiveSummary,
  isNonUsablePage,
  parsePrevalenceLine,
  selectEffectiveAttempts,
} from "./analyze-prevalence.mjs"

const PREFIX = "[VISUAL_VERIFICATION_PREVALENCE]"

function ev(partial) {
  return {
    schemaVersion: 1,
    event: "PAGE_PREVALENCE_SUMMARY",
    diagnosticRunId: "run-1",
    evaluationBatchId: "batch-1",
    batchStudentIndex: 1,
    pageIndex: 0,
    attempt: 0,
    eventKey: "run-1|batch-1|1|0|0",
    sourceMode: "batch",
    attemptOutcome: "unknown",
    engine: "azure_layout_family",
    layoutMode: "standard",
    expectedQuestionCount: 7,
    expectedOptionCount: 4,
    selectionMarksTotal: 28,
    selectedCountAzure: 7,
    blankRowCountBefore: 0,
    autoRescueCandidateCount: 0,
    reviewCandidateCount: 0,
    insufficientAbsoluteEvidenceCount: 0,
    insufficientMarginCount: 0,
    alreadySelectedCount: 7,
    noActionCount: 7,
    excludedCompetitiveDoubleMarkCount: 0,
    excludedGridIncompleteCount: 0,
    excludedInvalidPolygonCount: 0,
    excludedOtherCount: 0,
    degradedPage: false,
    degradedReason: null,
    pageGatesPassed: true,
    pageAbstainReason: null,
    pageUsefulness: "usefulPage",
    ...partial,
  }
}

function line(obj) {
  return `${PREFIX} ${JSON.stringify(obj)}`
}

function writeTemp(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prev-"))
  const fp = path.join(dir, "logs.txt")
  fs.writeFileSync(fp, content, "utf8")
  return fp
}

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`ok - ${name}`)
  } catch (e) {
    failed++
    console.error(`fail - ${name}`)
    console.error(e)
  }
}

test("1. eventos duplicados idénticos", () => {
  const a = ev()
  const r = dedupeEvents([a, { ...a }])
  assert.equal(r.unique.length, 1)
  assert.equal(r.duplicates, 1)
  assert.equal(r.hasCollisions, false)
})

test("2. eventKey duplicada con payload distinto → colisión", () => {
  const a = ev({ reviewCandidateCount: 0 })
  const b = ev({ reviewCandidateCount: 2 })
  const r = dedupeEvents([a, b])
  assert.equal(r.hasCollisions, true)
  const fp = writeTemp([line(a), line(b)].join("\n"))
  const out = analyzeFiles([fp])
  assert.equal(out.ok, false)
  assert.equal(out.error, "COLLISION")
})

test("3. dos reevaluaciones del mismo batch (runIds distintos)", () => {
  const r1 = ev({
    diagnosticRunId: "run-A",
    eventKey: "run-A|batch-1|1|0|0",
    reviewCandidateCount: 0,
  })
  const r2 = ev({
    diagnosticRunId: "run-B",
    eventKey: "run-B|batch-1|1|0|0",
    reviewCandidateCount: 1,
  })
  const { effective } = selectEffectiveAttempts([r1, r2])
  assert.equal(effective.length, 2)
  const analysis = analyzeBatch(effective)
  assert.equal(analysis.sample.totalStudents, 2)
})

test("4. attempt 0 y 1 → solo attempt efectivo (max)", () => {
  const a0 = ev({ attempt: 0, eventKey: "run-1|batch-1|1|0|0", reviewCandidateCount: 9 })
  const a1 = ev({ attempt: 1, eventKey: "run-1|batch-1|1|0|1", reviewCandidateCount: 1 })
  const { effective, resolutions } = selectEffectiveAttempts([a0, a1])
  assert.equal(effective.length, 1)
  assert.equal(effective[0].attempt, 1)
  assert.equal(effective[0].reviewCandidateCount, 1)
  assert.deepEqual(resolutions[0].discarded, [0])
})

test("5. página vacía ignorada (nonUsable)", () => {
  const empty = ev({
    selectionMarksTotal: 0,
    pageUsefulness: "ignoredOrNonOmrPage",
    reviewCandidateCount: 7,
    pageAbstainReason: "grid_incomplete",
    degradedReason: "grid_incomplete",
  })
  assert.equal(isNonUsablePage(empty), true)
  const analysis = analyzeBatch([empty])
  assert.equal(analysis.sample.nonUsablePages, 1)
  assert.equal(analysis.totals.totalReviewCandidates, 0)
  assert.equal(analysis.students.studentsWith0Review, 1)
})

test("6. estudiante sano", () => {
  const healthy = ev({ reviewCandidateCount: 0, autoRescueCandidateCount: 0 })
  const a = analyzeBatch([healthy])
  assert.equal(a.students.studentsWith0Review, 1)
  assert.equal(a.students.studentsWithAnyReview, 0)
})

test("7. estudiante con dos auto-rescues", () => {
  const p = ev({ autoRescueCandidateCount: 2, reviewCandidateCount: 0, blankRowCountBefore: 2 })
  const a = analyzeBatch([p])
  assert.equal(a.totals.totalAutoRescueCandidates, 2)
  assert.equal(a.students.studentsWith0Review, 1)
})

test("8. estudiante con seis review candidates → degradado / zona C", () => {
  const p = ev({
    reviewCandidateCount: 6,
    degradedPage: true,
    degradedReason: "excessive_review_candidates",
    selectedCountAzure: 1,
  })
  const a = analyzeBatch([p])
  assert.equal(a.totals.totalReviewCandidates, 6)
  assert.equal(a.totals.maxReviewOnSinglePage, 6)
  assert.equal(a.zone.zone, "ZONA_C")
})

test("9. lote Zona A", () => {
  const pages = []
  for (let s = 1; s <= 10; s++) {
    pages.push(
      ev({
        batchStudentIndex: s,
        eventKey: `run-1|batch-1|${s}|0|0`,
        reviewCandidateCount: s === 1 ? 1 : 0,
      }),
    )
  }
  // 1/10 = 10% any review, 90% zero, total review=1 ≤8
  const a = analyzeBatch(pages)
  assert.equal(a.zone.zone, "ZONA_A")
})

test("10. lote Zona B", () => {
  const pages = []
  for (let s = 1; s <= 10; s++) {
    pages.push(
      ev({
        batchStudentIndex: s,
        eventKey: `run-1|batch-1|${s}|0|0`,
        reviewCandidateCount: s <= 3 ? 1 : 0,
      }),
    )
  }
  // 30% any review → B (not A: pct0=70%<85%; not C: pctAny=30%<40%)
  const a = analyzeBatch(pages)
  assert.equal(a.zone.zone, "ZONA_B")
})

test("11. lote Zona C", () => {
  const pages = []
  for (let s = 1; s <= 10; s++) {
    pages.push(
      ev({
        batchStudentIndex: s,
        eventKey: `run-1|batch-1|${s}|0|0`,
        reviewCandidateCount: s <= 5 ? 2 : 0,
      }),
    )
  }
  // 50% any → C
  const a = analyzeBatch(pages)
  assert.equal(a.zone.zone, "ZONA_C")
})

test("12. JSON inválido", () => {
  const fp = writeTemp(`${PREFIX} {not-json\n`)
  const out = analyzeFiles([fp])
  assert.equal(out.ok, true)
  assert.ok(out.stats.parseFail >= 1)
  assert.equal(out.stats.parsedValid, 0)
})

test("13. evento incompleto / skipped", () => {
  assert.equal(parsePrevalenceLine(`${PREFIX} {"schemaVersion":1}`), null)
  const fp = writeTemp(
    `[VISUAL_VERIFICATION_PREVALENCE_SKIPPED] {"schemaVersion":1,"event":"PAGE_PREVALENCE_SKIPPED","reason":"missing_exact_context_ids"}\n`,
  )
  const out = analyzeFiles([fp])
  assert.equal(out.stats.parsedValid, 0)
})

test("14. denominadores y porcentajes exactos", () => {
  const pages = [
    ev({ batchStudentIndex: 1, eventKey: "run-1|batch-1|1|0|0", reviewCandidateCount: 0 }),
    ev({ batchStudentIndex: 2, eventKey: "run-1|batch-1|2|0|0", reviewCandidateCount: 1 }),
    ev({ batchStudentIndex: 3, eventKey: "run-1|batch-1|3|0|0", reviewCandidateCount: 0 }),
    ev({ batchStudentIndex: 4, eventKey: "run-1|batch-1|4|0|0", reviewCandidateCount: 0 }),
  ]
  const a = analyzeBatch(pages)
  assert.equal(a.sample.totalStudents, 4)
  assert.equal(a.students.studentsWith0Review, 3)
  assert.equal(a.students.studentsWithAnyReview, 1)
  assert.equal(a.students.pctWith0Review, 75)
  assert.equal(a.students.pctWithAnyReview, 25)
  assert.equal(a.denominators.pctWith0Review, "studentsWith0Review / totalStudents")
  assert.equal(a.totals.totalQuestions, 28)
  assert.equal(a.denominators.reviewPerQuestion, Number((1 / 28).toFixed(4)))
})

test("classifyZone helper: página >5 → C", () => {
  const z = classifyZone({
    totalStudents: 5,
    studentsWith0Review: 4,
    studentsWithAnyReview: 1,
    studentsWith3To5Review: 0,
    studentsWithMoreThan5Review: 1,
    studentSummaries: [
      { reviewCandidates: 0 },
      { reviewCandidates: 0 },
      { reviewCandidates: 0 },
      { reviewCandidates: 0 },
      { reviewCandidates: 6 },
    ],
    totalReviewCandidates: 6,
    totalDegradedPages: 1,
    maxReviewOnSinglePage: 6,
  })
  assert.equal(z.zone, "ZONA_C")
})

test("15. resumen ejecutivo Zona A/B/C + denominadores", () => {
  const dir = path.join(process.cwd(), "scripts/visual-verification-prevalence/fixtures")
  for (const [file, zone] of [
    ["zone-a.log", "ZONA_A"],
    ["zone-b.log", "ZONA_B"],
    ["zone-c.log", "ZONA_C"],
  ]) {
    const out = analyzeFiles([path.join(dir, file)], { synthetic: true })
    assert.equal(out.ok, true, file)
    assert.equal(out.batch.zone.zone, zone, file)
    assert.equal(out.sampleQuality.quality, "INSUFICIENTE")
    const summary = formatExecutiveSummary(out, { synthetic: true })
    assert.ok(summary.includes("RESUMEN DE PREVALENCIA"))
    assert.ok(summary.includes(zone))
    assert.ok(summary.includes("INSUFICIENTE"))
    assert.ok(summary.includes("fixtures sintéticos"))
    assert.ok(summary.includes("Estudiantes:"))
    assert.ok(summary.includes("denominador:"))
  }
})

test("16. fixtures: duplicates / collision / retry / reevaluation", () => {
  const dir = path.join(process.cwd(), "scripts/visual-verification-prevalence/fixtures")
  const dup = analyzeFiles([path.join(dir, "duplicates.log")], { synthetic: true })
  assert.equal(dup.ok, true)
  assert.equal(dup.stats.duplicatesIdentical, 1)
  assert.equal(dup.stats.uniqueEventKeys, 1)

  const col = analyzeFiles([path.join(dir, "collision.log")], { synthetic: true })
  assert.equal(col.ok, false)
  assert.equal(col.error, "COLLISION")
  const colSummary = formatExecutiveSummary(col, { synthetic: true })
  assert.ok(colSummary.includes("INSUFICIENTE"))

  const retry = analyzeFiles([path.join(dir, "retry-attempt.log")], { synthetic: true })
  assert.equal(retry.ok, true)
  assert.equal(retry.stats.effectivePagesAfterAttemptResolve, 1)
  assert.equal(retry.attemptResolutions[0].used, 1)
  assert.deepEqual(retry.attemptResolutions[0].discarded, [0])
  assert.equal(retry.batch.totals.totalReviewCandidates, 1)

  const re = analyzeFiles([path.join(dir, "reevaluation.log")], { synthetic: true })
  assert.equal(re.ok, true)
  assert.equal(re.stats.effectivePagesAfterAttemptResolve, 2)
  assert.equal(re.batch.sample.totalStudents, 2)
})

test("17. sample quality: denom 0 → no porcentaje inventado", () => {
  const q = assessSampleQuality(
    { sample: { totalStudents: 0 }, totals: { totalQuestions: 0 } },
    { synthetic: true },
  )
  assert.equal(q.quality, "INSUFICIENTE")
  const empty = analyzeBatch([])
  assert.equal(empty.students.pctWithAnyReview, null)
  assert.equal(empty.students.pctWith0Review, null)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
