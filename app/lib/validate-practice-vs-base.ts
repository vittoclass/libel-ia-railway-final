/**
 * Validación docente: compara ítems de alternativa múltiple extraídos de un PDF/DOCX "real"
 * contra los ítems `multiple_choice` ya guardados en la prueba base. Solo lectura / diff en memoria.
 * No persiste resultados; no modifica la base.
 */

export type ValidatePracticeMcItem = {
  item_number: number
  item_text: string
  question_type: string | null
  correct_answer: string | null
}

export type ValidatePracticeAlertCode =
  | "MISSING_IN_REAL"
  | "EXTRA_IN_REAL"
  | "KEY_MISMATCH"
  | "TYPE_MISMATCH"
  | "TEXT_VERY_DIFFERENT"
  | "ORDER_UNUSUAL_IN_REAL"
  | "KEY_MISSING_IN_REAL"

export type ValidatePracticeAlertSeverity = "info" | "warning"

export type ValidatePracticeAlert = {
  severity: ValidatePracticeAlertSeverity
  code: ValidatePracticeAlertCode
  item_number: number | null
  detail: string
  base_preview: string | null
  real_preview: string | null
}

export type ValidatePracticeSummary = {
  base_alternative_count: number
  real_alternative_count: number
  missing_in_real_count: number
  extra_in_real_count: number
  key_mismatch_count: number
  type_mismatch_count: number
  text_very_different_count: number
  order_unusual_in_real: boolean
  key_missing_in_real_count: number
}

/** Umbral Jaccard por palabras; por debajo = texto muy distinto (ambos textos con suficiente longitud). */
const TEXT_JACCARD_MIN = 0.28
const TEXT_MIN_LEN = 24

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "number" ? v : parseInt(String(v), 10)
  if (!Number.isFinite(n)) return null
  return Math.floor(n)
}

function strOrEmpty(v: unknown): string {
  if (v == null) return ""
  return String(v).trim()
}

function normalizeKey(v: string | null): string | null {
  if (!v) return null
  const u = v.trim().toUpperCase()
  if (/^[A-E]$/.test(u)) return u
  return null
}

function tokenizeWords(s: string): Set<string> {
  const t = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
  const parts = t.split(/\s+/).filter((w) => w.length > 1)
  return new Set(parts)
}

export function wordJaccardSimilarity(a: string, b: string): number {
  const sa = tokenizeWords(a)
  const sb = tokenizeWords(b)
  if (sa.size === 0 && sb.size === 0) return 1
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const w of sa) {
    if (sb.has(w)) inter++
  }
  const union = sa.size + sb.size - inter
  return union > 0 ? inter / union : 0
}

/** Parsea JSON del modelo: solo objetos en `items` con question_type multiple_choice o omitido si el modelo sigue instrucciones. */
export function parseValidatePracticeMcExtract(parsed: unknown): ValidatePracticeMcItem[] {
  if (!parsed || typeof parsed !== "object") return []
  const items = (parsed as { items?: unknown }).items
  if (!Array.isArray(items)) return []

  const out: ValidatePracticeMcItem[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const n = numOrNull(r.item_number)
    if (n == null || n < 1) continue
    const itemText = strOrEmpty(r.item_text)
    if (!itemText) continue
    const qtRaw = strOrEmpty(r.question_type).toLowerCase()
    const question_type = qtRaw === "multiple_choice" || qtRaw === "" ? "multiple_choice" : qtRaw
    if (question_type !== "multiple_choice") continue

    let correct: string | null = null
    const ca = strOrEmpty(r.correct_answer)
    if (ca) {
      const u = ca.toUpperCase()
      if (/^[A-E]$/.test(u)) correct = u
    }

    out.push({
      item_number: n,
      item_text: itemText,
      question_type: "multiple_choice",
      correct_answer: correct,
    })
  }
  return out
}

export const VALIDATE_PRACTICE_MC_SYSTEM_PROMPT = `Eres un extractor para VALIDACIÓN (no guardas nada). Recibirás TEXTO de un PDF/Word de una prueba real.

Tarea: identificar únicamente ítems de selección múltiple (alternativas A/B/C/D/E), con numeración explícita si existe.

Devuelve SOLO JSON válido (sin markdown):
{
  "items": [
    {
      "item_number": <entero >= 1>,
      "item_text": "<enunciado breve o completo; incluye alternativas si están en el mismo bloque>",
      "question_type": "multiple_choice",
      "correct_answer": "<A-E solo si la pauta o gabarito aparece en ESTE documento; si no hay clave visible, omite la clave>"
    }
  ]
}

REGLAS:
1) Incluye TODAS las preguntas de alternativa múltiple que encuentres.
2) No incluyas true_false, essay, desarrollo ni rúbricas en este JSON.
3) item_number: respeta el documento; si no hay número claro, usa orden 1,2,3 según aparición.
4) Sé compacto. Sin texto fuera del JSON.`

export function comparePracticeMultipleChoiceVsBase(
  baseItems: ValidatePracticeMcItem[],
  realItems: ValidatePracticeMcItem[],
): { summary: ValidatePracticeSummary; alerts: ValidatePracticeAlert[] } {
  const alerts: ValidatePracticeAlert[] = []

  const baseMap = new Map<number, ValidatePracticeMcItem>()
  for (const it of baseItems) {
    baseMap.set(it.item_number, it)
  }
  const realMap = new Map<number, ValidatePracticeMcItem>()
  for (const it of realItems) {
    realMap.set(it.item_number, it)
  }

  const baseNums = new Set(baseMap.keys())
  const realNums = new Set(realMap.keys())

  let missingInReal = 0
  for (const n of baseNums) {
    if (!realNums.has(n)) {
      missingInReal++
      const b = baseMap.get(n)!
      alerts.push({
        severity: "warning",
        code: "MISSING_IN_REAL",
        item_number: n,
        detail: `El ítem ${n} está en la prueba base (alternativa múltiple) pero no apareció en la extracción de la prueba real.`,
        base_preview: b.item_text.slice(0, 220),
        real_preview: null,
      })
    }
  }

  let extraInReal = 0
  for (const n of realNums) {
    if (!baseNums.has(n)) {
      extraInReal++
      const r = realMap.get(n)!
      alerts.push({
        severity: "warning",
        code: "EXTRA_IN_REAL",
        item_number: n,
        detail: `El ítem ${n} apareció en la prueba real pero no existe como alternativa múltiple en la prueba base.`,
        base_preview: null,
        real_preview: r.item_text.slice(0, 220),
      })
    }
  }

  let keyMismatch = 0
  let keyMissingInReal = 0
  let typeMismatch = 0
  let textVeryDifferent = 0

  for (const n of baseNums) {
    if (!realNums.has(n)) continue
    const b = baseMap.get(n)!
    const r = realMap.get(n)!
    if (b.question_type !== r.question_type) {
      typeMismatch++
      alerts.push({
        severity: "warning",
        code: "TYPE_MISMATCH",
        item_number: n,
        detail: `Ítem ${n}: tipo base "${b.question_type ?? "?"}" vs real "${r.question_type ?? "?"}".`,
        base_preview: b.item_text.slice(0, 160),
        real_preview: r.item_text.slice(0, 160),
      })
    }

    const bk = normalizeKey(b.correct_answer)
    const rk = normalizeKey(r.correct_answer)
    if (bk && !rk) {
      keyMissingInReal++
      alerts.push({
        severity: "warning",
        code: "KEY_MISSING_IN_REAL",
        item_number: n,
        detail: `Ítem ${n}: la base tiene clave ${bk} pero en la prueba real no se detectó pauta explícita.`,
        base_preview: bk,
        real_preview: null,
      })
    } else if (bk && rk && bk !== rk) {
      keyMismatch++
      alerts.push({
        severity: "warning",
        code: "KEY_MISMATCH",
        item_number: n,
        detail: `Ítem ${n}: clave base ${bk} vs clave detectada en real ${rk}.`,
        base_preview: bk,
        real_preview: rk,
      })
    }

    if (b.item_text.length >= TEXT_MIN_LEN && r.item_text.length >= TEXT_MIN_LEN) {
      const jac = wordJaccardSimilarity(b.item_text, r.item_text)
      if (jac < TEXT_JACCARD_MIN) {
        textVeryDifferent++
        alerts.push({
          severity: "info",
          code: "TEXT_VERY_DIFFERENT",
          item_number: n,
          detail: `Ítem ${n}: enunciados poco similares (similitud léxica ≈ ${jac.toFixed(2)}). Revise OCR o si es otra versión de la prueba.`,
          base_preview: b.item_text.slice(0, 200),
          real_preview: r.item_text.slice(0, 200),
        })
      }
    }
  }

  const orderNums = realItems.map((x) => x.item_number)
  const sorted = [...orderNums].sort((a, b) => a - b)
  const orderUnusual = orderNums.length >= 2 && orderNums.some((v, i) => v !== sorted[i])
  if (orderUnusual) {
    alerts.push({
      severity: "info",
      code: "ORDER_UNUSUAL_IN_REAL",
      item_number: null,
      detail:
        "La numeración extraída de la prueba real no sigue orden estrictamente creciente según el orden de aparición en el JSON (posible reorden o numeración irregular).",
      base_preview: null,
      real_preview: orderNums.slice(0, 40).join(", "),
    })
  }

  const summary: ValidatePracticeSummary = {
    base_alternative_count: baseItems.length,
    real_alternative_count: realItems.length,
    missing_in_real_count: missingInReal,
    extra_in_real_count: extraInReal,
    key_mismatch_count: keyMismatch,
    type_mismatch_count: typeMismatch,
    text_very_different_count: textVeryDifferent,
    order_unusual_in_real: orderUnusual,
    key_missing_in_real_count: keyMissingInReal,
  }

  return { summary, alerts }
}
