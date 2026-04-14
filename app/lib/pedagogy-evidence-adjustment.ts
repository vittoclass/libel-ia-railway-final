/**
 * Capa MVP: ajuste pedagógico basado en evidencia (solo lógica pura).
 * No integra UI, APIs, BD, OMR ni evaluación. Reversible: eliminar este archivo y referencias.
 *
 * Alineación de niveles cognitivos con la pasada 2 de smart-extract (Bloom en infinitivo).
 */

export type CanonicalCognitiveLevel =
  | "recordar"
  | "comprender"
  | "aplicar"
  | "analizar"
  | "evaluar"
  | "crear"

export type CoherenceFlag = "aligned" | "weak_signal" | "inconsistent" | "no_evidence"

export type CognitiveLevelSource = "ia" | "ia_soft_adjusted" | "evidence_heuristic"

export type DifficultyEvidenceLabel = "easy" | "medium" | "hard" | "unknown"

export type AdjustmentReasonCode =
  | "NO_EVIDENCE"
  | "INSUFFICIENT_N"
  | "EVIDENCE_PARTIAL"
  | "EVIDENCE_PCORRECT_ONLY"
  | "EVIDENCE_DISCRIMINATION_ONLY"
  | "EVIDENCE_DIFFICULTY_INDEX_ONLY"
  | "CONTRADICTION_HIGH_COGNITIVE_VS_EASY_ITEM"
  | "CONTRADICTION_LOW_COGNITIVE_VS_HARD_ITEM"
  | "COGNITIVE_HEURISTIC_WHEN_IA_MISSING"

/** Entrada: lo que viene de IA (u otra fuente) para un ítem. */
export interface AiPedagogyInput {
  cognitive_level: string | null | undefined
}

/** Evidencia empírica u oficial opcional por ítem (cualquier subconjunto). */
export interface ItemEvidenceInput {
  /** Proporción de aciertos: preferido 0–1; si viene1–100 se normaliza según política. */
  p_correct?: number | null
  /** Discriminación (p. ej. correlación ítem–total, biserial aproximado). Mayor suele indicar mejor discriminación. */
  discrimination?: number | null
  n_responses?: number | null
  /** Índice externo de dificultad si existe; mayor = más difícil (convención por defecto). */
  difficulty_index?: number | null
}

export interface EvidenceAdjustmentPolicy {
  /** Por debajo: se degrada confianza y no se marcan contradicciones fuertes. */
  minNResponses: number
  pCorrectEasyThreshold: number
  pCorrectHardThreshold: number
  /** Umbral en escala típica [-1, 1] para considerar discriminación “alta”. */
  discriminationHigh: number
  /** Contradicción fuerte: IA exige nivel ≥ este ordinal y el ítem se ve “fácil” por p_correct. */
  contradictionHighCognitiveMinOrdinal: number
  /** Contradicción fuerte: IA nivel ≤ este ordinal y el ítem se ve “difícil”. */
  contradictionLowCognitiveMaxOrdinal: number
  /** Facilita ítem “fácil” para flags de contradicción (tras normalizar p_correct). */
  contradictionEasyPcorrectMin: number
  /** Facilita ítem “difícil” para flags de contradicción. */
  contradictionHardPcorrectMax: number
}

export const DEFAULT_EVIDENCE_ADJUSTMENT_POLICY: EvidenceAdjustmentPolicy = {
  minNResponses: 15,
  pCorrectEasyThreshold: 0.7,
  pCorrectHardThreshold: 0.3,
  discriminationHigh: 0.25,
  contradictionHighCognitiveMinOrdinal: 3,
  contradictionLowCognitiveMaxOrdinal: 1,
  contradictionEasyPcorrectMin: 0.72,
  contradictionHardPcorrectMax: 0.28,
}

const COGNITIVE_ORDER: readonly CanonicalCognitiveLevel[] = [
  "recordar",
  "comprender",
  "aplicar",
  "analizar",
  "evaluar",
  "crear",
] as const

const ALIAS_TO_CANONICAL: Record<string, CanonicalCognitiveLevel> = {
  recordar: "recordar",
  memorizar: "recordar",
  reconocer: "recordar",
  comprender: "comprender",
  entender: "comprender",
  aplicar: "aplicar",
  aplicacion: "aplicar",
  analizar: "analizar",
  analisis: "analizar",
  evaluar: "evaluar",
  evaluacion: "evaluar",
  crear: "crear",
  sintetizar: "crear",
  razonar: "analizar",
  modelar: "aplicar",
}

function normalizeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function normalizeCognitiveLevelFromAi(raw: string | null | undefined): CanonicalCognitiveLevel | null {
  if (raw == null) return null
  const t = String(raw).trim()
  if (!t) return null
  const key = normalizeKey(t)
  return ALIAS_TO_CANONICAL[key] ?? null
}

function ordinal(level: CanonicalCognitiveLevel | null): number | null {
  if (level == null) return null
  const i = COGNITIVE_ORDER.indexOf(level)
  return i >= 0 ? i : null
}

function normalizePCorrect(
  p: number | null | undefined,
  policy: EvidenceAdjustmentPolicy,
): { value: number | null; reason: AdjustmentReasonCode | null } {
  if (p == null || !Number.isFinite(p)) return { value: null, reason: null }
  let x = p
  if (x > 1 && x <= 100) x = x / 100
  if (x < 0 || x > 1) return { value: null, reason: null }
  return { value: x, reason: null }
}

function hasAnyEvidenceField(ev: ItemEvidenceInput | null | undefined): boolean {
  if (ev == null || typeof ev !== "object") return false
  return (
    ev.p_correct != null ||
    ev.discrimination != null ||
    ev.n_responses != null ||
    ev.difficulty_index != null
  )
}

function deriveDifficultyFromPCorrect(
  p: number | null,
  policy: EvidenceAdjustmentPolicy,
): DifficultyEvidenceLabel {
  if (p == null) return "unknown"
  if (p >= policy.pCorrectEasyThreshold) return "easy"
  if (p <= policy.pCorrectHardThreshold) return "hard"
  return "medium"
}

function deriveDifficultyFromIndex(
  idx: number | null,
): DifficultyEvidenceLabel {
  if (idx == null || !Number.isFinite(idx)) return "unknown"
  if (idx >= 0.65) return "hard"
  if (idx <= 0.35) return "easy"
  return "medium"
}

function mergeDifficultyLabels(
  a: DifficultyEvidenceLabel,
  b: DifficultyEvidenceLabel,
): DifficultyEvidenceLabel {
  if (a === "unknown") return b
  if (b === "unknown") return a
  if (a === b) return a
  return "medium"
}

export interface PedagogyEvidenceAdjustmentResult {
  cognitive_level_adjusted: CanonicalCognitiveLevel | null
  cognitive_level_source: CognitiveLevelSource
  difficulty_evidence: DifficultyEvidenceLabel
  coherence_flag: CoherenceFlag
  confidence: number
  reason_codes: AdjustmentReasonCode[]
}

/**
 * Ajuste pedagógico basado en evidencia (MVP, solo lectura / puro).
 *
 * @param aiPedagogy Nivel cognitivo (y futuras extensiones) proveniente de IA u otra fuente.
 * @param evidenceBundle Evidencia opcional para el mismo ítem; puede ir parcial o vacía.
 * @param policy Umbrales; por defecto DEFAULT_EVIDENCE_ADJUSTMENT_POLICY.
 */
export function adjustPedagogyWithEvidence(
  aiPedagogy: AiPedagogyInput,
  evidenceBundle: ItemEvidenceInput | null | undefined,
  policy: EvidenceAdjustmentPolicy = DEFAULT_EVIDENCE_ADJUSTMENT_POLICY,
): PedagogyEvidenceAdjustmentResult {
  const iaCanon = normalizeCognitiveLevelFromAi(aiPedagogy.cognitive_level)

  if (!hasAnyEvidenceField(evidenceBundle)) {
    return {
      cognitive_level_adjusted: iaCanon,
      cognitive_level_source: "ia",
      difficulty_evidence: "unknown",
      coherence_flag: "no_evidence",
      confidence: 1,
      reason_codes: ["NO_EVIDENCE"],
    }
  }

  const ev = evidenceBundle as ItemEvidenceInput
  const n = ev.n_responses
  const nOk = n == null || !Number.isFinite(n) || n >= policy.minNResponses
  const insufficientN = n != null && Number.isFinite(n) && n < policy.minNResponses

  const { value: pNorm } = normalizePCorrect(ev.p_correct ?? null, policy)
  const diffFromP = deriveDifficultyFromPCorrect(pNorm, policy)
  const diffFromIdx = deriveDifficultyFromIndex(
    ev.difficulty_index != null && Number.isFinite(ev.difficulty_index)
      ? Number(ev.difficulty_index)
      : null,
  )
  const difficulty_evidence = mergeDifficultyLabels(diffFromP, diffFromIdx)

  const hasP = pNorm != null
  const hasD = ev.discrimination != null && Number.isFinite(ev.discrimination)
  const hasIdx = ev.difficulty_index != null && Number.isFinite(ev.difficulty_index)
  const invalidP = ev.p_correct != null && pNorm == null

  let reason_codes = buildEvidenceReasonCodes({
    insufficientN,
    hasP,
    hasD,
    hasIdx,
    invalidP,
  })

  let cognitive_level_adjusted: CanonicalCognitiveLevel | null = iaCanon
  let cognitive_level_source: CognitiveLevelSource = "ia"
  let coherence_flag: CoherenceFlag = "aligned"
  let confidence = 0.82

  if (iaCanon == null && pNorm != null) {
    if (difficulty_evidence === "easy") cognitive_level_adjusted = "aplicar"
    else if (difficulty_evidence === "hard") cognitive_level_adjusted = "analizar"
    else cognitive_level_adjusted = "aplicar"
    cognitive_level_source = "evidence_heuristic"
    coherence_flag = nOk ? "weak_signal" : "weak_signal"
    confidence = nOk ? 0.48 : 0.35
    reason_codes = dedupeReasons([...reason_codes, "COGNITIVE_HEURISTIC_WHEN_IA_MISSING"])
    return {
      cognitive_level_adjusted,
      cognitive_level_source,
      difficulty_evidence,
      coherence_flag,
      confidence,
      reason_codes,
    }
  }

  const ord = ordinal(iaCanon)
  let inconsistent = false
  const contradictionCodes: AdjustmentReasonCode[] = []

  if (
    nOk &&
    pNorm != null &&
    ord != null &&
    ord >= policy.contradictionHighCognitiveMinOrdinal &&
    pNorm >= policy.contradictionEasyPcorrectMin &&
    difficulty_evidence === "easy"
  ) {
    inconsistent = true
    contradictionCodes.push("CONTRADICTION_HIGH_COGNITIVE_VS_EASY_ITEM")
  }

  if (
    nOk &&
    pNorm != null &&
    ord != null &&
    ord <= policy.contradictionLowCognitiveMaxOrdinal &&
    pNorm <= policy.contradictionHardPcorrectMax &&
    difficulty_evidence === "hard"
  ) {
    inconsistent = true
    contradictionCodes.push("CONTRADICTION_LOW_COGNITIVE_VS_HARD_ITEM")
  }

  reason_codes = dedupeReasons([...reason_codes, ...contradictionCodes])

  if (inconsistent) {
    coherence_flag = "inconsistent"
    confidence = 0.55
    cognitive_level_adjusted = iaCanon
    cognitive_level_source = "ia"
  } else if (!nOk) {
    coherence_flag = "weak_signal"
    confidence = 0.58
    cognitive_level_adjusted = iaCanon
    cognitive_level_source = "ia"
  } else if (pNorm == null && ev.discrimination != null) {
    coherence_flag = "weak_signal"
    confidence = 0.62
    cognitive_level_adjusted = iaCanon
    cognitive_level_source = "ia"
  } else {
    coherence_flag = "aligned"
    confidence = pNorm != null && ev.discrimination != null && ev.discrimination >= policy.discriminationHigh ? 0.88 : 0.8
    cognitive_level_adjusted = iaCanon
    cognitive_level_source = "ia"
  }

  return {
    cognitive_level_adjusted,
    cognitive_level_source,
    difficulty_evidence,
    coherence_flag,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason_codes: dedupeReasons(reason_codes),
  }
}

function dedupeReasons(r: AdjustmentReasonCode[]): AdjustmentReasonCode[] {
  const out: AdjustmentReasonCode[] = []
  const s = new Set<AdjustmentReasonCode>()
  for (const x of r) {
    if (!s.has(x)) {
      s.add(x)
      out.push(x)
    }
  }
  return out
}

function buildEvidenceReasonCodes(args: {
  insufficientN: boolean
  hasP: boolean
  hasD: boolean
  hasIdx: boolean
  invalidP: boolean
}): AdjustmentReasonCode[] {
  const out: AdjustmentReasonCode[] = []
  if (args.insufficientN) out.push("INSUFFICIENT_N")
  if (args.invalidP) out.push("EVIDENCE_PARTIAL")
  const nSignals = (args.hasP ? 1 : 0) + (args.hasD ? 1 : 0) + (args.hasIdx ? 1 : 0)
  if (nSignals >= 2) out.push("EVIDENCE_PARTIAL")
  else if (args.hasP) out.push("EVIDENCE_PCORRECT_ONLY")
  else if (args.hasD) out.push("EVIDENCE_DISCRIMINATION_ONLY")
  else if (args.hasIdx) out.push("EVIDENCE_DIFFICULTY_INDEX_ONLY")
  return dedupeReasons(out)
}

/**
 * Comprobaciones mínimas sin framework de tests. Invocar solo en desarrollo o CI ad-hoc.
 * No efectos secundarios fuera de CPU.
 */
export function runPedagogyEvidenceAdjustmentSanityChecks(): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const p = DEFAULT_EVIDENCE_ADJUSTMENT_POLICY

  const r0 = adjustPedagogyWithEvidence({ cognitive_level: "aplicar" }, null, p)
  if (r0.coherence_flag !== "no_evidence" || r0.cognitive_level_adjusted !== "aplicar") {
    errors.push("sin evidencia debe devolver IA sin cambios")
  }

  const r1 = adjustPedagogyWithEvidence(
    { cognitive_level: "analizar" },
    { p_correct: 0.85, n_responses: 30 },
    p,
  )
  if (r1.coherence_flag !== "inconsistent") {
    errors.push("alto cognitivo + ítem muy fácil debe marcar inconsistent")
  }
  if (r1.cognitive_level_adjusted !== "analizar") {
    errors.push("en inconsistencia no debe sobrescribir agresivamente el nivel IA")
  }

  const r2 = adjustPedagogyWithEvidence(
    { cognitive_level: "recordar" },
    { p_correct: 0.12, n_responses: 40 },
    p,
  )
  if (r2.coherence_flag !== "inconsistent") {
    errors.push("bajo cognitivo + ítem muy difícil debe marcar inconsistent")
  }

  const r3 = adjustPedagogyWithEvidence(
    { cognitive_level: "aplicar" },
    { p_correct: 75, n_responses: 20 },
    p,
  )
  if (r3.difficulty_evidence !== "easy" || r3.cognitive_level_adjusted !== "aplicar") {
    errors.push("p_correct en escala 0–100 debe normalizarse")
  }

  const r4 = adjustPedagogyWithEvidence({ cognitive_level: null }, { p_correct: 0.2, n_responses: 25 }, p)
  if (r4.cognitive_level_source !== "evidence_heuristic" || r4.cognitive_level_adjusted == null) {
    errors.push("sin IA pero con evidencia debe sugerir heurística suave")
  }

  return { ok: errors.length === 0, errors }
}
