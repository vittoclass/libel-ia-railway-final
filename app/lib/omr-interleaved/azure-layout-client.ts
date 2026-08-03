/**
 * Cliente Azure Layout aislado (duplicado mínimo del pipeline estable).
 * No importa ni modifica app/lib/omr/experimental/azure-layout-omr-pipeline.ts
 */
import sharp from "sharp"
import { recordAzureDiCostAuditShadow } from "@/app/lib/cost-audit/recordAzureDiCostAuditShadow"
import { recordAzureRawSnapshot } from "@/app/lib/diagnostics/azure-raw-snapshot-recorder"
import type { LayoutMark } from "./types"

export type AnalyzeLine = { content?: string; polygon?: number[] }

export type AnalyzePage = {
  width?: number
  height?: number
  selectionMarks?: Array<{
    state?: string
    polygon?: number[]
    confidence?: number
  }>
  lines?: AnalyzeLine[]
}

export type AnalyzeResultPayload = {
  pages?: AnalyzePage[]
}

export async function normalizeToVerticalInterleaved(imageBuffer: Buffer): Promise<{
  buffer: Buffer
  azureAnalyzeUsedNormalizedBuffer?: boolean
  azureAutoRotationApplied?: boolean
  azureRotationDegreesApplied?: number
  azureOrientationNormalizationReason?: string
}> {
  const rotated = await sharp(imageBuffer).rotate().png().toBuffer()
  return {
    buffer: rotated,
    azureAnalyzeUsedNormalizedBuffer: true,
    azureAutoRotationApplied: true,
    azureRotationDegreesApplied: 0,
    azureOrientationNormalizationReason: "sharp_exif_rotate",
  }
}

export async function analyzeLayoutWithAzure(params: {
  endpoint: string
  key: string
  imageBuffer: Buffer
  apiVersion: string
  apiVersionFallbacks?: string[]
}): Promise<
  | {
      ok: true
      analyzeResult: AnalyzeResultPayload
      azureApiVersionUsed: string
      azureEndpointFlavorUsed: "documentintelligence" | "formrecognizer"
    }
  | { ok: false; errorCode: string; error: string }
> {
  const base = params.endpoint.replace(/\/$/, "")
  const baseNoFlavor = base.replace(/\/(documentintelligence|formrecognizer)$/i, "")
  const versions = Array.from(
    new Set([params.apiVersion, ...(params.apiVersionFallbacks ?? [])].filter((v) => !!v)),
  )
  const flavors: Array<"documentintelligence" | "formrecognizer"> = ["documentintelligence", "formrecognizer"]
  const attemptErrors: string[] = []
  const t0 = Date.now()

  for (const version of versions) {
    for (const flavor of flavors) {
      const url = `${baseNoFlavor}/${flavor}/documentModels/prebuilt-layout:analyze?api-version=${version}`
      const initRes = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": params.key,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(params.imageBuffer),
      })

      if (initRes.status !== 202) {
        const errText = await initRes.text()
        attemptErrors.push(`${flavor}@${version}: HTTP ${initRes.status} ${errText.slice(0, 200)}`)
        continue
      }

      const operationLocation = initRes.headers.get("Operation-Location")
      if (!operationLocation) {
        attemptErrors.push(`${flavor}@${version}: sin Operation-Location`)
        continue
      }

      const maxAttempts = 45
      const delayMs = 1000
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, delayMs))
        const res = await fetch(operationLocation, {
          method: "GET",
          headers: { "Ocp-Apim-Subscription-Key": params.key },
        })
        const data = (await res.json()) as {
          status?: string
          analyzeResult?: AnalyzeResultPayload
          result?: AnalyzeResultPayload
        }
        const ar = data.analyzeResult ?? data.result
        if (data.status === "succeeded" && ar) {
          recordAzureDiCostAuditShadow({
            operation: "omr_interleaved_azure_layout",
            model: "prebuilt-layout",
            pagesProcessed: ar.pages?.length ?? 1,
            filesProcessed: 1,
            durationMs: Date.now() - t0,
          })
          // FASE R.7: snapshot pasivo local de selectionMarks crudos (antes de OMR).
          // Fail-soft; no muta ar; flag LIBELIA_AZURE_RAW_SNAPSHOT=1.
          recordAzureRawSnapshot(ar)
          return {
            ok: true,
            analyzeResult: ar,
            azureApiVersionUsed: version,
            azureEndpointFlavorUsed: flavor,
          }
        }
        if (data.status === "failed") {
          attemptErrors.push(`${flavor}@${version}: análisis failed`)
          break
        }
      }
      attemptErrors.push(`${flavor}@${version}: timeout`)
    }
  }

  return {
    ok: false,
    errorCode: "AZURE_LAYOUT_ANALYZE_FAILED",
    error:
      attemptErrors.length > 0
        ? `No se pudo analizar en ninguna combinación. ${attemptErrors.join(" | ")}`
        : "No se pudo analizar en ninguna combinación",
  }
}

export function parseSelectionMarks(analyzeResult: AnalyzeResultPayload): { marks: LayoutMark[] } {
  const marks: LayoutMark[] = []
  for (const page of analyzeResult.pages ?? []) {
    const w = page.width && page.width > 0 ? page.width : 1
    const h = page.height && page.height > 0 ? page.height : 1
    for (const sm of page.selectionMarks ?? []) {
      const poly = sm.polygon
      if (!poly || poly.length < 4) continue
      const xs: number[] = []
      const ys: number[] = []
      for (let i = 0; i + 1 < poly.length; i += 2) {
        xs.push(poly[i]! / w)
        ys.push(poly[i + 1]! / h)
      }
      if (xs.length === 0) continue
      const centerX = xs.reduce((a, b) => a + b, 0) / xs.length
      const centerY = ys.reduce((a, b) => a + b, 0) / ys.length
      const st = String(sm.state || "").toLowerCase()
      const state: "selected" | "unselected" = st === "selected" ? "selected" : "unselected"
      const confidence = typeof sm.confidence === "number" ? sm.confidence : 1
      marks.push({
        state,
        polygonNorm: xs.map((x, j) => ({ x, y: ys[j] ?? 0 })),
        centerX,
        centerY,
        confidence,
      })
    }
  }
  return { marks }
}
