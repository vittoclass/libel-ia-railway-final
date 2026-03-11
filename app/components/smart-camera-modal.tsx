"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { X, Camera, RotateCw, Zap, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Props {
  isOpen: boolean
  onClose: () => void
  onCapture: (dataUrl: string) => void
  onFeedback?: (feedback: { confidence: number }) => void
  captureMode?: "sm_vf" | "terminos_pareados" | "desarrollo" | "closed_answer" | null
}

export default function SmartCameraModal({
  isOpen,
  onClose,
  onCapture,
  onFeedback,
  captureMode,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment")
  const [captureCount, setCaptureCount] = useState(0)
  const [lastCapture, setLastCapture] = useState<string | null>(null)

  // Iniciar cámara
  const startCamera = useCallback(async () => {
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      }

      const newStream = await navigator.mediaDevices.getUserMedia(constraints)
      setStream(newStream)

      if (videoRef.current) {
        videoRef.current.srcObject = newStream
        await videoRef.current.play()
      }
    } catch (error) {
      console.error("Error al acceder a la cámara:", error)
      alert("No se pudo acceder a la cámara. Verifica los permisos.")
    }
  }, [facingMode, stream])

  // Detener cámara
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
  }, [stream])

  // Cambiar cámara frontal/trasera
  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))
  }

  // Capturar foto
  const handleCapture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return

    setIsCapturing(true)

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")

    if (!ctx) return

    // Configurar canvas con dimensiones del video
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Dibujar frame actual
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Convertir a dataURL
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9)

    setLastCapture(dataUrl)
    setCaptureCount((prev) => prev + 1)

    // Feedback de confianza simulado (en producción vendría del análisis real)
    if (onFeedback) {
      onFeedback({ confidence: 0.95 })
    }

    // Enviar captura
    onCapture(dataUrl)

    setTimeout(() => {
      setIsCapturing(false)
    }, 300)
  }, [onCapture, onFeedback])

  // Efectos
  useEffect(() => {
    if (isOpen) {
      startCamera()
    } else {
      stopCamera()
      setCaptureCount(0)
      setLastCapture(null)
    }

    return () => {
      stopCamera()
    }
  }, [isOpen])

  // Reiniciar cámara cuando cambia el facingMode
  useEffect(() => {
    if (isOpen && stream) {
      startCamera()
    }
  }, [facingMode])

  if (!isOpen) return null

  const getModeLabel = () => {
    switch (captureMode) {
      case "sm_vf":
        return "Selección Múltiple / V-F"
      case "terminos_pareados":
        return "Términos Pareados"
      case "desarrollo":
        return "Preguntas de Desarrollo"
      case "closed_answer":
        return "Plantilla de Respuestas"
      default:
        return "Captura de Prueba"
    }
  }

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-2 md:p-4">
      <Card className="w-full max-w-4xl h-[90vh] flex flex-col bg-black overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-3 bg-black/80 text-white border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-blue-400" />
            <span className="font-semibold">{getModeLabel()}</span>
            {captureCount > 0 && (
              <span className="text-xs bg-green-600 px-2 py-0.5 rounded-full">
                {captureCount} capturada{captureCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-gray-800">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Video preview */}
        <div className="flex-1 relative bg-black overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "w-full h-full object-contain",
              isCapturing && "opacity-50"
            )}
          />

          {/* Overlay de guía */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Marco de encuadre */}
            <div className="absolute inset-4 md:inset-8 border-2 border-dashed border-white/30 rounded-lg" />

            {/* Indicadores de esquinas */}
            <div className="absolute top-4 left-4 md:top-8 md:left-8 w-8 h-8 border-t-2 border-l-2 border-blue-400" />
            <div className="absolute top-4 right-4 md:top-8 md:right-8 w-8 h-8 border-t-2 border-r-2 border-blue-400" />
            <div className="absolute bottom-20 left-4 md:bottom-24 md:left-8 w-8 h-8 border-b-2 border-l-2 border-blue-400" />
            <div className="absolute bottom-20 right-4 md:bottom-24 md:right-8 w-8 h-8 border-b-2 border-r-2 border-blue-400" />

            {/* Instrucción */}
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full">
              Centra la hoja dentro del marco
            </div>

            {/* Flash de captura */}
            {isCapturing && (
              <div className="absolute inset-0 bg-white animate-pulse" />
            )}
          </div>

          {/* Canvas oculto para captura */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Controles */}
        <div className="p-4 bg-black flex items-center justify-center gap-4">
          {/* Botón cambiar cámara */}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleFacingMode}
            className="rounded-full w-12 h-12 bg-gray-800 border-gray-700 text-white hover:bg-gray-700"
          >
            <RotateCw className="h-5 w-5" />
          </Button>

          {/* Botón capturar */}
          <Button
            onClick={handleCapture}
            disabled={!stream || isCapturing}
            className={cn(
              "rounded-full w-16 h-16 bg-white hover:bg-gray-200 transition-all",
              isCapturing && "scale-90"
            )}
          >
            <div className="w-12 h-12 rounded-full border-4 border-gray-300" />
          </Button>

          {/* Botón flash/confirmar */}
          <Button
            variant="outline"
            size="icon"
            onClick={onClose}
            className="rounded-full w-12 h-12 bg-green-600 border-green-500 text-white hover:bg-green-700"
          >
            <CheckCircle2 className="h-5 w-5" />
          </Button>
        </div>

        {/* Miniaturas de capturas */}
        {captureCount > 0 && lastCapture && (
          <div className="p-2 bg-gray-900 border-t border-gray-800">
            <div className="flex gap-2 overflow-x-auto">
              <div className="w-16 h-16 rounded border border-gray-600 overflow-hidden flex-shrink-0">
                <img
                  src={lastCapture}
                  alt="Última captura"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex items-center text-xs text-gray-400">
                {captureCount} imagen{captureCount > 1 ? "es" : ""} capturada{captureCount > 1 ? "s" : ""}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
