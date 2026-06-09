"use client"
/* eslint-disable @next/next/no-img-element -- QR PNG desde API con cookie de sesión. */

import { useEffect, useState, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { QrCode, RefreshCw, Copy, Check, Smartphone, Radio } from "lucide-react"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { BATCH_PHOTO_ACTIVITY_CHANNEL } from "@/app/lib/docente/active-batch-id"
import { readWizardSession } from "@/app/components/teacher-wizard/sessionStorage"
import type { DevelopmentTipoPrueba } from "@/app/lib/development-crop/flags"

const QR_SIZE_PX = 256
const MOBILE_ACTIVE_MS = 90_000

export type BatchSessionStatusPayload = {
  ok: boolean
  httpStatus: number
  message: string
  requestPayload: Record<string, unknown>
  responseJson: unknown
  /** Si el servidor no devolvió JSON (p. ej. HTML de error). */
  rawTextSnippet?: string
}

type Props = {
  batchId: string | null
  onRegenerateBatch: () => void
  /** Resultado del POST /api/docente/batch-session (éxito o error con cuerpo parseado). */
  onBatchSessionStatus?: (payload: BatchSessionStatusPayload) => void
  /** Si falla POST batch-session, envía el objeto crudo a la página (mismo debug que DocenteEstacion). */
  onBatchSessionDebug?: (payload: unknown) => void
  /** Páginas por alumno (debe coincidir con la estación / móvil). */
  expectedPagesPerStudent?: number
  /** Pauta base elegida en el PC (opcional). */
  sourceExamId?: string | null
  /** Texto opcional solo para logs en servidor (no se persiste en BD). */
  sessionContext?: string | null
}

/** Origen público para el enlace móvil: mismo host que la barra de direcciones; fuerza https fuera de localhost. */
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

function formatActivity(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return "—"
  }
}

export function BatchMobileSyncPanel({
  batchId,
  onRegenerateBatch,
  onBatchSessionStatus,
  onBatchSessionDebug,
  expectedPagesPerStudent = 2,
  sourceExamId = null,
  sessionContext = null,
}: Props) {
  const [isMounted, setIsMounted] = useState(false)
  const [origin, setOrigin] = useState("")
  const [copied, setCopied] = useState(false)
  const [qrLoadFailed, setQrLoadFailed] = useState(false)
  const [qrNonce, setQrNonce] = useState(0)
  const [lastPhotoActivityAt, setLastPhotoActivityAt] = useState<number | null>(null)
  const [batchSessionOk, setBatchSessionOk] = useState<boolean | null>(null)

  useEffect(() => {
    setIsMounted(true)
    setOrigin(resolveClientPublicOrigin())
  }, [])

  const ready = isMounted && !!batchId && !!origin
  const mobileUrl = useMemo(() => {
    if (!ready) return ""
    const base = `${origin}/escaneo/${encodeURIComponent(batchId!)}`
    const tipo = readWizardSession()?.tipoPrueba as DevelopmentTipoPrueba | undefined
    if (!tipo) return base
    return `${base}?tipo=${encodeURIComponent(tipo)}`
  }, [ready, origin, batchId])

  const qrSrc = ready ? `/api/docente/station-qr?u=${encodeURIComponent(mobileUrl)}&v=${qrNonce}` : ""

  useEffect(() => {
    setQrLoadFailed(false)
  }, [qrSrc])

  const retryQr = useCallback(() => {
    setQrLoadFailed(false)
    setQrNonce((n) => n + 1)
  }, [])

  /** Escucha actividad de fotos en el mismo navegador (BroadcastChannel desde la grilla). */
  useEffect(() => {
    if (!batchId) return
    let ch: BroadcastChannel | null = null
    try {
      ch = new BroadcastChannel(BATCH_PHOTO_ACTIVITY_CHANNEL)
      ch.onmessage = (ev: MessageEvent) => {
        const d = ev.data as { type?: string; batchId?: string } | undefined
        if (d?.type === "batch_photo_change" && d.batchId === batchId) {
          setLastPhotoActivityAt(Date.now())
        }
      }
    } catch {
      /* BroadcastChannel no disponible */
    }
    return () => {
      try {
        ch?.close()
      } catch {
        /* noop */
      }
    }
  }, [batchId])

  /** Registra el lote en batch_scan_sessions al tener URL de QR lista (mismo ID que en /escaneo/[batchId]). */
  useEffect(() => {
    if (!ready || !batchId) return
    let cancelled = false
    void (async () => {
      const requestPayload: Record<string, unknown> = {
        batch_id: batchId,
        expected_pages_per_student: expectedPagesPerStudent,
        source_exam_id: sourceExamId ?? null,
      }
      const ctx = typeof sessionContext === "string" ? sessionContext.trim() : ""
      if (ctx) requestPayload.session_context = ctx

      const emitStatus = (p: BatchSessionStatusPayload) => {
        onBatchSessionStatus?.(p)
        if (!p.ok) {
          onBatchSessionDebug?.({
            source: "BatchMobileSyncPanel",
            endpoint: "POST /api/docente/batch-session",
            httpStatus: p.httpStatus,
            batchId,
            requestPayload: p.requestPayload,
            responseJson: p.responseJson,
            rawTextSnippet: p.rawTextSnippet,
          })
        }
      }

      try {
        const res = await fetch("/api/docente/batch-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(requestPayload),
        })
        const text = await res.text()
        let responseJson: unknown = {}
        let rawTextSnippet: string | undefined
        try {
          responseJson = text && text.length > 0 ? JSON.parse(text) : {}
        } catch {
          rawTextSnippet = text.slice(0, 500)
          responseJson = {
            ok: false,
            error: "La respuesta del servidor no es JSON (posible error HTML o vacío).",
            rawTextSnippet,
          }
        }
        if (cancelled) return
        const j = responseJson as { ok?: boolean; error?: string }
        const ok = res.ok && j?.ok === true
        if (ok) {
          setBatchSessionOk(true)
          console.log("Lote registrado con éxito:", batchId)
          emitStatus({
            ok: true,
            httpStatus: res.status,
            message: "ok",
            requestPayload,
            responseJson,
          })
        } else {
          setBatchSessionOk(false)
          const msg =
            typeof j?.error === "string" && j.error.length > 0 ? j.error : `Error HTTP ${res.status}`
          console.warn("[BatchMobileSyncPanel] No se pudo registrar lote", batchId, res.status, responseJson)
          emitStatus({
            ok: false,
            httpStatus: res.status,
            message: msg,
            requestPayload,
            responseJson,
            rawTextSnippet,
          })
        }
      } catch (e) {
        if (!cancelled) {
          setBatchSessionOk(false)
          console.warn("[BatchMobileSyncPanel] batch-session", batchId, e)
          const ex = e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e)
          emitStatus({
            ok: false,
            httpStatus: 0,
            message: "No se pudo contactar al servidor para registrar el lote.",
            requestPayload,
            responseJson: { networkOrParse: true, exception: ex },
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, batchId, onBatchSessionStatus, onBatchSessionDebug, expectedPagesPerStudent, sourceExamId, sessionContext])

  async function copyLink() {
    if (!mobileUrl || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(mobileUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* noop */
    }
  }

  const showQrImage = isMounted && !!qrSrc && !qrLoadFailed

  const qrActive = ready && !qrLoadFailed && batchSessionOk !== false
  const now = typeof performance !== "undefined" ? Date.now() : 0
  const mobileRecentlyActive =
    lastPhotoActivityAt != null && now > 0 && now - lastPhotoActivityAt < MOBILE_ACTIVE_MS
  const waitingFirstMobile = ready && batchSessionOk === true && lastPhotoActivityAt == null
  const staleMobile = ready && batchSessionOk === true && lastPhotoActivityAt != null && !mobileRecentlyActive

  const confirmBeforeRegenerateBatch = useCallback(() => {
    if (lastPhotoActivityAt != null || batchSessionOk === true) {
      const go = window.confirm(
        "Crear nuevo lote no borra las fotos del servidor, pero puede desconectar esta pantalla del lote actual (nuevo código QR). ¿Continuar?",
      )
      if (!go) return
    }
    onRegenerateBatch()
  }, [batchSessionOk, lastPhotoActivityAt, onRegenerateBatch])

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-indigo-950 flex items-center gap-2">
            <QrCode className="h-5 w-5" aria-hidden />
            Sincronización móvil
          </h3>
          <p className="text-xs text-indigo-900/80 mt-1 max-w-prose">
            Escanee el código con el celular (o copie el enlace). El móvil usará el mismo <code>batch_id</code> que esta
            estación. Las fotos deben subirse al bucket <code>{BATCH_SCANS_BUCKET}</code> con la ruta indicada abajo.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={confirmBeforeRegenerateBatch} className="shrink-0 gap-1">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Nuevo lote / código
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px]">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
            qrActive ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          <Radio className="h-3 w-3 shrink-0" aria-hidden />
          {qrActive ? "QR activo" : qrLoadFailed ? "QR no disponible" : ready ? "Preparando QR…" : "Esperando lote…"}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
            mobileRecentlyActive
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : waitingFirstMobile
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : staleMobile
                  ? "border-slate-200 bg-slate-100 text-slate-700"
                  : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          <Smartphone className="h-3 w-3 shrink-0" aria-hidden />
          {mobileRecentlyActive
            ? "Móvil conectado"
            : waitingFirstMobile
              ? "Esperando conexión móvil"
              : staleMobile
                ? "Sin actividad reciente"
                : "Sin actividad aún"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700">
          Última actividad: {lastPhotoActivityAt != null ? formatActivity(lastPhotoActivityAt) : "—"}
        </span>
      </div>

      {qrLoadFailed ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">No se pudo cargar la imagen del código QR.</p>
          <p className="text-xs mt-1 text-amber-900/90">
            Use <strong>Copiar enlace</strong> para abrir la captura en el celular, o reintente el QR si el servidor respondió lento.
          </p>
          <Button type="button" variant="secondary" size="sm" className="mt-2 gap-1" onClick={retryQr}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Reintentar QR
          </Button>
        </div>
      ) : null}

      {batchSessionOk === false ? (
        <p className="text-xs text-rose-800 bg-rose-50 border border-rose-100 rounded-md px-2 py-1.5">
          No se pudo registrar el lote en el servidor. El QR puede mostrarse, pero el móvil podría rechazar subidas hasta que la
          sesión se registre (revise conexión o vuelva a intentar con <strong>Nuevo lote</strong>).
        </p>
      ) : null}

      <div className="text-xs font-mono break-all bg-white/80 border border-indigo-100 rounded-md px-2 py-1.5 text-slate-800">
        batch_id: {ready ? batchId : "… (se asigna al montar en el navegador)"}
      </div>

      <div className="flex flex-col items-center gap-6 md:flex-row md:flex-wrap md:items-start md:justify-center">
        <div className="flex w-full justify-center md:w-auto md:flex-1 md:justify-center">
          <div className="rounded-lg bg-white p-3 border border-indigo-100 shadow-sm">
            {showQrImage ? (
              <img
                src={qrSrc}
                width={QR_SIZE_PX}
                height={QR_SIZE_PX}
                className="block min-h-[200px] min-w-[200px]"
                alt="Código QR para abrir captura móvil"
                onError={() => {
                  console.warn("[BatchMobileSyncPanel] Error al cargar imagen QR", qrSrc)
                  setQrLoadFailed(true)
                }}
              />
            ) : (
              <div
                className="flex max-w-full flex-col items-center justify-center text-center text-sm text-slate-600 px-3 gap-2"
                style={{ width: QR_SIZE_PX, height: QR_SIZE_PX, minWidth: 200, minHeight: 200 }}
              >
                {qrLoadFailed ? (
                  <>
                    <span>
                      No se pudo mostrar el código. Use <strong>Copiar enlace</strong> o pulse <strong>Reintentar QR</strong>.
                    </span>
                    <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={retryQr}>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      Reintentar QR
                    </Button>
                  </>
                ) : (
                  <span>Generando conexión segura…</span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="space-y-2 min-w-[12rem] w-full max-w-sm md:w-auto">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1 w-full sm:w-auto"
            onClick={() => void copyLink()}
            disabled={!mobileUrl}
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copiado" : "Copiar enlace"}
          </Button>
          <p className="text-[11px] text-slate-600 max-w-sm">
            Ruta Storage: <code className="text-[10px]">{"{teacher_id}/{batch_id}/archivo.jpg"}</code>
            <span className="block mt-1">El celular abre /escaneo sin login; las fotos suben por la API del servidor.</span>
          </p>
        </div>
      </div>
    </div>
  )
}
