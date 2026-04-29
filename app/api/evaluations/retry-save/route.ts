import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { persistEvaluation, type EvaluationResultForPersist, type PersistEvaluationOpts } from "@/app/lib/persist-evaluation"

export const dynamic = "force-dynamic"

/**
 * POST /api/evaluations/retry-save
 * Reintenta guardar una evaluación ya calculada (sin volver a ejecutar OCR/Mistral).
 * Body: { result: EvaluationResultForPersist, teacher_id?, school_id?, title?, subject?, course_id? }
 * Si hay sesión con profile.teacher_id, se usan esos para guardar.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const result = body.result as EvaluationResultForPersist | undefined
    if (!result || typeof result.nota !== "number") {
      return NextResponse.json({ saved: false, save_error: "retry-save: body.result inválido" }, { status: 400 })
    }

    const user = await getAuthUser()
    let teacher_id: string | null = (body.teacher_id && String(body.teacher_id).trim()) || null
    let school_id: string | null = (body.school_id && String(body.school_id).trim()) || null

    if (user) {
      const supabase = getSupabaseServer()
      if (supabase) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("teacher_id, school_id")
          .eq("user_id", user.id)
          .maybeSingle()
        teacher_id = profile?.teacher_id ?? null
        school_id = profile?.school_id ?? null
      }
    }

    const opts: PersistEvaluationOpts = {
      teacher_id: teacher_id || undefined,
      school_id: school_id || undefined,
      title: body.title != null ? String(body.title).trim() || undefined : undefined,
      subject: body.subject != null ? String(body.subject).trim() || undefined : undefined,
      course_id: body.course_id != null ? String(body.course_id).trim() || undefined : undefined,
      student_name: body.student_name != null && String(body.student_name).trim() !== "" ? String(body.student_name).trim() : undefined,
      batch_id:
        body.evaluation_batch_id != null && String(body.evaluation_batch_id).trim() !== ""
          ? String(body.evaluation_batch_id).trim()
          : undefined,
      endpoint_origin: "/api/evaluations/retry-save",
    }

    const saveResult = await persistEvaluation(result, opts)

    if (saveResult.saved) {
      return NextResponse.json({
        saved: true,
        evaluation_id: saveResult.evaluation_id,
        status: saveResult.status,
        save_error: null,
      })
    }
    const save_error = `${saveResult.error.step}: ${saveResult.error.message}`
    return NextResponse.json({
      saved: false,
      evaluation_id: null,
      status: null,
      save_error,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({
      saved: false,
      evaluation_id: null,
      status: null,
      save_error: `retry-save: ${msg}`,
    })
  }
}
