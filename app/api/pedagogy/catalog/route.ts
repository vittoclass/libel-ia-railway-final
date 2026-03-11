import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const PEDAGOGY_ENABLED = process.env.ENABLE_PEDAGOGY === "true"

/**
 * GET /api/pedagogy/catalog?subject=Lenguaje
 * Devuelve ejes y habilidades para la asignatura. Requiere ENABLE_PEDAGOGY=true.
 */
export async function GET(req: NextRequest) {
  if (!PEDAGOGY_ENABLED) {
    return NextResponse.json({ step: "config", message: "Pedagogy no habilitado" }, { status: 404 })
  }

  const subject = req.nextUrl.searchParams.get("subject")?.trim() || "Lenguaje"
  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ step: "config", message: "Supabase no configurado" }, { status: 503 })
  }

  const { data: axes, error: axesErr } = await supabase
    .from("pedagogy_axes")
    .select("id, subject, name")
    .eq("subject", subject)
    .order("name")

  if (axesErr) {
    if (process.env.NODE_ENV !== "production") console.warn("[pedagogy/catalog] axes", axesErr)
    return NextResponse.json({ step: "axes", message: axesErr.message }, { status: 500 })
  }

  const axisIds = (axes ?? []).map((a) => a.id)
  let skills: Array<{ id: string; axis_id: string; name: string }> = []
  if (axisIds.length > 0) {
    const { data: skillsData, error: skillsErr } = await supabase
      .from("pedagogy_skills")
      .select("id, axis_id, name")
      .in("axis_id", axisIds)
      .order("name")
    if (skillsErr) {
      if (process.env.NODE_ENV !== "production") console.warn("[pedagogy/catalog] skills", skillsErr)
      return NextResponse.json({ step: "skills", message: skillsErr.message }, { status: 500 })
    }
    skills = skillsData ?? []
  }

  const axesWithSkills = (axes ?? []).map((axis) => ({
    ...axis,
    skills: skills.filter((s) => s.axis_id === axis.id),
  }))

  return NextResponse.json({
    subject,
    axes: axes ?? [],
    skills,
    axesWithSkills,
  })
}
