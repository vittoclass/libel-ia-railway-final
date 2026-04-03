"use client"

import { useCallback, useEffect, useState } from "react"
import { EvaluationLinkSelector } from "@/app/components/dashboard/utp/EvaluationLinkSelector"
import { ResultsMirror } from "@/app/components/dashboard/utp/ResultsMirror"
import { UtpAuditoriaJuezPanel } from "@/app/components/dashboard/utp/UtpAuditoriaJuezPanel"
import { UtpPendingBatchReleasesPanel } from "@/app/components/dashboard/utp/UtpPendingBatchReleasesPanel"
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

type EvalOrphanRow = EvalLotMember & {
  title: string
  course_label: string
  suggest_annex_to_batch_id: string | null
}

export default function DashboardUtpPage() {
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
  const [evalLotGroups, setEvalLotGroups] = useState<EvalLotGroup[]>([])
  const [evalOrphans, setEvalOrphans] = useState<EvalOrphanRow[]>([])
  const [expandedEvalLots, setExpandedEvalLots] = useState<Record<string, boolean>>({})
  /** IDs prellenados desde un lote OMR para vínculo masivo en el selector. */
  const [utpLotDraftIds, setUtpLotDraftIds] = useState<string[] | null>(null)

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

    return {
      id: String(base?.id ?? raw?.id ?? crypto.randomUUID()),
      upload_id: String(base?.upload_id ?? raw?.id ?? ""),
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
    const data = Array.isArray(reportJson?.items) ? reportJson.items.map(normalizeInstrumentItem) : []
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
      const reportJson = await reportRes.json()
      const data = Array.isArray(reportJson?.items) ? reportJson.items.map(normalizeInstrumentItem) : []
      console.log("DATOS RECUPERADOS PARA LA TABLA:", data)

      try {
        if (batchesRes.ok) {
          const bj = (await batchesRes.json()) as { groups?: EvalLotGroup[]; orphans?: EvalOrphanRow[] }
          setEvalLotGroups(Array.isArray(bj?.groups) ? bj.groups : [])
          setEvalOrphans(Array.isArray(bj?.orphans) ? bj.orphans : [])
        } else {
          setEvalLotGroups([])
          setEvalOrphans([])
        }
      } catch {
        setEvalLotGroups([])
        setEvalOrphans([])
      }

      let omrSemaforo: { insuficiente: number; elemental: number; adecuado: number; total: number } | null = null
      let cobertura: number | null = null
      let simceProy = 0
      let paesProy = 0
      try {
        if (dirRes && dirRes.ok) {
          const dj = (await dirRes.json()) as {
            semaforo?: { insuficiente?: number; elemental?: number; adecuado?: number; total?: number }
            kpis?: {
              promedio_logro_institucional?: number
              simce_proyectado_promedio?: number
              paes_proyectado_promedio?: number
            }
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
        }
      } catch {
        omrSemaforo = null
        cobertura = null
        simceProy = 0
        paesProy = 0
      }

      setSimceProyectadoOmr(simceProy)
      setPaesProyectadoOmr(paesProy)

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
      setRows([])
      setRiskRows([])
      setCoberturaInstitucionalOmr(null)
      setOmrLiveActive(false)
      setSimceProyectadoOmr(0)
      setPaesProyectadoOmr(0)
      setEvalLotGroups([])
      setEvalOrphans([])
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
    void loadUtpDashboard()
  }

  useEffect(() => {
    if (selectedReport?.id) {
      setDetailTab("juez")
    }
    setUtpLotDraftIds(null)
  }, [selectedReport?.id])

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

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Auditoría UTP</h2>
        <button
          type="button"
          onClick={() => syncRealData()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Sincronizar Datos Reales
        </button>
      </div>
      <UtpPendingBatchReleasesPanel refreshTrigger={outcomesRefresh} />
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
              Misma agregación que Panel Dirección (evaluaciones vinculadas por UTP o últimas en alcance institucional).
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
              const dateStr = g.evaluated_at ? new Date(g.evaluated_at).toLocaleString("es-CL") : "—"
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
                      onClick={() => setUtpLotDraftIds([...g.evaluation_ids])}
                    >
                      Usar lote en vínculo
                    </button>
                  </div>
                  {open && (
                    <ul className="pl-10 pr-4 pb-3 text-sm space-y-1 text-[var(--text-muted)]">
                      {g.members.map((m) => (
                        <li key={m.id} className="flex flex-wrap gap-x-2">
                          <span className="font-medium text-slate-800">{m.student_name ?? "Sin nombre"}</span>
                          <span className="font-mono text-[11px]">{m.id}</span>
                          <span className="text-xs">
                            {m.evaluated_at ? new Date(m.evaluated_at).toLocaleString("es-CL") : "—"}
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
                    <span className="font-medium">{o.student_name ?? "Sin nombre"}</span>
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
                    <td className="px-4 py-3">{row.calculated_at ? new Date(row.calculated_at).toLocaleString("es-CL") : "—"}</td>
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
      {!loading && !error && (
        <div className="rounded-xl border border-[var(--border-color)] bg-white p-4 shadow-sm">
          <h3 className="font-semibold">Análisis 360° (El Juez)</h3>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Hallazgos preventivos, sustento normativo y diagnóstico de causa raíz.
          </p>
          {reports.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Aún no hay informes auditados.</p>
          ) : (
            <div className="space-y-3">
              {reports.slice(0, 5).map((r) => {
                const doc = r.content ?? {}
                const rc = juezRootCause(doc)
                const qQual = asArray<{ issue: string; severity: string; evidence: string }>(doc.question_quality)
                const cAlign = asArray<{ check: string; status: string; detail: string }>(doc.curricular_alignment)
                return (
                <article key={r.id} className="rounded-lg border border-[var(--border-color)] p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{String(doc.analysis_summary ?? "")}</p>
                    <span className="text-xs text-[var(--text-muted)]">
                      {r.created_at ? new Date(r.created_at).toLocaleString("es-CL") : "—"}
                    </span>
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
                    onClick={() => setUtpLotDraftIds(null)}
                  >
                    Quitar selección de lote
                  </button>
                </div>
              )}
              <EvaluationLinkSelector
                reportId={selectedReport.id}
                linkedEvaluationIds={utpLotDraftIds ?? getLinkedEvalIds(selectedReport)}
                linkedAssessmentType={getLinkedAssessmentType(selectedReport)}
                onSaved={(payload) => {
                  setUtpLotDraftIds(null)
                  setOutcomesRefresh((x) => x + 1)
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
                    <td className="px-4 py-3">{row.created_at ? new Date(row.created_at).toLocaleString("es-CL") : "—"}</td>
                    <td className="px-4 py-3">{row.actor_name || "—"}</td>
                    <td className="px-4 py-3">{row.action || "—"}</td>
                    <td className="px-4 py-3">{row.student_or_course || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
