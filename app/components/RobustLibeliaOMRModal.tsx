"use client"

/**
 * OMR robusto por archivo (imagen de hoja estándar LibelIA).
 * Flujo: tipo de prueba → clave correcta (manual o por imagen) → subir hoja del estudiante (imagen) →
 * corrección geométrica → lectura por coordenadas LibelIA → compare → revisión mínima → guardado vía retry-save.
 * No toca /api/evaluate ni flujos antiguos; reutiliza /api/omr/compare y /api/evaluations/retry-save.
 */

import * as React from "react"
import { useState, useEffect } from "react"
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
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  AlertCircle,
  Camera,
  CheckCircle2,
  Upload,
  Save,
} from "lucide-react"
import { readLibelIASheetFromImage } from "@/app/lib/omr-libelia-reader"
import { readOMRWithAspose } from "@/app/lib/omr-aspose-reader"
import { readOMRWithLeadtools } from "@/app/lib/omr-leadtools-reader"
import { readOMRWithVeryfi } from "@/app/lib/omr-veryfi-reader"
import { findSheetCornersAndWarp } from "@/app/lib/sheet-perspective"
import { findSheetCornersFiducialAndWarp } from "@/app/lib/sheet-perspective-fiducial"
import { LIBELIA_OMR_ASPECT_RATIO } from "@/app/lib/omr-sheet-spec"
import { GRAY_THRESHOLD } from "@/app/lib/sheet-alignment"
import { useEvaluator, AnswerKeyData } from "@/app/useEvaluator"
import { getAllOMRTemplates, OMRTemplate } from "@/app/lib/omr-template-store"
import { ScanbotDocumentScanner } from "@/app/components/ScanbotDocumentScanner"
import { DynamsoftDocumentScanner } from "@/app/components/DynamsoftDocumentScanner"
import { isDynamsoftEnabled } from "@/app/lib/dynamsoft-normalizer"

type TrialType = "solo" | "mixta"
type Step = "trial_type" | "template" | "key" | "upload" | "result" | "review" | "done"
type KeySource = "manual" | "upload"

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

type Props = {
  open: boolean
  onClose: () => void
  onSaved?: (evaluationId: string) => void
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

export function RobustLibeliaOMRModal({ open, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const { saveAnswerKey } = useEvaluator()

  const [step, setStep] = useState<Step>("trial_type")
  const [trialType, setTrialType] = useState<TrialType | null>(null)
  const [totalPreguntas, setTotalPreguntas] = useState(40)
  const [opciones, setOpciones] = useState("A,B,C,D")
  const [keySource, setKeySource] = useState<KeySource>("manual")
  const [manualKeys, setManualKeys] = useState<Record<number, string>>({})
  const [answerKey, setAnswerKey] = useState<AnswerKeyItem[]>([])

  const [studentName, setStudentName] = useState("")
  const [courseLabel, setCourseLabel] = useState("")
  const [title, setTitle] = useState("Corrección OMR hoja LibelIA (archivo)")
  const [subject, setSubject] = useState("Evaluación")

  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null)
  const [perspectiveCorrected, setPerspectiveCorrected] = useState(false)
  const [correctedWithFiducials, setCorrectedWithFiducials] = useState(false)
  const [usedAsposeOMR, setUsedAsposeOMR] = useState(false)
  const [usedLeadToolsOMR, setUsedLeadToolsOMR] = useState(false)
  const [usedVeryfiOMR, setUsedVeryfiOMR] = useState(false)
  const [asposeTemplateInfo, setAsposeTemplateInfo] = useState<string | null>(null)
  const [asposeRunInfo, setAsposeRunInfo] = useState<string | null>(null)
  const [omrProviderForUi, setOmrProviderForUi] = useState<string | null>(null)

  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [revisedAnswers, setRevisedAnswers] = useState<Record<number, string>>({})

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [templates, setTemplates] = useState<OMRTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<OMRTemplate | null>(null)
  const [showScanbotScanner, setShowScanbotScanner] = useState(false)
  const [showDynamsoftScanner, setShowDynamsoftScanner] = useState(false)
  const [usedDynamsoftCapture, setUsedDynamsoftCapture] = useState(false)

  const optionsList = opciones
    .split(",")
    .map((o) => o.trim().toUpperCase())
    .filter(Boolean)

  useEffect(() => {
    if (!open) {
      setOmrProviderForUi(null)
      return
    }
    fetch("/api/omr/provider")
      .then((r) => r.json())
      .then((data: { provider?: string }) => setOmrProviderForUi(data?.provider ?? null))
      .catch(() => setOmrProviderForUi(null))
  }, [open])

  const resetState = () => {
    setStep("trial_type")
    setTrialType(null)
    setTotalPreguntas(40)
    setOpciones("A,B,C,D")
    setKeySource("manual")
    setManualKeys({})
    setAnswerKey([])
    setStudentName("")
    setCourseLabel("")
    setTitle("Corrección OMR hoja LibelIA (archivo)")
    setSubject("Evaluación")
    setUploadedImageUrl(null)
    setPerspectiveCorrected(false)
    setCorrectedWithFiducials(false)
    setUsedAsposeOMR(false)
    setUsedLeadToolsOMR(false)
    setUsedVeryfiOMR(false)
    setAsposeTemplateInfo(null)
    setAsposeRunInfo(null)
    setCompareResult(null)
    setRevisedAnswers({})
    setError(null)
    setLoading(false)
    setTemplates([])
    setSelectedTemplateId(null)
    setSelectedTemplate(null)
    setShowScanbotScanner(false)
    setShowDynamsoftScanner(false)
    setUsedDynamsoftCapture(false)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const handleTrialType = (type: TrialType) => {
    setTrialType(type)
    setStep("template")
    setError(null)
  }

  // Cargar plantillas existentes al abrir el modal o al entrar al paso de plantilla
  React.useEffect(() => {
    if (!open) return
    try {
      const all = getAllOMRTemplates()
      setTemplates(all)
    } catch {
      setTemplates([])
    }
  }, [open])

  const handleSelectTemplate = (template: OMRTemplate) => {
    setSelectedTemplateId(template.templateId)
    setSelectedTemplate(template)
    setTotalPreguntas(template.numQuestions)
    // Ajustar opciones según numOptions
    const baseOptions = "ABCDEFGH".slice(0, template.numOptions).split("")
    setOpciones(baseOptions.join(","))
    const keys: AnswerKeyItem[] = []
    for (let i = 1; i <= template.numQuestions; i++) {
      const ans = template.answerKey[i] || ""
      keys.push({ pregunta: i, respuestaCorrecta: String(ans).trim().toUpperCase() })
    }
    setAnswerKey(keys)
    const answerKeyData: AnswerKeyData = {
      respuestas: keys.map((k) => ({
        pregunta: k.pregunta,
        respuestaCorrecta: k.respuestaCorrecta,
        confianza: 0.95,
        metodo: "manual",
      })),
      totalPreguntas: template.numQuestions,
      preguntasDudosas: [],
      templateId: template.templateId,
    }
    saveAnswerKey(answerKeyData)
    setStep("upload")
    const hasAspose = !!template.asposeOmrBase64
    setAsposeTemplateInfo(
      hasAspose
        ? "Integración Aspose disponible para esta plantilla (tiene archivo .omr asociado)."
        : "Esta plantilla no tiene .omr Aspose guardado. Si Aspose no está configurado globalmente, se usará el lector de respaldo de LibelIA.",
    )
    setAsposeRunInfo(null)
    if (process.env.NODE_ENV === "development") {
      console.log("[RobustOMR] Plantilla seleccionada", {
        templateId: template.templateId,
        name: template.name,
        hasAsposeOmr: hasAspose,
        asposeLength: template.asposeOmrBase64?.length ?? 0,
      })
    }
    toast({
      title: "Plantilla OMR seleccionada.",
      description: "La clave correcta se cargó automáticamente.",
    })
  }

  const handleConfirmKey = () => {
    if (keySource === "manual") {
      const keys: AnswerKeyItem[] = []
      for (let i = 1; i <= totalPreguntas; i++) {
        const raw = (manualKeys[i] ?? "").trim().toUpperCase()
        if (!raw) {
          setError(`Falta la respuesta correcta de la pregunta ${i}.`)
          return
        }
        keys.push({ pregunta: i, respuestaCorrecta: raw })
      }
      setAnswerKey(keys)
      // Guardar clave estructurada en el sistema (AnswerKeyData interno)
      const answerKeyData: AnswerKeyData = {
        respuestas: keys.map((k) => ({
          pregunta: k.pregunta,
          respuestaCorrecta: k.respuestaCorrecta,
          confianza: 0.95,
          metodo: "manual",
        })),
        totalPreguntas,
        preguntasDudosas: [],
        templateId: "libelia_omr_standard",
      }
      saveAnswerKey(answerKeyData)
      setStep("upload")
      setError(null)
      toast({
        title: "Clave correcta cargada.",
        description: "Ahora sube la hoja OMR del estudiante.",
      })
      return
    }
  }

  const handleUploadKeyImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith("image/")) {
      setError("Por ahora solo se admiten imágenes para la clave.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = rej
        r.readAsDataURL(file)
      })
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
          data.respuestas.map(
            (r: { pregunta: number; respuestaCorrecta: string }) => ({
              pregunta: r.pregunta,
              respuestaCorrecta: String(r.respuestaCorrecta || "")
                .trim()
                .toUpperCase(),
            }),
          ),
        )
        // Guardar clave estructurada también en el sistema
        const answerKeyData: AnswerKeyData = {
          respuestas: data.respuestas.map(
            (r: { pregunta: number; respuestaCorrecta: string }) => ({
              pregunta: r.pregunta,
              respuestaCorrecta: String(r.respuestaCorrecta || "")
                .trim()
                .toUpperCase(),
              confianza: 0.95,
              metodo: "manual",
            }),
          ),
          totalPreguntas: data.totalPreguntas || totalPreguntas,
          preguntasDudosas: [],
          templateId: "libelia_omr_standard",
          imagenPlantilla: data.templateImageUrl || undefined,
        }
        saveAnswerKey(answerKeyData)
        setStep("upload")
        toast({
          title: "Clave correcta extraída.",
          description: "Ahora sube la hoja OMR del estudiante.",
        })
      } else {
        setError(data.error || "No se pudo extraer la clave de la plantilla.")
      }
    } catch {
      setError("Error al cargar la plantilla de clave.")
    } finally {
      setLoading(false)
    }
  }

  const handleDynamsoftImageCaptured = async (dataUrl: string) => {
    if (answerKey.length === 0) {
      setError("Primero debes cargar la clave correcta.")
      return
    }
    console.log("[RobustOMR] Dynamsoft normalized image accepted")
    toast({
      title: "Imagen normalizada con Dynamsoft",
      description: "Procesando con el flujo OMR.",
    })
    setUploadedImageUrl(dataUrl)
    setUsedDynamsoftCapture(true)
    setPerspectiveCorrected(true)
    setLoading(true)
    setError(null)
    setAsposeRunInfo(null)
    setUsedAsposeOMR(false)
    setUsedLeadToolsOMR(false)
    try {
      const imageToRead = dataUrl
      let gridResults: { pregunta: number; respuesta: string; confianza: number }[]
      let asposeTried = false
      let asposeEmpty = false
      let providerRes: { provider?: string }
      try {
        providerRes = await fetch("/api/omr/provider").then((r) => r.json())
      } catch {
        providerRes = { provider: "libelia" }
      }
      const omrProvider =
        providerRes?.provider === "opencv"
          ? "opencv"
          : providerRes?.provider === "leadtools"
            ? "leadtools"
            : providerRes?.provider === "veryfi"
              ? "veryfi"
              : "libelia"

      if (omrProvider === "veryfi") {
        console.log("[RobustOMR] usando Veryfi")
        try {
          toast({ title: "Leyendo con Veryfi", description: "Motor OMR Veryfi." })
          setAsposeRunInfo("Intentando lectura con Veryfi...")
          const response = await readOMRWithVeryfi(
            imageToRead,
            answerKey.length,
            optionsList,
            selectedTemplate?.templateId ?? undefined,
          )
          gridResults = response.results
          const nonEmptyCount = gridResults.filter(
            (r) => r.respuesta && r.respuesta !== "SIN_RESPUESTA",
          ).length
          if (nonEmptyCount === 0) {
            console.log("[RobustOMR] Veryfi sin resultados válidos, se usó LibelIA")
            const fallback = await readLibelIASheetFromImage(
              imageToRead,
              answerKey.length,
              optionsList,
            )
            gridResults = fallback
            setUsedVeryfiOMR(false)
            setAsposeRunInfo("Veryfi respondió sin resultados válidos. Se usó lector de respaldo de LibelIA.")
            toast({
              title: "Veryfi respondió sin resultados válidos.",
              description: "Se usó el lector de respaldo de LibelIA.",
            })
          } else {
            console.log("[RobustOMR] Veryfi devolvió resultados")
            setUsedVeryfiOMR(true)
            setUsedAsposeOMR(false)
            setAsposeRunInfo("Lectura realizada con Veryfi.")
            toast({ title: "Veryfi devolvió resultados", description: "Puedes revisar y guardar la corrección." })
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.log("[RobustOMR] Veryfi falló, usando LibelIA fallback", message)
          gridResults = await readLibelIASheetFromImage(
            imageToRead,
            answerKey.length,
            optionsList,
          )
          setUsedVeryfiOMR(false)
          setAsposeRunInfo("Veryfi falló. Se usó lector de respaldo de LibelIA.")
          toast({
            title: "Veryfi falló, se usó lector LibelIA",
            description: message,
          })
        }
      } else if (omrProvider === "leadtools" || omrProvider === "opencv") {
        const externalLabel = omrProvider === "opencv" ? "OpenCV" : "LEADTOOLS"
        const configHint =
          omrProvider === "opencv"
            ? "OPENCV_OMR_URL y OMR_PROVIDER=opencv"
            : "LEADTOOLS_OMR_URL y OMR_PROVIDER=leadtools"
        if (omrProvider === "opencv") {
          console.log("[RobustOMR] OpenCV reading Dynamsoft image")
          toast({ title: "OpenCV leyendo imagen corregida", description: "Usando imagen normalizada por Dynamsoft." })
        }
        try {
          setAsposeRunInfo(`Intentando lectura con ${externalLabel}...`)
          const response = await readOMRWithLeadtools(
            imageToRead,
            answerKey.length,
            optionsList,
            selectedTemplate?.templateId ?? undefined,
          )
          gridResults = response.results
          const nonEmptyCount = gridResults.filter(
            (r) => r.respuesta && r.respuesta !== "SIN_RESPUESTA",
          ).length
          if (nonEmptyCount === 0) {
            const fallback = await readLibelIASheetFromImage(
              imageToRead,
              answerKey.length,
              optionsList,
            )
            gridResults = fallback
            setUsedLeadToolsOMR(false)
            setAsposeRunInfo(
              `${externalLabel} respondió sin resultados válidos. Se usó lector de respaldo de LibelIA.`,
            )
          } else {
            setUsedLeadToolsOMR(true)
            setUsedAsposeOMR(false)
            const engine = response.metadata?.engine ?? ""
            const omissionsCount = response.omissions?.length ?? 0
            const doubleMarksCount = response.doubleMarks?.length ?? 0
            const hasIncidencias = omissionsCount > 0 || doubleMarksCount > 0
            if (omrProvider === "opencv") {
              if (!hasIncidencias) {
                setAsposeRunInfo("Imagen capturada y normalizada con Dynamsoft. Lectura realizada con OpenCV.")
              } else {
                setAsposeRunInfo("Imagen normalizada con Dynamsoft, pero la lectura OMR presentó incidencias.")
              }
            } else {
              setAsposeRunInfo(
                hasIncidencias
                  ? "Lectura realizada con OpenCV calibrado. Lectura con incidencias, revisar marcas."
                  : "Lectura realizada con OpenCV calibrado."
              )
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : typeof err === "object" && err !== null ? "Error desconocido" : String(err)
          console.log("[RobustOMR] OpenCV failed after Dynamsoft, using LibelIA fallback")
          gridResults = await readLibelIASheetFromImage(
            imageToRead,
            answerKey.length,
            optionsList,
          )
          setUsedLeadToolsOMR(false)
          setAsposeRunInfo("Dynamsoft capturó la imagen, pero OpenCV falló. Se usó lector LibelIA.")
          toast({
            title: "OpenCV falló, se usó respaldo LibelIA",
            description: "La imagen fue normalizada con Dynamsoft.",
          })
        }
      } else {
        setAsposeRunInfo("Intentando lectura con Aspose...")
        asposeTried = true
        gridResults = await readOMRWithAspose(
          imageToRead,
          answerKey.length,
          optionsList,
          selectedTemplate?.asposeOmrBase64 ?? undefined,
        )
        const nonEmptyCount = gridResults.filter(
          (r) => r.respuesta && r.respuesta !== "SIN_RESPUESTA",
        ).length
        if (nonEmptyCount === 0) {
          gridResults = await readLibelIASheetFromImage(imageToRead, answerKey.length, optionsList)
          setUsedAsposeOMR(false)
          setAsposeRunInfo("Aspose respondió sin resultados válidos. Se usó lector de respaldo de LibelIA.")
        } else {
          setUsedAsposeOMR(true)
          setAsposeRunInfo("Lectura OMR completada con Aspose.")
        }
      }

      const studentAnswers = gridResults.map((r) => ({
        pregunta: r.pregunta,
        respuesta: r.respuesta || "SIN_RESPUESTA",
        confianza: r.confianza,
      }))
      const normalizePregunta = (p: unknown): number => {
        const n = Number(p)
        return Number.isFinite(n) ? n : 0
      }
      const normalizeRespuesta = (s: unknown): string =>
        String(s ?? "").trim().toUpperCase() || "SIN_RESPUESTA"
      const correctAnswersForCompare = answerKey
        .map((k) => ({
          pregunta: normalizePregunta(k.pregunta),
          respuestaCorrecta: normalizeRespuesta(k.respuestaCorrecta),
          confianza: 0.95,
          metodo: "manual" as const,
        }))
        .filter((x) => x.pregunta >= 1)
        .sort((a, b) => a.pregunta - b.pregunta)
      const studentAnswersForCompare = studentAnswers
        .map((s) => ({
          pregunta: normalizePregunta(s.pregunta),
          respuesta: normalizeRespuesta(s.respuesta),
          confianza: Number(s.confianza) || 0,
        }))
        .filter((x) => x.pregunta >= 1)
        .sort((a, b) => a.pregunta - b.pregunta)
      const compareRes = await fetch("/api/omr/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answerKey: correctAnswersForCompare,
          studentAnswers: studentAnswersForCompare,
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
        title: usedLeadToolsOMR
          ? "Lectura OMR completada con LEADTOOLS."
          : usedAsposeOMR
            ? "Lectura OMR completada con Aspose."
            : `Se detectaron ${compareData.correctas} respuestas correctas.`,
        description: dudosas > 0 ? `Hay ${dudosas} preguntas que requieren revisión manual.` : "Puedes revisar y guardar la corrección.",
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar la hoja.")
    } finally {
      setLoading(false)
    }
  }

  const handleUploadStudentSheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Por ahora este flujo admite solo imágenes (JPG/PNG) de la hoja LibelIA.")
      return
    }
    if (answerKey.length === 0) {
      setError("Primero debes cargar la clave correcta.")
      return
    }
      setLoading(true)
      setError(null)
      setPerspectiveCorrected(false)
      setCorrectedWithFiducials(false)
      setUsedAsposeOMR(false)
      setUsedLeadToolsOMR(false)
      setAsposeRunInfo(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = rej
        r.readAsDataURL(file)
      })
      setUploadedImageUrl(dataUrl)

      let imageToRead = dataUrl
      const useFiducials = selectedTemplate?.sheetSpec === "libelia_standard_v2"
      if (useFiducials) {
        const fiducialResult = await findSheetCornersFiducialAndWarp(
          dataUrl,
          LIBELIA_OMR_ASPECT_RATIO
        )
        if (fiducialResult?.correctedDataUrl) {
          imageToRead = fiducialResult.correctedDataUrl
          setPerspectiveCorrected(true)
          setCorrectedWithFiducials(true)
        }
      }
      if (!useFiducials || imageToRead === dataUrl) {
        const warpResult = await findSheetCornersAndWarp(
          dataUrl,
          LIBELIA_OMR_ASPECT_RATIO,
          GRAY_THRESHOLD,
        )
        if (warpResult?.correctedDataUrl) {
          imageToRead = warpResult.correctedDataUrl
          setPerspectiveCorrected(true)
        }
      }

      let gridResults: { pregunta: number; respuesta: string; confianza: number }[]
      let asposeTried = false
      let asposeEmpty = false
      let providerRes: { provider?: string }
      try {
        providerRes = await fetch("/api/omr/provider").then((r) => r.json())
      } catch {
        providerRes = { provider: "libelia" }
      }
      const omrProvider =
        providerRes?.provider === "opencv"
          ? "opencv"
          : providerRes?.provider === "leadtools"
            ? "leadtools"
            : providerRes?.provider === "veryfi"
              ? "veryfi"
              : "libelia"

      if (omrProvider === "veryfi") {
        console.log("[RobustOMR] usando Veryfi")
        try {
          toast({ title: "Leyendo con Veryfi", description: "Motor OMR Veryfi." })
          setAsposeRunInfo("Intentando lectura con Veryfi...")
          const response = await readOMRWithVeryfi(
            imageToRead,
            answerKey.length,
            optionsList,
            selectedTemplate?.templateId ?? undefined,
          )
          gridResults = response.results
          const nonEmptyCount = gridResults.filter(
            (r) => r.respuesta && r.respuesta !== "SIN_RESPUESTA",
          ).length
          if (nonEmptyCount === 0) {
            console.log("[RobustOMR] Veryfi sin resultados válidos, se usó LibelIA")
            const fallback = await readLibelIASheetFromImage(
              imageToRead,
              answerKey.length,
              optionsList,
            )
            gridResults = fallback
            setUsedVeryfiOMR(false)
            setAsposeRunInfo("Veryfi respondió sin resultados válidos. Se usó lector de respaldo de LibelIA.")
            toast({
              title: "Veryfi respondió sin resultados válidos.",
              description: "Se usó el lector de respaldo de LibelIA.",
            })
          } else {
            console.log("[RobustOMR] Veryfi devolvió resultados")
            setUsedVeryfiOMR(true)
            setUsedAsposeOMR(false)
            setAsposeRunInfo("Lectura realizada con Veryfi.")
            toast({ title: "Veryfi devolvió resultados", description: "Puedes revisar y guardar la corrección." })
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.log("[RobustOMR] Veryfi falló, usando LibelIA fallback", message)
          gridResults = await readLibelIASheetFromImage(
            imageToRead,
            answerKey.length,
            optionsList,
          )
          setUsedVeryfiOMR(false)
          setAsposeRunInfo("Veryfi falló. Se usó lector de respaldo de LibelIA.")
          toast({
            title: "Veryfi falló, se usó lector LibelIA",
            description: message,
          })
        }
      } else if (omrProvider === "leadtools" || omrProvider === "opencv") {
        const externalLabel = omrProvider === "opencv" ? "OpenCV" : "LEADTOOLS"
        const configHint =
          omrProvider === "opencv"
            ? "OPENCV_OMR_URL y OMR_PROVIDER=opencv"
            : "LEADTOOLS_OMR_URL y OMR_PROVIDER=leadtools"
        if (omrProvider === "opencv") {
          console.log("[RobustOMR] provider=opencv, Aspose ignorado por prueba forzada")
          console.log("[RobustOMR] usando OpenCV")
        } else if (process.env.NODE_ENV === "development") {
          console.log("[RobustOMR] usando", externalLabel)
        }
        try {
          toast({
            title: `Leyendo con ${externalLabel}`,
            description: `Motor OMR ${externalLabel} (microservicio).`,
          })
          setAsposeRunInfo(`Intentando lectura con ${externalLabel}...`)
          const response = await readOMRWithLeadtools(
            imageToRead,
            answerKey.length,
            optionsList,
            selectedTemplate?.templateId ?? undefined,
          )
          gridResults = response.results
          const nonEmptyCount = gridResults.filter(
            (r) => r.respuesta && r.respuesta !== "SIN_RESPUESTA",
          ).length
          if (nonEmptyCount === 0) {
            if (process.env.NODE_ENV === "development") {
              console.log("[RobustOMR]", externalLabel, "sin resultados válidos, se usó LibelIA")
            }
            const fallback = await readLibelIASheetFromImage(
              imageToRead,
              answerKey.length,
              optionsList,
            )
            gridResults = fallback
            setUsedLeadToolsOMR(false)
            setAsposeRunInfo(
              `${externalLabel} respondió sin resultados válidos. Se usó lector de respaldo de LibelIA.`,
            )
            toast({
              title: `${externalLabel} respondió sin resultados válidos.`,
              description: "Se usó el lector de respaldo de LibelIA.",
            })
          } else {
            setUsedLeadToolsOMR(true)
            setUsedAsposeOMR(false)
            const engine = response.metadata?.engine ?? ""
            const omissionsCount = response.omissions?.length ?? 0
            const doubleMarksCount = response.doubleMarks?.length ?? 0
            const hasIncidencias = omissionsCount > 0 || doubleMarksCount > 0
            const totalQuestions = answerKey.length
            const incidenciasThreshold = Math.max(1, Math.ceil(totalQuestions * 0.2))
            const isDoubtful =
              engine === "opencv" &&
              hasIncidencias &&
              omissionsCount + doubleMarksCount >= incidenciasThreshold

            if (engine === "opencv" && !hasIncidencias) {
              console.log("[RobustOMR] OpenCV accepted")
            }

            if (engine === "opencv" && hasIncidencias && isDoubtful) {
              console.log("[RobustOMR] OpenCV doubtful, Azure validation started")
              try {
                const base64ForAzure = imageToRead.includes("base64,")
                  ? imageToRead.split("base64,")[1] ?? imageToRead
                  : imageToRead
                const azureRes = await fetch("/api/omr/azure-validate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ imageBase64: base64ForAzure }),
                })
                const azureResult = await azureRes.json().catch(() => ({}))
                const azureHasMarks = azureResult.hasSelectionMarks === true
                const azureQualityWarning = azureResult.qualityWarning

                if (azureQualityWarning && !azureHasMarks) {
                  console.log("[RobustOMR] Azure suggests recapture")
                  setAsposeRunInfo(
                    "Lectura realizada con OpenCV. La imagen requiere mejor captura (Azure no detectó marcas útiles)."
                  )
                  toast({
                    title: "Imagen requiere mejor captura",
                    description: "Se recomienda volver a fotografiar la hoja con mejor luz y encuadre.",
                  })
                } else if (azureHasMarks && hasIncidencias) {
                  console.log("[RobustOMR] Azure confirms structure but OpenCV misaligned")
                  setAsposeRunInfo(
                    "Lectura realizada con OpenCV calibrado. Revisar alineación/calibración OMR (Azure detectó estructura)."
                  )
                  toast({
                    title: "Revisar alineación OMR",
                    description: "OpenCV tuvo incidencias pero Azure detectó marcas. Revisar calibración o marcas dudosas.",
                  })
                } else {
                  setAsposeRunInfo(
                    "Lectura realizada con OpenCV calibrado. Lectura con incidencias, revisar marcas."
                  )
                }
              } catch {
                setAsposeRunInfo(
                  "Lectura realizada con OpenCV calibrado. Lectura con incidencias, revisar marcas."
                )
              }
            } else if (engine === "opencv") {
              if (response.metadata?.flatScoresDetected) {
                setAsposeRunInfo(
                  "Lectura realizada con OpenCV calibrado. Revisar alineación/calibración OMR (scores planos detectados)."
                )
                toast({
                  title: "Revisar alineación OMR",
                  description: "Posible desalineación de grilla. Ajuste calibración o vuelva a capturar.",
                })
              } else {
                setAsposeRunInfo(
                  hasIncidencias
                    ? "Lectura realizada con OpenCV calibrado. Lectura con incidencias, revisar marcas."
                    : "Lectura realizada con OpenCV calibrado."
                )
              }
            } else {
              setAsposeRunInfo(`Lectura OMR completada con ${externalLabel}.`)
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : typeof err === "object" && err !== null ? "Error desconocido" : String(err)
          if (omrProvider === "opencv") {
            console.log("[RobustOMR] OpenCV falló, usando LibelIA", message)
          } else if (process.env.NODE_ENV === "development") {
            console.log("[RobustOMR]", externalLabel, "falló, fallback LibelIA", message)
          }
          const isNotConfigured =
            message.toLowerCase().includes("no configurado") || message.toLowerCase().includes("configure")
          gridResults = await readLibelIASheetFromImage(
            imageToRead,
            answerKey.length,
            optionsList,
          )
          setUsedLeadToolsOMR(false)
          setAsposeRunInfo(
            isNotConfigured
              ? `${externalLabel} no configurado. Se usó lector de respaldo de LibelIA.`
              : `${externalLabel} falló. Se usó lector de respaldo de LibelIA.`,
          )
          toast({
            title: isNotConfigured ? `${externalLabel} no configurado` : `${externalLabel} falló, se usó LibelIA`,
            description: isNotConfigured
              ? `Configure ${configHint}. Se usó LibelIA.`
              : message,
          })
        }
      } else {
        try {
          toast({
            title: "Intentando lectura con Aspose...",
            description: "Motor OMR profesional (Aspose.OMR Cloud).",
          })
          setAsposeRunInfo("Intentando lectura con Aspose...")
          asposeTried = true
          gridResults = await readOMRWithAspose(
            imageToRead,
            answerKey.length,
            optionsList,
            selectedTemplate?.asposeOmrBase64 ?? undefined,
          )
          const nonEmptyCount = gridResults.filter(
            (r) => r.respuesta && r.respuesta !== "SIN_RESPUESTA",
          ).length
          if (nonEmptyCount === 0) {
            asposeEmpty = true
            if (process.env.NODE_ENV === "development") {
              console.warn("[RobustOMR] Aspose devolvió resultados vacíos, usando fallback LibelIA.", {
                totalResults: gridResults.length,
              })
            }
            const fallback = await readLibelIASheetFromImage(
              imageToRead,
              answerKey.length,
              optionsList,
            )
            gridResults = fallback
            setUsedAsposeOMR(false)
            setAsposeRunInfo(
              "Aspose respondió sin resultados válidos. Se usó lector de respaldo de LibelIA.",
            )
            toast({
              title: "Aspose respondió sin resultados válidos.",
              description: "Se usó el lector de respaldo de LibelIA para leer la hoja.",
            })
          } else {
            setUsedAsposeOMR(true)
            setAsposeRunInfo("Lectura OMR completada con Aspose.")
            if (process.env.NODE_ENV === "development") {
              console.log("[RobustOMR] Lectura completada con Aspose", {
                totalResults: gridResults.length,
                nonEmptyCount,
              })
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Error desconocido al leer con Aspose OMR."
          const lower = message.toLowerCase()
          const isConfigMissing = lower.includes("no está configurado")
          const isNoTemplate =
            lower.includes("no hay plantilla aspose") ||
            lower.includes("plantilla aspose") ||
            lower.includes("archivo .omr")

          if (process.env.NODE_ENV === "development") {
            console.error("[RobustOMR] Error al leer con Aspose, usando fallback LibelIA.", {
              error: err,
              message,
            })
          }

          gridResults = await readLibelIASheetFromImage(
            imageToRead,
            answerKey.length,
            optionsList,
          )
          setUsedAsposeOMR(false)
          asposeTried = true

          if (isConfigMissing || isNoTemplate) {
            setAsposeRunInfo(
              "No hay plantilla Aspose disponible o la configuración está incompleta. Se usó lector de respaldo de LibelIA.",
            )
            toast({
              title: "No hay plantilla Aspose disponible.",
              description:
                "Falta el archivo .omr asociado o la variable global. Se usó el lector de respaldo de LibelIA.",
            })
          } else {
            setAsposeRunInfo("Aspose falló. Se usó lector de respaldo de LibelIA.")
            toast({
              title: "Aspose falló. Se usó lector de respaldo de LibelIA.",
              description: message,
            })
          }
        }
      }

      const studentAnswers = gridResults.map((r) => ({
        pregunta: r.pregunta,
        respuesta: r.respuesta || "SIN_RESPUESTA",
        confianza: r.confianza,
      }))

      // Normalización antes de compare: pregunta como number, respuestas mayúscula y trim, orden por pregunta
      const normalizePregunta = (p: unknown): number => {
        const n = Number(p)
        return Number.isFinite(n) ? n : 0
      }
      const normalizeRespuesta = (s: unknown): string =>
        String(s ?? "")
          .trim()
          .toUpperCase() || "SIN_RESPUESTA"

      const correctAnswersForCompare = answerKey
        .map((k) => ({
          pregunta: normalizePregunta(k.pregunta),
          respuestaCorrecta: normalizeRespuesta(k.respuestaCorrecta),
          confianza: 0.95,
          metodo: "manual" as const,
        }))
        .filter((x) => x.pregunta >= 1)
        .sort((a, b) => a.pregunta - b.pregunta)

      const studentAnswersForCompare = studentAnswers
        .map((s) => ({
          pregunta: normalizePregunta(s.pregunta),
          respuesta: normalizeRespuesta(s.respuesta),
          confianza: Number(s.confianza) || 0,
        }))
        .filter((x) => x.pregunta >= 1)
        .sort((a, b) => a.pregunta - b.pregunta)

      const comparePayload = {
        answerKey: correctAnswersForCompare,
        studentAnswers: studentAnswersForCompare,
        exigencia: 0.6,
      }

      if (process.env.NODE_ENV === "development") {
        const templateId = selectedTemplate?.templateId ?? "none"
        console.log("[OMR_COMPARE_DEBUG] templateId", templateId)
        console.log("[OMR_COMPARE_DEBUG] correctAnswers", JSON.stringify(correctAnswersForCompare.slice(0, 15)))
        console.log("[OMR_COMPARE_DEBUG] studentAnswers", JSON.stringify(studentAnswersForCompare.slice(0, 15)))
        console.log("[OMR_COMPARE_DEBUG] payload compare", {
          answerKeyLength: correctAnswersForCompare.length,
          studentAnswersLength: studentAnswersForCompare.length,
          exigencia: comparePayload.exigencia,
        })
        const first10 = correctAnswersForCompare.slice(0, 10).map((c, idx) => {
          const stud = studentAnswersForCompare.find((s) => s.pregunta === c.pregunta)
          return {
            pregunta: c.pregunta,
            correcta: c.respuestaCorrecta,
            estudiante: stud?.respuesta ?? "MISSING",
            match: c.respuestaCorrecta === (stud?.respuesta ?? ""),
          }
        })
        console.log("[OMR_COMPARE_DEBUG] primeras 10 comparaciones esperadas", first10)
      }

      const compareRes = await fetch("/api/omr/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comparePayload),
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
        title: usedVeryfiOMR
          ? "Lectura OMR completada con Veryfi."
          : usedLeadToolsOMR
            ? "Lectura OMR completada con LEADTOOLS."
            : usedAsposeOMR
              ? "Lectura OMR completada con Aspose."
              : `Se detectaron ${compareData.correctas} respuestas correctas, ${compareData.incorrectas} incorrectas y ${dudosas} dudosas.`,
        description:
          usedVeryfiOMR
            ? "Motor: Veryfi. Puedes revisar y guardar la corrección."
            : usedLeadToolsOMR
              ? "Motor: LEADTOOLS. Puedes revisar y guardar la corrección."
              : usedAsposeOMR
                ? "Motor: Aspose.OMR Cloud. Puedes revisar y guardar la corrección."
                : dudosas > 0
                  ? `Hay ${dudosas} preguntas que requieren revisión manual.`
                  : "Puedes revisar y guardar la corrección.",
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar la hoja.")
    } finally {
      setLoading(false)
    }
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
      const alternativas_corregidas: Array<{
        pregunta: string
        respuesta_estudiante: string
        respuesta_correcta: string
      }> = []
      let correctas = 0
      for (let i = 1; i <= total; i++) {
        const correcta = keyMap.get(i) || ""
        const estudiante =
          revisedAnswers[i] ??
          compareResult.resultados.find((r) => r.pregunta === i)?.respuestaEstudiante ??
          ""
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
          title: title.trim() || "Corrección OMR hoja LibelIA (archivo)",
          subject: subject.trim() || "Evaluación",
        }),
      })
      const data = await res.json()
      if (data.saved && data.evaluation_id) {
        setStep("done")
        toast({
          title: "Corrección lista para guardar.",
          description: "Evaluación guardada correctamente.",
        })
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

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corrección OMR hoja LibelIA — por archivo</DialogTitle>
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
              ¿Qué tipo de prueba estás corrigiendo?
            </p>
            <p className="text-sm text-muted-foreground">
              Este flujo usa la hoja OMR estándar LibelIA y una imagen estable de la hoja del
              estudiante para una corrección más robusta.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                className="flex-1 justify-start border-emerald-300 text-emerald-800"
                variant="outline"
                onClick={() => handleTrialType("solo")}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Solo alternativas
              </Button>
              <Button
                className="flex-1 justify-start border-amber-300 text-amber-800"
                variant="outline"
                onClick={() => handleTrialType("mixta")}
              >
                <Camera className="mr-2 h-4 w-4" /> Prueba mixta (alternativas + otras secciones)
              </Button>
            </div>
          </div>
        )}

        {step === "template" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Selecciona una plantilla OMR LibelIA o carga una nueva clave.
            </p>
            {templates.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Aún no hay plantillas guardadas. Puedes crear una desde &quot;Generar hoja OMR LibelIA&quot;
                o cargar una clave manualmente.
              </p>
            )}
            {templates.length > 0 && (
              <div className="space-y-2">
                <Label>Plantillas disponibles</Label>
                <div className="max-h-56 overflow-y-auto space-y-2">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.templateId}
                      type="button"
                      className="w-full text-left border rounded-md px-3 py-2 text-sm hover:bg-muted/70"
                      onClick={() => handleSelectTemplate(tpl)}
                    >
                      <div className="font-medium text-[var(--text-accent)]">
                        {tpl.name || "Plantilla OMR"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Preguntas: {tpl.numQuestions} · Opciones: {tpl.numOptions} ·{" "}
                        {new Date(tpl.createdAt).toLocaleString()}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>¿No tienes plantilla guardada?</Label>
              <p className="text-xs text-muted-foreground">
                Puedes definir una clave manualmente o desde imagen, y luego usarla también en otros
                flujos.
              </p>
              <Button variant="outline" onClick={() => { setSelectedTemplate(null); setStep("key"); }}>
                Cargar clave manual / desde imagen
              </Button>
            </div>
          </div>
        )}

        {step === "key" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Carga la clave correcta de la hoja OMR LibelIA.
            </p>
            <p className="text-sm text-muted-foreground">
              Luego podrás subir una imagen escaneada o fotografiada de la hoja del estudiante y
              contrastarla con esta clave.
            </p>
            <div className="grid gap-2">
              <Label>Total de preguntas</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={totalPreguntas}
                onChange={(e) =>
                  setTotalPreguntas(Math.max(1, Number(e.target.value) || 40))
                }
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
                <p className="text-xs text-muted-foreground mb-2">
                  Letra correcta por pregunta (1 a {totalPreguntas})
                </p>
                <div className="grid grid-cols-5 sm:grid-cols-10 gap-1">
                  {Array.from({ length: totalPreguntas }, (_, i) => i + 1).map((n) => (
                    <div key={n} className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">{n}</span>
                      <Input
                        className="h-8 w-full text-center"
                        maxLength={1}
                        value={manualKeys[n] ?? ""}
                        onChange={(e) =>
                          setManualKeys((prev) => ({
                            ...prev,
                            [n]: e.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="?"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {keySource === "upload" && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Sube una foto de la pauta con las respuestas correctas marcadas (burbujas o X).
                </p>
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

        {step === "upload" && (
          <div className="space-y-4">
            {selectedTemplate && (
              <div className="rounded-lg border border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/40 p-4 space-y-2">
                <p className="text-sm font-medium text-[var(--text-accent)]">
                  Plantilla seleccionada
                </p>
                <dl className="text-sm text-muted-foreground space-y-1">
                  <div><span className="font-medium text-foreground">Nombre:</span> {selectedTemplate.name}</div>
                  <div><span className="font-medium text-foreground">Preguntas:</span> {selectedTemplate.numQuestions}</div>
                  <div><span className="font-medium text-foreground">Opciones:</span> {selectedTemplate.numOptions} (A–{String.fromCharCode(64 + selectedTemplate.numOptions)})</div>
                  <div><span className="font-medium text-foreground">Formato:</span> Hoja OMR estándar LibelIA</div>
                </dl>
                <p className="text-sm text-teal-700 dark:text-teal-300 pt-1 border-t border-teal-200 dark:border-teal-800">
                  La clave correcta se cargó automáticamente desde la plantilla seleccionada.
                </p>
                {(asposeTemplateInfo || omrProviderForUi === "opencv" || omrProviderForUi === "veryfi") && (
                  <p className="text-xs text-blue-800 dark:text-blue-200 mt-1">
                    {omrProviderForUi === "opencv"
                      ? "Prueba forzada con OpenCV. Aspose ignorado para esta ejecución."
                      : omrProviderForUi === "veryfi"
                        ? "Lectura OMR con Veryfi para esta ejecución."
                        : asposeTemplateInfo}
                  </p>
                )}
              </div>
            )}
            {asposeRunInfo && (
              <div className="rounded-md border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-xs text-blue-800 dark:text-blue-200">
                {asposeRunInfo}
              </div>
            )}
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Sube la hoja OMR estándar LibelIA del estudiante.
            </p>
            <p className="text-sm text-muted-foreground">
              Idealmente una foto o escaneo donde se vean completos los cuatro marcadores de
              esquina. El sistema corregirá la perspectiva y normalizará la lectura.
            </p>
            <div className="grid gap-2">
              <Label>Imagen de la hoja del estudiante (JPG/PNG)</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadStudentSheet}
                  className="flex-1 min-w-[140px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!isDynamsoftEnabled()) {
                      console.log("[RobustOMR] Dynamsoft unavailable, manual upload enabled")
                      toast({
                        title: "Dynamsoft no disponible, use carga manual",
                        description: "Configure NEXT_PUBLIC_DYNAMSOFT_LICENSE y NEXT_PUBLIC_DYNAMSOFT_ENABLED=true o suba la imagen manualmente.",
                      })
                      return
                    }
                    console.log("[RobustOMR] Dynamsoft capture started")
                    toast({ title: "Captura con Dynamsoft iniciada", description: "Encuadre el documento en la cámara." })
                    setShowDynamsoftScanner(true)
                  }}
                >
                  Capturar con Dynamsoft
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowScanbotScanner(true)}
                >
                  Capturar con scanner mejorado
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Opcional: use el scanner mejorado si está configurado; si no, suba la imagen desde su dispositivo.
              </p>
              {loading && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Leyendo hoja OMR...
                </span>
              )}
            </div>
            {uploadedImageUrl && (
              <div className="rounded-lg overflow-hidden bg-black aspect-video">
                <img
                  src={uploadedImageUrl}
                  alt="Hoja del estudiante"
                  className="w-full h-full object-contain"
                />
              </div>
            )}
          </div>
        )}

        {step === "result" && compareResult && (
          <div className="space-y-4">
            {selectedTemplate && (
              <div className="rounded-lg border border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/40 p-3 text-sm">
                <p className="font-medium text-[var(--text-accent)]">Plantilla usada</p>
                <p className="text-muted-foreground">
                  {selectedTemplate.name} · {selectedTemplate.numQuestions} preguntas · Opciones A–{String.fromCharCode(64 + selectedTemplate.numOptions)} · Hoja OMR estándar LibelIA
                </p>
              </div>
            )}
            {perspectiveCorrected && (
              <div className="rounded-md border border-green-500/50 bg-green-500/10 px-3 py-2 text-sm text-green-800 dark:text-green-200">
                La hoja fue corregida digitalmente para mejorar la lectura.
                {correctedWithFiducials && (
                  <span className="block mt-1 font-medium">Geometría: fiduciales ArUco detectados.</span>
                )}
              </div>
            )}
            {usedVeryfiOMR && (
              <div className="rounded-md border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-sm text-blue-800 dark:text-blue-200">
                Lectura realizada con Veryfi.
              </div>
            )}
            {usedDynamsoftCapture && asposeRunInfo && (
              <div className="rounded-md border border-teal-500/50 bg-teal-500/10 px-3 py-2 text-sm text-teal-800 dark:text-teal-200">
                {asposeRunInfo}
              </div>
            )}
            {usedLeadToolsOMR && !usedDynamsoftCapture && (
              <div className="rounded-md border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-sm text-blue-800 dark:text-blue-200">
                Lectura realizada con motor OMR LEADTOOLS.
              </div>
            )}
            {usedAsposeOMR && (
              <div className="rounded-md border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-sm text-blue-800 dark:text-blue-200">
                Lectura realizada con motor OMR profesional (Aspose.OMR Cloud).
              </div>
            )}
            {asposeRunInfo && !usedAsposeOMR && !usedLeadToolsOMR && !usedVeryfiOMR && (
              <div className="rounded-md border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-xs text-blue-800 dark:text-blue-200">
                {asposeRunInfo}
              </div>
            )}
            {trialType === "mixta" && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <strong>Prueba mixta.</strong> La nota mostrada es solo de la parte de alternativas;
                no es la nota final total de la prueba.
              </div>
            )}
            <p className="text-sm font-medium">
              Se detectaron {compareResult.correctas} respuestas correctas,{" "}
              {compareResult.incorrectas} incorrectas y{" "}
              {compareResult.requierenRevision?.length ?? 0} dudosas.
            </p>
            <p className="text-sm text-muted-foreground">
              Total de preguntas leídas: {compareResult.totalPreguntas}. Porcentaje de acierto:{" "}
              {compareResult.porcentaje}%.
            </p>
            {compareResult.requierenRevision &&
              compareResult.requierenRevision.length > 0 && (
                <p className="text-sm text-amber-600 font-medium">
                  Hay {compareResult.requierenRevision.length} preguntas que requieren revisión
                  manual.
                </p>
              )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Preg.</TableHead>
                  <TableHead>Correcta</TableHead>
                  <TableHead>Leída</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Conf.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compareResult.resultados.map((r) => {
                  const requiere = compareResult.requierenRevision?.includes(r.pregunta)
                  let estado = r.esCorrecta ? "Correcta" : "Incorrecta"
                  if (r.respuestaEstudiante === "SIN_RESPUESTA" || r.respuestaEstudiante === "") {
                    estado = "Vacía"
                  }
                  if (r.respuestaEstudiante === "DOBLE_MARCA") {
                    estado = "Doble marca"
                  }
                  if (requiere) {
                    estado += " (Revisar)"
                  }
                  return (
                    <TableRow key={r.pregunta}>
                      <TableCell>{r.pregunta}</TableCell>
                      <TableCell>{r.respuestaCorrecta}</TableCell>
                      <TableCell>{r.respuestaEstudiante}</TableCell>
                      <TableCell>{estado}</TableCell>
                      <TableCell>{Math.round((r.confianzaLectura ?? 0) * 100)}%</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <DialogFooter>
              <Button variant="outline" onClick={handleGoToReview}>
                Revisar dudosas
              </Button>
              <Button onClick={handleSave} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Guardando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" /> Guardar corrección
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "review" && compareResult && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Revisa solo las preguntas dudosas, con doble marca o vacías.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Preg.</TableHead>
                  <TableHead>Correcta</TableHead>
                  <TableHead>Leída</TableHead>
                  <TableHead>Tu corrección</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compareResult.resultados.map((r) => {
                  const requiere = compareResult.requierenRevision?.includes(r.pregunta)
                  if (!requiere) return null
                  const current =
                    revisedAnswers[r.pregunta] || r.respuestaEstudiante || "SIN_RESPUESTA"
                  return (
                    <TableRow key={r.pregunta}>
                      <TableCell>{r.pregunta}</TableCell>
                      <TableCell>{r.respuestaCorrecta}</TableCell>
                      <TableCell>{r.respuestaEstudiante}</TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-24"
                          maxLength={1}
                          value={current === "SIN_RESPUESTA" ? "" : current}
                          onChange={(e) =>
                            setRevised(
                              r.pregunta,
                              e.target.value.trim()
                                ? e.target.value.trim().toUpperCase()
                                : "SIN_RESPUESTA",
                            )
                          }
                          placeholder="(vacío)"
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("result")}>
                Volver al resumen
              </Button>
              <Button onClick={handleSave} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Guardando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" /> Guardar corrección
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text-accent)]">
              Corrección completada y guardada.
            </p>
            <p className="text-sm text-muted-foreground">
              Puedes cerrar este modal o corregir otra hoja usando el mismo flujo.
            </p>
            <DialogFooter>
              <Button onClick={handleClose}>Cerrar</Button>
            </DialogFooter>
          </div>
        )}
        <ScanbotDocumentScanner
          open={showScanbotScanner}
          onClose={() => setShowScanbotScanner(false)}
        />
        <DynamsoftDocumentScanner
          open={showDynamsoftScanner}
          onClose={() => setShowDynamsoftScanner(false)}
          onImageCaptured={handleDynamsoftImageCaptured}
        />
      </DialogContent>
    </Dialog>
  )
}

