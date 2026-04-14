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

  const MAX_SUBJECT_LEN = 120

  let body: { title?: unknown; subject?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }

  const titleString = typeof body.title === "string" ? body.title : undefined
  const hasTitle = titleString !== undefined
  const hasSubject = "subject" in body
  if (!hasTitle && !hasSubject) {
    return NextResponse.json(
      { error: "Envíe title (string) y/o subject (string o null)" },
      { status: 400 },
    )
  }

  if (hasSubject && body.subject !== null && typeof body.subject !== "string") {
    return NextResponse.json({ error: "subject debe ser string o null" }, { status: 400 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: existing, error: fetchErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id, title, subject")
    .eq("id", sourceExamId)
    .maybeSingle()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Prueba base no encontrada" }, { status: 404 })
  }
  if ((existing as { teacher_id: string }).teacher_id !== teacherId) {
    return NextResponse.json({ error: "Sin permiso sobre esta prueba base" }, { status: 403 })
  }

  const ex = existing as { title?: string | null; subject?: string | null }

  const title = hasTitle
    ? titleString.trim() === ""
      ? "Sin título"
      : titleString.trim()
    : (typeof ex.title === "string" && ex.title.trim() ? ex.title.trim() : "Sin título")

  let subject: string | null
  if (hasSubject) {
    if (body.subject === null) {
      subject = null
    } else if (typeof body.subject === "string") {
      const t = body.subject.trim()
      subject = t.length === 0 ? null : t.slice(0, MAX_SUBJECT_LEN)
    } else {
      return NextResponse.json({ error: "subject debe ser string o null" }, { status: 400 })
    }
  } else {
    subject = typeof ex.subject === "string" && ex.subject.trim() ? ex.subject.trim() : null
  }

  const { data: updated, error: updateErr } = await supabase
    .from("source_exams")
    .update({ title, subject, updated_at: new Date().toISOString() })
    .eq("id", sourceExamId)
    .select("id, title, subject, course_label, exam_type, pedagogy_mode, created_at")
    .single()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json({ source_exam: updated }, { status: 200, headers: NO_STORE })
}
