// app/api/debug/auth-health/route.ts
// Solo desarrollo: diagnóstico de sesión, perfil y conteos por teacher_id / user_id.
import { NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "No disponible en producción" }, { status: 404 })
  }

  const user = await getAuthUser()
  let profile: { teacher_id: string | null; school_id: string | null } | null = null
  let countByTeacherId: number | null = null
  let countByUserId: number | null = null

  const supabase = getSupabaseServer()
  if (supabase && user) {
    const { data: p } = await supabase
      .from("profiles")
      .select("teacher_id, school_id")
      .eq("user_id", user.id)
      .maybeSingle()
    profile = p ?? null

    if (profile?.teacher_id) {
      const { count } = await supabase
        .from("evaluations")
        .select("id", { count: "exact", head: true })
        .eq("teacher_id", profile.teacher_id)
      countByTeacherId = count ?? null
    }
    const { count: userCount } = await supabase
      .from("evaluations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
    countByUserId = userCount ?? null
  }

  return NextResponse.json({
    hasSession: !!user,
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    profileTeacherId: profile?.teacher_id ?? null,
    profileSchoolId: profile?.school_id ?? null,
    counts: {
      by_teacher_id: countByTeacherId,
      by_user_id: countByUserId,
    },
  })
}
