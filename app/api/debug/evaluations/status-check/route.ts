// app/api/debug/evaluations/status-check/route.ts
// Solo desarrollo: comprobar status en BD (countActive, countArchived, últimas 5).
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "No disponible en producción" }, { status: 404 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user || !profile?.teacher_id) {
    return NextResponse.json({ error: "No autorizado o perfil sin teacher_id" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const courseId = req.nextUrl.searchParams.get("course_id") ?? null
  const normalizedCourseId =
    !courseId || courseId === "_" || courseId === "Sin%20curso"
      ? "Sin curso"
      : decodeURIComponent(courseId)

  let query = supabase
    .from("evaluations")
    .select("id, title, evaluated_at, status, course_id")
    .eq("teacher_id", profile.teacher_id)
    .order("evaluated_at", { ascending: false })

  const { data: list, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const all = (list ?? []) as Array<{
    id: string
    title: string | null
    evaluated_at: string | null
    status: string | null
    course_id: string | null
  }>

  const byCourse = courseId
    ? all.filter((e) => {
        const c = e.course_id != null && String(e.course_id).trim() !== "" ? String(e.course_id).trim() : "Sin curso"
        return c === normalizedCourseId
      })
    : all

  const countActive = byCourse.filter((e) => e.status == null || e.status !== "archived").length
  const countArchived = byCourse.filter((e) => e.status === "archived").length
  const latest = byCourse.slice(0, 5).map((e) => ({
    id: e.id,
    status: e.status ?? "draft",
    title: e.title,
    evaluated_at: e.evaluated_at,
  }))

  return NextResponse.json({
    teacher_id: profile.teacher_id,
    course_id: courseId ? normalizedCourseId : null,
    countActive,
    countArchived,
    latest,
  })
}
