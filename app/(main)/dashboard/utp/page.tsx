"use client"

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { exportUtpExecutiveFichaPdf } from "@/app/lib/export-utp-dashboard-pdf"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { EvaluationLinkSelector } from "@/app/components/dashboard/utp/EvaluationLinkSelector"
import { ResultsMirror } from "@/app/components/dashboard/utp/ResultsMirror"
import { UtpAuditoriaJuezPanel } from "@/app/components/dashboard/utp/UtpAuditoriaJuezPanel"
import { UtpPendingBatchReleasesPanel } from "@/app/components/dashboard/utp/UtpPendingBatchReleasesPanel"
import { UtpExecutivePdfCapture } from "@/app/components/dashboard/utp/UtpExecutivePdfCapture"
import { UtpDemoReportBlock } from "@/app/components/dashboard/utp/UtpDemoReportBlock"
import { UtpByTeacherBlock } from "@/app/components/dashboard/utp/UtpByTeacherBlock"
import { UtpChartsBlock } from "@/app/components/dashboard/utp/UtpChartsBlock"
import {
  uiCoberturaBajada,
  uiCoberturaTitulo,
  uiLegacyTooltipCoberturaCol,
  uiLegacyTooltipEstandarCol,
  uiPaesProyectadoBajada,
  uiPaesProyectadoTitulo,
  uiSimceProyectadoBajada,
  uiSimceProyectadoTitulo,
  uiSemaforoBajada,
  uiSemaforoTitulo,
  uiTablaCoberturaCol,
  uiTablaEstandarAgenciaCol,
} from "@/app/lib/pedagogic-ui-copy"
import { formatDateTimeEsCl } from "@/app/lib/format-datetime-es-cl"
import { formatStudentDisplayName } from "@/app/lib/format-student-name"

type AuditRow = {
  id: string
  actor_name: string
  action: string
  student_or_course: string
  created_at: string | null
}

type RiskRow = {
  id: string
  student_id: string | null
  evaluation_id: string | null
  logro_pct: number
  agency_level: string | null
  paes_estimated: number | null
  risk_level: string | null
  calculated_at: string | null
}

type SchoolAnalyticsRow = {
  skill_name: string
  subject: string | null
  avg_logro_pct: number | null
  student_result_rows: number
}

type DireccionCourseBreakdownRow = {
  course_key: string
  course_display: string
  evaluation_count: number
  avg_logro_pct: number | null
  simce_projection: number | null
  paes_projection: number | null
}

type DireccionSegmentBreakdownRow = {
  subject_key: string
  subject_display: string
  instrument_family: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
  evaluation_count: number
  avg_logro_pct: number | null
  simce_projection: number | null
  paes_projection: number | null
  course_breakdown: DireccionCourseBreakdownRow[]
}

function parseDireccionCourseBreakdownFromApi(raw: unknown): DireccionCourseBreakdownRow[] {
  if (!Array.isArray(raw)) return []
  const out: DireccionCourseBreakdownRow[] = []
  for (const c of raw) {
    if (!c || typeof c !== "object") continue
    const o = c as Record<string, unknown>
    if (typeof o.course_key !== "string" || typeof o.course_display !== "string") continue
    const n = Number(o.evaluation_count)
    if (!Number.isFinite(n)) continue
    const avgRaw = o.avg_logro_pct
    const avg_logro_pct =
      avgRaw == null ? null : Number.isFinite(Number(avgRaw)) ? Number(avgRaw) : null
    const simRaw = o.simce_projection
    const paesRaw = o.paes_projection
    out.push({
      course_key: o.course_key,
      course_display: o.course_display,
      evaluation_count: n,
      avg_logro_pct,
      simce_projection: simRaw != null && Number.isFinite(Number(simRaw)) ? Number(simRaw) : null,
      paes_projection: paesRaw != null && Number.isFinite(Number(paesRaw)) ? Number(paesRaw) : null,
    })
  }
  return out
}

function formatDireccionSegmentProjection(
  instrument_family: DireccionSegmentBreakdownRow["instrument_family"],
  simce_projection: number | null,
  paes_projection: number | null,
): string {
  if (instrument_family === "SIMCE" && simce_projection != null && Number.isFinite(Number(simce_projection))) {
    return `SIMCE ${Math.round(Number(simce_projection))} (200–350)`
  }
  if (instrument_family === "PAES" && paes_projection != null && Number.isFinite(Number(paes_projection))) {
    return `PAES ${Math.round(Number(paes_projection))} (100–1000)`
  }
  return "—"
}

type SchoolAnalyticsPayload = {
  school_id: string | null
  evaluation_count: number
  evaluation_count_total?: number
  summary_available?: boolean
  status_reason?: string
  segmentation?: Array<{
    subject_key: string
    subject_display: string
    instrument_family: "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
    evaluation_count: number
    evaluation_ids: string[]
  }>
  segment_auto_selected?: boolean
  subject_filter?: string | null
  instrument_family_filter?: string | null
  course_filter?: string | null
  skill_result_rows?: number
  batch_id_filter?: string | null
  by_skill: SchoolAnalyticsRow[]
}

type UtpReport = {
  id: string
  upload_id?: string
  teacher_label?: string | null
  course_label?: string | null
  subject?: string | null
  file_name?: string | null
  status?: string | null
  /** JSONB `content`: análisis IA + `student_outcomes_link` */
  content: Record<string, unknown>
  raw_content?: Record<string, unknown> | null
  created_at: string | null
}

type EvalLotMember = { id: string; student_name: string | null; evaluated_at: string | null }

type EvalLotGroup = {
  batch_id: string | null
  title: string
  course_label: string
  evaluated_at: string | null
  student_count: number
  evaluation_ids: string[]
  members: EvalLotMember[]
  suggest_annex_to_batch_id: string | null
}

type BatchLinkChoice = "SIMCE" | "PAES"

type EvalOrphanRow = EvalLotMember & {
  title: string
  course_label: string
  suggest_annex_to_batch_id: string | null
}

function filterNonArchivedInstrumentRows(rawItems: unknown[]): unknown[] {
  return rawItems.filter((raw) => {
    const a = (raw as { is_archived?: boolean | null })?.is_archived
    return a !== true
  })
}

export default function DashboardUtpPage() {
  const router = useRouter()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [riskRows, setRiskRows] = useState<RiskRow[]>([])
  const [semaforo, setSemaforo] = useState({
    insuficiente: 0,
    elemental: 0,
    adecuado: 0,
    total: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reports, setReports] = useState<UtpReport[]>([])
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(null)
  const [currentSchoolId, setCurrentSchoolId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [teacherLabel, setTeacherLabel] = useState("")
  const [courseLabel, setCourseLabel] = useState("")
  const [subject, setSubject] = useState("Matemática")
  const [gradeLevel, setGradeLevel] = useState("2M")
  const [file, setFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<UtpReport | null>(null)
  const [detailTab, setDetailTab] = useState<"juez" | "aula">("juez")
  const [outcomesRefresh, setOutcomesRefresh] = useState(0)
  /** Cobertura curricular OMR (misma fuente que Panel Dirección). */
  const [coberturaInstitucionalOmr, setCoberturaInstitucionalOmr] = useState<number | null>(null)
  const [omrLiveActive, setOmrLiveActive] = useState(false)
  /** Mismos KPI que Panel Dirección (`/api/dashboard/direccion`). */
  const [simceProyectadoOmr, setSimceProyectadoOmr] = useState(0)
  const [paesProyectadoOmr, setPaesProyectadoOmr] = useState(0)
  const [segmentBreakdown, setSegmentBreakdown] = useState<DireccionSegmentBreakdownRow[]>([])
  const [evalLotGroups, setEvalLotGroups] = useState<EvalLotGroup[]>([])
  const [evalOrphans, setEvalOrphans] = useState<EvalOrphanRow[]>([])
  const [expandedEvalLots, setExpandedEvalLots] = useState<Record<string, boolean>>({})
  /** IDs prellenados desde un lote OMR para vínculo masivo en el selector. */
  const [utpLotDraftIds, setUtpLotDraftIds] = useState<string[] | null>(null)
  const [utpLotDraftAssessmentType, setUtpLotDraftAssessmentType] = useState<string | null>(null)
  const [showBatchLinkModal, setShowBatchLinkModal] = useState(false)
  const [batchLinkPending, setBatchLinkPending] = useState<EvalLotGroup | null>(null)
  const [batchLinkSaving, setBatchLinkSaving] = useState(false)
  const [batchLinkStatus, setBatchLinkStatus] = useState<string | null>(null)
  const [archivingBatchId, setArchivingBatchId] = useState<string | null>(null)
  const [archivingAll, setArchivingAll] = useState(false)
  const [schoolAnalytics, setSchoolAnalytics] = useState<SchoolAnalyticsPayload | null>(null)
  const [schoolAnalyticsLoading, setSchoolAnalyticsLoading] = useState(false)
  const [utpSchoolPedagogySubject, setUtpSchoolPedagogySubject] = useState("")
  const [utpSchoolPedagogyFamily, setUtpSchoolPedagogyFamily] = useState<
    "" | "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER"
  >("")
  const [utpSchoolPedagogyCourse, setUtpSchoolPedagogyCourse] = useState("")

  const reloadSchoolPedagogyOnly = useCallback(async () => {
    const schoolId = (currentSchoolId ?? "").trim()
    if (!schoolId) return
    setSchoolAnalyticsLoading(true)
    try {
      const qs = new URLSearchParams({ school_id: schoolId })
      if (utpSchoolPedagogySubject.trim()) qs.set("subject", utpSchoolPedagogySubject.trim())
      if (utpSchoolPedagogyFamily) qs.set("instrument_family", utpSchoolPedagogyFamily)
      if (utpSchoolPedagogyCourse.trim()) qs.set("course", utpSchoolPedagogyCourse.trim())
      const schoolRes = await fetch(`/api/dashboard/direccion/school-pedagogy?${qs.toString()}`, { cache: "no-store" })
      const sj = (await schoolRes.json()) as SchoolAnalyticsPayload
      setSchoolAnalytics(schoolRes.ok ? sj : null)
    } catch {
      setSchoolAnalytics(null)
    } finally {
      setSchoolAnalyticsLoading(false)
    }
  }, [currentSchoolId, utpSchoolPedagogySubject, utpSchoolPedagogyFamily, utpSchoolPedagogyCourse])
  const [archivingInstrumentId, setArchivingInstrumentId] = useState<string | null>(null)
  const [archivingAllInstruments, setArchivingAllInstruments] = useState(false)

  const utpPdfCaptureRef = useRef<HTMLDivElement>(null)
  const [utpPdfExporting, setUtpPdfExporting] = useState(false)
  const [utpInstitutionLabel, setUtpInstitutionLabel] = useState("")
  /** Solo cliente: evita mismatch SSR/CSR de Intl ("a las" vs ","). */
  const [utpPrintedAtLabel, setUtpPrintedAtLabel] = useState("")
  const [utpPdfDateLabel, setUtpPdfDateLabel] = useState("")
  /** Snapshot tras refetch explícito (misma query que pantalla) antes del PDF */
  const [utpPdfBySkillOverride, setUtpPdfBySkillOverride] = useState<SchoolAnalyticsRow[] | null>(null)
  const [utpPdfLogoSrc, setUtpPdfLogoSrc] = useState<string | null>(null)

  useEffect(() => {
    const h = document.querySelector("header h1")?.textContent?.trim()
    if (h) setUtpInstitutionLabel(h)
  }, [loading])

  useEffect(() => {
    const img = document.querySelector("header img")
    if (img instanceof HTMLImageElement) {
      const src = (img.currentSrc || img.src || "").trim()
      setUtpPdfLogoSrc(src.length > 0 ? src : null)
    } else {
      setUtpPdfLogoSrc(null)
    }
  }, [loading])

  useEffect(() => {
    const label = formatDateTimeEsCl(new Date())
    setUtpPrintedAtLabel(label)
    setUtpPdfDateLabel((prev) => (prev.trim() ? prev : label))
  }, [])

  async function handleUtpExportPdf() {
    setUtpPdfExporting(true)
    try {
      const institution =
        utpInstitutionLabel ||
        (typeof document !== "undefined" ? document.querySelector("header h1")?.textContent?.trim() : null) ||
        "Panel institucional"
      const reportDateLabel = formatDateTimeEsCl(new Date())

      const schoolId = (currentSchoolId ?? "").trim()

      async function fetchSchoolPedagogySkillsForPdf(): Promise<SchoolAnalyticsRow[]> {
        const qs = new URLSearchParams()
        if (schoolId) qs.set("school_id", schoolId)
        if (utpSchoolPedagogySubject.trim()) qs.set("subject", utpSchoolPedagogySubject.trim())
        if (utpSchoolPedagogyFamily) qs.set("instrument_family", utpSchoolPedagogyFamily)
        if (utpSchoolPedagogyCourse.trim()) qs.set("course", utpSchoolPedagogyCourse.trim())
        try {
          const schoolRes = await fetch(`/api/dashboard/direccion/school-pedagogy?${qs.toString()}`, { cache: "no-store" })
          if (!schoolRes.ok) return []
          const sj = (await schoolRes.json()) as SchoolAnalyticsPayload
          return Array.isArray(sj.by_skill) ? sj.by_skill : []
        } catch {
          return []
        }
      }

      /** Misma agregación que la pantalla y Analítica colegio (sin filtrar por un solo batch_id). */
      let bySkillForPdf = await fetchSchoolPedagogySkillsForPdf()
      if (bySkillForPdf.length === 0) {
        bySkillForPdf = schoolAnalytics?.by_skill ?? []
      }

      flushSync(() => {
        setUtpInstitutionLabel((prev) => (prev.trim() ? prev : institution))
        setUtpPdfDateLabel(reportDateLabel)
        setUtpPdfBySkillOverride(bySkillForPdf)
      })

      const r = await exportUtpExecutiveFichaPdf({
        rootElement: utpPdfCaptureRef.current,
        filename: `utp_dashboard_${new Date().toISOString().slice(0, 10)}.pdf`,
      })
      if (!r.ok) {
        window.alert(r.error ?? "No se pudo generar el PDF.")
      }
    } finally {
      flushSync(() => {
        setUtpPdfBySkillOverride(null)
      })
      setUtpPdfExporting(false)
    }
  }

  function juezRootCause(content: Record<string, unknown>): { approval_risk_pct?: number } {
    const rc = content.root_cause
    if (rc && typeof rc === "object" && !Array.isArray(rc)) return rc as { approval_risk_pct?: number }
    if (typeof rc === "string") {
      try {
        const p = JSON.parse(rc)
        if (p && typeof p === "object") return p as { approval_risk_pct?: number }
      } catch {
        /* ignore */
      }
    }
    return {}
  }

  function getLinkedEvalIds(report: UtpReport): string[] {
    const raw = (report.content ?? {}).student_outcomes_link
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
    const ids = (raw as { evaluation_ids?: unknown }).evaluation_ids
    if (!Array.isArray(ids)) return []
    return ids.map(String).filter(Boolean)
  }

  function getLinkedAssessmentType(report: UtpReport): string | null {
    const raw = (report.content ?? {}).student_outcomes_link
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
    const t = (raw as { assessment_type?: unknown }).assessment_type
    if (t == null || t === "") return null
    return String(t)
  }

  function riskBadgeClass(pct: number): string {
    if (pct >= 60) return "bg-red-100 text-red-700 border-red-200"
    if (pct >= 35) return "bg-amber-100 text-amber-700 border-amber-200"
    return "bg-emerald-100 text-emerald-700 border-emerald-200"
  }

  function parseMaybeObject(v: unknown): Record<string, unknown> | null {
    if (v && typeof v === "object") return v as Record<string, unknown>
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v)
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
      } catch {
        return null
      }
    }
    return null
  }

  function asArray<T>(v: unknown): T[] {
    return Array.isArray(v) ? (v as T[]) : []
  }

  function normalizeInstrumentItem(raw: any): UtpReport {
    const nested = Array.isArray(raw?.utp_audit_reports) ? raw.utp_audit_reports[0] : raw?.utp_audit_reports
    const base = nested && typeof nested === "object" ? nested : raw
    const blob =
      parseMaybeObject(base?.content) ??
      parseMaybeObject(base?.audit_content) ??
      parseMaybeObject(raw?.content) ??
      parseMaybeObject(raw?.audit_content) ??
      null

    const merged: Record<string, unknown> = { ...(blob ?? {}) }

    const mergeColumn = <K extends string>(key: K, v: unknown) => {
      if (v == null) return
      if (merged[key] == null || (Array.isArray(merged[key]) && (merged[key] as unknown[]).length === 0)) {
        merged[key] = v
      }
    }

    mergeColumn("analysis_summary", base?.analysis_summary)
    mergeColumn("question_quality", base?.question_quality)
    mergeColumn("curricular_alignment", base?.curricular_alignment)
    mergeColumn("normative_citations", base?.normative_citations)
    mergeColumn("recommended_actions", base?.recommended_actions)
    mergeColumn("observed_questions", base?.observed_questions)
    mergeColumn("detected_skills", base?.detected_skills)
    mergeColumn("improvement_suggestions", base?.improvement_suggestions)
    mergeColumn("utp_actions", base?.utp_actions)
    mergeColumn("pme_linkage", base?.pme_linkage)

    const fromBlobRc = parseMaybeObject(merged.root_cause)
    const fromColRc = parseMaybeObject(base?.root_cause)
    if (fromColRc && Object.keys(fromColRc).length > 0) {
      merged.root_cause = { ...fromColRc, ...fromBlobRc }
    } else if (fromBlobRc && Object.keys(fromBlobRc).length > 0) {
      merged.root_cause = fromBlobRc
    }

    if (merged.analysis_summary == null || String(merged.analysis_summary).trim() === "") {
      merged.analysis_summary = JSON.stringify(merged ?? base ?? raw)
    }

    /** Fila raíz = utp_instrument_uploads; el id del upload es siempre raw.id. */
    const uploadPk = String(raw?.id ?? "").trim() || String((base as { upload_id?: string })?.upload_id ?? "").trim()

    return {
      id: String(base?.id ?? raw?.id ?? crypto.randomUUID()),
      upload_id: uploadPk,
      teacher_label: raw?.teacher_label ?? base?.teacher_label ?? null,
      course_label: raw?.course_label ?? base?.course_label ?? null,
      subject: raw?.subject ?? base?.subject ?? null,
      file_name: raw?.file_name ?? base?.file_name ?? null,
      status: raw?.status ?? base?.status ?? null,
      content: merged,
      raw_content: merged,
      created_at: base?.created_at ?? raw?.created_at ?? null,
    }
  }

  async function fetchInstruments() {
    const reportRes = await fetch("/api/dashboard/utp/instruments", { cache: "no-store" })
    const reportJson = await reportRes.json()
    const raw = Array.isArray(reportJson?.items) ? filterNonArchivedInstrumentRows(reportJson.items) : []
    const data = raw.map(normalizeInstrumentItem)
    console.log("DATOS RECUPERADOS PARA LA TABLA:", data)
    setReports(data)
  }

  const loadUtpDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [auditRes, reportRes, dirRes, batchesRes] = await Promise.all([
        fetch("/api/dashboard/utp", { cache: "no-store" }),
        fetch("/api/dashboard/utp/instruments", { cache: "no-store" }),
        fetch(`/api/dashboard/direccion?sync=${Date.now()}`, { cache: "no-store" }).catch(() => null),
        fetch("/api/dashboard/utp/evaluation-batches", { cache: "no-store" }),
      ])
      const json = await auditRes.json()
      setCurrentOrganizationId(
        typeof json?.organization_id === "string" && json.organization_id.trim() !== ""
          ? json.organization_id
          : null
      )
      setCurrentSchoolId(typeof json?.school_id === "string" && json.school_id.trim() !== "" ? json.school_id : null)
      const reportJson = await reportRes.json()
      const rawItems = Array.isArray(reportJson?.items) ? filterNonArchivedInstrumentRows(reportJson.items) : []
      const data = rawItems.map(normalizeInstrumentItem)
      console.log("DATOS RECUPERADOS PARA LA TABLA:", data)

      try {
        let latestBatchId: string | null = null
        if (batchesRes.ok) {
          const bj = (await batchesRes.json()) as { groups?: EvalLotGroup[]; orphans?: EvalOrphanRow[] }
          const groups = Array.isArray(bj?.groups) ? bj.groups : []
          setEvalLotGroups(groups)
          setEvalOrphans(Array.isArray(bj?.orphans) ? bj.orphans : [])
          const sortedByDate = [...groups].sort((a, b) => {
            const ta = a.evaluated_at ? new Date(a.evaluated_at).getTime() : 0
            const tb = b.evaluated_at ? new Date(b.evaluated_at).getTime() : 0
            return tb - ta
          })
          latestBatchId = sortedByDate.find((g) => g.batch_id)?.batch_id ?? null
        } else {
          setEvalLotGroups([])
          setEvalOrphans([])
        }
        const schoolId = String((json?.school_id as string | null | undefined) ?? "").trim()
        if (schoolId) {
          setSchoolAnalyticsLoading(true)
          const qs = new URLSearchParams({ school_id: schoolId })
          try {
            const schoolRes = await fetch(`/api/dashboard/direccion/school-pedagogy?${qs.toString()}`, { cache: "no-store" })
            const sj = (await schoolRes.json()) as SchoolAnalyticsPayload
            setSchoolAnalytics(schoolRes.ok ? sj : null)
          } catch {
            setSchoolAnalytics(null)
          } finally {
            setSchoolAnalyticsLoading(false)
          }
        } else {
          setSchoolAnalytics(null)
          setSchoolAnalyticsLoading(false)
        }
      } catch {
        setEvalLotGroups([])
        setEvalOrphans([])
        setSchoolAnalytics(null)
        setSchoolAnalyticsLoading(false)
      }

      let omrSemaforo: { insuficiente: number; elemental: number; adecuado: number; total: number } | null = null
      let cobertura: number | null = null
      let simceProy = 0
      let paesProy = 0
      let segmentsFromDir: DireccionSegmentBreakdownRow[] = []
      try {
        if (dirRes && dirRes.ok) {
          const dj = (await dirRes.json()) as {
            semaforo?: { insuficiente?: number; elemental?: number; adecuado?: number; total?: number }
            kpis?: {
              promedio_logro_institucional?: number
              simce_proyectado_promedio?: number
              paes_proyectado_promedio?: number
            }
            segment_breakdown?: DireccionSegmentBreakdownRow[]
          }
          if (dj?.semaforo && typeof dj.semaforo === "object") {
            omrSemaforo = {
              insuficiente: Number(dj.semaforo.insuficiente) || 0,
              elemental: Number(dj.semaforo.elemental) || 0,
              adecuado: Number(dj.semaforo.adecuado) || 0,
              total: Number(dj.semaforo.total) || 0,
            }
          }
          const p = Number(dj?.kpis?.promedio_logro_institucional)
          if (Number.isFinite(p)) cobertura = p
          const s = Number(dj?.kpis?.simce_proyectado_promedio)
          const pa = Number(dj?.kpis?.paes_proyectado_promedio)
          if (Number.isFinite(s)) simceProy = s
          if (Number.isFinite(pa)) paesProy = pa
          const rawSeg = dj?.segment_breakdown
          if (Array.isArray(rawSeg)) {
            segmentsFromDir = rawSeg
              .filter(
                (r) =>
                  r &&
                  typeof r.subject_display === "string" &&
                  (r.instrument_family === "SIMCE" ||
                    r.instrument_family === "PAES" ||
                    r.instrument_family === "INSTITUTIONAL_OTHER"),
              )
              .map((r) => ({
                ...r,
                course_breakdown: parseDireccionCourseBreakdownFromApi(
                  (r as { course_breakdown?: unknown }).course_breakdown,
                ),
              }))
          }
        }
      } catch {
        omrSemaforo = null
        cobertura = null
        simceProy = 0
        paesProy = 0
        segmentsFromDir = []
      }

      setSimceProyectadoOmr(simceProy)
      setPaesProyectadoOmr(paesProy)
      setSegmentBreakdown(segmentsFromDir)

      const fallbackSemaforo = json?.semaforo ?? { insuficiente: 0, elemental: 0, adecuado: 0, total: 0 }
      const hasOmrSemaforoCounts =
        omrSemaforo != null &&
        (omrSemaforo.total > 0 || omrSemaforo.insuficiente > 0 || omrSemaforo.elemental > 0 || omrSemaforo.adecuado > 0)
      const useOmr =
        hasOmrSemaforoCounts ||
        (cobertura != null && cobertura > 0) ||
        simceProy > 0 ||
        paesProy > 0

      if (!auditRes.ok) {
        setError(json?.error ?? "No se pudo cargar auditoría")
        setRows([])
        setRiskRows([])
        setCoberturaInstitucionalOmr(useOmr && cobertura != null ? cobertura : null)
        setOmrLiveActive(useOmr)
        setSemaforo(useOmr && omrSemaforo ? omrSemaforo : fallbackSemaforo)
        setReports(data)
      } else {
        setRows(Array.isArray(json?.items) ? json.items : [])
        setRiskRows(Array.isArray(json?.risk_rows) ? json.risk_rows : [])
        setSemaforo(useOmr && omrSemaforo ? omrSemaforo : fallbackSemaforo)
        setCoberturaInstitucionalOmr(useOmr && cobertura != null ? cobertura : null)
        setOmrLiveActive(useOmr)
        setReports(data)
      }
    } catch {
      setError("Error de red al cargar auditoría")
      setCurrentOrganizationId(null)
      setCurrentSchoolId(null)
      setRows([])
      setRiskRows([])
      setCoberturaInstitucionalOmr(null)
      setOmrLiveActive(false)
      setSimceProyectadoOmr(0)
      setPaesProyectadoOmr(0)
      setSegmentBreakdown([])
      setEvalLotGroups([])
      setEvalOrphans([])
      setSchoolAnalytics(null)
      setSchoolAnalyticsLoading(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUtpDashboard()
  }, [loadUtpDashboard])

  function syncRealData() {
    try {
      localStorage.setItem("utp_link_updated_at", String(Date.now()))
    } catch {
      /* noop */
    }
    setOutcomesRefresh((x) => x + 1)
    router.refresh()
    void loadUtpDashboard()
  }

  useEffect(() => {
    if (selectedReport?.id) {
      setDetailTab("juez")
    }
    setUtpLotDraftIds(null)
    setUtpLotDraftAssessmentType(null)
  }, [selectedReport?.id])

  function handleUseBatchInLink(group: EvalLotGroup) {
    const batchId = group.batch_id ?? "sin-batch-id"
    console.log("Iniciando vínculo para el lote:", batchId)
    setBatchLinkStatus(null)
    setBatchLinkPending(group)
    setShowBatchLinkModal(true)
  }

  async function confirmBatchLink(choice: BatchLinkChoice) {
    const pending = batchLinkPending
    if (!pending) {
      setShowBatchLinkModal(false)
      return
    }
    const report = selectedReport ?? reports[0] ?? null
    const batchId = pending.batch_id ?? "sin-batch-id"
    const category = choice
    const endpoint = "/api/dashboard/utp/instruments"
    try {
      setBatchLinkSaving(true)
      setBatchLinkStatus("Vinculando lote...")
      console.log("Enviando vínculo...", { batchId, category })
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: report?.id ?? null,
          evaluation_ids: pending.evaluation_ids,
          assessment_type: category,
          batch_id: pending.batch_id,
          organization_id: currentOrganizationId ?? "PENDING",
          school_id: currentSchoolId,
          report_title: `Vínculo Automático - ${pending.title}`,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        console.warn("Vinculación de lote no confirmada por servidor:", j?.error ?? res.statusText)
        setBatchLinkStatus("No se pudo confirmar el vínculo. Reintentando no bloquea el flujo.")
      } else {
        setUtpLotDraftIds([...pending.evaluation_ids])
        setUtpLotDraftAssessmentType(choice === "SIMCE" ? "SIMCE" : "PAES")
        setShowBatchLinkModal(false)
        setBatchLinkPending(null)
        setDetailTab("aula")
      }
    } catch {
      setBatchLinkStatus("Error de red temporal al vincular lote.")
    } finally {
      setBatchLinkSaving(false)
      window.location.reload()
    }
  }

  async function annexOrphanToBatch(evaluationId: string, targetBatchId: string) {
    try {
      const res = await fetch("/api/dashboard/utp/evaluations-annex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluation_id: evaluationId, target_batch_id: targetBatchId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!j?.ok) {
        alert(j?.error ?? "No se pudo anexar al lote.")
        return
      }
      void loadUtpDashboard()
    } catch {
      alert("Error de red al anexar.")
    }
  }

  async function archiveBatch(batchId: string, title: string) {
    const ok = window.confirm(`¿Archivar el lote "${title}"? Esta acción lo ocultará de la bandeja.`)
    if (!ok) return
    setArchivingBatchId(batchId)
    try {
      const res = await fetch("/api/dashboard/utp/archive-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        alert(j?.error ?? "No se pudo archivar el lote.")
        return
      }
      void loadUtpDashboard()
    } catch {
      alert("Error de red al archivar lote.")
    } finally {
      setArchivingBatchId(null)
    }
  }

  async function archiveAllBatches() {
    const confirmed = window.confirm("¡ATENCIÓN! Esto archivará todos los lotes y reseteará los velocímetros a 0. ¿Estás seguro?")
    if (!confirmed) return
    setArchivingAll(true)
    try {
      const res = await fetch("/api/dashboard/utp/archive-all", {
        method: "POST",
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        alert(j?.error ?? "No se pudo archivar toda la bandeja.")
        return
      }
      void loadUtpDashboard()
    } catch {
      alert("Error de red al limpiar la bandeja.")
    } finally {
      setArchivingAll(false)
    }
  }

  async function handleUploadInstrument() {
    if (!file) {
      setUploadResult("Selecciona un archivo primero.")
      return
    }
    setUploading(true)
    setUploadResult(null)
    try {
      const fd = new FormData()
      fd.append("teacher_label", teacherLabel)
      fd.append("course_label", courseLabel)
      fd.append("subject", subject)
      fd.append("grade_level", gradeLevel)
      fd.append("file", file)

      const res = await fetch("/api/dashboard/utp/instruments", {
        method: "POST",
        body: fd,
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) {
        setUploadResult(`Error: ${json?.error ?? "No se pudo procesar el instrumento."}`)
        return
      }
      setUploadResult("Instrumento auditado y registrado correctamente.")
      setFile(null)
      await fetchInstruments()
    } catch {
      setUploadResult("Error de red durante la auditoría preventiva.")
    } finally {
      setUploading(false)
    }
  }

  async function archiveInstrument(uploadId: string) {
    const ok = window.confirm(
      "¿Estás seguro de eliminar esta PRUEBA BASE por completo? Los profesores ya no podrán verla para escanear",
    )
    if (!ok) return
    setArchivingInstrumentId(uploadId)
    try {
      const res = await fetch("/api/dashboard/utp/instruments/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        alert(j?.error ?? "No se pudo archivar el instrumento.")
        return
      }
      setSelectedReport((prev) => {
        if (prev && String(prev.upload_id ?? "").trim() === uploadId) return null
        return prev
      })
      await fetchInstruments()
      router.refresh()
    } catch {
      alert("Error de red al archivar instrumento.")
    } finally {
      setArchivingInstrumentId(null)
    }
  }

  async function archiveAllInstruments() {
    const ok = window.confirm("¿Estás seguro? Esto ocultará todas las pruebas base actuales")
    if (!ok) return
    setArchivingAllInstruments(true)
    try {
      const res = await fetch("/api/dashboard/utp/instruments/archive-all", {
        method: "POST",
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        alert(j?.error ?? "No se pudo archivar la lista completa.")
        return
      }
      await fetchInstruments()
      router.refresh()
    } catch {
      alert("Error de red al archivar todos los instrumentos.")
    } finally {
      setArchivingAllInstruments(false)
    }
  }

  return (
    <section className="utp-print-root space-y-6 sm:space-y-8 bg-[#F7F9FB] px-3 py-6 sm:px-6 sm:py-8 -mx-3 sm:-mx-6 rounded-none">
      <div className="utp-print-header border-b border-[#E5E7EB] pb-4 mb-2">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#111827]">{utpInstitutionLabel || "Panel institucional"}</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Dashboard UTP · Impreso el {utpPrintedAtLabel || "—"}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg sm:text-xl font-semibold text-[#111827]">Auditoría UTP</h2>
          <Link
            href="/dashboard/utp/roster"
            className="text-sm font-medium text-[#047857] hover:underline"
          >
            Padrón SIGE
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleUtpExportPdf()}
            disabled={utpPdfExporting}
            className="rounded-md border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
          >
            {utpPdfExporting ? "Generando PDF…" : "Descargar Reporte PDF"}
          </button>
          <button
            type="button"
            onClick={() => void archiveAllBatches()}
            disabled={archivingAll}
            className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-60"
          >
            {archivingAll ? "Limpiando…" : "Limpiar Toda la Bandeja"}
          </button>
          <button
            type="button"
            onClick={() => syncRealData()}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Sincronizar Datos Reales
          </button>
        </div>
      </div>
      <p className="text-xs text-[#374151] rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 leading-relaxed shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        Los resultados reflejan el desempeño de los estudiantes en las evaluaciones aplicadas y tienen como propósito apoyar
        la toma de decisiones pedagógicas.
      </p>
      <UtpPendingBatchReleasesPanel refreshTrigger={outcomesRefresh} />
      <div className="utp-pdf-capture-host fixed -left-[12000px] top-0 pointer-events-none" aria-hidden>
        <UtpExecutivePdfCapture
          ref={utpPdfCaptureRef}
          institutionName={utpInstitutionLabel || "Panel institucional"}
          reportDateLabel={utpPdfDateLabel}
          logoSrc={utpPdfLogoSrc}
          omrLiveActive={omrLiveActive}
          coberturaInstitucionalOmr={coberturaInstitucionalOmr}
          semaforo={semaforo}
          simceProyectadoOmr={simceProyectadoOmr}
          paesProyectadoOmr={paesProyectadoOmr}
          bySkill={utpPdfBySkillOverride ?? schoolAnalytics?.by_skill ?? []}
        />
      </div>
      {loading && <p className="text-sm text-[var(--text-muted)]">Cargando auditoría...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Subir Instrumentos Docentes</h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Carga privada para análisis preventivo curricular, con reporte exportable para PME.
        </p>
        <div className="grid gap-3 md:grid-cols-4 mt-4">
          <input
            className="rounded-md border border-[var(--border-color)] px-3 py-2 text-sm"
            placeholder="Profesor"
            value={teacherLabel}
            onChange={(e) => setTeacherLabel(e.target.value)}
          />
          <input
            className="rounded-md border border-[var(--border-color)] px-3 py-2 text-sm"
            placeholder="Curso"
            value={courseLabel}
            onChange={(e) => setCourseLabel(e.target.value)}
          />
          <input
            className="rounded-md border border-[var(--border-color)] px-3 py-2 text-sm"
            placeholder="Asignatura"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <select
            className="rounded-md border border-[var(--border-color)] px-3 py-2 text-sm"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
          >
            <option value="8B">8° Básico</option>
            <option value="2M">2° Medio</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            type="button"
            onClick={handleUploadInstrument}
            disabled={uploading}
            className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
          >
            {uploading ? "Analizando..." : "Subir y auditar"}
          </button>
          {uploadResult && <span className="text-sm text-[var(--text-muted)]">{uploadResult}</span>}
        </div>
      </div>
      {!loading && (
        <div className="rounded-xl border border-[var(--border-color)] bg-white overflow-hidden shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <h3 className="font-semibold">Pruebas base (instrumentos)</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Listado principal: columna <strong>Acciones</strong> archiva la prueba completa (no solo preguntas del
                editor). Registros en <code className="text-[11px]">utp_instrument_uploads</code>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void archiveAllInstruments()}
              disabled={archivingAllInstruments || reports.length === 0}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              {archivingAllInstruments ? "Archivando…" : "Archivar todos los instrumentos viejos"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Resumen / título</th>
                  <th className="text-left px-4 py-3 font-semibold">Profesor</th>
                  <th className="text-left px-4 py-3 font-semibold">Curso</th>
                  <th className="text-left px-4 py-3 font-semibold">Asignatura</th>
                  <th className="text-left px-4 py-3 font-semibold">Archivo</th>
                  <th className="text-left px-4 py-3 font-semibold">Fecha</th>
                  <th className="text-right px-4 py-3 font-semibold w-32">BORRAR</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-[var(--text-muted)]">
                      No hay pruebas base visibles. Suba un instrumento arriba o reactive archivados en BD si aplica.
                    </td>
                  </tr>
                ) : (
                  reports.map((r) => {
                    const doc = r.content ?? {}
                    const summary = String(doc.analysis_summary ?? "").trim()
                    const label = summary.length > 80 ? `${summary.slice(0, 80)}…` : summary || r.file_name || "—"
                    const uploadId = String(r.upload_id ?? "").trim()
                    return (
                      <tr key={uploadId || r.id} className="border-t border-[var(--border-color)] hover:bg-slate-50/80">
                        <td className="px-4 py-3 max-w-xs">
                          <span className="font-medium text-slate-900 line-clamp-2">{label}</span>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-muted)]">{r.teacher_label ?? "—"}</td>
                        <td className="px-4 py-3 text-[var(--text-muted)]">{r.course_label ?? "—"}</td>
                        <td className="px-4 py-3 text-[var(--text-muted)]">{r.subject ?? "—"}</td>
                        <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{r.file_name ?? "—"}</td>
                        <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">
                          {formatDateTimeEsCl(r.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            title="Borrar prueba base completa de la lista"
                            aria-label="Borrar prueba base completa"
                            disabled={!uploadId || archivingInstrumentId === uploadId}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-red-500 px-3 py-2 text-white shadow-sm hover:bg-red-600 disabled:opacity-50 disabled:pointer-events-none"
                            onClick={() => void archiveInstrument(uploadId)}
                          >
                            {archivingInstrumentId === uploadId ? (
                              <span className="text-sm font-bold px-1">…</span>
                            ) : (
                              <>
                                <span className="text-base leading-none font-extrabold" aria-hidden>
                                  X
                                </span>
                                <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!loading && !error && (
        <div className="space-y-2">
          {omrLiveActive ? (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              OMR en vivo: indicadores sincronizados con evaluaciones reales (misma lectura que Panel Dirección).
            </p>
          ) : null}
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{uiSemaforoTitulo()}</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-3xl">{uiSemaforoBajada()}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <article className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{uiCoberturaTitulo()}</p>
              {uiCoberturaBajada() ? (
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">{uiCoberturaBajada()}</p>
              ) : null}
              <p className="mt-2 text-3xl font-bold text-emerald-700">
                {coberturaInstitucionalOmr != null ? Math.round(coberturaInstitucionalOmr) : "—"}%
              </p>
              <div className="mt-3 h-2 w-full rounded-full bg-emerald-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(100, coberturaInstitucionalOmr ?? 0))}%`,
                  }}
                />
              </div>
            </article>
            <article className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs text-rose-600 uppercase tracking-wide">Insuficiente</p>
              <p className="text-3xl font-bold text-rose-700">{semaforo.insuficiente}</p>
            </article>
            <article className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs text-amber-600 uppercase tracking-wide">Elemental</p>
              <p className="text-3xl font-bold text-amber-700">{semaforo.elemental}</p>
            </article>
            <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs text-emerald-600 uppercase tracking-wide">Adecuado</p>
              <p className="text-3xl font-bold text-emerald-700">{semaforo.adecuado}</p>
            </article>
          </div>
          <p className="text-xs text-[var(--text-muted)]">Total en categorías de desempeño (estándar agencia): {semaforo.total}</p>
        </div>
      )}
      {!loading && (
        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Proyección resultados nacionales</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-3xl">
              Misma agregación que Panel Dirección: proyección SIMCE y PAES desde evaluaciones reales en alcance (vínculo UTP
              o universo institucional), usando la familia canónica por evaluación, sin mezclar internas en esas escalas.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{uiSimceProyectadoTitulo()}</p>
              {uiSimceProyectadoBajada() ? (
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">{uiSimceProyectadoBajada()}</p>
              ) : null}
              <p className="mt-2 text-3xl font-bold text-sky-700">{Math.round(simceProyectadoOmr)}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Escala SIMCE (200-350)</p>
            </article>
            <article className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{uiPaesProyectadoTitulo()}</p>
              {uiPaesProyectadoBajada() ? (
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">{uiPaesProyectadoBajada()}</p>
              ) : null}
              <p className="mt-2 text-3xl font-bold text-indigo-700">{Math.round(paesProyectadoOmr)}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Escala DEMRE (100-1000)</p>
            </article>
          </div>
        </div>
      )}
      {!loading && segmentBreakdown.length > 0 && (
        <article className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900">Desglose por asignatura y tipo de prueba</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1 max-w-3xl">
            Basado en las mismas evaluaciones que el resumen superior. No mezcla SIMCE, PAES ni pruebas internas. Este desglose
            corresponde al mismo alcance institucional mostrado en Dirección. Por curso se agrupan etiquetas equivalentes (p. ej.
            ordinales) sin duplicar filas artificiales.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm border border-slate-200 rounded-md overflow-hidden">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-700">Asignatura</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-700">Tipo</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700">Nº eval.</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700">Logro %</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700">Proyección</th>
                </tr>
              </thead>
              <tbody>
                {segmentBreakdown.map((row, i) => {
                  const rowKey = `${row.subject_key}-${row.instrument_family}-${i}`
                  const tipoLabel =
                    row.instrument_family === "SIMCE"
                      ? "SIMCE"
                      : row.instrument_family === "PAES"
                        ? "PAES"
                        : "Interna"
                  const proyeccion = formatDireccionSegmentProjection(
                    row.instrument_family,
                    row.simce_projection,
                    row.paes_projection,
                  )
                  const courses = row.course_breakdown ?? []
                  const courseTable = (
                    <table className="w-full text-xs border border-slate-100 rounded-md overflow-hidden">
                      <thead className="bg-slate-50/90">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Curso</th>
                          <th className="text-right px-2 py-1.5 font-semibold text-slate-600">Nº eval.</th>
                          <th className="text-right px-2 py-1.5 font-semibold text-slate-600">Logro %</th>
                          <th className="text-right px-2 py-1.5 font-semibold text-slate-600">Proyección</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courses.map((c) => (
                          <tr key={c.course_key} className="border-t border-slate-100 bg-white">
                            <td className="px-2 py-1.5 text-slate-800">{c.course_display}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{c.evaluation_count}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
                              {c.avg_logro_pct != null && Number.isFinite(Number(c.avg_logro_pct))
                                ? `${Number(c.avg_logro_pct).toFixed(1)}%`
                                : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600">
                              {formatDireccionSegmentProjection(
                                row.instrument_family,
                                c.simce_projection,
                                c.paes_projection,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                  return (
                    <Fragment key={rowKey}>
                      <tr className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-900">{row.subject_display}</td>
                        <td className="px-3 py-2 text-slate-700">{tipoLabel}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.evaluation_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.avg_logro_pct != null && Number.isFinite(Number(row.avg_logro_pct))
                            ? `${Number(row.avg_logro_pct).toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 text-xs">{proyeccion}</td>
                      </tr>
                      {courses.length === 1 ? (
                        <tr className="border-t border-slate-50 bg-slate-50/50">
                          <td colSpan={5} className="px-3 py-2">
                            {courseTable}
                          </td>
                        </tr>
                      ) : null}
                      {courses.length > 1 ? (
                        <tr className="border-t border-slate-50 bg-slate-50/50">
                          <td colSpan={5} className="px-3 py-2">
                            <details className="group">
                              <summary className="cursor-pointer text-slate-700 font-medium text-xs list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                                <span className="text-slate-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                                Por curso ({courses.length})
                              </summary>
                              <div className="mt-2 pl-4 border-l-2 border-slate-200">{courseTable}</div>
                            </details>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </article>
      )}
      {!loading && !error && (
        <div className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <h3 className="font-semibold">Analítica por Colegio (habilidades)</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Misma agregación que <strong>Analítica colegio</strong> (Dirección): por <code>school_id</code>, sin acotar a un solo{" "}
            <code>batch_id</code>. Si hay un único bloque SIMCE o PAES nacional (p. ej. solo PAES + evaluaciones internas), las
            habilidades se cargan solas para ese bloque; si hay varios bloques nacionales, elija asignatura y familia abajo.
          </p>
          <p className="mt-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            Fuente principal activa: <code>/api/dashboard/direccion/school-pedagogy</code>. Esta sección es la referencia
            pedagógica prioritaria para habilidades, ejes y focos institucionales.
          </p>
          {schoolAnalyticsLoading ? (
            <p className="text-sm text-[var(--text-muted)] mt-3">Cargando analítica…</p>
          ) : !schoolAnalytics || schoolAnalytics.by_skill.length === 0 ? (
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex flex-wrap gap-2 items-end">
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                  Asignatura
                  <input
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 min-w-[8rem]"
                    value={utpSchoolPedagogySubject}
                    onChange={(e) => setUtpSchoolPedagogySubject(e.target.value)}
                    placeholder="Ej. Matemática"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                  Familia
                  <select
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    value={utpSchoolPedagogyFamily}
                    onChange={(e) =>
                      setUtpSchoolPedagogyFamily(
                        e.target.value as "" | "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER",
                      )
                    }
                  >
                    <option value="">—</option>
                    <option value="SIMCE">SIMCE</option>
                    <option value="PAES">PAES</option>
                    <option value="INSTITUTIONAL_OTHER">Internas</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                  Curso (opc.)
                  <input
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 w-28"
                    value={utpSchoolPedagogyCourse}
                    onChange={(e) => setUtpSchoolPedagogyCourse(e.target.value)}
                    placeholder="Etiqueta"
                  />
                </label>
                <button
                  type="button"
                  className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100"
                  onClick={() => void reloadSchoolPedagogyOnly()}
                >
                  Aplicar filtros
                </button>
              </div>
              {schoolAnalytics?.status_reason === "requires_subject_and_instrument_family" &&
              (schoolAnalytics.segmentation?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  <p className="text-amber-800">
                    Hay más de un bloque SIMCE o PAES por asignatura, o solo internas sin filtrar: elija asignatura y familia
                    para ver habilidades agregadas sin mezclar.
                  </p>
                  <div className="overflow-x-auto rounded border border-slate-200 text-xs">
                    <table className="min-w-full">
                      <thead>
                        <tr className="bg-slate-50 text-left">
                          <th className="px-2 py-1">Asignatura</th>
                          <th className="px-2 py-1">Familia</th>
                          <th className="px-2 py-1 text-right">N° eval.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(schoolAnalytics.segmentation ?? []).map((s, i) => (
                          <tr key={`${s.subject_key}-${s.instrument_family}-${i}`} className="border-t border-slate-100">
                            <td className="px-2 py-1">{s.subject_display}</td>
                            <td className="px-2 py-1">{s.instrument_family}</td>
                            <td className="px-2 py-1 text-right">{s.evaluation_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-[var(--text-muted)]">Sin datos de habilidades para el colegio/lote actual.</p>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2 items-end text-xs">
                <label className="flex flex-col gap-0.5 text-[var(--text-muted)]">
                  Asignatura
                  <input
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 min-w-[7rem]"
                    value={utpSchoolPedagogySubject}
                    onChange={(e) => setUtpSchoolPedagogySubject(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[var(--text-muted)]">
                  Familia
                  <select
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900"
                    value={utpSchoolPedagogyFamily}
                    onChange={(e) =>
                      setUtpSchoolPedagogyFamily(
                        e.target.value as "" | "SIMCE" | "PAES" | "INSTITUTIONAL_OTHER",
                      )
                    }
                  >
                    <option value="">—</option>
                    <option value="SIMCE">SIMCE</option>
                    <option value="PAES">PAES</option>
                    <option value="INSTITUTIONAL_OTHER">Internas</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-800 hover:bg-slate-50"
                  onClick={() => void reloadSchoolPedagogyOnly()}
                >
                  Aplicar
                </button>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                school_id: <strong>{schoolAnalytics.school_id ?? "—"}</strong> · batch_id:{" "}
                <strong>{schoolAnalytics.batch_id_filter ?? "sin filtro (todo el colegio)"}</strong> · filas:{" "}
                <strong>{schoolAnalytics.skill_result_rows ?? 0}</strong>
                {schoolAnalytics.segment_auto_selected ? (
                  <>
                    {" "}
                    · segmento automático: <strong>{schoolAnalytics.subject_filter ?? "—"}</strong> /{" "}
                    <strong>{schoolAnalytics.instrument_family_filter ?? "—"}</strong>
                  </>
                ) : null}
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {schoolAnalytics.by_skill.slice(0, 6).map((r, i) => (
                  <article key={`${r.skill_name}-${i}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-[var(--text-muted)]">{r.subject ?? "—"}</p>
                    <p className="text-sm font-semibold text-slate-900">{r.skill_name}</p>
                    <p className="mt-1 text-2xl font-bold text-indigo-700">{Math.round(Number(r.avg_logro_pct ?? 0))}%</p>
                    <p className="text-xs text-[var(--text-muted)]">{r.student_result_rows} registros</p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!loading && !error && (evalLotGroups.length > 0 || evalOrphans.length > 0) && (
        <div className="rounded-xl border border-[var(--border-color)] bg-white overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50">
            <h3 className="font-semibold">Lotes de evaluación (OMR)</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-3xl">
              Agrupación por <code className="text-[11px]">batch_id</code>. Abra un informe 360° → pestaña Desempeño en Aula y pulse &quot;Usar lote en vínculo&quot; para precargar todas las evaluaciones; al guardar categoría se aplica a todo el lote.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {evalLotGroups.map((g) => {
              const key = g.batch_id ?? g.evaluation_ids[0] ?? "x"
              const open = Boolean(expandedEvalLots[key])
              const dateStr = formatDateTimeEsCl(g.evaluated_at)
              return (
                <div key={key} className="bg-white">
                  <div className="w-full px-4 py-3 flex flex-wrap items-center gap-2 hover:bg-slate-50">
                    <button
                      type="button"
                      className="text-slate-500 w-8 shrink-0 text-left"
                      aria-expanded={open}
                      onClick={() => setExpandedEvalLots((prev) => ({ ...prev, [key]: !open }))}
                    >
                      {open ? "▼" : "▶"}
                    </button>
                    <span className="font-medium text-slate-900 flex-1 min-w-[8rem]">{g.title}</span>
                    <span className="text-sm text-slate-600">{g.course_label}</span>
                    <span className="text-xs text-[var(--text-muted)]">{dateStr}</span>
                    <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                      {g.student_count} alumno{g.student_count !== 1 ? "s" : ""}
                    </span>
                    <button
                      type="button"
                      className="text-xs rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-sky-900 hover:bg-sky-100 ml-auto"
                      onClick={() => handleUseBatchInLink(g)}
                    >
                      Usar lote en vínculo
                    </button>
                    <button
                      type="button"
                      title="Archivar lote"
                      disabled={!g.batch_id || archivingBatchId === g.batch_id}
                      className="text-xs rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-rose-800 hover:bg-rose-100 disabled:opacity-60"
                      onClick={() => {
                        if (!g.batch_id) return
                        void archiveBatch(g.batch_id, g.title)
                      }}
                    >
                      {archivingBatchId === g.batch_id ? "…" : "✕"}
                    </button>
                  </div>
                  {open && (
                    <ul className="pl-10 pr-4 pb-3 text-sm space-y-1 text-[var(--text-muted)]">
                      {g.members.map((m) => (
                        <li key={m.id} className="flex flex-wrap gap-x-2">
                          <span className="font-medium text-slate-800">
                            {formatStudentDisplayName(m.student_name) || m.student_name || "Sin nombre"}
                          </span>
                          <span className="font-mono text-[11px]">{m.id}</span>
                          <span className="text-xs">
                            {formatDateTimeEsCl(m.evaluated_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          {evalOrphans.length > 0 && (
            <div className="px-4 py-3 border-t bg-amber-50/50">
              <h4 className="text-sm font-semibold text-amber-900">Sin lote (individuales / rezagados)</h4>
              <p className="text-xs text-amber-800/90 mt-0.5 mb-2">
                Si coinciden título y curso con un lote existente, puede anexar con un clic.
              </p>
              <ul className="space-y-2 text-sm">
                {evalOrphans.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 border border-amber-100 rounded-md px-2 py-2 bg-white">
                    <span className="font-medium">
                      {formatStudentDisplayName(o.student_name) || o.student_name || "Sin nombre"}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">{o.title}</span>
                    <span className="text-xs">{o.course_label}</span>
                    {o.suggest_annex_to_batch_id ? (
                      <button
                        type="button"
                        className="text-xs rounded-md bg-amber-700 text-white px-2 py-1 hover:bg-amber-800 ml-auto"
                        onClick={() => void annexOrphanToBatch(o.id, o.suggest_annex_to_batch_id!)}
                      >
                        Sugerir anexo al lote
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)] ml-auto">Sin lote compatible</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {showBatchLinkModal && batchLinkPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h4 className="text-base font-semibold text-slate-900">Confirmar categoría del lote</h4>
            <p className="mt-1 text-sm text-slate-600">
              Lote: <strong>{batchLinkPending.title}</strong>. Selecciona categoría para precargar el vínculo.
            </p>
            {batchLinkStatus ? (
              <p className="mt-2 text-xs text-slate-600">{batchLinkStatus}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={batchLinkSaving}
                className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
                onClick={() => confirmBatchLink("SIMCE")}
              >
                {batchLinkSaving ? "Vinculando..." : "Vincular como SIMCE"}
              </button>
              <button
                type="button"
                disabled={batchLinkSaving}
                className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
                onClick={() => confirmBatchLink("PAES")}
              >
                Vincular como PAES
              </button>
              <button
                type="button"
                disabled={batchLinkSaving}
                className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
                onClick={() => {
                  setShowBatchLinkModal(false)
                  setBatchLinkPending(null)
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {!loading && !error && (
        <div className="rounded-xl border border-[var(--border-color)] bg-white overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50">
            <h3 className="font-semibold">Alerta Temprana (Riesgo Alto/Crítico)</h3>
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Fecha</th>
                <th className="text-left px-4 py-3 font-semibold">Alumno ID</th>
                <th className="text-left px-4 py-3 font-semibold" title={uiLegacyTooltipCoberturaCol()}>
                  {uiTablaCoberturaCol()}
                </th>
                <th className="text-left px-4 py-3 font-semibold" title={uiLegacyTooltipEstandarCol()}>
                  {uiTablaEstandarAgenciaCol()}
                </th>
                <th className="text-left px-4 py-3 font-semibold">PAES</th>
                <th className="text-left px-4 py-3 font-semibold">Riesgo</th>
              </tr>
            </thead>
            <tbody>
              {riskRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-[var(--text-muted)]">Sin alertas de riesgo alto por ahora.</td>
                </tr>
              ) : (
                riskRows.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--border-color)]">
                    <td className="px-4 py-3">{formatDateTimeEsCl(row.calculated_at)}</td>
                    <td className="px-4 py-3">{row.student_id ?? "—"}</td>
                    <td className="px-4 py-3">{Math.round(row.logro_pct)}%</td>
                    <td className="px-4 py-3">{row.agency_level ?? "—"}</td>
                    <td className="px-4 py-3">{row.paes_estimated ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        String(row.risk_level ?? "").toUpperCase() === "CRITICO"
                          ? "bg-red-100 text-red-700"
                          : "bg-rose-100 text-rose-700"
                      }`}>
                        {row.risk_level ?? "ALTO"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {!loading && (
        <div className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="font-semibold">Análisis 360° (El Juez)</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Misma lista que arriba: el botón rojo quita la prueba completa de la bandeja (no es borrar preguntas del
              informe).
            </p>
          </div>
          {reports.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Aún no hay informes auditados.</p>
          ) : (
            <div className="space-y-3">
              {reports.map((r) => {
                const doc = r.content ?? {}
                const rc = juezRootCause(doc)
                const qQual = asArray<{ issue: string; severity: string; evidence: string }>(doc.question_quality)
                const cAlign = asArray<{ check: string; status: string; detail: string }>(doc.curricular_alignment)
                const cardUploadId = String(r.upload_id ?? "").trim()
                return (
                <article key={r.id} className="rounded-lg border border-[var(--border-color)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium min-w-0 flex-1">{String(doc.analysis_summary ?? "")}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {formatDateTimeEsCl(r.created_at)}
                      </span>
                      <button
                        type="button"
                        title="Archivar prueba base completa"
                        aria-label="Archivar prueba base completa"
                        disabled={!cardUploadId || archivingInstrumentId === cardUploadId}
                        className="inline-flex items-center justify-center rounded-md bg-red-600 p-2 text-white hover:bg-red-700 disabled:opacity-50"
                        onClick={() => void archiveInstrument(cardUploadId)}
                      >
                        {archivingInstrumentId === cardUploadId ? (
                          <span className="text-xs font-semibold px-0.5">…</span>
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(
                        Math.round(Number(rc.approval_risk_pct ?? 0)),
                      )}`}
                    >
                      Riesgo aprobación: {Math.round(Number(rc.approval_risk_pct ?? 0))}%
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {qQual.slice(0, 2).map((q, idx) => (
                      <span key={idx} className="text-xs rounded-full px-2 py-0.5 bg-rose-50 border border-rose-200 text-rose-700">
                        {q.severity}: {q.issue}
                      </span>
                    ))}
                    {cAlign.slice(0, 2).map((row, idx) => (
                      <span key={`c-${idx}`} className="text-xs rounded-full px-2 py-0.5 bg-sky-50 border border-sky-200 text-sky-700">
                        {row.status}: {row.check}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setSelectedReport(r)}
                      className="text-sm rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
                    >
                      Ver desglose pedagógico
                    </button>
                  </div>
                </article>
                )
              })}
            </div>
          )}
        </div>
      )}
      {!loading && !error && selectedReport && (
        <div className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold">Informe de auditoría (360°)</h3>
            <button
              type="button"
              onClick={() => setSelectedReport(null)}
              className="text-sm rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
          <div className="flex gap-1 border-b border-slate-200 mb-4">
            <button
              type="button"
              onClick={() => setDetailTab("juez")}
              className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px ${
                detailTab === "juez"
                  ? "border-slate-900 text-slate-900 bg-slate-50"
                  : "border-transparent text-[var(--text-muted)] hover:text-slate-700"
              }`}
            >
              Auditoría del Juez
            </button>
            <button
              type="button"
              onClick={() => setDetailTab("aula")}
              className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px ${
                detailTab === "aula"
                  ? "border-slate-900 text-slate-900 bg-slate-50"
                  : "border-transparent text-[var(--text-muted)] hover:text-slate-700"
              }`}
            >
              Desempeño en Aula
            </button>
          </div>
          {detailTab === "juez" ? (
            <UtpAuditoriaJuezPanel content={selectedReport.content ?? {}} />
          ) : (
            <div className="space-y-6">
              {utpLotDraftIds && utpLotDraftIds.length > 0 && (
                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 flex flex-wrap items-center gap-2">
                  <span>
                    Vínculo masivo: <strong>{utpLotDraftIds.length}</strong> evaluaciones del lote. Al guardar, la categoría se aplica a todo el lote.
                  </span>
                  <button
                    type="button"
                    className="text-xs underline text-sky-800 ml-auto"
                    onClick={() => {
                      setUtpLotDraftIds(null)
                      setUtpLotDraftAssessmentType(null)
                    }}
                  >
                    Quitar selección de lote
                  </button>
                </div>
              )}
              <EvaluationLinkSelector
                reportId={selectedReport.id}
                linkedEvaluationIds={utpLotDraftIds ?? getLinkedEvalIds(selectedReport)}
                linkedAssessmentType={utpLotDraftAssessmentType ?? getLinkedAssessmentType(selectedReport)}
                onSaved={(payload: { evaluation_ids: string[]; assessment_type?: string | null }) => {
                  setUtpLotDraftIds(null)
                  setUtpLotDraftAssessmentType(null)
                  setOutcomesRefresh((x) => x + 1)
                  void loadUtpDashboard()
                  router.refresh()
                  alert("Vínculo UTP guardado correctamente.")
                  window.location.reload()
                  setSelectedReport((prev) => {
                    if (!prev) return null
                    const baseContent = { ...(prev.content ?? {}) }
                    if (payload.evaluation_ids.length === 0) {
                      delete baseContent.student_outcomes_link
                    } else {
                      baseContent.student_outcomes_link = {
                        evaluation_ids: payload.evaluation_ids,
                        ...(payload.assessment_type ? { assessment_type: payload.assessment_type } : {}),
                      }
                    }
                    return { ...prev, content: baseContent, raw_content: baseContent }
                  })
                }}
              />
              <ResultsMirror auditReportId={selectedReport.id} refreshToken={outcomesRefresh} />
            </div>
          )}
        </div>
      )}
      {!loading && !error && (
        <>
          <div className="rounded-xl border border-[var(--border-color)] bg-white overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Fecha/Hora</th>
                  <th className="text-left px-4 py-3 font-semibold">Profesor</th>
                  <th className="text-left px-4 py-3 font-semibold">Acción</th>
                  <th className="text-left px-4 py-3 font-semibold">Alumno / Curso</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">Sin registros todavía.</td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border-color)]">
                      <td className="px-4 py-3">{formatDateTimeEsCl(row.created_at)}</td>
                      <td className="px-4 py-3">{row.actor_name || "—"}</td>
                      <td className="px-4 py-3">{row.action || "—"}</td>
                      <td className="px-4 py-3">{row.student_or_course || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <details className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <summary className="cursor-pointer select-none text-sm font-semibold text-amber-900">
              Vista experimental (bloques nuevos)
            </summary>
            <p className="mt-2 text-xs text-amber-900/90">
              Estos bloques se mantienen visibles solo como referencia y no reemplazan la lectura pedagógica principal basada en
              <code> school-pedagogy</code>.
            </p>
            <div className="space-y-6 sm:space-y-8 max-w-[1600px] mx-auto pt-3">
              <UtpDemoReportBlock />
              <UtpChartsBlock />
              <UtpByTeacherBlock />
            </div>
          </details>
        </>
      )}
      {!loading && error && (
        <div className="space-y-6 sm:space-y-8 max-w-[1600px] mx-auto pt-2">
          <UtpDemoReportBlock />
          <UtpChartsBlock />
          <UtpByTeacherBlock />
        </div>
      )}
    </section>
  )
}
