import sharp from "sharp"
import {
  DocumentAnalysisClient,
  AzureKeyCredential,
  type DocumentSelectionMark,
  type Point2D,
} from "@azure/ai-form-recognizer"

export interface OMRResultItem {
  id: string
  type: "multiple_choice" | "true_false" | "pairing" | "unknown"
  value?: string
  raw: string
  confidence: number
  bbox?: [number, number, number, number]
  warnings?: string[]
}

export interface OMRResult {
  success: boolean
  items: OMRResultItem[]
  warnings: string[]
  confidenceAvg: number
  processingTimeMs: number
}

type Mark = {
  polygon: Point2D[]
  confidence: number
  state: string
}

export async function processOMR(
  imageBuffer: Buffer,
  mimeType: string
): Promise<OMRResult> {
  const start = Date.now()
  const warnings: string[] = []

  try {
    let inputBuffer = imageBuffer
    if (!mimeType.includes("jpeg") && !mimeType.includes("png")) {
      inputBuffer = await sharp(imageBuffer).jpeg({ quality: 90 }).toBuffer()
    }

    const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
    const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
    if (!endpoint || !key) throw new Error("Credenciales de Azure faltantes")

    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key))
    const poller = await client.beginAnalyzeDocument("prebuilt-read", inputBuffer)
    const { pages } = await poller.pollUntilDone()

    const items: OMRResultItem[] = []
    let itemIndex = 1

    for (const page of pages ?? []) {
      // ✅ NO tipamos Mark[] antes de filtrar/normalizar
      const marks: Mark[] = (page.selectionMarks ?? [])
        .filter(
          (m): m is DocumentSelectionMark & { polygon: Point2D[] } =>
            m.state === "selected" &&
            m.confidence != null &&
            m.confidence >= 0.85 &&
            Array.isArray(m.polygon) &&
            m.polygon.length >= 3 &&
            m.polygon[0]?.x != null &&
            m.polygon[0]?.y != null
        )
        .map(
          (m): Mark => ({
            polygon: m.polygon,
            confidence: m.confidence ?? 0,
            state: m.state ?? "selected",
          })
        )
        .sort((a, b) => {
          const yA = a.polygon[0].y
          const yB = b.polygon[0].y
          if (Math.abs(yA - yB) < 20) return a.polygon[0].x - b.polygon[0].x
          return yA - yB
        })

      const rows: Mark[][] = []
      for (const mark of marks) {
        const y = mark.polygon[0].y
        const row = rows.find((r) => Math.abs(r[0].polygon[0].y - y) < 15)
        if (row) row.push(mark)
        else rows.push([mark])
      }

      for (const row of rows) {
        const sorted = row.sort((a, b) => a.polygon[0].x - b.polygon[0].x)

        const id = `P${itemIndex++}`
        const type = sorted.length === 2 ? "true_false" : "multiple_choice"

        const letters = ["A", "B", "C", "D", "E", "F", "G"]
        const value = letters[Math.min(sorted.length - 1, letters.length - 1)]

        const first = sorted[0].polygon[0]
        const lastPoly = sorted[sorted.length - 1].polygon
        const lastPoint = lastPoly[2] ?? lastPoly[lastPoly.length - 1]

        const bbox: [number, number, number, number] = [
          first.x,
          first.y,
          (lastPoint.x ?? first.x) - first.x,
          (lastPoint.y ?? first.y) - first.y,
        ]

        items.push({
          id,
          type,
          value,
          raw: "",
          confidence: Math.min(...sorted.map((m) => m.confidence)),
          bbox,
        })
      }
    }

    const confidenceAvg = items.length
      ? items.reduce((s, i) => s + i.confidence, 0) / items.length
      : 0

    return {
      success: true,
      items,
      warnings,
      confidenceAvg,
      processingTimeMs: Date.now() - start,
    }
  } catch (err) {
    return {
      success: false,
      items: [],
      warnings: [`Error OMR: ${err instanceof Error ? err.message : "fallo"}`],
      confidenceAvg: 0,
      processingTimeMs: Date.now() - start,
    }
  }
}
