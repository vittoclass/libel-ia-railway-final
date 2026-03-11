/**
 * Motor estructurado (SIMCE/PAES/facsímiles): clasificación por número o rango de pregunta.
 * Usa catálogo por asignatura y asigna ítems a ejes/habilidades por posición.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SkillRowForInsert, GenerateSkillsFromItemsResult } from "@/app/lib/generate-skills-from-items"

type CatalogAxis = { axis_id: string; axis_name: string; skills: Array<{ skill_id: string; skill_name: string }> }

async function loadCatalog(supabase: SupabaseClient, subject: string): Promise<CatalogAxis[]> {
  const subjectNorm = subject != null && String(subject).trim() !== "" ? String(subject).trim() : "Lenguaje"
  const { data: axesRows, error: axesErr } = await supabase
    .from("pedagogy_axes")
    .select("id, name")
    .eq("subject", subjectNorm)
    .order("name")
  if (axesErr || !axesRows?.length) return []

  const axisIds = axesRows.map((a) => a.id)
  const { data: skillsRows, error: skillsErr } = await supabase
    .from("pedagogy_skills")
    .select("id, axis_id, name")
    .in("axis_id", axisIds)
    .order("name")
  const skillsByAxis = new Map<string, Array<{ skill_id: string; skill_name: string }>>()
  for (const a of axesRows) skillsByAxis.set(a.id, [])
  if (!skillsErr && skillsRows?.length) {
    for (const s of skillsRows) {
      const list = skillsByAxis.get(s.axis_id)
      if (list) list.push({ skill_id: s.id, skill_name: s.name ?? "" })
    }
  }
  return axesRows.map((a) => ({
    axis_id: a.id,
    axis_name: a.name ?? "",
    skills: skillsByAxis.get(a.id) ?? [],
  }))
}

/**
 * Mapeo por número de pregunta (1-based) para modo estructurado.
 * FASE 7A: rangos fijos por especificación.
 *
 * MATEMÁTICA:
 * 1–8 -> Operaciones básicas
 * 9–16 -> Resolución de problemas (fallback: Modelar situaciones / Álgebra)
 * 17–24 -> Reconocimiento de figuras
 * 25–32 -> Interpretar gráficos
 * 33–40 -> Resolver ecuaciones
 * >40 -> ciclo 33–40 (Resolver ecuaciones)
 *
 * LENGUAJE:
 * 1–10 -> Localizar información
 * 11–20 -> Inferir información
 * 21–30 -> Interpretar
 * 31–40 -> Evaluar
 * >40 -> ciclo 31–40 (Evaluar)
 */
function getStructuredMapping(
  questionNumber: number,
  subject: string,
  catalog: CatalogAxis[]
): { axis_id: string; skill_id: string } | null {
  if (!catalog.length) return null
  const n = Math.max(1, Math.floor(Number(questionNumber)))
  const subj = (subject || "").toLowerCase()
  const isMath = subj.includes("matemática") || subj.includes("matematica")

  const skillNameByNumber = (name: string): { axis_id: string; skill_id: string } | null => {
    for (const axis of catalog) {
      const skill = axis.skills.find((s) => (s.skill_name || "").trim() === name)
      if (skill) return { axis_id: axis.axis_id, skill_id: skill.skill_id }
    }
    return null
  }

  if (isMath) {
    const mathSkillNames: Record<string, string> = {
      "1-8": "Operaciones básicas",
      "9-16": "Resolución de problemas",
      "17-24": "Reconocimiento de figuras",
      "25-32": "Interpretar gráficos",
      "33-40": "Resolver ecuaciones",
    }
    let rangeKey: string
    if (n <= 8) rangeKey = "1-8"
    else if (n <= 16) rangeKey = "9-16"
    else if (n <= 24) rangeKey = "17-24"
    else if (n <= 32) rangeKey = "25-32"
    else rangeKey = "33-40"
    const wanted = mathSkillNames[rangeKey]
    const found = skillNameByNumber(wanted)
    if (found) return found
    if (wanted === "Resolución de problemas") {
      const modelar = skillNameByNumber("Modelar situaciones")
      if (modelar) return modelar
      const algebraAxis = catalog.find((a) => a.axis_name.toLowerCase().includes("álgebra") || a.axis_name.toLowerCase().includes("algebra"))
      if (algebraAxis?.skills?.length) return { axis_id: algebraAxis.axis_id, skill_id: algebraAxis.skills[0].skill_id }
    }
    return skillNameByNumber("Operaciones básicas") || (catalog[0]?.skills?.[0] ? { axis_id: catalog[0].axis_id, skill_id: catalog[0].skills[0].skill_id } : null)
  }

  const lenSkillNames = ["Localizar información", "Inferir información", "Interpretar", "Evaluar"]
  let idx: number
  if (n <= 10) idx = 0
  else if (n <= 20) idx = 1
  else if (n <= 30) idx = 2
  else idx = 3
  const wanted = lenSkillNames[idx]
  const found = skillNameByNumber(wanted)
  if (found) return found
  const compAxis = catalog.find((a) => a.axis_name.toLowerCase().includes("comprensión"))
  const axis = compAxis ?? catalog[0]
  const skill = axis?.skills?.[idx % (axis.skills?.length || 1)] ?? axis?.skills?.[0]
  return skill ? { axis_id: axis!.axis_id, skill_id: skill.skill_id } : null
}

/**
 * Genera filas de habilidades por número de pregunta (modo estructurado).
 */
export async function generateSkillsFromStructuredBlueprint(
  supabase: SupabaseClient,
  evaluationId: string,
  subject: string,
  _examType: string | null
): Promise<GenerateSkillsFromItemsResult | null> {
  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select("id, subject")
    .eq("id", evaluationId)
    .maybeSingle()
  if (evErr || !evaluation) return null

  const subj = (evaluation as { subject?: string | null }).subject ?? subject ?? "Lenguaje"
  const catalog = await loadCatalog(supabase, subj)
  if (!catalog.length) return null

  const { data: items } = await supabase
    .from("evaluation_items")
    .select("question_number, score_obtained, score_max, is_correct, student_answer, correct_answer")
    .eq("evaluation_id", evaluationId)
    .order("question_number", { ascending: true })
  const itemsList = (items ?? []) as Array<{
    question_number?: number | null
    score_obtained?: number | null
    score_max?: number | null
    is_correct?: boolean | null
    student_answer?: string | null
    correct_answer?: string | null
  }>
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

  const agg = new Map<string, { obtained: number; max: number }>()
  const key = (a: string, b: string) => `${a}\t${b}`
  const addScore = (axisId: string, skillId: string, obtained: number, max: number) => {
    const k = key(axisId, skillId)
    const cur = agg.get(k) ?? { obtained: 0, max: 0 }
    agg.set(k, { obtained: cur.obtained + obtained, max: cur.max + (max > 0 ? max : 1) })
  }

  itemsList.forEach((item, index) => {
    const itemNum = Number(item.question_number) || index + 1
    const mapping = getStructuredMapping(itemNum, subj, catalog)
    if (!mapping) return

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
    addScore(mapping.axis_id, mapping.skill_id, obtained, max > 0 ? max : 1)
  })

  const skillRows: SkillRowForInsert[] = []
  for (const [k, v] of agg) {
    const [axis_id, skill_id] = k.split("\t")
    skillRows.push({
      axis_id,
      skill_id,
      score_obtained: v.obtained,
      score_max: v.max,
      accuracy: v.max > 0 ? v.obtained / v.max : null,
    })
  }

  return {
    profileIds,
    skillRows,
    subject: subj,
    items_count: itemsList.length,
    sample_item_texts: [],
    sample_computed_rows: skillRows.slice(0, 5),
  }
}
