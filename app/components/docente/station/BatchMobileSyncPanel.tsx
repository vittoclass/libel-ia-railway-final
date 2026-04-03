"use client"
/* eslint-disable @next/next/no-img-element -- QR PNG desde API con cookie de sesión. */

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { QrCode, RefreshCw, Copy, Check } from "lucide-react"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"

const QR_SIZE_PX = 256

type Props = {
  batchId: string | null
  onRegenerateBatch: () => void
  /** Si falla POST batch-session, envía el objeto crudo a la página (mismo debug que DocenteEstacion). */
  onBatchSessionDebug?: (payload: unknown) => void
  /** Páginas por alumno (debe coincidir con la estación / móvil). */
  expectedPagesPerStudent?: number
  /** Pauta base elegida en el PC (opcional). */
  sourceExamId?: string | null
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

export function BatchMobileSyncPanel({
  batchId,
  onRegenerateBatch,
  onBatchSessionDebug,
  expectedPagesPerStudent = 2,
  sourceExamId = null,
}: Props) {
  const [isMounted, setIsMounted] = useState(false)
  const [origin, setOrigin] = useState("")
  const [copied, setCopied] = useState(false)
  const [qrLoadFailed, setQrLoadFailed] = useState(false)

  useEffect(() => {
    setIsMounted(true)
    setOrigin(resolveClientPublicOrigin())
  }, [])

  const ready = isMounted && !!batchId && !!origin
  const mobileUrl = ready ? `${origin}/escaneo/${encodeURIComponent(batchId!)}` : ""

  const qrSrc = ready ? `/api/docente/station-qr?u=${encodeURIComponent(mobileUrl)}` : ""

  useEffect(() => {
    setQrLoadFailed(false)
  }, [qrSrc])

  /** Registra el lote en batch_scan_sessions al tener URL de QR lista (mismo ID que en /escaneo/[batchId]). */
  useEffect(() => {
    if (!ready || !batchId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/docente/batch-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            batch_id: batchId,
            expected_pages_per_student: expectedPagesPerStudent,
            source_exam_id: sourceExamId,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && j?.ok) {
          console.log("Lote registrado con éxito:", batchId)
        } else {
          console.warn("[BatchMobileSyncPanel] No se pudo registrar lote", batchId, res.status, j)
          onBatchSessionDebug?.({
            source: "BatchMobileSyncPanel",
            endpoint: "POST /api/docente/batch-session",
            httpStatus: res.status,
            batchId,
            body: j,
          })
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("[BatchMobileSyncPanel] batch-session", batchId, e)
          onBatchSessionDebug?.({
            source: "BatchMobileSyncPanel",
            endpoint: "POST /api/docente/batch-session",
            networkOrParse: true,
            batchId,
            exception: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, batchId, onBatchSessionDebug, expectedPagesPerStudent, sourceExamId])

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
        <Button type="button" variant="outline" size="sm" onClick={onRegenerateBatch} className="shrink-0 gap-1">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Nuevo lote / código
        </Button>
      </div>

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
                className="flex max-w-full items-center justify-center text-center text-sm text-slate-600 px-3"
                style={{ width: QR_SIZE_PX, height: QR_SIZE_PX, minWidth: 200, minHeight: 200 }}
              >
                {qrLoadFailed ? (
                  <span>
                    No se pudo mostrar el código. Use <strong>Copiar enlace</strong> o pulse <strong>Nuevo lote</strong>{" "}
                    y recargue.
                  </span>
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
