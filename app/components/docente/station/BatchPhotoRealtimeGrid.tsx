"use client"
/* eslint-disable @next/next/no-img-element -- URLs firmadas efímeras de Storage. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ImageIcon, Loader2, Users, RefreshCw, Wifi, WifiOff, CloudOff, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { MAX_BATCH_PHOTO_PAGE_SIZE } from "@/app/lib/docente/batch-photo-pagination"
import { broadcastBatchPhotoActivity } from "@/app/lib/docente/active-batch-id"
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

const POLL_MS = 9000

async function fetchAllBatchPhotos(batchId: string): Promise<{
  photos: BatchPhotoRow[]
  sessionEp: number | null
  warning: string | null
}> {
  const aggregated: BatchPhotoRow[] = []
  let offset = 0
  let sessionEp: number | null = null
  let warning: string | null = null
  for (let i = 0; i < 80; i++) {
    const res = await fetch(
      `/api/docente/batch-photos?batch_id=${encodeURIComponent(batchId)}&offset=${offset}&limit=${MAX_BATCH_PHOTO_PAGE_SIZE}`,
      { credentials: "include" },
    )
    const j = await res.json().catch(() => ({}))
    if (j?.warning) warning = String(j.warning)
    const chunk = Array.isArray(j?.photos) ? (j.photos as BatchPhotoRow[]) : []
    aggregated.push(...chunk)
    if (sessionEp == null) {
      const ep = j?.session?.expected_pages_per_student
      if (typeof ep === "number" && Number.isFinite(ep)) {
        sessionEp = Math.max(1, Math.min(50, Math.floor(ep)))
      }
    }
    const meta = j?.meta as { has_more?: boolean; next_offset?: number | null } | undefined
    if (!meta?.has_more) break
    offset = typeof meta.next_offset === "number" ? meta.next_offset : offset + chunk.length
    await new Promise<void>((r) => window.setTimeout(r, 0))
  }
  return { photos: aggregated, sessionEp, warning }
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

  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<"idle" | "subscribed" | "error" | "closed">("idle")
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const inFlight = useRef<Set<number>>(new Set())
  const promoteTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const propsRef = useRef({ batchId, courseLabel, subject, onPromoted })
  propsRef.current = { batchId, courseLabel, subject, onPromoted }
  /** Primera carga del lote: no broadcast; después, fotos nuevas vía polling avisan al panel QR. */
  const seenPhotoIdsRef = useRef<Set<string>>(new Set())
  const syncPrimedRef = useRef(false)

  useEffect(() => {
    seenPhotoIdsRef.current = new Set()
    syncPrimedRef.current = false
  }, [batchId])

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

  type StudentVisualStatus = "evaluado" | "listo" | "en_captura"

  const studentStats = useMemo(() => {
    const byStudent = new Map<number, { pages: Set<number>; pending: number; linked: boolean }>()
    for (const r of rows) {
      const si = r.student_index != null ? Math.floor(Number(r.student_index)) : null
      if (si == null || !Number.isFinite(si)) continue
      const cur = byStudent.get(si) ?? { pages: new Set<number>(), pending: 0, linked: false }
      if (r.evaluation_id || r.status === "linked") {
        cur.linked = true
      }
      if (!r.evaluation_id && r.status !== "linked") {
        cur.pending += 1
      }
      const pi = r.page_index != null ? Math.floor(Number(r.page_index)) : null
      if (pi != null && Number.isFinite(pi) && pi >= 1) cur.pages.add(pi)
      byStudent.set(si, cur)
    }
    const keys = [...byStudent.keys()].sort((a, b) => a - b)
    return keys.map((student_index) => {
      const s = byStudent.get(student_index)!
      const ready = !s.linked && s.pages.size >= effectiveExpectedPages
      const visualStatus: StudentVisualStatus = s.linked ? "evaluado" : ready ? "listo" : "en_captura"
      return {
        student_index,
        distinct_pages: s.pages.size,
        pending_rows: s.pending,
        linked: s.linked,
        ready,
        visualStatus,
      }
    })
  }, [rows, effectiveExpectedPages])

  const studentGroups = useMemo(() => {
    const byStudent = new Map<number, BatchPhotoRow[]>()
    const unassigned: BatchPhotoRow[] = []
    for (const r of sortedRows) {
      const si = r.student_index != null ? Math.floor(Number(r.student_index)) : null
      if (si == null || !Number.isFinite(si)) {
        unassigned.push(r)
        continue
      }
      const list = byStudent.get(si) ?? []
      list.push(r)
      byStudent.set(si, list)
    }
    const groups = [...byStudent.entries()]
      .sort(([a], [b]) => a - b)
      .map(([student_index, photos]) => ({ student_index, photos }))
    return { groups, unassigned }
  }, [sortedRows])

  const studentStatusLabel = (status: StudentVisualStatus): string => {
    if (status === "evaluado") return "Evaluado"
    if (status === "listo") return "Listo"
    return "En captura"
  }

  const studentStatusClass = (status: StudentVisualStatus): string => {
    if (status === "evaluado") return "bg-emerald-100 text-emerald-900 border-emerald-200"
    if (status === "listo") return "bg-amber-100 text-amber-950 border-amber-200"
    return "bg-slate-100 text-slate-700 border-slate-200"
  }

  const rowPaths = useMemo(() => sortedRows.map((r) => r.storage_path).filter(Boolean) as string[], [sortedRows])

  const syncFromServer = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true
      if (!silent) setSyncing(true)
      setSyncError(null)
      try {
        const { photos, sessionEp, warning } = await fetchAllBatchPhotos(batchId)
        const nextIds = new Set(photos.map((p) => p.id))
        let anyNew = false
        for (const p of photos) {
          if (!seenPhotoIdsRef.current.has(p.id)) {
            if (syncPrimedRef.current) anyNew = true
            seenPhotoIdsRef.current.add(p.id)
          }
        }
        for (const id of [...seenPhotoIdsRef.current]) {
          if (!nextIds.has(id)) seenPhotoIdsRef.current.delete(id)
        }
        syncPrimedRef.current = true
        if (anyNew) broadcastBatchPhotoActivity(batchId)

        setRows(photos)
        if (sessionEp != null) setSessionExpectedPages(sessionEp)
        else setSessionExpectedPages(null)
        setHint(warning)
        setLastSyncedAt(new Date())
      } catch {
        setSyncError("No se pudo sincronizar con el servidor.")
        if (!silent) setRows([])
      } finally {
        if (!silent) setSyncing(false)
        setLoading(false)
      }
    },
    [batchId],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      await syncFromServer({ silent: false })
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [batchId, syncFromServer])

  useEffect(() => {
    const id = window.setInterval(() => {
      void syncFromServer({ silent: true })
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [batchId, syncFromServer])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      const chunkSize = 24
      for (let i = 0; i < rowPaths.length; i += chunkSize) {
        if (cancelled) return
        const chunk = rowPaths.slice(i, i + chunkSize)
        await Promise.all(
          chunk.map(async (path) => {
            const { data, error } = await supabase.storage.from(BATCH_SCANS_BUCKET).createSignedUrl(path, 240)
            if (!error && data?.signedUrl) next[path] = data.signedUrl
          }),
        )
        await new Promise<void>((r) => window.setTimeout(r, 0))
      }
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

  const removeRowById = useCallback((id: string) => {
    setRows((prev) => prev.filter((p) => p.id !== id))
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
          broadcastBatchPhotoActivity(batchId)
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
          broadcastBatchPhotoActivity(batchId)
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "batch_photo_uploads",
          filter: `batch_id=eq.${batchId}`,
        },
        (payload) => {
          const oldRow = payload.old as { id?: string } | null
          if (oldRow?.id) removeRowById(String(oldRow.id))
          broadcastBatchPhotoActivity(batchId)
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("subscribed")
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRealtimeStatus("error")
        else if (status === "CLOSED") setRealtimeStatus("closed")
      })

    return () => {
      void supabase.removeChannel(channel)
      setRealtimeStatus("closed")
    }
  }, [batchId, supabase, mergeRow, removeRowById])

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

  const requestDeletePhoto = useCallback(
    async (r: BatchPhotoRow) => {
      const sent = Boolean(r.evaluation_id || r.status === "linked")
      if (sent) {
        window.alert(
          "Esta imagen ya fue sincronizada al evaluador. No puede eliminarse desde la estación mientras esté vinculada a una evaluación.",
        )
        return
      }
      const ok = window.confirm("¿Eliminar esta foto? Se borrará del lote y del almacenamiento.")
      if (!ok) return
      setDeletingId(r.id)
      setSyncError(null)
      try {
        const res = await fetch(
          `/api/docente/batch-photo?photo_id=${encodeURIComponent(r.id)}&batch_id=${encodeURIComponent(batchId)}`,
          { method: "DELETE", credentials: "include" },
        )
        const j = await res.json().catch(() => ({}))
        if (res.status === 409 && j?.code === "ALREADY_LINKED") {
          window.alert(
            typeof j?.error === "string"
              ? j.error
              : "Esta imagen ya fue sincronizada al evaluador y no puede eliminarse desde la estación.",
          )
          return
        }
        if (!res.ok) {
          setSyncError(typeof j?.error === "string" ? j.error : `Error ${res.status}`)
          return
        }
        removeRowById(r.id)
        if (r.storage_path) {
          setUrls((prev) => {
            const copy = { ...prev }
            delete copy[r.storage_path!]
            return copy
          })
        }
        broadcastBatchPhotoActivity(batchId)
        setLastSyncedAt(new Date())
      } finally {
        setDeletingId(null)
      }
    },
    [batchId, removeRowById],
  )

  const lastSyncLabel = lastSyncedAt
    ? lastSyncedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—"

  const connectionBadge =
    realtimeStatus === "subscribed" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
        <Wifi className="h-3 w-3" aria-hidden />
        Realtime OK
      </span>
    ) : realtimeStatus === "error" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-950">
        <WifiOff className="h-3 w-3" aria-hidden />
        Realtime con incidencias
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
        <CloudOff className="h-3 w-3" aria-hidden />
        Realtime: {realtimeStatus === "closed" ? "cerrado" : "conectando…"}
      </span>
    )

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="h-5 w-5 text-slate-600 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 leading-tight">Cola de fotos</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Tiempo real + respaldo cada ~{Math.round(POLL_MS / 1000)} s. Las fotos se revalidan aunque falle Realtime.
            </p>
          </div>
          {loading && !syncing ? <Loader2 className="h-4 w-4 animate-spin text-slate-400 shrink-0" aria-hidden /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connectionBadge}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 shrink-0"
            disabled={syncing}
            onClick={() => void syncFromServer({ silent: false })}
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            Sincronizar ahora
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 border border-slate-100 rounded-lg bg-slate-50/80 px-3 py-2">
        <span>
          <strong className="text-slate-800">Última sincronización:</strong> {lastSyncLabel}
        </span>
        <span>
          <strong className="text-slate-800">Fotos recibidas:</strong> {rows.length}
        </span>
        {syncError ? (
          <span className="text-rose-700 font-medium w-full sm:w-auto">{syncError}</span>
        ) : syncing ? (
          <span className="text-indigo-700 font-medium">Sincronizando…</span>
        ) : lastSyncedAt ? (
          <span className="text-emerald-800 font-medium">Listo</span>
        ) : null}
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
        INSERT + UPDATE + DELETE en tiempo real; el sondeo rescata cambios si el canal falla. Tras promover, la celda pasa a{" "}
        <span className="text-emerald-700 font-medium">verde</span>. Puede eliminar fotos mal tomadas con la papelera (solo antes de
        envío a evaluación).
      </p>
      {rows.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 py-12 text-center text-sm text-slate-500">
          Aún no hay fotos en este lote. Saque fotos desde el móvil cuando el flujo de subida esté conectado.
        </div>
      ) : (
        <div className="space-y-4">
          {studentGroups.groups.map(({ student_index, photos }) => {
            const stat = studentStats.find((s) => s.student_index === student_index)
            const visualStatus = stat?.visualStatus ?? "en_captura"
            const pageNumbers = [
              ...new Set(
                photos
                  .map((p) => (p.page_index != null ? Math.floor(Number(p.page_index)) : null))
                  .filter((pi): pi is number => pi != null && Number.isFinite(pi) && pi >= 1),
              ),
            ].sort((a, b) => a - b)

            return (
              <section
                key={student_index}
                className={cn(
                  "rounded-lg border p-3 space-y-2",
                  visualStatus === "evaluado"
                    ? "border-emerald-200 bg-emerald-50/40"
                    : visualStatus === "listo"
                      ? "border-amber-200 bg-amber-50/30"
                      : "border-slate-200 bg-slate-50/50",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h4 className="text-sm font-semibold text-slate-900">Alumno {student_index}</h4>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      studentStatusClass(visualStatus),
                    )}
                  >
                    Estado: {studentStatusLabel(visualStatus)}
                  </span>
                  {pageNumbers.length > 0 ? (
                    <span className="text-[11px] font-mono text-slate-600">
                      {pageNumbers.map((pi) => `P${pi}`).join(" · ")}
                    </span>
                  ) : null}
                </div>
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {photos.map((r) => {
                    const src = r.storage_path ? urls[r.storage_path] : undefined
                    const pi = r.page_index != null ? Number(r.page_index) : null
                    const sent = Boolean(r.evaluation_id || r.status === "linked")
                    const canDelete = !sent
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
                        {pi != null ? (
                          <span
                            className={cn(
                              "absolute top-0 left-0 z-10 text-[9px] text-white px-1.5 py-0.5 rounded-br font-medium",
                              sent ? "bg-emerald-800" : "bg-slate-900/85",
                            )}
                          >
                            P{pi}
                          </span>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="absolute top-0 right-0 z-20 flex h-7 w-7 items-center justify-center rounded-bl bg-black/55 text-white hover:bg-rose-700/90 disabled:opacity-40"
                            aria-label="Eliminar foto"
                            disabled={deletingId === r.id}
                            onClick={() => void requestDeletePhoto(r)}
                          >
                            {deletingId === r.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </button>
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
              </section>
            )
          })}
          {studentGroups.unassigned.length > 0 ? (
            <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-3 space-y-2">
              <h4 className="text-sm font-semibold text-slate-700">Sin alumno asignado</h4>
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {studentGroups.unassigned.map((r) => {
                  const src = r.storage_path ? urls[r.storage_path] : undefined
                  const sent = Boolean(r.evaluation_id || r.status === "linked")
                  const canDelete = !sent
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
                      {canDelete ? (
                        <button
                          type="button"
                          className="absolute top-0 right-0 z-20 flex h-7 w-7 items-center justify-center rounded-bl bg-black/55 text-white hover:bg-rose-700/90 disabled:opacity-40"
                          aria-label="Eliminar foto"
                          disabled={deletingId === r.id}
                          onClick={() => void requestDeletePhoto(r)}
                        >
                          {deletingId === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      ) : null}
                      {src ? (
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400 p-1 text-center">
                          {(r.storage_path ?? "").slice(-24)}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}
