/**
 * FASE 1 — Memoria caligráfica histórica (Graph Layer longitudinal).
 * Conecta evidencia entre evaluaciones del mismo estudiante; no modifica OCR ni scoring.
 */
import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isPlaceholderStudentDesarrolloText } from "@/app/lib/pick-student-desarrollo-text"
import {
  extractOcrTextsFromSummaryRaw,
  isLikelyHandwrittenOpenAnswer,
} from "@/app/lib/pedagogical-graph/handwritingEvidence"
import type { PedagogicalGraphEdge, PedagogicalGraphNode } from "@/app/lib/pedagogical-graph/types"

/** Límite de evaluaciones históricas consultadas (excluye la actual). */
export const MAX_HISTORICAL_EVALUATIONS = 8
/** Máximo de clusters de patrón en el snapshot. */
export const MAX_PATTERN_CLUSTERS = 12
/** Máximo de aristas shares_pattern_with (actual ↔ histórica). */
export const MAX_SHARED_PATTERN_EDGES = 16
/** Máximo de nodos recurring_ocr_confusion materializados. */
export const MAX_RECURRING_OCR_NODES = 6
/** Longitud máxima del excerpt en fingerprints (evita nodos pesados). */
const FINGERPRINT_TEXT_CHARS = 48

export type HistoricalMemoryBuildInput = {
  evaluationId: string
  evaluationNodeId: string
  studentNodeId: string | null
  studentProfileId: string | null
  catalogStudentId: string | null
  teacherId: string | null
  items: Array<{
    question_number: number
    student_answer?: string | null
    correct_answer?: string | null
  }>
  summaryRaw: unknown
}

export type HistoricalMemoryBuildResult = {
  historicalEvaluationsIncluded: number
  repeatedPatternClusters: number
  recurringOcrConfusionCount: number
  skippedReason?: "no_student_identity"
}

type GraphEvaluationItemRow = {
  question_number: number
  student_answer?: string | null
  correct_answer?: string | null
}

type EvalHandwritingRow = {
  evaluationId: string
  evaluatedAt: string | null
  signatures: ItemSignature[]
}

type ItemSignature = {
  questionNumber: number
  kind: "ocr_difficulty" | "teacher_correction"
  reason: string
  fingerprint: string
  excerpt: string | null
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

function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase()
}

function textsDiffer(a: string, b: string): boolean {
  const na = normText(a)
  const nb = normText(b)
  if (!na && !nb) return false
  return na !== nb
}

function hashShort(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12)
}

function studentMemoryKey(profileId: string | null, catalogId: string | null): string | null {
  if (profileId) return `profile:${profileId}`
  if (catalogId) return `catalog:${catalogId}`
  return null
}

function isOptionalSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  const code = String(err.code ?? "")
  const msg = String(err.message ?? "").toLowerCase()
  if (code === "42703" || code === "PGRST204" || code === "42P01") return true
  if (msg.includes("does not exist") && (msg.includes("column") || msg.includes("relation"))) return true
  return msg.includes("column") && (msg.includes("does not exist") || msg.includes("not found"))
}

/** Extrae firmas livianas por ítem (sin IA, sin letras). */
export function extractItemSignaturesFromEval(params: {
  evaluationId: string
  items: GraphEvaluationItemRow[]
  summaryRaw: unknown
}): ItemSignature[] {
  const { items, summaryRaw } = params
  const ocrFromRaw = extractOcrTextsFromSummaryRaw(summaryRaw)
  const out: ItemSignature[] = []

  for (const item of items) {
    const qn = Number(item.question_number)
    if (!Number.isFinite(qn) || qn <= 0) continue

    const currentText = item.student_answer != null ? String(item.student_answer).trim() : ""
    const ocrDesarrollo = ocrFromRaw.desarrollo.get(qn) ?? ""
    const ocrAlt = ocrFromRaw.alternativas.get(qn) ?? ""
    const ocrOriginal = ocrDesarrollo || ocrAlt
    const hasCurrentText = currentText.length > 0 && !isPlaceholderStudentDesarrolloText(currentText)
    const hasOcrInRaw = ocrOriginal.length > 0
    const isOpen = isLikelyHandwrittenOpenAnswer(item)

    if (!isOpen && !hasOcrInRaw) continue
    if (!hasCurrentText && !hasOcrInRaw && !isOpen) continue

    const teacherDiffers = hasOcrInRaw && hasCurrentText && textsDiffer(ocrOriginal, currentText)
    const placeholderMismatch =
      hasOcrInRaw &&
      hasCurrentText &&
      isPlaceholderStudentDesarrolloText(currentText) &&
      !isPlaceholderStudentDesarrolloText(ocrOriginal)

    if (teacherDiffers || placeholderMismatch) {
      const reason = placeholderMismatch ? "placeholder_vs_raw_text" : "teacher_text_differs_from_raw"
      const fpBase = `ocr_difficulty|${reason}|${normText(ocrOriginal).slice(0, FINGERPRINT_TEXT_CHARS)}`
      out.push({
        questionNumber: qn,
        kind: "ocr_difficulty",
        reason,
        fingerprint: hashShort(fpBase),
        excerpt: ocrOriginal.slice(0, FINGERPRINT_TEXT_CHARS) || null,
      })
    }

    if (teacherDiffers) {
      const diffSnippet = normText(currentText).slice(0, FINGERPRINT_TEXT_CHARS)
      const fpBase = `teacher_correction|${normText(ocrOriginal).slice(0, 24)}|${diffSnippet}`
      out.push({
        questionNumber: qn,
        kind: "teacher_correction",
        reason: "teacher_text_differs_from_raw",
        fingerprint: hashShort(fpBase),
        excerpt: currentText.slice(0, FINGERPRINT_TEXT_CHARS) || null,
      })
    }
  }

  return out
}

async function listHistoricalEvaluationIds(
  supabase: SupabaseClient,
  opts: {
    studentProfileId: string | null
    catalogStudentId: string | null
    currentEvaluationId: string
    teacherId: string | null
    limit: number
  }
): Promise<Array<{ id: string; evaluated_at: string | null }>> {
  const ids = new Set<string>()

  if (opts.studentProfileId) {
    const { data, error } = await supabase
      .from("evaluation_students")
      .select("evaluation_id")
      .eq("student_profile_id", opts.studentProfileId)
      .neq("evaluation_id", opts.currentEvaluationId)
      .limit(80)

    if (!error) {
      for (const row of data ?? []) {
        const eid = String((row as { evaluation_id?: string }).evaluation_id ?? "").trim()
        if (eid) ids.add(eid)
      }
    }
  }

  if (opts.catalogStudentId) {
    const { data: seRows } = await supabase
      .from("student_evaluations")
      .select("evaluation_id")
      .eq("student_id", opts.catalogStudentId)
      .neq("evaluation_id", opts.currentEvaluationId)
      .limit(80)

    for (const row of seRows ?? []) {
      const eid = String((row as { evaluation_id?: string }).evaluation_id ?? "").trim()
      if (eid) ids.add(eid)
    }

    const { data: esRows, error: esErr } = await supabase
      .from("evaluation_students")
      .select("evaluation_id")
      .eq("student_id", opts.catalogStudentId)
      .neq("evaluation_id", opts.currentEvaluationId)
      .limit(80)

    if (!esErr || !isOptionalSchemaError(esErr)) {
      for (const row of esRows ?? []) {
        const eid = String((row as { evaluation_id?: string }).evaluation_id ?? "").trim()
        if (eid) ids.add(eid)
      }
    }
  }

  if (ids.size === 0) return []

  let query = supabase
    .from("evaluations")
    .select("id, evaluated_at")
    .in("id", [...ids])
    .order("evaluated_at", { ascending: false })
    .limit(opts.limit)

  if (opts.teacherId) {
    query = query.eq("teacher_id", opts.teacherId)
  }

  const { data, error } = await query
  if (error && !isOptionalSchemaError(error)) return []
  return (data ?? []).map((r) => ({
    id: String((r as { id: string }).id),
    evaluated_at: (r as { evaluated_at?: string | null }).evaluated_at ?? null,
  }))
}

async function loadHistoricalEvalRows(
  supabase: SupabaseClient,
  evaluationIds: string[]
): Promise<Map<string, { items: GraphEvaluationItemRow[]; summaryRaw: unknown }>> {
  const out = new Map<string, { items: GraphEvaluationItemRow[]; summaryRaw: unknown }>()
  if (evaluationIds.length === 0) return out

  const [itemsRes, summariesRes] = await Promise.all([
    supabase
      .from("evaluation_items")
      .select("evaluation_id, question_number, student_answer, correct_answer")
      .in("evaluation_id", evaluationIds),
    supabase.from("evaluation_summaries").select("evaluation_id, raw").in("evaluation_id", evaluationIds),
  ])

  const itemsByEval = new Map<string, GraphEvaluationItemRow[]>()
  for (const row of itemsRes.data ?? []) {
    const eid = String((row as { evaluation_id?: string }).evaluation_id ?? "").trim()
    if (!eid) continue
    const list = itemsByEval.get(eid) ?? []
    list.push({
      question_number: Number((row as { question_number?: number }).question_number),
      student_answer: (row as { student_answer?: string | null }).student_answer,
      correct_answer: (row as { correct_answer?: string | null }).correct_answer,
    })
    itemsByEval.set(eid, list)
  }

  const rawByEval = new Map<string, unknown>()
  for (const row of summariesRes.data ?? []) {
    const eid = String((row as { evaluation_id?: string }).evaluation_id ?? "").trim()
    if (eid) rawByEval.set(eid, (row as { raw?: unknown }).raw ?? null)
  }

  for (const eid of evaluationIds) {
    out.set(eid, {
      items: itemsByEval.get(eid) ?? [],
      summaryRaw: rawByEval.get(eid) ?? null,
    })
  }
  return out
}

type PatternCluster = {
  clusterId: string
  kind: "ocr_difficulty" | "teacher_correction"
  reason: string
  fingerprint: string
  evaluationIds: string[]
  occurrenceCount: number
  excerpt: string | null
}

function buildPatternClusters(rows: EvalHandwritingRow[]): PatternCluster[] {
  const byFp = new Map<
    string,
    {
      kind: ItemSignature["kind"]
      reason: string
      fingerprint: string
      evalIds: Set<string>
      excerpt: string | null
      count: number
    }
  >()

  for (const row of rows) {
    for (const sig of row.signatures) {
      const key = `${sig.kind}|${sig.fingerprint}`
      const bucket = byFp.get(key) ?? {
        kind: sig.kind,
        reason: sig.reason,
        fingerprint: sig.fingerprint,
        evalIds: new Set<string>(),
        excerpt: sig.excerpt,
        count: 0,
      }
      bucket.evalIds.add(row.evaluationId)
      bucket.count += 1
      byFp.set(key, bucket)
    }
  }

  const clusters: PatternCluster[] = []
  for (const bucket of byFp.values()) {
    if (bucket.evalIds.size < 2) continue
    clusters.push({
      clusterId: bucket.fingerprint,
      kind: bucket.kind,
      reason: bucket.reason,
      fingerprint: bucket.fingerprint,
      evaluationIds: [...bucket.evalIds],
      occurrenceCount: bucket.count,
      excerpt: bucket.excerpt,
    })
  }

  return clusters
    .sort((a, b) => b.evaluationIds.length - a.evaluationIds.length || b.occurrenceCount - a.occurrenceCount)
    .slice(0, MAX_PATTERN_CLUSTERS)
}

/**
 * Agrega memoria caligráfica longitudinal al snapshot (FASE 1).
 * Solo lectura; no persiste ni altera OCR/scoring.
 */
export async function appendHandwritingHistoricalMemory(params: {
  supabase: SupabaseClient
  input: HistoricalMemoryBuildInput
  nodeMap: Map<string, PedagogicalGraphNode>
  edgeMap: Map<string, PedagogicalGraphEdge>
}): Promise<HistoricalMemoryBuildResult> {
  const { supabase, input, nodeMap, edgeMap } = params
  const memoryKey = studentMemoryKey(input.studentProfileId, input.catalogStudentId)

  if (!memoryKey || !input.studentNodeId) {
    return {
      historicalEvaluationsIncluded: 0,
      repeatedPatternClusters: 0,
      recurringOcrConfusionCount: 0,
      skippedReason: "no_student_identity",
    }
  }

  const currentSignatures = extractItemSignaturesFromEval({
    evaluationId: input.evaluationId,
    items: input.items,
    summaryRaw: input.summaryRaw,
  })

  const historicalMeta = await listHistoricalEvaluationIds(supabase, {
    studentProfileId: input.studentProfileId,
    catalogStudentId: input.catalogStudentId,
    currentEvaluationId: input.evaluationId,
    teacherId: input.teacherId,
    limit: MAX_HISTORICAL_EVALUATIONS,
  })

  const histIds = historicalMeta.map((h) => h.id)
  const histPayload = await loadHistoricalEvalRows(supabase, histIds)

  const evalRows: EvalHandwritingRow[] = [
    {
      evaluationId: input.evaluationId,
      evaluatedAt: null,
      signatures: currentSignatures,
    },
  ]

  for (const meta of historicalMeta) {
    const payload = histPayload.get(meta.id)
    if (!payload) continue
    evalRows.push({
      evaluationId: meta.id,
      evaluatedAt: meta.evaluated_at,
      signatures: extractItemSignaturesFromEval({
        evaluationId: meta.id,
        items: payload.items,
        summaryRaw: payload.summaryRaw,
      }),
    })
  }

  const clusters = buildPatternClusters(evalRows)
  const historicalEvaluationsIncluded = histIds.length

  const histProfileId = `historical_handwriting_profile:${memoryKey}`
  const memoryNodeId = `handwriting_memory:${memoryKey}`
  const progressNodeId = `writing_progress:${memoryKey}`

  upsertNode(nodeMap, {
    id: histProfileId,
    type: "historical_handwriting_profile",
    label: "Perfil caligráfico histórico",
    confidence: historicalEvaluationsIncluded > 0 ? "high" : "low",
    metadata: {
      phase: "1_longitudinal",
      student_profile_id: input.studentProfileId,
      catalog_student_id: input.catalogStudentId,
      historical_evaluation_count: historicalEvaluationsIncluded,
      evaluations_considered_cap: MAX_HISTORICAL_EVALUATIONS,
      is_evidence_only: true,
      no_letter_recognition: true,
    },
  })

  upsertEdge(edgeMap, {
    id: edgeId(input.studentNodeId, "has_handwriting_memory", histProfileId),
    source: input.studentNodeId,
    target: histProfileId,
    type: "has_handwriting_memory",
    confidence: "low",
    metadata: { note: "Memoria pasiva; no altera OCR ni puntajes." },
  })

  const ocrDifficultyTotal = evalRows.reduce(
    (acc, r) => acc + r.signatures.filter((s) => s.kind === "ocr_difficulty").length,
    0
  )
  const correctionTotal = evalRows.reduce(
    (acc, r) => acc + r.signatures.filter((s) => s.kind === "teacher_correction").length,
    0
  )

  upsertNode(nodeMap, {
    id: memoryNodeId,
    type: "handwriting_memory",
    label: "Memoria de escritura (longitudinal)",
    confidence: "low",
    metadata: {
      phase: "1_longitudinal",
      snapshot_evaluation_id: input.evaluationId,
      historical_evaluations_included: historicalEvaluationsIncluded,
      pattern_cluster_count: clusters.length,
      ocr_difficulty_signatures_total: ocrDifficultyTotal,
      teacher_correction_signatures_total: correctionTotal,
      is_evidence_only: true,
    },
  })

  upsertEdge(edgeMap, {
    id: edgeId(histProfileId, "aggregates", memoryNodeId),
    source: histProfileId,
    target: memoryNodeId,
    type: "aggregates",
    confidence: "low",
  })

  const sortedByTime = [...evalRows].sort((a, b) => {
    const ta = historicalMeta.find((h) => h.id === a.evaluationId)?.evaluated_at ?? ""
    const tb = historicalMeta.find((h) => h.id === b.evaluationId)?.evaluated_at ?? ""
    return String(ta).localeCompare(String(tb))
  })
  const firstHalf = sortedByTime.slice(0, Math.ceil(sortedByTime.length / 2))
  const secondHalf = sortedByTime.slice(Math.ceil(sortedByTime.length / 2))
  const ocrFirst = firstHalf.reduce((a, r) => a + r.signatures.filter((s) => s.kind === "ocr_difficulty").length, 0)
  const ocrSecond = secondHalf.reduce((a, r) => a + r.signatures.filter((s) => s.kind === "ocr_difficulty").length, 0)
  const corrFirst = firstHalf.reduce((a, r) => a + r.signatures.filter((s) => s.kind === "teacher_correction").length, 0)
  const corrSecond = secondHalf.reduce((a, r) => a + r.signatures.filter((s) => s.kind === "teacher_correction").length, 0)

  upsertNode(nodeMap, {
    id: progressNodeId,
    type: "writing_progress",
    label: "Progreso de escritura (heurístico)",
    confidence: "low",
    metadata: {
      phase: "1_longitudinal",
      evaluations_in_window: evalRows.length,
      ocr_difficulty_first_half: ocrFirst,
      ocr_difficulty_second_half: ocrSecond,
      teacher_corrections_first_half: corrFirst,
      teacher_corrections_second_half: corrSecond,
      trend_ocr_difficulty:
        ocrSecond < ocrFirst ? "fewer_difficulties_later" : ocrSecond > ocrFirst ? "more_difficulties_later" : "stable",
      trend_teacher_corrections:
        corrSecond < corrFirst
          ? "fewer_corrections_later"
          : corrSecond > corrFirst
            ? "more_corrections_later"
            : "stable",
      is_heuristic_only: true,
      not_a_score: true,
    },
  })

  upsertEdge(edgeMap, {
    id: edgeId(memoryNodeId, "aggregates", progressNodeId),
    source: memoryNodeId,
    target: progressNodeId,
    type: "aggregates",
    confidence: "low",
  })

  let recurringOcrConfusionCount = 0
  let sharedPatternEdgeCount = 0

  for (const cluster of clusters) {
    const clusterNodeId = `repeated_pattern_cluster:${memoryKey}:${cluster.clusterId}`
    upsertNode(nodeMap, {
      id: clusterNodeId,
      type: "repeated_pattern_cluster",
      label:
        cluster.kind === "ocr_difficulty"
          ? `Patrón OCR repetido (${cluster.evaluationIds.length} eval.)`
          : `Corrección repetida (${cluster.evaluationIds.length} eval.)`,
      confidence: cluster.evaluationIds.length >= 3 ? "high" : "low",
      metadata: {
        phase: "1_longitudinal",
        cluster_kind: cluster.kind,
        reason: cluster.reason,
        fingerprint: cluster.fingerprint,
        evaluation_ids: cluster.evaluationIds.slice(0, 8),
        occurrence_count: cluster.occurrenceCount,
        excerpt_preview: cluster.excerpt,
        is_evidence_only: true,
      },
    })

    upsertEdge(edgeMap, {
      id: edgeId(memoryNodeId, "aggregates", clusterNodeId),
      source: memoryNodeId,
      target: clusterNodeId,
      type: "aggregates",
      confidence: "low",
    })

    if (cluster.kind === "ocr_difficulty" && recurringOcrConfusionCount < MAX_RECURRING_OCR_NODES) {
      const recurId = `recurring_ocr_confusion:${memoryKey}:${cluster.clusterId}`
      upsertNode(nodeMap, {
        id: recurId,
        type: "recurring_ocr_confusion",
        label: "Confusión OCR recurrente",
        confidence: "low",
        metadata: {
          reason: cluster.reason,
          evaluations_count: cluster.evaluationIds.length,
          fingerprint: cluster.fingerprint,
          is_evidence_only: true,
        },
      })
      upsertEdge(edgeMap, {
        id: edgeId(recurId, "repeated_in", input.studentNodeId),
        source: recurId,
        target: input.studentNodeId,
        type: "repeated_in",
        confidence: "low",
      })
      upsertEdge(edgeMap, {
        id: edgeId(clusterNodeId, "linked_to_cluster", recurId),
        source: clusterNodeId,
        target: recurId,
        type: "linked_to_cluster",
        confidence: "low",
      })
      recurringOcrConfusionCount++
    }

    const currentInCluster = cluster.evaluationIds.includes(input.evaluationId)
    if (!currentInCluster) continue

    for (const otherEvalId of cluster.evaluationIds) {
      if (otherEvalId === input.evaluationId) continue
      if (sharedPatternEdgeCount >= MAX_SHARED_PATTERN_EDGES) break

      const otherEvalNodeId = `evaluation:${otherEvalId}`
      if (!nodeMap.has(otherEvalNodeId)) {
        upsertNode(nodeMap, {
          id: otherEvalNodeId,
          type: "evaluation",
          label: "Evaluación (histórica)",
          confidence: "low",
          metadata: {
            evaluation_id: otherEvalId,
            historical_reference_only: true,
            phase: "1_longitudinal",
          },
        })
      }

      upsertEdge(edgeMap, {
        id: edgeId(input.evaluationNodeId, "shares_pattern_with", otherEvalNodeId),
        source: input.evaluationNodeId,
        target: otherEvalNodeId,
        type: "shares_pattern_with",
        confidence: "low",
        metadata: {
          cluster_id: cluster.clusterId,
          cluster_kind: cluster.kind,
          fingerprint: cluster.fingerprint,
        },
      })
      sharedPatternEdgeCount++

      const diffNodePrefix = `possible_ocr_difficulty:${input.evaluationId}:`
      const writingPrefix = `writing_evidence:${input.evaluationId}:`
      for (const [nodeId, node] of nodeMap) {
        if (node.type === "possible_ocr_difficulty" && nodeId.startsWith(diffNodePrefix)) {
          upsertEdge(edgeMap, {
            id: edgeId(nodeId, "linked_to_cluster", clusterNodeId),
            source: nodeId,
            target: clusterNodeId,
            type: "linked_to_cluster",
            confidence: "low",
          })
        }
        if (node.type === "teacher_corrected_text" && nodeId.startsWith(`teacher_corrected_text:${input.evaluationId}:`)) {
          upsertEdge(edgeMap, {
            id: edgeId(nodeId, "contributes_to", memoryNodeId),
            source: nodeId,
            target: memoryNodeId,
            type: "contributes_to",
            confidence: "low",
            metadata: { cluster_id: cluster.clusterId },
          })
        }
        if (
          cluster.kind === "ocr_difficulty" &&
          node.type === "writing_evidence" &&
          nodeId.startsWith(writingPrefix) &&
          !edgeMap.has(edgeId(nodeId, "linked_to_cluster", clusterNodeId))
        ) {
          const qn = (node.metadata as { question_number?: number })?.question_number
          const sigMatch = currentSignatures.some(
            (s) => s.kind === "ocr_difficulty" && s.fingerprint === cluster.fingerprint && s.questionNumber === qn
          )
          if (sigMatch) {
            upsertEdge(edgeMap, {
              id: edgeId(nodeId, "linked_to_cluster", clusterNodeId),
              source: nodeId,
              target: clusterNodeId,
              type: "linked_to_cluster",
              confidence: "low",
            })
          }
        }
      }
    }
  }

  for (const [nodeId, node] of nodeMap) {
    if (node.type !== "teacher_corrected_text") continue
    if (!nodeId.startsWith(`teacher_corrected_text:${input.evaluationId}:`)) continue
    const contribEdgeId = edgeId(nodeId, "contributes_to", memoryNodeId)
    if (!edgeMap.has(contribEdgeId)) {
      upsertEdge(edgeMap, {
        id: contribEdgeId,
        source: nodeId,
        target: memoryNodeId,
        type: "contributes_to",
        confidence: "low",
        metadata: { phase: "1_longitudinal" },
      })
    }
  }

  return {
    historicalEvaluationsIncluded,
    repeatedPatternClusters: clusters.length,
    recurringOcrConfusionCount,
  }
}
