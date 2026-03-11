/**
 * Contrato entre LibelIA y el microservicio LEADTOOLS OMR.
 * Usado por /api/omr/read-leadtools y omr-leadtools-reader.
 * NO toca compare, scoring ni persistencia.
 */

/** Request que LibelIA envía al microservicio POST /read-omr */
export interface LeadToolsReadOmrRequest {
  imageBase64: string
  templateId: string
  numQuestions: number
  optionLabels: string[]
}

/** Un resultado por pregunta; compatible con GridReadResult de compare */
export interface LeadToolsReadOmrResultItem {
  pregunta: number
  respuesta: string
  confianza: number
}

/** Response del microservicio en 200 OK */
export interface LeadToolsReadOmrResponse {
  success: true
  results: LeadToolsReadOmrResultItem[]
  omissions?: number[]
  doubleMarks?: number[]
  metadata?: {
    engine?: string
    processingTimeMs?: number
  }
}

/** Response de error del microservicio (4xx/5xx) */
export interface LeadToolsReadOmrErrorResponse {
  success: false
  error: string
}

export type LeadToolsReadOmrResponseBody =
  | LeadToolsReadOmrResponse
  | LeadToolsReadOmrErrorResponse
