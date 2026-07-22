"use client"
/* eslint-disable @next/next/no-img-element -- QR PNG desde API con cookie de sesión. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Maximize2, Minimize2, RefreshCw } from "lucide-react"
import { readWizardSession } from "@/app/components/teacher-wizard/sessionStorage"
import type { DevelopmentTipoPrueba } from "@/app/lib/development-crop/flags"
import {
  buildCollaborativeEscaneoUrl,
  collaborativeQrDisplayName,
  collaborativeSlotDisplayName,
  type CollaborativeSlotLabel,
} from "@/app/lib/docente/collaborative-capture"
import { MAX_BATCH_PHOTO_PAGE_SIZE } from "@/app/lib/docente/batch-photo-pagination"

const POLL_MS = 5000
const QR_IMG_PX = 140

type PhotoRow = {
  student_index?: number | null
  page_index?: number | null
}

type SlotStatus = "waiting" | "capturing" | "received"

type Props = {
  batchId: string
  slotCount: number
  label: CollaborativeSlotLabel
  expectedPagesPerStudent?: number
  onChangeMode?: () => void
}

function resolveClientPublicOrigin(): string {
  if (typeof window === "undefined") return ""
  let o = window.location.origin
  const isLocal =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o) ||
    /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/i.test(o) ||
    /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/i.test(o)
  if (process.env.NODE_ENV === "production" && o.startsWith("http:") && !isLocal) {
    o = o.replace(/^http:/, "https:")
  }
  return o
}

function statusLabel(s: SlotStatus): string {
  if (s === "received") return "✔ Captura recibida"
  if (s === "capturing") return "Recibiendo fotos…"
  return "Esperando captura"
}

/**
 * Vista proyectable: grilla de QR del mismo batch (un slot = un código).
 * Estados vía poll de /api/docente/batch-photos (misma fuente que la grilla de fotos).
 */
export function CollaborativeQrProjectionGrid({
  batchId,
  slotCount,
  label,
  expectedPagesPerStudent = 2,
  onChangeMode,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState("")
  const [qrNonce, setQrNonce] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [pagesBySlot, setPagesBySlot] = useState<Map<number, Set<number>>>(() => new Map())
  const [pollError, setPollError] = useState<string | null>(null)

  const expected = Math.max(1, Math.min(50, Math.floor(Number(expectedPagesPerStudent)) || 2))
  const slots = useMemo(
    () => Array.from({ length: Math.max(1, Math.min(50, Math.floor(slotCount) || 1)) }, (_, i) => i + 1),
    [slotCount],
  )

  useEffect(() => {
    setOrigin(resolveClientPublicOrigin())
  }, [])

  const tipoPrueba = useMemo(() => {
    return readWizardSession()?.tipoPrueba as DevelopmentTipoPrueba | undefined
  }, [])

  const loadStatuses = useCallback(async () => {
    try {
      const map = new Map<number, Set<number>>()
      let offset = 0
      for (let page = 0; page < 40; page++) {
        const res = await fetch(
          `/api/docente/batch-photos?batch_id=${encodeURIComponent(batchId)}&offset=${offset}&limit=${MAX_BATCH_PHOTO_PAGE_SIZE}`,
          { cache: "no-store", credentials: "include" },
        )
        const j = (await res.json().catch(() => ({}))) as {
          photos?: PhotoRow[]
          error?: string
          meta?: { has_more?: boolean; next_offset?: number | null }
        }
        if (!res.ok) {
          setPollError(typeof j?.error === "string" ? j.error : `HTTP ${res.status}`)
          return
        }
        for (const row of Array.isArray(j.photos) ? j.photos : []) {
          const si = row.student_index != null ? Math.floor(Number(row.student_index)) : NaN
          const pi = row.page_index != null ? Math.floor(Number(row.page_index)) : NaN
          if (!Number.isFinite(si) || si < 1) continue
          if (!Number.isFinite(pi) || pi < 1) continue
          let set = map.get(si)
          if (!set) {
            set = new Set()
            map.set(si, set)
          }
          set.add(pi)
        }
        if (!j.meta?.has_more) break
        offset =
          typeof j.meta.next_offset === "number" ? j.meta.next_offset : offset + (j.photos?.length ?? 0)
      }
      setPollError(null)
      setPagesBySlot(map)
    } catch {
      setPollError("No se pudo sincronizar el estado de los códigos.")
    }
  }, [batchId])

  useEffect(() => {
    void loadStatuses()
    const t = window.setInterval(() => void loadStatuses(), POLL_MS)
    return () => window.clearInterval(t)
  }, [loadStatuses])

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      /* navegador sin fullscreen */
    }
  }, [])

  const gridColsClass =
    slots.length <= 10
      ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-5"
      : slots.length <= 20
        ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-5"
        : "grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"

  return (
    <div
      ref={rootRef}
      className={`rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-4 ${
        isFullscreen ? "bg-slate-950 text-slate-100 min-h-screen overflow-y-auto p-6" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={`font-semibold ${isFullscreen ? "text-white text-xl" : "text-emerald-950"}`}>
            Proyección — captura colaborativa
          </h3>
          <p className={`text-xs mt-1 max-w-prose ${isFullscreen ? "text-slate-300" : "text-emerald-900/80"}`}>
            {slots.length} códigos del mismo lote. Cada persona escanea el suyo. No se muestran datos
            internos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={isFullscreen ? "secondary" : "outline"}
            size="sm"
            className="gap-1"
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {isFullscreen ? "Salir proyección" : "Proyectar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => {
              setQrNonce((n) => n + 1)
              void loadStatuses()
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Actualizar
          </Button>
          {onChangeMode && !isFullscreen ? (
            <Button type="button" variant="ghost" size="sm" onClick={onChangeMode}>
              Cambiar modalidad
            </Button>
          ) : null}
        </div>
      </div>

      {pollError ? (
        <p className={`text-xs ${isFullscreen ? "text-amber-300" : "text-amber-900"}`}>{pollError}</p>
      ) : null}

      <div className={`grid gap-3 ${gridColsClass}`}>
        {slots.map((slot) => {
          const pages = pagesBySlot.get(slot)
          const distinct = pages?.size ?? 0
          const status: SlotStatus =
            distinct >= expected ? "received" : distinct > 0 ? "capturing" : "waiting"
          const url =
            origin && batchId
              ? buildCollaborativeEscaneoUrl({
                  origin,
                  batchId,
                  slot,
                  label,
                  tipoPrueba: tipoPrueba ?? null,
                })
              : ""
          const qrSrc = url
            ? `/api/docente/station-qr?u=${encodeURIComponent(url)}&v=${qrNonce}`
            : ""

          return (
            <div
              key={slot}
              className={`rounded-xl border p-3 flex flex-col items-center text-center gap-2 ${
                status === "received"
                  ? isFullscreen
                    ? "border-emerald-400 bg-emerald-950/60"
                    : "border-emerald-400 bg-emerald-100/90"
                  : status === "capturing"
                    ? isFullscreen
                      ? "border-amber-400/70 bg-amber-950/40"
                      : "border-amber-300 bg-amber-50"
                    : isFullscreen
                      ? "border-slate-600 bg-slate-900/80"
                      : "border-slate-200 bg-white"
              }`}
            >
              <p
                className={`text-3xl sm:text-4xl font-black leading-none tabular-nums ${
                  isFullscreen ? "text-white" : "text-slate-900"
                }`}
              >
                {slot}
              </p>
              <p className={`text-sm font-semibold ${isFullscreen ? "text-slate-100" : "text-slate-800"}`}>
                {collaborativeQrDisplayName(slot)}
              </p>
              <p className={`text-xs font-medium ${isFullscreen ? "text-slate-300" : "text-slate-600"}`}>
                {collaborativeSlotDisplayName(slot, label)}
              </p>
              <div
                className={`rounded-md bg-white p-1.5 border ${
                  isFullscreen ? "border-slate-500" : "border-slate-200"
                }`}
              >
                {qrSrc ? (
                  <img
                    src={qrSrc}
                    width={QR_IMG_PX}
                    height={QR_IMG_PX}
                    alt=""
                    className="block"
                    style={{ width: QR_IMG_PX, height: QR_IMG_PX }}
                  />
                ) : (
                  <div
                    className="flex items-center justify-center text-[10px] text-slate-500"
                    style={{ width: QR_IMG_PX, height: QR_IMG_PX }}
                  >
                    …
                  </div>
                )}
              </div>
              <p
                className={`text-xs font-semibold min-h-[2.5rem] flex items-center justify-center gap-1 px-1 ${
                  status === "received"
                    ? isFullscreen
                      ? "text-emerald-300"
                      : "text-emerald-800"
                    : status === "capturing"
                      ? isFullscreen
                        ? "text-amber-200"
                        : "text-amber-900"
                      : isFullscreen
                        ? "text-slate-400"
                        : "text-slate-500"
                }`}
              >
                {status === "received" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                ) : null}
                {statusLabel(status)}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
