"use client"

/**
 * Modal de detalle (solo lectura): GET /api/evaluations/[id].
 * PDF de corrección: mismo documento react-pdf que el evaluador (CorrectionReportPdfDocument + datos vía buildCorrectionReportGroupFromApiDetail).
 */
import * as React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { pdf } from "@react-pdf/renderer"
import { Button } from "@/components/ui/button"
import { FileDown, Loader2, X } from "lucide-react"
import { exportElementToPdf } from "@/app/lib/export-report-pdf"
import { resolveStudentDisplayName } from "@/app/lib/student-display-name"
import { useToast } from "@/hooks/use-toast"
import {
  buildCorrectionReportGroupFromApiDetail,
  type EvaluationDetailJsonForCorrectionZip,
} from "@/app/lib/correction-report-from-evaluation-detail"
import { CorrectionReportPdfDocument } from "@/app/components/correction-report/CorrectionReportPdfDocument"
import { buildPedagogicalResumenFromGroup } from "@/app/lib/pedagogical-feedback-from-group"
import {
  buildDevelopmentOrdinalMap,
  formatDevelopmentItemDisplayLabel,
  inferTipoPruebaRealForDisplay,
  sortDevelopmentItemKeys,
} from "@/app/lib/development-item-display-label"

type ApiItem = {
  question_number?: number | string | null
  student_answer?: string | null
  correct_answer?: string | null
  is_correct?: boolean | null
  score_obtained?: number | null
  score_max?: number | null
}

type Props = {
  evaluationId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  autoDownloadPdf?: boolean
  onAutoDownloadPdfConsumed?: () => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function formatCourseForUser(course_label?: string | null, course_id?: string | null): string {
  const lbl = String(course_label ?? "").trim()
  if (lbl && !UUID_RE.test(lbl)) return lbl
  if (lbl && UUID_RE.test(lbl)) return "Sin etiqueta de curso"
  const cid = String(course_id ?? "").trim()
  if (cid && UUID_RE.test(cid)) return "Sin etiqueta de curso"
  return "Sin curso"
}

function formatStrengthsImprovements(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.trim()
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const fort = o.fortalezas ?? o.strengths
    const mej = o.mejoras ?? o.areas_mejora ?? o.improvements
    const parts: string[] = []
    if (typeof fort === "string" && fort.trim()) parts.push(`Fortalezas: ${fort.trim()}`)
    if (typeof mej === "string" && mej.trim()) parts.push(`Por mejorar: ${mej.trim()}`)
    return parts.join("\n\n")
  }
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n")
  }
  return String(v)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function DocenteEvaluationDetailModal({
  evaluationId,
  open,
  onOpenChange,
  autoDownloadPdf = false,
  onAutoDownloadPdfConsumed,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const autoPdfDoneRef = useRef(false)
  const { toast } = useToast()

  const correctionBuild = useMemo(() => {
    if (!payload) return null
    return buildCorrectionReportGroupFromApiDetail(payload as EvaluationDetailJsonForCorrectionZip)
  }, [payload])

  const tipoPruebaRealForLabels = useMemo(() => {
    if (!payload) return "mixta" as const
    const summary = payload.summary as Record<string, unknown> | null | undefined
    const summaryRaw =
      summary && typeof summary.raw === "object" && summary.raw != null
        ? (summary.raw as Record<string, unknown>)
        : null
    const group = correctionBuild?.ok === true ? correctionBuild.group : null
    return inferTipoPruebaRealForDisplay({
      tipoPrueba:
        typeof summaryRaw?.tipoPrueba === "string"
          ? summaryRaw.tipoPrueba
          : typeof payload.tipoPrueba === "string"
            ? String(payload.tipoPrueba)
            : null,
      detalle_desarrollo: group?.detalle_desarrollo,
      alternativas_corregidas: group?.alternativas_corregidas,
    })
  }, [payload, correctionBuild])

  useEffect(() => {
    if (!open || !evaluationId) {
      setPayload(null)
      setError(null)
      setLoading(false)
      autoPdfDoneRef.current = false
      return
    }
    setLoading(true)
    setError(null)
    setPayload(null)
    autoPdfDoneRef.current = false
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/evaluations/${encodeURIComponent(evaluationId)}`, {
          credentials: "include",
          cache: "no-store",
        })
        const j = (await res.json()) as Record<string, unknown>
        if (cancelled) return
        if (!res.ok) {
          const msg =
            typeof j.error === "string"
              ? j.error
              : typeof j.message === "string"
                ? j.message
                : `Error ${res.status}`
          setError(msg)
          setPayload(null)
          return
        }
        setPayload(j)
      } catch {
        if (!cancelled) {
          setError("Error de red al cargar la evaluación")
          setPayload(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, evaluationId])

  const runCorrectionPdfDownload = React.useCallback(async () => {
    const ev = payload?.evaluation as Record<string, unknown> | undefined
    const title = String(ev?.title ?? "evaluacion")
      .replace(/[^\w\u00C0-\u024F\s\-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 60)
    const filename = `libelia_informe_correccion_${title}.pdf`

    if (correctionBuild?.ok === true) {
      setPdfBusy(true)
      try {
        const formData = {
          nombreProfesor: "—",
          asignatura: String(ev?.subject ?? "—"),
          departamento: "—",
          nombrePrueba: String(ev?.title ?? "—"),
          curso: formatCourseForUser(
            ev?.course_label != null ? String(ev.course_label) : null,
            ev?.course_id != null ? String(ev.course_id) : null,
          ),
          nivelEducativo: "Media",
          porcentajeExigencia: "60",
          tipoPrueba: tipoPruebaRealForLabels,
        }
        const evaluatedAt = ev?.evaluated_at != null ? String(ev.evaluated_at) : null
        const doc = (
          <CorrectionReportPdfDocument
            group={correctionBuild.group}
            formData={formData}
            evaluatedAt={evaluatedAt}
          />
        )
        const blob = await pdf(doc).toBlob()
        downloadBlob(blob, filename)
      } catch (e) {
        console.warn("[docente-eval-modal] pdf react-pdf", e)
        toast({ title: "No se pudo generar el PDF del informe completo.", variant: "destructive" })
      } finally {
        setPdfBusy(false)
      }
      return
    }

    const el = reportRef.current
    if (!el) return
    setPdfBusy(true)
    const result = await exportElementToPdf(el, filename)
    setPdfBusy(false)
    if (!result.ok && result.error) toast({ title: result.error, variant: "destructive" })
  }, [correctionBuild, payload, toast, tipoPruebaRealForLabels])

  useEffect(() => {
    if (!autoDownloadPdf || !payload || loading || error || autoPdfDoneRef.current) return
    const timer = window.setTimeout(() => {
      if (autoPdfDoneRef.current) return
      autoPdfDoneRef.current = true
      void (async () => {
        await runCorrectionPdfDownload()
        onAutoDownloadPdfConsumed?.()
      })()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [autoDownloadPdf, payload, loading, error, onAutoDownloadPdfConsumed, runCorrectionPdfDownload])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  if (!open) return null

  const evaluation = payload?.evaluation as Record<string, unknown> | undefined
  const summary = payload?.summary as Record<string, unknown> | null | undefined
  const students = Array.isArray(payload?.students) ? (payload!.students as Array<Record<string, unknown>>) : []
  const items = Array.isArray(payload?.items) ? (payload!.items as ApiItem[]) : []

  let obtained = 0
  let max = 0
  for (const it of items) {
    obtained += Number(it.score_obtained) || 0
    max += Number(it.score_max) || 0
  }
  const logroPct = max > 0 ? Math.round((obtained / max) * 10000) / 100 : null

  const strengthsText = formatStrengthsImprovements(summary?.strengths)
  const improvementsText = formatStrengthsImprovements(summary?.improvements)

  const studentNameLine = (() => {
    const fromRows =
      students.length > 0
        ? students
            .map((s) =>
              resolveStudentDisplayName({
                student_name: s.student_name != null ? String(s.student_name) : null,
                student_name_raw: null,
                raw: null,
              }).trim(),
            )
            .filter(Boolean)
            .join(" · ")
        : ""
    if (fromRows) return fromRows
    const evn = String(evaluation?.student_name ?? "").trim()
    if (evn) return evn
    const snr =
      summary?.student_name_raw != null && String(summary.student_name_raw).trim() !== ""
        ? String(summary.student_name_raw).trim()
        : ""
    if (snr) return snr
    const fromRawOnly = resolveStudentDisplayName({
      student_name: null,
      student_name_raw: null,
      raw: summary?.raw,
    }).trim()
    return fromRawOnly || "Alumno sin identificar"
  })()

  const richGroup = correctionBuild?.ok === true ? correctionBuild.group : null
  const devKeysForModal = sortDevelopmentItemKeys(
    Object.keys(richGroup?.detalle_desarrollo || {}),
  )
  const devOrdinalMapForModal = buildDevelopmentOrdinalMap(devKeysForModal, tipoPruebaRealForLabels)
  const itemOrdinalByIndex = (() => {
    const map = new Map<number, number>()
    if (tipoPruebaRealForLabels !== "solo_desarrollo") return map
    const sorted = [...items]
      .map((it, idx) => ({ it, idx }))
      .sort(
        (a, b) =>
          (Number(a.it.question_number) || 0) - (Number(b.it.question_number) || 0) ||
          a.idx - b.idx,
      )
    sorted.forEach((entry, i) => map.set(entry.idx, i + 1))
    return map
  })()
  const resumenRich = richGroup
    ? buildPedagogicalResumenFromGroup({
        alternativas_corregidas: richGroup.alternativas_corregidas,
        puntaje: richGroup.puntaje,
        puntosMaximos: richGroup.puntosMaximos,
        puntosAprobacion: richGroup.puntosAprobacion,
        detalle_desarrollo: richGroup.detalle_desarrollo,
      })
    : null

  const courseLine = evaluation
    ? formatCourseForUser(
        evaluation.course_label != null ? String(evaluation.course_label) : null,
        evaluation.course_id != null ? String(evaluation.course_id) : null,
      )
    : "—"

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/75"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="docente-eval-modal-title"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 flex-1 pr-2">
            <h2 id="docente-eval-modal-title" className="text-base font-semibold text-slate-900">
              {loading ? "Cargando…" : evaluation ? String(evaluation.title ?? "Evaluación") : "Detalle"}
            </h2>
            {!loading && evaluation ? (
              <p className="mt-1 truncate text-sm font-medium text-slate-800" title={studentNameLine}>
                {studentNameLine}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Cerrar"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!loading && !error && evaluation ? (
            <div className="mb-3 space-y-2">
              {richGroup ? (
                <p className="rounded-md border border-emerald-100 bg-emerald-50/90 px-3 py-2 text-xs text-emerald-950 leading-snug">
                  <span className="font-semibold">Informe de corrección completo</span> (mismo formato PDF que en el
                  evaluador: fortalezas, áreas de mejora, corrección detallada, alternativas y habilidades según datos
                  guardados).
                </p>
              ) : (
                <p className="rounded-md border border-amber-100 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 leading-snug">
                  <span className="font-semibold">Resumen operativo</span>: faltan datos persistidos para armar el
                  informe completo (p. ej. alternativas/desarrollo o puntaje). El PDF usará esta vista resumida. Para el
                  flujo completo de corrección, use el{" "}
                  <Link href="/evaluar" className="font-medium underline">
                    evaluador
                  </Link>
                  .
                </p>
              )}
              {evaluationId ? (
                <p className="text-xs text-slate-600">
                  <Link
                    href={`/dashboard/docente/evaluacion/${encodeURIComponent(evaluationId)}`}
                    className="font-medium text-sky-800 hover:underline"
                  >
                    Abrir esta evaluación en página completa
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
          <div ref={reportRef} className="space-y-4 text-sm text-slate-800">
            {loading ? (
              <div className="flex items-center gap-2 text-slate-600 py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
                Cargando evaluación…
              </div>
            ) : error ? (
              <p className="text-red-700">{error}</p>
            ) : evaluation ? (
              <>
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600">
                  <p>
                    <span className="font-medium text-slate-800">Estudiante(s):</span> {studentNameLine}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">Curso:</span> {courseLine}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">Asignatura:</span> {String(evaluation.subject ?? "—")}
                  </p>
                  {evaluation.evaluated_at ? (
                    <p>
                      <span className="font-medium text-slate-800">Fecha:</span>{" "}
                      {new Date(String(evaluation.evaluated_at)).toLocaleString("es-CL")}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-slate-200 p-2">
                    <div className="text-[10px] uppercase text-slate-500">Nota</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {summary?.grade_chile != null && Number.isFinite(Number(summary.grade_chile))
                        ? Number(summary.grade_chile)
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-2">
                    <div className="text-[10px] uppercase text-slate-500">Puntaje</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {max > 0 ? `${Math.round(obtained * 10) / 10} / ${Math.round(max * 10) / 10}` : "—"}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-2 col-span-2 sm:col-span-1">
                    <div className="text-[10px] uppercase text-slate-500">Logro</div>
                    <div className="text-lg font-semibold tabular-nums">{logroPct != null ? `${logroPct}%` : "—"}</div>
                  </div>
                </div>

                {students.length > 0 ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-slate-500 mb-1">Estudiantes</h4>
                    <ul className="list-disc list-inside text-slate-700">
                      {students.map((s, i) => (
                        <li key={i}>
                          {resolveStudentDisplayName({
                            student_name: s.student_name != null ? String(s.student_name) : null,
                            student_name_raw: null,
                            raw: null,
                          }).trim() || "Alumno sin identificar"}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {resumenRich ? (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 space-y-2">
                    <h4 className="text-xs font-semibold uppercase text-emerald-900/80">Retroalimentación (informe)</h4>
                    <p className="whitespace-pre-wrap text-emerald-950/90">
                      <span className="font-semibold">Fortalezas: </span>
                      {resumenRich.fortalezas?.trim() ? resumenRich.fortalezas : "—"}
                    </p>
                    <p className="whitespace-pre-wrap text-emerald-950/90">
                      <span className="font-semibold">Áreas de mejora: </span>
                      {resumenRich.areas_mejora?.trim() ? resumenRich.areas_mejora : "—"}
                    </p>
                  </div>
                ) : (strengthsText || improvementsText) && (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 space-y-2">
                    <h4 className="text-xs font-semibold uppercase text-emerald-900/80">Resumen (summary)</h4>
                    {strengthsText ? (
                      <p className="whitespace-pre-wrap text-emerald-950/90">{strengthsText}</p>
                    ) : null}
                    {improvementsText ? (
                      <p className="whitespace-pre-wrap text-emerald-950/90">{improvementsText}</p>
                    ) : null}
                  </div>
                )}

                {richGroup?.retroalimentacion?.evaluacion_habilidades &&
                richGroup.retroalimentacion.evaluacion_habilidades.length > 0 ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">Evaluación de habilidades</h4>
                    <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 text-xs">
                      <table className="min-w-full">
                        <thead className="bg-slate-100 sticky top-0">
                          <tr>
                            <th className="p-2 text-left">Habilidad</th>
                            <th className="p-2 text-left">Nivel</th>
                            <th className="p-2 text-left">Evidencia</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            richGroup.retroalimentacion.evaluacion_habilidades as Array<{
                              habilidad?: string
                              evaluacion?: string
                              evidencia?: string
                            }>
                          ).map((row, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="p-2 align-top">{row.habilidad ?? "—"}</td>
                              <td className="p-2 align-top">{row.evaluacion ?? "—"}</td>
                              <td className="p-2 align-top">{row.evidencia ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {richGroup?.retroalimentacion?.retroalimentacion_alternativas &&
                richGroup.retroalimentacion.retroalimentacion_alternativas.length > 0 ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">Alternativas corregidas</h4>
                    <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 text-xs">
                      <table className="min-w-full">
                        <thead className="bg-slate-100 sticky top-0">
                          <tr>
                            <th className="p-2 text-left">Pregunta</th>
                            <th className="p-2 text-left">Estudiante</th>
                            <th className="p-2 text-left">Correcta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {richGroup.retroalimentacion.retroalimentacion_alternativas.map(
                            (
                              row: {
                                pregunta?: string
                                respuesta_estudiante?: string
                                respuesta_correcta?: string
                              },
                              i: number,
                            ) => (
                              <tr key={i} className="border-t border-slate-100">
                                <td className="p-2 align-top max-w-[120px]">{row.pregunta ?? "—"}</td>
                                <td className="p-2 align-top">{row.respuesta_estudiante ?? "—"}</td>
                                <td className="p-2 align-top">{row.respuesta_correcta ?? "—"}</td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {richGroup?.detalle_desarrollo && Object.keys(richGroup.detalle_desarrollo).length > 0 ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">Desarrollo</h4>
                    <ul className="space-y-2 text-xs">
                      {Object.entries(richGroup.detalle_desarrollo).map(([k, v]) => (
                        <li key={k} className="rounded border border-slate-100 bg-slate-50/80 p-2">
                          <div className="font-semibold text-slate-800">
                            {formatDevelopmentItemDisplayLabel(
                              k,
                              tipoPruebaRealForLabels,
                              devOrdinalMapForModal.get(k),
                            )}
                          </div>
                          <div className="mt-1 text-slate-700 whitespace-pre-wrap">
                            {typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {items.length > 0 ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">Ítems (respuestas)</h4>
                    <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-100 sticky top-0">
                          <tr className="text-left text-slate-600">
                            <th className="p-2">N°</th>
                            <th className="p-2">Estudiante</th>
                            <th className="p-2">Correcta</th>
                            <th className="p-2">Pts</th>
                            <th className="p-2">Ok</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, idx) => {
                            const n = it.question_number
                            const soloDevOrdinal = itemOrdinalByIndex.get(idx)
                            const numLabel =
                              tipoPruebaRealForLabels === "solo_desarrollo" && soloDevOrdinal != null
                                ? formatDevelopmentItemDisplayLabel("", tipoPruebaRealForLabels, soloDevOrdinal)
                                : typeof n === "number" && Number.isFinite(n)
                                  ? String(n)
                                  : typeof n === "string" && n.trim()
                                    ? n.trim()
                                    : String(idx + 1)
                            const ok = it.is_correct === true
                            const wrong = it.is_correct === false
                            return (
                              <tr
                                key={idx}
                                className={
                                  ok ? "bg-emerald-50/60" : wrong ? "bg-rose-50/60" : "bg-white border-t border-slate-100"
                                }
                              >
                                <td className="p-2 tabular-nums">{numLabel}</td>
                                <td className="p-2 max-w-[140px] truncate" title={String(it.student_answer ?? "")}>
                                  {String(it.student_answer ?? "—")}
                                </td>
                                <td className="p-2 max-w-[140px] truncate" title={String(it.correct_answer ?? "")}>
                                  {String(it.correct_answer ?? "—")}
                                </td>
                                <td className="p-2 tabular-nums whitespace-nowrap">
                                  {Number(it.score_obtained) || 0}/{Number(it.score_max) || 0}
                                </td>
                                <td className="p-2">{ok ? "✓" : wrong ? "✗" : "—"}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs">Sin ítems en esta evaluación.</p>
                )}
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 p-4 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={pdfBusy || loading || !!error || !payload}
            onClick={() => void runCorrectionPdfDownload()}
          >
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
            {correctionBuild?.ok === true ? "Descargar informe corrección (PDF)" : "Descargar resumen (PDF)"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  )
}
