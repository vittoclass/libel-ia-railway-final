/**
 * Fortalezas y áreas de mejora derivadas solo de datos del grupo en cliente
 * (alternativas corregidas, puntaje, umbrales, detalle_desarrollo), sin narrativa de IA.
 */

export type AltRow = {
  pregunta?: string
  respuesta_estudiante?: string
  respuesta_correcta?: string
}

/** Misma lógica que la tabla OMR editable (solo lectura para resúmenes). */
export function countAlternativasSummary(alts: AltRow[] | undefined): {
  incorrect: number
  revisar: number
} {
  if (!alts?.length) return { incorrect: 0, revisar: 0 }
  let incorrect = 0
  let revisar = 0
  for (const item of alts) {
    const respuestaEst = (item.respuesta_estudiante ?? "").trim().toUpperCase()
    const respuestaCorr = (item.respuesta_correcta ?? "").trim().toUpperCase()
    const esIncorrecta = Boolean(respuestaEst && respuestaCorr && respuestaEst !== respuestaCorr)
    const tieneBajaConfianza =
      respuestaEst.length > 2 ||
      (String(item.pregunta ?? "").includes("VF") && !["V", "F"].includes(respuestaEst)) ||
      (String(item.pregunta ?? "").includes("TP") && isNaN(Number.parseInt(respuestaEst, 10))) ||
      (String(item.pregunta ?? "").includes("SM") && !["A", "B", "C", "D", "E"].includes(respuestaEst)) ||
      respuestaEst === ""
    if (esIncorrecta) incorrect++
    if (esIncorrecta || tieneBajaConfianza) revisar++
  }
  return { incorrect, revisar }
}

function parsePuntajeFraccion(puntaje: string | undefined): { obtenido: number; maximo: number } | null {
  const m = String(puntaje ?? "").match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/)
  if (!m) return null
  const obtenido = Number(m[1])
  const maximo = Number(m[2])
  if (!Number.isFinite(obtenido) || !Number.isFinite(maximo)) return null
  return { obtenido, maximo }
}

function contarAlternativasObjetivas(alts: AltRow[] | undefined) {
  if (!alts?.length) {
    return {
      totalFilas: 0,
      correctas: 0,
      incorrectas: 0,
      sinRespuesta: 0,
      sinPauta: 0,
    }
  }
  let correctas = 0
  let incorrectas = 0
  let sinRespuesta = 0
  let sinPauta = 0
  for (const alt of alts) {
    const correcta = (alt.respuesta_correcta ?? "").trim().toUpperCase()
    const extraida = (alt.respuesta_estudiante ?? "").trim().toUpperCase()
    if (!correcta) {
      sinPauta++
      continue
    }
    if (!extraida) {
      sinRespuesta++
      continue
    }
    if (correcta === extraida) correctas++
    else incorrectas++
  }
  return {
    totalFilas: alts.length,
    correctas,
    incorrectas,
    sinRespuesta,
    sinPauta,
  }
}

export function buildPedagogicalResumenFromGroup(group: {
  alternativas_corregidas?: AltRow[]
  puntaje?: string
  puntosMaximos?: number
  puntosAprobacion?: number
  detalle_desarrollo?: Record<string, unknown>
}): { fortalezas: string; areas_mejora: string } {
  const alts = group.alternativas_corregidas
  const c = contarAlternativasObjetivas(alts)
  const { incorrect, revisar } = countAlternativasSummary(alts)
  const devN = Object.keys(group.detalle_desarrollo || {}).length
  const fr = parsePuntajeFraccion(group.puntaje)
  const maxPts = group.puntosMaximos ?? fr?.maximo
  const umbral = group.puntosAprobacion

  const lineasF: string[] = []
  const lineasA: string[] = []

  lineasF.push(`Puntaje total registrado: ${group.puntaje?.trim() || "N/D"}.`)

  if (c.totalFilas > 0) {
    lineasF.push(
      `Ítems de alternativa cerrada (tabla): ${c.correctas} correctas, ${c.incorrectas} incorrectas, ${c.sinRespuesta} sin respuesta o vacías, ${c.sinPauta} sin pauta en fila; total ${c.totalFilas} filas.`,
    )
    if (c.correctas > 0) {
      lineasF.push(`${c.correctas} respuesta(s) coinciden exactamente con la pauta (tras normalizar mayúsculas).`)
    }
    if (c.correctas > 0 && c.incorrectas === 0 && c.sinRespuesta === 0) {
      lineasF.push("En ítems cerrados con respuesta y pauta, no hay discrepancias respecto a la pauta.")
    }
  }

  if (devN > 0) {
    lineasF.push(
      `La evaluación incluye ${devN} pregunta(s) de desarrollo; el detalle por ítem está en la sección de desarrollo (fuente estructural).`,
    )
  }

  if (fr && maxPts != null && umbral != null && Number.isFinite(umbral)) {
    if (fr.obtenido >= umbral) {
      lineasF.push(
        `Con ${fr.obtenido} de ${maxPts} puntos, alcanza o supera el umbral de aprobación configurado para nota 4.0 (${umbral} pts).`,
      )
    }
  }

  if (c.incorrectas > 0) {
    lineasA.push(
      `${c.incorrectas} respuesta(s) de alternativa cerrada no coinciden con la pauta (comparación directa estudiante vs correcta).`,
    )
  }
  if (c.sinRespuesta > 0) {
    lineasA.push(`${c.sinRespuesta} ítem(s) de alternativa sin respuesta del estudiante o con respuesta vacía.`)
  }
  if (c.sinPauta > 0) {
    lineasA.push(`${c.sinPauta} fila(s) en la tabla de alternativas no tienen respuesta correcta cargada; conviene completar la pauta.`)
  }
  if (revisar > incorrect) {
    lineasA.push(
      `${revisar - incorrect} fila(s) señalada(s) para revisión por criterios de formato o confianza OMR (sin error claro frente a la pauta).`,
    )
  }
  if (fr && maxPts != null && umbral != null && Number.isFinite(umbral) && fr.obtenido < umbral) {
    lineasA.push(
      `Puntaje total ${fr.obtenido} de ${maxPts} no alcanza el umbral de aprobación para nota 4.0 (${umbral} pts) con la exigencia actual.`,
    )
  }

  if (lineasA.length === 0) {
    lineasA.push("No se detectan discrepancias objetivas adicionales respecto a la pauta y el puntaje mostrados arriba.")
  }

  return {
    fortalezas: lineasF.join("\n"),
    areas_mejora: lineasA.join("\n"),
  }
}
