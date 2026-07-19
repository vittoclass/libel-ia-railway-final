/**
 * FASE 3.5 — Contrato estable de ítems de desarrollo en el pipeline de evaluación.
 * Sin integración con Prueba Base; sin OMR ni scoring (solo normalización / fusión de resultados de IA).
 */

import {
  applyDevelopmentCriteriaCoreToSoloDesarrolloRecord,
  buildDevelopmentCriteriaPromptInstruction,
  buildDevelopmentCriteriaRespuestasDesarrolloJsonExample,
} from "@/app/lib/development-core/development-criteria-core"
import {
  isPlaceholderStudentDesarrolloText,
  pickStudentDesarrolloVisibleText,
} from "@/app/lib/pick-student-desarrollo-text"

/** Prefijos de ítem cerrado: no se renombran a P{n} (evita colisión con desarrollo). */
const CERRADA_PREFIX = /^(SM|VF|TP|C)\d/i

/**
 * Identidad canónica de un ítem de desarrollo: P1 … P999 según el ordinal pedagógico.
 * No aplica a claves de alternativas (SM/VF/TP/C…).
 */
export function tryCanonicalDevelopmentItemKey(rawKey: string): string | null {
  const k = String(rawKey ?? "").trim()
  if (!k) return null
  if (CERRADA_PREFIX.test(k)) return null

  const u = k.toUpperCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ")

  let m = /^P(\d{1,3})$/i.exec(u.replace(/\s/g, ""))
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }

  m = /^(\d{1,3})$/.exec(u)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }

  m = /^Q(\d{1,3})$/i.exec(u.replace(/\s/g, ""))
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }

  m = /^PREGUNTA\s*(\d{1,3})$/i.exec(u)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }

  m = /^ITEM\s*(\d{1,3})$/i.exec(u)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }

  m = /^DESARROLLO\s*(\d{1,3})$/i.exec(u)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }

  return null
}

/** Fila mínima de pauta estructurada para clasificar cerradas vs desarrollo (misma semántica que parsePautaEstructurada en route). */
export type PautaRowClassification = { id: string; isDevelopment: boolean }

function extractOrdinalFromStructuredPautaId(id: string): number | null {
  const m = String(id ?? "").match(/(\d{1,3})/)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 1 || n > 999) return null
  return n
}

function buildClosedVersusOpenOrdinalIndex(rows: PautaRowClassification[]) {
  const cerradaExactIds = new Set<string>()
  const cerradaOrdinals = new Set<number>()
  const desarrolloOrdinals = new Set<number>()

  for (const row of rows) {
    const idU = String(row.id ?? "").trim().toUpperCase()
    if (!idU) continue
    const ord = extractOrdinalFromStructuredPautaId(row.id)
    if (row.isDevelopment) {
      if (ord != null) desarrolloOrdinals.add(ord)
    } else {
      cerradaExactIds.add(idU)
      if (ord != null) cerradaOrdinals.add(ord)
    }
  }

  return { cerradaExactIds, cerradaOrdinals, desarrolloOrdinals }
}

/** Ordinal P{n} asociado a una clave ya normalizada o alias numérico. */
function ordinalFromDesarrolloDetalleKey(rawKey: string): number | null {
  const t = rawKey.trim()
  const m = /^P(\d{1,3})$/i.exec(t)
  if (m) return Number.parseInt(m[1], 10)
  const canon = tryCanonicalDevelopmentItemKey(t)
  if (canon && /^P\d+$/i.test(canon)) return Number.parseInt(canon.slice(1), 10)
  return null
}

/**
 * Tras normalizar, elimina entradas de desarrollo que corresponden solo a slots cerrados en la pauta estructurada.
 * Evita que "1"→P1 u otras colisiones de ordinal mezclen alternativas con desarrollo.
 */
export function filterDesarrolloExcludingClosedPautaSlots(
  detalle: Record<string, unknown>,
  pautaRows: PautaRowClassification[],
  tipoPrueba: "mixta" | "solo_desarrollo" | "solo_alternativas",
): Record<string, unknown> {
  if (tipoPrueba === "solo_alternativas") {
    return {}
  }

  if (!pautaRows.length) {
    return { ...detalle }
  }

  const { cerradaExactIds, cerradaOrdinals, desarrolloOrdinals } = buildClosedVersusOpenOrdinalIndex(pautaRows)

  const out: Record<string, unknown> = {}
  for (const [rawKey, val] of Object.entries(detalle)) {
    if (val == null || typeof val !== "object") continue

    const keyU = rawKey.trim().toUpperCase()
    if (cerradaExactIds.has(keyU)) continue

    const ord = ordinalFromDesarrolloDetalleKey(rawKey)
    if (ord != null) {
      const onlyClosedSlot = cerradaOrdinals.has(ord) && !desarrolloOrdinals.has(ord)
      if (onlyClosedSlot) continue
    }

    out[rawKey] = val
  }

  return orderCanonicalDesarrolloRecord(out)
}

/**
 * Evita que correccion_detallada trate ítems cerrados como bloques de desarrollo (misma lógica ordinal / id exacto).
 */
export function removeCorreccionEntriesForClosedPautaSlots(
  retro: { correccion_detallada?: unknown[] } | null | undefined,
  pautaRows: PautaRowClassification[],
): void {
  if (!retro || !Array.isArray(retro.correccion_detallada) || !pautaRows.length) return

  const { cerradaExactIds, cerradaOrdinals, desarrolloOrdinals } = buildClosedVersusOpenOrdinalIndex(pautaRows)

  retro.correccion_detallada = retro.correccion_detallada.filter((entry) => {
    if (!entry || typeof entry !== "object") return true
    const seccion = String((entry as { seccion?: unknown }).seccion ?? "").trim()
    if (!seccion) return true

    const secU = seccion.toUpperCase()
    if (cerradaExactIds.has(secU)) return false

    const canonFromSec = tryCanonicalDevelopmentKeyFromSection(seccion)
    const ord =
      (canonFromSec && /^P\d+$/i.test(canonFromSec) ? Number.parseInt(canonFromSec.slice(1), 10) : null) ??
      ordinalFromDesarrolloDetalleKey(seccion)

    if (ord != null && cerradaOrdinals.has(ord) && !desarrolloOrdinals.has(ord)) {
      return false
    }

    return true
  })
}

function substantiveStudentText(item: Record<string, unknown> | null | undefined): string {
  if (!item) return ""
  const t = pickStudentDesarrolloVisibleText(item)
  if (!t || isPlaceholderStudentDesarrolloText(t)) return ""
  return t
}

/** Une dos objetos ítem: primary gana en conflicto; rellena huecos desde fallback. */
function overlayDesarrolloItem(primary: Record<string, unknown>, fallback: Record<string, unknown>): Record<string, unknown> {
  const pText = substantiveStudentText(primary)
  const fText = substantiveStudentText(fallback)
  const texto = pText || fText || String(primary.texto_estudiante ?? primary.cita_estudiante ?? fallback.texto_estudiante ?? fallback.cita_estudiante ?? "").trim()

  const pJ = typeof primary.justificacion === "string" ? primary.justificacion.trim() : ""
  const fJ = typeof fallback.justificacion === "string" ? fallback.justificacion.trim() : ""
  const justificacion = pJ || fJ

  let puntaje: unknown = primary.puntaje
  if (puntaje == null || (typeof puntaje === "string" && !String(puntaje).includes("/"))) {
    puntaje = fallback.puntaje ?? puntaje
  }

  return {
    ...fallback,
    ...primary,
    texto_estudiante: texto,
    cita_estudiante: texto,
    justificacion: justificacion || primary.justificacion || fallback.justificacion,
    puntaje,
  }
}

/**
 * Cuando dos entradas caen en el mismo ordinal, preferir la cita más útil (más larga sustantiva).
 */
function mergeSamePassItems(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const ta = substantiveStudentText(a)
  const tb = substantiveStudentText(b)
  if (tb.length > ta.length) return overlayDesarrolloItem(b, a)
  if (ta.length > tb.length) return overlayDesarrolloItem(a, b)
  return overlayDesarrolloItem(a, b)
}

/**
 * Colapsa todas las claves crudas a P{n} (o deja claves no reconocidas tal cual, una entrada por clave).
 */
export function collapseDevelopmentKeysToCanonical(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!raw || typeof raw !== "object") return out

  for (const [rawKey, val] of Object.entries(raw)) {
    if (val == null || typeof val !== "object") continue
    const item = val as Record<string, unknown>
    const canon = tryCanonicalDevelopmentItemKey(rawKey)
    const bucketKey = canon ?? rawKey.trim()
    if (!bucketKey) continue

    if (out[bucketKey] == null) {
      out[bucketKey] = { ...item }
    } else {
      out[bucketKey] = mergeSamePassItems(out[bucketKey] as Record<string, unknown>, item)
    }
  }
  return out
}

/**
 * Regla de fusión Vision + dedicada: la pasada dedicada manda cuando aporta cita sustantiva;
 * si no, se conserva Vision. Si ambas son débiles, se prioriza la estructura de la dedicada (puntaje/justificación).
 */
export function mergeVisionAndDedicatedDesarrollo(
  visionRaw: Record<string, unknown> | null | undefined,
  dedicatedRaw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const v = collapseDevelopmentKeysToCanonical(visionRaw)
  const d = collapseDevelopmentKeysToCanonical(dedicatedRaw)
  const keys = new Set([...Object.keys(v), ...Object.keys(d)])
  const out: Record<string, unknown> = {}

  for (const key of keys) {
    const vis = v[key] as Record<string, unknown> | undefined
    const ded = d[key] as Record<string, unknown> | undefined
    if (!ded) {
      if (vis) out[key] = vis
      continue
    }
    if (!vis) {
      out[key] = ded
      continue
    }

    const dText = substantiveStudentText(ded)
    if (dText.length > 0) {
      out[key] = overlayDesarrolloItem(ded, vis)
      continue
    }

    const vText = substantiveStudentText(vis)
    if (vText.length > 0) {
      out[key] = overlayDesarrolloItem(vis, ded)
      continue
    }

    out[key] = overlayDesarrolloItem(ded, vis)
  }

  return out
}

/** Acumula páginas: mismo criterio que colisión en una pasada (texto sustantivo más largo gana). */
export function accumulateDesarrolloAcrossPages(
  acc: Record<string, unknown> | null | undefined,
  page: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const a = collapseDevelopmentKeysToCanonical(acc)
  const p = collapseDevelopmentKeysToCanonical(page)
  const keys = new Set([...Object.keys(a), ...Object.keys(p)])
  const out: Record<string, unknown> = {}

  for (const key of keys) {
    const ai = a[key] as Record<string, unknown> | undefined
    const pi = p[key] as Record<string, unknown> | undefined
    if (!pi) {
      if (ai) out[key] = ai
      continue
    }
    if (!ai) {
      out[key] = pi
      continue
    }
    out[key] = mergeSamePassItems(ai, pi)
  }
  return out
}

/** Orden estable: P1, P2, … P10; el resto alfabético. */
export function orderCanonicalDesarrolloRecord(record: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(record).sort((a, b) => {
    const ma = /^P(\d+)$/.exec(a)
    const mb = /^P(\d+)$/.exec(b)
    if (ma && mb) return Number(ma[1]) - Number(mb[1])
    if (ma) return -1
    if (mb) return 1
    return a.localeCompare(b)
  })
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = record[k]
  return out
}

/** True si el ítem ya cubre el feedback por pregunta (cita, justificación o puntaje obtenido > 0). */
export function desarrolloItemSuppressesCorreccionDetallada(item: unknown): boolean {
  if (!item || typeof item !== "object") return false
  const o = item as Record<string, unknown>
  const t = pickStudentDesarrolloVisibleText(o)
  if (t && !isPlaceholderStudentDesarrolloText(t)) return true
  const j = String(o.justificacion ?? "").trim()
  if (j.length >= 12) return true
  const p = String(o.puntaje ?? "").trim()
  const m = p.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/)
  if (m) {
    const obt = Number.parseFloat(m[1])
    if (Number.isFinite(obt) && obt > 0) return true
  }
  return false
}

/**
 * Quita de correccion_detallada las filas que duplican un ítem Pn ya cubierto en detalle_desarrollo.
 * Si el detalle para Pn está vacío o sin señal operativa, se conserva la fila de correccion_detallada.
 */
export function pruneCorreccionDetalladaForCanonicalDesarrollo(
  retro: { correccion_detallada?: unknown[] } | null | undefined,
  detallePorClave: Record<string, unknown>,
): void {
  if (!retro || !Array.isArray(retro.correccion_detallada)) return

  retro.correccion_detallada = retro.correccion_detallada.filter((entry) => {
    if (!entry || typeof entry !== "object") return true
    const seccion = String((entry as { seccion?: unknown }).seccion ?? "").trim()
    const canon = tryCanonicalDevelopmentKeyFromSection(seccion)
    if (!canon) return true
    const det = detallePorClave[canon]
    if (det == null) return true
    if (desarrolloItemSuppressesCorreccionDetallada(det)) return false
    return true
  })
}

/** Interpreta el título de un bloque de corrección como ordinal de desarrollo, si aplica. */
export function tryCanonicalDevelopmentKeyFromSection(seccion: string): string | null {
  const s = String(seccion ?? "").trim()
  if (!s) return null

  const direct = tryCanonicalDevelopmentItemKey(s)
  if (direct) return direct

  const compact = s.replace(/\s+/g, " ")
  const m1 = /pregunta\s*(?:de\s*)?desarrollo\s*[:#]?\s*P\s*(\d{1,3})/i.exec(compact)
  if (m1) {
    const n = Number(m1[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }
  const m2 = /desarrollo\s*[:#]?\s*P\s*(\d{1,3})/i.exec(compact)
  if (m2) {
    const n = Number(m2[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }
  const m3 = /í?tem\s*(\d{1,3})\b/i.exec(compact)
  if (m3) {
    const n = Number(m3[1])
    if (n >= 1 && n <= 999) return `P${n}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Deduplicación conservadora por evidencia normalizada (solo_desarrollo)
// ---------------------------------------------------------------------------

const DEVELOPMENT_EVIDENCE_FIELD_ORDER = [
  "texto_estudiante",
  "cita_estudiante",
  "respuesta",
  "answer",
  "contenido",
  "text",
] as const

const MIN_EVIDENCE_CHARS = 80
const MIN_EVIDENCE_WORDS = 12
const DUPLICATE_JACCARD_THRESHOLD = 0.65
const DUPLICATE_CONTAINMENT_THRESHOLD = 0.75

/** Evidencia del estudiante normalizada para comparación determinista (extensible a multimodal). */
export type NormalizedDevelopmentEvidence = {
  normalizedText: string
  words: string[]
  wordSet: Set<string>
  wordCount: number
  usefulCharCount: number
}

export type DevelopmentDeduplicationGroup = {
  keptKey: string
  duplicateKeys: string[]
  reason: string
  similarity?: number
  containment?: number
}

export type DevelopmentDeduplicationAudit = {
  deduplicated: boolean
  keptKeys: string[]
  droppedKeys: string[]
  groups: DevelopmentDeduplicationGroup[]
}

export type DeduplicateDevelopmentAnswersInput = {
  respuestasDesarrollo: Record<string, unknown>
  tipoPruebaReal: string
}

export type DeduplicateDevelopmentAnswersResult = {
  respuestasDesarrollo: Record<string, unknown>
  audit?: DevelopmentDeduplicationAudit
}

function extractDevelopmentEvidenceRawText(item: Record<string, unknown>): string | null {
  for (const field of DEVELOPMENT_EVIDENCE_FIELD_ORDER) {
    const v = item[field]
    if (typeof v === "string") {
      const t = v.trim()
      if (t) return t
    }
  }
  return null
}

function stripDiacriticsForEvidence(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeDevelopmentEvidenceString(raw: string): string {
  let s = raw.toLowerCase()
  s = stripDiacriticsForEvidence(s)
  s = s.replace(/\[ilegible\]/gi, " ")
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ")
  s = s.replace(/\s+/g, " ").trim()
  return s
}

function significantEvidenceWords(normalized: string): string[] {
  if (!normalized) return []
  return normalized.split(/\s+/).filter((w) => w.length >= 2)
}

/**
 * Construye evidencia normalizada desde un ítem de desarrollo.
 * Hoy: texto escrito. Diseño preparado para futuras fuentes (visual, artes, OCR shadow).
 */
export function buildNormalizedDevelopmentEvidence(item: unknown): NormalizedDevelopmentEvidence | null {
  if (!item || typeof item !== "object") return null
  const o = item as Record<string, unknown>
  const raw = extractDevelopmentEvidenceRawText(o)
  if (!raw) return null

  const normalizedText = normalizeDevelopmentEvidenceString(raw)
  const words = significantEvidenceWords(normalizedText)
  if (!normalizedText || words.length === 0) return null

  const usefulCharCount = normalizedText.replace(/\s/g, "").length
  return {
    normalizedText,
    words,
    wordSet: new Set(words),
    wordCount: words.length,
    usefulCharCount,
  }
}

function meetsMinimumEvidenceForComparison(ev: NormalizedDevelopmentEvidence): boolean {
  return ev.usefulCharCount >= MIN_EVIDENCE_CHARS && ev.wordCount >= MIN_EVIDENCE_WORDS
}

function intersectionWordCount(a: Set<string>, b: Set<string>): number {
  let n = 0
  const smaller = a.size <= b.size ? a : b
  const larger = a.size <= b.size ? b : a
  for (const w of smaller) {
    if (larger.has(w)) n++
  }
  return n
}

function jaccardWordSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  const inter = intersectionWordCount(a, b)
  const union = a.size + b.size - inter
  if (union === 0) return 0
  return inter / union
}

function containmentWordSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const inter = intersectionWordCount(a, b)
  const minSize = Math.min(a.size, b.size)
  if (minSize === 0) return 0
  return inter / minSize
}

function countIlegibleMarkersInRaw(raw: string): number {
  const matches = raw.match(/\[ilegible\]/gi)
  return matches ? matches.length : 0
}

function parseDesarrolloPuntajeScores(puntaje: unknown): { obtained: number; max: number } {
  const s = String(puntaje ?? "").trim()
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/)
  if (!m) return { obtained: 0, max: 0 }
  const obtained = Number.parseFloat(m[1])
  const max = Number.parseFloat(m[2])
  return {
    obtained: Number.isFinite(obtained) ? obtained : 0,
    max: Number.isFinite(max) ? max : 0,
  }
}

function usefulJustificacionLength(item: Record<string, unknown>): number {
  const j = item.justificacion
  if (typeof j !== "string") return 0
  return j.trim().replace(/\s+/g, " ").length
}

type RankedDevelopmentEntry = {
  key: string
  item: Record<string, unknown>
  evidence: NormalizedDevelopmentEvidence
  ilegibleCount: number
  justificacionLength: number
  scoreMax: number
  scoreObtained: number
  stableIndex: number
}

function compareDevelopmentEntryRank(a: RankedDevelopmentEntry, b: RankedDevelopmentEntry): number {
  if (b.evidence.wordCount !== a.evidence.wordCount) return b.evidence.wordCount - a.evidence.wordCount
  if (a.ilegibleCount !== b.ilegibleCount) return a.ilegibleCount - b.ilegibleCount
  if (b.justificacionLength !== a.justificacionLength) return b.justificacionLength - a.justificacionLength
  if (b.scoreMax !== a.scoreMax) return b.scoreMax - a.scoreMax
  if (b.scoreObtained !== a.scoreObtained) return b.scoreObtained - a.scoreObtained
  return a.stableIndex - b.stableIndex
}

function pickBestDevelopmentEntryInGroup(entries: RankedDevelopmentEntry[]): RankedDevelopmentEntry {
  let best = entries[0]
  for (let i = 1; i < entries.length; i++) {
    if (compareDevelopmentEntryRank(entries[i], best) < 0) best = entries[i]
  }
  return best
}

class DevelopmentEvidenceUnionFind {
  private parent = new Map<string, string>()

  constructor(keys: string[]) {
    for (const k of keys) this.parent.set(k, k)
  }

  find(x: string): string {
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let cur = x
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

function pairDuplicateMetrics(
  evA: NormalizedDevelopmentEvidence,
  evB: NormalizedDevelopmentEvidence,
): { duplicate: boolean; jaccard: number; containment: number } {
  if (!meetsMinimumEvidenceForComparison(evA) || !meetsMinimumEvidenceForComparison(evB)) {
    return { duplicate: false, jaccard: 0, containment: 0 }
  }
  const jaccard = jaccardWordSimilarity(evA.wordSet, evB.wordSet)
  const containment = containmentWordSimilarity(evA.wordSet, evB.wordSet)
  const duplicate = jaccard >= DUPLICATE_JACCARD_THRESHOLD && containment >= DUPLICATE_CONTAINMENT_THRESHOLD
  return { duplicate, jaccard, containment }
}

/**
 * Elimina respuestas de desarrollo duplicadas por evidencia normalizada similar.
 * Solo activo en solo_desarrollo; conservador: ante duda, conserva ambas.
 */
export function deduplicateDevelopmentAnswersForSoloDesarrollo(
  input: DeduplicateDevelopmentAnswersInput,
): DeduplicateDevelopmentAnswersResult {
  const { respuestasDesarrollo, tipoPruebaReal } = input

  if (tipoPruebaReal !== "solo_desarrollo") {
    return { respuestasDesarrollo }
  }

  if (!respuestasDesarrollo || typeof respuestasDesarrollo !== "object") {
    return { respuestasDesarrollo: {} }
  }

  const entries = Object.entries(respuestasDesarrollo).filter(
    ([, val]) => val != null && typeof val === "object",
  )

  if (entries.length <= 1) {
    return { respuestasDesarrollo }
  }

  const keys = entries.map(([k]) => k)
  const itemsByKey = new Map<string, Record<string, unknown>>()
  const evidenceByKey = new Map<string, NormalizedDevelopmentEvidence>()
  const rawTextByKey = new Map<string, string>()
  const stableIndexByKey = new Map<string, number>()

  entries.forEach(([key, val], idx) => {
    const item = val as Record<string, unknown>
    itemsByKey.set(key, item)
    stableIndexByKey.set(key, idx)
    const raw = extractDevelopmentEvidenceRawText(item)
    if (raw) rawTextByKey.set(key, raw)
    const ev = buildNormalizedDevelopmentEvidence(item)
    if (ev) evidenceByKey.set(key, ev)
  })

  const comparableKeys = keys.filter((k) => {
    const ev = evidenceByKey.get(k)
    return ev != null && meetsMinimumEvidenceForComparison(ev)
  })

  if (comparableKeys.length <= 1) {
    return { respuestasDesarrollo }
  }

  const uf = new DevelopmentEvidenceUnionFind(keys)
  const groupPairMetrics = new Map<string, { jaccard: number; containment: number }>()

  for (let i = 0; i < comparableKeys.length; i++) {
    const keyA = comparableKeys[i]
    const evA = evidenceByKey.get(keyA)!
    for (let j = i + 1; j < comparableKeys.length; j++) {
      const keyB = comparableKeys[j]
      const evB = evidenceByKey.get(keyB)!
      const metrics = pairDuplicateMetrics(evA, evB)
      if (!metrics.duplicate) continue
      uf.union(keyA, keyB)
      const pairKey = [keyA, keyB].sort().join("|")
      const prev = groupPairMetrics.get(pairKey)
      if (
        !prev ||
        metrics.jaccard > prev.jaccard ||
        (metrics.jaccard === prev.jaccard && metrics.containment > prev.containment)
      ) {
        groupPairMetrics.set(pairKey, { jaccard: metrics.jaccard, containment: metrics.containment })
      }
    }
  }

  const groupsByRoot = new Map<string, string[]>()
  for (const key of keys) {
    const root = uf.find(key)
    const list = groupsByRoot.get(root) ?? []
    list.push(key)
    groupsByRoot.set(root, list)
  }

  const duplicateGroups = [...groupsByRoot.values()].filter((g) => g.length > 1)
  if (duplicateGroups.length === 0) {
    return { respuestasDesarrollo }
  }

  const keptKeys: string[] = []
  const droppedKeys: string[] = []
  const auditGroups: DevelopmentDeduplicationGroup[] = []
  const keysToDrop = new Set<string>()

  for (const groupKeys of duplicateGroups) {
    const ranked: RankedDevelopmentEntry[] = []
    for (const key of groupKeys) {
      const item = itemsByKey.get(key)!
      const evidence = evidenceByKey.get(key)
      if (!evidence) continue
      const raw = rawTextByKey.get(key) ?? ""
      const scores = parseDesarrolloPuntajeScores(item.puntaje)
      ranked.push({
        key,
        item,
        evidence,
        ilegibleCount: countIlegibleMarkersInRaw(raw),
        justificacionLength: usefulJustificacionLength(item),
        scoreMax: scores.max,
        scoreObtained: scores.obtained,
        stableIndex: stableIndexByKey.get(key) ?? 0,
      })
    }

    if (ranked.length <= 1) continue

    const best = pickBestDevelopmentEntryInGroup(ranked)
    const dupKeys = groupKeys.filter((k) => k !== best.key)
    if (dupKeys.length === 0) continue

    keptKeys.push(best.key)
    for (const dk of dupKeys) {
      droppedKeys.push(dk)
      keysToDrop.add(dk)
    }

    let maxJ = 0
    let maxC = 0
    for (let i = 0; i < groupKeys.length; i++) {
      for (let j = i + 1; j < groupKeys.length; j++) {
        const pairKey = [groupKeys[i], groupKeys[j]].sort().join("|")
        const m = groupPairMetrics.get(pairKey)
        if (m) {
          maxJ = Math.max(maxJ, m.jaccard)
          maxC = Math.max(maxC, m.containment)
        }
      }
    }

    auditGroups.push({
      keptKey: best.key,
      duplicateKeys: dupKeys,
      reason: "normalized_evidence_jaccard_and_containment",
      similarity: maxJ > 0 ? maxJ : undefined,
      containment: maxC > 0 ? maxC : undefined,
    })
  }

  if (droppedKeys.length === 0) {
    return { respuestasDesarrollo }
  }

  const out: Record<string, unknown> = {}
  for (const [key, val] of entries) {
    if (!keysToDrop.has(key)) out[key] = val
  }

  const audit: DevelopmentDeduplicationAudit = {
    deduplicated: true,
    keptKeys,
    droppedKeys,
    groups: auditGroups,
  }

  logDevelopmentDeduplicationAudit(audit, itemsByKey)

  return {
    respuestasDesarrollo: orderCanonicalDesarrolloRecord(out),
    audit,
  }
}

function logDevelopmentDeduplicationAudit(
  audit: DevelopmentDeduplicationAudit,
  itemsByKey: Map<string, Record<string, unknown>>,
): void {
  const maxSimilarity = audit.groups.reduce((m, g) => Math.max(m, g.similarity ?? 0), 0)
  const maxContainment = audit.groups.reduce((m, g) => Math.max(m, g.containment ?? 0), 0)

  const scoreMaxKept = audit.groups.map((g) => parseDesarrolloPuntajeScores(itemsByKey.get(g.keptKey)?.puntaje).max)
  const scoreMaxDropped = audit.droppedKeys.map(
    (k) => parseDesarrolloPuntajeScores(itemsByKey.get(k)?.puntaje).max,
  )

  console.info("[evaluate][development] deduplicated duplicated development answers", {
    keptKeys: audit.keptKeys,
    droppedKeys: audit.droppedKeys,
    reason: "normalized_evidence_similarity",
    groupCount: audit.groups.length,
    similarityRounded: Math.round(maxSimilarity * 100) / 100,
    containmentRounded: Math.round(maxContainment * 100) / 100,
    scoreMaxKept,
    scoreMaxDropped,
  })
}

// ---------------------------------------------------------------------------
// Unidad pedagógica de evidencia (solo_desarrollo) — decisión previa al scoring
// ---------------------------------------------------------------------------

export type PedagogicalEvidenceUnitMode =
  | "NOT_APPLICABLE"
  | "SINGLE_EVIDENCE_TEXT"
  | "SINGLE_EVIDENCE_VISUAL"
  | "MULTIPLE_OPEN_EVIDENCES"

export type PedagogicalEvidenceScoringMode = "GLOBAL_MECHANICAL" | "MULTI_ITEM_EXISTING"

export type PedagogicalEvidenceUnitPlan = {
  applies: boolean
  mode: PedagogicalEvidenceUnitMode
  scoringMode: PedagogicalEvidenceScoringMode
  allowOmr: boolean
  reason: string
}

export type ResolvePedagogicalEvidenceUnitPlanInput = {
  tipoPruebaReal: string
  areaConocimiento?: string | null
  rubrica?: string | null
  pautaEstructurada?: string | null
  puntajeTotal: number
}

type PautaRowForEvidencePlan = { id: string; maxScore: number; isDevelopment: boolean }

function parsePautaRowsForEvidencePlan(pautaStr: string | null | undefined): PautaRowForEvidencePlan[] {
  const items: PautaRowForEvidencePlan[] = []
  const raw = String(pautaStr ?? "").trim()
  if (!raw) return items

  for (const pair of raw.split(";").map((p) => p.trim()).filter((p) => p.length > 0)) {
    const [id, scoreStr] = pair.split(":").map((s) => s.trim())
    const maxScore = Number.parseInt(scoreStr, 10)
    if (!id || !Number.isFinite(maxScore) || maxScore <= 0) continue
    items.push({
      id,
      maxScore,
      isDevelopment: id.toLowerCase().includes("desarrollo") || /^p\d+/i.test(id),
    })
  }
  return items
}

function isExplicitDevelopmentQuestionId(id: string): boolean {
  const compact = id.trim().replace(/\s+/g, "")
  if (/^p\d{1,3}$/i.test(compact)) return true
  if (/^q\d{1,3}$/i.test(compact)) return true
  if (/^pregunta\d{1,3}$/i.test(compact)) return true
  if (/desarrollo\s*\d+/i.test(id)) return true
  return false
}

function looksLikeRubricCriterionSlot(id: string): boolean {
  const lower = id.toLowerCase().trim()
  if (/^c\d{1,3}$/i.test(lower)) return true
  if (/^crit/i.test(lower)) return true
  if (/^r\d{1,3}$/i.test(lower)) return true
  if (/criterio|indicador|dimensi[oó]n|r[uú]brica/i.test(lower)) return true
  return false
}

function detectExplicitMultiOpenQuestions(
  pautaEstructurada: string | null | undefined,
  puntajeTotal: number,
): { detected: boolean; reason: string } {
  const rows = parsePautaRowsForEvidencePlan(pautaEstructurada)
  const devRows = rows.filter((r) => r.isDevelopment)
  if (devRows.length < 2) {
    return { detected: false, reason: "fewer_than_two_development_slots_in_pauta" }
  }

  const questionLike = devRows.filter((r) => isExplicitDevelopmentQuestionId(r.id))
  if (questionLike.length < 2) {
    return { detected: false, reason: "development_slots_not_explicit_questions" }
  }

  const criterionLikeCount = devRows.filter((r) => looksLikeRubricCriterionSlot(r.id)).length
  if (criterionLikeCount > 0 && criterionLikeCount >= devRows.length - 1) {
    return { detected: false, reason: "development_slots_look_like_rubric_criteria" }
  }

  const sumMax = questionLike.reduce((sum, row) => sum + row.maxScore, 0)
  if (sumMax !== puntajeTotal) {
    return { detected: false, reason: "question_max_scores_do_not_sum_to_puntaje_total" }
  }

  return { detected: true, reason: "explicit_multi_question_pauta_sums_to_total" }
}

function isArtesArea(areaConocimiento: string | null | undefined): boolean {
  return String(areaConocimiento ?? "").trim().toLowerCase() === "artes"
}

/**
 * Decide cuántas evidencias pedagógicas reales se evalúan antes de aplicar rúbrica y puntaje.
 * Conservador: ante duda, GLOBAL_MECHANICAL con una sola evidencia.
 */
export function resolvePedagogicalEvidenceUnitPlan(
  input: ResolvePedagogicalEvidenceUnitPlanInput,
): PedagogicalEvidenceUnitPlan {
  const { tipoPruebaReal, areaConocimiento, pautaEstructurada, puntajeTotal } = input

  if (tipoPruebaReal !== "solo_desarrollo") {
    return {
      applies: false,
      mode: "NOT_APPLICABLE",
      scoringMode: "MULTI_ITEM_EXISTING",
      allowOmr: true,
      reason: "not_solo_desarrollo",
    }
  }

  const multiOpen = detectExplicitMultiOpenQuestions(pautaEstructurada, puntajeTotal)
  if (multiOpen.detected) {
    return {
      applies: true,
      mode: "MULTIPLE_OPEN_EVIDENCES",
      scoringMode: "MULTI_ITEM_EXISTING",
      allowOmr: false,
      reason: multiOpen.reason,
    }
  }

  if (isArtesArea(areaConocimiento)) {
    return {
      applies: true,
      mode: "SINGLE_EVIDENCE_VISUAL",
      scoringMode: "GLOBAL_MECHANICAL",
      allowOmr: false,
      reason: "solo_desarrollo_artes",
    }
  }

  return {
    applies: true,
    mode: "SINGLE_EVIDENCE_TEXT",
    scoringMode: "GLOBAL_MECHANICAL",
    allowOmr: false,
    reason: "default_single_open_evidence",
  }
}

const MECHANICAL_ACHIEVEMENT_LEVELS = [
  "LOGRADO",
  "PARCIALMENTE_LOGRADO",
  "INSUFICIENTE",
  "NO_OBSERVABLE",
] as const

export type AchievementLevel = (typeof MECHANICAL_ACHIEVEMENT_LEVELS)[number]

export type MechanicalRubricCriterion = {
  criterio_id: string
  criterio_label: string
  max_points: number
  level: AchievementLevel
  evidence: string
  justification: string
}

export type MechanicalDevelopmentScore = {
  total_obtained: number
  total_max: number
  criteria: MechanicalRubricCriterion[]
  generated_puntaje: string
  reason: string
  confidence: "HIGH" | "MEDIUM" | "LOW"
}

/**
 * Instrucciones de prompt según el plan (solo cuando plan.applies === true).
 * Sprint 31: delega al núcleo común (misma redacción; sin cambio funcional).
 */
export function buildPedagogicalEvidencePromptInstruction(
  plan: PedagogicalEvidenceUnitPlan,
  puntajeTotal: number,
): string {
  return buildDevelopmentCriteriaPromptInstruction({
    applies: plan.applies,
    mode: plan.mode,
    puntajeTotal,
  })
}

/**
 * Ejemplo JSON de respuestas_desarrollo para prompts solo_desarrollo (sin puntaje IA).
 * Sprint 31: delega al núcleo común (misma redacción; sin cambio funcional).
 */
export function buildSoloDesarrolloRespuestasDesarrolloJsonExample(
  plan: PedagogicalEvidenceUnitPlan,
): string {
  return buildDevelopmentCriteriaRespuestasDesarrolloJsonExample({
    applies: plan.applies,
    mode: plan.mode,
  })
}

export type ApplyPedagogicalEvidencePlanInput = {
  respuestasDesarrollo: Record<string, unknown>
  plan: PedagogicalEvidenceUnitPlan
  puntajeTotal: number
}

export type PedagogicalEvidencePlanApplicationAudit = {
  applied: boolean
  mode: PedagogicalEvidenceUnitMode
  keptKeys: string[]
  droppedKeys: string[]
  reason: string
  puntajeTotal: number
  beforeCount: number
  afterCount: number
  sumBefore: number
  sumAfter: number
}

export type ApplyPedagogicalEvidencePlanResult = {
  respuestasDesarrollo: Record<string, unknown>
  audit?: PedagogicalEvidencePlanApplicationAudit
}

type ParsedDevelopmentScoreItem = {
  key: string
  item: Record<string, unknown>
  scoreObtained: number
  scoreMax: number
  stableIndex: number
}

type RankedGlobalScoringCandidate = ParsedDevelopmentScoreItem & {
  usefulEvidenceLength: number
  ilegibleCount: number
  justificacionLength: number
}

function usefulEvidenceLengthForRanking(item: Record<string, unknown>): number {
  const ev = buildNormalizedDevelopmentEvidence(item)
  if (ev) return ev.usefulCharCount
  const raw = extractDevelopmentEvidenceRawText(item)
  return raw ? raw.trim().replace(/\s+/g, " ").length : 0
}

function compareGlobalScoringCandidateRank(
  a: RankedGlobalScoringCandidate,
  b: RankedGlobalScoringCandidate,
): number {
  if (b.scoreMax !== a.scoreMax) return b.scoreMax - a.scoreMax
  if (b.usefulEvidenceLength !== a.usefulEvidenceLength) return b.usefulEvidenceLength - a.usefulEvidenceLength
  if (a.ilegibleCount !== b.ilegibleCount) return a.ilegibleCount - b.ilegibleCount
  return a.stableIndex - b.stableIndex
}

function pickBestGlobalScoringCandidate(
  candidates: RankedGlobalScoringCandidate[],
): RankedGlobalScoringCandidate {
  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    if (compareGlobalScoringCandidateRank(candidates[i], best) < 0) best = candidates[i]
  }
  return best
}

function sumParsedDevelopmentScores(items: ParsedDevelopmentScoreItem[]): {
  sumObtained: number
  sumMax: number
} {
  let sumObtained = 0
  let sumMax = 0
  for (const it of items) {
    sumObtained += it.scoreObtained
    sumMax += it.scoreMax
  }
  return { sumObtained, sumMax }
}

function toRankedGlobalCandidate(p: ParsedDevelopmentScoreItem): RankedGlobalScoringCandidate {
  return {
    ...p,
    usefulEvidenceLength: usefulEvidenceLengthForRanking(p.item),
    ilegibleCount: countIlegibleMarkersInRaw(extractDevelopmentEvidenceRawText(p.item) ?? ""),
    justificacionLength: usefulJustificacionLength(p.item),
  }
}

function logPedagogicalEvidenceGlobalEnforced(audit: PedagogicalEvidencePlanApplicationAudit): void {
  console.info("[evaluate][pedagogical-evidence] global evidence enforced", {
    mode: audit.mode,
    keptKeys: audit.keptKeys,
    droppedKeys: audit.droppedKeys,
    puntajeTotal: audit.puntajeTotal,
    beforeCount: audit.beforeCount,
    afterCount: audit.afterCount,
    sumBefore: audit.sumBefore,
    sumAfter: audit.sumAfter,
  })
}

/**
 * Evita que varias granularidades se sumen en GLOBAL_MECHANICAL: conserva una sola entrada principal.
 */
export function applyPedagogicalEvidencePlanToDevelopmentAnswers(
  input: ApplyPedagogicalEvidencePlanInput,
): ApplyPedagogicalEvidencePlanResult {
  const { respuestasDesarrollo, plan, puntajeTotal } = input

  if (!plan.applies) {
    return { respuestasDesarrollo }
  }

  if (plan.scoringMode !== "GLOBAL_MECHANICAL") {
    return { respuestasDesarrollo }
  }

  if (!respuestasDesarrollo || typeof respuestasDesarrollo !== "object") {
    return { respuestasDesarrollo: {} }
  }

  const entries = Object.entries(respuestasDesarrollo).filter(
    ([, val]) => val != null && typeof val === "object",
  )

  if (entries.length <= 1) {
    return { respuestasDesarrollo }
  }

  const parsed: ParsedDevelopmentScoreItem[] = entries.map(([key, val], idx) => {
    const item = val as Record<string, unknown>
    const scores = parseDesarrolloPuntajeScores(item.puntaje)
    return {
      key,
      item,
      scoreObtained: scores.obtained,
      scoreMax: scores.max,
      stableIndex: idx,
    }
  })

  const { sumObtained: sumObtainedBefore } = sumParsedDevelopmentScores(parsed)

  const globalCandidates = parsed.filter((p) => p.scoreMax === puntajeTotal)
  let kept: ParsedDevelopmentScoreItem
  let reason: string

  if (globalCandidates.length > 0) {
    if (globalCandidates.length === 1) {
      kept = globalCandidates[0]
      reason =
        globalCandidates.length < parsed.length
          ? "single_global_max_equals_total"
          : "only_global_entry"
    } else {
      const ranked = globalCandidates.map(toRankedGlobalCandidate)
      kept = pickBestGlobalScoringCandidate(ranked)
      reason = "best_among_multiple_global_max_equals_total"
    }
  } else {
    const maxScore = Math.max(...parsed.map((p) => p.scoreMax))
    const topByMax = parsed.filter((p) => p.scoreMax === maxScore)
    if (topByMax.length === 1) {
      kept = topByMax[0]
      reason = "highest_score_max_no_global_candidate"
    } else {
      const ranked = topByMax.map(toRankedGlobalCandidate)
      kept = pickBestGlobalScoringCandidate(ranked)
      reason = "tie_on_score_max_best_evidence"
    }
  }

  const droppedKeys = parsed.filter((p) => p.key !== kept.key).map((p) => p.key)
  if (droppedKeys.length === 0) {
    return { respuestasDesarrollo }
  }

  const out: Record<string, unknown> = { [kept.key]: kept.item }
  const { sumObtained: sumObtainedAfter } = sumParsedDevelopmentScores([kept])

  const audit: PedagogicalEvidencePlanApplicationAudit = {
    applied: true,
    mode: plan.mode,
    keptKeys: [kept.key],
    droppedKeys,
    reason,
    puntajeTotal,
    beforeCount: parsed.length,
    afterCount: 1,
    sumBefore: sumObtainedBefore,
    sumAfter: sumObtainedAfter,
  }

  logPedagogicalEvidenceGlobalEnforced(audit)

  return {
    respuestasDesarrollo: orderCanonicalDesarrolloRecord(out),
    audit,
  }
}

export type ReconcileSoloDesarrolloScoringGranularityInput = {
  respuestasDesarrollo: Record<string, unknown>
  tipoPruebaReal: string
  puntajeTotal: number
  pautaEstructurada?: string | null
}

/**
 * Reconcilia granularidad de puntaje en solo_desarrollo cuando coexisten criterios parciales
 * (p. ej. 4/5) y una evaluación global (p. ej. 15/20). Evita doble conteo antes de scoring.
 */
export function reconcileSoloDesarrolloScoringGranularity(
  input: ReconcileSoloDesarrolloScoringGranularityInput,
): Record<string, unknown> {
  const { respuestasDesarrollo, tipoPruebaReal, puntajeTotal } = input

  if (tipoPruebaReal !== "solo_desarrollo") {
    return respuestasDesarrollo
  }

  if (!respuestasDesarrollo || typeof respuestasDesarrollo !== "object") {
    return {}
  }

  const entries = Object.entries(respuestasDesarrollo).filter(
    ([, val]) => val != null && typeof val === "object",
  )

  if (entries.length <= 1) {
    return respuestasDesarrollo
  }

  const parsed: ParsedDevelopmentScoreItem[] = entries.map(([key, val], idx) => {
    const item = val as Record<string, unknown>
    const scores = parseDesarrolloPuntajeScores(item.puntaje)
    return {
      key,
      item,
      scoreObtained: scores.obtained,
      scoreMax: scores.max,
      stableIndex: idx,
    }
  })

  const { sumObtained: sumObtainedBefore, sumMax: sumMaxBefore } = sumParsedDevelopmentScores(parsed)

  if (sumObtainedBefore <= puntajeTotal && sumMaxBefore <= puntajeTotal) {
    return respuestasDesarrollo
  }

  const globalCandidates = parsed.filter((p) => p.scoreMax === puntajeTotal)
  const partialCandidates = parsed.filter((p) => p.scoreMax < puntajeTotal)

  if (globalCandidates.length === 0) {
    console.warn("[evaluate][development] scoring granularity warning", {
      reason: "overscored_without_global_candidate",
      puntajeTotal,
      sumObtainedBefore,
      sumMaxBefore,
      itemCount: parsed.length,
    })
    return respuestasDesarrollo
  }

  let keptKey: string
  let reason: string

  if (globalCandidates.length === 1 && partialCandidates.length > 0) {
    keptKey = globalCandidates[0].key
    reason = "single_global_with_partial_criteria"
  } else if (globalCandidates.length > 1) {
    const ranked = globalCandidates.map(toRankedGlobalCandidate)
    keptKey = pickBestGlobalScoringCandidate(ranked).key
    reason = "multiple_global_candidates"
  } else {
    console.warn("[evaluate][development] scoring granularity warning", {
      reason: "overscored_without_partial_criteria_to_drop",
      puntajeTotal,
      sumObtainedBefore,
      sumMaxBefore,
      globalCandidateCount: globalCandidates.length,
      partialCandidateCount: partialCandidates.length,
    })
    return respuestasDesarrollo
  }

  const droppedKeys = parsed.filter((p) => p.key !== keptKey).map((p) => p.key)
  if (droppedKeys.length === 0) {
    return respuestasDesarrollo
  }

  const out: Record<string, unknown> = {}
  for (const p of parsed) {
    if (p.key === keptKey) out[p.key] = p.item
  }

  const keptOnly = parsed.filter((p) => p.key === keptKey)
  const { sumObtained: sumObtainedAfter, sumMax: sumMaxAfter } = sumParsedDevelopmentScores(keptOnly)

  console.info("[evaluate][development] reconciled global-vs-criteria scoring granularity", {
    keptKeys: [keptKey],
    droppedKeys,
    reason,
    puntajeTotal,
    sumObtainedBefore,
    sumMaxBefore,
    sumObtainedAfter,
    sumMaxAfter,
  })

  return orderCanonicalDesarrolloRecord(out)
}

// ---------------------------------------------------------------------------
// Scoring mecánico controlado (solo_desarrollo + GLOBAL_MECHANICAL)
// IA interpreta — LibelIA calcula
// ---------------------------------------------------------------------------

const LEVEL_TO_FRACTION: Record<AchievementLevel, number> = {
  LOGRADO: 1,
  PARCIALMENTE_LOGRADO: 0.6,
  INSUFICIENTE: 0.25,
  NO_OBSERVABLE: 0,
}

type CriterioEvaluadoRaw = {
  criterio_id?: unknown
  criterio_label?: unknown
  nivel_logro?: unknown
  evidencia?: unknown
  justificacion?: unknown
}

export type CalculateMechanicalDevelopmentScoreInput = {
  criteriosEvaluados?: unknown
  respuestasDesarrollo?: Record<string, unknown>
  rubrica?: string | null
  pautaEstructurada?: string | null
  puntajeTotal: number
  plan: PedagogicalEvidenceUnitPlan
}

export type CalculateMechanicalDevelopmentScoreResult = {
  ok: boolean
  puntaje: string
  totalObtained: number
  totalMax: number
  criteria: MechanicalRubricCriterion[]
  reason: string
  confidence: "HIGH" | "MEDIUM" | "LOW"
}

export type ApplyMechanicalDevelopmentScoreInput = {
  respuestasDesarrollo: Record<string, unknown>
  rubrica?: string | null
  pautaEstructurada?: string | null
  puntajeTotal: number
  plan: PedagogicalEvidenceUnitPlan
}

export type ApplyMechanicalDevelopmentScoreResult = {
  respuestasDesarrollo: Record<string, unknown>
  applied: boolean
  score?: CalculateMechanicalDevelopmentScoreResult
}

function roundMechanicalPoints(value: number): number {
  return Math.round(value)
}

function clampMechanicalTotal(value: number, puntajeTotal: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(roundMechanicalPoints(value), puntajeTotal)
}

function formatMechanicalPuntaje(obtained: number, max: number): string {
  return `${clampMechanicalTotal(obtained, max)}/${max}`
}

function normalizeAchievementLevel(raw: unknown): { level: AchievementLevel; normalized: boolean } {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/Á/g, "A")
    .replace(/É/g, "E")
    .replace(/Í/g, "I")
    .replace(/Ó/g, "O")
    .replace(/Ú/g, "U")

  if (s === "LOGRADO" || s === "LO_LOGRO" || s === "COMPLETO") {
    return { level: "LOGRADO", normalized: s !== "LOGRADO" }
  }
  if (
    s === "PARCIALMENTE_LOGRADO" ||
    s === "PARCIAL" ||
    s === "EN_DESARROLLO" ||
    s === "MEDIO"
  ) {
    return { level: "PARCIALMENTE_LOGRADO", normalized: s !== "PARCIALMENTE_LOGRADO" }
  }
  if (s === "INSUFICIENTE" || s === "NO_LOGRADO" || s === "BAJO") {
    return { level: "INSUFICIENTE", normalized: s !== "INSUFICIENTE" }
  }
  if (
    s === "NO_OBSERVABLE" ||
    s === "NO_EVIDENCIA" ||
    s === "SIN_EVIDENCIA" ||
    s === "NO_APLICA"
  ) {
    return { level: "NO_OBSERVABLE", normalized: s !== "NO_OBSERVABLE" }
  }

  return { level: "PARCIALMENTE_LOGRADO", normalized: true }
}

function isCriterioEvaluadoArray(value: unknown): value is CriterioEvaluadoRaw[] {
  return Array.isArray(value) && value.length > 0
}

function collectCriteriosEvaluadosFromDesarrollo(
  respuestasDesarrollo: Record<string, unknown> | undefined,
): CriterioEvaluadoRaw[] {
  if (!respuestasDesarrollo || typeof respuestasDesarrollo !== "object") return []

  const merged: CriterioEvaluadoRaw[] = []
  const seenIds = new Set<string>()

  for (const val of Object.values(respuestasDesarrollo)) {
    if (!val || typeof val !== "object") continue
    const item = val as Record<string, unknown>
    const rawList = item.criterios_evaluados
    if (!isCriterioEvaluadoArray(rawList)) continue

    for (const c of rawList) {
      if (!c || typeof c !== "object") continue
      const id = String(c.criterio_id ?? c.criterio_label ?? "").trim()
      const dedupeKey = id.toLowerCase() || `idx_${merged.length}`
      if (seenIds.has(dedupeKey)) continue
      seenIds.add(dedupeKey)
      merged.push(c)
    }
  }

  return merged
}

type RubricMaxSlot = { id: string; label: string; maxScore: number }

function parseRubricMaxSlotsFromPauta(pautaEstructurada: string | null | undefined): RubricMaxSlot[] {
  const rows = parsePautaRowsForEvidencePlan(pautaEstructurada)
  const slots: RubricMaxSlot[] = []

  for (const row of rows) {
    if (!looksLikeRubricCriterionSlot(row.id) && !row.isDevelopment) continue
    if (isExplicitDevelopmentQuestionId(row.id) && !looksLikeRubricCriterionSlot(row.id)) continue
    slots.push({ id: row.id, label: row.id, maxScore: row.maxScore })
  }

  if (slots.length > 0) return slots

  const devRows = rows.filter((r) => r.isDevelopment)
  if (devRows.length >= 2 && devRows.every((r) => looksLikeRubricCriterionSlot(r.id))) {
    return devRows.map((r) => ({ id: r.id, label: r.id, maxScore: r.maxScore }))
  }

  return []
}

function parseRubricMaxSlotsFromRubricText(rubrica: string | null | undefined): RubricMaxSlot[] {
  const text = String(rubrica ?? "").trim()
  if (!text) return []

  const slots: RubricMaxSlot[] = []
  const linePattern =
    /(?:criterio|indicador|dimensi[oó]n|aspecto)\s*(\d{1,2})[^\d]{0,80}?(\d{1,3})\s*(?:pts?|puntos|pt\.?)/gi

  let match: RegExpExecArray | null
  while ((match = linePattern.exec(text)) !== null) {
    const n = Number.parseInt(match[1], 10)
    const max = Number.parseInt(match[2], 10)
    if (!Number.isFinite(n) || !Number.isFinite(max) || max <= 0) continue
    slots.push({ id: `C${n}`, label: `Criterio ${n}`, maxScore: max })
  }

  if (slots.length >= 2) return slots

  const maxOnlyPattern = /(\d{1,3})\s*(?:pts?|puntos|pt\.?)/gi
  const maxes: number[] = []
  while ((match = maxOnlyPattern.exec(text)) !== null) {
    const max = Number.parseInt(match[1], 10)
    if (Number.isFinite(max) && max > 0) maxes.push(max)
  }

  if (maxes.length >= 2 && maxes.length <= 12) {
    return maxes.map((maxScore, idx) => ({
      id: `C${idx + 1}`,
      label: `Criterio ${idx + 1}`,
      maxScore,
    }))
  }

  return []
}

function normalizeMaxSlotsToTotal(slots: RubricMaxSlot[], puntajeTotal: number): RubricMaxSlot[] {
  if (slots.length === 0) return []
  const sum = slots.reduce((acc, s) => acc + s.maxScore, 0)
  if (sum <= 0) return []
  if (sum === puntajeTotal) return slots

  if (sum > puntajeTotal) {
    const factor = puntajeTotal / sum
    return slots.map((s) => ({
      ...s,
      maxScore: roundMechanicalPoints(s.maxScore * factor),
    }))
  }

  return slots
}

function assignMaxPointsToCriteria(
  rawCriteria: CriterioEvaluadoRaw[],
  pautaEstructurada: string | null | undefined,
  rubrica: string | null | undefined,
  puntajeTotal: number,
): RubricMaxSlot[] {
  const fromPauta = normalizeMaxSlotsToTotal(parseRubricMaxSlotsFromPauta(pautaEstructurada), puntajeTotal)
  if (fromPauta.length > 0) {
    return rawCriteria.map((c, idx) => {
      const id = String(c.criterio_id ?? "").trim()
      const label = String(c.criterio_label ?? id ?? `Criterio ${idx + 1}`).trim()
      const match =
        fromPauta.find((s) => s.id.toLowerCase() === id.toLowerCase()) ??
        fromPauta.find((s) => s.label.toLowerCase() === label.toLowerCase()) ??
        fromPauta[idx]
      return {
        id: id || match?.id || `C${idx + 1}`,
        label: label || match?.label || `Criterio ${idx + 1}`,
        maxScore: match?.maxScore ?? roundMechanicalPoints(puntajeTotal / rawCriteria.length),
      }
    })
  }

  const fromRubric = normalizeMaxSlotsToTotal(parseRubricMaxSlotsFromRubricText(rubrica), puntajeTotal)
  if (fromRubric.length > 0) {
    return rawCriteria.map((c, idx) => {
      const id = String(c.criterio_id ?? "").trim()
      const label = String(c.criterio_label ?? id ?? `Criterio ${idx + 1}`).trim()
      const match =
        fromRubric.find((s) => s.id.toLowerCase() === id.toLowerCase()) ??
        fromRubric[idx]
      return {
        id: id || match?.id || `C${idx + 1}`,
        label: label || match?.label || `Criterio ${idx + 1}`,
        maxScore: match?.maxScore ?? roundMechanicalPoints(puntajeTotal / rawCriteria.length),
      }
    })
  }

  const equalMax = roundMechanicalPoints(puntajeTotal / rawCriteria.length)
  return rawCriteria.map((c, idx) => ({
    id: String(c.criterio_id ?? `C${idx + 1}`).trim() || `C${idx + 1}`,
    label: String(c.criterio_label ?? `Criterio ${idx + 1}`).trim() || `Criterio ${idx + 1}`,
    maxScore: equalMax,
  }))
}

function buildMechanicalCriteriaFromEvaluated(
  rawCriteria: CriterioEvaluadoRaw[],
  slots: RubricMaxSlot[],
): MechanicalRubricCriterion[] {
  return rawCriteria.map((c, idx) => {
    const slot = slots[idx]
    const { level } = normalizeAchievementLevel(c.nivel_logro)
    return {
      criterio_id: slot?.id ?? (String(c.criterio_id ?? `C${idx + 1}`).trim() || `C${idx + 1}`),
      criterio_label: slot?.label ?? (String(c.criterio_label ?? `Criterio ${idx + 1}`).trim() || `Criterio ${idx + 1}`),
      max_points: slot?.maxScore ?? 0,
      level,
      evidence: String(c.evidencia ?? "").trim(),
      justification: String(c.justificacion ?? "").trim(),
    }
  })
}

function sumMechanicalCriteria(criteria: MechanicalRubricCriterion[]): number {
  let total = 0
  for (const c of criteria) {
    const fraction = LEVEL_TO_FRACTION[c.level] ?? 0
    total += c.max_points * fraction
  }
  return total
}

function pickBestScoredDevelopmentEntry(
  respuestasDesarrollo: Record<string, unknown>,
  puntajeTotal: number,
): { key: string; item: Record<string, unknown>; scoreObtained: number; scoreMax: number } | null {
  const ordered = orderCanonicalDesarrolloRecord(respuestasDesarrollo)
  const entries = Object.entries(ordered).filter(([, val]) => val != null && typeof val === "object")
  if (entries.length === 0) return null

  const parseable: RankedGlobalScoringCandidate[] = []
  for (let idx = 0; idx < entries.length; idx++) {
    const [key, val] = entries[idx]
    const item = val as Record<string, unknown>
    const scores = parseDesarrolloPuntajeScores(item.puntaje)
    if (scores.max <= 0 || scores.obtained < 0) continue
    parseable.push(
      toRankedGlobalCandidate({
        key,
        item,
        scoreObtained: scores.obtained,
        scoreMax: scores.max,
        stableIndex: idx,
      }),
    )
  }

  if (parseable.length === 0) return null

  const globalMax = parseable.filter((p) => p.scoreMax === puntajeTotal)
  const pool = globalMax.length > 0 ? globalMax : parseable
  const best = pickBestGlobalScoringCandidate(pool)
  return {
    key: best.key,
    item: best.item,
    scoreObtained: best.scoreObtained,
    scoreMax: best.scoreMax,
  }
}

function pickPrimaryDevelopmentEntry(
  respuestasDesarrollo: Record<string, unknown>,
  puntajeTotal: number,
): { key: string; item: Record<string, unknown> } | null {
  const scored = pickBestScoredDevelopmentEntry(respuestasDesarrollo, puntajeTotal)
  if (scored) {
    return { key: scored.key, item: scored.item }
  }

  const ordered = orderCanonicalDesarrolloRecord(respuestasDesarrollo)
  const entries = Object.entries(ordered).filter(([, val]) => val != null && typeof val === "object")
  if (entries.length === 0) return null

  const ranked = entries.map(([key, val], idx) =>
    toRankedGlobalCandidate({
      key,
      item: val as Record<string, unknown>,
      scoreObtained: 0,
      scoreMax: 0,
      stableIndex: idx,
    }),
  )
  const kept = pickBestGlobalScoringCandidate(ranked)
  return { key: kept.key, item: kept.item }
}

function scaleParsedScoreToPuntajeTotal(
  obtained: number,
  max: number,
  puntajeTotal: number,
): number {
  if (max <= 0 || puntajeTotal <= 0) return 0
  if (max === puntajeTotal) {
    return clampMechanicalTotal(obtained, puntajeTotal)
  }
  return clampMechanicalTotal((obtained / max) * puntajeTotal, puntajeTotal)
}

function mechanicalFallbackFromDesarrollo(
  respuestasDesarrollo: Record<string, unknown> | undefined,
  puntajeTotal: number,
): CalculateMechanicalDevelopmentScoreResult {
  const safeTotal = puntajeTotal > 0 ? puntajeTotal : 1
  const entries = Object.entries(respuestasDesarrollo ?? {}).filter(
    ([, val]) => val != null && typeof val === "object",
  )

  if (entries.length === 0) {
    return {
      ok: false,
      puntaje: formatMechanicalPuntaje(0, safeTotal),
      totalObtained: 0,
      totalMax: safeTotal,
      criteria: [],
      reason: "no_development_entries",
      confidence: "LOW",
    }
  }

  const bestScored = pickBestScoredDevelopmentEntry(respuestasDesarrollo ?? {}, safeTotal)
  if (bestScored) {
    const scaled = scaleParsedScoreToPuntajeTotal(
      bestScored.scoreObtained,
      bestScored.scoreMax,
      safeTotal,
    )
    return {
      ok: scaled > 0 || bestScored.scoreObtained === 0,
      puntaje: formatMechanicalPuntaje(scaled, safeTotal),
      totalObtained: scaled,
      totalMax: safeTotal,
      criteria: [],
      reason: "fallback_scaled_existing_global_score",
      confidence: "MEDIUM",
    }
  }

  return {
    ok: false,
    puntaje: formatMechanicalPuntaje(0, safeTotal),
    totalObtained: 0,
    totalMax: safeTotal,
    criteria: [],
    reason: "fallback_unusable_ia_puntaje",
    confidence: "LOW",
  }
}

/**
 * Convierte niveles de logro por criterio en puntaje mecánico controlado.
 * Solo activo en solo_desarrollo con scoringMode GLOBAL_MECHANICAL.
 */
export function calculateMechanicalDevelopmentScore(
  input: CalculateMechanicalDevelopmentScoreInput,
): CalculateMechanicalDevelopmentScoreResult {
  const { respuestasDesarrollo, rubrica, pautaEstructurada, puntajeTotal, plan } = input

  if (!plan.applies || plan.scoringMode !== "GLOBAL_MECHANICAL") {
    return {
      ok: false,
      puntaje: formatMechanicalPuntaje(0, puntajeTotal),
      totalObtained: 0,
      totalMax: puntajeTotal,
      criteria: [],
      reason: "not_applicable",
      confidence: "LOW",
    }
  }

  const rawFromInput = isCriterioEvaluadoArray(input.criteriosEvaluados)
    ? (input.criteriosEvaluados as CriterioEvaluadoRaw[])
    : []
  const rawFromDesarrollo = collectCriteriosEvaluadosFromDesarrollo(respuestasDesarrollo)
  const rawCriteria = rawFromInput.length > 0 ? rawFromInput : rawFromDesarrollo

  if (rawCriteria.length === 0) {
    const fallback = mechanicalFallbackFromDesarrollo(respuestasDesarrollo, puntajeTotal)
    if (fallback.confidence === "LOW" || fallback.reason.startsWith("fallback_")) {
      console.info("[evaluate][mechanical-development-scoring] fallback", {
        reason: fallback.reason,
        confidence: fallback.confidence,
      })
    }
    return fallback
  }

  const slots = assignMaxPointsToCriteria(rawCriteria, pautaEstructurada, rubrica, puntajeTotal)
  let criteria = buildMechanicalCriteriaFromEvaluated(rawCriteria, slots)

  const slotSum = criteria.reduce((acc, c) => acc + c.max_points, 0)
  if (slotSum > puntajeTotal && slotSum > 0) {
    const factor = puntajeTotal / slotSum
    criteria = criteria.map((c) => ({
      ...c,
      max_points: roundMechanicalPoints(c.max_points * factor),
    }))
  }

  let totalObtained = sumMechanicalCriteria(criteria)
  totalObtained = clampMechanicalTotal(totalObtained, puntajeTotal)

  const hasUnknownLevels = rawCriteria.some((c) => normalizeAchievementLevel(c.nivel_logro).normalized)
  const confidence: "HIGH" | "MEDIUM" | "LOW" =
    criteria.length >= 2 && !hasUnknownLevels ? "HIGH" : criteria.length >= 1 ? "MEDIUM" : "LOW"

  return {
    ok: true,
    puntaje: formatMechanicalPuntaje(totalObtained, puntajeTotal),
    totalObtained,
    totalMax: puntajeTotal,
    criteria,
    reason: "mechanical_from_criterios_evaluados",
    confidence,
  }
}

/**
 * Sobrescribe puntaje de desarrollo con valor mecánico antes de calculateFinalScore.
 */
export function applyMechanicalDevelopmentScoreToAnalysis(
  input: ApplyMechanicalDevelopmentScoreInput,
): ApplyMechanicalDevelopmentScoreResult {
  const { respuestasDesarrollo, rubrica, pautaEstructurada, puntajeTotal, plan } = input

  if (!plan.applies || plan.scoringMode !== "GLOBAL_MECHANICAL") {
    return { respuestasDesarrollo, applied: false }
  }

  if (!respuestasDesarrollo || typeof respuestasDesarrollo !== "object") {
    return { respuestasDesarrollo: {}, applied: false }
  }

  // Sprint 31 — núcleo de criterios (flag off = no-op; shadow no muta oficial).
  const coreWired = applyDevelopmentCriteriaCoreToSoloDesarrolloRecord({
    respuestasDesarrollo,
    rubrica,
    soloDesarrolloApplies: plan.applies === true,
  })
  const respuestasDesarrolloForMechanical = coreWired.respuestasDesarrollo

  const primary = pickPrimaryDevelopmentEntry(respuestasDesarrolloForMechanical, puntajeTotal)
  const scoreResult = calculateMechanicalDevelopmentScore({
    respuestasDesarrollo: respuestasDesarrolloForMechanical,
    rubrica,
    pautaEstructurada,
    puntajeTotal,
    plan,
  })

  if (!primary) {
    console.info("[evaluate][mechanical-development-scoring] fallback", {
      reason: scoreResult.reason,
      confidence: scoreResult.confidence,
    })
    return { respuestasDesarrollo: respuestasDesarrolloForMechanical, applied: false, score: scoreResult }
  }

  const mergedJustificacion =
    typeof primary.item.justificacion === "string" && primary.item.justificacion.trim()
      ? primary.item.justificacion.trim()
      : scoreResult.criteria
          .map((c) => `${c.criterio_label}: ${c.justification || c.evidence}`.trim())
          .filter(Boolean)
          .join(" ")

  const criteriosEvaluadosOut =
    scoreResult.criteria.length > 0
      ? scoreResult.criteria.map((c) => ({
          criterio_id: c.criterio_id,
          criterio_label: c.criterio_label,
          nivel_logro: c.level,
          evidencia: c.evidence,
          justificacion: c.justification,
        }))
      : primary.item.criterios_evaluados

  const outItem: Record<string, unknown> = {
    ...primary.item,
    texto_estudiante:
      primary.item.texto_estudiante ??
      primary.item.cita_estudiante ??
      "",
    cita_estudiante:
      primary.item.cita_estudiante ??
      primary.item.texto_estudiante ??
      "",
    justificacion: mergedJustificacion,
    puntaje: scoreResult.puntaje,
    criterios_evaluados: criteriosEvaluadosOut,
  }

  const out: Record<string, unknown> = { [primary.key]: outItem }

  if (scoreResult.confidence === "LOW" || scoreResult.reason.startsWith("fallback_")) {
    console.info("[evaluate][mechanical-development-scoring] fallback", {
      reason: scoreResult.reason,
      confidence: scoreResult.confidence,
    })
  } else {
    console.info("[evaluate][mechanical-development-scoring] applied", {
      totalObtained: scoreResult.totalObtained,
      totalMax: scoreResult.totalMax,
      criteriaCount: scoreResult.criteria.length,
      confidence: scoreResult.confidence,
      reason: scoreResult.reason,
    })
  }

  return {
    respuestasDesarrollo: orderCanonicalDesarrolloRecord(out),
    applied: true,
    score: scoreResult,
  }
}

// ---------------------------------------------------------------------------
// Invariantes finales solo_desarrollo — última barrera antes de calculateFinalScore
// ---------------------------------------------------------------------------

export type EnforceSoloDesarrolloFinalInvariantsInput = {
  tipoPruebaReal: string
  respuestasCerradas: Array<{ pregunta: string; respuesta_detectada: string; confianza?: number }>
  respuestasDesarrollo: Record<string, unknown>
  plan: PedagogicalEvidenceUnitPlan
  rubrica?: string | null
  pautaEstructurada?: string | null
  puntajeTotal: number
}

export type SoloDesarrolloFinalInvariantsAudit = {
  enforced: boolean
  respuestasCerradasCleared: boolean
  developmentKeysBefore: number
  developmentKeysAfter: number
  sumObtainedBefore: number
  sumObtainedAfter: number
  droppedDevelopmentKeys: string[]
  mechanicalScoreApplied: boolean
  singleEntryEnforced: boolean
  reason: string
}

function isArtificialClosedDevelopmentKey(rawKey: string): boolean {
  const k = String(rawKey ?? "").trim()
  if (!k) return true
  if (CERRADA_PREFIX.test(k)) return true
  return looksLikeRubricCriterionSlot(k)
}

function looksLikePartialCriterionBreakdownKey(rawKey: string): boolean {
  const k = String(rawKey ?? "").trim()
  if (!k) return false
  if (tryCanonicalDevelopmentItemKey(k)) return false
  if (/^p\s*\d+\s+/i.test(k)) return true
  if (/^pregunta\s*\d+\s+/i.test(k)) return true
  return /estructura|contenido|reflexi[oó]n|coherencia|dimensi[oó]n|indicador|criterio|r[uú]brica/i.test(k)
}

/** Llave canónica pura P{n} sin sufijos analíticos (P1, P2, …). */
function isPureCanonicalDevelopmentKey(key: string): boolean {
  return /^P\d{1,3}$/i.test(String(key ?? "").trim())
}

/** Llave analítica extendida de la IA (P1_Estructura, P2_Contenido, etc.). */
function isExtendedAnalyticalDevelopmentKey(key: string): boolean {
  const k = String(key ?? "").trim()
  if (!k || isPureCanonicalDevelopmentKey(k)) return false
  if (/^P\d{1,3}[_\-\s]/i.test(k)) return true
  if (k.includes("_")) return true
  return looksLikePartialCriterionBreakdownKey(k)
}

/** Llaves basura autogeneradas que no deben sumar en desarrollo puro. */
function isGarbageTopLevelDevelopmentKey(key: string): boolean {
  const k = String(key ?? "").trim()
  if (!k) return true
  const upper = k.toUpperCase()
  if (upper === "BLANK" || upper === "EMPTY" || upper === "N/A" || upper === "NULL") return true
  return isArtificialClosedDevelopmentKey(k)
}

function countDevelopmentEntries(respuestasDesarrollo: Record<string, unknown>): number {
  return Object.values(respuestasDesarrollo).filter((val) => val != null && typeof val === "object").length
}

function sumDevelopmentObtained(respuestasDesarrollo: Record<string, unknown>): number {
  const parsed: ParsedDevelopmentScoreItem[] = Object.entries(respuestasDesarrollo)
    .filter(([, val]) => val != null && typeof val === "object")
    .map(([key, val], idx) => {
      const item = val as Record<string, unknown>
      const scores = parseDesarrolloPuntajeScores(item.puntaje)
      return {
        key,
        item,
        scoreObtained: scores.obtained,
        scoreMax: scores.max,
        stableIndex: idx,
      }
    })
  return sumParsedDevelopmentScores(parsed).sumObtained
}

function sumCanonicalPureDevelopmentObtained(respuestasDesarrollo: Record<string, unknown>): number {
  let sum = 0
  for (const [key, val] of Object.entries(respuestasDesarrollo)) {
    if (!isPureCanonicalDevelopmentKey(key)) continue
    if (val == null || typeof val !== "object") continue
    sum += parseDesarrolloPuntajeScores((val as Record<string, unknown>).puntaje).obtained
  }
  return sum
}

/**
 * Purga llaves basura y sub-ítems analíticos del top-level cuando coexisten con P{n} puros.
 * Antes de descartar sub-llaves analíticas, fusiona criterios_evaluados en la llave canónica P{n}.
 */
function purgeSoloDesarrolloTopLevelRecord(
  rawDev: Record<string, unknown>,
): { cleaned: Record<string, unknown>; droppedKeys: string[] } {
  const droppedKeys: string[] = []
  const intermediate: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(rawDev)) {
    if (val == null || typeof val !== "object") continue
    if (isGarbageTopLevelDevelopmentKey(key)) {
      droppedKeys.push(key)
      continue
    }
    intermediate[key] = val
  }

  const keys = Object.keys(intermediate)
  const hasCanonicalPure = keys.some(isPureCanonicalDevelopmentKey)
  const hasExtendedAnalytical = keys.some(isExtendedAnalyticalDevelopmentKey)

  if (hasCanonicalPure && hasExtendedAnalytical) {
    for (const key of keys) {
      if (!isExtendedAnalyticalDevelopmentKey(key)) continue
      const canonBase = extractCanonicalBaseFromExtendedKey(key)
      if (!canonBase || !isPureCanonicalDevelopmentKey(canonBase)) continue
      const target = intermediate[canonBase]
      const source = intermediate[key]
      if (target && typeof target === "object" && source && typeof source === "object") {
        mergeCriteriosEvaluadosIntoItem(
          target as Record<string, unknown>,
          source as Record<string, unknown>,
        )
      }
    }
  }

  const cleaned: Record<string, unknown> = {}
  for (const key of keys) {
    if (hasCanonicalPure && hasExtendedAnalytical && isExtendedAnalyticalDevelopmentKey(key)) {
      droppedKeys.push(key)
      continue
    }
    cleaned[key] = intermediate[key]
  }

  return { cleaned: orderCanonicalDesarrolloRecord(cleaned), droppedKeys }
}

/** Formato determinista X/Y entero — compatible con parseInt en calculateFinalScore y EvaluatorClient. */
function formatSoloDesarrolloPautaPuntaje(obtained: number, max: number): string {
  const maxInt = Math.round(max)
  const obtInt = Math.max(0, Math.min(Math.round(obtained), maxInt))
  return `${obtInt}/${maxInt}`
}

/** Campos numéricos sueltos que motores ingenuos pueden leer como puntaje top-level. */
const SOLO_DESARROLLO_ITEM_SCORING_KEYS = [
  "score",
  "points",
  "puntaje_obtenido",
  "puntaje_maximo",
  "score_obtained",
  "score_max",
  "total",
  "obtained",
  "max_score",
  "max_points",
] as const

/** Campos de puntuación dentro de criterios_evaluados que provocan doble suma. */
const SOLO_DESARROLLO_CRITERION_SCORING_KEYS = [
  "puntaje",
  "score",
  "points",
  "puntaje_obtenido",
  "puntaje_maximo",
  "max_points",
  "points_obtained",
  "points_max",
  "obtained",
  "max",
] as const

function extractCanonicalBaseFromExtendedKey(key: string): string | null {
  const m = /^P(\d{1,3})/i.exec(String(key ?? "").trim())
  if (!m) return null
  return `P${m[1]}`
}

function mergeCriteriosEvaluadosIntoItem(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  const targetList = isCriterioEvaluadoArray(target.criterios_evaluados)
    ? [...(target.criterios_evaluados as CriterioEvaluadoRaw[])]
    : []
  const sourceList = isCriterioEvaluadoArray(source.criterios_evaluados)
    ? (source.criterios_evaluados as CriterioEvaluadoRaw[])
    : []
  if (sourceList.length === 0) return

  const seenIds = new Set(
    targetList.map((c) => String(c.criterio_id ?? c.criterio_label ?? "").trim().toLowerCase()).filter(Boolean),
  )

  for (const c of sourceList) {
    const id = String(c.criterio_id ?? c.criterio_label ?? "").trim()
    const dedupeKey = id.toLowerCase()
    if (dedupeKey && seenIds.has(dedupeKey)) continue
    if (dedupeKey) seenIds.add(dedupeKey)
    targetList.push(c)
  }

  if (targetList.length > 0) {
    target.criterios_evaluados = targetList
  }
}

/** Elimina campos aritméticos de un criterio; conserva solo señal pedagógica. */
function stripCriterionScoringFields(criterion: CriterioEvaluadoRaw): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(criterion as Record<string, unknown>) }
  for (const key of SOLO_DESARROLLO_CRITERION_SCORING_KEYS) {
    delete out[key]
  }
  out._scoring_authority = "canonical_puntaje"
  return out
}

function numericMatchesAnalytical(value: number, analytical: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(analytical)) return false
  return value === analytical || Math.abs(value - analytical) < 0.01
}

/**
 * Contrato de salida infalible para un ítem P{n}:
 * - puntaje canónico en escala oficial de la pauta docente
 * - propiedades numéricas sueltas alineadas al puntaje escalado
 * - criterios_evaluados sin flags aritméticos independientes (anti-doble suma)
 */
function sealSoloDesarrolloCanonicalItem(
  item: Record<string, unknown>,
  officialObtained: number,
  officialMax: number,
  analyticalObtained: number,
  analyticalMax: number,
): Record<string, unknown> {
  const obtInt = Math.max(0, Math.min(Math.round(officialObtained), Math.round(officialMax)))
  const maxInt = Math.round(officialMax)
  const canonicalPuntaje = formatSoloDesarrolloPautaPuntaje(obtInt, maxInt)

  const sealed: Record<string, unknown> = { ...item, puntaje: canonicalPuntaje }

  for (const key of SOLO_DESARROLLO_ITEM_SCORING_KEYS) {
    const val = sealed[key]
    if (typeof val !== "number" || !Number.isFinite(val)) continue
    if (analyticalMax > 0 && numericMatchesAnalytical(val, analyticalObtained)) {
      sealed[key] = obtInt
    } else if (numericMatchesAnalytical(val, analyticalMax)) {
      sealed[key] = maxInt
    }
  }

  const legacyPuntaje = item.puntaje
  if (legacyPuntaje != null && typeof legacyPuntaje === "object" && !Array.isArray(legacyPuntaje)) {
    sealed.puntaje = canonicalPuntaje
    sealed.puntaje_detalle = {
      ...(legacyPuntaje as Record<string, unknown>),
      total: obtInt,
      max: maxInt,
      _authority: "canonical_puntaje",
    }
  }

  if (isCriterioEvaluadoArray(sealed.criterios_evaluados)) {
    sealed.criterios_evaluados = (sealed.criterios_evaluados as CriterioEvaluadoRaw[]).map(stripCriterionScoringFields)
    sealed._criterios_scoring_sealed = true
  }

  sealed._puntaje_canonico = canonicalPuntaje
  sealed._scoring_sealed = true

  return sealed
}

/** Mapa P{n} → puntaje máximo oficial según pauta estructurada del docente (sin criterios de rúbrica). */
function buildOfficialMaxScoreByCanonicalKey(
  pautaEstructurada: string | null | undefined,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of parsePautaRowsForEvidencePlan(pautaEstructurada)) {
    if (looksLikeRubricCriterionSlot(row.id) && !isExplicitDevelopmentQuestionId(row.id)) {
      continue
    }
    const canon = tryCanonicalDevelopmentItemKey(row.id)
    if (!canon || !isPureCanonicalDevelopmentKey(canon)) continue
    const key = canon.toUpperCase()
    const prev = map.get(key)
    if (prev == null || row.maxScore > prev) {
      map.set(key, row.maxScore)
    }
  }
  return map
}

/**
 * Porcentaje de logro en escala de rúbrica analítica (criterios_evaluados o puntaje x/y).
 * No usa el máximo oficial de la pregunta; solo la escala interna de la evaluación por criterios.
 */
function computeItemRubricAchievement(
  item: Record<string, unknown>,
  rubrica: string | null | undefined,
  pautaEstructurada: string | null | undefined,
  puntajeTotal: number,
): { obtained: number; max: number } {
  const rawCriteria = isCriterioEvaluadoArray(item.criterios_evaluados)
    ? (item.criterios_evaluados as CriterioEvaluadoRaw[])
    : []

  if (rawCriteria.length > 0) {
    const slots = assignMaxPointsToCriteria(rawCriteria, pautaEstructurada, rubrica, puntajeTotal)
    const criteria = buildMechanicalCriteriaFromEvaluated(rawCriteria, slots)
    const rubricMax = criteria.reduce((sum, c) => sum + c.max_points, 0)
    const rubricObtained = sumMechanicalCriteria(criteria)
    if (rubricMax > 0) {
      return { obtained: rubricObtained, max: rubricMax }
    }
  }

  const scores = parseDesarrolloPuntajeScores(item.puntaje)
  return { obtained: scores.obtained, max: scores.max }
}

/**
 * Reescala cada llave canónica P{n} al máximo oficial de la pauta docente,
 * aplicando el porcentaje de logro mecánico de la rúbrica analítica (sin interpretación libre de la IA).
 * Sella el contrato de salida: puntaje, respaldos numéricos y criterios sin doble suma.
 */
function rebalanceSoloDesarrolloScoresWithOfficialPauta(
  respuestasDesarrollo: Record<string, unknown>,
  pautaEstructurada: string | null | undefined,
  rubrica: string | null | undefined,
  puntajeTotal: number,
): { rebalanced: Record<string, unknown>; scoresRescaled: boolean } {
  const officialMaxByKey = buildOfficialMaxScoreByCanonicalKey(pautaEstructurada)
  const pureCanonicalKeys = Object.keys(respuestasDesarrollo).filter(isPureCanonicalDevelopmentKey)
  const singleGlobalEvidence = pureCanonicalKeys.length === 1
  let scoresRescaled = false
  const out: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(respuestasDesarrollo)) {
    if (val == null || typeof val !== "object") {
      continue
    }
    const item = val as Record<string, unknown>

    if (!isPureCanonicalDevelopmentKey(key)) {
      out[key] = item
      continue
    }

    const canonKey = key.trim().toUpperCase()
    let officialMax = officialMaxByKey.get(canonKey)
    if (singleGlobalEvidence) {
      officialMax = puntajeTotal
    } else if (officialMax == null || officialMax <= 0) {
      out[key] = item
      continue
    }

    const rubric = computeItemRubricAchievement(item, rubrica, pautaEstructurada, puntajeTotal)
    const fallbackScores = parseDesarrolloPuntajeScores(item.puntaje)
    const rubricMax = rubric.max > 0 ? rubric.max : fallbackScores.max
    const rubricObtained = rubric.max > 0 ? rubric.obtained : fallbackScores.obtained

    if (rubricMax <= 0) {
      const bestScored = pickBestScoredDevelopmentEntry(respuestasDesarrollo, puntajeTotal)
      if (bestScored) {
        const officialObtained = scaleParsedScoreToPuntajeTotal(
          bestScored.scoreObtained,
          bestScored.scoreMax,
          officialMax,
        )
        const sealed = sealSoloDesarrolloCanonicalItem(
          bestScored.item,
          officialObtained,
          officialMax,
          bestScored.scoreObtained,
          bestScored.scoreMax,
        )
        if (String(item.puntaje ?? "").trim() !== String(sealed.puntaje ?? "").trim()) {
          scoresRescaled = true
        }
        out[key] = sealed
        continue
      }

      const sealed = sealSoloDesarrolloCanonicalItem(item, 0, officialMax, 0, 0)
      if (String(item.puntaje ?? "").trim() !== String(sealed.puntaje ?? "").trim()) {
        scoresRescaled = true
      }
      out[key] = sealed
      continue
    }

    const achievement = Math.max(0, Math.min(1, rubricObtained / rubricMax))
    const officialObtained = achievement * officialMax
    const sealed = sealSoloDesarrolloCanonicalItem(
      item,
      officialObtained,
      officialMax,
      rubricObtained,
      rubricMax,
    )

    if (String(sealed.puntaje ?? "").trim() !== String(item.puntaje ?? "").trim()) {
      scoresRescaled = true
    }

    out[key] = sealed
  }

  return { rebalanced: orderCanonicalDesarrolloRecord(out), scoresRescaled }
}

/** Re-sincroniza respaldos numéricos y criterios tras cualquier ajuste de puntaje (p. ej. clamp). */
function reassertAllCanonicalSoloDesarrolloScoringBackups(
  respuestasDesarrollo: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(respuestasDesarrollo)) {
    if (val == null || typeof val !== "object") continue
    const item = val as Record<string, unknown>

    if (!isPureCanonicalDevelopmentKey(key)) {
      out[key] = item
      continue
    }

    const scores = parseDesarrolloPuntajeScores(item.puntaje)
    if (scores.max <= 0) {
      out[key] = item
      continue
    }

    out[key] = sealSoloDesarrolloCanonicalItem(
      item,
      scores.obtained,
      scores.max,
      scores.obtained,
      scores.max,
    )
  }

  return orderCanonicalDesarrolloRecord(out)
}

function clampDevelopmentRecordTotal(
  respuestasDesarrollo: Record<string, unknown>,
  puntajeTotal: number,
): Record<string, unknown> {
  const entries = Object.entries(respuestasDesarrollo).filter(
    ([, val]) => val != null && typeof val === "object",
  )
  if (entries.length === 0) return respuestasDesarrollo

  const parsed = entries.map(([key, val], idx) => {
    const item = val as Record<string, unknown>
    const scores = parseDesarrolloPuntajeScores(item.puntaje)
    return { key, item, obtained: scores.obtained, max: scores.max, stableIndex: idx }
  })

  const sumObtained = parsed.reduce((s, p) => s + p.obtained, 0)

  if (entries.length === 1) {
    const p = parsed[0]
    const obtained = clampMechanicalTotal(p.obtained, puntajeTotal)
    const max = p.max > 0 ? Math.min(p.max, puntajeTotal) : puntajeTotal
    const normalizedMax = max === puntajeTotal ? puntajeTotal : max
    if (obtained === p.obtained && normalizedMax === p.max) {
      return respuestasDesarrollo
    }
    return {
      [p.key]: sealSoloDesarrolloCanonicalItem(
        p.item,
        obtained,
        normalizedMax,
        p.obtained,
        p.max > 0 ? p.max : puntajeTotal,
      ),
    }
  }

  if (sumObtained <= puntajeTotal) {
    return respuestasDesarrollo
  }

  const factor = puntajeTotal / sumObtained
  const out: Record<string, unknown> = {}
  let allocated = 0
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]
    let newObtained =
      i === parsed.length - 1
        ? puntajeTotal - allocated
        : clampMechanicalTotal(p.obtained * factor, puntajeTotal)
    newObtained = Math.max(0, newObtained)
    allocated += newObtained
    const max = p.max > 0 ? Math.min(p.max, puntajeTotal) : puntajeTotal
    out[p.key] = sealSoloDesarrolloCanonicalItem(
      p.item,
      Math.min(newObtained, max),
      max,
      p.obtained,
      p.max > 0 ? p.max : puntajeTotal,
    )
  }
  return orderCanonicalDesarrolloRecord(out)
}

/**
 * Barrera destructiva de última línea para solo_desarrollo, inmediatamente antes de calculateFinalScore.
 *
 * Pipeline interno (100 % encapsulado, reversible):
 * 1. Guardián de entrada — retorno inmediato si tipoPruebaReal !== "solo_desarrollo"
 * 2. Purga de sub-llaves analíticas (fusiona criterios_evaluados en P{n} antes de descartar)
 * 3. Rebalanceo al máximo oficial de pautaEstructurada vía % logro de rúbrica analítica
 * 4. Clamp defensivo si la suma excede puntajeTotal
 * 5. Re-sellado de respaldos numéricos (score/points) y neutralización de criterios_evaluados
 *
 * No modifica mixta, solo_alternativas ni calculateFinalScore.
 */
export function enforceSoloDesarrolloFinalInvariants(
  input: EnforceSoloDesarrolloFinalInvariantsInput,
): {
  respuestasCerradas: Array<{ pregunta: string; respuesta_detectada: string; confianza?: number }>
  respuestasDesarrollo: Record<string, unknown>
  alternativasCorregidas: []
  audit: SoloDesarrolloFinalInvariantsAudit
} {
  const {
    tipoPruebaReal,
    respuestasCerradas,
    respuestasDesarrollo: rawDev,
    pautaEstructurada,
    rubrica,
    puntajeTotal,
  } = input

  const noopAudit: SoloDesarrolloFinalInvariantsAudit = {
    enforced: false,
    respuestasCerradasCleared: false,
    developmentKeysBefore: 0,
    developmentKeysAfter: 0,
    sumObtainedBefore: 0,
    sumObtainedAfter: 0,
    droppedDevelopmentKeys: [],
    mechanicalScoreApplied: false,
    singleEntryEnforced: false,
    reason: "not_solo_desarrollo",
  }

  if (tipoPruebaReal !== "solo_desarrollo") {
    return {
      respuestasCerradas,
      respuestasDesarrollo: rawDev,
      alternativasCorregidas: [],
      audit: noopAudit,
    }
  }

  const devInput = rawDev ?? {}
  const sumBefore = sumDevelopmentObtained(devInput)
  const keysBefore = countDevelopmentEntries(devInput)

  const purged = purgeSoloDesarrolloTopLevelRecord(devInput)
  let dev = purged.cleaned

  const sumCanonicalBeforeRebalance = sumCanonicalPureDevelopmentObtained(dev)
  const rebalanced = rebalanceSoloDesarrolloScoresWithOfficialPauta(
    dev,
    pautaEstructurada,
    rubrica,
    puntajeTotal,
  )
  dev = rebalanced.rebalanced

  const sumCanonical = sumCanonicalPureDevelopmentObtained(dev)
  if (sumCanonical > puntajeTotal || sumDevelopmentObtained(dev) > puntajeTotal) {
    dev = clampDevelopmentRecordTotal(dev, puntajeTotal)
  }

  // Contrato de salida final: respaldos numéricos y criterios alineados al puntaje canónico sellado.
  dev = reassertAllCanonicalSoloDesarrolloScoringBackups(dev)

  const sumAfter = sumDevelopmentObtained(dev)
  const keysAfter = countDevelopmentEntries(dev)

  const reasons: string[] = []
  if (purged.droppedKeys.length > 0) reasons.push("purged_garbage_and_analytical_subkeys")
  if (rebalanced.scoresRescaled) reasons.push("official_pauta_score_rebalance")
  if (sumCanonicalBeforeRebalance > puntajeTotal && sumAfter <= puntajeTotal) {
    reasons.push("canonical_sum_clamped")
  }
  if (reasons.length === 0) reasons.push("invariants_verified")

  console.info("[evaluate][solo-desarrollo] final invariants enforced", {
    developmentKeysBefore: keysBefore,
    developmentKeysAfter: keysAfter,
    sumObtainedBefore: sumBefore,
    sumObtainedAfter: sumAfter,
    sumCanonicalPureBefore: sumCanonicalBeforeRebalance,
    scoresRescaled: rebalanced.scoresRescaled,
    droppedDevelopmentKeys: purged.droppedKeys,
    reason: reasons.join(";"),
    puntajeTotal,
  })

  return {
    respuestasCerradas: [],
    respuestasDesarrollo: dev,
    alternativasCorregidas: [],
    audit: {
      enforced: true,
      respuestasCerradasCleared: true,
      developmentKeysBefore: keysBefore,
      developmentKeysAfter: keysAfter,
      sumObtainedBefore: sumBefore,
      sumObtainedAfter: sumAfter,
      droppedDevelopmentKeys: purged.droppedKeys,
      mechanicalScoreApplied: rebalanced.scoresRescaled,
      singleEntryEnforced: false,
      reason: reasons.join(";"),
    },
  }
}

// ---------------------------------------------------------------------------
// Reparación mecánico-pedagógica solo_desarrollo — última compuerta antes de calculateFinalScore
// Evita 0/1 (o 0/N con evidencia útil) cuando faltan criterios_evaluados utilizables.
// ---------------------------------------------------------------------------

const SOLO_DESARROLLO_REPAIR_MIN_USEFUL_EVIDENCE_CHARS = 120

const UNIVERSAL_DEVELOPMENT_CRITERIA: Array<{ id: string; label: string }> = [
  { id: "C1", label: "Estructura" },
  { id: "C2", label: "Contenido" },
  { id: "C3", label: "Reflexión / Profundidad" },
  { id: "C4", label: "Coherencia / Redacción" },
]

const REPAIR_POSITIVE_JUSTIFICATION_MARKERS = [
  "estructura clara",
  "desarrolla",
  "contexto",
  "reflexion",
  "reflexión",
  "coherente",
  "cumple",
  "introduccion",
  "introducción",
  "presenta introduccion",
  "presenta introducción",
  "desarrollo",
  "cierre",
  "presenta",
  "logra",
  "demuestra",
  "adecuado",
  "apropiado",
] as const

const REPAIR_STRONG_POSITIVE_JUSTIFICATION_MARKERS = [
  "cumple bien",
  "logrado",
  "completo",
  "excelente",
  "destaca",
  "claramente cumple",
  "muy bien",
  "satisfactoriamente",
] as const

export type RepairSoloDesarrolloMechanicalScoreInput = {
  tipoPruebaReal: string
  combinedAnalysis: { respuestas_desarrollo?: unknown }
  puntajeTotal: number
  rubrica?: string | null
  pautaEstructurada?: string | null
  areaConocimiento?: string | null
}

export type RepairSoloDesarrolloMechanicalScoreResult = {
  combinedAnalysis: { respuestas_desarrollo?: unknown }
  repaired: boolean
  audit?: {
    previousScore: string
    repairedScore: string
    criteriaCount: number
    reason: string
    evidenceLength: number
    puntajeTotal: number
  }
}

function usefulEvidenceCharCountForRepair(item: Record<string, unknown>): number {
  const normalized = buildNormalizedDevelopmentEvidence(item)
  if (normalized) return normalized.usefulCharCount
  const raw = extractDevelopmentEvidenceRawText(item)
  if (!raw) return 0
  return normalizeDevelopmentEvidenceString(raw).replace(/\s/g, "").length
}

function isCriticalZeroSoloDesarrolloPuntaje(puntaje: unknown, puntajeTotal: number): boolean {
  const { obtained, max } = parseDesarrolloPuntajeScores(puntaje)
  if (obtained !== 0) return false
  if (max === 1) return true
  if (max === puntajeTotal) return true
  return max <= 0
}

function extractRecognizableRubricCriterionLabels(
  rubrica: string | null | undefined,
  pautaEstructurada: string | null | undefined,
): Array<{ id: string; label: string }> {
  const fromPauta = parseRubricMaxSlotsFromPauta(pautaEstructurada)
  if (fromPauta.length >= 2) {
    return fromPauta.map((s) => ({ id: s.id, label: s.label }))
  }

  const fromRubricSlots = parseRubricMaxSlotsFromRubricText(rubrica)
  if (fromRubricSlots.length >= 2) {
    return fromRubricSlots.map((s) => ({ id: s.id, label: s.label }))
  }

  const text = String(rubrica ?? "").trim()
  if (text) {
    const labels: Array<{ id: string; label: string }> = []
    const linePattern =
      /(?:criterio|indicador|dimensi[oó]n|aspecto)\s*(\d{1,2})[^\n:]{0,60}[:.\-–]\s*([^\n\d]{3,80})/gi
    let match: RegExpExecArray | null
    while ((match = linePattern.exec(text)) !== null) {
      const n = Number.parseInt(match[1], 10)
      const label = String(match[2] ?? "").trim()
      if (!Number.isFinite(n) || !label) continue
      labels.push({ id: `C${n}`, label })
    }
    if (labels.length >= 2) return labels
  }

  return UNIVERSAL_DEVELOPMENT_CRITERIA
}

function criterionLabelMentionedInJustification(criterionLabel: string, justificacionNorm: string): boolean {
  const labelNorm = normalizeDevelopmentEvidenceString(criterionLabel)
  if (!labelNorm) return false
  if (justificacionNorm.includes(labelNorm)) return true
  const tokens = labelNorm.split(/\s+/).filter((w) => w.length >= 4)
  return tokens.some((t) => justificacionNorm.includes(t))
}

function inferConservativeRepairLevel(
  criterionLabel: string,
  justificacion: string,
  hasUsefulEvidence: boolean,
): AchievementLevel {
  if (!hasUsefulEvidence) return "NO_OBSERVABLE"

  const j = normalizeDevelopmentEvidenceString(justificacion)
  const mentioned = criterionLabelMentionedInJustification(criterionLabel, j)
  const hasStrongPositive = REPAIR_STRONG_POSITIVE_JUSTIFICATION_MARKERS.some((p) =>
    j.includes(normalizeDevelopmentEvidenceString(p)),
  )
  const hasPositive = REPAIR_POSITIVE_JUSTIFICATION_MARKERS.some((p) =>
    j.includes(normalizeDevelopmentEvidenceString(p)),
  )

  if (hasStrongPositive && (mentioned || hasPositive)) return "LOGRADO"
  if (hasPositive || mentioned || hasUsefulEvidence) return "PARCIALMENTE_LOGRADO"
  return "PARCIALMENTE_LOGRADO"
}

function repairCriterioLevelsIfNeeded(
  rawCriteria: CriterioEvaluadoRaw[],
  justificacion: string,
  hasUsefulEvidence: boolean,
): CriterioEvaluadoRaw[] {
  return rawCriteria.map((c) => {
    const label = String(c.criterio_label ?? c.criterio_id ?? "").trim() || "Criterio"
    const { level } = normalizeAchievementLevel(c.nivel_logro)
    if (level !== "NO_OBSERVABLE" && level !== "INSUFICIENTE") {
      return c
    }
    const repairedLevel = inferConservativeRepairLevel(label, justificacion, hasUsefulEvidence)
    return {
      ...c,
      criterio_id: c.criterio_id ?? label,
      criterio_label: c.criterio_label ?? label,
      nivel_logro: repairedLevel,
    }
  })
}

function buildRepairCriteriaFromLabels(
  labels: Array<{ id: string; label: string }>,
  justificacion: string,
  hasUsefulEvidence: boolean,
  puntajeTotal: number,
): MechanicalRubricCriterion[] {
  const count = labels.length > 0 ? labels.length : UNIVERSAL_DEVELOPMENT_CRITERIA.length
  const equalMax = roundMechanicalPoints(puntajeTotal / count)
  const slots = labels.map((l, idx) => ({
    id: l.id || `C${idx + 1}`,
    label: l.label || `Criterio ${idx + 1}`,
    maxScore: equalMax,
  }))
  const normalizedSlots = normalizeMaxSlotsToTotal(slots, puntajeTotal)

  return normalizedSlots.map((slot) => ({
    criterio_id: slot.id,
    criterio_label: slot.label,
    max_points: slot.maxScore,
    level: inferConservativeRepairLevel(slot.label, justificacion, hasUsefulEvidence),
    evidence: "",
    justification: "",
  }))
}

function computeRepairMechanicalScore(
  criteria: MechanicalRubricCriterion[],
  puntajeTotal: number,
  hasUsefulEvidence: boolean,
): { totalObtained: number; puntaje: string; criteria: MechanicalRubricCriterion[] } {
  let working = criteria.map((c) => ({ ...c }))
  if (working.length === 0) {
    working = buildRepairCriteriaFromLabels(UNIVERSAL_DEVELOPMENT_CRITERIA, "", hasUsefulEvidence, puntajeTotal)
  }

  if (hasUsefulEvidence) {
    working = working.map((c) => {
      if (c.level === "NO_OBSERVABLE" || c.level === "INSUFICIENTE") {
        return { ...c, level: "PARCIALMENTE_LOGRADO" as AchievementLevel }
      }
      return c
    })
  }

  let totalObtained = sumMechanicalCriteria(working)
  totalObtained = clampMechanicalTotal(totalObtained, puntajeTotal)

  if (hasUsefulEvidence && totalObtained < 1 && puntajeTotal > 1) {
    const minPerCriterion = roundMechanicalPoints(puntajeTotal / working.length)
    working = working.map((c, idx) =>
      idx === 0
        ? { ...c, level: "PARCIALMENTE_LOGRADO" as AchievementLevel, max_points: Math.max(c.max_points, minPerCriterion) }
        : c,
    )
    totalObtained = Math.max(1, clampMechanicalTotal(sumMechanicalCriteria(working), puntajeTotal))
  }

  return {
    totalObtained,
    puntaje: formatMechanicalPuntaje(totalObtained, puntajeTotal),
    criteria: working,
  }
}

function pickSingleDevelopmentEntryForRepair(
  respuestasDesarrollo: Record<string, unknown>,
): { key: string; item: Record<string, unknown> } | null {
  const entries = Object.entries(respuestasDesarrollo).filter(
    ([, val]) => val != null && typeof val === "object",
  )
  if (entries.length !== 1) return null
  const [key, val] = entries[0]
  return { key, item: val as Record<string, unknown> }
}

/**
 * Repara puntaje 0/1 (o 0/N con evidencia) en solo_desarrollo cuando hay evidencia útil
 * pero no criterios_evaluados utilizables. Solo aplica a tipoPruebaReal === "solo_desarrollo".
 */
export function repairSoloDesarrolloMechanicalScoreIfNeeded(
  input: RepairSoloDesarrolloMechanicalScoreInput,
): RepairSoloDesarrolloMechanicalScoreResult {
  const { tipoPruebaReal, combinedAnalysis, puntajeTotal, rubrica, pautaEstructurada } = input

  if (tipoPruebaReal !== "solo_desarrollo") {
    return { combinedAnalysis, repaired: false }
  }

  const rawDev = combinedAnalysis.respuestas_desarrollo
  if (!rawDev || typeof rawDev !== "object" || Array.isArray(rawDev)) {
    return { combinedAnalysis, repaired: false }
  }

  const respuestasDesarrollo = rawDev as Record<string, unknown>
  const single = pickSingleDevelopmentEntryForRepair(respuestasDesarrollo)
  if (!single) {
    return { combinedAnalysis, repaired: false }
  }

  const { item } = single
  const previousScore = String(item.puntaje ?? "").trim() || "0/0"
  const evidenceLength = usefulEvidenceCharCountForRepair(item)
  const justificacion =
    typeof item.justificacion === "string" ? item.justificacion.trim() : ""
  const hasUsefulEvidence = evidenceLength >= SOLO_DESARROLLO_REPAIR_MIN_USEFUL_EVIDENCE_CHARS

  const isCriticalFailure =
    puntajeTotal > 1 &&
    isCriticalZeroSoloDesarrolloPuntaje(item.puntaje, puntajeTotal) &&
    hasUsefulEvidence &&
    justificacion.length > 0

  if (!isCriticalFailure) {
    return { combinedAnalysis, repaired: false }
  }

  const existingCriteria = collectCriteriosEvaluadosFromDesarrollo(respuestasDesarrollo)
  let repairCriteria: MechanicalRubricCriterion[]
  let repairReason: string

  if (existingCriteria.length > 0) {
    const repairedRaw = repairCriterioLevelsIfNeeded(existingCriteria, justificacion, hasUsefulEvidence)
    const slots = assignMaxPointsToCriteria(repairedRaw, pautaEstructurada, rubrica, puntajeTotal)
    repairCriteria = buildMechanicalCriteriaFromEvaluated(repairedRaw, slots)
    repairReason = "recalculated_from_existing_criterios_evaluados"
  } else {
    const labels = extractRecognizableRubricCriterionLabels(rubrica, pautaEstructurada)
    repairCriteria = buildRepairCriteriaFromLabels(labels, justificacion, hasUsefulEvidence, puntajeTotal)
    repairReason = labels === UNIVERSAL_DEVELOPMENT_CRITERIA ? "synthetic_universal_criteria" : "synthetic_from_rubric"
  }

  const scoreResult = computeRepairMechanicalScore(repairCriteria, puntajeTotal, hasUsefulEvidence)

  const textoEstudiante =
    item.texto_estudiante ??
    item.cita_estudiante ??
    item.respuesta ??
    ""
  const citaEstudiante =
    item.cita_estudiante ??
    item.texto_estudiante ??
    item.respuesta ??
    ""

  const criteriosEvaluadosOut = scoreResult.criteria.map((c) => ({
    criterio_id: c.criterio_id,
    criterio_label: c.criterio_label,
    nivel_logro: c.level,
    evidencia: c.evidence,
    justificacion: c.justification || justificacion.slice(0, 200),
    _scoring_authority: "canonical_puntaje",
  }))

  const repairedItem: Record<string, unknown> = {
    ...item,
    texto_estudiante: textoEstudiante,
    cita_estudiante: citaEstudiante,
    justificacion,
    puntaje: scoreResult.puntaje,
    criterios_evaluados: criteriosEvaluadosOut,
    _solo_desarrollo_repair_applied: true,
    _puntaje_canonico: scoreResult.puntaje,
    _scoring_sealed: true,
  }

  const repairedDesarrollo = orderCanonicalDesarrolloRecord({ P1: repairedItem })

  console.info("[evaluate][solo-desarrollo-repair] repaired_zero_score", {
    previousScore,
    repairedScore: scoreResult.puntaje,
    criteriaCount: scoreResult.criteria.length,
    reason: repairReason,
    evidenceLength,
    puntajeTotal,
  })

  return {
    combinedAnalysis: {
      ...combinedAnalysis,
      respuestas_desarrollo: repairedDesarrollo,
    },
    repaired: true,
    audit: {
      previousScore,
      repairedScore: scoreResult.puntaje,
      criteriaCount: scoreResult.criteria.length,
      reason: repairReason,
      evidenceLength,
      puntajeTotal,
    },
  }
}
