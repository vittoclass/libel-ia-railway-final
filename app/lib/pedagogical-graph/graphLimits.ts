/**
 * FASE 2C — Observabilidad y límites globales del Graph Layer.
 * Recorta histórico e inferencia de baja confianza antes que el núcleo pedagógico.
 */
import type {
  PedagogicalGraphEdge,
  PedagogicalGraphEdgeType,
  PedagogicalGraphNode,
  PedagogicalGraphNodeType,
  PedagogicalGraphObservability,
  PedagogicalGraphSnapshot,
} from "@/app/lib/pedagogical-graph/types"

export const MAX_GRAPH_NODES = 600
export const MAX_GRAPH_EDGES = 2000
/** Aproximación del payload JSON (nodos + aristas) antes de serializar el snapshot completo. */
export const MAX_RESPONSE_BYTES = 1_048_576

const WARN_RATIO = 0.8

/** Núcleo pedagógico: no se elimina en degradación segura. */
const CORE_NODE_TYPES = new Set<PedagogicalGraphNodeType>([
  "student",
  "evaluation",
  "item",
  "skill",
  "axis",
  "cognitive_level",
  "subject",
  "course",
  "teacher",
  "school",
  "organization",
  "source_exam",
  "batch",
  "student_profile",
  "score_summary",
  "achievement_level",
])

const HISTORICAL_NODE_TYPES = new Set<PedagogicalGraphNodeType>([
  "historical_handwriting_profile",
  "handwriting_memory",
  "writing_progress",
  "recurring_ocr_confusion",
  "repeated_pattern_cluster",
])

const INFERRED_NODE_TYPES = new Set<PedagogicalGraphNodeType>([
  "failure_pattern",
  "co_occurrence_cluster",
  "inferred_relation",
])

const HANDWRITING_EVIDENCE_NODE_TYPES = new Set<PedagogicalGraphNodeType>([
  "handwriting_profile",
  "writing_evidence",
  "handwriting_observation",
  "possible_ocr_difficulty",
  "teacher_corrected_text",
  "ocr_original_text",
])

const SECONDARY_LABEL_NODE_TYPES = new Set<PedagogicalGraphNodeType>([
  "skill_label_text",
  "axis_label_text",
])

const CORE_EDGE_TYPES = new Set<PedagogicalGraphEdgeType>([
  "completed",
  "contains",
  "measures",
  "belongs_to",
  "has_cognitive_level",
  "belongs_to_subject",
  "uses",
  "part_of",
  "has_text_skill",
  "has_text_axis",
  "has_score_summary",
  "applied",
  "has_achievement_level",
])

const HISTORICAL_EDGE_TYPES = new Set<PedagogicalGraphEdgeType>([
  "has_handwriting_memory",
  "shares_pattern_with",
  "repeated_in",
  "contributes_to",
  "aggregates",
  "linked_to_cluster",
])

const INFERRED_EDGE_TYPES = new Set<PedagogicalGraphEdgeType>([
  "co_fails_with",
  "has_inferred_pattern",
  "supported_by",
])

const HANDWRITING_EDGE_TYPES = new Set<PedagogicalGraphEdgeType>([
  "has_handwriting_profile",
  "contains_writing_evidence",
  "has_written_answer",
  "may_need_review",
  "improves",
  "references",
])

const CONFIDENCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 }

function confidenceRank(c: string): number {
  return CONFIDENCE_RANK[c] ?? 1
}

/** Menor = eliminar antes. */
export function nodeTrimPriority(node: PedagogicalGraphNode): number {
  if (CORE_NODE_TYPES.has(node.type)) return 10_000
  const conf = confidenceRank(node.confidence)
  if (HISTORICAL_NODE_TYPES.has(node.type)) return 10 + conf
  if (INFERRED_NODE_TYPES.has(node.type)) return 100 + conf
  if (HANDWRITING_EVIDENCE_NODE_TYPES.has(node.type)) return 200 + conf
  if (SECONDARY_LABEL_NODE_TYPES.has(node.type)) return 300 + conf
  return 500 + conf
}

export function edgeTrimPriority(edge: PedagogicalGraphEdge): number {
  if (CORE_EDGE_TYPES.has(edge.type)) return 10_000
  const conf = confidenceRank(edge.confidence)
  if (HISTORICAL_EDGE_TYPES.has(edge.type)) return 10 + conf
  if (INFERRED_EDGE_TYPES.has(edge.type)) return 100 + conf
  if (HANDWRITING_EDGE_TYPES.has(edge.type)) return 200 + conf
  return 400 + conf
}

function isRemovableNode(node: PedagogicalGraphNode): boolean {
  return !CORE_NODE_TYPES.has(node.type)
}

function isRemovableEdge(edge: PedagogicalGraphEdge): boolean {
  return !CORE_EDGE_TYPES.has(edge.type)
}

function estimateGraphPayloadBytes(nodes: PedagogicalGraphNode[], edges: PedagogicalGraphEdge[]): number {
  try {
    return Buffer.byteLength(JSON.stringify({ nodes, edges }), "utf8")
  } catch {
    return 0
  }
}

function pruneOrphanEdges(
  nodes: PedagogicalGraphNode[],
  edges: PedagogicalGraphEdge[]
): PedagogicalGraphEdge[] {
  const ids = new Set(nodes.map((n) => n.id))
  return edges.filter((e) => ids.has(e.source) && ids.has(e.target))
}

function trimNodesToLimit(
  nodes: PedagogicalGraphNode[],
  maxNodes: number,
  capsApplied: string[]
): PedagogicalGraphNode[] {
  if (nodes.length <= maxNodes) return nodes
  const removable = nodes
    .filter(isRemovableNode)
    .sort((a, b) => nodeTrimPriority(a) - nodeTrimPriority(b))
  const toRemoveCount = Math.min(removable.length, nodes.length - maxNodes)
  if (toRemoveCount <= 0) return nodes
  const removeIds = new Set(removable.slice(0, toRemoveCount).map((n) => n.id))
  const tier = nodeTrimPriority(removable[0]!)
  if (tier < 200) capsApplied.push("nodes_trimmed_historical")
  else if (tier < 300) capsApplied.push("nodes_trimmed_inferred")
  else if (tier < 400) capsApplied.push("nodes_trimmed_handwriting_evidence")
  else capsApplied.push("nodes_trimmed_secondary_labels")
  return nodes.filter((n) => !removeIds.has(n.id))
}

function trimEdgesToLimit(
  edges: PedagogicalGraphEdge[],
  maxEdges: number,
  capsApplied: string[]
): PedagogicalGraphEdge[] {
  if (edges.length <= maxEdges) return edges
  const removable = edges
    .filter(isRemovableEdge)
    .sort((a, b) => edgeTrimPriority(a) - edgeTrimPriority(b))
  const toRemoveCount = Math.min(removable.length, edges.length - maxEdges)
  if (toRemoveCount <= 0) return edges
  const removeIds = new Set(removable.slice(0, toRemoveCount).map((e) => e.id))
  const tier = edgeTrimPriority(removable[0]!)
  if (tier < 200) capsApplied.push("edges_trimmed_historical")
  else if (tier < 300) capsApplied.push("edges_trimmed_inferred")
  else if (tier < 400) capsApplied.push("edges_trimmed_handwriting_evidence")
  else capsApplied.push("edges_trimmed_low_confidence")
  return edges.filter((e) => !removeIds.has(e.id))
}

function buildWarnings(
  nodeCount: number,
  edgeCount: number,
  bytesEstimate: number
): string[] {
  const warnings: string[] = []
  const nodeWarnAt = Math.floor(MAX_GRAPH_NODES * WARN_RATIO)
  const edgeWarnAt = Math.floor(MAX_GRAPH_EDGES * WARN_RATIO)
  const byteWarnAt = Math.floor(MAX_RESPONSE_BYTES * WARN_RATIO)

  if (nodeCount >= nodeWarnAt) {
    warnings.push(
      nodeCount >= MAX_GRAPH_NODES
        ? "graph_nodes_at_or_over_limit"
        : "graph_nodes_approaching_limit"
    )
  }
  if (edgeCount >= edgeWarnAt) {
    warnings.push(
      edgeCount >= MAX_GRAPH_EDGES
        ? "graph_edges_at_or_over_limit"
        : "graph_edges_approaching_limit"
    )
  }
  if (bytesEstimate >= byteWarnAt) {
    warnings.push(
      bytesEstimate >= MAX_RESPONSE_BYTES
        ? "graph_response_bytes_at_or_over_limit"
        : "graph_response_bytes_approaching_limit"
    )
  }
  return warnings
}

export type ApplyGraphLimitsInput = {
  snapshot: PedagogicalGraphSnapshot
  buildDurationMs: number
  layersIncluded: string[]
}

export type ApplyGraphLimitsResult = {
  snapshot: PedagogicalGraphSnapshot
  observability: PedagogicalGraphObservability
}

/**
 * Aplica topes globales con degradación segura: el snapshot siempre se devuelve.
 */
export function applyGraphLimits(input: ApplyGraphLimitsInput): ApplyGraphLimitsResult {
  const capsApplied: string[] = []
  const nodesBefore = input.snapshot.nodes.length
  const edgesBefore = input.snapshot.edges.length

  let nodes = [...input.snapshot.nodes]
  let edges = [...input.snapshot.edges]

  const overNodeCap = nodes.length > MAX_GRAPH_NODES
  const overEdgeCap = edges.length > MAX_GRAPH_EDGES
  let bytesEstimate = estimateGraphPayloadBytes(nodes, edges)
  const overByteCap = bytesEstimate > MAX_RESPONSE_BYTES

  if (overNodeCap) {
    nodes = trimNodesToLimit(nodes, MAX_GRAPH_NODES, capsApplied)
    edges = pruneOrphanEdges(nodes, edges)
  }
  if (edges.length > MAX_GRAPH_EDGES) {
    edges = trimEdgesToLimit(edges, MAX_GRAPH_EDGES, capsApplied)
  }

  bytesEstimate = estimateGraphPayloadBytes(nodes, edges)
  let bytePasses = 0
  while (bytesEstimate > MAX_RESPONSE_BYTES && bytePasses < 6) {
    bytePasses += 1
    const prevNodes = nodes.length
    const prevEdges = edges.length
    nodes = trimNodesToLimit(nodes, Math.max(nodes.length - 1, 1), capsApplied)
    edges = pruneOrphanEdges(nodes, edges)
    if (edges.length > MAX_GRAPH_EDGES) {
      edges = trimEdgesToLimit(edges, MAX_GRAPH_EDGES, capsApplied)
    }
    if (edges.length > MAX_GRAPH_EDGES - 1) {
      edges = trimEdgesToLimit(edges, Math.max(edges.length - 1, 1), capsApplied)
    }
    bytesEstimate = estimateGraphPayloadBytes(nodes, edges)
    if (nodes.length === prevNodes && edges.length === prevEdges) break
  }
  if (bytePasses > 0 && !capsApplied.includes("response_bytes_trimmed")) {
    capsApplied.push("response_bytes_trimmed")
  }

  const nodeCount = nodes.length
  const edgeCount = edges.length
  const degraded =
    nodeCount < nodesBefore ||
    edgeCount < edgesBefore ||
    capsApplied.length > 0 ||
    nodeCount > MAX_GRAPH_NODES ||
    edgeCount > MAX_GRAPH_EDGES ||
    bytesEstimate > MAX_RESPONSE_BYTES

  const warnings = buildWarnings(nodesBefore, edgesBefore, estimateGraphPayloadBytes(nodes, edges))
  if (degraded && !warnings.includes("graph_degraded")) {
    warnings.push("graph_degraded")
  }
  if (nodeCount > MAX_GRAPH_NODES || edgeCount > MAX_GRAPH_EDGES) {
    warnings.push("graph_core_only_retained_over_cap")
  }

  const observability: PedagogicalGraphObservability = {
    node_count: nodeCount,
    edge_count: edgeCount,
    build_duration_ms: input.buildDurationMs,
    layers_included: [...input.layersIncluded],
    caps_applied: [...new Set(capsApplied)],
    warnings,
    degraded,
    nodes_before_cap: nodesBefore,
    edges_before_cap: edgesBefore,
    response_bytes_estimate: bytesEstimate,
  }

  return {
    snapshot: {
      ...input.snapshot,
      nodes,
      edges,
      observability,
    },
    observability,
  }
}
