"use client"
/* eslint-disable @next/next/no-img-element -- QR PNG desde API con cookie de sesión. */

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { QrCode, RefreshCw, Copy, Check } from "lucide-react"

type Props = {
  batchId: string | null
  onRegenerateBatch: () => void
}

export function BatchMobileSyncPanel({ batchId, onRegenerateBatch }: Props) {
  const [mounted, setMounted] = useState(false)
  const [origin, setOrigin] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setMounted(true)
    setOrigin(window.location.origin)
  }, [])

  const ready = mounted && !!batchId && !!origin
  const mobileUrl =
    ready ? `${origin}/docente/movil-scan?batch_id=${encodeURIComponent(batchId!)}` : ""

  const qrSrc = ready ? `/api/docente/station-qr?u=${encodeURIComponent(mobileUrl)}` : ""

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
            estación. Las fotos deben subirse al bucket <code>batch-scans</code> con la ruta indicada abajo.
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

      <div className="flex flex-wrap items-start gap-6">
        <div className="rounded-lg bg-white p-2 border border-indigo-100 shadow-sm">
          {qrSrc ? (
            <img src={qrSrc} width={240} height={240} className="block" alt="Código QR para abrir captura móvil" />
          ) : (
            <div className="w-[240px] h-[240px] flex items-center justify-center text-center text-sm text-slate-500 px-2">
              {mounted && !batchId ? "Generando lote…" : "Cargando QR…"}
            </div>
          )}
        </div>
        <div className="space-y-2 min-w-[12rem]">
          <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={() => void copyLink()} disabled={!mobileUrl}>
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copiado" : "Copiar enlace"}
          </Button>
          <p className="text-[11px] text-slate-600 max-w-sm">
            Ruta Storage: <code className="text-[10px]">{"{teacher_id}/{batch_id}/archivo.jpg"}</code>
            <span className="block mt-1">En el celular debe iniciar sesión con la misma cuenta para subir fotos (Paso C).</span>
          </p>
        </div>
      </div>
    </div>
  )
}
