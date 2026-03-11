// app/api/debug/evaluations/by-course/route.ts
// Temporal: listar evaluaciones por curso sin filtrar por status (para ver si BD tiene "archived").
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

  const { data: list, error } = await supabase
    .from("evaluations")
    .select("id, title, course_id, status")
    .eq("teacher_id", profile.teacher_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const all = (list ?? []) as Array<{ id: string; title: string | null; course_id: string | null; status: string | null }>
  const evaluations = courseId
    ? all.filter((e) => {
        const c = e.course_id != null && String(e.course_id).trim() !== "" ? String(e.course_id).trim() : "Sin curso"
        return c === normalizedCourseId
      })
    : all

  return NextResponse.json({
    evaluations: evaluations.map((e) => ({ id: e.id, title: e.title, course_id: e.course_id, status: e.status })),
  })
}
