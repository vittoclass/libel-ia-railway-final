/**
 * Persistencia de evaluación en Supabase.
 * Usa cliente con SERVICE_ROLE_KEY (bypass RLS). Nunca falla en silencio: devuelve
 * { saved: true, evaluation_id, status } o { saved: false, error: { message, step, details? } }.
 */
import { getSupabaseServer } from "@/app/lib/supabase-server"
import {
  ensureStudentProfile,
  resolveStudentProfileLooseByTeacherAndName,
} from "@/app/lib/student-profile-link"
import { inferFlatAssessmentCategoryFromExamLabel, parseAssessmentTypeToFlat } from "@/app/lib/assessment-category"
import { evaluateSkillsFromEvaluation } from "@/app/lib/skill-evaluator"
import { agencyFieldsFromSkillScores } from "@/app/lib/skill-result-agency"
import {
  attachStudentIdToEvaluationArtifacts,
  upsertStudentIdentity,
} from "@/app/lib/student-identity/repository"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@supabase/supabase-js"
import { upsertStudentProjectionFromEvaluation } from "@/app/lib/student-projection-upsert"

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
  /** Vínculo opcional a Prueba Base para trazabilidad pedagógica. */
  source_exam_id?: string | null
  /** Herencia opcional explícita del tipo de instrumento. */
  exam_type?: string | null
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
const FALLBACK_SCHOOL_NAME = "Escuela Local"
const FALLBACK_TEACHER_NAME = "Profe Local"
function isValidUUID(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim() !== "" && UUID_REGEX.test(s.trim())
}

/** Curso mayoritario entre evaluaciones del mismo lote (rezagados alineados al resto del curso). */
async function resolveBatchCourseContextFromPeers(
  supabase: SupabaseClient,
  batchId: string
): Promise<{ course_id: string | null; course_label: string | null }> {
  const { data: rows } = await supabase
    .from("evaluations")
    .select("course_id, course_label")
    .eq("batch_id", batchId)
    .limit(120)
  const list = (rows ?? []) as Array<{ course_id?: string | null; course_label?: string | null }>
  if (list.length === 0) return { course_id: null, course_label: null }
  const labelCounts = new Map<string, number>()
  let firstCourseId: string | null = null
  for (const r of list) {
    const cid = r.course_id != null && String(r.course_id).trim() !== "" ? String(r.course_id).trim() : null
    if (cid && !firstCourseId) firstCourseId = cid
    const lab = r.course_label != null && String(r.course_label).trim() !== "" ? String(r.course_label).trim() : null
    if (lab) labelCounts.set(lab, (labelCounts.get(lab) ?? 0) + 1)
  }
  let bestLabel: string | null = null
  let bestN = 0
  for (const [lab, n] of labelCounts) {
    if (n > bestN) {
      bestN = n
      bestLabel = lab
    }
  }
  return { course_id: firstCourseId, course_label: bestLabel }
}

async function ensureEmergencyTeacherAndSchool(
  supabase: SupabaseClient
): Promise<{ school_id: string | null; teacher_id: string | null }> {
  let schoolId: string | null = null
  let teacherId: string | null = null
  const schoolRes = await supabase
    .from("schools")
    .select("id")
    .eq("name", FALLBACK_SCHOOL_NAME)
    .limit(1)
    .maybeSingle()
  if (!schoolRes.error && schoolRes.data?.id) {
    schoolId = String((schoolRes.data as { id: string }).id)
  } else {
    const insSchool = await supabase
      .from("schools")
      .insert({ name: FALLBACK_SCHOOL_NAME })
      .select("id")
      .single()
    if (!insSchool.error && insSchool.data?.id) {
      schoolId = String((insSchool.data as { id: string }).id)
    }
  }
  if (!schoolId) return { school_id: null, teacher_id: null }

  const teacherRes = await supabase
    .from("teachers")
    .select("id")
    .eq("name", FALLBACK_TEACHER_NAME)
    .eq("school_id", schoolId)
    .limit(1)
    .maybeSingle()
  if (!teacherRes.error && teacherRes.data?.id) {
    teacherId = String((teacherRes.data as { id: string }).id)
  } else {
    const insTeacher = await supabase
      .from("teachers")
      .insert({ name: FALLBACK_TEACHER_NAME, school_id: schoolId })
      .select("id")
      .single()
    if (!insTeacher.error && insTeacher.data?.id) {
      teacherId = String((insTeacher.data as { id: string }).id)
    }
  }

  return { school_id: schoolId, teacher_id: teacherId }
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
  const hasAnon = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const isDev = process.env.NODE_ENV !== "production"

  try {
    const hostname = supabaseUrl ? new URL(supabaseUrl).hostname : "(no URL)"
    if (isDev) {
      console.info("[save] supabase host:", hostname)
      console.info("[save] has service role:", hasServiceRole)
      console.info("[save] has anon key:", hasAnon)
    }
  } catch (_) {
    if (isDev) console.info("[save] SUPABASE_URL invalid or missing")
  }

  let supabase = getSupabaseServer()
  if (!supabase && supabaseUrl && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    supabase = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    if (isDev) console.warn("[save] using ANON key fallback (no service role)")
  }
  if (!supabase) {
    if (isDev) console.error("[save] getSupabaseServer() returned null")
    return { saved: false, success: false, error: { step: "config", message: "Supabase client not available" } }
  }

  let effective_school_id: string | null = opts.school_id?.trim() || null
  let effective_teacher_id: string | null = opts.teacher_id?.trim() || null

  if (!effective_teacher_id) {
    const emergency = await ensureEmergencyTeacherAndSchool(supabase)
    effective_teacher_id = emergency.teacher_id
    effective_school_id = effective_school_id ?? emergency.school_id
    if (isDev) {
      console.warn("[save] teacher_id vacío; usando fallback local", {
        fallback_teacher_id: effective_teacher_id,
        fallback_school_id: effective_school_id,
      })
    }
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
    const emergency = await ensureEmergencyTeacherAndSchool(supabase)
    effective_teacher_id = effective_teacher_id ?? emergency.teacher_id
    effective_school_id = effective_school_id ?? emergency.school_id
  }

  if (!effective_school_id || !effective_teacher_id) {
    const msg = "Falta school_id o teacher_id (incluso con fallback)"
    if (isDev) console.error("[save]", msg)
    return { saved: false, success: false, error: { step: "resolve_ids", message: msg }, reason: "PROFILE_NOT_ONBOARDED" }
  }

  const safeTitle = opts.title != null && String(opts.title).trim() !== "" ? String(opts.title).trim() : "Evaluación sin título"
  const safeSubject = opts.subject != null && String(opts.subject).trim() !== "" ? String(opts.subject).trim() : "Sin asignatura"
  const rawCourse = opts.course_id != null && String(opts.course_id).trim() !== "" ? String(opts.course_id).trim() : null
  const safeCourseLabel = rawCourse ?? "Sin curso"
  const evaluationCourseId = isValidUUID(rawCourse) ? rawCourse!.trim() : null
  const generatedEvaluationId = crypto.randomUUID()

  const confirmedStudents: string[] = []
  if (Array.isArray(opts.student_names) && opts.student_names.length > 0) {
    for (const n of opts.student_names) {
      if (n != null && String(n).trim() !== "") confirmedStudents.push(String(n).trim())
    }
  } else if (opts.student_name != null && String(opts.student_name).trim() !== "") {
    confirmedStudents.push(String(opts.student_name).trim())
  }
  if (confirmedStudents.length === 0) {
    const det =
      result.nombreEstudianteDetectado != null && String(result.nombreEstudianteDetectado).trim() !== ""
        ? String(result.nombreEstudianteDetectado).trim()
        : null
    if (det) confirmedStudents.push(det)
  }
  if (isDev) console.info("[student] confirmed_students_before_save =", JSON.stringify(confirmedStudents))

  let batchPeerCourse: { course_id: string | null; course_label: string | null } = {
    course_id: null,
    course_label: null,
  }
  const batchIdOptEarly = opts.batch_id != null && String(opts.batch_id).trim() !== "" ? String(opts.batch_id).trim() : null
  if (batchIdOptEarly && isValidUUID(batchIdOptEarly)) {
    batchPeerCourse = await resolveBatchCourseContextFromPeers(supabase, batchIdOptEarly)
  }

  const evaluationInsert: Record<string, unknown> = {
    id: generatedEvaluationId,
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
  if (batchIdOptEarly && isValidUUID(batchIdOptEarly)) evaluationInsert.batch_id = batchIdOptEarly
  const sourceExamIdOpt =
    opts.source_exam_id != null && String(opts.source_exam_id).trim() !== ""
      ? String(opts.source_exam_id).trim()
      : null
  if (sourceExamIdOpt && isValidUUID(sourceExamIdOpt)) {
    evaluationInsert.source_exam_id = sourceExamIdOpt
    const sourceExamRes = await supabase
      .from("source_exams")
      .select("exam_type, pedagogy_mode, title, source_file_name")
      .eq("id", sourceExamIdOpt)
      .maybeSingle()
    if (!sourceExamRes.error && sourceExamRes.data) {
      const row = sourceExamRes.data as {
        exam_type?: string | null
        pedagogy_mode?: string | null
        title?: string | null
        source_file_name?: string | null
      }
      const inheritedExamType = String(row.exam_type ?? "").trim()
      const inheritedPedagogyMode = String(row.pedagogy_mode ?? "").trim()
      const titleBlob = String(row.title ?? "").trim()
      const fileBlob = String(row.source_file_name ?? "").trim()
      if (inheritedExamType) evaluationInsert.exam_type = inheritedExamType
      if (inheritedPedagogyMode) evaluationInsert.pedagogy_mode = inheritedPedagogyMode

      const labelInfer = inferFlatAssessmentCategoryFromExamLabel(`${titleBlob} ${fileBlob}`)
      let categoryFlat = parseAssessmentTypeToFlat(inheritedExamType)
      if (labelInfer === "ENSAYO_SIMCE" || labelInfer === "ENSAYO_PAES") {
        categoryFlat = labelInfer
        if (!evaluationInsert.exam_type) evaluationInsert.exam_type = labelInfer
      } else if (!categoryFlat && labelInfer) {
        categoryFlat = labelInfer
        if (!evaluationInsert.exam_type) evaluationInsert.exam_type = labelInfer
      }
      if (categoryFlat) evaluationInsert.assessment_category = categoryFlat
    }
  }
  const examTypeOpt = opts.exam_type != null && String(opts.exam_type).trim() !== "" ? String(opts.exam_type).trim() : null
  if (examTypeOpt && !evaluationInsert.exam_type) {
    evaluationInsert.exam_type = examTypeOpt
  }

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

  const returnedEvaluationId = typeof evaluation.id === "string" ? evaluation.id : String(evaluation.id)
  const evaluationId = isValidUUID(returnedEvaluationId) ? returnedEvaluationId : generatedEvaluationId
  if (!isValidUUID(evaluationId)) {
    return {
      saved: false,
      success: false,
      error: { step: "insert_evaluations", message: `evaluation_id inválido: ${returnedEvaluationId}` },
    }
  }
  if (isDev) console.info("[persist] evaluation created", evaluationId)

  if (!evaluationCourseId && batchPeerCourse.course_id && isValidUUID(batchPeerCourse.course_id)) {
    const { error: patchCourseErr } = await supabase
      .from("evaluations")
      .update({ course_id: batchPeerCourse.course_id })
      .eq("id", evaluationId)
    if (patchCourseErr && isDev) {
      console.warn("[persist] sync course_id desde lote:", patchCourseErr.message)
    }
  }

  // SNAPSHOT_NATIONAL_ANALYTICS_V1: evitar falso "saved: true" en persistencia parcial
  const childPersistError: { current: { step: string; message: string } | null } = { current: null }
  const registerChildError = (step: string, message: string) => {
    if (!childPersistError.current) childPersistError.current = { step, message }
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
  const profileCourseLabel = batchPeerCourse.course_label ?? safeCourseLabel

  for (const confirmedName of confirmedStudents) {
    try {
      const normalized = confirmedName.trim().toLowerCase()
      let profileId: string | null = null
      try {
        profileId = await ensureStudentProfile(supabase, {
          teacher_id: effective_teacher_id,
          school_id: effective_school_id,
          student_name: confirmedName,
          course_label: profileCourseLabel,
        })
        if (!profileId && effective_teacher_id) {
          profileId = await resolveStudentProfileLooseByTeacherAndName(supabase, effective_teacher_id, normalized)
        }
        if (!profileId && isDev) {
          console.warn(
            "[student_profile] sin perfil para",
            confirmedName.slice(0, 40),
            "— se guarda evaluation_students con student_profile_id null (reintentable / backfill)"
          )
        }
      } catch (linkErr) {
        if (isDev) {
          console.warn(
            "[student_profile] ensureStudentProfile excepción:",
            linkErr instanceof Error ? linkErr.message : String(linkErr)
          )
        }
      }
      const row: Record<string, unknown> = {
        evaluation_id: evaluationId,
        student_name: confirmedName,
        student_normalized: normalized,
        course_label: safeCourseLabel,
      }
      if (profileId) row.student_profile_id = profileId

      const upsertEvaluationStudent = async (payload: Record<string, unknown>) =>
        supabase.from("evaluation_students").upsert(payload, { onConflict: "evaluation_id,student_normalized" })

      let { error: esErr } = await upsertEvaluationStudent(row)
      const pgCode = (esErr as { code?: string } | null)?.code
      if (esErr && profileId && (pgCode === "23503" || String(esErr.message ?? "").toLowerCase().includes("foreign key"))) {
        const rowNoFk = { ...row, student_profile_id: null }
        const retry = await upsertEvaluationStudent(rowNoFk)
        esErr = retry.error
        profileId = null
        if (isDev && !retry.error) console.warn("[evaluation_students] upsert reintentado sin student_profile_id (FK inválida)")
      }
      if (esErr) registerChildError("upsert_evaluation_students", esErr.message)
      if (!esErr) {
        savedStudentNames.push(confirmedName)
        if (profileId) {
          profileIdsCollected.push(profileId)
          if (isDev) console.info("[student_profile] upsert evaluation_student ->", profileId)
        }
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
        skillRows.map((row) => {
          const agency = agencyFieldsFromSkillScores(row.score_obtained, row.score_max)
          return supabase
            .from("evaluation_skill_results")
            .insert({
              evaluation_id: evaluationId,
              student_profile_id: profileId,
              axis_id: row.axis_id,
              skill_id: row.skill_id,
              score_obtained: row.score_obtained,
              score_max: row.score_max,
              accuracy: row.accuracy,
              logro_pct: agency.logro_pct,
              achievement_level: agency.achievement_level,
            })
            .then(({ error }) => ({ error }))
        })
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

  const pipelineError = childPersistError.current
  if (!pipelineError) {
    try {
      const proj = await upsertStudentProjectionFromEvaluation(supabase, evaluationId)
      if (!proj.ok && isDev) {
        console.warn("[persist] student_projection:", proj.step, proj.message)
      }
    } catch (projErr) {
      if (isDev) {
        console.warn(
          "[persist] student_projection exception",
          projErr instanceof Error ? projErr.message : String(projErr)
        )
      }
    }
  }

  if (pipelineError) {
    return {
      saved: false,
      success: false,
      error: {
        step: pipelineError.step,
        message: `${pipelineError.message} (evaluation_id=${evaluationId})`,
      },
    }
  }

  return { saved: true, success: true, evaluation_id: evaluationId, status: "draft" }
}
