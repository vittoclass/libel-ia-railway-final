import { NextRequest, NextResponse } from "next/server"
import { normUuid, profileScopeFromRow } from "@/app/lib/evaluation-read-scope"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer, isSupabaseConfigured } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/evaluations/by-teacher/:teacherId
 * Devuelve las evaluaciones del profesor (para verificar historial tras persistencia).
 * Sesión + ownership (propio teacher_id o mismo school_id). Service role sin cambio.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { teacherId: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "Supabase no configurado" },
      { status: 503 }
    )
  }
  const teacherId = params?.teacherId
  if (!teacherId) {
    return NextResponse.json(
      { success: false, error: "Falta teacherId" },
      { status: 400 }
    )
  }

  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: "No autorizado" },
      { status: 401 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Error al conectar con Supabase" },
      { status: 503 }
    )
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const { teacher_id_used, school_id_used } = profileScopeFromRow(profileRow)
  const requestedTeacherId = normUuid(teacherId)
  const isOwnTeacher = !!(teacher_id_used && requestedTeacherId === teacher_id_used)

  let allowed = isOwnTeacher
  if (!allowed && school_id_used) {
    const { data: targetRow } = await supabase
      .from("profiles")
      .select("teacher_id, school_id")
      .eq("teacher_id", teacherId)
      .maybeSingle()
    const targetSchool = profileScopeFromRow(targetRow).school_id_used
    if (targetSchool && targetSchool === school_id_used) {
      allowed = true
    }
  }

  if (!allowed) {
    return NextResponse.json(
      { success: false, error: "No autorizado" },
      { status: 403 }
    )
  }

  let query = supabase
    .from("evaluations")
    .select("id, title, subject, evaluated_at, created_at")
    .eq("teacher_id", teacherId)

  if (!isOwnTeacher && school_id_used) {
    query = query.eq("school_id", school_id_used)
  }

  const { data: evaluations, error } = await query.order("evaluated_at", { ascending: false })

  if (error) {
    console.error("[evaluations/by-teacher]", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, evaluations: evaluations ?? [] })
}
