import { NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * POST /api/debug/evaluations/relink-to-profile
 * Solo NODE_ENV=development.
 * teacher_id_actual = profile.teacher_id del usuario logueado.
 * teacher_id_candidato = teacher_id más frecuente en evaluations distinto al actual.
 * UPDATE evaluations SET teacher_id = teacher_id_actual WHERE teacher_id = teacher_id_candidato.
 * Devuelve { ok, teacher_id_actual, teacher_id_candidato, updatedCount }.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  const { user, profile } = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacher_id_actual = profileRow?.teacher_id ?? profile?.teacher_id ?? null
  if (!teacher_id_actual) {
    return NextResponse.json(
      { ok: false, message: "Perfil sin teacher_id" },
      { status: 400 }
    )
  }

  const { data: allEvals } = await supabase.from("evaluations").select("teacher_id")
  const countByTeacherId: Record<string, number> = {}
  for (const row of allEvals ?? []) {
    const tid = row.teacher_id
    if (tid) {
      countByTeacherId[tid] = (countByTeacherId[tid] ?? 0) + 1
    }
  }

  const entries = Object.entries(countByTeacherId).filter(
    ([tid]) => tid !== teacher_id_actual
  )
  if (entries.length === 0) {
    return NextResponse.json({
      ok: false,
      teacher_id_actual,
      teacher_id_candidato: null,
      updatedCount: 0,
      message: "No hay evaluaciones con otro teacher_id para vincular",
    })
  }

  entries.sort((a, b) => b[1] - a[1])
  const teacher_id_candidato = entries[0][0]
  const countCandidate = entries[0][1]
  if (countCandidate === 0) {
    return NextResponse.json({
      ok: false,
      teacher_id_actual,
      teacher_id_candidato,
      updatedCount: 0,
      message: "No hay evaluaciones para vincular",
    })
  }

  const { data, error } = await supabase
    .from("evaluations")
    .update({ teacher_id: teacher_id_actual })
    .eq("teacher_id", teacher_id_candidato)
    .select("id")

  if (error) {
    return NextResponse.json(
      { ok: false, step: "update", message: error.message },
      { status: 500 }
    )
  }

  const updatedCount = Array.isArray(data) ? data.length : 0
  return NextResponse.json({
    ok: true,
    teacher_id_actual,
    teacher_id_candidato,
    updatedCount,
  })
}
