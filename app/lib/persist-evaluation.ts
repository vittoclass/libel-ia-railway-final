/**
 * Persistencia de evaluación en Supabase.
 * Usa cliente con SERVICE_ROLE_KEY (bypass RLS). Nunca falla en silencio: devuelve
 * { saved: true, evaluation_id, status } o { saved: false, error: { message, step, details? } }.
 */
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { ensureStudentProfile } from "@/app/lib/student-profile-link"
import { evaluateSkillsFromEvaluation } from "@/app/lib/skill-evaluator"
import {
  attachStudentIdToEvaluationArtifacts,
  upsertStudentIdentity,
} from "@/app/lib/student-identity/repository"
import type { SupabaseClient } from "@supabase/supabase-js"

export interface PersistEvaluationOpts {
  user_id?: string | null
  teacher_id?: string | null
  school_id?: string | null
  course_id?: string | null
  title?: string | null
  subject?: string | null
  /** Un nombre confirmado (frontend o detectado). Se guarda exactamente. */
  student_name?: string | null
  /** RUT opcional del estudiante para identidad histórica (si no viene, fallback por nombre). */
  student_rut?: string | null
  /** Varios nombres confirmados; cada uno se guarda como fila independiente. Si se usa, tiene prioridad sobre student_name. */
  student_names?: string[] | null
  teacher_name?: string | null
  course?: string | null
  /** UUID de lote (EvaluatorClient); opcional, reversible si se ignora en BD. */
  batch_id?: string | null
}

export interface EvaluationResultForPersist {
  puntaje: string
  nota: number
  puntosAprobacion?: number
  puntosMaximos?: number
  nombreEstudianteDetectado?: string | null
  retroalimentacion?: {
    resumen_general?: { fortalezas?: string; areas_mejora?: string }
    correccion_detallada?: unknown[]
  }
  alternativas_corregidas?: Array<{
    pregunta: string
    respuesta_estudiante: string
    respuesta_correcta: string
  }>
  detalle_desarrollo?: Record<
    string,
    { puntaje?: string; texto_estudiante?: string; justificacion?: string } | undefined
  >
}

export type PersistResult =
  | { saved: true; success: true; evaluation_id: string; status: string }
  | { saved: false; success: false; error: { step: string; message: string }; reason?: string }

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isValidUUID(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim() !== "" && UUID_REGEX.test(s.trim())
}

/**
 * Inserta una evaluación y sus ítems/resumen en Supabase (cliente SERVICE_ROLE).
 * NO usa profesor por defecto: teacher_id y school_id deben venir del perfil del usuario autenticado.
 * Si no se pasan teacher_id/school_id válidos, devuelve saved: false (reason: PROFILE_NOT_ONBOARDED o NO_SESSION).
 */
export async function persistEvaluation(
  result: EvaluationResultForPersist,
  opts: PersistEvaluationOpts
): Promise<PersistResult> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)

const isDev = process.env.NODE_ENV !== "production"

  try {
    const hostname = supabaseUrl ? new URL(supabaseUrl).hostname : "(no URL)"
    if (isDev) {
      console.info("[save] supabase host:", hostname)
      console.info("[save] has service role:", hasServiceRole)
    }
  } catch (_) {
    if (isDev) console.info("[save] SUPABASE_URL invalid or missing")
  }

  if (!hasServiceRole) {
    if (isDev) console.error("[save] Missing SUPABASE_SERVICE_ROLE_KEY")
    return { saved: false, success: false, error: { step: "config", message: "Missing SUPABASE_SERVICE_ROLE_KEY" } }
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    if (isDev) console.error("[save] getSupabaseServer() returned null")
    return { saved: false, success: false, error: { step: "config", message: "Supabase client not available" } }
  }

  let effective_school_id: string | null = opts.school_id?.trim() || null
  let effective_teacher_id: string | null = opts.teacher_id?.trim() || null

  if (!effective_teacher_id) {
    const msg = "Falta teacher_id (perfil no completado o sin sesión)"
    if (isDev) console.warn("[save]", msg)
    return { saved: false, success: false, error: { step: "auth", message: msg }, reason: "PROFILE_NOT_ONBOARDED" }
  }

  if (!effective_school_id) {
    const { data: teacher } = await supabase
      .from("teachers")
      .select("school_id")
      .eq("id", effective_teacher_id)
      .single()
    effective_school_id = teacher?.school_id ?? null
  }

  if (!effective_school_id || !effective_teacher_id) {
    const msg = "Falta school_id o teacher_id"
    if (isDev) console.error("[save]", msg)
    return { saved: false, success: false, error: { step: "resolve_ids", message: msg }, reason: "PROFILE_NOT_ONBOARDED" }
  }

  const safeTitle = opts.title != null && String(opts.title).trim() !== "" ? String(opts.title).trim() : "Evaluación sin título"
  const safeSubject = opts.subject != null && String(opts.subject).trim() !== "" ? String(opts.subject).trim() : "Sin asignatura"
  const rawCourse = opts.course_id != null && String(opts.course_id).trim() !== "" ? String(opts.course_id).trim() : null
  const safeCourseLabel = rawCourse ?? "Sin curso"
  const evaluationCourseId = isValidUUID(rawCourse) ? rawCourse!.trim() : null

  const confirmedStudents: string[] = []
  if (Array.isArray(opts.student_names) && opts.student_names.length > 0) {
    for (const n of opts.student_names) {
      if (n != null && String(n).trim() !== "") confirmedStudents.push(String(n).trim())
    }
  } else if (opts.student_name != null && String(opts.student_name).trim() !== "") {
    confirmedStudents.push(String(opts.student_name).trim())
  }
  if (isDev) console.info("[student] confirmed_students_before_save =", JSON.stringify(confirmedStudents))

  const evaluationInsert: Record<string, unknown> = {
    school_id: effective_school_id,
    teacher_id: effective_teacher_id,
    user_id: opts.user_id?.trim() || null,
    title: safeTitle,
    subject: safeSubject,
    evaluated_at: new Date().toISOString(),
    status: "draft",
    course_label: safeCourseLabel,
  }
  if (evaluationCourseId) evaluationInsert.course_id = evaluationCourseId
  const batchIdOpt = opts.batch_id != null && String(opts.batch_id).trim() !== "" ? String(opts.batch_id).trim() : null
  if (batchIdOpt && isValidUUID(batchIdOpt)) evaluationInsert.batch_id = batchIdOpt

  const { data: evaluation, error: evalError } = await supabase
    .from("evaluations")
    .insert(evaluationInsert)
    .select("id")
    .single()

  if (evalError || !evaluation?.id) {
    const msg = evalError?.message ?? String(evalError ?? "No id returned")
    if (isDev) console.error("[save] evaluations insert FAIL", evalError?.message ?? evalError)
    return {
      saved: false,
      success: false,
      error: { step: "insert_evaluations", message: msg },
    }
  }

  const evaluationId = typeof evaluation.id === "string" ? evaluation.id : String(evaluation.id)
  if (isDev) console.info("[persist] evaluation created", evaluationId)

  // SNAPSHOT_NATIONAL_ANALYTICS_V1: evitar falso "saved: true" en persistencia parcial
  let childPersistError: { step: string; message: string } | null = null
  const registerChildError = (step: string, message: string) => {
    if (!childPersistError) childPersistError = { step, message }
    if (isDev) console.error(`[save] child persistence fail (${step})`, message)
  }

  let questionNumber = 1
  let itemsInserted = 0

  const altItems = result.alternativas_corregidas || []
  // SNAPSHOT_NATIONAL_ANALYTICS_V1: inserts paralelos para reducir latencia en serverless
  const altInsertPromises = altItems.map((a, idx) => {
    const isCorrect =
      String(a.respuesta_estudiante).trim().toUpperCase() ===
      String(a.respuesta_correcta).trim().toUpperCase()
    return supabase
      .from("evaluation_items")
      .insert({
        evaluation_id: evaluationId,
        question_number: idx + 1,
        student_answer: a.respuesta_estudiante ?? null,
        correct_answer: a.respuesta_correcta ?? null,
        is_correct: isCorrect,
        score_obtained: isCorrect ? 1 : 0,
        score_max: 1,
      })
      .then(({ error }) => ({ error }))
  })
  const altInsertResults = await Promise.all(altInsertPromises)
  for (const r of altInsertResults) {
    if (r.error) registerChildError("insert_evaluation_items_alternativas", r.error.message)
    else itemsInserted++
  }
  questionNumber = altItems.length + 1

  const desarrollo = result.detalle_desarrollo || {}
  /** Extrae número de pregunta desde clave de desarrollo (P39 → 39, "39" → 39) para que evaluation_items.question_number coincida con source_exam_items.item_number y entre al análisis pedagógico. */
  const parseDevelopmentQuestionNumber = (key: string): number | null => {
    const k = String(key).trim()
    const numMatch = k.match(/(\d+)/)
    if (numMatch) {
      const n = parseInt(numMatch[1], 10)
      if (n >= 1 && n <= 999) return n
    }
    return null
  }
  const desarrolloKeys = Object.keys(desarrollo).sort()
  const desarrolloRows: Array<Record<string, unknown>> = []
  let nextQuestionNumber = questionNumber
  for (const key of desarrolloKeys) {
    const item = desarrollo[key]
    if (!item || typeof item !== "object") continue
    let scoreObtained = 0
    let scoreMax = 0
    if (typeof item.puntaje === "string" && item.puntaje.includes("/")) {
      const [obt, max] = item.puntaje.split("/").map((n) => parseFloat(n) || 0)
      scoreObtained = obt
      scoreMax = max
    }
    const parsedQ = parseDevelopmentQuestionNumber(key)
    const qNum = parsedQ != null ? parsedQ : nextQuestionNumber++
    desarrolloRows.push({
      evaluation_id: evaluationId,
      question_number: qNum,
      student_answer: item.texto_estudiante ?? null,
      correct_answer: null,
      is_correct: null,
      score_obtained: scoreObtained,
      score_max: scoreMax,
    })
  }
  const desarrolloInsertPromises = desarrolloRows.map((row) =>
    supabase.from("evaluation_items").insert(row).then(({ error }) => ({ error }))
  )
  const desarrolloInsertResults = await Promise.all(desarrolloInsertPromises)
  for (const r of desarrolloInsertResults) {
    if (r.error) registerChildError("insert_evaluation_items_desarrollo", r.error.message)
    else itemsInserted++
  }

  if (isDev) console.info("[persist] items inserted", itemsInserted)

  const resumen = result.retroalimentacion?.resumen_general
  const studentNameRawForSummary =
    confirmedStudents[0] ??
    (opts.student_name != null && String(opts.student_name).trim() !== "" ? String(opts.student_name).trim() : null) ??
    (result.nombreEstudianteDetectado != null && String(result.nombreEstudianteDetectado).trim() !== ""
      ? String(result.nombreEstudianteDetectado).trim()
      : null)
  let rawSafe: Record<string, unknown> | null = null
  try {
    rawSafe = result as unknown as Record<string, unknown>
    if (typeof rawSafe === "object" && rawSafe !== null) {
      const str = JSON.stringify(rawSafe)
      if (str.length > 100_000) rawSafe = { nota: result.nota, puntaje: result.puntaje }
    }
  } catch (_) {
    rawSafe = { nota: result.nota, puntaje: result.puntaje }
  }
  const { error: sumErr } = await supabase.from("evaluation_summaries").insert({
    evaluation_id: evaluationId,
    grade_chile: result.nota ?? null,
    student_name_raw: studentNameRawForSummary,
    strengths: resumen?.fortalezas ?? null,
    improvements: resumen?.areas_mejora ?? null,
    raw: rawSafe,
  })
  if (sumErr) registerChildError("insert_evaluation_summaries", sumErr.message)
  if (!sumErr && isDev) console.info("[persist] summary inserted")

  const savedStudentNames: string[] = []
  const profileIdsCollected: string[] = []
  if (confirmedStudents.length === 0 && isDev) {
    console.info("[student_profile] skipped (no student_name)")
  }
  for (const confirmedName of confirmedStudents) {
    try {
      const normalized = confirmedName.trim().toLowerCase()
      const row = {
        evaluation_id: evaluationId,
        student_name: confirmedName,
        student_normalized: normalized,
        course_label: safeCourseLabel,
      } as Record<string, unknown>
      const { error: esErr } = await supabase
        .from("evaluation_students")
        .upsert(row, { onConflict: "evaluation_id,student_normalized" })
      if (esErr) registerChildError("upsert_evaluation_students", esErr.message)
      if (!esErr) savedStudentNames.push(confirmedName)

      try {
        const profileId = await ensureStudentProfile(supabase, {
          teacher_id: effective_teacher_id,
          school_id: effective_school_id,
          student_name: confirmedName,
          course_label: safeCourseLabel,
        })
        if (profileId) {
          profileIdsCollected.push(profileId)
          const { error: upErr } = await supabase
            .from("evaluation_students")
            .update({ student_profile_id: profileId })
            .eq("evaluation_id", evaluationId)
            .eq("student_normalized", normalized)
          if (upErr) registerChildError("attach_student_profile", upErr.message)
          else if (isDev) console.info("[student_profile] attached evaluation_student ->", profileId)
        }
      } catch (linkErr) {
        registerChildError(
          "student_profile_link",
          linkErr instanceof Error ? linkErr.message : String(linkErr)
        )
      }
      // PHASE_4_MEMORY_IDENTITY_V1
      try {
        const identity = await upsertStudentIdentity(supabase, {
          rut: opts.student_rut ?? null,
          student_name: confirmedName,
          course_label: safeCourseLabel,
          institution: null,
          evaluation_id: evaluationId,
          evaluated_at: new Date().toISOString(),
        })
        if (identity.student_id) {
          await attachStudentIdToEvaluationArtifacts(supabase, {
            evaluation_id: evaluationId,
            student_name: confirmedName,
            student_id: identity.student_id,
          })
        }
      } catch (identityErr) {
        registerChildError(
          "student_identity_upsert",
          identityErr instanceof Error ? identityErr.message : String(identityErr)
        )
      }
    } catch (e) {
      registerChildError(
        "upsert_evaluation_students_exception",
        e instanceof Error ? e.message : String(e)
      )
    }
  }
  if (isDev) console.info("[student] saved_students =", JSON.stringify(savedStudentNames))

  try {
    const skillRows = await evaluateSkillsFromEvaluation(result, safeSubject)
    if (skillRows.length > 0 && profileIdsCollected.length > 0) {
      const skillInsertPromises = profileIdsCollected.flatMap((profileId) =>
        skillRows.map((row) =>
          supabase
            .from("evaluation_skill_results")
            .insert({
              evaluation_id: evaluationId,
              student_profile_id: profileId,
              axis_id: row.axis_id,
              skill_id: row.skill_id,
              score_obtained: row.score_obtained,
              score_max: row.score_max,
              accuracy: row.accuracy,
            })
            .then(({ error }) => ({ error }))
        )
      )
      const skillInsertResults = await Promise.all(skillInsertPromises)
      for (const r of skillInsertResults) {
        if (r.error) registerChildError("insert_evaluation_skill_results", r.error.message)
      }
      if (isDev) console.info("[skill_results] inserted for", profileIdsCollected.length, "profiles,", skillRows.length, "skills each")
    }
  } catch (e) {
    registerChildError(
      "skill_results_pipeline",
      e instanceof Error ? e.message : String(e)
    )
  }

  if (childPersistError) {
    return {
      saved: false,
      success: false,
      error: {
        step: childPersistError.step,
        message: `${childPersistError.message} (evaluation_id=${evaluationId})`,
      },
    }
  }

  return { saved: true, success: true, evaluation_id: evaluationId, status: "draft" }
}
