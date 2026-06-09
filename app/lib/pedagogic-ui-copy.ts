/**
 * Etiquetas pedagógicas alineadas al lenguaje técnico escolar chileno (solo UI).
 * Reversión rápida: poner USE_NEW_PEDAGOGIC_LABELS = false.
 */

import { PAES_PROJECTION_DISCLAIMER } from "@/app/lib/paesProjectionCanonical"
import { SIMCE_PROJECTION_SCALE_LABEL, SIMCE_PROJECTION_SCALE_RANGE } from "@/app/lib/simceProjectionCanonical"

export const USE_NEW_PEDAGOGIC_LABELS = true

const LEGACY = {
  promedioLogro: "Promedio de Logro Institucional",
  semaforoRiesgo: "Semáforo de Riesgo (Agencia)",
  distribucionEstadar: "Distribución por Estándar Agencia",
  logroPorHabilidad: "Logro por habilidad (%)",
  logroPorEje: "Logro por eje (%)",
  tooltipSeries: "Logro",
  nivelAgenciaCol: "Nivel Agencia",
  logroCol: "Logro",
} as const

const NUEVO = {
  coberturaTitulo: "Cobertura Curricular Real",
  coberturaBajada:
    "Mide el % de respuestas correctas sobre el total de ítems, reflejando el aprendizaje efectivo sin el filtro de la escala de notas.",
  estandarTitulo: "Estándar de Aprendizaje (Agencia)",
  estandarBajada:
    "Clasificación de desempeño (Insuficiente, Elemental, Adecuado) según los criterios de la Agencia de Calidad de la Educación.",
  semaforoTitulo: "Semáforo de Desempeño Institucional",
  semaforoBajada:
    "Estado de salud pedagógica del establecimiento frente a la categorización nacional vigente.",
  coberturaPorHabilidad: "Cobertura curricular por habilidad (%)",
  coberturaPorEje: "Cobertura curricular por eje (%)",
  coberturaPorHabilidadBajada:
    "Participación correcta en ítems asociados a cada habilidad; no equivale a la escala de notas Chile.",
  coberturaPorEjeBajada: "Participación correcta en ítems por eje del currículo; indicador de logro observable en aula.",
  tooltipCobertura: "Cobertura curricular",
  estandarAprendizajeCol: "Estándar de Aprendizaje (Agencia)",
  coberturaCol: "Cobertura curricular (%)",
  simceProyectadoTitulo: "SIMCE Proyectado",
  simceProyectadoBajada:
    `Estimación referencial (escala ${SIMCE_PROJECTION_SCALE_RANGE}) basada en el nivel de cobertura curricular actual.`,
  paesProyectadoTitulo: "PAES Proyectado (referencial)",
  paesProyectadoBajada:
    "Estimación pedagógica en escala 100–1000 según el desempeño observado en esta evaluación; no reemplaza puntaje oficial DEMRE.",
} as const

const LEGACY_NACIONAL = {
  simce: "SIMCE Proyectado",
  paes: "PAES Proyectado Promedio",
} as const

function pick<N extends string, L extends string>(nuevo: N, legacy: L): N | L {
  try {
    if (USE_NEW_PEDAGOGIC_LABELS && typeof nuevo === "string" && nuevo.length > 0) return nuevo
  } catch {
    /* fallback */
  }
  return legacy
}

export function uiCoberturaTitulo() {
  return pick(NUEVO.coberturaTitulo, LEGACY.promedioLogro)
}

export function uiCoberturaBajada() {
  return USE_NEW_PEDAGOGIC_LABELS ? NUEVO.coberturaBajada : ""
}

export function uiEstandarAprendizajeTitulo() {
  return pick(NUEVO.estandarTitulo, LEGACY.distribucionEstadar)
}

export function uiEstandarAprendizajeBajada() {
  return USE_NEW_PEDAGOGIC_LABELS ? NUEVO.estandarBajada : ""
}

export function uiSemaforoTitulo() {
  return pick(NUEVO.semaforoTitulo, LEGACY.semaforoRiesgo)
}

export function uiSemaforoBajada() {
  return USE_NEW_PEDAGOGIC_LABELS
    ? NUEVO.semaforoBajada
    : "Conteo por nivel de logro proyectado"
}

export function uiCoberturaPorHabilidadTitulo() {
  return pick(NUEVO.coberturaPorHabilidad, LEGACY.logroPorHabilidad)
}

export function uiCoberturaPorEjeTitulo() {
  return pick(NUEVO.coberturaPorEje, LEGACY.logroPorEje)
}

export function uiCoberturaPorHabilidadBajada() {
  return USE_NEW_PEDAGOGIC_LABELS ? NUEVO.coberturaPorHabilidadBajada : ""
}

export function uiCoberturaPorEjeBajada() {
  return USE_NEW_PEDAGOGIC_LABELS ? NUEVO.coberturaPorEjeBajada : ""
}

export function uiChartTooltipLabel() {
  return pick(NUEVO.tooltipCobertura, LEGACY.tooltipSeries)
}

export function uiTablaCoberturaCol() {
  return pick(NUEVO.coberturaCol, LEGACY.logroCol)
}

export function uiTablaEstandarAgenciaCol() {
  return pick(NUEVO.estandarAprendizajeCol, LEGACY.nivelAgenciaCol)
}

/** title="" en <th> para micro-explicación vía hover (texto legacy). */
export function uiLegacyTooltipCoberturaCol() {
  return LEGACY.logroCol
}

export function uiLegacyTooltipEstandarCol() {
  return LEGACY.nivelAgenciaCol
}

export function uiSimceProyectadoTitulo() {
  return pick(NUEVO.simceProyectadoTitulo, LEGACY_NACIONAL.simce)
}

export function uiSimceProyectadoBajada() {
  return USE_NEW_PEDAGOGIC_LABELS ? NUEVO.simceProyectadoBajada : SIMCE_PROJECTION_SCALE_LABEL
}

export function uiSimceProyectadoEscalaLabel() {
  return SIMCE_PROJECTION_SCALE_LABEL
}

export function uiPaesProyectadoTitulo() {
  return pick(NUEVO.paesProyectadoTitulo, LEGACY_NACIONAL.paes)
}

export function uiPaesProyectadoBajada() {
  return USE_NEW_PEDAGOGIC_LABELS ? NUEVO.paesProyectadoBajada : "Escala PAES referencial (100–1000)"
}

export function uiPaesProyectadoDisclaimer() {
  return PAES_PROJECTION_DISCLAIMER
}

export function uiProyeccionNacionalTitulo() {
  return "Proyección referencial (SIMCE / PAES)"
}
