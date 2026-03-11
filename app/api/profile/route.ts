import { NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const PROFILE_COLUMNS = "user_id, teacher_id, school_id, department"

const CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
}

function toProfile(row: Record<string, unknown> | null, userId: string) {
  if (!row) return null
  return {
    id: null,
    user_id: (row.user_id as string) ?? userId,
    teacher_id: (row.teacher_id as string) ?? null,
    school_id: (row.school_id as string) ?? null,
    department: (row.department as string) ?? null,
    role: (row.role as string) ?? "teacher",
  }
}

/**
 * GET /api/profile — Siempre lee desde BD con service role.
 * user desde cookies (getAuthUser); SELECT profiles WHERE user_id; si no existe fila, INSERT + SELECT de nuevo.
 * Responde con perfil REAL (nunca fallback con teacher_id null si la fila existe en BD).
 */
export async function GET() {
  const user = await getAuthUser()
  if (process.env.NODE_ENV === "development") {
    console.info("[API][PROFILE] user.id", user?.id ?? null)
  }
  if (!user) {
    if (process.env.NODE_ENV === "development") console.info("[API][PROFILE] no user, returning 200 profile null")
    return NextResponse.json(
      { profile: null, user: null },
      { status: 200, headers: CACHE_HEADERS }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    if (process.env.NODE_ENV === "development") console.info("[API][PROFILE] supabase null, returning fallback")
    return NextResponse.json(
      {
        profile: { id: null, user_id: user.id, teacher_id: null, school_id: null, department: null, role: "teacher" },
        user: { id: user.id, email: user.email ?? null },
        isAdmin: false,
      },
      { status: 200, headers: CACHE_HEADERS }
    )
  }

  const { data: row, error: selectError } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle()

  if (selectError && process.env.NODE_ENV === "development") {
    console.info("[API][PROFILE] GET select error", user.id, selectError.message)
  }

  let profileRow = row ? toProfile(row as Record<string, unknown>, user.id) : null
  if (process.env.NODE_ENV === "development") {
    console.info("[API][PROFILE] profile found", !!profileRow, "teacher_id", profileRow?.teacher_id ?? null, "school_id", profileRow?.school_id ?? null)
  }

  if (!profileRow) {
    const { error: insertErr } = await supabase
      .from("profiles")
      .insert({ user_id: user.id })

    if (insertErr && process.env.NODE_ENV === "development") {
      console.info("[API][PROFILE] GET insert error", user.id, insertErr.message)
    }

    const { data: insertedRow } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("user_id", user.id)
      .maybeSingle()

    profileRow = insertedRow ? toProfile(insertedRow as Record<string, unknown>, user.id) : null
    if (process.env.NODE_ENV === "development") {
      console.info("[API][PROFILE] after insert, profileRow", !!profileRow, "returning fallback?", !profileRow)
    }
  }

  if (profileRow && process.env.NODE_ENV === "development") {
    console.info("[API][PROFILE] user", user.id, "teacher_id", profileRow.teacher_id)
  }

  const finalProfile = profileRow ?? {
    id: null,
    user_id: user.id,
    teacher_id: null,
    school_id: null,
    department: null,
    role: "teacher" as const,
  }
  if (process.env.NODE_ENV === "development" && !profileRow) {
    console.info("[API][PROFILE] returning fallback profile (no real row)")
  }

  return NextResponse.json(
    {
      profile: finalProfile,
      user: { id: user.id, email: user.email ?? null },
      isAdmin: (finalProfile.role ?? "teacher") === "admin",
    },
    { status: 200, headers: CACHE_HEADERS }
  )
}
