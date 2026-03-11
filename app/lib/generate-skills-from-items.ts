/**
 * Generador de habilidades directamente desde evaluation_items.
 * Construye texto por ítem con buildItemText(); fallback por asignatura;
 * SIEMPRE produce al menos una fila cuando hay items válidos y catálogo.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { getPedagogyCatalog } from "@/app/lib/pedagogy-catalog"

export interface SkillRowForInsert {
  axis_id: string
  skill_id: string
  score_obtained: number
  score_max: number
  accuracy: number | null
}

export interface GenerateSkillsFromItemsResult {
  profileIds: string[]
  skillRows: SkillRowForInsert[]
  subject: string
  items_count: number
  sample_item_texts: string[]
  sample_computed_rows: SkillRowForInsert[]
}

type ItemRow = {
  question_number?: number | null
  student_answer?: string | null
  correct_answer?: string | null
  is_correct?: boolean | null
  score_obtained?: number | null
  score_max?: number | null
  [key: string]: unknown
}

const ITEM_TEXT_KEYS = [
  "question",
  "question_text",
  "prompt",
  "statement",
  "item_text",
  "feedback",
  "comment",
  "student_answer",
  "correct_answer",
]

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

/**
 * Concatena todo el texto útil del ítem para clasificar.
 */
function buildItemText(item: ItemRow): string {
  const parts = ITEM_TEXT_KEYS.map((k) => item[k]).filter((v) => v != null && String(v).trim() !== "")
  return parts.map(String).join(" ").trim().toLowerCase()
}

function fallbackTextBySubject(subject: string): string {
  const s = (subject || "").toLowerCase()
  if (s.includes("matemática") || s.includes("matematica")) return "operación problema matemático"
  return "comprensión lectora texto"
}

/**
 * Fallback (axis_id, skill_id) por asignatura cuando no hay match.
 * Matemática -> primer eje con "Operaciones básicas" o primer skill del primer eje.
 * Lenguaje -> primer eje con "Localizar información" o primer skill del primer eje.
 */
function getFallbackIds(
  catalog: { axes: Array<{ axis_id: string; axis_name: string; skills: Array<{ skill_id: string; skill_name: string }> }> },
  subject: string
): { axis_id: string; skill_id: string } | null {
  if (!catalog.axes?.length) return null
  const subj = (subject || "").toLowerCase()
  const isMath = subj.includes("matemática") || subj.includes("matematica")
  const fallbackSkillName = isMath ? "Operaciones básicas" : "Localizar información"
  for (const axis of catalog.axes) {
    for (const sk of axis.skills || []) {
      if (sk.skill_name && sk.skill_name.trim() === fallbackSkillName) {
        return { axis_id: axis.axis_id, skill_id: sk.skill_id }
      }
    }
  }
  return catalog.axes[0]?.skills?.[0]
    ? { axis_id: catalog.axes[0].axis_id, skill_id: catalog.axes[0].skills[0].skill_id }
    : null
}

/**
 * Heurísticas robustas por palabras clave.
 * Matemática: suma, resta, ecuación, gráfico, figura, problema, etc.
 * Lenguaje: localizar, inferir, interpretar, evaluar.
 */
function matchSkillNameByKeywords(text: string, subject: string): string {
  const t = (text || "").trim().toLowerCase()
  if (subject === "Lenguaje" || subject.toLowerCase() === "lenguaje") {
    if (/\b(localizar|explícito|información)\b/.test(t)) return "Localizar información"
    if (/\b(inferir|deducir|implicar|concluir)\b/.test(t)) return "Inferir información"
    if (/\b(interpretar|significado|sentido|recurso)\b/.test(t)) return "Interpretar"
    if (/\b(evaluar|opinión|postura|argumento)\b/.test(t)) return "Evaluar"
    return "Localizar información"
  }
  if (subject === "Matemática" || subject.toLowerCase() === "matemática" || subject.toLowerCase() === "matematica") {
    if (/\b(suma|resta|multiplicación|división|cálculo|fracción|decimal|porcentaje|número|números|operación|operaciones)\b/.test(t)) return "Operaciones básicas"
    if (/\b(ecuación|ecuaciones|álgebra|algebra|variable|expresión|función)\b/.test(t)) return "Resolver ecuaciones"
    if (/\b(gráfico|grafico|tabla|dato|datos|probabilidad|estadística)\b/.test(t)) return "Interpretar gráficos"
    if (/\b(figura|geometría|geométri|área|perímetro|volumen|ángulo)\b/.test(t)) return "Reconocimiento de figuras"
    if (/\b(problema|resolver|razonamiento|modelar)\b/.test(t)) return "Resolución de problemas"
    return "Operaciones básicas"
  }
  return "Localizar información"
}

/**
 * Genera filas de habilidades a partir de evaluation_items.
 * Si hay items válidos, SIEMPRE devuelve al menos una fila (fallback por asignatura).
 * Alias para modo "text": generateSkillsFromTextItems = generateSkillsFromEvaluationItems.
 */
export async function generateSkillsFromEvaluationItems(
  supabase: SupabaseClient,
  evaluationId: string
): Promise<GenerateSkillsFromItemsResult | null> {
  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select("id, subject")
    .eq("id", evaluationId)
    .maybeSingle()

  if (evErr || !evaluation) return null

  const subject = (evaluation as { subject?: string | null }).subject ?? "Lenguaje"

  const { data: items } = await supabase
    .from("evaluation_items")
    .select("*")
    .eq("evaluation_id", evaluationId)
    .order("question_number", { ascending: true })

  const itemsList = (items ?? []) as ItemRow[]
  if (itemsList.length === 0) return null

  const { data: esRows } = await supabase
    .from("evaluation_students")
    .select("student_profile_id")
    .eq("evaluation_id", evaluationId)
    .not("student_profile_id", "is", null)

  const profileIds = [
    ...new Set(
      (esRows ?? []).map((r) => (r as { student_profile_id: string }).student_profile_id).filter(Boolean)
    ),
  ] as string[]

  const catalog = await getPedagogyCatalog(subject)
  const fallbackIds = catalog.axes?.length ? getFallbackIds(catalog, subject) : null

  if (!catalog.axes?.length || !fallbackIds) {
    const sample_item_texts = itemsList.slice(0, 5).map((i) => buildItemText(i) || fallbackTextBySubject(subject))
    return {
      profileIds,
      skillRows: [],
      subject,
      items_count: itemsList.length,
      sample_item_texts,
      sample_computed_rows: [],
    }
  }

  const skillNameToIds = new Map<string, { axis_id: string; skill_id: string }>()
  for (const axis of catalog.axes) {
    for (const sk of axis.skills || []) {
      if (sk.skill_name) skillNameToIds.set(sk.skill_name.trim(), { axis_id: axis.axis_id, skill_id: sk.skill_id })
    }
  }

  const agg = new Map<string, { obtained: number; max: number }>()
  const key = (axisId: string, skillId: string) => `${axisId}\t${skillId}`

  function addScore(axisId: string, skillId: string, obtained: number, max: number) {
    const k = key(axisId, skillId)
    const cur = agg.get(k) ?? { obtained: 0, max: 0 }
    agg.set(k, { obtained: cur.obtained + obtained, max: cur.max + (max > 0 ? max : 1) })
  }

  const allTexts: string[] = []
  for (const item of itemsList) {
    let textToClassify = buildItemText(item)
    if (!textToClassify) textToClassify = fallbackTextBySubject(subject)
    allTexts.push(textToClassify)

    const skillName = matchSkillNameByKeywords(textToClassify, subject)
    const ids = skillNameToIds.get(skillName) ?? fallbackIds

    let obtained = 0
    let max = 0
    if (Number(item.score_max) === 1) {
      const isCorrect =
        item.is_correct === true ||
        (item.score_obtained != null && Number(item.score_obtained) >= 1) ||
        (item.student_answer != null &&
          item.correct_answer != null &&
          String(item.student_answer).trim().toUpperCase() === String(item.correct_answer).trim().toUpperCase())
      obtained = isCorrect ? 1 : 0
      max = 1
    } else {
      obtained = Number(item.score_obtained) || 0
      max = Number(item.score_max) || 0
    }

    if (ids) {
      addScore(ids.axis_id, ids.skill_id, obtained, max > 0 ? max : 1)
    }
  }

  if (agg.size === 0 && itemsList.length > 0 && fallbackIds) {
    let totalObtained = 0
    let totalMax = 0
    for (const item of itemsList) {
      if (Number(item.score_max) === 1) {
        const isCorrect =
          item.is_correct === true ||
          (item.score_obtained != null && Number(item.score_obtained) >= 1) ||
          (item.student_answer != null &&
            item.correct_answer != null &&
            String(item.student_answer).trim().toUpperCase() === String(item.correct_answer).trim().toUpperCase())
        totalObtained += isCorrect ? 1 : 0
        totalMax += 1
      } else {
        totalObtained += Number(item.score_obtained) || 0
        totalMax += Number(item.score_max) || 0
      }
    }
    addScore(fallbackIds.axis_id, fallbackIds.skill_id, totalMax > 0 ? totalObtained : 0, totalMax > 0 ? totalMax : 1)
  }

  const skillRows: SkillRowForInsert[] = []
  for (const [k, v] of agg) {
    const [axis_id, skill_id] = k.split("\t")
    const accuracy = v.max > 0 ? v.obtained / v.max : null
    skillRows.push({
      axis_id,
      skill_id,
      score_obtained: v.obtained,
      score_max: v.max,
      accuracy,
    })
  }

  const sample_item_texts = allTexts.slice(0, 5)
  const sample_computed_rows = skillRows.slice(0, 5)
  if (isDev) {
    console.info("[skills] item texts", sample_item_texts)
    console.info("[skills] computed rows", sample_computed_rows)
  }

  return {
    profileIds,
    skillRows,
    subject,
    items_count: itemsList.length,
    sample_item_texts,
    sample_computed_rows,
  }
}

/** Alias para modo pedagógico "text". */
export const generateSkillsFromTextItems = generateSkillsFromEvaluationItems
