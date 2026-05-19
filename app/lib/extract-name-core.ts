import { ComputerVisionClient } from "@azure/cognitiveservices-computervision"
import { ApiKeyCredentials } from "@azure/ms-rest-js"
import OpenAI from "openai"
import { findBestMatch } from "string-similarity"

const AZURE_VISION_ENDPOINT = process.env.AZURE_VISION_ENDPOINT!
const AZURE_VISION_KEY = process.env.AZURE_VISION_KEY!
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY!
const openai = new OpenAI({ apiKey: MISTRAL_API_KEY, baseURL: "https://api.mistral.ai/v1" })

export type ExtractNameMode = "fuzzy_matching" | "ai_fallback" | "no_ocr_text"

export type ExtractNameOcrPerFile = {
  fileName: string
  text: string
  charCount: number
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
}

export async function ocrAzure(imageBuffer: Buffer): Promise<string> {
  if (!AZURE_VISION_ENDPOINT || !AZURE_VISION_KEY) {
    throw new Error("Credenciales de Azure no configuradas en el servidor.")
  }
  const credentials = new ApiKeyCredentials({ inHeader: { "Ocp-Apim-Subscription-Key": AZURE_VISION_KEY } })
  const client = new ComputerVisionClient(credentials, AZURE_VISION_ENDPOINT)

  const result = await client.readInStream(imageBuffer)
  const operationId = result.operationLocation.split("/").pop()!
  let analysisResult
  do {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    analysisResult = await client.getReadResult(operationId)
  } while (analysisResult.status === "running" || analysisResult.status === "notStarted")

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

export async function extractNameWithAI(combinedText: string): Promise<string[]> {
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
      const aiResponse = await openai.chat.completions.create({
        model: "mistral-large-latest",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 500,
      })

      const content = aiResponse.choices[0].message.content
      if (!content) return []
      const match = content.match(/({[\s\S]*})/)
      const cleanedContent = match ? match[1] : '{"suggestions":[]}'
      const result = JSON.parse(cleanedContent)
      return Array.isArray(result.suggestions) ? result.suggestions : []
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
        return []
      }
    }
  }
  console.error("[extract-name-core] Fallback IA falló tras reintentos:", lastError)
  return []
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

export async function runExtractNamePipeline(params: {
  files: Array<{ name: string; buffer: Buffer }>
  nameList: string[]
  nameListParseError?: string | null
  includeAudit?: boolean
}): Promise<{
  success: boolean
  suggestions: string[]
  audit?: ExtractNameAudit
  error?: string
}> {
  const { files, nameList, nameListParseError = null, includeAudit = false } = params
  const isNameListAvailable = nameList.length > 0

  if (!files.length) {
    return { success: false, suggestions: [], error: "No se proporcionaron archivos" }
  }

  const ocrPerFile: ExtractNameOcrPerFile[] = []
  let combinedText = ""
  for (const file of files) {
    const text = await ocrAzure(file.buffer)
    ocrPerFile.push({ fileName: file.name, text, charCount: text.length })
    combinedText += text + "\n\n---\n\n"
  }

  if (combinedText.trim() === "") {
    const audit: ExtractNameAudit = {
      ocrPerFile,
      combinedText: "",
      mode: "no_ocr_text",
      nameListCount: nameList.length,
      nameListParseError,
      fuzzyRatingsTop10: null,
      aiPromptExcerpt: null,
    }
    return { success: true, suggestions: [], ...(includeAudit ? { audit } : {}) }
  }

  let suggestions: string[] = []
  let mode: ExtractNameMode = "ai_fallback"
  let fuzzyRatingsTop10: ExtractNameFuzzyRating[] | null = null

  if (isNameListAvailable) {
    mode = "fuzzy_matching"
    const fuzzy = findTopNameSuggestionsWithRatings(combinedText, nameList)
    suggestions = fuzzy.suggestions
    fuzzyRatingsTop10 = fuzzy.ratings.slice(0, 10)
  } else {
    suggestions = await extractNameWithAI(combinedText)
  }

  const audit: ExtractNameAudit = {
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
  }

  return {
    success: true,
    suggestions,
    ...(includeAudit ? { audit } : {}),
  }
}
