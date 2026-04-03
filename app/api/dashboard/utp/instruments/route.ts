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
  // MODO DIAGNOSTICO TEMPORAL: sin filtros user/org.
  const { data, error } = await supabase
    .from("utp_instrument_uploads")
    .select("*, utp_audit_reports(*)")
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ items: [], warning: error.message }, { status: 200 })
  console.log("CONTEO REAL EN DB:", (data ?? []).length)
  return NextResponse.json({ items: data ?? [] })
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

    let body: { report_id?: string; evaluation_ids?: string[]; assessment_type?: string; clear?: boolean }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
    }

    const reportId = String(body?.report_id ?? "").trim()
    if (!reportId) return NextResponse.json({ ok: false, error: "report_id es requerido" }, { status: 400 })

    const { data: row, error: fetchErr } = await supabase
      .from("utp_audit_reports")
      .select("id, content")
      .eq("id", reportId)
      .maybeSingle()

    if (fetchErr || !row) {
      return NextResponse.json({ ok: false, error: fetchErr?.message ?? "Reporte no encontrado" }, { status: 200 })
    }

    const merged = { ...parseContentJson((row as { content?: unknown }).content) }

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

    const { error: upErr } = await supabase.from("utp_audit_reports").update({ content: merged }).eq("id", reportId)

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 200 })
    }

    if (!body.clear && merged.student_outcomes_link && typeof merged.student_outcomes_link === "object") {
      const link = merged.student_outcomes_link as { evaluation_ids?: string[]; assessment_type?: string }
      const ids = Array.isArray(link.evaluation_ids) ? link.evaluation_ids : []
      const cat = typeof link.assessment_type === "string" ? link.assessment_type.trim() : ""
      if (ids.length > 0 && cat) {
        const { error: evCatErr } = await supabase.from("evaluations").update({ assessment_category: cat }).in("id", ids)
        if (evCatErr && process.env.NODE_ENV === "development") {
          console.warn("[utp/instruments PATCH] assessment_category:", evCatErr.message)
        }
      }
    }

    return NextResponse.json({ ok: true, content: merged }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
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
