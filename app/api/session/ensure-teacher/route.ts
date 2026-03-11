import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServer, isSupabaseConfigured } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * POST /api/session/ensure-teacher
 * Body: { name: string }
 * Crea escuela (si no existe) y profesor, o devuelve los ids para usar en localStorage.
 * Sesión MVP: el frontend guarda school_id y teacher_id en localStorage y los envía en cada evaluación.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "Supabase no configurado" },
      { status: 503 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Error al conectar con Supabase" },
      { status: 503 }
    )
  }

  let body: { name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Body JSON inválido" },
      { status: 400 }
    )
  }

  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name) {
    return NextResponse.json(
      { success: false, error: "Falta 'name' (nombre del profesor)" },
      { status: 400 }
    )
  }

  try {
    // Crear escuela por defecto para este profesor (una escuela por profesor en MVP)
    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .insert({ name: `Escuela de ${name}` })
      .select("id")
      .single()

    if (schoolError || !school?.id) {
      console.error("[ensure-teacher] Error creando school:", schoolError)
      return NextResponse.json(
        { success: false, error: schoolError?.message ?? "Error creando escuela" },
        { status: 500 }
      )
    }

    const { data: teacher, error: teacherError } = await supabase
      .from("teachers")
      .insert({ school_id: school.id, name })
      .select("id, school_id")
      .single()

    if (teacherError || !teacher?.id) {
      console.error("[ensure-teacher] Error creando teacher:", teacherError)
      return NextResponse.json(
        { success: false, error: teacherError?.message ?? "Error creando profesor" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      school_id: teacher.school_id,
      teacher_id: teacher.id,
    })
  } catch (e) {
    console.error("[ensure-teacher] Error:", e)
    return NextResponse.json(
      { success: false, error: "Error interno" },
      { status: 500 }
    )
  }
}
