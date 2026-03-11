// components/ClosedAnswerOMRModal.tsx
"use client"
import { useState, useEffect, useCallback } from "react"
import {
  X,
  RotateCcw,
  AlertCircle,
  Eye,
  CheckCircle2,
  Loader2,
  Upload,
  Settings2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface ClosedAnswerItem {
  pregunta: string
  respuesta: string
  confianza: number
}

export interface ClosedAnswerOMRResult {
  respuestas: ClosedAnswerItem[]
  alumnoDetectado?: string
  cursoDetectado?: string
  totalPreguntas: number
}

interface Props {
  imageUrl: string // dataUrl de la imagen
  onClose: () => void
  onConfirm: (data: ClosedAnswerOMRResult) => void
  onRescan: () => void
  totalPreguntas?: number
  opciones?: string
  columnas?: number
}

export default function ClosedAnswerOMRModal({
  imageUrl,
  onClose,
  onConfirm,
  onRescan,
  totalPreguntas: initialTotal = 40,
  opciones: initialOpciones = "A, B, C, D",
  columnas: initialColumnas = 2,
}: Props) {
  const [respuestas, setRespuestas] = useState<ClosedAnswerItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [alumnoDetectado, setAlumnoDetectado] = useState<string>("")
  const [cursoDetectado, setCursoDetectado] = useState<string>("")
  const [totalPreguntas, setTotalPreguntas] = useState(initialTotal)
  const [opciones, setOpciones] = useState(initialOpciones)
  const [columnas, setColumnas] = useState(initialColumnas)
  const [showSettings, setShowSettings] = useState(false)
  const [hasExtracted, setHasExtracted] = useState(false)

  const opcionesValidas = opciones
    .split(",")
    .map((o) => o.trim().toUpperCase())
    .filter((o) => o.length > 0)

  const extract = useCallback(async () => {
    if (!imageUrl) {
      setError("No se ha proporcionado una imagen valida.")
      return
    }

    setLoading(true)
    setError(null)
    setRespuestas([])
    setWarnings([])

    try {
      const res = await fetch("/api/omr/closed-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
body: JSON.stringify({
          dataUrl: imageUrl,
          mimeType: "image/jpeg",
          totalPreguntas,
          opciones,
          columnas,
          dobleVerificacion: true,
        }),
      })

      const data = await res.json()

      if (data.success && Array.isArray(data.respuestas)) {
        setRespuestas(data.respuestas)
        setAlumnoDetectado(data.alumnoDetectado || "")
        setCursoDetectado(data.cursoDetectado || "")
        setWarnings(data.warnings || [])
        setHasExtracted(true)
      } else {
        setError(data.error || "Error en la extraccion OMR. La IA no pudo leer la plantilla.")
      }
    } catch (e) {
      setError("Error de red o servidor al intentar la extraccion OMR de respuestas cerradas.")
} finally {
      setLoading(false)
    }
  }, [imageUrl, totalPreguntas, opciones, columnas])

  const handleRespuestaChange = (index: number, newValue: string) => {
    setRespuestas((prev) => {
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        respuesta: newValue.toUpperCase(),
        confianza: 1.0, // Manual edit = max confidence
      }
      return updated
    })
  }

  const lowConfidenceItems = respuestas.filter(
    (r) => r.confianza < 0.90 || r.respuesta === "SIN_RESPUESTA" || r.respuesta === "DOBLE_MARCA"
  )

  const handleConfirm = () => {
    onConfirm({
      respuestas,
      alumnoDetectado: alumnoDetectado || undefined,
      cursoDetectado: cursoDetectado || undefined,
      totalPreguntas,
    })
  }

  // Dividir respuestas en columnas para mejor visualizacion
  const midPoint = Math.ceil(respuestas.length / 2)
  const col1 = respuestas.slice(0, midPoint)
  const col2 = respuestas.slice(midPoint)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2 md:p-4">
      <Card className="w-full max-w-6xl h-[95vh] flex flex-col bg-white">
        {/* Header */}
        <div className="flex justify-between items-center p-3 md:p-4 border-b shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Eye className="h-5 w-5 text-indigo-600" />
            <h2 className="text-base md:text-lg font-bold text-gray-900">
              OMR - Plantilla Respuestas Cerradas
            </h2>
            {loading ? (
              <span className="text-sm text-gray-500 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Procesando...
              </span>
            ) : error ? (
              <span className="flex items-center gap-1 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" /> Error
              </span>
            ) : hasExtracted && lowConfidenceItems.length > 0 ? (
              <span className="flex items-center gap-1 text-yellow-600 text-sm bg-yellow-50 px-2 py-0.5 rounded">
                <AlertCircle className="h-3 w-3" />
                {lowConfidenceItems.length} requieren revision
              </span>
            ) : hasExtracted ? (
              <span className="flex items-center gap-1 text-green-600 text-sm">
                <CheckCircle2 className="h-3 w-3" /> {respuestas.length} respuestas detectadas
              </span>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col md:flex-row gap-3 p-3 md:p-4 overflow-hidden">
          {/* Left: Image + Settings */}
          <div className="w-full md:w-2/5 flex flex-col gap-3 overflow-hidden">
            {/* Settings Panel */}
            <div className="shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(!showSettings)}
                className="w-full justify-start gap-2"
              >
                <Settings2 className="h-4 w-4" />
                Configuracion ({totalPreguntas} preguntas, opciones: {opciones})
              </Button>

              {showSettings && (
                <div className="mt-2 p-3 border rounded-lg bg-gray-50 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-600">Total Preguntas</label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={totalPreguntas}
                        onChange={(e) => setTotalPreguntas(Math.max(1, Number(e.target.value) || 40))}
                        className="h-8"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-600">Opciones</label>
                      <Input
                        value={opciones}
                        onChange={(e) => setOpciones(e.target.value)}
                        placeholder="A, B, C, D"
                        className="h-8"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Image preview */}
            <div className="flex-1 relative overflow-auto rounded border bg-gray-50">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt="Plantilla de respuestas"
                  className="w-full h-auto object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">
                  <Upload className="h-8 w-8" />
                </div>
              )}
            </div>

            {/* Extract button */}
            <div className="shrink-0 flex gap-2">
              <Button
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={extract}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analizando plantilla...
                  </>
                ) : hasExtracted ? (
                  <>
                    <RotateCcw className="mr-2 h-4 w-4" /> Re-analizar
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" /> Analizar Plantilla
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Right: Results Table */}
          <div className="w-full md:w-3/5 flex flex-col gap-3 overflow-hidden">
            {/* Detected info */}
            {hasExtracted && (alumnoDetectado || cursoDetectado) && (
              <div className="shrink-0 flex gap-3 p-2 bg-indigo-50 rounded border border-indigo-200 text-sm">
                {alumnoDetectado && (
                  <div>
                    <span className="font-semibold text-indigo-700">Alumno:</span>{" "}
                    <span className="text-gray-800">{alumnoDetectado}</span>
                  </div>
                )}
                {cursoDetectado && (
                  <div>
                    <span className="font-semibold text-indigo-700">Curso:</span>{" "}
                    <span className="text-gray-800">{cursoDetectado}</span>
                  </div>
                )}
              </div>
            )}

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

            {/* Error */}
            {error && (
              <div className="p-4 text-red-600 flex flex-col items-center gap-2">
                <AlertCircle className="h-8 w-8" />
                <p className="text-center text-sm">{error}</p>
              </div>
            )}

            {/* No extraction yet */}
            {!hasExtracted && !loading && !error && (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
                <Eye className="h-12 w-12" />
                <p className="text-sm text-center">
                  Configura el numero de preguntas y opciones, luego presiona
                  <br />
                  <strong>&quot;Analizar Plantilla&quot;</strong> para extraer las respuestas.
                </p>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
                <p className="text-sm text-gray-600 text-center">
                  Analizando plantilla con doble verificacion...
                  <br />
                  <span className="text-xs text-gray-400">Esto puede tomar 15-30 segundos</span>
                </p>
              </div>
            )}

            {/* Results grid - two columns */}
            {hasExtracted && !loading && respuestas.length > 0 && (
              <div className="flex-1 overflow-y-auto">
                <div className="text-xs font-semibold text-gray-500 mb-2 px-1">
                  Edita cualquier respuesta haciendo clic. Los cambios son inmediatos.
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0">
                  {/* Column 1 */}
                  <div>
                    <div className="grid grid-cols-[40px_1fr_20px] gap-1 px-1 py-1 bg-gray-100 rounded-t text-xs font-semibold text-gray-600">
                      <span>#</span>
                      <span>Respuesta</span>
                      <span></span>
                    </div>
                    {col1.map((item, idx) => {
                      const index = idx
                      const needsReview =
                        item.confianza < 0.90 ||
                        item.respuesta === "SIN_RESPUESTA" ||
                        item.respuesta === "DOBLE_MARCA"
                      return (
                        <div
                          key={index}
                          className={cn(
                            "grid grid-cols-[40px_1fr_20px] gap-1 px-1 py-0.5 items-center text-sm border-b",
                            needsReview && "bg-red-50 border-l-2 border-l-red-500"
                          )}
                        >
                          <span className="font-mono text-xs text-gray-500">{item.pregunta}</span>
                          <div className="flex gap-1">
                            {opcionesValidas.map((opt) => (
                              <button
                                key={opt}
                                onClick={() => handleRespuestaChange(index, opt)}
                                className={cn(
                                  "w-7 h-7 rounded text-xs font-bold transition-all",
                                  item.respuesta === opt
                                    ? "bg-indigo-600 text-white shadow-sm"
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
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
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
                      <span>Respuesta</span>
                      <span></span>
                    </div>
                    {col2.map((item, idx) => {
                      const index = midPoint + idx
                      const needsReview =
                        item.confianza < 0.90 ||
                        item.respuesta === "SIN_RESPUESTA" ||
                        item.respuesta === "DOBLE_MARCA"
                      return (
                        <div
                          key={index}
                          className={cn(
                            "grid grid-cols-[40px_1fr_20px] gap-1 px-1 py-0.5 items-center text-sm border-b",
                            needsReview && "bg-red-50 border-l-2 border-l-red-500"
                          )}
                        >
                          <span className="font-mono text-xs text-gray-500">{item.pregunta}</span>
                          <div className="flex gap-1">
                            {opcionesValidas.map((opt) => (
                              <button
                                key={opt}
                                onClick={() => handleRespuestaChange(index, opt)}
                                className={cn(
                                  "w-7 h-7 rounded text-xs font-bold transition-all",
                                  item.respuesta === opt
                                    ? "bg-indigo-600 text-white shadow-sm"
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
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Confirm button */}
            {hasExtracted && !loading && respuestas.length > 0 && (
              <div className="shrink-0 flex gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" onClick={onRescan} className="gap-1">
                  <RotateCcw className="h-3 w-3" /> Re-escanear
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirm}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-1"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmar {respuestas.length} respuestas
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
