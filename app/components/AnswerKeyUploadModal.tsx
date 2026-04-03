"use client"
/* eslint-disable @next/next/no-img-element -- Preview de plantilla desde URL/archivo local. */

import { useState, useCallback, useRef, useEffect } from "react"
import {
  X,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  Settings2,
  FileCheck,
  Camera,
  Sparkles,
  PenLine,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface AnswerKeyItem {
  pregunta: number
  respuestaCorrecta: string
  confianza: number
  metodo: "manual" | "auto"
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

type Step = "config" | "input" | "review"

export default function AnswerKeyUploadModal({
  isOpen,
  onClose,
  onConfirm,
  initialTotalPreguntas = 38,
  initialAlternativas = "A, B, C, D",
  initialColumnas = 2,
}: Props) {
  const [step, setStep] = useState<Step>("config")
  const [totalPreguntas, setTotalPreguntas] = useState(initialTotalPreguntas)
  const [alternativas, setAlternativas] = useState(initialAlternativas)
  const [columnas, setColumnas] = useState(initialColumnas)
  
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [respuestas, setRespuestas] = useState<AnswerKeyItem[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const alternativasArray = alternativas
    .split(",")
    .map((o) => o.trim().toUpperCase())
    .filter((o) => o.length > 0)

  // Inicializar respuestas vacias cuando se configura
  const initializeRespuestas = useCallback(() => {
    const nuevas: AnswerKeyItem[] = []
    for (let i = 1; i <= totalPreguntas; i++) {
      nuevas.push({
        pregunta: i,
        respuestaCorrecta: "",
        confianza: 1.0,
        metodo: "manual"
      })
    }
    setRespuestas(nuevas)
  }, [totalPreguntas])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      setImageUrl(dataUrl)
    }
    reader.readAsDataURL(file)
  }, [])

  // Intentar extraer con IA (opcional, si falla el profesor ingresa manual)
  const tryAutoExtract = useCallback(async () => {
    if (!imageUrl) return
    
    setLoading(true)
    setError(null)

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
        }),
      })

      const data = await res.json()

      if (data.success && Array.isArray(data.respuestas) && data.respuestas.length === totalPreguntas) {
        // Verificar que no hay duplicados ni errores
        const valid = data.respuestas.every((r: any, i: number) => r.pregunta === i + 1)
        if (valid) {
          setRespuestas(data.respuestas.map((r: any) => ({
            pregunta: r.pregunta,
            respuestaCorrecta: r.respuestaCorrecta || "",
            confianza: r.confianza || 0.5,
            metodo: "auto" as const
          })))
          if (data.templateId) setTemplateId(data.templateId)
        } else {
          // Si hay error, inicializar vacias
          initializeRespuestas()
        }
      } else {
        // Si falla, inicializar vacias para que el profesor ingrese manual
        initializeRespuestas()
      }
    } catch (e) {
      // Si hay error de red, inicializar vacias
      initializeRespuestas()
    } finally {
      setLoading(false)
    }
  }, [imageUrl, totalPreguntas, alternativasArray, columnas, initializeRespuestas])

  const handleRespuestaChange = useCallback((pregunta: number, newValue: string) => {
    const upperValue = newValue.toUpperCase()
    // Solo permitir valores validos
    if (upperValue && !alternativasArray.includes(upperValue) && upperValue !== "") {
      return
    }
    
    setRespuestas((prev) => {
      return prev.map((r) => {
        if (r.pregunta === pregunta) {
          return {
            ...r,
            respuestaCorrecta: upperValue,
            confianza: 1.0,
            metodo: "manual" as const,
          }
        }
        return r
      })
    })
  }, [alternativasArray])

  const handleConfirm = useCallback(() => {
    // Verificar que todas las preguntas tengan respuesta
    const sinRespuesta = respuestas.filter(r => !r.respuestaCorrecta || r.respuestaCorrecta === "")
    if (sinRespuesta.length > 0) {
      setError(`Faltan ${sinRespuesta.length} respuestas por completar: ${sinRespuesta.map(r => r.pregunta).join(", ")}`)
      return
    }

    onConfirm({
      respuestas,
      totalPreguntas,
      preguntasDudosas: [],
      imagenPlantilla: imageUrl || undefined,
      templateId: templateId || undefined
    })
  }, [respuestas, totalPreguntas, imageUrl, templateId, onConfirm])

  const goToInputStep = useCallback(() => {
    initializeRespuestas()
    setStep("input")
  }, [initializeRespuestas])

  const resetToConfig = useCallback(() => {
    setImageUrl(null)
    setRespuestas([])
    setTemplateId(null)
    setError(null)
    setStep("config")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [])

  // Dividir respuestas en columnas para visualizacion
  const preguntasPorColumna = Math.ceil(respuestas.length / columnas)
  const columnasRespuestas: AnswerKeyItem[][] = []
  for (let c = 0; c < columnas; c++) {
    columnasRespuestas.push(respuestas.slice(c * preguntasPorColumna, (c + 1) * preguntasPorColumna))
  }

  const respuestasCompletas = respuestas.filter(r => r.respuestaCorrecta && r.respuestaCorrecta !== "").length

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 md:p-4">
      <Card className="w-full max-w-5xl h-[90vh] flex flex-col bg-white">
        {/* Header */}
        <div className="flex justify-between items-center p-3 md:p-4 border-b shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FileCheck className="h-5 w-5 text-emerald-600" />
            <h2 className="text-base md:text-lg font-bold text-gray-900">
              Plantilla de Respuestas Correctas
            </h2>
            {step === "config" && (
              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                Paso 1: Configurar
              </span>
            )}
            {step === "input" && (
              <span className="text-xs bg-blue-100 px-2 py-0.5 rounded text-blue-600">
                Paso 2: Ingresar respuestas
              </span>
            )}
            {step === "review" && (
              <span className="text-xs bg-emerald-100 px-2 py-0.5 rounded text-emerald-600">
                Paso 3: Confirmar
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col p-3 md:p-4 overflow-hidden">
          
          {/* STEP 1: CONFIG */}
          {step === "config" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md mx-auto">
              <div className="text-center">
                <Sparkles className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Configura tu plantilla
                </h3>
                <p className="text-sm text-gray-600">
                  Define cuantas preguntas de seleccion multiple tiene tu prueba.
                  Las preguntas de desarrollo se evaluan aparte.
                </p>
              </div>

              <div className="w-full space-y-4">
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">
                    Preguntas de Seleccion Multiple
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={totalPreguntas}
                    onChange={(e) => setTotalPreguntas(Math.max(1, Number(e.target.value) || 38))}
                    className="h-10"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Solo preguntas cerradas (alternativas)
                  </p>
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
                        {col} col{col > 1 ? "s" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-11"
                onClick={goToInputStep}
              >
                Continuar
              </Button>
            </div>
          )}

          {/* STEP 2: INPUT */}
          {step === "input" && (
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              <div className="flex items-center justify-between shrink-0">
                <Button variant="ghost" size="sm" onClick={resetToConfig} className="gap-1">
                  <Settings2 className="h-4 w-4" /> Cambiar configuracion
                </Button>
                <div className="text-sm text-gray-600">
                  {respuestasCompletas}/{totalPreguntas} completadas
                </div>
              </div>

              <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
                {/* Left: Image upload (opcional) */}
                <div className="w-full md:w-1/3 flex flex-col gap-3 shrink-0">
                  <p className="text-sm font-semibold text-gray-700">
                    Imagen de referencia (opcional)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  
                  {!imageUrl ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="h-40 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 transition-all p-4"
                    >
                      <Camera className="h-8 w-8 text-gray-400" />
                      <p className="text-xs text-gray-500 text-center">
                        Sube foto de tu plantilla<br/>con respuestas marcadas
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 mt-1 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          fileInputRef.current?.click()
                        }}
                      >
                        <Upload className="h-3 w-3" /> Subir imagen
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <img
                        src={imageUrl}
                        alt="Plantilla"
                        className="w-full h-40 object-cover rounded border"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setImageUrl(null)
                          if (fileInputRef.current) fileInputRef.current.value = ""
                        }}
                        className="absolute top-1 right-1 h-6 px-2 text-xs bg-white"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={tryAutoExtract}
                        disabled={loading}
                        className="mt-2 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs"
                      >
                        {loading ? (
                          <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Extrayendo...</>
                        ) : (
                          <><Sparkles className="h-3 w-3 mr-1" /> Intentar extraer automaticamente</>
                        )}
                      </Button>
                    </div>
                  )}

                  <div className="p-3 bg-amber-50 rounded border border-amber-200">
                    <p className="text-xs text-amber-800">
                      <strong>Importante:</strong> Verifica cada respuesta manualmente.
                      Haz clic en cada casilla para seleccionar la alternativa correcta.
                    </p>
                  </div>
                </div>

                {/* Right: Respuestas grid */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <p className="text-sm font-semibold text-gray-700 mb-2 shrink-0">
                    <PenLine className="h-4 w-4 inline mr-1" />
                    Ingresa las respuestas correctas
                  </p>
                  
                  <div className="flex-1 overflow-y-auto">
                    <div className={cn("grid gap-4", columnas === 1 ? "grid-cols-1" : columnas === 2 ? "grid-cols-2" : "grid-cols-3")}>
                      {columnasRespuestas.map((colRespuestas, colIndex) => (
                        <div key={colIndex} className="space-y-1">
                          {colRespuestas.map((item) => (
                            <div
                              key={item.pregunta}
                              className={cn(
                                "flex items-center gap-2 p-1 rounded",
                                !item.respuestaCorrecta && "bg-red-50"
                              )}
                            >
                              <span className="w-8 text-xs font-mono text-gray-600 text-right">
                                {item.pregunta}.
                              </span>
                              <div className="flex gap-1">
                                {alternativasArray.map((alt) => (
                                  <button
                                    key={alt}
                                    onClick={() => handleRespuestaChange(item.pregunta, alt)}
                                    className={cn(
                                      "w-7 h-7 text-xs font-bold rounded border transition-all",
                                      item.respuestaCorrecta === alt
                                        ? "bg-emerald-600 text-white border-emerald-600"
                                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                                    )}
                                  >
                                    {alt}
                                  </button>
                                ))}
                              </div>
                              {item.respuestaCorrecta && (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="shrink-0 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="shrink-0 flex gap-3">
                <Button variant="outline" onClick={resetToConfig}>
                  Volver
                </Button>
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleConfirm}
                  disabled={respuestasCompletas < totalPreguntas}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Confirmar {respuestasCompletas}/{totalPreguntas} respuestas
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
