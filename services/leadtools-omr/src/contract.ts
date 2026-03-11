/**
 * Contrato request/response del microservicio LEADTOOLS OMR (alineado con LibelIA).
 */
export interface ReadOmrRequest {
  imageBase64: string
  templateId: string
  numQuestions: number
  optionLabels: string[]
}

export interface ReadOmrResultItem {
  pregunta: number
  respuesta: string
  confianza: number
}

export interface ReadOmrSuccessResponse {
  success: true
  results: ReadOmrResultItem[]
  omissions?: number[]
  doubleMarks?: number[]
  metadata?: {
    engine?: string
    processingTimeMs?: number
  }
}

export interface ReadOmrErrorResponse {
  success: false
  error: string
}

export type ReadOmrResponse = ReadOmrSuccessResponse | ReadOmrErrorResponse
