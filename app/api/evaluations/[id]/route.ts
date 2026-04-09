// app/api/evaluations/[id]/route.ts
// GET: detalle de una evaluación (metadata, items, summary, estudiantes). Solo del usuario autenticado.
import { NextRequest, NextResponse } from "next/server"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { canReadEvaluationInAppScope, profileScopeFromRow } from "@/app/lib/evaluation-read-scope"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV !== "production"

const EVAL_DETAIL_SELECT_FULL =
  "id, title, course_id, course_label, subject, evaluated_at, status, teacher_id, school_id, user_id, source_exam_id, batch_id, batch_student_index, scan_image_paths, capture_source"
const EVAL_DETAIL_SELECT_BASE =
  "id, title, course_id, course_label, subject, evaluated_at, status, teacher_id, school_id, user_id, source_exam_id, batch_id, batch_student_index"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (isDev) console.info("[API][EVAL_DETAIL] start", id)
  if (!id) {
    return NextResponse.json(
      isDev ? { step: "params", message: "id requerido", debug: { id } } : { error: "id requerido" },
      { status: 400 }
    )
  }

  const { user } = await getOrCreateProfile()
  if (isDev) console.info("[API][EVAL_DETAIL] user", user?.id ?? null)
  if (!user) {
    return NextResponse.json(
      isDev ? { step: "auth", message: "No autorizado", debug: { hasUser: false } } : { error: "No autorizado" },
      { status: 401 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      isDev ? { step: "config", message: "Supabase no configurado", debug: {} } : { error: "Supabase no configurado" },
      { status: 503 }
    )
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const { teacher_id_used, school_id_used } = profileScopeFromRow(profileRow)

  let evaluation: Record<string, unknown> | null = null
  let evalErr: { message: string } | null = null
  {
    const r1 = await supabase.from("evaluations").select(EVAL_DETAIL_SELECT_FULL).eq("id", id).maybeSingle()
    if (!r1.error && r1.data) {
      evaluation = r1.data as Record<string, unknown>
    } else {
      const r2 = await supabase.from("evaluations").select(EVAL_DETAIL_SELECT_BASE).eq("id", id).maybeSingle()
      if (!r2.error && r2.data) {
        evaluation = r2.data as Record<string, unknown>
        evalErr = null
        if (isDev && r1.error) console.info("[API][EVAL_DETAIL] fallback select sin columnas opcionales", r1.error.message)
      } else {
        evaluation = (r2.data ?? null) as Record<string, unknown> | null
        evalErr = r2.error ?? r1.error
      }
    }
  }

  if (isDev) console.info("[API][EVAL_DETAIL] evaluation found", !!evaluation)
  if (evalErr || !evaluation) {
    const step = evalErr ? "fetch_evaluation" : "not_found"
    const message = evalErr?.message ?? "Evaluación no encontrada"
    if (isDev) console.info("[API][EVAL_DETAIL] error/not found", step, message)
    if (!evalErr && !evaluation) {
      const userMessage = "Esta evaluación aún no tiene resultados procesados."
      return NextResponse.json(
        isDev
          ? {
              step: "not_found",
              error: "Evaluación no encontrada",
              message: userMessage,
              code: "EVALUATION_NOT_FOUND",
              debug: { id },
            }
          : {
              error: "Evaluación no encontrada",
              message: userMessage,
              code: "EVALUATION_NOT_FOUND",
            },
        { status: 404 }
      )
    }
    return NextResponse.json(
      isDev ? { step, message, debug: { id, evalErr: evalErr?.message ?? null } } : { error: message },
      { status: evaluation ? 500 : 404 }
    )
  }

  const canRead = canReadEvaluationInAppScope({
    userId: user.id,
    evaluation: evaluation as { teacher_id?: string | null; user_id?: string | null; school_id?: string | null },
    teacher_id_used,
    school_id_used,
  })
  if (isDev)
    console.info("[API][EVAL_DETAIL] ownership validated", {
      canRead,
      teacher_id_used: !!teacher_id_used,
      school_id_used: !!school_id_used,
    })
  if (!canRead) {
    if (isDev) console.info("[API][EVAL_DETAIL] 403 forbidden")
    return NextResponse.json(
      isDev
        ? {
            step: "ownership",
            message: "No autorizado para esta evaluación",
            debug: {
              evaluationTeacherId: evaluation.teacher_id,
              evaluationUserId: (evaluation as { user_id?: string }).user_id,
              teacher_id_used,
              school_id_used,
              userId: user.id,
            },
          }
        : { error: "No autorizado para esta evaluación" },
      { status: 403 }
    )
  }

  const ev = evaluation as Record<string, unknown>

  const [itemsRes, summaryRes, studentsRes] = await Promise.all([
    supabase
      .from("evaluation_items")
      .select("question_number, student_answer, correct_answer, is_correct, score_obtained, score_max")
      .eq("evaluation_id", id)
      .order("question_number", { ascending: true }),
    supabase
      .from("evaluation_summaries")
      .select("grade_chile, strengths, improvements, raw")
      .eq("evaluation_id", id)
      .maybeSingle(),
    supabase
      .from("evaluation_students")
      .select("id, student_name, student_identifier, created_at")
      .eq("evaluation_id", id)
      .order("student_name", { ascending: true }),
  ])

  const items = Array.isArray(itemsRes.data) ? itemsRes.data : []
  const summary = summaryRes.data ?? null
  const studentsRaw = Array.isArray(studentsRes.data) ? studentsRes.data : []
  const students = [...studentsRaw].sort((a, b) => {
    const an = String((a as { student_name?: string | null }).student_name ?? "").trim()
    const bn = String((b as { student_name?: string | null }).student_name ?? "").trim()
    if (!an && bn) return 1
    if (an && !bn) return -1
    return 0
  })
  if (isDev) {
    if (itemsRes.error) console.info("[API][EVAL_DETAIL] evaluation_items error:", itemsRes.error.message)
    if (summaryRes.error) console.info("[API][EVAL_DETAIL] evaluation_summaries error:", summaryRes.error.message)
    if (studentsRes.error) console.info("[API][EVAL_DETAIL] evaluation_students error:", studentsRes.error.message)
    console.info("[API][EVAL_DETAIL] items count", items.length)
    console.info("[API][EVAL_DETAIL] summary found", !!summary)
    console.info("[API][EVAL_DETAIL] response 200")
  }
  let firstStudentName: string | undefined
  let firstStudentIdentifier: string | undefined
  for (const st of students) {
    const row = st as { student_name?: string | null; student_identifier?: string | null }
    const n = row.student_name != null ? String(row.student_name).trim() : ""
    if (n.length > 0 && !firstStudentName) firstStudentName = n
    const idf = row.student_identifier != null ? String(row.student_identifier).trim() : ""
    if (idf.length > 0 && !firstStudentIdentifier) firstStudentIdentifier = idf
  }

  const rawPaths = ev.scan_image_paths
  const scanPaths = Array.isArray(rawPaths)
    ? rawPaths.filter((p): p is string => typeof p === "string" && p.length > 0)
    : []
  const scan_image_signed_urls: string[] = []
  for (const path of scanPaths.slice(0, 20)) {
    const { data: signed, error: signErr } = await supabase.storage
      .from(BATCH_SCANS_BUCKET)
      .createSignedUrl(path, 3600)
    if (!signErr && signed?.signedUrl) scan_image_signed_urls.push(signed.signedUrl)
  }

  return NextResponse.json(
    {
      evaluation: {
        id: ev.id,
        title: ev.title,
        course_id: ev.course_id,
        course_label: (ev.course_label as string | null | undefined) ?? undefined,
        subject: ev.subject,
        evaluated_at: ev.evaluated_at,
        status: (ev.status as string | null | undefined) ?? "draft",
        student_name: firstStudentName,
        student_identifier: firstStudentIdentifier,
        source_exam_id: (ev.source_exam_id as string | null | undefined) ?? undefined,
        batch_id: (ev.batch_id as string | null | undefined) ?? undefined,
        batch_student_index: (ev.batch_student_index as number | null | undefined) ?? undefined,
        capture_source: (ev.capture_source as string | null | undefined) ?? undefined,
        scan_image_paths: scanPaths.length > 0 ? scanPaths : undefined,
        /** Primera ruta en Storage (bucket batch-scans); misma lista ordenada que scan_image_paths[0]. */
        scan_primary_storage_path: scanPaths[0] ?? undefined,
        scan_image_signed_urls: scan_image_signed_urls.length > 0 ? scan_image_signed_urls : undefined,
      },
      items,
      summary: summary
        ? {
            grade_chile: summary.grade_chile,
            strengths: summary.strengths,
            improvements: summary.improvements,
            raw: summary.raw,
          }
        : null,
      students,
      evaluation_items: items,
      evaluation_summaries: summary
        ? {
            grade_chile: summary.grade_chile,
            strengths: summary.strengths,
            improvements: summary.improvements,
            raw: summary.raw,
          }
        : null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json(
      isDev ? { step: "params", message: "id requerido", debug: { id } } : { error: "id requerido" },
      { status: 400 }
    )
  }

  const { user, profile } = await getOrCreateProfile()
  const teacherId = profile?.teacher_id ?? null
  if (!user) {
    return NextResponse.json(
      isDev ? { step: "auth", message: "No autorizado", debug: { hasUser: false } } : { error: "No autorizado" },
      { status: 401 }
    )
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      isDev ? { step: "config", message: "Supabase no configurado", debug: {} } : { error: "Supabase no configurado" },
      { status: 503 }
    )
  }

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, user_id")
    .eq("id", id)
    .maybeSingle()

  if (evalErr || !evaluation) {
    return NextResponse.json(
      isDev ? { step: "fetch_evaluation", message: evalErr?.message ?? "Evaluación no encontrada", debug: { id } } : { error: "Evaluación no encontrada" },
      { status: 404 }
    )
  }

  const isOwnerByTeacher = teacherId && evaluation.teacher_id === teacherId
  const isOwnerByUser = evaluation.user_id && evaluation.user_id === user.id
  if (!isOwnerByTeacher && !isOwnerByUser) {
    return NextResponse.json(
      isDev
        ? {
            step: "ownership",
            message: "No autorizado para esta evaluación",
            debug: { evaluationTeacherId: evaluation.teacher_id, evaluationUserId: evaluation.user_id, profileTeacherId: teacherId, userId: user.id },
          }
        : { error: "No autorizado para esta evaluación" },
      { status: 403 }
    )
  }

  // LOGICA_ANTERIOR_LOCAL: no existia borrado fisico en este endpoint.
  // DATA_SCIENCE_FIX_V1: eliminacion por fila padre; dependencias se limpian por ON DELETE CASCADE en DB.
  const { error: deleteErr } = await supabase.from("evaluations").delete().eq("id", id)
  if (deleteErr) {
    return NextResponse.json(
      isDev ? { step: "delete_evaluation", message: deleteErr.message, debug: { id } } : { error: "No se pudo eliminar la evaluación" },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, deleted_evaluation_id: id }, { status: 200 })
}
