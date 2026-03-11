/**
 * Motor heurístico de asignación de habilidades a partir del resultado de evaluación.
 * No modifica scoring ni evaluación. Solo capa pedagógica adicional.
 */
import { getPedagogyCatalog } from "@/app/lib/pedagogy-catalog"

export interface EvaluationResultForSkills {
  alternativas_corregidas?: Array<{
    pregunta?: string
    respuesta_estudiante?: string
    respuesta_correcta?: string
  }>
  detalle_desarrollo?: Record<
    string,
    { puntaje?: string; texto_estudiante?: string; justificacion?: string } | undefined
  >
}

export interface SkillResultRow {
  axis_id: string
  skill_id: string
  score_obtained: number
  score_max: number
  accuracy: number | null
}

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

/**
 * Asigna habilidad por palabras clave en el texto de la pregunta (heurística inicial).
 * Lenguaje: inferir/deducir → Inferir información; interpretar/significado → Interpretar; opinión/postura/evaluar → Evaluar; sino → Localizar información.
 * Matemática: operación → Operaciones básicas; ecuación → Resolver ecuaciones; gráfico → Interpretar gráficos; figura → Reconocimiento de figuras; sino → primera habilidad del primer eje.
 */
function matchSkillNameByKeywords(text: string, subject: string): string {
  const t = (text || "").trim().toLowerCase()
  if (subject === "Lenguaje" || subject.toLowerCase() === "lenguaje") {
    if (/\b(inferir|deducir|implicar)\b/.test(t)) return "Inferir información"
    if (/\b(interpretar|significado)\b/.test(t)) return "Interpretar"
    if (/\b(opinión|postura|evaluar)\b/.test(t)) return "Evaluar"
    return "Localizar información"
  }
  if (subject === "Matemática" || subject.toLowerCase() === "matemática" || subject.toLowerCase() === "matematica") {
    if (/\b(operación|operaciones)\b/.test(t)) return "Operaciones básicas"
    if (/\b(ecuación|ecuaciones)\b/.test(t)) return "Resolver ecuaciones"
    if (/\b(gráfico|grafico)\b/.test(t)) return "Interpretar gráficos"
    if (/\b(figura|geométri)\b/.test(t)) return "Reconocimiento de figuras"
    return "Operaciones básicas"
  }
  return "Localizar información"
}

/**
 * A partir del resultado de evaluación y la asignatura, devuelve resultados agregados por (axis_id, skill_id).
 * accuracy = score_obtained / score_max (null si score_max === 0).
 */
export async function evaluateSkillsFromEvaluation(
  result: EvaluationResultForSkills,
  subject: string
): Promise<SkillResultRow[]> {
  const catalog = await getPedagogyCatalog(subject)
  if (!catalog.axes?.length) {
    if (isDev) console.info("[skill_evaluator] no catalog for subject", subject)
    return []
  }

  const skillNameToIds = new Map<string, { axis_id: string; skill_id: string }>()
  for (const axis of catalog.axes) {
    for (const sk of axis.skills) {
      if (sk.skill_name) skillNameToIds.set(sk.skill_name.trim(), { axis_id: axis.axis_id, skill_id: sk.skill_id })
    }
  }

  const agg = new Map<string, { obtained: number; max: number }>()
  const key = (axisId: string, skillId: string) => `${axisId}\t${skillId}`

  function addScore(axisId: string, skillId: string, obtained: number, max: number) {
    const k = key(axisId, skillId)
    const cur = agg.get(k) ?? { obtained: 0, max: 0 }
    agg.set(k, { obtained: cur.obtained + obtained, max: cur.max + max })
  }

  const altItems = result.alternativas_corregidas ?? []
  for (const a of altItems) {
    const preguntaText = (a.pregunta != null ? String(a.pregunta) : "").trim() || "pregunta"
    const isCorrect =
      String(a.respuesta_estudiante ?? "").trim().toUpperCase() ===
      String(a.respuesta_correcta ?? "").trim().toUpperCase()
    const scoreObtained = isCorrect ? 1 : 0
    const scoreMax = 1
    const skillName = matchSkillNameByKeywords(preguntaText, subject)
    const ids = skillNameToIds.get(skillName)
    if (ids) {
      addScore(ids.axis_id, ids.skill_id, scoreObtained, scoreMax)
    } else if (catalog.axes[0]?.skills[0]) {
      addScore(catalog.axes[0].axis_id, catalog.axes[0].skills[0].skill_id, scoreObtained, scoreMax)
    }
  }

  const desarrollo = result.detalle_desarrollo ?? {}
  for (const [preguntaKey, item] of Object.entries(desarrollo)) {
    if (!item || typeof item !== "object") continue
    let obtained = 0
    let max = 0
    if (typeof item.puntaje === "string" && item.puntaje.includes("/")) {
      const parts = item.puntaje.split("/").map((n) => parseFloat(n) || 0)
      obtained = parts[0] ?? 0
      max = parts[1] ?? 0
    }
    const text = (item.texto_estudiante != null ? String(item.texto_estudiante) : "").trim() || preguntaKey
    const skillName = matchSkillNameByKeywords(text, subject)
    const ids = skillNameToIds.get(skillName)
    if (ids && max > 0) {
      addScore(ids.axis_id, ids.skill_id, obtained, max)
    } else if (catalog.axes[0]?.skills[0] && max > 0) {
      addScore(catalog.axes[0].axis_id, catalog.axes[0].skills[0].skill_id, obtained, max)
    }
  }

  const rows: SkillResultRow[] = []
  for (const [k, v] of agg) {
    const [axis_id, skill_id] = k.split("\t")
    const accuracy = v.max > 0 ? v.obtained / v.max : null
    rows.push({
      axis_id,
      skill_id,
      score_obtained: v.obtained,
      score_max: v.max,
      accuracy,
    })
  }
  return rows
}
