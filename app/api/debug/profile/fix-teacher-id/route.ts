import { NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * POST /api/debug/profile/fix-teacher-id
 * Solo desarrollo. Si profile.teacher_id es null, asigna el teacher_id más frecuente en evaluations.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  if (profile?.teacher_id != null) {
    return NextResponse.json({
      ok: true,
      message: "profile.teacher_id ya está definido",
      profile: { user_id: profile.user_id, teacher_id: profile.teacher_id, school_id: profile.school_id, department: profile.department, role: profile.role },
    })
  }

  const { data: evals } = await supabase
    .from("evaluations")
    .select("teacher_id")
  const countByTeacherId: Record<string, number> = {}
  for (const row of evals ?? []) {
    const tid = row.teacher_id
    if (tid) {
      countByTeacherId[tid] = (countByTeacherId[tid] ?? 0) + 1
    }
  }
  const entries = Object.entries(countByTeacherId)
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No hay evaluaciones con teacher_id para inferir" },
      { status: 400 }
    )
  }
  entries.sort((a, b) => b[1] - a[1])
  const teacherId = entries[0][0]

  const { data: teacher } = await supabase
    .from("teachers")
    .select("school_id")
    .eq("id", teacherId)
    .maybeSingle()
  const schoolId = teacher?.school_id ?? null

  const updates: { teacher_id: string; school_id?: string | null } = { teacher_id: teacherId }
  if (schoolId != null) updates.school_id = schoolId

  const { data: updated, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("user_id", user.id)
    .select("user_id, teacher_id, school_id, department, role")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    profile: {
      user_id: updated?.user_id ?? user.id,
      teacher_id: updated?.teacher_id ?? teacherId,
      school_id: updated?.school_id ?? schoolId,
      department: updated?.department ?? null,
      role: updated?.role ?? "teacher",
    },
  })
}
