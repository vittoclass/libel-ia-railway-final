import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/** GET /api/evaluations/me — Lista evaluaciones del profesor asociado al usuario logueado. Query: courseId?, from?, to? */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  let teacher_id: string | null = profile?.teacher_id ?? null
  if (!teacher_id) {
    const { data: defaultTeacher } = await supabase
      .from("teachers")
      .select("id")
      .limit(1)
      .maybeSingle()
    teacher_id = defaultTeacher?.id ?? null
  }

  if (!teacher_id) {
    return NextResponse.json({ evaluations: [], message: "Completa tu perfil (nombre, colegio) para ver historial." }, { status: 200 })
  }

  const { searchParams } = new URL(req.url)
  const courseId = searchParams.get("courseId")?.trim() || undefined
  const from = searchParams.get("from")?.trim() || undefined
  const to = searchParams.get("to")?.trim() || undefined

  let query = supabase
    .from("evaluations")
    .select("id, title, subject, evaluated_at, created_at")
    .eq("teacher_id", teacher_id)
    .order("evaluated_at", { ascending: false })

  if (courseId) query = query.eq("course_id", courseId)
  if (from) query = query.gte("evaluated_at", from)
  if (to) query = query.lte("evaluated_at", to)

  const { data: evaluations, error } = await query

  if (error) {
    console.error("[evaluations/me]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const list = evaluations ?? []
  if (list.length === 0) {
    return NextResponse.json({ evaluations: [] })
  }

  const ids = list.map((e) => e.id)
  const { data: summaries } = await supabase
    .from("evaluation_summaries")
    .select("evaluation_id, grade_chile")
    .in("evaluation_id", ids)

  const gradeByEval = new Map((summaries ?? []).map((s) => [s.evaluation_id, s.grade_chile]))
  const withGrade = list.map((e) => ({ ...e, grade_chile: gradeByEval.get(e.id) ?? null }))

  return NextResponse.json({ evaluations: withGrade })
}
