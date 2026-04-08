/**
 * GET/POST /api/source-exams
 * Capa aditiva: solo listar y crear pruebas base (source_exam). No toca evaluations ni /api/evaluate.
 * Autenticación por perfil (teacher_id). Lista por teacher_id; POST crea con teacher_id del perfil.
 */
import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

export async function GET() {
  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json(
      { source_exams: [], message: "Completa tu perfil para ver pruebas base." },
      { status: 200 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data, error } = await supabase
    .from("source_exams")
    .select("id, title, subject, course_label, exam_type, pedagogy_mode, created_at")
    .eq("teacher_id", teacherId)
    .or("is_archived.is.null,is_archived.eq.false")
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(
    { source_exams: data ?? [] },
    { status: 200, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" } },
  )
}

export async function POST(req: NextRequest) {
  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json(
      { error: "Completa tu perfil para crear pruebas base." },
      { status: 403 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  let body: { title?: string; subject?: string; course_label?: string; exam_type?: string; pedagogy_mode?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }

  const title = typeof body.title === "string" ? body.title.trim() || null : null
  const subject = typeof body.subject === "string" ? body.subject.trim() || null : null
  const course_label = typeof body.course_label === "string" ? body.course_label.trim() || null : null
  const exam_type = typeof body.exam_type === "string" ? body.exam_type.trim() || null : null
  const pedagogy_mode = typeof body.pedagogy_mode === "string" ? body.pedagogy_mode.trim() || null : null

  const { data: inserted, error: insertErr } = await supabase
    .from("source_exams")
    .insert({
      teacher_id: teacherId,
      school_id: profile?.school_id ?? null,
      title: title ?? "Sin título",
      subject,
      course_label,
      exam_type,
      pedagogy_mode,
    })
    .select("id, title, subject, course_label, exam_type, pedagogy_mode, created_at")
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
  return NextResponse.json({ source_exam: inserted }, { status: 201 })
}
