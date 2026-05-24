/**
 * FASE 3B — Nodos/aristas nominal_confirmation + teacher_confirmed_match en el Graph Layer.
 * Solo evidencia de confirmación docente; no altera identidad resuelta en BD.
 */
import type {
  PedagogicalGraphConfidence,
  PedagogicalGraphEdge,
  PedagogicalGraphNode,
} from "@/app/lib/pedagogical-graph/types"
import type { TeacherNominalConfirmationRecord } from "@/app/lib/pedagogical-graph/nominalConfirmationMemory"
import { normalizeNominalName } from "@/app/lib/pedagogical-graph/nominalIdentity"

export type NominalConfirmationGraphResult = {
  confirmationNodesCount: number
  confirmedMatchEdgesCount: number
}

function edgeId(source: string, type: string, target: string): string {
  return `${source}|${type}|${target}`
}

function upsertNode(map: Map<string, PedagogicalGraphNode>, node: PedagogicalGraphNode): void {
  const existing = map.get(node.id)
  if (!existing) {
    map.set(node.id, node)
    return
  }
  if (existing.confidence === "low" && node.confidence === "high") {
    map.set(node.id, { ...existing, ...node, confidence: "high" })
  }
}

function upsertEdge(map: Map<string, PedagogicalGraphEdge>, edge: PedagogicalGraphEdge): void {
  const existing = map.get(edge.id)
  if (!existing) {
    map.set(edge.id, edge)
    return
  }
  if (existing.confidence === "low" && edge.confidence === "high") {
    map.set(edge.id, edge)
  }
}

function confirmationConfidence(rec: TeacherNominalConfirmationRecord): PedagogicalGraphConfidence {
  if (rec.manual_override || rec.ignored) return "low"
  if (rec.historical_confirmation_count >= 3) return "high"
  if (rec.confirmed_by_teacher) return "medium"
  return "low"
}

/**
 * Añade confirmaciones docentes al snapshot (capa nominal_confirmation).
 */
export function appendNominalConfirmationLayerToGraph(params: {
  evaluationId: string
  evaluationNodeId: string
  observationNodeId: string | null
  matchNodeIds: string[]
  confirmations: TeacherNominalConfirmationRecord[]
  nodeMap: Map<string, PedagogicalGraphNode>
  edgeMap: Map<string, PedagogicalGraphEdge>
}): NominalConfirmationGraphResult {
  const { evaluationId, evaluationNodeId, observationNodeId, matchNodeIds, confirmations, nodeMap, edgeMap } =
    params

  const observedNorm = confirmations[0]
    ? normalizeNominalName(confirmations[0].observed_name_raw).normalized
    : ""

  const relevant = confirmations.filter((c) => {
    if (!observedNorm) return true
    return (
      c.observed_name_normalized === observedNorm ||
      normalizeNominalName(c.observed_name_raw).normalized === observedNorm
    )
  })

  let confirmationNodesCount = 0
  let confirmedMatchEdgesCount = 0
  let idx = 0

  for (const rec of relevant) {
    if (rec.ignored) continue
    idx += 1
    const conf = confirmationConfidence(rec)
    const nodeId = `nominal_confirmation:${evaluationId}:${rec.observed_token_bag_key}:${idx}`

    upsertNode(nodeMap, {
      id: nodeId,
      type: "nominal_confirmation",
      label: rec.manual_override
        ? `Corrección manual: ${rec.confirmed_display_name ?? rec.observed_name_raw}`
        : `Confirmado: ${rec.confirmed_display_name ?? "—"}`,
      confidence: conf,
      metadata: {
        confirmed_by_teacher: rec.confirmed_by_teacher,
        confirmed_at: rec.confirmed_at,
        historical_confirmation_count: rec.historical_confirmation_count,
        manual_override: rec.manual_override,
        ignored: rec.ignored,
        observed_name_raw: rec.observed_name_raw,
        observed_name_normalized: rec.observed_name_normalized,
        confirmed_display_name: rec.confirmed_display_name,
        student_profile_id: rec.student_profile_id,
        catalog_student_id: rec.catalog_student_id,
        requires_teacher_review: false,
        teacher_authority: "manual_edit_prevails",
      },
    })
    confirmationNodesCount += 1

    if (observationNodeId) {
      upsertEdge(edgeMap, {
        id: edgeId(observationNodeId, "references", nodeId),
        source: observationNodeId,
        target: nodeId,
        type: "references",
        confidence: conf,
        metadata: { role: "nominal_confirmation_evidence" },
      })
    }

    const topMatchId = matchNodeIds[0]
    if (topMatchId && rec.confirmed_by_teacher && !rec.manual_override) {
      upsertEdge(edgeMap, {
        id: edgeId(nodeId, "teacher_confirmed_match", topMatchId),
        source: nodeId,
        target: topMatchId,
        type: "teacher_confirmed_match",
        confidence: conf,
        metadata: {
          confirmed_by_teacher: true,
          confirmed_at: rec.confirmed_at,
          historical_confirmation_count: rec.historical_confirmation_count,
          suggested_student_name: rec.confirmed_display_name,
        },
      })
      confirmedMatchEdgesCount += 1
    }

    if (rec.student_profile_id) {
      const profileNodeId = `student_profile:${rec.student_profile_id}`
      if (nodeMap.has(profileNodeId)) {
        upsertEdge(edgeMap, {
          id: edgeId(nodeId, "references", profileNodeId),
          source: nodeId,
          target: profileNodeId,
          type: "references",
          confidence: conf,
          metadata: { role: "confirmed_roster_profile" },
        })
      }
    }
  }

  return { confirmationNodesCount, confirmedMatchEdgesCount }
}
