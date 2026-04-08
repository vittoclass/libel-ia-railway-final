/**
 * PATCH /api/source-exams/[id]
 * Actualiza metadatos de la prueba base (solo el dueño: teacher_id del perfil).
 * No toca source_exam_items.
 */
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ error: "Completa tu perfil para editar pruebas base." }, { status: 403 })
  }

  const { id: sourceExamId } = await params
  if (!sourceExamId) return NextResponse.json({ error: "Falta id de prueba base" }, { status: 400 })

  let body: { title?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }

  if (typeof body.title !== "string") {
    return NextResponse.json({ error: "Se requiere title (string)" }, { status: 400 })
  }

  const title = body.title.trim() === "" ? "Sin título" : body.title.trim()

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: existing, error: fetchErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id, title")
    .eq("id", sourceExamId)
    .maybeSingle()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Prueba base no encontrada" }, { status: 404 })
  }
  if ((existing as { teacher_id: string }).teacher_id !== teacherId) {
    return NextResponse.json({ error: "Sin permiso sobre esta prueba base" }, { status: 403 })
  }

  const { data: updated, error: updateErr } = await supabase
    .from("source_exams")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", sourceExamId)
    .select("id, title, subject, course_label, exam_type, pedagogy_mode, created_at")
    .single()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json({ source_exam: updated }, { status: 200, headers: NO_STORE })
}
