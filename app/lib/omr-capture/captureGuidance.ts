/**
 * Mensajes docentes para guía de captura V2 (sin jerga técnica).
 */

import type { CornerLabel } from "./quadAudit"
import type { MarkerDetectV2Result } from "./markerDetectV2"

const CORNER_ORDER: CornerLabel[] = ["TL", "TR", "BR", "BL"]

const MISSING_CORNER_MESSAGE: Record<CornerLabel, string> = {
  TL: "Falta esquina superior izquierda",
  TR: "Falta esquina superior derecha",
  BR: "Falta esquina inferior derecha",
  BL: "Falta esquina inferior izquierda",
}

function missingCornersFromDetection(detection: MarkerDetectV2Result): CornerLabel[] {
  const fromQuad = detection.quadAudit.missingCorners
  if (fromQuad.length > 0) return fromQuad
  return detection.quadrantAudits.filter((a) => !a.usedForQuad).map((a) => a.corner)
}

/**
 * Mensaje cuando hay menos de 4 marcadores visibles.
 * Devuelve null si hay 4 y debe usarse el mensaje de calidad general.
 */
export function buildCaptureGuidanceMessage(detection: MarkerDetectV2Result): string | null {
  if (detection.markerCount >= 4) return null

  const missing = missingCornersFromDetection(detection)
  const parts: string[] = []

  for (const corner of CORNER_ORDER) {
    if (missing.includes(corner)) {
      parts.push(MISSING_CORNER_MESSAGE[corner])
    }
  }

  if (parts.length === 0) {
    if (detection.markerCount < 2) {
      return "Encuadra la hoja en la pantalla"
    }
    return null
  }

  if (missing.some((c) => c === "BR" || c === "BL")) {
    parts.push("Incluye la parte inferior de la hoja")
  }

  return parts.join(". ")
}

export function postCaptureMessageForScore(score: number): string {
  if (score >= 85) return "Foto adecuada para evaluación automática"
  if (score >= 70) return "Puedes usarla, pero repetirla puede mejorar el resultado"
  return "Recomendado repetir: no se ve completa la hoja"
}

export function yellowHintMessage(): string {
  return "Puedes tomarla, pero si enderezas la hoja saldrá mejor."
}

export function bottomFrameHint(): string {
  return "Recomendado: incluye toda la parte inferior."
}
