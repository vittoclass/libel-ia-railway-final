import { NextResponse } from "next/server"
import { defaultAcademicYear } from "@/app/lib/docente/academic-defaults"
import { getAuthUser, getSupabaseRouteClient } from "@/app/lib/supabase-route"

export const dynamic = "force-dynamic"

export type TeacherAssignmentRow = {
  id: string
  school_id: string
  teacher_id: string
  academic_year: number
  semester: string
  subject: string
  course_label: string
  course_id: string | null
  weekly_hours: number | null
  is_active: boolean
}

/**
 * GET — Asignaciones activas del docente (RLS + filtro por año; fallback sin año si no hay filas).
 * Tabla teacher_assignments (PASO A). Si no existe aún en BD, devuelve [].
 */
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = await getSupabaseRouteClient()
  const year = defaultAcademicYear()

  let rows: TeacherAssignmentRow[] = []
  let warning: string | null = null

  const run = async (filterYear: boolean) => {
    let q = supabase
      .from("teacher_assignments")
      .select(
        "id, school_id, teacher_id, academic_year, semester, subject, course_label, course_id, weekly_hours, is_active",
      )
      .eq("is_active", true)
      .order("semester", { ascending: true })
      .order("subject", { ascending: true })

    if (filterYear) q = q.eq("academic_year", year)

    const { data, error } = await q
    if (error) {
      if (error.message.includes("does not exist") || error.code === "42P01") {
        warning = "Tabla teacher_assignments no aplicada aún; ejecute la migración PASO A."
        return []
      }
      throw new Error(error.message)
    }
    return (data ?? []) as TeacherAssignmentRow[]
  }

  try {
    rows = await run(true)
    if (rows.length === 0) {
      rows = await run(false)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg, assignments: [] }, { status: 500 })
  }

  return NextResponse.json({
    assignments: rows,
    academic_year_default: year,
    warning,
  })
}
