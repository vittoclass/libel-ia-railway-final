import { NextResponse } from "next/server"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * POST /api/debug/pedagogy/seed
 * Solo desarrollo. Inserta seed mínimo: Lenguaje - Comprensión lectora + 2 habilidades.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ step: "config", message: "Not available in production" }, { status: 404 })
  }
  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ step: "config", message: "Supabase no configurado" }, { status: 503 })
  }

  const { data: existing } = await supabase
    .from("pedagogy_axes")
    .select("id")
    .eq("subject", "Lenguaje")
    .eq("name", "Comprensión lectora")
    .maybeSingle()

  let axisId = existing?.id
  if (!axisId) {
    const { data: inserted, error: e1 } = await supabase
      .from("pedagogy_axes")
      .insert({ subject: "Lenguaje", name: "Comprensión lectora" })
      .select("id")
      .single()
    if (e1) return NextResponse.json({ step: "axis", message: e1.message }, { status: 500 })
    axisId = inserted?.id
  }

  if (!axisId) return NextResponse.json({ step: "axis", message: "No axis id" }, { status: 500 })

  for (const name of ["Localizar información", "Inferir información", "Interpretar", "Argumentar"]) {
    const { error: e2 } = await supabase
      .from("pedagogy_skills")
      .upsert({ axis_id: axisId, name }, { onConflict: "axis_id,name" })
    if (e2) return NextResponse.json({ step: "skill", message: e2.message }, { status: 500 })
  }

  const { data: existingEscritura } = await supabase
    .from("pedagogy_axes")
    .select("id")
    .eq("subject", "Lenguaje")
    .eq("name", "Escritura")
    .maybeSingle()
  let escrituraId = existingEscritura?.id
  if (!escrituraId) {
    const { data: ins, error: eEsc } = await supabase
      .from("pedagogy_axes")
      .insert({ subject: "Lenguaje", name: "Escritura" })
      .select("id")
      .single()
    if (eEsc) return NextResponse.json({ step: "axis_escritura", message: eEsc.message }, { status: 500 })
    escrituraId = ins?.id
  }
  if (escrituraId) {
    for (const name of ["Producir textos", "Coherencia y cohesión"]) {
      await supabase.from("pedagogy_skills").upsert({ axis_id: escrituraId, name }, { onConflict: "axis_id,name" })
    }
  }

  return NextResponse.json({ ok: true, message: "Seed aplicado (Lenguaje: Comprensión lectora + Escritura)" })
}
