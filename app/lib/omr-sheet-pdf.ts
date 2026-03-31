/**
 * Generación de PDF de la hoja OMR estándar LibelIA.
 * Solo cliente; no modifica OMR existente ni APIs.
 */
import {
  MARGIN_MM,
  MARKER_SIZE_MM,
  CONTENT_WIDTH_MM,
  CONTENT_HEIGHT_MM,
  INNER_LEFT_MM,
  INNER_TOP_MM,
  HEADER_HEIGHT_MM,
  BUBBLE_RADIUS_MM,
  getBubblePositions,
  LIBELIA_OMR_ASPECT_RATIO,
  type OmrTemplateVariant,
} from "./omr-sheet-spec"
import { getLibelIAArUcoMarkerDataUrls } from "./omr-sheet-aruco"

export { LIBELIA_OMR_ASPECT_RATIO }

export type OMRSheetOptions = {
  numQuestions: number
  options: string[] // e.g. ["A","B","C","D"] or ["A","B","C","D","E"]
  variant: "student" | "key"
  keyAnswers?: string[] // for variant "key": answer per question, e.g. ["A","B","C",...]
  title?: string
  /** Si es "libelia_standard_v2", se dibujan fiduciales ArUco en lugar de cuadrados. */
  sheetSpec?: "libelia_standard_v1" | "libelia_standard_v2"
  /** Orden de numeración en 2 columnas: pares/impares o continuo/secuencial. */
  omrTemplateVariant?: OmrTemplateVariant
}

// eslint-disable-next-line
function drawMarkers(doc: any): void {
  doc.setFillColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)
  const corners = [
    [MARGIN_MM, MARGIN_MM],
    [MARGIN_MM + CONTENT_WIDTH_MM - MARKER_SIZE_MM, MARGIN_MM],
    [
      MARGIN_MM + CONTENT_WIDTH_MM - MARKER_SIZE_MM,
      MARGIN_MM + CONTENT_HEIGHT_MM - MARKER_SIZE_MM,
    ],
    [MARGIN_MM, MARGIN_MM + CONTENT_HEIGHT_MM - MARKER_SIZE_MM],
  ]
  corners.forEach(([x, y]) => {
    doc.rect(x, y, MARKER_SIZE_MM, MARKER_SIZE_MM, "F")
  })
}

// eslint-disable-next-line
function drawHeader(
  doc: any,
  variant: "student" | "key",
  title: string
): void {
  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text(title || "LibelIA OMR", INNER_LEFT_MM, INNER_TOP_MM + 6)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.text("Nombre: _________________________________________", INNER_LEFT_MM, INNER_TOP_MM + 12)
  doc.text("Curso: _________________________________________", INNER_LEFT_MM, INNER_TOP_MM + 18)
  if (variant === "key") {
    doc.setTextColor(180, 0, 0)
    doc.text("CLAVE CORRECTA — No entregar al estudiante", INNER_LEFT_MM, INNER_TOP_MM + 24)
    doc.setTextColor(0, 0, 0)
  }
}

// eslint-disable-next-line
function drawBubbles(
  doc: any,
  numQuestions: number,
  numOptions: number,
  keyAnswers?: string[],
  omrTemplateVariant: OmrTemplateVariant = "odd_even_dual_column"
): void {
  const positions = getBubblePositions(numQuestions, numOptions, omrTemplateVariant)
  const optionLabels = "ABCDEFGH".slice(0, numOptions).split("")

  positions.forEach(({ q, optionIndex, cx, cy }) => {
    const label = optionLabels[optionIndex]
    const isCorrect = keyAnswers && keyAnswers[q - 1] === label
    doc.setDrawColor(0, 0, 0)
    if (isCorrect) {
      doc.setFillColor(0, 0, 0)
      doc.circle(cx, cy, BUBBLE_RADIUS_MM, "F")
      doc.circle(cx, cy, BUBBLE_RADIUS_MM, "S")
    } else {
      doc.setFillColor(255, 255, 255)
      doc.circle(cx, cy, BUBBLE_RADIUS_MM, "S")
    }
  })

  // Question numbers (draw once per question, left of first bubble)
  const seen = new Set<number>()
  positions.forEach(({ q, optionIndex, cx, cy }) => {
    if (optionIndex !== 0) return
    if (seen.has(q)) return
    seen.add(q)
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    doc.text(String(q) + ".", cx - 6, cy + 0.4)
  })
}

/**
 * Genera el PDF de la hoja OMR y devuelve el blob para descarga.
 */
export async function generateOMRSheetPDF(opts: OMRSheetOptions): Promise<Blob> {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  })

  const { numQuestions, options, variant, keyAnswers, title, sheetSpec, omrTemplateVariant } = opts
  const numOptions = options.length

  if (sheetSpec === "libelia_standard_v2") {
    try {
      const markerUrls = await getLibelIAArUcoMarkerDataUrls()
      const corners = [
        [MARGIN_MM, MARGIN_MM],
        [MARGIN_MM + CONTENT_WIDTH_MM - MARKER_SIZE_MM, MARGIN_MM],
        [
          MARGIN_MM + CONTENT_WIDTH_MM - MARKER_SIZE_MM,
          MARGIN_MM + CONTENT_HEIGHT_MM - MARKER_SIZE_MM,
        ],
        [MARGIN_MM, MARGIN_MM + CONTENT_HEIGHT_MM - MARKER_SIZE_MM],
      ]
      for (let i = 0; i < 4; i++) {
        doc.addImage(
          markerUrls[i],
          "PNG",
          corners[i][0],
          corners[i][1],
          MARKER_SIZE_MM,
          MARKER_SIZE_MM
        )
      }
    } catch {
      drawMarkers(doc)
    }
  } else {
    drawMarkers(doc)
  }

  const sheetTitle =
    title || (variant === "key" ? "LibelIA OMR — Clave correcta" : "LibelIA OMR — Hoja de respuestas")
  drawHeader(doc, variant, sheetTitle)
  drawBubbles(
    doc,
    numQuestions,
    numOptions,
    variant === "key" ? keyAnswers : undefined,
    omrTemplateVariant ?? "odd_even_dual_column"
  )

  return doc.output("blob")
}

/**
 * Nombre de archivo sugerido para la hoja generada.
 */
export function getOMRSheetFilename(
  variant: "student" | "key",
  numQuestions: number
): string {
  const base = variant === "student" ? "libelia_omr_estudiante" : "libelia_omr_clave"
  return `${base}_${numQuestions}.pdf`
}
