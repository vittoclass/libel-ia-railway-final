import type { HybridSlotDescriptor, HybridSlotTopology } from "./hybrid-slot-topology"
import { getOmrSlotsInPhysicalOrder, validateClosedOmrCountMatchesTopology } from "./hybrid-slot-topology"
import { parseClosedIdNumericSlot } from "./optionalOcrQuestionAnchor"

export type HybridPreMapValidation =
  | { ok: true }
  | { ok: false; errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH"; error: string }

export type HybridPostMapValidation =
  | { ok: true; physicalIndexPreserved: boolean; hybridStructuralIntegrity: boolean }
  | { ok: false; errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE"; error: string; physicalIndexPreserved: boolean }

function normId(id: string): string {
  return String(id ?? "").trim()
}

/** Antes del decode geométrico: mapa híbrido coherente con la pauta cerrada. */
export function validateHybridTopologyPreMap(topology: HybridSlotTopology, closedQuestionIds: string[]): HybridPreMapValidation {
  const closed = closedQuestionIds.map(normId).filter(Boolean)
  if (!validateClosedOmrCountMatchesTopology(topology, closed.length)) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
      error: `Pre-map: closedOmrQuestionCount (${topology.closedOmrQuestionCount}) inconsistente con pauta (${closed.length}).`,
    }
  }
  const omrSlots = getOmrSlotsInPhysicalOrder(topology)
  if (omrSlots.length !== closed.length) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
      error: `Pre-map: slots OMR en mapa (${omrSlots.length}) != cerradas (${closed.length}).`,
    }
  }
  const sortedMap = [...omrSlots.map((s) => normId(s.canonicalId))].sort()
  const sortedClosed = [...closed].sort()
  for (let i = 0; i < sortedClosed.length; i++) {
    if (sortedMap[i] !== sortedClosed[i]) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
        error: "Pre-map: conjunto de canonical en slots OMR no coincide exactamente con closedQuestionIds.",
      }
    }
  }
  return { ok: true }
}

/**
 * Tras decodificar: sin colapso de slots físicos, biyección de questionNumber, physicalIndex alineados al mapa OMR.
 * REGLA DE ORO: questionNumber === physicalIndex === numericPart(canonicalId)
 *
 * IMPORTANTE: la validación compara filas de salida contra closedQuestionIds.length
 * (solo cerradas), NUNCA contra totalPhysicalSlots ni physicalHybridSlotCount.
 * Los slots de desarrollo (Pn) se cuentan como skipped, no como filas faltantes.
 */
export function validateHybridPostMapPhysicalIntegrity(params: {
  perQuestion: Array<Record<string, unknown>>
  topology: HybridSlotTopology
  closedQuestionIds: string[]
  /** Si true, exige filas con physicalIndex y sin completado sintético. */
  strictHybrid: boolean
}): HybridPostMapValidation {
  const { perQuestion, topology, closedQuestionIds, strictHybrid } = params
  const closed = closedQuestionIds.map(normId).filter(Boolean)
  const n = closed.length
  const hasDevelopment = topology.hasInterleavedDevelopment
  const developmentSlotCount = topology.developmentSlotCount

  if (perQuestion.length !== n) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
      error: `Filas salida (${perQuestion.length}) != cerradas OMR (${n}).` +
        (hasDevelopment
          ? ` [${developmentSlotCount} slots desarrollo contados como skipped, totalPhysical=${topology.physicalHybridSlotCount}]`
          : ""),
      physicalIndexPreserved: false,
    }
  }

  const expectedNumericIds = new Set<number>()
  for (const id of closed) {
    const num = parseClosedIdNumericSlot(id)
    if (num != null) expectedNumericIds.add(num)
  }

  const qnSet = new Set<number>()
  const physSet = new Set<number>()

  for (const row of perQuestion) {
    const qn = Number(row.questionNumber ?? 0)
    if (!Number.isFinite(qn) || qn < 1 || !expectedNumericIds.has(qn)) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
        error: `questionNumber ilegal o no esperado: ${qn} (esperados: ${[...expectedNumericIds].sort((a, b) => a - b).join(",")}).`,
        physicalIndexPreserved: false,
      }
    }
    if (qnSet.has(qn)) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
        error: `Colapso: questionNumber duplicado ${qn}.`,
        physicalIndexPreserved: false,
      }
    }
    qnSet.add(qn)

    if (strictHybrid && row.canonicalId != null) {
      const expectedNum = parseClosedIdNumericSlot(String(row.canonicalId))
      if (expectedNum != null && expectedNum !== qn) {
        return {
          ok: false,
          errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
          error: `REGLA_DE_ORO: canonicalId=${row.canonicalId} -> numericPart=${expectedNum} != questionNumber=${qn}.`,
          physicalIndexPreserved: false,
        }
      }
    }

    const pi = row.physicalIndex
    if (strictHybrid) {
      if (typeof pi !== "number" || !Number.isFinite(pi)) {
        return {
          ok: false,
          errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
          error: "Fila híbrida estricta sin physicalIndex numérico.",
          physicalIndexPreserved: false,
        }
      }
      if (pi !== qn) {
        return {
          ok: false,
          errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
          error: `REGLA_DE_ORO: physicalIndex=${pi} != questionNumber=${qn} para canonicalId=${row.canonicalId}.`,
          physicalIndexPreserved: false,
        }
      }
      physSet.add(pi)
    } else if (typeof pi === "number" && Number.isFinite(pi)) {
      physSet.add(pi)
    }

    if (row.completedByExpectation === true && strictHybrid) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
        error: "Padding/completado sintético detectado en modo híbrido estricto.",
        physicalIndexPreserved: false,
      }
    }
  }

  if (qnSet.size !== n) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
      error: "Secuencia de questionNumber incompleta (huecos ilegales).",
      physicalIndexPreserved: false,
    }
  }

  if (strictHybrid) {
    if (physSet.size !== expectedNumericIds.size || [...expectedNumericIds].some((p) => !physSet.has(p))) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
        error: "Conjunto de physicalIndex en salida no coincide con IDs numéricos canónicos esperados.",
        physicalIndexPreserved: false,
      }
    }
  }

  // Topology self-consistency: maxPhysicalIndex from descriptors vs physicalHybridSlotCount.
  // When development slots exist, the max descriptor physicalIndex includes both closed AND
  // development slots, so it SHOULD equal physicalHybridSlotCount (total physical on sheet).
  // This check validates the topology, not the output rows.
  // Skip when development slots exist: the mismatch between output row count (closed only)
  // and physicalHybridSlotCount (total) is expected and NOT an error.
  if (!hasDevelopment) {
    const maxPhysFromMap = Math.max(0, ...topology.hybridSlotDescriptors.map((d: HybridSlotDescriptor) => d.physicalIndex))
    if (topology.physicalHybridSlotCount > 0 && maxPhysFromMap !== topology.physicalHybridSlotCount) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_PHYSICAL_SLOT_COLLAPSE",
        error: `maxPhysicalIndex (${maxPhysFromMap}) !== hybridPhysicalSlotCount (${topology.physicalHybridSlotCount}).`,
        physicalIndexPreserved: false,
      }
    }
  }

  return {
    ok: true,
    physicalIndexPreserved: strictHybrid,
    hybridStructuralIntegrity: true,
  }
}
