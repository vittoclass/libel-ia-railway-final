/**
 * Reexporta el extractor unificado de documentos (PDF/DOCX).
 * @see extract-document-structured.ts
 */
export {
  extractPdfStructured,
  extractSourceDocumentStructured,
  type StructuredLine,
  type TextBlock,
  type DocumentForensic,
  type DocumentExtractionInfo,
  type ExtractDocumentStructuredResult,
  type SourceDocumentMeta,
  type PdfExtractionInfo,
  type ExtractPdfStructuredResult,
} from "@/app/lib/extract-document-structured"
