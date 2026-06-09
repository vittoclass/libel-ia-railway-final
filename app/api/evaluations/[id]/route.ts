// app/api/evaluations/[id]/route.ts
// GET: detalle de una evaluaci?n (metadata, items, summary, estudiantes). Solo del usuario autenticado.
import { NextRequest, NextResponse } from "next/server"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { canReadEvaluationInAppScope, normUuid, profileScopeFromRow } from "@/app/lib/evaluation-read-scope"
import { isMasterEmail } from "@/app/lib/master-access"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { mergePedagogicalSummaryDisplayFields, resolveStudentDisplayName } from "@/app/lib/student-display-name"

export const dynamic = "force-dynamic"

const isDev = process.env.NODE_ENV !== "production"

/** Sin columnas opcionales no desplegadas en todas las BD (p. ej. batch_student_index). */
const EVAL_DETAIL_SELECT_FULL =
  "id, title, course_id, course_label, subject, evaluated_at, status, teacher_id, school_id, user_id, source_exam_id, batch_id, scan_image_paths, capture_source"
const EVAL_DETAIL_SELECT_BASE =
  "id, title, course_id, course_label, subject, evaluated_at, status, teacher_id, school_id, user_id, source_exam_id, batch_id"

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
    const message = evalErr?.message ?? "Evaluaci?n no encontrada"
    if (isDev) console.info("[API][EVAL_DETAIL] error/not found", step, message)
    if (!evalErr && !evaluation) {
      const userMessage = "Esta evaluaci?n a?n no tiene resultados procesados."
      return NextResponse.json(
        isDev
          ? {
              step: "not_found",
              error: "Evaluaci?n no encontrada",
              message: userMessage,
              code: "EVALUATION_NOT_FOUND",
              debug: { id },
            }
          : {
              error: "Evaluaci?n no encontrada",
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
            message: "No autorizado para esta evaluaci?n",
            debug: {
              evaluationTeacherId: evaluation.teacher_id,
              evaluationUserId: (evaluation as { user_id?: string }).user_id,
              teacher_id_used,
              school_id_used,
              userId: user.id,
            },
          }
        : { error: "No autorizado para esta evaluaci?n" },
      { status: 403 }
    )
  }

  const ev = evaluation as Record<string, unknown>

  const [itemsRes, summariesRes, studentsRes] = await Promise.all([
    supabase
      .from("evaluation_items")
      .select("question_number, student_answer, correct_answer, is_correct, score_obtained, score_max")
      .eq("evaluation_id", id)
      .order("question_number", { ascending: true }),
    supabase
      .from("evaluation_summaries")
      .select("id, grade_chile, strengths, improvements, raw, student_name_raw, created_at")
      .eq("evaluation_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("evaluation_students")
      .select("id, student_name, student_identifier, created_at")
      .eq("evaluation_id", id)
      .order("student_name", { ascending: true }),
  ])

  const items = Array.isArray(itemsRes.data) ? itemsRes.data : []
  const summaryRowsRaw = Array.isArray(summariesRes.data) ? summariesRes.data : []
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
    if (summariesRes.error) console.info("[API][EVAL_DETAIL] evaluation_summaries error:", summariesRes.error.message)
    if (studentsRes.error) console.info("[API][EVAL_DETAIL] evaluation_students error:", studentsRes.error.message)
    console.info("[API][EVAL_DETAIL] items count", items.length)
    console.info("[API][EVAL_DETAIL] summaries count", summaryRowsRaw.length)
    console.info("[API][EVAL_DETAIL] response 200")
  }
  let firstStudentIdentifier: string | undefined
  for (const st of students) {
    const row = st as { student_identifier?: string | null }
    const idf = row.student_identifier != null ? String(row.student_identifier).trim() : ""
    if (idf.length > 0 && !firstStudentIdentifier) firstStudentIdentifier = idf
  }

  type SummaryRow = {
    id?: string
    grade_chile?: unknown
    strengths?: unknown
    improvements?: unknown
    raw?: unknown
    student_name_raw?: string | null
    created_at?: string | null
  }
  const summaryRows = summaryRowsRaw as SummaryRow[]

  function mapSummaryToPayload(row: SummaryRow) {
    const merged = mergePedagogicalSummaryDisplayFields({
      strengths: row.strengths as string | null | undefined,
      improvements: row.improvements as string | null | undefined,
      raw: row.raw,
    })
    return {
      id: row.id,
      grade_chile: row.grade_chile,
      strengths: merged.strengths,
      improvements: merged.improvements,
      raw: row.raw,
      student_name_raw: row.student_name_raw ?? null,
      created_at: row.created_at ?? null,
    }
  }

  const summariesPayload = summaryRows.map(mapSummaryToPayload)
  /** Una fila por alumno es posible; `summary` / `evaluation_summaries` siguen el resumen m?s reciente (compat). */
  const summaryTyped = summaryRows.length > 0 ? summaryRows[summaryRows.length - 1]! : null
  const mergedSummaryFields = summaryTyped
    ? mergePedagogicalSummaryDisplayFields({
        strengths: summaryTyped.strengths as string | null | undefined,
        improvements: summaryTyped.improvements as string | null | undefined,
        raw: summaryTyped.raw,
      })
    : { strengths: null as string | null, improvements: null as string | null }

  let resolvedStudentName: string | undefined
  for (const st of students) {
    const row = st as { student_name?: string | null }
    const n = resolveStudentDisplayName({
      student_name: row.student_name,
      student_name_raw: null,
      raw: null,
    }).trim()
    if (n) {
      resolvedStudentName = n
      break
    }
  }
  if (!resolvedStudentName && summaryTyped) {
    const n = resolveStudentDisplayName({
      student_name: null,
      student_name_raw: summaryTyped.student_name_raw ?? null,
      raw: summaryTyped.raw,
    }).trim()
    if (n) resolvedStudentName = n
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
        student_name: resolvedStudentName,
        student_identifier: firstStudentIdentifier,
        source_exam_id: (ev.source_exam_id as string | null | undefined) ?? undefined,
        batch_id: (ev.batch_id as string | null | undefined) ?? undefined,
        capture_source: (ev.capture_source as string | null | undefined) ?? undefined,
        scan_image_paths: scanPaths.length > 0 ? scanPaths : undefined,
        /** Primera ruta en Storage (bucket batch-scans); misma lista ordenada que scan_image_paths[0]. */
        scan_primary_storage_path: scanPaths[0] ?? undefined,
        scan_image_signed_urls: scan_image_signed_urls.length > 0 ? scan_image_signed_urls : undefined,
      },
      items,
      summary: summaryTyped
        ? {
            grade_chile: summaryTyped.grade_chile,
            strengths: mergedSummaryFields.strengths,
            improvements: mergedSummaryFields.improvements,
            raw: summaryTyped.raw,
            student_name_raw: summaryTyped.student_name_raw ?? null,
            created_at: summaryTyped.created_at ?? null,
          }
        : null,
      /** Todas las filas de resumen de esta evaluaci?n (p. ej. una por estudiante). */
      summaries: summariesPayload,
      students,
      evaluation_items: items,
      evaluation_summaries: summaryTyped
        ? {
            grade_chile: summaryTyped.grade_chile,
            strengths: mergedSummaryFields.strengths,
            improvements: mergedSummaryFields.improvements,
            raw: summaryTyped.raw,
            student_name_raw: summaryTyped.student_name_raw ?? null,
            created_at: summaryTyped.created_at ?? null,
          }
        : null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}

const INSTITUTIONAL_ARCHIVE_ROLES = new Set(["UTP", "DIRECCION", "ADMIN_INSTITUCION", "ADMIN"])

function normalizeArchiveRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

/** school_id de la evaluación; si la fila no lo trae, infiere desde el teacher_id del docente creador. */
async function resolveEvaluationSchoolId(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  evaluation: { teacher_id?: string | null; school_id?: string | null }
): Promise<string | null> {
  const direct = normUuid(evaluation.school_id ?? null)
  if (direct) return direct

  const evalTeacher = normUuid(evaluation.teacher_id ?? null)
  if (!evalTeacher) return null

  const { data: teacherProfile } = await supabase
    .from("profiles")
    .select("school_id")
    .eq("teacher_id", evalTeacher)
    .not("school_id", "is", null)
    .limit(1)
    .maybeSingle()

  return normUuid((teacherProfile as { school_id?: string | null } | null)?.school_id ?? null)
}

async function canArchiveEvaluation(params: {
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>
  userEmail: string | undefined
  userId: string
  teacherId: string | null
  profileRole: string | null | undefined
  profileSchoolId: string | null
  evaluation: { teacher_id?: string | null; user_id?: string | null; school_id?: string | null }
}): Promise<boolean> {
  if (isMasterEmail(params.userEmail)) return true

  const evalTeacher = normUuid(params.evaluation.teacher_id ?? null)
  const { teacher_id_used, school_id_used } = profileScopeFromRow({
    teacher_id: params.teacherId,
    school_id: params.profileSchoolId,
  })

  if (teacher_id_used && evalTeacher === teacher_id_used) return true

  const evalUserId = params.evaluation.user_id != null ? String(params.evaluation.user_id).trim() : ""
  if (evalUserId !== "" && (evalUserId === params.userId || (teacher_id_used && evalUserId === teacher_id_used))) {
    return true
  }

  const role = normalizeArchiveRole(params.profileRole)
  if (INSTITUTIONAL_ARCHIVE_ROLES.has(role) && school_id_used) {
    const evalSchool =
      normUuid(params.evaluation.school_id ?? null) ??
      (await resolveEvaluationSchoolId(params.supabase, params.evaluation))
    if (evalSchool && school_id_used === evalSchool) return true
  }

  return false
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

  const { user } = await getOrCreateProfile()
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
    .select("teacher_id, school_id, role")
    .eq("user_id", user.id)
    .maybeSingle()

  const { data: evaluation, error: evalErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, user_id, school_id")
    .eq("id", id)
    .maybeSingle()

  if (evalErr || !evaluation) {
    return NextResponse.json(
      isDev ? { step: "fetch_evaluation", message: evalErr?.message ?? "Evaluaci?n no encontrada", debug: { id } } : { error: "Evaluaci?n no encontrada" },
      { status: 404 }
    )
  }

  const profileScope = profileScopeFromRow(profileRow)
  const resolvedEvalSchool =
    normUuid(evaluation.school_id ?? null) ?? (await resolveEvaluationSchoolId(supabase, evaluation))
  const canArchive = await canArchiveEvaluation({
    supabase,
    userEmail: user.email,
    userId: user.id,
    teacherId: profileRow?.teacher_id ?? null,
    profileRole: profileRow?.role ?? null,
    profileSchoolId: profileRow?.school_id ?? null,
    evaluation,
  })
  if (!canArchive) {
    return NextResponse.json(
      isDev
        ? {
            step: "ownership",
            message: "No autorizado para esta evaluaci?n",
            debug: {
              evaluationTeacherId: evaluation.teacher_id,
              evaluationUserId: evaluation.user_id,
              evaluationSchoolId: evaluation.school_id,
              resolvedEvaluationSchoolId: resolvedEvalSchool,
              profileTeacherId: profileRow?.teacher_id ?? null,
              profileSchoolId: profileRow?.school_id ?? null,
              profileRole: profileRow?.role ?? null,
              normalizedProfileRole: normalizeArchiveRole(profileRow?.role),
              userId: user.id,
              isMaster: isMasterEmail(user.email),
              institutionalRoleMatch: INSTITUTIONAL_ARCHIVE_ROLES.has(normalizeArchiveRole(profileRow?.role)),
              sameSchoolAsProfile:
                !!profileScope.school_id_used &&
                !!resolvedEvalSchool &&
                profileScope.school_id_used === resolvedEvalSchool,
            },
          }
        : { error: "No autorizado para esta evaluaci?n" },
      { status: 403 }
    )
  }

  const { data: updated, error: archiveErr } = await supabase
    .from("evaluations")
    .update({ status: "archived", is_archived: true })
    .eq("id", id)
    .select("id, status, is_archived")
    .maybeSingle()

  if (archiveErr) {
    return NextResponse.json(
      isDev ? { step: "archive_evaluation", message: archiveErr.message, debug: { id } } : { error: "No se pudo archivar la evaluaci?n" },
      { status: 500 }
    )
  }

  if (!updated) {
    return NextResponse.json(
      isDev
        ? { step: "archive_evaluation", message: "No se actualiz? ninguna fila (posible RLS o id inexistente)", debug: { id } }
        : { error: "No se pudo archivar la evaluaci?n" },
      { status: 409 }
    )
  }

  if (updated.status !== "archived" || updated.is_archived !== true) {
    return NextResponse.json(
      isDev
        ? {
            step: "archive_evaluation",
            message: "La evaluaci?n no qued? archivada en BD",
            debug: { id, status: updated.status, is_archived: updated.is_archived },
          }
        : { error: "No se pudo archivar la evaluaci?n" },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { ok: true, archived_evaluation_id: id, status: "archived", is_archived: true },
    { status: 200 }
  )
}
