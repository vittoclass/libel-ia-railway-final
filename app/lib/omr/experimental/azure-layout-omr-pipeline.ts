/**
 * Pipeline OMR oficial: Azure Document Intelligence (prebuilt-layout) + agrupación de selection marks.
 * Consumido solo desde app/api/evaluate/route.ts (OMR oficial).
 */
import sharp from "sharp"
import { recordAzureDiCostAuditShadow } from "@/app/lib/cost-audit/recordAzureDiCostAuditShadow"
import { recordAzureRawSnapshot } from "@/app/lib/diagnostics/azure-raw-snapshot-recorder"
import {
  resolveVisualBlankRescueModeFromEnv,
  runAzureVisualBlankRescue,
} from "@/app/lib/omr-shared/azure-visual-blank-rescue"
import { mapDualPanelsWithPautaOrchestrator } from "./azure-layout-omr-pauta-orchestrator"

export type OmrTemplateVariant = "odd_even_dual_column" | "sequential_dual_column" | "single_column"

type Mark = {
  state: "selected" | "unselected"
  polygonNorm: { x: number; y: number }[]
  centerX: number
  centerY: number
  confidence: number
}

type AnalyzePage = {
  width?: number
  height?: number
  selectionMarks?: Array<{
    state?: string
    polygon?: number[]
    confidence?: number
  }>
}

type AnalyzeResultPayload = {
  pages?: AnalyzePage[]
}

function letter(i: number): string {
  return ["A", "B", "C", "D", "E", "F", "G", "H"][i] ?? "?"
}

async function normalizeToVertical(imageBuffer: Buffer): Promise<{
  buffer: Buffer
  azureInputOrientationOriginal?: string
  azureInputOrientationAfterExif?: string
  azureInputOrientationNormalized?: string
  azureOrientationPreservedAsIs?: boolean
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

async function analyzeWithAzure(params: {
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
    new Set([params.apiVersion, ...(params.apiVersionFallbacks ?? [])].filter((v) => !!v))
  )
  const flavors: Array<"documentintelligence" | "formrecognizer"> = [
    "documentintelligence",
    "formrecognizer",
  ]
  const attemptErrors: string[] = []

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

function parseMarks(analyzeResult: AnalyzeResultPayload): { marks: Mark[] } {
  const marks: Mark[] = []
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

function clusterRowsByY(items: Array<{ idx: number; mark: Mark }>): Array<Array<{ idx: number; mark: Mark }>> {
  const sorted = [...items].sort((a, b) => a.mark.centerY - b.mark.centerY)
  const rows: Array<Array<{ idx: number; mark: Mark }>> = []
  const threshold = 0.018
  for (const it of sorted) {
    let placed = false
    for (const row of rows) {
      const ry = row[0]!.mark.centerY
      if (Math.abs(it.mark.centerY - ry) < threshold) {
        row.push(it)
        placed = true
        break
      }
    }
    if (!placed) rows.push([it])
  }
  for (const row of rows) {
    row.sort((a, b) => a.mark.centerX - b.mark.centerX)
  }
  return rows
}

function mapDualPanelsByContract(params: {
  items: Array<{ idx: number; mark: Mark }>
  variant: OmrTemplateVariant
  expectedQuestionCount?: number
  expectedOptionCount?: number
}): Array<Record<string, unknown>> {
  const splitX = 0.5
  const totalExpected =
    typeof params.expectedQuestionCount === "number" && params.expectedQuestionCount > 0
      ? params.expectedQuestionCount
      : Math.max(1, Math.ceil(params.items.length / 4))
  const half = Math.ceil(totalExpected / 2)
  const expectedOptionCount =
    typeof params.expectedOptionCount === "number" && params.expectedOptionCount >= 2
      ? Math.max(2, Math.min(8, Math.round(params.expectedOptionCount)))
      : 4

  const leftItems = params.items.filter((it) => it.mark.centerX <= splitX)
  const rightItems = params.items.filter((it) => it.mark.centerX > splitX)

  const kmeans1d = (values: number[], k: number): number[] => {
    if (!values.length) return Array.from({ length: k }, (_, i) => (i + 0.5) / k)
    const sorted = [...values].sort((a, b) => a - b)
    const centers = Array.from({ length: k }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / Math.max(1, k - 1))]!)
    for (let iter = 0; iter < 10; iter++) {
      const buckets: number[][] = Array.from({ length: k }, () => [])
      for (const v of sorted) {
        let best = 0
        let dist = Number.POSITIVE_INFINITY
        for (let i = 0; i < k; i++) {
          const d = Math.abs(v - centers[i]!)
          if (d < dist) {
            dist = d
            best = i
          }
        }
        buckets[best]!.push(v)
      }
      for (let i = 0; i < k; i++) {
        const b = buckets[i]!
        if (b.length > 0) centers[i] = b.reduce((s, v) => s + v, 0) / b.length
      }
    }
    return centers.sort((a, b) => a - b)
  }

  const nearestCenterIndex = (x: number, centers: number[]): number => {
    let best = 0
    let dist = Number.POSITIVE_INFINITY
    for (let i = 0; i < centers.length; i++) {
      const d = Math.abs(x - centers[i]!)
      if (d < dist) {
        dist = d
        best = i
      }
    }
    return best
  }

  const mkForPanel = (
    panelItems: Array<{ idx: number; mark: Mark }>,
    panelQuestionCount: number,
    panelIndex: 0 | 1,
    qResolver: (rowIndex: number) => number
  ): Array<Record<string, unknown>> => {
    if (panelQuestionCount <= 0) return []
    const xs = panelItems.map((it) => it.mark.centerX)
    const ys = panelItems.map((it) => it.mark.centerY)
    const minY = ys.length ? Math.min(...ys) : 0
    const maxY = ys.length ? Math.max(...ys) : 1
    const minX = xs.length ? Math.min(...xs) : panelIndex === 0 ? 0 : splitX
    const maxX = xs.length ? Math.max(...xs) : panelIndex === 0 ? splitX : 1
    const dy = Math.max(1e-6, maxY - minY)
    const dx = Math.max(1e-6, maxX - minX)
    const rowBuckets: Array<Array<{ idx: number; mark: Mark; localX: number }>> = Array.from(
      { length: panelQuestionCount },
      () => []
    )
    for (const it of panelItems) {
      const rowNorm = (it.mark.centerY - minY) / dy
      const rowIdx = Math.max(0, Math.min(panelQuestionCount - 1, Math.round(rowNorm * (panelQuestionCount - 1))))
      const localX = (it.mark.centerX - minX) / dx
      rowBuckets[rowIdx]!.push({ ...it, localX })
    }

    const panelNoiseBaseCandidates = panelItems
      .filter((it) => it.mark.state !== "selected")
      .map((it) => it.mark.confidence)
      .sort((a, b) => a - b)
    const panelNoiseBase =
      panelNoiseBaseCandidates.length > 0
        ? panelNoiseBaseCandidates[Math.floor(panelNoiseBaseCandidates.length * 0.7)]!
        : 0.7
    const sensitivityThreshold = Math.max(0.55, Math.min(0.92, panelNoiseBase + 0.1))
    const centers = kmeans1d(
      panelItems.map((it) => (it.mark.centerX - minX) / dx),
      expectedOptionCount
    )

    const out: Array<Record<string, unknown>> = []
    for (let rowIdx = 0; rowIdx < panelQuestionCount; rowIdx++) {
      const q = qResolver(rowIdx)
      const bucket = rowBuckets[rowIdx] ?? []
      const byOption = new Map<number, { idx: number; confidence: number; state: "selected" | "unselected" }>()
      for (const mark of bucket) {
        const optionIdx = nearestCenterIndex(mark.localX, centers)
        const prev = byOption.get(optionIdx)
        if (!prev || mark.mark.confidence > prev.confidence) {
          byOption.set(optionIdx, {
            idx: mark.idx,
            confidence: mark.mark.confidence,
            state: mark.mark.state,
          })
        }
      }
      const confidencesByColumn: Record<string, number> = {}
      for (let i = 0; i < expectedOptionCount; i++) {
        const hit = byOption.get(i)
        if (hit) confidencesByColumn[letter(i)] = Number(hit.confidence.toFixed(4))
      }
      const candidates = Array.from(byOption.entries()).sort((a, b) => b[1].confidence - a[1].confidence)
      const selectedCandidates = candidates.filter(([, v]) => v.state === "selected")
      let chosen = selectedCandidates[0]?.[1] ?? null
      let chosenIdx = selectedCandidates[0]?.[0] ?? -1
      if (!chosen && candidates.length > 0) {
        const best = candidates[0]!
        if (best[1].confidence >= sensitivityThreshold) {
          chosen = best[1]
          chosenIdx = best[0]
        }
      }
      const selectedAnswer = chosen && chosenIdx >= 0 ? letter(chosenIdx) : "BLANK"
      out.push({
        questionNumber: q,
        panelIndex,
        rowIndexWithinPanel: rowIdx,
        selectedAnswer,
        assignedDetectionIndices: chosen ? [chosen.idx] : [],
        confidencesByColumn,
        observedFromSensors: bucket.length > 0,
      })
    }
    return out
  }

  const perQ: Array<Record<string, unknown>> = []
  const leftCount = params.variant === "sequential_dual_column" ? half : Math.ceil(totalExpected / 2)
  const rightCount = totalExpected - leftCount
  if (params.variant === "sequential_dual_column") {
    perQ.push(
      ...mkForPanel(leftItems, leftCount, 0, (rowIdx) => rowIdx + 1),
      ...mkForPanel(rightItems, rightCount, 1, (rowIdx) => leftCount + rowIdx + 1),
    )
  } else {
    perQ.push(
      ...mkForPanel(leftItems, leftCount, 0, (rowIdx) => rowIdx * 2 + 1),
      ...mkForPanel(rightItems, rightCount, 1, (rowIdx) => (rowIdx + 1) * 2),
    )
  }

  return perQ.sort((a, b) => Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0))
}

export async function runAzureLayoutOmrPipeline(params: {
  imageBuffer: Buffer
  templateKey: string
  expectedQuestionCount?: number
  expectedOptionCount?: number
  canonicalWidth: number
  canonicalHeight: number
  omrTemplateVariant?: OmrTemplateVariant
  /** Orden pauta (solo isDevelopment): orquestador Y sin tocar parseMarks/clusterRowsByY. */
  pautaSegmentationItems?: Array<{ isDevelopment: boolean }>
}): Promise<Record<string, unknown>> {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
  if (!endpoint || !key) {
    return {
      success: false,
      omrMode: "azure_layout_omr",
      errorCode: "AZURE_LAYOUT_NOT_CONFIGURED",
      error: "Faltan AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT o AZURE_DOCUMENT_INTELLIGENCE_KEY",
    }
  }

  const apiVersion = "2024-11-30"
  const orientation = await normalizeToVertical(params.imageBuffer)
  const analyze = await analyzeWithAzure({
    endpoint,
    key,
    imageBuffer: orientation.buffer,
    apiVersion,
    apiVersionFallbacks: ["2024-07-31-preview", "2023-07-31"],
  })

  if (!analyze.ok) {
    return {
      success: false,
      omrMode: "azure_layout_omr",
      errorCode: analyze.errorCode,
      error: analyze.error,
      azureInputOrientationNormalized: orientation.azureOrientationNormalizationReason,
      azureAnalyzeUsedNormalizedBuffer: orientation.azureAnalyzeUsedNormalizedBuffer,
    }
  }

  recordAzureDiCostAuditShadow({
    operation: "omr_official_azure_layout",
    model: "prebuilt-layout",
    pagesProcessed: analyze.analyzeResult.pages?.length ?? 1,
    filesProcessed: 1,
  })

  // FASE R.13: snapshot pasivo local de selectionMarks crudos (antes de parseMarks/OMR).
  // Fail-soft; no muta analyzeResult; flag LIBELIA_AZURE_RAW_SNAPSHOT=1.
  recordAzureRawSnapshot(analyze.analyzeResult)

  const parsed = parseMarks(analyze.analyzeResult)
  const normalizeMarksAffine = (marks: Mark[]): Mark[] => {
    if (!marks.length) return marks
    const xs = marks.map((m) => m.centerX)
    const ys = marks.map((m) => m.centerY)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const dx = Math.max(1e-6, maxX - minX)
    const dy = Math.max(1e-6, maxY - minY)
    return marks.map((m) => ({
      ...m,
      centerX: (m.centerX - minX) / dx,
      centerY: (m.centerY - minY) / dy,
      polygonNorm: m.polygonNorm.map((p) => ({ x: (p.x - minX) / dx, y: (p.y - minY) / dy })),
    }))
  }
  const normalizedMarks = normalizeMarksAffine(parsed.marks)
  const indexedMarks = normalizedMarks.map((m, i) => ({ idx: i, mark: m }))
  const forceDualByTemplate = /^template_38_4($|[_-])/i.test(String(params.templateKey ?? ""))
  const expected =
    typeof params.expectedQuestionCount === "number" && params.expectedQuestionCount > 0
      ? params.expectedQuestionCount
      : undefined
  const expectedOptionCount =
    typeof params.expectedOptionCount === "number" && params.expectedOptionCount >= 2
      ? Math.max(2, Math.min(8, Math.round(params.expectedOptionCount)))
      : 4

  const variant: OmrTemplateVariant =
    params.omrTemplateVariant === "single_column"
      ? "single_column"
      : params.omrTemplateVariant === "sequential_dual_column"
        ? "sequential_dual_column"
        : "odd_even_dual_column"
  const questionBlocksPerRow = forceDualByTemplate || variant !== "single_column" ? 2 : 1

  let perQuestion: Array<Record<string, unknown>>
  let orchestratorQuestionOrder: string | null = null
  if (questionBlocksPerRow === 2) {
    const om = mapDualPanelsWithPautaOrchestrator({
      items: indexedMarks,
      variant,
      expectedQuestionCount: expected,
      expectedOptionCount,
      pautaItems: params.pautaSegmentationItems ?? [],
      legacyMapDual: mapDualPanelsByContract,
    })
    perQuestion = om.perQuestion
    orchestratorQuestionOrder = om.questionOrderSource
  } else {
    const rows = clusterRowsByY(indexedMarks)
    perQuestion = rows.map((r, i) => {
      const sortedByX = [...r].sort((a, b) => a.mark.centerX - b.mark.centerX)
      const confidencesByColumn: Record<string, number> = {}
      sortedByX.forEach((item, idx) => {
        confidencesByColumn[letter(idx)] = Number(item.mark.confidence.toFixed(4))
      })
      const selected = r.filter((x) => x.mark.state === "selected")
      let selectedAnswer = "BLANK"
      if (selected.length === 1) {
        const selectedIdx = sortedByX.findIndex((x) => x.idx === selected[0]!.idx)
        selectedAnswer = selectedIdx >= 0 ? letter(selectedIdx) : "BLANK"
      } else if (selected.length > 1) {
        selectedAnswer = "MULTIPLE"
      }
      return {
        questionNumber: i + 1,
        panelIndex: 0,
        rowIndexWithinPanel: i,
        selectedAnswer,
        assignedDetectionIndices: selected.map((x) => x.idx),
        confidencesByColumn,
        observedFromSensors: true,
      }
    })
  }

  const out = [...perQuestion]
  if (expected && out.length < expected) {
    const seen = new Set(out.map((q) => Number(q.questionNumber)))
    for (let q = 1; q <= expected; q++) {
      if (!seen.has(q)) {
        out.push({
          questionNumber: q,
          panelIndex: 0,
          rowIndexWithinPanel: out.length,
          selectedAnswer: "BLANK",
          assignedDetectionIndices: [],
          confidencesByColumn: {},
          observedFromSensors: false,
          inferredBlank: true,
          completedByExpectation: true,
        })
      }
    }
  }
  out.sort((a, b) => Number(a.questionNumber) - Number(b.questionNumber))

  // FASE R.20: rescate visual anti-BLANK — SHADOW only; APPLY hard-blocked (never mutates out).
  try {
    const rescueMode = resolveVisualBlankRescueModeFromEnv()
    if (rescueMode !== "off") {
      const meta = await sharp(orientation.buffer).metadata()
      const imageWidth = meta.width ?? 0
      const imageHeight = meta.height ?? 0
      // R.20: even if APPLY=1 by mistake, force shadow so out is never modified.
      await runAzureVisualBlankRescue({
        imageBuffer: orientation.buffer,
        imageWidth,
        imageHeight,
        marks: parsed.marks,
        rows: out.map((row) => ({
          questionNumber: Number(row.questionNumber),
          selectedAnswer: typeof row.selectedAnswer === "string" ? row.selectedAnswer : undefined,
          inferredBlank: row.inferredBlank === true,
          completedByExpectation: row.completedByExpectation === true,
        })),
        expectedQuestionCount: expected ?? out.length,
        expectedOptionCount,
        variant,
        mode: "shadow",
      })
      // Intentionally ignore proposedRows; do not assign to out.
    }
  } catch {
    // fail-soft
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${params.canonicalWidth}" height="${params.canonicalHeight}" viewBox="0 0 ${params.canonicalWidth} ${params.canonicalHeight}">${parsed.marks
    .map((m) => {
      const pts = m.polygonNorm
        .map((p) => `${(p.x * params.canonicalWidth).toFixed(1)},${(p.y * params.canonicalHeight).toFixed(1)}`)
        .join(" ")
      const c = m.state === "selected" ? "#16a34a" : m.state === "unselected" ? "#d97706" : "#64748b"
      return `<polygon points="${pts}" fill="none" stroke="${c}" stroke-width="2"/>`
    })
    .join("")}</svg>`
  const overlay = await sharp(Buffer.from(svg)).png().toBuffer()

  return {
    success: true,
    omrMode: "azure_layout_omr",
    azureLayoutModel: "prebuilt-layout",
    azureApiVersion: analyze.azureApiVersionUsed,
    azureEndpointFlavorUsed: analyze.azureEndpointFlavorUsed,
    perQuestion: out,
    questionAssignments: [],
    observedQuestionsCount: perQuestion.length,
    completedMissingQuestionsCount: Math.max(0, out.length - perQuestion.length),
    questionOrderSource:
      questionBlocksPerRow === 2
        ? orchestratorQuestionOrder === "pauta_orchestrator_odd_even_y_resync"
          ? orchestratorQuestionOrder
          : forceDualByTemplate
            ? "template_forced_dual_columns"
            : (orchestratorQuestionOrder ?? "azure_table_rows_then_x_columns")
        : "azure_marks_fallback_y_sort",
    templateKey: params.templateKey,
    omrTemplateVariant: variant,
    questionBlocksPerRow,
    overlayPngBase64: overlay.toString("base64"),
    ...orientation,
  }
}
