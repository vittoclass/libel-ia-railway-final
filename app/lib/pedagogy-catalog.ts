/**
 * Catálogo pedagógico: ejes y habilidades por asignatura.
 * Solo lectura desde pedagogy_axes y pedagogy_skills.
 */
import { getSupabaseServer } from "@/app/lib/supabase-server"

export interface CatalogSkill {
  skill_id: string
  skill_name: string
}

export interface CatalogAxis {
  axis_id: string
  axis_name: string
  skills: CatalogSkill[]
}

export interface PedagogyCatalog {
  axes: CatalogAxis[]
}

/**
 * Carga ejes y habilidades para una asignatura (ej: "Lenguaje", "Matemática").
 * Devuelve { axes: [ { axis_id, axis_name, skills: [ { skill_id, skill_name } ] } ] }.
 */
export async function getPedagogyCatalog(subject: string): Promise<PedagogyCatalog> {
  const supabase = getSupabaseServer()
  if (!supabase) {
    return { axes: [] }
  }

  const subjectNorm = subject != null && String(subject).trim() !== "" ? String(subject).trim() : "Lenguaje"

  const { data: axesRows, error: axesErr } = await supabase
    .from("pedagogy_axes")
    .select("id, name")
    .eq("subject", subjectNorm)
    .order("name")

  if (axesErr || !axesRows?.length) {
    return { axes: [] }
  }

  const axisIds = axesRows.map((a) => a.id)
  const { data: skillsRows, error: skillsErr } = await supabase
    .from("pedagogy_skills")
    .select("id, axis_id, name")
    .in("axis_id", axisIds)
    .order("name")

  const skillsByAxis = new Map<string, CatalogSkill[]>()
  for (const a of axesRows) {
    skillsByAxis.set(a.id, [])
  }
  if (!skillsErr && skillsRows?.length) {
    for (const s of skillsRows) {
      const list = skillsByAxis.get(s.axis_id)
      if (list) list.push({ skill_id: s.id, skill_name: s.name ?? "" })
    }
  }

  const axes: CatalogAxis[] = axesRows.map((a) => ({
    axis_id: a.id,
    axis_name: a.name ?? "",
    skills: skillsByAxis.get(a.id) ?? [],
  }))

  return { axes }
}
