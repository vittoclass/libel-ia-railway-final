/**
 * Construye un snapshot de grafo pedagógico solo lectura desde tablas existentes.
 * Grafo parcial si faltan datos; no inventa habilidades ni ejes.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { getSourceExamForEvaluation } from "@/app/lib/source-exam-db"
import {
  GRAPH_STUDENT_DISPLAY_NAME_FALLBACK,
  GRAPH_STUDENT_NODE_LABEL_WITHOUT_NAME,
  resolveGraphStudentDisplayName,
} from "@/app/lib/pedagogical-graph/resolveGraphStudentName"
import {
  appendHandwritingEvidenceNodes,
  resolveScanImagePathsForGraph,
} from "@/app/lib/pedagogical-graph/handwritingEvidence"
import { appendHandwritingHistoricalMemory } from "@/app/lib/pedagogical-graph/handwritingHistoricalMemory"
import { appendIntraEvaluationCoFailures } from "@/app/lib/pedagogical-graph/dynamicRelations"
import type {
  BuildGraphSnapshotResult,
  PedagogicalGraphConfidence,
  PedagogicalGraphEdge,
  PedagogicalGraphNode,
  PedagogicalGraphSnapshot,
} from "@/app/lib/pedagogical-graph/types"

const WEAK_ACCURACY_THRESHOLD = 0.5
const STRONG_ACCURACY_THRESHOLD = 0.75

function normCognitiveKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

function itemNodeId(evaluationId: string, questionNumber: number): string {
  return `item:${evaluationId}:q${questionNumber}`
}

function edgeId(source: string, type: string, target: string): string {
  return `${source}|${type}|${target}`
}

function isPostgrestSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  const code = String(err.code ?? "")
  const msg = String(err.message ?? "").toLowerCase()
  if (code === "42703" || code === "PGRST204") return true
  return msg.includes("column") && (msg.includes("does not exist") || msg.includes("not found"))
}

type GraphEvaluationItemRow = {
  question_number: number
  score_obtained?: number | null
  score_max?: number | null
  is_correct?: boolean | null
  student_answer?: string | null
  correct_answer?: string | null
}

/** Ítems para el grafo; degrada si columnas de texto opcionales no existen en PostgREST. */
async function loadGraphEvaluationItems(
  supabase: SupabaseClient,
  evaluationId: string,
  initial: { data: unknown[] | null; error: { code?: string; message?: string } | null }
): Promise<GraphEvaluationItemRow[]> {
  if (!initial.error && initial.data) {
    return initial.data as GraphEvaluationItemRow[]
  }
  if (initial.error && isPostgrestSchemaError(initial.error)) {
    const { data, error } = await supabase
      .from("evaluation_items")
      .select("question_number, score_obtained, score_max, is_correct")
      .eq("evaluation_id", evaluationId)
      .order("question_number", { ascending: true })
    if (!error && data) return data as GraphEvaluationItemRow[]
  }
  return (initial.data ?? []) as GraphEvaluationItemRow[]
}

function textLabelNodeId(kind: "skill_label_text" | "axis_label_text", label: string): string {
  return `${kind}:${normCognitiveKey(label)}`
}

function formatCourseLabel(parts: {
  level?: string | null
  letter?: string | null
  year?: number | null
  fallback?: string | null
}): string | null {
  const bits: string[] = []
  if (parts.level && String(parts.level).trim()) bits.push(String(parts.level).trim())
  if (parts.letter && String(parts.letter).trim()) bits.push(String(parts.letter).trim())
  if (parts.year != null && Number.isFinite(Number(parts.year))) bits.push(String(parts.year))
  if (bits.length > 0) return bits.join(" ")
  const fb = parts.fallback != null ? String(parts.fallback).trim() : ""
  return fb || null
}

function upsertNode(
  map: Map<string, PedagogicalGraphNode>,
  node: PedagogicalGraphNode,
  preferHigherConfidence = true
): void {
  const existing = map.get(node.id)
  if (!existing) {
    map.set(node.id, node)
    return
  }
  if (!preferHigherConfidence) return
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

export async function buildGraphSnapshot(
  supabase: SupabaseClient,
  evaluationId: string
): Promise<BuildGraphSnapshotResult> {
  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select(
      "id, subject, source_exam_id, teacher_id, school_id, course_id, course_label, batch_id, title"
    )
    .eq("id", evaluationId)
    .maybeSingle()

  if (evErr) {
    if (isPostgrestSchemaError(evErr)) {
      return { ok: false, reason: "schema_error", message: String(evErr.message ?? "schema_error") }
    }
    return { ok: false, reason: "not_found" }
  }
  if (!evaluation) {
    return { ok: false, reason: "not_found" }
  }

  const evRow = evaluation as {
    subject?: string | null
    source_exam_id?: string | null
    teacher_id?: string | null
    school_id?: string | null
    course_id?: string | null
    course_label?: string | null
    batch_id?: string | null
    title?: string | null
  }

  const subjectRaw = evRow.subject ?? null
  const teacherId = evRow.teacher_id != null && String(evRow.teacher_id).trim() !== "" ? String(evRow.teacher_id).trim() : null
  const schoolId = evRow.school_id != null && String(evRow.school_id).trim() !== "" ? String(evRow.school_id).trim() : null
  const courseId = evRow.course_id != null && String(evRow.course_id).trim() !== "" ? String(evRow.course_id).trim() : null
  const courseLabelRaw =
    evRow.course_label != null && String(evRow.course_label).trim() !== ""
      ? String(evRow.course_label).trim()
      : null
  const batchId = evRow.batch_id != null && String(evRow.batch_id).trim() !== "" ? String(evRow.batch_id).trim() : null

  const sourceExamId = await getSourceExamForEvaluation(supabase, evaluationId)

  const [studentsRes, itemsRes, skillResultsRes, studentEvalRes, summaryRes] = await Promise.all([
    supabase
      .from("evaluation_students")
      .select("id, student_name, student_profile_id, student_id, course_id, course_label")
      .eq("evaluation_id", evaluationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("evaluation_items")
      .select("question_number, score_obtained, score_max, is_correct, student_answer, correct_answer")
      .eq("evaluation_id", evaluationId)
      .order("question_number", { ascending: true }),
    supabase
      .from("evaluation_skill_results")
      .select(
        "skill_id, axis_id, accuracy, score_obtained, score_max, student_profile_id, student_id, achievement_level"
      )
      .eq("evaluation_id", evaluationId),
    supabase
      .from("student_evaluations")
      .select("student_id")
      .eq("evaluation_id", evaluationId)
      .maybeSingle(),
    supabase
      .from("evaluation_summaries")
      .select("grade_chile, strengths, improvements, raw, student_name_raw")
      .eq("evaluation_id", evaluationId)
      .maybeSingle(),
  ])

  const items = await loadGraphEvaluationItems(supabase, evaluationId, itemsRes)

  const sourceItemsRes = sourceExamId
    ? await supabase
        .from("source_exam_items")
        .select("item_number, axis_id, skill_id, axis_label, skill_label, cognitive_level")
        .eq("source_exam_id", sourceExamId)
        .order("item_number", { ascending: true })
    : { data: [] as unknown[], error: null }

  const evalStudentsEarly = (studentsRes.data ?? []) as Array<{
    student_profile_id?: string | null
    student_id?: string | null
    course_id?: string | null
    course_label?: string | null
  }>
  const firstEvalStudentEarly = evalStudentsEarly[0] ?? null
  const earlyStudentProfileId =
    firstEvalStudentEarly?.student_profile_id != null &&
    String(firstEvalStudentEarly.student_profile_id).trim() !== ""
      ? String(firstEvalStudentEarly.student_profile_id).trim()
      : null
  const evalStudentCourseId =
    firstEvalStudentEarly?.course_id != null && String(firstEvalStudentEarly.course_id).trim() !== ""
      ? String(firstEvalStudentEarly.course_id).trim()
      : null
  const evalStudentCourseLabel =
    firstEvalStudentEarly?.course_label != null && String(firstEvalStudentEarly.course_label).trim() !== ""
      ? String(firstEvalStudentEarly.course_label).trim()
      : null

  const resolvedCourseId = courseId ?? evalStudentCourseId
  const resolvedCourseLabel = courseLabelRaw ?? evalStudentCourseLabel

  const studentEvalRowEarly = studentEvalRes.data as { student_id?: string | null } | null
  const catalogStudentIdEarly =
    studentEvalRowEarly?.student_id != null && String(studentEvalRowEarly.student_id).trim() !== ""
      ? String(studentEvalRowEarly.student_id).trim()
      : evalStudentsEarly[0]?.student_id != null && String(evalStudentsEarly[0].student_id).trim() !== ""
        ? String(evalStudentsEarly[0].student_id).trim()
        : null

  const [teacherRes, schoolRes, courseRes, sourceExamRes, profileRes, catalogStudentRes] =
    await Promise.all([
    teacherId
      ? supabase.from("teachers").select("id, name, school_id").eq("id", teacherId).maybeSingle()
      : Promise.resolve({ data: null as unknown, error: null }),
    schoolId
      ? supabase.from("schools").select("id, name").eq("id", schoolId).maybeSingle()
      : Promise.resolve({ data: null as unknown, error: null }),
    resolvedCourseId
      ? supabase
          .from("courses")
          .select("id, level, letter, year, school_id")
          .eq("id", resolvedCourseId)
          .maybeSingle()
      : Promise.resolve({ data: null as unknown, error: null }),
    sourceExamId
      ? supabase.from("source_exams").select("id, title, subject").eq("id", sourceExamId).maybeSingle()
      : Promise.resolve({ data: null as unknown, error: null }),
    earlyStudentProfileId
      ? supabase
          .from("student_profiles")
          .select("id, student_name, course_label, school_id")
          .eq("id", earlyStudentProfileId)
          .maybeSingle()
      : Promise.resolve({ data: null as unknown, error: null }),
    catalogStudentIdEarly
      ? supabase
          .from("students")
          .select("id, full_name")
          .eq("id", catalogStudentIdEarly)
          .maybeSingle()
      : Promise.resolve({ data: null as unknown, error: null }),
  ])

  const nodeMap = new Map<string, PedagogicalGraphNode>()
  const edgeMap = new Map<string, PedagogicalGraphEdge>()

  const evaluationNodeId = `evaluation:${evaluationId}`
  upsertNode(nodeMap, {
    id: evaluationNodeId,
    type: "evaluation",
    label: "Evaluación",
    confidence: "high",
    metadata: { evaluation_id: evaluationId },
  })

  // —— Estudiante y arista completed ——
  const evalStudents = (studentsRes.data ?? []) as Array<{
    id?: string
    student_name?: string | null
    student_profile_id?: string | null
    student_id?: string | null
  }>
  const summaryRowEarly = summaryRes.data as {
    student_name_raw?: string | null
    raw?: unknown
  } | null
  const profileRowEarly = profileRes.data as Record<string, unknown> | null
  const catalogRowEarly = catalogStudentRes.data as Record<string, unknown> | null

  const resolvedStudentName = resolveGraphStudentDisplayName({
    evaluationStudents: evalStudents,
    studentProfile: profileRowEarly,
    studentCatalog: catalogRowEarly,
    summary: summaryRowEarly,
  })
  const student_display_name = resolvedStudentName.hasResolvedName
    ? resolvedStudentName.displayName
    : GRAPH_STUDENT_DISPLAY_NAME_FALLBACK
  const studentNodeLabel = resolvedStudentName.hasResolvedName
    ? resolvedStudentName.displayName
    : GRAPH_STUDENT_NODE_LABEL_WITHOUT_NAME

  const studentEvalRow = studentEvalRes.data as { student_id?: string | null } | null
  const linkedStudentId = studentEvalRow?.student_id ?? null
  const firstEvalStudent = evalStudents[0] ?? null
  const studentProfileId = firstEvalStudent?.student_profile_id ?? null
  const evalStudentRowId = firstEvalStudent?.id ?? null

  let studentNodeId: string | null = null
  if (linkedStudentId) {
    studentNodeId = `student:${linkedStudentId}`
  } else if (studentProfileId) {
    studentNodeId = `student:profile:${studentProfileId}`
  } else if (evalStudentRowId) {
    studentNodeId = `student:evaluation_student:${evalStudentRowId}`
  }

  if (studentNodeId) {
    upsertNode(nodeMap, {
      id: studentNodeId,
      type: "student",
      label: studentNodeLabel,
      confidence: linkedStudentId || studentProfileId ? "high" : "low",
      metadata: {
        student_id: linkedStudentId,
        student_profile_id: studentProfileId,
        name_source: resolvedStudentName.nameSource,
        name_confidence: resolvedStudentName.nameConfidence,
      },
    })
    upsertEdge(edgeMap, {
      id: edgeId(studentNodeId, "completed", evaluationNodeId),
      source: studentNodeId,
      target: evaluationNodeId,
      type: "completed",
      confidence: linkedStudentId ? "high" : "low",
    })
  }

  // —— Docente ——
  if (teacherId) {
    const teacherRow = teacherRes.data as { id?: string; name?: string | null } | null
    const teacherLabel =
      teacherRow?.name != null && String(teacherRow.name).trim()
        ? String(teacherRow.name).trim()
        : "Docente"
    const teacherNodeId = `teacher:${teacherId}`
    upsertNode(nodeMap, {
      id: teacherNodeId,
      type: "teacher",
      label: teacherLabel,
      confidence: "high",
      metadata: { teacher_id: teacherId },
    })
    upsertEdge(edgeMap, {
      id: edgeId(teacherNodeId, "applied", evaluationNodeId),
      source: teacherNodeId,
      target: evaluationNodeId,
      type: "applied",
      confidence: "high",
    })
  }

  // —— Colegio / escuela ——
  let schoolNodeId: string | null = null
  if (schoolId) {
    const schoolRow = schoolRes.data as { id?: string; name?: string | null } | null
    const schoolLabel =
      schoolRow?.name != null && String(schoolRow.name).trim()
        ? String(schoolRow.name).trim()
        : "Colegio"
    schoolNodeId = `school:${schoolId}`
    upsertNode(nodeMap, {
      id: schoolNodeId,
      type: "school",
      label: schoolLabel,
      confidence: "high",
      metadata: { school_id: schoolId },
    })
  }

  // —— Curso ——
  let courseNodeId: string | null = null
  if (resolvedCourseId) {
    const courseRow = courseRes.data as {
      id?: string
      level?: string | null
      letter?: string | null
      year?: number | null
      school_id?: string | null
    } | null
    const courseLabel =
      formatCourseLabel({
        level: courseRow?.level,
        letter: courseRow?.letter,
        year: courseRow?.year,
        fallback: resolvedCourseLabel,
      }) ?? "Curso"
    courseNodeId = `course:${resolvedCourseId}`
    upsertNode(nodeMap, {
      id: courseNodeId,
      type: "course",
      label: courseLabel,
      confidence: "high",
      metadata: {
        course_id: resolvedCourseId,
        course_label: resolvedCourseLabel,
      },
    })
    const courseSchoolId =
      courseRow?.school_id != null && String(courseRow.school_id).trim() !== ""
        ? String(courseRow.school_id).trim()
        : schoolId
    if (courseSchoolId && !schoolNodeId) {
      const { data: courseSchoolRow } = await supabase
        .from("schools")
        .select("id, name")
        .eq("id", courseSchoolId)
        .maybeSingle()
      const sl =
        (courseSchoolRow as { name?: string | null } | null)?.name != null &&
        String((courseSchoolRow as { name?: string | null }).name).trim()
          ? String((courseSchoolRow as { name?: string | null }).name).trim()
          : "Colegio"
      schoolNodeId = `school:${courseSchoolId}`
      upsertNode(nodeMap, {
        id: schoolNodeId,
        type: "school",
        label: sl,
        confidence: "high",
        metadata: { school_id: courseSchoolId },
      })
    }
    if (schoolNodeId) {
      upsertEdge(edgeMap, {
        id: edgeId(courseNodeId, "belongs_to", schoolNodeId),
        source: courseNodeId,
        target: schoolNodeId,
        type: "belongs_to",
        confidence: "high",
      })
    }
  } else if (resolvedCourseLabel) {
    courseNodeId = `course:label:${normCognitiveKey(resolvedCourseLabel)}`
    upsertNode(nodeMap, {
      id: courseNodeId,
      type: "course",
      label: resolvedCourseLabel,
      confidence: "low",
      metadata: { course_label: resolvedCourseLabel },
    })
    if (schoolNodeId) {
      upsertEdge(edgeMap, {
        id: edgeId(courseNodeId, "belongs_to", schoolNodeId),
        source: courseNodeId,
        target: schoolNodeId,
        type: "belongs_to",
        confidence: schoolId ? "high" : "low",
      })
    }
  }

  if (studentNodeId && courseNodeId) {
    upsertEdge(edgeMap, {
      id: edgeId(studentNodeId, "belongs_to", courseNodeId),
      source: studentNodeId,
      target: courseNodeId,
      type: "belongs_to",
      confidence: resolvedCourseId || studentProfileId ? "high" : "low",
    })
  }

  // —— Perfil de estudiante ——
  if (earlyStudentProfileId) {
    const profileRow = profileRes.data as {
      id?: string
      student_name?: string | null
      course_label?: string | null
      school_id?: string | null
    } | null
    const profileLabel =
      profileRow?.student_name != null && String(profileRow.student_name).trim()
        ? String(profileRow.student_name).trim()
        : student_display_name
    const profileNodeId = `student_profile:${earlyStudentProfileId}`
    upsertNode(nodeMap, {
      id: profileNodeId,
      type: "student_profile",
      label: profileLabel,
      confidence: "high",
      metadata: {
        student_profile_id: earlyStudentProfileId,
        course_label: profileRow?.course_label ?? null,
        school_id: profileRow?.school_id ?? null,
      },
    })
    if (studentNodeId) {
      upsertEdge(edgeMap, {
        id: edgeId(studentNodeId, "belongs_to", profileNodeId),
        source: studentNodeId,
        target: profileNodeId,
        type: "belongs_to",
        confidence: "high",
      })
    }
  }

  // —— Prueba base ——
  if (sourceExamId) {
    const examRow = sourceExamRes.data as { id?: string; title?: string | null; subject?: string | null } | null
    const examLabel =
      examRow?.title != null && String(examRow.title).trim()
        ? String(examRow.title).trim()
        : "Prueba base"
    const sourceExamNodeId = `source_exam:${sourceExamId}`
    upsertNode(nodeMap, {
      id: sourceExamNodeId,
      type: "source_exam",
      label: examLabel,
      confidence: "high",
      metadata: {
        source_exam_id: sourceExamId,
        subject: examRow?.subject ?? null,
      },
    })
    upsertEdge(edgeMap, {
      id: edgeId(evaluationNodeId, "uses", sourceExamNodeId),
      source: evaluationNodeId,
      target: sourceExamNodeId,
      type: "uses",
      confidence: "high",
    })
  }

  // —— Lote ——
  if (batchId) {
    const batchLabel =
      evRow.title != null && String(evRow.title).trim() ? `Lote · ${String(evRow.title).trim()}` : "Lote"
    const batchNodeId = `batch:${batchId}`
    upsertNode(nodeMap, {
      id: batchNodeId,
      type: "batch",
      label: batchLabel,
      confidence: "high",
      metadata: { batch_id: batchId },
    })
    upsertEdge(edgeMap, {
      id: edgeId(evaluationNodeId, "part_of", batchNodeId),
      source: evaluationNodeId,
      target: batchNodeId,
      type: "part_of",
      confidence: "high",
    })
  }

  // —— Resumen de puntaje ——
  const summaryRow = summaryRes.data as {
    grade_chile?: number | null
    strengths?: string | null
    improvements?: string | null
    raw?: unknown
  } | null
  const itemsForScore = items
  let totalObtained = 0
  let totalMax = 0
  for (const it of itemsForScore) {
    const so = Number(it.score_obtained)
    const sm = Number(it.score_max)
    if (Number.isFinite(so)) totalObtained += so
    if (Number.isFinite(sm)) totalMax += sm
  }
  const hasSummaryRow = summaryRow != null
  const hasItemScores = itemsForScore.length > 0 && totalMax > 0
  if (hasSummaryRow || hasItemScores) {
    const gradeChile =
      summaryRow?.grade_chile != null && Number.isFinite(Number(summaryRow.grade_chile))
        ? Number(summaryRow.grade_chile)
        : null
    const scoreSummaryNodeId = `score_summary:${evaluationId}`
    const scoreLabel =
      gradeChile != null ? `Nota ${gradeChile.toFixed(1)}` : totalMax > 0 ? `Puntaje ${totalObtained}/${totalMax}` : "Resumen"
    upsertNode(nodeMap, {
      id: scoreSummaryNodeId,
      type: "score_summary",
      label: scoreLabel,
      confidence: hasSummaryRow ? "high" : "low",
      metadata: {
        grade_chile: gradeChile,
        total_score_obtained: totalObtained,
        total_score_max: totalMax,
        strengths: summaryRow?.strengths ?? null,
        improvements: summaryRow?.improvements ?? null,
        from_evaluation_summaries: hasSummaryRow,
      },
    })
    upsertEdge(edgeMap, {
      id: edgeId(evaluationNodeId, "has_score_summary", scoreSummaryNodeId),
      source: evaluationNodeId,
      target: scoreSummaryNodeId,
      type: "has_score_summary",
      confidence: hasSummaryRow ? "high" : "low",
    })
  }

  // —— Asignatura ——
  if (subjectRaw && String(subjectRaw).trim()) {
    const subjectLabel = String(subjectRaw).trim()
    const subjectNodeId = `subject:${normCognitiveKey(subjectLabel)}`
    upsertNode(nodeMap, {
      id: subjectNodeId,
      type: "subject",
      label: subjectLabel,
      confidence: "high",
      metadata: { subject: subjectLabel },
    })
    upsertEdge(edgeMap, {
      id: edgeId(evaluationNodeId, "belongs_to_subject", subjectNodeId),
      source: evaluationNodeId,
      target: subjectNodeId,
      type: "belongs_to_subject",
      confidence: "high",
    })
  }

  // —— Ítems de evaluación ——
  const sourceByQuestion = new Map<
    number,
    {
      axis_id: string | null
      skill_id: string | null
      axis_label: string | null
      skill_label: string | null
      cognitive_level: string | null
    }
  >()
  for (const s of sourceItemsRes.data ?? []) {
    const q = Number((s as { item_number?: number | null }).item_number)
    if (!Number.isFinite(q) || q <= 0) continue
    sourceByQuestion.set(q, {
      axis_id: (s as { axis_id?: string | null }).axis_id ?? null,
      skill_id: (s as { skill_id?: string | null }).skill_id ?? null,
      axis_label: (s as { axis_label?: string | null }).axis_label ?? null,
      skill_label: (s as { skill_label?: string | null }).skill_label ?? null,
      cognitive_level: (s as { cognitive_level?: string | null }).cognitive_level ?? null,
    })
  }

  const skillIdsNeeded = new Set<string>()
  const axisIdsNeeded = new Set<string>()

  for (const row of skillResultsRes.data ?? []) {
    const sk = (row as { skill_id?: string | null }).skill_id
    const ax = (row as { axis_id?: string | null }).axis_id
    if (sk) skillIdsNeeded.add(sk)
    if (ax) axisIdsNeeded.add(ax)
  }
  for (const src of sourceByQuestion.values()) {
    if (src.skill_id) skillIdsNeeded.add(src.skill_id)
    if (src.axis_id) axisIdsNeeded.add(src.axis_id)
  }

  const [skillsCatalogRes, axesCatalogRes] = await Promise.all([
    skillIdsNeeded.size > 0
      ? supabase.from("pedagogy_skills").select("id, name, axis_id").in("id", [...skillIdsNeeded])
      : Promise.resolve({ data: [] as unknown[], error: null }),
    axisIdsNeeded.size > 0
      ? supabase.from("pedagogy_axes").select("id, name, subject").in("id", [...axisIdsNeeded])
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])

  const skillById = new Map<string, { name: string; axis_id: string | null }>()
  for (const sk of skillsCatalogRes.data ?? []) {
    skillById.set((sk as { id: string }).id, {
      name: String((sk as { name?: string }).name ?? "").trim() || "Habilidad",
      axis_id: (sk as { axis_id?: string | null }).axis_id ?? null,
    })
    const axId = (sk as { axis_id?: string | null }).axis_id
    if (axId) axisIdsNeeded.add(axId)
  }

  if (axisIdsNeeded.size > 0) {
    const missingAxisIds = [...axisIdsNeeded].filter(
      (id) => !(axesCatalogRes.data ?? []).some((a) => (a as { id: string }).id === id)
    )
    if (missingAxisIds.length > 0) {
      const extraAxes = await supabase
        .from("pedagogy_axes")
        .select("id, name, subject")
        .in("id", missingAxisIds)
      if (extraAxes.data?.length) {
        axesCatalogRes.data = [...(axesCatalogRes.data ?? []), ...extraAxes.data]
      }
    }
  }

  const axisById = new Map<string, { name: string; subject: string | null }>()
  for (const ax of axesCatalogRes.data ?? []) {
    axisById.set((ax as { id: string }).id, {
      name: String((ax as { name?: string }).name ?? "").trim() || "Eje",
      subject: (ax as { subject?: string | null }).subject ?? null,
    })
  }

  const ensureSkillAxisNodes = (
    skillId: string,
    axisId: string | null,
    confidence: PedagogicalGraphConfidence,
    extra?: Record<string, unknown>
  ): { skillNodeId: string; axisNodeId: string | null } => {
    const skMeta = skillById.get(skillId)
    if (!skMeta) return { skillNodeId: `skill:${skillId}`, axisNodeId: null }

    const skillNodeId = `skill:${skillId}`
    upsertNode(nodeMap, {
      id: skillNodeId,
      type: "skill",
      label: skMeta.name,
      confidence,
      metadata: { skill_id: skillId, ...extra },
    })

    const resolvedAxisId = axisId ?? skMeta.axis_id
    let axisNodeId: string | null = null
    if (resolvedAxisId && axisById.has(resolvedAxisId)) {
      axisNodeId = `axis:${resolvedAxisId}`
      const axMeta = axisById.get(resolvedAxisId)!
      upsertNode(nodeMap, {
        id: axisNodeId,
        type: "axis",
        label: axMeta.name,
        confidence,
        metadata: { axis_id: resolvedAxisId, subject: axMeta.subject },
      })
      upsertEdge(edgeMap, {
        id: edgeId(skillNodeId, "belongs_to", axisNodeId),
        source: skillNodeId,
        target: axisNodeId,
        type: "belongs_to",
        confidence,
      })
    }
    return { skillNodeId, axisNodeId }
  }

  for (const item of items) {
    const qn = Number(item.question_number)
    if (!Number.isFinite(qn) || qn <= 0) continue

    const itemId = itemNodeId(evaluationId, qn)
    upsertNode(nodeMap, {
      id: itemId,
      type: "item",
      label: `Ítem ${qn}`,
      confidence: "high",
      metadata: {
        question_number: qn,
        score_obtained: item.score_obtained,
        score_max: item.score_max,
        is_correct: item.is_correct,
      },
    })
    upsertEdge(edgeMap, {
      id: edgeId(evaluationNodeId, "contains", itemId),
      source: evaluationNodeId,
      target: itemId,
      type: "contains",
      confidence: "high",
    })

    const src = sourceByQuestion.get(qn)
    if (src?.skill_id && skillById.has(src.skill_id)) {
      const { skillNodeId } = ensureSkillAxisNodes(src.skill_id, src.axis_id, "high", {
        source: "source_exam_items",
      })
      upsertEdge(edgeMap, {
        id: edgeId(itemId, "measures", skillNodeId),
        source: itemId,
        target: skillNodeId,
        type: "measures",
        confidence: "high",
        metadata: { question_number: qn },
      })
    } else {
      if (src?.skill_label && String(src.skill_label).trim()) {
        const skillText = String(src.skill_label).trim()
        const skillTextNodeId = textLabelNodeId("skill_label_text", skillText)
        upsertNode(nodeMap, {
          id: skillTextNodeId,
          type: "skill_label_text",
          label: skillText,
          confidence: "low",
          metadata: { skill_label: skillText, question_number: qn },
        })
        upsertEdge(edgeMap, {
          id: edgeId(itemId, "has_text_skill", skillTextNodeId),
          source: itemId,
          target: skillTextNodeId,
          type: "has_text_skill",
          confidence: "low",
          metadata: { question_number: qn },
        })
      }
      if (src?.axis_label && String(src.axis_label).trim()) {
        const axisText = String(src.axis_label).trim()
        const axisTextNodeId = textLabelNodeId("axis_label_text", axisText)
        upsertNode(nodeMap, {
          id: axisTextNodeId,
          type: "axis_label_text",
          label: axisText,
          confidence: "low",
          metadata: { axis_label: axisText, question_number: qn },
        })
        upsertEdge(edgeMap, {
          id: edgeId(itemId, "has_text_axis", axisTextNodeId),
          source: itemId,
          target: axisTextNodeId,
          type: "has_text_axis",
          confidence: "low",
          metadata: { question_number: qn },
        })
      }
    }

    const cog = src?.cognitive_level
    if (cog && String(cog).trim()) {
      const cogLabel = String(cog).trim()
      const cogNodeId = `cognitive_level:${normCognitiveKey(cogLabel)}`
      upsertNode(nodeMap, {
        id: cogNodeId,
        type: "cognitive_level",
        label: cogLabel,
        confidence: "high",
      })
      upsertEdge(edgeMap, {
        id: edgeId(itemId, "has_cognitive_level", cogNodeId),
        source: itemId,
        target: cogNodeId,
        type: "has_cognitive_level",
        confidence: "high",
      })
    }
  }

  // —— Resultados por habilidad (refuerzo high, no inventa ids) ——
  const skillAccuracy = new Map<string, number[]>()
  for (const row of skillResultsRes.data ?? []) {
    const skillId = (row as { skill_id?: string | null }).skill_id
    if (!skillId || !skillById.has(skillId)) continue

    const axisId = (row as { axis_id?: string | null }).axis_id ?? null
    const accRaw = (row as { accuracy?: number | null }).accuracy
    let accuracy: number | null =
      accRaw != null && Number.isFinite(Number(accRaw)) ? Number(accRaw) : null
    if (accuracy == null) {
      const obtained = Number((row as { score_obtained?: number | null }).score_obtained) || 0
      const max = Number((row as { score_max?: number | null }).score_max) || 0
      if (max > 0) accuracy = obtained / max
    }
    if (accuracy != null) {
      const list = skillAccuracy.get(skillId) ?? []
      list.push(accuracy)
      skillAccuracy.set(skillId, list)
    }

    const { skillNodeId } = ensureSkillAxisNodes(skillId, axisId, "high", {
      source: "evaluation_skill_results",
      accuracy,
    })

    const achievementRaw = (row as { achievement_level?: string | null }).achievement_level
    if (achievementRaw && String(achievementRaw).trim()) {
      const levelLabel = String(achievementRaw).trim()
      const levelNodeId = `achievement_level:${normCognitiveKey(levelLabel)}`
      upsertNode(nodeMap, {
        id: levelNodeId,
        type: "achievement_level",
        label: levelLabel,
        confidence: "high",
        metadata: { achievement_level: levelLabel, skill_id: skillId },
      })
      upsertEdge(edgeMap, {
        id: edgeId(skillNodeId, "has_achievement_level", levelNodeId),
        source: skillNodeId,
        target: levelNodeId,
        type: "has_achievement_level",
        confidence: "high",
      })
    }

    const itemIdsForSkill = [...nodeMap.values()]
      .filter((n) => n.type === "item")
      .map((n) => n.id)
    for (const itemId of itemIdsForSkill) {
      const qn = Number(String((nodeMap.get(itemId)?.metadata as { question_number?: number })?.question_number))
      const src = sourceByQuestion.get(qn)
      if (src?.skill_id === skillId) {
        upsertEdge(edgeMap, {
          id: edgeId(itemId, "measures", skillNodeId),
          source: itemId,
          target: skillNodeId,
          type: "measures",
          confidence: "high",
        })
      }
    }
  }

  const skillNodes = [...nodeMap.values()].filter((n) => n.type === "skill")
  const weak_skills: string[] = []
  const strong_skills: string[] = []

  for (const skNode of skillNodes) {
    const idFromNode = skNode.id.startsWith("skill:") ? skNode.id.slice(6) : ""
    const accs = skillAccuracy.get(idFromNode)
    if (!accs?.length) continue
    const meanAcc = accs.reduce((a, b) => a + b, 0) / accs.length
    if (meanAcc < WEAK_ACCURACY_THRESHOLD) weak_skills.push(skNode.label)
    else if (meanAcc >= STRONG_ACCURACY_THRESHOLD) strong_skills.push(skNode.label)
  }

  const summaryRaw = (summaryRes.data as { raw?: unknown } | null)?.raw ?? null
  const { paths: scanImagePaths, source: scanPathsSource } = await resolveScanImagePathsForGraph(supabase, {
    evaluationId,
    batchId,
    summaryRaw,
  })

  const hwResult = appendHandwritingEvidenceNodes({
    input: {
      evaluationId,
      evaluationNodeId,
      studentNodeId,
      scanImagePaths,
      scanPathsSource,
      items,
      summaryRaw,
    },
    nodeMap,
    edgeMap,
  })

  const histMemoryResult = await appendHandwritingHistoricalMemory({
    supabase,
    input: {
      evaluationId,
      evaluationNodeId,
      studentNodeId,
      studentProfileId: earlyStudentProfileId,
      catalogStudentId: catalogStudentIdEarly,
      teacherId,
      items,
      summaryRaw,
    },
    nodeMap,
    edgeMap,
  })

  const coFailureResult = appendIntraEvaluationCoFailures({
    input: {
      evaluationId,
      evaluationNodeId,
      items,
      sourceByQuestion,
    },
    nodeMap,
    edgeMap,
  })

  const snapshot: PedagogicalGraphSnapshot = {
    evaluation_id: evaluationId,
    student_display_name,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
    summary: {
      skills_count: skillNodes.length,
      items_count: [...nodeMap.values()].filter((n) => n.type === "item").length,
      weak_skills: [...new Set(weak_skills)],
      strong_skills: [...new Set(strong_skills)],
      writing_evidence_count: hwResult.evidenceCount,
      historical_evaluations_included: histMemoryResult.historicalEvaluationsIncluded,
      repeated_pattern_clusters: histMemoryResult.repeatedPatternClusters,
      recurring_ocr_confusion_count: histMemoryResult.recurringOcrConfusionCount,
      co_failure_clusters_count: coFailureResult.coFailureClustersCount,
      inferred_intra_eval_edges_count: coFailureResult.inferredIntraEvalEdgesCount,
    },
  }

  return { ok: true, snapshot }
}
