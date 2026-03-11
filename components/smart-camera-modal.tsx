"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

export type CaptureMode = "sm_vf" | "terminos_pareados" | "desarrollo" | "closed_answer"

export type CameraFeedback = {
  confidence: number
  message?: string
}

type Props = {
  onCapture: (dataUrl: string, feedback?: CameraFeedback) => void
  onClose: () => void
  captureMode: CaptureMode | null

  // ✅ Acepta una función normal (NO Dispatch) para que puedas pasar handlers sin error.
  onFeedbackChange?: (feedback: CameraFeedback | null) => void
  currentFeedback?: CameraFeedback | null
}

export default function SmartCameraModal({
  onCapture,
  onClose,
  captureMode,
  onFeedbackChange,
  currentFeedback,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [confidence, setConfidence] = useState<number>(currentFeedback?.confidence ?? 1)

  // Sync si el padre actualiza feedback
  useEffect(() => {
    if (typeof currentFeedback?.confidence === "number") {
      setConfidence(currentFeedback.confidence)
    }
  }, [currentFeedback?.confidence])

  const stopCamera = useCallback(() => {
    if (stream) {
      for (const t of stream.getTracks()) t.stop()
    }
    setStream(null)
  }, [stream])

  const startCamera = useCallback(async () => {
    const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    setStream(media)
    if (videoRef.current) {
      videoRef.current.srcObject = media
      await videoRef.current.play()
    }
  }, [])

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  const feedback: CameraFeedback | null = useMemo(() => {
    return { confidence, message: captureMode ? `Modo: ${captureMode}` : undefined }
  }, [confidence, captureMode])

  useEffect(() => {
    if (onFeedbackChange) onFeedbackChange(feedback)
  }, [feedback, onFeedbackChange])

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL("image/png")
    onCapture(dataUrl, feedback ?? undefined)
  }, [onCapture, feedback])

  const close = useCallback(() => {
    stopCamera()
    onClose()
  }, [stopCamera, onClose])

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Cámara</h2>
          <button onClick={close} className="rounded px-2 py-1 text-sm hover:bg-black/5">
            Cerrar
          </button>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} className="h-auto w-full" playsInline muted />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="text-sm">Confianza (simulada): {Math.round(confidence * 100)}%</label>
          <input type="range" min={0} max={1} step={0.01} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={capture} className="flex-1 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            Capturar
          </button>
          <button onClick={close} className="flex-1 rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold hover:bg-black/5">
            Cancelar
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  )
}
