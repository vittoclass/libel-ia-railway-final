/**
 * GET /api/students/[id]/history
 * Perfil del estudiante: datos básicos, evaluaciones, habilidades, resumen.
 * id = student_profile.id. Mismo patrón de auth que /api/students/list (getAuthUser + SELECT profiles).
 * Siempre devuelve shape mínimo útil; vacíos si no hay datos.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: studentProfileId } = await params
  if (!studentProfileId) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 })
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

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  const teacherId = profileRow?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ error: "Completa tu perfil (teacher_id)" }, { status: 403 })
  }

  const { data: student, error: studentErr } = await supabase
    .from("student_profiles")
    .select("id, student_name, course_label")
    .eq("id", studentProfileId)
    .eq("teacher_id", teacherId)
    .maybeSingle()

  if (studentErr || !student) {
    return NextResponse.json(
      { error: studentErr?.message ?? "Estudiante no encontrado" },
      { status: student ? 500 : 404 }
    )
  }

  const { data: esRows } = await supabase
    .from("evaluation_students")
    .select("evaluation_id")
    .eq("student_profile_id", studentProfileId)

  const evaluationIds = [...new Set((esRows ?? []).map((r) => r.evaluation_id).filter(Boolean))] as string[]

  let evaluations: Array<{ evaluation_id: string; title: string | null; subject: string | null; evaluated_at: string | null; score: number | null }> = []

  if (evaluationIds.length > 0) {
    const { data: evals } = await supabase
      .from("evaluations")
      .select("id, title, subject, evaluated_at")
      .in("id", evaluationIds)
      .order("evaluated_at", { ascending: true })

    const { data: summaries } = await supabase
      .from("evaluation_summaries")
      .select("evaluation_id, grade_chile")
      .in("evaluation_id", evaluationIds)

    const gradeByEval = new Map((summaries ?? []).map((s) => [s.evaluation_id, s.grade_chile]))
    evaluations = (evals ?? []).map((e) => ({
      evaluation_id: e.id,
      title: e.title,
      subject: e.subject,
      evaluated_at: e.evaluated_at,
      score: gradeByEval.get(e.id) != null ? Number(gradeByEval.get(e.id)) : null,
    }))
  }

  const { data: skillResults } = await supabase
    .from("evaluation_skill_results")
    .select("skill_id, axis_id, accuracy, score_obtained, score_max")
    .eq("student_profile_id", studentProfileId)

  const skillIds = [...new Set((skillResults ?? []).map((r) => r.skill_id).filter(Boolean))] as string[]
  const axisIds = [...new Set((skillResults ?? []).map((r) => r.axis_id).filter(Boolean))] as string[]

  const bySkillAcc = new Map<string, number[]>()
  for (const r of skillResults ?? []) {
    if (!r.skill_id) continue
    const acc = r.accuracy ?? (r.score_max && r.score_obtained != null ? Number(r.score_obtained) / Number(r.score_max) : null)
    if (acc == null) continue
    if (!bySkillAcc.has(r.skill_id)) bySkillAcc.set(r.skill_id, [])
    bySkillAcc.get(r.skill_id)!.push(acc)
  }

  let skillIdToAxisId = new Map<string, string>()
  let skillIdToName = new Map<string, string>()
  let axisIdToName = new Map<string, string>()

  if (skillIds.length > 0) {
    const { data: skillRows } = await supabase.from("pedagogy_skills").select("id, name, axis_id").in("id", skillIds)
    ;(skillRows ?? []).forEach((s) => {
      if (s.axis_id) skillIdToAxisId.set(s.id, s.axis_id)
      skillIdToName.set(s.id, s.name ?? "")
    })
  }
  if (axisIds.length > 0) {
    const { data: axisRows } = await supabase.from("pedagogy_axes").select("id, name").in("id", axisIds)
    ;(axisRows ?? []).forEach((a) => { axisIdToName.set(a.id, a.name ?? "") })
  }

  const skills = [...bySkillAcc.entries()].map(([skillId, accs]) => {
    const axisId = skillIdToAxisId.get(skillId)
    const axis_name = axisId ? axisIdToName.get(axisId) ?? "" : ""
    const skill_name = skillIdToName.get(skillId) ?? skillId
    const accuracy = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0
    return { axis_name, skill_name, accuracy }
  })

  const scores = evaluations.map((e) => e.score).filter((s): s is number => s != null && typeof s === "number")
  const average_grade = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  const roundedAvg = average_grade != null ? Math.round(average_grade * 10) / 10 : null

  const skillsSorted = [...skills].sort((a, b) => b.accuracy - a.accuracy)
  const strongest_skill = skillsSorted.length > 0 ? skillsSorted[0].skill_name : null
  const weakest_skill = skillsSorted.length > 0 ? skillsSorted[skillsSorted.length - 1].skill_name : null

  return NextResponse.json({
    student: {
      id: student.id,
      student_name: student.student_name,
      course_label: student.course_label,
    },
    evaluations,
    skills,
    summary: {
      average_grade: roundedAvg,
      strongest_skill,
      weakest_skill,
    },
  })
}
