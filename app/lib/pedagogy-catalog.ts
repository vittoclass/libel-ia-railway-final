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

/** Quitar marcas diacríticas y unificar mayúsculas para emparejar con filas en BD. */
function normalizeSubjectKeyForCatalog(raw: string): string {
  return String(raw ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
}

/**
 * Claves ya normalizadas que deben mapear al mismo catálogo que la fila en BD
 * (p. ej. Lengua ↔ Lenguaje; Matemáticas ↔ Matemática).
 */
const SUBJECT_KEY_EQUIVALENCE_GROUPS: string[][] = [
  [
    "lenguaje",
    "lengua",
    "lenguaje y comunicacion",
    "lenguaje y literatura",
    "lengua y literatura",
    "comunicacion integral",
  ],
  ["matematica", "matematicas"],
  ["ciencias", "ciencias naturales", "ciencias para la ciudadania"],
  ["historia", "historia y geografia", "historia geografia y ciencias sociales"],
]

function equivalenceGroupIndex(key: string): number | null {
  for (let i = 0; i < SUBJECT_KEY_EQUIVALENCE_GROUPS.length; i++) {
    if (SUBJECT_KEY_EQUIVALENCE_GROUPS[i].includes(key)) return i
  }
  return null
}

/**
 * Devuelve el string `subject` exactamente como está en `pedagogy_axes` para filtrar ítems,
 * o null si no hay fila compatible.
 */
function resolveStoredSubjectForCatalog(storedSubjects: string[], input: string): string | null {
  const trimmed = String(input ?? "").trim()
  if (!trimmed) return null
  const inputKey = normalizeSubjectKeyForCatalog(trimmed)

  for (const s of storedSubjects) {
    if (normalizeSubjectKeyForCatalog(s) === inputKey) return s
  }

  const gIn = equivalenceGroupIndex(inputKey)
  if (gIn == null) return null

  for (const s of storedSubjects) {
    const sk = normalizeSubjectKeyForCatalog(s)
    if (equivalenceGroupIndex(sk) === gIn) return s
  }
  return null
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

  const subjectInput =
    subject != null && String(subject).trim() !== "" ? String(subject).trim() : "Lenguaje"

  const { data: allAxesRows, error: axesFetchErr } = await supabase
    .from("pedagogy_axes")
    .select("id, name, subject")
    .order("name")

  if (axesFetchErr || !allAxesRows?.length) {
    return { axes: [] }
  }

  const distinctSubjects = [
    ...new Set(allAxesRows.map((r) => String((r as { subject?: string }).subject ?? "").trim()).filter(Boolean)),
  ]

  const resolvedSubject = resolveStoredSubjectForCatalog(distinctSubjects, subjectInput)
  if (!resolvedSubject) {
    return { axes: [] }
  }

  const axesRows = allAxesRows.filter(
    (r) => String((r as { subject?: string }).subject ?? "").trim() === resolvedSubject,
  )

  const axisIds = axesRows.map((a) => (a as { id: string }).id)
  const { data: skillsRows, error: skillsErr } = await supabase
    .from("pedagogy_skills")
    .select("id, axis_id, name")
    .in("axis_id", axisIds)
    .order("name")

  const skillsByAxis = new Map<string, CatalogSkill[]>()
  for (const a of axesRows) {
    skillsByAxis.set((a as { id: string }).id, [])
  }
  if (!skillsErr && skillsRows?.length) {
    for (const s of skillsRows) {
      const list = skillsByAxis.get((s as { axis_id: string }).axis_id)
      if (list) list.push({ skill_id: (s as { id: string }).id, skill_name: (s as { name?: string }).name ?? "" })
    }
  }

  const axes: CatalogAxis[] = axesRows.map((a) => ({
    axis_id: (a as { id: string }).id,
    axis_name: (a as { name?: string }).name ?? "",
    skills: skillsByAxis.get((a as { id: string }).id) ?? [],
  }))

  return { axes }
}
