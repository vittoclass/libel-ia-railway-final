import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV !== "production"

/**
 * POST /api/profile/onboard
 * Requiere: public.profiles (user_id unique, teacher_id, school_id, department, role), schools(id, name), teachers(id, school_id, name).
 * Body: { teacherName | teacher_name, schoolName | school_name, department }
 * Asegura perfil con getOrCreateProfile; busca/crea school y teacher; actualiza profiles con teacher_id/school_id/department.
 */
export async function POST(req: NextRequest) {
  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { step: "internal", error: "Supabase no configurado" },
      { status: 503 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { step: "internal", error: "Body inválido" },
      { status: 400 }
    )
  }

  const teacherName =
    (typeof body?.teacherName === "string" ? body.teacherName : body?.teacher_name) as string | undefined
  const schoolName =
    (typeof body?.schoolName === "string" ? body.schoolName : body?.school_name) as string | undefined
  const department =
    typeof body?.department === "string" ? body.department.trim() || null : null

  const tName = typeof teacherName === "string" ? teacherName.trim() : ""
  const sName = typeof schoolName === "string" ? schoolName.trim() : ""

  if (!tName || !sName) {
    return NextResponse.json(
      { step: "internal", error: "teacherName y schoolName son requeridos" },
      { status: 400 }
    )
  }

  try {
    // 1) Buscar o crear school por name
    const { data: existingSchool } = await supabase
      .from("schools")
      .select("id")
      .eq("name", sName)
      .limit(1)
      .maybeSingle()

    let schoolId: string
    if (existingSchool?.id) {
      schoolId = existingSchool.id
    } else {
      const { data: newSchool, error: schoolErr } = await supabase
        .from("schools")
        .insert({ name: sName })
        .select("id")
        .single()
      if (schoolErr || !newSchool?.id) {
        return NextResponse.json(
          { step: "school", error: schoolErr?.message ?? "Error al crear escuela" },
          { status: 500 }
        );
      }
      schoolId = newSchool.id
    }

    // 2) Buscar o crear teacher por (school_id, name)
    const { data: existingTeacher } = await supabase
      .from("teachers")
      .select("id, school_id")
      .eq("school_id", schoolId)
      .eq("name", tName)
      .limit(1)
      .maybeSingle()

    let teacherId: string
    if (existingTeacher?.id) {
      teacherId = existingTeacher.id
    } else {
      const { data: newTeacher, error: teacherErr } = await supabase
        .from("teachers")
        .insert({ school_id: schoolId, name: tName })
        .select("id")
        .single()
      if (teacherErr || !newTeacher?.id) {
        return NextResponse.json(
          { step: "teacher", error: teacherErr?.message ?? "Error al crear profesor" },
          { status: 500 }
        );
      }
      teacherId = newTeacher.id
    }

    if (isDev) {
      console.info("[onboard] schoolId", schoolId, "teacherId", teacherId)
    }

    // 3) UPSERT profiles: update teacher_id, school_id, department (conflict user_id)
    const { error: profileErr } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: user.id,
          teacher_id: teacherId,
          school_id: schoolId,
          department,
          ...(profile?.role != null ? { role: profile.role } : {}),
        },
        { onConflict: "user_id" }
      )

    if (profileErr) {
      return NextResponse.json(
        { step: "profile", error: profileErr.message ?? "Error al guardar perfil" },
        { status: 500 }
      )
    }

    const { data: updatedProfile, error: selectErr } = await supabase
      .from("profiles")
      .select("user_id, teacher_id, school_id, department")
      .eq("user_id", user.id)
      .maybeSingle()

    if (isDev) {
      console.info("[onboard] user_id", user.id, "teacher_id", updatedProfile?.teacher_id ?? teacherId, "school_id", updatedProfile?.school_id ?? schoolId)
    }

    const finalRow = updatedProfile ?? {
      user_id: user.id,
      teacher_id: teacherId,
      school_id: schoolId,
      department,
      role: profile?.role ?? "teacher",
    }

    return NextResponse.json(
      {
        ok: true,
        success: true,
        profile: {
          id: null,
          user_id: finalRow.user_id,
          teacher_id: finalRow.teacher_id,
          school_id: finalRow.school_id,
          department: finalRow.department ?? null,
          role: (finalRow as { role?: string }).role ?? "teacher",
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error interno";
    if (isDev) console.error("[onboard]", e);
    return NextResponse.json(
      { step: "internal", error: message },
      { status: 500 }
    );
  }
}
