"use client"

import { useCallback, useEffect, useState } from "react"

type PendingRow = {
  batch_id: string
  evaluation_count: number
  title: string | null
  course_label: string | null
  subject: string | null
  submitted_at: string | null
  teacher_id: string | null
}

type Props = {
  /** Incrementar (p. ej. desde `outcomesRefresh`) para recargar la bandeja. */
  refreshTrigger: number
}

export function UtpPendingBatchReleasesPanel({ refreshTrigger }: Props) {
  const [rows, setRows] = useState<PendingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rejectText, setRejectText] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/dashboard/utp/pending-batch-releases", { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String(j?.error ?? "No se pudo cargar la bandeja"))
        setRows([])
        return
      }
      setRows(Array.isArray(j?.pending) ? j.pending : [])
    } catch {
      setError("Error de red")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTrigger])

  async function decide(batchId: string, action: "approve" | "reject") {
    const obs = action === "reject" ? String(rejectText[batchId] ?? "").trim() : ""
    if (action === "reject" && obs.length < 3) {
      alert("Escriba observaciones para el docente (mínimo 3 caracteres).")
      return
    }
    setBusyId(batchId)
    try {
      const res = await fetch("/api/evaluation-batches/utp-review-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId, action, observations: obs || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(String(j?.error ?? "No se pudo registrar la decisión"))
        return
      }
      setRejectText((prev) => {
        const n = { ...prev }
        delete n[batchId]
        return n
      })
      await load()
    } catch {
      alert("Error de red")
    } finally {
      setBusyId(null)
    }
  }

  if (loading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-900">
        Cargando pendientes de validación…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Bandeja UTP: {error}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
        <h3 className="font-semibold text-slate-900">Pendientes de validación (trazabilidad)</h3>
        <p className="mt-1 text-xs text-slate-600">
          No hay lotes enviados por docentes. Al aprobar un lote, sus datos pasan al panel de Dirección (rollups de
          trazabilidad).
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/40 p-4 shadow-sm space-y-3">
      <div>
        <h3 className="font-semibold text-amber-950">Pendientes de validación UTP</h3>
        <p className="text-xs text-amber-900/80 mt-0.5">
          Guardián de calidad: apruebe para liberar hacia Dirección, o devuelva con observaciones. Sin aprobación, la
          trazabilidad institucional no incorpora el lote.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-amber-200/80 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-amber-100 bg-amber-50/90 text-left text-xs uppercase tracking-wide text-amber-900/70">
              <th className="px-3 py-2">Lote</th>
              <th className="px-3 py-2">Prueba / curso</th>
              <th className="px-3 py-2">N° eval.</th>
              <th className="px-3 py-2">Enviado</th>
              <th className="px-3 py-2 w-[min(100%,22rem)]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const short = r.batch_id.slice(0, 8)
              const busy = busyId === r.batch_id
              return (
                <tr key={r.batch_id} className="border-b border-amber-50 align-top">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{short}…</td>
                  <td className="px-3 py-2 text-slate-800">
                    <div className="font-medium">{r.title ?? "—"}</div>
                    <div className="text-xs text-slate-500">
                      {r.course_label ?? "—"} · {r.subject ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.evaluation_count}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void decide(r.batch_id, "approve")}
                        className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        {busy ? "…" : "Aprobar"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void decide(r.batch_id, "reject")}
                        className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {busy ? "…" : "Devolver"}
                      </button>
                    </div>
                    <textarea
                      className="w-full min-h-[52px] rounded border border-slate-200 px-2 py-1 text-xs"
                      placeholder="Observaciones si devuelve el lote…"
                      value={rejectText[r.batch_id] ?? ""}
                      onChange={(e) =>
                        setRejectText((prev) => ({
                          ...prev,
                          [r.batch_id]: e.target.value,
                        }))
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
