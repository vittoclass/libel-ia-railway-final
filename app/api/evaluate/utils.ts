import type { DocumentAnalysisClient } from "@azure/ai-form-recognizer"

interface FileBuffer {
  buffer: Buffer
  mimeType: string
  captureMode?: string
}

export async function extractTextFromFiles(fileBuffers: FileBuffer[], client: DocumentAnalysisClient): Promise<string> {
  if (!fileBuffers || fileBuffers.length === 0) {
    return "NO SE PUDO EXTRAER TEXTO."
  }

  const textResults: string[] = []

  for (const fileBuffer of fileBuffers) {
    try {
      const isImage = fileBuffer.mimeType.startsWith("image/")
      const isPdf = fileBuffer.mimeType === "application/pdf"
      const isOffice =
        fileBuffer.mimeType.includes("officedocument") ||
        fileBuffer.mimeType.includes("spreadsheetml") ||
        fileBuffer.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

      if (!isImage && !isPdf && !isOffice) {
        console.warn(`[evaluate] Tipo de archivo no soportado para OCR: ${fileBuffer.mimeType}`)
        continue
      }

      console.log(`[evaluate] OCR Azure (prebuilt-read) para: ${fileBuffer.mimeType}`)

      // Usar Azure Document Intelligence para extraer texto
      const poller = await client.beginAnalyzeDocument("prebuilt-read", fileBuffer.buffer)
      const result = await poller.pollUntilDone()

      if (!result.content || result.content.trim().length === 0) {
        console.warn("[evaluate] OCR no extrajo contenido de este archivo")
        continue
      }

      textResults.push(result.content)
    } catch (error) {
      console.error("[evaluate] Error OCR Azure:", error)
      continue
    }
  }

  if (textResults.length === 0) {
    return "NO SE PUDO EXTRAER TEXTO."
  }

  console.log(`[evaluate] Texto extraído de ${textResults.length} archivo(s) (Azure prebuilt-read)`)

  return textResults.join("\n\n--- PÁGINA SIGUIENTE ---\n\n")
}
