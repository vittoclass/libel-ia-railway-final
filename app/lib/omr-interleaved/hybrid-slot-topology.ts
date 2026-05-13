/**
 * Topología híbrida universal (cerradas OMR + desarrollo sin OMR).
 * Sin heurísticas por examen/plantilla: solo orden estructural y conjunto de ids cerrados.
 */

export interface HybridSlotDescriptor {
  canonicalId: string
  physicalIndex: number
  slotType: "closed" | "development"
  participatesInOmr: boolean
}

/** Forensía serializable para snapshot de debug (no scoring). */
export type HybridTopologySnapshotForensics = {
  hybridPhysicalSlotCount: number
  closedOmrQuestionCount: number
  developmentSlotCount: number
  hybridSlotMapPreview: HybridSlotDescriptor[]
  physicalIndexPreserved: boolean | null
  syntheticPaddingPrevented: boolean
  hybridStructuralIntegrity: boolean | null
}

export type HybridSlotTopology = {
  hybridSlotDescriptors: HybridSlotDescriptor[]
  /** Cardinal físico total en la pauta ordenada (cerradas + desarrollo). */
  physicalHybridSlotCount: number
  /** Solo ítems cerrados evaluables por OMR (= cardinal esperado de filas decodificadas). */
  closedOmrQuestionCount: number
  developmentSlotCount: number
  /** true si existe al menos un slot de desarrollo explícito en la ordenación. */
  hasInterleavedDevelopment: boolean
}

function normId(id: string): string {
  return String(id ?? "").trim()
}

export function assertHybridPhysicalIndicesContiguous(topology: HybridSlotTopology): {
  ok: boolean
  errorCode?: "INTERLEAVED_HYBRID_INVALID_STRUCTURE"
  error?: string
} {
  const n = topology.physicalHybridSlotCount
  if (n < 1) return { ok: true }
  const idx = topology.hybridSlotDescriptors.map((d) => d.physicalIndex).sort((a, b) => a - b)
  const max = Math.max(...idx)
  const min = Math.min(...idx)
  if (min !== 1 || max !== n || idx.length !== n) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_HYBRID_INVALID_STRUCTURE",
      error: `physicalIndex no contigua o inconsistente: min=${min} max=${max} expectedMax=${n} count=${idx.length}`,
    }
  }
  for (let i = 0; i < n; i++) {
    if (idx[i] !== i + 1) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_HYBRID_INVALID_STRUCTURE",
        error: `Se esperaba physicalIndex ${i + 1}, obtuvo ${idx[i]}`,
      }
    }
  }
  return { ok: true }
}

/**
 * Construye topología desde el orden físico completo de la evaluación.
 * `fullStructuredQuestionOrder`: orden de aparición en la pauta (todas las preguntas).
 * `closedQuestionIds`: solo cerradas, en el orden oficial de corrección OMR.
 */
export function buildHybridSlotTopology(params: {
  closedQuestionIds: string[]
  fullStructuredQuestionOrder: string[]
}):
  | { ok: true; topology: HybridSlotTopology }
  | { ok: false; errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH"; error: string } {
  const closedRaw = params.closedQuestionIds.map(normId).filter(Boolean)
  const orderRaw = params.fullStructuredQuestionOrder.map(normId).filter(Boolean)

  if (!closedRaw.length) {
    return { ok: false, errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH", error: "closedQuestionIds vacío" }
  }
  if (orderRaw.length < closedRaw.length) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
      error: `Orden estructural (${orderRaw.length}) menor que cerradas (${closedRaw.length}).`,
    }
  }

  const closedSet = new Set(closedRaw)
  if (closedSet.size !== closedRaw.length) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
      error: "closedQuestionIds contiene duplicados tras normalizar.",
    }
  }

  const seenOrder = new Set<string>()
  for (const id of orderRaw) {
    if (seenOrder.has(id)) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
        error: `Duplicado en orden estructural: "${id}".`,
      }
    }
    seenOrder.add(id)
  }

  for (const cid of closedRaw) {
    if (!seenOrder.has(cid)) {
      return {
        ok: false,
        errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
        error: `Ítem cerrado "${cid}" no aparece en el orden estructurado completo.`,
      }
    }
  }

  const descriptors: HybridSlotDescriptor[] = orderRaw.map((canonicalId, i) => {
    const participatesInOmr = closedSet.has(canonicalId)
    return {
      canonicalId,
      physicalIndex: i + 1,
      slotType: participatesInOmr ? "closed" : "development",
      participatesInOmr,
    }
  })

  let omrSlots = 0
  let devSlots = 0
  for (const d of descriptors) {
    if (d.participatesInOmr) omrSlots++
    else devSlots++
  }

  if (omrSlots !== closedRaw.length) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
      error: `Slots OMR derivados (${omrSlots}) != closedQuestionIds (${closedRaw.length}).`,
    }
  }

  const structuralAssert = assertHybridPhysicalIndicesContiguous({
    hybridSlotDescriptors: descriptors,
    physicalHybridSlotCount: descriptors.length,
    closedOmrQuestionCount: omrSlots,
    developmentSlotCount: devSlots,
    hasInterleavedDevelopment: devSlots > 0,
  })
  if (!structuralAssert.ok) {
    return {
      ok: false,
      errorCode: "INTERLEAVED_HYBRID_SLOT_MISMATCH",
      error: structuralAssert.error ?? "Estructura física inválida",
    }
  }

  return {
    ok: true,
    topology: {
      hybridSlotDescriptors: descriptors,
      physicalHybridSlotCount: descriptors.length,
      closedOmrQuestionCount: omrSlots,
      developmentSlotCount: devSlots,
      hasInterleavedDevelopment: devSlots > 0,
    },
  }
}

/**
 * Topología por defecto: solo cerradas, sin slots de desarrollo en el orden estructural.
 */
export function buildClosedOnlyHybridTopology(closedQuestionIds: string[]): HybridSlotTopology {
  const ids = closedQuestionIds.map(normId).filter(Boolean)
  const descriptors: HybridSlotDescriptor[] = ids.map((canonicalId, i) => ({
    canonicalId,
    physicalIndex: i + 1,
    slotType: "closed" as const,
    participatesInOmr: true,
  }))
  return {
    hybridSlotDescriptors: descriptors,
    physicalHybridSlotCount: descriptors.length,
    closedOmrQuestionCount: descriptors.length,
    developmentSlotCount: 0,
    hasInterleavedDevelopment: false,
  }
}

export function getOmrSlotsInPhysicalOrder(topology: HybridSlotTopology): HybridSlotDescriptor[] {
  return topology.hybridSlotDescriptors.filter((d) => d.participatesInOmr).sort((a, b) => a.physicalIndex - b.physicalIndex)
}

/**
 * coherencia: número de slots OMR en el mapa == pauta cerrada.
 */
export function validateClosedOmrCountMatchesTopology(topology: HybridSlotTopology, closedQuestionIdsLength: number): boolean {
  return topology.closedOmrQuestionCount === closedQuestionIdsLength && getOmrSlotsInPhysicalOrder(topology).length === closedQuestionIdsLength
}
