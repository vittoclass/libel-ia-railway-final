// app/api/profile/onboarding/route.ts
// POST: completar perfil (nombre profesor, colegio, departamento). Crea/usa school y teacher, actualiza profile.
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { DEFAULT_PROFILE_ROLE } from "@/app/lib/profile-defaults"
import { resolvePilotSchool } from "@/app/lib/pilot-school"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  let body: { full_name?: string; school_name?: string; department?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
  }

  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : ""
  const schoolName = typeof body.school_name === "string" ? body.school_name.trim() : ""
  const department = typeof body.department === "string" ? body.department.trim() || null : null

  if (!fullName) {
    return NextResponse.json({ error: "El nombre del profesor es obligatorio" }, { status: 400 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const pilot = await resolvePilotSchool(supabase)

  let schoolId: string
  if (pilot) {
    schoolId = pilot.id
  } else {
    if (!schoolName) {
      return NextResponse.json(
        { error: "Nombre del profesor y nombre del colegio son obligatorios" },
        { status: 400 }
      )
    }
    const { data: existingSchool } = await supabase
      .from("schools")
      .select("id")
      .ilike("name", schoolName)
      .limit(1)
      .maybeSingle()

    if (existingSchool?.id) {
      schoolId = existingSchool.id
    } else {
      const { data: newSchool, error: schoolErr } = await supabase
        .from("schools")
        .insert({ name: schoolName })
        .select("id")
        .single()
      if (schoolErr || !newSchool?.id) {
        return NextResponse.json(
          { error: "No se pudo crear el colegio: " + (schoolErr?.message ?? "unknown") },
          { status: 500 }
        )
      }
      schoolId = newSchool.id
    }
  }

  const { data: existingTeacher } = await supabase
    .from("teachers")
    .select("id")
    .eq("school_id", schoolId)
    .eq("name", fullName)
    .limit(1)
    .maybeSingle()

  let teacherId: string
  if (existingTeacher?.id) {
    teacherId = existingTeacher.id
  } else {
    const { data: newTeacher, error: teacherErr } = await supabase
      .from("teachers")
      .insert({ school_id: schoolId, name: fullName })
      .select("id")
      .single()

    if (teacherErr || !newTeacher?.id) {
      return NextResponse.json(
        { error: "No se pudo crear el profesor: " + (teacherErr?.message ?? "unknown") },
        { status: 500 }
      )
    }
    teacherId = newTeacher.id
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle()
  const role =
    existingProfile != null && typeof (existingProfile as { role?: string }).role === "string"
      ? (existingProfile as { role: string }).role
      : DEFAULT_PROFILE_ROLE

  const { error: profileErr } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      teacher_id: teacherId,
      school_id: schoolId,
      department,
      role,
    },
    { onConflict: "user_id" }
  )

  if (profileErr) {
    return NextResponse.json(
      { error: "No se pudo guardar el perfil: " + profileErr.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    teacher_id: teacherId,
    school_id: schoolId,
    message: "Perfil completado. Ya puedes guardar evaluaciones.",
  })
}
