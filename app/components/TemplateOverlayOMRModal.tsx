"use client"

/**
 * OMR guiado por plantilla real superpuesta.
 * Flujo: tipo de prueba (solo/mixta) → cargar plantilla (imagen + clave) → cámara con overlay y alineación real → captura → lectura por grid → comparación → revisión → guardado.
 * Alineación real en tiempo real: detección de hoja en el frame y guía hasta que encaje con el marco de la plantilla.
 * No modifica /api/evaluate ni persist-evaluation; usa retry-save. Solo burbujas en V1.
 */
import * as React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loader2, Camera, CheckCircle2, XCircle, AlertCircle, Save } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { readGridFromImage } from "@/app/lib/omr-grid-reader"
import { readLibelIASheetFromImage, drawBubbleDebugOverlay } from "@/app/lib/omr-libelia-reader"
import { detectSheetInFrame, getAlignmentFeedback, drawDetectionOverlay, GRAY_THRESHOLD } from "@/app/lib/sheet-alignment"
import { findSheetCornersAndWarp } from "@/app/lib/sheet-perspective"

type TrialType = "solo" | "mixta"
type Step = "trial_type" | "template" | "camera" | "preview" | "result" | "review" | "done"

type AnswerKeyItem = { pregunta: number; respuestaCorrecta: string }
type CompareResult = {
  success: boolean
  resultados: Array<{
    pregunta: number
    respuestaCorrecta: string
    respuestaEstudiante: string
    esCorrecta: boolean
    confianzaLectura: number
  }>
  totalPreguntas: number
  correctas: number
  incorrectas: number
  sinResponder: number
  porcentaje: number
  nota: number
  requierenRevision: number[]
  warnings: string[]
}

function calcularNotaChile(correctas: number, total: number, exigencia = 0.6): number {
  if (total === 0) return 1.0
  const puntajeMinimo = total * exigencia
  if (correctas >= puntajeMinimo) {
    const rango = total - puntajeMinimo
    const puntosExtras = correctas - puntajeMinimo
    return Math.min(7.0, Math.round((4.0 + (puntosExtras / rango) * 3.0) * 10) / 10)
  }
  return Math.max(1.0, Math.round((1.0 + (correctas / puntajeMinimo) * 3.0) * 10) / 10)
}

type Props = {
  open: boolean
  onClose: () => void
  onSaved?: (evaluationId: string) => void
}

export function TemplateOverlayOMRModal({ open, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [step, setStep] = useState<Step>("trial_type")
  const [trialType, setTrialType] = useState<TrialType | null>(null)
  const [totalPreguntas, setTotalPreguntas] = useState(40)
  const [opciones, setOpciones] = useState("A,B,C,D")
  const [templateDataUrl, setTemplateDataUrl] = useState<string | null>(null)
  const [templateAspectRatio, setTemplateAspectRatio] = useState(1.4)
  const [answerKey, setAnswerKey] = useState<AnswerKeyItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [pendingCaptureDataUrl, setPendingCaptureDataUrl] = useState<string | null>(null)
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [revisedAnswers, setRevisedAnswers] = useState<Record<number, string>>({})
  const [showDebugBubbles, setShowDebugBubbles] = useState(false)
  const debugCanvasRef = useRef<HTMLCanvasElement>(null)

  const [studentName, setStudentName] = useState("")
  const [courseLabel, setCourseLabel] = useState("")
  const [title, setTitle] = useState("")
  const [subject, setSubject] = useState("")

  const [alignmentMessage, setAlignmentMessage] = useState("Alineando plantilla con la hoja...")
  const [alignmentScore, setAlignmentScore] = useState(0)
  const [alignmentReady, setAlignmentReady] = useState(false)
  const [captureAlignmentReady, setCaptureAlignmentReady] = useState(false)
  const [perspectiveCorrected, setPerspectiveCorrected] = useState(false)

  const canvasWorkRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const optionsList = opciones.split(",").map((o) => o.trim().toUpperCase()).filter(Boolean)

  const handleTrialType = (type: TrialType) => {
    setTrialType(type)
    setStep("template")
    setError(null)
  }

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith("image/")) return
    setLoading(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const img = new Image()
      img.src = dataUrl
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = rej
      })
      const aspect = img.naturalWidth / img.naturalHeight
      setTemplateAspectRatio(aspect)
      setTemplateDataUrl(dataUrl)

      const res = await fetch("/api/omr/answer-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl,
          mimeType: file.type || "image/jpeg",
          totalPreguntas,
          alternativas: optionsList,
          columnas: 2,
          tipoMarca: "burbuja",
        }),
      })
      const data = await res.json()
      if (data.success && Array.isArray(data.respuestas)) {
        setTotalPreguntas(data.totalPreguntas || totalPreguntas)
        setAnswerKey(
          data.respuestas.map((r: { pregunta: number; respuestaCorrecta: string }) => ({
            pregunta: r.pregunta,
            respuestaCorrecta: String(r.respuestaCorrecta || "").trim().toUpperCase(),
          }))
        )
        setStep("camera")
        toast({ title: "Plantilla correcta cargada. Alinea la hoja con la plantilla." })
      } else {
        setError(data.error || "No se pudo extraer la clave de la plantilla.")
      }
    } catch {
      setError("Error al cargar la plantilla.")
    } finally {
      setLoading(false)
    }
  }

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("La cámara no está disponible.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setError(null)
    } catch {
      setError("No se pudo acceder a la cámara. Revisa los permisos.")
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach((t) => t.stop())
      videoRef.current.srcObject = null
    }
  }, [])

  useEffect(() => {
    if (open && step === "camera") startCamera()
    return () => { if (step !== "camera") stopCamera() }
  }, [open, step, startCamera, stopCamera])

  useEffect(() => {
    if (step !== "camera" || !templateDataUrl || !videoRef.current) return
    const video = videoRef.current
    if (!canvasWorkRef.current) canvasWorkRef.current = document.createElement("canvas")
    const work = canvasWorkRef.current
    let rafId: number
    const tick = () => {
      if (step !== "camera" || !videoRef.current) return
      const v = videoRef.current
      if (v.readyState >= 2) {
        const detected = detectSheetInFrame(v, work)
        const viewW = work.width
        const viewH = work.height
        const feedback = getAlignmentFeedback(detected, viewW, viewH, templateAspectRatio)
        setAlignmentMessage(feedback.message)
        setAlignmentScore(feedback.score)
        setAlignmentReady(feedback.ready)
        if (overlayCanvasRef.current && v.clientWidth > 0 && v.clientHeight > 0) {
          drawDetectionOverlay(
            overlayCanvasRef.current,
            detected,
            feedback,
            viewW,
            viewH,
            v.clientWidth,
            v.clientHeight,
            v.videoWidth,
            v.videoHeight
          )
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [step, templateAspectRatio])

  // Debug: dibujar zonas de lectura (burbujas) sobre la imagen en preview
  useEffect(() => {
    if (
      step !== "preview" ||
      !showDebugBubbles ||
      !pendingCaptureDataUrl ||
      answerKey.length === 0 ||
      !debugCanvasRef.current
    )
      return
    const canvas = debugCanvasRef.current
    drawBubbleDebugOverlay(
      canvas,
      pendingCaptureDataUrl,
      answerKey.length,
      optionsList.length
    ).catch(() => {})
  }, [step, showDebugBubbles, pendingCaptureDataUrl, answerKey.length, optionsList.length])

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return
    setCaptureAlignmentReady(alignmentReady)
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92)
    setPendingCaptureDataUrl(dataUrl)
    stopCamera()
    setStep("preview")
    setError(null)
  }

  const handleConfirmCapture = async () => {
    const dataUrl = pendingCaptureDataUrl
    if (!dataUrl || answerKey.length === 0) return
    setLoading(true)
    setError(null)
    setPerspectiveCorrected(false)
    try {
      let imageToRead = dataUrl
      const warpResult = await findSheetCornersAndWarp(
        dataUrl,
        templateAspectRatio,
        GRAY_THRESHOLD
      )
      if (warpResult?.correctedDataUrl) {
        imageToRead = warpResult.correctedDataUrl
        setPerspectiveCorrected(true)
      }

      let gridResults: { pregunta: number; respuesta: string; confianza: number }[]
      try {
        gridResults = await readLibelIASheetFromImage(
          imageToRead,
          answerKey.length,
          optionsList
        )
      } catch {
        gridResults = await readGridFromImage(imageToRead, templateAspectRatio, {
          totalPreguntas: answerKey.length,
          columnas: 2,
          opciones: optionsList,
        })
      }
      const studentAnswers = gridResults.map((r) => ({
        pregunta: r.pregunta,
        respuesta: r.respuesta || "SIN_RESPUESTA",
        confianza: r.confianza,
      }))

      const compareRes = await fetch("/api/omr/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answerKey: answerKey.map((k) => ({
            pregunta: k.pregunta,
            respuestaCorrecta: k.respuestaCorrecta,
            confianza: 0.95,
            metodo: "manual",
          })),
          studentAnswers,
          exigencia: 0.6,
        }),
      })
      const compareData = await compareRes.json()
      if (!compareData.success) {
        setError(compareData.error || "Error al comparar.")
        setLoading(false)
        return
      }
      setCompareResult(compareData)
      setRevisedAnswers({})
      setStep("result")
      const dudosas = compareData.requierenRevision?.length ?? 0
      toast({
        title: `Se detectaron ${compareData.correctas} correctas, ${compareData.incorrectas} incorrectas y ${dudosas} dudosas.`,
        description: dudosas > 0 ? `Hay ${dudosas} preguntas que requieren revisión manual.` : undefined,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al procesar.")
    } finally {
      setLoading(false)
    }
  }

  const handleRepetirCaptura = () => {
    setPendingCaptureDataUrl(null)
    setPerspectiveCorrected(false)
    setStep("camera")
    startCamera()
  }

  const handleRetake = () => {
    setPendingCaptureDataUrl(null)
    setCompareResult(null)
    setRevisedAnswers({})
    setPerspectiveCorrected(false)
    setStep("camera")
    startCamera()
  }

  const handleGoToReview = () => setStep("review")

  const setRevised = (pregunta: number, value: string) => {
    setRevisedAnswers((prev) => ({ ...prev, [pregunta]: value }))
  }

  const handleSave = async () => {
    if (!compareResult) return
    setLoading(true)
    setError(null)
    try {
      const total = compareResult.totalPreguntas
      const keyMap = new Map(answerKey.map((k) => [k.pregunta, k.respuestaCorrecta]))
      const alternativas_corregidas: Array<{ pregunta: string; respuesta_estudiante: string; respuesta_correcta: string }> = []
      let correctas = 0
      for (let i = 1; i <= total; i++) {
        const correcta = keyMap.get(i) || ""
        const estudiante = revisedAnswers[i] ?? compareResult.resultados.find((r) => r.pregunta === i)?.respuestaEstudiante ?? ""
        const est = String(estudiante).trim().toUpperCase()
        const cor = String(correcta).trim().toUpperCase()
        alternativas_corregidas.push({
          pregunta: String(i),
          respuesta_estudiante: est || "SIN_RESPUESTA",
          respuesta_correcta: cor,
        })
        if (est && est === cor) correctas++
      }
      const nota = calcularNotaChile(correctas, total, 0.6)
      const result = {
        puntaje: `${correctas}/${total}`,
        nota,
        alternativas_corregidas,
      }

      const res = await fetch("/api/evaluations/retry-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result,
          student_name: studentName.trim() || undefined,
          course_id: courseLabel.trim() || undefined,
          title: title.trim() || (trialType === "mixta" ? "OMR plantilla (solo alternativas)" : "OMR plantilla superpuesta"),
          subject: subject.trim() || "Evaluación",
        }),
      })
      const data = await res.json()
      if (data.saved && data.evaluation_id) {
        setStep("done")
        toast({ title: "Corrección lista para guardar.", description: "Evaluación guardada correctamente." })
        onSaved?.(data.evaluation_id)
      } else {
        setError(data.save_error || "Error al guardar.")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar.")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    stopCamera()
    setStep("trial_type")
    setTrialType(null)
    setTemplateDataUrl(null)
    setAnswerKey([])
    setCompareResult(null)
    setPendingCaptureDataUrl(null)
    setRevisedAnswers({})
    setAlignmentMessage("Alineando plantilla con la hoja...")
    setAlignmentScore(0)
    setAlignmentReady(false)
    setCaptureAlignmentReady(false)
    setPerspectiveCorrected(false)
    setError(null)
    onClose()
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>OMR con plantilla superpuesta</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {step === "trial_type" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              ¿Esta prueba es solo de alternativas?
            </p>
            <p className="text-sm text-muted-foreground">
              Si es mixta, el sistema solo capturará y corregirá la parte de alternativas y no calculará la nota final total de la prueba.
            </p>
            <div className="flex gap-4">
              <Button onClick={() => handleTrialType("solo")} className="flex-1">
                Sí, solo alternativas
              </Button>
              <Button variant="outline" onClick={() => handleTrialType("mixta")} className="flex-1">
                No, es mixta
              </Button>
            </div>
          </div>
        )}

        {step === "template" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Carga la plantilla corregida real (imagen de la pauta con respuestas marcadas).
            </p>
            <p className="text-sm text-muted-foreground">
              Se usará como referencia visual superpuesta en la cámara. La clave se extrae de la misma imagen.
            </p>
            <div className="grid gap-2">
              <Label>Total de preguntas</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={totalPreguntas}
                onChange={(e) => setTotalPreguntas(Math.max(1, Number(e.target.value) || 40))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Opciones (ej. A,B,C,D)</Label>
              <Input value={opciones} onChange={(e) => setOpciones(e.target.value)} placeholder="A,B,C,D" />
            </div>
            <div>
              <Label>Imagen de la plantilla resuelta</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={handleTemplateUpload}
                disabled={loading}
                className="mt-1"
              />
              {loading && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Extrayendo clave...
                </span>
              )}
            </div>
          </div>
        )}

        {step === "camera" && templateDataUrl && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Alinea la hoja con la plantilla.
            </p>
            <p className="text-sm text-muted-foreground">
              La plantilla está bien alineada cuando coincida con tu hoja. El sistema guía en tiempo real hasta que la alineación sea suficiente.
            </p>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ objectFit: "contain" }}
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="absolute border-2 border-white/80 rounded-lg shadow-lg flex items-center justify-center overflow-hidden"
                  style={{ aspectRatio: templateAspectRatio, maxWidth: "90%", maxHeight: "90%" }}
                >
                  <img
                    src={templateDataUrl}
                    alt="Plantilla"
                    className="w-full h-full object-contain opacity-40"
                  />
                </div>
                <div className="absolute bottom-2 left-0 right-0 flex flex-col items-center gap-1 px-2">
                  <div className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          alignmentReady
                            ? "rgb(34, 197, 94)"
                            : alignmentScore >= 0.4
                              ? "rgb(234, 179, 8)"
                              : "rgb(239, 68, 68)",
                      }}
                      aria-hidden
                    />
                    <span className="text-white text-xs font-medium">
                      {alignmentReady
                        ? "Lista para capturar"
                        : alignmentScore >= 0.4
                          ? "Ajusta un poco más"
                          : "Mala alineación"}
                    </span>
                  </div>
                  <span className="text-center text-white/90 text-xs bg-black/60 rounded px-2 py-1 max-w-[95%]">
                    {alignmentMessage}
                  </span>
                </div>
              </div>
            </div>
            {!alignmentReady && (
              <p className="text-sm text-amber-600 font-medium">
                La hoja aún no coincide con la plantilla. Corrige la posición para continuar.
              </p>
            )}
            {alignmentReady && (
              <p className="text-sm text-green-600 font-medium">
                Alineación suficiente. Puedes capturar.
              </p>
            )}
            <DialogFooter>
              <Button onClick={handleCapture} disabled={!alignmentReady}>
                <Camera className="h-4 w-4 mr-2" /> Capturar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && pendingCaptureDataUrl && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">¿Usar esta foto?</p>
            <p className="text-sm text-muted-foreground">Revisa que la hoja se vea nítida y alineada. Si no, repite la captura. Si se detectan las esquinas de la hoja, se aplicará corrección de perspectiva para mejorar la lectura.</p>
            {!captureAlignmentReady && (
              <div className="rounded-md border border-amber-500 bg-amber-500/15 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 font-medium">
                La captura no cumple el nivel mínimo de alineación. Intenta nuevamente.
              </div>
            )}
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              {showDebugBubbles ? (
                <canvas
                  ref={debugCanvasRef}
                  className="w-full h-full object-contain"
                  style={{ maxHeight: "70vh" }}
                />
              ) : (
                <img src={pendingCaptureDataUrl} alt="Vista previa" className="w-full h-full object-contain" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowDebugBubbles((v) => !v)}
              >
                {showDebugBubbles ? "Ocultar zonas de lectura" : "Ver zonas de lectura (debug)"}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleRepetirCaptura}>Repetir captura</Button>
              <Button onClick={handleConfirmCapture} disabled={loading}>
                {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Procesando...</> : "Usar esta foto"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "result" && compareResult && (
          <div className="space-y-4">
            {perspectiveCorrected && (
              <div className="rounded-md border border-green-500/50 bg-green-500/10 px-3 py-2 text-sm text-green-800 dark:text-green-200">
                La hoja fue corregida digitalmente para mejorar la lectura.
              </div>
            )}
            {trialType === "mixta" && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <strong>Prueba mixta.</strong> La nota mostrada es solo de la parte de alternativas; no es la nota final total de la prueba.
              </div>
            )}
            <p className="text-sm font-medium">
              Se detectaron {compareResult.correctas} respuestas correctas, {compareResult.incorrectas} incorrectas y{" "}
              {compareResult.requierenRevision?.length ?? 0} dudosas.
            </p>
            {compareResult.requierenRevision && compareResult.requierenRevision.length > 0 && (
              <p className="text-sm text-amber-600 font-medium">
                Hay {compareResult.requierenRevision.length} preguntas que requieren revisión manual.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div className="flex items-center gap-2 rounded-md bg-green-500/10 text-green-700 dark:text-green-400 px-3 py-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Correctas: {compareResult.correctas}
              </div>
              <div className="flex items-center gap-2 rounded-md bg-red-500/10 text-red-700 dark:text-red-400 px-3 py-2">
                <XCircle className="h-4 w-4 shrink-0" /> Incorrectas: {compareResult.incorrectas}
              </div>
              <div className="flex items-center gap-2 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" /> Dudosas: {compareResult.requierenRevision?.length ?? 0}
              </div>
              <div className="flex items-center gap-2 rounded-md bg-[var(--bg-muted)] px-3 py-2">
                {trialType === "mixta" ? "Nota (solo alternativas): " : "Nota: "}{compareResult.nota.toFixed(1)}
              </div>
            </div>
            <div className="rounded-md border overflow-hidden">
              <p className="text-xs font-medium text-muted-foreground px-3 py-2 bg-[var(--bg-muted)]">Detalle por pregunta</p>
              <div className="max-h-48 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Nº</TableHead>
                      <TableHead>Detectada</TableHead>
                      <TableHead>Correcta</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compareResult.resultados.map((r) => {
                      const esDudosa = compareResult.requierenRevision?.includes(r.pregunta)
                      return (
                        <TableRow key={r.pregunta} className={esDudosa ? "bg-amber-500/10" : undefined}>
                          <TableCell className="font-medium">{r.pregunta}</TableCell>
                          <TableCell>{r.respuestaEstudiante || "—"}</TableCell>
                          <TableCell>{r.respuestaCorrecta}</TableCell>
                          <TableCell>
                            {esDudosa ? <span className="text-amber-600 font-medium">Dudosa</span> : r.esCorrecta ? <span className="text-green-600">Correcta</span> : <span className="text-red-600">Incorrecta</span>}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Nombre del estudiante</Label>
              <Input value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Opcional" />
              <Label>Curso</Label>
              <Input value={courseLabel} onChange={(e) => setCourseLabel(e.target.value)} placeholder="Opcional" />
              <Label>Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={trialType === "mixta" ? "OMR plantilla (solo alternativas)" : "OMR plantilla superpuesta"} />
              <Label>Asignatura</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Evaluación" />
            </div>
            <div className="rounded-md border bg-[var(--bg-muted)] p-3">
              <p className="text-sm font-medium text-[var(--text-accent)]">Resumen final</p>
              <p className="text-xs text-muted-foreground">
                Correctas: {compareResult.correctas} · Incorrectas: {compareResult.incorrectas} · Dudosas: {compareResult.requierenRevision?.length ?? 0} · Puntaje: {compareResult.correctas}/{compareResult.totalPreguntas}
                {trialType === "mixta" && " (solo parte de alternativas)"}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleRetake}>Repetir captura</Button>
              {compareResult.requierenRevision && compareResult.requierenRevision.length > 0 ? (
                <Button onClick={handleGoToReview}>Revisar dudosas</Button>
              ) : (
                <Button onClick={handleSave} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Guardar corrección
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {step === "review" && compareResult && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">Revisión mínima: solo preguntas dudosas</p>
            <p className="text-sm text-muted-foreground">
              Confirma la respuesta detectada, cámbiala o déjala en blanco. Respuesta correcta como referencia.
            </p>
            <div className="max-h-56 overflow-y-auto space-y-3">
              {(compareResult.requierenRevision || []).map((num) => {
                const res = compareResult.resultados.find((r) => r.pregunta === num)
                const current = revisedAnswers[num] ?? res?.respuestaEstudiante ?? ""
                return (
                  <div key={num} className="rounded-lg border border-amber-200 bg-amber-500/5 p-3 space-y-2">
                    <div className="font-semibold">Pregunta {num}</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground">Respuesta correcta: </span><span className="font-medium text-green-700 dark:text-green-400">{res?.respuestaCorrecta || "—"}</span></div>
                      <div><span className="text-muted-foreground">Lo detectado: </span><span className="font-medium">{res?.respuestaEstudiante || "—"}</span></div>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {optionsList.map((opt) => (
                        <Button key={opt} variant={current === opt ? "default" : "outline"} size="sm" className="h-8 min-w-8" onClick={() => setRevised(num, opt)}>{opt}</Button>
                      ))}
                      <Button variant={current === "" ? "default" : "outline"} size="sm" className="h-8" onClick={() => setRevised(num, "")}>Sin respuesta</Button>
                    </div>
                  </div>
                )
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("result")}>Volver al resultado</Button>
              <Button onClick={handleSave} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Guardar corrección
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <p className="font-medium">Corrección lista para guardar.</p>
            <p className="text-sm text-muted-foreground">La evaluación se guardó y entra al flujo normal de LibelIA.</p>
            <DialogFooter className="flex justify-center">
              <Button onClick={handleClose}>Cerrar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
