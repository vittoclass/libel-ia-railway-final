/**
 * FASE 0 — Memoria caligráfica (solo observabilidad en grafo).
 * Extrae evidencia desde tablas/campos existentes; no modifica OCR ni scoring.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { pickStudentDesarrolloVisibleText, isPlaceholderStudentDesarrolloText } from "@/app/lib/pick-student-desarrollo-text"
import type { PedagogicalGraphEdge, PedagogicalGraphNode } from "@/app/lib/pedagogical-graph/types"

export type HandwritingEvidenceBuildInput = {
  evaluationId: string
  evaluationNodeId: string
  studentNodeId: string | null
  scanImagePaths: string[]
  /** Origen de rutas de escaneo (opcional; solo metadata). */
  scanPathsSource?: string | null
  items: Array<{
    question_number: number
    student_answer?: string | null
    correct_answer?: string | null
  }>
  summaryRaw: unknown
}

function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ")
}

function textsDiffer(a: string, b: string): boolean {
  const na = normText(a)
  const nb = normText(b)
  if (!na && !nb) return false
  return na !== nb
}

function parseDevelopmentQuestionNumber(key: string): number | null {
  const k = String(key).trim()
  const numMatch = k.match(/(\d+)/)
  if (numMatch) {
    const n = parseInt(numMatch[1], 10)
    if (n >= 1 && n <= 999) return n
  }
  return null
}

function isRecord(u: unknown): u is Record<string, unknown> {
  return u != null && typeof u === "object" && !Array.isArray(u)
}

/** Ítem con respuesta abierta/manuscrita (desarrollo), no burbuja A–D. */
export function isLikelyHandwrittenOpenAnswer(item: {
  student_answer?: string | null
  correct_answer?: string | null
}): boolean {
  const ans = item.student_answer != null ? String(item.student_answer).trim() : ""
  if (!ans || isPlaceholderStudentDesarrolloText(ans)) return false
  const corr = item.correct_answer != null ? String(item.correct_answer).trim() : ""
  if (!corr) return true
  if (ans.length > 8) return true
  const single = /^[A-Da-d]$/.test(ans)
  return !single
}

export function parseScanImagePaths(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((p) => String(p).trim()).filter(Boolean)
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.map((p) => String(p).trim()).filter(Boolean)
    } catch {
      return [raw.trim()]
    }
  }
  return []
}

function isOptionalSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  const code = String(err.code ?? "")
  const msg = String(err.message ?? "").toLowerCase()
  if (code === "42703" || code === "PGRST204" || code === "42P01") return true
  if (msg.includes("does not exist") && (msg.includes("column") || msg.includes("relation"))) return true
  return msg.includes("column") && (msg.includes("does not exist") || msg.includes("not found"))
}

/** Rutas de imagen dentro de `evaluation_summaries.raw` (sin columna evaluations.scan_image_paths). */
export function extractScanPathsFromSummaryRaw(raw: unknown): string[] {
  if (!isRecord(raw)) return []
  const keys = [
    "scan_image_paths",
    "scanImagePaths",
    "image_paths",
    "imagePaths",
    "storage_paths",
    "storagePaths",
  ] as const
  for (const k of keys) {
    const paths = parseScanImagePaths(raw[k])
    if (paths.length > 0) return paths
  }
  return []
}

function pathsFromBatchPhotoRows(data: unknown[] | null): string[] {
  return (data ?? [])
    .map((row) => String((row as { storage_path?: string | null }).storage_path ?? "").trim())
    .filter(Boolean)
}

/** Consulta batch_photo_uploads; falla en silencio si tabla/columna no existe. */
export async function fetchScanPathsFromBatchPhotos(
  supabase: SupabaseClient,
  evaluationId: string,
  batchId: string | null
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("batch_photo_uploads")
      .select("storage_path")
      .eq("evaluation_id", evaluationId)
      .order("page_index", { ascending: true })
      .limit(100)

    if (error && isOptionalSchemaError(error)) return []
    if (error) return []

    let paths = pathsFromBatchPhotoRows(data)
    if (paths.length === 0 && batchId) {
      const second = await supabase
        .from("batch_photo_uploads")
        .select("storage_path")
        .eq("batch_id", batchId)
        .eq("evaluation_id", evaluationId)
        .order("page_index", { ascending: true })
        .limit(100)
      if (!second.error || !isOptionalSchemaError(second.error)) {
        if (!second.error) paths = pathsFromBatchPhotoRows(second.data)
      }
    }
    return [...new Set(paths)]
  } catch {
    return []
  }
}

/** Resuelve rutas de escaneo sin depender de evaluations.scan_image_paths. */
export async function resolveScanImagePathsForGraph(
  supabase: SupabaseClient,
  opts: { evaluationId: string; batchId: string | null; summaryRaw: unknown }
): Promise<{ paths: string[]; source: string | null }> {
  const fromRaw = extractScanPathsFromSummaryRaw(opts.summaryRaw)
  const fromBatch = await fetchScanPathsFromBatchPhotos(supabase, opts.evaluationId, opts.batchId)
  const paths = [...new Set([...fromRaw, ...fromBatch])]
  let source: string | null = null
  if (fromRaw.length > 0 && fromBatch.length > 0) {
    source = "evaluation_summaries.raw+batch_photo_uploads"
  } else if (fromRaw.length > 0) {
    source = "evaluation_summaries.raw"
  } else if (fromBatch.length > 0) {
    source = "batch_photo_uploads"
  }
  return { paths, source }
}

export type OcrTextByQuestion = Map<number, string>

/** Texto OCR original persistido en evaluation_summaries.raw (snapshot de corrección). */
export function extractOcrTextsFromSummaryRaw(raw: unknown): {
  desarrollo: OcrTextByQuestion
  alternativas: OcrTextByQuestion
  hasRaw: boolean
} {
  const desarrollo = new Map<number, string>()
  const alternativas = new Map<number, string>()
  if (!isRecord(raw)) return { desarrollo, alternativas, hasRaw: false }

  const det = raw.detalle_desarrollo
  if (isRecord(det)) {
    for (const [key, val] of Object.entries(det)) {
      if (!isRecord(val)) continue
      const qn = parseDevelopmentQuestionNumber(key)
      if (qn == null) continue
      const text = pickStudentDesarrolloVisibleText(val)
      if (text) desarrollo.set(qn, text)
    }
  }

  const alts = raw.alternativas_corregidas
  if (Array.isArray(alts)) {
    alts.forEach((row, idx) => {
      if (!isRecord(row)) return
      const text = String(row.respuesta_estudiante ?? "").trim()
      if (!text) return
      alternativas.set(idx + 1, text)
    })
  }

  return { desarrollo, alternativas, hasRaw: true }
}

function edgeId(source: string, type: string, target: string): string {
  return `${source}|${type}|${target}`
}

function upsertNode(
  map: Map<string, PedagogicalGraphNode>,
  node: PedagogicalGraphNode
): void {
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

export type HandwritingEvidenceBuildResult = {
  evidenceCount: number
  hasHandwritingProfile: boolean
}

/**
 * Agrega nodos/aristas de evidencia caligráfica al grafo (FASE 0).
 * Todo con confidence baja salvo rutas de escaneo explícitas.
 */
export function appendHandwritingEvidenceNodes(params: {
  input: HandwritingEvidenceBuildInput
  nodeMap: Map<string, PedagogicalGraphNode>
  edgeMap: Map<string, PedagogicalGraphEdge>
}): HandwritingEvidenceBuildResult {
  const { input, nodeMap, edgeMap } = params
  const { evaluationId, evaluationNodeId, studentNodeId } = input
  let evidenceCount = 0

  const ocrFromRaw = extractOcrTextsFromSummaryRaw(input.summaryRaw)
  const scanPaths = input.scanImagePaths

  let profileNodeId: string | null = null
  const ensureProfile = (): string | null => {
    if (!studentNodeId) return null
    if (!profileNodeId) {
      profileNodeId = `handwriting_profile:${studentNodeId}`
      upsertNode(nodeMap, {
        id: profileNodeId,
        type: "handwriting_profile",
        label: "Perfil caligráfico (evidencia)",
        confidence: "low",
        metadata: {
          phase: "0_observability",
          student_node_id: studentNodeId,
          note: "Sin reconocimiento de letras; solo agregación futura de evidencia.",
        },
      })
      upsertEdge(edgeMap, {
        id: edgeId(studentNodeId, "has_handwriting_profile", profileNodeId),
        source: studentNodeId,
        target: profileNodeId,
        type: "has_handwriting_profile",
        confidence: "low",
      })
    }
    return profileNodeId
  }

  if (scanPaths.length > 0) {
    const scanEvId = `writing_evidence:${evaluationId}:scans`
    upsertNode(nodeMap, {
      id: scanEvId,
      type: "writing_evidence",
      label: `Escaneos (${scanPaths.length})`,
      confidence: "high",
      metadata: {
        kind: "scan_image_paths",
        path_count: scanPaths.length,
        paths_preview: scanPaths.slice(0, 3),
        is_evidence_only: true,
      },
    })
    upsertEdge(edgeMap, {
      id: edgeId(evaluationNodeId, "contains_writing_evidence", scanEvId),
      source: evaluationNodeId,
      target: scanEvId,
      type: "contains_writing_evidence",
      confidence: "high",
      metadata: {
        source: input.scanPathsSource ?? "scan_paths_unavailable",
      },
    })
    evidenceCount++
    ensureProfile()
  }

  for (const item of input.items) {
    const qn = Number(item.question_number)
    if (!Number.isFinite(qn) || qn <= 0) continue

    const currentText = item.student_answer != null ? String(item.student_answer).trim() : ""
    const ocrDesarrollo = ocrFromRaw.desarrollo.get(qn) ?? ""
    const ocrAlt = ocrFromRaw.alternativas.get(qn) ?? ""
    const ocrOriginal = ocrDesarrollo || ocrAlt

    const isOpen = isLikelyHandwrittenOpenAnswer(item)
    const hasCurrentText = currentText.length > 0 && !isPlaceholderStudentDesarrolloText(currentText)
    const hasOcrInRaw = ocrOriginal.length > 0

    if (!isOpen && !hasOcrInRaw) continue
    if (!hasCurrentText && !hasOcrInRaw && !isOpen) continue

    const itemId = `item:${evaluationId}:q${qn}`
    const writingEvId = `writing_evidence:${evaluationId}:q${qn}`
    const excerpt =
      (hasCurrentText ? currentText : ocrOriginal).slice(0, 80) +
      ((hasCurrentText ? currentText : ocrOriginal).length > 80 ? "…" : "")

    upsertNode(nodeMap, {
      id: writingEvId,
      type: "writing_evidence",
      label: `Respuesta escrita · ítem ${qn}`,
      confidence: hasCurrentText || hasOcrInRaw ? "high" : "low",
      metadata: {
        kind: isOpen ? "open_answer" : "marked_or_short",
        question_number: qn,
        text_excerpt: excerpt || null,
        has_student_answer_db: hasCurrentText,
        has_ocr_in_raw: hasOcrInRaw,
        is_evidence_only: true,
      },
    })
    upsertEdge(edgeMap, {
      id: edgeId(itemId, "has_written_answer", writingEvId),
      source: itemId,
      target: writingEvId,
      type: "has_written_answer",
      confidence: "high",
    })
    upsertEdge(edgeMap, {
      id: edgeId(evaluationNodeId, "contains_writing_evidence", writingEvId),
      source: evaluationNodeId,
      target: writingEvId,
      type: "contains_writing_evidence",
      confidence: "high",
    })
    evidenceCount++
    const profId = ensureProfile()

    if (hasOcrInRaw) {
      const ocrNodeId = `ocr_original_text:${evaluationId}:q${qn}`
      upsertNode(nodeMap, {
        id: ocrNodeId,
        type: "ocr_original_text",
        label: `OCR original · ítem ${qn}`,
        confidence: "low",
        metadata: {
          question_number: qn,
          text_length: ocrOriginal.length,
          source: ocrDesarrollo ? "evaluation_summaries.raw.detalle_desarrollo" : "evaluation_summaries.raw.alternativas_corregidas",
          is_evidence_only: true,
        },
      })
      upsertEdge(edgeMap, {
        id: edgeId(writingEvId, "references", ocrNodeId),
        source: writingEvId,
        target: ocrNodeId,
        type: "contains",
        confidence: "low",
        metadata: { role: "ocr_snapshot_from_raw" },
      })
    }

    const teacherDiffers =
      hasOcrInRaw && hasCurrentText && textsDiffer(ocrOriginal, currentText)
    const placeholderMismatch =
      hasOcrInRaw &&
      hasCurrentText &&
      isPlaceholderStudentDesarrolloText(currentText) &&
      !isPlaceholderStudentDesarrolloText(ocrOriginal)

    if (teacherDiffers) {
      const correctedId = `teacher_corrected_text:${evaluationId}:q${qn}`
      upsertNode(nodeMap, {
        id: correctedId,
        type: "teacher_corrected_text",
        label: `Corrección docente · ítem ${qn}`,
        confidence: "low",
        metadata: {
          question_number: qn,
          current_text_length: currentText.length,
          ocr_text_length: ocrOriginal.length,
          is_evidence_only: true,
        },
      })
      upsertEdge(edgeMap, {
        id: edgeId(correctedId, "improves", profId ?? writingEvId),
        source: correctedId,
        target: profId ?? writingEvId,
        type: "improves",
        confidence: "low",
        metadata: { note: "Diferencia texto DB vs raw; no altera OCR ni puntaje." },
      })
    }

    if (teacherDiffers || placeholderMismatch) {
      const diffId = `possible_ocr_difficulty:${evaluationId}:q${qn}`
      upsertNode(nodeMap, {
        id: diffId,
        type: "possible_ocr_difficulty",
        label: `Posible dificultad OCR · ítem ${qn}`,
        confidence: "low",
        metadata: {
          question_number: qn,
          reason: placeholderMismatch ? "placeholder_vs_raw_text" : "teacher_text_differs_from_raw",
          is_evidence_only: true,
          not_a_decision: true,
        },
      })
      upsertEdge(edgeMap, {
        id: edgeId(writingEvId, "may_need_review", diffId),
        source: writingEvId,
        target: diffId,
        type: "may_need_review",
        confidence: "low",
      })
    }
  }

  if (ocrFromRaw.hasRaw && studentNodeId) {
    ensureProfile()
  }

  return {
    evidenceCount,
    hasHandwritingProfile: profileNodeId != null,
  }
}
