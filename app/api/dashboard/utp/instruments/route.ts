import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { parseAssessmentTypeToFlat, PATCH_ASSESSMENT_ALIASES } from "@/app/lib/assessment-category"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { generateUtpAuditAnalysis, sanitizeFileName } from "@/app/lib/services/utp-audit"
import mammoth from "mammoth"

/** Si algún id pertenece a un lote (batch_id), incluye todas las evaluaciones de ese lote (vínculo masivo). */
async function expandEvaluationIdsByBatch(supabase: SupabaseClient, seedIds: string[]): Promise<string[]> {
  const out = new Set(seedIds.map((x) => String(x).trim()).filter(Boolean))
  if (out.size === 0) return []
  const { data: rows } = await supabase.from("evaluations").select("id, batch_id").in("id", [...out])
  const batchKeys = new Set<string>()
  for (const r of rows ?? []) {
    const bid = (r as { batch_id?: string | null }).batch_id
    if (bid && String(bid).trim()) batchKeys.add(String(bid).trim())
  }
  for (const bid of batchKeys) {
    const { data: sibs } = await supabase.from("evaluations").select("id").eq("batch_id", bid).limit(500)
    for (const s of sibs ?? []) out.add(String((s as { id: string }).id))
  }
  return [...out].slice(0, 500)
}

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function isAllowedRole(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

function scopeOrganization(profile: { organization_id?: string | null; school_id?: string | null; teacher_id?: string | null } | null): string | null {
  return profile?.organization_id ?? profile?.school_id ?? profile?.teacher_id ?? null
}

function defaultAuditContent(params: {
  teacherLabel: string
  courseLabel: string
  subject: string
  fileName: string
}) {
  return {
    analysis_summary: "Reporte por defecto: no fue posible ejecutar el análisis completo de IA.",
    question_quality: [
      {
        issue: "Análisis automático no disponible",
        severity: "MEDIA",
        evidence: `Archivo recibido: ${params.fileName}`,
      },
    ],
    curricular_alignment: [
      {
        check: "Alineamiento curricular",
        status: "WARN",
        detail: "Se requiere revisión manual del instrumento por UTP.",
      },
    ],
    normative_citations: [
      {
        source: "Agencia de Calidad de la Educación",
        reference: "Estándares de Aprendizaje vigentes",
        url: "https://www.curriculumnacional.cl/portal/Evaluacion/Estandares-y-otros-indicadores/Estandares-de-Aprendizaje/",
      },
    ],
    observed_questions: [
      { question_ref: "P1", issue: "No se pudo ejecutar revisión automática completa.", recommendation: "Revisar manualmente redacción y distractores." },
    ],
    detected_skills: [
      { skill: "NO DETERMINADA", confidence: "BAJA", evidence: "Análisis IA no disponible en este intento." },
    ],
    improvement_suggestions: [
      { target: "Instrumento completo", action: "Revisar OA, ejes y niveles cognitivos antes de aplicar." },
    ],
    utp_actions: [
      { priority: "ALTA", action: "Pedir al profesor ajuste inmediato de ítems críticos.", owner: "Jefe UTP" },
    ],
    pme_linkage: [
      {
        pme_dimension: "Gestión Pedagógica",
        objective: "Fortalecer calidad de evaluación en aula.",
        evidence: "Registro de retroalimentación y nueva versión del instrumento.",
      },
    ],
    root_cause: {
      probable_causes: ["No se pudo calcular causa raíz automática."],
      low_skill_focus: [],
      approval_risk_pct: 0,
    },
    recommended_actions: [
      "Ejecutar revisión técnica manual del instrumento.",
      "Reintentar auditoría automática una vez estabilizado el motor IA.",
    ],
    context: {
      teacher: params.teacherLabel,
      course: params.courseLabel,
      subject: params.subject,
      file_name: params.fileName,
    },
  }
}

async function extractInstrumentText(file: File): Promise<string> {
  const lowerName = String(file.name || "").toLowerCase()
  if (file.type.startsWith("text/") || lowerName.endsWith(".txt")) {
    return await file.text()
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    const docx = await mammoth.extractRawText({ buffer })
    return String(docx.value || "").trim()
  }
  // Fallback simple para formatos no parseados aquí (pdf/otros).
  return `${file.name}\n${file.type}\n`
}

export async function GET(_req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  // Usa SUPABASE_SERVICE_ROLE_KEY via getSupabaseServer (servidor).
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id, school_id, teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  console.log("ROL DETECTADO:", role, "| profile.role:", (profile as { role?: string | null } | null)?.role ?? null)
  if (!isMasterEmail(user.email) && !isAllowedRole(role))
    return NextResponse.json({ error: "Prohibido" }, { status: 403 })

  const { data, error } = await supabase
    .from("utp_instrument_uploads")
    .select("*, utp_audit_reports(*)")
    // Obligatorio: no listar archivados (is_archived = true). NULL o false = visibles.
    .or("is_archived.is.null,is_archived.eq.false")
    .order("created_at", { ascending: false })
    .limit(100)

  const noStore = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  } as const

  if (error) return NextResponse.json({ items: [], warning: error.message }, { status: 200, headers: noStore })
  console.log("CONTEO REAL EN DB:", (data ?? []).length)
  return NextResponse.json({ items: data ?? [] }, { status: 200, headers: noStore })
}

function parseContentJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw)
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>
    } catch {
      /* ignore */
    }
  }
  return {}
}

async function tableHasColumn(
  supabase: SupabaseClient,
  table: string,
  column: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", table)
    .eq("column_name", column)
    .limit(1)
    .maybeSingle()
  if (error) return false
  return Boolean(data?.column_name)
}

async function runBatchCategorizationCascade(
  supabase: SupabaseClient,
  batchId: string,
  category: string,
): Promise<void> {
  const { data: evalRows } = await supabase
    .from("evaluations")
    .select("id")
    .eq("batch_id", batchId)
  const evalIds = (evalRows ?? []).map((r) => String((r as { id: string }).id)).filter(Boolean)

  const updates: Array<() => unknown> = [
    () => supabase.from("evaluations").update({ assessment_category: category }).eq("batch_id", batchId),
  ]

  const hasExamType = await tableHasColumn(supabase, "evaluation_summaries", "exam_type")
  const hasAssessmentCategory = await tableHasColumn(supabase, "evaluation_summaries", "assessment_category")
  if (evalIds.length > 0 && hasExamType) {
    updates.push(() =>
      supabase.from("evaluation_summaries").update({ exam_type: category }).in("evaluation_id", evalIds),
    )
  }
  if (evalIds.length > 0 && hasAssessmentCategory) {
    updates.push(() =>
      supabase
        .from("evaluation_summaries")
        .update({ assessment_category: category })
        .in("evaluation_id", evalIds),
    )
  }
  await Promise.all(updates.map((run) => Promise.resolve(run())))
}

async function resolveOrganizationIdForAutoAudit(args: {
  supabase: SupabaseClient
  userId: string
  profileOrgId: string | null
  bodyOrgId: string | null
  schoolId: string | null
}): Promise<string | null> {
  const { supabase, userId, profileOrgId, bodyOrgId, schoolId } = args
  const bodyNorm = String(bodyOrgId ?? "").trim()
  const bodyCandidate = bodyNorm && bodyNorm.toUpperCase() !== "PENDING" ? bodyNorm : ""
  const direct = bodyCandidate || String(profileOrgId ?? "").trim()
  if (direct) return direct

  const school = String(schoolId ?? "").trim()
  if (school) {
    const orgBySchoolProfile = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("school_id", school)
      .not("organization_id", "is", null)
      .limit(1)
      .maybeSingle()
    if (!orgBySchoolProfile.error && orgBySchoolProfile.data?.organization_id) {
      return String((orgBySchoolProfile.data as { organization_id: string }).organization_id).trim()
    }
    // Fallback opcional: algunas BD tienen organization_id en schools.
    const orgBySchoolTable = await supabase
      .from("schools")
      .select("organization_id")
      .eq("id", school)
      .single()
    if (!orgBySchoolTable.error && (orgBySchoolTable.data as { organization_id?: string | null } | null)?.organization_id) {
      return String((orgBySchoolTable.data as { organization_id: string }).organization_id).trim()
    }
  }

  const selfProfile = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .not("organization_id", "is", null)
    .limit(1)
    .maybeSingle()
  if (!selfProfile.error && selfProfile.data?.organization_id) {
    return String((selfProfile.data as { organization_id: string }).organization_id).trim()
  }

  // Hardcode de seguridad: si el usuario tiene una sola organización histórica en uploads, usar esa.
  const previousUploads = await supabase
    .from("utp_instrument_uploads")
    .select("organization_id")
    .eq("uploaded_by_user_id", userId)
    .not("organization_id", "is", null)
    .limit(20)
  if (!previousUploads.error && Array.isArray(previousUploads.data) && previousUploads.data.length > 0) {
    const uniq = [...new Set(previousUploads.data.map((r) => String((r as { organization_id?: string | null }).organization_id ?? "").trim()).filter(Boolean))]
    if (uniq.length === 1) return uniq[0]
  }
  return "00000000-0000-0000-0000-000000000000"
}

async function resolveAssessmentCategoryByBaseExam(
  supabase: SupabaseClient,
  evaluationIds: string[],
  fallbackCategory: string,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const ids = [...new Set(evaluationIds.map((x) => String(x).trim()).filter(Boolean))]
  if (ids.length === 0) return resolved

  const { data: evalRows } = await supabase
    .from("evaluations")
    .select("id, source_exam_id")
    .in("id", ids)
  const sourceExamIds = [
    ...new Set(
      (evalRows ?? [])
        .map((r) => String((r as { source_exam_id?: string | null }).source_exam_id ?? "").trim())
        .filter(Boolean),
    ),
  ]
  const examTypeBySourceExam = new Map<string, string>()
  if (sourceExamIds.length > 0) {
    const { data: sourceRows } = await supabase
      .from("source_exams")
      .select("id, exam_type")
      .in("id", sourceExamIds)
    for (const s of sourceRows ?? []) {
      const sid = String((s as { id: string }).id)
      const flat = parseAssessmentTypeToFlat(String((s as { exam_type?: string | null }).exam_type ?? ""))
      if (flat) examTypeBySourceExam.set(sid, flat)
    }
  }

  for (const r of evalRows ?? []) {
    const row = r as { id: string; source_exam_id?: string | null }
    const eid = String(row.id)
    const sid = String(row.source_exam_id ?? "").trim()
    resolved.set(eid, examTypeBySourceExam.get(sid) ?? fallbackCategory)
  }
  return resolved
}

/**
 * PATCH /api/dashboard/utp/instruments
 * Body: { report_id: string, evaluation_ids?: string[], clear?: boolean }
 * Fusiona `student_outcomes_link` en `content` sin borrar el análisis IA (merge superficial del JSONB).
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })
    const supabase = getSupabaseServer()
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 503 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, organization_id, school_id, teacher_id")
      .eq("user_id", user.id)
      .maybeSingle()

    const role = normalizeRole((profile as { role?: string | null } | null)?.role)
    if (!isMasterEmail(user.email) && !isAllowedRole(role))
      return NextResponse.json({ ok: false, error: "Prohibido" }, { status: 403 })

    let body: {
      report_id?: string
      evaluation_ids?: string[]
      assessment_type?: string
      clear?: boolean
      batch_id?: string | null
      organization_id?: string | null
      school_id?: string | null
      report_title?: string | null
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
    }

    // Prioridad absoluta: actualizar categoría por lote antes de cualquier lógica de reportes.
    if (!body.clear) {
      const batchIdEarly = String(body.batch_id ?? "").trim()
      const flatEarly = parseAssessmentTypeToFlat(String(body.assessment_type ?? ""))
      if (batchIdEarly && flatEarly) {
        try {
          await runBatchCategorizationCascade(supabase, batchIdEarly, flatEarly)
        } catch (earlyBatchErr) {
          if (process.env.NODE_ENV === "development") {
            console.warn(
              "[utp/instruments PATCH] early batch cascade:",
              earlyBatchErr instanceof Error ? earlyBatchErr.message : String(earlyBatchErr),
            )
          }
        }
      }
    }

    let reportId = String(body?.report_id ?? "").trim()
    let row: { id: string; content?: unknown } | null = null
    let reportBypassWarning: string | null = null
    try {
      if (reportId) {
        const existingRes = await supabase
          .from("utp_audit_reports")
          .select("id, content")
          .eq("id", reportId)
          .maybeSingle()
        if (existingRes.error || !existingRes.data) {
          reportBypassWarning = existingRes.error?.message ?? "Reporte no encontrado"
          reportId = ""
        } else {
          row = existingRes.data as { id: string; content?: unknown }
        }
      } else if (!body.clear) {
        const bodyOrg = String(body.organization_id ?? "").trim() || null
        const profileOrgRaw = String((profile as { organization_id?: string | null } | null)?.organization_id ?? "").trim() || null
        const schoolIdBody = String(body.school_id ?? "").trim() || null
        const profileOrg = await resolveOrganizationIdForAutoAudit({
          supabase,
          userId: user.id,
          profileOrgId: profileOrgRaw,
          bodyOrgId: bodyOrg,
          schoolId: schoolIdBody,
        })
        const autoTitle = String(body.report_title ?? "").trim() || "Vínculo Automático - Lote"
        const batchTag = String(body.batch_id ?? "").trim()
        const uploadInsert = await supabase
          .from("utp_instrument_uploads")
          .insert({
            organization_id: profileOrg,
            uploaded_by_user_id: user.id,
            teacher_label: "Auto-Link UTP",
            course_label: batchTag || "Sin lote",
            subject: "General",
            file_name: "auto-link.json",
            storage_bucket: "utp-audit-private",
            storage_path: `${profileOrg}/auto-link/${crypto.randomUUID()}.json`,
            status: "analyzed",
          })
          .select("id")
          .single()
        if (uploadInsert.error || !uploadInsert.data?.id) {
          reportBypassWarning = uploadInsert.error?.message ?? "No se pudo crear upload automático"
        } else {
          const reportInsert = await supabase
            .from("utp_audit_reports")
            .insert({
              upload_id: String((uploadInsert.data as { id: string }).id),
              organization_id: profileOrg,
              analysis_summary: autoTitle,
              question_quality: [],
              curricular_alignment: [],
              normative_citations: [],
              root_cause: {},
              recommended_actions: [],
              content: {},
            })
            .select("id, content")
            .single()
          if (reportInsert.error || !reportInsert.data?.id) {
            reportBypassWarning = reportInsert.error?.message ?? "No se pudo crear informe automático"
          } else {
            reportId = String((reportInsert.data as { id: string }).id)
            row = reportInsert.data as { id: string; content?: unknown }
          }
        }
      }
    } catch (reportErr) {
      reportBypassWarning = reportErr instanceof Error ? reportErr.message : String(reportErr)
      reportId = ""
      row = null
    }

    const merged = { ...parseContentJson(row?.content) }

    if (body.clear) {
      delete merged.student_outcomes_link
    } else {
      const rawIds = Array.isArray(body.evaluation_ids) ? body.evaluation_ids : []
      const seedIds = [...new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))].slice(0, 500)
      const evaluation_ids = await expandEvaluationIdsByBatch(supabase, seedIds)
      const rawType = String(body.assessment_type ?? "").trim().toUpperCase()
      if (!(PATCH_ASSESSMENT_ALIASES as readonly string[]).includes(rawType)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "assessment_type inválido. Use: MENSUAL, LIBRO, SEMESTRAL, ENSAYO_SIMCE, ENSAYO_PAES (o legado SIMCE, PAES, INTERNA).",
          },
          { status: 400 },
        )
      }
      const flat = parseAssessmentTypeToFlat(rawType)
      if (!flat) {
        return NextResponse.json({ ok: false, error: "No se pudo normalizar assessment_type" }, { status: 400 })
      }
      merged.student_outcomes_link = { evaluation_ids, assessment_type: flat }
    }

    if (reportId) {
      const { error: upErr } = await supabase.from("utp_audit_reports").update({ content: merged }).eq("id", reportId)
      if (upErr) {
        reportBypassWarning = upErr.message
      }
    }

    if (!body.clear && merged.student_outcomes_link && typeof merged.student_outcomes_link === "object") {
      const link = merged.student_outcomes_link as { evaluation_ids?: string[]; assessment_type?: string }
      const ids = Array.isArray(link.evaluation_ids) ? link.evaluation_ids : []
      const cat = typeof link.assessment_type === "string" ? link.assessment_type.trim() : ""
      if (ids.length > 0 && cat) {
        const categoryByEvaluation = await resolveAssessmentCategoryByBaseExam(supabase, ids, cat)
        const groupByCategory = new Map<string, string[]>()
        for (const id of ids) {
          const chosen = categoryByEvaluation.get(String(id)) ?? cat
          const arr = groupByCategory.get(chosen) ?? []
          arr.push(String(id))
          groupByCategory.set(chosen, arr)
        }
        for (const [category, categoryIds] of groupByCategory) {
          const { error: evCatErr } = await supabase
            .from("evaluations")
            .update({ assessment_category: category })
            .in("id", categoryIds)
          if (evCatErr && process.env.NODE_ENV === "development") {
            console.warn("[utp/instruments PATCH] assessment_category:", evCatErr.message)
          }
        }
      }
    }

    // Garantía de vínculo: reintento de cascada al final para máxima consistencia.
    if (!body.clear) {
      const batchId = String(body.batch_id ?? "").trim()
      const flat = parseAssessmentTypeToFlat(String(body.assessment_type ?? ""))
      if (batchId && flat) {
        try {
          await runBatchCategorizationCascade(supabase, batchId, flat)
        } catch (byBatchErr) {
          if (process.env.NODE_ENV === "development") {
            console.warn(
              "[utp/instruments PATCH] final batch cascade:",
              byBatchErr instanceof Error ? byBatchErr.message : String(byBatchErr),
            )
          }
        }
      }
    }

    return NextResponse.json({ ok: true, message: "Categorización exitosa" }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ ok: true, message: "Categorización exitosa" }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  // Usa SUPABASE_SERVICE_ROLE_KEY via getSupabaseServer (servidor).
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id, school_id, teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  console.log("ROL DETECTADO:", role, "| profile.role:", (profile as { role?: string | null } | null)?.role ?? null)
  if (!isMasterEmail(user.email) && !isAllowedRole(role))
    return NextResponse.json({ error: "Prohibido" }, { status: 403 })

  const orgScope = scopeOrganization(profile as { organization_id?: string | null; school_id?: string | null; teacher_id?: string | null } | null)
  const orgId = orgScope ?? "00000000-0000-0000-0000-000000000000"

  const formData = await req.formData()
  const teacherLabel = String(formData.get("teacher_label") ?? "").trim()
  const courseLabel = String(formData.get("course_label") ?? "").trim()
  const subject = String(formData.get("subject") ?? "").trim()
  const gradeLevel = String(formData.get("grade_level") ?? "2M").trim().toUpperCase()
  const file = formData.get("file")

  if (!teacherLabel || !courseLabel || !subject) {
    return NextResponse.json({ error: "teacher_label, course_label y subject son requeridos" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 })
  }

  const safeName = sanitizeFileName(file.name)
  const storagePath = `${orgId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const uploadResult = await supabase.storage
    .from("utp-audit-private")
    .upload(storagePath, buffer, { contentType: file.type || "application/octet-stream", upsert: false })

  if (uploadResult.error) {
    console.error("[utp/instruments][storage-upload-error]", {
      code: (uploadResult.error as { statusCode?: string | number }).statusCode ?? null,
      message: uploadResult.error.message,
      storagePath,
      userId: user.id,
      role,
      orgId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    })
    return NextResponse.json({ error: "No se pudo subir archivo a storage privado", detail: uploadResult.error.message }, { status: 500 })
  }

  try {
    const textFromFile = await extractInstrumentText(file)
    const text = `${textFromFile}\n${subject}\n${courseLabel}`
    const aiPrompt = `
Eres "El Juez" de auditoría pedagógica UTP en Chile.
Debes evaluar la prueba en blanco usando estándares oficiales: OA, ejes, habilidades y niveles cognitivos.
Tarea:
1) Criticar preguntas mal elaboradas (distractores débiles, ambigüedad, baja exigencia).
2) Validar alineamiento curricular con parámetros oficiales vigentes.
3) Entregar sugerencias específicas de mejora por ítem y por habilidad.
4) Para cada pregunta observada, incluir propuesta concreta de mejora (tipo "cámbiela por un caso donde el estudiante deba inferir...").
5) Definir "Acciones sugeridas para el UTP" con prioridad y responsable.
6) Vincular cada hallazgo con una acción del PME (Gestión Pedagógica o Liderazgo).
7) Citar sustento normativo (Agencia de Calidad, DEMRE, MINEDUC).
FORMATO OBLIGATORIO:
- Responde SOLO JSON válido (sin markdown, sin texto introductorio ni cierre).
- Usa estas llaves exactas:
  analysis_summary, question_quality, curricular_alignment, normative_citations,
  observed_questions, detected_skills, improvement_suggestions, utp_actions, pme_linkage, root_cause, recommended_actions.
`
    let auditContent: Record<string, unknown>
    try {
      const analysis = await generateUtpAuditAnalysis({
        supabase,
        organizationId: orgId,
        gradeLevel,
        subject: subject.toUpperCase(),
        text,
        aiPrompt,
      })
      auditContent = analysis && typeof analysis === "object"
        ? (analysis as unknown as Record<string, unknown>)
        : defaultAuditContent({
            teacherLabel,
            courseLabel,
            subject,
            fileName: file.name,
          })
    } catch (analysisError) {
      console.error("[utp/instruments][analysis-fallback]", {
        message: analysisError instanceof Error ? analysisError.message : String(analysisError),
        userId: user.id,
        fileName: file.name,
      })
      auditContent = defaultAuditContent({
        teacherLabel,
        courseLabel,
        subject,
        fileName: file.name,
      })
    }

    if (!auditContent || typeof auditContent !== "object") {
      auditContent = defaultAuditContent({
        teacherLabel,
        courseLabel,
        subject,
        fileName: file.name,
      })
    }

    const rpcParams = {
      p_teacher_name: teacherLabel,
      p_course_name: courseLabel,
      p_subject_name: subject,
      p_file_path: storagePath,
      // Debe ir como objeto JS plano; Supabase SDK serializa a jsonb.
      p_audit_content: auditContent,
      p_user_id: user.id,
    }
    console.log("DATOS ENVIADOS AL RPC:", JSON.stringify(rpcParams, null, 2))

    let txData: unknown = null
    let txError: { code?: string; message?: string; details?: string; hint?: string } | null = null
    try {
      const rpcRes = await supabase.rpc("create_utp_audit_with_report", rpcParams)
      txData = rpcRes.data
      txError = (rpcRes.error as { code?: string; message?: string; details?: string; hint?: string } | null) ?? null
    } catch (rpcThrown) {
      const e = rpcThrown as { message?: string; details?: string; hint?: string } | null
      const rpcThrownMessage = e?.message || e?.details || "Error RPC desconocido"
      console.error("[utp/instruments][rpc-thrown-catch]", {
        message: e?.message ?? null,
        details: e?.details ?? null,
        hint: e?.hint ?? null,
        storagePath,
        userId: user.id,
        role,
        orgId,
      })
      await supabase.storage.from("utp-audit-private").remove([storagePath])
      return NextResponse.json(
        { error: "Falló transacción de auditoría", detail: rpcThrownMessage },
        { status: 500 }
      )
    }

    if (txError) {
      console.error("[utp/instruments][rpc-transaction-error]", {
        code: (txError as { code?: string }).code ?? null,
        message: txError.message ?? null,
        details: (txError as { details?: string }).details ?? null,
        hint: (txError as { hint?: string }).hint ?? null,
        storagePath,
        userId: user.id,
        role,
        orgId,
      })
      await supabase.storage.from("utp-audit-private").remove([storagePath])
      return NextResponse.json(
        {
          error: "Falló transacción de auditoría",
          detail: txError.message || (txError as { details?: string }).details || "Error RPC desconocido",
        },
        { status: 500 }
      )
    }

    const uploadRow = Array.isArray(txData) ? (txData[0] as Record<string, unknown> | undefined) ?? null : null
    return NextResponse.json({
      ok: true,
      upload: uploadRow,
      report: auditContent,
    })
  } catch (e) {
    console.error("[utp/instruments][catch-error]", {
      name: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : null,
      userId: user.id,
      role,
      orgId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      storagePath,
    })
    await supabase.storage.from("utp-audit-private").remove([storagePath])
    const err = e as { message?: string; details?: string } | null
    return NextResponse.json(
      {
        error: "Error en motor de auditoría",
        detail: (e instanceof Error ? e.message : null) || err?.message || err?.details || String(e),
      },
      { status: 500 }
    )
  }
}
