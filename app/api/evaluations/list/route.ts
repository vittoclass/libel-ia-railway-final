import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV !== "production"
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) ?? ""
const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).host : "(no url)"

/**
 * GET /api/evaluations/list
 * Query: course_id, subject, status, from_date, to_date, search (título).
 * Autentica con cookies; re-lee profile desde BD.
 * Lista evaluaciones en scope seguro: por school_id del perfil; si falta school_id,
 * cae a teacher_id del perfil. Nunca lista global.
 */
export async function GET(req: NextRequest) {
  const { user } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { step: "config", message: "Supabase no configurado", details: null, ...(isDev && { debug: { school_id_used: null, supabaseHost, hasServiceRole } }) },
      { status: 503 }
    )
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, teacher_id, school_id, department")
    .eq("user_id", user.id)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json(
      {
        step: "profile",
        message: profileError.message,
        details: (profileError as { details?: string })?.details ?? null,
        ...(isDev && { debug: { school_id_used: null, supabaseHost, hasServiceRole } }),
      },
      { status: 500 }
    )
  }

  const { searchParams } = new URL(req.url)
  const courseId = searchParams.get("course_id")?.trim() || null
  const subject = searchParams.get("subject")?.trim() || null
  const statusFilter = searchParams.get("status")?.trim() || null
  const fromDate = searchParams.get("from_date")?.trim() || null
  const toDate = searchParams.get("to_date")?.trim() || null
  const search = searchParams.get("search")?.trim() || null

  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)

  const teacherIdRaw = profileRow?.teacher_id != null ? String(profileRow.teacher_id).trim() : ""
  const teacher_id_used = teacherIdRaw !== "" && isUuid(teacherIdRaw) ? teacherIdRaw : null
  const schoolIdRaw = profileRow?.school_id != null ? String(profileRow.school_id).trim() : ""
  const school_id_used = schoolIdRaw !== "" && isUuid(schoolIdRaw) ? schoolIdRaw : null
  if (!school_id_used && !teacher_id_used) {
    return NextResponse.json(
      {
        evaluations: [],
        reason: "PROFILE_NOT_ONBOARDED",
        message: "Completa tu perfil para ver evaluaciones del colegio.",
        ...(isDev && { debug: { school_id_used: null, teacher_id_used: null, rows: 0, supabaseHost, hasServiceRole } }),
      },
      { status: 200 },
    )
  }

  let query = supabase
    .from("evaluations")
    .select("id, title, course_id, course_label, subject, evaluated_at, status")
    .order("evaluated_at", { ascending: false })

  if (school_id_used) query = query.eq("school_id", school_id_used)
  else if (teacher_id_used) query = query.eq("teacher_id", teacher_id_used)

  if (courseId) query = isUuid(courseId) ? query.eq("course_id", courseId) : query.eq("course_label", courseId)
  if (subject) query = query.eq("subject", subject)
  if (statusFilter) query = query.eq("status", statusFilter)
  if (fromDate) query = query.gte("evaluated_at", fromDate)
  if (toDate) query = query.lte("evaluated_at", toDate)
  if (search) query = query.ilike("title", `%${search}%`)

  const res = await query

  if (isDev) {
    console.info("[evaluations/list][raw]", {
      school_id_used,
      teacher_id_used,
      filters: { courseId, subject, statusFilter, fromDate, toDate, search },
      error: res.error?.message ?? null,
      rows: Array.isArray(res.data) ? res.data.length : 0,
      sample: Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null,
    })
  }

  if (res.error) {
    return NextResponse.json(
      {
        step: "list",
        message: res.error.message,
        details: (res.error as { details?: string })?.details ?? null,
        ...(isDev && { debug: { school_id_used, teacher_id_used, supabaseHost, hasServiceRole } }),
      },
      { status: 500 }
    )
  }

  const list = (res.data ?? []) as Array<{ id: string; title: string | null; course_id: string | null; course_label: string | null; subject: string | null; evaluated_at: string | null; status?: string | null }>

  const ids = list.map((e) => e.id)
  let summaries: Array<{ evaluation_id: string; grade_chile: number | null }> = []
  let studentCounts: Map<string, number> = new Map()
  let firstStudentNames: Map<string, string> = new Map()
  if (ids.length > 0) {
    const sumRes = await supabase
      .from("evaluation_summaries")
      .select("evaluation_id, grade_chile")
      .in("evaluation_id", ids)
    if (sumRes.error) {
      return NextResponse.json(
        {
          step: "summaries",
          message: sumRes.error.message,
          details: (sumRes.error as { details?: string })?.details ?? null,
          ...(isDev && { debug: { school_id_used, teacher_id_used, supabaseHost, hasServiceRole } }),
        },
        { status: 500 }
      )
    }
    summaries = sumRes.data ?? []
    const studentsRes = await supabase
      .from("evaluation_students")
      .select("evaluation_id, student_name")
      .in("evaluation_id", ids)
    const studentRows = (studentsRes.data ?? []) as Array<{ evaluation_id: string; student_name: string | null }>
    const byEval = new Map<string, Array<string>>()
    studentRows.forEach((r) => {
      const name = r.student_name != null && String(r.student_name).trim() !== "" ? r.student_name : null
      if (!name) return
      if (!byEval.has(r.evaluation_id)) byEval.set(r.evaluation_id, [])
      byEval.get(r.evaluation_id)!.push(name)
    })
    byEval.forEach((names, evalId) => {
      studentCounts.set(evalId, names.length)
      const first = [...names].sort((a, b) => a.localeCompare(b))[0]
      if (first) firstStudentNames.set(evalId, first)
    })
  }

  const gradeByEval = new Map(summaries.map((s) => [s.evaluation_id, s.grade_chile]))
  const withGrade = list.map((e) => ({
    ...e,
    status: e.status ?? "draft",
    grade_chile: gradeByEval.get(e.id) ?? null,
    student_count: studentCounts.get(e.id) ?? 0,
    first_student_name: firstStudentNames.get(e.id) ?? null,
    course_display: e.course_label != null && String(e.course_label).trim() !== "" ? e.course_label : (e.course_id ?? "Sin curso"),
  }))

  if (process.env.NODE_ENV !== "production") console.info("[list] rows", withGrade.length)

  return NextResponse.json(
    {
      evaluations: withGrade,
      isAdmin: false,
      ...(isDev && { debug: { school_id_used, teacher_id_used, rows: withGrade.length, supabaseHost, hasServiceRole } }),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}
