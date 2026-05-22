/**
 * FASE 2A — Motor dinámico seguro: co-fallo intra-evaluación (solo lectura).
 * Detecta patrones de dificultad compartida entre ítems fallidos de UNA evaluación.
 * No modifica scoring, OCR ni persistencia.
 */
import type {
  PedagogicalGraphConfidence,
  PedagogicalGraphEdge,
  PedagogicalGraphNode,
} from "@/app/lib/pedagogical-graph/types"

/** Máximo de clusters de co-fallo por evaluación. */
export const MAX_CO_FAILURE_CLUSTERS = 8
/** Máximo de aristas inferidas por co-fallo intra-evaluación. */
export const MAX_INFERRED_INTRA_EVAL_EDGES = 24
/** Longitud máxima de excerpts en metadata inferida. */
export const MAX_INFERRED_EXCERPT_CHARS = 80

const METHOD_INTRA_CO_FAILURE = "intra_evaluation_co_failure"

type SourceItemMeta = {
  axis_id: string | null
  skill_id: string | null
  axis_label: string | null
  skill_label: string | null
  cognitive_level: string | null
}

type GraphEvaluationItemRow = {
  question_number: number
  score_obtained?: number | null
  score_max?: number | null
  is_correct?: boolean | null
}

export type IntraCoFailureBuildInput = {
  evaluationId: string
  evaluationNodeId: string
  items: GraphEvaluationItemRow[]
  sourceByQuestion: Map<number, SourceItemMeta>
}

export type IntraCoFailureBuildResult = {
  coFailureClustersCount: number
  inferredIntraEvalEdgesCount: number
}

type InferredConfidence = "high" | "medium" | "low"

type ClusterDimension =
  | "skill_id"
  | "axis_id"
  | "cognitive_level"
  | "skill_label_text"
  | "axis_label_text"

type ClusterCandidate = {
  dimension: ClusterDimension
  key: string
  confidence: InferredConfidence
  label: string
  questionNumbers: number[]
  itemNodeIds: string[]
  supportTargetId: string | null
  priority: number
}

function edgeId(source: string, type: string, target: string): string {
  return `${source}|${type}|${target}`
}

function normKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

function itemNodeId(evaluationId: string, questionNumber: number): string {
  return `item:${evaluationId}:q${questionNumber}`
}

function textLabelNodeId(kind: "skill_label_text" | "axis_label_text", label: string): string {
  return `${kind}:${normKey(label)}`
}

function truncateExcerpt(text: string, max = MAX_INFERRED_EXCERPT_CHARS): string {
  const t = text.trim().replace(/\s+/g, " ")
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function upsertNode(map: Map<string, PedagogicalGraphNode>, node: PedagogicalGraphNode): void {
  const existing = map.get(node.id)
  if (!existing) {
    map.set(node.id, node)
    return
  }
  const rank = (c: PedagogicalGraphConfidence) => (c === "high" ? 3 : c === "medium" ? 2 : 1)
  if (rank(node.confidence) > rank(existing.confidence)) {
    map.set(node.id, { ...existing, ...node, confidence: node.confidence })
  }
}

function upsertEdge(map: Map<string, PedagogicalGraphEdge>, edge: PedagogicalGraphEdge): void {
  const existing = map.get(edge.id)
  if (!existing) {
    map.set(edge.id, edge)
    return
  }
  const rank = (c: PedagogicalGraphConfidence) => (c === "high" ? 3 : c === "medium" ? 2 : 1)
  if (rank(edge.confidence) > rank(existing.confidence)) {
    map.set(edge.id, edge)
  }
}

function toGraphConfidence(c: InferredConfidence): PedagogicalGraphConfidence {
  return c
}

function baseInferredMetadata(params: {
  confidence: InferredConfidence
  supportCount: number
  evidenceItemNumbers: number[]
  explanation: string
  dimension?: string
  excerpt?: string | null
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    is_inferred: true,
    is_evidence_only: true,
    not_a_decision: true,
    method: METHOD_INTRA_CO_FAILURE,
    support_count: params.supportCount,
    evidence_item_numbers: params.evidenceItemNumbers,
    confidence: params.confidence,
    explanation: params.explanation,
    requires_teacher_review: true,
    hypothesis_type: "pedagogical_hypothesis",
  }
  if (params.dimension) meta.dimension = params.dimension
  if (params.excerpt) meta.excerpt = truncateExcerpt(params.excerpt)
  return meta
}

function isItemFailed(item: GraphEvaluationItemRow): boolean {
  if (item.is_correct === false) return true
  if (item.is_correct === true) return false
  const so = Number(item.score_obtained)
  const sm = Number(item.score_max)
  if (Number.isFinite(sm) && sm > 0 && Number.isFinite(so) && so < sm) return true
  return false
}

function buildExplanation(
  dimension: ClusterDimension,
  label: string,
  count: number
): string {
  const n = String(count)
  switch (dimension) {
    case "skill_id":
      return `Posible patrón de dificultad en la misma habilidad («${label}») en ${n} ítems. Hipótesis pedagógica; requiere revisión docente.`
    case "axis_id":
      return `Posible co-fallo en el mismo eje («${label}») en ${n} ítems. No es diagnóstico definitivo; requiere revisión docente.`
    case "cognitive_level":
      return `Posible patrón en el mismo nivel cognitivo («${label}») en ${n} ítems. Hipótesis; requiere revisión docente.`
    case "skill_label_text":
      return `Posible coincidencia por etiqueta de habilidad («${label}») en ${n} ítems. Evidencia débil; requiere revisión docente.`
    case "axis_label_text":
      return `Posible coincidencia por etiqueta de eje («${label}») en ${n} ítems. Evidencia débil; requiere revisión docente.`
  }
}

function clusterNodeIds(evaluationId: string, dimension: ClusterDimension, key: string): {
  clusterId: string
  patternId: string
  relationId: string
} {
  const safeKey = normKey(key).slice(0, 64)
  const base = `${evaluationId}:${dimension}:${safeKey}`
  return {
    clusterId: `co_occurrence_cluster:${base}`,
    patternId: `failure_pattern:${base}`,
    relationId: `inferred_relation:${base}`,
  }
}

function dimensionPriority(dimension: ClusterDimension, confidence: InferredConfidence): number {
  const dimScore =
    dimension === "skill_id"
      ? 50
      : dimension === "axis_id"
        ? 40
        : dimension === "cognitive_level"
          ? 35
          : 20
  const confScore = confidence === "high" ? 30 : confidence === "medium" ? 20 : 10
  return dimScore + confScore
}

export function appendIntraEvaluationCoFailures(params: {
  input: IntraCoFailureBuildInput
  nodeMap: Map<string, PedagogicalGraphNode>
  edgeMap: Map<string, PedagogicalGraphEdge>
}): IntraCoFailureBuildResult {
  const { input, nodeMap, edgeMap } = params
  const { evaluationId, evaluationNodeId, items, sourceByQuestion } = input

  const failedContexts: Array<{
    questionNumber: number
    itemNodeId: string
    skillId: string | null
    axisId: string | null
    cognitiveKey: string | null
    skillText: string | null
    axisText: string | null
  }> = []

  for (const item of items) {
    if (!isItemFailed(item)) continue
    const qn = Number(item.question_number)
    if (!Number.isFinite(qn) || qn <= 0) continue
    const src = sourceByQuestion.get(qn)
    failedContexts.push({
      questionNumber: qn,
      itemNodeId: itemNodeId(evaluationId, qn),
      skillId: src?.skill_id && String(src.skill_id).trim() ? String(src.skill_id).trim() : null,
      axisId: src?.axis_id && String(src.axis_id).trim() ? String(src.axis_id).trim() : null,
      cognitiveKey:
        src?.cognitive_level && String(src.cognitive_level).trim()
          ? normKey(String(src.cognitive_level).trim())
          : null,
      skillText:
        src?.skill_label && String(src.skill_label).trim() ? String(src.skill_label).trim() : null,
      axisText: src?.axis_label && String(src.axis_label).trim() ? String(src.axis_label).trim() : null,
    })
  }

  if (failedContexts.length < 2) {
    return { coFailureClustersCount: 0, inferredIntraEvalEdgesCount: 0 }
  }

  const regrouped = new Map<string, ClusterCandidate>()
  for (const ctx of failedContexts) {
    type DimensionTry = {
      dimension: ClusterDimension
      key: string
      confidence: InferredConfidence
      supportTargetId: string | null
      label: string
    }
    const tries: DimensionTry[] = []
    if (ctx.skillId) {
      tries.push({
        dimension: "skill_id",
        key: ctx.skillId,
        confidence: "high",
        supportTargetId: `skill:${ctx.skillId}`,
        label:
          nodeMap.get(`skill:${ctx.skillId}`)?.label ?? `Habilidad ${ctx.skillId.slice(0, 8)}`,
      })
    }
    if (ctx.axisId) {
      tries.push({
        dimension: "axis_id",
        key: ctx.axisId,
        confidence: "medium",
        supportTargetId: `axis:${ctx.axisId}`,
        label: nodeMap.get(`axis:${ctx.axisId}`)?.label ?? `Eje ${ctx.axisId.slice(0, 8)}`,
      })
    }
    if (ctx.cognitiveKey) {
      tries.push({
        dimension: "cognitive_level",
        key: ctx.cognitiveKey,
        confidence: "medium",
        supportTargetId: `cognitive_level:${ctx.cognitiveKey}`,
        label:
          nodeMap.get(`cognitive_level:${ctx.cognitiveKey}`)?.label ??
          sourceByQuestion.get(ctx.questionNumber)?.cognitive_level?.trim() ??
          ctx.cognitiveKey,
      })
    }
    if (ctx.skillText) {
      tries.push({
        dimension: "skill_label_text",
        key: normKey(ctx.skillText),
        confidence: "low",
        supportTargetId: textLabelNodeId("skill_label_text", ctx.skillText),
        label: truncateExcerpt(ctx.skillText, 48),
      })
    }
    if (ctx.axisText) {
      tries.push({
        dimension: "axis_label_text",
        key: normKey(ctx.axisText),
        confidence: "low",
        supportTargetId: textLabelNodeId("axis_label_text", ctx.axisText),
        label: truncateExcerpt(ctx.axisText, 48),
      })
    }

    for (const t of tries) {
      const id = `${t.dimension}:${t.key}`
      const existing = regrouped.get(id)
      if (!existing) {
        regrouped.set(id, {
          dimension: t.dimension,
          key: t.key,
          confidence: t.confidence,
          label: t.label,
          questionNumbers: [ctx.questionNumber],
          itemNodeIds: [ctx.itemNodeId],
          supportTargetId: t.supportTargetId,
          priority: dimensionPriority(t.dimension, t.confidence),
        })
      } else {
        if (!existing.questionNumbers.includes(ctx.questionNumber)) {
          existing.questionNumbers.push(ctx.questionNumber)
        }
        if (!existing.itemNodeIds.includes(ctx.itemNodeId)) {
          existing.itemNodeIds.push(ctx.itemNodeId)
        }
      }
    }
  }

  const candidates = [...regrouped.values()]
    .filter((c) => c.questionNumbers.length >= 2)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return b.questionNumbers.length - a.questionNumbers.length
    })
    .slice(0, MAX_CO_FAILURE_CLUSTERS)

  let inferredEdgeCount = 0

  const tryAddInferredEdge = (edge: PedagogicalGraphEdge): boolean => {
    if (inferredEdgeCount >= MAX_INFERRED_INTRA_EVAL_EDGES) return false
    const meta = edge.metadata ?? {}
    if (meta.is_inferred !== true) return false
    upsertEdge(edgeMap, edge)
    inferredEdgeCount++
    return true
  }

  for (const cluster of candidates) {
    const qSorted = [...cluster.questionNumbers].sort((a, b) => a - b)
    const supportCount = qSorted.length
    const { clusterId, patternId, relationId } = clusterNodeIds(
      evaluationId,
      cluster.dimension,
      cluster.key
    )

    const graphConf = toGraphConfidence(cluster.confidence)
    const explanation = buildExplanation(cluster.dimension, cluster.label, supportCount)
    const sharedMeta = baseInferredMetadata({
      confidence: cluster.confidence,
      supportCount,
      evidenceItemNumbers: qSorted,
      explanation,
      dimension: cluster.dimension,
    })

    const clusterLabel = `Co-fallo · ${supportCount} ítems`
    const patternLabel = `Patrón posible · ${cluster.label}`

    upsertNode(nodeMap, {
      id: clusterId,
      type: "co_occurrence_cluster",
      label: clusterLabel,
      confidence: graphConf,
      metadata: {
        ...sharedMeta,
        cluster_kind: "intra_evaluation_co_failure",
      },
    })

    upsertNode(nodeMap, {
      id: patternId,
      type: "failure_pattern",
      label: patternLabel,
      confidence: graphConf,
      metadata: {
        ...sharedMeta,
        pattern_kind: "possible_difficulty_pattern",
        disclaimer: "No es diagnóstico definitivo",
      },
    })

    upsertNode(nodeMap, {
      id: relationId,
      type: "inferred_relation",
      label: "Hipótesis pedagógica",
      confidence: graphConf,
      metadata: {
        ...sharedMeta,
        relation_kind: "co_failure_hypothesis",
      },
    })

    tryAddInferredEdge({
      id: edgeId(evaluationNodeId, "has_inferred_pattern", patternId),
      source: evaluationNodeId,
      target: patternId,
      type: "has_inferred_pattern",
      confidence: graphConf,
      metadata: sharedMeta,
    })

    tryAddInferredEdge({
      id: edgeId(patternId, "co_fails_with", clusterId),
      source: patternId,
      target: clusterId,
      type: "co_fails_with",
      confidence: graphConf,
      metadata: sharedMeta,
    })

    if (cluster.supportTargetId && nodeMap.has(cluster.supportTargetId)) {
      tryAddInferredEdge({
        id: edgeId(patternId, "supported_by", cluster.supportTargetId),
        source: patternId,
        target: cluster.supportTargetId,
        type: "supported_by",
        confidence: graphConf,
        metadata: sharedMeta,
      })
    }

    tryAddInferredEdge({
      id: edgeId(relationId, "contributes_to", patternId),
      source: relationId,
      target: patternId,
      type: "contributes_to",
      confidence: graphConf,
      metadata: {
        ...sharedMeta,
        relation_role: "hypothesis_anchor",
      },
    })

    for (const itemId of cluster.itemNodeIds) {
      if (!nodeMap.has(itemId)) continue
      if (
        !tryAddInferredEdge({
          id: edgeId(itemId, "contributes_to", patternId),
          source: itemId,
          target: patternId,
          type: "contributes_to",
          confidence: graphConf,
          metadata: sharedMeta,
        })
      ) {
        break
      }
    }

    const itemIds = cluster.itemNodeIds.filter((id) => nodeMap.has(id))
    for (let i = 0; i < itemIds.length; i++) {
      if (
        !tryAddInferredEdge({
          id: edgeId(itemIds[i], "co_fails_with", clusterId),
          source: itemIds[i],
          target: clusterId,
          type: "co_fails_with",
          confidence: graphConf,
          metadata: sharedMeta,
        })
      ) {
        break
      }
    }

    if (itemIds.length >= 2) {
      for (let i = 1; i < itemIds.length; i++) {
        if (
          !tryAddInferredEdge({
            id: edgeId(itemIds[i - 1], "co_fails_with", itemIds[i]),
            source: itemIds[i - 1],
            target: itemIds[i],
            type: "co_fails_with",
            confidence: graphConf,
            metadata: sharedMeta,
          })
        ) {
          break
        }
      }
    }
  }

  return {
    coFailureClustersCount: candidates.length,
    inferredIntraEvalEdgesCount: inferredEdgeCount,
  }
}
