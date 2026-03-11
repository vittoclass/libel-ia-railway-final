import { User } from "@supabase/supabase-js"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export type ProfileRow = {
  id: string | null
  user_id: string
  teacher_id: string | null
  school_id: string | null
  department: string | null
  role: string | null
}

// Solo columnas que existen en la migración base (20250228). role viene de migración posterior.
const PROFILE_COLUMNS = "user_id, teacher_id, school_id, department"

/**
 * Obtiene el perfil del usuario logueado; si no existe fila en profiles, la crea (user_id, role: 'teacher').
 * Siempre usa select con las columnas necesarias; tras insert hace SELECT y devuelve la fila real.
 * Retorna profile nunca null cuando hay sesión.
 */
export async function getOrCreateProfile(): Promise<{
  user: User | null
  profile: ProfileRow | null
}> {
  const user = await getAuthUser()
  if (process.env.NODE_ENV === "development") {
    console.info("[profile][lib] getAuthUser result", !!user, "user.id", user?.id ?? null)
  }
  if (!user) {
    return { user: null, profile: null }
  }

  const supabase = getSupabaseServer()
  const fallback: ProfileRow = {
    id: null,
    user_id: user.id,
    teacher_id: null,
    school_id: null,
    department: null,
    role: "teacher",
  }

  if (!supabase) {
    if (process.env.NODE_ENV === "development") console.info("[profile][lib] supabase null, returning fallback")
    return { user, profile: fallback }
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle()

  if (profileError) {
    if (process.env.NODE_ENV === "development") {
      console.info("[profile][lib] select error for user", user.id, profileError.message)
    }
    return { user, profile: fallback }
  }

  if (profileData) {
    const p = toProfileRow(profileData as Record<string, unknown>, user.id)
    if (p) {
      if (process.env.NODE_ENV === "development") {
        console.info("[profile][lib] profile found", "teacher_id", p.teacher_id, "school_id", p.school_id)
      }
      return { user, profile: p }
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[profile][lib] no profile row, inserting")
  }
  const { error: insertErr } = await supabase
    .from("profiles")
    .insert({ user_id: user.id })

  if (insertErr) {
    if (process.env.NODE_ENV === "development") {
      console.info("[profile][lib] insert error for user", user.id, insertErr.message)
    }
    return { user, profile: fallback }
  }

  const { data: insertedRow, error: selectAfterErr } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle()

  if (selectAfterErr || !insertedRow) {
    if (process.env.NODE_ENV === "development") console.info("[profile][lib] select after insert failed, returning fallback")
    return { user, profile: fallback }
  }

  const p = toProfileRow(insertedRow as Record<string, unknown>, user.id)
  if (p) {
    if (process.env.NODE_ENV === "development") {
      console.info("[profile][lib] user", user.id, "teacher_id", p.teacher_id, "(after insert)")
    }
    return { user, profile: p }
  }
  if (process.env.NODE_ENV === "development") console.info("[profile][lib] toProfileRow returned null after insert")
  return { user, profile: fallback }
}

function toProfileRow(row: Record<string, unknown> | null, userId: string): ProfileRow | null {
  if (!row) return null
  return {
    id: (row.id as string) ?? null,
    user_id: (row.user_id as string) ?? userId,
    teacher_id: (row.teacher_id as string) ?? null,
    school_id: (row.school_id as string) ?? null,
    department: (row.department as string) ?? null,
    role: (row.role as string) ?? "teacher",
  }
}
