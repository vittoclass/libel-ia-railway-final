/**

 * Misma forma de salida que extractStudentClosedAnswersAzureLayoutOfficial (adaptador evaluate).

 */

import { runInterleavedAzureLayoutOmrPipeline } from "./run-interleaved-pipeline"

import type { InterleavedPipelineForensicReport } from "./interleaved-pipeline-forensics"

import type { OmrTemplateVariantInterleaved } from "./types"

import { normalizeToCanonicalId } from "../canonical-closed-id"
import { dedupeInterleavedPerQuestionForOfficialOutput } from "./dedupe-interleaved-per-question-official"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"



export async function extractStudentClosedAnswersInterleavedLayout(params: {

  studentImageBase64: string

  teacherAnswerKey: Array<{ pregunta: string; respuestaCorrecta: string }>

  closedQuestionIds: string[]

  expectedOptionCount?: number

  expectedQuestionCount?: number

  authoritativeOmrQuestionCount?: number

  templateKey: string

  templateVariant?: OmrTemplateVariantInterleaved

  /**
   * Orden físico completo SM/P/… desde pauta estructurada.
   * Si se omite, se deduce solo desde teacherAnswerKey (suele ser solo cerradas).
   */
  hybridStructuredQuestionOrder?: string[]

  /**
   * Si true (p. ej. omrClosedLayoutMode === interleaved_development), no reintento cerradas-only
   * ante INTERLEAVED_HYBRID_SLOT_MISMATCH (sin recuperación silenciosa).
   */
  suppressHybridSoftMismatchRecovery?: boolean

}): Promise<{

  detectedAnswers: { pregunta: string; respuesta_detectada: string; confianza: number }[]

  officialOmrPerQuestionRaw: any[]

  officialOmrDetectedAnswersPreview: Array<{ pregunta: string; respuesta_detectada: string; confianza: number }>

  officialOmrQuestionCountFromPipeline: number

  officialOmrDetectedAnswersCount: number

  officialOmrDetectedVsPipelineMismatch: boolean

  officialOmrAdapterMode: "direct_passthrough_from_experimental"

  interleavedPipelineForensics?: InterleavedPipelineForensicReport

  interleavedPartialStructuralSurvival?: boolean

  interleavedRecoveryPassthrough?: boolean

  interleavedOfficialOutputSanitization?: {
    droppedGhostRowsCount: number
    sanitizedFromPipelineCount: number
    sanitizedToExpectedCount: number
    duplicateCanonicalIdsResolved: number
    paddingRowsAdded: number
  }

  omrTemplateVariantRequested?: string

  omrTemplateVariantEffective?: string

}> {

  const raw = params.studentImageBase64.replace(/^data:image\/\w+;base64,/, "").trim()

  const imageBuffer = Buffer.from(raw, "base64")

  const expectation =

    typeof params.expectedQuestionCount === "number" && params.expectedQuestionCount > 0

      ? params.expectedQuestionCount

      : undefined



  const closedIds =

    params.closedQuestionIds.length > 0

      ? params.closedQuestionIds

      : params.teacherAnswerKey.map((r) => String(r?.pregunta ?? "").trim()).filter(Boolean)



  const fromPautaOrder =
    Array.isArray(params.hybridStructuredQuestionOrder) && params.hybridStructuredQuestionOrder.length > 0
      ? params.hybridStructuredQuestionOrder.map((s) => String(s ?? "").trim()).filter(Boolean)
      : undefined

  if (
    params.suppressHybridSoftMismatchRecovery === true &&
    (!fromPautaOrder || fromPautaOrder.length === 0)
  ) {
    throw new Error(
      "[INTERLEAVED_INVALID_STRUCTURED_ORDER] " +
        "Modo intercalado forzado requiere hybridStructuredQuestionOrder (pauta estructurada).",
    )
  }

  const fullStructuredQuestionOrder =
    fromPautaOrder && fromPautaOrder.length > 0
      ? fromPautaOrder
      : params.teacherAnswerKey.length > 0
        ? params.teacherAnswerKey.map((r) => String(r?.pregunta ?? "").trim()).filter(Boolean)
        : undefined



  const interleaved = await runInterleavedAzureLayoutOmrPipeline({

    imageBuffer,

    templateKey: params.templateKey,

    ...(expectation !== undefined ? { expectedQuestionCount: expectation } : {}),

    ...(typeof params.expectedOptionCount === "number" ? { expectedOptionCount: params.expectedOptionCount } : {}),

    canonicalWidth: 1200,

    canonicalHeight: 1700,

    omrTemplateVariant: params.templateVariant ?? "odd_even_dual_column",

    closedQuestionIds: closedIds,

    ...(fullStructuredQuestionOrder?.length ? { hybridStructuredQuestionOrder: fullStructuredQuestionOrder } : {}),

  })

  const softMismatchEnabled = String(process.env.INTERLEAVED_SOFT_MISMATCH ?? "")
    .trim()
    .toLowerCase() === "true"
  const baseInterleavedErrorCode = String((interleaved as any)?.errorCode ?? "")
  const canSoftRecoverHybridMismatch =
    !params.suppressHybridSoftMismatchRecovery &&
    softMismatchEnabled &&
    baseInterleavedErrorCode === "INTERLEAVED_HYBRID_SLOT_MISMATCH"
  let effectiveInterleaved: Record<string, unknown> | null = interleaved as Record<string, unknown>



  if (!interleaved || (interleaved as any).success !== true) {
    if (canSoftRecoverHybridMismatch) {
      // Guard reversible: degradacion local al mapeo cerrado-only
      // cuando falta algun slot en el orden hibrido estructurado.
      console.warn(
        `[interleaved_omr][soft_mismatch] ${baseInterleavedErrorCode} -> retry closed-only; template=${params.templateKey}`,
        {
          error: String((interleaved as any)?.error ?? ""),
          closedCount: closedIds.length,
        },
      )
      const retryClosedOnly = await runInterleavedAzureLayoutOmrPipeline({
        imageBuffer,
        templateKey: params.templateKey,
        ...(expectation !== undefined ? { expectedQuestionCount: expectation } : {}),
        ...(typeof params.expectedOptionCount === "number" ? { expectedOptionCount: params.expectedOptionCount } : {}),
        canonicalWidth: 1200,
        canonicalHeight: 1700,
        omrTemplateVariant: params.templateVariant ?? "odd_even_dual_column",
        closedQuestionIds: closedIds,
      })
      if (retryClosedOnly && (retryClosedOnly as any).success === true) {
        console.warn(
          `[interleaved_omr][soft_mismatch] recovered with closed-only topology; template=${params.templateKey}`,
        )
        effectiveInterleaved = retryClosedOnly as Record<string, unknown>
      } else {
        console.warn(
          `[interleaved_omr][soft_mismatch] closed-only retry failed; preserving legacy fallback path`,
          {
            errorCode: String((retryClosedOnly as any)?.errorCode ?? "UNKNOWN"),
            error: String((retryClosedOnly as any)?.error ?? "fallo lectura"),
          },
        )
      }
    }
  }

  if (!effectiveInterleaved || (effectiveInterleaved as any).success !== true) {
    if ((effectiveInterleaved as any)?.errorCode === "AZURE_LAYOUT_NOT_CONFIGURED") {

      throw new Error("[interleaved_omr] Azure no configurado")

    }

    const failCode = String((effectiveInterleaved as any)?.errorCode ?? "")
    const omrClosedAnswers = (effectiveInterleaved as any)?.omrClosedAnswers
    const rows: unknown[] = Array.isArray((effectiveInterleaved as any)?.perQuestion)
      ? ((effectiveInterleaved as any).perQuestion as unknown[])
      : []

    if (
      failCode === "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE" &&
      Array.isArray(omrClosedAnswers) &&
      omrClosedAnswers.length > 0 &&
      rows.length === 0
    ) {
      console.warn(
        "[INTERLEAVED_RECOVERY] No se pudieron materializar filas híbridas. " +
          "Se utilizará passthrough universal de omrClosedAnswers.",
      )

      const first = omrClosedAnswers[0] as Record<string, unknown> | undefined
      const looksLikePipelineRow =
        first &&
        typeof first === "object" &&
        ("selectedAnswer" in first || "confidencesByColumn" in first)

      const recoveredPerQuestion: Array<Record<string, unknown>> = looksLikePipelineRow
        ? (omrClosedAnswers as Array<Record<string, unknown>>)
        : omrClosedAnswers.map((item: Record<string, unknown>, index: number) => {
            const numFromCanonical = parseClosedIdNumericSlot(
              String(item.canonicalId ?? item.pregunta ?? ""),
            )
            const numericId =
              typeof item.questionNumber === "number"
                ? item.questionNumber
                : numFromCanonical ?? index + 1
            return {
            questionNumber: numericId,
            physicalIndex: numericId,

            pregunta: item.pregunta ?? item.canonicalId ?? `C${numericId}`,

            selectedAnswer: String(
              item.respuesta_detectada ?? item.selectedAnswer ?? "",
            )
              .trim()
              .toUpperCase(),

            respuesta: item.respuesta ?? item.selectedAnswer ?? "",

            confidencesByColumn:
              item.confidencesByColumn && typeof item.confidencesByColumn === "object"
                ? item.confidencesByColumn
                : {},

            confidence: typeof item.confidence === "number" ? item.confidence : 0.92,

            source: "interleaved_recovery_passthrough",

            interleavedRecovery: true,
          }
          })

      effectiveInterleaved = {
        ...(effectiveInterleaved as Record<string, unknown>),
        success: true,
        perQuestion: recoveredPerQuestion,
        closedOmrQuestionCountUsed: recoveredPerQuestion.length,
        interleavedRecoveryPassthrough: true,
      } as Record<string, unknown>
    } else {
      throw new Error(

        `[interleaved_omr] ${String((effectiveInterleaved as any)?.errorCode ?? "UNKNOWN")} ${String((effectiveInterleaved as any)?.error ?? "falló lectura")}`,

      )
    }

  }



  const pipelinePerQuestionRaw = Array.isArray((effectiveInterleaved as any).perQuestion)
    ? (effectiveInterleaved as any).perQuestion
    : []

  if (pipelinePerQuestionRaw.length === 0) {

    throw new Error("[interleaved_omr] pipeline devolvió 0 preguntas detectadas")

  }



  /** El pipeline debe materializar tantas filas como ítems cerrados OMR, no como total físico híbrido. */

  const expectedOmrClosedRows =

    typeof (effectiveInterleaved as any).closedOmrQuestionCountUsed === "number"

      ? (effectiveInterleaved as any).closedOmrQuestionCountUsed

      : closedIds.length

  const officialOutputExpectation =
    expectation ?? (expectedOmrClosedRows > 0 ? expectedOmrClosedRows : closedIds.length)
  const expectedClosedCanonicalIds = closedIds
    .map((id) => normalizeToCanonicalId(id))
    .filter((id): id is string => Boolean(id))

  const { perQuestion, sanitization: interleavedOfficialOutputSanitization } =
    dedupeInterleavedPerQuestionForOfficialOutput(
      pipelinePerQuestionRaw as Array<Record<string, unknown>>,
      officialOutputExpectation > 0 ? officialOutputExpectation : pipelinePerQuestionRaw.length,
      expectedClosedCanonicalIds.length > 0 ? expectedClosedCanonicalIds : undefined,
    )

  const physicalHybrid =

    typeof (effectiveInterleaved as any).hybridPhysicalSlotCount === "number"

      ? (effectiveInterleaved as any).hybridPhysicalSlotCount

      : null

  const auth = params.authoritativeOmrQuestionCount

  const partialStructuralSurvival = (effectiveInterleaved as any).interleavedPartialStructuralSurvival === true



  if (

    typeof auth === "number" &&

    auth > 0 &&

    physicalHybrid != null &&

    auth === physicalHybrid &&

    auth !== expectedOmrClosedRows

  ) {

    /** authoritative = total físico en pautas híbridas → validar contra cerradas materializadas. */

    if (perQuestion.length !== expectedOmrClosedRows && !partialStructuralSurvival) {

      throw new Error(

        `[interleaved_omr] Layout Mismatch (híbrido) pipeline=${perQuestion.length} cerradas_OMR_esperadas=${expectedOmrClosedRows} authoritative_físico=${auth}`,

      )

    }

  } else if (expectedOmrClosedRows > 0 && perQuestion.length !== expectedOmrClosedRows && !partialStructuralSurvival) {

    throw new Error(

      `[interleaved_omr] Layout Mismatch pipeline=${perQuestion.length} esperado_cerradas_OMR=${expectedOmrClosedRows}`,

    )

  }



  for (const q of perQuestion) {
    if (q && typeof q === "object" && typeof q.canonicalId === "string") {
      const n = parseClosedIdNumericSlot(q.canonicalId)
      if (
        n != null &&
        (q.questionNumber !== n || q.physicalIndex !== n)
      ) {
        throw new Error(
          `REGLA_DE_ORO_IDENTITY_VIOLATION: questionNumber=${q.questionNumber}, physicalIndex=${q.physicalIndex}, canonicalId=${q.canonicalId}`,
        )
      }
    }
  }

  const sorted = [...perQuestion].sort(

    (a, b) => Number(a?.questionNumber ?? 0) - Number(b?.questionNumber ?? 0),

  )



  const out: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []

  let rowOrdinal = 0

  for (const row of sorted) {

    const qn = Number(row?.questionNumber ?? 0)

    if (qn < 1) continue

    const canonRaw =

      row && typeof row === "object" && typeof (row as any).canonicalId === "string"

        ? String((row as any).canonicalId).trim()

        : ""

    const fromClosedAtPos = params.closedQuestionIds[rowOrdinal]

    const fromTeacherAtPos = params.teacherAnswerKey[rowOrdinal]?.pregunta

    rowOrdinal++

    const keyId =

      normalizeToCanonicalId(canonRaw) ||

      normalizeToCanonicalId(fromClosedAtPos) ||

      normalizeToCanonicalId(fromTeacherAtPos) ||

      normalizeToCanonicalId(`C${qn}`) ||

      `C${qn}`

    const ansRaw = String(row?.selectedAnswer ?? "").trim().toUpperCase()

    const confidenceMapRaw =

      row && typeof row === "object" && row.confidencesByColumn && typeof row.confidencesByColumn === "object"

        ? (row.confidencesByColumn as Record<string, unknown>)

        : {}

    const confidenceEntries = Object.entries(confidenceMapRaw)

      .map(([k, v]) => [String(k).toUpperCase(), Number(v)] as const)

      .filter(([k, v]) => /^[A-Z]$/.test(k) && Number.isFinite(v))

      .sort((a, b) => b[1] - a[1])

    const bestByConfidence = confidenceEntries[0]?.[0] ?? ""

    const ans =

      ansRaw === "MULTIPLE"

        ? bestByConfidence || "BLANK"

        : ansRaw === "" || ansRaw === "SIN_RESPUESTA" || ansRaw === "BLANK"

          ? "BLANK"

          : ansRaw

    const isBlankLike = ans === "BLANK" || ans === "SIN_RESPUESTA" || ans === ""

    out.push({

      pregunta: keyId,

      respuesta_detectada: ans,

      confianza: isBlankLike ? 0.4 : 0.92,

    })

  }

  if (out.length === 0) {

    throw new Error("[interleaved_omr] adapter devolvió 0 respuestas detectadas")

  }



  const effVariant = (effectiveInterleaved as any)?.omrTemplateVariantEffective
  const reqVariant = (effectiveInterleaved as any)?.omrTemplateVariantRequested
  const autoDiag = (effectiveInterleaved as any)?.omrTemplateVariantAutoDiagnostics

  return {

    detectedAnswers: out,

    officialOmrPerQuestionRaw: perQuestion,

    officialOmrDetectedAnswersPreview: out.slice(0, 12),

    officialOmrQuestionCountFromPipeline: perQuestion.length,

    officialOmrDetectedAnswersCount: out.length,

    officialOmrDetectedVsPipelineMismatch: out.length !== perQuestion.length,

    officialOmrAdapterMode: "direct_passthrough_from_experimental",

    ...(typeof effVariant === "string" ? { omrTemplateVariantEffective: effVariant } : {}),

    ...(typeof reqVariant === "string" ? { omrTemplateVariantRequested: reqVariant } : {}),

    ...(autoDiag && typeof autoDiag === "object" ? { omrTemplateVariantAutoDiagnostics: autoDiag } : {}),

    ...((effectiveInterleaved as any).interleavedPipelineForensics

      ? { interleavedPipelineForensics: (effectiveInterleaved as any).interleavedPipelineForensics }

      : {}),

    ...(partialStructuralSurvival ? { interleavedPartialStructuralSurvival: true } : {}),

    ...((effectiveInterleaved as any).interleavedRecoveryPassthrough === true
      ? { interleavedRecoveryPassthrough: true }
      : {}),

    ...(interleavedOfficialOutputSanitization.droppedGhostRowsCount > 0 ||
    interleavedOfficialOutputSanitization.duplicateCanonicalIdsResolved > 0 ||
    interleavedOfficialOutputSanitization.sanitizedFromPipelineCount !==
      interleavedOfficialOutputSanitization.sanitizedToExpectedCount
      ? { interleavedOfficialOutputSanitization }
      : {}),

    ...(typeof (effectiveInterleaved as any).interleavedStructuralShiftDetected === "boolean" ||
    typeof (effectiveInterleaved as any).interleavedStructuralRealignmentApplied === "boolean" ||
    (effectiveInterleaved as any).interleavedStructuralShiftOffset != null
      ? {
          interleavedStructuralShiftDetected:
            (effectiveInterleaved as any).interleavedStructuralShiftDetected === true,
          interleavedStructuralShiftOffset:
            typeof (effectiveInterleaved as any).interleavedStructuralShiftOffset === "number" &&
            Number.isFinite((effectiveInterleaved as any).interleavedStructuralShiftOffset)
              ? (effectiveInterleaved as any).interleavedStructuralShiftOffset
              : null,
          interleavedStructuralRealignmentApplied:
            (effectiveInterleaved as any).interleavedStructuralRealignmentApplied === true,
        }
      : {}),

    ...(typeof (effectiveInterleaved as any).interleavedDetectionGeometryRefineApplied === "boolean" ||
    typeof (effectiveInterleaved as any).interleavedDetectionGeometryRefineRollback === "boolean"
      ? {
          interleavedDetectionGeometryRefineApplied:
            (effectiveInterleaved as any).interleavedDetectionGeometryRefineApplied === true,
          interleavedDetectionGeometryRefineRollback:
            (effectiveInterleaved as any).interleavedDetectionGeometryRefineRollback === true,
          ...(typeof (effectiveInterleaved as any).interleavedDetectionGeometryRefinePanelsProcessed === "number" &&
          Number.isFinite((effectiveInterleaved as any).interleavedDetectionGeometryRefinePanelsProcessed)
            ? {
                interleavedDetectionGeometryRefinePanelsProcessed: (effectiveInterleaved as any)
                  .interleavedDetectionGeometryRefinePanelsProcessed,
              }
            : {}),
          ...(typeof (effectiveInterleaved as any).interleavedDetectionGeometryRefineConservativeEnabled === "boolean"
            ? {
                interleavedDetectionGeometryRefineConservativeEnabled:
                  (effectiveInterleaved as any).interleavedDetectionGeometryRefineConservativeEnabled,
                interleavedDetectionGeometryRefineProtectedCount:
                  (effectiveInterleaved as any).interleavedDetectionGeometryRefineProtectedCount ?? 0,
                interleavedDetectionGeometryRefineRefinedCount:
                  (effectiveInterleaved as any).interleavedDetectionGeometryRefineRefinedCount ?? 0,
              }
            : {}),
        }
      : {}),

  }

}


