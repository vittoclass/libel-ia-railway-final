import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)

/**
 * GET /api/evaluations/by-batch?batch_id=UUID
 * Lista evaluaciones del mismo lote (evaluations.batch_id), en el mismo alcance que /api/evaluations/list.
 */
export async function GET(req: NextRequest) {
  const { user } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const batchId = new URL(req.url).searchParams.get("batch_id")?.trim() ?? ""
  if (!isUuid(batchId)) {
    return NextResponse.json({ error: "batch_id inválido" }, { status: 400 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacherIdRaw = profileRow?.teacher_id != null ? String(profileRow.teacher_id).trim() : ""
  const teacher_id_used = teacherIdRaw !== "" && isUuid(teacherIdRaw) ? teacherIdRaw : null
  const schoolIdRaw = profileRow?.school_id != null ? String(profileRow.school_id).trim() : ""
  const school_id_used = schoolIdRaw !== "" && isUuid(schoolIdRaw) ? schoolIdRaw : null

  if (!school_id_used && !teacher_id_used) {
    return NextResponse.json({ batch_id: batchId, evaluations: [], message: "Perfil sin colegio ni profesor." })
  }

  let query = supabase
    .from("evaluations")
    .select("id, title, course_id, course_label, evaluated_at, batch_id")
    .eq("batch_id", batchId)
    .order("evaluated_at", { ascending: true })

  if (school_id_used) query = query.eq("school_id", school_id_used)
  else if (teacher_id_used) query = query.eq("teacher_id", teacher_id_used)

  const { data: rows, error } = await query
  if (error) {
    console.error("[evaluations/by-batch]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const listRaw = (rows ?? []) as Array<{
    id: string
    title: string | null
    course_id: string | null
    course_label: string | null
    evaluated_at: string | null
    batch_id: string | null
  }>

  const list = listRaw.filter((e) => e.id != null && String(e.id).trim() !== "" && isUuid(String(e.id).trim()))
  const ids = list.map((e) => e.id)

  let firstStudentNames = new Map<string, string>()
  if (ids.length > 0) {
    const studentsRes = await supabase.from("evaluation_students").select("evaluation_id, student_name").in("evaluation_id", ids)
    const studentRows = (studentsRes.data ?? []) as Array<{ evaluation_id: string; student_name: string | null }>
    const byEval = new Map<string, string[]>()
    studentRows.forEach((r) => {
      const name = r.student_name != null && String(r.student_name).trim() !== "" ? String(r.student_name).trim() : null
      if (!name) return
      if (!byEval.has(r.evaluation_id)) byEval.set(r.evaluation_id, [])
      byEval.get(r.evaluation_id)!.push(name)
    })
    byEval.forEach((names, evalId) => {
      const first = [...names].sort((a, b) => a.localeCompare(b, "es"))[0]
      if (first) firstStudentNames.set(evalId, first)
    })
  }

  const evaluations = list.map((e) => ({
    id: e.id,
    title: e.title,
    course_id: e.course_id,
    course_label: e.course_label,
    evaluated_at: e.evaluated_at,
    first_student_name: firstStudentNames.get(e.id) ?? null,
  }))

  return NextResponse.json(
    { batch_id: batchId, evaluations },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  )
}
