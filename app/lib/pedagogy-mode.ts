/**
 * Resolución del modo pedagógico para una evaluación.
 * Prioridad: source_exam > structured > text > auto.
 * No toca el motor de evaluación ni el guardado.
 */

export type PedagogyMode = "text" | "structured" | "source_exam" | "auto"
export type ExamType = "normal" | "simce" | "paes" | null

export interface EvaluationForMode {
  source_exam_id?: string | null
  exam_type?: string | null
  pedagogy_mode?: string | null
  subject?: string | null
}

export interface ResolvePedagogyModeOptions {
  /** Si true, se considera que evaluation_items tienen texto suficiente para clasificar por contenido */
  hasEnoughTextInItems?: boolean
}

const MIN_TEXT_LENGTH_PER_ITEM = 10

/**
 * Resuelve el modo pedagógico efectivo.
 * FASE 7A: solo auto | text | structured (source_exam reservado para después).
 * 1) Si pedagogy_mode existe y no es "auto" -> devolver ese valor (text | structured).
 * 2) Si exam_type es simce o paes -> "structured".
 * 3) Si hay texto suficiente en ítems -> "text".
 * 4) Si no: Matemática -> "structured", Lenguaje -> "text".
 */
export function resolvePedagogyMode(
  evaluation: EvaluationForMode,
  options: ResolvePedagogyModeOptions = {}
): PedagogyMode {
  const mode = (evaluation.pedagogy_mode || "").trim().toLowerCase()
  const examType = (evaluation.exam_type || "").trim().toLowerCase()
  const subject = (evaluation.subject || "").trim()

  if (evaluation.source_exam_id) return "source_exam"
  if (mode === "source_exam") return "source_exam"

  if (mode === "text" || mode === "structured") return mode
  if (examType === "simce" || examType === "paes") return "structured"

  if (mode === "auto" || !mode) {
    const hasText = options.hasEnoughTextInItems ?? true
    if (hasText) return "text"
    const subj = subject.toLowerCase()
    if (subj.includes("matemática") || subj.includes("matematica")) return "structured"
    return "text"
  }

  return "text"
}

/**
 * Indica si hay suficiente texto en los ítems para clasificar por contenido.
 */
export function hasEnoughTextInItems(
  items: Array<{ student_answer?: string | null; correct_answer?: string | null; [key: string]: unknown }>
): boolean {
  if (!items.length) return false
  const totalChars = items.reduce((sum, it) => {
    const s = [it.student_answer, it.correct_answer, it.question, it.question_text, it.prompt, it.item_text]
      .filter(Boolean)
      .map(String)
      .join(" ")
    return sum + s.length
  }, 0)
  return totalChars >= items.length * MIN_TEXT_LENGTH_PER_ITEM
}
