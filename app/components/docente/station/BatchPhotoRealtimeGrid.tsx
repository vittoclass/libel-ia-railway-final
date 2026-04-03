"use client"
/* eslint-disable @next/next/no-img-element -- URLs firmadas efímeras de Storage. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ImageIcon, Loader2, Users } from "lucide-react"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { cn } from "@/lib/utils"

export type BatchPhotoRow = {
  id: string
  batch_id: string
  storage_path: string
  processed_at: string | null
  created_at: string | null
  content_type?: string | null
  student_index?: number | null
  page_index?: number | null
  evaluation_id?: string | null
  status?: string | null
}

type Props = {
  batchId: string
  supabase: SupabaseClient
  /** Fallback si la sesión en BD aún no tiene expected_pages_per_student. */
  expectedPagesPerStudent?: number
  courseLabel?: string | null
  subject?: string | null
  onPromoted?: (payload: { student_index: number; evaluation_id: string }) => void
}

export function BatchPhotoRealtimeGrid({
  batchId,
  supabase,
  expectedPagesPerStudent = 2,
  courseLabel = null,
  subject = null,
  onPromoted,
}: Props) {
  const [rows, setRows] = useState<BatchPhotoRow[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [hint, setHint] = useState<string | null>(null)
  const [promoteHint, setPromoteHint] = useState<string | null>(null)
  /** Coincide con batch_scan_sessions (misma fuente que el servidor al promover). */
  const [sessionExpectedPages, setSessionExpectedPages] = useState<number | null>(null)

  const inFlight = useRef<Set<number>>(new Set())
  const promoteTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const propsRef = useRef({ batchId, courseLabel, subject, onPromoted })
  propsRef.current = { batchId, courseLabel, subject, onPromoted }

  const propExpected = Math.max(1, Math.min(50, Math.floor(Number(expectedPagesPerStudent)) || 2))
  const effectiveExpectedPages = sessionExpectedPages ?? propExpected

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const sa = Number(a.student_index ?? 1e9)
      const sb = Number(b.student_index ?? 1e9)
      if (sa !== sb) return sa - sb
      const pa = Number(a.page_index ?? 1e9)
      const pb = Number(b.page_index ?? 1e9)
      if (pa !== pb) return pa - pb
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return ta - tb
    })
  }, [rows])

  const studentStats = useMemo(() => {
    const byStudent = new Map<number, { pages: Set<number>; pending: number; linked: boolean }>()
    for (const r of rows) {
      const si = r.student_index != null ? Math.floor(Number(r.student_index)) : null
      if (si == null || !Number.isFinite(si)) continue
      const cur = byStudent.get(si) ?? { pages: new Set<number>(), pending: 0, linked: false }
      if (r.evaluation_id) {
        cur.linked = true
        byStudent.set(si, cur)
        continue
      }
      cur.pending += 1
      const pi = r.page_index != null ? Math.floor(Number(r.page_index)) : null
      if (pi != null && Number.isFinite(pi) && pi >= 1) cur.pages.add(pi)
      byStudent.set(si, cur)
    }
    const keys = [...byStudent.keys()].sort((a, b) => a - b)
    return keys.map((student_index) => {
      const s = byStudent.get(student_index)!
      return {
        student_index,
        distinct_pages: s.pages.size,
        pending_rows: s.pending,
        linked: s.linked,
        ready: !s.linked && s.pages.size >= effectiveExpectedPages,
      }
    })
  }, [rows, effectiveExpectedPages])

  const rowPaths = useMemo(() => sortedRows.map((r) => r.storage_path).filter(Boolean) as string[], [sortedRows])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(`/api/docente/batch-photos?batch_id=${encodeURIComponent(batchId)}`)
        const j = await res.json().catch(() => ({}))
        if (cancelled) return
        if (j?.warning) setHint(String(j.warning))
        setRows(Array.isArray(j?.photos) ? j.photos : [])
        const ep = j?.session?.expected_pages_per_student
        if (typeof ep === "number" && Number.isFinite(ep)) {
          setSessionExpectedPages(Math.max(1, Math.min(50, Math.floor(ep))))
        } else {
          setSessionExpectedPages(null)
        }
      } catch {
        if (!cancelled) {
          setRows([])
          setSessionExpectedPages(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [batchId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      await Promise.all(
        rowPaths.map(async (path) => {
          const { data, error } = await supabase.storage.from(BATCH_SCANS_BUCKET).createSignedUrl(path, 240)
          if (!error && data?.signedUrl) next[path] = data.signedUrl
        }),
      )
      if (!cancelled) setUrls((prev) => ({ ...prev, ...next }))
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, rowPaths])

  const mergeRow = useCallback((row: BatchPhotoRow) => {
    if (!row?.id) return
    setRows((prev) => {
      const idx = prev.findIndex((p) => p.id === row.id)
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = { ...copy[idx], ...row }
        return copy
      }
      if (prev.some((p) => p.id === row.id)) return prev
      return [row, ...prev]
    })
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel(`docente_batch_photos:${batchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "batch_photo_uploads",
          filter: `batch_id=eq.${batchId}`,
        },
        (payload) => {
          mergeRow(payload.new as BatchPhotoRow)
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "batch_photo_uploads",
          filter: `batch_id=eq.${batchId}`,
        },
        (payload) => {
          mergeRow(payload.new as BatchPhotoRow)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [batchId, supabase, mergeRow])

  useEffect(() => {
    return () => {
      for (const t of promoteTimersRef.current.values()) clearTimeout(t)
      promoteTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const timers = promoteTimersRef.current
    const readyStudents = studentStats.filter((s) => s.ready && !s.linked).map((s) => s.student_index)
    const readySet = new Set(readyStudents)

    for (const [si, t] of [...timers.entries()]) {
      if (!readySet.has(si)) {
        clearTimeout(t)
        timers.delete(si)
      }
    }

    for (const stat of studentStats) {
      if (!stat.ready || stat.linked) continue
      if (inFlight.current.has(stat.student_index)) continue

      const si = stat.student_index
      const existing = timers.get(si)
      if (existing) clearTimeout(existing)

      timers.set(
        si,
        setTimeout(() => {
          timers.delete(si)
          if (inFlight.current.has(si)) return
          inFlight.current.add(si)

          void (async () => {
            const { batchId: bid, courseLabel: cl, subject: sj, onPromoted: onP } = propsRef.current
            try {
              const res = await fetch("/api/docente/batch-promote-student", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  batch_id: bid,
                  student_index: si,
                  course_label: cl ?? undefined,
                  subject: sj ?? undefined,
                }),
              })
              const j = await res.json().catch(() => ({}))
              if (res.ok && j?.evaluation_id) {
                const eid = String(j.evaluation_id)
                const now = new Date().toISOString()
                setRows((prev) =>
                  prev.map((r) =>
                    Math.floor(Number(r.student_index ?? 0)) === si
                      ? { ...r, evaluation_id: eid, processed_at: r.processed_at ?? now, status: "linked" }
                      : r,
                  ),
                )
                onP?.({ student_index: si, evaluation_id: eid })
                setPromoteHint(`Alumno ${si}: ENVIADO A EVALUACIÓN (${eid.slice(0, 8)}…).`)
              } else if (!res.ok) {
                if (j?.code === "INCOMPLETE_PAGES") {
                  /* Esperando más páginas; sin ruido en UI */
                } else {
                  setPromoteHint(
                    typeof j?.error === "string" ? j.error : `No se pudo promover alumno ${si} (${res.status}).`,
                  )
                }
              }
            } finally {
              inFlight.current.delete(si)
            }
          })()
        }, 450),
      )
    }
  }, [studentStats])

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-5 w-5 text-slate-600" aria-hidden />
        <h3 className="font-semibold text-slate-900">Cola de fotos (Realtime)</h3>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden /> : null}
      </div>
      {hint ? <p className="text-xs text-amber-800">{hint}</p> : null}
      {promoteHint ? <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded px-2 py-1">{promoteHint}</p> : null}
      <div className="flex flex-wrap items-start gap-3 text-xs text-slate-600">
        <p className="max-w-md">
          Meta por alumno (sesión): <strong>{effectiveExpectedPages}</strong> página(s) distinta(s). Al completarse se promueve{" "}
          <strong>automáticamente</strong> a Evaluaciones; las rutas quedan en <code>evaluations.scan_image_paths</code>.
        </p>
        {studentStats.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/90 px-2 py-1.5">
            <Users className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden />
            {studentStats.map((s) => (
              <span
                key={s.student_index}
                className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  s.linked
                    ? "bg-emerald-200 text-emerald-950 font-semibold"
                    : s.ready
                      ? "bg-amber-100 text-amber-950 animate-pulse"
                      : "bg-white text-slate-700 border border-slate-200"
                }`}
                title={
                  s.linked
                    ? "ENVIADO A EVALUACIÓN"
                    : `${s.distinct_pages}/${effectiveExpectedPages} páginas distintas · ${s.pending_rows} archivo(s)`
                }
              >
                A{s.student_index}: {s.linked ? "OK" : `${s.distinct_pages}/${effectiveExpectedPages}`}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-slate-500">
        INSERT + UPDATE en tiempo real. Tras promover, la celda pasa a <span className="text-emerald-700 font-medium">verde</span>.
      </p>
      {rows.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 py-12 text-center text-sm text-slate-500">
          Aún no hay fotos en este lote. Saque fotos desde el móvil cuando el flujo de subida esté conectado.
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {sortedRows.map((r) => {
            const src = r.storage_path ? urls[r.storage_path] : undefined
            const si = r.student_index != null ? Number(r.student_index) : null
            const pi = r.page_index != null ? Number(r.page_index) : null
            const sent = Boolean(r.evaluation_id || r.status === "linked")
            return (
              <li
                key={r.id}
                className={cn(
                  "aspect-square rounded-md border overflow-hidden relative transition-colors duration-300",
                  sent
                    ? "border-emerald-500 bg-emerald-50 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
                    : "border-slate-100 bg-slate-100",
                )}
              >
                {si != null && pi != null ? (
                  <span
                    className={cn(
                      "absolute top-0 left-0 z-10 text-[9px] text-white px-1.5 py-0.5 rounded-br font-medium",
                      sent ? "bg-emerald-800" : "bg-slate-900/85",
                    )}
                  >
                    A{si} · P{pi}
                  </span>
                ) : null}
                {src ? (
                  <img src={src} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400 p-1 text-center">
                    {(r.storage_path ?? "").slice(-24)}
                  </div>
                )}
                {sent ? (
                  <span className="absolute bottom-0 left-0 right-0 bg-emerald-600 text-[8px] font-bold tracking-wide text-white text-center py-1 leading-tight px-0.5">
                    ENVIADO A EVALUACIÓN
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
