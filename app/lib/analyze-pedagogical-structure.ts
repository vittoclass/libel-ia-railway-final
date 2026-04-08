/**
 * Análisis pedagógico de ítems de prueba base.
 * Genera metadata educativa (habilidad, demanda cognitiva, tipo de pregunta, dificultad)
 * de forma automática y solo lectura. No modifica evaluación, scoring ni importación.
 */
import type { ParsedLine } from "@/app/lib/parse-bulk-items"

/** Metadata pedagógica generada por el analizador. Solo para visualización y diagnóstico. */
export interface PedagogicalMetadata {
  skill: string
  cognitive_level: string
  difficulty: string
  question_format: string
}

/** Ítem con metadata pedagógica (enriquecido). */
export type ItemWithPedagogy<T = ParsedLine> = T & { pedagogical: PedagogicalMetadata }

/** Entrada mínima para el analizador (compatible con ParsedLine y filas de source_exam_items). */
export interface PedagogicalItemInput {
  item_number?: number | null
  item_text?: string | null
  axis_label?: string | null
  skill_label?: string | null
  /** Texto declarado en pauta; si no está vacío, no se usa detectSkill. */
  cognitive_level?: string | null
  question_type?: string | null
  max_score?: number | null
  rubric_text?: string | null
}

// --- Habilidades por eje (heurística por texto de eje y enunciado) ---
const AXIS_SKILLS: Record<string, string[]> = {
  "números y operaciones": ["cálculo", "proporcionalidad", "resolución de problemas", "interpretación numérica"],
  "numeros y operaciones": ["cálculo", "proporcionalidad", "resolución de problemas", "interpretación numérica"],
  "geometría": ["visualización", "medición", "resolución de problemas", "razonamiento espacial"],
  "geometria": ["visualización", "medición", "resolución de problemas", "razonamiento espacial"],
  "álgebra": ["modelación", "ecuaciones", "patrones", "resolución de problemas"],
  "algebra": ["modelación", "ecuaciones", "patrones", "resolución de problemas"],
  "lectura": ["inferencia", "localización de información", "reflexión", "interpretación"],
  "lenguaje": ["inferencia", "localización de información", "reflexión", "interpretación"],
  "escritura": ["producción de textos", "coherencia", "ortografía", "argumentación"],
  "ciencias": ["análisis de fenómenos", "indagación", "explicación", "aplicación"],
  "historia": ["análisis de fuentes", "comprensión temporal", "argumentación histórica"],
}

const SKILL_KEYWORDS: Record<string, RegExp[]> = {
  proporcionalidad: [/\bproporc/i, /\braz[oó]n\s*\/\s*raz[oó]n/i, /\bporcentaje/i, /\bregla\s+de\s+tres/i],
  cálculo: [/\bcalcula?\w*/i, /\bopera\w*/i, /\bsuma\b/i, /\bresta\b/i, /\bmultiplic/i, /\bdivisi[oó]n/i],
  "resolución de problemas": [/\bresuelve\b/i, /\bproblema\b/i, /\bplantea\b/i, /\bdetermina\b/i],
  "interpretación numérica": [/\binterpreta\b/i, /\bgr[aá]fico\b/i, /\btabla\b/i, /\bvalor\s+num[eé]rico/i],
  inferencia: [/\binfiere\b/i, /\bdeduce\b/i, /\bconcluye\b/i, /\bimplica\b/i],
  "localización de información": [/\blocaliza\b/i, /\bbusca\b/i, /\bencuentra\b/i, /\bse[gñ]ala\b/i],
  reflexión: [/\breflexiona\b/i, /\bopina\b/i, /\bvalora\b/i, /\bjustifica\b/i],
  interpretación: [/\binterpreta\b/i, /\bexplica\b/i, /\bcomprende\b/i, /\bsignificado\b/i],
}

// --- Niveles cognitivos (Bloom simplificado) ---
const COGNITIVE_LEVELS = ["recordar", "aplicar", "analizar", "razonar", "modelar"] as const

const COGNITIVE_KEYWORDS: Record<string, RegExp[]> = {
  recordar: [/\bidentifica\b/i, /\bse[gñ]ala\b/i, /\bnombre\b/i, /\bdefine\b/i, /\bcu[áa]l\s+es\b/i, /\blista\b/i],
  aplicar: [/\bcalcula\b/i, /\bresuelve\b/i, /\baplica\b/i, /\busa\b/i, /\butiliza\b/i, /\bcompleta\b/i],
  analizar: [/\banaliza\b/i, /\bcompara\b/i, /\bclasifica\b/i, /\bdistingue\b/i, /\brelaciona\b/i, /\bexplica\s+por\b/i],
  razonar: [/\bjustifica\b/i, /\bdemuestra\b/i, /\bargumenta\b/i, /\bexplica\s+el\b/i, /\bpor\s+qu[eé]\b/i, /\bdeduce\b/i],
  modelar: [/\bmodela\b/i, /\bplantea\b/i, /\brepresenta\b/i, /\bgr[aá]fico\b/i, /\becuaci[oó]n\b/i, /\bf[oó]rmula\b/i],
}

// --- Tipos de pregunta (formato pedagógico): alternativa simple, contextual, desarrollo corto, con rúbrica ---

// --- Dificultad: baja, media, alta ---

function normalizeAxis(axis: string | null | undefined): string {
  if (!axis || typeof axis !== "string") return ""
  return axis.trim().toLowerCase().normalize("NFD").replace(/\u0300/g, "")
}

/**
 * Detecta habilidad pedagógica a partir del eje, skill_label existente y texto del ítem.
 */
export function detectSkill(item: PedagogicalItemInput): string {
  const axis = normalizeAxis(item.axis_label)
  const text = (item.item_text ?? "").trim()
  const existing = (item.skill_label ?? "").trim()
  if (existing.length >= 1) return existing

  for (const [key, skills] of Object.entries(AXIS_SKILLS)) {
    if (axis.includes(key)) {
      for (const skill of skills) {
        const regs = SKILL_KEYWORDS[skill]
        if (regs?.some((r) => r.test(text))) return skill
      }
      return skills[0] ?? "resolución de problemas"
    }
  }

  for (const [skill, regs] of Object.entries(SKILL_KEYWORDS)) {
    if (regs.some((r) => r.test(text))) return skill
  }

  if (axis) return "comprensión"
  return "resolución de problemas"
}

/**
 * Clasifica la demanda cognitiva (recordar, aplicar, analizar, razonar, modelar).
 */
export function detectCognitiveLevel(item: PedagogicalItemInput): string {
  const text = ((item.item_text ?? "") + " " + (item.rubric_text ?? "")).trim()
  for (const level of COGNITIVE_LEVELS) {
    const regs = COGNITIVE_KEYWORDS[level]
    if (regs?.some((r) => r.test(text))) return level
  }
  if (item.question_type === "multiple_choice" || item.question_type === "true_false") return "aplicar"
  if (item.rubric_text && item.rubric_text.length > 80) return "razonar"
  return "aplicar"
}

/**
 * Clasifica el formato de pregunta (alternativa simple, contextual, desarrollo corto, con rúbrica).
 */
export function detectQuestionType(item: PedagogicalItemInput): string {
  const qt = (item.question_type ?? "").toLowerCase()
  const hasRubric = !!(item.rubric_text && item.rubric_text.trim().length > 10)
  const textLen = (item.item_text ?? "").trim().length

  if (qt === "multiple_choice" || qt === "true_false") {
    if (textLen > 200) return "alternativa contextual"
    return "alternativa simple"
  }
  if (qt === "short_answer" || qt === "essay") {
    if (hasRubric) return "desarrollo con rúbrica"
    return "desarrollo corto"
  }
  if (hasRubric) return "desarrollo con rúbrica"
  if (textLen > 150) return "desarrollo corto"
  return "alternativa simple"
}

/**
 * Estima dificultad (baja, media, alta) por longitud, tipo y puntaje.
 */
export function estimateDifficulty(item: PedagogicalItemInput): string {
  const textLen = (item.item_text ?? "").trim().length
  const rubricLen = (item.rubric_text ?? "").trim().length
  const maxScore = item.max_score ?? 0
  const format = detectQuestionType(item)

  let score = 0
  if (textLen > 300) score += 2
  else if (textLen > 120) score += 1
  if (rubricLen > 150) score += 2
  else if (rubricLen > 50) score += 1
  if (maxScore >= 4) score += 2
  else if (maxScore >= 2) score += 1
  if (format === "desarrollo con rúbrica") score += 1
  if (format === "alternativa contextual") score += 1

  if (score >= 5) return "alta"
  if (score >= 2) return "media"
  return "baja"
}

/**
 * Analiza una lista de ítems y devuelve la misma lista con metadata pedagógica en cada uno.
 * No muta los objetos originales.
 */
export function analyzePedagogicalStructure<T extends PedagogicalItemInput>(
  items: T[]
): ItemWithPedagogy<T>[] {
  if (!Array.isArray(items)) return []
  return items.map((item) => {
    const skillUser = String(item.skill_label ?? "").trim()
    const cognitiveUser = String(item.cognitive_level ?? "").trim()
    const pedagogical: PedagogicalMetadata = {
      skill: skillUser.length > 0 ? skillUser : detectSkill(item),
      cognitive_level: cognitiveUser.length > 0 ? cognitiveUser : detectCognitiveLevel(item),
      difficulty: estimateDifficulty(item),
      question_format: detectQuestionType(item),
    }
    return { ...item, pedagogical }
  })
}

/**
 * Enriquece ítems con metadata pedagógica. Seguro: no modifica evaluación ni importación.
 * Úsese solo al previsualizar importación o al listar ítems de una prueba base.
 */
export function enrichItemsWithPedagogy<T extends PedagogicalItemInput>(
  items: T[]
): ItemWithPedagogy<T>[] {
  return analyzePedagogicalStructure(items)
}
