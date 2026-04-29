"use client"

/**
 * Mismo layout de informe de corrección que usa el evaluador (react-pdf).
 * Entrada: group compatible con CorrectionReportGroupForPdf + formData parcial.
 */
import { format } from "date-fns"
import { Document, Page, Text, View, StyleSheet, Image as PDFImage } from "@react-pdf/renderer"
import { buildPedagogicalResumenFromGroup } from "@/app/lib/pedagogical-feedback-from-group"
import { formatStudentDisplayName } from "@/app/lib/format-student-name"
import type { CorrectionReportGroupForPdf } from "@/app/lib/correction-report-from-evaluation-detail"
import {
  filterCorreccionDetalladaParaDesarrolloUnico,
  formatDetalleDesarrolloPdf,
  pdfSafe,
  renderForWeb,
  splitCorreccionForTwoPages,
} from "@/app/lib/correction-report-pdf-helpers"

const LIBELIA_LOGO_PNG_BASE64 = "/LOGO-LIBEL.png"

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
  feedbackImproveTitle: { fontSize: 9, fontWeight: "bold", color: "#854D0E", marginBottom: 3 },
  feedbackText: { fontSize: 8, lineHeight: 1.15, flexWrap: "wrap" as const },
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
    textAlign: "center" as const,
  },
  habCol37: { width: "37%", borderStyle: "solid", borderWidth: 1, borderColor: "#E5E7EB", padding: 2 },
  tableCellHeader: { margin: 1, fontSize: 8, fontWeight: "bold" },
  tableCell: { margin: 1, fontSize: 8, textAlign: "left" as const },
})

export type CorrectionReportPdfFormData = {
  nombreProfesor?: string | null
  asignatura?: string | null
  departamento?: string | null
  nombrePrueba?: string | null
  curso?: string | null
  nivelEducativo?: string | null
  porcentajeExigencia?: string | number | null
}

function formatReportDate(evaluatedAtIso: string | null | undefined): string {
  if (evaluatedAtIso) {
    const d = new Date(evaluatedAtIso)
    if (!Number.isNaN(d.getTime())) return format(d, "dd/MM/yyyy")
  }
  return format(new Date(), "dd/MM/yyyy")
}

export function CorrectionReportPdfDocument({
  group,
  formData,
  logoPreview,
  evaluatedAt,
}: {
  group: CorrectionReportGroupForPdf
  formData: CorrectionReportPdfFormData
  logoPreview?: string | null
  /** Fecha de evaluación (ISO); si falta, se usa hoy como en el evaluador histórico. */
  evaluatedAt?: string | null
}) {
  const resumenPedagogico = buildPedagogicalResumenFromGroup({
    alternativas_corregidas: group.alternativas_corregidas,
    puntaje: group.puntaje,
    puntosMaximos: group.puntosMaximos,
    puntosAprobacion: group.puntosAprobacion,
    detalle_desarrollo: group.detalle_desarrollo,
  })
  const puntaje = group.puntaje || "N/A"
  const notaNum = Number(group.nota) || 0
  const decimas = typeof group.decimasAdicionales === "number" ? group.decimasAdicionales : 0
  const notaFinal = (notaNum + decimas).toFixed(1)
  const devKeys = Object.keys(group.detalle_desarrollo || {})
  const correccionSinDuplicarDesarrollo = filterCorreccionDetalladaParaDesarrolloUnico(group)
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
  const correccionConDesarrollo = [...correccionSinDuplicarDesarrollo, ...correccionDesarrolloArray] as Array<{
    seccion?: string
    detalle?: string
    detalles?: string
  }>
  const { first: correccionP1, rest: correccionP2 } = splitCorreccionForTwoPages(correccionConDesarrollo)
  const isSuperior = ["Técnico Superior", "Universitario", "Postgrado"].includes(String(formData.nivelEducativo ?? ""))
  const cursoLabel = isSuperior ? "Sección" : "Curso"
  const departamentoLabel = isSuperior ? "Escuela/Carrera" : "Departamento"

  const puntosAprobacion = group.puntosAprobacion || 0
  const puntajeMaximo = group.puntosMaximos || Number(group.puntaje?.split("/")[1]) || 0
  const puntajeObtenido = Number(group.puntaje?.split("/")[0]) || 0
  const porcentajeObtenido = Math.min(100, (puntajeObtenido / puntajeMaximo) * 100)
  const porcentajeAprobacion = (puntosAprobacion / puntajeMaximo) * 100
  const isAprobado = puntajeObtenido >= puntosAprobacion

  const fechaInforme = formatReportDate(evaluatedAt)

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
            {logoPreview ? <PDFImage src={logoPreview} style={styles.logoColegio} /> : null}
            <Text style={styles.infoText}>Profesor: {pdfSafe(formData.nombreProfesor || "N/A")}</Text>
            <Text style={styles.infoText}>Asignatura: {pdfSafe(formData.asignatura || "N/A")}</Text>
            <Text style={styles.infoText}>
              {departamentoLabel}: {pdfSafe(formData.departamento || "N/A")}
            </Text>

            <Text style={styles.infoText}>Evaluación: {pdfSafe(formData.nombrePrueba || "N/A")}</Text>
            <Text style={styles.infoText}>Fecha: {pdfSafe(fechaInforme)}</Text>
          </View>
        </View>
        <Text style={styles.studentLine}>
          Alumno: {pdfSafe(formatStudentDisplayName(group.studentName))} · {cursoLabel}:{" "}
          {pdfSafe(formData.curso || "N/A")}
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
              textAlign: "center" as const,
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
              textAlign: "center" as const,
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
              textAlign: "center" as const,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: "bold", color: "#4B5563", marginBottom: 2 }}>Fecha</Text>
            <Text style={{ fontSize: 11, fontWeight: "bold", color: "#4F46E5" }}>{pdfSafe(fechaInforme)}</Text>
          </View>
        </View>

        {puntajeMaximo > 0 && puntosAprobacion > 0 ? (
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
              Rendimiento vs. Exigencia ({String(formData.porcentajeExigencia ?? "")}%)
            </Text>
            <View
              style={{ height: 6, width: "100%", backgroundColor: "#E5E7EB", borderRadius: 3, position: "relative" }}
            >
              <View
                style={{
                  width: `${porcentajeObtenido}%`,
                  height: "100%",
                  backgroundColor: isAprobado ? "#34D399" : "#EF4444",
                  borderRadius: 3,
                }}
              />
              <View
                style={{
                  position: "absolute",
                  top: -5,
                  left: `${porcentajeAprobacion}%`,
                  width: 1.5,
                  height: 16,
                  backgroundColor: "#F59E0B",
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4, alignItems: "baseline" }}>
              <Text style={{ fontSize: 8, fontWeight: "bold", color: "#4B5563" }}>
                Puntos de Aprobación (4.0):{" "}
              </Text>
              <Text style={{ fontSize: 8, fontWeight: "bold", color: "#F59E0B" }}>{puntosAprobacion} pts</Text>
            </View>
          </View>
        ) : null}

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
              Fortalezas (según datos registrados)
            </Text>
            <Text style={styles.feedbackText}>{pdfSafe(resumenPedagogico.fortalezas)}</Text>
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
            <Text style={styles.feedbackImproveTitle}>Áreas de mejora (según datos registrados)</Text>
            <Text style={styles.feedbackText}>{pdfSafe(resumenPedagogico.areas_mejora)}</Text>
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
              {correccionP1.map((item, index) => (
                <View key={String(index)} style={styles.tableRow}>
                  <View style={styles.tableCol}>
                    <Text style={styles.tableCell}>{pdfSafe(renderForWeb(item.seccion ?? ""))}</Text>
                  </View>
                  <View style={styles.tableColDetail}>
                    <Text style={styles.tableCell}>
                      {pdfSafe(renderForWeb(item.detalle ?? item.detalles ?? ""))}
                    </Text>
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
              {correccionP2.map((item, index) => (
                <View key={String(index)} style={styles.tableRow}>
                  <View style={styles.tableCol}>
                    <Text style={styles.tableCell}>{pdfSafe(renderForWeb(item.seccion ?? ""))}</Text>
                  </View>
                  <View style={styles.tableColDetail}>
                    <Text style={styles.tableCell}>
                      {pdfSafe(renderForWeb(item.detalle ?? item.detalles ?? ""))}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
        {group.retroalimentacion?.evaluacion_habilidades &&
        group.retroalimentacion.evaluacion_habilidades.length > 0 ? (
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
              {(group.retroalimentacion.evaluacion_habilidades as Array<{
                habilidad?: string
                evaluacion?: string
                evidencia?: string
              }>).map((item, index) => (
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
        ) : null}

        {group.retroalimentacion?.retroalimentacion_alternativas &&
        group.retroalimentacion.retroalimentacion_alternativas.length > 0 ? (
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
              {(
                group.retroalimentacion.retroalimentacion_alternativas as Array<{
                  pregunta?: string
                  respuesta_estudiante?: string
                  respuesta_correcta?: string
                }>
              ).map((item, index) => (
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
        ) : null}
      </Page>
    </Document>
  )
}
