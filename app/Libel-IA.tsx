"use client"
/* eslint-disable @next/next/no-img-element -- Data URL de captura; preview dinámica. */

import { useState } from "react"
import { useEvaluator } from "./useEvaluator"
import SmartCameraModal from "@/components/smart-camera-modal"

type CameraFeedback = { confidence: number }

export default function LibelIA() {
  // =========================
  // ESTADOS
  // =========================
  const [fileUrl, setFileUrl] = useState<string>("")
  const [rubrica, setRubrica] = useState<string>("")
  const [result, setResult] = useState<any>(null)
  const [isCameraOpen, setIsCameraOpen] = useState(false)

  const { evaluate, isLoading } = useEvaluator()

  // =========================
  // HANDLERS
  // =========================
  const handleEvaluate = async () => {
    if (!fileUrl) {
      alert("Primero debes tomar o subir una imagen.")
      return
    }

    if (!rubrica.trim()) {
      alert("Por favor, ingresa una rúbrica de evaluación.")
      return
    }

    const payload = {
      fileUrls: [fileUrl],
      rubrica,
      puntajeTotal: 100,
      flexibilidad: 3,
    }

    const evaluationResult = await evaluate(payload)
    setResult(evaluationResult)
  }

  // ✅ acepta feedback opcional (si SmartCameraModal lo envía)
  const handleCapture = (dataUrl: string, feedback?: CameraFeedback) => {
    setFileUrl(dataUrl)
    setIsCameraOpen(false)
  }

  // =========================
  // RENDER
  // =========================
  return (
    <div className="p-6 max-w-3xl mx-auto bg-white min-h-screen">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">📝 Evaluación con IA</h1>

      {/* RÚBRICA */}
      <div className="mb-6">
        <label className="block mb-2 font-medium text-gray-700">Rúbrica de evaluación</label>
        <textarea
          value={rubrica}
          onChange={(e) => setRubrica(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
          rows={4}
          placeholder="Ej: Evalúa ortografía, coherencia, estructura, claridad de ideas..."
        />
      </div>

      {/* BOTÓN CÁMARA */}
      <div className="mb-4">
        <button
          onClick={() => setIsCameraOpen(true)}
          className="bg-gray-200 px-4 py-2 rounded-lg"
        >
          📷 Abrir cámara
        </button>
      </div>

      {/* MODAL CÁMARA */}
      {isCameraOpen && (
        <SmartCameraModal
          onCapture={handleCapture}
          onClose={() => setIsCameraOpen(false)}
          captureMode={null}
        />
      )}

      {/* PREVISUALIZACIÓN */}
      {fileUrl && (
        <div className="mb-4">
          <p className="font-medium mb-2">Imagen capturada:</p>
          <img
            src={fileUrl}
            alt="Imagen capturada"
            className="border rounded-lg max-w-full h-auto"
          />
        </div>
      )}

      {/* RESULTADO */}
      {isLoading && <p className="text-center mt-6">🔄 Evaluando con IA...</p>}

      {result && (
        <div
          className={`mt-6 p-4 rounded-lg border-l-4 ${
            result.success ? "bg-green-50 border-green-400 text-green-800" : "bg-red-50 border-red-400 text-red-800"
          }`}
        >
          <h3 className="font-bold text-lg">{result.success ? "✅ Evaluación completada" : "❌ Error"}</h3>

          {result.success ? (
            <>
              <p className="mt-2">
                <strong>Puntaje:</strong> {result.puntaje}
              </p>
              <p className="mt-1">
                <strong>Nota:</strong> {result.nota}
              </p>
              <p className="mt-2">
                <strong>Retroalimentación:</strong>{" "}
                {result.retroalimentacion?.resumen_general?.fortalezas}{" "}
                {result.retroalimentacion?.resumen_general?.areas_mejora}
              </p>
            </>
          ) : (
            <p className="mt-2">{result.error}</p>
          )}
        </div>
      )}

      {/* BOTÓN EVALUAR */}
      <div className="mt-6">
        <button
          onClick={handleEvaluate}
          disabled={isLoading || !fileUrl || !rubrica.trim()}
          className={`w-full py-3 px-6 rounded-lg font-medium text-white transition ${
            isLoading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {isLoading ? "Evaluando..." : "⚡ Evaluar con IA"}
        </button>
      </div>
    </div>
  )
}
