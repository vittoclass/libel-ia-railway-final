#!/usr/bin/env node
/**
 * Script Node puro (sin webpack) para convertir PDF base64 → array de imágenes PNG base64.
 * Se ejecuta con: node scripts/pdfToImagesRunner.mjs
 * Lee el base64 del PDF por stdin, escribe JSON array de base64 por stdout.
 * Uso: echo "<base64>" | node scripts/pdfToImagesRunner.mjs
 * O con archivo: node scripts/pdfToImagesRunner.mjs < ruta/al.pdf.base64
 */

import canvas from "canvas"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"

const createCanvas = canvas.createCanvas

async function main() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const base64Pdf = Buffer.concat(chunks).toString("utf8").trim()
  if (!base64Pdf) {
    console.error(JSON.stringify({ error: "No se recibió base64 por stdin" }))
    process.exit(1)
  }

  try {
    const data = new Uint8Array(Buffer.from(base64Pdf, "base64"))
    const loadingTask = getDocument({ data })
    const pdfDoc = await loadingTask.promise
    const numPages = pdfDoc.numPages
    const out = []
    const scale = 2

    for (let n = 1; n <= numPages; n++) {
      const page = await pdfDoc.getPage(n)
      const viewport = page.getViewport({ scale })
      const w = viewport.width
      const h = viewport.height
      const canvas = createCanvas(Math.floor(w), Math.floor(h))
      const ctx = canvas.getContext("2d")
      await page.render({ canvasContext: ctx, viewport }).promise
      const pngBuffer = canvas.toBuffer("image/png")
      out.push(pngBuffer.toString("base64"))
    }

    if (out.length === 0) {
      console.error(JSON.stringify({ error: "PDF sin páginas" }))
      process.exit(1)
    }
    process.stdout.write(JSON.stringify(out))
  } catch (err) {
    const msg = err && (err.message || String(err))
    console.error(JSON.stringify({ error: msg }))
    process.exit(1)
  }
}

main()
