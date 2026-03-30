/**
 * FASE 3.5 — Contrato estable de ítems de desarrollo en el pipeline de evaluación.
 * Sin integración con Prueba Base; sin OMR ni scoring (solo normalización / fusión de resultados de IA).
 */

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

  const u = k.toUpperCase().replace(/\s+/g, " ")

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
