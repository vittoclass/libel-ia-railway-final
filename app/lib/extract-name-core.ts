import { ComputerVisionClient } from "@azure/cognitiveservices-computervision"
import { ApiKeyCredentials } from "@azure/ms-rest-js"
import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer"
import OpenAI from "openai"
import { findBestMatch } from "string-similarity"
import { recordAzureDiCostAuditShadow } from "@/app/lib/cost-audit/recordAzureDiCostAuditShadow"
import { recordProviderCostAuditShadow } from "@/app/lib/cost-audit/recordProviderCostAuditShadow"

const AZURE_VISION_ENDPOINT = process.env.AZURE_VISION_ENDPOINT!
const AZURE_VISION_KEY = process.env.AZURE_VISION_KEY!
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY!
const openai = new OpenAI({ apiKey: MISTRAL_API_KEY, baseURL: "https://api.mistral.ai/v1" })

const COMBINED_TEXT_PREVIEW_MAX = 500

export type ExtractNameMode = "direct_label" | "fuzzy_matching" | "ai_fallback" | "no_ocr_text"

export type ExtractNameOcrSource =
  | "azure_vision"
  | "document_intelligence"
  | "azure_vision_then_document_intelligence"
  | "none"

export type ExtractNameErrorStage =
  | "no_files"
  | "azure_vision"
  | "document_intelligence"
  | "ocr_empty"
  | "ai_fallback"
  | "pipeline"
  | null

export type ExtractNameOcrPerFile = {
  fileName: string
  text: string
  charCount: number
  ocrSource: "azure_vision" | "document_intelligence" | "none"
}

export type ExtractNameFuzzyRating = {
  target: string
  rating: number
}

export type ExtractNameAudit = {
  ocrPerFile: ExtractNameOcrPerFile[]
  combinedText: string
  mode: ExtractNameMode
  nameListCount: number
  nameListParseError: string | null
  fuzzyRatingsTop10: ExtractNameFuzzyRating[] | null
  aiPromptExcerpt: string | null
  files_count: number
  mime_types: string[]
  azure_vision_text_length: number
  document_intelligence_used: boolean
  document_intelligence_text_length: number
  combined_text_preview: string
  ai_fallback_used: boolean
  suggestions_count: number
  error_stage: ExtractNameErrorStage
  ocr_source: ExtractNameOcrSource
  direct_label_name_detected: boolean
  direct_label_pattern: string | null
  direct_label_raw_value: string | null
  direct_label_normalized: string | null
}

export type ExtractNameFileInput = {
  name: string
  buffer: Buffer
  mimeType: string
}

function previewText(text: string, max = COMBINED_TEXT_PREVIEW_MAX): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

export function inferMimeType(fileName: string, declaredMime: string): string {
  const declared = declaredMime?.trim()
  if (declared) return declared
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (lower.endsWith(".doc")) return "application/msword"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff"
  return "application/octet-stream"
}

function isMimeSupportedByDocumentIntelligence(mimeType: string): boolean {
  const isImage = mimeType.startsWith("image/")
  const isPdf = mimeType === "application/pdf"
  const isOffice =
    mimeType.includes("officedocument") ||
    mimeType.includes("spreadsheetml") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  return isImage || isPdf || isOffice
}

export function getDocumentIntelligenceClient(): DocumentAnalysisClient | null {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim()
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim()
  if (!endpoint || !key) return null
  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key))
}

export async function ocrAzure(imageBuffer: Buffer): Promise<string> {
  if (!AZURE_VISION_ENDPOINT || !AZURE_VISION_KEY) {
    throw new Error("Credenciales de Azure Computer Vision no configuradas en el servidor.")
  }
  const credentials = new ApiKeyCredentials({ inHeader: { "Ocp-Apim-Subscription-Key": AZURE_VISION_KEY } })
  const client = new ComputerVisionClient(credentials, AZURE_VISION_ENDPOINT)

  const t0 = Date.now()
  const result = await client.readInStream(imageBuffer)
  const operationId = result.operationLocation.split("/").pop()!
  let analysisResult
  do {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    analysisResult = await client.getReadResult(operationId)
  } while (analysisResult.status === "running" || analysisResult.status === "notStarted")

  const pageCount = analysisResult.analyzeResult?.readResults?.length ?? null
  recordProviderCostAuditShadow({
    provider: "azure_vision",
    model: "read_api",
    operation: "extract_name_azure_vision_read",
    pagesProcessed: pageCount ?? 1,
    filesProcessed: 1,
    durationMs: Date.now() - t0,
    costSource: "REAL_PROVIDER_USAGE",
  })

  let fullText = ""
  if (analysisResult.status === "succeeded" && analysisResult.analyzeResult?.readResults) {
    analysisResult.analyzeResult.readResults.forEach((readResult) => {
      readResult.lines.forEach((line) => {
        fullText += line.text + " "
      })
    })
  }
  return fullText.trim()
}

/** Mismo modelo prebuilt-read que usa evaluate (Document Intelligence). */
export async function ocrDocumentIntelligence(
  buffer: Buffer,
  mimeType: string,
  client: DocumentAnalysisClient,
): Promise<string> {
  if (!isMimeSupportedByDocumentIntelligence(mimeType)) {
    return ""
  }
  const t0 = Date.now()
  const poller = await client.beginAnalyzeDocument("prebuilt-read", buffer)
  const result = await poller.pollUntilDone()
  recordAzureDiCostAuditShadow({
    operation: "extract_name_azure_di_read",
    model: "prebuilt-read",
    pagesProcessed: result.pages?.length ?? null,
    filesProcessed: 1,
    durationMs: Date.now() - t0,
  })
  return result.content?.trim() ?? ""
}

export async function extractNameWithAI(
  combinedText: string,
): Promise<{ suggestions: string[]; failed: boolean; error?: string }> {
  const prompt = `Actúa como un extractor de datos de un examen o trabajo. Tu ÚNICO OBJETIVO es identificar y extraer los nombres completos de los estudiantes que realizaron el examen. 
    
    INSTRUCCIONES CLAVE:
    1. EXCLUYE de la extracción cualquier nombre que esté asociado o etiquetado como "Profesor", "Docente", "Asignatura", "Curso", "Prueba", "Evaluación" o "Fecha". Concéntrate SÓLO en los nombres de los ALUMNOS.
    2. Devuelve un array de strings llamado 'suggestions' con TODOS los nombres de ALUMNOS que encuentres (individuales o grupales), en el orden en que aparecen.
    
    Si solo encuentras un nombre de alumno, devuélvelo como el único elemento en el array. Si encuentras varios nombres, devuelve todos los nombres identificados (máximo 7).
    
    Tu única respuesta debe ser un objeto JSON.
    
    Texto OCR para análisis: ${combinedText}
    
    Ejemplo de respuesta (trabajo grupal): 
    {"suggestions": ["Juan Pérez", "Ana Gómez", "Carlos Rojas"]}
    `

  const maxRetries = 3
  const retryStatuses = [502, 503, 429]
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const aiStartedAt = Date.now()
      const aiResponse = await openai.chat.completions.create({
        model: "mistral-large-latest",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 500,
      })

      recordProviderCostAuditShadow({
        provider: "mistral",
        model: "mistral-large-latest",
        operation: "extract_name_mistral",
        usage: aiResponse.usage,
        durationMs: Date.now() - aiStartedAt,
      })

      const content = aiResponse.choices[0].message.content
      if (!content) return { suggestions: [], failed: false }
      const match = content.match(/({[\s\S]*})/)
      const cleanedContent = match ? match[1] : '{"suggestions":[]}'
      const result = JSON.parse(cleanedContent)
      const suggestions = Array.isArray(result.suggestions) ? result.suggestions : []
      return { suggestions, failed: false }
    } catch (error) {
      lastError = error
      const err = error as { status?: number; message?: string }
      const status = err?.status
      const msg = err?.message ?? ""
      const isRetryable =
        (status != null && retryStatuses.includes(status)) || /503|502|429|overflow/.test(msg)
      if (isRetryable && attempt < maxRetries) {
        const delayMs = 2000 * Math.pow(2, attempt - 1)
        await new Promise((r) => setTimeout(r, delayMs))
      } else {
        console.error("[extract-name-core] Fallback IA falló:", error)
        const message =
          lastError instanceof Error
            ? lastError.message
            : typeof lastError === "string"
              ? lastError
              : "Error desconocido en Mistral"
        return { suggestions: [], failed: true, error: message }
      }
    }
  }
  console.error("[extract-name-core] Fallback IA falló tras reintentos:", lastError)
  const message =
    lastError instanceof Error
      ? lastError.message
      : typeof lastError === "string"
        ? lastError
        : "Error desconocido en Mistral tras reintentos"
  return { suggestions: [], failed: true, error: message }
}

export function findTopNameSuggestionsWithRatings(
  ocrText: string,
  nameList: string[],
): { suggestions: string[]; ratings: ExtractNameFuzzyRating[] } {
  const ratings: ExtractNameFuzzyRating[] = []

  nameList.forEach((name) => {
    const match = findBestMatch(name, [ocrText])
    const rating = match.ratings[0].rating
    ratings.push({ target: name, rating })
  })

  ratings.sort((a, b) => b.rating - a.rating)

  let topSuggestions = ratings.slice(0, 3).map((r) => r.target)
  topSuggestions = Array.from(new Set(topSuggestions))

  return { suggestions: topSuggestions, ratings }
}

export function findTopNameSuggestions(ocrText: string, nameList: string[]): string[] {
  return findTopNameSuggestionsWithRatings(ocrText, nameList).suggestions
}

const DIRECT_LABEL_STOP_REGEX =
  /\s*(?:Curso|Fecha|Asignatura|Profesor|Puntaje|RUT|RUN|N[°º]|Edad)\s*:/i

/** Orden: patrones más específicos primero. */
const DIRECT_NAME_LABEL_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /Nombre\s+del\s+estudiante\s*:/i, label: "Nombre del estudiante:" },
  { regex: /Nombre\s+y\s+apellido\s*:/i, label: "Nombre y apellido:" },
  { regex: /Apellidos\s+y\s+nombres\s*:/i, label: "Apellidos y nombres:" },
  { regex: /Alumno\/a\s*:/i, label: "Alumno/a:" },
  { regex: /Estudiante\s*:/i, label: "Estudiante:" },
  { regex: /Alumno\s*:/i, label: "Alumno:" },
  { regex: /Nombre\s*:/i, label: "Nombre:" },
]

const DIRECT_LABEL_NAME_BLOCKLIST = new Set([
  "curso",
  "hoja",
  "respuesta",
  "libella",
  "libelia",
  "qmr",
])

export type DirectLabelExtraction = {
  normalized: string
  raw: string
  pattern: string
}

export function normalizeDirectLabelName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

export function isValidDirectLabelName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed || /\d/.test(trimmed)) return false

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 0) return false

  for (const word of words) {
    const lower = word.toLowerCase().replace(/[^a-záéíóúñü]/gi, "")
    if (DIRECT_LABEL_NAME_BLOCKLIST.has(lower)) return false
    if (/^libell?a$/i.test(word)) return false
    if (/^qmr$/i.test(word)) return false
  }

  const letterWords = words.filter((w) => /[a-záéíóúñü]/i.test(w))
  if (letterWords.length >= 2) return true
  if (letterWords.length === 1) {
    const w = letterWords[0]
    return w.replace(/[^a-záéíóúñü]/gi, "").length >= 4
  }
  return false
}

export function extractDirectLabelNameFromText(text: string): DirectLabelExtraction | null {
  const flat = text.replace(/\r?\n/g, " ").replace(/\s+/g, " ")
  for (const { regex, label } of DIRECT_NAME_LABEL_PATTERNS) {
    const match = flat.match(regex)
    if (!match || match.index == null) continue

    const afterLabel = flat.slice(match.index + match[0].length)
    const stopMatch = afterLabel.match(DIRECT_LABEL_STOP_REGEX)
    const rawSegment = (stopMatch?.index != null ? afterLabel.slice(0, stopMatch.index) : afterLabel)
      .trim()
      .replace(/^[\s:,\-–—]+/, "")
      .replace(/[\s,;.\-–—]+$/, "")

    if (!rawSegment) continue

    const normalized = normalizeDirectLabelName(rawSegment)
    if (!isValidDirectLabelName(normalized)) continue

    return { normalized, raw: rawSegment, pattern: label }
  }
  return null
}

export function parseNameListFromForm(nameListJson: string | null): {
  nameList: string[]
  parseError: string | null
} {
  if (!nameListJson) return { nameList: [], parseError: null }
  try {
    const parsedList = JSON.parse(nameListJson)
    if (Array.isArray(parsedList)) {
      return { nameList: parsedList.filter((x) => typeof x === "string"), parseError: null }
    }
    return { nameList: [], parseError: "nameList JSON válido pero no era un array" }
  } catch (e) {
    return {
      nameList: [],
      parseError: e instanceof Error ? e.message : String(e),
    }
  }
}

function buildAudit(params: {
  ocrPerFile: ExtractNameOcrPerFile[]
  combinedText: string
  mode: ExtractNameMode
  nameListCount: number
  nameListParseError: string | null
  fuzzyRatingsTop10: ExtractNameFuzzyRating[] | null
  aiPromptExcerpt: string | null
  mimeTypes: string[]
  azureVisionTextLength: number
  documentIntelligenceUsed: boolean
  documentIntelligenceTextLength: number
  aiFallbackUsed: boolean
  suggestionsCount: number
  errorStage: ExtractNameErrorStage
  ocrSource: ExtractNameOcrSource
  directLabel?: DirectLabelExtraction | null
}): ExtractNameAudit {
  const combinedText = params.combinedText
  const directLabel = params.directLabel ?? null
  return {
    ocrPerFile: params.ocrPerFile,
    combinedText,
    mode: params.mode,
    nameListCount: params.nameListCount,
    nameListParseError: params.nameListParseError,
    fuzzyRatingsTop10: params.fuzzyRatingsTop10,
    aiPromptExcerpt: params.aiPromptExcerpt,
    files_count: params.ocrPerFile.length,
    mime_types: params.mimeTypes,
    azure_vision_text_length: params.azureVisionTextLength,
    document_intelligence_used: params.documentIntelligenceUsed,
    document_intelligence_text_length: params.documentIntelligenceTextLength,
    combined_text_preview: previewText(combinedText),
    ai_fallback_used: params.aiFallbackUsed,
    suggestions_count: params.suggestionsCount,
    error_stage: params.errorStage,
    ocr_source: params.ocrSource,
    direct_label_name_detected: directLabel != null,
    direct_label_pattern: directLabel?.pattern ?? null,
    direct_label_raw_value: directLabel?.raw ?? null,
    direct_label_normalized: directLabel?.normalized ?? null,
  }
}

export async function runExtractNamePipeline(params: {
  files: ExtractNameFileInput[]
  nameList: string[]
  nameListParseError?: string | null
  includeAudit?: boolean
}): Promise<{
  success: boolean
  suggestions: string[]
  audit?: ExtractNameAudit
  error?: string
  error_stage?: ExtractNameErrorStage
}> {
  const { files, nameList, nameListParseError = null, includeAudit = false } = params
  const isNameListAvailable = nameList.length > 0
  const mimeTypes = files.map((f) => f.mimeType)

  if (!files.length) {
    const audit = buildAudit({
      ocrPerFile: [],
      combinedText: "",
      mode: "no_ocr_text",
      nameListCount: nameList.length,
      nameListParseError,
      fuzzyRatingsTop10: null,
      aiPromptExcerpt: null,
      mimeTypes: [],
      azureVisionTextLength: 0,
      documentIntelligenceUsed: false,
      documentIntelligenceTextLength: 0,
      aiFallbackUsed: false,
      suggestionsCount: 0,
      errorStage: "no_files",
      ocrSource: "none",
    })
    return {
      success: false,
      suggestions: [],
      error: "No se proporcionaron archivos",
      error_stage: "no_files",
      ...(includeAudit ? { audit } : {}),
    }
  }

  const ocrPerFile: ExtractNameOcrPerFile[] = []
  let azureVisionCombined = ""
  let azureVisionHadHardFailure = false
  let azureVisionErrorMessage: string | null = null

  for (const file of files) {
    let text = ""
    let ocrSource: ExtractNameOcrPerFile["ocrSource"] = "none"
    try {
      text = await ocrAzure(file.buffer)
      ocrSource = "azure_vision"
    } catch (err) {
      azureVisionHadHardFailure = true
      azureVisionErrorMessage =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Error en Azure Computer Vision"
      console.error(`[extract-name-core] Azure Vision falló para ${file.name}:`, err)
    }
    ocrPerFile.push({
      fileName: file.name,
      text,
      charCount: text.length,
      ocrSource,
    })
    if (text) azureVisionCombined += text + "\n\n---\n\n"
  }

  const azureVisionTextLength = azureVisionCombined.trim().length
  let combinedText = azureVisionCombined.trim()
  let documentIntelligenceUsed = false
  let documentIntelligenceTextLength = 0
  let ocrSource: ExtractNameOcrSource = azureVisionTextLength > 0 ? "azure_vision" : "none"

  if (combinedText === "") {
    const docClient = getDocumentIntelligenceClient()
    if (docClient) {
      let diCombined = ""
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!isMimeSupportedByDocumentIntelligence(file.mimeType)) {
          console.warn(
            `[extract-name-core] Document Intelligence omitido (tipo no soportado): ${file.mimeType} (${file.name})`,
          )
          continue
        }
        try {
          const diText = await ocrDocumentIntelligence(file.buffer, file.mimeType, docClient)
          if (diText) {
            documentIntelligenceUsed = true
            documentIntelligenceTextLength += diText.length
            diCombined += diText + "\n\n---\n\n"
            ocrPerFile[i] = {
              fileName: file.name,
              text: diText,
              charCount: diText.length,
              ocrSource: "document_intelligence",
            }
          }
        } catch (err) {
          console.error(`[extract-name-core] Document Intelligence falló para ${file.name}:`, err)
          const diMessage =
            err instanceof Error ? err.message : typeof err === "string" ? err : "Error en Document Intelligence"
          if (azureVisionHadHardFailure && !documentIntelligenceUsed) {
            const audit = buildAudit({
              ocrPerFile,
              combinedText: "",
              mode: "no_ocr_text",
              nameListCount: nameList.length,
              nameListParseError,
              fuzzyRatingsTop10: null,
              aiPromptExcerpt: null,
              mimeTypes,
              azureVisionTextLength: 0,
              documentIntelligenceUsed: false,
              documentIntelligenceTextLength: 0,
              aiFallbackUsed: false,
              suggestionsCount: 0,
              errorStage: "document_intelligence",
              ocrSource: "none",
            })
            return {
              success: false,
              suggestions: [],
              error: diMessage,
              error_stage: "document_intelligence",
              ...(includeAudit ? { audit } : {}),
            }
          }
        }
      }
      combinedText = diCombined.trim()
      if (combinedText) {
        ocrSource = azureVisionTextLength > 0 ? "azure_vision_then_document_intelligence" : "document_intelligence"
      }
    } else if (azureVisionHadHardFailure) {
      const audit = buildAudit({
        ocrPerFile,
        combinedText: "",
        mode: "no_ocr_text",
        nameListCount: nameList.length,
        nameListParseError,
        fuzzyRatingsTop10: null,
        aiPromptExcerpt: null,
        mimeTypes,
        azureVisionTextLength: 0,
        documentIntelligenceUsed: false,
        documentIntelligenceTextLength: 0,
        aiFallbackUsed: false,
        suggestionsCount: 0,
        errorStage: "azure_vision",
        ocrSource: "none",
      })
      return {
        success: false,
        suggestions: [],
        error: azureVisionErrorMessage ?? "Azure Computer Vision no disponible",
        error_stage: "azure_vision",
        ...(includeAudit ? { audit } : {}),
      }
    }
  }

  if (combinedText === "") {
    const audit = buildAudit({
      ocrPerFile,
      combinedText: "",
      mode: "no_ocr_text",
      nameListCount: nameList.length,
      nameListParseError,
      fuzzyRatingsTop10: null,
      aiPromptExcerpt: null,
      mimeTypes,
      azureVisionTextLength,
      documentIntelligenceUsed,
      documentIntelligenceTextLength,
      aiFallbackUsed: false,
      suggestionsCount: 0,
      errorStage: "ocr_empty",
      ocrSource: "none",
    })
    return { success: true, suggestions: [], ...(includeAudit ? { audit } : {}) }
  }

  const directLabel = extractDirectLabelNameFromText(combinedText)
  if (directLabel) {
    const suggestions = [directLabel.normalized]
    const audit = buildAudit({
      ocrPerFile,
      combinedText,
      mode: "direct_label",
      nameListCount: nameList.length,
      nameListParseError,
      fuzzyRatingsTop10: null,
      aiPromptExcerpt: null,
      mimeTypes,
      azureVisionTextLength,
      documentIntelligenceUsed,
      documentIntelligenceTextLength,
      aiFallbackUsed: false,
      suggestionsCount: 1,
      errorStage: null,
      ocrSource,
      directLabel,
    })
    return {
      success: true,
      suggestions,
      ...(includeAudit ? { audit } : {}),
    }
  }

  let suggestions: string[] = []
  let mode: ExtractNameMode = "ai_fallback"
  let fuzzyRatingsTop10: ExtractNameFuzzyRating[] | null = null
  let aiFallbackUsed = false

  if (isNameListAvailable) {
    mode = "fuzzy_matching"
    const fuzzy = findTopNameSuggestionsWithRatings(combinedText, nameList)
    suggestions = fuzzy.suggestions
    fuzzyRatingsTop10 = fuzzy.ratings.slice(0, 10)
  } else {
    aiFallbackUsed = true
    const aiResult = await extractNameWithAI(combinedText)
    if (aiResult.failed) {
      const audit = buildAudit({
        ocrPerFile,
        combinedText,
        mode: "ai_fallback",
        nameListCount: nameList.length,
        nameListParseError,
        fuzzyRatingsTop10: null,
        aiPromptExcerpt:
          "Mistral large-latest — extrae hasta 7 nombres de ALUMNOS del texto OCR (excluye Profesor/Docente/Curso).",
        mimeTypes,
        azureVisionTextLength,
        documentIntelligenceUsed,
        documentIntelligenceTextLength,
        aiFallbackUsed: true,
        suggestionsCount: 0,
        errorStage: "ai_fallback",
        ocrSource,
      })
      return {
        success: false,
        suggestions: [],
        error: aiResult.error ?? "No se pudo extraer nombres con IA",
        error_stage: "ai_fallback",
        ...(includeAudit ? { audit } : {}),
      }
    }
    suggestions = aiResult.suggestions
  }

  const audit = buildAudit({
    ocrPerFile,
    combinedText,
    mode,
    nameListCount: nameList.length,
    nameListParseError,
    fuzzyRatingsTop10,
    aiPromptExcerpt:
      mode === "ai_fallback"
        ? "Mistral large-latest — extrae hasta 7 nombres de ALUMNOS del texto OCR (excluye Profesor/Docente/Curso)."
        : null,
    mimeTypes,
    azureVisionTextLength,
    documentIntelligenceUsed,
    documentIntelligenceTextLength,
    aiFallbackUsed,
    suggestionsCount: suggestions.length,
    errorStage: null,
    ocrSource,
  })

  return {
    success: true,
    suggestions,
    ...(includeAudit ? { audit } : {}),
  }
}
