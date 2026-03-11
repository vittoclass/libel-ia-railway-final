/**
 * Extrae texto de un PDF mediante un script Node aislado (scripts/extract-pdf-text.cjs).
 * Evita el runtime de Next y el error "Object.defineProperty called on non-object".
 * Solo para importación de ítems de prueba base. No toca evaluación ni pdfToImages.
 */
import { spawnSync } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { randomBytes } from "crypto"

export interface ExtractPdfTextResult {
  text: string
  pageCount: number
  warning?: string
}

const MIN_TEXT_LENGTH_FOR_WARNING = 50
const DEBUG = typeof process !== "undefined" && process.env.NODE_ENV !== "production"
const MAX_STDOUT_MB = 50

export async function extractTextFromPdf(buffer: Buffer): Promise<ExtractPdfTextResult> {
  if (DEBUG) console.log("[extract-text-from-pdf] buffer length:", buffer?.length)

  const scriptPath = path.join(process.cwd(), "scripts", "extract-pdf-text.cjs")
  const tempDir = os.tmpdir()
  const tempName = `libelia-pdf-${Date.now()}-${randomBytes(8).toString("hex")}.pdf`
  const tempPath = path.join(tempDir, tempName)

  try {
    await fs.writeFile(tempPath, buffer, { flag: "w" })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`No se pudo escribir archivo temporal: ${msg}`)
  }

  try {
    const result = spawnSync(process.execPath, [scriptPath, tempPath], {
      encoding: "utf8",
      maxBuffer: MAX_STDOUT_MB * 1024 * 1024,
    })

    if (result.status !== 0) {
      let details = "Error desconocido del script"
      try {
        const errJson = result.stderr ? JSON.parse(result.stderr.trim()) : {}
        details = (errJson.details ?? errJson.error ?? details) as string
      } catch {
        if (result.stderr?.trim()) details = result.stderr.trim()
      }
      throw new Error(details)
    }

    let parsed: { text?: string; pageCount?: number; warning?: string }
    try {
      parsed = JSON.parse(result.stdout?.trim() ?? "{}") as {
        text?: string
        pageCount?: number
        warning?: string
      }
    } catch {
      throw new Error("La salida del script no es JSON válido")
    }

    const text = typeof parsed.text === "string" ? parsed.text : ""
    const pageCount = typeof parsed.pageCount === "number" ? parsed.pageCount : 0

    let warning: string | undefined = parsed.warning
    if (
      !warning &&
      pageCount > 0 &&
      text.trim().length < MIN_TEXT_LENGTH_FOR_WARNING
    ) {
      warning =
        "El PDF podría ser escaneado y no contener texto extraíble. Revise el texto abajo o pegue/edite manualmente."
    }

    if (DEBUG) {
      console.log("[extract-text-from-pdf] extracted text length:", text.length, "pageCount:", pageCount)
    }

    return { text, pageCount, warning }
  } finally {
    await fs.unlink(tempPath).catch(() => {})
  }
}
