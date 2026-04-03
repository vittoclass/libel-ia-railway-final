import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeRutCanonical } from "@/app/lib/student-identity/rut"

// PHASE_4_MEMORY_IDENTITY_V1
type EnsureIdentityParams = {
  rut: string | null | undefined
  student_name: string
  course_label?: string | null
  institution?: string | null
  evaluation_id?: string | null
  evaluated_at?: string | null
}

// PHASE_4_MEMORY_IDENTITY_V1
export async function upsertStudentIdentity(
  supabase: SupabaseClient,
  params: EnsureIdentityParams
): Promise<{ student_id: string | null; rut_norm: string | null }> {
  const rut_norm = normalizeRutCanonical(params.rut)
  if (!rut_norm) return { student_id: null, rut_norm: null }
  const payload = {
    rut_raw: params.rut ?? null,
    rut_norm,
    full_name: params.student_name,
    course_label: params.course_label ?? null,
    institution: params.institution ?? null,
  }
  const { data, error } = await supabase
    .from("students")
    .upsert(payload, { onConflict: "rut_norm" })
    .select("id")
    .single()
  if (error || !data?.id) return { student_id: null, rut_norm }
  const student_id = String(data.id)
  if (params.evaluation_id) {
    await supabase
      .from("student_evaluations")
      .upsert(
        {
          student_id,
          evaluation_id: params.evaluation_id,
          course_label: params.course_label ?? null,
          evaluated_at: params.evaluated_at ?? null,
        },
        { onConflict: "evaluation_id" }
      )
      .select("id")
      .maybeSingle()
  }
  return { student_id, rut_norm }
}

// PHASE_4_MEMORY_IDENTITY_V1
export async function attachStudentIdToEvaluationArtifacts(
  supabase: SupabaseClient,
  params: {
    evaluation_id: string
    student_name?: string | null
    student_normalized?: string | null
    student_id: string
  }
): Promise<void> {
  const normalized =
    params.student_normalized ?? (params.student_name ? params.student_name.trim().toLowerCase() : null)
  if (normalized) {
    await supabase
      .from("evaluation_students")
      .update({ student_id: params.student_id })
      .eq("evaluation_id", params.evaluation_id)
      .eq("student_normalized", normalized)
  } else {
    await supabase
      .from("evaluation_students")
      .update({ student_id: params.student_id })
      .eq("evaluation_id", params.evaluation_id)
  }
  await supabase
    .from("evaluation_skill_results")
    .update({ student_id: params.student_id })
    .eq("evaluation_id", params.evaluation_id)
}
