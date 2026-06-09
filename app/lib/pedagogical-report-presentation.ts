/**
 * Presentación de informes pedagógicos (solo UI/texto).
 * No modifica scoring, evaluación, OMR ni agregación del motor.
 */

import { formatPedagogicalReadableText, formatQuestionNumbersSpanish } from "@/app/lib/pedagogical-export-formatting"
import { normalizePedagogicalText } from "@/app/lib/analyze-learning-results"

export const PEDAGOGIC_REPORT_STRONG_PCT = 70

export const COGNITIVE_PERFORMANCE_LABELS = {
  highest: "Mejor desempeño cognitivo observado",
  lowest: "Mayor dificultad cognitiva observada",
} as const

export type PerformanceEvidenceKind = "strength" | "weakness"

export type DimensionMention = {
  key: string
  name: string
  section: "resumen" | "diagnostico" | "recomendaciones"
}

export type EvidencePerformanceRow = {
  name: string
  pct: number
  items: number
  kind: PerformanceEvidenceKind
}

export type SkillAggregatePresentationInput = {
  dimension_value: string
  score_obtained?: number
  score_max?: number
  logro_pct: number | null
  question_count?: number
}

export type QuestionPedagogyLink = {
  item_number: number
  skill: string
  axis?: string
  cognitive_level?: string
  logro_pct?: number | null
}

export type GroupedSkillEvidenceDisplay = {
  canonicalKey: string
  displayName: string
  aliasLabels: string[]
  pct: number
  score_obtained: number
  score_max: number
  question_count: number
  question_numbers: number[]
  evidenceLabel: string
  evidenceSuffix: string
  includesNote: string | null
}

export type HierarchicalGapSkill = {
  displayName: string
  pct: number
  evidenceSuffix: string
  question_numbers: number[]
  cognitiveLevels: string[]
  includesNote: string | null
}

export type HierarchicalGapAxis = {
  axisName: string
  skills: HierarchicalGapSkill[]
  worstPct: number
}

export type HierarchicalGapsDisplay = {
  axes: HierarchicalGapAxis[]
  standaloneCognitiveGaps: Array<{ name: string; pct: number; evidenceSuffix: string }>
}

export type GroupedRecommendationDisplay = {
  groupTitle: string
  skills: Array<{ name: string; questionNumbers: number[] }>
}

export type StudentReportDiagnosis = {
  overview: string
  strengths: GroupedSkillEvidenceDisplay[]
  hierarchicalGaps: HierarchicalGapsDisplay
  groupedRecommendations: GroupedRecommendationDisplay[]
  mentions: DimensionMention[]
  hasContent: boolean
}

/** Alias solo de presentación (no altera motor ni persistencia). */
const SKILL_DISPLAY_ALIASES: Record<string, string> = {
  "IDENTIFICAR EL PROPOSITO COMUNICATIVO DEL TEXTO": "IDENTIFICAR PROPOSITO COMUNICATIVO",
  "IDENTIFICAR EL PROPOSITO COMUNICATIVO DE UN TEXTO": "IDENTIFICAR PROPOSITO COMUNICATIVO",
  "IDENTIFICAR PROPOSITO COMUNICATIVO DE UN TEXTO": "IDENTIFICAR PROPOSITO COMUNICATIVO",
  "IDENTIFICAR PROPOSITO COMUNICATIVO DEL TEXTO": "IDENTIFICAR PROPOSITO COMUNICATIVO",
}

const MAX_HIERARCHICAL_GAP_AXES = 5
const MAX_RECOMMENDATION_GROUPS = 3
const MAX_SKILLS_PER_RECOMMENDATION_GROUP = 4

function normalizeDimensionKey(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
}

function clampDisplayPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function itemCountLabel(count: number): string {
  return count === 1 ? "1 ítem" : `${count} ítems`
}

export function normalizeSkillKeyForDisplay(text: string): string {
  const base = normalizePedagogicalText(text)
  return SKILL_DISPLAY_ALIASES[base] ?? base
}

export function normalizeAxisKeyForDisplay(text: string): string {
  return normalizePedagogicalText(text)
}

function pickDisplayNameFromAliases(aliases: string[]): string {
  const readable = aliases.map((a) => formatPedagogicalReadableText(a))
  const unique = [...new Set(readable.filter(Boolean))]
  if (unique.length === 0) return "—"
  return unique.sort((a, b) => a.length - b.length || a.localeCompare(b, "es"))[0]
}

function pctFromDeliveredTotals(obtained: number, max: number, fallback: number | null): number {
  if (max > 0 && Number.isFinite(obtained) && Number.isFinite(max)) {
    return clampDisplayPct((obtained / max) * 100)
  }
  if (fallback != null && Number.isFinite(fallback)) return clampDisplayPct(fallback)
  return 0
}

export function formatEvidenceCountSuffix(questionCount: number, questionNumbers: number[]): string {
  const nums = [...new Set(questionNumbers.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
  const count = questionCount > 0 ? questionCount : nums.length
  if (count <= 0) return ""
  const numsLabel = nums.length > 0 ? formatQuestionNumbersSpanish(nums) : ""
  if (count === 1) return numsLabel ? `1 evidencia: ítem ${numsLabel}` : "1 evidencia"
  return numsLabel ? `${count} evidencias: ítems ${numsLabel}` : `${count} evidencias`
}

function questionNumbersForSkillKey(byQuestion: QuestionPedagogyLink[] | undefined, skillKey: string): number[] {
  if (!byQuestion?.length) return []
  return byQuestion
    .filter((q) => normalizeSkillKeyForDisplay(q.skill) === skillKey)
    .map((q) => q.item_number)
    .filter((n) => Number.isFinite(n))
}

function resolveAxisForSkillKey(
  byQuestion: QuestionPedagogyLink[] | undefined,
  skillKey: string,
): string | null {
  if (!byQuestion?.length) return null
  const counts = new Map<string, number>()
  for (const q of byQuestion) {
    if (normalizeSkillKeyForDisplay(q.skill) !== skillKey) continue
    const axisKey = normalizeAxisKeyForDisplay(q.axis ?? "")
    if (!axisKey) continue
    counts.set(axisKey, (counts.get(axisKey) ?? 0) + 1)
  }
  let best: { key: string; count: number } | null = null
  for (const [key, count] of counts) {
    if (!best || count > best.count) best = { key, count }
  }
  if (!best) return null
  const sample = byQuestion.find(
    (q) => normalizeSkillKeyForDisplay(q.skill) === skillKey && normalizeAxisKeyForDisplay(q.axis ?? "") === best!.key,
  )
  return sample?.axis ? formatPedagogicalReadableText(sample.axis) : formatPedagogicalReadableText(best.key)
}

function cognitiveLevelsForSkillKey(byQuestion: QuestionPedagogyLink[] | undefined, skillKey: string): string[] {
  if (!byQuestion?.length) return []
  const levels = new Set<string>()
  for (const q of byQuestion) {
    if (normalizeSkillKeyForDisplay(q.skill) !== skillKey) continue
    const level = String(q.cognitive_level ?? "").trim()
    if (level) levels.add(formatPedagogicalReadableText(level))
  }
  return [...levels].sort((a, b) => a.localeCompare(b, "es"))
}

function buildIncludesNote(aliasLabels: string[]): string | null {
  const readable = [...new Set(aliasLabels.map((a) => formatPedagogicalReadableText(a)).filter(Boolean))]
  if (readable.length <= 1) return null
  return `Incluye: ${readable.map((x) => `"${x}"`).join(", ")}`
}

/**
 * F1 — Agrupa evidencias por habilidad canónica de display sin deduplicar en motor.
 */
export function groupEvidenceByCanonicalSkillForDisplay(
  rows: SkillAggregatePresentationInput[],
  byQuestion?: QuestionPedagogyLink[],
  kind: PerformanceEvidenceKind = "weakness",
): GroupedSkillEvidenceDisplay[] {
  const groups = new Map<
    string,
    {
      aliasLabels: string[]
      obtained: number
      max: number
      question_count: number
      fallbackPct: number | null
    }
  >()

  for (const row of rows) {
    const raw = String(row.dimension_value ?? "").trim()
    if (!raw) continue
    const key = normalizeSkillKeyForDisplay(raw)
    const obtained = Number(row.score_obtained) || 0
    const max = Number(row.score_max) || 0
    const qCount = Number(row.question_count) || 0
    const cur = groups.get(key) ?? { aliasLabels: [], obtained: 0, max: 0, question_count: 0, fallbackPct: null }
    if (!cur.aliasLabels.includes(raw)) cur.aliasLabels.push(raw)
    cur.obtained += obtained
    cur.max += max
    cur.question_count += qCount
    if (row.logro_pct != null && Number.isFinite(row.logro_pct)) cur.fallbackPct = row.logro_pct
    groups.set(key, cur)
  }

  const out: GroupedSkillEvidenceDisplay[] = []
  for (const [canonicalKey, g] of groups) {
    const question_numbers = questionNumbersForSkillKey(byQuestion, canonicalKey)
    const question_count = g.question_count > 0 ? g.question_count : question_numbers.length
    const pct = pctFromDeliveredTotals(g.obtained, g.max, g.fallbackPct)
    const displayName = pickDisplayNameFromAliases(g.aliasLabels)
    const evidenceSuffix = formatEvidenceCountSuffix(question_count, question_numbers)
    const items = question_count
    out.push({
      canonicalKey,
      displayName,
      aliasLabels: g.aliasLabels,
      pct,
      score_obtained: g.obtained,
      score_max: g.max,
      question_count,
      question_numbers,
      evidenceSuffix,
      includesNote: buildIncludesNote(g.aliasLabels),
      evidenceLabel: formatPerformanceEvidenceLabel({
        items,
        accuracy: pct,
        kind,
        strongPct: PEDAGOGIC_REPORT_STRONG_PCT,
      }),
    })
  }

  return out.sort((a, b) => a.pct - b.pct)
}

function mapAxisEvidenceRows(
  rows: SkillAggregatePresentationInput[],
  kind: PerformanceEvidenceKind,
  threshold: number,
  compare: (pct: number, threshold: number) => boolean,
): GroupedSkillEvidenceDisplay[] {
  return rows
    .filter((r) => typeof r.logro_pct === "number" && compare(Number(r.logro_pct), threshold))
    .map((r) => {
      const pct = Number(r.logro_pct)
      const items = Number(r.question_count) || 0
      const displayName = formatPedagogicalReadableText(r.dimension_value)
      return {
        canonicalKey: normalizeAxisKeyForDisplay(r.dimension_value),
        displayName,
        aliasLabels: [r.dimension_value],
        pct,
        score_obtained: Number(r.score_obtained) || 0,
        score_max: Number(r.score_max) || 0,
        question_count: items,
        question_numbers: [],
        evidenceSuffix: formatEvidenceCountSuffix(items, []),
        includesNote: null,
        evidenceLabel: formatPerformanceEvidenceLabel({
          items,
          accuracy: pct,
          kind,
          strongPct: PEDAGOGIC_REPORT_STRONG_PCT,
        }),
      }
    })
}

/**
 * F2 — Brechas jerárquicas eje → habilidad → nivel cognitivo (máx. 5 ejes narrativos).
 */
export function buildHierarchicalGapsDisplay(args: {
  by_axis: SkillAggregatePresentationInput[]
  by_skill: SkillAggregatePresentationInput[]
  by_cognitive_level: SkillAggregatePresentationInput[]
  by_question?: QuestionPedagogyLink[]
  weakPct?: number
}): HierarchicalGapsDisplay {
  const weakPct = args.weakPct ?? 50
  const byQuestion = args.by_question ?? []

  const weakSkills = groupEvidenceByCanonicalSkillForDisplay(
    args.by_skill.filter((r) => typeof r.logro_pct === "number" && Number(r.logro_pct) < weakPct),
    byQuestion,
    "weakness",
  )
  const weakAxes = mapAxisEvidenceRows(args.by_axis, "weakness", weakPct, (pct, t) => pct < t)
  const weakCog = mapAxisEvidenceRows(args.by_cognitive_level, "weakness", weakPct, (pct, t) => pct < t)

  const axisMap = new Map<string, HierarchicalGapAxis>()
  const addAxis = (axisName: string) => {
    const key = normalizeAxisKeyForDisplay(axisName)
    if (!axisMap.has(key)) {
      axisMap.set(key, { axisName, skills: [], worstPct: 100 })
    }
    return axisMap.get(key)!
  }

  for (const skill of weakSkills) {
    const axisName = resolveAxisForSkillKey(byQuestion, skill.canonicalKey) ?? "Habilidades priorizadas"
    const axis = addAxis(axisName)
    const cogLevels = cognitiveLevelsForSkillKey(byQuestion, skill.canonicalKey)
    axis.skills.push({
      displayName: skill.displayName,
      pct: skill.pct,
      evidenceSuffix: skill.evidenceSuffix,
      question_numbers: skill.question_numbers,
      cognitiveLevels: cogLevels,
      includesNote: skill.includesNote,
    })
    axis.worstPct = Math.min(axis.worstPct, skill.pct)
  }

  for (const axisRow of weakAxes) {
    const axis = addAxis(axisRow.displayName)
    axis.worstPct = Math.min(axis.worstPct, axisRow.pct)
    if (axis.skills.length === 0) {
      axis.skills.push({
        displayName: `Logro general del eje (${axisRow.pct}%)`,
        pct: axisRow.pct,
        evidenceSuffix: axisRow.evidenceSuffix,
        question_numbers: [],
        cognitiveLevels: [],
        includesNote: null,
      })
    }
  }

  const axes = [...axisMap.values()]
    .filter((a) => a.skills.length > 0)
    .sort((a, b) => a.worstPct - b.worstPct)
    .slice(0, MAX_HIERARCHICAL_GAP_AXES)

  const linkedCogKeys = new Set<string>()
  for (const axis of axes) {
    for (const skill of axis.skills) {
      for (const level of skill.cognitiveLevels) linkedCogKeys.add(normalizeDimensionKey(level))
    }
  }

  const standaloneCognitiveGaps = weakCog
    .filter((c) => !linkedCogKeys.has(normalizeDimensionKey(c.displayName)))
    .map((c) => ({
      name: c.displayName,
      pct: c.pct,
      evidenceSuffix: c.evidenceSuffix || itemCountLabel(c.question_count),
    }))

  return { axes, standaloneCognitiveGaps }
}

/**
 * F3 — Recomendaciones agrupadas por eje (máx. 3 grupos, 4 habilidades c/u).
 */
export function buildGroupedRecommendationsDisplay(args: {
  by_axis: SkillAggregatePresentationInput[]
  by_skill: SkillAggregatePresentationInput[]
  by_question?: QuestionPedagogyLink[]
  weakPct?: number
}): GroupedRecommendationDisplay[] {
  const weakPct = args.weakPct ?? 50
  const byQuestion = args.by_question ?? []

  const weakSkills = groupEvidenceByCanonicalSkillForDisplay(
    args.by_skill.filter((r) => typeof r.logro_pct === "number" && Number(r.logro_pct) < weakPct),
    byQuestion,
    "weakness",
  ).sort((a, b) => a.pct - b.pct)

  const groupMap = new Map<string, { title: string; worstPct: number; skills: Array<{ name: string; questionNumbers: number[] }> }>()

  for (const skill of weakSkills) {
    const axisName = resolveAxisForSkillKey(byQuestion, skill.canonicalKey)
    const title = axisName
      ? `Diseñar refuerzo focalizado en ${axisName}:`
      : "Habilidades priorizadas:"
    const key = axisName ? normalizeAxisKeyForDisplay(axisName) : "__skills__"
    const cur = groupMap.get(key) ?? { title, worstPct: skill.pct, skills: [] }
    cur.worstPct = Math.min(cur.worstPct, skill.pct)
    if (cur.skills.length < MAX_SKILLS_PER_RECOMMENDATION_GROUP) {
      cur.skills.push({
        name: skill.displayName,
        questionNumbers: skill.question_numbers,
      })
    }
    groupMap.set(key, cur)
  }

  if (groupMap.size === 0) {
    const weakAxes = args.by_axis
      .filter((r) => typeof r.logro_pct === "number" && Number(r.logro_pct) < weakPct)
      .sort((a, b) => Number(a.logro_pct) - Number(b.logro_pct))
      .slice(0, MAX_RECOMMENDATION_GROUPS)
    return weakAxes.map((a) => ({
      groupTitle: `Diseñar refuerzo focalizado en ${formatPedagogicalReadableText(a.dimension_value)}:`,
      skills: [
        {
          name: `Eje con logro ${clampDisplayPct(Number(a.logro_pct))}%`,
          questionNumbers: [],
        },
      ],
    }))
  }

  return [...groupMap.values()]
    .sort((a, b) => a.worstPct - b.worstPct)
    .slice(0, MAX_RECOMMENDATION_GROUPS)
    .map((g) => ({
      groupTitle: g.title,
      skills: g.skills,
    }))
}

export function buildStudentReportDiagnosis(args: {
  by_axis: SkillAggregatePresentationInput[]
  by_skill: SkillAggregatePresentationInput[]
  by_cognitive_level: SkillAggregatePresentationInput[]
  by_question?: QuestionPedagogyLink[]
  strongPct?: number
  weakPct?: number
}): StudentReportDiagnosis {
  const strongPct = args.strongPct ?? PEDAGOGIC_REPORT_STRONG_PCT
  const weakPct = args.weakPct ?? 50
  const byQuestion = args.by_question ?? []

  const strengthsSkill = groupEvidenceByCanonicalSkillForDisplay(
    args.by_skill.filter((r) => typeof r.logro_pct === "number" && Number(r.logro_pct) >= strongPct),
    byQuestion,
    "strength",
  )
  const strengthsAxis = mapAxisEvidenceRows(args.by_axis, "strength", strongPct, (pct, t) => pct >= t)
  const strengths = [...strengthsAxis, ...strengthsSkill].sort((a, b) => b.pct - a.pct)

  const hierarchicalGaps = buildHierarchicalGapsDisplay({
    by_axis: args.by_axis,
    by_skill: args.by_skill,
    by_cognitive_level: args.by_cognitive_level,
    by_question: byQuestion,
    weakPct,
  })

  const groupedRecommendations = buildGroupedRecommendationsDisplay({
    by_axis: args.by_axis,
    by_skill: args.by_skill,
    by_question: byQuestion,
    weakPct,
  })

  const gapSkillCount = hierarchicalGaps.axes.reduce((n, a) => n + a.skills.length, 0)
  const mentions: DimensionMention[] = [
    ...strengths.map((x) => ({ key: x.displayName, name: x.displayName, section: "diagnostico" as const })),
    ...hierarchicalGaps.axes.flatMap((a) =>
      a.skills.map((s) => ({ key: s.displayName, name: s.displayName, section: "diagnostico" as const })),
    ),
    ...groupedRecommendations.flatMap((g) =>
      g.skills.map((s) => ({ key: s.name, name: s.name, section: "recomendaciones" as const })),
    ),
  ]

  auditReportMentionsInDev(mentions, "student-report")

  return {
    overview: buildStudentReportOverview({
      strengthCount: strengths.length,
      weaknessCount: gapSkillCount + hierarchicalGaps.standaloneCognitiveGaps.length,
      axisCount: args.by_axis.length,
      skillCount: groupEvidenceByCanonicalSkillForDisplay(args.by_skill, byQuestion).length,
    }),
    strengths,
    hierarchicalGaps,
    groupedRecommendations,
    mentions,
    hasContent:
      strengths.length > 0 ||
      hierarchicalGaps.axes.length > 0 ||
      hierarchicalGaps.standaloneCognitiveGaps.length > 0 ||
      groupedRecommendations.length > 0,
  }
}

/**
 * Etiqueta de desempeño según cantidad de ítems y umbral de logro (solo presentación).
 */
export function formatPerformanceEvidenceLabel(args: {
  items: number
  accuracy: number
  kind: PerformanceEvidenceKind
  strongPct?: number
}): string {
  const items = Math.max(0, Math.round(Number(args.items) || 0))
  const accuracy = Number(args.accuracy)
  const strongPct = args.strongPct ?? PEDAGOGIC_REPORT_STRONG_PCT
  const itemLabel = itemCountLabel(items)

  if (args.kind === "strength") {
    if (items <= 1) return `Buen desempeño observado (Evidencia limitada: ${itemLabel})`
    if (items <= 3) return `Fortaleza emergente (${Math.round(accuracy)}% · ${itemLabel})`
    if (items >= 4 && accuracy >= strongPct) return `Fortaleza consolidada (${Math.round(accuracy)}% · ${itemLabel})`
    return `Buen desempeño observado (${Math.round(accuracy)}% · ${itemLabel})`
  }

  if (items <= 1) return `Dificultad observada (Evidencia limitada: ${itemLabel})`
  if (items <= 3) return `Dificultad emergente (${Math.round(accuracy)}% · ${itemLabel})`
  if (items >= 4) return `Dificultad consolidada (${Math.round(accuracy)}% · ${itemLabel})`
  return `Dificultad observada (${Math.round(accuracy)}% · ${itemLabel})`
}

/**
 * Comparación con el curso: solo si hay z_score o percentil válidos.
 */
export function formatRelativeCoursePositionText(
  zScore: number | null | undefined,
  percentile?: number | null | undefined,
): string | null {
  if (percentile != null && Number.isFinite(percentile)) {
    if (percentile >= 75) return "La posición relativa del estudiante se ubica por encima del promedio del curso."
    if (percentile <= 25) return "La posición relativa del estudiante se ubica por debajo del promedio del curso."
    return "La posición relativa del estudiante se mantiene en un rango cercano al promedio del curso."
  }
  if (zScore == null || !Number.isFinite(zScore)) return null
  if (zScore <= -0.8) return "La posición relativa del estudiante se ubica por debajo del promedio del curso."
  if (zScore >= 0.8) {
    return "La posición relativa del estudiante se ubica por encima del promedio del curso, aunque persiste una brecha específica."
  }
  return "La posición relativa del estudiante se mantiene en un rango cercano al promedio del curso."
}

export function detectCrossSectionDuplicates(mentions: DimensionMention[]): DimensionMention[] {
  const seen = new Map<string, DimensionMention>()
  const duplicates: DimensionMention[] = []
  for (const m of mentions) {
    const key = normalizeDimensionKey(m.key || m.name)
    if (!key) continue
    const prev = seen.get(key)
    if (prev && prev.section !== m.section) duplicates.push(m)
    else if (!prev) seen.set(key, m)
  }
  return duplicates
}

/** @deprecated Usar buildGroupedRecommendationsDisplay para F3. */
export function buildActionRecommendation(args: {
  name: string
  pct: number
  relatedQuestionNumbers?: number[]
}): string {
  const nums = (args.relatedQuestionNumbers ?? []).filter((n) => Number.isFinite(n))
  const qPart =
    nums.length > 0 ? `, priorizando ítems ${formatQuestionNumbersSpanish(nums)}` : ""
  return `Diseñar refuerzo focalizado en ${args.name}${qPart} (logro actual ${Math.round(args.pct)}%).`
}

export function buildStudentReportOverview(args: {
  strengthCount: number
  weaknessCount: number
  axisCount: number
  skillCount: number
}): string {
  const parts: string[] = []
  if (args.axisCount > 0) parts.push(`${args.axisCount} eje${args.axisCount !== 1 ? "s" : ""}`)
  if (args.skillCount > 0) parts.push(`${args.skillCount} habilidad${args.skillCount !== 1 ? "es" : ""}`)
  const scope = parts.length > 0 ? `Se evaluaron ${parts.join(" y ")} en este instrumento. ` : ""
  return `${scope}Se identifican ${args.strengthCount} señal${args.strengthCount !== 1 ? "es" : ""} de fortaleza y ${args.weaknessCount} área${args.weaknessCount !== 1 ? "s" : ""} de mejora. Los detalles y la evidencia por dimensión se desarrollan en el diagnóstico.`
}

export function auditReportMentionsInDev(mentions: DimensionMention[], context: string): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return
  const duplicates = detectCrossSectionDuplicates(mentions)
  if (duplicates.length > 0) {
    console.warn(`[pedagogical-report] menciones duplicadas (${context})`, duplicates)
  }
}
