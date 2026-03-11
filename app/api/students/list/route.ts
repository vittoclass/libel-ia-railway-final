/**
 * GET /api/students/list
 * Lista estudiantes desde student_profiles (teacher_id del perfil).
 * Fuente principal: student_profiles where teacher_id = profile.teacher_id.
 * Agregados (evaluations_count, avg_score) se calculan en memoria en segunda etapa.
 * No depende de joins para que existan filas.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV !== "production"

export async function GET(req: NextRequest) {
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
    if (isDev) console.info("[students/list] teacher_id null, returning []")
    return NextResponse.json(
      { students: [], message: "Completa tu perfil para ver estudiantes." },
      { status: 200 }
    )
  }

  if (isDev) console.info("[students/list] teacher_id", teacherId)

  const courseLabel = req.nextUrl.searchParams.get("course_label")?.trim() || null
  const search = req.nextUrl.searchParams.get("search")?.trim() || null

  let query = supabase
    .from("student_profiles")
    .select("id, student_name, course_label")
    .eq("teacher_id", teacherId)
    .order("student_name", { ascending: true })

  if (courseLabel) query = query.eq("course_label", courseLabel)
  if (search) query = query.or(`student_name.ilike.%${search}%,student_normalized.ilike.%${search}%`)

  const { data: profiles, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const list = (profiles ?? []) as Array<{ id: string; student_name: string; course_label: string | null }>

  if (isDev) console.info("[students/list] profiles found", list.length)

  if (list.length === 0) {
    return NextResponse.json(
      {
        students: [],
        ...(isDev && { debug: { teacher_id: teacherId, profiles_count: 0, eval_students_count: 0, summaries_count: 0 } }),
      },
      { status: 200 }
    )
  }

  const profileIds = list.map((p) => p.id)

  const { data: evalStudents, error: esErr } = await supabase
    .from("evaluation_students")
    .select("evaluation_id, student_profile_id")
    .in("student_profile_id", profileIds)

  if (esErr) {
    return NextResponse.json({ error: esErr.message }, { status: 500 })
  }

  const esRows = (evalStudents ?? []) as Array<{ evaluation_id: string; student_profile_id: string }>
  if (isDev) console.info("[students/list] evaluation_students rows", esRows.length)

  const evalIdsByProfile = new Map<string, string[]>()
  for (const row of esRows) {
    const pid = row.student_profile_id
    if (!pid) continue
    if (!evalIdsByProfile.has(pid)) evalIdsByProfile.set(pid, [])
    if (row.evaluation_id) evalIdsByProfile.get(pid)!.push(row.evaluation_id)
  }

  const evaluationCounts = new Map<string, number>()
  for (const pid of profileIds) {
    const evalIds = evalIdsByProfile.get(pid) ?? []
    evaluationCounts.set(pid, [...new Set(evalIds)].length)
  }

  const allEvalIds = [...new Set(esRows.map((r) => r.evaluation_id).filter(Boolean))] as string[]
  const avgScores = new Map<string, number>()
  let summariesCount = 0

  if (allEvalIds.length > 0) {
    const { data: summaries, error: sumErr } = await supabase
      .from("evaluation_summaries")
      .select("evaluation_id, grade_chile")
      .in("evaluation_id", allEvalIds)

    summariesCount = (summaries ?? []).length
    if (isDev) console.info("[students/list] summaries rows", summariesCount)

    if (!sumErr && summaries?.length) {
      const gradeByEval = new Map((summaries as Array<{ evaluation_id: string; grade_chile: number | null }>).map((s) => [s.evaluation_id, s.grade_chile]))
      evalIdsByProfile.forEach((evalIds, pid) => {
        const uniq = [...new Set(evalIds)]
        const grades = uniq
          .map((eid) => gradeByEval.get(eid))
          .filter((g): g is number => g != null && typeof g === "number")
        if (grades.length > 0) {
          avgScores.set(pid, grades.reduce((a, b) => a + b, 0) / grades.length)
        }
      })
    }
  } else if (isDev) {
    console.info("[students/list] summaries rows", 0)
  }

  const students = list.map((p) => ({
    id: p.id,
    student_name: p.student_name,
    course_label: p.course_label,
    evaluations_count: evaluationCounts.get(p.id) ?? 0,
    avg_score: avgScores.has(p.id) ? avgScores.get(p.id)! : null,
  }))

  return NextResponse.json({
    students,
    ...(isDev && {
      debug: {
        teacher_id: teacherId,
        profiles_count: list.length,
        eval_students_count: esRows.length,
        summaries_count: summariesCount,
      },
    }),
  })
}
