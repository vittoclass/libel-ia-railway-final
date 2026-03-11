/**
 * POST /api/courses/[courseId]/recompute-skills
 * Recalcula habilidades para todas las evaluaciones del curso del profesor.
 * courseId = course_label (URL-encoded). Respuesta auditable con details por evaluación.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { normalizeCourseLabel } from "@/app/lib/course-utils"
import { recomputeSkillsForEvaluation } from "@/app/lib/backfill-skill-results"

export const dynamic = "force-dynamic"

type DetailItem = {
  evaluation_id: string
  title: string | null
  subject: string | null
  reason: string
  items_count: number
  linked_profiles_count: number
  computed_skill_rows_count: number
  rows_to_insert_count: number
  inserted_skill_rows_count: number
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const rawCourse = (await params).courseId
  if (!rawCourse) {
    return NextResponse.json({ ok: false, message: "courseId requerido" }, { status: 400 })
  }

  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ ok: false, message: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Supabase no configurado" }, { status: 503 })
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (profileError || !profileRow?.teacher_id) {
    return NextResponse.json(
      { ok: false, message: profileError?.message ?? "Completa tu perfil (teacher_id)" },
      { status: 403 }
    )
  }

  const courseLabel =
    rawCourse === "_" || rawCourse === "Sin%20curso" ? "Sin curso" : decodeURIComponent(rawCourse)
  const normalized = normalizeCourseLabel(courseLabel)

  const { data: evaluations, error: evErr } = await supabase
    .from("evaluations")
    .select("id, subject, course_label, title")
    .eq("teacher_id", profileRow.teacher_id)

  if (evErr) {
    return NextResponse.json({ ok: false, message: evErr.message }, { status: 500 })
  }

  const evList = (evaluations ?? []).filter(
    (e) => normalizeCourseLabel((e as { course_label?: string | null }).course_label) === normalized
  )

  const details: DetailItem[] = []
  let evaluations_updated = 0
  let inserted_rows_total = 0

  for (const ev of evList) {
    const res = await recomputeSkillsForEvaluation(
      supabase,
      ev.id as string,
      profileRow.teacher_id
    )
    details.push({
      evaluation_id: res.evaluation_id ?? ev.id,
      title: res.title ?? (ev as { title?: string | null }).title ?? null,
      subject: res.subject ?? (ev as { subject?: string | null }).subject ?? null,
      reason: res.reason ?? (res.ok ? "INSERTED_OK" : "NO_ITEMS"),
      items_count: res.items_count ?? 0,
      linked_profiles_count: res.linked_profiles_count ?? 0,
      computed_skill_rows_count: res.computed_skill_rows_count ?? 0,
      rows_to_insert_count: res.rows_to_insert_count ?? 0,
      inserted_skill_rows_count: res.inserted_skill_rows_count ?? 0,
    })
    if (res.ok && (res.inserted_skill_rows_count ?? 0) > 0) {
      evaluations_updated++
      inserted_rows_total += res.inserted_skill_rows_count ?? 0
    }
  }

  return NextResponse.json({
    ok: true,
    evaluations_scanned: evList.length,
    evaluations_updated,
    inserted_rows_total,
    details,
  })
}
