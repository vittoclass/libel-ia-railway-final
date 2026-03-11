/**
 * POST /api/debug/backfill-skill-results
 * Solo development (404 en production).
 * Body opcional: { course_label?: string }.
 * Pobla evaluation_skill_results para evaluaciones antiguas usando evaluation_items y evaluateSkillsFromEvaluation.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { backfillSkillResults } from "@/app/lib/backfill-skill-results"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "No disponible en producción" }, { status: 404 })
  }

  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (profileError || !profileRow?.teacher_id) {
    return NextResponse.json(
      { error: profileError?.message ?? "Completa tu perfil (teacher_id)" },
      { status: profileRow ? 500 : 403 }
    )
  }

  let course_label: string | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (body && typeof body.course_label === "string" && body.course_label.trim() !== "") {
      course_label = body.course_label.trim()
    }
  } catch {
    // body opcional
  }

  const result = await backfillSkillResults({
    supabase,
    teacher_id: profileRow.teacher_id,
    course_label: course_label ?? undefined,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, scanned_evaluations: result.scanned_evaluations, updated_evaluations: result.updated_evaluations, inserted_rows: result.inserted_rows },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    scanned_evaluations: result.scanned_evaluations,
    updated_evaluations: result.updated_evaluations,
    inserted_rows: result.inserted_rows,
  })
}
