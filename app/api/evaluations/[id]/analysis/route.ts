import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const PEDAGOGY_ENABLED = process.env.ENABLE_PEDAGOGY === "true"

function simceLevel(accuracy: number): "Avanzado" | "Intermedio" | "Inicial" {
  if (accuracy >= 0.75) return "Avanzado"
  if (accuracy >= 0.5) return "Intermedio"
  return "Inicial"
}

/**
 * GET /api/evaluations/[id]/analysis?mode=simce
 * Usa evaluation_items (is_correct) + evaluation_question_tags.
 * Retorna bySkill, byAxis, y opcionalmente simceLevels si mode=simce.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!PEDAGOGY_ENABLED) {
    return NextResponse.json({ step: "config", message: "Pedagogy no habilitado" }, { status: 404 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ step: "auth", message: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ step: "config", message: "Supabase no configurado" }, { status: 503 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ step: "validation", message: "Falta id" }, { status: 400 })
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacher_id = profileRow?.teacher_id ?? profile?.teacher_id ?? null
  if (!teacher_id) {
    return NextResponse.json({ step: "profile", message: "Perfil incompleto" }, { status: 403 })
  }

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id")
    .eq("id", id)
    .eq("teacher_id", teacher_id)
    .maybeSingle()

  if (!evaluation) {
    return NextResponse.json({ step: "evaluation", message: "No encontrada o sin permiso" }, { status: 404 })
  }

  const modeSimce = req.nextUrl.searchParams.get("mode") === "simce"

  const [itemsRes, tagsRes] = await Promise.all([
    supabase.from("evaluation_items").select("question_number, is_correct").eq("evaluation_id", id),
    supabase.from("evaluation_question_tags").select("question_number, axis_id, skill_id").eq("evaluation_id", id),
  ])

  if (itemsRes.error) {
    return NextResponse.json({ step: "items", message: itemsRes.error.message }, { status: 500 })
  }
  if (tagsRes.error) {
    return NextResponse.json({ step: "tags", message: tagsRes.error.message }, { status: 500 })
  }

  const items = (itemsRes.data ?? []) as Array<{ question_number: number; is_correct: boolean | null }>
  const tags = (tagsRes.data ?? []) as Array<{ question_number: number; axis_id: string | null; skill_id: string | null }>

  const correctByQuestion = new Map(items.map((i) => [i.question_number, i.is_correct === true]))
  const tagByQuestion = new Map(tags.map((t) => [t.question_number, t]))

  if (tags.length === 0) {
    return NextResponse.json({
      bySkill: [],
      byAxis: [],
      simceLevels: modeSimce ? { bySkill: [], byAxis: [] } : undefined,
      message: "Sin etiquetado pedagógico",
    })
  }

  const skillStats = new Map<string, { correct: number; total: number }>()
  const axisStats = new Map<string, { correct: number; total: number }>()
  const skillNames = new Map<string, string>()
  const axisNames = new Map<string, string>()

  for (const t of tags) {
    const correct = correctByQuestion.get(t.question_number) === true
    if (t.skill_id) {
      const s = skillStats.get(t.skill_id) ?? { correct: 0, total: 0 }
      s.total++
      if (correct) s.correct++
      skillStats.set(t.skill_id, s)
    }
    if (t.axis_id) {
      const a = axisStats.get(t.axis_id) ?? { correct: 0, total: 0 }
      a.total++
      if (correct) a.correct++
      axisStats.set(t.axis_id, a)
    }
  }

  const skillIds = Array.from(skillStats.keys())
  const axisIds = Array.from(axisStats.keys())
  if (skillIds.length > 0) {
    const { data: skills } = await supabase.from("pedagogy_skills").select("id, name, axis_id").in("id", skillIds)
    for (const s of skills ?? []) {
      skillNames.set(s.id, s.name)
    }
  }
  if (axisIds.length > 0) {
    const { data: axes } = await supabase.from("pedagogy_axes").select("id, name").in("id", axisIds)
    for (const a of axes ?? []) {
      axisNames.set(a.id, a.name)
    }
  }

  const bySkill = Array.from(skillStats.entries()).map(([skill_id, s]) => {
    const accuracy = s.total > 0 ? s.correct / s.total : 0
    return {
      skill_id,
      skill_name: skillNames.get(skill_id) ?? skill_id,
      correct: s.correct,
      total: s.total,
      accuracy,
      ...(modeSimce && { level: simceLevel(accuracy) }),
    }
  })

  const byAxis = Array.from(axisStats.entries()).map(([axis_id, a]) => {
    const accuracy = a.total > 0 ? a.correct / a.total : 0
    return {
      axis_id,
      axis_name: axisNames.get(axis_id) ?? axis_id,
      correct: a.correct,
      total: a.total,
      accuracy,
      ...(modeSimce && { level: simceLevel(accuracy) }),
    }
  })

  return NextResponse.json({
    bySkill,
    byAxis,
    ...(modeSimce && {
      simceLevels: {
        bySkill: bySkill.map((s) => ({ skill_id: s.skill_id, skill_name: s.skill_name, level: s.level })),
        byAxis: byAxis.map((a) => ({ axis_id: a.axis_id, axis_name: a.axis_name, level: a.level })),
      },
    }),
  })
}
