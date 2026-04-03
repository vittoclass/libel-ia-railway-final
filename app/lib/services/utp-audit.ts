import type { SupabaseClient } from "@supabase/supabase-js"
import OpenAI from "openai"

type IssueSeverity = "BAJA" | "MEDIA" | "ALTA"

export type UtpAuditAnalysis = {
  analysis_summary: string
  question_quality: Array<{ issue: string; severity: IssueSeverity; evidence: string }>
  curricular_alignment: Array<{ check: string; status: "OK" | "WARN"; detail: string }>
  normative_citations: Array<{ source: string; reference: string; url: string }>
  observed_questions: Array<{ question_ref: string; issue: string; recommendation: string }>
  detected_skills: Array<{ skill: string; confidence: "ALTA" | "MEDIA" | "BAJA"; evidence: string }>
  improvement_suggestions: Array<{ target: string; action: string }>
  utp_actions: Array<{ priority: "ALTA" | "MEDIA" | "BAJA"; action: string; owner: string }>
  pme_linkage: Array<{ pme_dimension: string; objective: string; evidence: string }>
  root_cause: {
    probable_causes: string[]
    low_skill_focus: string[]
    approval_risk_pct: number
  }
  recommended_actions: string[]
}

export function sanitizeFileName(name: string): string {
  return String(name || "instrumento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
}

function splitQuestions(rawText: string): string[] {
  const text = String(rawText || "")
  if (!text.trim()) return []
  const byNumber = text.split(/\n\s*(?:\d+[\)\.\-]|PREGUNTA\s+\d+[:\-])\s*/i).map((s) => s.trim()).filter(Boolean)
  if (byNumber.length >= 3) return byNumber
  const byLine = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  return byLine
}

function evaluateQuestionQuality(questions: string[]): UtpAuditAnalysis["question_quality"] {
  const out: UtpAuditAnalysis["question_quality"] = []
  if (questions.length === 0) {
    out.push({
      issue: "No se detectaron preguntas estructuradas",
      severity: "ALTA",
      evidence: "El archivo no contiene bloques identificables de ítems.",
    })
    return out
  }
  const longStatements = questions.filter((q) => q.length > 280).length
  if (longStatements > 0) {
    out.push({
      issue: "Enunciados extensos potencialmente confusos",
      severity: "MEDIA",
      evidence: `${longStatements} ítems superan 280 caracteres.`,
    })
  }
  const weakDistractors = questions.filter((q) => {
    const options = q.match(/[A-D]\)/g) ?? []
    return options.length > 0 && options.length < 4
  }).length
  if (weakDistractors > 0) {
    out.push({
      issue: "Distractores débiles o incompletos",
      severity: "ALTA",
      evidence: `${weakDistractors} ítems presentan menos de 4 alternativas.`,
    })
  }
  const lowRigor = questions.filter((q) => !/(analiza|justifica|argumenta|modela|infiere|evalua)/i.test(q)).length
  const lowRigorPct = Math.round((lowRigor / Math.max(1, questions.length)) * 100)
  if (lowRigorPct >= 60) {
    out.push({
      issue: "Bajo rigor cognitivo",
      severity: "MEDIA",
      evidence: `${lowRigorPct}% de ítems no evidencian verbos cognitivos de nivel medio/alto.`,
    })
  }
  if (out.length === 0) {
    out.push({
      issue: "Calidad basal aceptable",
      severity: "BAJA",
      evidence: "No se detectaron señales críticas automáticas en redacción y estructura.",
    })
  }
  return out
}

async function evaluateCurricularAlignment(
  supabase: SupabaseClient,
  organizationId: string,
  gradeLevel: string,
  subject: string
): Promise<UtpAuditAnalysis["curricular_alignment"]> {
  const checks: UtpAuditAnalysis["curricular_alignment"] = []

  const { data: cutsRows } = await supabase
    .from("pedagogical_parameters")
    .select("id, parameter_key, year")
    .eq("parameter_type", "AGENCY_LEVEL_CUTS")
    .eq("is_active", true)
    .eq("organization_id", organizationId)
    .or(`grade_level.eq.${gradeLevel},grade_level.is.null`)
    .order("year", { ascending: false })
    .limit(1)

  if ((cutsRows ?? []).length > 0) {
    checks.push({
      check: "Cortes Agencia vigentes",
      status: "OK",
      detail: `Se encontró ${cutsRows?.[0]?.parameter_key ?? "parámetro activo"} para ${gradeLevel}.`,
    })
  } else {
    checks.push({
      check: "Cortes Agencia vigentes",
      status: "WARN",
      detail: `No hay cortes activos específicos para ${gradeLevel}; usar fallback referencial.`,
    })
  }

  const { data: demreRows } = await supabase
    .from("pedagogical_parameters")
    .select("id, parameter_key, year")
    .eq("parameter_type", "DEMRE_PAES_TABLE")
    .eq("is_active", true)
    .eq("organization_id", organizationId)
    .or(`subject.eq.${subject},subject.is.null`)
    .order("year", { ascending: false })
    .limit(1)

  checks.push({
    check: "Tabla de conversión DEMRE",
    status: (demreRows ?? []).length > 0 ? "OK" : "WARN",
    detail:
      (demreRows ?? []).length > 0
        ? `Tabla activa ${demreRows?.[0]?.parameter_key ?? ""}.`
        : "No se encontró tabla DEMRE activa para esta asignatura.",
  })

  return checks
}

async function buildRootCause(
  supabase: SupabaseClient,
  organizationId: string
): Promise<UtpAuditAnalysis["root_cause"]> {
  const { data: projections } = await supabase
    .from("student_projections")
    .select("logro_pct, risk_level, skills_breakdown")
    .eq("organization_id", organizationId)
    .order("calculated_at", { ascending: false })
    .limit(500)

  const rows = projections ?? []
  const low = rows.filter((r) => Number(r.logro_pct) < 50).length
  const approvalRisk = Math.round((low / Math.max(1, rows.length)) * 100)

  const probable_causes: string[] = []
  if (approvalRisk >= 40) probable_causes.push("Alta concentración de estudiantes bajo 50% de logro.")
  if (rows.some((r) => String(r.risk_level || "").toUpperCase() === "CRITICO")) {
    probable_causes.push("Se observan casos críticos persistentes sin intervención diferenciada.")
  }
  if (probable_causes.length === 0) probable_causes.push("Resultados estables; foco en mejora de desempeño intermedio.")

  return {
    probable_causes,
    low_skill_focus: ["MODELACION", "RESOLUCION_DE_PROBLEMAS"],
    approval_risk_pct: approvalRisk,
  }
}

export async function generateUtpAuditAnalysis(input: {
  supabase: SupabaseClient
  organizationId: string
  gradeLevel: string
  subject: string
  text: string
  aiPrompt?: string
}): Promise<UtpAuditAnalysis> {
  const questions = splitQuestions(input.text)
  const question_quality = evaluateQuestionQuality(questions)
  const curricular_alignment = await evaluateCurricularAlignment(
    input.supabase,
    input.organizationId,
    input.gradeLevel,
    input.subject
  )
  const root_cause = await buildRootCause(input.supabase, input.organizationId)

  const normative_citations = [
    {
      source: "Agencia de Calidad de la Educación",
      reference: "Estándares de Aprendizaje (Insuficiente, Elemental, Adecuado)",
      url: "https://www.curriculumnacional.cl/portal/Evaluacion/Estandares-y-otros-indicadores/Estandares-de-Aprendizaje/",
    },
    {
      source: "DEMRE",
      reference: "Tablas de Transformación de Puntajes PAES",
      url: "https://demre.cl/paes/factores-seleccion/tabla-transformacion-puntajes",
    },
    {
      source: "MINEDUC",
      reference: "Orientaciones PME y Gestión Pedagógica",
      url: "https://sac.mineduc.cl/dimension-gestion-pedagogica/",
    },
  ]

  const hasHighIssue = question_quality.some((q) => q.severity === "ALTA")
  const analysis_summary = hasHighIssue
    ? "Se detectan hallazgos preventivos de alto impacto en calidad de ítems y alineamiento curricular."
    : "Instrumento con cumplimiento basal; se sugieren mejoras focalizadas para fortalecer rigor y trazabilidad."

  const recommended_actions = [
    "Reescribir ítems con distractores funcionales y criterio de plausibilidad pedagógica.",
    "Etiquetar cada ítem con OA, eje y habilidad antes de su aplicación masiva.",
    "Aplicar pilotaje breve con análisis de discriminación antes de uso formal.",
    "Monitorear semanalmente casos en riesgo ALTO/CRITICO y ajustar secuencias didácticas.",
  ]

  const detected_skills: UtpAuditAnalysis["detected_skills"] = [
    { skill: "RESOLUCIÓN DE PROBLEMAS", confidence: "MEDIA", evidence: "Presencia parcial de verbos de aplicación y análisis." },
    { skill: "MODELACIÓN", confidence: "BAJA", evidence: "Baja frecuencia de problemas contextualizados." },
  ]

  const observed_questions: UtpAuditAnalysis["observed_questions"] = questions.slice(0, 5).map((q, idx) => ({
    question_ref: `P${idx + 1}`,
    issue: q.length > 280 ? "Enunciado extenso y potencialmente ambiguo." : "Revisar precisión del enunciado y distractores.",
    recommendation: "Acotar redacción y explicitar habilidad evaluada (OA/Eje/Nivel cognitivo).",
  }))

  const improvement_suggestions: UtpAuditAnalysis["improvement_suggestions"] = [
    { target: "Diseño de ítems", action: "Fortalecer distractores plausibles y eliminar alternativas obvias." },
    { target: "Alineamiento curricular", action: "Mapear cada ítem a OA, eje y nivel cognitivo antes de aplicar." },
  ]
  const utp_actions: UtpAuditAnalysis["utp_actions"] = [
    {
      priority: "ALTA",
      action: "Solicitar al docente reformulación de ítems observados con foco en inferencia y argumentación.",
      owner: "Jefe UTP",
    },
    {
      priority: "MEDIA",
      action: "Revisar pauta de corrección y calibrar distractores con equipo de asignatura.",
      owner: "UTP + Coordinación de Departamento",
    },
  ]
  const pme_linkage: UtpAuditAnalysis["pme_linkage"] = [
    {
      pme_dimension: "Gestión Pedagógica",
      objective: "Fortalecer calidad de instrumentos y evaluación auténtica.",
      evidence: "Acta de revisión UTP + versión corregida del instrumento.",
    },
    {
      pme_dimension: "Liderazgo",
      objective: "Monitorear decisiones pedagógicas con evidencia técnica.",
      evidence: "Seguimiento mensual de mejoras por asignatura.",
    },
  ]

  const baseline: UtpAuditAnalysis = {
    analysis_summary,
    question_quality,
    curricular_alignment,
    normative_citations,
    observed_questions,
    detected_skills,
    improvement_suggestions,
    utp_actions,
    pme_linkage,
    root_cause,
    recommended_actions,
  }

  const openAiKey = process.env.OPENAI_API_KEY
  if (!openAiKey) return baseline

  try {
    const openai = new OpenAI({ apiKey: openAiKey })
    const prompt = input.aiPrompt ?? `
Actúa como auditor UTP experto en currículum chileno y mentor pedagógico.
Analiza el instrumento y devuelve JSON estricto con:
analysis_summary, question_quality[], curricular_alignment[], normative_citations[], observed_questions[], detected_skills[], improvement_suggestions[], utp_actions[], pme_linkage[], root_cause, recommended_actions[].
No inventes fuentes: usa Agencia, DEMRE y MINEDUC.
RESPUESTA OBLIGATORIA: solo JSON válido, sin texto adicional.
`
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify({
            grade_level: input.gradeLevel,
            subject: input.subject,
            text_excerpt: input.text.slice(0, 12000),
            curricular_alignment,
            root_cause,
          }),
        },
      ],
      response_format: { type: "json_object" },
    })
    const raw = completion.choices?.[0]?.message?.content
    if (!raw) return baseline
    const parsed = JSON.parse(raw) as Partial<UtpAuditAnalysis>
    return {
      analysis_summary: parsed.analysis_summary ?? baseline.analysis_summary,
      question_quality: Array.isArray(parsed.question_quality) ? parsed.question_quality as UtpAuditAnalysis["question_quality"] : baseline.question_quality,
      curricular_alignment: Array.isArray(parsed.curricular_alignment) ? parsed.curricular_alignment as UtpAuditAnalysis["curricular_alignment"] : baseline.curricular_alignment,
      normative_citations: Array.isArray(parsed.normative_citations) ? parsed.normative_citations as UtpAuditAnalysis["normative_citations"] : baseline.normative_citations,
      observed_questions: Array.isArray(parsed.observed_questions) ? parsed.observed_questions as UtpAuditAnalysis["observed_questions"] : baseline.observed_questions,
      detected_skills: Array.isArray(parsed.detected_skills) ? parsed.detected_skills as UtpAuditAnalysis["detected_skills"] : baseline.detected_skills,
      improvement_suggestions: Array.isArray(parsed.improvement_suggestions) ? parsed.improvement_suggestions as UtpAuditAnalysis["improvement_suggestions"] : baseline.improvement_suggestions,
      utp_actions: Array.isArray(parsed.utp_actions) ? parsed.utp_actions as UtpAuditAnalysis["utp_actions"] : baseline.utp_actions,
      pme_linkage: Array.isArray(parsed.pme_linkage) ? parsed.pme_linkage as UtpAuditAnalysis["pme_linkage"] : baseline.pme_linkage,
      root_cause: parsed.root_cause ?? baseline.root_cause,
      recommended_actions: Array.isArray(parsed.recommended_actions) ? parsed.recommended_actions : baseline.recommended_actions,
    }
  } catch {
    return baseline
  }
}
