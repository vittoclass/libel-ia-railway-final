/**
 * Resolución de nombre visible para el grafo pedagógico (solo lectura).
 * Orden de prioridad alineado con evaluation_students → perfiles → catálogo → summary → evaluación.
 */
import { resolveStudentDisplayName } from "@/app/lib/student-display-name"

export type GraphStudentNameSource =
  | "evaluation_students.student_name"
  | "student_profiles.student_name"
  | "student_profiles.full_name"
  | "student_profiles.display_name"
  | "student_profiles.name"
  | "students.full_name"
  | "students.display_name"
  | "students.name"
  | "evaluation_summaries.student_name_raw"
  | "evaluation_summaries.raw"
  | "evaluations.student_name"
  | "none"

export type GraphStudentNameConfidence = "high" | "medium" | "low"

const PROFILE_NAME_KEYS = ["student_name", "full_name", "display_name", "name"] as const
const STUDENT_CATALOG_NAME_KEYS = ["full_name", "display_name", "name"] as const

function trimName(v: unknown): string {
  if (v == null) return ""
  return String(v).trim()
}

function pickFromRow(
  row: Record<string, unknown> | null | undefined,
  keys: readonly string[],
  sourcePrefix: "student_profiles" | "students"
): { name: string; source: GraphStudentNameSource } | null {
  if (!row) return null
  for (const key of keys) {
    const n = trimName(row[key])
    if (n) {
      return { name: n, source: `${sourcePrefix}.${key}` as GraphStudentNameSource }
    }
  }
  return null
}

export function confidenceForGraphNameSource(
  source: GraphStudentNameSource
): GraphStudentNameConfidence {
  if (source === "none") return "low"
  if (
    source.startsWith("evaluation_students.") ||
    source.startsWith("student_profiles.") ||
    source.startsWith("students.")
  ) {
    return "high"
  }
  if (source === "evaluation_summaries.student_name_raw" || source === "evaluations.student_name") {
    return "medium"
  }
  return "low"
}

export function resolveGraphStudentDisplayName(input: {
  evaluationStudents: Array<{ student_name?: string | null }>
  studentProfile?: Record<string, unknown> | null
  studentCatalog?: Record<string, unknown> | null
  summary?: { student_name_raw?: string | null; raw?: unknown } | null
  evaluationStudentName?: string | null
}): {
  displayName: string
  nameSource: GraphStudentNameSource
  nameConfidence: GraphStudentNameConfidence
  hasResolvedName: boolean
} {
  for (const row of input.evaluationStudents) {
    const n = resolveStudentDisplayName({
      student_name: row.student_name ?? null,
      student_name_raw: null,
      raw: null,
    }).trim()
    if (n) {
      const source: GraphStudentNameSource = "evaluation_students.student_name"
      return {
        displayName: n,
        nameSource: source,
        nameConfidence: confidenceForGraphNameSource(source),
        hasResolvedName: true,
      }
    }
  }

  const fromProfile = pickFromRow(input.studentProfile, PROFILE_NAME_KEYS, "student_profiles")
  if (fromProfile) {
    return {
      displayName: fromProfile.name,
      nameSource: fromProfile.source,
      nameConfidence: confidenceForGraphNameSource(fromProfile.source),
      hasResolvedName: true,
    }
  }

  const fromCatalog = pickFromRow(input.studentCatalog, STUDENT_CATALOG_NAME_KEYS, "students")
  if (fromCatalog) {
    return {
      displayName: fromCatalog.name,
      nameSource: fromCatalog.source,
      nameConfidence: confidenceForGraphNameSource(fromCatalog.source),
      hasResolvedName: true,
    }
  }

  const rawName = trimName(input.summary?.student_name_raw)
  if (rawName) {
    const source: GraphStudentNameSource = "evaluation_summaries.student_name_raw"
    return {
      displayName: rawName,
      nameSource: source,
      nameConfidence: confidenceForGraphNameSource(source),
      hasResolvedName: true,
    }
  }

  if (input.summary) {
    const fromSummaryRaw = resolveStudentDisplayName({
      student_name: null,
      student_name_raw: null,
      raw: input.summary.raw,
    }).trim()
    if (fromSummaryRaw) {
      const source: GraphStudentNameSource = "evaluation_summaries.raw"
      return {
        displayName: fromSummaryRaw,
        nameSource: source,
        nameConfidence: confidenceForGraphNameSource(source),
        hasResolvedName: true,
      }
    }
  }

  const evalName = trimName(input.evaluationStudentName)
  if (evalName) {
    const source: GraphStudentNameSource = "evaluations.student_name"
    return {
      displayName: evalName,
      nameSource: source,
      nameConfidence: confidenceForGraphNameSource(source),
      hasResolvedName: true,
    }
  }

  return {
    displayName: "",
    nameSource: "none",
    nameConfidence: "low",
    hasResolvedName: false,
  }
}

/** Etiqueta del nodo `student` cuando hay vínculo pero no nombre resuelto. */
export const GRAPH_STUDENT_NODE_LABEL_WITHOUT_NAME = "Estudiante sin nombre"

export const GRAPH_STUDENT_DISPLAY_NAME_FALLBACK = "Sin nombre de estudiante"
