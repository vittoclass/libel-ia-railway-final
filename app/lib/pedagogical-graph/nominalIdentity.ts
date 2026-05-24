/**
 * FASE 3A — Memoria nominal segura (Graph Layer, solo lectura).
 * Observación OCR → sugerencias de coincidencia; nunca auto-confirma ni persiste.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  GRAPH_STUDENT_DISPLAY_NAME_FALLBACK,
  GRAPH_STUDENT_NODE_LABEL_WITHOUT_NAME,
} from "@/app/lib/pedagogical-graph/resolveGraphStudentName"
import type { NominalConfirmationIndex } from "@/app/lib/pedagogical-graph/nominalConfirmationMemory"
import {
  buildObservedToConfirmedIndex,
  computeHistoricalNominalBoost,
  getHistoricalConfirmedEntriesForObserved,
  rankObservedMemoryEntry,
  resolveObservedNominalMemory,
  type HistoricalNominalBoostContext,
  type ObservedNominalMemoryResolution,
} from "@/app/lib/pedagogical-graph/historicalNominalBoost"
import type {
  PedagogicalGraphConfidence,
  PedagogicalGraphEdge,
  PedagogicalGraphNode,
} from "@/app/lib/pedagogical-graph/types"

/** Máximo de candidatos sugeridos por observación nominal. */
export const MAX_NOMINAL_CANDIDATES_PER_OBSERVATION = 3
/** Máximo de perfiles consultados para el roster nominal. */
export const MAX_NOMINAL_ROSTER_PROFILES = 120
/** Máximo de evaluaciones históricas para nombres OCR previos (mismo docente). */
export const MAX_NOMINAL_HISTORICAL_EVALS = 24
/** Score mínimo para incluir un candidato en el snapshot. */
export const MIN_NOMINAL_MATCH_SCORE = 0.52
/** Levenshtein ≥ este umbral añade razón high_levenshtein_similarity. */
export const HIGH_LEVENSHTEIN_THRESHOLD = 0.72
/** Score ≥ este umbral con un solo candidato fuerte → confianza high en metadata. */
export const HIGH_NOMINAL_SCORE_THRESHOLD = 0.86

const NOMINAL_NAME_STOPWORDS = new Set(["de", "del", "la", "las", "los", "y"])

/** Nombres genéricos / placeholders — no generan observación nominal. */
const GENERIC_NOMINAL_EXACT = new Set(
  [
    "sin nombre",
    "sin nombre de estudiante",
    "estudiante",
    "estudiante sin nombre",
    "alumno",
    "alumno sin nombre",
    "sin identificar",
    "desconocido",
    "n/a",
    "na",
    "—",
    "-",
    "...",
  ].map((s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase())
)

const GENERIC_NOMINAL_PREFIX = /^estudiante\s*\d*$/i

export type NormalizedNominalName = {
  raw: string
  normalized: string
  importantTokens: string[]
  tokenBagKey: string
}

export type NominalRosterEntry = {
  displayName: string
  normalized: string
  importantTokens: string[]
  studentProfileId: string | null
  catalogStudentId: string | null
  courseLabel: string | null
  schoolId: string | null
  sameCourse: boolean
  sameSchool: boolean
  historicalMatchCount: number
  historicalConfirmationCount: number
  source: "student_profiles" | "evaluation_students" | "students" | "historical_nominal_memory"
}

export type NominalMatchScoreResult = {
  score: number
  baseNominalScore: number
  levenshteinSimilarity: number
  tokenBagMatch: boolean
  tokenOverlap: number
  reasons: string[]
  historical_nominal_boost_applied?: boolean
  historical_nominal_boost_value?: number
  consistency_score?: number
}

export type RankedNominalCandidate = NominalRosterEntry & NominalMatchScoreResult

export type NominalIdentityBuildInput = {
  evaluationId: string
  evaluationNodeId: string
  studentNodeId: string | null
  teacherId: string | null
  schoolId: string | null
  courseId: string | null
  courseLabel: string | null
  linkedStudentProfileId: string | null
  linkedCatalogStudentId: string | null
  resolvedDisplayName: string
  summaryStudentNameRaw: string | null
  summaryRaw: unknown
}

export type NominalIdentityBuildResult = {
  nominalMatchesCount: number
  nominalHighConfidenceMatches: number
  skippedReason?: string
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

function isOptionalSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  const code = String(err.code ?? "")
  const msg = String(err.message ?? "").toLowerCase()
  if (code === "42703" || code === "PGRST204" || code === "42P01") return true
  if (msg.includes("does not exist") && (msg.includes("column") || msg.includes("relation"))) return true
  return msg.includes("column") && (msg.includes("does not exist") || msg.includes("not found"))
}

function trimName(v: unknown): string {
  if (v == null) return ""
  return String(v).trim()
}

function normCourseLabelKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
}

/** Alineado con smart-grades: minúsculas, sin tildes, puntuación suave → espacio. */
export function normalizeNominalName(raw: string): NormalizedNominalName {
  const trimmed = String(raw ?? "").trim()
  const normalized = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const parts = normalized.split(/\s+/).filter(Boolean)
  const importantTokens = parts.filter((t) => t.length >= 2 && !NOMINAL_NAME_STOPWORDS.has(t))
  return {
    raw: trimmed,
    normalized,
    importantTokens,
    tokenBagKey: nominalTokenBagKey(importantTokens),
  }
}

export function nominalTokenBagKey(tokens: string[]): string {
  return [...tokens].sort().join(" ")
}

export function isGenericNominalName(raw: string): boolean {
  const t = normalizeNominalName(raw).normalized
  if (!t || t.length < 2) return true
  if (GENERIC_NOMINAL_EXACT.has(t)) return true
  if (GENERIC_NOMINAL_PREFIX.test(t)) return true
  if (t === normalizeNominalName(GRAPH_STUDENT_DISPLAY_NAME_FALLBACK).normalized) return true
  if (t === normalizeNominalName(GRAPH_STUDENT_NODE_LABEL_WITHOUT_NAME).normalized) return true
  return false
}

/** Nombre manual docente vigente y distinto del OCR observado (no genérico). */
export function isActiveManualNominalOverride(
  observedRaw: string,
  resolvedDisplayName: string | undefined | null
): boolean {
  const observed = observedRaw.trim()
  const resolved = resolvedDisplayName?.trim() ?? ""
  if (!observed || !resolved || isGenericNominalName(resolved)) return false
  return (
    normalizeNominalName(observed).normalized !== normalizeNominalName(resolved).normalized
  )
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost)
      prev = tmp
    }
  }
  return dp[n]!
}

export function levenshteinSimilarity(a: string, b: string): number {
  const na = normalizeNominalName(a).normalized
  const nb = normalizeNominalName(b).normalized
  if (!na && !nb) return 1
  if (!na || !nb) return 0
  if (na === nb) return 1
  const maxLen = Math.max(na.length, nb.length)
  const dist = levenshteinDistance(na, nb)
  return 1 - dist / maxLen
}

function tokenOverlapCount(a: string[], b: string[]): number {
  const setB = new Set(b)
  let overlap = 0
  for (const t of a) {
    if (setB.has(t)) overlap++
  }
  return overlap
}

/** Puntúa similitud nominal observada ↔ candidato del roster (sin auto-confirmar). */
export function scoreNominalMatch(
  observed: NormalizedNominalName,
  candidate: Pick<
    NominalRosterEntry,
    "displayName" | "sameCourse" | "sameSchool" | "historicalMatchCount" | "historicalConfirmationCount"
  >
): NominalMatchScoreResult {
  const candNorm = normalizeNominalName(candidate.displayName)
  const lev = levenshteinSimilarity(observed.normalized, candNorm.normalized)
  const bagMatch =
    observed.tokenBagKey.length > 0 &&
    observed.tokenBagKey === candNorm.tokenBagKey &&
    observed.importantTokens.length >= 1
  const overlap = tokenOverlapCount(observed.importantTokens, candNorm.importantTokens)

  let score = lev
  if (bagMatch) score = Math.max(score, 0.9)
  if (overlap >= 2) score = Math.max(score, 0.74 + Math.min(overlap - 2, 2) * 0.06)
  else if (overlap === 1 && observed.importantTokens.length === 1 && candNorm.importantTokens.length === 1) {
    score = Math.max(score, 0.68)
  }
  if (candidate.sameCourse) score += 0.07
  if (candidate.sameSchool) score += 0.03
  if (candidate.historicalConfirmationCount > 0) score += 0.04
  score = Math.min(score, 0.99)

  const reasons: string[] = []
  if (candidate.sameCourse) reasons.push("same_course")
  if (lev >= HIGH_LEVENSHTEIN_THRESHOLD) reasons.push("high_levenshtein_similarity")
  if (bagMatch) reasons.push("token_bag_match")
  if (overlap >= 2) reasons.push("token_overlap")
  if (candidate.sameSchool) reasons.push("same_school")
  if (candidate.historicalConfirmationCount > 0) reasons.push("historical_confirmation_candidate")
  else if (candidate.historicalMatchCount > 0) reasons.push("historical_match_candidate")

  return {
    score,
    baseNominalScore: score,
    levenshteinSimilarity: lev,
    tokenBagMatch: bagMatch,
    tokenOverlap: overlap,
    reasons: [...new Set(reasons)],
  }
}

export type RankNominalCandidatesOpts = {
  excludeNormalized?: string
  maxCandidates?: number
  minScore?: number
  confirmationIndex?: NominalConfirmationIndex
  teacherId?: string
  courseLabel?: string | null
  /** Nombre manual actual — prioriza última edición y evita sugerir en contra. */
  resolvedNormalized?: string
}

export type { ObservedNominalMemoryResolution }

/** Ordena y recorta candidatos (máx. 3); excluye coincidencia exacta con el nombre ya resuelto. */
export function rankNominalCandidates(
  observed: NormalizedNominalName,
  roster: NominalRosterEntry[],
  opts?: RankNominalCandidatesOpts
): RankedNominalCandidate[] {
  const maxCandidates = opts?.maxCandidates ?? MAX_NOMINAL_CANDIDATES_PER_OBSERVATION
  const minScore = opts?.minScore ?? MIN_NOMINAL_MATCH_SCORE
  const excludeNorm = opts?.excludeNormalized ?? ""

  const confirmationRows =
    opts?.confirmationIndex?.all?.length
      ? opts.confirmationIndex.all
      : (opts?.confirmationIndex?.recent ?? [])
  const resolvedNorm = opts?.resolvedNormalized?.trim() || ""
  const boostCtx: HistoricalNominalBoostContext | null =
    confirmationRows.length > 0
      ? {
          teacherId: opts?.teacherId ?? "",
          courseLabel: opts?.courseLabel ?? null,
          sameTeacherScope: true,
          confirmations: confirmationRows,
          resolvedNormalized: resolvedNorm || undefined,
        }
      : null

  const observedIndex = boostCtx ? buildObservedToConfirmedIndex(boostCtx.confirmations) : null
  const memoryEntriesForSort =
    boostCtx && observedIndex
      ? getHistoricalConfirmedEntriesForObserved(observed, observedIndex, {
          confirmations: boostCtx.confirmations,
          resolvedNormalized: resolvedNorm || undefined,
        })
      : []
  const lastCorrectionNorm =
    boostCtx && observedIndex
      ? resolveObservedNominalMemory(observed, boostCtx.confirmations, {
          resolvedNormalized: resolvedNorm || undefined,
          sameTeacherScope: true,
        }).last_teacher_correction?.normalized ?? null
      : null

  const pushScoredCandidate = (
    entry: NominalRosterEntry,
    match: NominalMatchScoreResult,
    histMeta: {
      historicalConfirmationCount: number
      boostApplied: boolean
      boostValue: number
      consistencyScore: number
      extraReasons: string[]
    }
  ) => {
    let finalScore = match.score
    const reasons = [...match.reasons, ...histMeta.extraReasons]

    if (boostCtx && observedIndex) {
      const boost = computeHistoricalNominalBoost(observed, entry, boostCtx, observedIndex)
      if (boost.historical_nominal_boost_applied) {
        finalScore =
          match.baseNominalScore +
          boost.historical_nominal_boost_value +
          boost.same_course_bonus +
          boost.teacher_history_bonus
        finalScore = Math.min(finalScore, 0.99)
        histMeta.historicalConfirmationCount = Math.max(
          histMeta.historicalConfirmationCount,
          boost.historical_confirmation_count
        )
        histMeta.boostApplied = true
        histMeta.boostValue = boost.historical_nominal_boost_value
        histMeta.consistencyScore = boost.consistency_score
        reasons.push("historical_longitudinal_boost")
        if (boost.historical_confirmation_count >= 2) {
          reasons.push("teacher_confirmed_match_history")
        }
        if (boost.same_course_weight > 0) reasons.push("historical_same_course")
      }
    }

    if (finalScore < minScore) return
    scored.push({
      ...entry,
      ...match,
      score: finalScore,
      historicalConfirmationCount: histMeta.historicalConfirmationCount,
      historical_nominal_boost_applied: histMeta.boostApplied,
      historical_nominal_boost_value: histMeta.boostValue,
      consistency_score: histMeta.consistencyScore,
      reasons: [...new Set(reasons)],
    })
  }

  const scored: RankedNominalCandidate[] = []
  const rosterNorms = new Set(
    roster.map((e) => normalizeNominalName(e.displayName).normalized).filter(Boolean)
  )

  for (const entry of roster) {
    const entryNorm = normalizeNominalName(entry.displayName).normalized
    if (!entryNorm || entryNorm === observed.normalized) continue
    if (excludeNorm && entryNorm === excludeNorm) continue
    const match = scoreNominalMatch(observed, entry)
    pushScoredCandidate(entry, match, {
      historicalConfirmationCount: entry.historicalConfirmationCount,
      boostApplied: false,
      boostValue: 0,
      consistencyScore: 0,
      extraReasons: [],
    })
  }

  if (boostCtx && observedIndex) {
    const historicalEntries = getHistoricalConfirmedEntriesForObserved(observed, observedIndex, {
      confirmations: boostCtx.confirmations,
      resolvedNormalized: resolvedNorm || undefined,
    })
    for (const hist of historicalEntries) {
      const displayName = hist.confirmedDisplayName?.trim()
      if (!displayName) continue
      const entryNorm = hist.confirmedNormalized || normalizeNominalName(displayName).normalized
      if (!entryNorm || entryNorm === observed.normalized) continue
      if (excludeNorm && entryNorm === excludeNorm) continue
      if (rosterNorms.has(entryNorm)) continue

      const candNorm = normalizeNominalName(displayName)
      const pseudoEntry: NominalRosterEntry = {
        displayName,
        normalized: entryNorm,
        importantTokens: candNorm.importantTokens,
        studentProfileId: hist.studentProfileId,
        catalogStudentId: hist.catalogStudentId,
        courseLabel: opts?.courseLabel ?? null,
        schoolId: null,
        sameCourse: false,
        sameSchool: false,
        historicalMatchCount: 0,
        historicalConfirmationCount: hist.historical_confirmation_count,
        source: "historical_nominal_memory",
      }
      const match = scoreNominalMatch(observed, pseudoEntry)
      pushScoredCandidate(pseudoEntry, match, {
        historicalConfirmationCount: hist.historical_confirmation_count,
        boostApplied: false,
        boostValue: 0,
        consistencyScore: 0,
        extraReasons: ["historical_nominal_memory", "teacher_confirmed_match_history"],
      })
    }
  }

  const memoryRankFor = (c: RankedNominalCandidate): number => {
    if (!memoryEntriesForSort.length) return 0
    const norm = normalizeNominalName(c.displayName).normalized
    const entry = memoryEntriesForSort.find((e) => e.confirmedNormalized === norm)
    if (!entry) return 0
    return rankObservedMemoryEntry(entry, {
      lastCorrectionNorm,
      allForObserved: memoryEntriesForSort,
      resolvedNormalized: resolvedNorm || undefined,
    })
  }

  scored.sort((a, b) => {
    const aNorm = normalizeNominalName(a.displayName).normalized
    const bNorm = normalizeNominalName(b.displayName).normalized
    const aResolved = resolvedNorm && aNorm === resolvedNorm ? 1 : 0
    const bResolved = resolvedNorm && bNorm === resolvedNorm ? 1 : 0
    if (bResolved !== aResolved) return bResolved - aResolved
    const memA = memoryRankFor(a)
    const memB = memoryRankFor(b)
    return (
      b.score - a.score ||
      memB - memA ||
      (b.historical_nominal_boost_value ?? 0) - (a.historical_nominal_boost_value ?? 0) ||
      (b.historicalConfirmationCount ?? 0) - (a.historicalConfirmationCount ?? 0) ||
      b.levenshteinSimilarity - a.levenshteinSimilarity
    )
  })
  return scored.slice(0, maxCandidates)
}

function metadataConfidenceForCandidates(
  ranked: RankedNominalCandidate[]
): PedagogicalGraphConfidence {
  if (ranked.length === 0) return "low"
  const top = ranked[0]!
  const histBoost = top.historical_nominal_boost_applied === true
  const histConf = top.historicalConfirmationCount ?? 0
  if (
    histBoost &&
    histConf >= 3 &&
    (top.consistency_score ?? 0) >= 0.55 &&
    top.score >= MIN_NOMINAL_MATCH_SCORE + 0.12
  ) {
    return "high"
  }
  if (
    ranked.length === 1 &&
    top.score >= HIGH_NOMINAL_SCORE_THRESHOLD &&
    top.sameCourse &&
    (top.reasons.includes("high_levenshtein_similarity") || histBoost)
  ) {
    return "high"
  }
  if (
    top.score >= HIGH_LEVENSHTEIN_THRESHOLD &&
    (top.sameCourse || top.sameSchool || (histBoost && histConf >= 2))
  ) {
    return "medium"
  }
  return "low"
}

function extractObservedNameFromSummary(input: {
  studentNameRaw: string | null
  summaryRaw: unknown
}): { raw: string; source: string } | null {
  const fromCol = trimName(input.studentNameRaw)
  if (fromCol && !isGenericNominalName(fromCol)) {
    return { raw: fromCol, source: "evaluation_summaries.student_name_raw" }
  }
  if (input.summaryRaw && typeof input.summaryRaw === "object" && !Array.isArray(input.summaryRaw)) {
    const o = input.summaryRaw as Record<string, unknown>
    const keys = ["nombreEstudianteDetectado", "nombre_estudiante", "nombreEstudiante", "student_name", "alumno"]
    for (const key of keys) {
      const v = trimName(o[key])
      if (v && !isGenericNominalName(v)) {
        return { raw: v, source: `evaluation_summaries.raw.${key}` }
      }
    }
  }
  return null
}

function courseLabelsMatch(a: string | null, b: string | null): boolean {
  const ka = normCourseLabelKey(a)
  const kb = normCourseLabelKey(b)
  if (!ka || !kb) return false
  return ka === kb
}

export type NominalSuggestionsInput = {
  teacherId: string
  schoolId: string | null
  courseId: string | null
  courseLabel: string | null
  currentEvaluationId?: string
  observedNameRaw: string
  resolvedDisplayName?: string
  linkedProfileId?: string | null
  linkedCatalogId?: string | null
  confirmationIndex?: NominalConfirmationIndex
  /** manual === observed: no bloquear autofill aunque resolvedDisplayName se omita del ranking. */
  manualEmptyForMemory?: boolean
  manualMatchesObserved?: boolean
}

/** Sugerencias nominales para UI/API (sin auto-confirmar). */
export async function buildNominalSuggestionsForTeacher(
  supabase: SupabaseClient,
  input: NominalSuggestionsInput
): Promise<{
  observed: NormalizedNominalName
  ranked: RankedNominalCandidate[]
  memoryResolution: ObservedNominalMemoryResolution | null
  manualOverrideActive?: boolean
  secondaryHistoricalSuggestion?: string | null
  skippedReason?: string
}> {
  const observed = normalizeNominalName(input.observedNameRaw)
  if (!input.teacherId) {
    return { observed, ranked: [], memoryResolution: null, skippedReason: "no_teacher_scope" }
  }
  if (!observed.normalized || isGenericNominalName(observed.raw)) {
    return { observed, ranked: [], memoryResolution: null, skippedReason: "generic_or_empty_observed_name" }
  }
  const resolvedNorm = input.resolvedDisplayName
    ? normalizeNominalName(input.resolvedDisplayName).normalized
    : ""
  const manualEmptyForMemoryEarly =
    resolvedNorm.length > 0 && resolvedNorm === observed.normalized
  if (resolvedNorm && resolvedNorm === observed.normalized && !manualEmptyForMemoryEarly) {
    return { observed, ranked: [], memoryResolution: null, skippedReason: "already_resolved_exact" }
  }
  const manualOverrideActive = isActiveManualNominalOverride(
    observed.raw,
    input.resolvedDisplayName
  )
  const roster = await loadNominalRoster(supabase, {
    teacherId: input.teacherId,
    schoolId: input.schoolId,
    courseId: input.courseId,
    courseLabel: input.courseLabel,
    currentEvaluationId: input.currentEvaluationId ?? "ephemeral",
    linkedProfileId: input.linkedProfileId ?? null,
    linkedCatalogId: input.linkedCatalogId ?? null,
    confirmationIndex: input.confirmationIndex,
  })
  const rankedFull = rankNominalCandidates(observed, roster, {
    excludeNormalized: resolvedNorm || undefined,
    confirmationIndex: input.confirmationIndex,
    teacherId: input.teacherId,
    courseLabel: input.courseLabel,
    resolvedNormalized: resolvedNorm || undefined,
  })
  const manualEmptyForMemory =
    input.manualEmptyForMemory === true ||
    input.manualMatchesObserved === true ||
    (resolvedNorm.length > 0 && resolvedNorm === observed.normalized)
  const memoryResolvedNorm =
    manualEmptyForMemory && !input.resolvedDisplayName?.trim()
      ? undefined
      : resolvedNorm || undefined
  const memoryResolution =
    input.confirmationIndex?.all?.length
      ? resolveObservedNominalMemory(observed, input.confirmationIndex.all, {
          resolvedNormalized: memoryResolvedNorm,
          sameTeacherScope: true,
          currentCourse: {
            courseId: input.courseId,
            courseLabel: input.courseLabel,
          },
          manualEmptyForMemory,
          manualMatchesObserved: input.manualMatchesObserved === true || manualEmptyForMemory,
        })
      : null
  const secondaryHistoricalSuggestion = manualOverrideActive
    ? rankedFull.find(
        (c) => normalizeNominalName(c.displayName).normalized !== resolvedNorm
      )?.displayName ?? null
    : null
  const ranked = manualOverrideActive ? [] : rankedFull
  return {
    observed,
    ranked,
    memoryResolution,
    manualOverrideActive,
    secondaryHistoricalSuggestion,
    skippedReason: manualOverrideActive
      ? "manual_override_active"
      : ranked.length === 0
        ? "no_candidates"
        : undefined,
  }
}

async function loadNominalRoster(
  supabase: SupabaseClient,
  opts: {
    teacherId: string
    schoolId: string | null
    courseId: string | null
    courseLabel: string | null
    currentEvaluationId: string
    linkedProfileId: string | null
    linkedCatalogId: string | null
    confirmationIndex?: NominalConfirmationIndex
  }
): Promise<NominalRosterEntry[]> {
  const byNorm = new Map<string, NominalRosterEntry>()

  const addEntry = (entry: Omit<NominalRosterEntry, "normalized" | "importantTokens" | "sameCourse" | "sameSchool">) => {
    const norm = normalizeNominalName(entry.displayName)
    if (!norm.normalized || isGenericNominalName(entry.displayName)) return
    const sameCourse = courseLabelsMatch(entry.courseLabel, opts.courseLabel)
    const sameSchool =
      opts.schoolId != null &&
      entry.schoolId != null &&
      String(opts.schoolId) === String(entry.schoolId)
    const key =
      entry.studentProfileId != null
        ? `profile:${entry.studentProfileId}`
        : entry.catalogStudentId != null
          ? `catalog:${entry.catalogStudentId}`
          : `name:${norm.normalized}|${normCourseLabelKey(entry.courseLabel)}`
    const existing = byNorm.get(key)
    if (!existing || entry.displayName.length > existing.displayName.length) {
      byNorm.set(key, {
        ...entry,
        normalized: norm.normalized,
        importantTokens: norm.importantTokens,
        sameCourse,
        sameSchool,
        historicalMatchCount: entry.historicalMatchCount,
        historicalConfirmationCount: entry.historicalConfirmationCount,
      })
    }
  }

  let profileQuery = supabase
    .from("student_profiles")
    .select("id, student_name, course_label, school_id, student_id")
    .eq("teacher_id", opts.teacherId)
    .order("student_name", { ascending: true })
    .limit(MAX_NOMINAL_ROSTER_PROFILES)

  if (opts.schoolId) {
    profileQuery = profileQuery.eq("school_id", opts.schoolId)
  }
  if (opts.courseLabel) {
    profileQuery = profileQuery.eq("course_label", opts.courseLabel)
  }

  const { data: profiles, error: profErr } = await profileQuery
  if (!profErr) {
    for (const row of profiles ?? []) {
      const name = trimName((row as { student_name?: string | null }).student_name)
      if (!name) continue
      addEntry({
        displayName: name,
        studentProfileId: String((row as { id: string }).id),
        catalogStudentId:
          (row as { student_id?: string | null }).student_id != null
            ? String((row as { student_id?: string | null }).student_id)
            : null,
        courseLabel: (row as { course_label?: string | null }).course_label ?? null,
        schoolId: (row as { school_id?: string | null }).school_id ?? null,
        historicalMatchCount: 0,
        historicalConfirmationCount: 0,
        source: "student_profiles",
      })
    }
  }

  let evalQuery = supabase
    .from("evaluations")
    .select("id, course_id, course_label, school_id")
    .eq("teacher_id", opts.teacherId)
    .neq("id", opts.currentEvaluationId)
    .order("evaluated_at", { ascending: false })
    .limit(MAX_NOMINAL_HISTORICAL_EVALS)

  if (opts.schoolId) evalQuery = evalQuery.eq("school_id", opts.schoolId)
  if (opts.courseId) evalQuery = evalQuery.eq("course_id", opts.courseId)
  else if (opts.courseLabel) evalQuery = evalQuery.eq("course_label", opts.courseLabel)

  const { data: histEvals } = await evalQuery
  const histEvalIds = (histEvals ?? []).map((r) => String((r as { id: string }).id)).filter(Boolean)

  const profileConfirmCounts = new Map<string, number>()

  if (histEvalIds.length > 0) {
    const [esRes, sumRes] = await Promise.all([
      supabase
        .from("evaluation_students")
        .select("evaluation_id, student_name, student_profile_id, student_id, course_label")
        .in("evaluation_id", histEvalIds),
      supabase
        .from("evaluation_summaries")
        .select("evaluation_id, student_name_raw, raw")
        .in("evaluation_id", histEvalIds),
    ])

    for (const row of esRes.data ?? []) {
      const name = trimName((row as { student_name?: string | null }).student_name)
      const pid = (row as { student_profile_id?: string | null }).student_profile_id
      if (name && pid) {
        const id = String(pid)
        profileConfirmCounts.set(id, (profileConfirmCounts.get(id) ?? 0) + 1)
      }
    }

    for (const row of esRes.data ?? []) {
      const name = trimName((row as { student_name?: string | null }).student_name)
      if (!name) continue
      const pid = (row as { student_profile_id?: string | null }).student_profile_id
      const sid = (row as { student_id?: string | null }).student_id
      const profileId = pid != null ? String(pid) : null
      addEntry({
        displayName: name,
        studentProfileId: profileId,
        catalogStudentId: sid != null ? String(sid) : null,
        courseLabel: (row as { course_label?: string | null }).course_label ?? opts.courseLabel,
        schoolId: opts.schoolId,
        historicalMatchCount: profileId ? (profileConfirmCounts.get(profileId) ?? 0) : 0,
        historicalConfirmationCount:
          profileId && opts.linkedProfileId && profileId === opts.linkedProfileId
            ? 0
            : profileId
              ? (profileConfirmCounts.get(profileId) ?? 0)
              : 0,
        source: "evaluation_students",
      })
    }

    for (const row of sumRes.data ?? []) {
      const extracted = extractObservedNameFromSummary({
        studentNameRaw: (row as { student_name_raw?: string | null }).student_name_raw ?? null,
        summaryRaw: (row as { raw?: unknown }).raw ?? null,
      })
      if (!extracted) continue
      addEntry({
        displayName: extracted.raw,
        studentProfileId: null,
        catalogStudentId: null,
        courseLabel: opts.courseLabel,
        schoolId: opts.schoolId,
        historicalMatchCount: 1,
        historicalConfirmationCount: 0,
        source: "evaluation_students",
      })
    }
  }

  if (opts.linkedCatalogId && opts.schoolId) {
    const { data: catalogRow } = await supabase
      .from("students")
      .select("id, full_name, school_id")
      .eq("id", opts.linkedCatalogId)
      .maybeSingle()
    if (catalogRow) {
      const schoolMatch =
        (catalogRow as { school_id?: string | null }).school_id == null ||
        String((catalogRow as { school_id?: string | null }).school_id) === String(opts.schoolId)
      if (schoolMatch) {
        const name = trimName((catalogRow as { full_name?: string | null }).full_name)
        if (name) {
          addEntry({
            displayName: name,
            studentProfileId: opts.linkedProfileId,
            catalogStudentId: opts.linkedCatalogId,
            courseLabel: opts.courseLabel,
            schoolId: opts.schoolId,
            historicalMatchCount: 0,
            historicalConfirmationCount: 0,
            source: "students",
          })
        }
      }
    }
  }

  const profileConfirmFromTeacher = opts.confirmationIndex?.byProfileId

  for (const entry of byNorm.values()) {
    if (entry.studentProfileId) {
      const c = profileConfirmCounts.get(entry.studentProfileId) ?? 0
      entry.historicalMatchCount = Math.max(entry.historicalMatchCount, c)
      entry.historicalConfirmationCount = Math.max(entry.historicalConfirmationCount, c)
      if (profileConfirmFromTeacher) {
        const tc = profileConfirmFromTeacher.get(entry.studentProfileId) ?? 0
        entry.historicalConfirmationCount = Math.max(entry.historicalConfirmationCount, tc)
      }
    }
  }

  return [...byNorm.values()]
}

function buildMatchMetadata(
  observed: NormalizedNominalName,
  top: RankedNominalCandidate | undefined,
  ranked: RankedNominalCandidate[],
  observationSource: string
): Record<string, unknown> {
  const confidence = metadataConfidenceForCandidates(ranked)
  return {
    requires_teacher_review: true,
    confidence,
    suggested_student_name: top?.displayName ?? null,
    observed_name_raw: observed.raw,
    observed_name_normalized: observed.normalized,
    observation_source: observationSource,
    reason: top?.reasons ?? [],
    match_score: top?.score ?? null,
    levenshtein_similarity: top?.levenshteinSimilarity ?? null,
    candidates_count: ranked.length,
    historical_match_count: top?.historicalMatchCount ?? 0,
    historical_confirmation_count: top?.historicalConfirmationCount ?? 0,
    historical_nominal_boost_applied: top?.historical_nominal_boost_applied ?? false,
    historical_nominal_boost_value: top?.historical_nominal_boost_value ?? 0,
    consistency_score: top?.consistency_score ?? null,
    historical_boost: top
      ? {
          applied: top.historical_nominal_boost_applied ?? false,
          value: top.historical_nominal_boost_value ?? 0,
          historical_confirmation_count: top.historicalConfirmationCount ?? 0,
          consistency_score: top.consistency_score ?? 0,
        }
      : null,
  }
}

/**
 * Añade nodos/aristas de memoria nominal al snapshot (solo lectura).
 */
export async function appendNominalIdentityToGraph(params: {
  supabase: SupabaseClient
  input: NominalIdentityBuildInput
  nodeMap: Map<string, PedagogicalGraphNode>
  edgeMap: Map<string, PedagogicalGraphEdge>
  confirmationIndex?: NominalConfirmationIndex
}): Promise<NominalIdentityBuildResult & { observationNodeId?: string; matchNodeIds?: string[] }> {
  const { supabase, input, nodeMap, edgeMap } = params

  if (!input.teacherId) {
    return { nominalMatchesCount: 0, nominalHighConfidenceMatches: 0, skippedReason: "no_teacher_scope" }
  }

  const observedExtracted = extractObservedNameFromSummary({
    studentNameRaw: input.summaryStudentNameRaw,
    summaryRaw: input.summaryRaw,
  })
  if (!observedExtracted) {
    return { nominalMatchesCount: 0, nominalHighConfidenceMatches: 0, skippedReason: "no_observed_name" }
  }

  const observed = normalizeNominalName(observedExtracted.raw)
  if (isGenericNominalName(observed.raw)) {
    return { nominalMatchesCount: 0, nominalHighConfidenceMatches: 0, skippedReason: "generic_observed_name" }
  }

  const resolvedNorm = normalizeNominalName(input.resolvedDisplayName).normalized
  if (resolvedNorm && resolvedNorm === observed.normalized) {
    return { nominalMatchesCount: 0, nominalHighConfidenceMatches: 0, skippedReason: "already_resolved_exact" }
  }

  const roster = await loadNominalRoster(supabase, {
    teacherId: input.teacherId,
    schoolId: input.schoolId,
    courseId: input.courseId,
    courseLabel: input.courseLabel,
    currentEvaluationId: input.evaluationId,
    linkedProfileId: input.linkedStudentProfileId,
    linkedCatalogId: input.linkedCatalogStudentId,
    confirmationIndex: params.confirmationIndex,
  })

  const ranked = rankNominalCandidates(observed, roster, {
    excludeNormalized: resolvedNorm || undefined,
    confirmationIndex: params.confirmationIndex,
    teacherId: input.teacherId ?? undefined,
    courseLabel: input.courseLabel,
    resolvedNormalized: resolvedNorm || undefined,
  })

  if (ranked.length === 0) {
    return { nominalMatchesCount: 0, nominalHighConfidenceMatches: 0, skippedReason: "no_candidates" }
  }

  const metaConfidence = metadataConfidenceForCandidates(ranked)
  const observationNodeId = `name_observation:${input.evaluationId}`
  const top = ranked[0]

  upsertNode(nodeMap, {
    id: observationNodeId,
    type: "name_observation",
    label: observed.raw,
    confidence: metaConfidence,
    metadata: buildMatchMetadata(observed, top, ranked, observedExtracted.source),
  })

  upsertEdge(edgeMap, {
    id: edgeId(input.evaluationNodeId, "has_name_observation", observationNodeId),
    source: input.evaluationNodeId,
    target: observationNodeId,
    type: "has_name_observation",
    confidence: "medium",
    metadata: { observation_source: observedExtracted.source },
  })

  if (input.studentNodeId) {
    upsertEdge(edgeMap, {
      id: edgeId(observationNodeId, "references", input.studentNodeId),
      source: observationNodeId,
      target: input.studentNodeId,
      type: "references",
      confidence: "low",
      metadata: { role: "current_graph_student_link" },
    })
  }

  let highCount = 0
  let matchIndex = 0
  const matchNodeIds: string[] = []

  for (const cand of ranked) {
    matchIndex += 1
    const candNorm = normalizeNominalName(cand.displayName)
    const candidateNodeId = `name_candidate:${input.evaluationId}:${candNorm.normalized}:${matchIndex}`
    const matchNodeId = `possible_student_match:${input.evaluationId}:${matchIndex}`
    matchNodeIds.push(matchNodeId)
    const histStrong =
      (cand.historical_nominal_boost_applied === true &&
        (cand.historicalConfirmationCount ?? 0) >= 3 &&
        (cand.consistency_score ?? 0) >= 0.55) ||
      false
    const matchMetaConfidence: PedagogicalGraphConfidence =
      (cand.score >= HIGH_NOMINAL_SCORE_THRESHOLD && cand.sameCourse) || histStrong
        ? "high"
        : cand.score >= HIGH_LEVENSHTEIN_THRESHOLD ||
            (cand.historical_nominal_boost_applied && cand.score >= MIN_NOMINAL_MATCH_SCORE + 0.15)
          ? "medium"
          : "low"

    if (matchMetaConfidence === "high") highCount += 1

    upsertNode(nodeMap, {
      id: candidateNodeId,
      type: "name_candidate",
      label: cand.displayName,
      confidence: matchMetaConfidence,
      metadata: {
        requires_teacher_review: true,
        suggested_student_name: cand.displayName,
        student_profile_id: cand.studentProfileId,
        catalog_student_id: cand.catalogStudentId,
        match_score: cand.score,
        base_nominal_score: cand.baseNominalScore,
        levenshtein_similarity: cand.levenshteinSimilarity,
        reason: cand.reasons,
        historical_match_count: cand.historicalMatchCount,
        historical_confirmation_count: cand.historicalConfirmationCount,
        historical_nominal_boost_applied: cand.historical_nominal_boost_applied ?? false,
        historical_nominal_boost_value: cand.historical_nominal_boost_value ?? 0,
        consistency_score: cand.consistency_score ?? null,
        historical_boost: {
          applied: cand.historical_nominal_boost_applied ?? false,
          value: cand.historical_nominal_boost_value ?? 0,
          historical_confirmation_count: cand.historicalConfirmationCount ?? 0,
          consistency_score: cand.consistency_score ?? 0,
        },
        roster_source: cand.source,
      },
    })

    upsertNode(nodeMap, {
      id: matchNodeId,
      type: "possible_student_match",
      label: `Posible: ${cand.displayName}`,
      confidence: matchMetaConfidence,
      metadata: {
        requires_teacher_review: true,
        confidence: matchMetaConfidence,
        suggested_student_name: cand.displayName,
        reason: cand.reasons,
        match_score: cand.score,
        base_nominal_score: cand.baseNominalScore,
        levenshtein_similarity: cand.levenshteinSimilarity,
        historical_match_count: cand.historicalMatchCount,
        historical_confirmation_count: cand.historicalConfirmationCount,
        historical_nominal_boost_applied: cand.historical_nominal_boost_applied ?? false,
        historical_nominal_boost_value: cand.historical_nominal_boost_value ?? 0,
        consistency_score: cand.consistency_score ?? null,
      },
    })

    upsertEdge(edgeMap, {
      id: edgeId(observationNodeId, "has_possible_student_match", matchNodeId),
      source: observationNodeId,
      target: matchNodeId,
      type: "has_possible_student_match",
      confidence: matchMetaConfidence,
    })

    upsertEdge(edgeMap, {
      id: edgeId(matchNodeId, "suggests_name_candidate", candidateNodeId),
      source: matchNodeId,
      target: candidateNodeId,
      type: "suggests_name_candidate",
      confidence: matchMetaConfidence,
      metadata: {
        requires_teacher_review: true,
        suggested_student_name: cand.displayName,
        reason: cand.reasons,
      },
    })

    if (cand.studentProfileId) {
      const profileNodeId = `student_profile:${cand.studentProfileId}`
      if (nodeMap.has(profileNodeId)) {
        upsertEdge(edgeMap, {
          id: edgeId(candidateNodeId, "references", profileNodeId),
          source: candidateNodeId,
          target: profileNodeId,
          type: "references",
          confidence: matchMetaConfidence,
          metadata: { requires_teacher_review: true },
        })
      }
    } else if (cand.catalogStudentId) {
      const catalogNodeId = `student:${cand.catalogStudentId}`
      if (nodeMap.has(catalogNodeId)) {
        upsertEdge(edgeMap, {
          id: edgeId(candidateNodeId, "references", catalogNodeId),
          source: candidateNodeId,
          target: catalogNodeId,
          type: "references",
          confidence: matchMetaConfidence,
          metadata: { requires_teacher_review: true },
        })
      }
    }
  }

  return {
    nominalMatchesCount: ranked.length,
    nominalHighConfidenceMatches: highCount,
    observationNodeId,
    matchNodeIds,
  }
}

/** API de prueba / composición: construye estructura nominal sin mutar maps externos. */
export function buildNominalIdentitySnapshot(params: {
  evaluationId: string
  observedNameRaw: string
  roster: NominalRosterEntry[]
  resolvedDisplayName?: string
  observationSource?: string
}): {
  observation: NormalizedNominalName
  ranked: RankedNominalCandidate[]
  metadata: Record<string, unknown>
} {
  const observed = normalizeNominalName(params.observedNameRaw)
  const excludeNorm = params.resolvedDisplayName
    ? normalizeNominalName(params.resolvedDisplayName).normalized
    : undefined
  const ranked = rankNominalCandidates(observed, params.roster, { excludeNormalized: excludeNorm })
  return {
    observation: observed,
    ranked,
    metadata: buildMatchMetadata(observed, ranked[0], ranked, params.observationSource ?? "manual"),
  }
}
