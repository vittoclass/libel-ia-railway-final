import { NextRequest, NextResponse } from "next/server"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { upsertStudentProjectionFromEvaluation } from "@/app/lib/student-projection-upsert"

export const dynamic = "force-dynamic"

type RequestBody = {
  evaluation_id?: string
  student_id?: string | null
  year?: number
  grade_level?: string
  subject?: string
  paes_application?: "REGULAR" | "INVIERNO"
  paes_subject?: string
}

export async function POST(req: NextRequest) {
  const { user, profile } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ step: "auth", message: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ step: "config", message: "Supabase no configurado" }, { status: 503 })

  let body: RequestBody = {}
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ step: "validation", message: "Body JSON inválido" }, { status: 400 })
  }

  const evaluationId = String(body.evaluation_id ?? "").trim()
  if (!evaluationId) {
    return NextResponse.json({ step: "validation", message: "evaluation_id es requerido" }, { status: 400 })
  }

  const teacherId = profile?.teacher_id ?? null
  if (!teacherId) {
    return NextResponse.json({ step: "profile", message: "Perfil incompleto (teacher_id)" }, { status: 403 })
  }

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, teacher_id, course_id")
    .eq("id", evaluationId)
    .eq("teacher_id", teacherId)
    .maybeSingle()

  if (!evaluation) {
    return NextResponse.json({ step: "evaluation", message: "No encontrada o sin permiso" }, { status: 404 })
  }

  const result = await upsertStudentProjectionFromEvaluation(supabase, evaluationId, {
    year: body.year,
    gradeLevel: body.grade_level,
    subject: body.subject,
    paesApplication: body.paes_application,
    paesSubject: body.paes_subject,
  })

  if (!result.ok) {
    const status =
      result.step === "student"
        ? 409
        : result.step === "organization"
          ? 409
          : result.step === "items" && result.message.includes("Sin puntaje")
            ? 422
            : 500
    return NextResponse.json({ step: result.step, message: result.message }, { status })
  }

  const projection = result.projection
  return NextResponse.json({
    ok: true,
    source_label: (projection.parameters_snapshot as { source_label?: string } | undefined)?.source_label ?? null,
    projection,
    checks: {
      logro_pct: projection.logro_pct,
      correct_answers: projection.correct_answers,
    },
  })
}
