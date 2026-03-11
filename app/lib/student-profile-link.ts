/**
 * Vincula evaluation_students a student_profiles (perfil histórico del estudiante).
 * No modifica la lógica de evaluación. Solo capa aditiva.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeCourseLabel } from "@/app/lib/course-utils"

export interface EnsureStudentProfileParams {
  teacher_id: string
  school_id: string | null
  student_name: string
  course_label: string | null
}

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production"

/**
 * Obtiene o crea un student_profile y devuelve su id.
 * 1) Recibe teacher_id, school_id, student_name, course_label.
 * 2) student_normalized = student_name.trim().toLowerCase()
 * 3) Busca existente: teacher_id + student_normalized, limit 1.
 * 4) Si existe → return existing.id
 * 5) Si no existe → insert con los 5 campos y devuelve el id creado.
 * Si algo falla devuelve null y log en dev.
 */
export async function ensureStudentProfile(
  supabase: SupabaseClient,
  params: EnsureStudentProfileParams
): Promise<string | null> {
  const { teacher_id, school_id, student_name, course_label } = params
  const student_normalized =
    student_name != null && String(student_name).trim() !== ""
      ? String(student_name).trim().toLowerCase()
      : ""
  if (!student_normalized) {
    if (isDev) console.info("[student_profile] skipped (empty student_name)")
    return null
  }

  try {
    const courseLabelNormalized = normalizeCourseLabel(course_label)
    const courseVal =
      course_label != null && String(course_label).trim() !== "" ? String(course_label).trim() : null

    const { data: existingRows, error: selectError } = await supabase
      .from("student_profiles")
      .select("id, course_label, course_label_normalized")
      .eq("teacher_id", teacher_id)
      .eq("student_normalized", student_normalized)

    if (selectError) {
      if (isDev) console.warn("[student_profile] error (select)", selectError.message)
      return null
    }

    const existing = (existingRows ?? []).find(
      (r) => (r.course_label_normalized ?? normalizeCourseLabel(r.course_label)) === courseLabelNormalized
    )
    if (existing?.id) {
      if (isDev) console.info("[student_profile] existing", existing.id)
      return existing.id
    }

    const { data: inserted, error: insertError } = await supabase
      .from("student_profiles")
      .insert({
        teacher_id,
        school_id,
        student_name: String(student_name).trim(),
        student_normalized,
        course_label: courseVal,
        course_label_normalized: courseLabelNormalized,
      })
      .select("id")
      .single()

    if (insertError) {
      if (isDev) console.warn("[student_profile] error (insert)", insertError.message)
      const code = (insertError as { code?: string }).code
      if (code === "23505") {
        const { data: retryRows } = await supabase
          .from("student_profiles")
          .select("id, course_label, course_label_normalized")
          .eq("teacher_id", teacher_id)
          .eq("student_normalized", student_normalized)
        const retry = (retryRows ?? []).find(
          (r) => (r.course_label_normalized ?? normalizeCourseLabel(r.course_label)) === courseLabelNormalized
        )
        if (retry?.id) return retry.id
      }
      return null
    }
    const id = inserted?.id ?? null
    if (isDev && id) console.info("[student_profile] created", id)
    return id
  } catch (e) {
    if (isDev) console.warn("[student_profile] error", e)
    return null
  }
}
