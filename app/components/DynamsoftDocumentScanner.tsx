"use client"

/**
 * Scanner de documento con Dynamsoft Document Normalizer.
 * Captura desde cámara, detecta documento, recorta y corrige perspectiva;
 * devuelve la imagen normalizada vía onImageCaptured(dataUrl).
 * Integración real: NO decorativa.
 */

import * as React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  loadDynamsoftSDK,
  initDynamsoftLicense,
  normalizeDocumentFromBlob,
  isDynamsoftEnabled,
} from "@/app/lib/dynamsoft-normalizer"

export type DynamsoftDocumentScannerProps = {
  open: boolean
  onClose: () => void
  /** Imagen normalizada (data URL) lista para OpenCV OMR. */
  onImageCaptured: (dataUrl: string) => void
}

export function DynamsoftDocumentScanner({
  open,
  onClose,
  onImageCaptured,
}: DynamsoftDocumentScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "capturing" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [licenseInited, setLicenseInited] = useState(false)

  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [stream])

  useEffect(() => {
    if (!open) {
      stopStream()
      setStatus("idle")
      setErrorMessage(null)
      return
    }

    if (!isDynamsoftEnabled()) {
      setStatus("error")
      setErrorMessage("Dynamsoft no disponible. Use carga manual o configure NEXT_PUBLIC_DYNAMSOFT_LICENSE y NEXT_PUBLIC_DYNAMSOFT_ENABLED=true.")
      return
    }

    setStatus("loading")
    setErrorMessage(null)

    const license = process.env.NEXT_PUBLIC_DYNAMSOFT_LICENSE || ""

    const init = async () => {
      try {
        await loadDynamsoftSDK()
        await initDynamsoftLicense(license)
        setLicenseInited(true)

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        setStream(mediaStream)
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream
          await videoRef.current.play()
        }
        setStatus("ready")
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setStatus("error")
        setErrorMessage(msg || "Error al iniciar Dynamsoft o cámara.")
        if (process.env.NODE_ENV === "development") {
          console.warn("[DynamsoftDocumentScanner] init error", err)
        }
      }
    }

    init()
    return () => {
      stopStream()
    }
  }, [open, stopStream])

  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || status !== "ready") return

    setStatus("capturing")
    setErrorMessage(null)

    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("No canvas context")

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.92)
      })
      if (!blob) throw new Error("No se pudo generar la imagen")

      const dataUrl = await normalizeDocumentFromBlob(blob)
      onImageCaptured(dataUrl)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg || "Error al normalizar el documento.")
      setStatus("ready")
      if (process.env.NODE_ENV === "development") {
        console.warn("[DynamsoftDocumentScanner] capture/normalize error", err)
      }
    }
  }, [status, onImageCaptured, onClose])

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Capturar con Dynamsoft</DialogTitle>
        </DialogHeader>

        {status === "error" && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        {status === "loading" && (
          <p className="text-sm text-muted-foreground">
            Cargando Dynamsoft y cámara...
          </p>
        )}

        {status === "ready" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Encuadre el documento. Al capturar se detectarán bordes y se normalizará la imagen.
            </p>
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-contain"
              />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={handleCapture}>
                Capturar y normalizar
              </Button>
            </div>
          </div>
        )}

        {status === "capturing" && (
          <p className="text-sm text-muted-foreground">
            Detectando documento y normalizando...
          </p>
        )}

        {status === "error" && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Usar carga manual
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
