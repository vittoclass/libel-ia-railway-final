import { NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/debug/evaluations-diagnose
 * Diagnóstico completo del listado de evaluaciones. Solo en desarrollo.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  const { user, profile } = await getOrCreateProfile()
  const hasSession = !!user
  const userId = user?.id ?? null

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({
      hasSession,
      userId,
      profile: profile ? { user_id: profile.user_id, teacher_id: profile.teacher_id, school_id: profile.school_id, role: profile.role } : null,
      teacher_id_used: profile?.teacher_id ?? null,
      countByTeacherId: {},
      error: "Supabase no configurado",
      latestEvaluationsByProfileTeacherId: [],
      latestEvaluationsAnyTeacher: [],
      counts: {},
    })
  }

  const profileTeacherId = profile?.teacher_id ?? null

  // Conteos por teacher_id (todas las evaluaciones agrupadas)
  const { data: allEvals } = await supabase.from("evaluations").select("teacher_id")
  const countByTeacherId: Record<string, number> = {}
  for (const row of allEvals ?? []) {
    const tid = row.teacher_id ?? "(null)"
    countByTeacherId[tid] = (countByTeacherId[tid] ?? 0) + 1
  }

  // Últimas 5 con teacher_id del perfil
  let latestEvaluationsByProfileTeacherId: Array<{ id: string; teacher_id: string; status: string | null; title: string | null; evaluated_at: string | null }> = []
  if (profileTeacherId) {
    const { data } = await supabase
      .from("evaluations")
      .select("id, teacher_id, status, title, evaluated_at")
      .eq("teacher_id", profileTeacherId)
      .order("evaluated_at", { ascending: false })
      .limit(5)
    latestEvaluationsByProfileTeacherId = (data ?? []).map((r) => ({
      id: r.id,
      teacher_id: r.teacher_id,
      status: r.status ?? null,
      title: r.title ?? null,
      evaluated_at: r.evaluated_at ?? null,
    }))
  }

  // Últimas 5 de cualquier teacher (sin filtro teacher_id)
  const { data: anyData } = await supabase
    .from("evaluations")
    .select("id, teacher_id, status, title, evaluated_at")
    .order("evaluated_at", { ascending: false })
    .limit(5)
  const latestEvaluationsAnyTeacher = (anyData ?? []).map((r) => ({
    id: r.id,
    teacher_id: r.teacher_id,
    status: r.status ?? null,
    title: r.title ?? null,
    evaluated_at: r.evaluated_at ?? null,
  }))

  // Conteos (con tolerancia si status no existe)
  let totalEvaluations = 0
  let countByProfileTeacherId = 0
  let countDraft = 0
  let countFinal = 0
  let countArchived = 0

  const { count: total } = await supabase.from("evaluations").select("id", { count: "exact", head: true })
  totalEvaluations = total ?? 0

  if (profileTeacherId) {
    const { count: byTeacher } = await supabase
      .from("evaluations")
      .select("id", { count: "exact", head: true })
      .eq("teacher_id", profileTeacherId)
    countByProfileTeacherId = byTeacher ?? 0
  }

  try {
    const { count: d } = await supabase.from("evaluations").select("id", { count: "exact", head: true }).eq("status", "draft")
    countDraft = d ?? 0
    const { count: f } = await supabase.from("evaluations").select("id", { count: "exact", head: true }).eq("status", "final")
    countFinal = f ?? 0
    const { count: a } = await supabase.from("evaluations").select("id", { count: "exact", head: true }).eq("status", "archived")
    countArchived = a ?? 0
  } catch (_) {
    // status column might not exist
  }

  return NextResponse.json({
    hasSession,
    userId,
    profile: profile ? { user_id: profile.user_id, teacher_id: profile.teacher_id, school_id: profile.school_id, role: profile.role } : null,
    teacher_id_used: profileTeacherId,
    countByTeacherId,
    latestEvaluationsByProfileTeacherId,
    latestEvaluationsAnyTeacher,
    counts: {
      totalEvaluations,
      countByTeacherId: countByProfileTeacherId,
      countDraft,
      countFinal,
      countArchived,
    },
  })
}
