// app/lib/omr/OmniOMRProcessor.ts
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

/** Tipo interno normalizado (polygon YA garantizado) */
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
    // Preprocesamiento de imagen
    let inputBuffer = imageBuffer
    if (!mimeType.includes("jpeg") && !mimeType.includes("png")) {
      inputBuffer = await sharp(imageBuffer).jpeg({ quality: 90 }).toBuffer()
    }

    const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
    const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
    if (!endpoint || !key) {
      throw new Error("Credenciales de Azure faltantes")
    }

    const client = new DocumentAnalysisClient(
      endpoint,
      new AzureKeyCredential(key)
    )

    const poller = await client.beginAnalyzeDocument(
      "prebuilt-read",
      inputBuffer
    )

    const { pages } = await poller.pollUntilDone()

    const items: OMRResultItem[] = []
    let index = 1

    for (const page of pages ?? []) {
      /** 🔒 NORMALIZACIÓN SEGURA (TS feliz) */
      const marks = (page.selectionMarks ?? [])
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
          const ay = a.polygon[0].y
          const by = b.polygon[0].y
          if (Math.abs(ay - by) < 20) {
            return a.polygon[0].x - b.polygon[0].x
          }
          return ay - by
        })

      // Agrupación por filas
      const rows: Mark[][] = []
      for (const m of marks) {
        const y = m.polygon[0].y
        const row = rows.find((r) => Math.abs(r[0].polygon[0].y - y) < 15)
        row ? row.push(m) : rows.push([m])
      }

      // Conversión a ítems OMR
      for (const row of rows) {
        const sorted = row.sort((a, b) => a.polygon[0].x - b.polygon[0].x)

        const letters = ["A", "B", "C", "D", "E", "F"]
        const value = letters[Math.min(sorted.length - 1, letters.length - 1)]

        const first = sorted[0].polygon[0]
        const lastPoly = sorted.at(-1)!.polygon
        const last = lastPoly[lastPoly.length - 1]

        items.push({
          id: `P${index++}`,
          type: sorted.length === 2 ? "true_false" : "multiple_choice",
          value,
          raw: "",
          confidence: Math.min(...sorted.map((m) => m.confidence)),
          bbox: [first.x, first.y, last.x - first.x, last.y - first.y],
        })
      }
    }

    const confidenceAvg =
      items.reduce((s, i) => s + i.confidence, 0) / Math.max(1, items.length)

    return {
      success: true,
      items,
      warnings,
      confidenceAvg,
      processingTimeMs: Date.now() - start,
    }
  } catch (err: any) {
    return {
      success: false,
      items: [],
      warnings: [err?.message ?? "Error OMR"],
      confidenceAvg: 0,
      processingTimeMs: Date.now() - start,
    }
  }
}
