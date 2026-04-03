import { NextRequest, NextResponse } from "next/server"
import { getAuthUser, getSupabaseRouteClient } from "@/app/lib/supabase-route"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET ?q= — Pautas (source_exams) del mismo teacher_id del perfil. No toca OMR ni evaluations.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const q = String(req.nextUrl.searchParams.get("q") ?? "")
    .replace(/,/g, " ")
    .trim()
    .slice(0, 120)
  const limit = Math.min(40, Math.max(5, Number(req.nextUrl.searchParams.get("limit")) || 20))

  const supabase = await getSupabaseRouteClient()

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  const teacherId = String((profile as { teacher_id?: string | null } | null)?.teacher_id ?? "").trim()
  if (!teacherId || !UUID_REGEX.test(teacherId)) {
    return NextResponse.json({ error: "Complete el perfil con teacher_id para buscar pautas.", exams: [] }, { status: 403 })
  }

  let query = supabase
    .from("source_exams")
    .select("id, title, subject, course_label, exam_type, created_at")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (q.length >= 2) {
    const esc = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
    query = query.or(
      `title.ilike.%${esc}%,subject.ilike.%${esc}%,course_label.ilike.%${esc}%`,
    )
  }

  const { data, error } = await query

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return NextResponse.json({ exams: [], warning: "Tabla source_exams no disponible." })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ exams: data ?? [] })
}
