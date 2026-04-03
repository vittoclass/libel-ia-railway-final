/**
 * Veredictos de tendencia (Δ en puntos porcentuales entre dos agregados del mismo nivel y definición).
 * Umbral 5 pp: explícito en reglas de negocio.
 */

export type TrendVerdict = "incremento_inteligencia" | "alerta_retroceso" | "estable"

const THRESHOLD_PP = 5

export function classifyTrendDelta(deltaPercentagePoints: number): TrendVerdict {
  if (deltaPercentagePoints > THRESHOLD_PP) return "incremento_inteligencia"
  if (deltaPercentagePoints < -THRESHOLD_PP) return "alerta_retroceso"
  return "estable"
}

export function buildTraceabilityInsight(params: {
  axisLabel: string
  skillLabel: string
  subject: string
  levelLabel: string
  currentPct: number | null
  previousPct: number | null
  deltaPp: number | null
  verdict: TrendVerdict
  semesterCurrent: string
  semesterPrevious: string | null
}): string {
  const cur = params.currentPct != null ? `${Math.round(params.currentPct * 10) / 10}%` : "sin dato"
  const prev =
    params.previousPct != null ? `${Math.round(params.previousPct * 10) / 10}%` : "sin dato previo"
  const axis = params.axisLabel || "el eje pedagógico"
  const skill = params.skillLabel || "la habilidad"
  const deltaStr =
    params.deltaPp != null ? `${params.deltaPp > 0 ? "+" : ""}${Math.round(params.deltaPp * 10) / 10} pp` : "sin comparación"

  if (params.verdict === "incremento_inteligencia") {
    return `${params.levelLabel} (${params.subject}): ${axis} — ${skill} muestra un incremento de inteligencia (${deltaStr} de logro entre ${params.semesterPrevious ?? "periodo anterior"} y ${params.semesterCurrent}; actual ${cur}, anterior ${prev}).`
  }
  if (params.verdict === "alerta_retroceso") {
    return `${params.levelLabel} (${params.subject}): alerta de retroceso en ${axis} — ${skill} (${deltaStr}; actual ${cur}, anterior ${prev}). Revise refuerzo y alineación de evaluaciones.`
  }
  return `${params.levelLabel} (${params.subject}): ${axis} — ${skill} se mantiene estable (${deltaStr}; ${cur} vs ${prev} en ${params.semesterCurrent}).`
}
