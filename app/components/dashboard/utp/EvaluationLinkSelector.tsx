"use client"

import { useCallback, useEffect, useState } from "react"
import { FLAT_ASSESSMENT_TYPES, parseAssessmentTypeToFlat, type FlatAssessmentType } from "@/app/lib/assessment-category"

type SearchHit = {
  id: string
  title: string | null
  subject: string | null
  course_label: string | null
  evaluated_at: string | null
}

export type StudentOutcomesLinkSavePayload = {
  evaluation_ids: string[]
  assessment_type?: string | null
}

const FLAT_LABELS: Record<FlatAssessmentType, string> = {
  MENSUAL: "Mensual (interna corta)",
  LIBRO: "Libro",
  SEMESTRAL: "Semestral",
  ENSAYO_SIMCE: "Ensayo SIMCE",
  ENSAYO_PAES: "Ensayo PAES",
}

type EvaluationLinkSelectorProps = {
  reportId: string
  /** IDs ya vinculados (desde content.student_outcomes_link) */
  linkedEvaluationIds: string[]
  /** Valor crudo guardado (plano o legado); se normaliza al mostrar. */
  linkedAssessmentType?: string | null
  onSaved: (payload: StudentOutcomesLinkSavePayload) => void
}

export function EvaluationLinkSelector({
  reportId,
  linkedEvaluationIds,
  linkedAssessmentType,
  onSaved,
}: EvaluationLinkSelectorProps) {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [selected, setSelected] = useState<string[]>(linkedEvaluationIds)
  const [assessmentType, setAssessmentType] = useState<FlatAssessmentType | "">("")
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setSelected(linkedEvaluationIds)
  }, [linkedEvaluationIds.join("|"), reportId])

  useEffect(() => {
    const flat =
      linkedAssessmentType != null && String(linkedAssessmentType).trim() !== ""
        ? parseAssessmentTypeToFlat(String(linkedAssessmentType))
        : null
    setAssessmentType(flat ?? "")
  }, [linkedAssessmentType, reportId])

  const runSearch = useCallback(async () => {
    setSearching(true)
    setMessage(null)
    try {
      const url = new URL("/api/dashboard/utp/evaluations-search", window.location.origin)
      if (q.trim().length >= 2) url.searchParams.set("q", q.trim())
      url.searchParams.set("limit", "50")
      const res = await fetch(url.toString(), { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      setHits(Array.isArray(json?.items) ? json.items : [])
    } catch {
      setHits([])
    } finally {
      setSearching(false)
    }
  }, [q])

  useEffect(() => {
    const t = setTimeout(() => {
      void runSearch()
    }, 300)
    return () => clearTimeout(t)
  }, [runSearch, q])

  async function saveLink() {
    if (!assessmentType) {
      setMessage("Selecciona el tipo de prueba (clasificación para trazabilidad por alumno).")
      return
    }
    if (selected.length === 0) {
      setMessage("Selecciona al menos una evaluación para vincular.")
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/dashboard/utp/instruments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId, evaluation_ids: selected, assessment_type: assessmentType }),
      })
      const json = await res.json().catch(() => ({}))
      if (!json?.ok) {
        setMessage(json?.error ?? "No se pudo guardar el vínculo.")
        return
      }
      setMessage("Vínculo guardado.")
      try {
        localStorage.setItem("utp_link_updated_at", String(Date.now()))
      } catch {
        /* noop */
      }
      const link = json?.content?.student_outcomes_link
      const savedFlat =
        link && typeof link === "object" && typeof (link as { assessment_type?: unknown }).assessment_type === "string"
          ? parseAssessmentTypeToFlat(String((link as { assessment_type: string }).assessment_type))
          : parseAssessmentTypeToFlat(assessmentType)
      if (savedFlat) setAssessmentType(savedFlat)
      onSaved({
        evaluation_ids: selected,
        assessment_type: savedFlat ?? assessmentType,
      })
    } catch {
      setMessage("Error de red al guardar.")
    } finally {
      setSaving(false)
    }
  }

  async function clearLink() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/dashboard/utp/instruments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId, clear: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!json?.ok) {
        setMessage(json?.error ?? "No se pudo limpiar el vínculo.")
        return
      }
      setSelected([])
      setAssessmentType("")
      setMessage("Vínculo eliminado.")
      try {
        localStorage.setItem("utp_link_updated_at", String(Date.now()))
      } catch {
        /* noop */
      }
      onSaved({ evaluation_ids: [], assessment_type: null })
    } catch {
      setMessage("Error de red.")
    } finally {
      setSaving(false)
    }
  }

  function toggleId(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-800">Vínculo con evaluaciones reales</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Busque evaluaciones corregidas y selecciónelas. Solo lectura de resultados; no modifica el OMR.
        </p>
      </div>
      <input
        className="w-full rounded-md border border-[var(--border-color)] px-3 py-2 text-sm"
        placeholder="Buscar por título, curso o asignatura…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-xs text-[var(--text-muted)]">
          Tipo de prueba (obligatorio)
          <select
            value={assessmentType}
            onChange={(e) => setAssessmentType((e.target.value || "") as FlatAssessmentType | "")}
            className="mt-1 w-full rounded-md border border-[var(--border-color)] px-2 py-2 text-sm bg-white"
          >
            <option value="">Seleccionar…</option>
            {FLAT_ASSESSMENT_TYPES.map((v) => (
              <option key={v} value={v}>
                {FLAT_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-white text-sm">
        {searching ? (
          <p className="p-3 text-[var(--text-muted)]">Buscando…</p>
        ) : hits.length === 0 ? (
          <p className="p-3 text-[var(--text-muted)]">Sin resultados. Escriba al menos 2 caracteres o deje vacío para recientes.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {hits.map((h) => {
              const checked = selected.includes(h.id)
              return (
                <li key={h.id}>
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-slate-50">
                    <input type="checkbox" checked={checked} onChange={() => toggleId(h.id)} className="mt-1" />
                    <span>
                      <span className="font-medium">{h.title ?? "Sin título"}</span>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {h.subject ?? "—"} · {h.course_label ?? "—"} ·{" "}
                        {h.evaluated_at ? new Date(h.evaluated_at).toLocaleDateString("es-CL") : "—"}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">{h.id}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving || selected.length === 0 || !assessmentType}
          onClick={() => void saveLink()}
          className="rounded-md bg-slate-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          Guardar vínculo ({selected.length})
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void clearLink()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
        >
          Limpiar vínculo
        </button>
        {message && <span className="text-xs text-[var(--text-muted)]">{message}</span>}
      </div>
    </div>
  )
}
