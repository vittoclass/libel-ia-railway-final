

// EVALAJUDRO CLIENT CUENTA CON PORCENTAJES Y PUATAS CON PUBTJAE TB.txt (EvaluatorClient.tsx)
"use client"
import * as React from "react"
import { useState, useRef, type ChangeEvent, useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import dynamic from "next/dynamic"
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import NotesDashboard from "@/components/NotesDashboard"
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
import { useEvaluator } from "./useEvaluator"
const SmartCameraModal = dynamic(() => import("@/components/smart-camera-modal"), {
  loading: () => <p>Cargando...</p>,
})

const Label = React.forwardRef<HTMLLabelElement, React.ComponentPropsWithoutRef<"label">>(
  ({ className, ...props }, ref) => <label ref={ref} className={cn("text-sm font-medium", className)} {...props} />,
)
Label.displayName = "Label"

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
function renderForWeb(value: any): React.ReactNode {
  if (value === null || value === undefined) return ""
  const t = typeof value
  if (t === "string" || t === "number" || t === "boolean") return String(value)
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc ml-6">
        {value.map((v, i) => (
          <li key={i}>{renderForWeb(v)}</li>
        ))}
      </ul>
    )
  }
  try {
    if (typeof value === "object" && value !== null && value.cita_estudiante && value.justificacion) {
      return (
        <div className="space-y-1">
          <p className="font-semibold text-sm">Puntaje: {value.puntaje}</p>
          <p className="text-xs italic text-[var(--text-secondary)]">
            Cita Estudiante: &quot;{value.cita_estudiante}&quot;
          </p>
          <p className="text-sm">{value.justificacion}</p>
        </div>
      )
    }
    return (
      <pre className="text-sm whitespace-pre-wrap bg-[var(--bg-muted-subtle)] p-2 rounded">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  } catch {
    return String(value)
  }
}
function pdfSafe(value: any): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    if (typeof value === "object" && value !== null && value.cita_estudiante && value.justificacion) {
      return `Puntaje: ${value.puntaje}
Respuesta Estudiante: "${value.cita_estudiante}"
Justificación: ${value.justificacion}`
    }
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
const splitCorreccionForTwoPages = (lista: any[] | undefined) => {
  if (!lista || lista.length === 0) return { first: [], rest: [] }
  const MAX_P1 = Math.min(5, lista.length)
  return { first: lista.slice(0, MAX_P1), rest: lista.slice(MAX_P1) }
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
  const correccionDesarrolloArray = Object.keys(group.detalle_desarrollo || {}).map((key) => ({
    seccion: `Pregunta Desarrollo: ${key.replace(/_/g, " ")}`,
    detalle: group.detalle_desarrollo[key],
  }))
  const correccionConDesarrollo = [...correccion, ...correccionDesarrolloArray]
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

// 🔥 FUNCIÓN HELPER PARA CALCULAR LA NOTA (Tomada de route.ts)
const calculateGrade = (score: number, maxScore: number, porcentajeExigencia: number): number => {
  if (maxScore <= 0 || porcentajeExigencia <= 0) return 1.0

  const exigenciaDecimal = Math.min(100, porcentajeExigencia) / 100
  const puntosAprobacion = Math.ceil(maxScore * exigenciaDecimal)

  const puntajeEfectivo = Math.max(0, score)

  if (puntajeEfectivo === 0) return 1.0

  const APROBACION_PUNTOS = puntosAprobacion
  const PUNTAJE_MAXIMO = maxScore
  let grade: number // Declarar 'grade' fuera de los bloques if/else

  if (puntajeEfectivo <= APROBACION_PUNTOS) {
    // Nota de 1.0 a 4.0
    grade = 1.0 + 3.0 * (puntajeEfectivo / APROBACION_PUNTOS)
    // Aseguramos que no exceda 4.0 antes del redondeo
    grade = Math.min(4.0, grade)
  } else {
    // Nota de 4.0 a 7.0
    const remainingPoints = PUNTAJE_MAXIMO - APROBACION_PUNTOS
    if (remainingPoints === 0) return 7.0
    grade = 4.0 + 3.0 * ((puntajeEfectivo - APROBACION_PUNTOS) / remainingPoints)
  }

  // 🔥 AJUSTE CRÍTICO: Redondeo riguroso al décimo (0.1)
  // Multiplicamos por 10, redondeamos, y dividimos por 10.
  const finalRoundedGrade = Math.min(7.0, Math.round(grade * 10) / 10)
  return finalRoundedGrade
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
}

// *** TIPOS DECLARADOS PARA RESOLVER ERRORES LINT ***
type CaptureMode = "sm_vf" | "terminos_pareados" | "desarrollo" | null
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

  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [classSize, setClassSize] = useState(1)
  const [isExtractingNames, setIsExtractingNames] = useState(false)
  const [theme, setTheme] = useState("theme-ocaso")
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null)
  // Progreso de evaluacion por lotes
  const batchInitial = { isActive: false, totalItems: 0, completedItems: 0, successCount: 0, errorCount: 0, currentBatch: 0, totalBatches: 0 }
  const [batchProgress, setBatchProgress] = useState(batchInitial)
  const isMobile = typeof window !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const { evaluate, isLoading } = useEvaluator()
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
      porcentajeExigencia: "60",
      pautaEstructurada: "",
      // 🔥 NUEVO: Pauta de alternativas
      pautaCorrectaAlternativas: "",
    },
  })
  useEffect(() => {
    const saved = (localStorage.getItem("userEmail") || "").toLowerCase()
    if (saved && /\S+@\S+\.\S+/.test(saved)) setUserEmail(saved)
  }, [])
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

  // 🚨 Nueva lógica de control para certeza baja
  if (fb.confidence < 0.98) {
    const confirmCapture = window.confirm(
      `⚠️ Baja Certeza OCR (${(fb.confidence * 100).toFixed(1)}%). ¿Desea continuar con el riesgo de error o reintentar?`,
    )
    if (!confirmCapture) return
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
    } = form.getValues()
    const puntajeTotalNum = Number(puntajeTotal)
    const porcentajeExigenciaNum = Number(porcentajeExigencia)

    const group = studentGroups.find((g) => g.id === groupId)
    if (!group || group.files.length === 0) return

    setStudentGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, isEvaluating: true, isEvaluated: false, error: undefined } : g)),
    )

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
      respuestasAlternativas: group.alternativas_corregidas,
      captureMode: captureMode,
    }

    const result = await evaluate(payload)

    setStudentGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g
        if (result.success) {
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
            error: undefined,
          }
        } else {
          return { ...g, isEvaluating: false, error: result.error }
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
        respuestasAlternativas: group.alternativas_corregidas,
        captureMode: captureMode,
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
                      error: undefined,
                    }
                  } else {
                    return { ...g, isEvaluating: false, error: msg.error || "Error en la evaluacion" }
                  }
                }),
              )
            } else if (msg.type === "done") {
              // Completado
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
      const htmlContent = `
      <html>
        <head>
          <meta charset="utf-8">
          <title>Notas - Libel-IA</title>
          <style>
            table { border-collapse: collapse;
width: 100%; margin-top: 20px; }
            th, td { border: 1px solid #000;
padding: 10px; text-align: left; }
            th { background-color: #f2f2f2;
}
          </style>
        </head>
        <body>
          <h1>Resumen de Notas - Libel-IA</h1>
          <table>
            <thead>
              <tr>
                <th>Estudiante</th>
        
<th>Puntaje</th>
                <th>Nota</th>
                <th>Fortalezas</th>
                <th>Áreas de Mejora</th>
              </tr>
            </thead>
            <tbody>
    
${evaluatedGroups
  .map(
    (g) => `
                <tr>
                  <td>${g.studentName || "N/A"}</td>
                  <td>${g.puntaje || "N/A"}</td>
                  <td>${g.nota || "N/A"}</td>
            
<td>${(g.retroalimentacion?.resumen_general?.fortalezas || "N/A").replace(/\n/g, "<br>")}</td>
                  <td>${(g.retroalimentacion?.resumen_general?.areas_mejora || "N/A").replace(/\n/g, "<br>")}</td>
                </tr>
              `,
  )
  .join("")} 
            </tbody>
          </table>
        </body>
      </html>
    
`

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
      const blob = await pdf(
        <ReportDocument group={group} formData={form.getValues()} logoPreview={logoPreview} />,
      ).toBlob()
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

  return (
    <div className={activeTab === "inicio" ? "theme-ocaso" : theme}>
      <GlobalStyles />
      {/* 🚨 MODIFICADO: SmartCameraModal ahora requiere el modo, la función de feedback y el estado de feedback */}
      {isCameraOpen && (
        <SmartCameraModal
     onCapture={(dataUrl: string, feedback?: CameraFeedback) =>
                      handleCapture(dataUrl, captureMode, feedback)
                  }

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

      {/* 🚨 NUEVO: Modal de Selección de Modo de Captura */}
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
            <TabsTrigger value="presentacion" className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm">
              <Eye className="mr-2 h-4 w-4 inline" />
              Presentación
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
                                <Input placeholder="Ej: 60" type="number" {...field} />
                              </FormControl>

                              <FormDescription>
                                Porcentaje de puntaje para obtener Nota 4.0. (Estándar Chile: 60)
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
                            />
                          </FormControl>
                          <FormDescription className="text-blue-600 font-semibold">
                            **OBLIGATORIO si la prueba tiene alternativas.** Usa `ID_PREGUNTA:RESPUESTA_CORRECTA`.
                            Separa con `;`.
                          </FormDescription>
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
            <>
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
                        // 🚨 MODIFICACIÓN CRÍTICA: Abrir el modal de selección
                        onClick={() => setIsCaptureModeSelectionOpen(true)}
                      >
                        <Camera className="mr-2 h-4 w-4" /> Usar Cámara (Captura Guiada)
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
                  {unassignedFiles.length > 0 && (
                    <div className="p-4 border rounded-lg bg-[var(--bg-muted-subtle)] border-[var(--border-color)]">
                      <h3 className="font-semibold mb-3 flex items-center text-[var(--text-accent)]">
                        <ClipboardList className="mr-2 h-5 w-5" /> Archivos Pendientes
                      </h3>

                      <div className="flex flex-wrap gap-4 items-center">
                        {/* ✅ USO DE renderFilePreview */}
                        {unassignedFiles.map((file) => (
                          <div key={file.id} className="relative w-24 h-24">
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
                    <CardTitle className="flex items-center gap-2 text-[var(--text-accent)]">
                      <Users className="text-green-500" />
                      Grupos de Estudiantes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {studentGroups.map((group) => (
                      <div key={group.id} className="border p-4 rounded-lg border-[var(--border-color)]">
                        <Input
                          className="text-lg font-bold border-0 shadow-none focus-visible:ring-0 p-1 mb-2 bg-transparent"
                          value={group.studentName}
                          onChange={(e) => updateStudentName(group.id, e.target.value)}
                        />

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

                        <div className="flex flex-wrap gap-2 min-h-[50px] bg-[var(--bg-muted-subtle)] p-2 rounded-md">
                          {/* ✅ USO DE renderFilePreview */}
                          {group.files.map((file) => (
                            <div key={file.id} className="relative w-20 h-20">
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
                            <div className="flex items-center justify-center w-20 h-20 border-2 border-dashed rounded-md border-[var(--border-color)]">
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
                    ))}
                  </CardContent>
                  <CardFooter className="flex flex-col items-stretch gap-4">
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
              {studentGroups.some((g) => g.isEvaluated || g.isEvaluating || g.isValidationStep) && (
                <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
                  <CardHeader>
                    <CardTitle className="text-[var(--text-accent)]">Paso 3: Resultados</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {studentGroups
                      .filter((g) => g.isEvaluated || g.isEvaluating || g.isValidationStep)
                      .map((group) => {
                        const notaNumber = Number(group.nota) || 0
                        const finalNota = notaNumber + (group.decimasAdicionales || 0)
                        const isReadyToValidate = group.isValidationStep && group.alternativas_corregidas?.length

                        // 🔥 EXTRACCIÓN DE VALORES PARA EL VELOCÍMETRO
                        const puntajeObtenido = Number.parseInt(group.puntaje?.split("/")[0] || "0", 10)
                        const puntajeMaximo =
                          group.puntosMaximos || Number.parseInt(group.puntaje?.split("/")[1] || "0", 10)
                        const puntosAprobacion = group.puntosAprobacion || 0

                        return (
                          <div
                            key={group.id}
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
                              <p className="text-red-600">Error: {group.error}</p>
                            ) : (
                              <div className="mt-4 space-y-6">
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
                                              if (!item) return null

                                              return (
                                                <TableRow key={key}>
                                                  <TableCell className="font-medium text-purple-600">
                                                    {key.replace(/_/g, " ")}
                                                  </TableCell>
                                                  <TableCell>
                                                    <p className="font-semibold text-sm mb-1">
                                                      Puntaje: {item.puntaje}
                                                    </p>
                                                    <p className="text-xs italic text-[var(--text-secondary)] mb-1">
                                                      Cita Estudiante: &quot;{item.cita_estudiante}&quot;
                                                    </p>

                                                    <p className="text-sm">{item.justificacion}</p>
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
                                    {group.isEvaluated &&
                                      group.alternativas_corregidas &&
                                      group.alternativas_corregidas.length > 0 && (
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
                                                {group.alternativas_corregidas?.map((item, index) => {
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
                                                        {item.respuesta_correcta}
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
                                          </div>
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
                                              group.retroalimentacion?.resumen_general?.fortalezas || "No disponible",
                                              group.studentName,
                                            )}
                                          </p>
                                        </CardContent>
                                      </Card>

                                      <Card className="border-l-4 border-l-yellow-500">
                                        <CardHeader className="pb-3">
                                          <CardTitle className="text-yellow-700 text-base">✏️ Áreas de Mejora</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                          <p className="text-sm leading-relaxed">
                                            {formatFeedbackText(
                                              group.retroalimentacion?.resumen_general?.areas_mejora || "No disponible",
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
                      })}
                  </CardContent>
                </Card>
              )}
            </>
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
      </main>
    </div>
  )
}