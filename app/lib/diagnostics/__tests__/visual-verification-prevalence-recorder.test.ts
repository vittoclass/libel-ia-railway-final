/**
 * FASE 2A-2 — tests del recorder pasivo de prevalencia.
 * Ejecutar: npx tsx app/lib/diagnostics/__tests__/visual-verification-prevalence-recorder.test.ts
 *
 * No llama Azure. No activa APPLY en producción. No PII.
 */

import assert from "node:assert/strict"
import type { AzureLayoutOmrDiagnosticContext } from "@/app/lib/omr/experimental/azure-layout-omr-pipeline"
import type {
  VisualBlankRescuePageResult,
  VisualBlankRescueRowDecision,
} from "@/app/lib/omr-shared/azure-visual-blank-rescue"
import {
  PREVALENCE_LOG_PREFIX,
  PREVALENCE_SKIPPED_LOG_PREFIX,
  VISUAL_VERIFICATION_PREVALENCE_FLAG,
  __setPrevalenceEmitForTests,
  assessDegradedPage,
  assertDecisionsUntouched,
  isVisualVerificationPrevalenceEnabled,
  recordVisualVerificationPrevalence,
  tryBuildPrevalenceEventKey,
} from "../visual-verification-prevalence-recorder"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const FLAG = VISUAL_VERIFICATION_PREVALENCE_FLAG
const SHADOW = "LIBELIA_AZURE_VISUAL_BLANK_RESCUE_SHADOW"
const APPLY = "LIBELIA_AZURE_VISUAL_BLANK_RESCUE_APPLY"

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(overrides)) {
    prev[k] = process.env[k]
    const v = overrides[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    fn()
  } finally {
    for (const k of Object.keys(overrides)) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

function baseCtx(
  partial?: Partial<AzureLayoutOmrDiagnosticContext>,
): AzureLayoutOmrDiagnosticContext {
  return {
    diagnosticRunId: "run-aaa",
    evaluationBatchId: "batch-bbb",
    batchStudentIndex: 1,
    pageIndex: 0,
    attempt: 0,
    ...partial,
  }
}

function metrics(bestLetter = "B") {
  return {
    perOption: [
      {
        letter: "A",
        meanGray: 200,
        localBackground: 220,
        darkRatio: 0.1,
        contrast: 10,
        azureState: "unselected" as const,
        azureConfidence: 0.9,
      },
      {
        letter: bestLetter,
        meanGray: 180,
        localBackground: 220,
        darkRatio: 0.2,
        contrast: 15,
        azureState: "unselected" as const,
        azureConfidence: 0.9,
      },
    ],
    bestLetter,
    secondLetter: "A",
    marginDarkRatio: 0.1,
    marginContrast: 5,
  }
}

function healthyResult(
  decisions: VisualBlankRescueRowDecision[],
  partial?: Partial<VisualBlankRescuePageResult>,
): VisualBlankRescuePageResult {
  return {
    pageAction: "shadow_report",
    pageGatesPassed: true,
    pageAbstainReason: null,
    selectionMarksTotal: 28,
    selectedCountAzure: 5,
    blankRowCountBefore: 2,
    decisions,
    proposedRows: null,
    ...partial,
  }
}

function captureLogs(fn: () => void): string[] {
  const lines: string[] = []
  __setPrevalenceEmitForTests((line) => {
    lines.push(line)
  })
  try {
    fn()
  } finally {
    __setPrevalenceEmitForTests(null)
  }
  return lines
}

function parseEvent(line: string): Record<string, unknown> {
  assert.ok(line.startsWith(PREVALENCE_LOG_PREFIX + " "))
  return JSON.parse(line.slice(PREVALENCE_LOG_PREFIX.length + 1)) as Record<string, unknown>
}

test("1. Flag ausente → 0 eventos", () => {
  withEnv({ [FLAG]: undefined, [SHADOW]: "1" }, () => {
    assert.equal(isVisualVerificationPrevalenceEnabled(), false)
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult([]),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.equal(lines.length, 0)
  })
})

test('2. Flag "0" → 0 eventos', () => {
  withEnv({ [FLAG]: "0", [SHADOW]: "1" }, () => {
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult([]),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.equal(lines.length, 0)
  })
})

test('3. Flag inválido ("true"/"yes"/"2"/vacío) → 0 eventos', () => {
  for (const bad of ["true", "yes", "2", ""]) {
    withEnv({ [FLAG]: bad, [SHADOW]: "1" }, () => {
      const lines = captureLogs(() => {
        recordVisualVerificationPrevalence({
          diagnosticContext: baseCtx(),
          rescueMode: "shadow",
          rescueResult: healthyResult([]),
          expectedQuestionCount: 7,
          expectedOptionCount: 4,
          imageAvailableInMemory: true,
        })
      })
      assert.equal(lines.length, 0, `flag=${JSON.stringify(bad)}`)
    })
  }
})

test('4. Flag "1" + SHADOW off (rescueMode off) → 0 evento válido', () => {
  withEnv({ [FLAG]: "1", [SHADOW]: undefined, [APPLY]: undefined }, () => {
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "off",
        rescueResult: healthyResult([]),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.equal(lines.length, 0)
  })
})

test('5. Flag "1" + SHADOW on → evento', () => {
  withEnv({ [FLAG]: "1", [SHADOW]: "1" }, () => {
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult(
          Array.from({ length: 5 }, (_, i) => ({
            action: "no_action" as const,
            questionNumber: i + 1,
            reason: "already_selected",
          })).concat([
            { action: "no_action", questionNumber: 6, reason: "already_selected" },
            { action: "no_action", questionNumber: 7, reason: "already_selected" },
          ]),
          { selectedCountAzure: 7, blankRowCountBefore: 0 },
        ),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.equal(lines.length, 1)
    const ev = parseEvent(lines[0]!)
    assert.equal(ev.event, "PAGE_PREVALENCE_SUMMARY")
    assert.equal(ev.sourceMode, "batch")
    assert.equal(ev.eventKey, "run-aaa|batch-bbb|1|0|0")
  })
})

test("6. Falta diagnosticRunId → skipped/no muestra", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: {
          evaluationBatchId: "b",
          batchStudentIndex: 1,
          pageIndex: 0,
          attempt: 0,
        },
        rescueMode: "shadow",
        rescueResult: healthyResult([]),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.equal(lines.length, 1)
    assert.ok(lines[0]!.startsWith(PREVALENCE_SKIPPED_LOG_PREFIX))
  })
})

test("7. Falta batch/student en modo batch incompleto → skipped; direct sin batch OK", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const skipped = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: {
          diagnosticRunId: "run-1",
          evaluationBatchId: "b",
          // falta batchStudentIndex
          pageIndex: 0,
          attempt: 0,
        },
        rescueMode: "shadow",
        rescueResult: healthyResult([]),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.ok(skipped[0]!.startsWith(PREVALENCE_SKIPPED_LOG_PREFIX))

    const direct = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: {
          diagnosticRunId: "run-1",
          pageIndex: 0,
          attempt: 0,
        },
        rescueMode: "shadow",
        rescueResult: healthyResult([]),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.equal(direct.length, 1)
    const ev = parseEvent(direct[0]!)
    assert.equal(ev.sourceMode, "direct")
    assert.equal(ev.eventKey, "run-1|direct|0|0")
  })
})

test("8. Página sana 7/7", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const decisions: VisualBlankRescueRowDecision[] = Array.from({ length: 7 }, (_, i) => ({
      action: "no_action" as const,
      questionNumber: i + 1,
      reason: "already_selected",
    }))
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult(decisions, {
          selectedCountAzure: 7,
          blankRowCountBefore: 0,
        }),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    const ev = parseEvent(lines[0]!)
    assert.equal(ev.autoRescueCandidateCount, 0)
    assert.equal(ev.reviewCandidateCount, 0)
    assert.equal(ev.degradedPage, false)
    assert.equal(ev.pageUsefulness, "usefulPage")
  })
})

test("9. Dos rescued_answer", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const decisions: VisualBlankRescueRowDecision[] = [
      {
        action: "rescued_answer",
        questionNumber: 1,
        letter: "A",
        reason: "visual_dominant_clear",
        metrics: metrics("A"),
      },
      {
        action: "rescued_answer",
        questionNumber: 2,
        letter: "C",
        reason: "visual_dominant_clear",
        metrics: metrics("C"),
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        action: "no_action" as const,
        questionNumber: i + 3,
        reason: "already_selected",
      })),
    ]
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult(decisions, {
          selectedCountAzure: 5,
          blankRowCountBefore: 2,
        }),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    const ev = parseEvent(lines[0]!)
    assert.equal(ev.autoRescueCandidateCount, 2)
    assert.equal(ev.reviewCandidateCount, 0)
    const raw = JSON.stringify(ev)
    assert.equal(raw.includes('"letter"'), false)
    assert.equal(raw.includes("bestLetter"), false)
  })
})

test("10. Seis insufficient_absolute_evidence → review + degraded", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const decisions: VisualBlankRescueRowDecision[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        action: "abstain" as const,
        questionNumber: i + 1,
        reason: "insufficient_absolute_evidence",
        metrics: metrics("B"),
      })),
      { action: "no_action" as const, questionNumber: 7, reason: "already_selected" },
    ]
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult(decisions, {
          selectedCountAzure: 1,
          blankRowCountBefore: 6,
        }),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    const ev = parseEvent(lines[0]!)
    assert.equal(ev.reviewCandidateCount, 6)
    assert.equal(ev.insufficientAbsoluteEvidenceCount, 6)
    assert.equal(ev.degradedPage, true)
    assert.ok(
      ev.degradedReason === "severe_selected_deficit" ||
        ev.degradedReason === "excessive_review_candidates",
    )
  })
})

test("11. insufficient_margin separado (no suma a review)", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const decisions: VisualBlankRescueRowDecision[] = [
      {
        action: "abstain",
        questionNumber: 1,
        reason: "insufficient_margin",
        metrics: metrics("A"),
      },
      {
        action: "abstain",
        questionNumber: 2,
        reason: "insufficient_absolute_evidence",
        metrics: metrics("B"),
      },
    ]
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult(decisions),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    const ev = parseEvent(lines[0]!)
    assert.equal(ev.insufficientMarginCount, 1)
    assert.equal(ev.reviewCandidateCount, 1)
    assert.equal(ev.insufficientAbsoluteEvidenceCount, 1)
  })
})

test("12. competitive_double_mark excluido de review", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const decisions: VisualBlankRescueRowDecision[] = [
      {
        action: "abstain",
        questionNumber: 1,
        reason: "competitive_double_mark",
        metrics: metrics("A"),
      },
    ]
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult(decisions),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    const ev = parseEvent(lines[0]!)
    assert.equal(ev.excludedCompetitiveDoubleMarkCount, 1)
    assert.equal(ev.reviewCandidateCount, 0)
  })
})

test("13. grid_incomplete no produce revisiones", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: {
          pageAction: "no_op",
          pageGatesPassed: false,
          pageAbstainReason: "grid_incomplete",
          selectionMarksTotal: 10,
          selectedCountAzure: 0,
          blankRowCountBefore: 7,
          decisions: [],
          proposedRows: null,
        },
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    const ev = parseEvent(lines[0]!)
    assert.equal(ev.reviewCandidateCount, 0)
    assert.equal(ev.pageUsefulness, "gridIncompleteUsefulPage")
    assert.equal(ev.excludedGridIncompleteCount, 1)
    assert.equal(ev.degradedReason, "grid_incomplete")
  })
})

test("14. página vacía/no OMR no produce siete candidatos", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: {
          pageAction: "no_op",
          pageGatesPassed: false,
          pageAbstainReason: "grid_incomplete",
          selectionMarksTotal: 0,
          selectedCountAzure: 0,
          blankRowCountBefore: 7,
          decisions: [],
          proposedRows: null,
        },
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    const ev = parseEvent(lines[0]!)
    assert.equal(ev.pageUsefulness, "ignoredOrNonOmrPage")
    assert.equal(ev.reviewCandidateCount, 0)
  })
})

test("15. ninguna letra ni PII en JSON", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const decisions: VisualBlankRescueRowDecision[] = [
      {
        action: "rescued_answer",
        questionNumber: 1,
        letter: "D",
        reason: "visual_dominant_clear",
        metrics: metrics("D"),
      },
      {
        action: "abstain",
        questionNumber: 2,
        reason: "insufficient_absolute_evidence",
        metrics: metrics("C"),
      },
    ]
    const lines = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult(decisions),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    const raw = lines[0]!
    assert.equal(/"letter"\s*:/.test(raw), false)
    assert.equal(/"bestLetter"\s*:/.test(raw), false)
    assert.equal(/"secondLetter"\s*:/.test(raw), false)
    assert.equal(raw.includes('"D"'), false)
    assert.equal(raw.includes('"C"'), false)
    assert.equal(/@/.test(raw), false)
    assert.equal(/https?:\/\//i.test(raw), false)
    assert.equal(/base64/i.test(raw), false)
    assert.equal(/storage_path/i.test(raw), false)
    assert.equal(/"polygon"\s*:/i.test(raw), false)
    assert.equal(/polygonNorm/i.test(raw), false)
    assert.equal(/teacherId|schoolId|nombreEstudiante|"rut"/i.test(raw), false)
  })
})

test("16. excepción interna → pipeline intacto (no lanza)", () => {
  withEnv({ [FLAG]: "1" }, () => {
    __setPrevalenceEmitForTests(() => {
      throw new Error("console boom")
    })
    assert.doesNotThrow(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult([]),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    __setPrevalenceEmitForTests(null)
  })
})

test("17. decisions no mutadas", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const decisions: VisualBlankRescueRowDecision[] = [
      {
        action: "abstain",
        questionNumber: 1,
        reason: "insufficient_absolute_evidence",
        metrics: metrics("A"),
      },
    ]
    const before = JSON.parse(JSON.stringify(decisions))
    captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: healthyResult(decisions),
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.ok(assertDecisionsUntouched(before, decisions))
  })
})

test("18. out / rescueResult no mutado", () => {
  withEnv({ [FLAG]: "1" }, () => {
    const result = healthyResult([])
    const before = JSON.stringify(result)
    captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: result,
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
    assert.equal(JSON.stringify(result), before)
  })
})

test("19. mismo runId en eventKeys de todas las páginas de la ejecución", () => {
  const runId = "run-shared-xyz"
  const k0 = tryBuildPrevalenceEventKey(baseCtx({ diagnosticRunId: runId, pageIndex: 0 }))
  const k1 = tryBuildPrevalenceEventKey(baseCtx({ diagnosticRunId: runId, pageIndex: 1 }))
  assert.ok(k0 && k1)
  assert.ok(k0.eventKey.startsWith(runId + "|"))
  assert.ok(k1.eventKey.startsWith(runId + "|"))
  assert.notEqual(k0.eventKey, k1.eventKey)
})

test("20. reevaluación genera runId diferente → eventKeys distintas", () => {
  const a = tryBuildPrevalenceEventKey(baseCtx({ diagnosticRunId: "run-1" }))
  const b = tryBuildPrevalenceEventKey(baseCtx({ diagnosticRunId: "run-2" }))
  assert.ok(a && b)
  assert.notEqual(a.eventKey, b.eventKey)
})

test("precedencia degradedReason documentada", () => {
  const base = {
    selectedCountAzure: 5,
    expectedQuestionCount: 7,
    reviewCandidateCount: 0,
    blankRowCountBefore: 0,
    autoRescueCandidateCount: 0,
    pageUsefulness: "usefulPage" as const,
  }
  assert.equal(
    assessDegradedPage({ ...base, pageAbstainReason: "grid_incomplete" }).degradedReason,
    "grid_incomplete",
  )
  assert.equal(
    assessDegradedPage({
      ...base,
      pageAbstainReason: null,
      selectedCountAzure: 1,
      reviewCandidateCount: 6,
    }).degradedReason,
    "severe_selected_deficit",
  )
  assert.equal(
    assessDegradedPage({
      ...base,
      pageAbstainReason: null,
      selectedCountAzure: 5,
      reviewCandidateCount: 3,
    }).degradedReason,
    "excessive_review_candidates",
  )
  assert.equal(
    assessDegradedPage({
      ...base,
      pageAbstainReason: null,
      selectedCountAzure: 5,
      reviewCandidateCount: 0,
      blankRowCountBefore: 3,
      autoRescueCandidateCount: 1,
    }).degradedReason,
    "excessive_blank_rows",
  )
  assert.equal(
    assessDegradedPage({
      ...base,
      pageAbstainReason: null,
      selectedCountAzure: 5,
      reviewCandidateCount: 3,
      expectedQuestionCount: 10,
    }).degradedReason,
    "excessive_review_candidates",
  )
  // high_review_ratio: 2/7 ≈ 0.286 < 0.30 → no; 3/7 already caught by excessive_review
  // For ratio alone without >2: need expected large so 2/6 > 0.30? 2/6=0.333, review=2 not >2
  assert.equal(
    assessDegradedPage({
      ...base,
      pageAbstainReason: null,
      selectedCountAzure: 5,
      reviewCandidateCount: 2,
      expectedQuestionCount: 6,
      blankRowCountBefore: 0,
    }).degradedReason,
    "high_review_ratio",
  )
})

test("identidad funcional: PREVALENCE 0 vs 1 no altera rescueResult", () => {
  const result = healthyResult([
    {
      action: "rescued_answer",
      questionNumber: 1,
      letter: "A",
      reason: "visual_dominant_clear",
      metrics: metrics("A"),
    },
  ])
  const snapshot = JSON.stringify(result)
  withEnv({ [FLAG]: "0" }, () => {
    captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: result,
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
  })
  assert.equal(JSON.stringify(result), snapshot)
  withEnv({ [FLAG]: "1" }, () => {
    captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: result,
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
  })
  assert.equal(JSON.stringify(result), snapshot)
})

/**
 * FASE 2A-3 — identidad funcional exacta (sin Azure).
 * A: PREVALENCE ausente/"0"  B: PREVALENCE "1"
 * Decisiones Shadow ya provistas en fixture; resultado funcional idéntico.
 * Única diferencia aceptable: presencia del log diagnóstico.
 */
test("2A-3 identidad funcional exacta A vs B (fixture Shadow)", () => {
  const decisions: VisualBlankRescueRowDecision[] = [
    {
      action: "rescued_answer",
      questionNumber: 2,
      letter: "B",
      reason: "visual_dominant_clear",
      metrics: metrics("B"),
    },
    {
      action: "abstain",
      questionNumber: 3,
      reason: "insufficient_absolute_evidence",
      metrics: metrics("C"),
    },
    ...Array.from({ length: 5 }, (_, i) => ({
      action: "no_action" as const,
      questionNumber: i === 0 ? 1 : i + 3,
      reason: "already_selected" as const,
    })),
  ]
  const proposedRows = [
    {
      questionNumber: 2,
      selectedAnswer: "B",
      visualBlankRescue: true as const,
      visualBlankRescueLetter: "B",
    },
  ]
  const functionalSnapshot = () => ({
    questionCount: decisions.length,
    questionNumbers: decisions.map((d) => d.questionNumber),
    actions: decisions.map((d) => d.action),
    reasons: decisions.map((d) => d.reason),
    lettersInDecisions: decisions.map((d) =>
      d.action === "rescued_answer" ? d.letter : undefined,
    ),
    proposedRows: JSON.parse(JSON.stringify(proposedRows)),
    visualBlankRescue: proposedRows.map((r) => r.visualBlankRescue),
    selectedAnswers: proposedRows.map((r) => r.selectedAnswer),
    confidenceProxy: decisions.map((d) => {
      if (d.action === "rescued_answer" || d.action === "abstain") {
        return d.metrics
          ? { marginDarkRatio: d.metrics.marginDarkRatio }
          : null
      }
      return null
    }),
    blankFlags: decisions.map(
      (d) => !(d.action === "no_action" && d.reason === "already_selected"),
    ),
    scoringInputProxy: {
      perQuestion: decisions.map((d) => ({
        questionNumber: d.questionNumber,
        selectedAnswer:
          d.action === "rescued_answer"
            ? d.letter
            : d.action === "no_action" && d.reason === "already_selected"
              ? "SELECTED"
              : "BLANK",
      })),
    },
  })

  const result = healthyResult(decisions, {
    selectedCountAzure: 5,
    blankRowCountBefore: 2,
    proposedRows: proposedRows as VisualBlankRescuePageResult["proposedRows"],
  })
  const before = JSON.stringify(result)
  const snapA = functionalSnapshot()

  let logsOff: string[] = []
  withEnv({ [FLAG]: undefined }, () => {
    logsOff = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: result,
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
  })
  assert.equal(logsOff.length, 0)
  assert.equal(JSON.stringify(result), before)
  assert.deepEqual(functionalSnapshot(), snapA)

  let logsOn: string[] = []
  withEnv({ [FLAG]: "1" }, () => {
    logsOn = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: result,
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
  })
  assert.equal(logsOn.length, 1)
  assert.ok(logsOn[0]!.startsWith(PREVALENCE_LOG_PREFIX))
  assert.equal(JSON.stringify(result), before)
  assert.deepEqual(functionalSnapshot(), snapA)

  // Flag "0" idéntico a ausente
  let logsZero: string[] = []
  withEnv({ [FLAG]: "0" }, () => {
    logsZero = captureLogs(() => {
      recordVisualVerificationPrevalence({
        diagnosticContext: baseCtx(),
        rescueMode: "shadow",
        rescueResult: result,
        expectedQuestionCount: 7,
        expectedOptionCount: 4,
        imageAvailableInMemory: true,
      })
    })
  })
  assert.equal(logsZero.length, 0)
  assert.deepEqual(functionalSnapshot(), snapA)

  // PREVALENCE no activa Shadow/APPLY
  withEnv({ [FLAG]: "1", [SHADOW]: undefined, [APPLY]: undefined }, () => {
    assert.equal(isVisualVerificationPrevalenceEnabled(), true)
    assert.notEqual(process.env[SHADOW], "1")
    assert.notEqual(process.env[APPLY], "1")
  })
})

async function main(): Promise<void> {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`ok - ${t.name}`)
    } catch (e) {
      failed++
      console.error(`fail - ${t.name}`)
      console.error(e)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
