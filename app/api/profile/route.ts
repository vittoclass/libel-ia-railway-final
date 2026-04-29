import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { DEFAULT_PROFILE_ROLE } from "@/app/lib/profile-defaults"
import { resolvePilotSchool } from "@/app/lib/pilot-school"

export const dynamic = "force-dynamic"
const isPilotModeEnabled = () => String(process.env.PILOT_MODE ?? "").trim().toLowerCase() === "true"

const PROFILE_COLUMNS = "user_id, teacher_id, school_id, department, role"

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
    role: (row.role as string) ?? DEFAULT_PROFILE_ROLE,
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
      { profile: null, user: null, onboarded: false },
      { status: 200, headers: CACHE_HEADERS }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    if (process.env.NODE_ENV === "development") console.info("[API][PROFILE] supabase null, returning fallback")
    return NextResponse.json(
      {
        profile: {
          id: null,
          user_id: user.id,
          teacher_id: null,
          school_id: null,
          department: null,
          role: DEFAULT_PROFILE_ROLE,
        },
        user: { id: user.id, email: user.email ?? null },
        isAdmin: false,
        onboarded: false,
      },
      { status: 200, headers: CACHE_HEADERS }
    )
  }

  const { data: row, error: selectError } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle()

  if (selectError) {
    console.error("[API][PROFILE] GET select error", user.id, selectError.message, selectError)
    return NextResponse.json(
      {
        error: selectError.message,
        step: "select",
        profile: null,
        user: { id: user.id, email: user.email ?? null },
      },
      { status: 500, headers: CACHE_HEADERS }
    )
  }

  let profileRow = row ? toProfile(row as Record<string, unknown>, user.id) : null
  if (process.env.NODE_ENV === "development") {
    console.info("[API][PROFILE] profile found", !!profileRow, "teacher_id", profileRow?.teacher_id ?? null, "school_id", profileRow?.school_id ?? null)
  }

  if (!profileRow) {
    const pilot = isPilotModeEnabled() ? await resolvePilotSchool(supabase) : null
    const { error: insertErr } = await supabase.from("profiles").insert({
      id: user.id,
      user_id: user.id,
      role: DEFAULT_PROFILE_ROLE,
      ...(pilot ? { school_id: pilot.id } : {}),
    })

    if (insertErr) {
      console.error("[API][PROFILE] GET insert error", user.id, insertErr.message, insertErr)
      return NextResponse.json(
        {
          error: insertErr.message,
          step: "insert",
          profile: null,
          user: { id: user.id, email: user.email ?? null },
        },
        { status: 500, headers: CACHE_HEADERS }
      )
    }

    const { data: insertedRow, error: afterSelectErr } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("user_id", user.id)
      .maybeSingle()

    if (afterSelectErr) {
      console.error("[API][PROFILE] GET post-insert select error", user.id, afterSelectErr.message)
      return NextResponse.json(
        { error: afterSelectErr.message, step: "post_insert_select", user: { id: user.id, email: user.email ?? null } },
        { status: 500, headers: CACHE_HEADERS }
      )
    }

    profileRow = insertedRow ? toProfile(insertedRow as Record<string, unknown>, user.id) : null
    if (process.env.NODE_ENV === "development") {
      console.info("[API][PROFILE] after insert, profileRow", !!profileRow)
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
    role: DEFAULT_PROFILE_ROLE,
  }
  if (process.env.NODE_ENV === "development" && !profileRow) {
    console.info("[API][PROFILE] returning fallback profile (no real row)")
  }

  const roleNorm = String(finalProfile.role ?? "").toLowerCase()
  const onboarded = !!finalProfile.teacher_id

  const pilotSchool = isPilotModeEnabled() ? await resolvePilotSchool(supabase) : null

  let teacherDisplayName: string | null = null
  if (onboarded && finalProfile.teacher_id) {
    const { data: teacherRow, error: teacherErr } = await supabase
      .from("teachers")
      .select("name")
      .eq("id", finalProfile.teacher_id)
      .maybeSingle()
    if (teacherErr && process.env.NODE_ENV === "development") {
      console.warn("[API][PROFILE] teacher name lookup", teacherErr.message)
    } else {
      const raw = String((teacherRow as { name?: string | null } | null)?.name ?? "").trim()
      teacherDisplayName = raw.length > 0 ? raw : null
    }
  }

  const needs_teacher_display_name = onboarded && String(teacherDisplayName ?? "").trim().length < 2

  return NextResponse.json(
    {
      profile: finalProfile,
      user: { id: user.id, email: user.email ?? null },
      isAdmin: roleNorm === "admin",
      onboarded,
      teacher_display_name: teacherDisplayName,
      needs_teacher_display_name,
      pilotSchool:
        pilotSchool != null
          ? { id: pilotSchool.id, name: pilotSchool.name, schoolNameLocked: true as const }
          : null,
    },
    { status: 200, headers: CACHE_HEADERS }
  )
}

const DISPLAY_NAME_MIN = 2
const DISPLAY_NAME_MAX = 200

/**
 * POST /api/profile — Solo nombre para identificación (docente ya onboarded).
 * Actualiza public.teachers.name del teacher_id del perfil.
 * Intenta actualizar profiles.full_name si la columna existe en el proyecto (ignora error si no).
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: CACHE_HEADERS })
  }

  let body: { display_name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400, headers: CACHE_HEADERS })
  }

  const displayName =
    typeof body.display_name === "string" ? body.display_name.trim().slice(0, DISPLAY_NAME_MAX) : ""
  if (displayName.length < DISPLAY_NAME_MIN) {
    return NextResponse.json(
      { error: "El nombre debe tener al menos 2 caracteres" },
      { status: 400, headers: CACHE_HEADERS },
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503, headers: CACHE_HEADERS })
  }

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500, headers: CACHE_HEADERS })
  }

  const teacherId = (prof as { teacher_id?: string | null } | null)?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json(
      { error: "Completa primero tu perfil en /perfil antes de guardar el nombre." },
      { status: 400, headers: CACHE_HEADERS },
    )
  }

  const { error: teacherUpdErr } = await supabase.from("teachers").update({ name: displayName }).eq("id", teacherId)
  if (teacherUpdErr) {
    return NextResponse.json({ error: teacherUpdErr.message }, { status: 500, headers: CACHE_HEADERS })
  }

  const { error: fullNameErr } = await supabase.from("profiles").update({ full_name: displayName }).eq("user_id", user.id)
  if (fullNameErr && process.env.NODE_ENV === "development") {
    console.info("[API][PROFILE] POST profiles.full_name opcional:", fullNameErr.message)
  }

  return NextResponse.json(
    { ok: true, message: "Nombre guardado." },
    { status: 200, headers: CACHE_HEADERS },
  )
}
