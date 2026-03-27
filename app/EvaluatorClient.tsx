// EvaluatorClient.tsx - Cliente principal del evaluador (porcentajes, pautas, OMR)
"use client"
import * as React from "react"
import { useState, useRef, type ChangeEvent, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import dynamic from "next/dynamic"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { format } from "date-fns"
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
} from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import NotesDashboard from "@/app/components/NotesDashboard"
import SourceExamsSection from "@/app/components/SourceExamsSection"
import PedagogicalAnalysisModal from "@/app/components/PedagogicalAnalysisModal"
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
import OMRPreviewModal from "@/app/components/OMRPreviewModal"
import AnswerKeyUploadModal from "../components/AnswerKeyUploadModal"
import { RealtimeOMRModal } from "@/app/components/RealtimeOMRModal"
import { TemplateOverlayOMRModal } from "@/app/components/TemplateOverlayOMRModal"
import { OMRSheetGeneratorModal } from "@/app/components/OMRSheetGeneratorModal"
import { RobustLibeliaOMRModal } from "@/app/components/RobustLibeliaOMRModal"
import ClosedAnswerOMRModal from "@/app/components/ClosedAnswerOMRModal"
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
// ==== Estilos PDF ====
const styles = StyleSheet.create({
  page: { padding: 20, fontSize: 10, lineHeight: 1.25 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  headerRight: { textAlign: "right" },
  logoLibelia: { height: 30, width: 30, marginRight: 8, objectFit: "contain" },
  logoColegio: { maxHeight: 30, maxWidth: 110, objectFit: "contain" },
  title: { fontSize: 13, fontWeight: "bold", color: "#4F46E5" },
  subtitle: { fontSize: 9, color: "#6B7280" },
  infoText: { fontSize: 9, color: "#4B5563", marginVertical: 1 },
  studentLine: { fontSize: 9, color: "#111827", marginTop: 5 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: "bold",
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    marginBottom: 5,
    marginTop: 8,
  },
  feedbackGrid: { flexDirection: "row", gap: 8, marginTop: 8 },
  feedbackCard: { padding: 6, borderRadius: 6, flex: 1 },
  fortalezas: { backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0" },
  areasMejora: { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A" },
  feedbackTitle: { fontSize: 9, fontWeight: "bold", color: "#166534", marginBottom: 3 },
  feedbackImproveTitle: { fontSize: 9, fontWeight: "bold", color: "#854D0E", marginBottom: 3 },
  feedbackText: { fontSize: 8, lineHeight: 1.15, flexWrap: "wrap" as any },
  table: { width: "100%", borderStyle: "solid", borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 6 },
  tableRow: { margin: "auto", flexDirection: "row", borderBottomWidth: 1, borderColor: "#E5E7EB" },
  tableColHeader: {
    width: "35%",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    padding: 2,
  },
  tableColHeaderDetail: {
    width: "65%",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    padding: 2,
  },
  tableCol: { width: "35%", borderStyle: "solid", borderWidth: 1, borderColor: "#E5E7EB", padding: 2 },
  tableColDetail: { width: "65%", borderStyle: "solid", borderWidth: 1, borderColor: "#E5E7EB", padding: 2 },
  col40: { width: "40%", borderStyle: "solid", borderWidth: 1, borderColor: "#E5E7EB", padding: 2 },
  col30: { width: "30%", borderStyle: "solid", borderWidth: 1, borderColor: "#E5E7EB", padding: 2 },
  habCol45: { width: "45%", borderStyle: "solid", borderWidth: 1, borderColor: "#E5E7EB", padding: 2 },
  habCol18: {
    width: "18%",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 2,
    textAlign: "center" as any,
  },
  habCol37: { width: "37%", borderStyle: "solid", borderWidth: 1, borderColor: "#E5E7EB", padding: 2 },
  tableCellHeader: { margin: 1, fontSize: 8, fontWeight: "bold" },
  tableCell: { margin: 1, fontSize: 8, textAlign: "left" as any },
})
// ----------------- Helpers safe render -----------------
function renderForWeb(value: any): string {
  if (value === null || value === undefined) return ""
  const t = typeof value
  if (t === "string" || t === "number" || t === "boolean") return String(value)
  if (Array.isArray(value)) {
    return value.map(v => renderForWeb(v)).join(", ")
  }
  try {
    if (typeof value === "object" && value !== null) {
      // Manejar objetos con estructura conocida
      if (value.cita_estudiante && value.justificacion) {
        return `Puntaje: ${value.puntaje || "N/A"} - Respuesta: "${value.cita_estudiante}" - ${value.justificacion}`
      }
      if (value.area && value.detalles) {
        return `${value.area}: ${renderForWeb(value.detalles)}`
      }
      if (value.descripcion) return String(value.descripcion)
      if (value.detalle) return String(value.detalle)
      if (value.detalles) return String(value.detalles)
      if (value.texto) return String(value.texto)
      if (value.seccion) return `${value.seccion}: ${renderForWeb(value.detalle || value.detalles || "")}`
      if (value.mensaje) return String(value.mensaje)
      // Ultimo recurso: convertir entries a string
      const entries = Object.entries(value)
      if (entries.length > 0) {
        return entries.map(([k, v]) => `${k}: ${renderForWeb(v)}`).join("; ")
      }
    }
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
function pdfSafe(value: any): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    if (Array.isArray(value)) {
      const arr = value as any[]
      if (arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null && ("aspecto" in arr[0] || "detalle" in arr[0])) {
        return arr.map((x: any) => `• ${x.aspecto ?? x.seccion ?? "Item"}: ${x.detalle ?? x.detalles ?? ""}`).join("\n")
      }
      return arr.map((v) => pdfSafe(v)).join(", ")
    }
    if (typeof value === "object" && value !== null && value.cita_estudiante && value.justificacion) {
      return `Puntaje: ${pdfSafe(value.puntaje)}
Respuesta Estudiante: "${value.cita_estudiante}"
Justificación: ${value.justificacion}`
    }
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
/** Convierte cualquier valor a string para evitar [object Object] en PDF/UI. */
function safeStr(value: any): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}
const splitCorreccionForTwoPages = (lista: any[] | undefined) => {
  if (!lista || lista.length === 0) return { first: [], rest: [] }
  const MAX_P1 = Math.min(5, lista.length)
  return { first: lista.slice(0, MAX_P1), rest: lista.slice(MAX_P1) }
}

/** PDF desarrollo: solo texto legible; nunca JSON.stringify. */
function formatDetalleDesarrolloPdf(raw: any): string {
  if (raw == null) return ""
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return String(raw)
  if (Array.isArray(raw)) return raw.map((x) => formatDetalleDesarrolloPdf(x)).filter(Boolean).join(" — ")
  if (typeof raw !== "object") return String(raw)
  const o = raw as Record<string, unknown>
  const pVal = o.puntaje
  const p =
    pVal != null && String(pVal).trim() !== ""
      ? `Puntaje: ${String(pVal).trim()}`
      : ""
  const txtSource = (o.cita_estudiante ?? o.texto_estudiante ?? o.respuesta ?? o.respuesta_estudiante) as unknown
  const txt = txtSource != null ? String(txtSource).trim() : ""
  const txtPart = txt ? `Respuesta: "${txt.replace(/"/g, "'")}"` : ""
  const jVal = o.justificacion
  const j = jVal != null ? String(jVal).trim() : ""
  const jPart = j ? `Justificación: ${j}` : ""
  const main = [p, txtPart, jPart].filter(Boolean).join("\n")
  if (main) return main
  const fallback = Object.entries(o)
    .filter(([, v]) => v != null && typeof v !== "object" && typeof v !== "function")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" — ")
  return fallback || "(Sin detalle estructurado disponible)"
}

function normalizePdfMatchText(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

function extractDevQuestionNumbersFromKeys(devKeys: string[]): Set<number> {
  const nums = new Set<number>()
  for (const key of devKeys) {
    const m = /^P\s*(\d+)$/i.exec(key.trim())
    if (m) nums.add(parseInt(m[1], 10))
  }
  return nums
}

function buildDetalleDesarrolloMatchCorpus(detalleDesarrollo: Record<string, any> | undefined): string {
  if (!detalleDesarrollo || typeof detalleDesarrollo !== "object") return ""
  const parts: string[] = []
  for (const v of Object.values(detalleDesarrollo)) {
    if (v == null) continue
    if (typeof v === "object" && !Array.isArray(v)) {
      parts.push(String((v as any).justificacion ?? ""))
      parts.push(String((v as any).cita_estudiante ?? (v as any).texto_estudiante ?? (v as any).respuesta ?? ""))
    } else {
      parts.push(String(v))
    }
  }
  return normalizePdfMatchText(parts.join("\n"))
}

function textoMencionaNumerosDesarrollo(texto: string, nums: Set<number>): boolean {
  const t = normalizePdfMatchText(texto)
  if (!t) return false
  for (const n of nums) {
    if (new RegExp(`\\bp\\s*${n}\\b`, "i").test(t)) return true
    if (new RegExp(`pregunta\\s*[:-]?\\s*${n}\\b`, "i").test(t)) return true
  }
  return false
}

function seccionRelatesToDetalleDesarrolloKeys(seccion: string, devKeys: string[]): boolean {
  if (!devKeys.length) return false
  const s = String(seccion || "")
  const upper = s.toUpperCase()
  for (const key of devKeys) {
    const k = key.trim()
    if (!k) continue
    const ku = k.toUpperCase()
    const kSpaced = k.replace(/_/g, " ").toUpperCase()
    if (upper.includes(ku) || upper.includes(kSpaced)) return true
    const num = /^P(\d+)$/i.exec(k)?.[1]
    if (num && new RegExp(`\\bP\\s*${num}\\b`, "i").test(s)) return true
  }
  return false
}

/**
 * PDF: si hay detalle_desarrollo, no mostrar en correccion_detallada ninguna fila del "mundo desarrollo"
 * (misma pregunta por número, subtítulos repetidos en justificación, cita solapada, etc.).
 */
function excludeCorreccionDetalladaRowForPdfDesarrollo(
  row: any,
  devKeys: string[],
  detalleDesarrollo: Record<string, any> | undefined,
): boolean {
  if (!devKeys.length) return false
  const seccion = String(row?.seccion ?? "")
  const detalleRow = String(row?.detalle ?? row?.detalles ?? "")
  const nums = extractDevQuestionNumbersFromKeys(devKeys)
  const corpus = buildDetalleDesarrolloMatchCorpus(detalleDesarrollo)
  const secNorm = normalizePdfMatchText(seccion)
  const detNorm = normalizePdfMatchText(detalleRow)

  if (seccionRelatesToDetalleDesarrolloKeys(seccion, devKeys)) return true
  if (/pregunta\s+desarrollo/i.test(seccion)) return true
  if (/\bdesarrollo\b/i.test(seccion) && /\bpregunta\b/i.test(seccion)) return true

  for (const n of nums) {
    if (new RegExp(`pregunta\\s*[:-]?\\s*${n}\\b`, "i").test(seccion)) return true
  }

  if (secNorm.length >= 10 && corpus.length >= 24 && corpus.includes(secNorm)) return true
  if (detNorm.length >= 28 && corpus.length >= 24 && corpus.includes(detNorm)) return true

  if (textoMencionaNumerosDesarrollo(seccion, nums)) return true
  if (textoMencionaNumerosDesarrollo(detalleRow, nums)) return true

  if (detNorm.length >= 22 && detalleDesarrollo && typeof detalleDesarrollo === "object") {
    for (const v of Object.values(detalleDesarrollo)) {
      if (!v || typeof v !== "object") continue
      const cite = normalizePdfMatchText(
        String((v as any).cita_estudiante ?? (v as any).texto_estudiante ?? (v as any).respuesta ?? ""),
      )
      if (cite.length < 18) continue
      const head = cite.slice(0, 44)
      if (head.length >= 18 && detNorm.includes(head)) return true
      const headRow = detNorm.slice(0, 44)
      if (headRow.length >= 18 && cite.includes(headRow)) return true
    }
  }

  return false
}

const ReportDocument = ({ group, formData, logoPreview }: any) => {
  const resumen = (group.retroalimentacion && group.retroalimentacion.resumen_general) || {
    fortalezas: "N/A",
    areas_mejora: "N/A",
  }
  const puntaje = group.puntaje || "N/A"
  const notaNum = Number(group.nota) || 0
  const notaFinal = (notaNum + (group.decimasAdicionales || 0)).toFixed(1)
  const correccion = group.retroalimentacion?.correccion_detallada || []
  const devKeys = Object.keys(group.detalle_desarrollo || {})
  const correccionSinDuplicarDesarrollo = correccion.filter(
    (row: any) => !excludeCorreccionDetalladaRowForPdfDesarrollo(row, devKeys, group.detalle_desarrollo),
  )
  const correccionDesarrolloArray = devKeys.map((key) => {
    const raw = group.detalle_desarrollo![key]
    const detalle =
      typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : formatDetalleDesarrolloPdf(raw)
    return {
      seccion: `Pregunta Desarrollo: ${key.replace(/_/g, " ")}`,
      detalle,
    }
  })
  const correccionConDesarrollo = [...correccionSinDuplicarDesarrollo, ...correccionDesarrolloArray]
  const { first: correccionP1, rest: correccionP2 } = splitCorreccionForTwoPages(correccionConDesarrollo)
  const isSuperior = ["Técnico Superior", "Universitario", "Postgrado"].includes(formData.nivelEducativo)
  const cursoLabel = isSuperior ? "Sección" : "Curso"
  const departamentoLabel = isSuperior ? "Escuela/Carrera" : "Departamento"

  // 🔥 INICIO - LÓGICA DEL VELOCÍMETRO PARA PDF
  const puntosAprobacion = group.puntosAprobacion || 0
  const puntajeMaximo = group.puntosMaximos || Number(group.puntaje?.split("/")[1]) || 0
  const puntajeObtenido = Number(group.puntaje?.split("/")[0]) || 0
  // Cálculo de porcentajes para el PDF
  const porcentajeObtenido = Math.min(100, (puntajeObtenido / puntajeMaximo) * 100)
  const porcentajeAprobacion = (puntosAprobacion / puntajeMaximo) * 100
  const isAprobado = puntajeObtenido >= puntosAprobacion
  // 🔥 FIN - LÓGICA DEL VELOCÍMETRO PARA PDF

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PDFImage src={LIBELIA_LOGO_PNG_BASE64} style={styles.logoLibelia} />
            <View>
              <Text style={styles.title}>Libel-IA</Text>
              <Text style={styles.subtitle}>Informe de Evaluación Pedagógica</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            {logoPreview && <PDFImage src={logoPreview} style={styles.logoColegio} />}
            <Text style={styles.infoText}>Profesor: {pdfSafe(formData.nombreProfesor || "N/A")}</Text>
            <Text style={styles.infoText}>Asignatura: {pdfSafe(formData.asignatura || "N/A")}</Text>
            <Text style={styles.infoText}>
              {departamentoLabel}: {pdfSafe(formData.departamento || "N/A")}
            </Text>

            <Text style={styles.infoText}>Evaluación: {pdfSafe(formData.nombrePrueba || "N/A")}</Text>
            <Text style={styles.infoText}>Fecha: {pdfSafe(format(new Date(), "dd/MM/yyyy"))}</Text>
          </View>
        </View>
        <Text style={styles.studentLine}>
          Alumno: {pdfSafe(group.studentName)} · {cursoLabel}: {pdfSafe(formData.curso || "N/A")}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: "#F9FAFB",
              borderWidth: 1,
              borderColor: "#E5E7EB",
              padding: 5,
              borderRadius: 6,
              textAlign: "center" as any,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: "bold", color: "#4B5563", marginBottom: 2 }}>Puntaje</Text>
            <Text style={{ fontSize: 11, fontWeight: "bold", color: "#4F46E5" }}>{pdfSafe(puntaje)}</Text>
          </View>

          <View
            style={{
              flex: 1,
              backgroundColor: "#F9FAFB",
              borderWidth: 1,
              borderColor: "#E5E7EB",
              padding: 5,
              borderRadius: 6,
              textAlign: "center" as any,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: "bold", color: "#4B5563", marginBottom: 2 }}>Nota</Text>
            <Text style={{ fontSize: 11, fontWeight: "bold", color: "#4F46E5" }}>{pdfSafe(notaFinal)}</Text>
          </View>
          <View
            style={{
              flex: 1,
              backgroundColor: "#F9FAFB",
              borderWidth: 1,
              borderColor: "#E5E7EB",
              padding: 5,
              borderRadius: 6,
              textAlign: "center" as any,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: "bold", color: "#4B5563", marginBottom: 2 }}>Fecha</Text>
            <Text style={{ fontSize: 11, fontWeight: "bold", color: "#4F46E5" }}>
              {pdfSafe(format(new Date(), "dd/MM/yyyy"))}
            </Text>
          </View>
        </View>

        {/* 🔥 BLOQUE DE VELOCÍMETRO EN PDF (AGREGADO) */}
        {puntajeMaximo > 0 && puntosAprobacion > 0 && (
          <View
            style={{
              marginTop: 8,
              padding: 5,
              backgroundColor: "#F9FAFB",
              borderWidth: 1,
              borderColor: "#E5E7EB",
              borderRadius: 6,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: "bold", color: "#4B5563", marginBottom: 4 }}>
              📊 Rendimiento vs. Exigencia ({formData.porcentajeExigencia}%)
            </Text>
            <View
              style={{ height: 6, width: "100%", backgroundColor: "#E5E7EB", borderRadius: 3, position: "relative" }}
            >
              {/* Barra de progreso obtenida */}
              <View
                style={{
                  width: `${porcentajeObtenido}%`,
                  height: "100%",
                  backgroundColor: isAprobado ? "#34D399" : "#EF4444", // Verde/Rojo para Aprobado/Reprobado
                  borderRadius: 3,
                }}
              />
              {/* Marcador de Nota 4.0 */}
              <View
                style={{
                  position: "absolute",
                  top: -5,
                  left: `${porcentajeAprobacion}%`,
                  width: 1.5,
                  height: 16,
                  backgroundColor: "#F59E0B", // Amarillo/Naranja
                  transform: "translateX(-50%)",
                }}
              >
                <Text
                  style={{
                    fontSize: 7,
                    color: "#374151",
                    position: "absolute",
                    top: -10,
                    left: -5,
                    fontWeight: "bold",
                  }}
                >
                  4.0
                </Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                fontSize: 7,
                color: "#6B7280",
                marginTop: 4,
              }}
            >
              <Text>0 pts</Text>
              <Text>{puntajeMaximo} pts (100%)</Text>
            </View>
            <Text style={{ fontSize: 8, fontWeight: "bold", color: "#4B5563", marginTop: 4 }}>
              Puntos de Aprobación (4.0): <Text style={{ color: "#F59E0B" }}>{puntosAprobacion} pts</Text>
            </Text>
          </View>
        )}
        {/* FIN - BLOQUE DE VELOCÍMETRO EN PDF */}

        <View style={styles.feedbackGrid}>
          <View
            style={{
              padding: 6,
              borderRadius: 6,
              flex: 1,
              backgroundColor: "#F0FDF4",
              borderWidth: 1,
              borderColor: "#BBF7D0",
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: "bold", color: "#166534", marginBottom: 3 }}>
              ✅ <Text>Fortalezas</Text>
            </Text>
            <Text style={styles.feedbackText}>{pdfSafe(resumen.fortalezas)}</Text>
          </View>
          <View
            style={{
              padding: 6,
              borderRadius: 6,
              flex: 1,
              backgroundColor: "#FFFBEB",
              borderWidth: 1,
              borderColor: "#FDE68A",
            }}
          >
            <Text style={styles.feedbackImproveTitle}>
              ✏️
              <Text>Áreas de Mejora</Text>
            </Text>
            <Text style={styles.feedbackText}>{pdfSafe(resumen.areas_mejora)}</Text>
          </View>
        </View>
        {correccionP1.length > 0 && (
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.sectionTitle}>Corrección Detallada</Text>

            <View style={styles.table}>
              <View style={[styles.tableRow, { backgroundColor: "#F9FAFB" }]}>
                <View style={styles.tableColHeader}>
                  <Text style={styles.tableCellHeader}>Sección</Text>
                </View>
                <View style={styles.tableColHeaderDetail}>
                  <Text style={styles.tableCellHeader}>Detalle</Text>
                </View>
              </View>
              {correccionP1.map((item: any, index: number) => (
                <View key={String(index)} style={styles.tableRow}>
                  <View style={styles.tableCol}>
                    <Text style={styles.tableCell}>{pdfSafe(item.seccion)}</Text>
                  </View>
                  <View style={styles.tableColDetail}>
                    <Text style={styles.tableCell}>{pdfSafe(item.detalle)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
        {correccionP2.length > 0 && (
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.sectionTitle}>Corrección Detallada (cont.)</Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, { backgroundColor: "#F9FAFB" }]}>
                <View style={styles.tableColHeader}>
                  <Text style={styles.tableCellHeader}>Sección</Text>
                </View>
                <View style={styles.tableColHeaderDetail}>
                  <Text style={styles.tableCellHeader}>Detalle</Text>
                </View>
              </View>
              {correccionP2.map((item: any, index: number) => (
                <View key={String(index)} style={styles.tableRow}>
                  <View style={styles.tableCol}>
                    <Text style={styles.tableCell}>{pdfSafe(item.seccion)}</Text>
                  </View>
                  <View style={styles.tableColDetail}>
                    <Text style={styles.tableCell}>{pdfSafe(item.detalle)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
        {group.retroalimentacion?.evaluacion_habilidades?.length > 0 && (
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.sectionTitle}>Evaluación de Habilidades</Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, { backgroundColor: "#F9FAFB" }]}>
                <View style={styles.habCol45}>
                  <Text style={styles.tableCellHeader}>Habilidad</Text>
                </View>

                <View style={styles.habCol18}>
                  <Text style={styles.tableCellHeader}>Nivel</Text>
                </View>
                <View style={styles.habCol37}>
                  <Text style={styles.tableCellHeader}>Evidencia</Text>
                </View>
              </View>
              {group.retroalimentacion.evaluacion_habilidades.map((item: any, index: number) => (
                <View key={String(index)} style={styles.tableRow}>
                  <View style={styles.habCol45}>
                    <Text style={styles.tableCell}>{pdfSafe(item.habilidad)}</Text>
                  </View>

                  <View style={styles.habCol18}>
                    <Text style={styles.tableCell}>{pdfSafe(item.evaluacion)}</Text>
                  </View>
                  <View style={styles.habCol37}>
                    <Text style={styles.tableCell}>{pdfSafe(item.evidencia)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {group.retroalimentacion?.retroalimentacion_alternativas?.length > 0 && (
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.sectionTitle}>Respuestas Alternativas</Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, { backgroundColor: "#F9FAFB" }]}>
                <View style={styles.col40}>
                  <Text style={styles.tableCellHeader}>Pregunta</Text>
                </View>
                <View style={styles.col30}>
                  <Text style={styles.tableCellHeader}>Respuesta Estudiante</Text>
                </View>
                <View style={styles.col30}>
                  <Text style={styles.tableCellHeader}>Respuesta Correcta</Text>
                </View>
              </View>
              {group.retroalimentacion.retroalimentacion_alternativas.map((item: any, index: number) => (
                <View key={String(index)} style={styles.tableRow}>
                  <View style={styles.col40}>
                    <Text style={styles.tableCell}>{pdfSafe(item.pregunta)}</Text>
                  </View>
                  <View style={styles.col30}>
                    <Text style={styles.tableCell}>{pdfSafe(item.respuesta_estudiante)}</Text>
                  </View>
                  <View style={styles.col30}>
                    <Text style={styles.tableCell}>{pdfSafe(item.respuesta_correcta)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </Page>
    </Document>
  )
}

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
const formSchema = z.object({
  tipoEvaluacion: z.string().default("prueba"),
  // ✅ PUNTUACIÓN CRÍTICA: Rúbrica y puntaje total se mantienen
  rubrica: z.string().min(10, "La rúbrica es necesaria."),
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
  // NUEVOS CAMPOS DE CONTROL
  porcentajeExigencia: z
    .string()
    .min(1, "La exigencia es obligatoria.")
    .regex(/^[0-9]+$/, "Debe ser un número."),
  // 🟢 CRÍTICO: Pauta Estructurada OBLIGATORIA para la suma del backend
  pautaEstructurada: z.string().min(5, "La pauta de puntajes es obligatoria para rigor."),
  // 🔥 CRÍTICO: Campo para la pauta de alternativas.
  pautaCorrectaAlternativas: z.string().optional(),
  // Tipo de prueba: mixta (alternativas + desarrollo), solo_desarrollo, solo_alternativas
  tipoPrueba: z.enum(["mixta", "solo_desarrollo", "solo_alternativas"]).default("mixta"),
})
interface FilePreview {
  id: string
  file: File
  previewUrl: string
  dataUrl: string
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
  /** Id de la evaluación en BD cuando ya fue guardada; permite aplicar cambios de la tabla al resto de la app */
  evaluation_id?: string | null
  shouldUseOfficialAzureOmr?: boolean
  officialOmrActivationReason?: string
  officialOmrIntegrationEnabled?: boolean
  officialOmrEngineSelected?: string
  officialOmrEngineUsed?: string
  officialOmrFallbackUsed?: boolean
  officialOmrFallbackReason?: string | null
  omrDebug?: any
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

export default function EvaluatorClient() {
  const enablePedagogy = process.env.NEXT_PUBLIC_ENABLE_PEDAGOGY === "true"
  const [activeTab, setActiveTab] = useState("presentacion")
  const [userEmail, setUserEmail] = useState<string>("")
  const [unassignedFiles, setUnassignedFiles] = useState<FilePreview[]>([])
  const [studentGroups, setStudentGroups] = useState<StudentGroup[]>([])
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
  // Progreso de evaluacion por lotes

  /** Cuenta incorrectas y a revisar desde alternativas_corregidas (misma lógica que la tabla OMR; solo lectura). */
  const countAlternativasSummary = (alts: Array<{ pregunta?: string; respuesta_estudiante?: string; respuesta_correcta?: string }> | undefined) => {
    if (!alts?.length) return { incorrect: 0, revisar: 0 }
    let incorrect = 0
    let revisar = 0
    for (const item of alts) {
      const respuestaEst = (item.respuesta_estudiante ?? "").trim().toUpperCase()
      const respuestaCorr = (item.respuesta_correcta ?? "").trim().toUpperCase()
      const esIncorrecta = Boolean(respuestaEst && respuestaCorr && respuestaEst !== respuestaCorr)
      const tieneBajaConfianza =
        respuestaEst.length > 2 ||
        (String(item.pregunta ?? "").includes("VF") && !["V", "F"].includes(respuestaEst)) ||
        (String(item.pregunta ?? "").includes("TP") && isNaN(Number.parseInt(respuestaEst))) ||
        (String(item.pregunta ?? "").includes("SM") && !["A", "B", "C", "D", "E"].includes(respuestaEst)) ||
        respuestaEst === ""
      if (esIncorrecta) incorrect++
      if (esIncorrecta || tieneBajaConfianza) revisar++
    }
    return { incorrect, revisar }
  }
  const batchInitial = { isActive: false, totalItems: 0, completedItems: 0, successCount: 0, errorCount: 0, currentBatch: 0, totalBatches: 0 }
  const [batchProgress, setBatchProgress] = useState(batchInitial)
  const isMobile = typeof window !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
const { evaluate, isLoading, answerKey, saveAnswerKey, clearAnswerKey, answerKeyToPauta } = useEvaluator()
  const { toast } = useToast()

  // Estado para el modal de plantilla de respuestas del profesor
  const [isAnswerKeyModalOpen, setIsAnswerKeyModalOpen] = useState(false)
  // Sesión MVP: persistencia Supabase (solo perfil desde API; sin localStorage para teacher_id)
  const [mainProfile, setMainProfile] = useState<{ profile: { teacher_id: string | null; school_id: string | null } | null; user: { id: string; email: string | null } | null } | null>(null)
  const [showOnboardingModal, setShowOnboardingModal] = useState(false)
  const [onboardingForm, setOnboardingForm] = useState({ teacher_name: "", school_name: "", department: "" })
  const [onboardingSaving, setOnboardingSaving] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [onboardRefreshFailed, setOnboardRefreshFailed] = useState(false)
  const [hasSessionTeacher, setHasSessionTeacher] = useState(false)
  // Historial (Fase 2A): perfil y evaluaciones del usuario logueado
  const [historialProfile, setHistorialProfile] = useState<{ profile: { teacher_id: string } | null; user: { id: string; email: string | null } | null } | null>(null)
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
  /** Solo development: diagnóstico flujo Ver informe */
  const [verDebug, setVerDebug] = useState<{ evaluationId: string; status: number; error: string | null; payload: unknown } | null>(null)
  /** Solo development: diagnóstico flujo Archivar */
  const [archiveDebug, setArchiveDebug] = useState<{ total: number; rows: Array<{ id: string; status: string | null; canShowArchive: boolean }>; lastClick?: string; lastResponse?: { status: number; json: unknown } } | null>(null)
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
  const lastFailedSaveRef = React.useRef<{ result: Record<string, unknown>; opts: { teacher_id?: string; school_id?: string; title?: string; subject?: string; course_id?: string; student_name?: string } } | null>(null)

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
    try {
      const r = await fetch(`/api/evaluations/${evaluacionesDetailId}`, { cache: "no-store", credentials: "include" })
      const j = await r.json()
      if (r.ok && j.evaluation) {
        setEvaluacionesDetail({
          evaluation: j.evaluation,
          evaluation_items: j.evaluation_items ?? j.items ?? [],
          evaluation_summaries: j.evaluation_summaries ?? j.summary ?? null,
        })
        setEvaluacionesDetailItemsDraft(null)
        setEvaluacionesDetailError(null)
      } else {
        setEvaluacionesDetailError(r.status === 403 ? "Completa tu perfil para ver esta evaluación." : "No se pudo cargar el informe")
      }
    } catch {
      setEvaluacionesDetailError("No se pudo cargar el informe")
    } finally {
      setEvaluacionesDetailLoading(false)
    }
  }, [evaluacionesDetailId])

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

  /** Nombre final visible del estudiante para sync-student. Fuente: group.studentName (single/batch) o payload.opts.student_name (retry). */
  function getFinalStudentNameForSync(
    group: { studentName?: string } | null | undefined,
    payload?: { opts?: { student_name?: string } } | null
  ): string {
    const fromGroup = group?.studentName != null ? String(group.studentName).trim() : ""
    const fromPayload = payload?.opts?.student_name != null ? String(payload.opts.student_name).trim() : ""
    return fromGroup || fromPayload || ""
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
        if (j.profile?.teacher_id) {
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
    if (process.env.NODE_ENV !== "production" && activeTab === "evaluaciones" && evaluacionesList.length >= 0) {
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
        files: [],
        isEvaluated: false,
        isEvaluating: false,
        decimasAdicionales: 0,
      })),
    )
    setUnassignedFiles([])
  }, [classSize])
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
      toast({ title: "No hay archivos pendientes para agrupar.", variant: "default" })
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

  /** Nombre genérico que se puede sobrescribir de forma segura (solo "Alumno N" o vacío). */
  const isGenericGroupName = (name: string | undefined) => {
    if (!name || typeof name !== "string") return true
    const t = name.trim()
    return t === "" || /^Alumno\s+\d+$/i.test(t)
  }

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

  const extractStudentNameFromText = (text: string, knownName?: string): string => {
    if (knownName && knownName.trim() && knownName !== "Estudiante") {
      return knownName
    }

    // Buscar patrones comunes de nombres en el texto
    const namePatterns = [
      /(?:el estudiante|la estudiante|alumno|alumna)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i,
      /^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})\s+(?:demuestra|muestra|presenta|tiene)/i,
    ]

    for (const pattern of namePatterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        return match[1].trim()
      }
    }

    return "El estudiante"
  }

  const formatFeedbackText = (text: string, studentName: string): string => {
    // Validar que text sea string
    if (!text || typeof text !== 'string') {
      return text || ""
    }
    
    const nameToUse = extractStudentNameFromText(text, studentName)

    // Si el texto ya tiene un nombre o "el estudiante", no lo reemplazamos mal
    if (text.toLowerCase().includes("el estudiante") || text.toLowerCase().includes("la estudiante")) {
      return text
    }

    // Si no menciona al estudiante, agregamos el nombre al inicio
    if (!text.match(/^(el|la)\s+estudiante/i)) {
      return `${nameToUse} ${text.charAt(0).toLowerCase()}${text.slice(1)}`
    }

    return text
  }

  // Función para manejar la evaluación de un solo grupo (usada para confirmación OMR individual)
  const handleEvaluateSingleGroup = async (groupId: string) => {
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

    const group = studentGroups.find((g) => g.id === groupId)
    if (!group || group.files.length === 0) return

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

    const payload = {
      fileUrls: group.files.map((f) => f.dataUrl),
      fileMimeTypes: group.files.map((f) => f.file.type),
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
      pautaEstructurada,
      pautaCorrectaAlternativas,
      tipoPrueba: tipoPrueba || "mixta",
      respuestasAlternativas: answerKey ? undefined : group.alternativas_corregidas,
      captureMode: captureMode,
      ...(teacherIdForPayload && { teacher_id: teacherIdForPayload }),
      ...(schoolIdForPayload && { school_id: schoolIdForPayload }),
      evaluation_title: form.getValues("nombrePrueba") ?? "",
      evaluation_subject: form.getValues("asignatura") ?? "",
      course_id: form.getValues("curso") ?? "",
      nombreEstudiante: group.studentName && String(group.studentName).trim() !== "" ? String(group.studentName).trim() : undefined,
      omrTemplateVariant: selectedOmrTemplateVariant,
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
                const finalStudentName = getFinalStudentNameForSync(group, null)
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
            error: result.error,
          }
        }
      }),
    )
  }

  // Función para manejar evaluación masiva en lotes paralelos (3 lotes x 45 simultáneos)
  const handleEvaluateGroups = async (groupIDsToEvaluate: string[]) => {
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

    if (!rubrica) {
      form.setError("rubrica", { type: "manual", message: "La rubrica es requerida." })
      return
    }
    if (!pautaEstructurada) {
      form.setError("pautaEstructurada", {
        type: "manual",
        message: "La pauta de puntajes estructurada es requerida para el rigor.",
      })
      return
    }

    // Filtrar grupos validos
    const validGroups = studentGroups.filter(
      (g) => groupIDsToEvaluate.includes(g.id) && g.files.length > 0
    )

    if (validGroups.length === 0) return

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
    const totalBatches = Math.ceil(validGroups.length / 45)
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

    // Construir items para el batch endpoint
    const batchItems = validGroups.map((group) => ({
      groupId: group.id,
      payload: {
        fileUrls: group.files.map((f) => f.dataUrl),
        fileMimeTypes: group.files.map((f) => f.file.type),
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
        pautaEstructurada,
        pautaCorrectaAlternativas,
        tipoPrueba: tipoPrueba || "mixta",
        respuestasAlternativas: answerKey ? undefined : group.alternativas_corregidas,
        captureMode: captureMode,
        ...(teacherIdForPayload && { teacher_id: teacherIdForPayload }),
        ...(schoolIdForPayload && { school_id: schoolIdForPayload }),
        evaluation_title: nombrePrueba ?? "",
        evaluation_subject: asignatura ?? "",
        course_id: curso ?? "",
        nombreEstudiante: group.studentName && String(group.studentName).trim() !== "" ? String(group.studentName).trim() : undefined,
        omrTemplateVariant: selectedOmrTemplateVariant,
      },
    }))

    try {
      const response = await fetch("/api/evaluate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batchItems }),
      })

      if (!response.ok || !response.body) {
        throw new Error("Error HTTP " + response.status + ": " + response.statusText)
      }

      // Leer stream NDJSON línea por línea
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let completed = 0
      let successes = 0
      let errors = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)

            if (msg.type === "meta") {
              setBatchProgress((prev) => ({
                ...prev,
                totalBatches: msg.totalBatches,
              }))
            } else if (msg.type === "result") {
              completed++
              if (msg.success) successes++
              else errors++

              const currentBatch = Math.floor((completed - 1) / 45) + 1

              setBatchProgress((prev) => ({
                ...prev,
                completedItems: completed,
                successCount: successes,
                errorCount: errors,
                currentBatch,
              }))

              // Actualizar el grupo específico con su resultado
              setStudentGroups((prev) =>
                prev.map((g) => {
                  if (g.id !== msg.groupId) return g
                  if (msg.success && msg.data) {
                    if (msg.data.saved && typeof (msg.data as { evaluation_id?: string }).evaluation_id === "string") {
                      setLastSavedEvaluationId((msg.data as { evaluation_id: string }).evaluation_id)
                      setLastSaveReason(null)
                      setLastSaveError(null)
                      setActiveTab("evaluaciones")
                    } else if (!msg.data.saved) {
                      const reason = typeof (msg.data as { reason?: string }).reason === "string" ? (msg.data as { reason: string }).reason : null
                      const saveError = typeof (msg.data as { save_error?: string }).save_error === "string" ? (msg.data as { save_error: string }).save_error : "Error desconocido"
                      setLastSaveReason(reason)
                      setLastSaveError(saveError)
                      toast({ title: "❌ No se pudo guardar: " + (reason || saveError), variant: "destructive" })
                    }
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
                      error: undefined,
                      evaluation_id: (msg.data as { evaluation_id?: string }).evaluation_id ?? undefined,
                    }
                  } else {
                    return { ...g, isEvaluating: false, error: msg.error || "Error en la evaluacion" }
                  }
                }),
              )
              if (msg.success && msg.data?.saved && typeof (msg.data as { evaluation_id?: string }).evaluation_id === "string") {
                const evalId = (msg.data as { evaluation_id: string }).evaluation_id
                const group = studentGroups.find((g) => g.id === msg.groupId)
                const finalStudentName = getFinalStudentNameForSync(group ?? undefined, null)
                const finalCourseLabel = getFinalCourseLabel(null)
                if (finalStudentName) {
                  fetch(`/api/evaluations/${evalId}/sync-student`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      student_name: finalStudentName,
                      course_label: finalCourseLabel,
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
            } else if (msg.type === "done") {
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
    } catch (err) {
      // Si falla el batch, marcar todos como error
      const errorMsg = err instanceof Error ? err.message : "Error en evaluacion batch"
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

  const onEvaluateAll = async () => {
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
      await handleEvaluateGroups(groupsToEvaluate)
    }
  }

  const exportToDocOrCsv = (formatType: "csv" | "doc") => {
    const evaluatedGroups = studentGroups.filter((g) => g.isEvaluated)
    if (evaluatedGroups.length === 0) {
      alert("No hay evaluaciones para exportar.")
      return
    }

    if (formatType === "doc") {
      // Generar documento Word (.doc) básico con HTML
      const rows = evaluatedGroups
        .map(
          (g) =>
            [
              "<tr>",
              "<td>" + (g.studentName || "N/A") + "</td>",
              "<td>" + (g.puntaje || "N/A") + "</td>",
              "<td>" + (g.nota || "N/A") + "</td>",
              "<td>" + (g.retroalimentacion?.resumen_general?.fortalezas || "N/A").replace(/\n/g, "<br>") + "</td>",
              "<td>" + (g.retroalimentacion?.resumen_general?.areas_mejora || "N/A").replace(/\n/g, "<br>") + "</td>",
              "</tr>",
            ].join(""),
        )
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
  const selectedNivel = form.watch("nivelEducativo")
  // ✅ CORRECCIÓN DE PESTAÑAS: Definición para ajustar etiquetas
  const isSuperior = ["Técnico Superior", "Universitario", "Postgrado"].includes(selectedNivel)
  const cursoLabel = isSuperior ? "Sección" : "Curso"
  const departamentoLabel = isSuperior ? "Escuela/Carrera" : "Departamento"
  const rootThemeClass = activeTab === "inicio" ? "theme-ocaso" : theme

  return (
    <EvaluatorRootDiv className={rootThemeClass}>
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

      {process.env.NODE_ENV === "development" && mainProfile && (
        <div className="mx-4 mb-2 rounded border border-dashed border-[var(--border-color)] bg-[var(--bg-muted)] px-3 py-2 text-xs font-mono text-[var(--text-muted)]">
          <span className="font-semibold">[DEV] Perfil:</span> userId={mainProfile.user?.id ?? "—"} | teacher_id={mainProfile.profile?.teacher_id ?? "null"} | school_id={mainProfile.profile?.school_id ?? "null"}
        </div>
      )}

      {process.env.NODE_ENV === "development" && (
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
              <div className="font-semibold">Vista previa del informe — {previewGroup.studentName}</div>

              <div className="pdf-modal-actions">
                <PDFDownloadLink
                  document={
                    <ReportDocument group={previewGroup} formData={form.getValues()} logoPreview={logoPreview} />
                  }
                  fileName={`informe_${previewGroup.studentName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`}
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
            <TabsTrigger value="pruebas-base" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <BookOpen className="mr-2 h-4 w-4 inline" />
              Pruebas base
            </TabsTrigger>
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
                      onEvaluateAll()
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
                          <span className="truncate">{group.studentName || "Sin nombre"}</span>
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

                  {/* Agrupación automática por reglas (solo UI; no toca evaluación ni contratos). */}
                  {studentGroups.length > 0 ? (
                    <div className="p-4 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 space-y-3">
                      <h3 className="font-bold text-[var(--text-accent)] flex items-center gap-2">
                        <Users className="h-5 w-5 text-indigo-600" />
                        Agrupación automática
                      </h3>
                      <p className="text-sm text-[var(--text-secondary)]">
                        Indica cuántas imágenes corresponden a cada estudiante. Luego usa el botón para distribuir los archivos pendientes en orden.
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
                        const totalLoaded = unassignedFiles.length + studentGroups.reduce((acc, g) => acc + g.files.length, 0)
                        const expected = studentGroups.length * Math.max(1, imagesPerStudent)
                        const missing = Math.max(0, expected - totalLoaded)
                        const surplus = Math.max(0, totalLoaded - expected)
                        const complete = studentGroups.filter((g) => g.files.length >= Math.max(1, imagesPerStudent)).length
                        const incomplete = studentGroups.filter((g) => g.files.length > 0 && g.files.length < Math.max(1, imagesPerStudent)).length
                        return (
                          <div className="text-sm space-y-1 pt-2 border-t border-indigo-200 dark:border-indigo-800">
                            <p className="font-medium text-[var(--text-primary)]">
                              Se detectaron {totalLoaded} imagen{totalLoaded !== 1 ? "es" : ""} en total.
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
                        disabled={isExtractingNames || studentGroups.filter((g) => g.files.length > 0 && isGenericGroupName(g.studentName)).length === 0}
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
                          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                            <Input
                              className="text-lg font-bold border-0 shadow-none focus-visible:ring-0 p-1 bg-transparent flex-1 min-w-0"
                              value={group.studentName}
                              onChange={(e) => updateStudentName(group.id, e.target.value)}
                            />
                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-[var(--bg-muted)] text-[var(--text-secondary)]">
                              {group.files.length} archivo{group.files.length !== 1 ? "s" : ""}
                            </span>
                            <span className="text-xs font-medium px-2 py-1 rounded-full border bg-white/80 dark:bg-gray-900/80">
                              {stateLabel}
                            </span>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleNameExtraction(group.id)}
                            disabled={isExtractingNames}
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
                                  onClick={() => removeFileFromGroup(file.id, group.id)}
                                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}

                            {unassignedFiles.length > 0 && (
                              <div className="flex items-center justify-center w-20 h-20 border-2 border-dashed rounded-lg border-[var(--border-color)]">
                                <select
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
                        </div>
                      )
                    })}
                  </CardContent>
                  <CardFooter className="flex flex-col items-stretch gap-4">
                    <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-muted-subtle)] p-3 space-y-2">
                      <Label htmlFor="omr-template-variant" className="text-[var(--text-accent)]">
                        Tipo de plantilla OMR
                      </Label>
                      <Select
                        value={selectedOmrTemplateVariant}
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
                        Se envía a la evaluación como <span className="font-mono">omrTemplateVariant</span>. Comprueba{" "}
                        <span className="font-mono">omrTemplateVariantUsed</span> en OMR DEBUG (REAL).
                      </p>
                    </div>
                    {/* Botón de Evaluación */}
                    <Button
                      size="lg"
                      onClick={onEvaluateAll}
                      className="w-full"
                      disabled={
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
                      {focusedGroupId && (
                        <Button type="button" variant="outline" size="sm" onClick={() => setFocusedGroupId(null)}>
                          Ver todos
                        </Button>
                      )}
                    </div>
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
                                <p className="font-semibold text-sm truncate text-[var(--text-primary)]" title={group.studentName}>
                                  {group.studentName || "Sin nombre"}
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
                              {focusedGroup?.studentName || "Este estudiante"} aún no tiene resultados.
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
                        const expectedClosedCount = Math.max(
                          0,
                          Number(debug?.expectedQuestionCountUsed ?? 0) || 0
                        )
                        const currentAlternativas = Array.isArray(group.alternativas_corregidas)
                          ? group.alternativas_corregidas
                          : []
                        const tableAlternativas =
                          expectedClosedCount > currentAlternativas.length
                            ? [
                                ...currentAlternativas,
                                ...Array.from(
                                  { length: expectedClosedCount - currentAlternativas.length },
                                  (_, idx) => ({
                                    pregunta: `SM${currentAlternativas.length + idx + 1}`,
                                    respuesta_estudiante: "",
                                    respuesta_correcta: "",
                                  }),
                                ),
                              ]
                            : currentAlternativas

                        // 🔥 EXTRACCIÓN DE VALORES PARA EL VELOCÍMETRO
                        const puntajeObtenido = Number.parseInt(group.puntaje?.split("/")[0] || "0", 10)
                        const puntajeMaximo =
                          group.puntosMaximos || Number.parseInt(group.puntaje?.split("/")[1] || "0", 10)
                        const puntosAprobacion = group.puntosAprobacion || 0

                        return (
                          <div
                            key={group.id}
                            id={`group-paso3-${group.id}`}
                            className={`p-6 rounded-lg border-l-4 ${
                              group.error ? "border-red-500" : "border-green-500"
                            } bg-[var(--bg-card)] shadow`}
                          >
                            <div className="flex justify-between items-center flex-wrap gap-2">
                              <h3 className="font-bold text-xl text-[var(--text-accent)]">{group.studentName}</h3>
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
                                    fileName={`informe_${group.studentName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`}
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
                                {(typeof group.shouldUseOfficialAzureOmr !== "undefined" ||
                                  typeof group.officialOmrEngineSelected !== "undefined") && (
                                  <div className="rounded-md border border-cyan-300 bg-cyan-50 dark:bg-cyan-950/30 p-3 text-xs">
                                    <p className="font-semibold text-cyan-900 dark:text-cyan-100 mb-1">
                                      Debug OMR oficial (temporal)
                                    </p>
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
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="mt-4 space-y-6">
                                {(typeof group.shouldUseOfficialAzureOmr !== "undefined" ||
                                  typeof group.officialOmrEngineSelected !== "undefined") && (
                                  <div className="rounded-md border border-cyan-300 bg-cyan-50 dark:bg-cyan-950/30 p-3 text-xs">
                                    <p className="font-semibold text-cyan-900 dark:text-cyan-100 mb-1">
                                      Debug OMR oficial (temporal)
                                    </p>
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
                                  </div>
                                )}
                                {group.isEvaluated && (
                                  <>
                                    {debug && (
                                      <div style={{
                                        marginTop: "20px",
                                        padding: "12px",
                                        border: "3px solid red",
                                        background: "#000",
                                        color: "#00ff00",
                                        fontSize: "12px",
                                        zIndex: 9999
                                      }}>
                                        <div><b>OMR DEBUG (REAL)</b></div>

                                        <div>engineSelected: {String(debug.engineSelected)}</div>
                                        <div>engineUsed: {String(debug.engineUsed)}</div>
                                        <div>fallbackUsed: {String(debug.fallbackUsed)}</div>
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
                                            {group.retroalimentacion?.correccion_detallada?.map((item, index) => (
                                              <TableRow key={index}>
                                                <TableCell className="font-medium">
                                                  {renderForWeb(item.seccion)}
                                                </TableCell>

                                                <TableCell>{renderForWeb(item.detalle)}</TableCell>
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
                                                isDevelopmentItem && (item.cita_estudiante ?? item.texto_estudiante) != null
                                                  ? renderForWeb(item.cita_estudiante ?? item.texto_estudiante)
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
                                                alt={`Prueba ${group.studentName} - Página ${idx + 1}`}
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
                                                        student_answer: (item as { texto_estudiante?: string })?.texto_estudiante ?? "",
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
                                      <Card className="border-l-4 border-l-green-500">
                                        <CardHeader className="pb-3">
                                          <CardTitle className="text-green-700 text-base">✅ Fortalezas</CardTitle>
                                        </CardHeader>
<CardContent>
                                          <p className="text-sm leading-relaxed">
                                            {formatFeedbackText(
                                              renderForWeb(group.retroalimentacion?.resumen_general?.fortalezas) || "No disponible",
                                              group.studentName,
                                            )}
                                          </p>
                                        </CardContent>
                                      </Card>

                                      <Card className="border-l-4 border-l-yellow-500">
                                        <CardHeader className="pb-3">
                                          <CardTitle className="text-yellow-700 text-base">Áreas de Mejora</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                          <p className="text-sm leading-relaxed">
                                            {formatFeedbackText(
                                              renderForWeb(group.retroalimentacion?.resumen_general?.areas_mejora) || "No disponible",
                                              group.studentName,
                                            )}
                                          </p>
                                        </CardContent>
                                      </Card>
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
                                const r = await fetch(`/api/evaluations/${e.id}`)
                                const j = await r.json()
                                setHistorialDetail(j.evaluation ? { evaluation: j.evaluation, items: j.items ?? [], summary: j.summary } : null)
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
                  {process.env.NODE_ENV === "development" && (
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
                          const r = await fetch(url)
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
                              setEvaluacionesDetailId(lastSavedEvaluationId)
                              setEvaluacionesDetail(null)
                              setEvaluacionesDetailError(null)
                              setEvaluationStudents([])
                              setEvaluacionesDetailLoading(true)
                              Promise.all([
                                fetch(`/api/evaluations/${lastSavedEvaluationId}`),
                                fetch(`/api/evaluations/${lastSavedEvaluationId}/students`),
                              ])
                                .then(([r, studentsRes]) => Promise.all([r.json(), studentsRes.json()]).then(([j, s]) => ({ j, s, ok: r.ok, status: r.status })))
                                .then(({ j, s, ok, status }) => {
                                  if (ok && j.evaluation) {
                                    setEvaluacionesDetail({
                                      evaluation: j.evaluation,
                                      evaluation_items: j.evaluation_items ?? j.items ?? [],
                                      evaluation_summaries: j.evaluation_summaries ?? j.summary ?? null,
                                    })
                                    setEvaluacionesDetailError(null)
                                  } else {
                                    setEvaluacionesDetailError(status === 403 ? "Completa tu perfil para ver esta evaluación." : "No se pudo cargar el informe")
                                  }
                                  setEvaluationStudents(s?.students ?? [])
                                })
                                .catch(() => setEvaluacionesDetailError("No se pudo cargar el informe"))
                                .finally(() => setEvaluacionesDetailLoading(false))
                            }}
                          >
                            Abrir
                          </Button>
                      {process.env.NODE_ENV === "development" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            setDiagnosisResult(null)
                            setDiagnosisOpen(true)
                            try {
                              const r = await fetch(`/api/debug/evaluations/full-check?evaluation_id=${encodeURIComponent(lastSavedEvaluationId)}`)
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
                <p className="text-sm text-[var(--text-muted)] mb-3">
                  teacher_id del perfil: {evaluacionesListDebug?.teacher_id_used ?? "—"} | evaluaciones encontradas: {evaluacionesList.length}
                </p>
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
                        {process.env.NODE_ENV !== "production" && (
                          <div className="pt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-amber-600 border-amber-500/50"
                              onClick={async () => {
                                setFixTeacherIdResult(null)
                                const r = await fetch("/api/debug/profile/fix-teacher-id", { method: "POST" })
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
                    {evaluacionesListReason !== "PROFILE_NOT_ONBOARDED" && evaluacionesListDebug?.teacher_id_used && process.env.NODE_ENV !== "production" && (
                      <div className="pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-amber-600 border-amber-500/50"
                          onClick={async () => {
                            const r = await fetch("/api/debug/evaluations/relink-to-profile", { method: "POST" })
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
                            const finalCourseLabel = getFinalCourseLabel(payload)
                            if (evalId && finalStudentName) {
                              fetch(`/api/evaluations/${evalId}/sync-student`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ student_name: finalStudentName, course_label: finalCourseLabel }),
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
                                  onClick={async () => {
                                    const evaluationId = ev.id
                                    if (process.env.NODE_ENV === "development") {
                                      console.info("[UI][VER] clicked", evaluationId)
                                    }
                                    setEvaluacionesDetailId(evaluationId)
                                    setEvaluacionesDetail(null)
                                    setEvaluacionesDetailError(null)
                                    setEvaluationStudents([])
                                    setEvaluacionesDetailLoading(true)
                                    setVerDebug(null)
                                    try {
                                      const url = `/api/evaluations/${evaluationId}`
                                      if (process.env.NODE_ENV === "development") {
                                        console.info("[UI][VER] fetching", url)
                                      }
                                      const r = await fetch(url)
                                      const j = await r.json()
                                      if (process.env.NODE_ENV === "development") {
                                        console.info("[UI][VER] response status", r.status)
                                        if (r.ok) {
                                          console.info("[UI][VER] payload keys", Object.keys(j || {}))
                                          console.info("[UI][VER] has evaluation", !!j?.evaluation)
                                          console.info("[UI][VER] items length", Array.isArray(j?.items) ? j.items.length : -1)
                                          console.info("[UI][VER] has summary", !!j?.summary)
                                        }
                                      }
                                      if (r.ok && j.evaluation) {
                                        setEvaluacionesDetail({
                                          evaluation: j.evaluation,
                                          evaluation_items: j.evaluation_items ?? j.items ?? [],
                                          evaluation_summaries: j.evaluation_summaries ?? j.summary ?? null,
                                        })
                                        setEvaluacionesDetailError(null)
                                      } else {
                                        if (process.env.NODE_ENV === "development") {
                                          setVerDebug({ evaluationId, status: r.status, error: j?.error ?? null, payload: j })
                                        }
                                        setEvaluacionesDetailError(r.status === 403 ? "Completa tu perfil para ver esta evaluación." : "No se pudo cargar el informe")
                                      }
                                      try {
                                        const sRes = await fetch(`/api/evaluations/${evaluationId}/students`)
                                        const s = sRes.ok ? await sRes.json() : { students: [] }
                                        setEvaluationStudents(s.students ?? [])
                                      } catch {
                                        setEvaluationStudents([])
                                      }
                                    } catch (e) {
                                      const errMsg = e instanceof Error ? e.message : String(e)
                                      if (process.env.NODE_ENV === "development") {
                                        setVerDebug({ evaluationId, status: 0, error: errMsg, payload: null })
                                      }
                                      setEvaluacionesDetailError("No se pudo cargar el informe")
                                    } finally {
                                      setEvaluacionesDetailLoading(false)
                                    }
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
                                {process.env.NODE_ENV === "development" && (() => {
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
                                    if (process.env.NODE_ENV === "development") {
                                      console.info("[UI][ARCHIVE] clicked", ev.id)
                                    }
                                    const r = await fetch(`/api/evaluations/${ev.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }) })
                                    const j = await r.json().catch(() => ({}))
                                    if (process.env.NODE_ENV === "development") {
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
                            </TableCell>
                          </TableRow>
                        )
                        })}
                      </TableBody>
                    </Table>
                  </>
                )}
                {evaluacionesDetailId && (
                  <div className="mt-6 p-4 border rounded-lg bg-[var(--bg-muted)]">
                    <div className="flex justify-between items-center mb-4">
                      <span className="font-medium text-[var(--text-accent)]">Detalle de la evaluación</span>
                      <Button variant="ghost" size="sm" onClick={() => { setEvaluacionesDetailId(null); setEvaluacionesDetail(null); setEvaluacionesDetailError(null); setEvaluacionesDetailItemsDraft(null) }}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {evaluacionesDetailLoading && (
                      <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
                      </div>
                    )}
                    {!evaluacionesDetailLoading && evaluacionesDetailError && (
                      <p className="text-sm text-red-600 dark:text-red-400">{evaluacionesDetailError}</p>
                    )}
                    {!evaluacionesDetailLoading && evaluacionesDetail && (
                      <div className="space-y-4">
                        <div className="grid gap-2 text-sm">
                          <p><span className="font-medium">Nota final:</span> {(evaluacionesDetail.evaluation_summaries as { grade_chile?: number })?.grade_chile != null ? Number((evaluacionesDetail.evaluation_summaries as { grade_chile?: number }).grade_chile) : "—"}</p>
                          <p><span className="font-medium">Fortalezas:</span> {(evaluacionesDetail.evaluation_summaries as { strengths?: string })?.strengths ?? "—"}</p>
                          <p><span className="font-medium">Debilidades / Áreas de mejora:</span> {(evaluacionesDetail.evaluation_summaries as { improvements?: string })?.improvements ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium mb-1">Estudiantes</p>
                          {evaluationStudents.length === 0 ? (
                            <p className="text-sm text-[var(--text-muted)]">Sin estudiantes vinculados</p>
                          ) : (
                            <ul className="text-sm list-disc list-inside">
                              {evaluationStudents.map((s, i) => (
                                <li key={i}>{s.student_name || "—"}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <p className="text-sm font-medium">Preguntas evaluadas</p>
                        {evaluacionesDetailItemsDraft == null ? (
                          <>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>#</TableHead>
                                  <TableHead>Respuesta estudiante</TableHead>
                                  <TableHead>Correcta</TableHead>
                                  <TableHead>Puntaje</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(evaluacionesDetail.evaluation_items as Array<{ question_number?: number; student_answer?: string; correct_answer?: string | null; is_correct?: boolean | null; score_obtained?: number; score_max?: number }>).map((item, i) => (
                                  <TableRow key={i}>
                                    <TableCell>{item.question_number ?? i + 1}</TableCell>
                                    <TableCell>{item.student_answer ?? "—"}</TableCell>
                                    <TableCell>{item.correct_answer != null ? item.correct_answer : (item.is_correct != null ? (item.is_correct ? "Sí" : "No") : "—")}</TableCell>
                                    <TableCell>{item.score_obtained != null && item.score_max != null ? `${item.score_obtained}/${item.score_max}` : "—"}</TableCell>
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
                                const items = (evaluacionesDetail.evaluation_items as Array<{ question_number?: number; student_answer?: string; correct_answer?: string; is_correct?: boolean; score_obtained?: number; score_max?: number }>).map((it) => ({
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
                                  <TableHead>#</TableHead>
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
                                            next[idx] = { ...next[idx], score_obtained: e.target.value === "" ? undefined : Number(e.target.value) }
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
                                      toast({ title: j?.error || "Error al guardar", variant: "destructive" })
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
                              <Button type="button" variant="outline" size="sm" onClick={() => setEvaluacionesDetailItemsDraft(null)}>Cancelar</Button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
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
                  {process.env.NODE_ENV === "development" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        setDiagnosisResult(null)
                        setDiagnosisOpen(true)
                        try {
                          const r = await fetch("/api/debug/evaluations/full-check")
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
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {courseEntries.map(([courseId, data]) => {
                            const total = data.active.length + data.archived.length
                            const archivedCount = data.archived.length
                            return (
                              <Card
                                key={courseId}
                                className="cursor-pointer border-[var(--border-color)] hover:bg-[var(--bg-muted)] transition-colors"
                                onClick={() => setSelectedCourseId(courseId)}
                              >
                                <CardContent className="pt-4">
                                  <div className="font-medium text-[var(--text-accent)]">{courseId}</div>
                                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                                    {total} evaluación(es) · {archivedCount} archivada(s)
                                  </div>
                                  <div className="mt-2 flex gap-2">
                                    <Button size="sm" onClick={(e) => { e.stopPropagation(); setSelectedCourseId(courseId) }}>
                                      Abrir
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={async (e) => {
                                        e.stopPropagation()
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
                                              summary: j.summary ? { strongest_axis: j.summary.strongest_axis ?? null, weakest_axis: j.summary.weakest_axis ?? null } : { strongest_axis: null, weakest_axis: null },
                                            })
                                          } else {
                                            setCourseDiagnosisData({ course_label: courseId, students_count: 0, evaluations_count: 0, axes: [], skills: [], strongest_skill: null, weakest_skill: null, summary: { strongest_axis: null, weakest_axis: null } })
                                          }
                                        } catch {
                                          setCourseDiagnosisData({ course_label: courseId, students_count: 0, evaluations_count: 0, axes: [], skills: [], strongest_skill: null, weakest_skill: null, summary: { strongest_axis: null, weakest_axis: null } })
                                        } finally {
                                          setCourseDiagnosisLoading(false)
                                        }
                                      }}
                                    >
                                      Ver diagnóstico
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        openCoursePedagogicalSummary(courseId, courseId)
                                      }}
                                    >
                                      <FolderOpen className="h-3.5 w-3.5 mr-1" /> Ver resumen pedagógico
                                    </Button>
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
                    <div className="flex items-center gap-2 mb-4">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedCourseId(null)}>
                        ← Volver a cursos
                      </Button>
                      <span className="font-medium text-[var(--text-accent)]">{selectedCourseId}</span>
                      <Button
                        variant="outline"
                        size="sm"
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
                                summary: j.summary ? { strongest_axis: j.summary.strongest_axis ?? null, weakest_axis: j.summary.weakest_axis ?? null } : { strongest_axis: null, weakest_axis: null },
                              })
                            } else {
                              setCourseDiagnosisData({ course_label: selectedCourseId, students_count: 0, evaluations_count: 0, axes: [], skills: [], strongest_skill: null, weakest_skill: null, summary: { strongest_axis: null, weakest_axis: null } })
                            }
                          } catch {
                            setCourseDiagnosisData({ course_label: selectedCourseId, students_count: 0, evaluations_count: 0, axes: [], skills: [], strongest_skill: null, weakest_skill: null, summary: { strongest_axis: null, weakest_axis: null } })
                          } finally {
                            setCourseDiagnosisLoading(false)
                          }
                        }}
                      >
                        Ver diagnóstico
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!selectedCourseId) return
                          openCoursePedagogicalSummary(selectedCourseId, selectedCourseId)
                        }}
                      >
                        <FolderOpen className="h-3 w-3 mr-1" /> Ver resumen pedagógico
                      </Button>
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
                                  <TableCell className="flex gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={async () => {
                                        setEvaluacionesDetailId(e.id)
                                        setEvaluacionesDetail(null)
                                        setEvaluacionesDetailError(null)
                                        setEvaluationStudents([])
                                        setEvaluacionesDetailLoading(true)
                                        try {
                                          const [r, studentsRes] = await Promise.all([
                                            fetch(`/api/evaluations/${e.id}`),
                                            fetch(`/api/evaluations/${e.id}/students`),
                                          ])
                                          const j = await r.json()
                                          const s = await studentsRes.json()
                                          if (r.ok && j.evaluation) {
                                            setEvaluacionesDetail({
                                              evaluation: j.evaluation,
                                              evaluation_items: j.evaluation_items ?? j.items ?? [],
                                              evaluation_summaries: j.evaluation_summaries ?? j.summary ?? null,
                                            })
                                            setEvaluacionesDetailError(null)
                                          } else {
                                            if (r.status === 403) {
                                              setEvaluacionesDetailError("Completa tu perfil para ver esta evaluación.")
                                            } else {
                                              setEvaluacionesDetailError("No se pudo cargar el informe")
                                            }
                                          }
                                          setEvaluationStudents(s?.students ?? [])
                                        } catch {
                                          setEvaluacionesDetailError("No se pudo cargar el informe")
                                        } finally {
                                          setEvaluacionesDetailLoading(false)
                                        }
                                      }}
                                    >
                                      Ver / Abrir carpeta
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
                                          const r = await fetch(`/api/evaluations/${e.id}/students`)
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
                                    <TableCell>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                          setEvaluacionesDetailId(e.id)
                                          setEvaluacionesDetail(null)
                                          setEvaluacionesDetailError(null)
                                          setEvaluationStudents([])
                                          setEvaluacionesDetailLoading(true)
                                          try {
                                            const [r, studentsRes] = await Promise.all([
                                              fetch(`/api/evaluations/${e.id}`),
                                              fetch(`/api/evaluations/${e.id}/students`),
                                            ])
                                            const j = await r.json()
                                            const s = await studentsRes.json()
                                            if (r.ok && j.evaluation) {
                                              setEvaluacionesDetail({
                                                evaluation: j.evaluation,
                                                evaluation_items: j.evaluation_items ?? j.items ?? [],
                                                evaluation_summaries: j.evaluation_summaries ?? j.summary ?? null,
                                              })
                                              setEvaluacionesDetailError(null)
                                            } else {
                                              setEvaluacionesDetailError(r.status === 403 ? "Completa tu perfil para ver esta evaluación." : "No se pudo cargar el informe")
                                            }
                                            setEvaluationStudents(s?.students ?? [])
                                          } catch {
                                            setEvaluacionesDetailError("No se pudo cargar el informe")
                                          } finally {
                                            setEvaluacionesDetailLoading(false)
                                          }
                                        }}
                                      >
                                        Ver / Abrir carpeta
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
                                            const r = await fetch(`/api/evaluations/${e.id}/students`)
                                            const j = await r.json()
                                            setStudentsModalList(j.students ?? [])
                                          } finally {
                                            setStudentsModalLoading(false)
                                          }
                                        }}
                                      >
                                        Ver estudiantes
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
            {studentsModalEvalId && (
              <Dialog open={!!studentsModalEvalId} onOpenChange={(open) => { if (!open) { setStudentsModalEvalId(null); setStudentsModalList([]); setStudentsModalSearch("") } }}>
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
                        .filter((s) => !studentsModalSearch.trim() || (s.student_name || "").toLowerCase().includes(studentsModalSearch.trim().toLowerCase()))
                        .map((s, i) => (
                          <li key={i}>{s.student_name || "—"}</li>
                        ))}
                    </ul>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const evalId = studentsModalEvalId
                      if (!evalId) return
                      setEvaluacionesDetailId(evalId)
                      setEvaluacionesDetail(null)
                      setEvaluacionesDetailError(null)
                      setEvaluationStudents([])
                      setEvaluacionesDetailLoading(true)
                      setStudentsModalEvalId(null)
                      setStudentsModalList([])
                      try {
                        const [r, studentsRes] = await Promise.all([
                          fetch(`/api/evaluations/${evalId}`),
                          fetch(`/api/evaluations/${evalId}/students`),
                        ])
                        const j = await r.json()
                        const s = await studentsRes.json()
                        if (r.ok && j.evaluation) {
                          setEvaluacionesDetail({
                            evaluation: j.evaluation,
                            evaluation_items: j.evaluation_items ?? j.items ?? [],
                            evaluation_summaries: j.evaluation_summaries ?? j.summary ?? null,
                          })
                          setEvaluacionesDetailError(null)
                        } else {
                          setEvaluacionesDetailError(r.status === 403 ? "Completa tu perfil para ver esta evaluación." : "No se pudo cargar el informe")
                        }
                        setEvaluationStudents(s?.students ?? [])
                      } catch {
                        setEvaluacionesDetailError("No se pudo cargar el informe")
                      } finally {
                        setEvaluacionesDetailLoading(false)
                      }
                    }}
                  >
                    Abrir informe
                  </Button>
                </DialogContent>
              </Dialog>
            )}
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
                              <li key={i}>{st.student_name}{st.created_at ? ` · ${format(new Date(st.created_at), "dd/MM/yyyy")}` : ""}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-[var(--text-muted)]">No hay estudiantes registrados para esta evaluación.</p>
                        )}
                      </div>
                      {(evaluacionesDetail.evaluation_items as unknown[])?.length > 0 ? (
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
                                  const items = (evaluacionesDetail.evaluation_items as Array<{ question_number?: number; student_answer?: string; correct_answer?: string; is_correct?: boolean; score_obtained?: number; score_max?: number }>).map((it) => ({
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
            {typeof process !== "undefined" && process.env.NODE_ENV !== "production" && (
              <Card className="bg-[var(--bg-card)] border-[var(--border-color)] border-dashed">
                <CardHeader>
                  <CardTitle className="text-sm text-[var(--text-muted)]">Diagnóstico estudiantes</CardTitle>
                  <CardDescription>Solo visible en desarrollo. Último sync y lista actual.</CardDescription>
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
      {/* Modales de análisis pedagógico y resumen de curso: fuera de TabsContent para que abran desde cualquier pestaña (Estudiantes, Evaluaciones, Cursos). */}
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
    </EvaluatorRootDiv>
  )
}
