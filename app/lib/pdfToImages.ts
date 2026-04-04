/**
 * Convierte PDF (y opcionalmente Word) a imágenes base64 para enviar a APIs de visión (Mistral, etc.).
 * PDF: cada página se convierte en una imagen PNG base64.
 * Word: por ahora se sugiere exportar a PDF.
 */

/** Detecta si el base64 corresponde a un PDF por la cabecera %PDF- */
export function isPdfBase64(base64: string): boolean {
  if (!base64 || base64.length < 20) return false
  try {
    const buf = Buffer.from(base64, "base64")
    return buf.slice(0, 5).toString("ascii") === "%PDF-"
  } catch {
    return false
  }
}

/** Detecta si el base64 corresponde a un DOCX (ZIP con [Content_Types].xml) */
export function isDocxBase64(base64: string): boolean {
  if (!base64 || base64.length < 100) return false
  try {
    const buf = Buffer.from(base64, "base64")
    // DOCX es un ZIP; cabecera PK (50 4B 03 04 o 50 4B 05 06)
    if (buf[0] === 0x50 && buf[1] === 0x4b) return true
    return false
  } catch {
    return false
  }
}

/**
 * Convierte un buffer/base64 de PDF a array de imágenes PNG en base64 (una por página).
 * Usa un script Node externo (scripts/pdfToImagesRunner.mjs) para evitar que webpack empaquete pdfjs-dist.
 */
export async function pdfToImageBase64List(pdfBase64: string): Promise<string[]> {
  const { spawn } = await import("child_process")
  const path = await import("path")
  const fs = await import("fs")
  const scriptPath = path.join(process.cwd(), "scripts", "pdfToImagesRunner.mjs")

  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      "Convertidor de PDF no encontrado (scripts/pdfToImagesRunner.mjs). Asegúrate de estar en la raíz del proyecto."
    )
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    })

    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => { stderr += chunk })

    child.on("error", (err) => {
      reject(new Error("No se pudo ejecutar el convertidor de PDF: " + (err.message || String(err))))
    })
    child.on("close", (code) => {
      if (code !== 0) {
        let msg = "No se pudo convertir el PDF a imágenes."
        const lines = stderr.trim().split("\n").filter(Boolean)
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const errObj = JSON.parse(lines[i])
            if (errObj && typeof errObj.error === "string") {
              msg = errObj.error
              break
            }
          } catch (_) {
            // no es JSON, seguir con la línea anterior
          }
        }
        if (!msg && stderr.trim()) msg = stderr.trim()
        reject(new Error(msg))
        return
      }
      try {
        const arr = JSON.parse(stdout) as string[]
        if (!Array.isArray(arr) || arr.length === 0) {
          reject(new Error("PDF sin páginas o conversión fallida"))
          return
        }
        resolve(arr)
      } catch (_e) {
        reject(new Error("Respuesta inválida del convertidor de PDF."))
      }
    })

    child.stdin.write(pdfBase64, "utf8", (err) => {
      if (err) reject(err)
      else child.stdin.end()
    })
  })
}

/**
 * Dado un data URL o base64 de un archivo, devuelve una lista de base64 de imágenes
 * (1 elemento si ya es imagen, N si es PDF con N páginas).
 * Word por ahora lanza con mensaje para exportar a PDF.
 */
export async function fileToImageBase64List(
  dataUrlOrBase64: string,
  mimeType?: string
): Promise<string[]> {
  let source = String(dataUrlOrBase64 ?? "").trim()
  let effectiveMime = mimeType

  /** URLs firmadas (p. ej. Supabase): descargar en servidor; si no, el flujo trataba "https://..." como base64 y Mistral recibía data:image/jpeg;base64,https://... */
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source)
    if (!res.ok) {
      throw new Error(
        `No se pudo descargar el archivo para evaluar (${res.status}). URL: ${source.slice(0, 200)}`
      )
    }
    const buf = Buffer.from(await res.arrayBuffer())
    source = buf.toString("base64")
    const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
    if (ct === "application/pdf") {
      effectiveMime = "application/pdf"
    } else if (ct.startsWith("image/") && !effectiveMime) {
      effectiveMime = ct
    }
  }

  const raw = source.startsWith("data:")
    ? source.replace(/^data:.*?;base64,/, "")
    : source

  const isPdf =
    effectiveMime === "application/pdf" || mimeType === "application/pdf" || isPdfBase64(raw)
  const isDocx =
    effectiveMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    isDocxBase64(raw)

  if (isDocx) {
    throw new Error(
      "Documentos Word (.docx) no se pueden evaluar directamente. Exporta el documento a PDF (Guardar como > PDF) y sube el PDF."
    )
  }

  if (isPdf) {
    return pdfToImageBase64List(raw)
  }

  // Ya es imagen (o formato no reconocido; lo intentamos como imagen)
  return [raw]
}
