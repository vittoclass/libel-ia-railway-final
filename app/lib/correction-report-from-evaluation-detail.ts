/**
 * Reconstruye el payload mínimo para `ReportDocument` (PDF informe corrección) desde
 * GET /api/evaluations/[id]. Solo lectura / mapeo; no toca OMR ni persistencia.
 */

export const MAX_CORRECTION_REPORTS_ZIP_PHASE1 = 40

export function sanitizeCorrectionZipPart(raw: string | null | undefined, fallback: string): string {
  const base = String(raw ?? "").trim() || fallback
  const cleaned = base
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
  return cleaned || fallback
}

type AltRow = { pregunta: string; respuesta_estudiante: string; respuesta_correcta: string }

export type CorrectionReportGroupForPdf = {
  id: string
  studentName: string
  files: []
  retroalimentacion?: {
    correccion_detallada?: unknown[]
    evaluacion_habilidades?: unknown[]
    resumen_general?: { fortalezas: string; areas_mejora: string }
    retroalimentacion_alternativas?: AltRow[]
  }
  alternativas_corregidas?: AltRow[]
  puntaje?: string
  nota?: number | string
  decimasAdicionales: number
  isEvaluated: true
  isEvaluating: false
  detalle_desarrollo?: Record<string, unknown>
  puntosAprobacion?: number
  puntosMaximos?: number
}

export type EvaluationDetailJsonForCorrectionZip = Record<string, unknown>

function isRecord(u: unknown): u is Record<string, unknown> {
  return u != null && typeof u === "object" && !Array.isArray(u)
}

function altsFromItems(items: unknown): AltRow[] {
  if (!Array.isArray(items)) return []
  const out: AltRow[] = []
  for (const it of items) {
    if (!isRecord(it)) continue
    const n = it.question_number
    const pregunta =
      typeof n === "number" && Number.isFinite(n)
        ? `Pregunta ${n}`
        : typeof n === "string" && n.trim()
          ? n.trim()
          : "Pregunta"
    const stud = String(it.student_answer ?? "").trim()
    const corr = String(it.correct_answer ?? "").trim()
    out.push({ pregunta, respuesta_estudiante: stud, respuesta_correcta: corr })
  }
  return out
}

function scoreTotalsFromItems(items: unknown): { obtained: number; max: number } | null {
  if (!Array.isArray(items)) return null
  let o = 0
  let m = 0
  for (const it of items) {
    if (!isRecord(it)) continue
    o += Number(it.score_obtained) || 0
    m += Number(it.score_max) || 0
  }
  if (m <= 0) return null
  return { obtained: o, max: m }
}

export function buildCorrectionReportGroupFromApiDetail(
  j: EvaluationDetailJsonForCorrectionZip,
):
  | { ok: true; group: CorrectionReportGroupForPdf; warnings: string[] }
  | { ok: false; error: string } {
  const warnings: string[] = []
  const evaluation = isRecord(j.evaluation) ? j.evaluation : null
  const items = j.items
  const summary = isRecord(j.summary) ? j.summary : null

  if (!evaluation && !Array.isArray(items)) {
    return { ok: false, error: "Respuesta de API sin evaluation ni items" }
  }

  let raw: Record<string, unknown> | null = null
  if (summary && isRecord(summary.raw)) {
    raw = summary.raw
  }

  const studentName =
    String(
      evaluation?.student_name ?? raw?.nombreEstudianteDetectado ?? raw?.studentName ?? "Estudiante",
    ).trim() || "Estudiante"

  let alternativas: AltRow[] | undefined
  if (raw && Array.isArray(raw.alternativas_corregidas)) {
    const parsed: AltRow[] = []
    for (const row of raw.alternativas_corregidas) {
      if (!isRecord(row)) continue
      const pregunta = String(row.pregunta ?? "").trim() || "Pregunta"
      parsed.push({
        pregunta,
        respuesta_estudiante: String(row.respuesta_estudiante ?? "").trim(),
        respuesta_correcta: String(row.respuesta_correcta ?? "").trim(),
      })
    }
    if (parsed.length > 0) alternativas = parsed
  }
  if (!alternativas || alternativas.length === 0) {
    alternativas = altsFromItems(items)
    if (alternativas.length > 0) warnings.push("Alternativas reconstruidas desde ítems (sin raw.alternativas_corregidas).")
  }

  const totals = scoreTotalsFromItems(items)
  let puntaje: string | undefined =
    raw && typeof raw.puntaje === "string" && raw.puntaje.includes("/") ? raw.puntaje : undefined
  if (!puntaje && totals) {
    const o = Math.round(totals.obtained * 10) / 10
    const mx = Math.round(totals.max * 10) / 10
    puntaje = `${o}/${mx}`
    warnings.push("Puntaje reconstruido desde evaluation_items.")
  }

  const notaRaw = raw?.nota ?? summary?.grade_chile
  let nota: number | string | undefined
  if (typeof notaRaw === "number" && Number.isFinite(notaRaw)) {
    nota = notaRaw
  } else if (notaRaw != null && String(notaRaw).trim() !== "") {
    const n = Number(notaRaw)
    nota = Number.isFinite(n) ? n : String(notaRaw)
  }

  let puntosMaximos: number | undefined =
    typeof raw?.puntosMaximos === "number" && Number.isFinite(raw.puntosMaximos) ? raw.puntosMaximos : totals?.max
  let puntosAprobacion: number | undefined =
    typeof raw?.puntosAprobacion === "number" && Number.isFinite(raw.puntosAprobacion) ? raw.puntosAprobacion : undefined

  if (puntosAprobacion == null && typeof puntosMaximos === "number" && puntosMaximos > 0) {
    puntosAprobacion = Math.ceil(puntosMaximos * 0.4)
    warnings.push("puntosAprobacion estimado (40% del máximo); faltaba en persistido.")
  }

  let detalle_desarrollo: Record<string, unknown> | undefined
  if (raw && isRecord(raw.detalle_desarrollo)) {
    detalle_desarrollo = raw.detalle_desarrollo
  }

  let retro: CorrectionReportGroupForPdf["retroalimentacion"]
  if (raw && isRecord(raw.retroalimentacion)) {
    const r = raw.retroalimentacion
    retro = {
      correccion_detallada: Array.isArray(r.correccion_detallada) ? r.correccion_detallada : undefined,
      evaluacion_habilidades: Array.isArray(r.evaluacion_habilidades) ? r.evaluacion_habilidades : undefined,
      resumen_general: isRecord(r.resumen_general)
        ? {
            fortalezas: String((r.resumen_general as Record<string, unknown>).fortalezas ?? ""),
            areas_mejora: String((r.resumen_general as Record<string, unknown>).areas_mejora ?? ""),
          }
        : undefined,
      retroalimentacion_alternativas: Array.isArray(r.retroalimentacion_alternativas)
        ? (r.retroalimentacion_alternativas as AltRow[])
        : undefined,
    }
  }
  if (!retro && (summary?.strengths || summary?.improvements)) {
    retro = {
      resumen_general: {
        fortalezas: String(summary?.strengths ?? ""),
        areas_mejora: String(summary?.improvements ?? ""),
      },
    }
    warnings.push("Resumen pedagógico parcial desde strengths/improvements de summary.")
  }
  if (
    retro &&
    (!retro.retroalimentacion_alternativas || retro.retroalimentacion_alternativas.length === 0) &&
    alternativas?.length
  ) {
    retro = { ...retro, retroalimentacion_alternativas: alternativas }
  }

  const hasMinimal =
    (alternativas && alternativas.length > 0) ||
    (detalle_desarrollo && Object.keys(detalle_desarrollo).length > 0) ||
    Boolean(puntaje && puntaje.includes("/"))

  if (!hasMinimal) {
    return {
      ok: false,
      error:
        "No hay datos mínimos para el informe (alternativas, desarrollo o puntaje). La evaluación puede estar incompleta en servidor.",
    }
  }

  const evalId = evaluation?.id != null ? String(evaluation.id) : "eval"

  const group: CorrectionReportGroupForPdf = {
    id: `api-${evalId}`,
    studentName,
    files: [],
    decimasAdicionales: 0,
    isEvaluated: true,
    isEvaluating: false,
    alternativas_corregidas: alternativas,
    retroalimentacion: retro,
    puntaje,
    nota,
    detalle_desarrollo,
    puntosMaximos,
    puntosAprobacion,
  }

  return { ok: true, group, warnings }
}
