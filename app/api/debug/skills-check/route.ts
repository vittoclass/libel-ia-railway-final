/**
 * GET /api/debug/skills-check?evaluation_id=...
 * Diagnóstico claro: items_count, computed_skill_rows_count, inserted_skill_rows_count, skills, message.
 * Solo desarrollo.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { evaluateSkillsFromEvaluation } from "@/app/lib/skill-evaluator"
import type { EvaluationResultForSkills } from "@/app/lib/skill-evaluator"
import { getPedagogyCatalog } from "@/app/lib/pedagogy-catalog"

export const dynamic = "force-dynamic"

type ItemRow = {
  question_number?: number | null
  student_answer?: string | null
  correct_answer?: string | null
  score_obtained?: number | null
  score_max?: number | null
}

function buildResultFromItems(items: ItemRow[]): EvaluationResultForSkills {
  const alternativas_corregidas = items
    .filter((i) => Number(i.score_max) === 1)
    .map((i) => ({
      pregunta: "Pregunta " + (i.question_number ?? 0),
      respuesta_estudiante: String(i.student_answer ?? ""),
      respuesta_correcta: String(i.correct_answer ?? ""),
    }))
  const detalle_desarrollo: Record<string, { puntaje?: string; texto_estudiante?: string }> = {}
  for (const i of items.filter((i) => Number(i.score_max) > 1)) {
    const key = "Pregunta " + (i.question_number ?? 0)
    detalle_desarrollo[key] = {
      puntaje: String(i.score_obtained ?? 0) + "/" + String(i.score_max ?? 0),
      texto_estudiante: String(i.student_answer ?? ""),
    }
  }
  return { alternativas_corregidas, detalle_desarrollo }
}

export async function GET(req: NextRequest) {
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

  const evaluationId = req.nextUrl.searchParams.get("evaluation_id")?.trim()
  if (!evaluationId) {
    return NextResponse.json({ error: "evaluation_id requerido" }, { status: 400 })
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const teacherId = profileRow?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ error: "Perfil sin teacher_id" }, { status: 403 })
  }

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, subject, teacher_id")
    .eq("id", evaluationId)
    .eq("teacher_id", teacherId)
    .maybeSingle()

  if (evalErr || !evaluation) {
    return NextResponse.json(
      { error: evalErr?.message ?? "Evaluación no encontrada o sin permiso" },
      { status: evaluation ? 500 : 404 }
    )
  }

  const subject = (evaluation as { subject?: string | null }).subject ?? "Lenguaje"

  const { data: items } = await supabase
    .from("evaluation_items")
    .select("question_number, student_answer, correct_answer, score_obtained, score_max")
    .eq("evaluation_id", evaluationId)
    .order("question_number", { ascending: true })

  const itemsList = (items ?? []) as ItemRow[]
  const items_count = itemsList.length

  let computed_skill_rows_count = 0
  let computedRows: Awaited<ReturnType<typeof evaluateSkillsFromEvaluation>> = []
  if (items_count > 0) {
    const result = buildResultFromItems(itemsList)
    try {
      computedRows = await evaluateSkillsFromEvaluation(result, subject)
      computed_skill_rows_count = computedRows.length
    } catch (_) {
      computed_skill_rows_count = 0
    }
  }

  const { data: insertedRows, error: skillErr } = await supabase
    .from("evaluation_skill_results")
    .select("axis_id, skill_id, accuracy")
    .eq("evaluation_id", evaluationId)

  if (skillErr) {
    return NextResponse.json({
      evaluation_id: evaluationId,
      subject,
      items_count,
      computed_skill_rows_count,
      inserted_skill_rows_count: 0,
      skills: [],
      message: "Error al leer evaluation_skill_results: " + skillErr.message,
    })
  }

  const insertedList = insertedRows ?? []
  const inserted_skill_rows_count = insertedList.length

  const axisIds = [...new Set(insertedList.map((r) => r.axis_id).filter(Boolean))] as string[]
  const skillIds = [...new Set(insertedList.map((r) => r.skill_id).filter(Boolean))] as string[]
  const axisNames = new Map<string, string>()
  const skillNames = new Map<string, string>()
  if (axisIds.length > 0) {
    const { data: axes } = await supabase.from("pedagogy_axes").select("id, name").in("id", axisIds)
    ;(axes ?? []).forEach((a) => axisNames.set(a.id, a.name ?? ""))
  }
  if (skillIds.length > 0) {
    const { data: skills } = await supabase.from("pedagogy_skills").select("id, name").in("id", skillIds)
    ;(skills ?? []).forEach((s) => skillNames.set(s.id, s.name ?? ""))
  }

  const byKey = new Map<string, { axis_name: string; skill_name: string; accSum: number; count: number }>()
  for (const r of insertedList) {
    const axis_name = r.axis_id ? axisNames.get(r.axis_id) ?? "" : ""
    const skill_name = r.skill_id ? skillNames.get(r.skill_id) ?? "" : ""
    const key = `${r.axis_id}\t${r.skill_id}`
    const acc = r.accuracy != null ? Number(r.accuracy) : 0
    const cur = byKey.get(key)
    if (cur) {
      cur.accSum += acc
      cur.count += 1
    } else {
      byKey.set(key, { axis_name, skill_name, accSum: acc, count: 1 })
    }
  }
  const skills = Array.from(byKey.values()).map((v) => ({
    axis_name: v.axis_name,
    skill_name: v.skill_name,
    accuracy: v.count > 0 ? v.accSum / v.count : 0,
  }))

  if (inserted_skill_rows_count === 0 && computed_skill_rows_count > 0) {
    const catalog = await getPedagogyCatalog(subject)
    const axisIdToName = new Map<string, string>()
    const skillIdToName = new Map<string, string>()
    for (const ax of catalog.axes ?? []) {
      axisIdToName.set(ax.axis_id, ax.axis_name)
      for (const sk of ax.skills ?? []) skillIdToName.set(sk.skill_id, sk.skill_name)
    }
    for (const row of computedRows) {
      skills.push({
        axis_name: axisIdToName.get(row.axis_id) ?? row.axis_id,
        skill_name: skillIdToName.get(row.skill_id) ?? row.skill_id,
        accuracy: row.accuracy ?? 0,
      })
    }
  }

  let message: string
  if (items_count === 0) {
    message = "La evaluación no tiene evaluation_items"
  } else if (computed_skill_rows_count === 0) {
    message = "El evaluador de habilidades no produjo resultados"
  } else if (inserted_skill_rows_count === 0) {
    message = "Se calcularon habilidades pero no se insertaron"
  } else {
    message = "OK"
  }

  return NextResponse.json({
    evaluation_id: evaluationId,
    subject,
    items_count,
    computed_skill_rows_count,
    inserted_skill_rows_count,
    skills,
    message,
  })
}
