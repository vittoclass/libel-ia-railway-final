/**
 * GET /api/courses/[courseId]/diagnosis
 * Diagnóstico pedagógico del curso: datos derivados de las evaluaciones del profesor,
 * no solo de student_profiles.course_label. Así se alinean "8°C", "8 C", etc.
 * courseId = course_label (URL-encoded). Requiere sesión.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { normalizeCourseLabel } from "@/app/lib/course-utils"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV !== "production"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const rawCourse = (await params).courseId
  if (!rawCourse) {
    return NextResponse.json({ error: "courseId requerido" }, { status: 400 })
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

  const requested_course_label =
    rawCourse === "_" || rawCourse === "Sin%20curso" ? "Sin curso" : decodeURIComponent(rawCourse)
  const normalized_requested_course_label = normalizeCourseLabel(requested_course_label)

  // C. Evaluaciones del profesor; filtrar en memoria por course_label normalizado
  const { data: evaluations, error: evErr } = await supabase
    .from("evaluations")
    .select("id, course_label")
    .eq("teacher_id", teacherId)

  if (evErr) {
    return NextResponse.json({ error: evErr.message }, { status: 500 })
  }

  const evaluationIds = (evaluations ?? [])
    .filter((e) => normalizeCourseLabel(e.course_label) === normalized_requested_course_label)
    .map((e) => e.id)
    .filter(Boolean) as string[]
  const matched_evaluations_count = evaluationIds.length

  // D. evaluation_students para esas evaluaciones → students_count y evaluations_count
  let students_count = 0
  let profileIds: string[] = []
  let evaluations_count = matched_evaluations_count

  if (evaluationIds.length > 0) {
    const { data: esRows } = await supabase
      .from("evaluation_students")
      .select("evaluation_id, student_profile_id")
      .in("evaluation_id", evaluationIds)

    const rows = esRows ?? []
    evaluations_count = new Set(rows.map((r) => r.evaluation_id).filter(Boolean)).size
    profileIds = [...new Set(rows.map((r) => r.student_profile_id).filter(Boolean))] as string[]
    students_count = profileIds.length
  }

  const course_label = requested_course_label
  const emptyPayload = () => ({
    course_label,
    students_count,
    evaluations_count,
    axes: [] as Array<{ axis_name: string; accuracy: number }>,
    skills: [] as Array<{ skill_name: string; axis_name: string; accuracy: number }>,
    strongest_skill: null as string | null,
    weakest_skill: null as string | null,
    summary: { strongest_axis: null as string | null, weakest_axis: null as string | null },
    ...(isDev && {
      debug: {
        requested_course_label,
        normalized_requested_course_label,
        matched_evaluations_count,
        matched_student_profiles_count: students_count,
      },
    }),
  })

  if (profileIds.length === 0) {
    return NextResponse.json(emptyPayload())
  }

  // E. evaluation_skill_results para esos student_profile_id
  const { data: results, error: resErr } = await supabase
    .from("evaluation_skill_results")
    .select("axis_id, skill_id, accuracy, score_obtained, score_max")
    .in("student_profile_id", profileIds)

  if (resErr) {
    return NextResponse.json({ error: resErr.message }, { status: 500 })
  }

  const rows = (results ?? []) as Array<{
    axis_id: string | null
    skill_id: string | null
    accuracy: number | null
    score_obtained?: number | null
    score_max?: number | null
  }>

  const axisAccs = new Map<string, number[]>()
  const skillAccs = new Map<string, number[]>()
  const axisIds = new Set<string>()
  const skillIds = new Set<string>()

  for (const r of rows) {
    const acc =
      r.accuracy ??
      (r.score_max && r.score_obtained != null ? Number(r.score_obtained) / Number(r.score_max) : null)
    if (acc == null) continue
    if (r.axis_id) {
      axisIds.add(r.axis_id)
      if (!axisAccs.has(r.axis_id)) axisAccs.set(r.axis_id, [])
      axisAccs.get(r.axis_id)!.push(acc)
    }
    if (r.skill_id) {
      skillIds.add(r.skill_id)
      if (!skillAccs.has(r.skill_id)) skillAccs.set(r.skill_id, [])
      skillAccs.get(r.skill_id)!.push(acc)
    }
  }

  let axisNames = new Map<string, string>()
  const skillIdToAxisId = new Map<string, string>()
  const skillNames = new Map<string, string>()
  if (axisIds.size > 0) {
    const { data: axes } = await supabase.from("pedagogy_axes").select("id, name").in("id", [...axisIds])
    ;(axes ?? []).forEach((a) => {
      axisNames.set(a.id, a.name ?? "")
    })
  }
  if (skillIds.size > 0) {
    const { data: skills } = await supabase
      .from("pedagogy_skills")
      .select("id, name, axis_id")
      .in("id", [...skillIds])
    ;(skills ?? []).forEach((s) => {
      skillNames.set(s.id, s.name ?? "")
      if (s.axis_id) skillIdToAxisId.set(s.id, s.axis_id)
    })
  }

  const axes = [...axisAccs.entries()].map(([id, accs]) => ({
    axis_name: axisNames.get(id) ?? id,
    accuracy: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0,
  }))

  const skills = [...skillAccs.entries()].map(([id, accs]) => {
    const axisId = skillIdToAxisId.get(id)
    const axis_name = axisId ? axisNames.get(axisId) ?? "" : ""
    return {
      skill_name: skillNames.get(id) ?? id,
      axis_name,
      accuracy: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0,
    }
  })

  const sortedSkills = [...skills].sort((a, b) => a.accuracy - b.accuracy)
  const weakest_skill = sortedSkills.length > 0 ? sortedSkills[0].skill_name : null
  const strongest_skill = sortedSkills.length > 0 ? sortedSkills[sortedSkills.length - 1].skill_name : null

  const sortedAxes = [...axes].sort((a, b) => a.accuracy - b.accuracy)
  const weakest_axis = sortedAxes.length > 0 ? sortedAxes[0].axis_name : null
  const strongest_axis = sortedAxes.length > 0 ? sortedAxes[sortedAxes.length - 1].axis_name : null

  return NextResponse.json({
    course_label,
    students_count,
    evaluations_count,
    axes,
    skills,
    strongest_skill,
    weakest_skill,
    summary: { strongest_axis, weakest_axis },
    ...(isDev && {
      debug: {
        requested_course_label,
        normalized_requested_course_label,
        matched_evaluations_count,
        matched_student_profiles_count: students_count,
      },
    }),
  })
}
