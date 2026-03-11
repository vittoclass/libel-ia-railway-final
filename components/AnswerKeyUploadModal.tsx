// components/AnswerKeyUploadModal.tsx
"use client"
import { useState, useCallback, useRef } from "react"
import {
  X,
  RotateCcw,
  AlertCircle,
  Eye,
  CheckCircle2,
  Loader2,
  Upload,
  Settings2,
  FileCheck,
  Camera,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface AnswerKeyItem {
  pregunta: number
  respuestaCorrecta: string
  confianza: number
  metodo: "mistral" | "manual"
}

export interface AnswerKeyResult {
  respuestas: AnswerKeyItem[]
  totalPreguntas: number
  preguntasDudosas: number[]
  imagenPlantilla?: string
  templateId?: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onConfirm: (data: AnswerKeyResult) => void
  initialTotalPreguntas?: number
  initialAlternativas?: string
  initialColumnas?: number
}

type Step = "config" | "upload" | "review"

export default function AnswerKeyUploadModal({
  isOpen,
  onClose,
  onConfirm,
  initialTotalPreguntas = 40,
  initialAlternativas = "A, B, C, D",
  initialColumnas = 2,
}: Props) {
  const [step, setStep] = useState<Step>("config")
  const [totalPreguntas, setTotalPreguntas] = useState(initialTotalPreguntas)
  const [alternativas, setAlternativas] = useState(initialAlternativas)
  const [columnas, setColumnas] = useState(initialColumnas)
  const [tipoMarca, setTipoMarca] = useState<"X" | "burbuja">("X")
  
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [respuestas, setRespuestas] = useState<AnswerKeyItem[]>([])
  const [preguntasDudosas, setPreguntasDudosas] = useState<number[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const alternativasArray = alternativas
    .split(",")
    .map((o) => o.trim().toUpperCase())
    .filter((o) => o.length > 0)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      setImageUrl(dataUrl)
      setStep("upload")
    }
    reader.readAsDataURL(file)
  }, [])

  const processImage = useCallback(async () => {
    if (!imageUrl) {
      setError("No se ha proporcionado una imagen.")
      return
    }

    setLoading(true)
    setError(null)
    setRespuestas([])
    setWarnings([])
    setPreguntasDudosas([])

    try {
      const res = await fetch("/api/omr/answer-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl: imageUrl,
          mimeType: "image/jpeg",
          totalPreguntas,
          alternativas: alternativasArray,
          columnas,
          tipoMarca,
          usarMistralParaDudosas: true,
        }),
      })

      const data = await res.json()

      if (data.success && Array.isArray(data.respuestas)) {
        setRespuestas(data.respuestas)
        setPreguntasDudosas(data.preguntasDudosas || [])
        setWarnings(data.warnings || [])
        if (data.templateId) setTemplateId(data.templateId)
        setStep("review")
      } else {
        setError(data.error || "Error procesando la plantilla del profesor.")
      }
    } catch (e) {
      setError("Error de red o servidor al procesar la plantilla.")
    } finally {
      setLoading(false)
    }
  }, [imageUrl, totalPreguntas, alternativasArray, columnas, tipoMarca])

  const handleRespuestaChange = (pregunta: number, newValue: string) => {
    setRespuestas((prev) => {
      return prev.map((r) => {
        if (r.pregunta === pregunta) {
          return {
            ...r,
            respuestaCorrecta: newValue.toUpperCase(),
            confianza: 1.0,
            metodo: "manual" as const,
          }
        }
        return r
      })
    })
    // Quitar de dudosas si se edito manualmente
    setPreguntasDudosas((prev) => prev.filter((p) => p !== pregunta))
  }

  const handleConfirm = () => {
    onConfirm({
      respuestas,
      totalPreguntas,
      preguntasDudosas: respuestas.filter((r) => r.confianza < 0.85).map((r) => r.pregunta),
      imagenPlantilla: imageUrl || undefined,
      templateId: templateId || undefined,
    })
  }

  // Funcion para saltar OMR y llenar manualmente
  const skipOMRAndFillManually = () => {
    const respuestasManuales: AnswerKeyItem[] = []
    for (let i = 1; i <= totalPreguntas; i++) {
      respuestasManuales.push({
        pregunta: i,
        respuestaCorrecta: "A", // Valor por defecto, el usuario lo editara
        confianza: 1.0,
        metodo: "manual",
      })
    }
    setRespuestas(respuestasManuales)
    setStep("review")
  }

  const resetToUpload = () => {
    setImageUrl(null)
    setRespuestas([])
    setPreguntasDudosas([])
    setTemplateId(null)
    setError(null)
    setWarnings([])
    setStep("upload")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const goBackToConfig = () => {
    setStep("config")
  }

  // Dividir respuestas en columnas para visualizacion
  const midPoint = Math.ceil(respuestas.length / 2)
  const col1 = respuestas.slice(0, midPoint)
  const col2 = respuestas.slice(midPoint)

  const lowConfidenceItems = respuestas.filter(
    (r) => r.confianza < 0.85 || r.respuestaCorrecta === "SIN_RESPUESTA"
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2 md:p-4">
      <Card className="w-full max-w-5xl h-[90vh] flex flex-col bg-white">
        {/* Input de archivo siempre en el DOM para poder abrirlo desde cualquier paso */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden
        />
        {/* Header */}
        <div className="flex justify-between items-center p-3 md:p-4 border-b shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FileCheck className="h-5 w-5 text-emerald-600" />
            <h2 className="text-base md:text-lg font-bold text-gray-900">
              Plantilla de Respuestas del Profesor
            </h2>
            {step === "config" && (
              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                Paso 1: Configurar
              </span>
            )}
            {step === "upload" && (
              <span className="text-xs bg-blue-100 px-2 py-0.5 rounded text-blue-600">
                Paso 2: Subir foto
              </span>
            )}
            {step === "review" && (
              <span className="text-xs bg-emerald-100 px-2 py-0.5 rounded text-emerald-600">
                Paso 3: Revisar y confirmar
              </span>
            )}
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col p-3 md:p-4 min-h-0 overflow-auto">
          
          {/* STEP 1: CONFIG */}
          {step === "config" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md mx-auto">
              <div className="text-center">
                <Sparkles className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Configura tu plantilla
                </h3>
                <p className="text-sm text-gray-600">
                  Define cuantas preguntas tiene tu prueba y las alternativas disponibles.
                  Luego subiras una foto de tu plantilla con las respuestas correctas marcadas.
                </p>
              </div>

              <div className="w-full space-y-4">
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">
                    Total de Preguntas
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={totalPreguntas}
                    onChange={(e) => setTotalPreguntas(Math.max(1, Number(e.target.value) || 40))}
                    className="h-10"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">
                    Alternativas (separadas por coma)
                  </label>
                  <Input
                    value={alternativas}
                    onChange={(e) => setAlternativas(e.target.value)}
                    placeholder="A, B, C, D"
                    className="h-10"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Ejemplo: A, B, C, D o A, B, C, D, E
                  </p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">
                    Columnas en la plantilla
                  </label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((col) => (
                      <button
                        key={col}
                        onClick={() => setColumnas(col)}
                        className={cn(
                          "flex-1 py-2 rounded border text-sm font-medium transition-all",
                          columnas === col
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        )}
                      >
                        {col} columna{col > 1 ? "s" : ""}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">
                    Tipo de marca en la plantilla
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Cómo está marcada la respuesta correcta: con X o rellenando la burbuja.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTipoMarca("X")}
                      className={cn(
                        "flex-1 py-2 rounded border text-sm font-medium transition-all",
                        tipoMarca === "X"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      X (cruce / tachado)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTipoMarca("burbuja")}
                      className={cn(
                        "flex-1 py-2 rounded border text-sm font-medium transition-all",
                        tipoMarca === "burbuja"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      Burbuja rellenada
                    </button>
                  </div>
                </div>
              </div>

              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-11"
                onClick={() => setStep("upload")}
              >
                Continuar
              </Button>
              {/* Botón de subir imagen visible ya en el Paso 1 */}
              <div className="w-full pt-4 border-t border-gray-200">
                <p className="text-sm text-gray-600 mb-3 text-center">
                  ¿Ya tienes la foto? Puedes subirla ahora:
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12 border-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50 gap-2 text-base font-semibold"
                  onClick={() => {
                    setStep("upload")
                    setTimeout(() => fileInputRef.current?.click(), 150)
                  }}
                >
                  <Upload className="h-5 w-5" />
                  Subir imagen de la plantilla
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: UPLOAD */}
          {step === "upload" && (
            <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-auto">
              {/* Botón de subir siempre visible en la parte superior */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                <Button variant="ghost" size="sm" onClick={goBackToConfig} className="gap-1 self-start">
                  <Settings2 className="h-4 w-4" /> Cambiar configuracion
                </Button>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <span className="text-sm text-gray-600 shrink-0">
                    {totalPreguntas} preguntas | {alternativas} | {columnas} col.
                  </span>
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    size="lg"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shrink-0 w-full sm:w-auto"
                  >
                    <Upload className="h-4 w-4" />
                    Subir imagen de la plantilla
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex flex-col md:flex-row gap-4 min-h-0 overflow-auto">
                {/* Upload area */}
                <div className="w-full md:w-1/2 flex flex-col gap-3 shrink-0">
                  {!imageUrl ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[200px] border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/50 transition-all p-6"
                    >
                      <Camera className="h-16 w-16 text-gray-400" />
                      <div className="text-center space-y-1">
                        <p className="text-base font-semibold text-gray-800">
                          Foto de la plantilla con respuestas correctas
                        </p>
                        <p className="text-sm text-gray-500">
                          Haz clic aquí o usa el botón verde de arriba
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="lg"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          fileInputRef.current?.click()
                        }}
                      >
                        <Upload className="h-4 w-4" /> Subir imagen de la plantilla
                      </Button>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col gap-3 overflow-hidden">
                      <div className="flex-1 relative overflow-auto rounded border bg-gray-50">
                        <img
                          src={imageUrl}
                          alt="Plantilla del profesor"
                          className="w-full h-auto object-contain"
                        />
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="gap-1"
                        >
                          <Upload className="h-3 w-3" /> Subir otra foto
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={resetToUpload}
                          className="gap-1"
                        >
                          <RotateCcw className="h-3 w-3" /> Cambiar imagen
                        </Button>
                        <Button
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={processImage}
                          disabled={loading}
                        >
                          {loading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...
                            </>
                          ) : (
                            <>
                              <Eye className="mr-2 h-4 w-4" /> Detectar respuestas
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Instructions */}
                <div className="w-full md:w-1/2 flex flex-col gap-3 p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-semibold text-gray-900">Instrucciones</h4>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>Usa la <strong>misma plantilla</strong> que usan tus estudiantes</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>Marca las respuestas <strong>correctas</strong> con una X clara o rellena el circulo</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>Asegurate de que la foto tenga <strong>buena iluminacion</strong></span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>La plantilla debe estar <strong>bien encuadrada</strong> y sin arrugas</span>
                    </li>
                  </ul>

                  <div className="mt-4 p-3 bg-amber-50 rounded border border-amber-200">
                    <p className="text-sm text-amber-800 mb-2">
                      Si no quieres usar OMR, puedes llenar las respuestas manualmente:
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={skipOMRAndFillManually}
                      className="w-full border-amber-400 text-amber-700 hover:bg-amber-100"
                    >
                      Llenar respuestas manualmente
                    </Button>
                  </div>

                  {loading && (
                    <div className="mt-4 p-4 bg-white rounded border flex flex-col items-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                      <p className="text-sm text-gray-600 text-center">
                        Analizando plantilla del profesor...
                        <br />
                        <span className="text-xs text-gray-400">
                          El sistema detecta las marcas (X o burbuja) según el tipo elegido
                        </span>
                      </p>
                    </div>
                  )}

                  {error && (
                    <div className="mt-4 p-4 bg-red-50 rounded border border-red-200 text-red-700 text-sm flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW */}
          {step === "review" && (
            <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
              {/* Left: Image */}
              <div className="w-full md:w-2/5 flex flex-col gap-3 overflow-hidden">
                <div className="flex-1 relative overflow-auto rounded border bg-gray-50">
                  {imageUrl && (
                    <img
                      src={imageUrl}
                      alt="Plantilla del profesor"
                      className="w-full h-auto object-contain"
                    />
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetToUpload}
                  className="gap-1"
                >
                  <RotateCcw className="h-3 w-3" /> Re-escanear con otra imagen
                </Button>
              </div>

              {/* Right: Results */}
              <div className="w-full md:w-3/5 flex flex-col gap-3 overflow-hidden">
                {/* Summary */}
                <div className="shrink-0 flex items-center gap-3 flex-wrap">
                  {lowConfidenceItems.length === 0 ? (
                    <span className="flex items-center gap-1 text-emerald-600 text-sm bg-emerald-50 px-2 py-1 rounded">
                      <CheckCircle2 className="h-4 w-4" />
                      Todas las respuestas detectadas con alta confianza
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 text-sm bg-amber-50 px-2 py-1 rounded">
                      <AlertCircle className="h-4 w-4" />
                      {lowConfidenceItems.length} pregunta{lowConfidenceItems.length > 1 ? "s" : ""} requiere{lowConfidenceItems.length > 1 ? "n" : ""} revision
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    {respuestas.length} respuestas | Metodos: sharp + Mistral backup
                  </span>
                </div>

                {/* Warnings */}
                {warnings.length > 0 && (
                  <div className="shrink-0 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                    {warnings.map((w, i) => (
                      <p key={i} className="flex items-start gap-1">
                        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {w}
                      </p>
                    ))}
                  </div>
                )}

                {/* Instructions */}
                <div className="shrink-0 text-xs text-gray-500 px-1">
                  Haz clic en cualquier alternativa para editarla. Las preguntas en rojo necesitan revision.
                </div>

                {/* Results grid */}
                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0">
                    {/* Column 1 */}
                    <div>
                      <div className="grid grid-cols-[40px_1fr_20px] gap-1 px-1 py-1 bg-gray-100 rounded-t text-xs font-semibold text-gray-600">
                        <span>#</span>
                        <span>Respuesta Correcta</span>
                        <span></span>
                      </div>
                      {col1.map((item) => {
                        const needsReview =
                          item.confianza < 0.85 || item.respuestaCorrecta === "SIN_RESPUESTA"
                        return (
                          <div
                            key={item.pregunta}
                            className={cn(
                              "grid grid-cols-[40px_1fr_20px] gap-1 px-1 py-0.5 items-center text-sm border-b",
                              needsReview && "bg-red-50 border-l-2 border-l-red-500"
                            )}
                          >
                            <span className="font-mono text-xs text-gray-500">{item.pregunta}</span>
                            <div className="flex gap-1">
                              {alternativasArray.map((opt) => (
                                <button
                                  key={opt}
                                  onClick={() => handleRespuestaChange(item.pregunta, opt)}
                                  className={cn(
                                    "w-7 h-7 rounded text-xs font-bold transition-all",
                                    item.respuestaCorrecta === opt
                                      ? "bg-emerald-600 text-white shadow-sm"
                                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                  )}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                            <span>
                              {needsReview ? (
                                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {/* Column 2 */}
                    <div>
                      <div className="grid grid-cols-[40px_1fr_20px] gap-1 px-1 py-1 bg-gray-100 rounded-t text-xs font-semibold text-gray-600">
                        <span>#</span>
                        <span>Respuesta Correcta</span>
                        <span></span>
                      </div>
                      {col2.map((item) => {
                        const needsReview =
                          item.confianza < 0.85 || item.respuestaCorrecta === "SIN_RESPUESTA"
                        return (
                          <div
                            key={item.pregunta}
                            className={cn(
                              "grid grid-cols-[40px_1fr_20px] gap-1 px-1 py-0.5 items-center text-sm border-b",
                              needsReview && "bg-red-50 border-l-2 border-l-red-500"
                            )}
                          >
                            <span className="font-mono text-xs text-gray-500">{item.pregunta}</span>
                            <div className="flex gap-1">
                              {alternativasArray.map((opt) => (
                                <button
                                  key={opt}
                                  onClick={() => handleRespuestaChange(item.pregunta, opt)}
                                  className={cn(
                                    "w-7 h-7 rounded text-xs font-bold transition-all",
                                    item.respuestaCorrecta === opt
                                      ? "bg-emerald-600 text-white shadow-sm"
                                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                  )}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                            <span>
                              {needsReview ? (
                                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Confirm button */}
                <div className="shrink-0 flex gap-2 pt-2 border-t">
                  <Button
                    size="sm"
                    onClick={handleConfirm}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1 h-10"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Confirmar Pauta ({respuestas.length} respuestas correctas)
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
