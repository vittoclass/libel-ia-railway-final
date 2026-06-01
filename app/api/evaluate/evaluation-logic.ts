// app/api/evaluate/route.ts
// Endpoint principal para evaluar pruebas de estudiantes
// Integra OMR para respuestas cerradas con retroalimentación IA
// Soporta imágenes, PDF y Word: si hay PDF/Word se usa Azure OCR + Mistral texto; si solo imágenes, Mistral Vision.
import { NextResponse } from "next/server"
import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer"
// FIX_BUILD_PATH_REVERSIBLE: usar rutas relativas robustas (Railway case-sensitive + build context)
import { getTemplate, getTemplateImage } from "../../lib/omrTemplateCache"
import { fileToImageBase64List, isPdfBase64 } from "../../lib/pdfToImages"
import { extractTextFromFiles } from "./utils"
import { persistEvaluation } from "../../lib/persist-evaluation"
import { getAuthUser } from "../../lib/supabase-route"
import { getSupabaseServer } from "../../lib/supabase-server"
import { runAzureLayoutOmrPipeline } from "../../lib/omr/experimental/azure-layout-omr-pipeline"
import { extractStudentClosedAnswersInterleavedLayout } from "../../lib/omr-interleaved/extract-closed-answers"
import type { OmrTemplateVariantInterleaved } from "../../lib/omr-interleaved/types"
import {
  buildEvaluationBase,
  buildTeacherAnswerKeyFromFormPauta,
  getFormItemCorrectAnswer,
  isEvaluationBaseItemClosedForOmr,
  isFormStructuredRowClosedForOmr,
  toCanonicalPautaFromEvaluationBaseItems,
  type EvaluationBaseSourceExamItemInput,
} from "../../lib/evaluation-base"
import {
  cerradaMapKeyFromPregunta,
  dedupePautaAlternativasToCanonicalMap,
  normalizeToCanonicalId,
} from "../../lib/canonical-closed-id"
import {
  accumulateDesarrolloAcrossPages,
  collapseDevelopmentKeysToCanonical,
  filterDesarrolloExcludingClosedPautaSlots,
  mergeVisionAndDedicatedDesarrollo,
  orderCanonicalDesarrolloRecord,
  pruneCorreccionDetalladaForCanonicalDesarrollo,
  removeCorreccionEntriesForClosedPautaSlots,
} from "../../lib/desarrollo-pipeline"
import {
  applyConsolidatedStudentClosedAnswers,
  mergeConsolidatedDesarrolloFinales,
  RESPUESTAS_FINALES_ESTUDIANTE,
  type CerradaRowForFinalEvaluation,
} from "../../lib/student-final-answers-for-evaluation"
import {
  omrTemplateKeyForClosedQuestionCount,
  resolveSourceExamOmrMetadata,
} from "../../lib/source-exam-omr-metadata"
import { enhanceOmrStudentImageBase64 } from "../../lib/omr-image-preenhance"
import { extractJsonObjectFromModelText } from "../../lib/smart-base-parser"
import {
  DEFAULT_EVALUATION_PROVIDER_TRACE,
  EvaluationIaUnavailableError,
  evaluationAiKeysConfigured,
  mergeEvaluationProviderTrace,
  requestEvaluationTextCompletion,
  requestEvaluationVisionCompletion,
  type EvaluationProviderTrace,
} from "../../lib/ai-evaluation-provider"

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY

type ProviderTraceAcc = { current: EvaluationProviderTrace }

function absorbProviderTrace(acc: ProviderTraceAcc | undefined, trace: EvaluationProviderTrace): void {
  if (acc) acc.current = mergeEvaluationProviderTrace(acc.current, trace)
}
const DEFAULT_STUDENT_NAME = "Estudiante No Identificado"
// SNAPSHOT_ESTABLE_OMR_MARCH_31
// Ajuste reversible de rigor/fidelidad en desarrollo:
// - Piso de generosidad para intento identificable: 0.5 (antes 1.0)
// - Marcador obligatorio [ilegible] para palabras no legibles
const DESARROLLO_MIN_ATTEMPT_SCORE = 0.5
// HUMAN_CONTEXT_TRANSCRIPTION_V1
// Regla reversible: usar contexto local solo para descifrar trazos, nunca para inventar/reemplazar evidencia.

/** Sin narrativa IA: informe ejecutivo solo alternativas (OMR + pauta). */
const RETRO_SOLO_ALTERNATIVAS_EJECUTIVO = "Evaluación de respuestas cerradas finalizada."

function retroalimentacionEjecutivaSoloAlternativas(): {
  fortalezas: string
  areas_mejora: string
  correccion_detallada: { seccion: string; detalle: string }[]
} {
  return {
    fortalezas: RETRO_SOLO_ALTERNATIVAS_EJECUTIVO,
    areas_mejora: "",
    correccion_detallada: [],
  }
}

/** Si la llamada HTTP a Mistral supera este tiempo, se asume IA/red colgada (logs Railway). */
const MISTRAL_FETCH_TIMEOUT_MS = 25_000
/** Pixtral / visión y payloads grandes: margen extra sin inflar texto plano. */
const MISTRAL_FETCH_TIMEOUT_MS_VISION = 40_000

function isMistralTimeoutError(e: unknown): boolean {
  return e instanceof Error && e.message === "ERROR_MISTRAL_TIMEOUT"
}

const ERROR_MISTRAL_JSON_DEGRADED = "ERROR_MISTRAL_JSON_DEGRADED"

function isMistralJsonDegradedError(e: unknown): boolean {
  return e instanceof Error && e.message === ERROR_MISTRAL_JSON_DEGRADED
}

/** Análisis vacío seguro cuando Mistral Vision no devuelve JSON parseable (conserva OMR ya leído). */
function emptyMistralVisionAnalysis() {
  return {
    respuestas_cerradas: [] as { pregunta: string; respuesta_detectada: string; confianza: number }[],
    respuestas_desarrollo: {} as Record<string, unknown>,
    retroalimentacion: {
      fortalezas:
        "Lectura integrada de la hoja por visión no disponible (tiempo de espera del servicio o respuesta ilegible o truncada). Si hay OMR dedicado, las alternativas cerradas provienen de esa lectura.",
      areas_mejora: "",
      correccion_detallada: [] as { seccion: string; detalle: string }[],
    },
    nombreEstudiante: null as string | null,
  }
}

/**
 * JSON de Mistral: parse directo; si SyntaxError / cadena truncada, repara con extractJsonObjectFromModelText.
 * Si no se puede reparar, lanza ERROR_MISTRAL_JSON_DEGRADED para degradar sin tumbar la evaluación.
 */
function parseMistralModelJsonContent(content: string): unknown {
  const raw = String(content ?? "").trim()
  if (!raw) throw new Error(ERROR_MISTRAL_JSON_DEGRADED)
  try {
    return JSON.parse(raw)
  } catch (first) {
    const tryLenient =
      first instanceof SyntaxError ||
      (first instanceof Error &&
        /unterminated string|unexpected end of json|unexpected token/i.test(first.message))
    if (!tryLenient) throw first
    try {
      return extractJsonObjectFromModelText(raw)
    } catch {
      throw new Error(ERROR_MISTRAL_JSON_DEGRADED)
    }
  }
}

const OMR_RAW_PREVIEW_SLICE = 10

function officialOmrPerQuestionRawWireFields(raw: unknown): {
  officialOmrPerQuestionRawLength: number
  officialOmrPerQuestionRawPreview: unknown[]
} {
  const arr = Array.isArray(raw) ? raw : []
  return {
    officialOmrPerQuestionRawLength: arr.length,
    officialOmrPerQuestionRawPreview: arr.slice(0, OMR_RAW_PREVIEW_SLICE),
  }
}

/** Quita `officialOmrPerQuestionRaw` completo del cuerpo HTTP de error (evita truncamiento en cliente). */
function omitHeavyOmrFieldsForErrorWire(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(payload, "officialOmrPerQuestionRaw")) return payload
  const { officialOmrPerQuestionRaw, ...rest } = payload
  return { ...rest, ...officialOmrPerQuestionRawWireFields(officialOmrPerQuestionRaw) }
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === "function") return anyFn([a, b])
  return b
}

/** Reintentos para 502/503/429 (overload/servicio no disponible). Timeout por intento: ERROR_MISTRAL_TIMEOUT. */
async function fetchMistralWithRetry(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? MISTRAL_FETCH_TIMEOUT_MS
  const maxRetries = 3
  const retryStatuses = [502, 503, 429]
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
    console.log("[evaluate][Mistral] ANTES fetch", { attempt, maxRetries, timeoutMs })
    try {
      const signal = init.signal
        ? mergeAbortSignals(init.signal, timeoutController.signal)
        : timeoutController.signal
      const res = await fetch(url, { ...init, signal })
      clearTimeout(timeoutId)
      console.log("[evaluate][Mistral] DESPUÉS fetch", { attempt, ok: res.ok, status: res.status })
      if (res.ok) return res
      const body = await res.text()
      const errMsg = `Mistral API error: ${res.status} - ${body.slice(0, 300)}`
      if (!retryStatuses.includes(res.status) || attempt === maxRetries) {
        throw new Error(errMsg)
      }
      const delayMs = 2000 * Math.pow(2, attempt - 1)
      console.warn(`[Mistral] ${res.status} (intento ${attempt}/${maxRetries}), reintento en ${delayMs}ms`)
      await new Promise((r) => setTimeout(r, delayMs))
    } catch (e) {
      clearTimeout(timeoutId)
      const abortedByTimeout = timeoutController.signal.aborted
      const isAbortError =
        e instanceof Error && (e.name === "AbortError" || (e as { code?: string }).code === "ABORT_ERR")
      if (abortedByTimeout && isAbortError) {
        console.error("[evaluate][Mistral] ERROR_MISTRAL_TIMEOUT", { attempt, url: url.slice(0, 96) })
        throw new Error("ERROR_MISTRAL_TIMEOUT")
      }
      lastError = e instanceof Error ? e : new Error(String(e))
      if (lastError.message === "ERROR_MISTRAL_TIMEOUT") throw lastError
      if (attempt === maxRetries) throw lastError
      const delayMs = 2000 * Math.pow(2, attempt - 1)
      console.warn(`[Mistral] Error (intento ${attempt}/${maxRetries}):`, lastError.message)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError || new Error("Mistral API error: servicio no disponible")
}

// Tipos para la pauta estructurada
interface ItemScore {
  id: string
  maxScore: number
  isDevelopment: boolean
}

interface AlternativeResult {
  pregunta: string
  respuesta_estudiante: string
  respuesta_correcta: string
}

// Parsear la pauta estructurada (formato: "SM1:1; SM2:1; P1:5; ...")
function parsePautaEstructurada(pautaStr: string): ItemScore[] {
  const items: ItemScore[] = []
  if (!pautaStr) return items

  const pairs = pautaStr.split(";").map(p => p.trim()).filter(p => p.length > 0)

  for (const pair of pairs) {
    const [id, scoreStr] = pair.split(":").map(s => s.trim())
    const maxScore = parseInt(scoreStr, 10)

    if (id && !isNaN(maxScore) && maxScore > 0) {
      items.push({
        id: id,
        maxScore: maxScore,
        isDevelopment: id.toLowerCase().includes("desarrollo") || id.toLowerCase().match(/^p\d+/) !== null,
      })
    }
  }
  return items
}

/**
 * Inventario híbrido en orden de examen: solo ids tal como aparecen en `pautaEstructurada` (cerradas + desarrollo).
 * Regla de oro: una sola pasada por `parsePautaEstructurada`; sin rellenos ni numeración inferida.
 */
function buildHybridStructuredQuestionOrder(pautaEstructurada: string): string[] {
  return parsePautaEstructurada(pautaEstructurada)
    .map((r) => String(r?.id ?? "").trim())
    .filter((id) => id.length > 0)
}

/** Prueba mixta con bloques cerrado/desarrollo alternados en la pauta (≥2 transiciones). */
function pautaHasInterleavedDevelopmentBlocks(rows: ItemScore[]): boolean {
  if (rows.length < 3) return false
  const hasDev = rows.some((r) => r.isDevelopment)
  const hasClosed = rows.some((r) => !r.isDevelopment)
  if (!hasDev || !hasClosed) return false
  let transitions = 0
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].isDevelopment !== rows[i - 1].isDevelopment) transitions++
  }
  return transitions >= 2
}

/**
 * Activa el pipeline Azure interleaved si el body envía omrClosedLayoutMode === "interleaved_development",
 * o heurísticamente cuando la pauta estructurada muestra cerradas y desarrollo intercalados (≥2 transiciones).
 * EVALUATE_INTERLEAVED_OMR=false desactiva por completo. "standard" fuerza el layout Azure clásico (sin interleaved).
 * Inventario de cerradas: siempre acotado por officialClosedCount (>0); solo_desarrollo no entra (0 cerradas).
 */
function resolveUseInterleavedAzureOmr(params: {
  explicitLayoutMode: string
  tipoPrueba: "mixta" | "solo_desarrollo" | "solo_alternativas"
  pautaRows: ItemScore[]
  officialClosedCount: number
}): boolean {
  if (params.officialClosedCount <= 0) return false
  const explicit = params.explicitLayoutMode.trim().toLowerCase()
  if (explicit === "standard") return false
  const envOff = String(process.env.EVALUATE_INTERLEAVED_OMR ?? "true").trim().toLowerCase() === "false"
  if (envOff) return false
  if (explicit === "interleaved_development") return true
  if (params.tipoPrueba === "solo_desarrollo") return false
  return pautaHasInterleavedDevelopmentBlocks(params.pautaRows)
}

/** Extrae solo la opción marcada: A-E, V, F, o número. Evita frases completas. */
function normalizeRespuestaCerrada(texto: string): string {
  if (!texto || typeof texto !== "string") return "BLANK"
  const t = texto.trim().toUpperCase()
  if (t === "" || t === "SIN_RESPUESTA" || t === "SIN RESPUESTA") return "BLANK"
  if (t === "BLANK") return "BLANK"
  if (t === "MULTIPLE") return "MULTIPLE"
  const letraMatch = t.match(/^([A-E])[\s):.(]?/) || t.match(/\b([A-E])\b/)
  if (letraMatch) return letraMatch[1]
  if (t.match(/^([VF])[\s):.(]?/) || t === "V" || t === "F") return t.charAt(0)
  const numMatch = t.match(/(\d+)/)
  if (numMatch) return numMatch[1]
  if (/^[A-EVF]$/.test(t)) return t
  return "BLANK"
}

type CerradaNormRow = { pregunta: string; respuesta_detectada: string; confianza: number }

/** Índice de detecciones por `C<n>` únicamente (sin alias duplicados en el mapa). */
function buildCerradaDetectionLookup(rows: CerradaNormRow[]): Map<string, CerradaNormRow> {
  const m = new Map<string, CerradaNormRow>()
  for (const r of rows) {
    const canon = normalizeToCanonicalId(r.pregunta)
    if (!canon) continue
    if (!m.has(canon)) {
      m.set(canon, {
        pregunta: canon,
        respuesta_detectada: r.respuesta_detectada,
        confianza: Number(r.confianza) || 0.8,
      })
    }
  }
  return m
}

function dedupeCerradasDetectedOnly(rows: CerradaNormRow[]): CerradaNormRow[] {
  const seen = new Set<string>()
  const out: CerradaNormRow[] = []
  let n = 0
  for (const r of rows) {
    const canon = normalizeToCanonicalId(r.pregunta)
    const id = (canon ?? String(r.pregunta ?? "").trim()) || `Q${++n}`
    const k = id.toUpperCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push({
      pregunta: canon ?? id,
      respuesta_detectada: normalizeRespuestaCerrada(String(r.respuesta_detectada ?? "")),
      confianza: Number(r.confianza) || 0.8,
    })
  }
  return out
}

/**
 * Inventario oficial (evaluation base, ítems cerrados) + detecciones OMR/IA; sin inflar más allá del inventario.
 * Alineación exclusiva por `canonicalId` (C{n}); nunca por posición en arreglo.
 */
function alignCerradasToOfficialInventory(
  detected: CerradaNormRow[],
  officialClosed: { id: string; order: number }[],
): CerradaNormRow[] {
  if (!officialClosed.length) return dedupeCerradasDetectedOnly(detected)
  const lookup = buildCerradaDetectionLookup(detected)
  const sorted = [...officialClosed].sort((a, b) => a.order - b.order)
  const out: CerradaNormRow[] = []
  const usedCanonical = new Set<string>()
  for (const it of sorted) {
    const canon = normalizeToCanonicalId(it.id)
    if (!canon) continue
    const hit = lookup.get(canon)
    if (hit) usedCanonical.add(canon)
    out.push({
      pregunta: canon,
      respuesta_detectada: hit ? normalizeRespuestaCerrada(hit.respuesta_detectada) : "BLANK",
      confianza: hit ? hit.confianza : 0,
    })
  }
  for (const row of dedupeCerradasDetectedOnly(detected)) {
    const c = normalizeToCanonicalId(row.pregunta)
    if (!c || usedCanonical.has(c)) continue
    out.push(row)
  }
  return out
}

/**
 * Cuando `ingestExtradas` / el mapa por pregunta queda vacío pero el pipeline OMR sí materializó
 * `officialOmrPerQuestionRaw`, reconstruye el mismo shape que el adaptador Azure/interleaved.
 */
function rebuildStudentClosedAnswersFromOfficialOmrPerQuestionRaw(
  officialOmrPerQuestionRaw: any[],
  closedQuestionIds: string[],
  teacherAnswerKey: Array<{ pregunta: string; respuestaCorrecta: string }>,
  opts?: { recovery?: boolean },
): Array<{ pregunta: string; respuesta_detectada: string; confianza: number; source?: string; recovery?: boolean }> {
  if (!Array.isArray(officialOmrPerQuestionRaw) || officialOmrPerQuestionRaw.length === 0) return []
  const sorted = [...officialOmrPerQuestionRaw].sort(
    (a, b) => Number(a?.questionNumber ?? 0) - Number(b?.questionNumber ?? 0),
  )
  const out: Array<{
    pregunta: string
    respuesta_detectada: string
    confianza: number
    source?: string
    recovery?: boolean
  }> = []
  let rowOrdinal = 0
  for (const row of sorted) {
    const qn = Number(row?.questionNumber ?? 0)
    if (qn < 1) continue
    const canonRaw =
      row && typeof row === "object" && typeof (row as any).canonicalId === "string"
        ? String((row as any).canonicalId).trim()
        : ""
    const fromClosedAtPos = closedQuestionIds[rowOrdinal]
    const fromTeacherAtPos = teacherAnswerKey[rowOrdinal]?.pregunta
    rowOrdinal++
    const keyId =
      normalizeToCanonicalId(canonRaw) ||
      normalizeToCanonicalId(fromClosedAtPos) ||
      normalizeToCanonicalId(fromTeacherAtPos) ||
      normalizeToCanonicalId(`C${qn}`) ||
      `C${qn}`
    const ansRaw = String(row?.selectedAnswer ?? "").trim().toUpperCase()
    const confidenceMapRaw =
      row && typeof row === "object" && (row as any).confidencesByColumn && typeof (row as any).confidencesByColumn === "object"
        ? ((row as any).confidencesByColumn as Record<string, unknown>)
        : {}
    const confidenceEntries = Object.entries(confidenceMapRaw)
      .map(([k, v]) => [String(k).toUpperCase(), Number(v)] as const)
      .filter(([k, v]) => /^[A-Z]$/.test(k) && Number.isFinite(v))
      .sort((a, b) => b[1] - a[1])
    const bestByConfidence = confidenceEntries[0]?.[0] ?? ""
    const ans =
      ansRaw === "MULTIPLE"
        ? bestByConfidence || "BLANK"
        : ansRaw === "" || ansRaw === "SIN_RESPUESTA" || ansRaw === "BLANK"
          ? "BLANK"
          : ansRaw
    const isBlankLike = ans === "BLANK" || ans === "SIN_RESPUESTA" || ans === ""
    const confFromRow =
      row && typeof row === "object" && typeof (row as any).confidence === "number" && Number.isFinite((row as any).confidence)
        ? (row as any).confidence
        : null
    const confianza = confFromRow != null ? confFromRow : isBlankLike ? 0.4 : 0.92
    const base = { pregunta: keyId, respuesta_detectada: ans, confianza }
    out.push(
      opts?.recovery ? { ...base, source: "officialOmrPerQuestionRaw", recovery: true } : base,
    )
  }
  return out
}

function extractClosedOrdinalFromQuestionId(id: string): number | null {
  const c = normalizeToCanonicalId(id)
  if (c) {
    const n = Number(c.slice(1))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const m = String(id ?? "").toUpperCase().match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function sortDetectedCerradasByOfficialClosedOrder<
  T extends { pregunta: string; respuesta_detectada: string; confianza: number },
>(rows: T[], officialClosedOrderIds: string[]): T[] {
  const rank = new Map<string, number>()
  officialClosedOrderIds.forEach((id, i) => {
    const c = normalizeToCanonicalId(id)
    if (c && !rank.has(c)) rank.set(c, i)
  })
  return [...rows].sort((a, b) => {
    const ca = normalizeToCanonicalId(a.pregunta)
    const cb = normalizeToCanonicalId(b.pregunta)
    const ra = ca != null ? rank.get(ca) ?? 999_999 : 999_999
    const rb = cb != null ? rank.get(cb) ?? 999_999 : 999_999
    if (ra !== rb) return ra - rb
    const na = ca ? parseInt(ca.slice(1), 10) : Number.MAX_SAFE_INTEGER
    const nb = cb ? parseInt(cb.slice(1), 10) : Number.MAX_SAFE_INTEGER
    return na - nb
  })
}

/** ¿La lectura OMR de cerrada es vacía / no detectada? (alineado a isBlankLikeDetectedAnswer en POST). */
function isOmrBlankForRetroVeto(value: string): boolean {
  const norm = String(value ?? "").trim().toUpperCase()
  return norm === "" || norm === "BLANK" || norm === "SIN_RESPUESTA"
}

function resolveOmrLegacyForRow(
  r: { pregunta?: string },
  legacyByUpper: Map<string, boolean>
): boolean {
  const k = String(r.pregunta ?? "").trim().toUpperCase()
  if (legacyByUpper.get(k) === true) return true
  const n = extractClosedOrdinalFromQuestionId(k)
  if (n != null) {
    if (legacyByUpper.get(`SM${n}`) === true) return true
    if (legacyByUpper.get(`C${n}`) === true) return true
    if (legacyByUpper.get(`VF${n}`) === true) return true
  }
  return false
}

function claimsConcreteAlternativeInText(text: string): boolean {
  const t = String(text ?? "")
  return (
    /\b(marc[óo]|eligi[óo]|seleccion[óo]|indic[óo]|contest[óo]|respondi[óo])\s+([A-E]|la\s+[A-E])\b/i.test(
      t
    ) ||
    /\bletra\s+[A-E]\b/i.test(t) ||
    /\bopci[oó]n\s+[A-E]\b/i.test(t)
  )
}

function correccionReferencesClosedQuestion(detalle: string, seccion: string, label: string): boolean {
  const blob = `${detalle} ${seccion}`.toUpperCase()
  const u = label.trim().toUpperCase()
  if (u && blob.includes(u)) return true
  const n = extractClosedOrdinalFromQuestionId(u)
  if (n != null) {
    if (blob.includes(`SM${n}`) || blob.includes(`C${n}`) || blob.includes(`VF${n}`)) return true
    if (blob.includes(`PREGUNTA ${n}`) || blob.includes(`ÍTEM ${n}`) || blob.includes(`ITEM ${n}`))
      return true
  }
  return false
}

/**
 * Veto de alucinación: si OMR dijo BLANK, no permitir texto que asuma una marca concreta en alternativas.
 * No altera puntajes; solo sanea retroalimentación generada por IA.
 */
function applyOmrBlankHonestyToRetroalimentacion(
  retro: any,
  cerradas: Array<{ pregunta: string; respuesta_detectada: string }>
): any {
  if (!retro || typeof retro !== "object") return retro
  const blanks: { label: string }[] = []
  for (const r of cerradas) {
    if (!isOmrBlankForRetroVeto(r.respuesta_detectada)) continue
    const label = String(r.pregunta ?? "").trim() || "ítem"
    blanks.push({ label })
  }
  if (blanks.length === 0) return retro

  const HONEST = "Respuesta no detectada o vacía."
  let cd = Array.isArray(retro.correccion_detallada) ? [...retro.correccion_detallada] : []
  cd = cd.filter((c: any) => {
    const det = String(c?.detalle ?? "")
    const sec = String(c?.seccion ?? "")
    if (!claimsConcreteAlternativeInText(det) && !claimsConcreteAlternativeInText(sec)) return true
    for (const b of blanks) {
      if (!correccionReferencesClosedQuestion(det, sec, b.label)) continue
      return false
    }
    return true
  })

  const seenHonest = new Set<string>()
  for (const b of blanks) {
    const key = b.label.toUpperCase()
    if (seenHonest.has(key)) continue
    seenHonest.add(key)
    cd.push({ seccion: "Alternativas (OMR)", detalle: `${b.label}: ${HONEST}` })
  }

  const out = { ...retro, correccion_detallada: cd }
  if (typeof out.fortalezas === "string" && claimsConcreteAlternativeInText(out.fortalezas)) {
    for (const b of blanks) {
      if (correccionReferencesClosedQuestion(out.fortalezas, "", b.label)) {
        out.fortalezas = `${HONEST} (Lectura OMR sin marca detectada en ${b.label}.)`
        break
      }
    }
  }
  if (typeof out.areas_mejora === "string" && claimsConcreteAlternativeInText(out.areas_mejora)) {
    for (const b of blanks) {
      if (correccionReferencesClosedQuestion(out.areas_mejora, "", b.label)) {
        out.areas_mejora = `${HONEST} (Revisar imagen o marcar a mano si corresponde: ${b.label}.)`
        break
      }
    }
  }
  return out
}

function ensureOfficialClosedInventorySize(
  officialClosed: Array<{ id: string; order: number }>,
  targetCount: number
): Array<{ id: string; order: number }> {
  const t = Math.max(0, Math.floor(targetCount))
  if (t <= 0) return officialClosed

  const byOrdinal = new Map<number, { id: string; order: number }>()
  for (const it of officialClosed) {
    const n = extractClosedOrdinalFromQuestionId(it.id)
    if (n != null && n >= 1 && !byOrdinal.has(n)) {
      byOrdinal.set(n, { id: it.id, order: n })
    }
  }
  const out: Array<{ id: string; order: number }> = []
  for (let n = 1; n <= t; n++) {
    const existing = byOrdinal.get(n)
    out.push(existing ?? { id: `C${n}`, order: n })
  }
  return out
}

// Calcular nota en escala chilena (1.0 - 7.0)
// Curva ligeramente generosa: debajo de 4.0 se usa exponente < 1 para que el mismo puntaje rinda una nota un poco mayor.
function calculateGrade(score: number, maxScore: number, porcentajeExigencia: number): number {
  if (maxScore <= 0 || porcentajeExigencia <= 0) return 1.0

  const exigenciaDecimal = Math.min(100, Math.max(1, porcentajeExigencia)) / 100
  const puntosAprobacion = Math.ceil(maxScore * exigenciaDecimal)
  const puntajeEfectivo = Math.max(0, score)

  if (puntajeEfectivo === 0) return 1.0

  let grade: number

  if (puntajeEfectivo <= puntosAprobacion) {
    // Curva menos severa: (x)^0.95 da un pequeño boost a puntajes intermedios
    const ratio = Math.min(1, puntajeEfectivo / puntosAprobacion)
    grade = 1.0 + 3.0 * Math.pow(ratio, 0.95)
    grade = Math.min(4.0, grade)
  } else {
    const remainingPoints = maxScore - puntosAprobacion
    if (remainingPoints === 0) return 7.0
    grade = 4.0 + 3.0 * ((puntajeEfectivo - puntosAprobacion) / remainingPoints)
  }

  return Math.min(7.0, Math.round(grade * 10) / 10)
}

// Convertir imagen a base64 si es URL
async function urlToBase64(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return url.replace(/^data:.*?;base64,/, "")
  }

  const response = await fetch(url)
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer).toString("base64")
}

/**
 * Parte `image_url` para Mistral Vision: si ya es https:// o data:, se usa tal cual;
 * si es base64 crudo (sin prefijo), se envía como data:image/jpeg;base64,...
 */
function mistralVisionImagePart(imageRef: string): { type: "image_url"; image_url: { url: string } } {
  const s = String(imageRef ?? "").trim()
  if (!s) {
    return { type: "image_url", image_url: { url: "" } }
  }
  const lower = s.toLowerCase()
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return { type: "image_url", image_url: { url: s } }
  }
  if (lower.startsWith("data:")) {
    return { type: "image_url", image_url: { url: s } }
  }
  return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${s}` } }
}

/** Mistral solo acepta imágenes (JPEG, PNG, WEBP, etc.). PDF/Word se convierten antes con fileToImageBase64List. */

/**
 * Resuelve fileUrls a una lista plana de imágenes en base64.
 * - Si es imagen: 1 elemento.
 * - Si es PDF: N elementos (una por página).
 * - Si es Word: lanza con mensaje para exportar a PDF.
 */
async function resolveToImageBase64List(
  fileUrls: string[],
  fileMimeTypes?: string[]
): Promise<string[]> {
  const list: string[] = []
  for (let i = 0; i < fileUrls.length; i++) {
    const url = fileUrls[i]
    const mime = fileMimeTypes?.[i]
    console.log("[evaluate][imagen] ANTES fileToImageBase64List", { index: i, mime: mime ?? null })
    const pages = await fileToImageBase64List(url, mime)
    console.log("[evaluate][imagen] DESPUÉS fileToImageBase64List", { index: i, pageCount: pages.length })
    list.push(...pages)
  }
  return list
}

/**
 * Puente autoritativo Source Exam -> clave docente.
 * Evita truncamientos del formulario: reconstruye pauta/clave directamente desde source_exam_items.
 */
async function loadAuthoritativeTeacherKeyFromSourceExam(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  sourceExamId: string,
  teacherId: string,
  tipoPrueba: "mixta" | "solo_desarrollo" | "solo_alternativas",
): Promise<{
  answerKeyFromTemplate: {
    respuestas: Array<{ pregunta: number; respuestaCorrecta: string; confianza: number; metodo: "manual" }>
    totalPreguntas: number
  } | null
  pautaEstructuradaCanonical: string
  pautaAlternativasCanonical: string
  closedItemsCount: number
} | null> {
  const sid = String(sourceExamId ?? "").trim()
  const tid = String(teacherId ?? "").trim()
  if (!sid || !tid) return null

  const { data: exam, error: examErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id")
    .eq("id", sid)
    .maybeSingle()
  if (examErr || !exam) return null
  if (String((exam as { teacher_id?: string | null }).teacher_id ?? "").trim() !== tid) return null

  const { data: rows, error: rowsErr } = await supabase
    .from("source_exam_items")
    .select("id, item_number, item_text, axis_id, skill_id, question_type, correct_answer, max_score, rubric_text")
    .eq("source_exam_id", sid)
    .order("item_number", { ascending: true })
  if (rowsErr || !rows?.length) return null

  const items: EvaluationBaseSourceExamItemInput[] = rows.map((r) => ({
    rowId: String((r as { id: string }).id),
    item_number: (r as { item_number?: number | null }).item_number ?? null,
    item_text: (r as { item_text?: string | null }).item_text ?? null,
    axis_id: (r as { axis_id?: string | null }).axis_id ?? null,
    skill_id: (r as { skill_id?: string | null }).skill_id ?? null,
    question_type: (r as { question_type?: string | null }).question_type ?? null,
    correct_answer: (r as { correct_answer?: string | null }).correct_answer ?? null,
    max_score: (r as { max_score?: number | null }).max_score ?? null,
    rubric_text: (r as { rubric_text?: string | null }).rubric_text ?? null,
  }))

  const eb = buildEvaluationBase({ sourceExam: { items } })
  const canonical = toCanonicalPautaFromEvaluationBaseItems(eb.items)
  const answerKeyFromTemplate = buildTeacherAnswerKeyFromFormPauta(
    String(canonical.pautaEstructurada ?? ""),
    String(canonical.pautaCorrectaAlternativas ?? ""),
    tipoPrueba,
  )
  const closedItemsCount = eb.items.filter((it) => isEvaluationBaseItemClosedForOmr(it)).length

  return {
    answerKeyFromTemplate,
    pautaEstructuradaCanonical: canonical.pautaEstructurada,
    pautaAlternativasCanonical: canonical.pautaCorrectaAlternativas,
    closedItemsCount,
  }
}

/** Obtiene base64 listo para Mistral. Si es PDF, convierte la primera página a imagen. */
async function getImageBase64ForVision(url: string): Promise<string> {
  const base64 = await urlToBase64(url)
  if (isPdfBase64(base64)) {
    console.log("[evaluate][imagen] ANTES fileToImageBase64List (PDF→visión)")
    const pages = await fileToImageBase64List(url, "application/pdf")
    console.log("[evaluate][imagen] DESPUÉS fileToImageBase64List (PDF→visión)", { pageCount: pages.length })
    if (pages.length === 0) throw new Error("El PDF no pudo convertirse a imágenes.")
    return pages[0]
  }
  return base64
}

/** Devuelve true si algún archivo es PDF o Word/Office (para usar rama Azure OCR en lugar de conversión a imágenes). */
function hasPdfOrWord(fileMimeTypes: string[] | undefined): boolean {
  if (!Array.isArray(fileMimeTypes) || fileMimeTypes.length === 0) return false
  return fileMimeTypes.some(
    (m) =>
      m === "application/pdf" ||
      (typeof m === "string" && (m.includes("officedocument") || m.includes("spreadsheetml")))
  )
}

/** Obtiene buffers desde fileUrls (data URLs o URLs) para enviar a Azure Document Intelligence. */
async function getFileBuffersFromUrls(
  fileUrls: string[],
  fileMimeTypes: string[]
): Promise<{ buffer: Buffer; mimeType: string }[]> {
  const out: { buffer: Buffer; mimeType: string }[] = []
  for (let i = 0; i < fileUrls.length; i++) {
    const url = fileUrls[i]
    const mimeType = fileMimeTypes[i] || "application/octet-stream"
    let buffer: Buffer
    if (url.startsWith("data:")) {
      const base64 = url.replace(/^data:.*?;base64,/, "")
      buffer = Buffer.from(base64, "base64")
    } else {
      const res = await fetch(url)
      const ab = await res.arrayBuffer()
      buffer = Buffer.from(ab)
    }
    out.push({ buffer, mimeType })
  }
  return out
}

/** Evalúa usando solo el texto extraído por Azure (PDF/Word/imagen). Alineado con la API antigua: generosidad calibrada, fortalezas con aspectos positivos, puntaje por ítem. */
async function analyzeWithMistralText(
  textoExtraido: string,
  rubrica: string,
  pauta: string,
  pautaEstructurada: string,
  pautaCorrectaAlternativas: string,
  nivelEducativo: string,
  areaConocimiento: string,
  puntajeTotal: number,
  porcentajeExigencia: number,
  tipoPrueba: "mixta" | "solo_desarrollo" | "solo_alternativas",
  flexibilidad: number = 3,
  nombreEstudiante?: string,
  providerTraceOut?: ProviderTraceAcc,
): Promise<{
  nombreEstudiante: string | null
  respuestas_cerradas: { pregunta: string; respuesta_detectada: string; confianza: number }[]
  respuestas_desarrollo: Record<string, { texto_estudiante: string; puntaje: string; justificacion: string }>
  retroalimentacion: { fortalezas: string; areas_mejora: string; correccion_detallada: { seccion: string; detalle: string }[] }
}> {
  const itemScores = parsePautaEstructurada(pautaEstructurada)
  const soloDesarrollo = tipoPrueba === "solo_desarrollo"
  const soloAlternativas = tipoPrueba === "solo_alternativas"
  if (soloAlternativas) {
    const n =
      nombreEstudiante && nombreEstudiante.trim() && nombreEstudiante !== "Estudiante"
        ? nombreEstudiante.trim()
        : null
    return {
      nombreEstudiante: n,
      respuestas_cerradas: [],
      respuestas_desarrollo: {},
      retroalimentacion: retroalimentacionEjecutivaSoloAlternativas(),
    }
  }
  const desarrolloItems = itemScores.filter((i) => i.isDevelopment)
  const desarrolloPuntajes = desarrolloItems.map((item) => `${item.id} (Máx: ${item.maxScore} pts)`).join(", ")
  const alternativasItems = itemScores.filter((i) => !i.isDevelopment)
  const listaIdsAlternativas = alternativasItems.map((i) => i.id).join(", ")
  const nombreInstruccion =
    nombreEstudiante && nombreEstudiante.trim() && nombreEstudiante !== "Estudiante"
      ? `**IMPORTANTE:** El nombre del estudiante es "${nombreEstudiante}". USA este nombre en fortalezas y áreas de mejora (ej: "${nombreEstudiante} demuestra...", "${nombreEstudiante} debe mejorar...").`
      : `**IMPORTANTE:** Si no hay nombre, usa "El estudiante" o "La estudiante" en fortalezas y áreas de mejora. NUNCA dejes frases sin sujeto.`

  const prompt = `Actúa como un profesor universitario riguroso pero justo. El objetivo es la EVALUACIÓN CUALITATIVA y la PUNTUACIÓN DIRECTA.

Puntaje máximo de la evaluación: ${puntajeTotal} puntos. Exigencia para aprobar: ${porcentajeExigencia}%.

${nombreInstruccion}

RÚBRICA DE EVALUACIÓN (criterio para desarrollo - escala 0 a máximo del ítem):
${rubrica}

${pauta ? `PAUTA DE RESPUESTAS (Desarrollo/Abiertas):\n${pauta}\n\n` : ""}

REGLAS DE ORO:

1) ALTERNATIVAS (OBLIGATORIO - EXTRACCIÓN CERRETERA):
   - La prueba tiene exactamente estos ítems de respuestas cerradas: ${listaIdsAlternativas || "ninguno (solo desarrollo)"}.
   - Debes extraer del texto OCR ÚNICAMENTE lo que el estudiante marcó o escribió para cada ítem. En "respuesta_detectada" escribe SOLO la letra o el número (A, B, C, D, E, V, F, o un dígito). NUNCA pongas la afirmación completa.
   - Devuelve en "respuestas_cerradas" UNA entrada por cada ítem de la lista anterior, con "pregunta" igual al ID exacto (ej: SM1, VF2, TP1). Si en la transcripción no aparece la respuesta de un ítem, pon "SIN_RESPUESTA". NO inventes; solo lo que aparece en el texto.
   - La pauta de alternativas correctas es solo para que sepas las opciones válidas; lo que debes extraer es lo que REALMENTE marcó el estudiante según la transcripción.

2) PUNTUACIÓN DE DESARROLLO (generosidad calibrada):
   - Ítems de desarrollo y sus máximos: ${desarrolloPuntajes || "No especificados"}
   - **CRITERIO DE GENEROSIDAD (AJUSTE SEGURO):** Si el concepto principal es identificable pero la respuesta es incompleta o con errores de redacción, el puntaje mínimo es ${DESARROLLO_MIN_ATTEMPT_SCORE} puntos (si el máximo del ítem > ${DESARROLLO_MIN_ATTEMPT_SCORE}). Si la respuesta es totalmente irrelevante o ilegible, el puntaje debe ser 0.
   - **FORMATO:** "puntaje" = "OBTENIDO/MAX_ITEM" (ej. "2/2", "1/3").
   - Considera flexibilidad ${flexibilidad}/5 (1=estricto, 5=flexible) al asignar puntaje.

3) FORTALEZAS: DEBES reconocer aspectos POSITIVOS concretos del trabajo. Cita entre comillas lo que escribió el estudiante y explica por qué es un logro (concepto bien aplicado, buena argumentación, claridad, etc.). No seas genérico; menciona logros específicos que veas en el texto. Tono de educador que valora el avance.

4) ÁREAS DE MEJORA: Orienta el crecimiento citando lo que escribió e indicando qué puede mejorar y cómo. Tono de apoyo, sin desvalorizar.

5) En respuestas_desarrollo: "texto_estudiante" = CITA LITERAL de la respuesta del estudiante. "justificacion" = por qué tiene ese puntaje según la rúbrica (incluye cita).
   - **MARCADOR DE INCERTIDUMBRE OBLIGATORIO:** Si una palabra es ilegible por caligrafía, NO la inventes ni la completes por contexto; reemplázala por [ilegible]. La transcripción debe ser un espejo de lo escrito.
   - **CONTEXTO COMO APOYO DE DESCIFRADO (NO DE REEMPLAZO):** Usa las palabras legibles alrededor para ayudar a identificar caracteres manuscritos dudosos. Si el trazo sugiere una palabra concreta que encaja en la oración, transcríbela LITERAL (incluyendo errores ortográficos del estudiante). Ejemplo: si parece "extricta", escribe "extricta"; NO la cambies por "estricta" ni por otra palabra más "correcta".
   - Si tras usar contexto local el trazo sigue ambiguo o no coincide en absoluto, usa [ilegible]. Es preferible [ilegible] antes que resumir o suponer texto no escrito.

6) LENGUAJE RESPONSABLE: Nunca escribas frases que afirmen que el estudiante "no respondió", "no contestó" o "no escribió nada". Si en la TRANSCRIPCIÓN OCR no ves respuesta para una pregunta, describe la LIMITACIÓN de la transcripción, por ejemplo: "En la transcripción OCR no se observa una respuesta legible para esta pregunta", sin culpar al estudiante.

---
PAUTA DE PUNTAJES POR ÍTEM:
${pautaEstructurada || "No especificada"}

PAUTA DE ALTERNATIVAS CORRECTAS (para comparar):
${pautaCorrectaAlternativas || "No especificada"}

--- TRANSCRIPCIÓN OCR ---
${textoExtraido}
--- FIN TRANSCRIPCIÓN ---

Tipo de prueba: ${soloDesarrollo ? "SOLO DESARROLLO" : soloAlternativas ? "SOLO ALTERNATIVAS" : "MIXTA"}. Nivel: ${nivelEducativo}. Área: ${areaConocimiento}.

Responde ÚNICAMENTE con este JSON (sin markdown):
{
  "nombreEstudiante": "nombre encontrado en el texto o null",
  "respuestas_cerradas": [${listaIdsAlternativas ? listaIdsAlternativas.split(", ").map(id => `{"pregunta": "${id.trim()}", "respuesta_detectada": "SOLO LETRA O NÚMERO O SIN_RESPUESTA", "confianza": 0.95}`).join(", ") : ""}],
  "respuestas_desarrollo": {
    "P1": {"texto_estudiante": "CITA LITERAL de lo que escribió el estudiante", "puntaje": "2/2", "justificacion": "Explicación que incluye cita y por qué ese puntaje según rúbrica"}
  },
  "retroalimentacion": {
    "fortalezas": "Aspectos POSITIVOS concretos del trabajo, citando al estudiante. Reconocer logros específicos (ej: buena estructura, concepto bien aplicado).",
    "areas_mejora": "Orientaciones de mejora citando lo que escribió, tono de apoyo.",
    "correccion_detallada": [{"seccion": "P1 o nombre ítem", "detalle": "explicación con cita del estudiante"}]
  }
}

Las claves de respuestas_desarrollo pueden ser P1, P2, P3, etc. según los ítems de desarrollo en la pauta. Asigna puntaje de 0 a máximo de cada ítem aplicando generosidad calibrada. Para respuestas_cerradas, usa exactamente los IDs: ${listaIdsAlternativas || "[]"}.`

  const { content, trace } = await requestEvaluationTextCompletion({
    prompt,
    maxTokens: 8192,
    temperature: 0.1,
    timeoutMs: MISTRAL_FETCH_TIMEOUT_MS,
  })
  absorbProviderTrace(providerTraceOut, trace)
  const parsed = JSON.parse(content)
  const rawCerradas = Array.isArray(parsed.respuestas_cerradas) ? parsed.respuestas_cerradas : []
  const byPregunta = new Map<string, { respuesta_detectada: string; confianza: number }>()
  for (const r of rawCerradas) {
    const id = String(r.pregunta || "").trim()
    if (!id) continue
    const detectada = normalizeRespuestaCerrada(String(r.respuesta_detectada ?? ""))
    byPregunta.set(id, { respuesta_detectada: detectada, confianza: Number(r.confianza) || 0.8 })
  }
  const respuestas_cerradas: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
  for (const item of alternativasItems) {
    const existing = byPregunta.get(item.id)
    respuestas_cerradas.push({
      pregunta: item.id,
      respuesta_detectada: existing ? existing.respuesta_detectada : "SIN_RESPUESTA",
      confianza: existing ? existing.confianza : 0,
    })
  }
  return {
    nombreEstudiante: parsed.nombreEstudiante ?? null,
    respuestas_cerradas,
    respuestas_desarrollo: parsed.respuestas_desarrollo && typeof parsed.respuestas_desarrollo === "object" ? parsed.respuestas_desarrollo : {},
    retroalimentacion: {
      fortalezas: parsed.retroalimentacion?.fortalezas ?? "",
      areas_mejora: parsed.retroalimentacion?.areas_mejora ?? "",
      correccion_detallada: Array.isArray(parsed.retroalimentacion?.correccion_detallada) ? parsed.retroalimentacion.correccion_detallada : [],
    },
  }
}

function normalizeOmrTemplateVariantFromBody(v: unknown): OmrTemplateVariantInterleaved {
  if (v === "single_column") return "single_column"
  if (v === "sequential_dual_column") return "sequential_dual_column"
  return "odd_even_dual_column"
}

/** Ruta Mistral legacy: solo distingue impar/par vs secuencial en el prompt (sin modo una columna). */
function legacyMistralDualVariant(
  v: OmrTemplateVariantInterleaved,
): "odd_even_dual_column" | "sequential_dual_column" {
  return v === "sequential_dual_column" ? "sequential_dual_column" : "odd_even_dual_column"
}

function isOmrTemplateVariantInterleaved(v: string | undefined): v is OmrTemplateVariantInterleaved {
  return v === "single_column" || v === "sequential_dual_column" || v === "odd_even_dual_column"
}

/** Extrae SOLO lo que el estudiante marcó. Si hay imagen de plantilla, se envían AMBAS imágenes:
 *  imagen 1 = plantilla del profesor (mismo layout), imagen 2 = hoja del estudiante.
 *  El modelo usa la plantilla solo como referencia de estructura; extrae únicamente de la imagen 2. */
async function extractStudentClosedAnswersOnly(
  studentImageBase64: string,
  totalPreguntas: number,
  alternativas: string[],
  columnas: number = 2,
  templateImageBase64?: string,
  templateVariant: "odd_even_dual_column" | "sequential_dual_column" = "odd_even_dual_column"
): Promise<{ pregunta: string; respuesta_detectada: string; confianza: number }[]> {
  const half = Math.ceil(totalPreguntas / 2)
  const alts = alternativas.length ? alternativas : ["A", "B", "C", "D"]
  const layoutText =
    templateVariant === "sequential_dual_column"
      ? `- COLUMNA IZQUIERDA: Preguntas 1 a ${half}
- COLUMNA DERECHA: Preguntas ${half + 1} a ${totalPreguntas}`
      : `- COLUMNA IZQUIERDA: Preguntas impares (1, 3, 5, ...)
- COLUMNA DERECHA: Preguntas pares (2, 4, 6, ...)`

  const conPlantilla = !!templateImageBase64 && templateImageBase64.length > 50
  const prompt = conPlantilla
    ? `Tienes DOS imágenes de la MISMA plantilla de respuestas (mismo formato, mismas posiciones de preguntas).

IMAGEN 1 = PLANTILLA DEL PROFESOR (respuestas correctas). Solo sirve para ver la ESTRUCTURA y posición de las preguntas.
IMAGEN 2 = HOJA DEL ESTUDIANTE. Aquí debes leer QUÉ LETRA está marcada en cada pregunta.

TU TAREA: Extraer ÚNICAMENTE lo que está marcado en la IMAGEN 2 (hoja del estudiante). NO copies las respuestas de la imagen 1. El estudiante puede marcar distinto al profesor.

Estructura: ${columnas} columnas.
${layoutText}
Opciones: ${alts.join(", ")}.

Para cada pregunta (1 a ${totalPreguntas}) indica SOLO la letra que VES MARCADA EN LA IMAGEN 2. Si en la imagen 2 no hay marca, escribe "SIN_RESPUESTA".

Responde SOLO este JSON:
{"r":[{"p":1,"a":"?"},{"p":2,"a":"?"},...,{"p":${totalPreguntas},"a":"?"}]}
"p" = número de pregunta, "a" = letra marcada EN LA IMAGEN 2 (${alts.join("/")}) o "" si no hay marca.
Exactamente ${totalPreguntas} elementos en "r".`
    : `TAREA: Lee ÚNICAMENTE esta imagen de una HOJA DE RESPUESTAS DE UN ESTUDIANTE.

NO tienes acceso a las respuestas correctas. Indica QUÉ LETRA está marcada (con X o relleno) en cada pregunta.

ESTRUCTURA: ${columnas} columnas.
${layoutText}
Opciones: ${alts.join(", ")}.

Para cada pregunta (1 a ${totalPreguntas}) indica SOLO la letra que VES marcada. Si no hay marca, "SIN_RESPUESTA". NO inventes. El estudiante puede marcar mal; refleja exactamente lo marcado.

Responde SOLO este JSON:
{"r":[{"p":1,"a":"?"},{"p":2,"a":"?"},...,{"p":${totalPreguntas},"a":"?"}]}
"p" = número de pregunta, "a" = letra (${alts.join("/")}) o "" si no hay marca. Exactamente ${totalPreguntas} elementos en "r".`

  const content: any[] = []
  if (conPlantilla) {
    content.push(mistralVisionImagePart(templateImageBase64!))
  }
  content.push(mistralVisionImagePart(studentImageBase64))
  content.push({ type: "text", text: prompt })

  const res = await fetchMistralWithRetry(
    "https://api.mistral.ai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: "pixtral-12b-2409",
        messages: [{ role: "user", content }],
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    },
    { timeoutMs: MISTRAL_FETCH_TIMEOUT_MS_VISION },
  )

  if (!res.ok) throw new Error(`Mistral OMR error: ${res.status}`)
  const data = await res.json()
  const responseText = data.choices?.[0]?.message?.content || ""
  const match = responseText.match(/\{[\s\S]*\}/)
  if (!match) return []

  const parsed = JSON.parse(match[0])
  const rawR = Array.isArray(parsed?.r) ? parsed.r : []
  const respMap = new Map<number, string>()
  for (const r of rawR) {
    const num = Number(r?.p)
    if (num >= 1 && num <= totalPreguntas && !respMap.has(num)) {
      const ans = String(r?.a || "").trim().toUpperCase()
      if (ans === "BLANK" || ans === "SIN_RESPUESTA" || ans === "") {
        respMap.set(num, "SIN_RESPUESTA")
      } else {
        respMap.set(num, alts.includes(ans) ? ans : "SIN_RESPUESTA")
      }
    }
  }

  const out: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
  for (let i = 1; i <= totalPreguntas; i++) {
    const a = respMap.get(i) || "SIN_RESPUESTA"
    const isBlankLike = a === "SIN_RESPUESTA" || a === "BLANK" || a === ""
    out.push({
      pregunta: `SM${i}`,
      respuesta_detectada: a,
      confianza: isBlankLike ? 0.4 : 0.9,
    })
  }
  return out
}

async function extractStudentClosedAnswersAzureLayoutOfficial(params: {
  studentImageBase64: string
  teacherAnswerKey: Array<{ pregunta: string; respuestaCorrecta: string }>
  closedQuestionIds?: string[]
  expectedOptionCount?: number
  /** Si se pasa >0, el pipeline completa huecos con BLANK inferido (completedByExpectation). Omitir para solo lectura sensorial. */
  expectedQuestionCount?: number
  /**
   * Filas del mapa OMR alineadas a la prueba base (source_exam.total_questions o ítems cerrados).
   * Si está definido, la validación de longitud del layout usa este valor (no solo la plantilla del docente).
   */
  authoritativeOmrQuestionCount?: number
  /** Orden pauta (isDevelopment) para orquestador Y; no altera visión de Azure. */
  pautaItemsForOmSegmentation?: Array<{ isDevelopment: boolean }>
  templateKey: string
  templateVariant?: OmrTemplateVariantInterleaved
}): Promise<{
  detectedAnswers: { pregunta: string; respuesta_detectada: string; confianza: number }[]
  officialOmrPerQuestionRaw: any[]
  officialOmrDetectedAnswersPreview: Array<{ pregunta: string; respuesta_detectada: string; confianza: number }>
  officialOmrQuestionCountFromPipeline: number
  officialOmrDetectedAnswersCount: number
  officialOmrDetectedVsPipelineMismatch: boolean
  officialOmrAdapterMode: "direct_passthrough_from_experimental"
}> {
  console.info("[official_azure_layout_family] invoking runAzureLayoutOmrPipeline")
  const raw = params.studentImageBase64.replace(/^data:image\/\w+;base64,/, "").trim()
  const imageBuffer = Buffer.from(raw, "base64")
  const expectation =
    typeof params.expectedQuestionCount === "number" && params.expectedQuestionCount > 0
      ? params.expectedQuestionCount
      : undefined
  const azure = await runAzureLayoutOmrPipeline({
    imageBuffer,
    templateKey: params.templateKey,
    ...(expectation !== undefined ? { expectedQuestionCount: expectation } : {}),
    ...(typeof params.expectedOptionCount === "number" ? { expectedOptionCount: params.expectedOptionCount } : {}),
    canonicalWidth: 1200,
    canonicalHeight: 1700,
    omrTemplateVariant: params.templateVariant ?? "odd_even_dual_column",
    ...(Array.isArray(params.pautaItemsForOmSegmentation) && params.pautaItemsForOmSegmentation.length > 0
      ? { pautaSegmentationItems: params.pautaItemsForOmSegmentation }
      : {}),
  })
  if (!azure || (azure as any).success !== true) {
    if ((azure as any)?.errorCode === "AZURE_LAYOUT_PIPELINE_UNAVAILABLE") {
      throw new Error(
        "[official_azure_layout_family] experimental pipeline unavailable (stub detectado)"
      )
    }
    throw new Error(
      `[official_azure_layout_family] ${String((azure as any)?.errorCode ?? "UNKNOWN")} ${String((azure as any)?.error ?? "falló lectura")}`
    )
  }

  const perQuestion = Array.isArray((azure as any).perQuestion) ? (azure as any).perQuestion : []
  if (perQuestion.length === 0) {
    throw new Error("[official_azure_layout_family] pipeline devolvió 0 preguntas detectadas")
  }
  const fromTeacher =
    Array.isArray(params.closedQuestionIds) && params.closedQuestionIds.length > 0
      ? params.closedQuestionIds.length
      : params.teacherAnswerKey.length
  const layoutRowsExpected =
    typeof params.authoritativeOmrQuestionCount === "number" && params.authoritativeOmrQuestionCount > 0
      ? params.authoritativeOmrQuestionCount
      : fromTeacher
  if (layoutRowsExpected > 0 && perQuestion.length !== layoutRowsExpected) {
    throw new Error(
      `[official_azure_layout_family] Layout Mismatch pipeline=${perQuestion.length} esperado=${layoutRowsExpected}`
    )
  }
  const sorted = [...perQuestion].sort(
    (a, b) => Number(a?.questionNumber ?? 0) - Number(b?.questionNumber ?? 0),
  )

  const out: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
  let rowOrdinal = 0
  for (const row of sorted) {
    const qn = Number(row?.questionNumber ?? 0)
    if (qn < 1) continue
    const canonRaw =
      row && typeof row === "object" && typeof (row as any).canonicalId === "string"
        ? String((row as any).canonicalId).trim()
        : ""
    const fromClosedAtPos = params.closedQuestionIds?.[rowOrdinal]
    const fromTeacherAtPos = params.teacherAnswerKey[rowOrdinal]?.pregunta
    rowOrdinal++
    const keyId =
      normalizeToCanonicalId(canonRaw) ||
      normalizeToCanonicalId(fromClosedAtPos) ||
      normalizeToCanonicalId(fromTeacherAtPos) ||
      normalizeToCanonicalId(`C${qn}`) ||
      `C${qn}`
    // Passthrough directo desde Azure; si reporta MULTIPLE elegimos la alternativa de mayor confianza.
    const ansRaw = String(row?.selectedAnswer ?? "").trim().toUpperCase()
    const confidenceMapRaw =
      row && typeof row === "object" && row.confidencesByColumn && typeof row.confidencesByColumn === "object"
        ? (row.confidencesByColumn as Record<string, unknown>)
        : {}
    const confidenceEntries = Object.entries(confidenceMapRaw)
      .map(([k, v]) => [String(k).toUpperCase(), Number(v)] as const)
      .filter(([k, v]) => /^[A-Z]$/.test(k) && Number.isFinite(v))
      .sort((a, b) => b[1] - a[1])
    const bestByConfidence = confidenceEntries[0]?.[0] ?? ""
    const ans =
      ansRaw === "MULTIPLE"
        ? bestByConfidence || "BLANK"
        : ansRaw === "" || ansRaw === "SIN_RESPUESTA" || ansRaw === "BLANK"
          ? "BLANK"
          : ansRaw
    const isBlankLike = ans === "BLANK" || ans === "SIN_RESPUESTA" || ans === ""
    out.push({
      pregunta: keyId,
      respuesta_detectada: ans,
      confianza: isBlankLike ? 0.4 : 0.92,
    })
  }
  if (out.length === 0) {
    throw new Error("[official_azure_layout_family] adapter devolvió 0 respuestas detectadas")
  }
  console.info("[official_azure_layout_family] pipeline_success", {
    pipelineExpectationPassed: expectation ?? null,
    perQuestionCount: perQuestion.length,
    detectedAnswersCount: out.length,
  })
  return {
    detectedAnswers: out,
    officialOmrPerQuestionRaw: perQuestion,
    officialOmrDetectedAnswersPreview: out.slice(0, 12),
    officialOmrQuestionCountFromPipeline: perQuestion.length,
    officialOmrDetectedAnswersCount: out.length,
    officialOmrDetectedVsPipelineMismatch: out.length !== perQuestion.length,
    officialOmrAdapterMode: "direct_passthrough_from_experimental",
  }
}

// Llamar a Mistral Vision para analizar la prueba.
// CRÍTICO: La pauta de respuestas CORRECTAS (pautaCorrectaAlternativas) NUNCA se envía al modelo
// en esta función. Solo se usa en calculateFinalScore para comparar. Así evitamos que la IA
// devuelva las correctas como si fueran lo que marcó el estudiante.
async function analyzeWithMistralVision(
  imageBase64: string,
  rubrica: string,
  pauta: string,
  pautaEstructurada: string,
  pautaCorrectaAlternativas: string, // Solo para construir itemScores; NO se incluye en el prompt de extracción
  nivelEducativo: string,
  areaConocimiento: string,
  puntajeTotal: number,
  porcentajeExigencia: number,
  tipoPrueba: "mixta" | "solo_desarrollo" | "solo_alternativas" = "mixta",
  providerTraceOut?: ProviderTraceAcc,
): Promise<any> {
  const itemScores = parsePautaEstructurada(pautaEstructurada)
  const soloDesarrollo = tipoPrueba === "solo_desarrollo"
  const soloAlternativas = tipoPrueba === "solo_alternativas"

  // NO usar pautaCorrectaAlternativas en el prompt: la extracción debe ser fiel a lo que ve en la imagen.
  // La corrección se hace después en calculateFinalScore comparando con la plantilla del profesor.

  const prompt = `Eres un evaluador pedagógico experto chileno. Analiza esta imagen de una prueba de un estudiante y genera una evaluación completa. Esta imagen puede ser de CUALQUIER tipo de prueba (mixta, solo desarrollo, solo alternativas); adapta tu respuesta al contenido visible.

CONTEXTO:
- Nivel educativo: ${nivelEducativo}
- Área de conocimiento: ${areaConocimiento}
- Puntaje total máximo: ${puntajeTotal} puntos
- Porcentaje de exigencia para aprobar: ${porcentajeExigencia}%
- Tipo de prueba: ${soloDesarrollo ? "SOLO DESARROLLO (no hay alternativas)" : soloAlternativas ? "SOLO ALTERNATIVAS (no hay desarrollo)" : "MIXTA (alternativas + desarrollo)"}

RÚBRICA DE EVALUACIÓN:
${rubrica}

${pauta && !soloAlternativas ? `PAUTA DE CORRECCIÓN (Desarrollo):\n${pauta}` : ""}

PAUTA DE PUNTAJES POR ÍTEM:
${pautaEstructurada || "No especificada"}

TAREA:
1. Identifica el nombre del estudiante si está visible.
${soloDesarrollo ? "" : `2. EXTRAE ÚNICAMENTE lo que el estudiante marcó en esta hoja. Para cada pregunta de alternativas (SM, V/F, términos pareados): lee la letra o número que está marcado con X o relleno en la imagen. Responde SOLO con lo que VES marcado (A, B, C, D, E, V, F, o número). Si no hay marca clara, escribe "SIN_RESPUESTA". NO inventes ni uses ninguna lista de respuestas correctas: extrae solo lo que muestra la imagen.`}
${soloAlternativas ? "" : `3. PREGUNTAS DE DESARROLLO (OBLIGATORIO):
   - En "texto_estudiante" DEBES copiar LITERALMENTE lo que el estudiante escribió. Si hay texto manuscrito visible, CÍTALO aquí.
   - Si una palabra no se puede leer, escribe [ilegible] exactamente en esa posición. NO inventes ni completes por contexto.
   - Puedes usar el contexto de palabras vecinas solo para descifrar caracteres dudosos; si el trazo apunta a una palabra específica, transcríbela tal cual (con sus errores del estudiante). NO reemplaces por una palabra "mejor".
   - En "justificacion" explica POR QUÉ tiene ese puntaje citando partes concretas de su respuesta.
   - PROHIBIDO escribir "no contestó", "sin respuesta" o "no respondió" si en la imagen hay CUALQUIER texto manuscrito en la pregunta. Solo "Sin respuesta" cuando la zona de respuesta está realmente en blanco.
   - El puntaje debe reflejar lo que se ve; si hay texto, debe haber cita en texto_estudiante.`}
4. RETROALIMENTACIÓN (tono de educador, preciso y técnico):
   - "fortalezas": Escribe como un docente que reconoce el avance del estudiante. Cita entre comillas frases exactas de lo que escribió o marcó y explica por qué son un logro (concepto bien aplicado, buena argumentación, etc.). Sé cálido pero preciso; evita generalidades.
   - "areas_mejora": Escribe como un docente que orienta el crecimiento. Cita entre comillas lo que escribió el estudiante y indica qué puede mejorar y cómo (sin desvalorizar). Sé claro y técnico, con clima de apoyo. No digas que no contestó si en la imagen hay respuesta visible.

FORMATO DE RESPUESTA (JSON estricto):
{
  "nombreEstudiante": "nombre detectado o null",
  "respuestas_cerradas": ${soloDesarrollo ? "[]" : `[
    {"pregunta": "SM1", "respuesta_detectada": "LETRA O NUMERO QUE VES MARCADO EN LA HOJA", "confianza": 0.95}
  ]`},
  "respuestas_desarrollo": ${soloAlternativas ? "{}" : `{
    "P39": {
      "texto_estudiante": "CITA TEXTUAL EXACTA de lo que escribió el estudiante",
      "puntaje": "X/Y",
      "justificacion": "explicación que INCLUYE al menos una cita entre comillas del texto del estudiante y por qué tiene ese puntaje"
    }
  }`},
  "retroalimentacion": {
    "fortalezas": "Como docente: reconoce logros CITANDO entre comillas texto exacto del estudiante y explicando por qué es fortaleza (preciso y con clima educativo).",
    "areas_mejora": "Como docente: orienta mejoras CITANDO entre comillas lo que escribió y qué puede mejorar, con tono de apoyo y precisión técnica.",
    "correccion_detallada": [{"seccion": "Seccion", "detalle": "explicación con al menos UNA cita textual entre comillas del estudiante y por qué tuvo ese puntaje"}]
  }
}

REGLA CRÍTICA PARA ALTERNATIVAS: En "respuesta_detectada" debes poner ÚNICAMENTE la letra o número que el estudiante marcó en esta hoja (lo que se ve en la imagen). No uses ninguna pauta de respuestas correctas para rellenar este campo. Si el estudiante marcó mal, debes poner lo que marcó, no la respuesta correcta.

INSTRUCCIONES PARA PREGUNTAS DE DESARROLLO (si la prueba tiene desarrollo):
1. BUSCA en la imagen el número de la pregunta y el texto manuscrito debajo.
2. En "texto_estudiante" COPIA EXACTAMENTE lo que escribió el estudiante (cita literal). Si hay texto visible, DEBE aparecer aquí; no resumas.
   Si una palabra es ilegible, usa [ilegible] y no la completes por contexto.
   Puedes usar contexto local para descifrar trazos; si identificas una palabra probable por trazo+contexto, escríbela literal como aparece (incluidos errores ortográficos del estudiante), sin corregirla.
3. En "justificacion" explica POR QUÉ tiene ese puntaje e INCLUYE al menos una cita entre comillas de lo que escribió el estudiante.
4. En "correccion_detallada" cada elemento en "detalle" DEBE contener al menos una cita entre comillas del texto del estudiante.
5. PROHIBIDO: No escribas "Sin respuesta", "no contestó", "no respondió" ni "no hay texto escrito por el estudiante" en desarrollo si hay CUALQUIER texto manuscrito en la zona de esa pregunta. Solo usa "Sin respuesta" cuando la zona está realmente en blanco.`

  const { content, trace } = await requestEvaluationVisionCompletion({
    imageBase64,
    prompt,
    maxTokens: 4096,
    temperature: 0.1,
    timeoutMs: MISTRAL_FETCH_TIMEOUT_MS_VISION,
  })
  absorbProviderTrace(providerTraceOut, trace)
  return parseMistralModelJsonContent(content)
}

/** Llamada dedicada SOLO a preguntas de desarrollo: extracción con CITAS textuales obligatorias y retroalimentación profunda. */
async function analyzeDevelopmentOnly(
  imageBase64: string,
  rubrica: string,
  pauta: string,
  pautaEstructurada: string,
  nivelEducativo: string,
  areaConocimiento: string,
  providerTraceOut?: ProviderTraceAcc,
): Promise<{ respuestas_desarrollo: Record<string, any>; retroalimentacion: any }> {
  const prompt = `Eres un evaluador experto con mirada pedagógica. Esta imagen es de una prueba con PREGUNTAS DE DESARROLLO (respuestas abiertas, escritas a mano).

CITAS OBLIGATORIAS EN DESARROLLO (no omitas ninguna):
- En CADA "texto_estudiante" debes poner la CITA LITERAL de lo que el estudiante escribió. Si hay texto visible, copia el texto exacto; no resumas. Si la zona está en blanco, escribe "Sin respuesta".
- Si una palabra es ilegible por caligrafía, reemplázala por [ilegible]. NO inventes ni completes por contexto.
- Puedes usar palabras vecinas como ayuda para descifrar trazos. Si el trazo sugiere una palabra específica, transcríbela exactamente como el estudiante la escribió (aunque tenga faltas). Si sigue ambiguo, deja [ilegible].
- En CADA "justificacion" debes incluir al menos UNA cita entre comillas del texto del estudiante y explicar por qué tiene ese puntaje.
- En "correccion_detallada" CADA ítem en "detalle" debe contener al menos UNA cita entre comillas de lo que escribió el estudiante y por qué tuvo ese puntaje.

FORTALEZAS Y ÁREAS DE MEJORA (tono de educador, preciso y técnico):
- "fortalezas": Escribe como un docente que reconoce el avance. Cita entre comillas frases exactas de lo que escribió el estudiante y explica por qué son un logro (concepto bien aplicado, argumentación, etc.). Tono cálido y preciso.
- "areas_mejora": Escribe como un docente que orienta el crecimiento. Cita entre comillas lo que escribió e indica qué puede mejorar y cómo, con tono de apoyo y precisión técnica. No desvalorices.

PROHIBIDO: No digas "no contestó" ni "no respondió" si hay CUALQUIER texto manuscrito visible en la pregunta. Solo "Sin respuesta" si la zona está realmente en blanco.

RÚBRICA:
${rubrica}

PAUTA DE CORRECCIÓN (Desarrollo):
${pauta || "No especificada"}

PAUTA DE PUNTAJES:
${pautaEstructurada || "No especificada"}

Nivel: ${nivelEducativo}. Área: ${areaConocimiento}.

Responde ÚNICAMENTE con este JSON (cada texto_estudiante y cada detalle con cita literal):
{
  "respuestas_desarrollo": {
    "P1": { "texto_estudiante": "cita literal exacta de lo que escribió el estudiante", "puntaje": "X/Y", "justificacion": "explicación que incluye al menos una cita entre comillas del estudiante" }
  },
  "retroalimentacion": {
    "fortalezas": "Como docente: reconoce logros citando entre comillas texto del estudiante; tono educativo y preciso.",
    "areas_mejora": "Como docente: orienta mejoras citando entre comillas lo que escribió; tono de apoyo y técnico.",
    "correccion_detallada": [{"seccion": "Nombre pregunta", "detalle": "explicación con al menos una cita entre comillas del estudiante y por qué tuvo ese puntaje"}]
  }
}
Las claves de respuestas_desarrollo pueden ser P1, P2, P39, P40, etc. según los números de pregunta que veas. texto_estudiante DEBE ser el texto real escrito por el estudiante, no un resumen.`

  const { content, trace } = await requestEvaluationVisionCompletion({
    imageBase64,
    prompt,
    maxTokens: 8192,
    temperature: 0.1,
    timeoutMs: MISTRAL_FETCH_TIMEOUT_MS_VISION,
  })
  absorbProviderTrace(providerTraceOut, trace)
  if (!content) return { respuestas_desarrollo: {}, retroalimentacion: {} }
  const parsed = parseMistralModelJsonContent(content) as {
    respuestas_desarrollo?: Record<string, unknown>
    retroalimentacion?: Record<string, unknown>
  }
  return {
    respuestas_desarrollo: parsed.respuestas_desarrollo || {},
    retroalimentacion: parsed.retroalimentacion || {},
  }
}

// Calcular puntaje final combinando alternativas y desarrollo
function calculateFinalScore(
  respuestasCerradas: any[],
  respuestasDesarrollo: any,
  pautaEstructurada: string,
  pautaCorrectaAlternativas: string,
  puntajeTotal: number,
  porcentajeExigencia: number
) {
  const itemScores = parsePautaEstructurada(pautaEstructurada)

  const { map: pautaMap, warnings: pautaCanonWarnings } = dedupePautaAlternativasToCanonicalMap(
    String(pautaCorrectaAlternativas ?? ""),
  )
  for (const w of pautaCanonWarnings) {
    console.warn(`[evaluate][calculateFinalScore] ${w}`)
  }

  let scoreAlternativas = 0
  let scoreDesarrollo = 0
  const alternativasCorregidas: AlternativeResult[] = []

  // Corregir respuestas cerradas (solo claves C{n})
  for (const resp of respuestasCerradas || []) {
    const canon = normalizeToCanonicalId(resp.pregunta)
    if (!canon) continue
    const preguntaId = canon
    const respuestaDetectada = String(resp.respuesta_detectada || "").toUpperCase()

    const respuestaCorrecta = pautaMap.get(canon) || ""

    const legacyRead = (resp as { _omr_legacy_read?: boolean })._omr_legacy_read === true
    const confOmr = Number((resp as { confianza?: number }).confianza) || 0
    alternativasCorregidas.push({
      pregunta: preguntaId,
      respuesta_estudiante: respuestaDetectada,
      respuesta_correcta: respuestaCorrecta,
      ...(legacyRead && confOmr < 0.7 ? { requires_review: true as const } : {}),
    })

    if (respuestaCorrecta && respuestaDetectada === respuestaCorrecta) {
      const itemMatch = itemScores.find((i) => normalizeToCanonicalId(i.id) === canon)
      scoreAlternativas += itemMatch?.maxScore || 1
    }
  }

  // Sumar puntajes de desarrollo
  for (const itemId in respuestasDesarrollo || {}) {
    const item = respuestasDesarrollo[itemId]
    if (!item || typeof item !== "object") continue
    let puntajeObtenido = 0
    let puntajeMaximoItem = 1
    if (typeof item.puntaje === "string" && item.puntaje.includes("/")) {
      const parts = item.puntaje.split("/")
      puntajeObtenido = parseInt(parts[0], 10) || 0
      puntajeMaximoItem = parseInt(parts[1], 10) || 1
    } else if (typeof item.puntaje === "number") {
      puntajeObtenido = item.puntaje
      puntajeMaximoItem = item.puntaje
    } else if (item.puntaje && typeof item.puntaje === "object") {
      const p = item.puntaje as Record<string, unknown>
      if (typeof p.total === "number") {
        puntajeObtenido = p.total
        puntajeMaximoItem = p.total
      }
    } else if (typeof (item as any).total === "number") {
      puntajeObtenido = (item as any).total
      puntajeMaximoItem = (item as any).total
    }
    scoreDesarrollo += puntajeObtenido
  }

  const totalScore = scoreAlternativas + scoreDesarrollo
  const nota = calculateGrade(totalScore, puntajeTotal, porcentajeExigencia)
  
  const exigenciaDecimal = Math.min(100, porcentajeExigencia) / 100
  const puntosAprobacion = Math.ceil(puntajeTotal * exigenciaDecimal)

  return {
    puntaje: `${totalScore}/${puntajeTotal}`,
    nota,
    puntosAprobacion,
    puntosMaximos: puntajeTotal,
    alternativas_corregidas: alternativasCorregidas,
    scoreAlternativas,
    scoreDesarrollo,
  }
}

/** Normaliza respuestas_desarrollo para que cada ítem tenga puntaje como string "X/Y" (evita [object Object] y permite calcular nota). */
function normalizeRespuestasDesarrollo(
  respuestasDesarrollo: Record<string, any> | null | undefined
): Record<string, { texto_estudiante?: string; cita_estudiante?: string; puntaje: string; justificacion?: string }> {
  const out: Record<string, { texto_estudiante?: string; cita_estudiante?: string; puntaje: string; justificacion?: string }> = {}
  if (!respuestasDesarrollo || typeof respuestasDesarrollo !== "object") return out
  for (const [key, item] of Object.entries(respuestasDesarrollo)) {
    if (item == null || typeof item !== "object") continue
    let puntajeStr = "0/1"
    if (typeof item.puntaje === "string" && item.puntaje.includes("/")) {
      puntajeStr = item.puntaje
    } else if (typeof item.puntaje === "number") {
      puntajeStr = `${item.puntaje}/${item.puntaje}`
    } else if (item.puntaje && typeof item.puntaje === "object" && typeof (item.puntaje as any).total === "number") {
      const t = (item.puntaje as any).total
      puntajeStr = `${t}/${t}`
    } else if (typeof (item as any).total === "number") {
      const t = (item as any).total
      puntajeStr = `${t}/${t}`
    }
    const texto = item.texto_estudiante ?? item.cita_estudiante ?? ""
    const justif = typeof item.justificacion === "string" ? item.justificacion : (item.justificacion ? JSON.stringify(item.justificacion) : "")
    out[key] = {
      texto_estudiante: texto,
      cita_estudiante: texto,
      puntaje: puntajeStr,
      justificacion: justif,
    }
  }
  return out
}

/** Suaviza mensajes que culpan al estudiante cuando puede ser un problema de lectura/OCR. */
function sanitizeStudentBlameText(text: string | null | undefined): string {
  if (!text || typeof text !== "string") return text || ""
  let out = text
  const patterns = [
    /no hay texto escrito por el estudiante/gi,
    /no hay texto del estudiante/gi,
    /no respondi[oó]/gi,
    /no contest[oó]/gi,
    /no respondi[oó] la pregunta/gi,
    /no contest[oó] la pregunta/gi,
  ]
  for (const p of patterns) {
    out = out.replace(
      p,
      "en la transcripción disponible no se observa una respuesta legible para esta pregunta"
    )
  }
  return out
}

function sanitizeRetroalimentacion(retro: any): any {
  if (!retro || typeof retro !== "object") return retro
  const cleaned: any = { ...retro }
  if (typeof cleaned.fortalezas === "string") {
    cleaned.fortalezas = sanitizeStudentBlameText(cleaned.fortalezas)
  }
  if (typeof cleaned.areas_mejora === "string") {
    cleaned.areas_mejora = sanitizeStudentBlameText(cleaned.areas_mejora)
  }
  if (Array.isArray(cleaned.correccion_detallada)) {
    cleaned.correccion_detallada = cleaned.correccion_detallada.map((c: any) => {
      if (!c || typeof c !== "object") return c
      return {
        ...c,
        detalle: sanitizeStudentBlameText(c.detalle),
      }
    })
  }
  return cleaned
}

function normalizeDetectedStudentName(raw: unknown): string {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return DEFAULT_STUDENT_NAME
    for (const v of raw) {
      const s = String(v ?? "").trim()
      if (s) return s
    }
    return DEFAULT_STUDENT_NAME
  }
  const s = String(raw ?? "").trim()
  return s ? s : DEFAULT_STUDENT_NAME
}

/**
 * Serialización HTTP final de éxito para POST /api/evaluate: un solo documento JSON UTF-8
 * (equivalente a `res.status(200).json(...)` en Express). Sin parse del payload de negocio
 * ni armado manual de JSON; solo `JSON.stringify` estándar + cabecera charset explícita.
 */
function finalizeEvaluateSuccessResponseHttp200(resultadoFinal: Record<string, unknown>): NextResponse {
  const replacer = (_key: string, value: unknown) => (typeof value === "bigint" ? String(value) : value)
  try {
    const body = JSON.stringify(resultadoFinal, replacer)
    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  } catch (err) {
    console.error("[evaluate] finalizeEvaluateSuccessResponseHttp200: JSON.stringify falló", err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { success: false, error: `No se pudo serializar la respuesta de evaluación: ${msg}` },
      { status: 500 },
    )
  }
}

/**
 * Ejecuta la misma lógica que POST /api/evaluate sin HTTP interno (batch en servidor).
 * Usa cookies/Auth del request actual de Next (misma invocación que el POST del batch).
 */
export async function executeEvaluatePostBody(body: unknown): Promise<NextResponse> {
  /** Si el fallo ocurre antes de completar una fase con estado OMR real, el catch no debe inventar flags. */
  let omrDebugSnapshotForCatch: Record<string, unknown> | null = null
  const providerTraceAcc: ProviderTraceAcc = { current: { ...DEFAULT_EVALUATION_PROVIDER_TRACE } }
  try {
    const evaluationWarnings: string[] = []
    let evaluationDegraded = false

    if (!evaluationAiKeysConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: "IA evaluadora temporalmente no disponible.",
          provider_trace: providerTraceAcc.current,
        },
        { status: 503 },
      )
    }

    if (body == null || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Cuerpo de evaluación inválido" }, { status: 400 })
    }

    const bodyObj = body as Record<string, unknown>
    console.log("[evaluate] cuerpo evaluación", {
      fileUrlsLen: Array.isArray(bodyObj.fileUrls) ? bodyObj.fileUrls.length : 0,
    })
    const {
      fileUrls = [],
      fileMimeTypes = [],
      rubrica = "",
      pauta = "",
      puntajeTotal = 100,
      porcentajeExigencia = 55,
      pautaEstructurada = "",
      pautaCorrectaAlternativas = "",
      nivelEducativo = "Educación Media",
      areaConocimiento = "general",
      respuestasAlternativas,
      answerKeyFromTemplate: answerKeyFromBody,
      templateImageUrl,
      templateId,
      tipoPrueba = "mixta", // "mixta" | "solo_desarrollo" | "solo_alternativas"
      flexibilidad = 3,
      nombreEstudiante: nombreEstudianteBody,
      // Persistencia Supabase (opcional; no afecta la respuesta)
      teacher_id: teacherIdBody,
      school_id: schoolIdBody,
      course_id: courseIdBody,
      evaluation_title: evaluationTitleBody,
      evaluation_subject: evaluationSubjectBody,
      evaluation_batch_id: evaluationBatchIdBody,
      officialOmrIntegrationEnabled: officialOmrIntegrationEnabledIn,
      officialOmrEngineSelected: officialOmrEngineSelectedIn,
      omrTemplateVariant: omrTemplateVariantIn,
      officialOmrAllowFallbackToLegacy: officialOmrAllowFallbackToLegacyIn,
      source_exam_id: sourceExamIdBody,
      source_exam_context_active: sourceExamContextActiveBody,
      omrClosedLayoutMode: omrClosedLayoutModeBody,
      /** Respuestas de desarrollo consolidadas (tabla editable / sync); opcional. */
      detalle_desarrollo_finales: detalleDesarrolloFinalesBody,
    } = bodyObj as Record<string, any>
    const isForcedInterleaved =
      String(omrClosedLayoutModeBody ?? "").trim() === "interleaved_development"
    const officialOmrIntegrationEnabled = true
    const officialOmrEngineSelected: "legacy" | "azure_layout_family" = "azure_layout_family"
    const omrTemplateVariantRequested = normalizeOmrTemplateVariantFromBody(omrTemplateVariantIn)
    const omrTemplateVariantLegacyDual = legacyMistralDualVariant(omrTemplateVariantRequested)
    let officialOmrEngineUsed: "legacy" | "azure_layout_family" | "azure_layout_omr_interleaved" = "legacy"
    let officialOmrFallbackUsed = false
    let officialOmrFallbackReason: string | null = null
    const officialOmrAllowFallbackToLegacy = officialOmrAllowFallbackToLegacyIn !== false
    let officialOmrPerQuestionRaw: any[] = []
    let officialOmrDetectedAnswersPreview: Array<{ pregunta: string; respuesta_detectada: string; confianza: number }> = []
    let officialOmrQuestionCountFromPipeline = 0
    let officialOmrDetectedAnswersCount = 0
    let officialOmrDetectedVsPipelineMismatch = false
    let officialOmrAdapterMode: "direct_passthrough_from_experimental" | "legacy_extract_student_only" =
      "legacy_extract_student_only"
    let officialOmrExpectedQuestionCountUsed = 0
    let officialOmrTeacherAnswerKeyLength = 0
    let officialOmrTotalPregResolved = 0
    let officialOmrTemplateKeyUsed = "template_38_4"
    /** Variante física efectiva del último pipeline OMR exitoso (intercalado: auto-resuelta; resto: solicitada). */
    let officialOmrTemplateVariantUsed: OmrTemplateVariantInterleaved = omrTemplateVariantRequested
    let officialOmrTemplateVariantAutoDiagnostics: unknown = null
    let officialOmrSourceExamIdUsed: string | null = null
    let officialOmrMetadataSource: string | null = null
    let officialOmrItemsClosedCountFromDb = 0
    /** Filas del mapa OMR (rejilla) antes de alinear al inventario de pauta. */
    let officialOmrGridQuestionCountAtEngine = 0
    const teacherAnswersSource = "teacher_key"
    let studentAnswersSource: "student_omr_read" | typeof RESPUESTAS_FINALES_ESTUDIANTE = "student_omr_read"
    console.info("[trace][omr_official][request_flags]", {
      officialOmrIntegrationEnabledIn,
      officialOmrEngineSelectedIn,
      officialOmrAllowFallbackToLegacyIn,
      omrTemplateVariantIn,
      omrClosedLayoutModeBody: typeof omrClosedLayoutModeBody === "string" ? omrClosedLayoutModeBody : null,
    })

    // Regla de oro: teacher_id/school_id SOLO desde perfil en BD. Ignorar body.
    let effectiveTeacherId: string | null = null
    let effectiveSchoolId: string | null = null
    let authUserId: string | null = null
    console.log("[evaluate] ANTES getAuthUser (Supabase auth cookies / read-only)")
    const user = await getAuthUser()
    console.log("[evaluate] DESPUÉS getAuthUser", { hasUser: !!user })
    if (user) {
      authUserId = user.id
      const supabase = getSupabaseServer()
      if (supabase) {
        console.log("[evaluate] ANTES Supabase profiles SELECT")
        const { data: profile } = await supabase
          .from("profiles")
          .select("teacher_id, school_id")
          .eq("user_id", user.id)
          .maybeSingle()
        console.log("[evaluate] DESPUÉS Supabase profiles SELECT", { hasTeacherId: !!profile?.teacher_id })
        if (profile?.teacher_id) {
          effectiveTeacherId = profile.teacher_id
          effectiveSchoolId = profile.school_id ?? null
          if (process.env.NODE_ENV !== "production") console.info("[evaluate] teacher_id desde perfil:", profile.teacher_id)
        }
      }
    }

    const supabaseForEval = getSupabaseServer()
    const sourceExamIdTrimmed =
      typeof sourceExamIdBody === "string" && sourceExamIdBody.trim() !== "" ? sourceExamIdBody.trim() : null
    const hasSourceExamContextActive = sourceExamContextActiveBody === true
    if (hasSourceExamContextActive && !sourceExamIdTrimmed) {
      console.warn("[evaluate] Evaluación sin source_exam_id en contexto de prueba base", {
        teacher_id: effectiveTeacherId,
        school_id: effectiveSchoolId,
      })
    }

    // Memoria interna: si se envía templateId, cargar plantilla desde caché (Redis o memoria)
    let answerKeyFromTemplate = answerKeyFromBody
    let cachedTemplateBase64: string | undefined
    if (templateId && typeof templateId === "string") {
      try {
        const cached = await getTemplate(templateId)
        const cachedImg = await getTemplateImage(templateId)
        if (cached) {
          answerKeyFromTemplate = {
            respuestas: cached.respuestas,
            totalPreguntas: cached.totalPreguntas,
          }
          if (cachedImg) cachedTemplateBase64 = cachedImg.base64
        }
      } catch (_) {
        // Si falla la caché, seguir con answerKeyFromBody y templateImageUrl
      }
    }

    if (!fileUrls.length) {
      return NextResponse.json(
        { success: false, error: "No se proporcionaron imágenes para evaluar" },
        { status: 400 }
      )
    }

    const validFileUrls = fileUrls.filter((u: string) => u && String(u).length > 0)
    const fileMimeTypesArray = Array.isArray(fileMimeTypes) ? fileMimeTypes : []

    // Rama PDF/Word: Azure Document Intelligence extrae texto y Mistral evalúa por texto (sin convertir PDF a imágenes).
    const useAzurePath = hasPdfOrWord(fileMimeTypesArray)
    const azureEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
    const azureKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY

    let combinedAnalysis: any = {
      respuestas_cerradas: [],
      respuestas_desarrollo: {},
      retroalimentacion: { fortalezas: "", areas_mejora: "", correccion_detallada: [] },
      nombreEstudiante: null,
    }

    // Variables comunes para ambos caminos (imágenes o PDF/Word)
    let pautaAlternativasFinal = pautaCorrectaAlternativas
    if (answerKeyFromTemplate?.respuestas && answerKeyFromTemplate.respuestas.length > 0) {
      pautaAlternativasFinal = answerKeyFromTemplate.respuestas
        .map((r: any) => `${r.pregunta}:${(r.respuestaCorrecta || "").toString().trim().toUpperCase()}`)
        .filter((s: string) => s.length > 0)
        .join("; ")
    }
    const tipoPruebaReal = tipoPrueba === "solo_desarrollo" || tipoPrueba === "solo_alternativas" ? tipoPrueba : "mixta"
    const tieneAlternativas = tipoPruebaReal !== "solo_desarrollo"
    if (
      typeof sourceExamIdBody === "string" &&
      sourceExamIdBody.trim() &&
      supabaseForEval &&
      effectiveTeacherId
    ) {
      const authoritative = await loadAuthoritativeTeacherKeyFromSourceExam(
        supabaseForEval,
        sourceExamIdBody.trim(),
        effectiveTeacherId,
        tipoPruebaReal,
      )
      if (authoritative) {
        const currentLen =
          Array.isArray(answerKeyFromTemplate?.respuestas) ? answerKeyFromTemplate.respuestas.length : 0
        const authoritativeLen =
          Array.isArray(authoritative.answerKeyFromTemplate?.respuestas)
            ? authoritative.answerKeyFromTemplate.respuestas.length
            : 0
        if (authoritativeLen > currentLen) {
          answerKeyFromTemplate = authoritative.answerKeyFromTemplate
          if (authoritative.pautaAlternativasCanonical.trim()) {
            pautaAlternativasFinal = authoritative.pautaAlternativasCanonical
          }
          if (process.env.NODE_ENV !== "production") {
            console.info("[evaluate] source_exam key override", {
              sourceExamId: sourceExamIdBody.trim(),
              previousKeyLength: currentLen,
              authoritativeKeyLength: authoritativeLen,
              closedItemsCount: authoritative.closedItemsCount,
            })
          }
        }
      }
    }
    let respuestasCerradasDesdeOMR: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
    /** Solo se rellena en rama imágenes (OMR); en PDF queda vacío. */
    const omrLegacyByPreguntaUpper = new Map<string, boolean>()

    const evaluationBaseFormBuilt = buildEvaluationBase({
      form: {
        pautaEstructurada: String(pautaEstructurada ?? ""),
        pautaCorrectaAlternativas: pautaAlternativasFinal,
        rubrica: String(rubrica ?? ""),
        tipoPrueba: tipoPruebaReal,
        title: typeof evaluationTitleBody === "string" ? evaluationTitleBody.trim() || null : null,
      },
    })
    const officialClosedItemsEvaluationBase = evaluationBaseFormBuilt.items
      .filter((it) => isEvaluationBaseItemClosedForOmr(it))
      .sort((a, b) => a.order - b.order)
    /** Filas de pauta no marcadas como desarrollo por id heurístico; la entrada a OMR exige cierre estructural. */
    const pautaRowsNotDevelopment = parsePautaEstructurada(pautaEstructurada).filter((i) => !i.isDevelopment)
    const ebByPreguntaUpper = new Map(
      evaluationBaseFormBuilt.items.map((it) => [it.id.trim().toUpperCase(), it]),
    )
    let officialClosedItems: { id: string; order: number }[] = []
    if (pautaRowsNotDevelopment.length > 0) {
      let ord = 0
      for (const row of pautaRowsNotDevelopment) {
        const id = row.id.trim()
        const eb = ebByPreguntaUpper.get(id.toUpperCase())
        if (eb && !isEvaluationBaseItemClosedForOmr(eb)) continue
        const corr = getFormItemCorrectAnswer(pautaAlternativasFinal, id)
        if (
          !isFormStructuredRowClosedForOmr({
            maxScore: row.maxScore,
            correctAnswer: corr ?? null,
            tipoPrueba: tipoPruebaReal,
          })
        ) {
          continue
        }
        ord++
        officialClosedItems.push({
          id: eb?.id ?? id,
          order: eb?.order ?? ord,
        })
      }
    } else {
      officialClosedItems = officialClosedItemsEvaluationBase.map((it) => ({ id: it.id, order: it.order }))
    }

    if (useAzurePath) {
      if (!azureEndpoint || !azureKey) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Para evaluar PDF o Word debe configurar Azure Document Intelligence (AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT y AZURE_DOCUMENT_INTELLIGENCE_KEY en .env.local).",
          },
          { status: 400 }
        )
      }
      try {
        const fileBuffers = await getFileBuffersFromUrls(validFileUrls, fileMimeTypesArray)
        const docIntelClient = new DocumentAnalysisClient(azureEndpoint, new AzureKeyCredential(azureKey))
        const textoExtraido = await extractTextFromFiles(fileBuffers, docIntelClient)
        if (!textoExtraido || textoExtraido === "NO SE PUDO EXTRAER TEXTO.") {
          return NextResponse.json(
            {
              success: false,
              error: "No se pudo extraer texto del PDF o documento. Verifique que el archivo no esté protegido o dañado.",
            },
            { status: 400 }
          )
        }
        combinedAnalysis = await analyzeWithMistralText(
          textoExtraido,
          rubrica,
          pauta,
          pautaEstructurada,
          pautaAlternativasFinal,
          nivelEducativo,
          areaConocimiento,
          Number(puntajeTotal),
          Number(porcentajeExigencia),
          tipoPruebaReal,
          Number(flexibilidad) || 3,
          typeof nombreEstudianteBody === "string" ? nombreEstudianteBody.trim() || undefined : undefined,
          providerTraceAcc,
        )
        omrDebugSnapshotForCatch = {
          evaluationInputKind: "azure_document_text",
          officialOmrNotApplicable: true,
          teacherAnswersSource,
          studentAnswersSource,
          teacherClosedAnswersCount:
            typeof answerKeyFromTemplate?.respuestas?.length === "number"
              ? answerKeyFromTemplate.respuestas.length
              : 0,
          studentClosedAnswersCount: 0,
        }
      } catch (e: unknown) {
        console.error("[evaluate] Rama Azure (PDF/Word):", e)
        if (e instanceof EvaluationIaUnavailableError) {
          providerTraceAcc.current = mergeEvaluationProviderTrace(providerTraceAcc.current, e.provider_trace)
          return NextResponse.json(
            { success: false, error: e.message, provider_trace: providerTraceAcc.current },
            { status: 503 },
          )
        }
        let errMsg = e instanceof Error ? e.message : "Error al evaluar el documento (Azure/Mistral)."
        if (/503|502|429|upstream connect error|overflow/.test(errMsg)) {
          errMsg = "El servicio de IA no está disponible en este momento. Espera unos minutos e intenta de nuevo."
        }
        return NextResponse.json(
          { success: false, error: errMsg, provider_trace: providerTraceAcc.current },
          { status: 500 },
        )
      }
    } else {
    // Rama imágenes: convertir a listado (solo imágenes; sin PDF/Word) y evaluar con Mistral Vision
    let imageBase64List: string[]
    try {
      imageBase64List = await resolveToImageBase64List(validFileUrls, fileMimeTypesArray)
    } catch (e: any) {
      const msg = e?.message || "Error al procesar archivos"
      const isClientError = typeof msg === "string" && (msg.includes("Word") || msg.includes("PDF") || msg.includes("Exporta"))
      return NextResponse.json(
        { success: false, error: msg },
        { status: isClientError ? 400 : 500 }
      )
    }
    if (!imageBase64List.length) {
      return NextResponse.json(
        { success: false, error: "No se obtuvieron imágenes de los archivos subidos" },
        { status: 400 }
      )
    }

    // Extraer respuestas cerradas desde la imagen del estudiante (OMR dedicado), independiente de si hay pauta.
    if (imageBase64List.length > 0) {
      const teacherAnswerKeyBase = Array.isArray(answerKeyFromTemplate?.respuestas)
        ? answerKeyFromTemplate.respuestas
        : []
      const closedQuestionsFromPauta = parsePautaEstructurada(pautaEstructurada).filter(
        (i) => !i.isDevelopment
      ).length
      const closedFromEvaluationBase = officialClosedItems.length
      const totalPreg =
        teacherAnswerKeyBase.length ||
        closedFromEvaluationBase ||
        closedQuestionsFromPauta ||
        Number(answerKeyFromTemplate?.totalPreguntas) ||
        1

      let sourceExamOmrAuthoritative = 0
      if (
        tieneAlternativas &&
        typeof sourceExamIdBody === "string" &&
        sourceExamIdBody.trim() &&
        supabaseForEval &&
        effectiveTeacherId
      ) {
        const meta = await resolveSourceExamOmrMetadata(supabaseForEval, {
          sourceExamId: sourceExamIdBody.trim(),
          teacherId: effectiveTeacherId,
        })
        if (meta) {
          sourceExamOmrAuthoritative = meta.totalQuestionsAuthoritative
          officialOmrSourceExamIdUsed = meta.sourceExamId
          officialOmrMetadataSource = meta.source
          officialOmrItemsClosedCountFromDb = meta.itemsClosedCount
        }
      }

      /** Con pauta estructurada no se inventan huecos C1..Cn: el conteo OMR es solo ítems cerrados reales (Regla de Oro). */
      const inventoryFromStructuredPauta =
        pautaRowsNotDevelopment.length > 0 && officialClosedItems.length > 0

      let omrExpectedQuestionCount = Math.max(
        1,
        sourceExamOmrAuthoritative > 0 ? sourceExamOmrAuthoritative : totalPreg,
      )
      if (inventoryFromStructuredPauta) {
        omrExpectedQuestionCount = Math.max(1, officialClosedItems.length)
      }
      const templateKeyUsed = omrTemplateKeyForClosedQuestionCount(omrExpectedQuestionCount)
      // Sin pauta estructurada de cerradas: completar inventario hasta el tamaño esperado (comportamiento histórico).
      if (!inventoryFromStructuredPauta) {
        officialClosedItems = ensureOfficialClosedInventorySize(officialClosedItems, omrExpectedQuestionCount)
      }

      officialOmrGridQuestionCountAtEngine = omrExpectedQuestionCount
      officialOmrTotalPregResolved = omrExpectedQuestionCount
      officialOmrTeacherAnswerKeyLength = teacherAnswerKeyBase.length
      officialOmrTemplateKeyUsed = templateKeyUsed
      const altsSet = new Set<string>()
      for (const r of teacherAnswerKeyBase) {
        const v = (r.respuestaCorrecta || "").toString().trim().toUpperCase()
        if (v) altsSet.add(v)
      }
      const alternativasArray = altsSet.size > 0 ? Array.from(altsSet) : ["A", "B", "C", "D"]
      const columnas = 2
      const officialClosedSorted = [...officialClosedItems].sort((a, b) => a.order - b.order)
      const officialClosedOrderIds = officialClosedSorted
        .map((it) => String(it.id ?? "").trim())
        .filter((id) => id.length > 0)
      const pautaRowsForInterleavedOm = parsePautaEstructurada(pautaEstructurada)
      const parsedStructuredRubricExists = pautaRowsForInterleavedOm.length > 0
      let hybridStructuredQuestionOrder: string[] = []
      if (parsedStructuredRubricExists) {
        hybridStructuredQuestionOrder = buildHybridStructuredQuestionOrder(String(pautaEstructurada ?? ""))
        if (!Array.isArray(hybridStructuredQuestionOrder) || hybridStructuredQuestionOrder.length === 0) {
          throw new Error(
            "[INTERLEAVED_INVALID_STRUCTURED_ORDER] " +
              "No se pudo construir hybridStructuredQuestionOrder desde pautaEstructurada.",
          )
        }
      }
      const useInterleavedAzureOmr = resolveUseInterleavedAzureOmr({
        explicitLayoutMode: typeof omrClosedLayoutModeBody === "string" ? omrClosedLayoutModeBody : "",
        tipoPrueba: tipoPruebaReal,
        pautaRows: pautaRowsForInterleavedOm,
        officialClosedCount: officialClosedOrderIds.length,
      })
      // Diagnóstico de despliegue: mismas lecturas que runInterleavedAzureLayoutOmrPipeline (no toca lógica OMR).
      console.log("[C30_AUDIT_FLAG]", process.env.INTERLEAVED_C30_C31_AUDIT ?? null)
      console.log("[C30_RECOVERY_FLAG]", process.env.INTERLEAVED_FINAL_BLANK_RECOVERY_FROM_PHYSICAL_EVIDENCE ?? null)
      console.log("[OMR_INTERLEAVED_ROUTING]", {
        useInterleavedAzureOmr,
        explicitLayoutMode: typeof omrClosedLayoutModeBody === "string" ? omrClosedLayoutModeBody : null,
        evaluateInterleavedOmrEnv: process.env.EVALUATE_INTERLEAVED_OMR ?? null,
        tipoPrueba: tipoPruebaReal,
        pautaRowsForInterleavedCount: pautaRowsForInterleavedOm.length,
        officialClosedCount: officialClosedOrderIds.length,
        hasInterleavedHeuristicBlocks: pautaHasInterleavedDevelopmentBlocks(pautaRowsForInterleavedOm),
      })
      const extractClosedOrdinal = (id: string): number | null => {
        const m = String(id).toUpperCase().match(/(\d+)/)
        if (!m) return null
        const n = Number(m[1])
        return Number.isFinite(n) && n > 0 ? n : null
      }
      const hasClosedInventoryMismatch =
        officialClosedOrderIds.length > 0 &&
        officialClosedOrderIds.length !== omrExpectedQuestionCount
      const officialClosedQuestionNumbers = officialClosedSorted.map((it, idx) => {
        const fromId = extractClosedOrdinal(String(it.id ?? ""))
        if (fromId != null) return fromId
        const teacherQ = Number(teacherAnswerKeyBase[idx]?.pregunta)
        return Number.isFinite(teacherQ) && teacherQ > 0 ? teacherQ : idx + 1
      })
      const teacherQuestionNumbers = teacherAnswerKeyBase
        .map((r: any) => Number(r?.pregunta))
        .filter((n: number) => Number.isFinite(n) && n > 0)
      const hasClosedNumberSequenceMismatch =
        teacherQuestionNumbers.length > 0 &&
        officialClosedQuestionNumbers.length === teacherQuestionNumbers.length &&
        officialClosedQuestionNumbers.some((n, idx) => n !== teacherQuestionNumbers[idx])
      /** OMR legacy devuelve la i-ésima burbuja cerrada en orden físico; se alinea por índice al i-ésimo ítem cerrado oficial, no por el dígito en `pregunta`. */
      const remapLegacyRawToOfficialOrder = (
        legacyRaw: { pregunta: string; respuesta_detectada: string; confianza: number }[]
      ): { pregunta: string; respuesta_detectada: string; confianza: number }[] =>
        officialClosedOrderIds.map((officialId, idx) => {
          const displayId = normalizeToCanonicalId(officialId) ?? String(officialId ?? "").trim()
          const pregunta = displayId || `C${idx + 1}`
          const rawRow = legacyRaw[idx]
          return {
            pregunta,
            respuesta_detectada: String(rawRow?.respuesta_detectada ?? "BLANK"),
            confianza: Number(rawRow?.confianza) || 0.4,
          }
        })
      const isBlankLikeDetectedAnswer = (value: string): boolean => {
        const norm = String(value ?? "").trim().toUpperCase()
        return norm === "" || norm === "BLANK" || norm === "SIN_RESPUESTA"
      }
      const shouldReplaceDetectedAnswer = (
        current: { respuesta_detectada: string; confianza: number },
        incoming: { respuesta_detectada: string; confianza: number },
      ): boolean => {
        const currentBlank = isBlankLikeDetectedAnswer(current.respuesta_detectada)
        const incomingBlank = isBlankLikeDetectedAnswer(incoming.respuesta_detectada)
        // Regla de oro: BLANK/SIN_RESPUESTA nunca pisa una alternativa válida.
        if (!currentBlank && incomingBlank) return false
        if (currentBlank && !incomingBlank) return true
        const currentConfidence = Number(current.confianza) || 0
        const incomingConfidence = Number(incoming.confianza) || 0
        return incomingConfidence > currentConfidence
      }
      const detectedByPregunta = new Map<
        string,
        { pregunta: string; respuesta_detectada: string; confianza: number }
      >()
      let azureSuccessfulPages = 0
      let azureFailedPages = 0
      let omrSuccessfulAzureWasInterleaved = false

      const ingestExtradas = (
        rows: { pregunta: string; respuesta_detectada: string; confianza: number }[],
        fromLegacyPipeline: boolean
      ) => {
        for (const item of rows) {
          const canon = normalizeToCanonicalId(item.pregunta)
          const pid = canon ?? cerradaMapKeyFromPregunta(item.pregunta)
          const incoming = {
            pregunta: canon ?? item.pregunta,
            respuesta_detectada: String(item.respuesta_detectada ?? ""),
            confianza: Number(item.confianza) || 0.4,
          }
          const current = detectedByPregunta.get(pid)
          if (!current || shouldReplaceDetectedAnswer(current, incoming)) {
            detectedByPregunta.set(pid, incoming)
            omrLegacyByPreguntaUpper.set(pid, fromLegacyPipeline)
          }
        }
      }

      for (let i = 0; i < imageBase64List.length; i++) {
        try {
          const studentBase64 = imageBase64List[i]
          let templateBase64: string | undefined = cachedTemplateBase64
          if (!templateBase64 && templateImageUrl && typeof templateImageUrl === "string") {
            try {
              templateBase64 = await urlToBase64(templateImageUrl)
              if (templateBase64 && isPdfBase64(templateBase64)) templateBase64 = undefined
            } catch (_) {}
          }
          let extraidas: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
          const tryOfficialAzure =
            officialOmrIntegrationEnabled === true && officialOmrEngineSelected === "azure_layout_family"
          /** Solo inventario bloquea Azure; desajuste de secuencia pauta/base es soft (se intenta Azure y legacy solo si falla). */
          const forceLegacyStableRouteForStructure = hasClosedInventoryMismatch
          if (hasClosedNumberSequenceMismatch && !hasClosedInventoryMismatch) {
            console.info("[trace][omr_official][soft_sequence_mismatch]", {
              note: "sequence_mismatch_no_hard_legacy; azure_if_enabled_else_legacy",
            })
          }
          console.info("[trace][omr_official][engine_selector]", {
            tryOfficialAzure,
            forceLegacyStableRouteForStructure,
            hasClosedInventoryMismatch,
            hasClosedNumberSequenceMismatch,
            legacyForcedBeforeAzure: hasClosedInventoryMismatch,
            sequenceMismatchSoftOnly: hasClosedNumberSequenceMismatch && !hasClosedInventoryMismatch,
            officialOmrIntegrationEnabled,
            officialOmrEngineSelected,
            officialOmrAllowFallbackToLegacy,
            hasTemplateAnswerKey: Boolean(answerKeyFromTemplate?.respuestas?.length),
            totalPreg,
            omrExpectedQuestionCount,
            sourceExamOmrAuthoritative,
            useInterleavedAzureOmr,
            omrClosedLayoutModeBody: typeof omrClosedLayoutModeBody === "string" ? omrClosedLayoutModeBody : null,
            hybridStructuredQuestionOrderLen: hybridStructuredQuestionOrder.length,
          })
          if (forceLegacyStableRouteForStructure) {
            officialOmrFallbackUsed = true
            officialOmrFallbackReason =
              "FORCED_LEGACY_STRUCTURAL_MISMATCH_STABLE_ROUTE"
            const legacyRaw = await extractStudentClosedAnswersOnly(
              studentBase64,
              omrExpectedQuestionCount,
              alternativasArray,
              columnas,
              templateBase64,
              omrTemplateVariantLegacyDual
            )
            extraidas = remapLegacyRawToOfficialOrder(legacyRaw)
            console.info("[trace][omr_official][extraidas_forced_legacy_structural_gaps]", {
              extraidasFirst10: extraidas.slice(0, 10),
              extraidasCount: extraidas.length,
            })
            officialOmrAdapterMode = "legacy_extract_student_only"
            officialOmrEngineUsed = "legacy"
            ingestExtradas(extraidas, true)
          } else if (tryOfficialAzure) {
            const teacherAnswerKey = teacherAnswerKeyBase.map((r: any) => ({
              pregunta: String(r?.pregunta ?? ""),
              respuestaCorrecta: String(r?.respuestaCorrecta ?? ""),
            }))
            const expectedOptionCount = Math.max(
              2,
              new Set(
                teacherAnswerKey
                  .map((r: any) => String(r?.respuestaCorrecta ?? "").trim().toUpperCase())
                  .filter((v: any) => /^[A-Z]$/.test(v))
              ).size || 4
            )
            const expectedQuestionCountUsed = Math.max(1, omrExpectedQuestionCount)
            officialOmrExpectedQuestionCountUsed = expectedQuestionCountUsed
            officialOmrTemplateKeyUsed = templateKeyUsed
            const authoritativeForAzure =
              inventoryFromStructuredPauta || sourceExamOmrAuthoritative <= 0
                ? undefined
                : sourceExamOmrAuthoritative
            const azureParams = {
              teacherAnswerKey,
              closedQuestionIds: officialClosedOrderIds,
              expectedOptionCount,
              expectedQuestionCount: expectedQuestionCountUsed,
              authoritativeOmrQuestionCount: authoritativeForAzure,
              pautaItemsForOmSegmentation: parsePautaEstructurada(pautaEstructurada).map((it) => ({
                isDevelopment: it.isDevelopment,
              })),
              templateKey: templateKeyUsed,
              templateVariant: omrTemplateVariantRequested,
            }
            let azureOfficial:
              | Awaited<ReturnType<typeof extractStudentClosedAnswersAzureLayoutOfficial>>
              | Awaited<ReturnType<typeof extractStudentClosedAnswersInterleavedLayout>>
              | null = null
            let lastAzureErr: unknown = null
            let azureRecoveredAfterImageEnhance = false
            for (let attempt = 0; attempt < 2 && !azureOfficial; attempt++) {
              const imgForAttempt =
                attempt === 0
                  ? studentBase64
                  : await enhanceOmrStudentImageBase64(studentBase64).catch((preErr) => {
                      console.warn(
                        "[Evaluate] pre-mejoras imagen OMR omitidas (reintento Azure cancelado)",
                        preErr
                      )
                      return null
                    })
              if (attempt === 1 && !imgForAttempt) break
              try {
                if (useInterleavedAzureOmr) {
                  if (
                    !Array.isArray(hybridStructuredQuestionOrder) ||
                    hybridStructuredQuestionOrder.length === 0
                  ) {
                    throw new Error(
                      "[INTERLEAVED_INVALID_STRUCTURED_ORDER] hybridStructuredQuestionOrder vacío.",
                    )
                  }
                  console.info("[official_azure_layout_interleaved] invoking extractStudentClosedAnswersInterleavedLayout")
                  azureOfficial = await extractStudentClosedAnswersInterleavedLayout({
                    studentImageBase64: imgForAttempt ?? studentBase64,
                    teacherAnswerKey,
                    closedQuestionIds: officialClosedOrderIds,
                    expectedOptionCount,
                    expectedQuestionCount: Math.max(1, officialClosedOrderIds.length),
                    authoritativeOmrQuestionCount: authoritativeForAzure,
                    templateKey: templateKeyUsed,
                    templateVariant: omrTemplateVariantRequested,
                    suppressHybridSoftMismatchRecovery: isForcedInterleaved,
                    hybridStructuredQuestionOrder,
                  })
                } else {
                  azureOfficial = await extractStudentClosedAnswersAzureLayoutOfficial({
                    ...azureParams,
                    studentImageBase64: imgForAttempt ?? studentBase64,
                  })
                }
                if (attempt === 1) azureRecoveredAfterImageEnhance = true
              } catch (e) {
                lastAzureErr = e
                if (attempt === 1) {
                  console.warn("[Evaluate] Azure OMR falló también tras 1 reintento con imagen mejorada", e)
                }
              }
            }
            if (azureOfficial) {
              if (azureRecoveredAfterImageEnhance) {
                console.info("[Evaluate] Azure OMR: éxito en reintento tras pre-mejoras de imagen")
              }
              console.info("[official_azure_layout_family] adapter_result", {
                detectedAnswersCount: azureOfficial.detectedAnswers.length,
                questionCountFromPipeline: azureOfficial.officialOmrQuestionCountFromPipeline,
              })
              extraidas = azureOfficial.detectedAnswers
              console.info("[CRITICAL] USING EXPERIMENTAL OMR", extraidas.slice(0, 5))
              console.info("[trace][omr_official][extraidas_after_azure]", {
                extraidasFirst10: extraidas.slice(0, 10),
                extraidasCount: extraidas.length,
                officialOmrPerQuestionRawCount: Array.isArray(azureOfficial.officialOmrPerQuestionRaw)
                  ? azureOfficial.officialOmrPerQuestionRaw.length
                  : 0,
                interleavedBranch: useInterleavedAzureOmr,
              })
              officialOmrPerQuestionRaw = azureOfficial.officialOmrPerQuestionRaw
              officialOmrDetectedAnswersPreview = azureOfficial.officialOmrDetectedAnswersPreview
              officialOmrQuestionCountFromPipeline = azureOfficial.officialOmrQuestionCountFromPipeline
              officialOmrDetectedAnswersCount = azureOfficial.officialOmrDetectedAnswersCount
              officialOmrDetectedVsPipelineMismatch = azureOfficial.officialOmrDetectedVsPipelineMismatch
              officialOmrAdapterMode = azureOfficial.officialOmrAdapterMode
              if (useInterleavedAzureOmr) {
                const resolvedEffective = (azureOfficial as { omrTemplateVariantEffective?: string })
                  .omrTemplateVariantEffective
                officialOmrTemplateVariantUsed = isOmrTemplateVariantInterleaved(resolvedEffective)
                  ? resolvedEffective
                  : omrTemplateVariantRequested
                const variantAutoDiag = (azureOfficial as { omrTemplateVariantAutoDiagnostics?: unknown })
                  .omrTemplateVariantAutoDiagnostics
                if (variantAutoDiag != null) {
                  officialOmrTemplateVariantAutoDiagnostics = variantAutoDiag
                }
                omrSuccessfulAzureWasInterleaved = true
                officialOmrEngineUsed = "azure_layout_omr_interleaved"
              } else {
                officialOmrTemplateVariantUsed = omrTemplateVariantRequested
                officialOmrEngineUsed = "azure_layout_family"
              }
              azureSuccessfulPages++
              ingestExtradas(extraidas, false)
            } else {
              if (isForcedInterleaved && useInterleavedAzureOmr) {
                throw new Error(
                  `[INTERLEAVED_FORCED_MODE_FAILED] ${
                    lastAzureErr instanceof Error ? lastAzureErr.message : String(lastAzureErr ?? "unknown")
                  }`,
                )
              }
              if (!officialOmrAllowFallbackToLegacy) {
                throw lastAzureErr instanceof Error ? lastAzureErr : new Error(String(lastAzureErr))
              }
              azureFailedPages++
              console.warn(
                "[Evaluate] official azure_layout_family falló (incl. reintento con imagen mejorada), fallback legacy:",
                lastAzureErr
              )
              const legacyRaw = await extractStudentClosedAnswersOnly(
                studentBase64,
                omrExpectedQuestionCount,
                alternativasArray,
                columnas,
                templateBase64,
                omrTemplateVariantLegacyDual
              )
              extraidas = remapLegacyRawToOfficialOrder(legacyRaw)
              console.info("[trace][omr_official][extraidas_after_fallback_legacy]", {
                extraidasFirst10: extraidas.slice(0, 10),
                extraidasCount: extraidas.length,
                officialOmrFallbackUsed: true,
                officialOmrFallbackReason:
                  lastAzureErr instanceof Error ? lastAzureErr.message : String(lastAzureErr),
              })
              officialOmrAdapterMode = "legacy_extract_student_only"
              ingestExtradas(extraidas, true)
            }
          } else {
            const legacyRaw = await extractStudentClosedAnswersOnly(
              studentBase64,
              omrExpectedQuestionCount,
              alternativasArray,
              columnas,
              templateBase64,
              omrTemplateVariantLegacyDual
            )
            extraidas = remapLegacyRawToOfficialOrder(legacyRaw)
            console.info("[trace][omr_official][extraidas_after_legacy_direct]", {
              extraidasFirst10: extraidas.slice(0, 10),
              extraidasCount: extraidas.length,
            })
            officialOmrAdapterMode = "legacy_extract_student_only"
            ingestExtradas(extraidas, true)
          }
        } catch (e) {
          if (isForcedInterleaved) {
            const teacherKeyForOm = teacherAnswerKeyBase.map((r: any) => ({
              pregunta: String(r?.pregunta ?? ""),
              respuestaCorrecta: String(r?.respuestaCorrecta ?? ""),
            }))
            const recoveredFromRaw = rebuildStudentClosedAnswersFromOfficialOmrPerQuestionRaw(
              officialOmrPerQuestionRaw,
              officialClosedOrderIds,
              teacherKeyForOm,
              { recovery: true },
            )
            if (recoveredFromRaw.length > 0) {
              console.warn(
                "[EVALUATE_RECOVERY] OMR página con error; se aplican respuestas reconstruidas desde officialOmrPerQuestionRaw",
                { page: i + 1, err: e instanceof Error ? e.message : String(e) },
              )
              ingestExtradas(
                recoveredFromRaw.map(({ source: _s, recovery: _r, ...rest }) => rest),
                false,
              )
              continue
            }
            return NextResponse.json(
              {
                success: false,
                error: e instanceof Error ? e.message : String(e),
                officialOmrIntegrationEnabled,
                officialOmrEngineSelected,
                officialOmrAllowFallbackToLegacy,
                officialOmrEngineUsed,
                officialOmrFallbackUsed,
                officialOmrFallbackReason:
                  (e instanceof Error ? e.message : String(e)) || officialOmrFallbackReason,
                ...officialOmrPerQuestionRawWireFields(officialOmrPerQuestionRaw),
                officialOmrDetectedAnswersPreview,
                officialOmrQuestionCountFromPipeline,
                officialOmrDetectedAnswersCount,
                officialOmrDetectedVsPipelineMismatch,
                officialOmrAdapterMode,
                teacherAnswersSource,
                studentAnswersSource,
                teacherClosedAnswersCount:
                  typeof answerKeyFromTemplate?.respuestas?.length === "number"
                    ? answerKeyFromTemplate.respuestas.length
                    : 0,
                studentClosedAnswersCount: Math.max(
                  respuestasCerradasDesdeOMR.length,
                  detectedByPregunta.size,
                ),
                omrClosedLayoutMode: String(omrClosedLayoutModeBody ?? "").trim() || null,
                omrTemplateVariantRequested,
                omrTemplateVariantEffective: officialOmrTemplateVariantUsed,
                omrTemplateVariantAutoDiagnostics: officialOmrTemplateVariantAutoDiagnostics,
              },
              { status: 500 },
            )
          }
          if (
            officialOmrIntegrationEnabled === true &&
            officialOmrEngineSelected === "azure_layout_family" &&
            officialOmrAllowFallbackToLegacy === false
          ) {
            return NextResponse.json(
              {
                success: false,
                error: e instanceof Error ? e.message : String(e),
                officialOmrIntegrationEnabled,
                officialOmrEngineSelected,
                officialOmrAllowFallbackToLegacy,
                officialOmrEngineUsed,
                officialOmrFallbackUsed,
                officialOmrFallbackReason:
                  (e instanceof Error ? e.message : String(e)) || officialOmrFallbackReason,
                ...officialOmrPerQuestionRawWireFields(officialOmrPerQuestionRaw),
                officialOmrDetectedAnswersPreview,
                officialOmrQuestionCountFromPipeline,
                officialOmrDetectedAnswersCount,
                officialOmrDetectedVsPipelineMismatch,
                officialOmrAdapterMode,
                teacherAnswersSource,
                studentAnswersSource,
                teacherClosedAnswersCount:
                  typeof answerKeyFromTemplate?.respuestas?.length === "number"
                    ? answerKeyFromTemplate.respuestas.length
                    : 0,
                studentClosedAnswersCount: Math.max(
                  respuestasCerradasDesdeOMR.length,
                  detectedByPregunta.size,
                ),
                omrTemplateVariantRequested,
                omrTemplateVariantEffective: officialOmrTemplateVariantUsed,
                omrTemplateVariantAutoDiagnostics: officialOmrTemplateVariantAutoDiagnostics,
              },
              { status: 500 }
            )
          }
          console.warn("[Evaluate] OMR dedicado falló para imagen", i, e)
        }
      }
      respuestasCerradasDesdeOMR = sortDetectedCerradasByOfficialClosedOrder(
        Array.from(detectedByPregunta.values()),
        officialClosedOrderIds,
      )
      if (
        (!respuestasCerradasDesdeOMR || respuestasCerradasDesdeOMR.length === 0) &&
        Array.isArray(officialOmrPerQuestionRaw) &&
        officialOmrPerQuestionRaw.length > 0
      ) {
        console.warn(
          "[EVALUATE_RECOVERY] Rebuilding studentClosedAnswers from officialOmrPerQuestionRaw",
        )
        const teacherKeyForOm = teacherAnswerKeyBase.map((r: any) => ({
          pregunta: String(r?.pregunta ?? ""),
          respuestaCorrecta: String(r?.respuestaCorrecta ?? ""),
        }))
        respuestasCerradasDesdeOMR = sortDetectedCerradasByOfficialClosedOrder(
          rebuildStudentClosedAnswersFromOfficialOmrPerQuestionRaw(
            officialOmrPerQuestionRaw,
            officialClosedOrderIds,
            teacherKeyForOm,
            { recovery: true },
          ),
          officialClosedOrderIds,
        )
      }
      if (
        Array.isArray(officialOmrPerQuestionRaw) &&
        officialOmrPerQuestionRaw.length > 0 &&
        (!respuestasCerradasDesdeOMR || respuestasCerradasDesdeOMR.length === 0)
      ) {
        throw new Error(
          "No se pudieron reconstruir respuestas cerradas desde officialOmrPerQuestionRaw.",
        )
      }
      if (azureSuccessfulPages > 0) {
        officialOmrEngineUsed = omrSuccessfulAzureWasInterleaved
          ? "azure_layout_omr_interleaved"
          : "azure_layout_family"
        officialOmrFallbackUsed = false
        officialOmrFallbackReason = null
        if (officialOmrAdapterMode !== "direct_passthrough_from_experimental") {
          officialOmrAdapterMode = "direct_passthrough_from_experimental"
        }
      } else if (azureFailedPages > 0) {
        officialOmrEngineUsed = "legacy"
        officialOmrFallbackUsed = true
        if (!officialOmrFallbackReason) {
          officialOmrFallbackReason = "[official_azure_layout_family] fallback total por fallas en todas las páginas"
        }
      }
      omrDebugSnapshotForCatch = {
        officialOmrIntegrationEnabled,
        officialOmrEngineSelected,
        officialOmrAllowFallbackToLegacy,
        officialOmrEngineUsed,
        officialOmrFallbackUsed,
        officialOmrFallbackReason,
        ...officialOmrPerQuestionRawWireFields(officialOmrPerQuestionRaw),
        officialOmrDetectedAnswersPreview,
        officialOmrQuestionCountFromPipeline,
        officialOmrDetectedAnswersCount,
        officialOmrDetectedVsPipelineMismatch,
        officialOmrAdapterMode,
        teacherAnswersSource,
        studentAnswersSource,
        teacherClosedAnswersCount:
          typeof answerKeyFromTemplate?.respuestas?.length === "number"
            ? answerKeyFromTemplate.respuestas.length
            : 0,
        studentClosedAnswersCount: respuestasCerradasDesdeOMR.length,
        omrTemplateVariantRequested,
        omrTemplateVariantEffective: officialOmrTemplateVariantUsed,
        omrTemplateVariantAutoDiagnostics: officialOmrTemplateVariantAutoDiagnostics,
      }
      console.info("[evaluate] OMR phase completed", {
        pages: imageBase64List.length,
        studentClosedAnswersCount: respuestasCerradasDesdeOMR.length,
        officialOmrEngineUsed,
        officialOmrFallbackUsed,
      })
    }

    // Procesar cada imagen (Mistral Vision + desarrollo dedicado), salvo solo_alternativas: solo OMR + pauta.
    combinedAnalysis = {
      respuestas_cerradas: [],
      respuestas_desarrollo: {},
      retroalimentacion: {
        fortalezas: "",
        areas_mejora: "",
        correccion_detallada: [],
      },
      nombreEstudiante: null,
    }

    if (tipoPruebaReal === "solo_alternativas") {
      combinedAnalysis.retroalimentacion = retroalimentacionEjecutivaSoloAlternativas()
      if (process.env.NODE_ENV !== "production") {
        console.info("[evaluate] solo_alternativas: omitiendo analyzeWithMistralVision y analyzeDevelopmentOnly (informe ejecutivo)")
      }
    } else {
      for (let i = 0; i < imageBase64List.length; i++) {
        const imageBase64 = imageBase64List[i]

        let analysis: Awaited<ReturnType<typeof analyzeWithMistralVision>>
        try {
          analysis = await analyzeWithMistralVision(
            imageBase64,
            rubrica,
            pauta,
            pautaEstructurada,
            pautaAlternativasFinal,
            nivelEducativo,
            areaConocimiento,
            Number(puntajeTotal),
            Number(porcentajeExigencia),
            tipoPrueba === "solo_desarrollo" || tipoPrueba === "solo_alternativas" ? tipoPrueba : "mixta",
            providerTraceAcc,
          )
        } catch (e) {
          if (e instanceof EvaluationIaUnavailableError) throw e
          if (!isMistralTimeoutError(e) && !isMistralJsonDegradedError(e)) throw e
          evaluationDegraded = true
          evaluationWarnings.push(
            isMistralTimeoutError(e)
              ? `mistral_vision_timeout_page_${i + 1}`
              : `mistral_vision_json_parse_page_${i + 1}`,
          )
          console.warn("[evaluate] Mistral Vision degraded, continuing", {
            page: i + 1,
            reason: isMistralTimeoutError(e) ? "timeout" : "json_parse",
          })
          analysis = emptyMistralVisionAnalysis()
        }

        // Combinar resultados
        if (analysis.nombreEstudiante && !combinedAnalysis.nombreEstudiante) {
          combinedAnalysis.nombreEstudiante = analysis.nombreEstudiante
        }

        if (analysis.respuestas_cerradas && respuestasCerradasDesdeOMR.length === 0) {
          // Evitar duplicados al combinar respuestas de multiples paginas
          for (const resp of analysis.respuestas_cerradas) {
            const key = cerradaMapKeyFromPregunta(resp.pregunta)
            const exists = combinedAnalysis.respuestas_cerradas.some(
              (r: any) => cerradaMapKeyFromPregunta(r.pregunta) === key,
            )
            if (!exists) {
              combinedAnalysis.respuestas_cerradas.push(resp)
            }
          }
        }

        if (analysis.retroalimentacion) {
          if (i === 0) {
            combinedAnalysis.retroalimentacion = analysis.retroalimentacion
          } else {
            // Combinar retroalimentación de múltiples páginas
            combinedAnalysis.retroalimentacion.correccion_detallada.push(
              ...(analysis.retroalimentacion.correccion_detallada || [])
            )
          }
        }

        // FASE 3.5: desarrollo — una sola clave canónica P{n} por ítem; fusión Vision + dedicada con criterio estable.
        const tieneDesarrollo = tipoPrueba !== "solo_alternativas"
        const ejecutarDesarrolloDedicado =
          tieneDesarrollo && (tipoPrueba === "solo_desarrollo" || !!pauta || !!pautaEstructurada)

        let pageMergedDev: Record<string, unknown>
        if (ejecutarDesarrolloDedicado) {
          try {
            const devResult = await analyzeDevelopmentOnly(
              imageBase64,
              rubrica,
              pauta,
              pautaEstructurada,
              nivelEducativo,
              areaConocimiento,
              providerTraceAcc,
            )
            pageMergedDev = mergeVisionAndDedicatedDesarrollo(
              (analysis.respuestas_desarrollo || {}) as Record<string, unknown>,
              (devResult.respuestas_desarrollo || {}) as Record<string, unknown>
            )
            if (devResult.retroalimentacion && (devResult.retroalimentacion.fortalezas || devResult.retroalimentacion.areas_mejora || (Array.isArray(devResult.retroalimentacion.correccion_detallada) && devResult.retroalimentacion.correccion_detallada.length > 0))) {
              if (i === 0) {
                combinedAnalysis.retroalimentacion = {
                  ...combinedAnalysis.retroalimentacion,
                  ...devResult.retroalimentacion,
                }
              } else {
                combinedAnalysis.retroalimentacion.fortalezas = combinedAnalysis.retroalimentacion.fortalezas || devResult.retroalimentacion.fortalezas
                combinedAnalysis.retroalimentacion.areas_mejora = combinedAnalysis.retroalimentacion.areas_mejora || devResult.retroalimentacion.areas_mejora
                combinedAnalysis.retroalimentacion.correccion_detallada.push(
                  ...(devResult.retroalimentacion.correccion_detallada || [])
                )
              }
            }
          } catch (e) {
            if (e instanceof EvaluationIaUnavailableError) throw e
            if (isMistralTimeoutError(e) || isMistralJsonDegradedError(e)) {
              evaluationDegraded = true
              evaluationWarnings.push(
                isMistralTimeoutError(e)
                  ? `mistral_development_timeout_page_${i + 1}`
                  : `mistral_development_json_parse_page_${i + 1}`,
              )
              console.warn("[evaluate] development analysis degraded", {
                page: i + 1,
                reason: isMistralTimeoutError(e) ? "timeout" : "json_parse",
              })
            } else {
              console.warn("[Evaluate] Análisis desarrollo dedicado falló", e)
            }
            pageMergedDev = collapseDevelopmentKeysToCanonical(
              (analysis.respuestas_desarrollo || {}) as Record<string, unknown>
            )
          }
        } else {
          pageMergedDev = collapseDevelopmentKeysToCanonical(
            (analysis.respuestas_desarrollo || {}) as Record<string, unknown>
          )
        }

        combinedAnalysis.respuestas_desarrollo = accumulateDesarrolloAcrossPages(
          combinedAnalysis.respuestas_desarrollo as Record<string, unknown>,
          pageMergedDev
        ) as typeof combinedAnalysis.respuestas_desarrollo
      }
    }

    }  // fin else (rama imágenes: Mistral Vision)

    if (
      (!respuestasCerradasDesdeOMR || respuestasCerradasDesdeOMR.length === 0) &&
      Array.isArray(officialOmrPerQuestionRaw) &&
      officialOmrPerQuestionRaw.length > 0
    ) {
      console.warn(
        "[EVALUATE_RECOVERY] (post-vision) Rebuilding studentClosedAnswers from officialOmrPerQuestionRaw",
      )
      const closedIdsForRecovery = [...officialClosedItems]
        .sort((a, b) => a.order - b.order)
        .map((it) => String(it.id ?? "").trim())
        .filter((id) => id.length > 0)
      const teacherKeyForRecovery = Array.isArray(answerKeyFromTemplate?.respuestas)
        ? answerKeyFromTemplate.respuestas.map((r: any) => ({
            pregunta: String(r?.pregunta ?? ""),
            respuestaCorrecta: String(r?.respuestaCorrecta ?? ""),
          }))
        : []
      respuestasCerradasDesdeOMR = sortDetectedCerradasByOfficialClosedOrder(
        rebuildStudentClosedAnswersFromOfficialOmrPerQuestionRaw(
          officialOmrPerQuestionRaw,
          closedIdsForRecovery,
          teacherKeyForRecovery,
          { recovery: true },
        ),
        closedIdsForRecovery,
      )
    }

    // Conservar siempre las respuestas cerradas detectadas por OMR del estudiante, aun sin pauta cargada.
    if (respuestasCerradasDesdeOMR.length > 0) {
      combinedAnalysis.respuestas_cerradas = respuestasCerradasDesdeOMR.map((r: any) => ({
        pregunta: r.pregunta,
        respuesta_detectada: r.respuesta_detectada || "",
        confianza: r.confianza ?? 0.9,
      }))
    }

    if (!(tieneAlternativas && answerKeyFromTemplate?.respuestas?.length) || combinedAnalysis.respuestas_cerradas.length === 0) {
      if (respuestasAlternativas && respuestasAlternativas.length > 0 && !answerKeyFromTemplate?.respuestas?.length) {
        const respMap = new Map<string, any>()
        for (let idx = 0; idx < respuestasAlternativas.length; idx++) {
          const r = respuestasAlternativas[idx]
          const preguntaSrc = String(r.pregunta ?? "").trim()
          const preguntaId = preguntaSrc || `Q${idx + 1}`
          const mapKey = normalizeToCanonicalId(preguntaId) ?? preguntaId.toUpperCase()
          const respuestaEstudiante = (r.respuesta_estudiante ?? r.respuesta ?? "").toString().trim()
          if (!respMap.has(mapKey)) {
            respMap.set(mapKey, {
              pregunta: normalizeToCanonicalId(preguntaId) ?? preguntaId,
              respuesta_detectada: respuestaEstudiante,
              confianza: r.confianza ?? 1.0,
            })
          }
        }
        combinedAnalysis.respuestas_cerradas = Array.from(respMap.values())
      }
    } else {
      const respMap = new Map<string, any>()
      for (let idx = 0; idx < combinedAnalysis.respuestas_cerradas.length; idx++) {
        const r = combinedAnalysis.respuestas_cerradas[idx]
        const preguntaSrc = String(r.pregunta ?? "").trim()
        const preguntaId = preguntaSrc || `Q${idx + 1}`
        const mapKey = normalizeToCanonicalId(preguntaId) ?? preguntaId.toUpperCase()
        if (!respMap.has(mapKey)) {
          respMap.set(mapKey, {
            pregunta: normalizeToCanonicalId(preguntaId) ?? preguntaId,
            respuesta_detectada: r.respuesta_detectada || "",
            confianza: r.confianza || 1.0,
          })
        }
      }
      combinedAnalysis.respuestas_cerradas = Array.from(respMap.values())
    }

    const cerradasParaAlinear: CerradaNormRow[] = (combinedAnalysis.respuestas_cerradas || []).map((r: any) => ({
      pregunta: String(r.pregunta ?? ""),
      respuesta_detectada: String(r.respuesta_detectada ?? r.respuesta ?? ""),
      confianza: Number(r.confianza) || 0.8,
    }))
    const cerradasAlineadas = alignCerradasToOfficialInventory(cerradasParaAlinear, officialClosedItems)
    const byId = new Map<string, CerradaNormRow>()
    for (const r of cerradasAlineadas) {
      const canon = normalizeToCanonicalId(r.pregunta)
      const k = canon ?? String(r.pregunta ?? "").trim().toUpperCase()
      if (!k || byId.has(k)) continue
      byId.set(k, { ...r, pregunta: canon ?? k })
    }
    const officialClosedSortedForBlank = [...officialClosedItems].sort((a, b) => a.order - b.order)
    const uniqueClosedInventory = new Set(
      officialClosedSortedForBlank
        .map((it) => normalizeToCanonicalId(it.id))
        .filter((x): x is string => x != null),
    )
    for (const it of officialClosedSortedForBlank) {
      const canon = normalizeToCanonicalId(it.id)
      if (!canon) continue
      if (!byId.has(canon)) {
        byId.set(canon, { pregunta: canon, respuesta_detectada: "BLANK", confianza: 0 })
      }
    }
    if (
      uniqueClosedInventory.size > 0 &&
      officialOmrQuestionCountFromPipeline > 0 &&
      uniqueClosedInventory.size !== officialOmrQuestionCountFromPipeline
    ) {
      evaluationWarnings.push(
        `[canonical_count_mismatch] closedItemsCount (${uniqueClosedInventory.size}) !== officialOmrQuestionCountFromPipeline (${officialOmrQuestionCountFromPipeline})`,
      )
    }
    const teacherKeyUniqueCanonical = new Set(
      (answerKeyFromTemplate?.respuestas ?? [])
        .map((r: { pregunta?: unknown }) => normalizeToCanonicalId(String(r?.pregunta ?? "")))
        .filter((x: string | null): x is string => x != null),
    )
    if (
      uniqueClosedInventory.size > 0 &&
      teacherKeyUniqueCanonical.size > 0 &&
      teacherKeyUniqueCanonical.size !== uniqueClosedInventory.size
    ) {
      evaluationWarnings.push(
        `[canonical_count_mismatch] teacherAnswerKey unique canonical (${teacherKeyUniqueCanonical.size}) !== closedItemsCount (${uniqueClosedInventory.size})`,
      )
    }
    combinedAnalysis.respuestas_cerradas = Array.from(byId.values()).sort((a, b) => {
      const ca = normalizeToCanonicalId(String(a.pregunta ?? ""))
      const cb = normalizeToCanonicalId(String(b.pregunta ?? ""))
      const na = ca ? parseInt(ca.slice(1), 10) : Number.MAX_SAFE_INTEGER
      const nb = cb ? parseInt(cb.slice(1), 10) : Number.MAX_SAFE_INTEGER
      if (na !== nb) return na - nb
      return String(a.pregunta ?? "").localeCompare(String(b.pregunta ?? ""))
    })
    combinedAnalysis.respuestas_cerradas = combinedAnalysis.respuestas_cerradas.map((r: any) => ({
      ...r,
      _omr_legacy_read: resolveOmrLegacyForRow(r, omrLegacyByPreguntaUpper),
    }))
    const consolidatedClosed = applyConsolidatedStudentClosedAnswers(
      combinedAnalysis.respuestas_cerradas as CerradaRowForFinalEvaluation[],
      respuestasAlternativas,
    )
    combinedAnalysis.respuestas_cerradas = consolidatedClosed.cerradas as typeof combinedAnalysis.respuestas_cerradas
    officialOmrExpectedQuestionCountUsed = combinedAnalysis.respuestas_cerradas.length
    console.info("[trace][omr_official][combined_before_scoring]", {
      combinedRespuestasCerradasCount: Array.isArray(combinedAnalysis.respuestas_cerradas)
        ? combinedAnalysis.respuestas_cerradas.length
        : 0,
      combinedRespuestasCerradasFirst10: Array.isArray(combinedAnalysis.respuestas_cerradas)
        ? combinedAnalysis.respuestas_cerradas.slice(0, 10)
        : [],
      officialOmrEngineUsed,
      officialOmrFallbackUsed,
      officialOmrFallbackReason,
    })

    // FASE 3.5: claves canónicas P{n} + orden estable (PDF/Word e imagen convergen aquí antes de normalizar).
    combinedAnalysis.respuestas_desarrollo = orderCanonicalDesarrolloRecord(
      collapseDevelopmentKeysToCanonical((combinedAnalysis.respuestas_desarrollo || {}) as Record<string, unknown>)
    ) as typeof combinedAnalysis.respuestas_desarrollo

    let desarrolloFinalesApplied = false
    if (
      detalleDesarrolloFinalesBody &&
      typeof detalleDesarrolloFinalesBody === "object" &&
      !Array.isArray(detalleDesarrolloFinalesBody)
    ) {
      const devMerged = mergeConsolidatedDesarrolloFinales(
        combinedAnalysis.respuestas_desarrollo as unknown as Record<string, unknown>,
        detalleDesarrolloFinalesBody,
      )
      combinedAnalysis.respuestas_desarrollo = devMerged.merged as typeof combinedAnalysis.respuestas_desarrollo
      desarrolloFinalesApplied = devMerged.applied
    }
    if (consolidatedClosed.applied || desarrolloFinalesApplied) {
      studentAnswersSource = RESPUESTAS_FINALES_ESTUDIANTE
    }

    // Normalizar respuestas_desarrollo para que puntaje sea siempre string "X/Y" (evita [object Object] y permite calcular nota)
    combinedAnalysis.respuestas_desarrollo = normalizeRespuestasDesarrollo(combinedAnalysis.respuestas_desarrollo)

    // Excluir del detalle de desarrollo los ordinales que en pauta estructurada son solo cerrados (p. ej. SM1 → 1 vs P1 mal colapsado).
    const pautaRowsForDesarrolloFilter = parsePautaEstructurada(pautaEstructurada)
    combinedAnalysis.respuestas_desarrollo = filterDesarrolloExcludingClosedPautaSlots(
      (combinedAnalysis.respuestas_desarrollo || {}) as Record<string, unknown>,
      pautaRowsForDesarrolloFilter,
      tipoPruebaReal,
    ) as typeof combinedAnalysis.respuestas_desarrollo

    removeCorreccionEntriesForClosedPautaSlots(combinedAnalysis.retroalimentacion, pautaRowsForDesarrolloFilter)

    // No duplicar por ítem en correccion_detallada lo que ya está cubierto en detalle_desarrollo (por Pn).
    pruneCorreccionDetalladaForCanonicalDesarrollo(
      combinedAnalysis.retroalimentacion,
      (combinedAnalysis.respuestas_desarrollo || {}) as Record<string, unknown>
    )

    combinedAnalysis.retroalimentacion = applyOmrBlankHonestyToRetroalimentacion(
      combinedAnalysis.retroalimentacion,
      combinedAnalysis.respuestas_cerradas as Array<{ pregunta: string; respuesta_detectada: string }>
    )

    // Sanitizar retroalimentación para no culpar al estudiante cuando es problema de lectura/OCR
    combinedAnalysis.retroalimentacion = sanitizeRetroalimentacion(combinedAnalysis.retroalimentacion)

    if (tipoPruebaReal === "solo_alternativas") {
      combinedAnalysis.respuestas_desarrollo = {}
      combinedAnalysis.retroalimentacion = retroalimentacionEjecutivaSoloAlternativas()
    }

    // Copias defensivas y separación explícita de fuentes (teacher key vs student OMR read).
    const teacherClosedAnswersForScoring = JSON.parse(JSON.stringify(pautaAlternativasFinal))
    const studentClosedAnswersDetected = Array.isArray(combinedAnalysis.respuestas_cerradas)
      ? combinedAnalysis.respuestas_cerradas.map((r: any) => ({ ...r }))
      : []
    console.info("[trace][omr_official][student_before_calculateFinalScore]", {
      teacherAnswersSource,
      studentAnswersSource,
      teacherClosedAnswersLength:
        typeof answerKeyFromTemplate?.respuestas?.length === "number"
          ? answerKeyFromTemplate.respuestas.length
          : 0,
      studentClosedAnswersDetectedCount: studentClosedAnswersDetected.length,
      studentClosedAnswersDetectedFirst10: studentClosedAnswersDetected.slice(0, 10),
    })
    if (Object.is(teacherClosedAnswersForScoring, studentClosedAnswersDetected)) {
      return NextResponse.json(
        {
          success: false,
          error: "Separación de fuentes inválida: teacher key y student answers comparten referencia.",
          teacherAnswersSource,
          studentAnswersSource,
        },
        { status: 500 }
      )
    }

    // Calcular puntaje final
    const scores = calculateFinalScore(
      studentClosedAnswersDetected,
      combinedAnalysis.respuestas_desarrollo,
      pautaEstructurada,
      teacherClosedAnswersForScoring,
      Number(puntajeTotal),
      Number(porcentajeExigencia)
    )
    console.info("[evaluate] closed scoring completed", {
      nota: scores.nota,
      puntaje: scores.puntaje,
    })

    // Construir respuesta
    const retroForResult =
      tipoPruebaReal === "solo_alternativas"
        ? {
            ...retroalimentacionEjecutivaSoloAlternativas(),
            resumen_general: {
              fortalezas: RETRO_SOLO_ALTERNATIVAS_EJECUTIVO,
              areas_mejora: "",
            },
            retroalimentacion_alternativas: scores.alternativas_corregidas,
          }
        : sanitizeRetroalimentacion({
            ...combinedAnalysis.retroalimentacion,
            resumen_general: {
              fortalezas: combinedAnalysis.retroalimentacion?.fortalezas || "Análisis pendiente",
              areas_mejora: combinedAnalysis.retroalimentacion?.areas_mejora || "Análisis pendiente",
            },
            retroalimentacion_alternativas: scores.alternativas_corregidas,
          })

    const result = {
      success: true,
      retroalimentacion: retroForResult,
      puntaje: scores.puntaje,
      nota: scores.nota,
      puntosAprobacion: scores.puntosAprobacion,
      puntosMaximos: scores.puntosMaximos,
      detalle_desarrollo: tipoPruebaReal === "solo_alternativas" ? {} : combinedAnalysis.respuestas_desarrollo,
      alternativas_corregidas: scores.alternativas_corregidas,
      // SNAPSHOT_NATIONAL_ANALYTICS_V1:
      // Original: nombreEstudianteDetectado: combinedAnalysis.nombreEstudiante,
      nombreEstudianteDetectado: normalizeDetectedStudentName(combinedAnalysis.nombreEstudiante),
      officialOmrIntegrationEnabled,
      officialOmrEngineSelected,
      officialOmrAllowFallbackToLegacy,
      officialOmrEngineUsed,
      officialOmrFallbackUsed,
      officialOmrFallbackReason,
      officialOmrPerQuestionRaw,
      officialOmrDetectedAnswersPreview,
      officialOmrQuestionCountFromPipeline,
      officialOmrDetectedAnswersCount,
      officialOmrDetectedVsPipelineMismatch,
      officialOmrAdapterMode,
      teacherAnswersSource,
      studentAnswersSource,
      omrTemplateVariantRequested,
      omrTemplateVariantEffective: officialOmrTemplateVariantUsed,
      teacherClosedAnswersCount:
        typeof answerKeyFromTemplate?.respuestas?.length === "number"
          ? answerKeyFromTemplate.respuestas.length
          : 0,
      studentClosedAnswersCount: studentClosedAnswersDetected.length,
      ...(tipoPruebaReal === "solo_alternativas"
        ? {
            informe_ejecutivo: {
              modo: "solo_alternativas" as const,
              mensaje: RETRO_SOLO_ALTERNATIVAS_EJECUTIVO,
              logro_sobre_pauta_pct:
                Number(scores.puntosMaximos) > 0
                  ? Math.round(
                      ((scores.scoreAlternativas + scores.scoreDesarrollo) / Number(scores.puntosMaximos)) * 100,
                    )
                  : null,
            },
          }
        : {}),
      ...(evaluationDegraded
        ? { evaluation_degraded: true as const, evaluation_warnings: [...evaluationWarnings] }
        : {}),
      provider_trace: providerTraceAcc.current,
    }
    console.info("[trace][omr_official][response_summary]", {
      success: true,
      officialOmrIntegrationEnabled,
      officialOmrEngineSelected,
      officialOmrEngineUsed,
      officialOmrFallbackUsed,
      officialOmrFallbackReason,
      officialOmrAdapterMode,
      officialOmrQuestionCountFromPipeline,
      officialOmrDetectedAnswersCount,
      officialOmrDetectedVsPipelineMismatch,
      teacherClosedAnswersCount:
        typeof answerKeyFromTemplate?.respuestas?.length === "number"
          ? answerKeyFromTemplate.respuestas.length
          : 0,
      studentClosedAnswersCount: studentClosedAnswersDetected.length,
    })

    // Persistencia: solo si hay sesión y perfil con teacher_id. Nunca usar IDs del body.
    let saveResult: Awaited<ReturnType<typeof persistEvaluation>>
    const canSave = !!effectiveTeacherId && !!authUserId
    if (!canSave) {
      const reason = !user ? "NO_SESSION" : "PROFILE_NOT_ONBOARDED"
      saveResult = { saved: false, success: false, error: { step: "auth", message: reason === "NO_SESSION" ? "Inicia sesión para guardar" : "Completa tu perfil para guardar" }, reason }
    } else {
      try {
        // SNAPSHOT_NATIONAL_ANALYTICS_V1:
        // Original:
        // const nombreFromBody = typeof nombreEstudianteBody === "string" ? nombreEstudianteBody.trim() || null : null
        // const nombreFromResult = result.nombreEstudianteDetectado != null && String(result.nombreEstudianteDetectado).trim() !== ""
        //   ? String(result.nombreEstudianteDetectado).trim()
        //   : null
        // const confirmedStudentName = nombreFromBody ?? nombreFromResult ?? null
        const nombreFromBody =
          typeof nombreEstudianteBody === "string" && nombreEstudianteBody.trim() !== ""
            ? nombreEstudianteBody.trim()
            : null
        const nombreFromResult = normalizeDetectedStudentName(result.nombreEstudianteDetectado)
        const confirmedStudentName = nombreFromBody ?? nombreFromResult
        if (process.env.NODE_ENV !== "production") {
          console.info("[student] detected_students_raw =", JSON.stringify([result.nombreEstudianteDetectado].filter(Boolean)))
          console.info("[student] confirmed_students_before_save =", JSON.stringify(confirmedStudentName ? [confirmedStudentName] : []))
        }
        console.log("[evaluate] ANTES persistEvaluation (Supabase service role)")
        saveResult = await persistEvaluation(result, {
          user_id: authUserId,
          teacher_id: effectiveTeacherId,
          school_id: effectiveSchoolId,
          course_id: typeof courseIdBody === "string" ? courseIdBody.trim() || null : null,
          title: typeof evaluationTitleBody === "string" ? evaluationTitleBody.trim() || null : null,
          subject: typeof evaluationSubjectBody === "string" ? evaluationSubjectBody.trim() || null : null,
          student_name: confirmedStudentName,
          batch_id:
            typeof evaluationBatchIdBody === "string" && evaluationBatchIdBody.trim() !== ""
              ? evaluationBatchIdBody.trim()
              : null,
          source_exam_id:
            typeof sourceExamIdBody === "string" && sourceExamIdBody.trim() !== ""
              ? sourceExamIdBody.trim()
              : null,
          endpoint_origin: "/api/evaluate",
        })
        console.log("[evaluate] DESPUÉS persistEvaluation", { saved: saveResult.saved })
      } catch (e) {
        if (process.env.NODE_ENV !== "production") console.error("[Evaluate] persistEvaluation threw:", e)
        saveResult = {
          saved: false,
          success: false,
          error: { step: "persist_throw", message: e instanceof Error ? e.message : String(e) },
        }
      }
    }

    const saved = saveResult.saved
    const evaluationId = saved ? saveResult.evaluation_id : null
    const status = saved ? saveResult.status : null
    const evaluationIdLooksUuid =
      typeof evaluationId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evaluationId)
    const save_error: string | null =
      !saved && saveResult.error ? `${saveResult.error.step}: ${saveResult.error.message}` : null
    const save_reason: string | undefined = !saved && "reason" in saveResult ? (saveResult as { reason?: string }).reason : undefined
      if (saved && !evaluationIdLooksUuid) {
      console.error("[evaluate][SAVE_INVALID_EVALUATION_ID]", { evaluationId, status })
      return NextResponse.json(
        {
          success: false,
          error: "Guardado devolvió evaluation_id inválido (no UUID)",
          saved: false,
          evaluation_id: null,
          save_error: "save: invalid evaluation_id returned by persistence layer",
          reason: "INVALID_EVALUATION_ID",
        },
        { status: 500 }
      )
    }
    if (!saved) {
      console.error("[evaluate][SAVE_FAILED]", {
        step: saveResult.error?.step ?? "unknown",
        message: saveResult.error?.message ?? "unknown",
        reason: save_reason ?? null,
      })
    } else {
      console.info("[evaluate][SAVE_OK]", { evaluation_id: evaluationId, status })
    }
    console.info("[evaluate][source_exam_link_observability]", {
      evaluation_id: evaluationId,
      teacher_id: effectiveTeacherId,
      school_id: effectiveSchoolId,
      source_exam_id: sourceExamIdTrimmed,
      has_source_exam_link: !!sourceExamIdTrimmed,
    })

    // Cuerpo HTTP: no incluir `officialOmrPerQuestionRaw` completo (muy volumétrico; ya hay preview en omrDebug).
    // Evita truncamiento intermedio que en el cliente produce "Unterminated string in JSON at position ...".
    const resultForWire: Record<string, unknown> = { ...(result as unknown as Record<string, unknown>) }
    delete resultForWire.officialOmrPerQuestionRaw

    const resultadoFinal: Record<string, unknown> = {
      ...resultForWire,
      omrDebug: {
        engineSelected: officialOmrEngineSelected,
        engineUsed: officialOmrEngineUsed,
        fallbackUsed: officialOmrFallbackUsed,
        fallbackReason: officialOmrFallbackReason,
        integrationEnabled: officialOmrIntegrationEnabled,
        studentAnswersSource,
        teacherAnswersSource,
        expectedQuestionCountUsed: officialOmrExpectedQuestionCountUsed,
        teacherAnswerKeyLength: officialOmrTeacherAnswerKeyLength,
        totalPregResolved: officialOmrTotalPregResolved,
        templateKeyUsed: officialOmrTemplateKeyUsed,
        omrTemplateVariantRequested,
        omrTemplateVariantEffective: officialOmrTemplateVariantUsed,
        omrTemplateVariantUsed: officialOmrTemplateVariantUsed,
        omrTemplateVariantAutoDiagnostics: officialOmrTemplateVariantAutoDiagnostics,
        officialOmrQuestionCountFromPipeline,
        officialOmrDetectedAnswersCount,
        officialOmrDetectedVsPipelineMismatch,
        officialOmrAdapterMode,
        sourceExamOmrIdUsed: officialOmrSourceExamIdUsed,
        sourceExamOmrMetadataSource: officialOmrMetadataSource,
        sourceExamOmrItemsClosedCountFromDb: officialOmrItemsClosedCountFromDb,
        gridQuestionCountAtEngine: officialOmrGridQuestionCountAtEngine,
        officialOmrPerQuestionRawLength: Array.isArray(officialOmrPerQuestionRaw) ? officialOmrPerQuestionRaw.length : 0,
        officialOmrPerQuestionRawPreview: Array.isArray(officialOmrPerQuestionRaw)
          ? officialOmrPerQuestionRaw.slice(0, 10)
          : [],
        detectedAnswersPreview:
          Array.isArray(officialOmrDetectedAnswersPreview) && officialOmrDetectedAnswersPreview.length > 0
            ? officialOmrDetectedAnswersPreview.slice(0, 10)
            : Array.isArray(studentClosedAnswersDetected)
              ? studentClosedAnswersDetected.slice(0, 10)
              : [],
        totalDetectedAnswers: Array.isArray(studentClosedAnswersDetected)
          ? studentClosedAnswersDetected.length
          : 0,
        provider_trace: providerTraceAcc.current,
      },
      provider_trace: providerTraceAcc.current,
      saved,
      evaluation_id: evaluationId,
      status,
      save_error,
      ...(save_reason && { reason: save_reason }),
    }

    return finalizeEvaluateSuccessResponseHttp200(resultadoFinal)
  } catch (error: unknown) {
    console.error("[Evaluate] Error:", error)
    if (error instanceof EvaluationIaUnavailableError) {
      providerTraceAcc.current = mergeEvaluationProviderTrace(providerTraceAcc.current, error.provider_trace)
    }
    let msg = error instanceof Error ? error.message : "Error procesando la evaluación"
    if (/503|502|429|upstream connect error|overflow/.test(msg)) {
      msg = "El servicio de IA no está disponible en este momento. Espera unos minutos e intenta de nuevo."
    }
    const isPdfError = typeof msg === "string" && msg.includes("PDF") && msg.includes("solo acepta imágenes")
    const omrPayload =
      omrDebugSnapshotForCatch != null
        ? omitHeavyOmrFieldsForErrorWire(omrDebugSnapshotForCatch)
        : { omrStateUnknownDueToEarlyFailure: true as const }
    return NextResponse.json(
      {
        success: false,
        error: msg,
        provider_trace: providerTraceAcc.current,
        ...omrPayload,
      },
      { status: error instanceof EvaluationIaUnavailableError ? 503 : isPdfError ? 400 : 500 },
    )
  }
}
