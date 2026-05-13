// EvaluatorClient.tsx - Cliente principal del evaluador (porcentajes, pautas, OMR)
"use client"
/* eslint-disable @next/next/no-img-element -- Vistas previas dinámicas (blob/data URL); Next/Image no encaja sin dimensiones estables. */
import * as React from "react"
import { useState, useRef, type ChangeEvent, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import dynamic from "next/dynamic"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { format } from "date-fns"
import { MAX_BATCH_PHOTO_PAGE_SIZE } from "@/app/lib/docente/batch-photo-pagination"
// UI (shadcn)
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Loader2,
  Sparkles,
  FileUp,
  Camera,
  Users,
  X,
  Printer,
  CalendarIcon,
  ImageUp,
  ClipboardList,
  Home,
  Palette,
  Eye,
  FileText,
  File as FileIcon,
  CheckCircle2,
  AlertCircle,
  History,
  Pencil,
  Archive,
  Trash2,
  Send,
  RefreshCw,
  FolderOpen,
  BookOpen,
  FileDown,
  FileArchive,
  MoreHorizontal,
} from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import NotesDashboard from "@/app/components/NotesDashboard"
import SourceExamsSection from "@/app/components/SourceExamsSection"
import {
  buildEvaluationBase,
  sourceExamInputToFormHints,
  buildTeacherAnswerKeyFromFormPauta,
  toCanonicalPautaFromEvaluationBaseItems,
  type EvaluationBase,
  type EvaluationBaseSourceExamItemInput,
} from "@/app/lib/evaluation-base"
import PedagogicalAnalysisModal from "@/app/components/PedagogicalAnalysisModal"
import { BatchPedagogicalZipDialog } from "@/app/components/BatchPedagogicalZipDialog"
import CoursePedagogicalSummaryModal from "@/app/components/CoursePedagogicalSummaryModal"
// PDF
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  PDFDownloadLink,
  Image as PDFImage,
  PDFViewer,
  pdf,
} from "@react-pdf/renderer"
import { useEvaluator, AnswerKeyData } from "./useEvaluator"
import {
  type EvaluateBatchNdjsonMeta,
  isEvaluateBatchDoneMsg,
  isEvaluateBatchMetaMsg,
} from "@/app/lib/evaluate-batch-ndjson"
import { pickStudentDesarrolloVisibleText } from "@/app/lib/pick-student-desarrollo-text"
import {
  buildPedagogicalResumenFromGroup,
  countAlternativasSummary,
} from "@/app/lib/pedagogical-feedback-from-group"
import {
  buildCorrectionReportGroupFromApiDetail,
  MAX_CORRECTION_REPORTS_ZIP_PHASE1,
  sanitizeCorrectionZipPart,
  type CorrectionReportGroupForPdf,
  type EvaluationDetailJsonForCorrectionZip,
} from "@/app/lib/correction-report-from-evaluation-detail"
import {
  filterCorreccionDetalladaParaDesarrolloUnico,
  formatDetalleDesarrolloPdf,
  pdfSafe,
  renderForWeb,
  splitCorreccionForTwoPages,
} from "@/app/lib/correction-report-pdf-helpers"
import { CorrectionReportPdfDocument as ReportDocument } from "@/app/components/correction-report/CorrectionReportPdfDocument"
import JSZip from "jszip"
import { saveAs } from "file-saver"
import { Progress } from "@/components/ui/progress"
import OMRPreviewModal from "@/app/components/OMRPreviewModal"
import AnswerKeyUploadModal from "../components/AnswerKeyUploadModal"
import { RealtimeOMRModal } from "@/app/components/RealtimeOMRModal"
import { TemplateOverlayOMRModal } from "@/app/components/TemplateOverlayOMRModal"
import { OMRSheetGeneratorModal } from "@/app/components/OMRSheetGeneratorModal"
import { RobustLibeliaOMRModal } from "@/app/components/RobustLibeliaOMRModal"
import ClosedAnswerOMRModal from "@/app/components/ClosedAnswerOMRModal"
import DevAdminPanel from "@/app/components/DevAdminPanel"
import {
  applyGuidedWizardSessionToEvaluatorForm,
  type GuidedEvaluatorFormField,
} from "@/app/components/teacher-wizard/applyGuidedWizardSessionToEvaluatorForm"
import { GuidedSessionEvaluatorContextBanner } from "@/app/components/teacher-wizard/GuidedSessionEvaluatorContextBanner"
import { ENABLE_WIZARD } from "@/app/components/teacher-wizard/constants"
import {
  readWizardSession,
  WIZARD_SESSION_CHANGED_EVENT,
  WIZARD_SESSION_STORAGE_KEY,
} from "@/app/components/teacher-wizard/sessionStorage"
import { INTERNAL_SUPPORT_UI } from "@/app/lib/internal-support-ui"
import { normalizeRutCanonical } from "@/app/lib/student-identity/rut"
import { formatStudentDisplayName } from "@/app/lib/format-student-name"
import {
  BATCH_PHOTO_ACTIVITY_CHANNEL,
  DOCENTE_ACTIVE_BATCH_ID_KEY,
  isDocenteBatchUuid,
  readDocenteActiveBatchId,
  writeDocenteActiveBatchId,
} from "@/app/lib/docente/active-batch-id"
type ClosedAnswerOMRResult = any
const SmartCameraModal = dynamic(() => import("@/components/smart-camera-modal"), {
  loading: () => <p>Cargando...</p>,
})

const Label = React.forwardRef<HTMLLabelElement, React.ComponentPropsWithoutRef<"label">>(
  ({ className, ...props }, ref) => <label ref={ref} className={cn("text-sm font-medium", className)} {...props} />,
)
Label.displayName = "Label"

/** Feature flag: oculta recálculo/backfill/pedagogy en UI estable. Activar con NEXT_PUBLIC_PEDAGOGY_FEATURES=true */
const FEATURE_PEDAGOGY_UI = false
const PEDAGOGY_UI_ENABLED =
  FEATURE_PEDAGOGY_UI ||
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_PEDAGOGY_FEATURES === "true")

/**
 * Panel temporal de trazabilidad visible dentro de la app.
 * Ajusta a `false` cuando termines el diagnóstico del caso real.
 */
const SHOW_EVALUATION_TRACE_PANEL = true

function tryCanonicalDevelopmentKeyForTrace(rawKey: string): string | null {
  const k = String(rawKey ?? "").trim().toUpperCase()
  if (!k) return null
  // Evitar claves de cerradas/alternativas si por algún motivo llegan.
  if (/^(SM|VF|TP|C)\s*\d+/.test(k)) return null

  // Normalizar separadores comunes alrededor del número.
  const compact = k.replace(/[\.\:\)\(]/g, " ").replace(/\s+/g, " ").trim()

  const p = /^P\s*(\d{1,3})$/.exec(compact.replace(/\s/g, ""))
  if (p) return `P${p[1]}`

  const n = /^(\d{1,3})$/.exec(compact.replace(/\s/g, ""))
  if (n) return `P${n[1]}`

  return null
}

function EvaluatorRootDiv({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  return <div className={className}>{children}</div>
}

// 🔥 FUNCIÓN DE PREVISUALIZACIÓN (AGREGADA)
const renderFilePreview = (file: { file: File; previewUrl: string }) => {
  const { file: f, previewUrl } = file
  const type = f.type
  const name = f.name.toLowerCase()

  if (type.startsWith("image/")) {
    return <img src={previewUrl || "/placeholder.svg"} alt={f.name} className="w-full h-full object-cover rounded-md" />
  }

  if (type === "application/pdf" || name.endsWith(".pdf")) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-red-50 rounded-md">
        <FileText className="text-red-500 h-6 w-6" />
        <span className="text-[10px] mt-1 text-gray-600 truncate px-1">PDF</span>
      </div>
    )
  }

  if (type.includes("word") || name.endsWith(".docx")) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-blue-50 rounded-md">
        <FileText className="text-blue-500 h-6 w-6" />
        <span className="text-[10px] mt-1 text-gray-600 truncate px-1">Word</span>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 rounded-md">
          <FileIcon className="text-gray-500 h-6 w-6" />
      <span className="text-[10px] mt-1 text-gray-600 truncate px-1">Archivo</span>
    </div>
  )
}

// ==== DEFINICIONES DE CONSTANTES GLOBALES ====
const wordmarkClass = "text-transparent bg-clip-text bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-400"
const LIBELIA_LOGO_PNG_BASE64 = "/LOGO-LIBEL.png"
// ==== Estilos Globales ====
const GlobalStyles = () => (
  <style jsx global>{`
    @import url('[https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap](https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap)');
    @import url('[https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@700&display=swap](https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@700&display=swap)');
    .font-logo { font-family: 'Josefin Sans', sans-serif; }
    :root, .theme-default {
      --bg-main: #F9FAFB; --bg-card: #FFFFFF; --bg-muted: #F3F4F6; --bg-muted-subtle: #F9FAFB;
      --bg-primary: #4338CA; --bg-primary-hover: #3730A3; --text-primary: #1F2937;
      --text-secondary: #6B7280; --text-on-primary: #FFFFFF; --text-accent: #4338CA;
      --border-color: #E5E7EB; --border-focus: #4F46E5; --ring-color: #4F46E5;
    }
    .theme-ocaso {
      
--bg-main: #09090b; --bg-card: #181818; --bg-muted: #27272a; --bg-muted-subtle: #18181b; 
      --bg-primary: #7C3AED; --bg-primary-hover: #6D28D9; --text-primary: #F4F4F5; 
      --text-secondary: #a1a1aa; --text-on-primary: #FFFFFF; --text-accent: #a78bfa; 
--border-color: #27272a; --border-focus: #8B5CF6; --ring-color: #8B5CF6; 
    }
    .theme-corporativo {
      --bg-main: #F0F4F8;
--bg-card: #FFFFFF; --bg-muted: #E3E8EE; --bg-muted-subtle: #F8FAFC; 
      --bg-primary: #2563EB; --bg-primary-hover: #1D4ED8; --text-primary: #0F172A; 
      --text-secondary: #475569; --text-on-primary: #FFFFFF; --text-accent: #2563EB; 
      --border-color: #CBD5E1;
--border-focus: #2563EB; --ring-color: #2563EB; 
    }
    .pdf-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center;
justify-content: center; z-index: 60; } 
    .pdf-modal { width: 95vw; height: 90vh; background: var(--bg-card); border: 1px solid var(--border-color);
border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; } 
    .pdf-modal-header { padding: 10px; display: flex; justify-content: space-between;
align-items: center; border-bottom: 1px solid var(--border-color); } 
    .pdf-modal-body { flex: 1;
} 
    .pdf-modal-actions { display: flex; gap: 8px; } 
    .compact-field { margin-top: 4px;
} 
    .compact-field label { font-size: 12px; font-weight: 600; margin-bottom: 2px;
} 
    .compact-field .range-hints { font-size: 10px; margin-top: 2px;
} 
    @media (max-width: 600px) { body { font-size: 12px; line-height: 1.4; } } 
  `}</style>
)
interface CorreccionDetallada {
  seccion: string
  detalle: string
}
interface EvaluacionHabilidad {
  habilidad: string
  evaluacion: string
  evidencia: string
}
interface RetroalimentacionEstructurada {
  correccion_detallada?: CorreccionDetallada[]
  evaluacion_habilidades?: EvaluacionHabilidad[]
  resumen_general?: { fortalezas: string; areas_mejora: string }
  puntaje?: string
  nota?: number
  retroalimentacion_alternativas?: { pregunta: string; respuesta_estudiante: string; respuesta_correcta: string }[]
}
/** Rúbrica y pauta estructurada son obligatorias salvo en prueba solo de alternativas (incl. V/F vía mismo modo). */
const formSchema = z
  .object({
    tipoEvaluacion: z.string().default("prueba"),
    rubrica: z.string(),
    puntajeTotal: z
      .string()
      .min(1, "El puntaje total es obligatorio.")
      .regex(/^[0-9]+$/, "El puntaje debe ser un número entero."),
    pauta: z.string().optional(),
    flexibilidad: z.array(z.number()).default([3]),
    nombreProfesor: z.string().optional(),
    nombrePrueba: z.string().optional(),
    departamento: z.string().optional(),
    asignatura: z.string().optional(),
    curso: z.string().optional(),
    fechaEvaluacion: z.date().optional(),
    areaConocimiento: z.string().default("general"),
    nivelEducativo: z.string().default("Educación Media"),
    nombresGrupales: z.string().optional(),
    porcentajeExigencia: z
      .string()
      .min(1, "La exigencia es obligatoria.")
      .regex(/^[0-9]+$/, "Debe ser un número."),
    pautaEstructurada: z.string(),
    pautaCorrectaAlternativas: z.string().optional(),
    tipoPrueba: z.enum(["mixta", "solo_desarrollo", "solo_alternativas"]).default("mixta"),
  })
  .superRefine((data, ctx) => {
    if (data.tipoPrueba === "solo_alternativas") return
    const rub = (data.rubrica ?? "").trim()
    if (rub.length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La rúbrica es necesaria.",
        path: ["rubrica"],
      })
    }
    const pe = (data.pautaEstructurada ?? "").trim()
    if (pe.length < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La pauta de puntajes es obligatoria para rigor.",
        path: ["pautaEstructurada"],
      })
    }
  })

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ""))
    r.onerror = () => reject(r.error ?? new Error("readAsDataURL"))
    r.readAsDataURL(file)
  })
}

/**
 * Data URLs muy grandes (~varios MB en base64) suelen provocar "Failed to fetch" en el navegador
 * aunque el servidor acepte el cuerpo. Solo se reencodea por encima del umbral; si falla, se usa el original.
 */
function shrinkDataUrlIfHuge(dataUrl: string, mime: string): Promise<string> {
  const thresholdChars = 2_000_000
  if (typeof document === "undefined") return Promise.resolve(dataUrl)
  if (dataUrl.length <= thresholdChars) return Promise.resolve(dataUrl)
  const isImg =
    dataUrl.startsWith("data:image/") || (typeof mime === "string" && mime.startsWith("image/"))
  if (!isImg) return Promise.resolve(dataUrl)

  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const maxSide = 2400
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        if (!w || !h) {
          resolve(dataUrl)
          return
        }
        const scale = Math.min(1, maxSide / Math.max(w, h))
        const tw = Math.max(1, Math.round(w * scale))
        const th = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement("canvas")
        canvas.width = tw
        canvas.height = th
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, tw, th)
        resolve(canvas.toDataURL("image/jpeg", 0.92))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

interface FilePreview {
  id: string
  file: File
  previewUrl: string
  dataUrl: string
  /** Id fila `batch_photo_uploads` cuando la imagen viene del escáner móvil. */
  mobileBatchPhotoId?: string
  fromMobileBatch?: boolean
  /** Ruta en bucket batch-scans; permite POST liviano a /api/evaluate vía URL firmada. */
  batchScanStoragePath?: string | null
}

/** Evita POST enormes: imágenes ya en batch-scans se envían como URL firmada a /api/evaluate. */
async function resolveFileUrlsForEvaluate(files: FilePreview[]): Promise<{ urls: string[]; mimes: string[] }> {
  const urls: string[] = []
  const mimes: string[] = []
  for (const f of files) {
    const sp = f.batchScanStoragePath?.trim()
    if (sp) {
      const relativeSignPath = `/api/docente/batch-photo-sign?path=${encodeURIComponent(sp)}`
      const attemptedUrl =
        typeof window !== "undefined" ? `${window.location.origin}${relativeSignPath}` : relativeSignPath
      try {
        const r = await fetch(relativeSignPath)
        const rawText = await r.text()
        let j: { signed_url?: string; error?: string } = {}
        try {
          j = rawText ? (JSON.parse(rawText) as { signed_url?: string; error?: string }) : {}
        } catch {
          j = {}
        }
        if (r.ok && typeof j.signed_url === "string" && j.signed_url.length > 0) {
          urls.push(j.signed_url)
          mimes.push(f.file.type || "image/jpeg")
          continue
        }
        console.error("[batch-photo-sign] Firma fallida (revisar storage_path y respuesta del servidor)", {
          storage_path: sp,
          attemptedUrl,
          responseStatus: r.status,
          responseStatusText: r.statusText,
          responseBodyPreview: rawText.slice(0, 8000),
          parsedJson: j,
          fileId: f.id,
        })
      } catch (netErr) {
        console.error("[batch-photo-sign] Error de red al firmar (fetch lanzó)", {
          storage_path: sp,
          attemptedUrl,
          error:
            netErr instanceof Error
              ? { name: netErr.name, message: netErr.message, stack: netErr.stack }
              : netErr,
          fileId: f.id,
        })
      }
    }
    const slim = await shrinkDataUrlIfHuge(f.dataUrl, f.file.type || "")
    urls.push(slim)
    mimes.push(slim.startsWith("data:image/jpeg") ? "image/jpeg" : f.file.type)
  }
  return { urls, mimes }
}

function displayStudentNameForEvaluateGroup(
  group: { studentName?: string },
  studentGroups: Array<{ id: string; studentName?: string }>,
  groupId: string,
): string {
  const t = group.studentName != null ? String(group.studentName).trim() : ""
  if (t.length > 0) return t
  const idx = studentGroups.findIndex((g) => g.id === groupId)
  return `Alumno ${idx >= 0 ? idx + 1 : 1}`
}
interface AlternativeResult {
  pregunta: string
  respuesta_estudiante: string
  respuesta_correcta: string
} // Definición para el tipo de alternativa
// 🔥 INTERFAZ PARA PAUTA ESTRUCTURADA
interface ItemScore {
  id: string
  maxScore: number
  isDevelopment: boolean
}
// 🔥 FUNCIÓN HELPER PARA PARSEAR LA PAUTA ESTRUCTURADA (Tomada de route.ts para el cálculo local)
const parsePautaEstructurada = (pautaStr: string): ItemScore[] => {
  const items: ItemScore[] = []
  if (!pautaStr) return items

  const pairs = pautaStr
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  for (const pair of pairs) {
    const [id, scoreStr] = pair.split(":").map((s) => s.trim())
    const maxScore = Number.parseInt(scoreStr, 10)

    if (id && !isNaN(maxScore) && maxScore > 0) {
      items.push({
        id: id,
        maxScore: maxScore,
        // Lógica de route.ts: es desarrollo si incluye 'desarrollo' o es P#
        isDevelopment: id.toLowerCase().includes("desarrollo") || id.toLowerCase().match(/^p\d+/) !== null,
      })
    }
  }
  return items
}

// 🔥 FUNCIÓN HELPER PARA CALCULAR LA NOTA (escala chilena 1.0–7.0, curva ligeramente generosa)
const calculateGrade = (score: number, maxScore: number, porcentajeExigencia: number): number => {
  if (maxScore <= 0 || porcentajeExigencia <= 0) return 1.0

  const exigenciaDecimal = Math.min(100, Math.max(1, porcentajeExigencia)) / 100
  const puntosAprobacion = Math.ceil(maxScore * exigenciaDecimal)

  const puntajeEfectivo = Math.max(0, score)

  if (puntajeEfectivo === 0) return 1.0

  const APROBACION_PUNTOS = puntosAprobacion
  const PUNTAJE_MAXIMO = maxScore
  let grade: number

  if (puntajeEfectivo <= APROBACION_PUNTOS) {
    const ratio = Math.min(1, puntajeEfectivo / APROBACION_PUNTOS)
    grade = 1.0 + 3.0 * Math.pow(ratio, 0.95)
    grade = Math.min(4.0, grade)
  } else {
    const remainingPoints = PUNTAJE_MAXIMO - APROBACION_PUNTOS
    if (remainingPoints === 0) return 7.0
    grade = 4.0 + 3.0 * ((puntajeEfectivo - APROBACION_PUNTOS) / remainingPoints)
  }

  return Math.min(7.0, Math.round(grade * 10) / 10)
}

// 🔥 CRÍTICO: NUEVA FUNCIÓN PARA CALCULAR EL PUNTAJE FINAL LOCALMENTE
// Usa la pauta estructurada y las alternativas corregidas (del estado editable)
const calculateFinalScore = (
  pautaEstructuradaStr: string,
  alternativasCorregidas: AlternativeResult[] | undefined,
  detalleDesarrollo: { [key: string]: any } | undefined,
  puntajeTotalMax: number, // Renombrado puntajeTotal a puntajeTotalMax para claridad
  porcentajeExigencia: number,
) => {
  const itemScores = parsePautaEstructurada(pautaEstructuradaStr)
  let scoreAlternativasObtenido = 0
  let scoreDesarrolloObtenido = 0

  // 1. Calcular puntaje de Alternativas/Cerradas (usando datos corregidos)
  if (alternativasCorregidas) {
    for (const alt of alternativasCorregidas) {
      const preguntaId = alt.pregunta.trim().toUpperCase()
      const itemMatch = itemScores.find((scoreItem) => {
        const scoreIdUpper = scoreItem.id.trim().toUpperCase()
        return scoreIdUpper === preguntaId || scoreIdUpper.includes(preguntaId) || preguntaId.includes(scoreIdUpper)
      })

      let maxItemScore = 1
      if (itemMatch) {
        maxItemScore = itemMatch.maxScore
      }

      const correcta = alt.respuesta_correcta ? alt.respuesta_correcta.trim().toUpperCase() : ""
      const extraida = alt.respuesta_estudiante ? alt.respuesta_estudiante.trim().toUpperCase() : ""

      if (correcta && extraida && correcta === extraida) {
        scoreAlternativasObtenido += maxItemScore
      }
    }
  }

  // 2. Calcular puntaje de Desarrollo (usando el último resultado de la IA)
  if (detalleDesarrollo) {
    for (const itemId in detalleDesarrollo) {
      const item = detalleDesarrollo[itemId]
      if (item && item.puntaje) {
        // La IA devuelve "PUNTAJE_OBTENIDO/MAX_ITEM" o solo el número
        const puntajeParts = item.puntaje.toString().split("/")
        const puntajeObtenido = Number.parseInt(puntajeParts[0], 10) || 0

        console.log("[v0] Desarrollo", itemId, "- Puntaje obtenido:", puntajeObtenido)

        scoreDesarrolloObtenido += puntajeObtenido
      }
    }
  }

  console.log(
    "[v0] calculateFinalScore - Alternativas:",
    scoreAlternativasObtenido,
    "Desarrollo:",
    scoreDesarrolloObtenido,
  )

  const finalScore = scoreAlternativasObtenido + scoreDesarrolloObtenido
  const finalNota = calculateGrade(finalScore, puntajeTotalMax, porcentajeExigencia)

  // Replicar lógica de puntos de aprobación para el velocímetro
  const exigenciaDecimal = Math.min(100, porcentajeExigencia) / 100
  const puntosAprobacionCalculados = Math.ceil(puntajeTotalMax * exigenciaDecimal)

  return {
    puntaje: `${finalScore}/${puntajeTotalMax}`,
    nota: finalNota,
    puntosAprobacion: puntosAprobacionCalculados,
    puntosMaximos: puntajeTotalMax,
  }
}

interface StudentGroup {
  id: string
  studentName: string
  studentRut?: string
  files: FilePreview[]
  retroalimentacion?: RetroalimentacionEstructurada
  puntaje?: string
  nota?: number | string
  decimasAdicionales: number
  isEvaluated: boolean
  isEvaluating: boolean
  isValidationStep?: boolean // 🚨 NUEVO: Para el paso de validación OMR
  error?: string
  detalle_desarrollo?: { [key: string]: any }
  alternativas_corregidas?: AlternativeResult[] // 🚨 NUEVO: Para guardar las alternativas corregidas
  // 🔥 AÑADIDO: Puntos clave para la visualización
  puntosAprobacion?: number
  puntosMaximos?: number
  /**
   * Panel temporal de diagnóstico (sin depender de consola/F12).
   * Se rellena en runtime para una evaluación concreta.
   */
  evaluationTrace?: {
    payload: {
      tipoPrueba: string
      evaluatorInstrumentSource: string
      selectedEvaluatorSourceExamId: string
      pautaEstructuradaFinal: string
      pautaCorrectaAlternativasFinal: string
      answerKeyFromTemplateSummary: {
        totalPreguntas: number
        respuestasLength: number
        primeras10: Array<{ pregunta: number; respuestaCorrecta: string }>
      } | null
    }
  }
  /** Id de la evaluación en BD cuando ya fue guardada; permite aplicar cambios de la tabla al resto de la app */
  evaluation_id?: string | null
  /** Evaluación ya creada al promocionar/vincular foto del lote móvil (mismo batch). */
  promotedEvaluationId?: string | null
  shouldUseOfficialAzureOmr?: boolean
  officialOmrActivationReason?: string
  officialOmrIntegrationEnabled?: boolean
  officialOmrEngineSelected?: string
  officialOmrEngineUsed?: string
  officialOmrFallbackUsed?: boolean
  officialOmrFallbackReason?: string | null
  omrDebug?: any
}

/**
 * Indica si el `StudentGroup` en memoria trae el mismo payload que usa «Descargar PDF»
 * (`ReportDocument`). Si es true, el ZIP puede generar el PDF idéntico sin GET a la API.
 */
function studentGroupHasLocalPedagogicalReportPayload(g: StudentGroup): boolean {
  if (!g.isEvaluated || g.error) return false
  if (g.retroalimentacion != null) return true
  const hasPuntaje = typeof g.puntaje === "string" && g.puntaje.includes("/")
  const hasAlts = Array.isArray(g.alternativas_corregidas) && g.alternativas_corregidas.length > 0
  const hasDev = g.detalle_desarrollo != null && Object.keys(g.detalle_desarrollo).length > 0
  return hasPuntaje && (hasAlts || hasDev)
}

type MobileBatchPlacement = {
  preview: FilePreview
  student_index: number | null
  evaluation_id: string | null
}
type MobileBatchSlot = {
  evaluation_id: string
  student_index: number | null
  student_name: string | null
  student_rut: string | null
}

/** Nombres de grupo que puede sobrescribir la sync del lote móvil (slots promovidos). */
function isGenericStudentSlotName(name: string | undefined): boolean {
  if (!name || typeof name !== "string") return true
  const t = name.trim()
  if (t === "" || /^Alumno\s+\d+$/i.test(t)) return true
  if (/^Alumno\s+lote/i.test(t)) return true
  if (/lote/i.test(t) && /índice/i.test(t)) return true
  return false
}

function mergeMobileBatchIntoEvaluatorState(
  prevGroups: StudentGroup[],
  prevUnassigned: FilePreview[],
  placement: MobileBatchPlacement[],
  slots: MobileBatchSlot[],
  apiIds: Set<string>,
): { groups: StudentGroup[]; unassigned: FilePreview[] } {
  let next = prevGroups.map((g) => ({ ...g, files: [...g.files] }))
  for (let gi = 0; gi < next.length; gi++) {
    const g = next[gi]
    const kept: FilePreview[] = []
    for (const f of g.files) {
      if (f.fromMobileBatch && f.mobileBatchPhotoId && !apiIds.has(f.mobileBatchPhotoId)) {
        try {
          URL.revokeObjectURL(f.previewUrl)
        } catch {
          /* noop */
        }
      } else {
        kept.push(f)
      }
    }
    next[gi] = { ...g, files: kept }
  }

  for (const slot of slots) {
    const si = slot.student_index
    if (si == null || si < 1 || si > next.length) continue
    const i = si - 1
    const g = next[i]
    const slotName = slot.student_name != null ? String(slot.student_name).trim() : ""
    const rutRaw = slot.student_rut?.trim()
    const rut = rutRaw ? normalizeRutCanonical(rutRaw) ?? rutRaw : undefined
    let newName = g.studentName
    if (slotName.length > 0 && isGenericStudentSlotName(g.studentName)) newName = slotName
    let newRut = g.studentRut ?? ""
    if (rut && !String(g.studentRut ?? "").trim()) newRut = rut
    next[i] = {
      ...g,
      studentName: newName,
      studentRut: newRut,
      promotedEvaluationId: slot.evaluation_id || g.promotedEvaluationId || null,
    }
  }

  const orphans: FilePreview[] = []
  for (const item of placement) {
    const { preview, student_index, evaluation_id } = item
    if (next.some((g) => g.files.some((f) => f.id === preview.id))) continue
    const gi =
      student_index != null && student_index >= 1 && student_index <= next.length ? student_index - 1 : -1
    if (gi >= 0) {
      const g = next[gi]
      next[gi] = {
        ...g,
        files: [...g.files, preview],
        promotedEvaluationId: evaluation_id || g.promotedEvaluationId || null,
      }
    } else {
      orphans.push(preview)
    }
  }

  let unassigned = prevUnassigned.filter((f) => {
    if (f.fromMobileBatch && f.mobileBatchPhotoId && !apiIds.has(f.mobileBatchPhotoId)) {
      try {
        URL.revokeObjectURL(f.previewUrl)
      } catch {
        /* noop */
      }
      return false
    }
    return true
  })
  for (const p of orphans) {
    if (!unassigned.some((f) => f.id === p.id)) unassigned = [...unassigned, p]
  }
  return { groups: next, unassigned }
}

// *** TIPOS DECLARADOS PARA RESOLVER ERRORES LINT ***
type CaptureMode = "sm_vf" | "terminos_pareados" | "desarrollo" | "closed_answer" | null
interface CameraFeedback {
  confidence: number
  // Agrega aquí otras propiedades si son necesarias para el feedback
}
// *** FIN DE DECLARACIONES DE TIPOS ***

// 🔥 SOLUCIÓN 1: DEFINICIÓN DE VELOCÍMETRO MOVIDA AL PRINCIPIO PARA EVITAR ReferenceError
// (Esto soluciona el problema de ejecución que viste en la consola)
const ExigenciaVelocimeter = ({
  obtenido,
  maximo,
  aprobacion,
}: { obtenido: number; maximo: number; aprobacion: number }) => {
  if (maximo === 0 || aprobacion === 0) return null

  // Asegura que el porcentaje obtenido no supere el 100%
  const porcentajeObtenido = Math.min(100, (obtenido / maximo) * 100)

  // Calcula donde cae el umbral de 4.0 (Puntos de Aprobación) en la barra total
  const porcentajeAprobacion = (aprobacion / maximo) * 100

  const isAprobado = obtenido >= aprobacion

  return (
    <div className="space-y-1 mt-3">
      <div className="relative h-4 w-full bg-gray-200 rounded-full overflow-hidden">
        {/* Barra de progreso obtenida */}
        <div
          style={{ width: `${porcentajeObtenido}%` }}
          className={cn("h-full transition-all duration-700", isAprobado ? "bg-green-500" : "bg-red-500")}
        />
        {/* Marcador de Nota 4.0 */}
        <div
          style={{ left: `${porcentajeAprobacion}%` }}
          className="absolute top-0 bottom-0 w-1 bg-yellow-500 transform -translate-x-1/2"
        >
          {/* Etiqueta del 4.0 */}
          <span className="absolute -top-6 text-[10px] left-1/2 transform -translate-x-1/2 font-bold text-gray-700">
            4.0
          </span>
        </div>
      </div>
      <div className="flex justify-between text-xs text-[var(--text-secondary)] font-semibold">
        <span>0 pts</span>
        <span>{maximo} pts (100%)</span>
      </div>
      {/* Resumen de puntos */}
      <div className="text-sm font-semibold text-[var(--text-primary)] pt-1">
        Puntos Aprobación (4.0): <span className="text-yellow-700">{aprobacion} pts</span>
      </div>
    </div>
  )
}

const ImageMagnifier = ({ src, alt }: { src: string; alt: string }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [zoom, setZoom] = useState(1)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setIsOpen(true)} className="gap-2">
        <Eye className="h-4 w-4" />
        Ver imagen original
      </Button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative max-w-7xl max-h-[90vh] overflow-auto bg-white rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b p-3 flex justify-between items-center z-10">
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                  -
                </Button>
                <span className="px-3 py-1 text-sm font-medium">{Math.round(zoom * 100)}%</span>
                <Button size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                  +
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4">
              <img
                src={src || "/placeholder.svg"}
                alt={alt}
                style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                className="transition-transform"
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** FASE 3: mapeo API → buildEvaluationBase (sin tocar servidor). */
type SourceExamItemApiRow = {
  id: string
  item_number?: number | null
  item_text?: string | null
  axis_id?: string | null
  skill_id?: string | null
  question_type?: string | null
  correct_answer?: string | null
  max_score?: number | null
  rubric_text?: string | null
}

function mapSourceExamApiRowsToInputs(rows: unknown[]): EvaluationBaseSourceExamItemInput[] {
  if (!Array.isArray(rows)) return []
  const out: EvaluationBaseSourceExamItemInput[] = []
  for (const row of rows) {
    const r = row as SourceExamItemApiRow
    const id = typeof r.id === "string" ? r.id : ""
    if (!id) continue
    const num = r.item_number
    out.push({
      rowId: id,
      item_number: typeof num === "number" ? num : typeof num === "string" ? parseInt(String(num), 10) || null : null,
      item_text: typeof r.item_text === "string" ? r.item_text : null,
      axis_id: typeof r.axis_id === "string" ? r.axis_id : null,
      skill_id: typeof r.skill_id === "string" ? r.skill_id : null,
      question_type: typeof r.question_type === "string" ? r.question_type : null,
      correct_answer:
        typeof r.correct_answer === "string"
          ? r.correct_answer.trim() || null
          : r.correct_answer != null && (typeof r.correct_answer === "number" || typeof r.correct_answer === "boolean")
            ? String(r.correct_answer).trim().toUpperCase() || null
            : null,
      max_score: typeof r.max_score === "number" ? r.max_score : typeof r.max_score === "string" ? parseInt(String(r.max_score), 10) || null : null,
      rubric_text: typeof r.rubric_text === "string" ? r.rubric_text : null,
    })
  }
  return out
}

/** Alineado con batch secuencial: meta.batchSize = 1 (app/api/evaluate/batch/route.ts). */
const EVALUATE_BATCH_PARALLEL_SIZE = 1
const SEQUENTIAL_EVALUATION_DELAY_MS = 1200
const MOBILE_BATCH_SYNC_TIMEOUT_MS = 15000
/** Polling de respaldo cuando hay lote móvil (Realtime sigue siendo el disparador principal). */
const MOBILE_BATCH_POLL_INTERVAL_MS = 13000
/** Coalescer ráfagas INSERT (Realtime + BroadcastChannel) para no spamear sync. */
const MOBILE_BATCH_REALTIME_DEBOUNCE_MS = 550

/** Misma configuración de red para todo GET de detalle de evaluación (modal informe + historial). */
const INFORME_DETAIL_FETCH_INIT: RequestInit = {
  cache: "no-store",
  credentials: "include",
  headers: { Pragma: "no-cache", "Cache-Control": "no-cache" },
}

function informeHttpErrorKind(status: number | undefined): string {
  if (status === 401) return "401_UNAUTHORIZED"
  if (status === 403) return "403_FORBIDDEN"
  if (status === 404) return "404_NOT_FOUND"
  if (status != null && status >= 500) return "5XX_SERVER"
  if (status != null) return `HTTP_${status}`
  return "CLIENT_OR_NETWORK"
}

function logInformeFetchFailure(
  step: string,
  url: string,
  res: Response | null,
  bodyText: string,
  parsed: unknown
) {
  console.error("[Informe] fetch falló", {
    step,
    url,
    kind: informeHttpErrorKind(res?.status),
    status: res?.status,
    statusText: res?.statusText,
    bodyLength: bodyText.length,
    bodyText: bodyText.slice(0, 8000),
    parsed,
  })
}

async function fetchInformeDetailRaw(url: string): Promise<{
  res: Response
  bodyText: string
  parsed: Record<string, unknown> | null
}> {
  const res = await fetch(url, INFORME_DETAIL_FETCH_INIT)
  const bodyText = await res.text()
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : null
  } catch {
    parsed = null
  }
  return { res, bodyText, parsed }
}

/** Hint opcional desde la fila de lista (Evaluaciones/Cursos) para abrir el modal aunque falle el GET puntual. */
type InformeRowHint = {
  title?: string | null
  subject?: string | null
  course_id?: string | null
  course_label?: string | null
  evaluated_at?: string | null
  grade_chile?: number | null
}

export default function EvaluatorClient() {
  const enablePedagogy = process.env.NEXT_PUBLIC_ENABLE_PEDAGOGY === "true"
  const [activeTab, setActiveTab] = useState("presentacion")
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const [userEmail, setUserEmail] = useState<string>("")
  const [unassignedFiles, setUnassignedFiles] = useState<FilePreview[]>([])
  const evaluatorStep2FilesRef = useRef<{ groups: StudentGroup[]; unassigned: FilePreview[] }>({
    groups: [],
    unassigned: [],
  })
  /** Sellado de lote (UUID); persiste en evaluations.batch_id. No interfiere con OMR. */
  const evaluationBatchIdRef = useRef<string | null>(null)
  const [evaluationBatchIdUi, setEvaluationBatchIdUi] = useState<string | null>(null)
  /** Embudo UTP → Dirección: pending_utp | validated | rejected | null si sin fila. */
  const [batchInstitutionalStatus, setBatchInstitutionalStatus] = useState<string | null>(null)
  const [batchUtpObservations, setBatchUtpObservations] = useState<string | null>(null)
  const [submitBatchUtpLoading, setSubmitBatchUtpLoading] = useState(false)
  const [studentGroups, setStudentGroups] = useState<StudentGroup[]>([])
  /** ZIP informes de corrección (Fase 1, solo cliente + GET /api/evaluations/[id]). */
  const [correctionReportsZipBusy, setCorrectionReportsZipBusy] = useState(false)
  const [correctionReportsZipProgress, setCorrectionReportsZipProgress] = useState<{
    current: number
    total: number
    label: string
  } | null>(null)

  useEffect(() => {
    const bid = evaluationBatchIdUi
    if (!bid) {
      setBatchInstitutionalStatus(null)
      setBatchUtpObservations(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`/api/evaluation-batches/release-status?batch_id=${encodeURIComponent(bid)}`)
        const j = (await r.json().catch(() => ({}))) as {
          status?: string | null
          utp_observations?: string | null
        }
        if (cancelled) return
        if (r.ok) {
          setBatchInstitutionalStatus(typeof j.status === "string" ? j.status : null)
          setBatchUtpObservations(typeof j.utp_observations === "string" ? j.utp_observations : null)
        } else {
          setBatchInstitutionalStatus(null)
          setBatchUtpObservations(null)
        }
      } catch {
        if (!cancelled) {
          setBatchInstitutionalStatus(null)
          setBatchUtpObservations(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [evaluationBatchIdUi])

  /** Ref alineado con el UUID mostrado (sync inmediato para fetch / Realtime / BroadcastChannel). */
  useEffect(() => {
    evaluationBatchIdRef.current = evaluationBatchIdUi
  }, [evaluationBatchIdUi])

  useEffect(() => {
    if (evaluationBatchIdUi) writeDocenteActiveBatchId(evaluationBatchIdUi)
  }, [evaluationBatchIdUi])

  /** Al abrir /evaluar, reutilizar el mismo lote que la estación docente (QR / grilla). */
  useEffect(() => {
    const p = readDocenteActiveBatchId()
    if (p) {
      setEvaluationBatchIdUi((prev) => prev ?? p)
    }
  }, [])

  useEffect(() => {
    evaluatorStep2FilesRef.current = { groups: studentGroups, unassigned: unassignedFiles }
  }, [studentGroups, unassignedFiles])

  const [isCameraOpen, setIsCameraOpen] = useState(false)
  // 🚨 NUEVOS ESTADOS PARA CAPTURA GUIADA
  const [isCaptureModeSelectionOpen, setIsCaptureModeSelectionOpen] = useState(false)
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null)
  // 🔥 AÑADIDO: Estado para el feedback de certeza en tiempo real
  const [cameraFeedback, setCameraFeedback] = useState<CameraFeedback | null>(null)

  // Estados para OMR de respuestas cerradas
  const [isClosedAnswerOMROpen, setIsClosedAnswerOMROpen] = useState(false)
  const [isRealtimeOMROpen, setIsRealtimeOMROpen] = useState(false)
  const [isTemplateOverlayOMROpen, setIsTemplateOverlayOMROpen] = useState(false)
  const [isRobustOMRLibeliaOpen, setIsRobustOMRLibeliaOpen] = useState(false)
  const [isOMRSheetGeneratorOpen, setIsOMRSheetGeneratorOpen] = useState(false)
  const [closedAnswerImageUrl, setClosedAnswerImageUrl] = useState<string>("")
  const [closedAnswerTargetGroupId, setClosedAnswerTargetGroupId] = useState<string | null>(null)

  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [classSize, setClassSize] = useState(1)
  /** Imágenes por estudiante para agrupación automática (solo UI, no altera contratos). */
  const [imagesPerStudent, setImagesPerStudent] = useState(1)
  const [isExtractingNames, setIsExtractingNames] = useState(false)
  const [theme, setTheme] = useState("theme-ocaso")
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null)
  /** Foco en un estudiante en Paso 3: al seleccionar una tarjeta del panorama, solo se muestra su detalle (reversible con "Ver todos"). */
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null)
  /** Variante de plantilla OMR enviada a /api/evaluate (flujo oficial; no toca experimental). */
  const [selectedOmrTemplateVariant, setSelectedOmrTemplateVariant] = useState<
    "odd_even_dual_column" | "sequential_dual_column"
  >("odd_even_dual_column")
  const [omrClosedLayoutMode, setOmrClosedLayoutMode] = useState<
    "auto" | "standard" | "interleaved_development"
  >("auto")
  // Progreso de evaluacion por lotes

  const batchInitial = { isActive: false, totalItems: 0, completedItems: 0, successCount: 0, errorCount: 0, currentBatch: 0, totalBatches: 0 }
  const [batchProgress, setBatchProgress] = useState(batchInitial)
  const isMobile = typeof window !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const supabaseBrowser = React.useMemo(() => createClientComponentClient(), [])
  const mobileBatchSyncingRef = useRef(false)
  const mobileBatchSyncPendingRef = useRef(false)
  /** En navegador `setTimeout` devuelve number; evita choque con tipo Node `Timeout`. */
  const mobileBatchRealtimeDebounceRef = useRef<number | null>(null)
  const syncMobileBatchPhotosRef = useRef<() => Promise<void>>(async () => {})
  const {
    evaluate,
    isLoading,
    answerKey,
    saveAnswerKey,
    clearAnswerKey,
    answerKeyToPauta,
    evaluateDiagnostic,
    clearEvaluateDiagnostic,
    reportEvaluateDiagnostic,
  } = useEvaluator()
  const { toast } = useToast()

  // Estado para el modal de plantilla de respuestas del profesor
  const [isAnswerKeyModalOpen, setIsAnswerKeyModalOpen] = useState(false)
  // Sesión MVP: persistencia Supabase (solo perfil desde API; sin localStorage para teacher_id)
  const [mainProfile, setMainProfile] = useState<{ profile: { teacher_id: string | null; school_id: string | null; role?: string | null } | null; user: { id: string; email: string | null } | null } | null>(null)
  const [showOnboardingModal, setShowOnboardingModal] = useState(false)
  const [onboardingForm, setOnboardingForm] = useState({ teacher_name: "", school_name: "", department: "" })
  const [onboardingSaving, setOnboardingSaving] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [onboardRefreshFailed, setOnboardRefreshFailed] = useState(false)
  const [hasSessionTeacher, setHasSessionTeacher] = useState(false)
  // Historial (Fase 2A): perfil y evaluaciones del usuario logueado
  const [historialProfile, setHistorialProfile] = useState<{ profile: { teacher_id: string; role?: string | null } | null; user: { id: string; email: string | null } | null } | null>(null)
  const [historialEvaluations, setHistorialEvaluations] = useState<Array<{ id: string; title: string | null; subject: string | null; evaluated_at: string | null; grade_chile: number | null }>>([])
  const [historialDetailId, setHistorialDetailId] = useState<string | null>(null)
  const [historialDetail, setHistorialDetail] = useState<{ evaluation: unknown; items: unknown[]; summary: unknown } | null>(null)
  const [historialOnboarding, setHistorialOnboarding] = useState({ teacher_name: "", school_name: "", department: "" })
  const [historialOnboardError, setHistorialOnboardError] = useState<string | null>(null)
  const [historialLoading, setHistorialLoading] = useState(false)
  const [historialFilters, setHistorialFilters] = useState({ courseId: "", from: "", to: "" })
  const [historialFetchKey, setHistorialFetchKey] = useState(0)
  // Evaluaciones guardadas: listado y detalle
  const [evaluacionesList, setEvaluacionesList] = useState<Array<{ id: string; title: string | null; course_id: string | null; subject: string | null; evaluated_at: string | null; grade_chile: number | null; status?: string | null; student_count?: number; first_student_name?: string | null }>>([])
  const [evaluacionesListLoading, setEvaluacionesListLoading] = useState(false)
  const [evaluacionesListUnauth, setEvaluacionesListUnauth] = useState(false)
  const [evaluacionesListMessage, setEvaluacionesListMessage] = useState<string | null>(null)
  const [evaluacionesListReason, setEvaluacionesListReason] = useState<string | null>(null)
  const [evaluacionesListError, setEvaluacionesListError] = useState<string | null>(null)
  const [fixTeacherIdResult, setFixTeacherIdResult] = useState<Record<string, unknown> | null>(null)
  const [lastSavedEvaluationId, setLastSavedEvaluationId] = useState<string | null>(null)
  const [lastSaveReason, setLastSaveReason] = useState<string | null>(null)
  const [lastSaveError, setLastSaveError] = useState<string | null>(null)
  const [diagnosisOpen, setDiagnosisOpen] = useState(false)
  const [diagnosisResult, setDiagnosisResult] = useState<object | null>(null)
  const [courseDiagnosisOpen, setCourseDiagnosisOpen] = useState(false)
  const [courseDiagnosisLabel, setCourseDiagnosisLabel] = useState<string | null>(null)
  const [courseDiagnosisData, setCourseDiagnosisData] = useState<{
    course_label: string
    students_count: number
    evaluations_count: number
    axes: Array<{ axis_name: string; accuracy: number }>
    skills: Array<{ skill_name: string; axis_name: string; accuracy: number }>
    strongest_skill: string | null
    weakest_skill: string | null
    summary: { strongest_axis: string | null; weakest_axis: string | null }
    // compat lectura antigua
    course?: string
  } | null>(null)
  const [courseDiagnosisRaw, setCourseDiagnosisRaw] = useState<object | null>(null)
  const [showDiagnosticoCrudo, setShowDiagnosticoCrudo] = useState(false)
  const [courseDiagnosisBackfillLoading, setCourseDiagnosisBackfillLoading] = useState(false)
  const [courseDiagnosisLoading, setCourseDiagnosisLoading] = useState(false)
  const [pedagogicalAnalysisEvalId, setPedagogicalAnalysisEvalId] = useState<string | null>(null)
  const [pedagogicalAnalysisEvalLabel, setPedagogicalAnalysisEvalLabel] = useState<string | null>(null)
  const [pedagogicalAnalysisStudentName, setPedagogicalAnalysisStudentName] = useState<string | null>(null)
  const [pedagogicalAnalysisCourseLabel, setPedagogicalAnalysisCourseLabel] = useState<string | null>(null)
  const [studentPedagogicalLoadingId, setStudentPedagogicalLoadingId] = useState<string | null>(null)
  const [coursePedagogicalSummaryOpen, setCoursePedagogicalSummaryOpen] = useState(false)
  const [coursePedagogicalSummaryId, setCoursePedagogicalSummaryId] = useState<string | null>(null)
  const [coursePedagogicalSummaryLabel, setCoursePedagogicalSummaryLabel] = useState<string | null>(null)

  const [batchZipDialogOpen, setBatchZipDialogOpen] = useState(false)
  const [batchZipTargetId, setBatchZipTargetId] = useState<string | null>(null)
  const [batchZipHistoryExamTitle, setBatchZipHistoryExamTitle] = useState<string | null>(null)
  const [batchZipHistoryCourseLabel, setBatchZipHistoryCourseLabel] = useState<string | null>(null)
  const [batchExportsRefreshKey, setBatchExportsRefreshKey] = useState(0)
  const [batchExportsList, setBatchExportsList] = useState<
    Array<{
      id: string
      batch_id: string
      zip_filename: string
      exam_title: string | null
      course_label: string | null
      evaluation_count: number
      created_at: string
    }>
  >([])
  const [batchExportsLoading, setBatchExportsLoading] = useState(false)
  const [batchExportsError, setBatchExportsError] = useState<string | null>(null)

  /** Deep link desde panel docente: /evaluar?tab=mis-archivos&batch=<uuid>&exam=&curso= */
  useEffect(() => {
    if (typeof window === "undefined") return
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get("tab") === "mis-archivos") {
        setActiveTab("mis-archivos")
      }
      const batch = params.get("batch")?.trim() ?? ""
      if (batch && uuidRe.test(batch)) {
        setBatchZipTargetId(batch)
        const exam = params.get("exam")
        const curso = params.get("curso")
        if (exam != null && exam !== "") setBatchZipHistoryExamTitle(exam)
        if (curso != null && curso !== "") setBatchZipHistoryCourseLabel(curso)
        setBatchZipDialogOpen(true)
        setActiveTab("mis-archivos")
      }
    } catch {
      /* URL inválida */
    }
  }, [])

  /** Abre el resumen pedagógico del curso. Mismo handler en Cursos, Evaluaciones y detalle. */
  const openCoursePedagogicalSummary = useCallback((courseId: string, courseLabel?: string | null) => {
    const id = courseId != null && String(courseId).trim() !== "" ? String(courseId).trim() : "Sin curso"
    const label = (courseLabel != null && String(courseLabel).trim() !== "") ? String(courseLabel).trim() : id
    setCoursePedagogicalSummaryId(id)
    setCoursePedagogicalSummaryLabel(label)
    setCoursePedagogicalSummaryOpen(true)
  }, [])

  const [evaluacionesListDebug, setEvaluacionesListDebug] = useState<{ teacher_id_used: string | null; rows: number } | null>(null)
  const [evaluacionesDiagnoseResult, setEvaluacionesDiagnoseResult] = useState<object | null>(null)
  // Dashboard pedagógico (solo si ENABLE_PEDAGOGY)
  const [dashboardEvaluationId, setDashboardEvaluationId] = useState<string | null>(null)
  const [dashboardMode, setDashboardMode] = useState<"normal" | "simce">("normal")
  const [dashboardList, setDashboardList] = useState<Array<{ id: string; title: string | null }>>([])
  const [dashboardListLoading, setDashboardListLoading] = useState(false)
  const [dashboardAnalysis, setDashboardAnalysis] = useState<{ bySkill: Array<{ skill_id: string; skill_name: string; correct: number; total: number; accuracy: number; level?: string }>; byAxis: Array<{ axis_id: string; axis_name: string; correct: number; total: number; accuracy: number; level?: string }>; message?: string } | null>(null)
  const [dashboardAnalysisLoading, setDashboardAnalysisLoading] = useState(false)
  const [dashboardAnalysisError, setDashboardAnalysisError] = useState<string | null>(null)
  const [dashboardTagsModalOpen, setDashboardTagsModalOpen] = useState(false)
  const [dashboardCatalog, setDashboardCatalog] = useState<{ axes: Array<{ id: string; name: string }>; skills: Array<{ id: string; axis_id: string; name: string }> }>({ axes: [], skills: [] })
  const [dashboardDetailItems, setDashboardDetailItems] = useState<Array<{ question_number: number }>>([])
  const [dashboardTagDrafts, setDashboardTagDrafts] = useState<Record<number, { axis_id: string; skill_id: string }>>({})
  const [dashboardTagsSaving, setDashboardTagsSaving] = useState(false)
  const [evaluacionesIsAdmin, setEvaluacionesIsAdmin] = useState(false)
  const [evaluacionesDetailId, setEvaluacionesDetailId] = useState<string | null>(null)
  const [evaluacionesDetail, setEvaluacionesDetail] = useState<{ evaluation: Record<string, unknown>; evaluation_items: Array<Record<string, unknown>>; evaluation_summaries: Record<string, unknown> | null } | null>(null)
  const [evaluacionesDetailError, setEvaluacionesDetailError] = useState<string | null>(null)
  const [evaluacionesDetailLoading, setEvaluacionesDetailLoading] = useState(false)
  const [evaluacionesDetailItemsSaving, setEvaluacionesDetailItemsSaving] = useState(false)
  const [evaluacionesDetailItemsDraft, setEvaluacionesDetailItemsDraft] = useState<Array<{ question_number: number; student_answer?: string; correct_answer?: string; is_correct?: boolean; score_obtained?: number; score_max?: number }> | null>(null)
  const [evaluacionesRecomputeLoading, setEvaluacionesRecomputeLoading] = useState(false)
  const [applyChangesGroupId, setApplyChangesGroupId] = useState<string | null>(null)
  const [lastRecomputeResult, setLastRecomputeResult] = useState<object | null>(null)
  const [showRecomputeResult, setShowRecomputeResult] = useState(false)
  // Pruebas base: modal para asociar evaluación a prueba base (capa aditiva, no toca scoring ni informe)
  const [associateSourceExamOpen, setAssociateSourceExamOpen] = useState(false)
  const [sourceExamsForAssociate, setSourceExamsForAssociate] = useState<Array<{ id: string; title: string | null }>>([])
  const [associateSourceExamLoading, setAssociateSourceExamLoading] = useState(false)
  const [selectedSourceExamIdForAssociate, setSelectedSourceExamIdForAssociate] = useState<string>("")
  // Asociar esta prueba base a todo el curso (masivo)
  const [coursesForBulkAssociate, setCoursesForBulkAssociate] = useState<Array<{ course_id: string; total_evaluations: number }>>([])
  const [selectedCourseIdForBulk, setSelectedCourseIdForBulk] = useState<string>("")
  const [bulkAssociateConfirmOpen, setBulkAssociateConfirmOpen] = useState(false)
  const [bulkAssociateLoading, setBulkAssociateLoading] = useState(false)
  /** FASE 3 / FREEZE_EVALUATION_BASE_CERRADAS: prueba base opcional en el evaluador (no sustituye el formulario). */
  const [evaluatorSourceExamOptions, setEvaluatorSourceExamOptions] = useState<Array<{ id: string; title: string | null }>>([])
  const [evaluatorSourceExamListLoading, setEvaluatorSourceExamListLoading] = useState(false)
  /** Primera carga de `/api/source-exams` en esta vista del evaluador (para avisos de prueba base guiada). */
  const [evaluatorSourceExamListHydrated, setEvaluatorSourceExamListHydrated] = useState(false)
  const [selectedEvaluatorSourceExamId, setSelectedEvaluatorSourceExamId] = useState<string>("")
  const [evaluatorEvaluationBaseSnapshot, setEvaluatorEvaluationBaseSnapshot] = useState<EvaluationBase | null>(null)
  const [evaluatorLastSourceExamPayload, setEvaluatorLastSourceExamPayload] = useState<{
    title: string | null
    items: EvaluationBaseSourceExamItemInput[]
  } | null>(null)
  const [evaluatorSourceExamItemsLoading, setEvaluatorSourceExamItemsLoading] = useState(false)
  const [evaluatorInstrumentSource, setEvaluatorInstrumentSource] = useState<"manual" | "source_exam" | "both">("manual")
  const lastActiveEvaluatorSourceExamIdRef = useRef<string>("")
  /** Solo development: diagnóstico flujo Ver informe */
  const [verDebug, setVerDebug] = useState<{ evaluationId: string; status: number; error: string | null; payload: unknown } | null>(null)
  /** Solo development: diagnóstico flujo Archivar */
  const [archiveDebug, setArchiveDebug] = useState<{ total: number; rows: Array<{ id: string; status: string | null; canShowArchive: boolean }>; lastClick?: string; lastResponse?: { status: number; json: unknown } } | null>(null)
  // DATA_SCIENCE_FIX_V1: confirmacion modal para borrado fisico.
  const [deleteEvaluationDialog, setDeleteEvaluationDialog] = useState<{ open: boolean; id: string | null; title: string | null }>({
    open: false,
    id: null,
    title: null,
  })
  const [deleteEvaluationLoading, setDeleteEvaluationLoading] = useState(false)
  /** Solo development: panel Debug UI colapsable */
  const [debugPanelOpen, setDebugPanelOpen] = useState(false)
  const [studentsModalEvalId, setStudentsModalEvalId] = useState<string | null>(null)
  const [studentsModalList, setStudentsModalList] = useState<Array<{ student_name: string }>>([])
  const [studentsModalLoading, setStudentsModalLoading] = useState(false)
  const [studentsModalSearch, setStudentsModalSearch] = useState("")
  const [evaluacionEditId, setEvaluacionEditId] = useState<string | null>(null)
  const [evaluacionEditForm, setEvaluacionEditForm] = useState({
    title: "",
    subject: "",
    course_id: "",
    exam_type: "",
    pedagogy_mode: "",
    source_exam_id: "",
  })
  const [showRetrySaveButton, setShowRetrySaveButton] = useState(false)
  const lastFailedSaveRef = React.useRef<{ result: Record<string, unknown>; opts: { teacher_id?: string; school_id?: string; title?: string; subject?: string; course_id?: string; student_name?: string; student_rut?: string } } | null>(null)

  const [studentsList, setStudentsList] = useState<Array<{ id: string; student_name: string; course_label: string | null; evaluations_count: number; avg_score: number | null }>>([])
  const [studentsListLoading, setStudentsListLoading] = useState(false)
  const [studentsListCourseFilter, setStudentsListCourseFilter] = useState("")
  const [studentsListSearch, setStudentsListSearch] = useState("")
  const [lastStudentSyncResult, setLastStudentSyncResult] = useState<{
    ok: boolean
    evaluation_id: string
    received_student_name: string
    received_course_label: string | null
    normalized_student_name: string
    student_profile_id: string | null
    created_or_existing: "created" | "existing" | null
    message: string
  } | null>(null)
  const [studentsListFetchKey, setStudentsListFetchKey] = useState(0)
  const [studentsListError, setStudentsListError] = useState<string | null>(null)
  const [studentHistoryId, setStudentHistoryId] = useState<string | null>(null)
  const [studentHistoryData, setStudentHistoryData] = useState<{
    student: { id: string; student_name: string; course_label: string | null }
    evaluations: Array<{ evaluation_id: string; title: string | null; subject: string | null; evaluated_at: string | null; score: number | null }>
    skills: Array<{ axis_name: string; skill_name: string; accuracy: number }>
    summary: { average_grade: number | null; strongest_skill: string | null; weakest_skill: string | null }
  } | null>(null)
  const [studentHistoryLoading, setStudentHistoryLoading] = useState(false)
  const [studentHistoryError, setStudentHistoryError] = useState<string | null>(null)
  const [studentHistoryRaw, setStudentHistoryRaw] = useState<object | null>(null)
  const [showDiagnosticoPerfil, setShowDiagnosticoPerfil] = useState(false)

  // Cursos / Carpetas: solo selectedCourseId (qué carpeta está abierta). Lista viene de evaluacionesList.
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)

  /** Tipo único para fila de evaluación normalizada (tabla Evaluaciones, Cursos, detalle). */
  interface EvaluationRowNormalized {
    id: string
    title: string | null
    course_id: string | null
    subject: string | null
    evaluated_at: string | null
    grade_chile: number | null
    status: string
    student_count: number
    first_student_name: string | null
  }

  function normalizeEvaluation(ev: { id: string; title?: string | null; course_id?: string | null; course_label?: string | null; course_display?: string | null; subject?: string | null; evaluated_at?: string | null; grade_chile?: number | null; status?: string | null; student_count?: number; first_student_name?: string | null }): EvaluationRowNormalized {
    const courseDisplay = ev.course_display ?? ev.course_label ?? ev.course_id
    return {
      id: ev.id,
      title: ev.title ?? "Evaluación sin título",
      subject: ev.subject ?? "Sin asignatura",
      course_id: courseDisplay != null && String(courseDisplay).trim() !== "" ? courseDisplay : "Sin curso",
      evaluated_at: ev.evaluated_at ?? null,
      status: ev.status ?? "draft",
      grade_chile: ev.grade_chile ?? null,
      student_count: ev.student_count ?? 0,
      first_student_name: ev.first_student_name ?? null,
    }
  }

  /** Cursos/Carpetas derivados solo desde la lista normalizada. status === "archived" => archived; resto => active. */
  function groupByCourse(normalized: EvaluationRowNormalized[]): Record<string, { active: EvaluationRowNormalized[]; archived: EvaluationRowNormalized[] }> {
    const courses: Record<string, { active: EvaluationRowNormalized[]; archived: EvaluationRowNormalized[] }> = {}
    normalized.forEach((ev) => {
      const course = ev.course_id ?? "Sin curso"
      if (!courses[course]) courses[course] = { active: [], archived: [] }
      if (ev.status === "archived") courses[course].archived.push(ev)
      else courses[course].active.push(ev)
    })
    return courses
  }

  /** Misma clave de agrupación que `groupByCourse` pero sobre filas crudas de /api/evaluations/list. */
  function listEvalCourseTabKey(e: {
    course_display?: string | null
    course_label?: string | null
    course_id?: string | null
  }): string {
    const d = e.course_display ?? e.course_label ?? e.course_id
    return d != null && String(d).trim() !== "" ? String(d).trim() : "Sin curso"
  }

  const openCourseBatchZip = useCallback(
    (courseTabKey: string) => {
      const matching = evaluacionesList.filter((ev) => (ev.status ?? "draft") !== "archived" && listEvalCourseTabKey(ev) === courseTabKey)
      const batches = matching
        .map((ev) => String((ev as { batch_id?: string | null }).batch_id ?? "").trim())
        .filter((b) => b.length > 0)
      if (batches.length === 0) {
        toast({
          title: "Sin lote en este curso",
          description:
            "Las evaluaciones activas no tienen batch_id. Usa el Evaluador con un lote activo o vincula las evaluaciones a un lote antes de exportar.",
          variant: "destructive",
        })
        return
      }
      const counts = new Map<string, number>()
      for (const b of batches) counts.set(b, (counts.get(b) ?? 0) + 1)
      let best = batches[0]!
      let bestN = 0
      counts.forEach((n, b) => {
        if (n > bestN) {
          bestN = n
          best = b
        }
      })
      setBatchZipHistoryExamTitle(null)
      setBatchZipHistoryCourseLabel(courseTabKey)
      setBatchZipTargetId(best)
      setBatchZipDialogOpen(true)
    },
    [evaluacionesList, toast],
  )
  const [evaluationStudents, setEvaluationStudents] = useState<Array<{ student_name: string; created_at: string | null }>>([])

  /** Una sola función de carga: lista de evaluaciones para Evaluaciones y Cursos. Se llama al entrar a la pestaña o al Recargar. */
  const loadEvaluationsList = useCallback(async () => {
    setEvaluacionesListLoading(true)
    setEvaluacionesListError(null)
    try {
      const r = await fetch("/api/evaluations/list", { cache: "no-store", credentials: "include" })
      const j = await r.json()
      if (r.ok) {
        setEvaluacionesList(j.evaluations ?? [])
        setEvaluacionesIsAdmin(!!j.isAdmin)
        setEvaluacionesListUnauth(false)
        setEvaluacionesListMessage(typeof j.message === "string" ? j.message : null)
        setEvaluacionesListReason(typeof j.reason === "string" ? j.reason : null)
        setEvaluacionesListDebug(j.debug ?? null)
        setEvaluacionesListError(null)
      } else {
        setEvaluacionesList([])
        setEvaluacionesListUnauth(r.status === 401)
        setEvaluacionesListDebug(r.status === 500 ? (j.debug ?? null) : null)
        setEvaluacionesListReason(null)
        const errText = r.status === 500 && (j.step || j.message)
          ? (j.step ? `[${j.step}] ${j.message || j.error || "Error"}` : (j.message || j.error || "Error"))
          : (j.error || (r.status === 401 ? null : "Error al cargar evaluaciones"))
        setEvaluacionesListError(errText || null)
      }
    } catch (e) {
      setEvaluacionesList([])
      setEvaluacionesListReason(null)
      setEvaluacionesListError("No se pudo cargar la lista de evaluaciones.")
    } finally {
      setEvaluacionesListLoading(false)
    }
  }, [])

  /** Lista de estudiantes (pestaña Estudiantes). Se puede llamar tras sync-student. */
  const loadStudentsList = useCallback(async () => {
    setStudentsListLoading(true)
    setStudentsListError(null)
    try {
      const params = new URLSearchParams()
      if (studentsListCourseFilter.trim()) params.set("course_label", studentsListCourseFilter.trim())
      if (studentsListSearch.trim()) params.set("search", studentsListSearch.trim())
      const r = await fetch(`/api/students/list?${params}`, { cache: "no-store" })
      const j = await r.json()
      const raw = j.students ?? []
      setStudentsList(raw.map((s: { id: string; student_name: string; course_label: string | null; evaluations_count?: number; evaluation_count?: number; avg_score?: number | null }) => ({
        id: s.id,
        student_name: s.student_name,
        course_label: s.course_label,
        evaluations_count: s.evaluations_count ?? s.evaluation_count ?? 0,
        avg_score: s.avg_score ?? null,
      })))
      if (!r.ok) setStudentsListError(j.error || "Error al cargar estudiantes")
    } catch (e) {
      setStudentsList([])
      setStudentsListError(e instanceof Error ? e.message : "Error al cargar lista de estudiantes")
    } finally {
      setStudentsListLoading(false)
    }
  }, [studentsListCourseFilter, studentsListSearch])

  /** Refresca el detalle de la evaluación abierta (tras edición manual del profesor). */
  const refetchEvaluacionDetail = useCallback(async () => {
    if (!evaluacionesDetailId) return
    setEvaluacionesDetailLoading(true)
    setEvaluacionesDetailError(null)
    const url = `/api/evaluations/${encodeURIComponent(evaluacionesDetailId)}`
    try {
      const { res, bodyText, parsed } = await fetchInformeDetailRaw(url)
      const j = parsed
      if (res.ok && j?.evaluation) {
        const rawItems = j.evaluation_items ?? j.items
        const itemsArr = Array.isArray(rawItems) ? (rawItems as Array<Record<string, unknown>>) : []
        setEvaluacionesDetail({
          evaluation: j.evaluation as Record<string, unknown>,
          evaluation_items: itemsArr,
          evaluation_summaries: (j.evaluation_summaries ?? j.summary ?? null) as Record<string, unknown> | null,
        })
        setEvaluacionesDetailItemsDraft(null)
        setEvaluacionesDetailError(null)
      } else {
        logInformeFetchFailure("refetchEvaluacionDetail", url, res, bodyText, j ?? bodyText)
        // Conservar el detalle ya visible; sin mensaje bloqueante (regla piloto / reversible).
        setEvaluacionesDetailError(null)
      }
    } catch (e) {
      logInformeFetchFailure("refetchEvaluacionDetail (excepción)", url, null, "", { error: e instanceof Error ? e.message : String(e) })
      setEvaluacionesDetailError(null)
    } finally {
      setEvaluacionesDetailLoading(false)
    }
  }, [evaluacionesDetailId])

  const informeHintFromListId = useCallback(
    (evaluationId: string): InformeRowHint | null => {
      const row = evaluacionesList.find((x) => x.id === evaluationId)
      if (!row) return null
      const r = row as { course_label?: string | null; course_display?: string | null }
      return {
        title: row.title,
        subject: row.subject,
        course_id: row.course_id,
        course_label: r.course_label ?? null,
        evaluated_at: row.evaluated_at,
        grade_chile: row.grade_chile ?? null,
      }
    },
    [evaluacionesList]
  )

  /** Misma URL que Análisis pedagógico por evaluación; hint opcional desde la fila de lista si el GET falla. */
  const openEvaluationInforme = useCallback(async (evaluationId: string, rowHint?: InformeRowHint | null) => {
    const id = String(evaluationId ?? "").trim()
    if (!id) return
    setEvaluacionesDetailId(id)
    setEvaluacionesDetail(null)
    setEvaluacionesDetailError(null)
    setEvaluationStudents([])
    setEvaluacionesDetailLoading(true)
    if (process.env.NODE_ENV === "development") setVerDebug(null)
    const detailUrl = `/api/evaluations/${encodeURIComponent(id)}`
    const applyHintShell = () => {
      const h = rowHint ?? {}
      setEvaluacionesDetail({
        evaluation: {
          id,
          title: h.title ?? "(Sin título)",
          subject: h.subject ?? null,
          course_id: h.course_id ?? null,
          course_label: h.course_label ?? null,
          evaluated_at: h.evaluated_at ?? null,
          status: "draft",
        },
        evaluation_items: [],
        evaluation_summaries:
          h.grade_chile != null
            ? { grade_chile: h.grade_chile, strengths: null, improvements: null, raw: null }
            : null,
      })
      setEvaluacionesDetailError(null)
    }
    try {
      const { res, bodyText, parsed: j } = await fetchInformeDetailRaw(detailUrl)
      if (process.env.NODE_ENV === "development") {
        console.info("[UI][VER] response status", res.status)
        if (res.ok && j) {
          console.info("[UI][VER] has evaluation", !!j.evaluation)
          console.info("[UI][VER] items length", Array.isArray(j.items) ? j.items.length : -1)
        } else {
          setVerDebug({ evaluationId: id, status: res.status, error: (j?.error as string) ?? null, payload: j })
        }
      }
      if (res.ok && j?.evaluation) {
        const rawItems = j.evaluation_items ?? j.items
        const itemsArr = Array.isArray(rawItems) ? (rawItems as Array<Record<string, unknown>>) : []
        setEvaluacionesDetail({
          evaluation: j.evaluation as Record<string, unknown>,
          evaluation_items: itemsArr,
          evaluation_summaries: (j.evaluation_summaries ?? j.summary ?? null) as Record<string, unknown> | null,
        })
        setEvaluacionesDetailError(null)
      } else {
        logInformeFetchFailure("openEvaluationInforme detalle", detailUrl, res, bodyText, j ?? bodyText)
        if (res.status === 403) {
          setEvaluacionesDetail(null)
          setEvaluacionesDetailError("Completa tu perfil para ver esta evaluación.")
        } else {
          applyHintShell()
        }
      }
      try {
        const studentsUrl = `/api/evaluations/${encodeURIComponent(id)}/students`
        const sOut = await fetchInformeDetailRaw(studentsUrl)
        if (!sOut.res.ok) {
          logInformeFetchFailure("openEvaluationInforme estudiantes", studentsUrl, sOut.res, sOut.bodyText, sOut.parsed ?? sOut.bodyText)
        }
        const rawS = sOut.res.ok ? sOut.parsed : null
        const list =
          rawS && typeof rawS === "object" && Array.isArray((rawS as { students?: unknown }).students)
            ? (rawS as { students: Array<{ student_name: string; created_at: string | null }> }).students
            : []
        setEvaluationStudents(list)
      } catch (se) {
        logInformeFetchFailure(
          "openEvaluationInforme estudiantes (excepción)",
          `/api/evaluations/${encodeURIComponent(id)}/students`,
          null,
          "",
          { error: se instanceof Error ? se.message : String(se) }
        )
        setEvaluationStudents([])
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      logInformeFetchFailure("openEvaluationInforme (excepción)", detailUrl, null, "", { error: errMsg })
      if (process.env.NODE_ENV === "development") {
        setVerDebug({ evaluationId: id, status: 0, error: errMsg, payload: null })
      }
      applyHintShell()
    } finally {
      setEvaluacionesDetailLoading(false)
    }
  }, [])

  /** Refresca perfil del estudiante si el modal está abierto (tras edición manual en informe). */
  const refetchStudentProfileIfOpen = useCallback(async () => {
    if (!studentHistoryId) return
    try {
      const r = await fetch(`/api/students/${studentHistoryId}/history`, { cache: "no-store" })
      const j = await r.json()
      if (r.ok) {
        setStudentHistoryData(j)
        setStudentHistoryError(null)
        setStudentHistoryRaw(j)
      }
    } catch {
      // Silencioso: no cerrar el modal ni mostrar error
    }
  }, [studentHistoryId])

  /** Refresca diagnóstico del curso si el modal está abierto (tras edición manual en informe). */
  const refetchCourseDiagnosisIfOpen = useCallback(async () => {
    if (!courseDiagnosisOpen || !courseDiagnosisLabel) return
    const courseId = courseDiagnosisLabel
    try {
      const r = await fetch(`/api/courses/${encodeURIComponent(courseId)}/diagnosis`, { cache: "no-store" })
      const j = await r.json()
      setCourseDiagnosisRaw(j)
      if (r.ok && !j.error) {
        setCourseDiagnosisData({
          course_label: j.course_label ?? j.course ?? courseId,
          students_count: j.students_count ?? 0,
          evaluations_count: j.evaluations_count ?? 0,
          axes: j.axes ?? [],
          skills: j.skills ?? [],
          strongest_skill: j.strongest_skill ?? null,
          weakest_skill: j.weakest_skill ?? null,
          summary: j.summary ? { strongest_axis: j.summary.strongest_axis ?? null, weakest_axis: j.summary.weakest_axis ?? null } : { strongest_axis: null, weakest_axis: null },
        })
      }
    } catch {
      // Silencioso
    }
  }, [courseDiagnosisOpen, courseDiagnosisLabel])

  const openDeleteEvaluationDialog = useCallback((evaluationId: string, title?: string | null) => {
    setDeleteEvaluationDialog({ open: true, id: evaluationId, title: title ?? null })
  }, [])

  const handleConfirmDeleteEvaluation = useCallback(async () => {
    if (!deleteEvaluationDialog.id) return
    setDeleteEvaluationLoading(true)
    try {
      // LOGICA_ANTERIOR_LOCAL: solo existia archivado, no borrado fisico.
      // DATA_SCIENCE_FIX_V1: borrado fisico via endpoint DELETE.
      const r = await fetch(`/api/evaluations/${deleteEvaluationDialog.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        setEvaluacionesList((prev) => prev.filter((item) => item.id !== deleteEvaluationDialog.id))
        if (evaluacionesDetailId === deleteEvaluationDialog.id) {
          setEvaluacionesDetailId(null)
          setEvaluacionesDetail(null)
          setEvaluacionesDetailError(null)
          setEvaluacionesDetailItemsDraft(null)
        }
        toast({ title: "Evaluación eliminada definitivamente." })
        setDeleteEvaluationDialog({ open: false, id: null, title: null })
        loadEvaluationsList().catch(() => {})
        loadStudentsList().catch(() => {})
      } else {
        toast({ title: j?.message || j?.error || "Error al eliminar evaluación", variant: "destructive" })
      }
    } catch {
      toast({ title: "Error al eliminar evaluación", variant: "destructive" })
    } finally {
      setDeleteEvaluationLoading(false)
    }
  }, [deleteEvaluationDialog.id, evaluacionesDetailId, loadEvaluationsList, loadStudentsList, toast])

  const guidedAutoAppliedSavedAtRef = useRef<string | null>(null)
  /** Evita repetir auto-selección de prueba base QR para el mismo `savedAt` de sesión. */
  const wizardGuidedSourceExamAutoAppliedSavedAtRef = useRef<string | null>(null)
  const [wizardGuidedFilledFields, setWizardGuidedFilledFields] = useState<GuidedEvaluatorFormField[]>([])
  const [wizardSessionRevision, setWizardSessionRevision] = useState(0)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipoEvaluacion: "prueba",
      rubrica: "",
      puntajeTotal: "100",
      pauta: "",
      flexibilidad: [3],
      nombreProfesor: "",
      nombrePrueba: "",
      departamento: "",
      asignatura: "",
      curso: "",
      fechaEvaluacion: new Date(),
      areaConocimiento: "general",

      nivelEducativo: "Educación Media",
      nombresGrupales: "",
      porcentajeExigencia: "55",
      pautaEstructurada: "",
      // 🔥 NUEVO: Pauta de alternativas
      pautaCorrectaAlternativas: "",
      tipoPrueba: "mixta",
    },
  })

  const watchedTipoPrueba = form.watch("tipoPrueba")
  const prevTipoPruebaRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = prevTipoPruebaRef.current
    if (watchedTipoPrueba === "solo_alternativas") {
      form.clearErrors(["rubrica", "pautaEstructurada"])
    } else if (prev === "solo_alternativas") {
      void form.trigger(["rubrica", "pautaEstructurada"])
    }
    prevTipoPruebaRef.current = watchedTipoPrueba
  }, [watchedTipoPrueba, form])

  const applyEvaluatorSourceExamHintsToEmptyFields = useCallback(() => {
    if (!evaluatorLastSourceExamPayload) return
    const hints = sourceExamInputToFormHints({
      title: evaluatorLastSourceExamPayload.title,
      items: evaluatorLastSourceExamPayload.items,
    })
    const v = form.getValues()
    if (!(typeof v.pautaEstructurada === "string" && v.pautaEstructurada.trim())) {
      form.setValue("pautaEstructurada", hints.pautaEstructurada)
    }
    if (!(typeof v.pautaCorrectaAlternativas === "string" && v.pautaCorrectaAlternativas.trim())) {
      form.setValue("pautaCorrectaAlternativas", hints.pautaCorrectaAlternativas)
    }
    if (!(typeof v.rubrica === "string" && v.rubrica.trim())) {
      form.setValue("rubrica", hints.rubricaNotes)
    }
    if (!(typeof v.nombrePrueba === "string" && v.nombrePrueba.trim()) && evaluatorLastSourceExamPayload.title) {
      form.setValue("nombrePrueba", evaluatorLastSourceExamPayload.title.slice(0, 300))
    }
    setEvaluatorInstrumentSource("both")
    toast({ title: "Campos vacíos rellenados desde la prueba base" })
  }, [evaluatorLastSourceExamPayload, form, toast])

  const applySuggestedTipoPruebaFromSourceExam = useCallback(() => {
    if (!evaluatorLastSourceExamPayload) return
    const hints = sourceExamInputToFormHints({
      title: evaluatorLastSourceExamPayload.title,
      items: evaluatorLastSourceExamPayload.items,
    })
    form.setValue("tipoPrueba", hints.suggestedTipoPrueba)
    toast({ title: "Tipo de prueba actualizado (sugerencia desde prueba base)" })
  }, [evaluatorLastSourceExamPayload, form, toast])

  const undoWizardGuidedApply = useCallback(() => {
    wizardGuidedFilledFields.forEach((f) => {
      if (f === "tipoPrueba") {
        form.setValue("tipoPrueba", "mixta", { shouldDirty: true })
      } else if (f === "puntajeTotal") {
        form.setValue("puntajeTotal", "100", { shouldDirty: true })
      } else if (f === "porcentajeExigencia") {
        form.setValue("porcentajeExigencia", "55", { shouldDirty: true })
      } else {
        form.setValue(f, "", { shouldDirty: true })
      }
    })
    setWizardGuidedFilledFields([])
    const draft = readWizardSession()
    if (draft?.savedAt) guidedAutoAppliedSavedAtRef.current = draft.savedAt
  }, [form, wizardGuidedFilledFields])

  const applyGuidedWizardConfiguration = useCallback(() => {
    if (!ENABLE_WIZARD) return
    const draft = readWizardSession()
    if (!draft?.savedAt) {
      toast({ title: "Configuración guiada", description: "No hay datos guardados en el asistente para aplicar." })
      return
    }
    const hasWizardPayload =
      Boolean(draft.course.trim()) ||
      Boolean(draft.testName.trim()) ||
      Boolean(draft.teacherName.trim()) ||
      Boolean((draft.departmentName ?? "").trim()) ||
      Boolean((draft.subjectName ?? "").trim()) ||
      Boolean(draft.tipoPrueba)
    if (!hasWizardPayload) {
      toast({ title: "Configuración guiada", description: "No hay datos guardados en el asistente para aplicar." })
      return
    }
    const r = applyGuidedWizardSessionToEvaluatorForm(
      draft,
      (f) => form.getValues(f),
      (f, v) => form.setValue(f, v, { shouldDirty: true, shouldTouch: true }),
    )
    if (draft.savedAt) guidedAutoAppliedSavedAtRef.current = draft.savedAt
    if (r.filled.length > 0) {
      setWizardGuidedFilledFields((prev) => [...new Set([...prev, ...r.filled])])
      toast({ title: "Configuración guiada aplicada.", description: "Puedes extraer nombres y evaluar." })
    } else if (r.skippedHadValue.length > 0) {
      toast({
        title: "Sin reemplazar",
        description: "Los campos que coinciden ya tenían información.",
      })
    } else {
      toast({
        title: "Configuración guiada",
        description: "No quedaron campos vacíos que coincidan con los datos del asistente.",
      })
    }
  }, [form, toast])

  useEffect(() => {
    if (!ENABLE_WIZARD) return
    if (activeTab !== "evaluator") return
    const draft = readWizardSession()
    if (!draft?.savedAt) return
    const hasWizardPayload =
      Boolean(draft.course.trim()) ||
      Boolean(draft.testName.trim()) ||
      Boolean(draft.teacherName.trim()) ||
      Boolean((draft.departmentName ?? "").trim()) ||
      Boolean((draft.subjectName ?? "").trim()) ||
      Boolean(draft.tipoPrueba)
    if (!hasWizardPayload) return
    if (guidedAutoAppliedSavedAtRef.current === draft.savedAt) return
    const r = applyGuidedWizardSessionToEvaluatorForm(
      draft,
      (f) => form.getValues(f),
      (f, v) => form.setValue(f, v, { shouldDirty: true, shouldTouch: true }),
    )
    guidedAutoAppliedSavedAtRef.current = draft.savedAt
    if (r.filled.length > 0) {
      setWizardGuidedFilledFields((prev) => [...new Set([...prev, ...r.filled])])
      toast({ title: "Configuración guiada aplicada.", description: "Puedes extraer nombres y evaluar." })
    }
  }, [activeTab, form, toast, wizardSessionRevision])

  useEffect(() => {
    const bump = () => setWizardSessionRevision((n) => n + 1)
    window.addEventListener(WIZARD_SESSION_CHANGED_EVENT, bump)
    const onStorage = (e: StorageEvent) => {
      if (e.key === WIZARD_SESSION_STORAGE_KEY) bump()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(WIZARD_SESSION_CHANGED_EVENT, bump)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const handleEvaluatorSourceExamSelect = useCallback(
    async (value: string): Promise<boolean> => {
      const id = value === "__none__" ? "" : value
      setSelectedEvaluatorSourceExamId(id)
      if (id) lastActiveEvaluatorSourceExamIdRef.current = id
      if (!id) {
        setEvaluatorEvaluationBaseSnapshot(null)
        setEvaluatorLastSourceExamPayload(null)
        setEvaluatorInstrumentSource("manual")
        return true
      }
      setEvaluatorSourceExamItemsLoading(true)
      try {
        const r = await fetch(`/api/source-exams/${id}/items`, { credentials: "include" })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setEvaluatorEvaluationBaseSnapshot(null)
          setEvaluatorLastSourceExamPayload(null)
          toast({ title: "No se pudieron cargar los ítems de la prueba base", variant: "destructive" })
          return false
        }
        const raw = Array.isArray(j.items) ? j.items : []
        const items = mapSourceExamApiRowsToInputs(raw)
        const title = evaluatorSourceExamOptions.find((o) => o.id === id)?.title ?? null
        const payload = { title, items }
        setEvaluatorLastSourceExamPayload(payload)
        const eb = buildEvaluationBase({ sourceExam: { title, items } })
        setEvaluatorEvaluationBaseSnapshot(eb)
        setEvaluatorInstrumentSource("source_exam")
        return true
      } catch {
        setEvaluatorEvaluationBaseSnapshot(null)
        setEvaluatorLastSourceExamPayload(null)
        toast({ title: "No se pudieron cargar los ítems de la prueba base", variant: "destructive" })
        return false
      } finally {
        setEvaluatorSourceExamItemsLoading(false)
      }
    },
    [evaluatorSourceExamOptions, toast],
  )

  const handleUseRememberedWizardSourceExam = useCallback(() => {
    const id = readWizardSession()?.sessionSourceExamId?.trim()
    if (id) void handleEvaluatorSourceExamSelect(id)
  }, [handleEvaluatorSourceExamSelect])

  const rememberedWizardSourceExamId = ENABLE_WIZARD ? (readWizardSession()?.sessionSourceExamId?.trim() ?? "") : ""
  const rememberedWizardSourceExamMissingFromList =
    Boolean(rememberedWizardSourceExamId) &&
    evaluatorSourceExamListHydrated &&
    !evaluatorSourceExamListLoading &&
    !evaluatorSourceExamOptions.some((o) => o.id === rememberedWizardSourceExamId)

  /** Lista de pruebas base para el selector del Evaluador: debe refrescarse al volver desde el banco, no solo al cargar la página. */
  const loadEvaluatorSourceExamOptions = useCallback(() => {
    setEvaluatorSourceExamListLoading(true)
    fetch("/api/source-exams", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.source_exams)) {
          setEvaluatorSourceExamOptions(
            j.source_exams.map((e: { id: string; title?: string | null }) => ({ id: e.id, title: e.title ?? null })),
          )
        }
      })
      .catch(() => {})
      .finally(() => {
        setEvaluatorSourceExamListLoading(false)
        setEvaluatorSourceExamListHydrated(true)
      })
  }, [])

  useEffect(() => {
    if (activeTab !== "evaluator") return
    loadEvaluatorSourceExamOptions()
  }, [activeTab, loadEvaluatorSourceExamOptions])

  /** Prueba base del QR: misma ruta que el selector (`handleEvaluatorSourceExamSelect`), solo si aún no hay una elegida. */
  useEffect(() => {
    if (!ENABLE_WIZARD) return
    if (activeTab !== "evaluator") return
    const draft = readWizardSession()
    if (!draft?.savedAt) return
    const wizId = draft.sessionSourceExamId?.trim()
    if (!wizId) return
    if (selectedEvaluatorSourceExamId.trim() !== "") return
    if (!evaluatorSourceExamListHydrated || evaluatorSourceExamListLoading) return
    if (!evaluatorSourceExamOptions.some((o) => o.id === wizId)) return
    if (wizardGuidedSourceExamAutoAppliedSavedAtRef.current === draft.savedAt) return
    let cancelled = false
    void (async () => {
      const ok = await handleEvaluatorSourceExamSelect(wizId)
      if (!cancelled && ok) {
        wizardGuidedSourceExamAutoAppliedSavedAtRef.current = draft.savedAt
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    activeTab,
    wizardSessionRevision,
    evaluatorSourceExamListHydrated,
    evaluatorSourceExamListLoading,
    evaluatorSourceExamOptions,
    selectedEvaluatorSourceExamId,
    handleEvaluatorSourceExamSelect,
  ])

  /** Nombre final visible del estudiante para sync-student. Fuente: group.studentName (single/batch) o payload.opts.student_name (retry). */
  function getFinalStudentNameForSync(
    group: { studentName?: string } | null | undefined,
    payload?: { opts?: { student_name?: string } } | null
  ): string {
    const fromGroup = group?.studentName != null ? String(group.studentName).trim() : ""
    const fromPayload = payload?.opts?.student_name != null ? String(payload.opts.student_name).trim() : ""
    return fromGroup || fromPayload || ""
  }

  function getFinalStudentRutForSync(
    group: { studentRut?: string } | null | undefined,
    payload?: { opts?: { student_rut?: string } } | null
  ): string | null {
    const fromGroup = group?.studentRut != null ? String(group.studentRut).trim() : ""
    const fromPayload = payload?.opts?.student_rut != null ? String(payload.opts.student_rut).trim() : ""
    return normalizeRutCanonical(fromGroup || fromPayload)
  }

  async function registerAuditAction(action: string, targetId: string, studentOrCourse: string) {
    try {
      await fetch("/api/dashboard/audit/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          targetId,
          targetType: "evaluation",
          metadata: { student_or_course: studentOrCourse },
        }),
      })
    } catch {
      // Silencioso para no bloquear el flujo operativo del docente.
    }
  }

  /** Curso final visible para sync-student. Fuente: form.curso o payload.opts.course_id (retry). */
  function getFinalCourseLabel(payload?: { opts?: { course_id?: string } } | null): string | null {
    const fromForm = form.getValues("curso")
    const fromPayload = payload?.opts?.course_id
    const v = fromForm != null && String(fromForm).trim() !== "" ? String(fromForm).trim() : (fromPayload != null ? String(fromPayload).trim() : null)
    return v || null
  }

  useEffect(() => {
    const saved = (localStorage.getItem("userEmail") || "").toLowerCase()
    if (saved && /\S+@\S+\.\S+/.test(saved)) setUserEmail(saved)
  }, [])
  // Perfil en mount: siempre fresco desde BD (no cache). Modal solo si user sin teacher_id y no en estado "refresh falló".
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch("/api/profile", { cache: "no-store" })
        const j = await r.json()
        if (cancelled) return
        setMainProfile({ profile: j.profile, user: j.user })
        setHasSessionTeacher(!!j.profile?.teacher_id)
        if (j.profile?.teacher_id) setOnboardRefreshFailed(false)
        if (j.user && !j.profile?.teacher_id && !onboardRefreshFailed) setShowOnboardingModal(true)
      } catch (_) {
        if (!cancelled) setMainProfile(null)
      }
    })()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (activeTab !== "historial") return
    let cancelled = false
    ;(async () => {
      setHistorialLoading(true)
      try {
        const r = await fetch("/api/profile")
        const j = await r.json()
        if (cancelled) return
        setHistorialProfile({ profile: j.profile, user: j.user })
        if (j.user) {
          const q = new URLSearchParams()
          if (historialFilters.courseId) q.set("courseId", historialFilters.courseId)
          if (historialFilters.from) q.set("from", historialFilters.from)
          if (historialFilters.to) q.set("to", historialFilters.to)
          const er = await fetch(`/api/evaluations/me?${q.toString()}`)
          const ej = await er.json()
          if (!cancelled) setHistorialEvaluations(ej.evaluations ?? [])
        } else {
          setHistorialEvaluations([])
        }
      } finally {
        if (!cancelled) setHistorialLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [activeTab, historialFetchKey])
  useEffect(() => {
    if (activeTab !== "evaluaciones" && activeTab !== "cursos") return
    loadEvaluationsList()
  }, [activeTab, loadEvaluationsList])
  useEffect(() => {
    if (INTERNAL_SUPPORT_UI && activeTab === "evaluaciones" && evaluacionesList.length >= 0) {
      const rows = evaluacionesList.map((e) => ({
        id: e.id,
        status: e.status ?? null,
        canShowArchive: (e.status ?? "draft") !== "archived",
      }))
      setArchiveDebug((prev) => ({ total: evaluacionesList.length, rows, lastClick: prev?.lastClick, lastResponse: prev?.lastResponse }))
    }
  }, [activeTab, evaluacionesList])
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && studentHistoryData) {
      console.info("[UI][STUDENT_PROFILE] skills length", studentHistoryData?.skills?.length ?? 0)
      console.info("[UI][STUDENT_PROFILE] strongest_skill", studentHistoryData?.summary?.strongest_skill ?? null)
      console.info("[UI][STUDENT_PROFILE] weakest_skill", studentHistoryData?.summary?.weakest_skill ?? null)
    }
  }, [studentHistoryData])
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && courseDiagnosisData) {
      console.info("[UI][COURSE_DIAG] axes length", courseDiagnosisData?.axes?.length ?? 0)
      console.info("[UI][COURSE_DIAG] skills length", courseDiagnosisData?.skills?.length ?? 0)
      console.info("[UI][COURSE_DIAG] strongest_axis", courseDiagnosisData?.summary?.strongest_axis ?? null)
      console.info("[UI][COURSE_DIAG] weakest_axis", courseDiagnosisData?.summary?.weakest_axis ?? null)
      console.info("[UI][COURSE_DIAG] strongest_skill", courseDiagnosisData?.strongest_skill ?? null)
      console.info("[UI][COURSE_DIAG] weakest_skill", courseDiagnosisData?.weakest_skill ?? null)
    }
  }, [courseDiagnosisData])
  useEffect(() => {
    if (activeTab !== "estudiantes") return
    loadStudentsList()
  }, [activeTab, loadStudentsList, studentsListCourseFilter, studentsListSearch, studentsListFetchKey])
  useEffect(() => {
    if (activeTab !== "mis-archivos") return
    let cancelled = false
    setBatchExportsLoading(true)
    setBatchExportsError(null)
    fetch("/api/batch-exports", { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as {
          exports?: Array<{
            id: string
            batch_id: string
            zip_filename: string
            exam_title: string | null
            course_label: string | null
            evaluation_count: number
            created_at: string
          }>
          error?: string
        }
        if (!r.ok) throw new Error(j.error || "No se pudo cargar el historial")
        if (!cancelled) setBatchExportsList(Array.isArray(j.exports) ? j.exports : [])
      })
      .catch((e) => {
        if (!cancelled) setBatchExportsError(e instanceof Error ? e.message : "Error de red")
      })
      .finally(() => {
        if (!cancelled) setBatchExportsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, batchExportsRefreshKey])
  useEffect(() => {
    if (typeof window === "undefined" || !enablePedagogy) return
    const id = localStorage.getItem("dashboardEvaluationId")
    const mode = localStorage.getItem("dashboardMode") as "normal" | "simce" | null
    if (id) setDashboardEvaluationId(id)
    if (mode === "simce" || mode === "normal") setDashboardMode(mode)
  }, [enablePedagogy])
  useEffect(() => {
    if (!enablePedagogy || activeTab !== "pedagogy-dashboard") return
    let cancelled = false
    setDashboardListLoading(true)
    Promise.all([
      fetch("/api/evaluations/list").then((r) => r.json()),
      fetch("/api/pedagogy/catalog?subject=Lenguaje").then((r) => r.json()),
    ]).then(([listRes, catalogRes]) => {
      if (cancelled) return
      if (listRes.evaluations) setDashboardList(listRes.evaluations.map((e: { id: string; title: string | null }) => ({ id: e.id, title: e.title })))
      if (catalogRes.axes && catalogRes.skills) setDashboardCatalog({ axes: catalogRes.axes, skills: catalogRes.skills })
      setDashboardListLoading(false)
    }).catch(() => { if (!cancelled) setDashboardListLoading(false) })
    return () => { cancelled = true }
  }, [enablePedagogy, activeTab])
  useEffect(() => {
    if (!enablePedagogy || !dashboardEvaluationId) { setDashboardAnalysis(null); setDashboardAnalysisError(null); return }
    let cancelled = false
    setDashboardAnalysisLoading(true)
    setDashboardAnalysisError(null)
    const mode = dashboardMode === "simce" ? "?mode=simce" : ""
    fetch(`/api/evaluations/${dashboardEvaluationId}/analysis${mode}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (j.step && j.message) { setDashboardAnalysisError(`[${j.step}] ${j.message}`); setDashboardAnalysis(null) }
        else { setDashboardAnalysis({ bySkill: j.bySkill ?? [], byAxis: j.byAxis ?? [], message: j.message }); setDashboardAnalysisError(null) }
      })
      .catch((e) => { if (!cancelled) setDashboardAnalysisError(e?.message || "Error"); setDashboardAnalysis(null) })
      .finally(() => { if (!cancelled) setDashboardAnalysisLoading(false) })
    return () => { cancelled = true }
  }, [enablePedagogy, dashboardEvaluationId, dashboardMode])
  useEffect(() => {
    const savedNivel = form.getValues("nivelEducativo")
    // Si es un nivel superior (antes en otra pestaña), mantenemos la lógica correcta.
    if (["Técnico Superior", "Universitario", "Postgrado"].includes(savedNivel)) {
      form.setValue("nivelEducativo", savedNivel)
    } else {
      form.setValue("nivelEducativo", "Educación Media")
    }

    const count = Math.max(1, classSize)
    setStudentGroups(
      Array.from({ length: count }, (_, i) => ({
        id: `student-${Date.now()}-${i}`,
        studentName: `Alumno ${i + 1}`,
        studentRut: "",
        files: [],
        isEvaluated: false,
        isEvaluating: false,
        decimasAdicionales: 0,
      })),
    )
    setUnassignedFiles([])
  }, [classSize])

  const ensureEvaluationBatchId = useCallback((): string => {
    if (evaluationBatchIdRef.current) return evaluationBatchIdRef.current
    const persisted = readDocenteActiveBatchId()
    if (persisted) {
      evaluationBatchIdRef.current = persisted
      setEvaluationBatchIdUi(persisted)
      return persisted
    }
    const fresh = crypto.randomUUID()
    evaluationBatchIdRef.current = fresh
    setEvaluationBatchIdUi(fresh)
    writeDocenteActiveBatchId(fresh)
    return fresh
  }, [])

  const processFiles = (files: File[]) => {
    const validTypes = [
      "image/jpeg",
      "image/png",
      "image/bmp",
      "image/tiff",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]
    const validFiles = Array.from(files).filter((file) => {
      if (validTypes.includes(file.type)) return true
      alert(`Formato no soportado para "${file.name}". Usa: JPEG, PNG, BMP, TIFF, PDF, DOCX o XLSX.`)
      return false
    })
    if (validFiles.length === 0) return
    ensureEvaluationBatchId()
    validFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        setUnassignedFiles((prev) => [
          ...prev,
          { id: `${file.name}-${Date.now()}`, file, previewUrl: URL.createObjectURL(file), dataUrl },
        ])
      }
      reader.readAsDataURL(file)
    })
  }
  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target && e.target.files) {
      processFiles(Array.from(e.target.files))
      // Reset the input so consecutive captures with the same filename still trigger onChange
      try {
        e.target.value = ""
      } catch {}
    }
  }
// 🚨 MODIFICACIÓN: handleCapture ahora recibe el modo Y el feedback de certeza.
const handleCapture = (dataUrl: string, mode: CaptureMode | null, feedback?: CameraFeedback) => {
  const fb = feedback ?? ({ confidence: 1 } as CameraFeedback)

  if (fb.confidence < 0.98) {
    const confirmCapture = window.confirm(
      `Baja Certeza OCR (${(fb.confidence * 100).toFixed(1)}%). Desea continuar con el riesgo de error o reintentar?`,
    )
    if (!confirmCapture) return
  }

  // Si es modo closed_answer, abrir el modal de OMR cerradas con la imagen capturada
  if (mode === "closed_answer") {
    fetch(dataUrl)
      .then((res) => res.blob())
      .then((blob) => {
        const fileName = `captura-omr-cerradas-${Date.now()}.png`
        const file = new File([blob], fileName, { type: "image/png" })
        const filePreview: FilePreview = {
          id: `omr-${Date.now()}`,
          file,
          previewUrl: URL.createObjectURL(file),
          dataUrl,
        }
        ensureEvaluationBatchId()
        setUnassignedFiles((prev) => [...prev, filePreview])
        handleOpenClosedAnswerOMR(dataUrl)
      })
      .catch((err) => console.error("Error al crear archivo desde captura:", err))

    setIsCameraOpen(false)
    setIsCaptureModeSelectionOpen(false)
    setCaptureMode(null)
    setCameraFeedback(null)
    return
  }

  fetch(dataUrl)
    .then((res) => res.blob())
    .then((blob) => {
      const fileName = mode ? `captura-${mode}-${Date.now()}.png` : `captura-${Date.now()}.png`
      const file = new File([blob], fileName, { type: "image/png" })
      processFiles([file])
    })
    .catch((err) => console.error("Error al crear archivo desde captura:", err))

  setIsCameraOpen(false)
  setIsCaptureModeSelectionOpen(false)
  setCaptureMode(null)
  setCameraFeedback(null)
}

  // Handler para abrir OMR cerradas desde archivos pendientes o grupo
  const handleOpenClosedAnswerOMR = (imageDataUrl: string, groupId?: string) => {
    setClosedAnswerImageUrl(imageDataUrl)
    setClosedAnswerTargetGroupId(groupId || null)
    setIsClosedAnswerOMROpen(true)
  }

  // Handler para confirmar respuestas del OMR cerradas
  const handleClosedAnswerConfirm = (result: ClosedAnswerOMRResult) => {
    const { pautaCorrectaAlternativas } = form.getValues()

    // Parsear la pauta correcta para comparar
    const pautaCorrecta: { [key: string]: string } = {}
    if (pautaCorrectaAlternativas) {
      const pairs = pautaCorrectaAlternativas.split(";").map((p: string) => p.trim()).filter((p: string) => p)
      for (const pair of pairs) {
        const [id, resp] = pair.split(":").map((s: string) => s.trim())
        if (id && resp) pautaCorrecta[id.toUpperCase()] = resp.toUpperCase()
      }
    }

    // Convertir las respuestas OMR al formato que el sistema ya usa (alternativas_corregidas)
    const alternativasCorregidas = result.respuestas.map((r: { pregunta: string; respuesta: string }) => {
      const preguntaKey = r.pregunta.trim()
      // Buscar la respuesta correcta en la pauta (por numero o por SM+numero)
      const correcta =
        pautaCorrecta[preguntaKey.toUpperCase()] ||
        pautaCorrecta[`SM${preguntaKey}`] ||
        pautaCorrecta[`${preguntaKey}`] ||
        ""

      return {
        pregunta: preguntaKey,
        respuesta_estudiante: r.respuesta === "SIN_RESPUESTA" || r.respuesta === "DOBLE_MARCA" ? "" : r.respuesta,
        respuesta_correcta: correcta,
      }
    })

    // Si hay un grupo objetivo, asignar las respuestas directamente
    if (closedAnswerTargetGroupId) {
      setStudentGroups((prev) =>
        prev.map((g) => {
          if (g.id !== closedAnswerTargetGroupId) return g
          return {
            ...g,
            alternativas_corregidas: alternativasCorregidas,
            studentName: result.alumnoDetectado || g.studentName,
          }
        })
      )
    } else {
      // Si no hay grupo objetivo, asignar al primer grupo que no tenga alternativas
      setStudentGroups((prev) => {
        const targetIdx = prev.findIndex((g) => !g.alternativas_corregidas || g.alternativas_corregidas.length === 0)
        if (targetIdx === -1 && prev.length > 0) {
          // Si todos tienen, asignar al primero
          const updated = [...prev]
          updated[0] = {
            ...updated[0],
            alternativas_corregidas: alternativasCorregidas,
            studentName: result.alumnoDetectado || updated[0].studentName,
          }
          return updated
        }
        return prev.map((g, idx) => {
          if (idx !== targetIdx) return g
          return {
            ...g,
            alternativas_corregidas: alternativasCorregidas,
            studentName: result.alumnoDetectado || g.studentName,
          }
        })
      })
    }

    setIsClosedAnswerOMROpen(false)
    setClosedAnswerImageUrl("")
    setClosedAnswerTargetGroupId(null)
  }

  const handleLogoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => setLogoPreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }
  const updateStudentName = (groupId: string, newName: string) =>
    setStudentGroups((groups) => groups.map((g) => (g.id === groupId ? { ...g, studentName: newName } : g)))
  const updateStudentRut = (groupId: string, newRut: string) =>
    setStudentGroups((groups) => groups.map((g) => (g.id === groupId ? { ...g, studentRut: newRut } : g)))
  const assignFileToGroup = (fileId: string, groupId: string) => {
    const fileToMove = unassignedFiles.find((f) => f.id === fileId)
    if (!fileToMove) return
    setStudentGroups((groups) => groups.map((g) => (g.id === groupId ? { ...g, files: [...g.files, fileToMove] } : g)))
    setUnassignedFiles((files) => files.filter((f) => f.id !== fileId))
  }
  const removeFileFromGroup = (fileId: string, groupId: string) => {
    let fileToMoveBack: FilePreview | undefined
    setStudentGroups((groups) =>
      groups.map((g) => {
        if (g.id === groupId) {
          fileToMoveBack = g.files.find((f) => f.id === fileId)
          return { ...g, files: g.files.filter((f) => f.id !== fileId) }
        }
        return g
      }),
    )
    if (fileToMoveBack) setUnassignedFiles((prev) => [...prev, fileToMoveBack!])
  }
  const handleDecimasChange = (groupId: string, value: string) => {
    const decimas = Number.parseFloat(value) || 0
    setStudentGroups((groups) => groups.map((g) => (g.id === groupId ? { ...g, decimasAdicionales: decimas } : g)))
  }
  const handlePuntajeChange = (groupId: string, value: string) => {
    setStudentGroups((groups) => groups.map((g) => (g.id === groupId ? { ...g, puntaje: value } : g)))
  }
  const handleNotaChange = (groupId: string, value: string) => {
    setStudentGroups((groups) =>
      groups.map((g) => (g.id === groupId ? { ...g, nota: Number.parseFloat(value) || 0 } : g)),
    )
  }
  const removeUnassignedFile = (fileId: string) => {
    setUnassignedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  /** Agrupación automática: distribuye unassignedFiles en studentGroups según imagesPerStudent. Reversible; no toca evaluación ni contratos. */
  const applyAutoGroup = () => {
    const per = Math.max(1, Math.min(50, imagesPerStudent))
    if (studentGroups.length === 0) {
      toast({ title: "Indica primero el Nº de estudiantes para crear los grupos.", variant: "default" })
      return
    }
    if (unassignedFiles.length === 0) {
      const hasMobile = studentGroups.some((g) => g.files.some((f) => f.fromMobileBatch))
      toast({
        title: hasMobile
          ? "No hay archivos de PC pendientes. Las del móvil ya van a cada grupo según índice."
          : "No hay archivos pendientes para agrupar.",
        variant: "default",
      })
      return
    }
    const toAssign: { fileId: string; groupId: string }[] = []
    let idx = 0
    for (const g of studentGroups) {
      const need = Math.max(0, per - g.files.length)
      for (let i = 0; i < need && idx < unassignedFiles.length; i++) {
        toAssign.push({ fileId: unassignedFiles[idx].id, groupId: g.id })
        idx++
      }
    }
    const assignedFileIds = new Set(toAssign.map((x) => x.fileId))
    const fileById = new Map(unassignedFiles.map((f) => [f.id, f]))
    setUnassignedFiles((prev) => prev.filter((f) => !assignedFileIds.has(f.id)))
    setStudentGroups((prev) =>
      prev.map((g) => {
        const add = toAssign
          .filter((x) => x.groupId === g.id)
          .map((x) => fileById.get(x.fileId))
          .filter(Boolean) as FilePreview[]
        return { ...g, files: [...g.files, ...add] }
      }),
    )
    toast({ title: "Agrupación automática completada. Revisa los grupos antes de evaluar." })
  }

  const handleNameExtraction = async (groupId: string) => {
    const grp = studentGroups.find((g) => g.id === groupId)
    if (!grp || grp.files.length === 0) {
      alert("Este estudiante/grupo no tiene archivos para extraer el nombre.")
      return
    }

    setIsExtractingNames(true)
    const formDataFD = new FormData()
    // ✅ Enviamos SOLO los archivos de este grupo (no unassignedFiles)
    grp.files.forEach((f) => formDataFD.append("files", f.file))
    formDataFD.append("nameList", "[]")

    try {
      const response = await fetch("/api/extract-name", { method: "POST", body: formDataFD })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || "Error desconocido.")
      const detectedNames = Array.isArray(data.suggestions) ? (data.suggestions as string[]) : []
      const numDetected = detectedNames.length
      if (numDetected > 0) {
        const allNamesList = detectedNames.map((n) => n.trim())
        const visibleGroupName = allNamesList.join(", ")

        setStudentGroups((groups) => {
          if (groups.length === 0) return groups
          return groups.map((g) => (g.id === groupId ? { ...g, studentName: visibleGroupName } : g))
        })
      } else {
        alert("No se detectó ningún nombre.")
      }
    } catch (error: any) {
      console.error("[ExtractName] Error:", error)
      alert(error?.message || "Error desconocido.")
    } finally {
      setIsExtractingNames(false)
    }
  }

  const isGenericGroupName = (name: string | undefined) => isGenericStudentSlotName(name)

  const syncMobileBatchPhotos = useCallback(async () => {
    const batchId = evaluationBatchIdRef.current
    if (!batchId || !isDocenteBatchUuid(batchId)) return
    if (mobileBatchSyncingRef.current) {
      mobileBatchSyncPendingRef.current = true
      return
    }
    mobileBatchSyncingRef.current = true
    try {
      const snapPre = evaluatorStep2FilesRef.current
      const knownMobilePhotoIds = new Set<string>()
      for (const g of snapPre.groups) {
        for (const f of g.files) {
          if (f.mobileBatchPhotoId) knownMobilePhotoIds.add(f.mobileBatchPhotoId)
        }
      }
      for (const f of snapPre.unassigned) {
        if (f.mobileBatchPhotoId) knownMobilePhotoIds.add(f.mobileBatchPhotoId)
      }

      type PhotoRow = {
        id: string
        student_index: number | null
        page_index?: number | null
        storage_path: string | null
        evaluation_id: string | null
        signed_url: string | null
      }
      let slotsFromApi: MobileBatchSlot[] = []
      const allPhotos: PhotoRow[] = []
      const apiIds = new Set<string>()
      let offset = 0
      const pageSize = MAX_BATCH_PHOTO_PAGE_SIZE
      let pages = 0
      while (pages < 64) {
        pages++
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), MOBILE_BATCH_SYNC_TIMEOUT_MS)
        const r = await fetch(
          `/api/docente/batch-evaluar-sync?batch_id=${encodeURIComponent(batchId)}&offset=${offset}&limit=${pageSize}`,
          { signal: controller.signal },
        ).finally(() => window.clearTimeout(timeoutId))
        const j = (await r.json().catch(() => ({}))) as {
          error?: string
          photos?: PhotoRow[]
          slots?: MobileBatchSlot[]
          meta?: { has_more?: boolean; next_offset?: number | null }
        }
        if (!r.ok) {
          if (j?.error) {
            toast({ title: "Sincronización del lote", description: j.error, variant: "destructive" })
          }
          return
        }
        const chunk = j.photos ?? []
        if (offset === 0) slotsFromApi = j.slots ?? []
        allPhotos.push(...chunk)
        for (const p of chunk) apiIds.add(p.id)
        const meta = j.meta
        if (!meta?.has_more) break
        offset = typeof meta.next_offset === "number" ? meta.next_offset : offset + chunk.length
        await new Promise<void>((res) => window.setTimeout(res, 0))
      }

      const placement: MobileBatchPlacement[] = []

      for (const p of allPhotos) {
        if (!p.signed_url) continue
        if (knownMobilePhotoIds.has(p.id)) continue
        try {
          const photoController = new AbortController()
          const photoTimeoutId = window.setTimeout(() => photoController.abort(), MOBILE_BATCH_SYNC_TIMEOUT_MS)
          const fr = await fetch(p.signed_url, { signal: photoController.signal }).finally(() =>
            window.clearTimeout(photoTimeoutId),
          )
          if (!fr.ok) continue
          const blob = await fr.blob()
          const ext = (p.storage_path?.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg"
          const mime = blob.type || "image/jpeg"
          const file = new File([blob], `movil-${p.id}.${ext}`, { type: mime })
          const storagePath = (p.storage_path ?? "").trim()
          const dataUrl = storagePath === "" ? await readFileAsDataUrl(file) : ""
          const preview: FilePreview = {
            id: `mobile-${p.id}`,
            file,
            previewUrl: URL.createObjectURL(file),
            dataUrl,
            mobileBatchPhotoId: p.id,
            fromMobileBatch: true,
            batchScanStoragePath: p.storage_path ?? null,
          }
          placement.push({
            preview,
            student_index: p.student_index,
            evaluation_id: p.evaluation_id,
          })
          await new Promise<void>((res) => window.setTimeout(res, 0))
        } catch {
          /* una fila no debe tumbar el lote */
        }
      }

      const snap = evaluatorStep2FilesRef.current
      const { groups: nextGroups, unassigned: nextUnassigned } = mergeMobileBatchIntoEvaluatorState(
        snap.groups,
        snap.unassigned,
        placement,
        slotsFromApi,
        apiIds,
      )
      setStudentGroups(nextGroups)
      setUnassignedFiles(nextUnassigned)
    } finally {
      mobileBatchSyncingRef.current = false
      if (mobileBatchSyncPendingRef.current) {
        mobileBatchSyncPendingRef.current = false
        void syncMobileBatchPhotosRef.current()
      }
    }
  }, [toast])

  useEffect(() => {
    if (activeTab !== "evaluator" || !evaluationBatchIdUi) return
    void syncMobileBatchPhotos()
  }, [activeTab, evaluationBatchIdUi, syncMobileBatchPhotos])

  useEffect(() => {
    if (activeTab !== "evaluator" || !evaluationBatchIdUi) return
    const t = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      void syncMobileBatchPhotos()
    }, MOBILE_BATCH_POLL_INTERVAL_MS)
    return () => window.clearInterval(t)
  }, [activeTab, evaluationBatchIdUi, syncMobileBatchPhotos])

  useEffect(() => {
    if (activeTab !== "evaluator" || !evaluationBatchIdUi) return
    const scheduleSyncFromRealtime = () => {
      if (mobileBatchRealtimeDebounceRef.current) window.clearTimeout(mobileBatchRealtimeDebounceRef.current)
      mobileBatchRealtimeDebounceRef.current = window.setTimeout(() => {
        mobileBatchRealtimeDebounceRef.current = null
        void syncMobileBatchPhotos()
      }, MOBILE_BATCH_REALTIME_DEBOUNCE_MS)
    }
    const ch = supabaseBrowser
      .channel(`evaluar-batch-photos-${evaluationBatchIdUi}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "batch_photo_uploads",
          filter: `batch_id=eq.${evaluationBatchIdUi}`,
        },
        () => {
          scheduleSyncFromRealtime()
        },
      )
      .subscribe()
    return () => {
      if (mobileBatchRealtimeDebounceRef.current) {
        window.clearTimeout(mobileBatchRealtimeDebounceRef.current)
        mobileBatchRealtimeDebounceRef.current = null
      }
      void supabaseBrowser.removeChannel(ch)
    }
  }, [activeTab, evaluationBatchIdUi, supabaseBrowser, syncMobileBatchPhotos])

  syncMobileBatchPhotosRef.current = syncMobileBatchPhotos

  /** Misma pestaña u otra: la grilla de estación emite al insertar/actualizar filas → Paso 2 sincroniza al instante. */
  useEffect(() => {
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(BATCH_PHOTO_ACTIVITY_CHANNEL)
    } catch {
      return
    }
    bc.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; batchId?: string }
      if (d?.type !== "batch_photo_change" || typeof d.batchId !== "string" || !isDocenteBatchUuid(d.batchId)) return
      const bid = d.batchId.trim()
      let cur = evaluationBatchIdRef.current
      const persisted = readDocenteActiveBatchId()
      if (!cur && persisted === bid) {
        evaluationBatchIdRef.current = bid
        setEvaluationBatchIdUi(bid)
        cur = bid
      }
      if (cur !== bid) return
      if (activeTabRef.current !== "evaluator") return
      if (mobileBatchRealtimeDebounceRef.current) window.clearTimeout(mobileBatchRealtimeDebounceRef.current)
      mobileBatchRealtimeDebounceRef.current = window.setTimeout(() => {
        mobileBatchRealtimeDebounceRef.current = null
        void syncMobileBatchPhotosRef.current()
      }, MOBILE_BATCH_REALTIME_DEBOUNCE_MS)
    }
    return () => {
      bc?.close()
    }
  }, [])

  /** Otra pestaña fijó el lote en localStorage (estación docente). */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DOCENTE_ACTIVE_BATCH_ID_KEY || e.newValue == null || e.newValue === "") return
      let id: string | null = null
      try {
        const p = JSON.parse(e.newValue) as unknown
        id = typeof p === "string" ? p : e.newValue
      } catch {
        id = e.newValue.replace(/^"|"$/g, "")
      }
      if (!isDocenteBatchUuid(id)) return
      const v = id.trim()
      if (activeTabRef.current !== "evaluator") return
      evaluationBatchIdRef.current = v
      setEvaluationBatchIdUi(v)
      if (mobileBatchRealtimeDebounceRef.current) window.clearTimeout(mobileBatchRealtimeDebounceRef.current)
      mobileBatchRealtimeDebounceRef.current = window.setTimeout(() => {
        mobileBatchRealtimeDebounceRef.current = null
        void syncMobileBatchPhotosRef.current()
      }, MOBILE_BATCH_REALTIME_DEBOUNCE_MS)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  /** Extracción masiva de nombres: recorre grupos con archivos y nombre genérico, reutiliza /api/extract-name. No toca evaluación ni contratos. */
  const handleBulkNameExtraction = async () => {
    const groupsWithFiles = studentGroups.filter((g) => g.files.length > 0)
    const toProcess = groupsWithFiles.filter((g) => isGenericGroupName(g.studentName))
    if (toProcess.length === 0) {
      toast({
        title: groupsWithFiles.length === 0
          ? "No hay grupos con archivos para extraer nombres."
          : "Todos los grupos ya tienen un nombre asignado. Solo se actualizan nombres genéricos (Alumno 1, Alumno 2…).",
        variant: "default",
      })
      return
    }
    setIsExtractingNames(true)
    let found = 0
    let notFound = 0
    let errors = 0
    for (const grp of toProcess) {
      try {
        const formDataFD = new FormData()
        grp.files.forEach((f) => formDataFD.append("files", f.file))
        formDataFD.append("nameList", "[]")
        const response = await fetch("/api/extract-name", { method: "POST", body: formDataFD })
        const data = await response.json()
        if (!response.ok || !data.success) {
          notFound++
          continue
        }
        const detectedNames = Array.isArray(data.suggestions) ? (data.suggestions as string[]) : []
        const numDetected = detectedNames.length
        if (numDetected > 0) {
          const visibleGroupName = detectedNames.map((n) => n.trim()).join(", ")
          setStudentGroups((groups) =>
            groups.map((g) => (g.id === grp.id ? { ...g, studentName: visibleGroupName } : g)),
          )
          found++
        } else {
          notFound++
        }
      } catch (_e) {
        errors++
      }
    }
    setIsExtractingNames(false)
    const total = toProcess.length
    if (found > 0 || notFound > 0 || errors > 0) {
      toast({
        title: "Extracción masiva finalizada.",
        description: `Procesados: ${total}. Encontrados: ${found}. No encontrados: ${notFound}.${errors > 0 ? ` Errores: ${errors}.` : ""}`,
        variant: errors > 0 ? "default" : "default",
      })
    }
  }

  const handleAlternativeChange = (groupId: string, questionKey: string, newValue: string) => {
    const { pautaEstructurada, puntajeTotal, porcentajeExigencia } = form.getValues()
    const puntajeTotalNum = Number(puntajeTotal)
    const porcentajeExigenciaNum = Number(porcentajeExigencia)

    console.log("[v0] Editando respuesta:", questionKey, "->", newValue)

    setStudentGroups((prevGroups) => {
      return prevGroups.map((group) => {
        if (group.id !== groupId) return group

        const newGroup = { ...group }
        const alternatives =
          newGroup.retroalimentacion?.retroalimentacion_alternativas || newGroup.alternativas_corregidas

        if (alternatives) {
          const alternativeIndex = alternatives.findIndex((a) => a.pregunta === questionKey)

          if (alternativeIndex !== -1) {
            // 1. Aplicar la corrección
            alternatives[alternativeIndex].respuesta_estudiante = newValue.trim().toUpperCase()

            // 2. RE-CÁLCULO LOCAL INMEDIATO DE LA NOTA Y PUNTAJE
            const newScores = calculateFinalScore(
              pautaEstructurada,
              alternatives, // Usamos las alternativas corregidas
              newGroup.detalle_desarrollo, // Usamos el detalle de desarrollo de la IA
              puntajeTotalNum,
              porcentajeExigenciaNum,
            )

            console.log("[v0] Nuevo puntaje calculado:", newScores.puntaje, "Nota:", newScores.nota)

            newGroup.puntaje = newScores.puntaje
            newGroup.nota = newScores.nota
            newGroup.puntosAprobacion = newScores.puntosAprobacion
            newGroup.puntosMaximos = newScores.puntosMaximos
            newGroup.alternativas_corregidas = alternatives // Aseguramos que las alternativas editadas se guarden
            if (newGroup.retroalimentacion) {
              newGroup.retroalimentacion = {
                ...newGroup.retroalimentacion,
                retroalimentacion_alternativas: [...alternatives],
              }
            }
          }
        }
        return newGroup
      })
    })
  }

  // Actualizar la respuesta correcta (clave) cuando el profesor la edita; recalcula puntaje y nota
  const handleCorrectAnswerChange = (groupId: string, questionKey: string, newCorrectValue: string) => {
    const { pautaEstructurada, puntajeTotal, porcentajeExigencia } = form.getValues()
    const puntajeTotalNum = Number(puntajeTotal)
    const porcentajeExigenciaNum = Number(porcentajeExigencia)

    setStudentGroups((prevGroups) => {
      return prevGroups.map((group) => {
        if (group.id !== groupId) return group

        const newGroup = { ...group }
        const alternatives =
          newGroup.retroalimentacion?.retroalimentacion_alternativas || newGroup.alternativas_corregidas

        if (alternatives) {
          const alternativeIndex = alternatives.findIndex((a) => a.pregunta === questionKey)
          if (alternativeIndex !== -1) {
            alternatives[alternativeIndex].respuesta_correcta = newCorrectValue.trim().toUpperCase()

            const newScores = calculateFinalScore(
              pautaEstructurada,
              alternatives,
              newGroup.detalle_desarrollo,
              puntajeTotalNum,
              porcentajeExigenciaNum,
            )

            newGroup.puntaje = newScores.puntaje
            newGroup.nota = newScores.nota
            newGroup.puntosAprobacion = newScores.puntosAprobacion
            newGroup.puntosMaximos = newScores.puntosMaximos
            newGroup.alternativas_corregidas = [...alternatives]
            if (newGroup.retroalimentacion) {
              newGroup.retroalimentacion = {
                ...newGroup.retroalimentacion,
                retroalimentacion_alternativas: [...alternatives],
              }
            }
          }
        }
        return newGroup
      })
    })
  }

  // Función para manejar la evaluación de un solo grupo (usada para confirmación OMR individual)
  const handleEvaluateSingleGroup = async (groupId: string) => {
    if (!evaluationBatchIdRef.current) {
      evaluationBatchIdRef.current = crypto.randomUUID()
      setEvaluationBatchIdUi(evaluationBatchIdRef.current)
    }
    const {
      rubrica,
      pauta,
      flexibilidad,
      tipoEvaluacion,
      areaConocimiento,
      puntajeTotal,
      nivelEducativo,
      nombresGrupales,
      porcentajeExigencia,
      pautaEstructurada,
      pautaCorrectaAlternativas,
      tipoPrueba,
    } = form.getValues()
    const puntajeTotalNum = Number(puntajeTotal)
    const porcentajeExigenciaNum = Number(porcentajeExigencia)

    // canonicalize-on-payload: si hay Prueba Base seleccionada y cargada en memoria,
    // forzamos el payload a usar la pauta derivada de esa fuente canónica.
    let pautaEstructuradaFinal = pautaEstructurada || ""
    let pautaCorrectaAlternativasFinal = pautaCorrectaAlternativas || ""
    const selectedSourceExamIdTrimmed =
      typeof selectedEvaluatorSourceExamId === "string" ? selectedEvaluatorSourceExamId.trim() : ""
    const sourceExamContextActive =
      evaluatorInstrumentSource === "source_exam" ||
      evaluatorInstrumentSource === "both" ||
      !!evaluatorEvaluationBaseSnapshot?.items?.length
    const resolvedSourceExamId =
      selectedSourceExamIdTrimmed || (sourceExamContextActive ? lastActiveEvaluatorSourceExamIdRef.current.trim() : "")
    if (sourceExamContextActive && evaluatorEvaluationBaseSnapshot?.items?.length) {
      const canonical = toCanonicalPautaFromEvaluationBaseItems(evaluatorEvaluationBaseSnapshot.items)
      console.log("CANONICAL PAYLOAD", {
        pautaEstructurada: canonical.pautaEstructurada,
        pautaCorrectaAlternativas: canonical.pautaCorrectaAlternativas,
      })
      if (canonical.pautaEstructurada.trim()) pautaEstructuradaFinal = canonical.pautaEstructurada
      if (canonical.pautaCorrectaAlternativas.trim()) pautaCorrectaAlternativasFinal = canonical.pautaCorrectaAlternativas
    }

    const traceAnswerKey = buildTeacherAnswerKeyFromFormPauta(
      String(pautaEstructuradaFinal),
      String(pautaCorrectaAlternativasFinal),
      (tipoPrueba || "mixta") as any,
    )
    const evaluationTracePayload = {
      tipoPrueba: tipoPrueba || "mixta",
      evaluatorInstrumentSource: evaluatorInstrumentSource,
      selectedEvaluatorSourceExamId: selectedEvaluatorSourceExamId || "",
      pautaEstructuradaFinal: String(pautaEstructuradaFinal),
      pautaCorrectaAlternativasFinal: String(pautaCorrectaAlternativasFinal),
      answerKeyFromTemplateSummary: traceAnswerKey
        ? {
            totalPreguntas: traceAnswerKey.totalPreguntas,
            respuestasLength: traceAnswerKey.respuestas.length,
            primeras10: traceAnswerKey.respuestas.slice(0, 10).map((r) => ({
              pregunta: r.pregunta,
              respuestaCorrecta: r.respuestaCorrecta,
            })),
          }
        : null,
    }

    const group = studentGroups.find((g) => g.id === groupId)
    if (!group || group.files.length === 0) return false

    setStudentGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, isEvaluating: true, isEvaluated: false, error: undefined } : g)),
    )

    let profileIds: { teacher_id: string; school_id: string } | null = null
    try {
      const pr = await fetch("/api/profile")
      const pj = await pr.json()
      if (pj?.profile?.teacher_id) {
        profileIds = { teacher_id: pj.profile.teacher_id, school_id: pj.profile.school_id || "" }
      }
    } catch (_) {}
    const teacherIdForPayload = profileIds?.teacher_id ?? null
    const schoolIdForPayload = profileIds?.school_id ?? null

    const displayName = displayStudentNameForEvaluateGroup(group, studentGroups, groupId)
    const { urls: evaluateFileUrls, mimes: evaluateFileMimes } = await resolveFileUrlsForEvaluate(group.files)

    const payload = {
      fileUrls: evaluateFileUrls,
      fileMimeTypes: evaluateFileMimes,
      rubrica,
      pauta,
      flexibilidad: flexibilidad[0],
      tipoEvaluacion,
      areaConocimiento,
      userEmail,
      puntajeTotal: puntajeTotalNum,
      nivelEducativo,
      nombresGrupales,
      porcentajeExigencia: porcentajeExigenciaNum,
      pautaEstructurada: pautaEstructuradaFinal,
      pautaCorrectaAlternativas: pautaCorrectaAlternativasFinal,
      tipoPrueba: tipoPrueba || "mixta",
      respuestasAlternativas: group.alternativas_corregidas,
      captureMode: captureMode,
      ...(teacherIdForPayload && { teacher_id: teacherIdForPayload }),
      ...(schoolIdForPayload && { school_id: schoolIdForPayload }),
      evaluation_title: form.getValues("nombrePrueba") ?? "",
      evaluation_subject: form.getValues("asignatura") ?? "",
      course_id: form.getValues("curso") ?? "",
      nombreEstudiante: displayName,
      student_rut: group.studentRut && String(group.studentRut).trim() !== "" ? String(group.studentRut).trim() : undefined,
      omrTemplateVariant: selectedOmrTemplateVariant,
      evaluation_batch_id: evaluationBatchIdRef.current ?? undefined,
      ...(resolvedSourceExamId ? { source_exam_id: resolvedSourceExamId } : {}),
      source_exam_context_active: sourceExamContextActive,
      ...(omrClosedLayoutMode === "auto" ? {} : { omrClosedLayoutMode }),
    }

    const result = await evaluate(payload)

    setStudentGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g
        if (result.success) {
            if (result.saved) {
            const evalId = (result as { evaluation_id?: string }).evaluation_id
            if (typeof evalId === "string") {
              setLastSavedEvaluationId(evalId)
              setLastSaveReason(null)
              setLastSaveError(null)
              if (process.env.NODE_ENV !== "production") console.info("[UI] saved evaluation_id", evalId)
              setActiveTab("evaluaciones")
              toast({ title: "Evaluación guardada y agregada al listado." })
              loadEvaluationsList()
              setShowRetrySaveButton(false)
              lastFailedSaveRef.current = null
              ;(async () => {
                const finalStudentName = getFinalStudentNameForSync(group, null) || displayName
                const finalStudentRut = getFinalStudentRutForSync(group, null)
                const finalCourseLabel = getFinalCourseLabel(null)
                if (!finalStudentName) {
                  setLastStudentSyncResult({
                    ok: false,
                    evaluation_id: evalId,
                    received_student_name: "",
                    received_course_label: finalCourseLabel,
                    normalized_student_name: "",
                    student_profile_id: null,
                    created_or_existing: null,
                    message: "student_name vacío en UI",
                  })
                  toast({ title: "La evaluación se guardó, pero no había nombre de estudiante para sincronizar", variant: "default" })
                  return
                }
                try {
                  const r = await fetch(`/api/evaluations/${evalId}/sync-student`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      student_name: finalStudentName,
                      course_label: finalCourseLabel,
                      student_rut: finalStudentRut,
                    }),
                  })
                  const j = await r.json()
                  setLastStudentSyncResult({
                    ok: !!j.ok,
                    evaluation_id: j.evaluation_id ?? evalId,
                    received_student_name: j.received_student_name ?? finalStudentName,
                    received_course_label: j.received_course_label ?? null,
                    normalized_student_name: j.normalized_student_name ?? "",
                    student_profile_id: j.student_profile_id ?? null,
                    created_or_existing: j.created_or_existing ?? null,
                    message: j.message ?? "",
                  })
                  if (j.ok) {
                    loadStudentsList()
                    loadEvaluationsList()
                    setStudentsListFetchKey((k) => k + 1)
                    await registerAuditAction(
                      "ALUMNO_EDITADO",
                      evalId,
                      `${finalStudentName}${finalCourseLabel ? ` · ${finalCourseLabel}` : ""}`,
                    )
                  } else {
                    toast({ title: "La evaluación se guardó, pero no se pudo sincronizar el estudiante", variant: "default" })
                  }
                } catch {
                  setLastStudentSyncResult({
                    ok: false,
                    evaluation_id: evalId,
                    received_student_name: finalStudentName,
                    received_course_label: finalCourseLabel,
                    normalized_student_name: "",
                    student_profile_id: null,
                    created_or_existing: null,
                    message: "Error de red al llamar sync-student",
                  })
                  toast({ title: "La evaluación se guardó, pero no se pudo sincronizar el estudiante", variant: "default" })
                }
              })()
            } else {
              toast({ title: "Evaluación guardada y agregada al listado." })
              loadEvaluationsList()
              setShowRetrySaveButton(false)
              lastFailedSaveRef.current = null
            }
          } else {
            const saveErrorMsg = typeof (result as { save_error?: string }).save_error === "string" ? (result as { save_error: string }).save_error : "Error desconocido"
            const reason = typeof (result as { reason?: string }).reason === "string" ? (result as { reason: string }).reason : null
            setLastSaveReason(reason)
            setLastSaveError(saveErrorMsg)
            toast({ title: "❌ No se pudo guardar: " + (reason || saveErrorMsg), variant: "destructive" })
            lastFailedSaveRef.current = {
              result: {
                puntaje: result.puntaje,
                nota: result.nota,
                retroalimentacion: result.retroalimentacion,
                alternativas_corregidas: result.alternativas_corregidas ?? result.retroalimentacion?.retroalimentacion_alternativas,
                detalle_desarrollo: result.detalle_desarrollo,
                puntosAprobacion: result.puntosAprobacion,
                puntosMaximos: result.puntosMaximos,
              },
              opts: {
                teacher_id: teacherIdForPayload ?? undefined,
                school_id: schoolIdForPayload ?? undefined,
                title: form.getValues("nombrePrueba") || undefined,
                subject: form.getValues("asignatura") || undefined,
                course_id: form.getValues("curso") || undefined,
                student_name: group.studentName && String(group.studentName).trim() !== "" ? String(group.studentName).trim() : undefined,
                student_rut: group.studentRut && String(group.studentRut).trim() !== "" ? String(group.studentRut).trim() : undefined,
              },
            }
            setShowRetrySaveButton(true)
          }
          return {
            ...g,
            isEvaluating: false,
            isEvaluated: true,
            isValidationStep: false,
            retroalimentacion: result.retroalimentacion,
            puntaje: result.puntaje,
            nota: result.nota,
            detalle_desarrollo: result.detalle_desarrollo,
            puntosAprobacion: result.puntosAprobacion,
            puntosMaximos: result.puntosMaximos,
            alternativas_corregidas:
              result.alternativas_corregidas || result.retroalimentacion?.retroalimentacion_alternativas,
            shouldUseOfficialAzureOmr: result.shouldUseOfficialAzureOmr,
            officialOmrActivationReason: result.officialOmrActivationReason,
            officialOmrIntegrationEnabled: result.officialOmrIntegrationEnabled,
            officialOmrEngineSelected: result.officialOmrEngineSelected,
            officialOmrEngineUsed: result.officialOmrEngineUsed,
            officialOmrFallbackUsed: result.officialOmrFallbackUsed,
            officialOmrFallbackReason: result.officialOmrFallbackReason ?? null,
            omrDebug: result.omrDebug,
              evaluationTrace: { payload: evaluationTracePayload },
            error: undefined,
            evaluation_id: (result as { evaluation_id?: string }).evaluation_id ?? undefined,
          }
        } else {
          return {
            ...g,
            isEvaluating: false,
            shouldUseOfficialAzureOmr: result.shouldUseOfficialAzureOmr,
            officialOmrActivationReason: result.officialOmrActivationReason,
            officialOmrIntegrationEnabled: result.officialOmrIntegrationEnabled,
            officialOmrEngineSelected: result.officialOmrEngineSelected,
            officialOmrEngineUsed: result.officialOmrEngineUsed,
            officialOmrFallbackUsed: result.officialOmrFallbackUsed,
            officialOmrFallbackReason: result.officialOmrFallbackReason ?? null,
            omrDebug: result.omrDebug,
              evaluationTrace: { payload: evaluationTracePayload },
            error: result.error,
          }
        }
      }),
    )
    return !!result.success
  }

  // Función para manejar evaluación masiva: servidor ejecuta un estudiante tras otro (sin fetch interno)
  const handleEvaluateGroups = async (groupIDsToEvaluate: string[]) => {
    ensureEvaluationBatchId()
    const {
      rubrica,
      pauta,
      flexibilidad,
      tipoEvaluacion,
      areaConocimiento,
      puntajeTotal,
      nivelEducativo,
      nombresGrupales,
      porcentajeExigencia,
      pautaEstructurada,
      pautaCorrectaAlternativas,
      tipoPrueba,
      nombrePrueba,
      asignatura,
      curso,
    } = form.getValues()
    const puntajeTotalNum = Number(puntajeTotal)
    const porcentajeExigenciaNum = Number(porcentajeExigencia)

    if (tipoPrueba !== "solo_alternativas") {
      if (!String(rubrica ?? "").trim()) {
        form.setError("rubrica", { type: "manual", message: "La rubrica es requerida." })
        return
      }
      if (!String(pautaEstructurada ?? "").trim()) {
        form.setError("pautaEstructurada", {
          type: "manual",
          message: "La pauta de puntajes estructurada es requerida para el rigor.",
        })
        return
      }
    }

    // Filtrar grupos validos
    const validGroups = studentGroups.filter(
      (g) => groupIDsToEvaluate.includes(g.id) && g.files.length > 0
    )

    if (validGroups.length === 0) return

    const validGroupById = new Map(validGroups.map((g) => [g.id, g]))

    // Marcar todos como evaluando
    setStudentGroups((prev) =>
      prev.map((g) => {
        if (groupIDsToEvaluate.includes(g.id) && g.files.length > 0) {
          return { ...g, isEvaluating: true, isEvaluated: false, error: undefined }
        }
        return g
      }),
    )

    // Inicializar progreso de batch
    const totalBatches = Math.ceil(validGroups.length / EVALUATE_BATCH_PARALLEL_SIZE)
    setBatchProgress({
      isActive: true,
      totalItems: validGroups.length,
      completedItems: 0,
      successCount: 0,
      errorCount: 0,
      currentBatch: 1,
      totalBatches,
    })

    let profileIds: { teacher_id: string; school_id: string } | null = null
    try {
      const pr = await fetch("/api/profile")
      const pj = await pr.json()
      if (pj?.profile?.teacher_id) {
        profileIds = { teacher_id: pj.profile.teacher_id, school_id: pj.profile.school_id || "" }
      }
    } catch (_) {}
    const teacherIdForPayload = profileIds?.teacher_id ?? null
    const schoolIdForPayload = profileIds?.school_id ?? null

    // canonicalize-on-payload (BATCH): aplicar la misma pauta canónica que SINGLE
    // para que /api/evaluate use la misma verdad (especialmente para answerKeyFromTemplate).
    const selectedSourceExamIdTrimmed =
      typeof selectedEvaluatorSourceExamId === "string" ? selectedEvaluatorSourceExamId.trim() : ""
    const sourceExamContextActive =
      evaluatorInstrumentSource === "source_exam" ||
      evaluatorInstrumentSource === "both" ||
      !!evaluatorEvaluationBaseSnapshot?.items?.length
    const resolvedSourceExamId =
      selectedSourceExamIdTrimmed || (sourceExamContextActive ? lastActiveEvaluatorSourceExamIdRef.current.trim() : "")

    let pautaEstructuradaFinal = pautaEstructurada
    let pautaCorrectaAlternativasFinal = pautaCorrectaAlternativas

    if (
      sourceExamContextActive &&
      evaluatorEvaluationBaseSnapshot?.items?.length
    ) {
      const canonical = toCanonicalPautaFromEvaluationBaseItems(evaluatorEvaluationBaseSnapshot.items)

      console.log("CANONICAL PAYLOAD BATCH", canonical)

      if (canonical.pautaEstructurada.trim()) {
        pautaEstructuradaFinal = canonical.pautaEstructurada
      }

      if (canonical.pautaCorrectaAlternativas.trim()) {
        pautaCorrectaAlternativasFinal = canonical.pautaCorrectaAlternativas
      }
    }

    const traceAnswerKey = buildTeacherAnswerKeyFromFormPauta(
      String(pautaEstructuradaFinal),
      String(pautaCorrectaAlternativasFinal),
      (tipoPrueba || "mixta") as any,
    )
    const evaluationTracePayloadCommon = {
      tipoPrueba: tipoPrueba || "mixta",
      evaluatorInstrumentSource: evaluatorInstrumentSource,
      selectedEvaluatorSourceExamId: selectedEvaluatorSourceExamId || "",
      pautaEstructuradaFinal: String(pautaEstructuradaFinal),
      pautaCorrectaAlternativasFinal: String(pautaCorrectaAlternativasFinal),
      answerKeyFromTemplateSummary: traceAnswerKey
        ? {
            totalPreguntas: traceAnswerKey.totalPreguntas,
            respuestasLength: traceAnswerKey.respuestas.length,
            primeras10: traceAnswerKey.respuestas.slice(0, 10).map((r) => ({
              pregunta: r.pregunta,
              respuestaCorrecta: r.respuestaCorrecta,
            })),
          }
        : null,
    }

    // Construir items para el batch endpoint (URLs firmadas cuando hay batchScanStoragePath)
    const batchItems = await Promise.all(
      validGroups.map(async (group) => {
        const { urls: evaluateFileUrls, mimes: evaluateFileMimes } = await resolveFileUrlsForEvaluate(group.files)
        const displayName = displayStudentNameForEvaluateGroup(group, studentGroups, group.id)
        return {
          groupId: group.id,
          payload: {
            fileUrls: evaluateFileUrls,
            fileMimeTypes: evaluateFileMimes,
            rubrica,
            pauta,
            flexibilidad: flexibilidad[0],
            tipoEvaluacion,
            areaConocimiento,
            userEmail,
            puntajeTotal: puntajeTotalNum,
            nivelEducativo,
            nombresGrupales,
            porcentajeExigencia: porcentajeExigenciaNum,
            pautaEstructurada: pautaEstructuradaFinal,
            pautaCorrectaAlternativas: pautaCorrectaAlternativasFinal,
            tipoPrueba: tipoPrueba || "mixta",
            respuestasAlternativas:
              Array.isArray(group.alternativas_corregidas) && group.alternativas_corregidas.length > 0
                ? group.alternativas_corregidas
                : answerKey
                  ? undefined
                  : group.alternativas_corregidas,
            captureMode: captureMode,
            ...(teacherIdForPayload && { teacher_id: teacherIdForPayload }),
            ...(schoolIdForPayload && { school_id: schoolIdForPayload }),
            evaluation_title: nombrePrueba ?? "",
            evaluation_subject: asignatura ?? "",
            course_id: curso ?? "",
            nombreEstudiante: displayName,
            student_rut: group.studentRut && String(group.studentRut).trim() !== "" ? String(group.studentRut).trim() : undefined,
            omrTemplateVariant: selectedOmrTemplateVariant,
            answerKeyFromTemplate: buildTeacherAnswerKeyFromFormPauta(
              String(pautaEstructuradaFinal),
              String(pautaCorrectaAlternativasFinal),
              (tipoPrueba || "mixta") as any,
            ),
            evaluation_batch_id: evaluationBatchIdRef.current ?? undefined,
            ...(resolvedSourceExamId ? { source_exam_id: resolvedSourceExamId } : {}),
            source_exam_context_active: sourceExamContextActive,
            ...(omrClosedLayoutMode === "auto" ? {} : { omrClosedLayoutMode }),
          },
        }
      }),
    )

    const batchEvaluateUrlAttempted =
      typeof window !== "undefined" ? `${window.location.origin}/api/evaluate/batch` : "/api/evaluate/batch"

    try {
      const response = await fetch("/api/evaluate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batchItems }),
      })

      if (!response.ok || !response.body) {
        const errRaw = await response.text().catch(() => "")
        let errorData: unknown = errRaw
        try {
          const t = errRaw.trim()
          if (t.startsWith("{") || t.startsWith("[")) errorData = JSON.parse(t) as unknown
        } catch {
          /* mantener texto */
        }
        const serialized =
          typeof errorData === "string" ? errorData : JSON.stringify(errorData, null, 2)
        console.error(
          "══════════════════════════════════════════════════════════════════════",
          "\n[evaluate/batch] FETCH FALLIDO — HTTP",
          response.status,
          response.statusText,
          "\nCUERPO (servidor):",
          errorData,
          "\nSERIALIZADO:\n",
          serialized,
          "\n══════════════════════════════════════════════════════════════════════",
        )
        window.alert(
          `[evaluate/batch] HTTP ${response.status} ${response.statusText}\n\n` +
            serialized.slice(0, 8000) +
            (serialized.length > 8000 ? "\n…(truncado en alert, ver consola)…" : ""),
        )
        reportEvaluateDiagnostic({
          phase: "evaluar_batch_http_error",
          urlAttempted: batchEvaluateUrlAttempted,
          method: "POST",
          fetchPathUsed: "/api/evaluate/batch",
          responseStatus: response.status,
          responseStatusText: response.statusText,
          responseBodyFromServer: serialized.slice(0, 120_000),
          hint: !response.body ? "Respuesta sin body legible para streaming" : "HTTP no OK en /api/evaluate/batch",
        })
        throw new Error(`Error HTTP ${response.status}: ${response.statusText} — ${serialized.slice(0, 500)}`)
      }

      // Leer stream NDJSON: acumular actualizaciones de grupos y aplicarlas en requestAnimationFrame (menos re-renders).
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let completed = 0
      let successes = 0
      let errors = 0
      let serverBatchSize = EVALUATE_BATCH_PARALLEL_SIZE
      const pendingResults = new Map<string, any>()
      let streamRafId: number | null = null

      const flushStreamUIUpdates = () => {
        const snapshot = new Map(pendingResults)
        if (snapshot.size > 0) {
          pendingResults.clear()
          setStudentGroups((prev) =>
            prev.map((g) => {
              const msg = snapshot.get(g.id)
              if (!msg) return g
              if (msg.success && msg.data) {
                return {
                  ...g,
                  isEvaluating: false,
                  isEvaluated: true,
                  isValidationStep: false,
                  retroalimentacion: msg.data.retroalimentacion,
                  puntaje: msg.data.puntaje,
                  nota: msg.data.nota,
                  detalle_desarrollo: msg.data.detalle_desarrollo,
                  puntosAprobacion: msg.data.puntosAprobacion,
                  puntosMaximos: msg.data.puntosMaximos,
                  alternativas_corregidas:
                    msg.data.alternativas_corregidas ||
                    msg.data.retroalimentacion?.retroalimentacion_alternativas,
                  omrDebug: msg.data.omrDebug,
                  evaluationTrace: { payload: evaluationTracePayloadCommon },
                  error: undefined,
                  evaluation_id: (msg.data as { evaluation_id?: string }).evaluation_id ?? undefined,
                }
              }
              return { ...g, isEvaluating: false, error: msg.error || "Error en la evaluacion" }
            }),
          )

          for (const [, msg] of snapshot) {
            if (!msg.success || !msg.data) continue
            if (msg.data.saved && typeof (msg.data as { evaluation_id?: string }).evaluation_id === "string") {
              setLastSavedEvaluationId((msg.data as { evaluation_id: string }).evaluation_id)
              setLastSaveReason(null)
              setLastSaveError(null)
              setActiveTab("evaluaciones")
            } else if (!msg.data.saved) {
              const reason =
                typeof (msg.data as { reason?: string }).reason === "string"
                  ? (msg.data as { reason: string }).reason
                  : null
              const saveError =
                typeof (msg.data as { save_error?: string }).save_error === "string"
                  ? (msg.data as { save_error: string }).save_error
                  : "Error desconocido"
              setLastSaveReason(reason)
              setLastSaveError(saveError)
              toast({ title: "❌ No se pudo guardar: " + (reason || saveError), variant: "destructive" })
            }
          }

          for (const [groupId, msg] of snapshot) {
            if (msg.success && msg.data?.saved && typeof (msg.data as { evaluation_id?: string }).evaluation_id === "string") {
              const evalId = (msg.data as { evaluation_id: string }).evaluation_id
              const group = validGroupById.get(groupId)
              const finalStudentName = getFinalStudentNameForSync(group ?? undefined, null)
              const finalStudentRut = getFinalStudentRutForSync(group ?? undefined, null)
              const finalCourseLabel = getFinalCourseLabel(null)
              if (finalStudentName) {
                fetch(`/api/evaluations/${evalId}/sync-student`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    student_name: finalStudentName,
                    course_label: finalCourseLabel,
                    student_rut: finalStudentRut,
                  }),
                })
                  .then(async (res) => {
                    const data = await res.json()
                    setLastStudentSyncResult({
                      ok: !!data.ok,
                      evaluation_id: data.evaluation_id ?? evalId,
                      received_student_name: data.received_student_name ?? finalStudentName,
                      received_course_label: data.received_course_label ?? null,
                      normalized_student_name: data.normalized_student_name ?? "",
                      student_profile_id: data.student_profile_id ?? null,
                      created_or_existing: data.created_or_existing ?? null,
                      message: data.message ?? "",
                    })
                    if (data.ok) {
                      loadStudentsList()
                      loadEvaluationsList()
                      setStudentsListFetchKey((k) => k + 1)
                      await registerAuditAction(
                        "ALUMNO_EDITADO",
                        evalId,
                        `${finalStudentName}${finalCourseLabel ? ` · ${finalCourseLabel}` : ""}`,
                      )
                    } else {
                      toast({ title: "La evaluación se guardó, pero no se pudo sincronizar el estudiante", variant: "default" })
                    }
                  })
                  .catch(() => {
                    setLastStudentSyncResult({
                      ok: false,
                      evaluation_id: evalId,
                      received_student_name: finalStudentName,
                      received_course_label: finalCourseLabel,
                      normalized_student_name: "",
                      student_profile_id: null,
                      created_or_existing: null,
                      message: "Error de red al llamar sync-student",
                    })
                    toast({ title: "La evaluación se guardó, pero no se pudo sincronizar el estudiante", variant: "default" })
                  })
                  .finally(() => loadEvaluationsList())
              } else {
                setLastStudentSyncResult({
                  ok: false,
                  evaluation_id: evalId,
                  received_student_name: "",
                  received_course_label: finalCourseLabel,
                  normalized_student_name: "",
                  student_profile_id: null,
                  created_or_existing: null,
                  message: "student_name vacío en UI",
                })
                toast({ title: "La evaluación se guardó, pero no había nombre de estudiante para sincronizar", variant: "default" })
                loadEvaluationsList()
              }
            }
          }
        }

        const currentBatch = completed > 0 ? Math.floor((completed - 1) / serverBatchSize) + 1 : 0
        setBatchProgress((prev) => ({
          ...prev,
          completedItems: completed,
          successCount: successes,
          errorCount: errors,
          currentBatch,
        }))
      }

      const scheduleStreamFlush = () => {
        if (streamRafId !== null) return
        streamRafId = requestAnimationFrame(() => {
          streamRafId = null
          flushStreamUIUpdates()
        })
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg: unknown = JSON.parse(line)

            if (isEvaluateBatchMetaMsg(msg)) {
              const meta: EvaluateBatchNdjsonMeta = msg
              if (meta.batchSize >= 1) {
                serverBatchSize = meta.batchSize
              }
              setBatchProgress((prev) => ({
                ...prev,
                totalBatches: meta.totalBatches,
              }))
            } else if (
              msg &&
              typeof msg === "object" &&
              (msg as { type?: string }).type === "result"
            ) {
              const m = msg as {
                type: string
                groupId: string
                success: boolean
                data?: unknown
                error?: string
              }
              completed++
              if (m.success) successes++
              else errors++
              pendingResults.set(m.groupId, m)
              scheduleStreamFlush()
            } else if (isEvaluateBatchDoneMsg(msg)) {
              if (streamRafId !== null) {
                cancelAnimationFrame(streamRafId)
                streamRafId = null
              }
              flushStreamUIUpdates()
              if (successes > 0) {
                toast({ title: "✅ Guardadas y agregadas al listado." })
                loadEvaluationsList()
              }
            }
          } catch (_e) {
            // Línea JSON inválida, ignorar
          }
        }
      }

      if (streamRafId !== null) {
        cancelAnimationFrame(streamRafId)
        streamRafId = null
      }
      flushStreamUIUpdates()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Error en evaluacion batch"
      const alreadyReportedHttp = typeof errorMsg === "string" && errorMsg.startsWith("Error HTTP ")
      if (!alreadyReportedHttp) {
        reportEvaluateDiagnostic({
          phase: "evaluar_batch_unexpected",
          urlAttempted: batchEvaluateUrlAttempted,
          method: "POST",
          fetchPathUsed: "/api/evaluate/batch",
          errorSerialized:
            err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
          hint: "Red, CORS, parseo del stream NDJSON u otro fallo distinto a HTTP ya informado arriba.",
        })
      }
      setStudentGroups((prev) =>
        prev.map((g) => {
          if (groupIDsToEvaluate.includes(g.id) && g.isEvaluating) {
            return { ...g, isEvaluating: false, error: errorMsg }
          }
          return g
        }),
      )
    } finally {
      setBatchProgress((prev) => ({ ...prev, isActive: false }))
    }
  }

  const handleEvaluateGroupsSequential = async (groupIDsToEvaluate: string[]) => {
    const validGroups = studentGroups.filter(
      (g) => groupIDsToEvaluate.includes(g.id) && g.files.length > 0,
    )
    if (validGroups.length === 0) return

    setBatchProgress({
      isActive: true,
      totalItems: validGroups.length,
      completedItems: 0,
      successCount: 0,
      errorCount: 0,
      currentBatch: 1,
      totalBatches: validGroups.length,
    })

    let completed = 0
    let successCount = 0
    let errorCount = 0
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    try {
      for (const group of validGroups) {
        try {
          const ok = await handleEvaluateSingleGroup(group.id)
          if (ok) successCount++
          else errorCount++
        } catch (err) {
          errorCount++
          const errMsg = err instanceof Error ? err.message : "Error en evaluación secuencial"
          setStudentGroups((prev) =>
            prev.map((g) => (g.id === group.id ? { ...g, isEvaluating: false, error: errMsg } : g)),
          )
        } finally {
          completed++
          setBatchProgress((prev) => ({
            ...prev,
            completedItems: completed,
            successCount,
            errorCount,
            currentBatch: completed > 0 ? completed : 1,
            totalBatches: validGroups.length,
          }))
        }

        if (completed < validGroups.length) {
          await sleep(SEQUENTIAL_EVALUATION_DELAY_MS)
        }
      }
    } finally {
      setBatchProgress((prev) => ({ ...prev, isActive: false }))
    }
  }

  const onEvaluateAll = async () => {
    if (batchProgress.isActive || isLoading) return
    const groupsToEvaluate = studentGroups
      .filter((g) => g.files.length > 0 && !g.isEvaluated && !g.isEvaluating)
      .map((g) => g.id)

    if (groupsToEvaluate.length === 0) {
      alert("No hay grupos con archivos para evaluar o todos ya han sido evaluados.")
      return
    }

    // Si algún grupo está en el paso de validación OMR, solo evaluamos ese grupo (individual).
    const validationGroup = studentGroups.find((g) => g.isValidationStep)
    if (validationGroup) {
      await handleEvaluateSingleGroup(validationGroup.id)
    } else {
      await handleEvaluateGroupsSequential(groupsToEvaluate)
    }
  }

  const exportToDocOrCsv = (formatType: "csv" | "doc") => {
    const evaluatedGroups = studentGroups.filter((g) => g.isEvaluated)
    if (evaluatedGroups.length === 0) {
      alert("No hay evaluaciones para exportar.")
      return
    }

    if (formatType === "doc") {
      const escHtml = (s: string) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
      // Generar documento Word (.doc) básico con HTML (mismo criterio que preview/PDF: datos reales)
      const rows = evaluatedGroups
        .map((g) => {
          const rp = buildPedagogicalResumenFromGroup({
            alternativas_corregidas: g.alternativas_corregidas,
            puntaje: g.puntaje,
            puntosMaximos: g.puntosMaximos,
            puntosAprobacion: g.puntosAprobacion,
            detalle_desarrollo: g.detalle_desarrollo,
          })
          return [
            "<tr>",
            "<td>" + escHtml(formatStudentDisplayName(g.studentName) || "N/A") + "</td>",
            "<td>" + escHtml(String(g.puntaje || "N/A")) + "</td>",
            "<td>" + escHtml(String(g.nota ?? "N/A")) + "</td>",
            "<td>" + escHtml(rp.fortalezas || "N/A").replace(/\n/g, "<br>") + "</td>",
            "<td>" + escHtml(rp.areas_mejora || "N/A").replace(/\n/g, "<br>") + "</td>",
            "</tr>",
          ].join("")
        })
        .join("")
      const htmlContent = [
        "<html><head><meta charset=\"utf-8\"><title>Notas - Libel-IA</title>",
        "<style>table{border-collapse:collapse;width:100%;margin-top:20px;}th,td{border:1px solid #000;padding:10px;text-align:left;}th{background-color:#f2f2f2;}</style>",
        "</head><body><h1>Resumen de Notas - Libel-IA</h1><table>",
        "<thead><tr><th>Estudiante</th><th>Puntaje</th><th>Nota</th><th>Fortalezas</th><th>Áreas de Mejora</th></tr></thead>",
        "<tbody>",
        rows,
        "</tbody></table></body></html>",
      ].join("")

      const blob = new Blob([htmlContent], { type: "application/msword" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "notas_libel-ia.doc"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const isCurrentlyEvaluatingAny = studentGroups.some((g) => g.isEvaluating)
  const isCurrentlyValidatingAny = studentGroups.some((g) => g.isValidationStep) // 🚨 NUEVO: Comprobar si estamos en paso de validación
  const previewGroup = previewGroupId ? studentGroups.find((g) => g.id === previewGroupId) : null
  const handlePreview = async (groupId: string) => {
    const group = studentGroups.find((g) => g.id === groupId)
    if (!group || !group.retroalimentacion) return
    if (isMobile) {
      const docEl = (
        <ReportDocument group={group} formData={form.getValues()} logoPreview={logoPreview} />
      )
      const blob = await pdf(docEl).toBlob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
    } else {
      setPreviewGroupId(groupId)
    }
  }

  const handleDownloadCorrectionReportsZip = async () => {
    const eligible = studentGroups.filter(
      (g): g is StudentGroup & { evaluation_id: string } =>
        Boolean(g.isEvaluated && !g.error && typeof g.evaluation_id === "string" && g.evaluation_id.trim() !== ""),
    )
    const evaluatedNoId = studentGroups.filter((g) => g.isEvaluated && !g.error && !g.evaluation_id).length

    if (eligible.length === 0) {
      toast({
        variant: "destructive",
        title: "No hay informes persistidos",
        description:
          "Solo se empaquetan evaluaciones ya guardadas con evaluation_id. Corrija o guarde las que falten.",
      })
      return
    }

    if (eligible.length > MAX_CORRECTION_REPORTS_ZIP_PHASE1) {
      toast({
        variant: "destructive",
        title: "Demasiados estudiantes (fase 1)",
        description: `Límite prudente: ${MAX_CORRECTION_REPORTS_ZIP_PHASE1} informes por ZIP en el navegador. Hay ${eligible.length} elegibles. Descargue por partes o reduzca el lote.`,
      })
      return
    }

    setCorrectionReportsZipBusy(true)
    setCorrectionReportsZipProgress({ current: 0, total: eligible.length, label: "Iniciando…" })

    const formValues = form.getValues()
    const zip = new JSZip()
    const folder = zip.folder("Informes_Evaluacion_Pedagogica")
    if (!folder) {
      setCorrectionReportsZipBusy(false)
      setCorrectionReportsZipProgress(null)
      toast({ variant: "destructive", title: "ZIP", description: "No se pudo crear la carpeta interna del ZIP." })
      return
    }

    const failures: string[] = []
    const warningsAll: string[] = []
    let pdfFromApiCount = 0

    for (let i = 0; i < eligible.length; i++) {
      const g = eligible[i]!
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      try {
        let groupForPdf: StudentGroup | CorrectionReportGroupForPdf = g

        if (studentGroupHasLocalPedagogicalReportPayload(g)) {
          setCorrectionReportsZipProgress({
            current: i,
            total: eligible.length,
            label: `PDF (mismo informe que en sesión): ${formatStudentDisplayName(g.studentName) || g.studentName || "N/A"}`,
          })
          groupForPdf = g
        } else {
          setCorrectionReportsZipProgress({
            current: i,
            total: eligible.length,
            label: `Cargando persistido (API): ${formatStudentDisplayName(g.studentName) || g.studentName || "N/A"}`,
          })
          const res = await fetch(`/api/evaluations/${encodeURIComponent(g.evaluation_id)}`, {
            credentials: "include",
            cache: "no-store",
          })
          const j = (await res.json()) as Record<string, unknown>
          if (!res.ok) {
            const err =
              typeof j.error === "string"
                ? j.error
                : typeof j.message === "string"
                  ? j.message
                  : `HTTP ${res.status}`
            failures.push(`${formatStudentDisplayName(g.studentName) || g.studentName || "Estudiante"}: ${err}`)
            continue
          }

          const built = buildCorrectionReportGroupFromApiDetail(j as EvaluationDetailJsonForCorrectionZip)
          if (!built.ok) {
            failures.push(`${formatStudentDisplayName(g.studentName) || g.studentName || "Estudiante"}: ${built.error}`)
            continue
          }
          for (const w of built.warnings)
            warningsAll.push(`${formatStudentDisplayName(g.studentName) || g.studentName || "Estudiante"}: ${w}`)
          pdfFromApiCount++
          groupForPdf = built.group
        }

        setCorrectionReportsZipProgress({
          current: i,
          total: eligible.length,
          label: `Generando PDF: ${formatStudentDisplayName(g.studentName) || g.studentName || "N/A"}`,
        })

        const docEl = <ReportDocument group={groupForPdf} formData={formValues} logoPreview={logoPreview} />
        const blob = await pdf(docEl).toBlob()
        if (!blob || blob.size === 0) {
          failures.push(`${formatStudentDisplayName(g.studentName) || g.studentName || "Estudiante"}: PDF vacío`)
          continue
        }

        const shortId = g.evaluation_id.replace(/-/g, "").slice(0, 8)
        const namePart = sanitizeCorrectionZipPart(formatStudentDisplayName(g.studentName) || g.studentName, "Estudiante")
        const fileName = `${sanitizeCorrectionZipPart(`${namePart}_${shortId}`, "informe")}.pdf`
        folder.file(fileName, await blob.arrayBuffer())

        setCorrectionReportsZipProgress({
          current: i + 1,
          total: eligible.length,
          label: `Listo: ${formatStudentDisplayName(g.studentName) || g.studentName || "N/A"}`,
        })
      } catch (e) {
        failures.push(
          `${formatStudentDisplayName(g.studentName) || g.studentName || "Estudiante"}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }

    setCorrectionReportsZipProgress({
      current: eligible.length,
      total: eligible.length,
      label: "Comprimiendo…",
    })

    const successful = eligible.length - failures.length
    if (successful === 0) {
      setCorrectionReportsZipBusy(false)
      setCorrectionReportsZipProgress(null)
      toast({
        variant: "destructive",
        title: "No se generó el ZIP",
        description:
          failures.slice(0, 6).join("\n") + (failures.length > 6 ? `\n…y ${failures.length - 6} más.` : ""),
      })
      return
    }

    try {
      const out = await zip.generateAsync({ type: "blob", compression: "DEFLATE" })
      const titlePart = sanitizeCorrectionZipPart(formValues.nombrePrueba || "Evaluacion", "Evaluacion")
      const zipName = `${titlePart}_InformesEstudiantes_PDF_${format(new Date(), "yyyyMMdd_HHmm")}.zip`
      try {
        saveAs(out, zipName)
      } catch (saveErr) {
        const url = URL.createObjectURL(out)
        try {
          const a = document.createElement("a")
          a.href = url
          a.download = zipName
          a.rel = "noopener"
          a.style.display = "none"
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        } finally {
          URL.revokeObjectURL(url)
        }
        if (process.env.NODE_ENV !== "production") console.warn("[correctionZIP] saveAs fallback:", saveErr)
      }

      const descParts: string[] = [`En el ZIP: ${successful} de ${eligible.length} PDF(s) (mismo informe que «Descargar PDF»).`]
      if (pdfFromApiCount > 0) {
        descParts.push(`${pdfFromApiCount} reconstruido(s) desde API (faltaban datos mínimos en esta pantalla).`)
      } else if (successful > 0 && failures.length === 0) {
        descParts.push("Fuente: datos de la sesión actual (mismo objeto que el PDF individual).")
      }
      if (evaluatedNoId > 0) {
        descParts.push(`${evaluatedNoId} evaluado(s) sin evaluation_id no se incluyeron.`)
      }
      if (failures.length > 0) {
        descParts.push(`Omitidos por error: ${failures.length}. Ej.: ${failures.slice(0, 2).join("; ")}`)
      }
      if (warningsAll.length > 0) {
        descParts.push(`Avisos: ${warningsAll.slice(0, 2).join(" · ")}${warningsAll.length > 2 ? "…" : ""}`)
      }
      toast({
        title: failures.length > 0 ? "ZIP parcial (revisar avisos)" : "ZIP descargado",
        description: descParts.join(" "),
      })
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error al comprimir",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setCorrectionReportsZipBusy(false)
      setCorrectionReportsZipProgress(null)
    }
  }

  const selectedNivel = form.watch("nivelEducativo")
  // ✅ CORRECCIÓN DE PESTAÑAS: Definición para ajustar etiquetas
  const isSuperior = ["Técnico Superior", "Universitario", "Postgrado"].includes(selectedNivel)
  const cursoLabel = isSuperior ? "Sección" : "Curso"
  const departamentoLabel = isSuperior ? "Escuela/Carrera" : "Departamento"
  const rootThemeClass = activeTab === "inicio" ? "theme-ocaso" : theme
  const currentEmail = String(mainProfile?.user?.email ?? "").toLowerCase()
  const currentRole = String(mainProfile?.profile?.role ?? "").toUpperCase()
  const isIvan =
    currentEmail.includes("ivan") ||
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_DEV_MASTER_EMAIL != null &&
      currentEmail === String(process.env.NEXT_PUBLIC_DEV_MASTER_EMAIL).toLowerCase())
  const isAdminRole =
    currentRole === "DIRECCION" || currentRole === "UTP" || currentRole === "ADMIN_INSTITUCION"
  const canSeePanelColegio = isIvan || isAdminRole
  /** Panel técnico OMR en resultados: solo Ivan / admin institucional / rol ADMIN; oculto para docentes normales. */
  const canSeeOmrOfficialDebugPanel = isIvan || isAdminRole || currentRole === "ADMIN"

  const evaluateDiagnosticText = evaluateDiagnostic
    ? (() => {
        try {
          return JSON.stringify(evaluateDiagnostic, null, 2)
        } catch {
          return String(evaluateDiagnostic)
        }
      })()
    : ""

  return (
    <EvaluatorRootDiv className={rootThemeClass}>
      {evaluateDiagnostic != null && (
        <div
          className="fixed inset-0 z-[99999] flex flex-col gap-3 bg-zinc-950 p-4 text-zinc-100 shadow-2xl"
          role="alertdialog"
          aria-label="Modo diagnóstico evaluación"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-red-400">Modo diagnóstico — error en evaluación</h2>
            <Button
              type="button"
              size="lg"
              className="bg-amber-500 text-black hover:bg-amber-400 font-semibold"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(evaluateDiagnosticText)
                  toast({ title: "Copiado al portapapeles." })
                } catch {
                  toast({ title: "No se pudo copiar; selecciona el texto manualmente.", variant: "destructive" })
                }
              }}
            >
              COPIAR ERROR PARA GEMINI
            </Button>
            <Button type="button" variant="outline" className="border-zinc-500 text-zinc-100" onClick={() => clearEvaluateDiagnostic()}>
              Cerrar panel
            </Button>
          </div>
          <textarea
            readOnly
            className="min-h-0 w-full flex-1 resize-none rounded border border-zinc-600 bg-zinc-900 p-3 font-mono text-xs leading-relaxed text-zinc-100"
            value={evaluateDiagnosticText}
            spellCheck={false}
          />
        </div>
      )}
      <GlobalStyles />
      {/* Banner: sin perfil completado no se guarda */}
      {mainProfile?.user && !mainProfile?.profile?.teacher_id && !onboardRefreshFailed && (
        <div className="bg-amber-500/15 border border-amber-500/40 text-amber-900 dark:text-amber-200 px-4 py-2 flex flex-wrap items-center gap-2 justify-center">
          <span>No se guardará hasta completar tu perfil.</span>
          <Button variant="outline" size="sm" onClick={() => setShowOnboardingModal(true)} className="border-amber-600 text-amber-800 dark:text-amber-200">
            Completar perfil
          </Button>
        </div>
      )}
      {onboardRefreshFailed && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-900 dark:text-red-200 px-4 py-2 text-center text-sm">
          Perfil guardado pero no se pudo verificar. Refresca la página (F5) para continuar.
        </div>
      )}

      {INTERNAL_SUPPORT_UI && mainProfile && (
        <div className="mx-4 mb-2 rounded border border-dashed border-[var(--border-color)] bg-[var(--bg-muted)] px-3 py-2 text-xs font-mono text-[var(--text-muted)]">
          <span className="font-semibold">[DEV] Perfil:</span> userId={mainProfile.user?.id ?? "—"} | teacher_id={mainProfile.profile?.teacher_id ?? "null"} | school_id={mainProfile.profile?.school_id ?? "null"}
        </div>
      )}

      {INTERNAL_SUPPORT_UI && (
        <div className="mx-4 mb-2 rounded border border-amber-500/50 bg-[var(--bg-muted)] overflow-hidden">
          <button
            type="button"
            onClick={() => setDebugPanelOpen((o) => !o)}
            className="w-full px-3 py-2 text-left text-sm font-semibold text-amber-800 dark:text-amber-200 flex items-center justify-between"
          >
            Debug UI
            <span>{debugPanelOpen ? "▼" : "▶"}</span>
          </button>
          {debugPanelOpen && (
            <div className="px-3 pb-3 pt-0 space-y-4 text-xs font-mono border-t border-amber-500/30">
              <div>
                <div className="font-semibold text-[var(--text-accent)] mb-1">A) Ver informe</div>
                <div className="bg-black/5 dark:bg-white/5 rounded p-2">
                  {verDebug ? (
                    <>
                      <div>último evaluationId: {verDebug.evaluationId}</div>
                      <div>último status: {verDebug.status}</div>
                      <div>error: {verDebug.error ?? "—"}</div>
                      <pre className="mt-1 overflow-auto max-h-24">{JSON.stringify(verDebug.payload, null, 2)}</pre>
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">Sin último intento de Ver</span>
                  )}
                </div>
              </div>
              <div>
                <div className="font-semibold text-[var(--text-accent)] mb-1">B) Archivar</div>
                <div className="bg-black/5 dark:bg-white/5 rounded p-2">
                  {archiveDebug ? (
                    <>
                      <div>total evaluaciones: {archiveDebug.total}</div>
                      <div>status por evaluación: {archiveDebug.rows.map((r) => `${r.id.slice(0, 8)}:${r.status}(archivar=${r.canShowArchive})`).join(", ")}</div>
                      {archiveDebug.lastClick && <div>último click: {archiveDebug.lastClick}</div>}
                      {archiveDebug.lastResponse && <div>última respuesta: status={archiveDebug.lastResponse.status} json={<pre className="inline">{JSON.stringify(archiveDebug.lastResponse.json)}</pre>}</div>}
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">Ir a pestaña Evaluaciones para ver datos</span>
                  )}
                </div>
              </div>
              <div>
                <div className="font-semibold text-[var(--text-accent)] mb-1">C) Perfil</div>
                <div className="bg-black/5 dark:bg-white/5 rounded p-2">
                  <div>hasSession: {!!mainProfile?.user}</div>
                  <div>profileLoaded: {!!mainProfile?.profile}</div>
                  <div>teacher_id: {mainProfile?.profile?.teacher_id ?? "null"}</div>
                  <div>school_id: {mainProfile?.profile?.school_id ?? "null"}</div>
                  <div>shouldShowOnboardingModal: {!!(mainProfile?.user && !mainProfile?.profile?.teacher_id && !onboardRefreshFailed)}</div>
                  <div>shouldShowProfileBanner: {!!(mainProfile?.user && !mainProfile?.profile?.teacher_id && !onboardRefreshFailed)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Modal obligatorio: completar perfil (no cerrable hasta guardar) */}
      <Dialog
        open={showOnboardingModal}
        onOpenChange={(open) => {
          if (open) setShowOnboardingModal(true)
          else if (mainProfile?.profile?.teacher_id) setShowOnboardingModal(false)
        }}
      >
        <DialogContent
          className="max-w-md"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Completa tu perfil</DialogTitle>
            <p className="text-sm text-[var(--text-muted)]">Para guardar y ver historial de evaluaciones, completa estos datos.</p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm font-medium text-[var(--text-accent)] mb-1">Nombre profesor</label>
              <Input
                placeholder="Tu nombre"
                value={onboardingForm.teacher_name}
                onChange={(e) => { setOnboardingForm((p) => ({ ...p, teacher_name: e.target.value })); setOnboardingError(null) }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-accent)] mb-1">Colegio</label>
              <Input
                placeholder="Nombre del colegio o escuela"
                value={onboardingForm.school_name}
                onChange={(e) => { setOnboardingForm((p) => ({ ...p, school_name: e.target.value })); setOnboardingError(null) }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-accent)] mb-1">Departamento (opcional)</label>
              <Input
                placeholder="Departamento"
                value={onboardingForm.department}
                onChange={(e) => { setOnboardingForm((p) => ({ ...p, department: e.target.value })); setOnboardingError(null) }}
              />
            </div>
            {onboardingError && <p className="text-sm text-red-600 dark:text-red-400">{onboardingError}</p>}
          </div>
          <DialogFooter>
            <Button
              disabled={onboardingSaving || !onboardingForm.teacher_name.trim() || !onboardingForm.school_name.trim()}
              onClick={async () => {
                setOnboardingError(null)
                setOnboardingSaving(true)
                try {
                  const r = await fetch("/api/profile/onboard", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      teacher_name: onboardingForm.teacher_name.trim(),
                      school_name: onboardingForm.school_name.trim(),
                      department: onboardingForm.department.trim() || undefined,
                    }),
                  })
                  const j = await r.json()
                  if (r.ok && j.success && j.profile?.teacher_id) {
                    setMainProfile((prev) => ({
                      user: prev?.user ?? { id: "", email: null },
                      profile: {
                        teacher_id: j.profile.teacher_id,
                        school_id: j.profile.school_id ?? null,
                      },
                    }))
                    setHasSessionTeacher(true)
                    setShowOnboardingModal(false)
                    setOnboardRefreshFailed(false)
                    setHistorialProfile((prev) => ({
                      user: prev?.user ?? { id: "", email: null },
                      profile: { teacher_id: j.profile.teacher_id },
                    }))
                    loadEvaluationsList()
                    fetch("/api/profile", { cache: "no-store" })
                      .then((res) => res.json())
                      .then((pj) => {
                        if (pj?.profile?.teacher_id) {
                          setMainProfile({ profile: pj.profile, user: pj.user })
                          setHistorialProfile({ profile: pj.profile, user: pj.user })
                        }
                      })
                      .catch(() => {})
                  } else if (r.ok && j.success && !j.profile?.teacher_id) {
                    setOnboardingError(j.step ? `[${j.step}] ${j.error || "Perfil guardado pero sin teacher_id"}` : "El servidor no devolvió teacher_id. Refresca (F5).")
                  } else {
                    setOnboardingError(j.step ? `[${j.step}] ${j.error || "Error"}` : (j.error || "Error al guardar perfil"))
                  }
                } catch (_) {
                  setOnboardingError("Error de conexión")
                } finally {
                  setOnboardingSaving(false)
                }
              }}
            >
              {onboardingSaving ? "Guardando…" : "Guardar perfil"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 🚨 MODIFICADO: SmartCameraModal ahora requiere el modo, la función de feedback y el estado de feedback */}
      {isCameraOpen && (
        <SmartCameraModal
          onCapture={(dataUrl, feedback) => handleCapture(dataUrl, captureMode, feedback)}
          onClose={() => {
            setIsCameraOpen(false)
            setCaptureMode(null)
            setCameraFeedback(null) // Limpiar feedback al cerrar
          }}
          captureMode={captureMode}
          onFeedbackChange={setCameraFeedback} // PASAR FUNCIÓN DE ACTUALIZACIÓN
          currentFeedback={cameraFeedback} // PASAR ESTADO ACTUAL
        />
      )}

      {/* Modal OMR de Respuestas Cerradas */}
          {/* {isClosedAnswerOMROpen && closedAnswerImageUrl && (
  <ClosedAnswerOMRModal
    imageUrl={closedAnswerImageUrl}
    onClose={() => {
      setIsClosedAnswerOMROpen(false)
      setClosedAnswerImageUrl("")
      setClosedAnswerTargetGroupId(null)
    }}
    onConfirm={handleClosedAnswerConfirm}
    onRescan={() => {
      setIsClosedAnswerOMROpen(false)
      setClosedAnswerImageUrl("")
    }}
  />
)} 
*/}

      {/* Modal OMR en tiempo real — flujo nuevo, no reemplaza el OMR actual */}
      <RealtimeOMRModal
        open={isRealtimeOMROpen}
        onClose={() => setIsRealtimeOMROpen(false)}
        onSaved={() => setIsRealtimeOMROpen(false)}
      />
      <TemplateOverlayOMRModal
        open={isTemplateOverlayOMROpen}
        onClose={() => setIsTemplateOverlayOMROpen(false)}
        onSaved={() => setIsTemplateOverlayOMROpen(false)}
      />
      <RobustLibeliaOMRModal
        open={isRobustOMRLibeliaOpen}
        onClose={() => setIsRobustOMRLibeliaOpen(false)}
        onSaved={() => setIsRobustOMRLibeliaOpen(false)}
      />
      <OMRSheetGeneratorModal
        open={isOMRSheetGeneratorOpen}
        onClose={() => setIsOMRSheetGeneratorOpen(false)}
      />

      {/* Modal de Seleccion de Modo de Captura */}
      {isCaptureModeSelectionOpen && (
        <div className="pdf-modal-backdrop">
          <Card className="max-w-md w-full p-6 space-y-4">
            <CardTitle className="text-[var(--text-accent)]">Seleccione el modo de captura</CardTitle>
            <CardDescription>
              Para optimizar el OCR y la corrección, indique qué tipo de sección va a fotografiar.
            </CardDescription>
            <div className="space-y-3">
              <Button
                className="w-full justify-start bg-transparent"
                variant="outline"
                onClick={() => {
                  setCaptureMode("sm_vf")
                  setIsCaptureModeSelectionOpen(false)
                  setIsCameraOpen(true)
                }}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Selección Múltiple / V/F (Marcas OMR)
              </Button>
              <Button
                className="w-full justify-start bg-transparent"
                variant="outline"
                onClick={() => {
                  setCaptureMode("terminos_pareados")
                  setIsCaptureModeSelectionOpen(false)
                  setIsCameraOpen(true)
                }}
              >
                <ClipboardList className="mr-2 h-4 w-4" /> Términos Pareados (Respuestas Cortas Numéricas)
              </Button>
              <Button
                className="w-full justify-start bg-transparent"
                variant="outline"
                onClick={() => {
                  setCaptureMode("desarrollo")
                  setIsCaptureModeSelectionOpen(false)
                  setIsCameraOpen(true)
                }}
              >
                <FileText className="mr-2 h-4 w-4" /> Desarrollo / Preguntas Abiertas (Texto)
              </Button>
              <Button
                className="w-full justify-start bg-transparent border-indigo-300 text-indigo-700"
                variant="outline"
                onClick={() => {
                  setIsCaptureModeSelectionOpen(false)
                  setCaptureMode("closed_answer")
                  setIsCameraOpen(true)
                }}
              >
                <ClipboardList className="mr-2 h-4 w-4" /> Plantilla Respuestas Cerradas (OMR)
              </Button>
              <Button
                className="w-full justify-start bg-transparent border-emerald-300 text-emerald-700"
                variant="outline"
                onClick={() => {
                  setIsCaptureModeSelectionOpen(false)
                  setIsRealtimeOMROpen(true)
                }}
              >
                <Camera className="mr-2 h-4 w-4" /> OMR en tiempo real (clave + cámara)
              </Button>
              <Button
                className="w-full justify-start bg-transparent border-sky-300 text-sky-700"
                variant="outline"
                onClick={() => {
                  setIsCaptureModeSelectionOpen(false)
                  setIsTemplateOverlayOMROpen(true)
                }}
              >
                <Camera className="mr-2 h-4 w-4" /> OMR con plantilla superpuesta (cámara)
              </Button>
              <Button
                className="w-full justify-start bg-transparent border-teal-300 text-teal-700"
                variant="outline"
                onClick={() => {
                  setIsCaptureModeSelectionOpen(false)
                  setIsRobustOMRLibeliaOpen(true)
                }}
              >
                <FileText className="mr-2 h-4 w-4" /> Corregir hoja OMR LibelIA (archivo)
              </Button>
              <Button
                className="w-full justify-start bg-transparent border-violet-300 text-violet-700"
                variant="outline"
                onClick={() => {
                  setIsCaptureModeSelectionOpen(false)
                  setIsOMRSheetGeneratorOpen(true)
                }}
              >
                <FileDown className="mr-2 h-4 w-4" /> Generar hoja OMR LibelIA
              </Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setIsCaptureModeSelectionOpen(false)}>
              Cancelar
            </Button>
          </Card>
        </div>
      )}

      {!isMobile && previewGroup && previewGroup.retroalimentacion && (
        <div className="pdf-modal-backdrop" role="dialog" aria-modal="true">
          <div className="pdf-modal">
            <div className="pdf-modal-header">
              <div className="font-semibold">
                Vista previa del informe — {formatStudentDisplayName(previewGroup.studentName) || previewGroup.studentName}
              </div>

              <div className="pdf-modal-actions">
                <PDFDownloadLink
                  document={
                    <ReportDocument group={previewGroup} formData={form.getValues()} logoPreview={logoPreview} />
                  }
                  fileName={`informe_${(formatStudentDisplayName(previewGroup.studentName) || previewGroup.studentName).replace(/[^a-zA-Z0-9]/g, "_")}.pdf`}
                >
                  {({ loading }) => (
                    <Button size="sm" disabled={loading}>
                      {loading ? (
                        "Preparando..."
                      ) : (
                        <>
                          <Printer className="mr-2 h-4 w-4" /> Descargar PDF
                        </>
                      )}
                    </Button>
                  )}
                </PDFDownloadLink>
                <Button variant="outline" size="sm" onClick={() => setPreviewGroupId(null)}>
                  Cerrar
                </Button>
              </div>
            </div>
            <div className="pdf-modal-body">
              <PDFViewer style={{ width: "100%", height: "100%" }}>
                <ReportDocument group={previewGroup} formData={form.getValues()} logoPreview={logoPreview} />
              </PDFViewer>
            </div>
          </div>
        </div>
      )}
      <main className="p-4 md:p-8 max-w-6xl mx-auto font-sans bg-[var(--bg-main)] text-[var(--text-primary)] transition-colors duration-300">
        <div className="mb-6 p-3 rounded-lg flex items-center justify-between bg-[var(--bg-card)] border border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-[var(--text-secondary)]" />
            <span className="text-sm font-medium text-[var(--text-secondary)]">Tema</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={theme === "theme-default" ? "default" : "ghost"}
              onClick={() => setTheme("theme-default")}
              className={cn(theme !== "theme-default" && "text-[var(--text-secondary)]")}
            >
              Predeterminado
            </Button>
            <Button
              size="sm"
              variant={theme === "theme-ocaso" ? "default" : "ghost"}
              onClick={() => setTheme("theme-ocaso")}
              className={cn(theme !== "theme-ocaso" && "text-[var(--text-secondary)]")}
            >
              Ocaso
            </Button>
            <Button
              size="sm"
              variant={theme === "theme-corporativo" ? "default" : "ghost"}
              onClick={() => setTheme("theme-corporativo")}
              className={cn(theme !== "theme-corporativo" && "text-[var(--text-secondary)]")}
            >
              Corporativo
            </Button>
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex overflow-x-auto bg-[var(--bg-muted)] py-2 gap-2 scrollbar-hide">
            <TabsTrigger value="inicio" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <Home className="mr-2 h-4 w-4 inline" />
              Inicio
            </TabsTrigger>
            {/* ✅ CONSOLIDACIÓN DE PESTAÑAS: Unificamos Evaluador Escolar y Superior en una sola */}
            <TabsTrigger value="evaluator" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <Sparkles className="mr-2 h-4 w-4 inline" />
              Evaluador
            </TabsTrigger>
            <TabsTrigger value="dashboard" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <ClipboardList className="mr-2 h-4 w-4 inline" />
              Resumen
            </TabsTrigger>
            {enablePedagogy && (
              <TabsTrigger value="pedagogy-dashboard" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
                <ClipboardList className="mr-2 h-4 w-4 inline" />
                Dashboard
              </TabsTrigger>
            )}
            <TabsTrigger value="presentacion" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <Eye className="mr-2 h-4 w-4 inline" />
              Presentación
            </TabsTrigger>
            <TabsTrigger value="historial" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <History className="mr-2 h-4 w-4 inline" />
              Historial
            </TabsTrigger>
            <TabsTrigger value="evaluaciones" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <FileText className="mr-2 h-4 w-4 inline" />
              Evaluaciones
            </TabsTrigger>
            <TabsTrigger value="cursos" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <FolderOpen className="mr-2 h-4 w-4 inline" />
              Cursos
            </TabsTrigger>
            <TabsTrigger value="estudiantes" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <Users className="mr-2 h-4 w-4 inline" />
              Estudiantes
            </TabsTrigger>
            <TabsTrigger value="mis-archivos" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <Archive className="mr-2 h-4 w-4 inline" />
              Mis archivos
            </TabsTrigger>
            <TabsTrigger value="pruebas-base" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <BookOpen className="mr-2 h-4 w-4 inline" />
              Pruebas base
            </TabsTrigger>
            {canSeePanelColegio && (
              <a
                href="/dashboard/institucion"
                className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm inline-flex items-center rounded-md border border-[var(--border-color)] bg-white hover:bg-[var(--bg-muted-subtle)]"
              >
                <Sparkles className="mr-2 h-4 w-4 inline" />
                Panel Colegio
              </a>
            )}
          </TabsList>
          <TabsContent value="evaluator" className="space-y-8 mt-4">
            <div className="flex items-center gap-3">
              <img
                src={LIBELIA_LOGO_PNG_BASE64 || "/placeholder.svg"}
                alt="Logo Libel-IA"
                className="h-8
w-8"
              />
              <span className={`font-semibold text-xl ${wordmarkClass} font-logo`}>Evaluador</span>
            </div>
            <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
              <CardHeader>
                <CardTitle className="text-[var(--text-accent)]">Paso 1: Configuración de la Evaluación</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (batchProgress.isActive || isLoading) return
                      void onEvaluateAll()
                    }}
                    className="space-y-8"
                  >
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4 border rounded-lg border-[var(--border-color)]">
                      <div className="flex items-center space-x-3">
                        <Label htmlFor="class-size" className="text-base font-bold text-[var(--text-accent)]">
                          Nº de Estudiantes:
                        </Label>

                        <Input
                          id="class-size"
                          type="number"
                          value={classSize}
                          onChange={(e) => setClassSize(Number(e.target.value) || 1)}
                          className="w-24 text-base"
                          min={1}
                        />
                      </div>
                      <div className="flex items-center space-x-3">
                        <FormField
                          control={form.control}
                          name="curso"
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-3">
                              <FormLabel className="text-base font-bold mt-2 text-[var(--text-accent)]">
                                {cursoLabel}:
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder={isSuperior ? "Ej: 1° Semestre" : "Ej: 8° Básico"}
                                  {...field}
                                  className="w-40 text-base"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <GuidedSessionEvaluatorContextBanner
                      onApplyGuided={applyGuidedWizardConfiguration}
                      wizardFilledFieldKeys={wizardGuidedFilledFields}
                      onUndoWizardApply={undoWizardGuidedApply}
                      evaluatorSourceExamListLoaded={evaluatorSourceExamListHydrated}
                      evaluatorSourceExamListLoading={evaluatorSourceExamListLoading}
                      rememberedSourceExamMissingFromList={rememberedWizardSourceExamMissingFromList}
                      onUseRememberedSourceExam={handleUseRememberedWizardSourceExam}
                      evaluatorSelectedSourceExamId={selectedEvaluatorSourceExamId}
                    />

                    <FormField
                      control={form.control}
                      name="areaConocimiento"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-bold text-[var(--text-accent)]">Área de Conocimiento</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecciona la materia..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="general">General / Interdisciplinario</SelectItem>

                              <SelectItem value="lenguaje">Lenguaje e Historia</SelectItem>
                              <SelectItem value="humanidades">Filosofía y Humanidades</SelectItem>
                              <SelectItem value="matematicas">Matemáticas</SelectItem>
                              <SelectItem value="ciencias">Ciencias</SelectItem>

                              <SelectItem value="ingles">Inglés</SelectItem>
                              <SelectItem value="artes">Artes</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="nivelEducativo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-bold text-[var(--text-accent)]">Nivel Educativo</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecciona el nivel de la evaluación" />
                              </SelectTrigger>
                            </FormControl>

                            <SelectContent>
                              <SelectItem value="Educación Básica">Educación Básica (1° a 8°)</SelectItem>
                              <SelectItem value="Educación Media">Educación Media (1° a 4°)</SelectItem>
                              {/* ✅ AJUSTE PARA NIVELES SUPERIORES CONSOLIDADOS */}
                              <SelectItem value="Técnico Superior">Técnico Superior</SelectItem>
                              <SelectItem value="Universitario">Universitario</SelectItem>
                              <SelectItem value="Postgrado">Postgrado</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>Esto ajusta el rigor y la terminología de la IA.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="flexibilidad"
                      render={({ field }) => (
                        <FormItem className="compact-field space-y-1">
                          <FormLabel className="text-[var(--text-accent)]">
                            Nivel de Flexibilidad (Generosidad en Desarrollo)
                          </FormLabel>
                          <FormControl>
                            <Slider
                              min={1}
                              max={5}
                              step={1}
                              defaultValue={field.value}
                              onValueChange={field.onChange}
                            />
                          </FormControl>
                          <div className="flex justify-between text-[10px] text-[var(--text-secondary)] range-hints">
                            <span>Estricto (Conceptos)</span>
                            <span>Flexible (Redacción)</span>
                          </div>
                        </FormItem>
                      )}
                    />
                    <div className="p-4 border rounded-lg border-dashed border-[var(--border-color)] bg-[var(--bg-card)] space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <BookOpen className="h-5 w-5 text-[var(--text-accent)] shrink-0" />
                        <h3 className="text-base font-semibold text-[var(--text-accent)]">
                          Prueba base (opcional) — FASE 3 / FREEZE_EVALUATION_BASE_CERRADAS
                        </h3>
                      </div>
                      <p className="text-sm text-[var(--text-secondary)]">
                        El evaluador funciona igual en modo <span className="font-medium">solo formulario manual</span>.
                        Si ya tienes una prueba base en el banco, el selector de abajo la enlaza a <span className="font-medium">esta</span>{" "}
                        configuración (pauta estructurada, alternativas, tipo sugerido) sin sustituir el formulario.
                      </p>
                      <ul className="text-xs text-[var(--text-secondary)] space-y-1 list-disc pl-5">
                        <li>
                          <span className="font-medium text-[var(--text-primary)]">Crear, listar o importar PDF/Word</span>{" "}
                          está en la pestaña superior <span className="font-medium">Pruebas base</span>.
                        </li>
                        <li>
                          <span className="font-medium text-[var(--text-primary)]">Reutilizar aquí</span>: elige una prueba en el
                          desplegable; se cargan sus ítems en memoria para los botones de abajo.
                        </li>
                      </ul>
                      <p className="text-[11px] text-[var(--text-secondary)] m-0">
                        Tras crear o importar en «Pruebas base», la lista se actualiza al volver a esta pestaña. Si no ves la nueva
                        prueba, pulsa <span className="font-medium text-[var(--text-primary)]">Actualizar lista</span>.
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto py-1 px-2 text-xs text-[var(--text-accent)] underline-offset-2 hover:underline"
                        onClick={() => setActiveTab("pruebas-base")}
                      >
                        Ir al banco «Pruebas base» (subir archivos / ver listado)
                      </Button>
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center flex-wrap">
                        <Select
                          value={selectedEvaluatorSourceExamId || "__none__"}
                          onValueChange={handleEvaluatorSourceExamSelect}
                          disabled={evaluatorSourceExamListLoading}
                        >
                          <SelectTrigger className="w-full sm:max-w-md">
                            <SelectValue
                              placeholder={
                                evaluatorSourceExamListLoading ? "Cargando pruebas base…" : "Sin prueba base seleccionada"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Solo formulario manual</SelectItem>
                            {evaluatorSourceExamOptions.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.title?.trim() || o.id.slice(0, 8)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          title="Volver a cargar pruebas base desde el servidor"
                          onClick={loadEvaluatorSourceExamOptions}
                          disabled={evaluatorSourceExamListLoading}
                        >
                          <RefreshCw className={cn("h-4 w-4", evaluatorSourceExamListLoading && "animate-spin")} />
                          <span className="ml-2">Actualizar lista</span>
                        </Button>
                        {evaluatorSourceExamItemsLoading ? (
                          <span className="text-sm text-[var(--text-secondary)] inline-flex items-center gap-1">
                            <Loader2 className="h-4 w-4 animate-spin" /> Cargando ítems…
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs font-mono rounded-md px-2 py-1.5 bg-[var(--bg-muted)] border border-[var(--border-color)]">
                        Fuente instrumento:{" "}
                        <span className="font-semibold">
                          {evaluatorInstrumentSource === "manual"
                            ? "solo formulario manual"
                            : evaluatorInstrumentSource === "source_exam"
                              ? "prueba base cargada (EvaluationBase en memoria)"
                              : "formulario + datos aplicados desde prueba base"}
                        </span>
                      </div>
                      {evaluatorEvaluationBaseSnapshot ? (
                        <p className="text-sm text-[var(--text-primary)]">
                          Resumen estructural: {evaluatorEvaluationBaseSnapshot.totalItems} ítems totales;{" "}
                          {evaluatorEvaluationBaseSnapshot.closedItems} cerrados; {evaluatorEvaluationBaseSnapshot.developmentItems}{" "}
                          desarrollo. Origen: {evaluatorEvaluationBaseSnapshot.source}.
                        </p>
                      ) : null}
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!evaluatorLastSourceExamPayload}
                            onClick={applyEvaluatorSourceExamHintsToEmptyFields}
                          >
                            Rellenar solo campos vacíos desde prueba base
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!evaluatorLastSourceExamPayload}
                            onClick={applySuggestedTipoPruebaFromSourceExam}
                          >
                            Aplicar tipo de prueba sugerido
                          </Button>
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-snug">
                          <span className="font-medium text-[var(--text-primary)]">Rellenar vacíos:</span> copia a los campos del
                          formulario solo si están vacíos (pauta estructurada, alternativas correctas, rúbrica, nombre de
                          prueba). No borra lo que ya escribiste.
                          <span className="mx-1 text-[var(--border-color)]">·</span>
                          <span className="font-medium text-[var(--text-primary)]">Tipo sugerido:</span> ajusta únicamente el
                          selector «Tipo de prueba» (mixta / solo alternativas / solo desarrollo) según los ítems de la prueba
                          base; no modifica textos de pauta ni respuestas.
                        </p>
                      </div>
                    </div>
                    <div className="p-4 border rounded-lg border-[var(--border-color)] bg-[var(--bg-muted)]">
                      <h3 className="text-lg font-semibold mb-4 text-[var(--text-accent)]">
                        Configuración Avanzada (Nota y Puntajes)
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                          control={form.control}
                          name="puntajeTotal"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="font-bold text-[var(--text-accent)]">
                                Puntaje Total Máximo
                              </FormLabel>

                              <FormControl>
                                <Input placeholder="Ej: 60" type="number" {...field} />
                              </FormControl>

                              <FormDescription>Máximo que se puede obtener.</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="porcentajeExigencia"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="font-bold text-[var(--text-accent)]">
                                Exigencia (Nota 4.0)
                              </FormLabel>

                              <FormControl>
                                <Input placeholder="Ej: 55" type="number" {...field} />
                              </FormControl>

                              <FormDescription>
                                Porcentaje de puntaje necesario para Nota 4.0 (por defecto 55). Si la nota resulta muy severa, baje este valor (ej: 50).
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="pautaEstructurada"
                          render={({ field }) => (
                            <FormItem className="col-span-full">
                              <FormLabel className="font-bold text-[var(--text-accent)]">
                                Pauta Estructurada de Puntajes por Ítem
                              </FormLabel>

                              <FormControl>
                                <Textarea
                                  placeholder="Ejemplo: SM1:1; SM2:1; VF1:2; PDesarrollo1:5; PDesarrollo2:5"
                                  className="min-h-[100px]"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription
                                className="text-red-600
font-semibold"
                              >
                                **OBLIGATORIO para la corrección rigurosa.** (CRÍTICO para resolver el fallo de
                                puntuación $0/52$). Usa `ID_PREGUNTA:PUNTAJE_MAXIMO`. Separa con `;`.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="tipoPrueba"
                          render={({ field }) => (
                            <FormItem className="col-span-full">
                              <FormLabel className="font-bold text-[var(--text-accent)]">
                                Tipo de prueba
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecciona el tipo de prueba" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="mixta">Mixta (alternativas + desarrollo)</SelectItem>
                                  <SelectItem value="solo_alternativas">Solo alternativas (SM, V/F, términos pareados)</SelectItem>
                                  <SelectItem value="solo_desarrollo">Solo desarrollo (preguntas abiertas)</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                Elige según lo que quieras que la IA revise. No rompe evaluaciones existentes.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {watchedTipoPrueba !== "solo_alternativas" && (
                      <FormField
                        control={form.control}
                        name="rubrica"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-bold text-[var(--text-accent)]">
                              Rúbrica (Criterios de Evaluación)
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Ej: Claridad (0-10), Estructura (0-10), Ortografía (0-10).
La IA usará una escala 0-10 por criterio de desarrollo."
                                className="min-h-[100px]"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>Describe los criterios de evaluación de desarrollo.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
{/* 🔥 CAMPO MANTENIDO: La clave de alternativas es vital para la corrección objetiva. */}
                    <FormField
                      control={form.control}
                      name="pautaCorrectaAlternativas"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-bold text-[var(--text-accent)]">
                            Pauta Oficial de Alternativas (Clave)
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Ejemplo: SM1:A; SM2:C; VF1:V (Usado por la IA para corregir Selección Múltiple)"
                              className="min-h-[100px]"
                              {...field}
                              value={answerKey ? answerKeyToPauta(answerKey) : field.value}
                              onChange={(e) => {
                                // Si hay plantilla cargada, limpiarla al editar manualmente
                                if (answerKey) {
                                  clearAnswerKey()
                                }
                                field.onChange(e)
                              }}
                            />
                          </FormControl>
                          <FormDescription className="text-blue-600 font-semibold">
                            **OBLIGATORIO si la prueba tiene alternativas.** Usa `ID_PREGUNTA:RESPUESTA_CORRECTA`.
                            Separa con `;`.
                          </FormDescription>
                          
                          {/* NUEVO: Boton para subir plantilla fotografiada del profesor */}
                          <div className="mt-3 p-3 border rounded-lg border-dashed border-green-400 bg-green-50/50">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-green-700">
                                  Subir Plantilla de Respuestas (Foto)
                                </p>
                                <p className="text-xs text-green-600 mt-1">
                                  Sube una foto de tu plantilla con las respuestas correctas marcadas. 
                                  El sistema extraera automaticamente las alternativas con 100% de precision.
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                className="border-green-500 text-green-700 hover:bg-green-100 shrink-0"
                                onClick={() => setIsAnswerKeyModalOpen(true)}
                              >
                                <ImageUp className="mr-2 h-4 w-4" />
                                {answerKey ? "Cambiar Plantilla" : "Subir Plantilla"}
                              </Button>
                            </div>
                            
                            {/* Indicador de plantilla cargada */}
                            {answerKey && (
                              <div className="mt-3 p-2 bg-green-100 rounded-md flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  <span className="text-sm font-medium text-green-700">
                                    Plantilla memorizada: {answerKey.totalPreguntas} preguntas
                                  </span>
                                  {answerKey.preguntasDudosas?.length > 0 && (
                                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded">
                                      {answerKey.preguntasDudosas.length} revisadas manualmente
                                    </span>
                                  )}
                                  <span className="text-xs text-green-600">
                                    — Las alternativas se corrigen con 100% de certeza según esta plantilla.
                                  </span>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => {
                                    clearAnswerKey()
                                    field.onChange("")
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                          
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* 🔥 CAMPO MANTENIDO: La pauta de desarrollo es para contexto de la IA. */}
                    <FormField
                      control={form.control}
                      name="pauta"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-bold text-[var(--text-accent)]">
                            Pauta (Respuestas de Desarrollo)
                          </FormLabel>

                          <FormControl>
                            <Textarea
                              placeholder="Opcional. Pega aquí las respuestas correctas de Desarrollo/Abiertas."
                              className="min-h-[100px]"
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
              </CardContent>
            </Card>
            <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
              <CardHeader>
                <CardTitle className="text-[var(--text-accent)]">Paso 1.1: Personalización del Informe</CardTitle>
              </CardHeader>

              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="nombreProfesor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[var(--text-accent)]">Nombre del Profesor</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej: Juan Pérez" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="departamento"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[var(--text-accent)]">{departamentoLabel}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={isSuperior ? "Ej: Escuela de Ingeniería" : "Ej: Departamento de Lenguaje"}
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="asignatura"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[var(--text-accent)]">Asignatura</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej: Lenguaje y Comunicación" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="nombrePrueba"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[var(--text-accent)]">Nombre de la Evaluación/Certamen</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej: Certamen N°2" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fechaEvaluacion"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className="text-[var(--text-accent)]">Fecha</FormLabel>

                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant={"outline"}
                                className={cn(
                                  "pl-3 text-left font-normal",
                                  !field.value && "text-[var(--text-secondary)]",
                                )}
                              >
                                {field.value ? format(field.value, "PPP") : <span>Elige una fecha</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                          </PopoverContent>
                        </Popover>
                      </FormItem>
                    )}
                  />
                  <div className="space-y-2 col-span-full">
                    <Label className="text-[var(--text-accent)]">Logo del Colegio (Opcional)</Label>
                    <div className="flex items-center gap-4">
                      <Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>
                        <ImageUp className="mr-2 h-4 w-4" />
                        Subir Logo
                      </Button>
                      <input
                        type="file"
                        accept="image/*"
                        ref={logoInputRef}
                        onChange={handleLogoChange}
                        className="hidden"
                      />
                      {logoPreview && (
                        <img
                          src={logoPreview || "/placeholder.svg"}
                          alt="Vista previa del logo"
                          className="h-12 w-auto object-contain border p-1 rounded-md"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          {activeTab === "evaluator" && (
            <div className="flex gap-4">
              {studentGroups.length > 0 && (
                <aside className="sticky top-4 self-start w-52 shrink-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 shadow-sm">
                  <h4 className="font-semibold text-sm text-[var(--text-accent)] mb-2 flex items-center gap-2">
                    <Users className="h-4 w-4" /> Estudiantes / Grupos
                  </h4>
                  <nav className="flex flex-col gap-1 max-h-[70vh] overflow-y-auto">
                    {studentGroups.map((group) => {
                      const isInResults = group.isEvaluated || group.isEvaluating || !!group.error
                      const targetId = isInResults ? `group-paso3-${group.id}` : `group-paso2-${group.id}`
                      const stateIcon = group.error ? (
                        <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                      ) : group.isEvaluating ? (
                        <Loader2 className="h-4 w-4 animate-spin text-amber-500 shrink-0" />
                      ) : group.isEvaluated ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      ) : group.files.length > 0 ? (
                        <FileUp className="h-4 w-4 text-blue-500 shrink-0" />
                      ) : (
                        <FileIcon className="h-4 w-4 text-[var(--text-secondary)] shrink-0" />
                      )
                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() =>
                            document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })
                          }
                          className="flex items-center gap-2 w-full text-left px-2 py-2 rounded-lg hover:bg-[var(--bg-muted)] text-sm truncate border border-transparent hover:border-[var(--border-color)]"
                        >
                          {stateIcon}
                          <span className="truncate">
                            {formatStudentDisplayName(group.studentName) || group.studentName || "Sin nombre"}
                          </span>
                        </button>
                      )
                    })}
                  </nav>
                </aside>
              )}
              <div className="flex-1 min-w-0 space-y-4">
              <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
                <CardHeader>
                  <CardTitle className="text-[var(--text-accent)]">Paso 2: Cargar y Agrupar Trabajos</CardTitle>
                </CardHeader>

                <CardContent className="space-y-6">
                  <div>
                    <h3 className="font-bold text-[var(--text-accent)]">Cargar Archivos</h3>
                    <div className="flex flex-wrap gap-4 mt-2 items-center">
                      <Button
                        type="button"
                        onClick={() => {
                          fileInputRef.current?.click()
                        }}
                      >
                        <FileUp className="mr-2 h-4 w-4" /> Subir Archivos (PDF/DOCX/Imágenes)
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setIsCaptureModeSelectionOpen(true)}
                      >
                        <Camera className="mr-2 h-4 w-4" /> Usar Camara (Captura Guiada)
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                        onClick={() => {
                          // Usar un input file oculto para seleccionar imagen de plantilla OMR
                          const input = document.createElement("input")
                          input.type = "file"
                          input.accept = "image/*"
                          input.onchange = (e: any) => {
                            const file = e.target?.files?.[0]
                            if (!file) return
                            const reader = new FileReader()
                            reader.onload = (ev) => {
                              const dataUrl = ev.target?.result as string
                              if (dataUrl) {
                                // Tambien agregar como archivo al pool
                                const filePreview: FilePreview = {
                                  id: `omr-${Date.now()}`,
                                  file,
                                  previewUrl: URL.createObjectURL(file),
                                  dataUrl,
                                }
                                setUnassignedFiles((prev) => [...prev, filePreview])
                                // Abrir el modal OMR cerradas
                                handleOpenClosedAnswerOMR(dataUrl)
                              }
                            }
                            reader.readAsDataURL(file)
                          }
                          input.click()
                        }}
                      >
                        <ClipboardList className="mr-2 h-4 w-4" /> OMR Respuestas Cerradas
                      </Button>
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        ref={fileInputRef}
                        onChange={handleFilesSelected}
                        className="hidden"
                      />
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleFilesSelected}
                        className="hidden"
                      />{" "}
                      {/* Se mantiene el input por si el modal decide usarlo */}
                      <p className="text-sm text-[var(--text-secondary)]">
                        Consejo: Sube primero la página con el nombre.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/80 dark:bg-slate-900/40 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-[var(--text-secondary)] max-w-[min(100%,42rem)]">
                      <span className="font-semibold text-[var(--text-primary)]">Lote de carga</span>
                      {evaluationBatchIdUi ? (
                        <span className="ml-2 font-mono text-[11px] break-all">{evaluationBatchIdUi}</span>
                      ) : (
                        <span className="ml-2 italic">Se asigna al subir la primera hoja o al iniciar evaluación.</span>
                      )}
                      {evaluationBatchIdUi ? (
                        <span className="block mt-1 text-[11px] text-amber-800 dark:text-amber-200/90">
                          El escáner móvil debe enviar fotos con <strong>exactamente</strong> este{" "}
                          <span className="font-mono">batch_id</span>. Si difiere, no verás las imágenes aquí.
                        </span>
                      ) : null}
                      {evaluationBatchIdUi && batchInstitutionalStatus && (
                        <span className="ml-2 block mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                          Estado institucional:{" "}
                          <strong>
                            {batchInstitutionalStatus === "pending_utp"
                              ? "En revisión UTP"
                              : batchInstitutionalStatus === "validated"
                                ? "Validado UTP (visible Dirección)"
                                : batchInstitutionalStatus === "rejected"
                                  ? "Devuelto por UTP"
                                  : batchInstitutionalStatus}
                          </strong>
                          {batchInstitutionalStatus === "rejected" && batchUtpObservations ? (
                            <span className="block mt-0.5 opacity-90">Obs.: {batchUtpObservations}</span>
                          ) : null}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="text-xs"
                        disabled={
                          !evaluationBatchIdUi ||
                          submitBatchUtpLoading ||
                          batchInstitutionalStatus === "pending_utp" ||
                          batchInstitutionalStatus === "validated"
                        }
                        onClick={async () => {
                          if (!evaluationBatchIdUi) return
                          setSubmitBatchUtpLoading(true)
                          try {
                            const r = await fetch("/api/evaluation-batches/submit-utp-review", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ batch_id: evaluationBatchIdUi }),
                            })
                            const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
                            if (!r.ok) {
                              toast({
                                title: "No se pudo enviar",
                                description: j?.error ?? "Error",
                                variant: "destructive",
                              })
                              return
                            }
                            toast({
                              title: "Enviado a UTP",
                              description: j?.message ?? "El lote quedó en revisión.",
                            })
                            setBatchInstitutionalStatus("pending_utp")
                            setBatchUtpObservations(null)
                          } catch {
                            toast({
                              title: "Error de red",
                              variant: "destructive",
                            })
                          } finally {
                            setSubmitBatchUtpLoading(false)
                          }
                        }}
                      >
                        {submitBatchUtpLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1 inline" aria-hidden />
                        ) : (
                          <Send className="h-3.5 w-3.5 mr-1 inline" aria-hidden />
                        )}
                        Enviar a Revisión UTP
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="text-xs shrink-0"
                        disabled={!!evaluationBatchIdUi}
                        onClick={() => {
                          const fresh = crypto.randomUUID()
                          evaluationBatchIdRef.current = fresh
                          setEvaluationBatchIdUi(fresh)
                          writeDocenteActiveBatchId(fresh)
                          toast({
                            title: "Lote listo para el móvil",
                            description: "Usa este UUID en el escáner. Debe coincidir con el que escanees en QR.",
                          })
                        }}
                      >
                        Fijar UUID para móvil
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs shrink-0"
                        onClick={() => {
                          setStudentGroups((prev) =>
                            prev.map((g) => ({
                              ...g,
                              files: g.files.filter((f) => {
                                if (f.fromMobileBatch) {
                                  try {
                                    URL.revokeObjectURL(f.previewUrl)
                                  } catch {
                                    /* noop */
                                  }
                                  return false
                                }
                                return true
                              }),
                              promotedEvaluationId: null,
                            })),
                          )
                          setUnassignedFiles((prev) =>
                            prev.filter((f) => {
                              if (f.fromMobileBatch) {
                                try {
                                  URL.revokeObjectURL(f.previewUrl)
                                } catch {
                                  /* noop */
                                }
                                return false
                              }
                              return true
                            }),
                          )
                          evaluationBatchIdRef.current = null
                          setEvaluationBatchIdUi(null)
                          writeDocenteActiveBatchId(null)
                          setBatchInstitutionalStatus(null)
                          setBatchUtpObservations(null)
                        }}
                      >
                        Nuevo lote
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="text-xs shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
                        disabled={!evaluationBatchIdUi}
                        title={!evaluationBatchIdUi ? "Activa un lote (sube una hoja o fija UUID) para exportar." : undefined}
                        onClick={() => {
                          if (!evaluationBatchIdUi) return
                          setBatchZipHistoryExamTitle(null)
                          setBatchZipHistoryCourseLabel(null)
                          setBatchZipTargetId(evaluationBatchIdUi)
                          setBatchZipDialogOpen(true)
                        }}
                      >
                        <FileArchive className="h-3.5 w-3.5 mr-1 inline" aria-hidden />
                        Descarga completa (ZIP)
                      </Button>
                    </div>
                  </div>

                  {/* Agrupación automática por reglas (solo UI; no toca evaluación ni contratos). */}
                  {studentGroups.length > 0 ? (
                    <div className="p-4 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 space-y-3">
                      <h3 className="font-bold text-[var(--text-accent)] flex items-center gap-2">
                        <Users className="h-5 w-5 text-indigo-600" />
                        Agrupación automática
                      </h3>
                      <p className="text-sm text-[var(--text-secondary)]">
                        Indica cuántas imágenes corresponden a cada estudiante. Luego usa el botón para distribuir los archivos pendientes en orden. Las fotos del móvil (mismo{" "}
                        <span className="font-mono text-xs">batch_id</span>) se suman al conteo y se ubican por{" "}
                        <span className="font-mono text-xs">student_index</span> del lote.
                      </p>
                      <div className="flex flex-wrap items-end gap-4">
                        <div className="space-y-1">
                          <Label htmlFor="images-per-student" className="text-sm font-medium">
                            Imágenes por estudiante
                          </Label>
                          <Input
                            id="images-per-student"
                            type="number"
                            min={1}
                            max={50}
                            value={imagesPerStudent}
                            onChange={(e) => setImagesPerStudent(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                            className="w-24"
                          />
                        </div>
                        <div className="text-sm text-[var(--text-secondary)]">
                          Estudiantes del curso: <strong className="text-[var(--text-primary)]">{studentGroups.length}</strong>
                          {" · "}
                          Esperadas en total: <strong className="text-[var(--text-primary)]">{studentGroups.length * Math.max(1, imagesPerStudent)}</strong>
                        </div>
                        <Button
                          type="button"
                          variant="default"
                          onClick={applyAutoGroup}
                          disabled={unassignedFiles.length === 0}
                        >
                          Agrupar automáticamente
                        </Button>
                      </div>
                      {(() => {
                        const mobileCount =
                          studentGroups.reduce((acc, g) => acc + g.files.filter((f) => f.fromMobileBatch).length, 0) +
                          unassignedFiles.filter((f) => f.fromMobileBatch).length
                        const totalLoaded = unassignedFiles.length + studentGroups.reduce((acc, g) => acc + g.files.length, 0)
                        const expected = studentGroups.length * Math.max(1, imagesPerStudent)
                        const missing = Math.max(0, expected - totalLoaded)
                        const surplus = Math.max(0, totalLoaded - expected)
                        const complete = studentGroups.filter((g) => g.files.length >= Math.max(1, imagesPerStudent)).length
                        const incomplete = studentGroups.filter((g) => g.files.length > 0 && g.files.length < Math.max(1, imagesPerStudent)).length
                        return (
                          <div className="text-sm space-y-1 pt-2 border-t border-indigo-200 dark:border-indigo-800">
                            <p className="font-medium text-[var(--text-primary)]">
                              Se detectaron {totalLoaded} imagen{totalLoaded !== 1 ? "es" : ""} en total
                              {mobileCount > 0 ? (
                                <span className="text-[var(--text-secondary)] font-normal">
                                  {" "}
                                  ({mobileCount} desde móvil)
                                </span>
                              ) : null}
                              .
                            </p>
                            <p className="text-[var(--text-secondary)]">
                              Configuración actual: {studentGroups.length} estudiantes × {Math.max(1, imagesPerStudent)} imágenes = {expected} esperadas.
                            </p>
                            {missing > 0 && (
                              <p className="text-amber-700 dark:text-amber-400 font-medium">
                                Faltan {missing} imagen{missing !== 1 ? "es" : ""} para completar la configuración.
                              </p>
                            )}
                            {surplus > 0 && (
                              <p className="text-amber-700 dark:text-amber-400 font-medium">
                                Sobran {surplus} imagen{surplus !== 1 ? "es" : ""} no agrupadas.
                              </p>
                            )}
                            {missing === 0 && surplus === 0 && totalLoaded > 0 && (
                              <p className="text-green-700 dark:text-green-400 font-medium">
                                La configuración coincide con el total de archivos.
                              </p>
                            )}
                            <div className="flex flex-wrap gap-3 pt-1">
                              <span className="text-[var(--text-secondary)]">
                                Grupos completos: <strong className="text-[var(--text-primary)]">{complete}</strong>
                              </span>
                              {incomplete > 0 && (
                                <span className="text-amber-600">
                                  Grupos incompletos: <strong>{incomplete}</strong>
                                </span>
                              )}
                              <span className="text-[var(--text-secondary)]">
                                Sin asignar: <strong className="text-[var(--text-primary)]">{unassignedFiles.length}</strong>
                              </span>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--text-secondary)]">
                      Indica el <strong>Nº de estudiantes</strong> en la pestaña de configuración para crear los grupos y usar la agrupación automática.
                    </p>
                  )}

                  {unassignedFiles.length > 0 && (
                    <div className="p-4 border-2 rounded-xl bg-[var(--bg-muted-subtle)] border-amber-200 dark:border-amber-800">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                        <h3 className="font-bold text-[var(--text-accent)] flex items-center gap-2">
                          <ClipboardList className="h-5 w-5 text-amber-600" />
                          Archivos pendientes de asignar
                          <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-200 text-sm font-bold">
                            {unassignedFiles.length}
                          </span>
                        </h3>
                        <p className="text-sm text-[var(--text-secondary)]">
                          Asigna cada archivo a un estudiante usando el selector &quot;Asignar&quot; en cada grupo.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3 items-center">
                        {unassignedFiles.map((file) => (
                          <div
                            key={file.id}
                            className="relative w-24 h-24 rounded-lg overflow-hidden border-2 border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-800 shadow-sm"
                          >
                            {renderFilePreview(file)}
                            <button
                              onClick={() => removeUnassignedFile(file.id)}
                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors"
                              aria-label="Eliminar archivo"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              {studentGroups.length > 0 && (
                <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-[var(--text-accent)]">
                        <Users className="text-green-500" />
                        Grupos de Estudiantes
                        <span className="text-sm font-normal text-[var(--text-secondary)]">
                          ({studentGroups.filter((g) => g.files.length > 0).length} con archivos · {studentGroups.filter((g) => g.files.length > 0 && !g.isEvaluated && !g.isEvaluating).length} listos para evaluar)
                        </span>
                      </CardTitle>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          isExtractingNames ||
                          batchProgress.isActive ||
                          isLoading ||
                          studentGroups.filter((g) => g.files.length > 0 && isGenericGroupName(g.studentName)).length === 0
                        }
                        onClick={handleBulkNameExtraction}
                        title="Extrae el nombre del estudiante para cada grupo que aún tenga nombre genérico (Alumno 1, Alumno 2…). No sobrescribe nombres ya asignados."
                      >
                        {isExtractingNames ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Extrayendo…
                          </>
                        ) : (
                          "Extraer nombres de todos los grupos"
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {studentGroups.map((group) => {
                      const stateLabel =
                        group.error
                          ? "Con error"
                          : group.isEvaluating
                            ? "Evaluando"
                            : group.isEvaluated
                              ? "Evaluado"
                              : group.files.length > 0
                                ? "Listo para evaluar"
                                : "Sin archivos"
                      const stateColor =
                        group.error
                          ? "border-red-300 bg-red-50/50 dark:bg-red-950/20"
                          : group.isEvaluating
                            ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20"
                            : group.isEvaluated
                              ? "border-green-300 bg-green-50/50 dark:bg-green-950/20"
                              : group.files.length > 0
                                ? "border-blue-300 bg-blue-50/50 dark:bg-blue-950/20"
                                : "border-[var(--border-color)] bg-[var(--bg-muted-subtle)]"
                      return (
                        <div
                          key={group.id}
                          id={`group-paso2-${group.id}`}
                          className={`border-2 p-4 rounded-xl ${stateColor}`}
                        >
                          <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <Label className="text-xs text-[var(--text-muted)]">Nombre del estudiante</Label>
                              <Input
                                className="text-lg font-bold border border-transparent hover:border-[var(--border-color)] focus-visible:ring-1 p-1 bg-transparent w-full"
                                placeholder="Escribe nombre y apellido si no se detectó solo"
                                value={group.studentName}
                                onChange={(e) => updateStudentName(group.id, e.target.value)}
                                aria-label="Nombre del estudiante"
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0 pt-5">
                              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-[var(--bg-muted)] text-[var(--text-secondary)]">
                                {group.files.length} archivo{group.files.length !== 1 ? "s" : ""}
                              </span>
                              <span className="text-xs font-medium px-2 py-1 rounded-full border bg-white/80 dark:bg-gray-900/80">
                                {stateLabel}
                              </span>
                            </div>
                          </div>
                          <div className="mb-3">
                            <Label className="text-xs text-[var(--text-muted)]">RUT (secundario, ancla técnica)</Label>
                            <Input
                              className="mt-1 max-w-xs"
                              placeholder="12.345.678-9"
                              value={group.studentRut ?? ""}
                              onChange={(e) => updateStudentRut(group.id, e.target.value)}
                            />
                          </div>
                          {group.promotedEvaluationId ? (
                            <p className="text-[11px] text-emerald-800 dark:text-emerald-200/90 mb-2">
                              Este índice tiene evaluación vinculada al lote móvil. Puedes usar{" "}
                              <strong>Evaluar este estudiante</strong> para ir a corrección con la foto.
                            </p>
                          ) : null}

                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleNameExtraction(group.id)}
                            disabled={isExtractingNames || batchProgress.isActive || isLoading}
                            className="mb-3 bg-transparent"
                          >
                            {isExtractingNames ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="mr-2 h-4 w-4 text-purple-500" />
                            )}{" "}
                            Detectar Nombre
                          </Button>

                          <div className="flex flex-wrap gap-2 min-h-[50px] bg-[var(--bg-muted-subtle)] p-3 rounded-lg border border-[var(--border-color)]">
                            {group.files.map((file) => (
                              <div key={file.id} className="relative w-20 h-20 rounded-md overflow-hidden border border-[var(--border-color)]">
                                {renderFilePreview(file)}
                                <button
                                  type="button"
                                  onClick={() => removeFileFromGroup(file.id, group.id)}
                                  disabled={batchProgress.isActive || isLoading}
                                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 disabled:opacity-40 disabled:pointer-events-none"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}

                            {unassignedFiles.length > 0 && (
                              <div className="flex items-center justify-center w-20 h-20 border-2 border-dashed rounded-lg border-[var(--border-color)]">
                                <select
                                  disabled={batchProgress.isActive || isLoading}
                                  onChange={(e) => {
                                    if (e.target.value) assignFileToGroup(e.target.value, group.id)
                                    e.target.value = ""
                                  }}
                                  className="text-sm bg-transparent"
                                >
                                  <option value="">Asignar</option>
                                  {unassignedFiles.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.file.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={
                                group.files.length === 0 ||
                                group.isEvaluating ||
                                isLoading ||
                                batchProgress.isActive ||
                                (isCurrentlyEvaluatingAny && !group.isEvaluating) ||
                                isCurrentlyValidatingAny
                              }
                              onClick={() => void handleEvaluateSingleGroup(group.id)}
                            >
                              {group.isEvaluating ? (
                                <>
                                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                                  Evaluando…
                                </>
                              ) : (
                                <>
                                  <Sparkles className="mr-2 h-3.5 w-3.5" aria-hidden />
                                  Evaluar este estudiante
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                  <CardFooter className="flex flex-col items-stretch gap-4">
                    <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-muted-subtle)] p-3 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="omr-template-variant" className="text-[var(--text-accent)]">
                          Variante de plantilla OMR
                        </Label>
                        <Select
                          value={selectedOmrTemplateVariant}
                          disabled={batchProgress.isActive || isLoading}
                          onValueChange={(v) =>
                            setSelectedOmrTemplateVariant(v as "odd_even_dual_column" | "sequential_dual_column")
                          }
                        >
                          <SelectTrigger id="omr-template-variant" className="w-full max-w-md bg-[var(--bg-card)]">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="odd_even_dual_column">Pares e impares</SelectItem>
                            <SelectItem value="sequential_dual_column">Continua / secuencial</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-[var(--text-secondary)]">
                          Se envía como <span className="font-mono">omrTemplateVariant</span>. En debug:{" "}
                          <span className="font-mono">omrTemplateVariantUsed</span>.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="omr-closed-layout-mode">Motor OMR para preguntas cerradas</Label>
                        <Select
                          value={omrClosedLayoutMode}
                          disabled={batchProgress.isActive || isLoading}
                          onValueChange={(value) =>
                            setOmrClosedLayoutMode(
                              value as "auto" | "standard" | "interleaved_development",
                            )
                          }
                        >
                          <SelectTrigger id="omr-closed-layout-mode" className="w-full max-w-md bg-[var(--bg-card)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Automático</SelectItem>
                            <SelectItem value="standard">OMR clásico</SelectItem>
                            <SelectItem value="interleaved_development">
                              OMR intercalado (cerradas + desarrollo)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-[var(--text-secondary)]">
                          <span className="font-mono">Automático</span> no envía{" "}
                          <span className="font-mono">omrClosedLayoutMode</span>.{" "}
                          <span className="font-mono">interleaved_development</span> fuerza el pipeline intercalado; si
                          falla, no hay fallback silencioso a legacy (error visible y{" "}
                          <span className="font-mono">/api/evaluate</span>). Desactivar todo el feature:{" "}
                          <span className="font-mono">EVALUATE_INTERLEAVED_OMR=false</span>.
                        </p>
                      </div>
                    </div>
                    {/* Botón de Evaluación */}
                    <Button
                      size="lg"
                      type="button"
                      onClick={() => void onEvaluateAll()}
                      className="w-full"
                      disabled={
                        isLoading ||
                        isCurrentlyEvaluatingAny ||
                        batchProgress.isActive ||
                        studentGroups.every((g) => g.files.length === 0) ||
                        isCurrentlyValidatingAny
                      }
                    >
                      {isCurrentlyValidatingAny ? (
                        <>
                          <CheckCircle2 className="mr-2 h-4 w-4 text-white" /> {"Confirmar Correcciones OMR"}
                        </>
                      ) : isLoading || isCurrentlyEvaluatingAny || batchProgress.isActive ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {"Evaluando"}{batchProgress.isActive ? (" (" + batchProgress.completedItems + "/" + batchProgress.totalItems + ")") : "..."}
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" /> {"Evaluar Todo (" + studentGroups.filter((g) => g.files.length > 0 && !g.isEvaluated).length + " pendientes)"}
                        </>
                      )}
                    </Button>

                    {/* Panel de progreso del batch */}
                    {batchProgress.isActive && (
                      <div className="p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] space-y-3">
                        <div className="flex items-center justify-between text-sm font-semibold text-[var(--text-primary)]">
                          <span>Procesamiento por lotes</span>
                          <span className="text-[var(--text-accent)]">
                            Lote {batchProgress.currentBatch}/{batchProgress.totalBatches}
                          </span>
                        </div>

                        {/* Barra de progreso general */}
                        <div className="space-y-1">
                          <div className="relative h-3 w-full bg-gray-200 rounded-full overflow-hidden">
                            <div
                              style={{
                                width: (batchProgress.totalItems > 0
                                  ? Math.round((batchProgress.completedItems / batchProgress.totalItems) * 100)
                                  : 0) + "%",
                              }}
                              className="h-full bg-[var(--bg-primary)] transition-all duration-500 rounded-full"
                            />
                          </div>
                          <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                            <span>{batchProgress.completedItems} de {batchProgress.totalItems} evaluaciones</span>
                            <span>
                              {batchProgress.totalItems > 0
                                ? Math.round((batchProgress.completedItems / batchProgress.totalItems) * 100)
                                : 0}%
                            </span>
                          </div>
                        </div>

                        {/* Contadores de estado */}
                        <div className="flex gap-4 text-xs">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="text-[var(--text-secondary)]">Completadas: <b className="text-[var(--text-primary)]">{batchProgress.successCount}</b></span>
                          </div>
                          {batchProgress.errorCount > 0 && (
                            <div className="flex items-center gap-1.5">
                              <div className="h-2 w-2 rounded-full bg-red-500" />
                              <span className="text-[var(--text-secondary)]">Errores: <b className="text-[var(--text-primary)]">{batchProgress.errorCount}</b></span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <Loader2 className="h-2.5 w-2.5 animate-spin text-[var(--text-accent)]" />
                            <span className="text-[var(--text-secondary)]">En proceso: <b className="text-[var(--text-primary)]">{batchProgress.totalItems - batchProgress.completedItems}</b></span>
                          </div>
                        </div>

                        {/* Info de lotes */}
                        <p className="text-[10px] text-[var(--text-secondary)]">
                          Sistema de evaluacion masiva: hasta 3 lotes de 45 evaluaciones procesandose simultaneamente.
                        </p>
                      </div>
                    )}
                  </CardFooter>
                </Card>
              )}
              {(studentGroups.some((g) => g.isEvaluated || g.isEvaluating || g.isValidationStep || !!g.error) || focusedGroupId) && (
                <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-[var(--text-accent)]">Paso 3: Resultados</CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        {studentGroups.some(
                          (g) => g.isEvaluated && !g.error && typeof g.evaluation_id === "string" && g.evaluation_id.trim() !== "",
                        ) && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={correctionReportsZipBusy}
                            title={`Mismo PDF que «Descargar PDF» por estudiante (informe de evaluación pedagógica). No es el ZIP pedagógico técnico de curso/lote. Máx. ${MAX_CORRECTION_REPORTS_ZIP_PHASE1} en fase 1. Sin RUT en el nombre del archivo.`}
                            onClick={() => void handleDownloadCorrectionReportsZip()}
                          >
                            {correctionReportsZipBusy ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Generando ZIP…
                              </>
                            ) : (
                              <>
                                <FileArchive className="mr-2 h-4 w-4" />
                                Descargar informes estudiantes (ZIP)
                              </>
                            )}
                          </Button>
                        )}
                        {focusedGroupId && (
                          <Button type="button" variant="outline" size="sm" onClick={() => setFocusedGroupId(null)}>
                            Ver todos
                          </Button>
                        )}
                      </div>
                    </div>
                    {correctionReportsZipProgress && correctionReportsZipProgress.total > 0 && (
                      <div className="mt-3 w-full max-w-md space-y-1">
                        <Progress
                          value={Math.min(
                            100,
                            Math.round((correctionReportsZipProgress.current / correctionReportsZipProgress.total) * 100),
                          )}
                        />
                        <p className="text-xs text-[var(--text-secondary)]">
                          {correctionReportsZipProgress.label} · {correctionReportsZipProgress.current}/
                          {correctionReportsZipProgress.total}
                        </p>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Panorama resumido por estudiante: tarjetas clicables para enfocar el detalle */}
                    {studentGroups.length > 0 && (
                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted-subtle)] p-3">
                        <h4 className="font-semibold text-sm text-[var(--text-accent)] mb-2">
                          Panorama del curso
                          {form.watch("curso")?.trim() && (
                            <span className="font-normal text-[var(--text-secondary)] ml-1">– {form.watch("curso")?.trim()}</span>
                          )}
                        </h4>
                        <div className="flex gap-2 overflow-x-auto pb-2">
                          {studentGroups.map((group) => {
                            const { incorrect, revisar } = countAlternativasSummary(group.alternativas_corregidas)
                            const isFocused = focusedGroupId === group.id
                            const todoCorrecto =
                              group.isEvaluated && !group.error && incorrect === 0 && revisar === 0
                            const tieneIncorrectas = group.isEvaluated && !group.error && incorrect > 0
                            const tieneRevisar = group.isEvaluated && !group.error && revisar > 0
                            const pendienteEvaluar = !group.isEvaluated || group.isEvaluating
                            const stateLabel = group.error
                              ? "Con error"
                              : group.isEvaluating
                                ? "Evaluando"
                                : group.isEvaluated
                                  ? "Evaluado"
                                  : group.files.length > 0
                                    ? "Listo para evaluar"
                                    : "Sin archivos"
                            return (
                              <button
                                key={group.id}
                                type="button"
                                onClick={() => {
                                  setFocusedGroupId(group.id)
                                  setTimeout(
                                    () => document.getElementById(`group-paso3-${group.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
                                    80,
                                  )
                                }}
                                className={cn(
                                  "shrink-0 w-44 rounded-lg border-2 p-3 text-left transition-colors",
                                  isFocused && "border-[var(--bg-primary)] bg-[var(--bg-primary)]/10 ring-2 ring-[var(--bg-primary)]/30",
                                  !isFocused && group.error && "border-red-300 bg-red-50/50 dark:bg-red-950/20",
                                  !isFocused && group.isEvaluating && "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20",
                                  !isFocused && todoCorrecto && "border-green-400 bg-green-50/50 dark:bg-green-950/20",
                                  !isFocused && tieneIncorrectas && "border-red-400 bg-red-50/50 dark:bg-red-950/20",
                                  !isFocused && tieneRevisar && "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20",
                                  !isFocused && pendienteEvaluar && !group.error && "border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--text-accent)]/50",
                                )}
                              >
                                <p
                                  className="font-semibold text-sm truncate text-[var(--text-primary)]"
                                  title={formatStudentDisplayName(group.studentName) || group.studentName}
                                >
                                  {formatStudentDisplayName(group.studentName) || group.studentName || "Sin nombre"}
                                </p>
                                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                  {group.files.length} archivo{group.files.length !== 1 ? "s" : ""}
                                  {!pendienteEvaluar && stateLabel ? ` · ${stateLabel}` : ""}
                                </p>
                                {todoCorrecto && (
                                  <p className="text-xs mt-1.5 flex items-center gap-1 text-green-700 dark:text-green-400 font-medium">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    Sin correcciones pendientes
                                  </p>
                                )}
                                {tieneIncorrectas && (
                                  <p className="text-xs mt-1.5 font-medium text-red-700 dark:text-red-400">
                                    {incorrect} incorrecta{incorrect !== 1 ? "s" : ""}
                                  </p>
                                )}
                                {tieneRevisar && (
                                  <p className="text-xs mt-1.5 font-medium text-amber-700 dark:text-amber-400">
                                    {revisar} a revisar
                                  </p>
                                )}
                                {pendienteEvaluar && !group.error && (
                                  <p className="text-xs mt-1.5 text-[var(--text-secondary)]">
                                    Pendiente de evaluación
                                  </p>
                                )}
                                {group.error && (
                                  <p className="text-xs mt-1.5 font-medium text-red-600 dark:text-red-400">
                                    Error
                                  </p>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {(() => {
                      const baseGroups = studentGroups.filter(
                        (g) => g.isEvaluated || g.isEvaluating || g.isValidationStep || !!g.error,
                      )
                      const displayGroups = focusedGroupId ? baseGroups.filter((g) => g.id === focusedGroupId) : baseGroups
                      if (focusedGroupId && displayGroups.length === 0) {
                        const focusedGroup = studentGroups.find((g) => g.id === focusedGroupId)
                        return (
                          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4 text-center">
                            <p className="text-[var(--text-primary)] font-medium">
                              {formatStudentDisplayName(focusedGroup?.studentName) ||
                                focusedGroup?.studentName ||
                                "Este estudiante"}{" "}
                              aún no tiene resultados.
                            </p>
                            <p className="text-sm text-[var(--text-secondary)] mt-1">
                              Evalúa para ver su detalle aquí o revisa en el paso 2.
                            </p>
                          </div>
                        )
                      }
                      return displayGroups.map((group) => {
                        const notaNumber = Number(group.nota) || 0
                        const finalNota = notaNumber + (group.decimasAdicionales || 0)
                        const isReadyToValidate = group.isValidationStep && group.alternativas_corregidas?.length
                        const debug = group.omrDebug
                        const currentAlternativas = Array.isArray(group.alternativas_corregidas)
                          ? group.alternativas_corregidas
                          : []
                        const tableAlternativas = currentAlternativas

                        const tracePayload = group.evaluationTrace?.payload ?? null
                        const teacherAnswerKeyLength =
                          debug && typeof debug.teacherAnswerKeyLength === "number" ? debug.teacherAnswerKeyLength : null
                        const expectedQuestionCountUsed =
                          debug && typeof debug.expectedQuestionCountUsed === "number" ? debug.expectedQuestionCountUsed : null
                        const officialOmrQuestionCountFromPipeline =
                          debug && typeof debug.officialOmrQuestionCountFromPipeline === "number"
                            ? debug.officialOmrQuestionCountFromPipeline
                            : null

                        const traceAlerts: string[] = []
                        if (teacherAnswerKeyLength === 0) {
                          traceAlerts.push("teacherAnswerKeyLength = 0 (clave docente usada por OMR vacía)")
                        }
                        if (
                          expectedQuestionCountUsed != null &&
                          officialOmrQuestionCountFromPipeline != null &&
                          expectedQuestionCountUsed !== officialOmrQuestionCountFromPipeline
                        ) {
                          traceAlerts.push(
                            `expectedQuestionCountUsed (${expectedQuestionCountUsed}) != officialOmrQuestionCountFromPipeline (${officialOmrQuestionCountFromPipeline})`,
                          )
                        }
                        if (
                          teacherAnswerKeyLength === 0 &&
                          tracePayload?.answerKeyFromTemplateSummary?.respuestasLength &&
                          tracePayload.answerKeyFromTemplateSummary.respuestasLength > 0
                        ) {
                          traceAlerts.push("Frontend sintetiza clave, pero el backend reporta teacherAnswerKeyLength = 0")
                        }

                        if (teacherAnswerKeyLength === 0 && tableAlternativas.some((x) => String(x.respuesta_correcta ?? "").trim().length > 0)) {
                          traceAlerts.push("Se observan respuestas correctas en la tabla (R. Correcta) pero teacherAnswerKeyLength = 0")
                        }

                        const desarrolloKeys = Object.keys(group.detalle_desarrollo || {})
                        const canonicalDevPairs = desarrolloKeys.map((k) => ({
                          original: k,
                          canonical: tryCanonicalDevelopmentKeyForTrace(k),
                        }))
                        const canonicalDevCounts = new Map<string, number>()
                        for (const p of canonicalDevPairs) {
                          if (!p.canonical) continue
                          canonicalDevCounts.set(p.canonical, (canonicalDevCounts.get(p.canonical) ?? 0) + 1)
                        }
                        const devCanonicalDuplicate = Array.from(canonicalDevCounts.values()).some((count) => count > 1)
                        if (devCanonicalDuplicate) {
                          traceAlerts.push("Duplicación canónica de desarrollo detectada (posibles colisiones Pn)")
                        }

                        const snapshotItems = evaluatorEvaluationBaseSnapshot?.items ?? []
                        const snapshotSource = evaluatorEvaluationBaseSnapshot?.source ?? "—"
                        const snapshotBuildFn =
                          snapshotSource === "source_exam"
                            ? "buildEvaluationBase -> buildFromSourceExam"
                            : snapshotSource === "structured_form"
                              ? "buildEvaluationBase -> buildFromForm"
                              : snapshotSource === "text_form"
                                ? "buildEvaluationBase -> buildFromForm(text_form-fallback)"
                                : "buildEvaluationBase (other)"

                        const typeInferenceSources = snapshotItems.map((it) => String((it.metadata as any)?.typeInferenceSource ?? "—"))
                        const inferTypeFromFormItemV2Used = typeInferenceSources.some((s) => s.includes("inferTypeFromFormItem:v2_altEvidence"))

                        // 🔥 EXTRACCIÓN DE VALORES PARA EL VELOCÍMETRO
                        const puntajeObtenido = Number.parseInt(group.puntaje?.split("/")[0] || "0", 10)
                        const puntajeMaximo =
                          group.puntosMaximos || Number.parseInt(group.puntaje?.split("/")[1] || "0", 10)
                        const puntosAprobacion = group.puntosAprobacion || 0

                        const omrIntegrationFieldsVisible =
                          typeof group.shouldUseOfficialAzureOmr !== "undefined" ||
                          typeof group.officialOmrEngineSelected !== "undefined"
                        const hasAnyOmrOfficialDebugContent =
                          omrIntegrationFieldsVisible ||
                          (group.isEvaluated && Boolean(debug)) ||
                          (SHOW_EVALUATION_TRACE_PANEL && Boolean(tracePayload))

                        const omrOfficialDebugDetailsPanel =
                          canSeeOmrOfficialDebugPanel && hasAnyOmrOfficialDebugContent ? (
                            <details className="rounded-md border border-cyan-300 bg-cyan-50 dark:bg-cyan-950/30 p-3 text-xs">
                              <summary className="cursor-pointer font-semibold text-cyan-900 dark:text-cyan-100">
                                Ver debug técnico OMR
                              </summary>
                              <div className="mt-3 space-y-4">
                                {omrIntegrationFieldsVisible && (
                                  <>
                                    <ul className="font-mono space-y-0.5 break-all">
                                      <li>shouldUseOfficialAzureOmr: {String(group.shouldUseOfficialAzureOmr ?? "—")}</li>
                                      <li>officialOmrActivationReason: {String(group.officialOmrActivationReason ?? "—")}</li>
                                      <li>officialOmrIntegrationEnabled: {String(group.officialOmrIntegrationEnabled ?? "—")}</li>
                                      <li>officialOmrEngineSelected: {String(group.officialOmrEngineSelected ?? "—")}</li>
                                      <li>officialOmrEngineUsed: {String(group.officialOmrEngineUsed ?? "—")}</li>
                                      <li>officialOmrFallbackUsed: {String(group.officialOmrFallbackUsed ?? "—")}</li>
                                      <li>officialOmrFallbackReason: {String(group.officialOmrFallbackReason ?? "—")}</li>
                                    </ul>
                                    {group.officialOmrEngineSelected === "azure_layout_family" &&
                                      group.officialOmrEngineUsed === "legacy" && (
                                        <div className="mt-2 rounded border-2 border-rose-600 bg-rose-50 dark:bg-rose-950/50 p-2 text-rose-900 dark:text-rose-100 font-bold">
                                          El motor Azure oficial NO se usó. Se hizo fallback a legacy.
                                        </div>
                                      )}
                                  </>
                                )}
                                {group.isEvaluated && debug && (
                                  <div
                                    style={{
                                      marginTop: "10px",
                                      padding: "12px",
                                      border: "3px solid red",
                                      background: "#000",
                                      color: "#00ff00",
                                      fontSize: "12px",
                                      zIndex: 9999,
                                    }}
                                  >
                                    <div>
                                      <b>OMR DEBUG (REAL)</b>
                                    </div>

                                    <div>engineSelected: {String(debug.engineSelected)}</div>
                                    <div>engineUsed: {String(debug.engineUsed)}</div>
                                    <div>fallbackUsed: {String(debug.fallbackUsed)}</div>
                                    <div>fallbackReason: {String(debug.fallbackReason ?? "—")}</div>
                                    <div>integrationEnabled: {String(debug.integrationEnabled)}</div>

                                    <div>studentAnswersSource: {String(debug.studentAnswersSource)}</div>
                                    <div>teacherAnswersSource: {String(debug.teacherAnswersSource)}</div>
                                    <div>expectedQuestionCountUsed: {String(debug.expectedQuestionCountUsed)}</div>
                                    <div>teacherAnswerKeyLength: {String(debug.teacherAnswerKeyLength)}</div>
                                    <div>totalPregResolved: {String(debug.totalPregResolved)}</div>
                                    <div>templateKeyUsed: {String(debug.templateKeyUsed)}</div>
                                    <div>omrTemplateVariantUsed: {String(debug.omrTemplateVariantUsed)}</div>

                                    <div>totalDetectedAnswers: {String(debug.totalDetectedAnswers)}</div>
                                    <div>officialOmrQuestionCountFromPipeline: {String(debug.officialOmrQuestionCountFromPipeline)}</div>
                                    <div>officialOmrDetectedAnswersCount: {String(debug.officialOmrDetectedAnswersCount)}</div>
                                    <div>officialOmrDetectedVsPipelineMismatch: {String(debug.officialOmrDetectedVsPipelineMismatch)}</div>
                                    <div>officialOmrAdapterMode: {String(debug.officialOmrAdapterMode)}</div>

                                    <div style={{ marginTop: "10px" }}>detectedAnswersPreview:</div>
                                    <pre style={{ maxHeight: "200px", overflow: "auto" }}>
                                      {JSON.stringify(debug.detectedAnswersPreview, null, 2)}
                                    </pre>
                                    <div style={{ marginTop: "10px" }}>officialOmrPerQuestionRawPreview:</div>
                                    <pre style={{ maxHeight: "200px", overflow: "auto" }}>
                                      {JSON.stringify(debug.officialOmrPerQuestionRawPreview, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {SHOW_EVALUATION_TRACE_PANEL && tracePayload && (
                                  <div className="rounded-lg border border-blue-300 bg-blue-50/30 p-3 space-y-4">
                                    <div className="font-semibold text-blue-900 dark:text-blue-100">Diagnóstico técnico temporal</div>
                                    <div className="space-y-4">
                                      <div className="rounded-md border border-border bg-background/60 p-3">
                                        <div className="font-semibold mb-2">PAYLOAD FINAL ENVIADO</div>
                                        <div className="text-xs text-muted-foreground space-y-1">
                                          <div>
                                            tipoPrueba: <span className="font-mono">{tracePayload.tipoPrueba}</span>
                                          </div>
                                          <div>
                                            evaluatorInstrumentSource:{" "}
                                            <span className="font-mono">{tracePayload.evaluatorInstrumentSource}</span>
                                          </div>
                                          <div>
                                            selectedEvaluatorSourceExamId:{" "}
                                            <span className="font-mono">{tracePayload.selectedEvaluatorSourceExamId || "—"}</span>
                                          </div>
                                          <div className="pt-2">pautaEstructuradaFinal:</div>
                                          <pre className="text-[11px] font-mono overflow-x-auto">{tracePayload.pautaEstructuradaFinal}</pre>
                                          <div className="pt-2">pautaCorrectaAlternativasFinal:</div>
                                          <pre className="text-[11px] font-mono overflow-x-auto">{tracePayload.pautaCorrectaAlternativasFinal}</pre>
                                          <div className="pt-2">answerKeyFromTemplate (resumen):</div>
                                          {tracePayload.answerKeyFromTemplateSummary ? (
                                            <>
                                              <div>
                                                totalPreguntas:{" "}
                                                <span className="font-mono">{tracePayload.answerKeyFromTemplateSummary.totalPreguntas}</span>
                                              </div>
                                              <div>
                                                respuestas.length:{" "}
                                                <span className="font-mono">{tracePayload.answerKeyFromTemplateSummary.respuestasLength}</span>
                                              </div>
                                              <pre className="text-[11px] font-mono overflow-x-auto">
                                                {JSON.stringify(tracePayload.answerKeyFromTemplateSummary.primeras10, null, 2)}
                                              </pre>
                                            </>
                                          ) : (
                                            <div className="text-[11px] font-mono">null (no se pudo sintetizar clave desde la pauta)</div>
                                          )}
                                        </div>
                                      </div>

                                      <div className="rounded-md border border-border bg-background/60 p-3">
                                        <div className="font-semibold mb-2">DEBUG OMR REAL</div>
                                        <div className="text-xs text-muted-foreground space-y-1 font-mono">
                                          <div>studentAnswersSource: {debug?.studentAnswersSource ?? "—"}</div>
                                          <div>teacherAnswersSource: {debug?.teacherAnswersSource ?? "—"}</div>
                                          <div>expectedQuestionCountUsed: {debug?.expectedQuestionCountUsed ?? "—"}</div>
                                          <div>teacherAnswerKeyLength: {debug?.teacherAnswerKeyLength ?? "—"}</div>
                                          <div>totalDetectedAnswers: {debug?.totalDetectedAnswers ?? "—"}</div>
                                          <div>officialOmrQuestionCountFromPipeline: {debug?.officialOmrQuestionCountFromPipeline ?? "—"}</div>
                                          <div>officialOmrDetectedAnswersCount: {debug?.officialOmrDetectedAnswersCount ?? "—"}</div>
                                          <div>officialOmrDetectedVsPipelineMismatch: {debug?.officialOmrDetectedVsPipelineMismatch ?? "—"}</div>
                                          <div>templateKeyUsed: {debug?.templateKeyUsed ?? "—"}</div>
                                          <div>omrTemplateVariantUsed: {debug?.omrTemplateVariantUsed ?? "—"}</div>
                                        </div>
                                      </div>

                                      <div className="rounded-md border border-border bg-background/60 p-3">
                                        <div className="font-semibold mb-2">TRACE DE ORIGEN REAL DE TIPOS</div>
                                        <div className="text-xs text-muted-foreground space-y-1">
                                          <div>
                                            evaluatorEvaluationBaseSnapshot.source:{" "}
                                            <span className="font-mono">{String(snapshotSource)}</span>
                                          </div>
                                          <div>
                                            Construido por: <span className="font-mono">{snapshotBuildFn}</span>
                                          </div>
                                          <div>
                                            inferTypeFromFormItem (versión modificada) usada:{" "}
                                            <span className="font-mono">{inferTypeFromFormItemV2Used ? "sí" : "no"}</span>
                                          </div>
                                        </div>
                                        <div className="mt-3 max-h-64 overflow-auto">
                                          <Table>
                                            <TableHeader>
                                              <TableRow>
                                                <TableHead>item_number</TableHead>
                                                <TableHead>type</TableHead>
                                                <TableHead>correctAnswer</TableHead>
                                                <TableHead>fuente</TableHead>
                                                <TableHead>altEvidence</TableHead>
                                                <TableHead>texto evaluado (alt)</TableHead>
                                              </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                              {snapshotItems.map((it, idx) => {
                                                const meta = it.metadata as any
                                                const altText =
                                                  typeof meta?.altEvidenceEvaluatedText === "string" ? meta.altEvidenceEvaluatedText : null
                                                const altRes = typeof meta?.altEvidenceResult === "boolean" ? meta.altEvidenceResult : null
                                                return (
                                                  <TableRow key={it.id || idx}>
                                                    <TableCell className="font-mono">{String(meta?.item_number ?? "—")}</TableCell>
                                                    <TableCell className="font-mono">{it.type}</TableCell>
                                                    <TableCell className="font-mono">{String(it.correctAnswer ?? "—")}</TableCell>
                                                    <TableCell className="font-mono">{String(meta?.typeInferenceSource ?? "—")}</TableCell>
                                                    <TableCell className="font-mono">{altRes == null ? "—" : altRes ? "true" : "false"}</TableCell>
                                                    <TableCell>
                                                      <div className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                                                        {altText ?? "—"}
                                                      </div>
                                                    </TableCell>
                                                  </TableRow>
                                                )
                                              })}
                                            </TableBody>
                                          </Table>
                                        </div>
                                      </div>

                                      <div className="rounded-md border border-border bg-background/60 p-3">
                                        <div className="font-semibold mb-2">COMPARACIÓN CERRADAS REALES</div>
                                        {Array.isArray(tableAlternativas) && tableAlternativas.length > 0 ? (
                                          <div className="overflow-x-auto">
                                            <Table>
                                              <TableHeader>
                                                <TableRow>
                                                  <TableHead>Pregunta</TableHead>
                                                  <TableHead>Respuesta detectada</TableHead>
                                                  <TableHead>Respuesta correcta usada</TableHead>
                                                  <TableHead>Estado real</TableHead>
                                                  <TableHead>Fuente correct</TableHead>
                                                  <TableHead>Fallback</TableHead>
                                                  <TableHead>Slot/canonical</TableHead>
                                                </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                {tableAlternativas.slice(0, 30).map((item, idx) => {
                                                  const est = (item.respuesta_estudiante ?? "").trim().toUpperCase()
                                                  const corr = (item.respuesta_correcta ?? "").trim().toUpperCase()
                                                  const ok = est && corr ? est === corr : false
                                                  const preg = (item.pregunta ?? "").trim().toUpperCase()
                                                  const slot = /^([CP])\d+$/.test(preg) ? preg : preg.match(/^\d+$/) ? `C${preg}` : "—"
                                                  return (
                                                    <TableRow key={idx}>
                                                      <TableCell className="font-mono">{item.pregunta}</TableCell>
                                                      <TableCell className="font-mono">{item.respuesta_estudiante}</TableCell>
                                                      <TableCell className="font-mono text-green-700">{item.respuesta_correcta}</TableCell>
                                                      <TableCell className="font-bold">{ok ? "OK" : "INCORRECTA"}</TableCell>
                                                      <TableCell className="font-mono">{debug?.teacherAnswersSource ?? "—"}</TableCell>
                                                      <TableCell className="font-mono">{debug?.fallbackUsed ? "sí" : "no"}</TableCell>
                                                      <TableCell className="font-mono">{slot}</TableCell>
                                                    </TableRow>
                                                  )
                                                })}
                                              </TableBody>
                                            </Table>
                                          </div>
                                        ) : (
                                          <div className="text-xs text-muted-foreground">No hay alternativas corregidas para mostrar</div>
                                        )}
                                      </div>

                                      <div className="rounded-md border border-border bg-background/60 p-3">
                                        <div className="font-semibold mb-2">DESARROLLO REAL</div>
                                        <div className="text-xs text-muted-foreground space-y-2">
                                          <div>
                                            total claves desarrollo detectadas: <span className="font-mono">{desarrolloKeys.length}</span>
                                          </div>
                                          <div>
                                            colapso/evidencia de normalización (por claves canónicas):{" "}
                                            <span className="font-mono">
                                              {canonicalDevPairs.some((p) => p.canonical && p.canonical !== p.original) ? "sí" : "no"}
                                            </span>
                                          </div>
                                          <div>
                                            duplicación canónica detectada:{" "}
                                            <span className="font-mono">{devCanonicalDuplicate ? "sí" : "no"}</span>
                                          </div>
                                          <pre className="text-[11px] font-mono overflow-x-auto">
                                            {JSON.stringify(
                                              canonicalDevPairs.slice(0, 60).map((p) => ({
                                                original: p.original,
                                                canonical: p.canonical ?? null,
                                              })),
                                              null,
                                              2,
                                            )}
                                          </pre>
                                        </div>
                                      </div>

                                      <div className="rounded-md border border-border bg-background/60 p-3">
                                        <div className="font-semibold mb-2">CONTRADICCIONES DETECTADAS</div>
                                        {traceAlerts.length > 0 ? (
                                          <ul className="list-disc pl-5 text-xs text-destructive space-y-1">
                                            {traceAlerts.map((a, i) => (
                                              <li key={i}>{a}</li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <div className="text-xs text-muted-foreground">Sin contradicciones detectadas para este caso.</div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </details>
                          ) : null

                        return (
                          <div
                            key={group.id}
                            id={`group-paso3-${group.id}`}
                            className={`p-6 rounded-lg border-l-4 ${
                              group.error ? "border-red-500" : "border-green-500"
                            } bg-[var(--bg-card)] shadow`}
                          >
                            <div className="flex justify-between items-center flex-wrap gap-2">
                              <h3 className="font-bold text-xl text-[var(--text-accent)]">
                                {formatStudentDisplayName(group.studentName) || group.studentName}
                              </h3>
                              {group.isEvaluating && (
                                <div className="flex items-center text-sm text-[var(--text-secondary)]">
                                  <Loader2
                                    className="mr-2
h-4 w-4 animate-spin"
                                  />
                                  Procesando...
                                </div>
                              )}
                              {group.isEvaluated && !group.error && (
                                <div className="flex items-center gap-2">
                                  <Button variant="outline" size="sm" onClick={() => handlePreview(group.id)}>
                                    <Eye className="mr-2 h-4 w-4" /> Ver informe
                                  </Button>

                                  <PDFDownloadLink
                                    document={
                                      <ReportDocument
                                        group={group}
                                        formData={form.getValues()}
                                        logoPreview={logoPreview}
                                      />
                                    }
                                    fileName={`informe_${(formatStudentDisplayName(group.studentName) || group.studentName).replace(/[^a-zA-Z0-9]/g, "_")}.pdf`}
                                  >
                                    {({ loading }) => (
                                      <Button variant="ghost" size="sm" disabled={loading}>
                                        {loading ? (
                                          "Preparando PDF..."
                                        ) : (
                                          <>
                                            <Printer className="mr-2 h-4 w-4" /> Descargar PDF
                                          </>
                                        )}
                                      </Button>
                                    )}
                                  </PDFDownloadLink>
                                </div>
                              )}
                            </div>

                            {group.error ? (
                              <div className="space-y-3">
                                <p className="text-red-600">Error: {group.error}</p>
                                {omrOfficialDebugDetailsPanel}
                              </div>
                            ) : (
                              <div className="mt-4 space-y-6">
                                {omrOfficialDebugDetailsPanel}
                                {group.isEvaluated && (
                                  <>
                                    {/* REEMPLAZO DE PUNTAJE Y NOTA PARA INCLUIR VELOCÍMETRO */}
                                    <div className="flex justify-between items-start bg-[var(--bg-muted-subtle)] p-4 rounded-lg">
                                      <div>
                                        <p className="text-sm font-bold">PUNTAJE</p>
                                        <Input
                                          className="text-xl font-semibold w-24 h-12 text-center"
                                          type="text"
                                          value={group.puntaje || ""}
                                          onChange={(e) => handlePuntajeChange(group.id, e.target.value)}
                                          placeholder="N/A"
                                        />
                                      </div>

                                      <div className="text-right">
                                        <div className="flex items-center gap-2">
                                          <label htmlFor={`decimas-${group.id}`} className="text-sm font-medium">
                                            Décimas:
                                          </label>
                                          <Input
                                            id={`decimas-${group.id}`}
                                            type="number"
                                            step={0.1}
                                            defaultValue={group.decimasAdicionales}
                                            onChange={(e) => handleDecimasChange(group.id, e.target.value)}
                                            className="h-8 w-20"
                                          />
                                        </div>
                                        <p className="text-sm font-bold mt-2">NOTA FINAL</p>
                                        <Input
                                          className="text-3xl font-bold w-24 h-12 text-center text-blue-600 border-none bg-transparent"
                                          type="number"
                                          step={0.1}
                                          value={String(Number(group.nota || 0) + (group.decimasAdicionales || 0))}
                                          onChange={(e) => handleNotaChange(group.id, e.target.value)}
                                          placeholder="N/A"
                                        />
                                      </div>
                                    </div>

                                    {/* 🔥 INTEGRACIÓN DEL VELOCÍMETRO */}
                                    {puntajeMaximo > 0 && puntosAprobacion > 0 && (
                                      <div className="bg-[var(--bg-muted)] p-4 rounded-lg border border-[var(--border-color)]">
                                        <h5 className="font-bold text-[var(--text-accent)] mb-2">
                                          📊 Rendimiento vs. Exigencia ({form.getValues("porcentajeExigencia")}%)
                                        </h5>
                                        <ExigenciaVelocimeter
                                          obtenido={puntajeObtenido}
                                          maximo={puntajeMaximo}
                                          aprobacion={puntosAprobacion}
                                        />
                                      </div>
                                    )}
                                    {/* FIN DE REEMPLAZO */}

                                    <div>
                                      <h4 className="font-bold mb-2 text-[var(--text-accent)]">Corrección Detallada</h4>

                                      <div className="overflow-x-auto">
                                        <Table>
                                          <TableHeader>
                                            <TableRow>
                                              <TableHead>Sección</TableHead>

                                              <TableHead>Detalle</TableHead>
                                            </TableRow>
                                          </TableHeader>

                                          <TableBody>
                                            {filterCorreccionDetalladaParaDesarrolloUnico(group).map((item, index) => (
                                              <TableRow key={index}>
                                                <TableCell className="font-medium">
                                                  {renderForWeb(item.seccion)}
                                                </TableCell>

                                                <TableCell>
                                                  {renderForWeb(item.detalle ?? item.detalles ?? "")}
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                            {Object.keys(group.detalle_desarrollo || {}).map((key) => {
                                              const item = group.detalle_desarrollo?.[key]
                                              if (item == null) return null
                                              // Si item no tiene la forma esperada (puntaje/texto/justificacion), puede ser un objeto de rúbrica; mostrarlo como texto seguro
                                              const isDevelopmentItem =
                                                typeof item === "object" &&
                                                (item.hasOwnProperty("puntaje") ||
                                                  item.hasOwnProperty("texto_estudiante") ||
                                                  item.hasOwnProperty("cita_estudiante") ||
                                                  item.hasOwnProperty("justificacion"))
                                              const puntajeStr =
                                                isDevelopmentItem && item.puntaje != null
                                                  ? renderForWeb(item.puntaje)
                                                  : ""
                                              const citaStr =
                                                isDevelopmentItem
                                                  ? renderForWeb(pickStudentDesarrolloVisibleText(item as Record<string, unknown>))
                                                  : ""
                                              const justifStr =
                                                isDevelopmentItem && item.justificacion != null
                                                  ? renderForWeb(item.justificacion)
                                                  : ""
                                              if (!isDevelopmentItem) {
                                                return (
                                                  <TableRow key={key}>
                                                    <TableCell className="font-medium text-purple-600">
                                                      {key.replace(/_/g, " ")}
                                                    </TableCell>
                                                    <TableCell>{renderForWeb(item)}</TableCell>
                                                  </TableRow>
                                                )
                                              }
                                              return (
                                                <TableRow key={key}>
                                                  <TableCell className="font-medium text-purple-600">
                                                    {key.replace(/_/g, " ")}
                                                  </TableCell>
                                                  <TableCell>
                                                    <p className="font-semibold text-sm mb-1">
                                                      Puntaje: {puntajeStr}
                                                    </p>
                                                    <p className="text-xs italic text-[var(--text-secondary)] mb-1">
                                                      Cita Estudiante: &quot;{citaStr}&quot;
                                                    </p>
                                                    <p className="text-sm">{justifStr}</p>
                                                  </TableCell>
                                                </TableRow>
                                              )
                                            })}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </div>
                                    {/* 🚨 VALIDACIÓN OMR INTERACTIVA - TABLA EDITABLE (PASO CRÍTICO DE LA METACONIGICIÓN) */}
                                    {/* Asegurar que la tabla editable SIEMPRE esté visible cuando hay alternativas cerradas */}
                                    {group.isEvaluated && (
                                        <div className="mt-4 border-2 border-blue-500 rounded-lg p-4 bg-blue-50">
                                          <h4 className="font-bold mb-2 flex items-center text-blue-700">
                                            <Eye className="h-4 w-4 mr-2" />
                                            Respuestas Cerradas - Revisión y Edición
                                          </h4>
                                          <div className="text-sm text-blue-800 mb-3 bg-blue-100 p-3 rounded border border-blue-300">
                                            <strong>🔍 INSTRUCCIONES:</strong> Las respuestas marcadas en{" "}
                                            <span className="bg-red-100 px-2 py-0.5 rounded border border-red-300 font-bold">
                                              ROJO
                                            </span>{" "}
                                            requieren su revisión.
                                            <br />
                                            <strong>
                                              Puede editar cualquier respuesta directamente. Los cambios se aplicarán
                                              inmediatamente al puntaje.
                                            </strong>
                                          </div>

                                          <div className="mb-4 flex gap-2 flex-wrap">
                                            {group.files.map((file, idx) => (
                                              <ImageMagnifier
                                                key={idx}
                                                src={file.previewUrl || "/placeholder.svg"}
                                                alt={`Prueba ${formatStudentDisplayName(group.studentName) || group.studentName} - Página ${idx + 1}`}
                                              />
                                            ))}
                                          </div>

                                          <div className="overflow-x-auto">
                                            {tableAlternativas.length > 0 ? (
                                              <Table>
                                                <TableHeader>
                                                  <TableRow className="bg-blue-50">
                                                    <TableHead>Pregunta</TableHead>
                                                    <TableHead>R. Estudiante (Editable)</TableHead>
                                                    <TableHead>R. Correcta</TableHead>
                                                    <TableHead>Estado</TableHead>
                                                  </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                  {tableAlternativas.map((item, index) => {
                                                  const respuestaEst =
                                                    item.respuesta_estudiante?.trim().toUpperCase() || ""
                                                  const respuestaCorr =
                                                    item.respuesta_correcta?.trim().toUpperCase() || ""
                                                  const esIncorrecta =
                                                    respuestaEst && respuestaCorr && respuestaEst !== respuestaCorr

                                                  const tieneBajaConfianza =
                                                    respuestaEst.length > 2 || // Más de 2 caracteres indica ruido
                                                    (item.pregunta.includes("VF") &&
                                                      !["V", "F"].includes(respuestaEst)) || // V/F debe ser V o F
                                                    (item.pregunta.includes("TP") &&
                                                      isNaN(Number.parseInt(respuestaEst))) || // TP debe ser número
                                                    (item.pregunta.includes("SM") &&
                                                      !["A", "B", "C", "D", "E"].includes(respuestaEst)) || // SM debe ser A-E
                                                    respuestaEst === "" // Respuesta vacía

                                                  const necesitaRevision = esIncorrecta || tieneBajaConfianza

                                                  return (
                                                    <TableRow
                                                      key={index}
                                                      className={cn(
                                                        necesitaRevision &&
                                                          "bg-red-50 hover:bg-red-100 border-l-4 border-l-red-500",
                                                      )}
                                                    >
                                                      <TableCell className="font-medium text-sm">
                                                        {item.pregunta}
                                                      </TableCell>
                                                      <TableCell>
                                                        <Input
                                                          type="text"
                                                          className={cn(
                                                            "h-8 w-20 text-center font-bold text-base",
                                                            necesitaRevision
                                                              ? "border-2 border-red-500 bg-red-50"
                                                              : "border-gray-300",
                                                          )}
                                                          defaultValue={item.respuesta_estudiante}
                                                          disabled={!currentAlternativas.some((a) => a.pregunta === item.pregunta)}
                                                          onChange={(e) =>
                                                            handleAlternativeChange(
                                                              group.id,
                                                              item.pregunta,
                                                              e.target.value,
                                                            )
                                                          }
                                                        />
                                                      </TableCell>
                                                      <TableCell className="text-sm text-green-600 font-bold">
                                                        <Input
                                                          type="text"
                                                          className="h-8 w-16 text-center font-bold text-green-700 border-green-300 bg-green-50/50"
                                                          value={item.respuesta_correcta || ""}
                                                          disabled={!currentAlternativas.some((a) => a.pregunta === item.pregunta)}
                                                          onChange={(e) =>
                                                            handleCorrectAnswerChange(
                                                              group.id,
                                                              item.pregunta,
                                                              e.target.value,
                                                            )
                                                          }
                                                          placeholder="A"
                                                        />
                                                      </TableCell>
                                                      <TableCell>
                                                        {necesitaRevision ? (
                                                          <span className="text-xs font-bold text-red-600 flex items-center gap-1">
                                                            <Eye className="h-3 w-3" /> ⚠️ REVISAR
                                                          </span>
                                                        ) : (
                                                          <span className="text-xs text-gray-500 flex items-center gap-1">
                                                            <CheckCircle2 className="h-3 w-3 text-green-500" />✓ OK
                                                          </span>
                                                        )}
                                                      </TableCell>
                                                    </TableRow>
                                                  )
                                                  })}
                                                </TableBody>
                                              </Table>
                                            ) : (
                                              <div className="text-sm text-blue-800 bg-blue-100 p-3 rounded border border-blue-300">
                                                No hay respuestas cerradas detectadas para mostrar en esta evaluación.
                                              </div>
                                            )}
                                          </div>
                                          {group.evaluation_id && (
                                            <div className="mt-3 flex items-center gap-2">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="default"
                                                disabled={applyChangesGroupId === group.id}
                                                onClick={async () => {
                                                  const evalId = group.evaluation_id
                                                  if (!evalId || !group.alternativas_corregidas?.length) return
                                                  setApplyChangesGroupId(group.id)
                                                  try {
                                                    const getRes = await fetch(`/api/evaluations/${evalId}`, { cache: "no-store", credentials: "include" })
                                                    const getData = await getRes.json().catch(() => ({}))
                                                    const currentItems: Array<{ question_number: number }> = Array.isArray(getData.evaluation_items)
                                                      ? getData.evaluation_items
                                                      : Array.isArray(getData.items)
                                                        ? getData.items
                                                        : []
                                                    const sortedDb = [...currentItems].sort((a, b) => (a.question_number ?? 0) - (b.question_number ?? 0))

                                                    const pautaStr = form.getValues().pautaEstructurada || ""
                                                    const itemScoresPauta = parsePautaEstructurada(pautaStr)
                                                    const altItems = group.alternativas_corregidas.map((a) => {
                                                      const preguntaId = (a.pregunta || "").trim().toUpperCase()
                                                      const itemMatch = itemScoresPauta.find((scoreItem) => {
                                                        const scoreIdUpper = (scoreItem.id || "").trim().toUpperCase()
                                                        return scoreIdUpper === preguntaId || scoreIdUpper.includes(preguntaId) || preguntaId.includes(scoreIdUpper)
                                                      })
                                                      let maxItemScore = 1
                                                      if (itemMatch) maxItemScore = itemMatch.maxScore
                                                      const correct = (a.respuesta_estudiante?.trim().toUpperCase() ?? "") === (a.respuesta_correcta?.trim().toUpperCase() ?? "")
                                                      return {
                                                        student_answer: a.respuesta_estudiante ?? "",
                                                        correct_answer: a.respuesta_correcta ?? "",
                                                        is_correct: correct,
                                                        score_obtained: correct ? maxItemScore : 0,
                                                        score_max: maxItemScore,
                                                      }
                                                    })
                                                    const desarrolloKeys = Object.keys(group.detalle_desarrollo || {}).sort()
                                                    const desarrolloItems = desarrolloKeys.map((key) => {
                                                      const item = group.detalle_desarrollo?.[key]
                                                      let score_obtained = 0
                                                      let score_max = 0
                                                      if (item && typeof item === "object" && typeof (item as { puntaje?: string }).puntaje === "string") {
                                                        const parts = (item as { puntaje: string }).puntaje.split("/").map((n) => parseInt(n, 10) || 0)
                                                        score_obtained = parts[0] ?? 0
                                                        score_max = parts[1] ?? 0
                                                      }
                                                      return {
                                                        student_answer: pickStudentDesarrolloVisibleText(
                                                          item as Record<string, unknown>,
                                                        ),
                                                        correct_answer: null as string | null,
                                                        is_correct: null as boolean | null,
                                                        score_obtained,
                                                        score_max,
                                                      }
                                                    })
                                                    const ourValues = [...altItems, ...desarrolloItems]
                                                    const items = sortedDb.map((row, i) => {
                                                      const qn = row.question_number ?? i + 1
                                                      const v = ourValues[i]
                                                      if (v) {
                                                        return {
                                                          question_number: qn,
                                                          student_answer: v.student_answer,
                                                          correct_answer: v.correct_answer,
                                                          is_correct: v.is_correct,
                                                          score_obtained: v.score_obtained,
                                                          score_max: v.score_max,
                                                        }
                                                      }
                                                      return { question_number: qn, score_obtained: 0, score_max: 0 }
                                                    })
                                                    const r = await fetch(`/api/evaluations/${evalId}/items`, {
                                                      method: "PATCH",
                                                      headers: { "Content-Type": "application/json" },
                                                      credentials: "include",
                                                      body: JSON.stringify({
                                                        items,
                                                        porcentaje_exigencia: (() => {
                                                          const n = Number(form.getValues().porcentajeExigencia)
                                                          return n >= 1 && n <= 100 ? n : undefined
                                                        })(),
                                                        puntaje_total_max: (() => {
                                                          const fromGroup = group.puntosMaximos != null && group.puntosMaximos > 0 ? group.puntosMaximos : null
                                                          const fromForm = Number(form.getValues().puntajeTotal)
                                                          return fromGroup ?? (fromForm > 0 ? fromForm : undefined)
                                                        })(),
                                                      }),
                                                    })
                                                    const j = await r.json().catch(() => ({}))
                                                    if (r.ok && j.ok) {
                                                      toast({ title: "Cambios aplicados en toda la app." })
                                                      loadEvaluationsList()
                                                      loadStudentsList()
                                                      await refetchStudentProfileIfOpen()
                                                      await refetchCourseDiagnosisIfOpen()
                                                      if (evaluacionesDetailId === evalId) await refetchEvaluacionDetail()
                                                    } else {
                                                      toast({ title: j?.error || "Error al aplicar cambios", variant: "destructive" })
                                                    }
                                                  } catch {
                                                    toast({ title: "Error al aplicar cambios", variant: "destructive" })
                                                  } finally {
                                                    setApplyChangesGroupId(null)
                                                  }
                                                }}
                                              >
                                                {applyChangesGroupId === group.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                                Aplicar cambios en toda la app
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    {/* FIN DE LA TABLA EDITABLE */}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                      {(() => {
                                        const rp = buildPedagogicalResumenFromGroup({
                                          alternativas_corregidas: group.alternativas_corregidas,
                                          puntaje: group.puntaje,
                                          puntosMaximos: group.puntosMaximos,
                                          puntosAprobacion: group.puntosAprobacion,
                                          detalle_desarrollo: group.detalle_desarrollo,
                                        })
                                        return (
                                          <>
                                            <Card className="border-l-4 border-l-green-500">
                                              <CardHeader className="pb-3">
                                                <CardTitle className="text-green-700 text-base">
                                                  Fortalezas (datos de la evaluación)
                                                </CardTitle>
                                              </CardHeader>
                                              <CardContent>
                                                <p className="text-sm leading-relaxed whitespace-pre-line">{rp.fortalezas}</p>
                                              </CardContent>
                                            </Card>

                                            <Card className="border-l-4 border-l-yellow-500">
                                              <CardHeader className="pb-3">
                                                <CardTitle className="text-yellow-700 text-base">
                                                  Áreas de mejora (datos de la evaluación)
                                                </CardTitle>
                                              </CardHeader>
                                              <CardContent>
                                                <p className="text-sm leading-relaxed whitespace-pre-line">{rp.areas_mejora}</p>
                                              </CardContent>
                                            </Card>
                                          </>
                                        )
                                      })()}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    })()}
                  </CardContent>
                </Card>
              )}
              </div>
            </div>
          )}
          <TabsContent value="dashboard" className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold text-[var(--text-accent)]">Resumen de Notas</h2>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => exportToDocOrCsv("csv")}>
                  Exportar CSV
                </Button>
                <Button onClick={() => exportToDocOrCsv("doc")}>Exportar Word</Button>
              </div>
            </div>
            <NotesDashboard
              studentGroups={studentGroups}
              curso={form.getValues("curso")}
              fecha={form.getValues("fechaEvaluacion")}
            />
          </TabsContent>
          {enablePedagogy && (
            <TabsContent value="pedagogy-dashboard" className="mt-4 space-y-4">
              <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
                <CardHeader>
                  <CardTitle className="text-[var(--text-accent)]">Dashboard pedagógico (Ejes / Habilidades)</CardTitle>
                  <CardDescription>Etiqueta preguntas por eje y habilidad para ver resultados por competencia.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-[var(--text-muted)]">Evaluación:</span>
                    <Select
                      value={dashboardEvaluationId ?? ""}
                      onValueChange={(v) => {
                        const id = v || null
                        setDashboardEvaluationId(id)
                        if (typeof window !== "undefined") (id ? localStorage.setItem("dashboardEvaluationId", id) : localStorage.removeItem("dashboardEvaluationId"))
                      }}
                    >
                      <SelectTrigger className="w-[280px]">
                        <SelectValue placeholder="Selecciona una evaluación" />
                      </SelectTrigger>
                      <SelectContent>
                        {dashboardList.map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.title || "(Sin título)"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {dashboardListLoading && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />}
                  </div>
                  {dashboardEvaluationId && (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const r = await fetch(`/api/evaluations/${dashboardEvaluationId}`)
                            const j = await r.json()
                            const items = (j.evaluation_items ?? j.items ?? []).map((it: { question_number: number }) => ({ question_number: it.question_number })).sort((a: { question_number: number }, b: { question_number: number }) => a.question_number - b.question_number)
                            setDashboardDetailItems(items)
                            setDashboardTagDrafts({})
                            setDashboardTagsModalOpen(true)
                          }}
                        >
                          Etiquetar preguntas
                        </Button>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={dashboardMode === "simce"}
                            onChange={(e) => {
                              const mode = e.target.checked ? "simce" : "normal"
                              setDashboardMode(mode)
                              if (typeof window !== "undefined") localStorage.setItem("dashboardMode", mode)
                            }}
                          />
                          Modo SIMCE (Inicial / Intermedio / Avanzado)
                        </label>
                      </div>
                      {dashboardAnalysisError && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-sm">
                          {dashboardAnalysisError}
                        </div>
                      )}
                      {dashboardAnalysisLoading && (
                        <div className="flex items-center gap-2 text-[var(--text-muted)]">
                          <Loader2 className="h-5 w-5 animate-spin" /> Cargando análisis...
                        </div>
                      )}
                      {!dashboardAnalysisLoading && dashboardAnalysis && (
                        <div className="space-y-6">
                          {dashboardAnalysis.message && (
                            <p className="text-sm text-[var(--text-muted)]">{dashboardAnalysis.message}</p>
                          )}
                          {(dashboardAnalysis.bySkill.length > 0 || dashboardAnalysis.byAxis.length > 0) ? (
                            <>
                              <div>
                                <h3 className="font-medium mb-2">Por habilidad</h3>
                                <div className="h-64">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={dashboardAnalysis.bySkill.map((s) => ({ name: s.skill_name, accuracy: Math.round(s.accuracy * 100), level: s.level }))} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                                      <Tooltip formatter={(v: number | undefined) => [`${v != null ? v : 0}%`, "Acierto"]} />
                                      <Bar dataKey="accuracy" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                              <div>
                                <h3 className="font-medium mb-2">Por eje</h3>
                                <div className="h-64">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={dashboardAnalysis.byAxis.map((a) => ({ name: a.axis_name, accuracy: Math.round(a.accuracy * 100), level: a.level }))} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                                      <Tooltip formatter={(v: number | undefined) => [`${v != null ? v : 0}%`, "Acierto"]} />
                                      <Bar dataKey="accuracy" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-[var(--text-muted)]">Aún no etiquetas preguntas. Usa &quot;Etiquetar preguntas&quot; para asignar eje y habilidad a cada ítem.</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {!dashboardEvaluationId && !dashboardListLoading && (
                    <p className="text-sm text-[var(--text-muted)]">Selecciona una evaluación para ver el análisis por ejes y habilidades.</p>
                  )}
                </CardContent>
              </Card>
              <Dialog open={dashboardTagsModalOpen} onOpenChange={setDashboardTagsModalOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Etiquetar preguntas</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    {dashboardDetailItems.map((it) => (
                      <div key={it.question_number} className="flex flex-wrap items-center gap-2 p-2 border rounded">
                        <span className="font-medium">Pregunta {it.question_number}</span>
                        <Select
                          value={dashboardTagDrafts[it.question_number]?.axis_id ?? ""}
                          onValueChange={(v) => setDashboardTagDrafts((prev) => ({ ...prev, [it.question_number]: { ...prev[it.question_number], axis_id: v, skill_id: prev[it.question_number]?.skill_id ?? "" } }))}
                        >
                          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Eje" /></SelectTrigger>
                          <SelectContent>
                            {dashboardCatalog.axes.map((a) => (
                              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={dashboardTagDrafts[it.question_number]?.skill_id ?? ""}
                          onValueChange={(v) => setDashboardTagDrafts((prev) => ({ ...prev, [it.question_number]: { ...prev[it.question_number], axis_id: prev[it.question_number]?.axis_id ?? "", skill_id: v } }))}
                        >
                          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Habilidad" /></SelectTrigger>
                          <SelectContent>
                            {dashboardCatalog.skills
                              .filter((s) => !dashboardTagDrafts[it.question_number]?.axis_id || s.axis_id === dashboardTagDrafts[it.question_number]?.axis_id)
                              .map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDashboardTagsModalOpen(false)}>Cancelar</Button>
                    <Button
                      disabled={dashboardTagsSaving}
                      onClick={async () => {
                        if (!dashboardEvaluationId) return
                        setDashboardTagsSaving(true)
                        const tags = dashboardDetailItems.map((it) => ({
                          question_number: it.question_number,
                          axis_id: dashboardTagDrafts[it.question_number]?.axis_id || null,
                          skill_id: dashboardTagDrafts[it.question_number]?.skill_id || null,
                        }))
                        const r = await fetch(`/api/evaluations/${dashboardEvaluationId}/tags`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ tags }),
                        })
                        const j = await r.json()
                        setDashboardTagsSaving(false)
                        if (r.ok && j.ok) {
                          setDashboardTagsModalOpen(false)
                          setDashboardAnalysis(null)
                          const mode = dashboardMode === "simce" ? "?mode=simce" : ""
                          const res = await fetch(`/api/evaluations/${dashboardEvaluationId}/analysis${mode}`)
                          const data = await res.json()
                          if (data.bySkill) setDashboardAnalysis({ bySkill: data.bySkill, byAxis: data.byAxis ?? [], message: data.message })
                          toast({ title: "Etiquetas guardadas." })
                        } else {
                          toast({ title: j.step ? `[${j.step}] ${j.message}` : (j.message || "Error"), variant: "destructive" })
                        }
                      }}
                    >
                      {dashboardTagsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </TabsContent>
          )}
          <TabsContent value="historial" className="mt-4 space-y-4">
            <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
              <CardHeader>
                <CardTitle className="text-[var(--text-accent)]">Historial de evaluaciones</CardTitle>
                <CardDescription>Evaluaciones guardadas en tu cuenta (filtradas por tu perfil).</CardDescription>
              </CardHeader>
              <CardContent>
                {historialLoading && (
                  <div className="flex items-center gap-2 text-[var(--text-muted)]">
                    <Loader2 className="h-5 w-5 animate-spin" /> Cargando...
                  </div>
                )}
                {!historialLoading && historialProfile?.user && (
                  <div className="flex items-center gap-2 mb-2 text-sm text-[var(--text-muted)]">
                    <span>Sesión: {historialProfile.user.email}</span>
                    <button
                      type="button"
                      className="text-[var(--accent)] hover:underline"
                      onClick={async () => {
                        try {
                          const supabase = createClientComponentClient()
                          await supabase.auth.signOut()
                        } catch (_) {}
                        await fetch("/api/auth/logout", { method: "POST" })
                        window.location.href = "/login"
                      }}
                    >
                      Cerrar sesión
                    </button>
                  </div>
                )}
                {!historialLoading && !historialProfile?.user && (
                  <div className="text-center py-8">
                    <p className="text-[var(--text-muted)] mb-4">Inicia sesión para ver tu historial.</p>
                    <a href="/login" className="text-[var(--accent)] font-medium hover:underline">Ir a iniciar sesión</a>
                  </div>
                )}
                {!historialLoading && historialProfile?.user && !historialProfile?.profile?.teacher_id && (
                  <div className="space-y-4 max-w-md">
                    <p className="text-sm text-[var(--text-muted)]">Completa tu perfil para ver el historial.</p>
                    <Input placeholder="Nombre del profesor" value={historialOnboarding.teacher_name} onChange={(e) => { setHistorialOnboarding((p) => ({ ...p, teacher_name: e.target.value })); setHistorialOnboardError(null) }} />
                    <Input placeholder="Colegio / Escuela" value={historialOnboarding.school_name} onChange={(e) => { setHistorialOnboarding((p) => ({ ...p, school_name: e.target.value })); setHistorialOnboardError(null) }} />
                    <Input placeholder="Departamento (opcional)" value={historialOnboarding.department} onChange={(e) => { setHistorialOnboarding((p) => ({ ...p, department: e.target.value })); setHistorialOnboardError(null) }} />
                    {historialOnboardError && <p className="text-sm text-red-600 dark:text-red-400">{historialOnboardError}</p>}
                    <Button
                      onClick={async () => {
                        setHistorialOnboardError(null)
                        const r = await fetch("/api/profile/onboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(historialOnboarding) })
                        const j = await r.json()
                        if (j.success) {
                          setHistorialProfile(null)
                          setHistorialLoading(true)
                          const pr = await fetch("/api/profile")
                          const pj = await pr.json()
                          setHistorialProfile({ profile: pj.profile, user: pj.user })
                          const er = await fetch("/api/evaluations/me")
                          const ej = await er.json()
                          setHistorialEvaluations(ej.evaluations ?? [])
                          setHistorialLoading(false)
                        } else {
                          const errMsg = j.step ? `[${j.step}] ${j.error || "Error"}` : (j.error || "Error al guardar perfil")
                          setHistorialOnboardError(errMsg)
                        }
                      }}
                    >
                      Guardar perfil
                    </Button>
                  </div>
                )}
                {!historialLoading && historialProfile?.profile?.teacher_id && (
                  <>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <Input placeholder="Curso (id)" className="w-32" value={historialFilters.courseId} onChange={(e) => setHistorialFilters((f) => ({ ...f, courseId: e.target.value }))} />
                      <Input type="date" className="w-36" value={historialFilters.from} onChange={(e) => setHistorialFilters((f) => ({ ...f, from: e.target.value }))} />
                      <Input type="date" className="w-36" value={historialFilters.to} onChange={(e) => setHistorialFilters((f) => ({ ...f, to: e.target.value }))} />
                      <Button variant="outline" size="sm" onClick={() => setHistorialFetchKey((k) => k + 1)}>Aplicar filtros</Button>
                      <Button variant="outline" size="sm" onClick={() => setHistorialFetchKey((k) => k + 1)} disabled={historialLoading}>
                        <RefreshCw className={cn("h-4 w-4 mr-1", historialLoading && "animate-spin")} />
                        Refrescar
                      </Button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Título</TableHead>
                          <TableHead>Asignatura</TableHead>
                          <TableHead>Nota</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historialEvaluations.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell>{e.evaluated_at ? format(new Date(e.evaluated_at), "dd/MM/yyyy HH:mm") : "—"}</TableCell>
                            <TableCell>{e.title || "(Sin título)"}</TableCell>
                            <TableCell>{e.subject || "(Sin asignatura)"}</TableCell>
                            <TableCell>{e.grade_chile != null ? Number(e.grade_chile) : "—"}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={async () => {
                                setHistorialDetailId(e.id)
                                const url = `/api/evaluations/${encodeURIComponent(e.id)}`
                                try {
                                  const { res, bodyText, parsed } = await fetchInformeDetailRaw(url)
                                  const j = parsed
                                  if (res.ok && j?.evaluation) {
                                    setHistorialDetail({
                                      evaluation: j.evaluation,
                                      items: (j.items as unknown[]) ?? [],
                                      summary: j.summary,
                                    })
                                  } else {
                                    logInformeFetchFailure("historial Ver", url, res, bodyText, j ?? bodyText)
                                    setHistorialDetail(null)
                                  }
                                } catch (err) {
                                  logInformeFetchFailure("historial Ver (excepción)", url, null, "", {
                                    error: err instanceof Error ? err.message : String(err),
                                  })
                                  setHistorialDetail(null)
                                }
                              }}>Ver</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {historialEvaluations.length === 0 && <p className="text-sm text-[var(--text-muted)] py-4">No hay evaluaciones aún.</p>}
                  </>
                )}
                {historialDetailId && historialDetail && (
                  <div className="mt-6 p-4 border rounded-lg bg-[var(--bg-muted)]">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium">Detalle evaluación</span>
                      <Button variant="ghost" size="sm" onClick={() => { setHistorialDetailId(null); setHistorialDetail(null) }}><X className="h-4 w-4" /></Button>
                    </div>
                    <p className="text-sm text-[var(--text-muted)]">Resumen: {(historialDetail.summary as { strengths?: string; improvements?: string; grade_chile?: number })?.grade_chile != null ? `Nota ${(historialDetail.summary as { grade_chile?: number }).grade_chile}` : ""}</p>
                    <p className="text-xs mt-1">Fortalezas: {(historialDetail.summary as { strengths?: string })?.strengths?.slice(0, 120) ?? "—"}...</p>
                    <p className="text-xs mt-1">Mejoras: {(historialDetail.summary as { improvements?: string })?.improvements?.slice(0, 120) ?? "—"}...</p>
                    <p className="text-sm font-medium mt-2">Ítems ({(historialDetail.items as unknown[]).length})</p>
                    <ul className="text-xs list-disc pl-4 max-h-40 overflow-y-auto">
                      {(historialDetail.items as Array<{ question_number: number; student_answer?: string; correct_answer?: string; is_correct?: boolean; score_obtained?: number }>).map((item, i) => (
                        <li key={i}>P{item.question_number}: {item.student_answer ?? "—"} {item.is_correct != null ? (item.is_correct ? "✓" : "✗") : ""}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="evaluaciones" className="mt-4 space-y-4">
            <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-[var(--text-accent)]">Evaluaciones guardadas</CardTitle>
                    <CardDescription>Evaluaciones ya guardadas en tu cuenta. Selecciona una para ver el detalle.</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadEvaluationsList()}
                    disabled={evaluacionesListLoading}
                  >
                    <RefreshCw className={cn("h-4 w-4 mr-1", evaluacionesListLoading && "animate-spin")} />
                    Recargar
                  </Button>
                  {INTERNAL_SUPPORT_UI && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        setDiagnosisResult(null)
                        setDiagnosisOpen(true)
                        try {
                          const url = lastSavedEvaluationId
                            ? `/api/debug/evaluations/full-check?evaluation_id=${encodeURIComponent(lastSavedEvaluationId)}`
                            : "/api/debug/evaluations/full-check"
                          const r = await fetch(url, { credentials: "include" })
                          const j = await r.json()
                          setDiagnosisResult(j)
                        } catch (e) {
                          setDiagnosisResult({ error: "No se pudo cargar el diagnóstico" })
                        }
                      }}
                    >
                      Diagnóstico
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {/* Banner rojo cuando la última evaluación no se guardó */}
                {(lastSaveReason || lastSaveError) && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-700 dark:text-red-300 text-sm">
                    {lastSaveReason === "NO_SESSION" && "No hay sesión: inicia sesión para guardar."}
                    {lastSaveReason === "PROFILE_NOT_ONBOARDED" && "Perfil incompleto: completa tu perfil para guardar."}
                    {lastSaveReason && lastSaveReason !== "NO_SESSION" && lastSaveReason !== "PROFILE_NOT_ONBOARDED" && lastSaveReason}
                    {!lastSaveReason && lastSaveError && lastSaveError}
                  </div>
                )}
                {/* Bloque fijo: última evaluación guardada */}
                <div className="mb-4 flex flex-wrap items-center gap-2 p-3 rounded-lg bg-[var(--bg-muted)] border border-[var(--border-color)]">
                  <span className="text-sm text-[var(--text-muted)]">
                    Última evaluación guardada: {lastSavedEvaluationId ?? "Ninguna aún"}
                  </span>
                      {lastSavedEvaluationId && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void openEvaluationInforme(lastSavedEvaluationId, informeHintFromListId(lastSavedEvaluationId))
                            }}
                          >
                            Abrir
                          </Button>
                      {INTERNAL_SUPPORT_UI && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            setDiagnosisResult(null)
                            setDiagnosisOpen(true)
                            try {
                              const r = await fetch(`/api/debug/evaluations/full-check?evaluation_id=${encodeURIComponent(lastSavedEvaluationId)}`, { credentials: "include" })
                              const j = await r.json()
                              setDiagnosisResult(j)
                            } catch (e) {
                              setDiagnosisResult({ error: "No se pudo cargar el diagnóstico" })
                            }
                          }}
                        >
                          Diagnosticar última
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {INTERNAL_SUPPORT_UI ? (
                  <p className="text-sm text-[var(--text-muted)] mb-3">
                    teacher_id del perfil: {evaluacionesListDebug?.teacher_id_used ?? "—"} | evaluaciones encontradas:{" "}
                    {evaluacionesList.length}
                  </p>
                ) : null}
                {evaluacionesListError && (
                  <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-sm">
                    Error: {evaluacionesListError}
                  </div>
                )}
                {evaluacionesListLoading && (
                  <div className="flex items-center gap-2 text-[var(--text-muted)]">
                    <Loader2 className="h-5 w-5 animate-spin" /> Cargando...
                  </div>
                )}
                {!evaluacionesListLoading && evaluacionesList.length === 0 && !evaluacionesListUnauth && (
                  <div className="py-8 text-center space-y-3">
                    <p className="text-[var(--text-muted)]">
                      {evaluacionesListReason === "PROFILE_NOT_ONBOARDED"
                        ? "Completa tu perfil para ver evaluaciones."
                        : evaluacionesListMessage || "No hay evaluaciones para tu perfil."}
                    </p>
                    {evaluacionesListReason === "PROFILE_NOT_ONBOARDED" && (
                      <>
                        <Button variant="outline" onClick={() => setActiveTab("historial")}>
                          Completar perfil
                        </Button>
                        {INTERNAL_SUPPORT_UI && (
                          <div className="pt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-amber-600 border-amber-500/50"
                              onClick={async () => {
                                setFixTeacherIdResult(null)
                                const r = await fetch("/api/debug/profile/fix-teacher-id", { method: "POST", credentials: "include" })
                                const j = await r.json()
                                setFixTeacherIdResult(j)
                                if (j?.ok) loadEvaluationsList()
                              }}
                            >
                              Reparar perfil (DEV)
                            </Button>
                            {fixTeacherIdResult != null && (
                              <pre className="mt-3 text-left text-xs bg-[var(--bg-muted)] p-3 rounded overflow-auto max-h-40">
                                {JSON.stringify(fixTeacherIdResult, null, 2)}
                              </pre>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {evaluacionesListReason !== "PROFILE_NOT_ONBOARDED" && evaluacionesListDebug?.teacher_id_used && INTERNAL_SUPPORT_UI && (
                      <div className="pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-amber-600 border-amber-500/50"
                          onClick={async () => {
                            const r = await fetch("/api/debug/evaluations/relink-to-profile", { method: "POST", credentials: "include" })
                            const j = await r.json()
                            if (j?.ok && j.updatedCount > 0) {
                              toast({ title: `Vinculadas ${j.updatedCount} evaluaciones a tu perfil.` })
                              loadEvaluationsList()
                            } else if (j?.ok && j.updatedCount === 0) {
                              toast({ title: j.message || "No había evaluaciones para vincular.", variant: "destructive" })
                            } else {
                              toast({ title: j?.message || "Error al vincular", variant: "destructive" })
                            }
                          }}
                        >
                          Vincular evaluaciones antiguas a mi perfil
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {!evaluacionesListLoading && evaluacionesListUnauth && (
                  <p className="text-[var(--text-muted)] py-8 text-center">Inicia sesión para ver tus evaluaciones guardadas. <a href="/login" className="text-[var(--accent)] hover:underline">Ir a iniciar sesión</a></p>
                )}
                {showRetrySaveButton && lastFailedSaveRef.current && (
                  <div className="flex flex-wrap items-center gap-2 py-3 px-4 rounded-lg bg-[var(--bg-muted)] border border-[var(--border-color)]">
                    <span className="text-sm text-[var(--text-muted)]">La última evaluación no se guardó en el servidor.</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const payload = lastFailedSaveRef.current
                        if (!payload) return
                        try {
                          const r = await fetch("/api/evaluations/retry-save", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ result: payload.result, ...payload.opts }),
                          })
                          const j = await r.json()
                          if (j.saved) {
                            toast({ title: "✅ Guardada como borrador." })
                            setShowRetrySaveButton(false)
                            lastFailedSaveRef.current = null
                            loadEvaluationsList()
                            const evalId = j.evaluation_id
                            const finalStudentName = getFinalStudentNameForSync(null, payload)
                            const finalStudentRut = getFinalStudentRutForSync(null, payload)
                            const finalCourseLabel = getFinalCourseLabel(payload)
                            if (evalId && finalStudentName) {
                              fetch(`/api/evaluations/${evalId}/sync-student`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ student_name: finalStudentName, course_label: finalCourseLabel, student_rut: finalStudentRut }),
                              })
                                .then(async (res) => {
                                  const data = await res.json()
                                  setLastStudentSyncResult({
                                    ok: !!data.ok,
                                    evaluation_id: data.evaluation_id ?? evalId,
                                    received_student_name: data.received_student_name ?? finalStudentName,
                                    received_course_label: data.received_course_label ?? null,
                                    normalized_student_name: data.normalized_student_name ?? "",
                                    student_profile_id: data.student_profile_id ?? null,
                                    created_or_existing: data.created_or_existing ?? null,
                                    message: data.message ?? "",
                                  })
                                  if (data.ok) {
                                    loadStudentsList()
                                    loadEvaluationsList()
                                    setStudentsListFetchKey((k) => k + 1)
                                    await registerAuditAction(
                                      "ALUMNO_EDITADO",
                                      evalId,
                                      `${finalStudentName}${finalCourseLabel ? ` · ${finalCourseLabel}` : ""}`,
                                    )
                                  } else {
                                    toast({ title: "La evaluación se guardó, pero no se pudo sincronizar el estudiante", variant: "default" })
                                  }
                                })
                                .catch(() => {
                                  setLastStudentSyncResult({
                                    ok: false,
                                    evaluation_id: evalId,
                                    received_student_name: finalStudentName,
                                    received_course_label: finalCourseLabel,
                                    normalized_student_name: "",
                                    student_profile_id: null,
                                    created_or_existing: null,
                                    message: "Error de red al llamar sync-student",
                                  })
                                  toast({ title: "La evaluación se guardó, pero no se pudo sincronizar el estudiante", variant: "default" })
                                })
                            } else if (evalId && !finalStudentName) {
                              setLastStudentSyncResult({
                                ok: false,
                                evaluation_id: evalId,
                                received_student_name: "",
                                received_course_label: finalCourseLabel,
                                normalized_student_name: "",
                                student_profile_id: null,
                                created_or_existing: null,
                                message: "student_name vacío en UI",
                              })
                              toast({ title: "La evaluación se guardó, pero no había nombre de estudiante para sincronizar", variant: "default" })
                            }
                          } else {
                            toast({ title: "❌ No se pudo guardar: " + (j.save_error || "Error"), variant: "destructive" })
                          }
                        } catch (_) {
                          toast({ title: "❌ Error al reintentar guardado", variant: "destructive" })
                        }
                      }}
                    >
                      Reintentar guardado
                    </Button>
                  </div>
                )}
                {!evaluacionesListLoading && evaluacionesList.length > 0 && (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Curso</TableHead>
                          <TableHead>Asignatura</TableHead>
                          <TableHead>Título</TableHead>
                          <TableHead>Nota</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Estudiantes</TableHead>
                          <TableHead>Estudiante</TableHead>
                          <TableHead>Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {evaluacionesList.map((e) => {
                          const ev = normalizeEvaluation(e)
                          return (
                            <TableRow key={ev.id}>
                              <TableCell>{ev.evaluated_at ? format(new Date(ev.evaluated_at), "dd/MM/yyyy HH:mm") : "—"}</TableCell>
                              <TableCell>{ev.course_id || "Sin curso"}</TableCell>
                              <TableCell>{ev.subject || "—"}</TableCell>
                              <TableCell>{ev.title || "—"}</TableCell>
                              <TableCell>{ev.grade_chile != null ? Number(ev.grade_chile) : "—"}</TableCell>
                              <TableCell>
                                {ev.status === "final" ? "Publicada" : ev.status === "archived" ? "Archivada" : "Borrador"}
                              </TableCell>
                              <TableCell>{ev.student_count ?? 0}</TableCell>
                              <TableCell>{ev.first_student_name && String(ev.first_student_name).trim() ? ev.first_student_name : "Sin nombre de estudiante"}</TableCell>
                              <TableCell className="flex flex-wrap gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (process.env.NODE_ENV === "development") {
                                      console.info("[UI][VER] clicked", ev.id)
                                    }
                                    void openEvaluationInforme(ev.id, informeHintFromListId(ev.id))
                                  }}
                                >
                                  Ver
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setPedagogicalAnalysisEvalId(ev.id)
                                    setPedagogicalAnalysisEvalLabel(
                                      ev.first_student_name && String(ev.first_student_name).trim()
                                        ? (ev.title ? `${ev.first_student_name} — ${ev.title}` : ev.first_student_name)
                                        : (ev.title || null)
                                    )
                                    setPedagogicalAnalysisStudentName(
                                      ev.first_student_name && String(ev.first_student_name).trim() ? ev.first_student_name : null
                                    )
                                    setPedagogicalAnalysisCourseLabel(
                                      (ev as { course_label?: string | null }).course_label ?? (ev as { course_id?: string | null }).course_id ?? null
                                    )
                                    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
                                      console.info("[Evaluaciones] Análisis pedagógico — abriendo", {
                                        evaluationId: ev.id,
                                        label: ev.first_student_name && String(ev.first_student_name).trim()
                                          ? (ev.title ? `${ev.first_student_name} — ${ev.title}` : ev.first_student_name)
                                          : (ev.title || null),
                                      })
                                    }
                                  }}
                                  title="Análisis pedagógico (prueba base)"
                                >
                                  <BookOpen className="mr-1 h-3.5 w-3.5" /> Análisis pedagógico
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const courseId = ev.course_id ?? "Sin curso"
                                    openCoursePedagogicalSummary(courseId, (ev as { course_label?: string | null }).course_label ?? courseId)
                                  }}
                                  title="Ver resumen pedagógico"
                                >
                                  <FolderOpen className="mr-1 h-3.5 w-3.5" /> Ver resumen pedagógico
                                </Button>
                                {INTERNAL_SUPPORT_UI && (() => {
                                  const canShowArchive = ev.status !== "archived"
                                  console.info("[UI][ARCHIVE] render", { evaluationId: ev.id, status: ev.status, activeTab, canShowArchive })
                                  return null
                                })()}
                                {ev.status !== "archived" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Archivar"
                                  onClick={async () => {
                                    if (INTERNAL_SUPPORT_UI) {
                                      console.info("[UI][ARCHIVE] clicked", ev.id)
                                    }
                                    const r = await fetch(`/api/evaluations/${ev.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }) })
                                    const j = await r.json().catch(() => ({}))
                                    if (INTERNAL_SUPPORT_UI) {
                                      console.info("[UI][ARCHIVE] response", r.status, j)
                                      setArchiveDebug((prev) => ({ ...(prev ?? { total: evaluacionesList.length, rows: evaluacionesList.map((x) => ({ id: x.id, status: x.status ?? null, canShowArchive: (x.status ?? "draft") !== "archived" })) }), lastClick: ev.id, lastResponse: { status: r.status, json: j } }))
                                    }
                                    if (r.ok) {
                                      setEvaluacionesList((prev) => prev.map((item) => (item.id === ev.id ? { ...item, status: "archived" } : item)))
                                      toast({ title: "Evaluación archivada." })
                                      loadEvaluationsList().catch(() => {})
                                    } else {
                                      toast({ title: j?.message || j?.error || "Error al archivar", variant: "destructive" })
                                    }
                                  }}
                                >
                                  <Archive className="h-4 w-4" />
                                </Button>
                              )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Eliminar"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openDeleteEvaluationDialog(ev.id, ev.title ?? null)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 text-red-600" />
                                </Button>
                            </TableCell>
                          </TableRow>
                        )
                        })}
                      </TableBody>
                    </Table>
                  </>
                )}
              </CardContent>
            </Card>
            <Dialog open={!!evaluacionEditId} onOpenChange={(open) => { if (!open) setEvaluacionEditId(null) }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Editar evaluación</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Nombre evaluación</label>
                    <Input
                      value={evaluacionEditForm.title}
                      onChange={(e) => setEvaluacionEditForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="Título"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Asignatura</label>
                    <Input
                      value={evaluacionEditForm.subject}
                      onChange={(e) => setEvaluacionEditForm((f) => ({ ...f, subject: e.target.value }))}
                      placeholder="Asignatura"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Curso (ID o nombre)</label>
                    <Input
                      value={evaluacionEditForm.course_id}
                      onChange={(e) => setEvaluacionEditForm((f) => ({ ...f, course_id: e.target.value }))}
                      placeholder="Curso"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEvaluacionEditId(null)}>Cancelar</Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={async () => {
                                    if (!evaluacionEditId) return
                                    const r = await fetch(`/api/evaluations/${evaluacionEditId}/meta`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        title: evaluacionEditForm.title || null,
                                        subject: evaluacionEditForm.subject || null,
                                        course_id: evaluacionEditForm.course_id || null,
                                      }),
                                    })
                      if (r.ok) {
                        setEvaluacionesList((prev) => prev.map((ev) => (ev.id === evaluacionEditId ? { ...ev, title: evaluacionEditForm.title || null, subject: evaluacionEditForm.subject || null, course_id: evaluacionEditForm.course_id || null } : ev)))
                        setEvaluacionEditId(null)
                        toast({ title: "Evaluación actualizada." })
                      }
                    }}
                  >
                    Guardar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>
            <TabsContent value="cursos" className="mt-4 space-y-4">
            <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-[var(--text-accent)]">Cursos / Carpetas</CardTitle>
                    <CardDescription>Organiza evaluaciones por curso. Activas y archivadas por separado. Desde cada curso puedes abrir el <strong>resumen pedagógico</strong> (gráficos, logro por eje/habilidad, diagnóstico automático).</CardDescription>
                  </div>
                  {INTERNAL_SUPPORT_UI && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        setDiagnosisResult(null)
                        setDiagnosisOpen(true)
                        try {
                          const r = await fetch("/api/debug/evaluations/full-check", { credentials: "include" })
                          const j = await r.json()
                          setDiagnosisResult(j)
                        } catch (e) {
                          setDiagnosisResult({ error: "No se pudo cargar el diagnóstico" })
                        }
                      }}
                    >
                      Diagnóstico
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!selectedCourseId ? (
                  <>
                    {evaluacionesListLoading ? (
                      <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
                      </p>
                    ) : (() => {
                      const normalizedEvaluations = evaluacionesList.map(normalizeEvaluation)
                      const coursesGrouped = groupByCourse(normalizedEvaluations)
                      const courseEntries = Object.entries(coursesGrouped)
                      if (courseEntries.length === 0) {
                        return <p className="text-sm text-[var(--text-muted)]">No hay evaluaciones en ningún curso. Guarda evaluaciones desde la pestaña Evaluaciones.</p>
                      }
                      return (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 overflow-hidden">
                          {courseEntries.map(([courseId, data]) => {
                            const total = data.active.length + data.archived.length
                            const archivedCount = data.archived.length
                            return (
                              <Card
                                key={courseId}
                                className="cursor-pointer border-[var(--border-color)] hover:bg-[var(--bg-muted)] transition-colors min-w-0 h-auto overflow-hidden"
                                onClick={() => setSelectedCourseId(courseId)}
                              >
                                <CardContent className="pt-4 min-w-0 h-auto overflow-hidden">
                                  <div className="font-medium text-[var(--text-accent)] break-words">{courseId}</div>
                                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                                    {total} evaluación(es) · {archivedCount} archivada(s)
                                  </div>
                                  <div
                                    className="mt-3 flex flex-wrap gap-2 justify-end items-center w-full min-w-0"
                                    onClick={(e) => e.stopPropagation()}
                                    role="group"
                                    aria-label="Acciones del curso"
                                  >
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="shrink-0"
                                      onClick={() => setSelectedCourseId(courseId)}
                                    >
                                      Abrir
                                    </Button>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button type="button" variant="outline" size="sm" className="shrink-0 h-8 text-xs">
                                          <MoreHorizontal className="h-3.5 w-3.5 mr-1 shrink-0" aria-hidden />
                                          Acciones
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
                                        <DropdownMenuItem
                                          className="text-xs cursor-pointer"
                                          onClick={async () => {
                                            setCourseDiagnosisLabel(courseId)
                                            setCourseDiagnosisOpen(true)
                                            setCourseDiagnosisData(null)
                                            setCourseDiagnosisRaw(null)
                                            setShowDiagnosticoCrudo(false)
                                            setCourseDiagnosisLoading(true)
                                            try {
                                              const r = await fetch(`/api/courses/${encodeURIComponent(courseId)}/diagnosis`)
                                              const j = await r.json()
                                              setCourseDiagnosisRaw(j)
                                              if (r.ok && !j.error) {
                                                setCourseDiagnosisData({
                                                  course_label: j.course_label ?? j.course ?? courseId,
                                                  students_count: j.students_count ?? 0,
                                                  evaluations_count: j.evaluations_count ?? 0,
                                                  axes: j.axes ?? [],
                                                  skills: j.skills ?? [],
                                                  strongest_skill: j.strongest_skill ?? null,
                                                  weakest_skill: j.weakest_skill ?? null,
                                                  summary: j.summary
                                                    ? { strongest_axis: j.summary.strongest_axis ?? null, weakest_axis: j.summary.weakest_axis ?? null }
                                                    : { strongest_axis: null, weakest_axis: null },
                                                })
                                              } else {
                                                setCourseDiagnosisData({
                                                  course_label: courseId,
                                                  students_count: 0,
                                                  evaluations_count: 0,
                                                  axes: [],
                                                  skills: [],
                                                  strongest_skill: null,
                                                  weakest_skill: null,
                                                  summary: { strongest_axis: null, weakest_axis: null },
                                                })
                                              }
                                            } catch {
                                              setCourseDiagnosisData({
                                                course_label: courseId,
                                                students_count: 0,
                                                evaluations_count: 0,
                                                axes: [],
                                                skills: [],
                                                strongest_skill: null,
                                                weakest_skill: null,
                                                summary: { strongest_axis: null, weakest_axis: null },
                                              })
                                            } finally {
                                              setCourseDiagnosisLoading(false)
                                            }
                                          }}
                                        >
                                          Ver diagnóstico
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-xs cursor-pointer"
                                          onClick={() => openCoursePedagogicalSummary(courseId, courseId)}
                                        >
                                          <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                          Resumen pedagógico
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-xs cursor-pointer text-emerald-700 focus:text-emerald-800"
                                          onClick={() => openCourseBatchZip(courseId)}
                                        >
                                          <FileArchive className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                          Descarga ZIP del curso
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </CardContent>
                              </Card>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 mb-4 min-w-0 overflow-hidden">
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        className="shrink-0 h-8 text-xs"
                        onClick={() => setSelectedCourseId(null)}
                      >
                        ← Volver a cursos
                      </Button>
                      <span className="font-medium text-[var(--text-accent)] break-words min-w-0 flex-1 basis-full sm:basis-auto sm:flex-none">
                        {selectedCourseId}
                      </span>
                      <div className="flex flex-wrap gap-2 justify-end items-center w-full sm:w-auto sm:ml-auto min-w-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" size="sm" className="h-8 text-xs shrink-0">
                              <MoreHorizontal className="h-3.5 w-3.5 mr-1 shrink-0" aria-hidden />
                              Acciones del curso
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              className="text-xs cursor-pointer"
                              onClick={async () => {
                                if (!selectedCourseId) return
                                setCourseDiagnosisLabel(selectedCourseId)
                                setCourseDiagnosisOpen(true)
                                setCourseDiagnosisData(null)
                                setCourseDiagnosisRaw(null)
                                setShowDiagnosticoCrudo(false)
                                setCourseDiagnosisLoading(true)
                                try {
                                  const r = await fetch(`/api/courses/${encodeURIComponent(selectedCourseId)}/diagnosis`)
                                  const j = await r.json()
                                  setCourseDiagnosisRaw(j)
                                  if (r.ok && !j.error) {
                                    setCourseDiagnosisData({
                                      course_label: j.course_label ?? j.course ?? selectedCourseId,
                                      students_count: j.students_count ?? 0,
                                      evaluations_count: j.evaluations_count ?? 0,
                                      axes: j.axes ?? [],
                                      skills: j.skills ?? [],
                                      strongest_skill: j.strongest_skill ?? null,
                                      weakest_skill: j.weakest_skill ?? null,
                                      summary: j.summary
                                        ? { strongest_axis: j.summary.strongest_axis ?? null, weakest_axis: j.summary.weakest_axis ?? null }
                                        : { strongest_axis: null, weakest_axis: null },
                                    })
                                  } else {
                                    setCourseDiagnosisData({
                                      course_label: selectedCourseId,
                                      students_count: 0,
                                      evaluations_count: 0,
                                      axes: [],
                                      skills: [],
                                      strongest_skill: null,
                                      weakest_skill: null,
                                      summary: { strongest_axis: null, weakest_axis: null },
                                    })
                                  }
                                } catch {
                                  setCourseDiagnosisData({
                                    course_label: selectedCourseId,
                                    students_count: 0,
                                    evaluations_count: 0,
                                    axes: [],
                                    skills: [],
                                    strongest_skill: null,
                                    weakest_skill: null,
                                    summary: { strongest_axis: null, weakest_axis: null },
                                  })
                                } finally {
                                  setCourseDiagnosisLoading(false)
                                }
                              }}
                            >
                              Ver diagnóstico
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-xs cursor-pointer"
                              onClick={() => {
                                if (!selectedCourseId) return
                                openCoursePedagogicalSummary(selectedCourseId, selectedCourseId)
                              }}
                            >
                              <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              Resumen pedagógico
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-xs cursor-pointer text-emerald-700 focus:text-emerald-800"
                              onClick={() => {
                                if (!selectedCourseId) return
                                openCourseBatchZip(selectedCourseId)
                              }}
                            >
                              <FileArchive className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              Descarga ZIP del curso
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    {(() => {
                      const normalizedEvaluations = evaluacionesList.map(normalizeEvaluation)
                      const coursesGrouped = groupByCourse(normalizedEvaluations)
                      const data = coursesGrouped[selectedCourseId] ?? { active: [], archived: [] }
                      return evaluacionesListLoading ? (
                        <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
                        </p>
                      ) : (
                        <>
                          <h3 className="text-sm font-semibold text-[var(--text-accent)] mt-4 mb-2">Activas</h3>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Título</TableHead>
                                <TableHead>Nota</TableHead>
                                <TableHead>Estudiantes</TableHead>
                                <TableHead>Acciones</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.active.map((e) => (
                                <TableRow key={e.id}>
                                  <TableCell>{e.evaluated_at ? format(new Date(e.evaluated_at), "dd/MM/yyyy HH:mm") : "—"}</TableCell>
                                  <TableCell>{e.title || "(Sin título)"}</TableCell>
                                  <TableCell>{e.grade_chile != null ? Number(e.grade_chile) : "—"}</TableCell>
                                  <TableCell>{e.student_count != null ? e.student_count : "—"}</TableCell>
                                  <TableCell className="flex gap-1 flex-wrap">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        void openEvaluationInforme(e.id, informeHintFromListId(e.id))
                                      }}
                                    >
                                      <Eye className="h-3 w-3 mr-1" /> Ver informe
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={async () => {
                                        setStudentsModalEvalId(e.id)
                                        setStudentsModalSearch("")
                                        setStudentsModalLoading(true)
                                        setStudentsModalList([])
                                        try {
                                          const r = await fetch(`/api/evaluations/${e.id}/students`, {
                                            cache: "no-store",
                                            credentials: "include",
                                          })
                                          const j = await r.json()
                                          setStudentsModalList(j.students ?? [])
                                        } finally {
                                          setStudentsModalLoading(false)
                                        }
                                      }}
                                    >
                                      Ver estudiantes
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      title="Archivar"
                                      onClick={async () => {
                                        const r = await fetch(`/api/evaluations/${e.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }) })
                                        if (r.ok) {
                                          setEvaluacionesList((prev) => prev.map((ev) => (ev.id === e.id ? { ...ev, status: "archived" } : ev)))
                                          toast({ title: "Evaluación archivada." })
                                          loadEvaluationsList().catch(() => {})
                                        } else {
                                          const j = await r.json().catch(() => ({}))
                                          toast({ title: j?.message || j?.error || "Error al archivar", variant: "destructive" })
                                        }
                                      }}
                                    >
                                      <Archive className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      title="Eliminar"
                                      onClick={() => openDeleteEvaluationDialog(e.id, e.title ?? null)}
                                    >
                                      <Trash2 className="h-4 w-4 text-red-600" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          <h3 className="text-sm font-semibold text-[var(--text-accent)] mt-6 mb-2">Archivadas</h3>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Título</TableHead>
                                <TableHead>Nota</TableHead>
                                <TableHead>Estudiantes</TableHead>
                                <TableHead>Acciones</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.archived.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={5} className="text-[var(--text-muted)]">Ninguna archivada</TableCell>
                                </TableRow>
                              ) : (
                                data.archived.map((e) => (
                                  <TableRow key={e.id}>
                                    <TableCell>{e.evaluated_at ? format(new Date(e.evaluated_at), "dd/MM/yyyy HH:mm") : "—"}</TableCell>
                                    <TableCell>{e.title || "(Sin título)"}</TableCell>
                                    <TableCell>{e.grade_chile != null ? Number(e.grade_chile) : "—"}</TableCell>
                                    <TableCell>{e.student_count != null ? e.student_count : "—"}</TableCell>
                                    <TableCell className="flex gap-1 flex-wrap">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          void openEvaluationInforme(e.id, informeHintFromListId(e.id))
                                        }}
                                      >
                                        <Eye className="h-3 w-3 mr-1" /> Ver informe
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                          setStudentsModalEvalId(e.id)
                                          setStudentsModalSearch("")
                                          setStudentsModalLoading(true)
                                          setStudentsModalList([])
                                          try {
                                            const r = await fetch(`/api/evaluations/${e.id}/students`, {
                                              cache: "no-store",
                                              credentials: "include",
                                            })
                                            const j = await r.json()
                                            setStudentsModalList(j.students ?? [])
                                          } finally {
                                            setStudentsModalLoading(false)
                                          }
                                        }}
                                      >
                                        Ver estudiantes
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        title="Eliminar"
                                        onClick={() => openDeleteEvaluationDialog(e.id, e.title ?? null)}
                                      >
                                        <Trash2 className="h-4 w-4 text-red-600" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </>
                      )
                    })()}
                  </>
                )}
              </CardContent>
            </Card>
            <Dialog
              open={deleteEvaluationDialog.open}
              onOpenChange={(open) => {
                if (!open) {
                  setDeleteEvaluationDialog({ open: false, id: null, title: null })
                } else {
                  setDeleteEvaluationDialog((prev) => ({ ...prev, open: true }))
                }
              }}
            >
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Eliminar evaluación</DialogTitle>
                </DialogHeader>
                <div className="text-sm text-[var(--text-muted)] space-y-2">
                  <p>
                    Esta acción eliminará definitivamente la evaluación y sus datos asociados.
                  </p>
                  <p>
                    <strong>Título:</strong> {deleteEvaluationDialog.title || "(Sin título)"}
                  </p>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDeleteEvaluationDialog({ open: false, id: null, title: null })}
                    disabled={deleteEvaluationLoading}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleConfirmDeleteEvaluation}
                    disabled={deleteEvaluationLoading || !deleteEvaluationDialog.id}
                  >
                    {deleteEvaluationLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Eliminar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={courseDiagnosisOpen} onOpenChange={(open) => { if (!open) { setCourseDiagnosisOpen(false); setCourseDiagnosisLabel(null); setCourseDiagnosisData(null); setCourseDiagnosisRaw(null); setShowDiagnosticoCrudo(false) } }}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Diagnóstico del curso</DialogTitle>
                </DialogHeader>
                {courseDiagnosisLoading ? (
                  <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</p>
                ) : courseDiagnosisData ? (
                  <div className="space-y-6">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-accent)]">{courseDiagnosisData.course_label ?? courseDiagnosisData.course ?? courseDiagnosisLabel}</p>
                      <p className="text-sm text-[var(--text-muted)]">Estudiantes evaluados: {courseDiagnosisData.students_count}</p>
                      <p className="text-sm text-[var(--text-muted)]">Evaluaciones consideradas: {courseDiagnosisData.evaluations_count}</p>
                    </div>
                    {((courseDiagnosisData.axes ?? []).length === 0 && (courseDiagnosisData.skills ?? []).length === 0) ? (
                      <p className="text-sm text-[var(--text-muted)]">Aún no hay suficiente información del curso.</p>
                    ) : (
                      <>
                        {(courseDiagnosisData.axes ?? []).length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold mb-2">Por ejes</h4>
                            <div className="h-56">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={(courseDiagnosisData.axes ?? []).map((a) => ({ name: a.axis_name.length > 14 ? a.axis_name.slice(0, 14) + "…" : a.axis_name, accuracy: Math.round(a.accuracy * 100) }))} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                                  <Tooltip formatter={(v: number | undefined) => [`${v != null ? v : 0}%`, "Precisión"]} />
                                  <Bar dataKey="accuracy" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}
                        {(courseDiagnosisData.skills ?? []).length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold mb-2">Por habilidades</h4>
                            <div className="h-56">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={[...(courseDiagnosisData.skills ?? [])].sort((a, b) => b.accuracy - a.accuracy).slice(0, 10).map((s) => ({ name: s.skill_name.length > 18 ? s.skill_name.slice(0, 18) + "…" : s.skill_name, accuracy: Math.round(s.accuracy * 100) }))}
                                  layout="vertical"
                                  margin={{ left: 8, right: 8 }}
                                >
                                  <XAxis type="number" domain={[0, 100]} />
                                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                                  <Tooltip formatter={(v: number | undefined) => [`${v != null ? v : 0}%`, "Precisión"]} />
                                  <Bar dataKey="accuracy" fill="var(--accent)" radius={[0, 4, 4, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Resumen</h4>
                      <p className="text-sm"><strong>Eje más fuerte:</strong> {courseDiagnosisData.summary?.strongest_axis ?? "—"}</p>
                      <p className="text-sm"><strong>Eje más débil:</strong> {courseDiagnosisData.summary?.weakest_axis ?? "—"}</p>
                      <p className="text-sm"><strong>Habilidad más fuerte:</strong> {courseDiagnosisData.strongest_skill ?? "—"}</p>
                      <p className="text-sm"><strong>Habilidad más débil:</strong> {courseDiagnosisData.weakest_skill ?? "—"}</p>
                    </div>
                    {PEDAGOGY_UI_ENABLED && (
                      <div className="space-y-2">
                        <div className="flex gap-2 items-center">
                          <Button type="button" variant="outline" size="sm" onClick={() => setShowDiagnosticoCrudo((v) => !v)}>
                            Diagnóstico crudo
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={courseDiagnosisBackfillLoading}
                            onClick={async () => {
                              const courseLabel = courseDiagnosisData?.course_label ?? courseDiagnosisData?.course ?? courseDiagnosisLabel ?? ""
                              if (!courseLabel) return
                              setCourseDiagnosisBackfillLoading(true)
                              try {
                                const r = await fetch(`/api/courses/${encodeURIComponent(courseLabel)}/recompute-skills`, {
                                  method: "POST",
                                })
                                const j = await r.json()
                                setLastRecomputeResult(j)
                                if (r.ok && j.ok) {
                                  const scanned = j.evaluations_scanned ?? 0
                                  const updated = j.evaluations_updated ?? 0
                                  const inserted = j.inserted_rows_total ?? 0
                                  const first = Array.isArray(j.details) && j.details.length > 0 ? j.details[0] : null
                                  const linked = first?.linked_profiles_count ?? "-"
                                  const computed = first?.computed_skill_rows_count ?? "-"
                                  const insertedFirst = first?.inserted_skill_rows_count ?? "-"
                                  const reason = first?.reason ?? "-"
                                  toast({ title: "Backfill del curso", description: `${scanned} evaluaciones, ${updated} actualizadas, ${inserted} filas. Ejemplo: perfiles ${linked}, skills ${computed}, insertadas ${insertedFirst}, estado ${reason}` })
                                  const courseId = courseDiagnosisLabel ?? courseDiagnosisData?.course_label ?? courseLabel
                                  const dr = await fetch(`/api/courses/${encodeURIComponent(courseId)}/diagnosis`)
                                  const dj = await dr.json()
                                  setCourseDiagnosisRaw(dj)
                                  if (dr.ok && !dj.error) {
                                    setCourseDiagnosisData({
                                      course_label: dj.course_label ?? dj.course ?? courseId,
                                      students_count: dj.students_count ?? 0,
                                      evaluations_count: dj.evaluations_count ?? 0,
                                      axes: dj.axes ?? [],
                                      skills: dj.skills ?? [],
                                      strongest_skill: dj.strongest_skill ?? null,
                                      weakest_skill: dj.weakest_skill ?? null,
                                      summary: dj.summary ? { strongest_axis: dj.summary.strongest_axis ?? null, weakest_axis: dj.summary.weakest_axis ?? null } : { strongest_axis: null, weakest_axis: null },
                                    })
                                  }
                                  if (studentHistoryId) {
                                    const hr = await fetch(`/api/students/${studentHistoryId}/history`)
                                    const hj = await hr.json()
                                    if (hr.ok && hj.student) setStudentHistoryData(hj)
                                  }
                                } else {
                                  toast({ title: "Error en backfill", description: j.message ?? "No se pudo ejecutar el backfill", variant: "destructive" })
                                }
                              } finally {
                                setCourseDiagnosisBackfillLoading(false)
                              }
                            }}
                          >
                            {courseDiagnosisBackfillLoading ? "Ejecutando backfill..." : "Backfill habilidades del curso"}
                          </Button>
                          {PEDAGOGY_UI_ENABLED && (
                            <Button type="button" variant="outline" size="sm" onClick={() => setShowRecomputeResult((v) => !v)}>
                              Ver resultado del recálculo
                            </Button>
                          )}
                        </div>
                        {showRecomputeResult && lastRecomputeResult != null && (
                          <pre className="text-xs bg-[var(--bg-muted)] p-3 rounded overflow-auto max-h-72 border border-[var(--border-color)]">
                            {JSON.stringify(lastRecomputeResult, null, 2)}
                          </pre>
                        )}
                        {showDiagnosticoCrudo && courseDiagnosisRaw != null && (
                          <pre className="text-xs bg-[var(--bg-muted)] p-3 rounded overflow-auto max-h-48 border border-[var(--border-color)]">
                            {JSON.stringify(courseDiagnosisRaw, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setCourseDiagnosisOpen(false); setCourseDiagnosisLabel(null); setCourseDiagnosisData(null); setCourseDiagnosisRaw(null); setShowDiagnosticoCrudo(false) }}>Cerrar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {/* Modal: Asociar esta evaluación a una prueba base (capa aditiva; no modifica nota ni informe) */}
            <Dialog open={associateSourceExamOpen} onOpenChange={(open) => { setAssociateSourceExamOpen(open); if (!open) setSelectedSourceExamIdForAssociate("") }}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Asociar a prueba base</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-[var(--text-muted)]">Elige una prueba base (instrumento en blanco) para vincular con esta evaluación. No se modifica la nota ni el informe.</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Prueba base</label>
                  <Select value={selectedSourceExamIdForAssociate || "none"} onValueChange={(v) => setSelectedSourceExamIdForAssociate(v === "none" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar prueba base" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {sourceExamsForAssociate.map((se) => (
                        <SelectItem key={se.id} value={se.id}>{se.title ?? "(Sin título)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="border-t pt-3 space-y-2">
                  <p className="text-sm font-medium text-[var(--text-muted)]">O bien: asociar esta prueba base a todo el curso</p>
                  <Select value={selectedCourseIdForBulk || "none"} onValueChange={(v) => setSelectedCourseIdForBulk(v === "none" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar curso" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {coursesForBulkAssociate.map((c) => (
                        <SelectItem key={c.course_id} value={c.course_id}>{c.course_id} ({c.total_evaluations} eval.)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!selectedSourceExamIdForAssociate || !selectedCourseIdForBulk || bulkAssociateLoading}
                    onClick={() => setBulkAssociateConfirmOpen(true)}
                  >
                    Asociar a todo el curso
                  </Button>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAssociateSourceExamOpen(false)}>Cancelar</Button>
                  <Button
                    disabled={!evaluacionesDetailId || !selectedSourceExamIdForAssociate || associateSourceExamLoading}
                    onClick={async () => {
                      if (!evaluacionesDetailId || !selectedSourceExamIdForAssociate) return
                      setAssociateSourceExamLoading(true)
                      try {
                        const r = await fetch(`/api/evaluations/${evaluacionesDetailId}/associate-source-exam`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ source_exam_id: selectedSourceExamIdForAssociate }),
                        })
                        const j = await r.json().catch(() => ({}))
        if (r.ok && j.ok) {
          toast({ title: "Asociación guardada." })
          setAssociateSourceExamOpen(false)
          setSelectedSourceExamIdForAssociate("")
          refetchEvaluacionDetail()
          if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
            console.info("[UI] associate-source-exam success", { evaluationId: evaluacionesDetailId, source_exam_id: selectedSourceExamIdForAssociate })
          }
        } else {
                          toast({ title: j.error || "Error al asociar", variant: "destructive" })
                        }
                      } catch {
                        toast({ title: "Error al asociar", variant: "destructive" })
                      } finally {
                        setAssociateSourceExamLoading(false)
                      }
                    }}
                  >
                    {associateSourceExamLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Asociar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {/* Confirmación: asociar prueba base a todo el curso */}
            <Dialog open={bulkAssociateConfirmOpen} onOpenChange={(open) => { setBulkAssociateConfirmOpen(open); if (!open) setSelectedCourseIdForBulk("") }}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Asociar a todo el curso</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-[var(--text-muted)]">
                  ¿Seguro que deseas asociar esta prueba base a {coursesForBulkAssociate.find((c) => c.course_id === selectedCourseIdForBulk)?.total_evaluations ?? 0} evaluaciones del curso {selectedCourseIdForBulk}?
                  Esta acción no modificará notas ni respuestas, solo la asociación pedagógica.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBulkAssociateConfirmOpen(false)}>Cancelar</Button>
                  <Button
                    disabled={bulkAssociateLoading || !selectedSourceExamIdForAssociate || !selectedCourseIdForBulk}
                    onClick={async () => {
                      if (!selectedSourceExamIdForAssociate || !selectedCourseIdForBulk) return
                      setBulkAssociateLoading(true)
                      try {
                        const r = await fetch(`/api/source-exams/${selectedSourceExamIdForAssociate}/associate-to-course`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ course_id: selectedCourseIdForBulk }),
                        })
                        const j = await r.json().catch(() => ({}))
                        if (r.ok && j.ok) {
                          toast({ title: `Asociación masiva: ${j.associated_count ?? 0} evaluaciones actualizadas.` })
                          setBulkAssociateConfirmOpen(false)
                          setAssociateSourceExamOpen(false)
                          setSelectedSourceExamIdForAssociate("")
                          setSelectedCourseIdForBulk("")
                          refetchEvaluacionDetail()
                        } else {
                          toast({ title: j.error || "Error al asociar", variant: "destructive" })
                        }
                      } catch {
                        toast({ title: "Error al asociar", variant: "destructive" })
                      } finally {
                        setBulkAssociateLoading(false)
                      }
                    }}
                  >
                    {bulkAssociateLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Confirmar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {/* Modal Diagnóstico (full-check) */}
            <Dialog open={diagnosisOpen} onOpenChange={(open) => { if (!open) { setDiagnosisOpen(false); setDiagnosisResult(null) } }}>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle>Diagnóstico evaluación</DialogTitle>
                </DialogHeader>
                {diagnosisResult != null && (
                  <>
                    <pre className="text-xs overflow-auto max-h-[60vh] p-3 rounded bg-[var(--bg-muted)] border border-[var(--border-color)] whitespace-pre-wrap break-words">
                      {JSON.stringify(diagnosisResult, null, 2)}
                    </pre>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          try {
                            navigator.clipboard.writeText(JSON.stringify(diagnosisResult, null, 2))
                            toast({ title: "Copiado al portapapeles" })
                          } catch (_e) {
                            toast({ title: "No se pudo copiar", variant: "destructive" })
                          }
                        }}
                      >
                        Copiar
                      </Button>
                      <Button variant="outline" onClick={() => { setDiagnosisOpen(false); setDiagnosisResult(null) }}>Cerrar</Button>
                    </DialogFooter>
                  </>
                )}
                {diagnosisResult == null && diagnosisOpen && (
                  <p className="text-sm text-[var(--text-muted)] flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando diagnóstico...</p>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>
          <TabsContent value="estudiantes" className="mt-4 space-y-4">
            <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
              <CardHeader>
                <CardTitle className="text-[var(--text-accent)]">Historial por estudiante</CardTitle>
                <CardDescription>Lista de estudiantes con evaluaciones. Haz clic en uno para ver su progreso.</CardDescription>
                <div className="flex flex-wrap gap-2 mt-2 items-center">
                  <Input
                    placeholder="Buscar por nombre..."
                    className="max-w-xs"
                    value={studentsListSearch}
                    onChange={(e) => setStudentsListSearch(e.target.value)}
                  />
                  <Input
                    placeholder="Filtrar por curso"
                    className="max-w-xs"
                    value={studentsListCourseFilter}
                    onChange={(e) => setStudentsListCourseFilter(e.target.value)}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => { setStudentsListFetchKey((k) => k + 1); loadStudentsList() }}>
                    Recargar estudiantes
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {studentsListError && (
                  <p className="text-sm text-red-600 dark:text-red-400 mb-3">{studentsListError}</p>
                )}
                {studentsListLoading ? (
                  <p className="flex items-center gap-2 text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</p>
                ) : studentsList.length === 0 ? (
                  <p className="text-[var(--text-muted)]">No hay estudiantes aún. Las evaluaciones guardadas con nombre de estudiante aparecerán aquí.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Curso</TableHead>
                        <TableHead>Evaluaciones</TableHead>
                        <TableHead>Promedio</TableHead>
                        <TableHead>Análisis pedagógico</TableHead>
                        <TableHead>Ver perfil</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {studentsList.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.student_name}</TableCell>
                          <TableCell>{s.course_label ?? "—"}</TableCell>
                          <TableCell>{s.evaluations_count}</TableCell>
                          <TableCell>{s.avg_score != null ? s.avg_score.toFixed(1) : "—"}</TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={studentPedagogicalLoadingId === s.id}
                              title="Análisis pedagógico de la evaluación más reciente del estudiante"
                              onClick={async () => {
                                setStudentPedagogicalLoadingId(s.id)
                                try {
                                  const r = await fetch(`/api/students/${s.id}/history`, { cache: "no-store", credentials: "include" })
                                  const j = await r.json()
                                  if (!r.ok || !j.evaluations || j.evaluations.length === 0) {
                                    const noEvals = Array.isArray(j.evaluations) && j.evaluations.length === 0
                                    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
                                      console.info("[Estudiantes] Análisis pedagógico — sin evaluación usable", {
                                        studentId: s.id,
                                        studentName: s.student_name,
                                        evaluationsCount: j.evaluations?.length ?? 0,
                                        reason: noEvals ? "no_evaluations" : "fetch_error",
                                      })
                                    }
                                    toast({
                                      title: noEvals ? "Este estudiante aún no tiene evaluaciones." : "No se pudo cargar el historial del estudiante.",
                                      description: noEvals ? undefined : (j.error || "Intente de nuevo más tarde."),
                                      variant: noEvals ? "default" : "destructive",
                                    })
                                    return
                                  }
                                  const evals = j.evaluations as Array<{ evaluation_id: string; title?: string | null; evaluated_at?: string | null }>
                                  const latest = evals[evals.length - 1]
                                  const evalId = latest?.evaluation_id
                                  if (!evalId) {
                                    toast({ title: "No se encontró una evaluación para este estudiante.", variant: "destructive" })
                                    return
                                  }
                                  const chosenLabel = `${s.student_name}${latest.title ? ` — ${latest.title}` : ""}`
                                  setPedagogicalAnalysisEvalId(evalId)
                                  setPedagogicalAnalysisEvalLabel(chosenLabel)
                                  setPedagogicalAnalysisStudentName(s.student_name ?? null)
                                  setPedagogicalAnalysisCourseLabel(s.course_label ?? null)
                                  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
                                    console.info("[Estudiantes] Análisis pedagógico — abriendo modal", {
                                      studentId: s.id,
                                      studentName: s.student_name,
                                      evaluationsCount: evals.length,
                                      chosenEvalId: evalId,
                                      chosenLabel,
                                    })
                                  }
                                  toast({ title: "Abriendo análisis de la evaluación más reciente..." })
                                } catch {
                                  toast({ title: "No se pudo cargar el análisis del estudiante.", variant: "destructive" })
                                  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
                                    console.info("[Estudiantes] Análisis pedagógico — error", { studentId: s.id, studentName: s.student_name })
                                  }
                                } finally {
                                  setStudentPedagogicalLoadingId(null)
                                }
                              }}
                            >
                              {studentPedagogicalLoadingId === s.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <BookOpen className="mr-1 h-3.5 w-3.5" />
                              )}
                              Análisis pedagógico
                            </Button>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                setStudentHistoryId(s.id)
                                setStudentHistoryData(null)
                                setStudentHistoryError(null)
                                setStudentHistoryRaw(null)
                                setStudentHistoryLoading(true)
                                try {
                                  const r = await fetch(`/api/students/${s.id}/history`)
                                  const j = await r.json()
                                  setStudentHistoryRaw(j)
                                  if (r.ok) {
                                    setStudentHistoryData(j)
                                    setStudentHistoryError(null)
                                  } else {
                                    setStudentHistoryData(null)
                                    setStudentHistoryError("No se pudo cargar el perfil del estudiante")
                                  }
                                } catch {
                                  setStudentHistoryData(null)
                                  setStudentHistoryError("No se pudo cargar el perfil del estudiante")
                                  setStudentHistoryRaw(null)
                                } finally {
                                  setStudentHistoryLoading(false)
                                }
                              }}
                            >
                              Ver perfil
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            {INTERNAL_SUPPORT_UI && (
              <Card className="bg-[var(--bg-card)] border-[var(--border-color)] border-dashed">
                <CardHeader>
                  <CardTitle className="text-sm text-[var(--text-muted)]">Diagnóstico estudiantes</CardTitle>
                  <CardDescription>Panel interno: Último sync y lista actual.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">A) Último sync-student</h4>
                    {lastStudentSyncResult ? (
                      <pre className="text-xs bg-[var(--bg-muted)] p-3 rounded overflow-auto max-h-40">
                        {JSON.stringify(
                          {
                            evaluation_id: lastStudentSyncResult.evaluation_id,
                            received_student_name: lastStudentSyncResult.received_student_name,
                            normalized_student_name: lastStudentSyncResult.normalized_student_name,
                            student_profile_id: lastStudentSyncResult.student_profile_id,
                            created_or_existing: lastStudentSyncResult.created_or_existing,
                            message: lastStudentSyncResult.message,
                            ok: lastStudentSyncResult.ok,
                          },
                          null,
                          2
                        )}
                      </pre>
                    ) : (
                      <p className="text-xs text-[var(--text-muted)]">Aún no se ha llamado sync-student en esta sesión.</p>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">B) Resultado actual /api/students/list</h4>
                    <p className="text-xs text-[var(--text-muted)] mb-1">Total: {studentsList.length} estudiantes</p>
                    <pre className="text-xs bg-[var(--bg-muted)] p-3 rounded overflow-auto max-h-48">
                      {JSON.stringify(studentsList.slice(0, 10), null, 2)}
                    </pre>
                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setStudentsListFetchKey((k) => k + 1); loadStudentsList() }}>
                      Recargar estudiantes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {studentHistoryId && (
              <Dialog open={!!studentHistoryId} onOpenChange={(open) => { if (!open) { setStudentHistoryId(null); setStudentHistoryData(null); setStudentHistoryError(null); setStudentHistoryRaw(null); setShowDiagnosticoPerfil(false) } }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Perfil del estudiante</DialogTitle>
                  </DialogHeader>
                  {studentHistoryLoading ? (
                    <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</p>
                  ) : studentHistoryError ? (
                    <p className="text-sm text-red-600 dark:text-red-400">{studentHistoryError}</p>
                  ) : studentHistoryData ? (
                    <div className="space-y-6">
                      <div>
                        <p className="font-semibold text-[var(--text-accent)]">{studentHistoryData.student.student_name}</p>
                        <p className="text-sm text-[var(--text-muted)]">Curso: {studentHistoryData.student.course_label ?? "—"}</p>
                        <p className="text-sm">Promedio: {studentHistoryData.summary.average_grade != null ? studentHistoryData.summary.average_grade : "—"}</p>
                        <p className="text-sm text-[var(--text-muted)]">Total evaluaciones: {studentHistoryData.evaluations.length}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Evolución de notas</h4>
                        {studentHistoryData.evaluations.length > 0 ? (
                          <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart
                                data={studentHistoryData.evaluations.map((e) => ({ fecha: e.evaluated_at ? format(new Date(e.evaluated_at), "dd/MM/yy") : "—", nota: e.score != null ? Number(e.score) : null }))}
                                margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                                <YAxis domain={[0, 7]} tick={{ fontSize: 11 }} />
                                <Tooltip formatter={(v: number | undefined) => [v != null ? v.toFixed(1) : "—", "Nota"]} />
                                <Line type="monotone" dataKey="nota" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4 }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        ) : (
                          <p className="text-sm text-[var(--text-muted)]">Aún no hay evaluaciones suficientes.</p>
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Habilidades</h4>
                        {(Array.isArray(studentHistoryData.skills) ? studentHistoryData.skills : []).length > 0 ? (
                          <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={(studentHistoryData.skills ?? []).map((k) => ({ name: k.skill_name.length > 18 ? k.skill_name.slice(0, 18) + "…" : k.skill_name, accuracy: Math.round(k.accuracy * 100) }))}
                                layout="vertical"
                                margin={{ left: 8, right: 8 }}
                              >
                                <XAxis type="number" domain={[0, 100]} />
                                <YAxis type="category" dataKey="name" width={120} />
                                <Tooltip formatter={(v: number | undefined) => [`${v != null ? v : 0}%`, "Precisión"]} />
                                <Bar dataKey="accuracy" fill="var(--accent)" radius={[0, 4, 4, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        ) : (
                          <p className="text-sm text-[var(--text-muted)]">Aún no hay habilidades calculadas.</p>
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Evaluaciones</h4>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Fecha</TableHead>
                              <TableHead>Título</TableHead>
                              <TableHead>Asignatura</TableHead>
                              <TableHead>Nota</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {studentHistoryData.evaluations.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={4} className="text-sm text-[var(--text-muted)] text-center">Sin evaluaciones</TableCell>
                              </TableRow>
                            ) : (
                              studentHistoryData.evaluations.map((e) => (
                                <TableRow key={e.evaluation_id}>
                                  <TableCell className="text-sm">{e.evaluated_at ? format(new Date(e.evaluated_at), "dd/MM/yyyy") : "—"}</TableCell>
                                  <TableCell className="text-sm">{e.title ?? "(Sin título)"}</TableCell>
                                  <TableCell className="text-sm">{e.subject ?? "—"}</TableCell>
                                  <TableCell>{e.score != null ? Number(e.score) : "—"}</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Resumen</h4>
                        <p className="text-sm"><strong>Fortaleza:</strong> {studentHistoryData.summary.strongest_skill ?? "—"}</p>
                        <p className="text-sm"><strong>Área de mejora:</strong> {studentHistoryData.summary.weakest_skill ?? "—"}</p>
                      </div>
                      {PEDAGOGY_UI_ENABLED && (
                        <div>
                          <Button type="button" variant="outline" size="sm" onClick={() => setShowDiagnosticoPerfil((v) => !v)}>
                            Diagnóstico perfil
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => setShowRecomputeResult((v) => !v)}>
                            Ver resultado del recálculo
                          </Button>
                          {showDiagnosticoPerfil && studentHistoryRaw != null && (
                            <pre className="mt-2 text-xs bg-[var(--bg-muted)] p-3 rounded overflow-auto max-h-48 border border-[var(--border-color)]">
                              {JSON.stringify(studentHistoryRaw, null, 2)}
                            </pre>
                          )}
                          {showRecomputeResult && lastRecomputeResult != null && (
                            <pre className="mt-2 text-xs bg-[var(--bg-muted)] p-3 rounded overflow-auto max-h-48 border border-[var(--border-color)]">
                              {JSON.stringify(lastRecomputeResult, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setStudentHistoryId(null); setStudentHistoryData(null); setStudentHistoryError(null); setStudentHistoryRaw(null); setShowDiagnosticoPerfil(false) }}>Cerrar</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </TabsContent>
          <TabsContent value="mis-archivos" className="mt-4 space-y-4">
            <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
              <CardHeader>
                <CardTitle className="text-[var(--text-accent)]">Exportaciones ZIP de informes</CardTitle>
                <CardDescription>
                  Historial de lotes exportados. Puedes volver a generar el ZIP con los mismos datos actuales del lote (las evaluaciones deben seguir existiendo).
                </CardDescription>
                <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={() => setBatchExportsRefreshKey((k) => k + 1)}>
                  Recargar lista
                </Button>
              </CardHeader>
              <CardContent>
                {batchExportsLoading ? (
                  <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
                  </p>
                ) : batchExportsError ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{batchExportsError}</p>
                ) : batchExportsList.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">Aún no hay exportaciones registradas. Usa «Descarga completa (ZIP)» en el Evaluador o en Cursos cuando tengas un lote.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Archivo</TableHead>
                        <TableHead>Prueba / curso</TableHead>
                        <TableHead className="text-right">Informes</TableHead>
                        <TableHead className="text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batchExportsList.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {row.created_at ? format(new Date(row.created_at), "dd/MM/yyyy HH:mm") : "—"}
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] break-all">{row.zip_filename}</TableCell>
                          <TableCell className="text-sm">
                            <div>{row.exam_title ?? "—"}</div>
                            <div className="text-[var(--text-muted)]">{row.course_label ?? "—"}</div>
                          </TableCell>
                          <TableCell className="text-right">{row.evaluation_count}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setBatchZipHistoryExamTitle(row.exam_title)
                                setBatchZipHistoryCourseLabel(row.course_label)
                                setBatchZipTargetId(row.batch_id)
                                setBatchZipDialogOpen(true)
                              }}
                            >
                              <FileArchive className="h-3.5 w-3.5 mr-1 inline" />
                              Regenerar ZIP
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="pruebas-base" className="mt-4 space-y-4">
            <SourceExamsSection />
          </TabsContent>
          <TabsContent value="presentacion" className="mt-8">
            <Card className="max-w-4xl mx-auto border-2 shadow-xl bg-[var(--bg-card)] border-[var(--border-color)] p-10 text-center">
              <img
                src={LIBELIA_LOGO_PNG_BASE64 || "/placeholder.svg"}
                alt="Logo Libel-IA"
                className="mx-auto h-20 w-20 mb-6"
              />

              <h1 className={`text-5xl font-bold ${wordmarkClass} font-logo mb-4`}>Libel-IA</h1>
              <p className="text-lg text-[var(--text-secondary)] mb-6">
                Plataforma chilena de evaluación educativa con inteligencia artificial. Creada por un profesor, para
                profesores. Detecta respuestas, genera retroalimentación y entrega informes pedagógicos profesionales en
                segundos.
                <b>1 crédito = 1 imagen.</b>
              </p>
              <ul className="text-left space-y-2 mx-auto max-w-xl text-[var(--text-secondary)]">
                <li>✅ Análisis automático de pruebas (alternativas, desarrollo, V/F).</li>
                <li>✅ Retroalimentación detallada y notas en escala chilena.</li>
                <li>✅ Informes PDF listos para imprimir o enviar.</li>
                <li>✅ Compatible con múltiples cursos y asignaturas.</li>
              </ul>
              <div className="flex items-center justify-center gap-3 mt-8">
                <a
                  href="/planes"
                  className="inline-flex items-center rounded-xl bg-black text-white px-5 py-3 text-sm font-semibold hover:opacity-90"
                >
                  Empezar ahora (activar 10 gratis)
                </a>
                <Button size="lg" className="text-sm py-3 px-5" onClick={() => setActiveTab("evaluator")}>
                  Ir al Evaluador <Sparkles className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      {/* Informe de evaluación: fuera de TabsContent para que el portal no quede bajo un tab inactivo */}
      {evaluacionesDetailId && (
        <Dialog
          open={!!evaluacionesDetailId}
          onOpenChange={(open) => {
            if (!open) {
              setEvaluacionesDetailId(null)
              setEvaluacionesDetail(null)
              setEvaluacionesDetailError(null)
              setEvaluationStudents([])
              setEvaluacionesDetailItemsDraft(null)
            }
          }}
        >
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detalle de evaluación</DialogTitle>
            </DialogHeader>
            {evaluacionesDetailLoading ? (
              <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</p>
            ) : evaluacionesDetailError ? (
              <div className="space-y-3">
                <p className="text-sm text-red-600 dark:text-red-400">{evaluacionesDetailError}</p>
                {evaluacionesDetailError.includes("Completa tu perfil") && (
                  <Button variant="outline" size="sm" onClick={() => { setActiveTab("historial"); setEvaluacionesDetailId(null); setEvaluacionesDetail(null); setEvaluacionesDetailError(null); setEvaluationStudents([]) }}>
                    Completar perfil
                  </Button>
                )}
              </div>
            ) : evaluacionesDetail ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-[var(--text-accent)]">{(evaluacionesDetail.evaluation as { title?: string }).title ?? "(Sin título)"}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {(evaluacionesDetail.evaluation as { subject?: string }).subject && <span>Asignatura: {(evaluacionesDetail.evaluation as { subject: string }).subject}</span>}
                    {(evaluacionesDetail.evaluation as { course_label?: string; course_id?: string }).course_label || (evaluacionesDetail.evaluation as { course_id?: string }).course_id
                      ? <span> · Curso: {(evaluacionesDetail.evaluation as { course_label?: string; course_id?: string }).course_label ?? (evaluacionesDetail.evaluation as { course_id?: string }).course_id}</span>
                      : null}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{(evaluacionesDetail.evaluation as { evaluated_at?: string }).evaluated_at ? format(new Date((evaluacionesDetail.evaluation as { evaluated_at: string }).evaluated_at), "dd/MM/yyyy HH:mm") : ""}</p>
                  {Array.isArray((evaluacionesDetail.evaluation as { scan_image_signed_urls?: string[] }).scan_image_signed_urls) &&
                  (evaluacionesDetail.evaluation as { scan_image_signed_urls: string[] }).scan_image_signed_urls.length > 0 ? (
                    <div className="mt-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] p-2 space-y-2">
                      <p className="text-xs font-medium text-[var(--text-accent)]">Imágenes del escaneo móvil</p>
                      <div className="flex flex-wrap gap-2">
                        {(evaluacionesDetail.evaluation as { scan_image_signed_urls: string[] }).scan_image_signed_urls.map((url, i) => (
                          <a key={`dlg-${url}-${i}`} href={url} target="_blank" rel="noreferrer" className="block w-24 h-24 rounded border overflow-hidden">
                            <img src={url} alt="" className="w-full h-full object-cover" />
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">
                      Prueba base: {(evaluacionesDetail.evaluation as { source_exam_id?: string | null }).source_exam_id ? "asociada" : "pendiente"}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedSourceExamIdForAssociate("")
                        setSelectedCourseIdForBulk("")
                        setAssociateSourceExamOpen(true)
                        fetch("/api/source-exams", { credentials: "include" })
                          .then((r) => r.json())
                          .then((j) => { if (j.source_exams) setSourceExamsForAssociate(j.source_exams.map((e: { id: string; title?: string | null }) => ({ id: e.id, title: e.title ?? null }))) })
                          .catch(() => setSourceExamsForAssociate([]))
                        fetch("/api/courses/list", { credentials: "include" })
                          .then((r) => r.json())
                          .then((j) => { if (j.courses) setCoursesForBulkAssociate(j.courses.map((c: { course_id: string; total_evaluations: number }) => ({ course_id: c.course_id, total_evaluations: c.total_evaluations }))) })
                          .catch(() => setCoursesForBulkAssociate([]))
                      }}
                    >
                      <BookOpen className="h-3 w-3 mr-1" /> {(evaluacionesDetail.evaluation as { source_exam_id?: string | null }).source_exam_id ? "Cambiar prueba base" : "Asociar a prueba base"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!evaluacionesDetailId) return
                        const ev = evaluacionesDetail.evaluation as { title?: string | null; student_name?: string | null; course_id?: string | null; course_label?: string | null }
                        const studentName = ev.student_name && String(ev.student_name).trim() ? ev.student_name : null
                        setPedagogicalAnalysisEvalId(evaluacionesDetailId)
                        setPedagogicalAnalysisEvalLabel(
                          studentName ? (ev.title ? `${studentName} — ${ev.title}` : studentName) : (ev.title ?? null)
                        )
                        setPedagogicalAnalysisStudentName(studentName)
                        setPedagogicalAnalysisCourseLabel(ev.course_label ?? ev.course_id ?? null)
                      }}
                      title="Análisis pedagógico (prueba base)"
                    >
                      <BookOpen className="h-3 w-3 mr-1" /> Análisis pedagógico
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const ev = evaluacionesDetail.evaluation as { course_id?: string | null; course_label?: string | null }
                        const courseId = ev.course_id != null && String(ev.course_id).trim() !== "" ? String(ev.course_id).trim() : "Sin curso"
                        const courseLabel = ev.course_label ?? ev.course_id ?? courseId
                        openCoursePedagogicalSummary(courseId, courseLabel)
                      }}
                      title="Ver resumen pedagógico"
                    >
                      <FolderOpen className="h-3 w-3 mr-1" /> Ver resumen pedagógico
                    </Button>
                  </div>
                </div>
                {evaluacionesDetail.evaluation_summaries ? (
                  <div className="rounded border border-[var(--border-color)] p-3 text-sm">
                    <p><strong>Nota (Chile):</strong> {(evaluacionesDetail.evaluation_summaries as { grade_chile?: number }).grade_chile ?? "—"}</p>
                    {(evaluacionesDetail.evaluation_summaries as { strengths?: string }).strengths && <p><strong>Fortalezas:</strong> {(evaluacionesDetail.evaluation_summaries as { strengths: string }).strengths}</p>}
                    {(evaluacionesDetail.evaluation_summaries as { improvements?: string }).improvements && <p><strong>Áreas de mejora:</strong> {(evaluacionesDetail.evaluation_summaries as { improvements: string }).improvements}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">Aún no hay resumen disponible.</p>
                )}
                <div>
                  <h4 className="text-sm font-semibold text-[var(--text-accent)] mb-2">Estudiantes</h4>
                  {evaluationStudents.length > 0 ? (
                    <ul className="list-disc list-inside text-sm text-[var(--text-secondary)]">
                      {evaluationStudents.map((st, i) => (
                        <li key={i}>
                          {st?.student_name != null && String(st.student_name).trim() !== "" ? st.student_name : "—"}
                          {st?.created_at ? ` · ${format(new Date(st.created_at), "dd/MM/yyyy")}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">No hay estudiantes registrados para esta evaluación.</p>
                  )}
                </div>
                {Array.isArray(evaluacionesDetail.evaluation_items) && evaluacionesDetail.evaluation_items.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--text-accent)] mb-2">Preguntas</h4>
                    {evaluacionesDetailItemsDraft == null ? (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Pregunta</TableHead>
                              <TableHead>Respuesta</TableHead>
                              <TableHead>Correcta</TableHead>
                              <TableHead>Puntos</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(evaluacionesDetail.evaluation_items as Array<{ question_number?: number; student_answer?: string; correct_answer?: string; is_correct?: boolean; score_obtained?: number; score_max?: number }>).map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell>{item.question_number ?? idx + 1}</TableCell>
                                <TableCell>{item.student_answer ?? "—"}</TableCell>
                                <TableCell>{item.correct_answer ?? "—"}</TableCell>
                                <TableCell>{item.is_correct ? "Sí" : "No"}</TableCell>
                                <TableCell>{item.score_obtained != null ? `${item.score_obtained}/${item.score_max ?? ""}` : "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            const src = Array.isArray(evaluacionesDetail.evaluation_items) ? evaluacionesDetail.evaluation_items : []
                            const items = (src as Array<{ question_number?: number; student_answer?: string; correct_answer?: string; is_correct?: boolean; score_obtained?: number; score_max?: number }>).map((it) => ({
                              question_number: it.question_number ?? 0,
                              student_answer: it.student_answer ?? "",
                              correct_answer: it.correct_answer ?? "",
                              is_correct: it.is_correct ?? false,
                              score_obtained: it.score_obtained ?? 0,
                              score_max: it.score_max ?? 0,
                            }))
                            setEvaluacionesDetailItemsDraft(items)
                          }}
                        >
                          <Pencil className="h-3 w-3 mr-1" /> Editar respuestas
                        </Button>
                      </>
                    ) : (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Pregunta</TableHead>
                              <TableHead>Respuesta</TableHead>
                              <TableHead>Correcta</TableHead>
                              <TableHead>Puntos (obt/máx)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {evaluacionesDetailItemsDraft.map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell>{item.question_number}</TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm"
                                    value={item.student_answer ?? ""}
                                    onChange={(e) => {
                                      const next = [...evaluacionesDetailItemsDraft!]
                                      next[idx] = { ...next[idx], student_answer: e.target.value }
                                      const max = next[idx].score_max ?? 1
                                      if (max === 1) {
                                        next[idx].is_correct = (e.target.value?.trim().toUpperCase() === (next[idx].correct_answer ?? "").trim().toUpperCase())
                                        next[idx].score_obtained = next[idx].is_correct ? 1 : 0
                                      }
                                      setEvaluacionesDetailItemsDraft(next)
                                    }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm w-20"
                                    value={item.correct_answer ?? ""}
                                    onChange={(e) => {
                                      const next = [...evaluacionesDetailItemsDraft!]
                                      next[idx] = { ...next[idx], correct_answer: e.target.value }
                                      const max = next[idx].score_max ?? 1
                                      next[idx].is_correct = max === 1
                                        ? (e.target.value?.trim().toUpperCase() === (next[idx].student_answer ?? "").trim().toUpperCase())
                                        : next[idx].is_correct
                                      if (max === 1) next[idx].score_obtained = next[idx].is_correct ? 1 : 0
                                      setEvaluacionesDetailItemsDraft(next)
                                    }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number"
                                      min={0}
                                      className="h-8 w-14 text-sm"
                                      value={item.score_obtained ?? ""}
                                      onChange={(e) => {
                                        const next = [...evaluacionesDetailItemsDraft!]
                                        const v = e.target.value === "" ? undefined : Number(e.target.value)
                                        next[idx] = { ...next[idx], score_obtained: v }
                                        setEvaluacionesDetailItemsDraft(next)
                                      }}
                                    />
                                    <span>/</span>
                                    <Input
                                      type="number"
                                      min={0}
                                      className="h-8 w-14 text-sm"
                                      value={item.score_max ?? ""}
                                      onChange={(e) => {
                                        const next = [...evaluacionesDetailItemsDraft!]
                                        next[idx] = { ...next[idx], score_max: e.target.value === "" ? undefined : Number(e.target.value) }
                                        setEvaluacionesDetailItemsDraft(next)
                                      }}
                                    />
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <div className="flex gap-2 mt-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={evaluacionesDetailItemsSaving}
                            onClick={async () => {
                              if (!evaluacionesDetailId || !evaluacionesDetailItemsDraft) return
                              setEvaluacionesDetailItemsSaving(true)
                              try {
                                const r = await fetch(`/api/evaluations/${evaluacionesDetailId}/items`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  credentials: "include",
                                  body: JSON.stringify({
                                    items: evaluacionesDetailItemsDraft.map((it) => ({
                                      question_number: it.question_number,
                                      student_answer: it.student_answer ?? "",
                                      correct_answer: it.correct_answer ?? "",
                                      is_correct: it.is_correct,
                                      score_obtained: it.score_obtained,
                                      score_max: it.score_max,
                                    })),
                                  }),
                                })
                                const j = await r.json().catch(() => ({}))
                                if (r.ok && j.ok) {
                                  toast({ title: "Cambios guardados. Nota y datos derivados actualizados." })
                                  await refetchEvaluacionDetail()
                                  loadEvaluationsList()
                                  loadStudentsList()
                                  await refetchStudentProfileIfOpen()
                                  await refetchCourseDiagnosisIfOpen()
                                  setEvaluacionesDetailItemsDraft(null)
                                } else {
                                  toast({ title: j.error || "Error al guardar", variant: "destructive" })
                                }
                              } catch {
                                toast({ title: "Error al guardar cambios", variant: "destructive" })
                              } finally {
                                setEvaluacionesDetailItemsSaving(false)
                              }
                            }}
                          >
                            {evaluacionesDetailItemsSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                            Guardar cambios
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEvaluacionesDetailItemsDraft(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">Aún no hay preguntas registradas.</p>
                )}
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEvaluacionesDetailId(null); setEvaluacionesDetail(null); setEvaluacionesDetailError(null); setEvaluationStudents([]) }}>Cerrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {studentsModalEvalId && (
        <Dialog
          open={!!studentsModalEvalId}
          onOpenChange={(open) => {
            if (!open) {
              setStudentsModalEvalId(null)
              setStudentsModalList([])
              setStudentsModalSearch("")
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Estudiantes</DialogTitle>
            </DialogHeader>
            <Input
              placeholder="Buscar por nombre..."
              value={studentsModalSearch}
              onChange={(e) => setStudentsModalSearch(e.target.value)}
              className="mb-3"
            />
            {studentsModalLoading ? (
              <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
              </p>
            ) : studentsModalList.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Sin estudiantes registrados.</p>
            ) : (
              <ul className="max-h-60 overflow-y-auto space-y-1 text-sm mb-4">
                {studentsModalList
                  .filter(
                    (s) =>
                      !studentsModalSearch.trim() ||
                      (s.student_name || "").toLowerCase().includes(studentsModalSearch.trim().toLowerCase())
                  )
                  .map((s, i) => (
                    <li key={i}>{s.student_name || "—"}</li>
                  ))}
              </ul>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const evalId = studentsModalEvalId
                if (!evalId) return
                setStudentsModalEvalId(null)
                setStudentsModalList([])
                void openEvaluationInforme(evalId, informeHintFromListId(evalId))
              }}
            >
              Abrir informe
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {/* Modales de análisis pedagógico y resumen de curso: fuera de TabsContent para que abran desde cualquier pestaña (Estudiantes, Evaluaciones, Cursos). */}
      <BatchPedagogicalZipDialog
        open={batchZipDialogOpen}
        onOpenChange={(o) => {
          setBatchZipDialogOpen(o)
          if (!o) {
            setBatchZipTargetId(null)
            setBatchZipHistoryExamTitle(null)
            setBatchZipHistoryCourseLabel(null)
          }
        }}
        batchId={batchZipTargetId}
        suggestedExamTitle={form.watch("nombrePrueba")}
        suggestedCourseLabel={form.watch("curso")}
        historyExamTitle={batchZipHistoryExamTitle}
        historyCourseLabel={batchZipHistoryCourseLabel}
        onRecorded={() => setBatchExportsRefreshKey((k) => k + 1)}
      />
      <PedagogicalAnalysisModal
        evaluationId={pedagogicalAnalysisEvalId}
        evaluationLabel={pedagogicalAnalysisEvalLabel}
        studentName={pedagogicalAnalysisStudentName}
        courseLabel={pedagogicalAnalysisCourseLabel}
        open={!!pedagogicalAnalysisEvalId}
        onOpenChange={(open) => {
          if (!open) {
            setPedagogicalAnalysisEvalId(null)
            setPedagogicalAnalysisEvalLabel(null)
            setPedagogicalAnalysisStudentName(null)
            setPedagogicalAnalysisCourseLabel(null)
          }
        }}
      />
      <CoursePedagogicalSummaryModal
        courseId={coursePedagogicalSummaryId}
        courseLabel={coursePedagogicalSummaryLabel}
        open={coursePedagogicalSummaryOpen}
        onOpenChange={(open) => {
          setCoursePedagogicalSummaryOpen(open)
          if (!open) {
            setCoursePedagogicalSummaryId(null)
            setCoursePedagogicalSummaryLabel(null)
          }
        }}
      />
      </main>
      
      {/* Modal para subir plantilla de respuestas del profesor */}
      <AnswerKeyUploadModal
        isOpen={isAnswerKeyModalOpen}
        onClose={() => setIsAnswerKeyModalOpen(false)}
        onConfirm={(data) => {
          saveAnswerKey(data)
          // Actualizar el campo del formulario con la pauta generada
          form.setValue("pautaCorrectaAlternativas", answerKeyToPauta(data))
          setIsAnswerKeyModalOpen(false)
        }}
      />
      {INTERNAL_SUPPORT_UI ? <DevAdminPanel /> : null}
    </EvaluatorRootDiv>
  )
}
