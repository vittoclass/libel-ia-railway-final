import { NextResponse } from "next/server"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET /api/debug/supabase-write-test
 * Prueba el guardado en Supabase sin pasar por OCR/Mistral.
 * Inserta un registro mínimo en evaluations (con teacher_id válido si existe).
 * Devuelve { ok: true } o { ok: false, error: string }.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not available in production" }, { status: 404 })
  }
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
    if (!hasServiceRole) {
      return NextResponse.json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 200 })
    }
    const supabase = getSupabaseServer()
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "getSupabaseServer() returned null" }, { status: 200 })
    }

    let school_id: string
    let teacher_id: string

    const { data: teachers } = await supabase.from("teachers").select("id, school_id").limit(1)
    const first = Array.isArray(teachers) ? teachers[0] : null
    if (first?.id && first?.school_id) {
      teacher_id = first.id
      school_id = first.school_id
    } else {
      const { data: newSchool, error: schoolErr } = await supabase
        .from("schools")
        .insert({ name: "Test escuela debug" })
        .select("id")
        .single()
      if (schoolErr || !newSchool?.id) {
        return NextResponse.json({ ok: false, error: "No schools table or insert failed: " + (schoolErr?.message ?? "no id") }, { status: 200 })
      }
      school_id = newSchool.id
      const { data: newTeacher, error: teacherErr } = await supabase
        .from("teachers")
        .insert({ school_id, name: "Test profesor debug" })
        .select("id")
        .single()
      if (teacherErr || !newTeacher?.id) {
        return NextResponse.json({ ok: false, error: "No teachers table or insert failed: " + (teacherErr?.message ?? "no id") }, { status: 200 })
      }
      teacher_id = newTeacher.id
    }

    const { data: row, error } = await supabase
      .from("evaluations")
      .insert({
        school_id,
        teacher_id,
        course_id: "Sin curso",
        title: "Test write debug",
        subject: "Sin asignatura",
        evaluated_at: new Date().toISOString(),
        status: "draft",
      })
      .select("id")
      .single()

    if (error || !row?.id) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "Insert evaluations failed (no id)" },
        { status: 200 }
      )
    }

    return NextResponse.json({ ok: true, evaluation_id: row.id }, { status: 200 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 200 })
  }
}
