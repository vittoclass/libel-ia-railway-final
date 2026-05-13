/**
 * Mapeo final definitivo: filas físicas ordenadas visualmente → closedQuestionIds
 * en orden oficial del inventario cerrado.
 *
 * Esta función se ejecuta como ÚLTIMO paso antes de la salida final del pipeline
 * interleaved. No modifica OMR clásico, OCR, scoring, evaluación ni UI.
 *
 * Reversible: INTERLEAVED_CLOSED_INVENTORY_FINAL_MAP=0 desactiva completamente.
 * Rollback automático si falla cualquier validación.
 */
import { isInterleavedClosedInventoryFinalMapEnabled, isInterleavedUniversalPhysicalMapEnabled } from "./env"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"
import { sortDecodedForRebuild } from "./rebuildQuestionSequence"
import type { RebuildQuestionSortOrder } from "./rebuildQuestionSequence"
import type { OmrTemplateVariantInterleaved } from "./types"
import { resolveUniversalPhysicalMapping, type UniversalMappingTelemetry, type PhysicalNumberPreservedTelemetry } from "./universal-physical-mapping"
import type { HybridSlotDescriptor } from "./hybrid-slot-topology"

export type ClosedInventoryRowTelemetry = {
  visualOrderIndexGlobal: number
  panelIndex: number
  rowIndexWithinPanel: number
  selectedAnswer: string
  selectedMarkX: number | null
  selectedMarkY: number | null
  physicalIndexBefore: number | null
  canonicalIdBefore: string | null
  physicalIndexAfter: number
  canonicalIdAfter: string
  expectedCanonicalIdFromClosedInventory: string
  expectedPhysicalIndexFromClosedInventory: number
  mappingMatchesClosedInventory: boolean
  mappingSource: "closed_inventory_order" | "rollback_preserved"
  wasRemapped: boolean
}

export type ClosedInventoryFinalMappingTelemetry = {
  closedInventoryFinalMapEnabled: boolean
  closedInventoryFinalMapApplied: boolean
  closedInventoryFinalMapRollback: boolean
  closedInventoryFinalMapRollbackReason: string | null
  closedInventoryRowCount: number
  closedInventoryExpectedCount: number
  closedInventoryMismatchCountBefore: number
  closedInventoryMismatchCountAfter: number
  closedInventoryAllMatchAfter: boolean
  closedInventoryRowTelemetry: ClosedInventoryRowTelemetry[]
  universalMapping?: UniversalMappingTelemetry
  physicalNumberPreserved?: PhysicalNumberPreservedTelemetry
}

function emptyTelemetry(reason?: string): ClosedInventoryFinalMappingTelemetry {
  return {
    closedInventoryFinalMapEnabled: false,
    closedInventoryFinalMapApplied: false,
    closedInventoryFinalMapRollback: false,
    closedInventoryFinalMapRollbackReason: reason ?? null,
    closedInventoryRowCount: 0,
    closedInventoryExpectedCount: 0,
    closedInventoryMismatchCountBefore: 0,
    closedInventoryMismatchCountAfter: 0,
    closedInventoryAllMatchAfter: false,
    closedInventoryRowTelemetry: [],
  }
}

function sortOrderForVariant(variant: OmrTemplateVariantInterleaved): RebuildQuestionSortOrder {
  return variant === "sequential_dual_column" ? "panel_then_y" : "y_then_panel"
}

function normId(id: string): string {
  return String(id ?? "").trim()
}

/**
 * Mapeo final universal: ordena filas por posición visual real y asigna
 * canonicalId/physicalIndex usando closedQuestionIds como fuente de verdad.
 *
 * Seguridad:
 * - Si closedQuestionIds.length !== filas cerradas detectadas → NO aplicar, rollback.
 * - Si detecta duplicados canonicalId tras mapeo → NO aplicar, rollback.
 * - Si detecta canonicalId fuera del inventario → NO aplicar, rollback.
 * - Feature flag: INTERLEAVED_CLOSED_INVENTORY_FINAL_MAP=0 desactiva.
 */
export function applyClosedInventoryFinalMapping(params: {
  perQuestion: Array<Record<string, unknown>>
  closedQuestionIds: string[]
  variant: OmrTemplateVariantInterleaved
  totalPhysicalSlots?: number
  hybridSlotDescriptors?: HybridSlotDescriptor[]
}): {
  perQuestion: Array<Record<string, unknown>>
  telemetry: ClosedInventoryFinalMappingTelemetry
} {
  const { closedQuestionIds, variant } = params
  const original = params.perQuestion

  if (!isInterleavedClosedInventoryFinalMapEnabled()) {
    return {
      perQuestion: original,
      telemetry: emptyTelemetry("feature_flag_disabled"),
    }
  }

  const closedIds = closedQuestionIds.map(normId).filter(Boolean)
  if (closedIds.length === 0) {
    return {
      perQuestion: original,
      telemetry: emptyTelemetry("empty_closed_question_ids"),
    }
  }

  const closedRows = original.filter(
    (r) => r && typeof r === "object" && r.interleavedPipeline === true,
  )
  const workingRows = closedRows.length > 0 ? closedRows : original

  if (workingRows.length !== closedIds.length) {
    // Before rollback, attempt physical-number-preserved mapping if applicable
    if (isInterleavedUniversalPhysicalMapEnabled()) {
      const universalPhysPreserved = resolveUniversalPhysicalMapping({
        rows: workingRows,
        closedQuestionIds: closedIds,
        preferredVariant: variant,
        totalPhysicalSlots: params.totalPhysicalSlots,
        hybridSlotDescriptors: params.hybridSlotDescriptors,
      })

      if (universalPhysPreserved.success) {
        const finalRows = universalPhysPreserved.orderedRows
        const rowTelemetryEntries: ClosedInventoryRowTelemetry[] = finalRows.map((row, i) => {
          const targetClosedId = closedIds[i] ?? ""
          const targetNumeric = parseClosedIdNumericSlot(targetClosedId) ?? i + 1
          const panelIndex = typeof row.panelIndex === "number" ? row.panelIndex : 0
          const rowIdxPanel = typeof row.rowIndexWithinPanel === "number" ? row.rowIndexWithinPanel : i
          const selectedAnswer = typeof row.selectedAnswer === "string" ? row.selectedAnswer : "BLANK"
          return {
            visualOrderIndexGlobal: i,
            panelIndex,
            rowIndexWithinPanel: rowIdxPanel,
            selectedAnswer,
            selectedMarkX: extractMarkCoord(row, "x"),
            selectedMarkY: extractMarkCoord(row, "y"),
            physicalIndexBefore: universalPhysPreserved.telemetry.mappingBefore[i]?.physicalIndex ?? null,
            canonicalIdBefore: universalPhysPreserved.telemetry.mappingBefore[i]?.canonicalId ?? null,
            physicalIndexAfter: targetNumeric,
            canonicalIdAfter: targetClosedId,
            expectedCanonicalIdFromClosedInventory: targetClosedId,
            expectedPhysicalIndexFromClosedInventory: targetNumeric,
            mappingMatchesClosedInventory: true,
            mappingSource: "closed_inventory_order" as const,
            wasRemapped: universalPhysPreserved.telemetry.mappingBefore[i]?.canonicalId !== targetClosedId,
          }
        })

        return {
          perQuestion: finalRows,
          telemetry: {
            closedInventoryFinalMapEnabled: true,
            closedInventoryFinalMapApplied: true,
            closedInventoryFinalMapRollback: false,
            closedInventoryFinalMapRollbackReason: null,
            closedInventoryRowCount: finalRows.length,
            closedInventoryExpectedCount: closedIds.length,
            closedInventoryMismatchCountBefore: rowTelemetryEntries.filter((r) => r.wasRemapped).length,
            closedInventoryMismatchCountAfter: 0,
            closedInventoryAllMatchAfter: true,
            closedInventoryRowTelemetry: rowTelemetryEntries,
            universalMapping: universalPhysPreserved.telemetry,
            physicalNumberPreserved: universalPhysPreserved.telemetry.physicalNumberPreserved,
          },
        }
      }
    }

    const rowTelemetry = buildPreMappingTelemetry(workingRows, closedIds, variant)
    return {
      perQuestion: original,
      telemetry: {
        closedInventoryFinalMapEnabled: true,
        closedInventoryFinalMapApplied: false,
        closedInventoryFinalMapRollback: true,
        closedInventoryFinalMapRollbackReason:
          `count_mismatch: detected=${workingRows.length} expected=${closedIds.length}`,
        closedInventoryRowCount: workingRows.length,
        closedInventoryExpectedCount: closedIds.length,
        closedInventoryMismatchCountBefore: rowTelemetry.mismatchCount,
        closedInventoryMismatchCountAfter: rowTelemetry.mismatchCount,
        closedInventoryAllMatchAfter: false,
        closedInventoryRowTelemetry: rowTelemetry.rows,
      },
    }
  }

  if (isInterleavedUniversalPhysicalMapEnabled()) {
    const universalResult = resolveUniversalPhysicalMapping({
      rows: workingRows,
      closedQuestionIds: closedIds,
      preferredVariant: variant,
      totalPhysicalSlots: params.totalPhysicalSlots,
      hybridSlotDescriptors: params.hybridSlotDescriptors,
    })

    if (universalResult.success) {
      const finalRows = universalResult.orderedRows
      const rowTelemetryEntries: ClosedInventoryRowTelemetry[] = finalRows.map((row, i) => {
        const targetClosedId = closedIds[i] ?? ""
        const targetNumeric = parseClosedIdNumericSlot(targetClosedId) ?? i + 1
        const panelIndex = typeof row.panelIndex === "number" ? row.panelIndex : 0
        const rowIdxPanel = typeof row.rowIndexWithinPanel === "number" ? row.rowIndexWithinPanel : i
        const selectedAnswer = typeof row.selectedAnswer === "string" ? row.selectedAnswer : "BLANK"
        return {
          visualOrderIndexGlobal: i,
          panelIndex,
          rowIndexWithinPanel: rowIdxPanel,
          selectedAnswer,
          selectedMarkX: extractMarkCoord(row, "x"),
          selectedMarkY: extractMarkCoord(row, "y"),
          physicalIndexBefore: universalResult.telemetry.mappingBefore[i]?.physicalIndex ?? null,
          canonicalIdBefore: universalResult.telemetry.mappingBefore[i]?.canonicalId ?? null,
          physicalIndexAfter: targetNumeric,
          canonicalIdAfter: targetClosedId,
          expectedCanonicalIdFromClosedInventory: targetClosedId,
          expectedPhysicalIndexFromClosedInventory: targetNumeric,
          mappingMatchesClosedInventory: true,
          mappingSource: "closed_inventory_order" as const,
          wasRemapped: universalResult.telemetry.mappingBefore[i]?.canonicalId !== targetClosedId,
        }
      })

      return {
        perQuestion: finalRows,
        telemetry: {
          closedInventoryFinalMapEnabled: true,
          closedInventoryFinalMapApplied: true,
          closedInventoryFinalMapRollback: false,
          closedInventoryFinalMapRollbackReason: null,
          closedInventoryRowCount: finalRows.length,
          closedInventoryExpectedCount: closedIds.length,
          closedInventoryMismatchCountBefore: rowTelemetryEntries.filter((r) => r.wasRemapped).length,
          closedInventoryMismatchCountAfter: 0,
          closedInventoryAllMatchAfter: true,
          closedInventoryRowTelemetry: rowTelemetryEntries,
          universalMapping: universalResult.telemetry,
        },
      }
    }

    const preTelemetry = buildPreMappingTelemetry(workingRows, closedIds, variant)
    return {
      perQuestion: original,
      telemetry: {
        closedInventoryFinalMapEnabled: true,
        closedInventoryFinalMapApplied: false,
        closedInventoryFinalMapRollback: true,
        closedInventoryFinalMapRollbackReason:
          universalResult.telemetry.rollbackReason ?? "universal_mapping_failed",
        closedInventoryRowCount: workingRows.length,
        closedInventoryExpectedCount: closedIds.length,
        closedInventoryMismatchCountBefore: preTelemetry.mismatchCount,
        closedInventoryMismatchCountAfter: preTelemetry.mismatchCount,
        closedInventoryAllMatchAfter: false,
        closedInventoryRowTelemetry: preTelemetry.rows,
        universalMapping: universalResult.telemetry,
      },
    }
  }

  const sortOrder = sortOrderForVariant(variant)
  const sorted = sortDecodedForRebuild([...workingRows], sortOrder)

  const mappedRows: Array<Record<string, unknown>> = []
  const rowTelemetryEntries: ClosedInventoryRowTelemetry[] = []
  const seenCanonicals = new Set<string>()
  let mismatchCountBefore = 0

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!
    const targetClosedId = closedIds[i]!
    const targetNumeric = parseClosedIdNumericSlot(targetClosedId)

    if (targetNumeric == null || targetNumeric < 1) {
      const preTelemetry = buildPreMappingTelemetry(workingRows, closedIds, variant)
      return {
        perQuestion: original,
        telemetry: {
          closedInventoryFinalMapEnabled: true,
          closedInventoryFinalMapApplied: false,
          closedInventoryFinalMapRollback: true,
          closedInventoryFinalMapRollbackReason:
            `invalid_numeric_in_closed_id: "${targetClosedId}" at index ${i}`,
          closedInventoryRowCount: workingRows.length,
          closedInventoryExpectedCount: closedIds.length,
          closedInventoryMismatchCountBefore: preTelemetry.mismatchCount,
          closedInventoryMismatchCountAfter: preTelemetry.mismatchCount,
          closedInventoryAllMatchAfter: false,
          closedInventoryRowTelemetry: preTelemetry.rows,
        },
      }
    }

    if (seenCanonicals.has(targetClosedId)) {
      const preTelemetry = buildPreMappingTelemetry(workingRows, closedIds, variant)
      return {
        perQuestion: original,
        telemetry: {
          closedInventoryFinalMapEnabled: true,
          closedInventoryFinalMapApplied: false,
          closedInventoryFinalMapRollback: true,
          closedInventoryFinalMapRollbackReason:
            `duplicate_canonical_id: "${targetClosedId}" at index ${i}`,
          closedInventoryRowCount: workingRows.length,
          closedInventoryExpectedCount: closedIds.length,
          closedInventoryMismatchCountBefore: preTelemetry.mismatchCount,
          closedInventoryMismatchCountAfter: preTelemetry.mismatchCount,
          closedInventoryAllMatchAfter: false,
          closedInventoryRowTelemetry: preTelemetry.rows,
        },
      }
    }
    seenCanonicals.add(targetClosedId)

    const prevCanonical = typeof row.canonicalId === "string" ? row.canonicalId : null
    const prevPhysical = typeof row.physicalIndex === "number" ? row.physicalIndex : null
    const wasAlreadyCorrect = prevCanonical === targetClosedId

    if (!wasAlreadyCorrect) mismatchCountBefore++

    const rowCenterY = typeof row.rowCenterY === "number" ? row.rowCenterY : null
    const panelIndex = typeof row.panelIndex === "number" ? row.panelIndex : 0
    const rowIdxPanel = typeof row.rowIndexWithinPanel === "number" ? row.rowIndexWithinPanel : i
    const selectedAnswer = typeof row.selectedAnswer === "string" ? row.selectedAnswer : "BLANK"

    const markX = extractMarkCoord(row, "x")
    const markY = extractMarkCoord(row, "y")

    rowTelemetryEntries.push({
      visualOrderIndexGlobal: i,
      panelIndex,
      rowIndexWithinPanel: rowIdxPanel,
      selectedAnswer,
      selectedMarkX: markX,
      selectedMarkY: markY ?? rowCenterY,
      physicalIndexBefore: prevPhysical,
      canonicalIdBefore: prevCanonical,
      physicalIndexAfter: targetNumeric,
      canonicalIdAfter: targetClosedId,
      expectedCanonicalIdFromClosedInventory: targetClosedId,
      expectedPhysicalIndexFromClosedInventory: targetNumeric,
      mappingMatchesClosedInventory: true,
      mappingSource: "closed_inventory_order",
      wasRemapped: !wasAlreadyCorrect,
    })

    mappedRows.push({
      ...row,
      questionNumber: targetNumeric,
      physicalIndex: targetNumeric,
      canonicalId: targetClosedId,
      closedInventoryMapped: true,
    })
  }

  const canonicalSet = new Set(closedIds)
  for (const mr of mappedRows) {
    const cid = String(mr.canonicalId ?? "")
    if (!canonicalSet.has(cid)) {
      const preTelemetry = buildPreMappingTelemetry(workingRows, closedIds, variant)
      return {
        perQuestion: original,
        telemetry: {
          closedInventoryFinalMapEnabled: true,
          closedInventoryFinalMapApplied: false,
          closedInventoryFinalMapRollback: true,
          closedInventoryFinalMapRollbackReason:
            `canonical_outside_inventory: "${cid}"`,
          closedInventoryRowCount: workingRows.length,
          closedInventoryExpectedCount: closedIds.length,
          closedInventoryMismatchCountBefore: mismatchCountBefore,
          closedInventoryMismatchCountAfter: 0,
          closedInventoryAllMatchAfter: false,
          closedInventoryRowTelemetry: preTelemetry.rows,
        },
      }
    }
  }

  const mappedCanonicalIds = mappedRows.map((r) => String(r.canonicalId ?? ""))
  const uniqueMapped = new Set(mappedCanonicalIds)
  if (uniqueMapped.size !== mappedRows.length) {
    const preTelemetry = buildPreMappingTelemetry(workingRows, closedIds, variant)
    return {
      perQuestion: original,
      telemetry: {
        closedInventoryFinalMapEnabled: true,
        closedInventoryFinalMapApplied: false,
        closedInventoryFinalMapRollback: true,
        closedInventoryFinalMapRollbackReason:
          `post_map_duplicate_canonicals: unique=${uniqueMapped.size} total=${mappedRows.length}`,
        closedInventoryRowCount: workingRows.length,
        closedInventoryExpectedCount: closedIds.length,
        closedInventoryMismatchCountBefore: mismatchCountBefore,
        closedInventoryMismatchCountAfter: 0,
        closedInventoryAllMatchAfter: false,
        closedInventoryRowTelemetry: preTelemetry.rows,
      },
    }
  }

  mappedRows.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))

  return {
    perQuestion: mappedRows,
    telemetry: {
      closedInventoryFinalMapEnabled: true,
      closedInventoryFinalMapApplied: true,
      closedInventoryFinalMapRollback: false,
      closedInventoryFinalMapRollbackReason: null,
      closedInventoryRowCount: mappedRows.length,
      closedInventoryExpectedCount: closedIds.length,
      closedInventoryMismatchCountBefore: mismatchCountBefore,
      closedInventoryMismatchCountAfter: 0,
      closedInventoryAllMatchAfter: true,
      closedInventoryRowTelemetry: rowTelemetryEntries,
    },
  }
}

function extractMarkCoord(
  row: Record<string, unknown>,
  axis: "x" | "y",
): number | null {
  const indices = row.assignedDetectionIndices
  if (!Array.isArray(indices) || indices.length === 0) return null
  const centerKey = axis === "x" ? "rowCenterX" : "rowCenterY"
  const v = row[centerKey]
  if (typeof v === "number" && Number.isFinite(v)) return v
  return null
}

function buildPreMappingTelemetry(
  rows: Array<Record<string, unknown>>,
  closedIds: string[],
  variant: OmrTemplateVariantInterleaved,
): { rows: ClosedInventoryRowTelemetry[]; mismatchCount: number } {
  const sortOrder = sortOrderForVariant(variant)
  const sorted = sortDecodedForRebuild([...rows], sortOrder)
  const entries: ClosedInventoryRowTelemetry[] = []
  let mismatchCount = 0

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!
    const expectedCid = closedIds[i] ?? `?_${i}`
    const expectedNumeric = closedIds[i] ? parseClosedIdNumericSlot(closedIds[i]!) : null
    const prevCanonical = typeof row.canonicalId === "string" ? row.canonicalId : null
    const prevPhysical = typeof row.physicalIndex === "number" ? row.physicalIndex : null
    const matches = prevCanonical === expectedCid
    if (!matches) mismatchCount++

    const panelIndex = typeof row.panelIndex === "number" ? row.panelIndex : 0
    const rowIdxPanel = typeof row.rowIndexWithinPanel === "number" ? row.rowIndexWithinPanel : i
    const selectedAnswer = typeof row.selectedAnswer === "string" ? row.selectedAnswer : "BLANK"
    const rowCenterY = typeof row.rowCenterY === "number" ? row.rowCenterY : null

    entries.push({
      visualOrderIndexGlobal: i,
      panelIndex,
      rowIndexWithinPanel: rowIdxPanel,
      selectedAnswer,
      selectedMarkX: extractMarkCoord(row, "x"),
      selectedMarkY: extractMarkCoord(row, "y") ?? rowCenterY,
      physicalIndexBefore: prevPhysical,
      canonicalIdBefore: prevCanonical,
      physicalIndexAfter: prevPhysical ?? (expectedNumeric ?? i + 1),
      canonicalIdAfter: prevCanonical ?? expectedCid,
      expectedCanonicalIdFromClosedInventory: expectedCid,
      expectedPhysicalIndexFromClosedInventory: expectedNumeric ?? i + 1,
      mappingMatchesClosedInventory: matches,
      mappingSource: "rollback_preserved",
      wasRemapped: false,
    })
  }

  return { rows: entries, mismatchCount }
}
