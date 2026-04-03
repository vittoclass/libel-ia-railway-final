"use client"
/* eslint-disable @next/next/no-img-element -- Capturas en vivo / data URL en modal OMR. */

/**
 * Flujo nuevo: OMR en tiempo real con cámara.
 * Usa solo APIs existentes: /api/omr/answer-key, /api/omr/closed-answer, /api/omr/compare, /api/evaluations/retry-save.
 * No modifica ningún endpoint ni persist-evaluation.
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
import { Loader2, Camera, CheckCircle2, XCircle, AlertCircle, Upload, Save } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

type Step = "key" | "camera" | "preview" | "result" | "review" | "done"

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

export function RealtimeOMRModal({ open, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [step, setStep] = useState<Step>("key")
  const [totalPreguntas, setTotalPreguntas] = useState(40)
  const [opciones, setOpciones] = useState("A,B,C,D")
  const [answerKey, setAnswerKey] = useState<AnswerKeyItem[]>([])
  const [keySource, setKeySource] = useState<"manual" | "upload">("manual")
  const [manualKeys, setManualKeys] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null)
  const [pendingCaptureDataUrl, setPendingCaptureDataUrl] = useState<string | null>(null)
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [revisedAnswers, setRevisedAnswers] = useState<Record<number, string>>({})

  const [studentName, setStudentName] = useState("")
  const [courseLabel, setCourseLabel] = useState("")
  const [title, setTitle] = useState("")
  const [subject, setSubject] = useState("")

  const optionsList = opciones.split(",").map((o) => o.trim().toUpperCase()).filter(Boolean)

  const buildAnswerKeyFromManual = useCallback(() => {
    const key: AnswerKeyItem[] = []
    for (let i = 1; i <= totalPreguntas; i++) {
      const v = (manualKeys[i] || "").trim().toUpperCase()
      key.push({ pregunta: i, respuestaCorrecta: optionsList.includes(v) ? v : "" })
    }
    return key
  }, [totalPreguntas, manualKeys, optionsList])

  const handleConfirmKey = () => {
    if (keySource === "manual") {
      const key = buildAnswerKeyFromManual()
      if (key.every((k) => k.respuestaCorrecta)) {
        setAnswerKey(key)
        setStep("camera")
        setError(null)
        toast({ title: "Clave correcta cargada." })
      } else {
        setError("Completa la letra correcta para todas las preguntas.")
      }
    } else {
      setError("Sube una imagen de la plantilla resuelta para extraer la clave.")
    }
  }

  const handleUploadKeyImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const dataUrl = reader.result as string
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
          toast({ title: "Clave correcta cargada." })
        } else {
          setError(data.error || "No se pudo extraer la clave.")
        }
      }
      reader.readAsDataURL(file)
    } catch (e) {
      setError("Error al procesar la imagen.")
    } finally {
      setLoading(false)
    }
  }

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("La cámara no está disponible en este navegador.")
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
    } catch (err) {
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
    if (open && step === "camera") {
      startCamera()
    }
    return () => {
      if (step !== "camera") stopCamera()
    }
  }, [open, step, startCamera, stopCamera])

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current || answerKey.length === 0) return
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
    try {
      const closedRes = await fetch("/api/omr/closed-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl,
          mimeType: "image/jpeg",
          totalPreguntas: answerKey.length,
          opciones: optionsList.join(","),
          columnas: 2,
        }),
      })
      const closedData = await closedRes.json()
      if (!closedData.success || !Array.isArray(closedData.respuestas)) {
        setError(closedData.error || "No se pudieron leer las respuestas de la hoja. La imagen no es suficientemente clara. Intenta nuevamente.")
        setLoading(false)
        return
      }

      const studentAnswers = closedData.respuestas.map((r: { pregunta: string | number; respuesta: string; confianza?: number }) => ({
        pregunta: Number(r.pregunta),
        respuesta: r.respuesta || "SIN_RESPUESTA",
        confianza: r.confianza ?? 0.5,
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
      setCapturedDataUrl(dataUrl)
      setPendingCaptureDataUrl(null)
      setStep("result")
      const dudosas = compareData.requierenRevision?.length ?? 0
      toast({
        title: `Se detectaron ${compareData.correctas} respuestas correctas, ${compareData.incorrectas} incorrectas y ${dudosas} dudosas.`,
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
    setStep("camera")
    startCamera()
  }

  const handleRetake = () => {
    setCapturedDataUrl(null)
    setPendingCaptureDataUrl(null)
    setCompareResult(null)
    setRevisedAnswers({})
    setStep("camera")
    startCamera()
  }

  const handleGoToReview = () => {
    setStep("review")
  }

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
          title: title.trim() || "OMR en tiempo real",
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
    setStep("key")
    setAnswerKey([])
    setCompareResult(null)
    setCapturedDataUrl(null)
    setPendingCaptureDataUrl(null)
    setRevisedAnswers({})
    setError(null)
    onClose()
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>OMR en tiempo real — Corrección con cámara</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* STEP: key */}
        {step === "key" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Carga una clave correcta antes de iniciar la cámara.
            </p>
            <p className="text-sm text-muted-foreground">
              Luego podrás capturar la hoja del estudiante y contrastarla con esta clave.
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
              <Input
                value={opciones}
                onChange={(e) => setOpciones(e.target.value)}
                placeholder="A,B,C,D"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--text-accent)]">¿Cómo cargar la clave?</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant={keySource === "manual" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 justify-start border-green-200 data-[state=active]:bg-green-600 data-[state=active]:text-white"
                  onClick={() => setKeySource("manual")}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Clave manual (recomendado)
                </Button>
                <Button
                  variant={keySource === "upload" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 justify-start"
                  onClick={() => setKeySource("upload")}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Subir plantilla resuelta
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {keySource === "manual"
                  ? "Más confiable: ingresas la letra correcta de cada pregunta."
                  : "Alternativa: sube una foto de la pauta con las respuestas marcadas."}
              </p>
            </div>
            {keySource === "manual" && (
              <div className="max-h-48 overflow-y-auto rounded border p-2">
                <p className="text-xs text-muted-foreground mb-2">Letra correcta por pregunta (1 a {totalPreguntas})</p>
                <div className="grid grid-cols-5 sm:grid-cols-10 gap-1">
                  {Array.from({ length: totalPreguntas }, (_, i) => i + 1).map((n) => (
                    <div key={n} className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">{n}</span>
                      <Input
                        className="h-8 w-full text-center"
                        maxLength={1}
                        value={manualKeys[n] ?? ""}
                        onChange={(e) => setManualKeys((prev) => ({ ...prev, [n]: e.target.value.toUpperCase() }))}
                        placeholder="?"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {keySource === "upload" && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">Sube una foto de la pauta con las respuestas correctas marcadas (burbujas o X).</p>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadKeyImage}
                  disabled={loading}
                />
                {loading && (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Extrayendo clave...
                  </span>
                )}
              </div>
            )}
            {keySource === "manual" && (
              <DialogFooter>
                <Button onClick={handleConfirmKey}>Clave correcta cargada</Button>
              </DialogFooter>
            )}
          </div>
        )}

        {/* STEP: camera */}
        {step === "camera" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Alinea la hoja dentro del recuadro.
            </p>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              <canvas ref={canvasRef} className="hidden" />
              {/* Overlay: marco y mensaje */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="absolute inset-[8%] border-2 border-white/90 rounded-lg shadow-lg flex items-center justify-center">
                  <div className="absolute -top-8 left-0 right-0 text-center">
                    <span className="bg-black/70 text-white text-sm font-medium px-3 py-1 rounded">
                      Alinea la hoja dentro del recuadro
                    </span>
                  </div>
                  <div className="absolute top-1 left-1 w-6 h-6 border-l-2 border-t-2 border-white/90 rounded-tl" />
                  <div className="absolute top-1 right-1 w-6 h-6 border-r-2 border-t-2 border-white/90 rounded-tr" />
                  <div className="absolute bottom-1 left-1 w-6 h-6 border-l-2 border-b-2 border-white/90 rounded-bl" />
                  <div className="absolute bottom-1 right-1 w-6 h-6 border-r-2 border-b-2 border-white/90 rounded-br" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCapture} disabled={loading}>
                <Camera className="h-4 w-4 mr-2" /> Capturar
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* STEP: preview — confirmar foto antes de procesar */}
        {step === "preview" && pendingCaptureDataUrl && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              ¿Usar esta foto?
            </p>
            <p className="text-sm text-muted-foreground">
              Revisa que la hoja se vea nítida y completa. Si no, repite la captura.
            </p>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <img src={pendingCaptureDataUrl} alt="Vista previa" className="w-full h-full object-contain" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleRepetirCaptura}>
                Repetir captura
              </Button>
              <Button onClick={handleConfirmCapture} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Procesando...
                  </>
                ) : (
                  "Usar esta foto"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* STEP: result */}
        {step === "result" && compareResult && (
          <div className="space-y-4">
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
                Nota: {compareResult.nota.toFixed(1)}
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
                        <TableRow
                          key={r.pregunta}
                          className={esDudosa ? "bg-amber-500/10" : undefined}
                        >
                          <TableCell className="font-medium">{r.pregunta}</TableCell>
                          <TableCell>{r.respuestaEstudiante || "—"}</TableCell>
                          <TableCell>{r.respuestaCorrecta}</TableCell>
                          <TableCell>
                            {esDudosa ? (
                              <span className="text-amber-600 font-medium">Dudosa</span>
                            ) : r.esCorrecta ? (
                              <span className="text-green-600">Correcta</span>
                            ) : (
                              <span className="text-red-600">Incorrecta</span>
                            )}
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
              <Label>Título evaluación</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="OMR en tiempo real" />
              <Label>Asignatura</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Evaluación" />
            </div>
            <div className="rounded-md border bg-[var(--bg-muted)] p-3 space-y-1">
              <p className="text-sm font-medium text-[var(--text-accent)]">Resumen final</p>
              <p className="text-xs text-muted-foreground">
                Correctas: {compareResult.correctas} · Incorrectas: {compareResult.incorrectas} · Dudosas: {compareResult.requierenRevision?.length ?? 0} · Puntaje estimado: {compareResult.correctas}/{compareResult.totalPreguntas} (nota {compareResult.nota.toFixed(1)})
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

        {/* STEP: review */}
        {step === "review" && compareResult && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Revisión mínima: solo preguntas dudosas
            </p>
            <p className="text-sm text-muted-foreground">
              Confirma la respuesta detectada, cámbiala si es incorrecta o déjala en blanco. La respuesta correcta se muestra como referencia.
            </p>
            <div className="max-h-56 overflow-y-auto space-y-3">
              {(compareResult.requierenRevision || []).map((num) => {
                const res = compareResult.resultados.find((r) => r.pregunta === num)
                const current = revisedAnswers[num] ?? res?.respuestaEstudiante ?? ""
                return (
                  <div key={num} className="rounded-lg border border-amber-200 bg-amber-500/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Pregunta {num}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Respuesta correcta: </span>
                        <span className="font-medium text-green-700 dark:text-green-400">{res?.respuestaCorrecta || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Lo detectado: </span>
                        <span className="font-medium">{res?.respuestaEstudiante || "—"}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {optionsList.map((opt) => (
                        <Button
                          key={opt}
                          variant={current === opt ? "default" : "outline"}
                          size="sm"
                          className="h-8 min-w-8"
                          onClick={() => setRevised(num, opt)}
                        >
                          {opt}
                        </Button>
                      ))}
                      <Button
                        variant={current === "" ? "default" : "outline"}
                        size="sm"
                        className="h-8"
                        onClick={() => setRevised(num, "")}
                      >
                        Sin respuesta
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="rounded-md border bg-[var(--bg-muted)] p-3 space-y-1">
              <p className="text-sm font-medium text-[var(--text-accent)]">Resumen final</p>
              <p className="text-xs text-muted-foreground">
                Tras tu revisión se guardará el puntaje resultante. Puedes volver atrás para repetir la captura si algo no cuadra.
              </p>
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

        {/* STEP: done */}
        {step === "done" && (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <p className="font-medium">Corrección lista para guardar.</p>
            <p className="text-sm text-muted-foreground">La evaluación se guardó correctamente y ya está en tu listado; entra al análisis pedagógico como el resto de evaluaciones.</p>
            <DialogFooter className="flex justify-center sm:justify-center">
              <Button onClick={handleClose}>Cerrar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
