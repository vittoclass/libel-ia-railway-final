/**
 * Fusión en memoria de ítems Smart Extract (prueba) con suplementos de pauta/rúbrica.
 * Sin BD; consumido por /api/source-exams/smart-extract y por el cliente solo vía JSON de respuesta.
 */
import type { SmartExtractItemPublic } from "@/app/lib/smart-base-parser"
import type { DraftFieldKey, MergeDraftOverlayByItem } from "@/app/lib/source-exam-validation-draft"

/** Filas extraídas de documentos de pauta o rúbrica (post-IA o heurística). */
export type SupplementRow = {
  item_number: number
  correct_answer?: string | null
  max_score?: number | null
  rubric_text?: string | null
}

export type MergeSmartExtractResult = {
  merged: SmartExtractItemPublic[]
  /** Por número de ítem (no por índice de arreglo). */
  overlayByItemNumber: Map<number, MergeDraftOverlayByItem>
  summary: {
    answersCompletedFromPauta: number
    scoresCompletedFromPautaOrRubric: number
    rubricsAssociated: number
    conflictsNeedReview: number
  }
}

/**
 * Normaliza claves tipo A–E o V/F desde texto de pauta (evita perder "B)", "Alt. C", "→ D").
 */
export function normAnswer(a: string | null | undefined): string | null {
  if (a == null) return null
  const raw = String(a).trim()
  if (!raw) return null
  const u = raw.toUpperCase()
  if (/^[A-E]$/.test(u)) return u
  if (u === "V" || u === "F") return u
  if (/^V\b|^VERDADERO\b|^VF\s*:\s*V/i.test(u)) return "V"
  if (/^F\b|^FALSO\b|^VF\s*:\s*F/i.test(u)) return "F"
  const letter = u.match(/\b([A-E])\b/)
  if (letter) return letter[1]
  const paren = u.match(/\(?\s*([A-E])\s*\)?/)
  if (paren) return paren[1]
  const vf = u.match(/\b([VF])\b/)
  if (vf) return vf[1]
  return null
}

function normScore(n: unknown): number | null {
  if (n == null) return null
  const x = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : parseInt(String(n), 10)
  if (Number.isNaN(x) || x < 0) return null
  return x
}

function scoreMismatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false
  return a !== b
}

function collectMainItemNumbers(mainItems: SmartExtractItemPublic[]): Set<number> {
  const nums = new Set<number>()
  for (const row of mainItems) {
    const n = Math.floor(Number(row.item_number))
    if (Number.isFinite(n) && n >= 1) nums.add(n)
  }
  return nums
}

/**
 * Completa mapas de suplemento con reglas masivas y tablas cuando la IA no expande fila a fila.
 * No inventa ítems fuera de `mainItems`; solo rellena huecos (prioridad: datos explícitos por ítem > heurística).
 */
export function augmentSupplementMapsFromText(
  pautaText: string,
  rubricText: string,
  pauta: Map<number, SupplementRow>,
  rubric: Map<number, SupplementRow>,
  mainItems: SmartExtractItemPublic[],
): void {
  const itemSet = collectMainItemNumbers(mainItems)
  if (itemSet.size === 0) return

  const ensurePauta = (n: number): SupplementRow => {
    const x = pauta.get(n)
    if (x) return x
    const row: SupplementRow = { item_number: n }
    pauta.set(n, row)
    return row
  }

  const ensureRubric = (n: number): SupplementRow => {
    const x = rubric.get(n)
    if (x) return x
    const row: SupplementRow = { item_number: n }
    rubric.set(n, row)
    return row
  }

  const setScorePautaIfEmpty = (n: number, score: number) => {
    if (!itemSet.has(n)) return
    const row = ensurePauta(n)
    if (normScore(row.max_score) != null) return
    row.max_score = score
    pauta.set(n, row)
  }

  const setAnswerPautaIfEmpty = (n: number, rawAns: string) => {
    if (!itemSet.has(n)) return
    const p = normAnswer(rawAns)
    if (!p) return
    const row = ensurePauta(n)
    if (normAnswer(row.correct_answer) != null) return
    row.correct_answer = p
    pauta.set(n, row)
  }

  const setRubricIfEmpty = (n: number, text: string) => {
    if (!itemSet.has(n)) return
    const t = text.trim()
    if (t.length < 4) return
    const row = ensureRubric(n)
    if (row.rubric_text?.trim()) return
    row.rubric_text = t
    rubric.set(n, row)
  }

  const combined = `${pautaText ?? ""}\n\n${rubricText ?? ""}`
  const pautaBlock = pautaText ?? ""

  // --- Reglas globales de puntaje (una sustituye a la otra si varias coinciden; orden de prioridad) ---
  const globalRes = [
    /(?:cada|todas?\s+las)\s+(?:pregunta|preguntas|ítem|ítems|item|items)\s+(?:vale|valen)\s+(\d+)\s*(?:punto|puntos|pts?)?/gi,
    /(?:todas?\s+las\s+)?alternativas?\s+(?:correctas?\s+)?(?:vale|valen)\s+(\d+)\s*(?:punto|puntos|pts?)?/gi,
    /(\d+)\s*(?:punto|puntos)\s+cada\s+una/gi,
    /cada\s+una\s+(?:vale|valen)\s+(\d+)\s*(?:punto|puntos|pts?)?/gi,
    /cada\s+respuesta\s+(?:vale|valen)\s+(\d+)\s*(?:punto|puntos|pts?)?/gi,
  ]
  for (const re of globalRes) {
    re.lastIndex = 0
    const m = re.exec(combined)
    if (!m) continue
    const sc = normScore(m[1])
    if (sc == null) continue
    for (const n of itemSet) {
      const exist = pauta.get(n)
      if (exist && normScore(exist.max_score) != null) continue
      setScorePautaIfEmpty(n, sc)
    }
    break
  }

  // --- Rangos: "ítems 1 a 10: 1 punto", "preguntas 11-15: 2 puntos" ---
  const rangeRe =
    /(?:preguntas?|preg\.|ítems?|items?)\s*(\d+)\s*(?:a|al|[-–—])\s*(\d+)\s*[:\s]+[^\d\n]{0,40}?(\d+)\s*(?:punto|puntos|pts?)\b/gi
  let rangeMatch: RegExpExecArray | null
  const rangeRe2 = new RegExp(rangeRe.source, rangeRe.flags)
  while ((rangeMatch = rangeRe2.exec(combined)) !== null) {
    const a = parseInt(rangeMatch[1], 10)
    const b = parseInt(rangeMatch[2], 10)
    const sc = normScore(rangeMatch[3])
    if (!Number.isFinite(a) || !Number.isFinite(b) || sc == null) continue
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    for (let n = lo; n <= hi; n++) {
      if (!itemSet.has(n)) continue
      const exist = pauta.get(n)
      if (exist && normScore(exist.max_score) != null) continue
      setScorePautaIfEmpty(n, sc)
    }
  }

  // --- Desarrollo / sección con puntaje → ítems largos sin puntaje en mapa ---
  const devRe =
    /(?:desarrollo|secci[oó]n(?:\s+(?:ii|iii|b|c|2|3))?)\s*[:\s]+\s*(\d+)\s*(?:punto|puntos|pts?)/gi
  let devMatch: RegExpExecArray | null
  const devRe2 = new RegExp(devRe.source, devRe.flags)
  while ((devMatch = devRe2.exec(`${pautaBlock}\n${rubricText ?? ""}`)) !== null) {
    const sc = normScore(devMatch[1])
    if (sc == null) continue
    for (const row of mainItems) {
      const n = Math.floor(Number(row.item_number))
      if (!Number.isFinite(n) || n < 1 || !itemSet.has(n)) continue
      const qt = row.question_type
      if (qt !== "essay" && qt !== "short_answer") continue
      const exist = pauta.get(n)
      if (exist && normScore(exist.max_score) != null) continue
      setScorePautaIfEmpty(n, sc)
    }
  }

  // --- Filas tipo tabla: Nº | respuesta | puntaje ---
  for (const line of combined.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.length > 600) continue

    let tm = t.match(/^\s*(\d+)\s*[\t|]\s*([^\t|]+?)\s*[\t|]\s*(\d+)\s*$/i)
    if (tm) {
      const n = parseInt(tm[1], 10)
      if (!itemSet.has(n)) continue
      const mid = tm[2].trim()
      const sc = normScore(tm[3])
      if (sc != null) {
        const exist = pauta.get(n)
        if (!exist || normScore(exist.max_score) == null) setScorePautaIfEmpty(n, sc)
      }
      if (mid.length <= 8 && (!pauta.get(n) || normAnswer(pauta.get(n)?.correct_answer) == null)) {
        setAnswerPautaIfEmpty(n, mid)
      }
      continue
    }

    tm = t.match(/^\s*(\d+)\s*[\t|]\s*([A-Ea-eVvFf])\s*[\t|]\s*(\d+)\s*$/)
    if (tm) {
      const n = parseInt(tm[1], 10)
      if (!itemSet.has(n)) continue
      const sc = normScore(tm[3])
      if (sc != null) {
        const exist = pauta.get(n)
        if (!exist || normScore(exist.max_score) == null) setScorePautaIfEmpty(n, sc)
      }
      setAnswerPautaIfEmpty(n, tm[2])
      continue
    }

    tm = t.match(/^\s*(\d+)\s+(?:[A-Ea-eVvFf])\s+(\d+)\s*$/)
    if (tm) {
      const n = parseInt(tm[1], 10)
      if (!itemSet.has(n)) continue
      const sc = normScore(tm[2])
      if (sc != null) {
        const exist = pauta.get(n)
        if (!exist || normScore(exist.max_score) == null) setScorePautaIfEmpty(n, sc)
      }
      continue
    }
  }

  // --- Rúbrica: líneas "Ítem N — …" o "N. descriptor largo" ---
  for (const line of (rubricText ?? "").split(/\r?\n/)) {
    let m = line.match(/^\s*(?:íte|ítem|item)\s*(\d+)\s*[.:\-–—]\s*(.+)$/i)
    if (!m) m = line.match(/^\s*(\d+)\s*[.)]\s+(.{8,})$/)
    if (m) {
      const n = parseInt(m[1], 10)
      setRubricIfEmpty(n, m[2])
    }
  }
}

/**
 * Prioridad: texto de pregunta desde main; respuesta y puntaje desde pauta/rúbrica;
 * rúbrica preferente desde doc. rúbrica. Conflictos → needs_review + nota (valor aplicado según regla).
 */
export function mergeSmartExtractWithSupplements(
  mainItems: SmartExtractItemPublic[],
  pautaByNum: ReadonlyMap<number, SupplementRow>,
  rubricByNum: ReadonlyMap<number, SupplementRow>,
): MergeSmartExtractResult {
  const overlayByItemNumber = new Map<number, MergeDraftOverlayByItem>()
  let answersCompletedFromPauta = 0
  let scoresCompletedFromPautaOrRubric = 0
  let rubricsAssociated = 0

  const merged = mainItems.map((row) => {
    const n = row.item_number ?? 0
    if (n < 1) return { ...row }

    const pauta = pautaByNum.get(n)
    const rubric = rubricByNum.get(n)
    const overlay: MergeDraftOverlayByItem = {}
    const next: SmartExtractItemPublic = { ...row }

    const mainAns = normAnswer(row.correct_answer)
    const mainScore = normScore(row.max_score)
    const mainRubric = row.rubric_text?.trim() ? row.rubric_text : null

    // --- correct_answer (prioridad pauta) ---
    const pAns = normAnswer(pauta?.correct_answer ?? null)
    if (pAns) {
      if (!mainAns) {
        next.correct_answer = pAns
        overlay.correct_answer = { status: "completed_from_pauta" }
        answersCompletedFromPauta++
      } else if (mainAns !== pAns) {
        next.correct_answer = pAns
        overlay.correct_answer = {
          status: "needs_review",
          conflict_note: "Respuesta distinta entre prueba y pauta.",
        }
      }
    }

    // --- max_score: prioridad pauta > rúbrica; conflicto entre fuentes o respecto a la prueba ---
    const pScore = normScore(pauta?.max_score ?? null)
    const rScore = normScore(rubric?.max_score ?? null)

    let chosenScore: number | null = mainScore
    let scoreSource: "pauta" | "rubric" | null = null
    let pautaRubricConflict = false

    if (pScore != null && rScore != null && pScore !== rScore) {
      chosenScore = pScore
      scoreSource = "pauta"
      pautaRubricConflict = true
    } else if (pScore != null) {
      chosenScore = pScore
      scoreSource = "pauta"
    } else if (rScore != null) {
      chosenScore = rScore
      scoreSource = "rubric"
    }

    if (pautaRubricConflict) {
      next.max_score = chosenScore
      overlay.max_score = {
        status: "needs_review",
        conflict_note: "Puntaje distinto entre pauta y rúbrica.",
      }
    } else if (scoreSource != null) {
      next.max_score = chosenScore
      const wasEmpty = mainScore == null
      const conflictWithMain = scoreMismatch(mainScore, chosenScore)
      if (conflictWithMain) {
        overlay.max_score = {
          status: "needs_review",
          conflict_note: "Puntaje distinto entre prueba y pauta/rúbrica.",
        }
      } else if (wasEmpty) {
        overlay.max_score = {
          status: scoreSource === "pauta" ? "completed_from_pauta" : "completed_from_rubric",
        }
        scoresCompletedFromPautaOrRubric++
      } else {
        overlay.max_score = {
          status: scoreSource === "pauta" ? "completed_from_pauta" : "completed_from_rubric",
        }
      }
    }

    // --- rubric_text: prioridad documento rúbrica, respaldo pauta ---
    const rText = rubric?.rubric_text?.trim() ? rubric.rubric_text.trim() : null
    const pText = pauta?.rubric_text?.trim() ? pauta.rubric_text.trim() : null

    if (rText) {
      if (!mainRubric) {
        next.rubric_text = rText
        overlay.rubric_text = { status: "completed_from_rubric" }
        rubricsAssociated++
      } else if (mainRubric !== rText) {
        next.rubric_text = rText
        overlay.rubric_text = {
          status: "needs_review",
          conflict_note: "Texto de rúbrica distinto entre prueba y documento de rúbrica.",
        }
      } else {
        overlay.rubric_text = { status: "completed_from_rubric" }
      }
    } else if (pText && !rText) {
      if (!mainRubric) {
        next.rubric_text = pText
        overlay.rubric_text = { status: "completed_from_pauta" }
        rubricsAssociated++
      } else if (mainRubric !== pText) {
        next.rubric_text = pText
        overlay.rubric_text = {
          status: "needs_review",
          conflict_note: "Texto de rúbrica distinto entre prueba y pauta.",
        }
      }
    }

    if (Object.keys(overlay).length > 0) {
      overlayByItemNumber.set(n, overlay)
    }

    return next
  })

  let conflictsNeedReview = 0
  for (const o of overlayByItemNumber.values()) {
    if (Object.values(o).some((e) => e.status === "needs_review")) conflictsNeedReview++
  }

  return {
    merged,
    overlayByItemNumber,
    summary: {
      answersCompletedFromPauta,
      scoresCompletedFromPautaOrRubric,
      rubricsAssociated,
      conflictsNeedReview,
    },
  }
}

/** Para JSON en la respuesta HTTP (Map no es serializable). */
export function mergeOverlayToJsonRecord(
  overlay: Map<number, MergeDraftOverlayByItem>,
): Record<string, MergeDraftOverlayByItem> {
  const out: Record<string, MergeDraftOverlayByItem> = {}
  for (const [num, o] of overlay) {
    out[String(num)] = o
  }
  return out
}

export function mergeOverlayFromJsonRecord(
  rec: Record<string, MergeDraftOverlayByItem> | null | undefined,
): Map<number, MergeDraftOverlayByItem> {
  const m = new Map<number, MergeDraftOverlayByItem>()
  if (!rec || typeof rec !== "object") return m
  for (const [k, v] of Object.entries(rec)) {
    const n = parseInt(k, 10)
    if (!Number.isFinite(n) || n < 1) continue
    m.set(n, v)
  }
  return m
}

/** Prompt corto: solo pauta/rúbrica, salida JSON estricta. */
export const SUPPLEMENT_EXTRACT_SYSTEM_PROMPT = `Eres un extractor de pautas y rúbricas escolares (Chile). Recibirás uno o dos bloques de texto: PAUTA y opcionalmente RÚBRICA.

Devuelve SOLO JSON válido (sin markdown):
{
  "from_pauta": [ { "item_number": <entero>=1, "correct_answer": "<A-E o V/F si existe>", "max_score": <entero>=0 o omite>, "rubric_text": "<solo si la pauta incluye criterios largos; si no, omite>" } ],
  "from_rubric": [ { "item_number": <entero>=1, "rubric_text": "<texto del criterio o descriptor>", "max_score": <entero si hay puntaje por ítem; omite si no> } ]
}

Reglas:
1) Una fila por número de ítem cuando haya información explícita en el texto.
2) Si el documento dice reglas globales (ej. "cada pregunta vale 1 punto", "ítems 1 al 20: 1 punto"), DEBES expandirlas: incluye una fila por cada número de ítem afectado con max_score correspondiente (y correct_answer si la tabla lo da por fila).
3) Tablas con columnas Nº / Respuesta / Puntaje: una fila JSON por cada fila de tabla.
4) correct_answer: solo letras A-E o V/F según el documento; normaliza (ej. "B)" → "B").
5) No inventes ítems sin evidencia en el texto.
6) Si un bloque no está presente o está vacío, devuelve [] para ese arreglo.
7) Los números de ítem deben corresponder a la numeración del documento.

Responde únicamente con el JSON.`

export function supplementRowsToMaps(rows: {
  from_pauta?: SupplementRow[]
  from_rubric?: SupplementRow[]
}): { pauta: Map<number, SupplementRow>; rubric: Map<number, SupplementRow> } {
  const pauta = new Map<number, SupplementRow>()
  const rubric = new Map<number, SupplementRow>()
  for (const r of rows.from_pauta ?? []) {
    const n = Math.floor(Number(r.item_number))
    if (!Number.isFinite(n) || n < 1) continue
    pauta.set(n, { ...r, item_number: n })
  }
  for (const r of rows.from_rubric ?? []) {
    const n = Math.floor(Number(r.item_number))
    if (!Number.isFinite(n) || n < 1) continue
    rubric.set(n, { ...r, item_number: n })
  }
  return { pauta, rubric }
}
