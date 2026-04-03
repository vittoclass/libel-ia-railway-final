"use client"
/* eslint-disable @next/next/no-img-element -- URLs firmadas efímeras de Storage. */

import { useEffect, useMemo, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ImageIcon, Loader2 } from "lucide-react"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"

export type BatchPhotoRow = {
  id: string
  batch_id: string
  storage_path: string
  processed_at: string | null
  created_at: string | null
  content_type?: string | null
  student_index?: number | null
  page_index?: number | null
}

type Props = {
  batchId: string
  supabase: SupabaseClient
}

export function BatchPhotoRealtimeGrid({ batchId, supabase }: Props) {
  const [rows, setRows] = useState<BatchPhotoRow[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [hint, setHint] = useState<string | null>(null)

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

  const rowPaths = useMemo(() => sortedRows.map((r) => r.storage_path), [sortedRows])

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
      } catch {
        if (!cancelled) setRows([])
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
          const row = payload.new as BatchPhotoRow
          if (!row?.id) return
          setRows((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev
            return [row, ...prev]
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [batchId, supabase])

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-5 w-5 text-slate-600" aria-hidden />
        <h3 className="font-semibold text-slate-900">Cola de fotos (Realtime)</h3>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden /> : null}
      </div>
      {hint ? <p className="text-xs text-amber-800">{hint}</p> : null}
      <p className="text-xs text-slate-500">
        Orden: <code>student_index</code> + <code>page_index</code> (Paso C). Misma sesión Supabase; RLS por{" "}
        <code>teacher_id</code>. Para agrupar vía API (sin OMR):{" "}
        <code className="text-[10px]">/api/docente/batch-inbox-groups?batch_id=…</code>
      </p>
      {rows.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 py-12 text-center text-sm text-slate-500">
          Aún no hay fotos en este lote. Saque fotos desde el móvil cuando el flujo de subida esté conectado.
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {sortedRows.map((r) => {
            const src = urls[r.storage_path]
            const si = r.student_index != null ? Number(r.student_index) : null
            const pi = r.page_index != null ? Number(r.page_index) : null
            return (
              <li
                key={r.id}
                className="aspect-square rounded-md border border-slate-100 bg-slate-100 overflow-hidden relative"
              >
                {si != null && pi != null ? (
                  <span className="absolute top-0 left-0 z-10 bg-slate-900/85 text-[9px] text-white px-1.5 py-0.5 rounded-br">
                    A{si} · P{pi}
                  </span>
                ) : null}
                {src ? (
                  <img src={src} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400 p-1 text-center">
                    {r.storage_path.slice(-24)}
                  </div>
                )}
                {r.processed_at ? (
                  <span className="absolute bottom-0 left-0 right-0 bg-emerald-600/90 text-[9px] text-white text-center py-0.5">
                    Procesada
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
