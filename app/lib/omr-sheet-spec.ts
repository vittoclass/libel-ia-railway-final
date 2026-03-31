/**
 * Especificación de la hoja OMR estándar LibelIA.
 * Diseño fijo para impresión, cámara y pipeline de lectura.
 * No modifica OMR existente ni APIs.
 */

export const PAGE_WIDTH_MM = 210
export const PAGE_HEIGHT_MM = 297
export const MARGIN_MM = 15
export const MARKER_SIZE_MM = 12
export const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - 2 * MARGIN_MM
export const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - 2 * MARGIN_MM

/** Área interior (dentro de los marcadores): para título, nombre, curso y preguntas. */
export const INNER_LEFT_MM = MARGIN_MM + MARKER_SIZE_MM
export const INNER_TOP_MM = MARGIN_MM + MARKER_SIZE_MM
export const INNER_WIDTH_MM = CONTENT_WIDTH_MM - 2 * MARKER_SIZE_MM
export const INNER_HEIGHT_MM = CONTENT_HEIGHT_MM - 2 * MARKER_SIZE_MM

/** Relación de aspecto del área interior. Usar como templateAspectRatio en el pipeline OMR. */
export const LIBELIA_OMR_ASPECT_RATIO = INNER_WIDTH_MM / INNER_HEIGHT_MM

export const BUBBLE_RADIUS_MM = 2
export const BUBBLE_SPACING_MM = 6
export const ROW_HEIGHT_MM = 6
export const COLUMNS = 2
export const HEADER_HEIGHT_MM = 28
export const QUESTION_NUMBER_WIDTH_MM = 8

export type BubblePosition = { q: number; optionIndex: number; cx: number; cy: number }
export type OmrTemplateVariant = "odd_even_dual_column" | "sequential_dual_column"

/**
 * Devuelve las posiciones (centro en mm) de cada burbuja para el grid de preguntas.
 * q = 1..numQuestions, optionIndex = 0..numOptions-1.
 * Orden compatible con omr-grid-reader: columnas = 2, filas = ceil(numQuestions/2).
 */
export function getBubblePositions(
  numQuestions: number,
  numOptions: number,
  templateVariant: OmrTemplateVariant = "odd_even_dual_column"
): BubblePosition[] {
  const positions: BubblePosition[] = []
  const rowsPerColumn = Math.ceil(numQuestions / COLUMNS)
  const colWidth = INNER_WIDTH_MM / COLUMNS
  const startY = INNER_TOP_MM + HEADER_HEIGHT_MM

  for (let q = 1; q <= numQuestions; q++) {
    const isSequential = templateVariant === "sequential_dual_column"
    const col = isSequential ? (q > rowsPerColumn ? 1 : 0) : (q - 1) % COLUMNS
    const row = isSequential
      ? q > rowsPerColumn
        ? q - rowsPerColumn - 1
        : q - 1
      : Math.floor((q - 1) / COLUMNS)
    const xBase = INNER_LEFT_MM + col * colWidth + QUESTION_NUMBER_WIDTH_MM
    const yRow = startY + row * ROW_HEIGHT_MM + ROW_HEIGHT_MM / 2
    for (let o = 0; o < numOptions; o++) {
      const cx = xBase + o * BUBBLE_SPACING_MM
      positions.push({ q, optionIndex: o, cx, cy: yRow })
    }
  }
  return positions
}

/** Esquinas del área de contenido (centro de los marcadores) para referencia. */
export function getMarkerCorners(): { x: number; y: number }[] {
  const half = MARKER_SIZE_MM / 2
  return [
    { x: MARGIN_MM + half, y: MARGIN_MM + half },
    { x: MARGIN_MM + CONTENT_WIDTH_MM - half, y: MARGIN_MM + half },
    {
      x: MARGIN_MM + CONTENT_WIDTH_MM - half,
      y: MARGIN_MM + CONTENT_HEIGHT_MM - half,
    },
    { x: MARGIN_MM + half, y: MARGIN_MM + CONTENT_HEIGHT_MM - half },
  ]
}
