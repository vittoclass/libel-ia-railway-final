#!/usr/bin/env node
/**
 * Script Node puro (CJS, sin webpack) para extraer texto de un PDF.
 * Se ejecuta con: node scripts/extract-pdf-text.cjs <ruta-al-pdf>
 * Escribe en stdout JSON: { text, pageCount, warning? }
 * En error escribe en stderr JSON: { error, details? } y sale con código 1.
 * Solo para importación de ítems de prueba base. No toca evaluación ni OCR.
 * La ruta HTTP extract-pdf-text prioriza Azure Document Intelligence si hay variables de entorno.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const MIN_TEXT_LENGTH_FOR_WARNING = 50;

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    const err = { error: "Falta ruta del PDF", details: "Uso: node extract-pdf-text.cjs <ruta.pdf>" };
    process.stderr.write(JSON.stringify(err));
    process.exit(1);
  }

  const resolved = path.resolve(pdfPath);
  if (!fs.existsSync(resolved)) {
    const err = { error: "Archivo no encontrado", details: resolved };
    process.stderr.write(JSON.stringify(err));
    process.exit(1);
  }

  let buffer;
  try {
    buffer = fs.readFileSync(resolved);
  } catch (e) {
    const msg = e && (e.message || String(e));
    process.stderr.write(JSON.stringify({ error: "No se pudo leer el archivo", details: msg }));
    process.exit(1);
  }

  if (buffer.length === 0) {
    process.stderr.write(JSON.stringify({ error: "El archivo está vacío" }));
    process.exit(1);
  }

  let PDFParse;
  try {
    const pdfParse = require("pdf-parse");
    PDFParse = pdfParse.PDFParse || pdfParse.default;
  } catch (e) {
    const msg = e && (e.message || String(e));
    process.stderr.write(JSON.stringify({ error: "No se pudo cargar pdf-parse", details: msg }));
    process.exit(1);
  }

  if (typeof PDFParse !== "function") {
    process.stderr.write(
      JSON.stringify({ error: "pdf-parse no exporta PDFParse", details: "Módulo incompatible" })
    );
    process.exit(1);
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = typeof result.text === "string" ? result.text : "";
    const pageCount = typeof result.total === "number" ? result.total : 0;

    let warning;
    if (pageCount > 0 && text.trim().length < MIN_TEXT_LENGTH_FOR_WARNING) {
      warning =
        "El PDF podría ser escaneado y no contener texto extraíble. Revise el texto abajo o pegue/edite manualmente.";
    }

    process.stdout.write(JSON.stringify({ text, pageCount, warning: warning || undefined }));
  } catch (e) {
    const msg = e && (e.message || String(e));
    process.stderr.write(JSON.stringify({ error: "No se pudo extraer texto del PDF", details: msg }));
    process.exit(1);
  } finally {
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }
  }
}

main();
