import type { TeacherWizardSessionDraft } from "./sessionStorage"

export type GuidedEvaluatorFormField =
  | "curso"
  | "nombrePrueba"
  | "nombreProfesor"
  | "departamento"
  | "asignatura"
  | "tipoPrueba"
  | "puntajeTotal"
  | "porcentajeExigencia"

export type ApplyGuidedWizardSessionResult = {
  filled: GuidedEvaluatorFormField[]
  skippedHadValue: GuidedEvaluatorFormField[]
}

const VALID_TIPO_PRUEBA = new Set<string>(["mixta", "solo_desarrollo", "solo_alternativas"])

/** Alineado con `defaultValues` de EvaluatorClient (formulario). */
const EVALUATOR_DEFAULT_PUNTAJE_TOTAL = "100"
const EVALUATOR_DEFAULT_PORCENTAJE_EXIGENCIA = "55"

function isEmptyFieldValue(v: string | undefined): boolean {
  return v == null || String(v).trim() === ""
}

/** Variantes de clave por si el JSON local usó alias distintos al tipado estricto. */
function wizardString(d: TeacherWizardSessionDraft, keys: string[]): string {
  const obj = d as Record<string, unknown>
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string") {
      const t = v.trim()
      if (t) return t
    }
  }
  return ""
}

function normalizeIntString(v: string | undefined): string {
  return String(v ?? "").trim()
}

/**
 * Exigencia: rellenar si vacío/ inválido o si sigue en el default de fábrica del evaluador,
 * para permitir que el valor del QR sustituya al default sin pisar una edición manual.
 */
function shouldApplyPorcentajeExigencia(currentRaw: string | undefined, fromWizard: string): boolean {
  const w = normalizeIntString(fromWizard)
  if (!/^[0-9]+$/.test(w)) return false
  const t = normalizeIntString(currentRaw)
  if (!t) return true
  if (!/^[0-9]+$/.test(t)) return true
  if (t === EVALUATOR_DEFAULT_PORCENTAJE_EXIGENCIA) return true
  return false
}

/**
 * Puntaje total: solo si vacío, 0 o default de fábrica (no sobrescribir otras elecciones).
 */
function shouldApplyPuntajeTotal(currentRaw: string | undefined, fromWizard: string): boolean {
  const w = normalizeIntString(fromWizard)
  if (!/^[0-9]+$/.test(w) || w === "0") return false
  const t = normalizeIntString(currentRaw)
  if (!t) return true
  if (!/^[0-9]+$/.test(t)) return true
  const n = Number.parseInt(t, 10)
  if (!Number.isFinite(n) || n === 0) return true
  if (t === EVALUATOR_DEFAULT_PUNTAJE_TOTAL) return true
  return false
}

/**
 * Rellena campos del evaluador desde el borrador local del wizard (sin backend).
 * Reversible: el usuario puede editar después.
 *
 * tipoPrueba: se aplica desde el wizard si el campo está vacío o es inválido, o si el
 * valor actual es "mixta" (no se pisa solo_desarrollo / solo_alternativas ya elegidos).
 *
 * exigencia / puntajeTotal: solo si vienen definidos en el borrador (sesiones antiguas sin claves no aplican).
 */
export function applyGuidedWizardSessionToEvaluatorForm(
  draft: TeacherWizardSessionDraft | null,
  getField: (field: GuidedEvaluatorFormField) => string | undefined,
  setField: (field: GuidedEvaluatorFormField, value: string) => void,
): ApplyGuidedWizardSessionResult {
  const filled: GuidedEvaluatorFormField[] = []
  const skippedHadValue: GuidedEvaluatorFormField[] = []
  if (!draft?.savedAt) return { filled, skippedHadValue }

  const pairs: Array<{ field: GuidedEvaluatorFormField; fromWizard: string }> = [
    { field: "curso", fromWizard: draft.course.trim() },
    { field: "nombrePrueba", fromWizard: draft.testName.trim() },
    { field: "nombreProfesor", fromWizard: draft.teacherName.trim() },
    { field: "departamento", fromWizard: wizardString(draft, ["departmentName", "departamento"]) },
    { field: "asignatura", fromWizard: wizardString(draft, ["subjectName", "asignatura", "subject"]) },
  ]

  for (const { field, fromWizard } of pairs) {
    if (!fromWizard) continue
    const currentRaw = getField(field)
    if (!isEmptyFieldValue(currentRaw)) {
      skippedHadValue.push(field)
      continue
    }
    setField(field, fromWizard)
    filled.push(field)
  }

  const wTipo = draft.tipoPrueba ?? "mixta"
  const curRaw = String(getField("tipoPrueba") ?? "").trim()
  const curValid = VALID_TIPO_PRUEBA.has(curRaw)
  const cur = curValid ? curRaw : null

  const shouldApplyTipo = cur === null || cur === "mixta"
  if (!shouldApplyTipo) {
    skippedHadValue.push("tipoPrueba")
  } else if (cur === wTipo) {
    skippedHadValue.push("tipoPrueba")
  } else {
    setField("tipoPrueba", wTipo)
    filled.push("tipoPrueba")
  }

  if (draft.exigencia != null && Number.isFinite(draft.exigencia)) {
    const fromWizard = String(Math.round(draft.exigencia))
    if (shouldApplyPorcentajeExigencia(getField("porcentajeExigencia"), fromWizard)) {
      setField("porcentajeExigencia", fromWizard)
      filled.push("porcentajeExigencia")
    } else {
      skippedHadValue.push("porcentajeExigencia")
    }
  }

  if (draft.puntajeTotal != null && Number.isFinite(draft.puntajeTotal)) {
    const fromWizard = String(Math.round(draft.puntajeTotal))
    if (shouldApplyPuntajeTotal(getField("puntajeTotal"), fromWizard)) {
      setField("puntajeTotal", fromWizard)
      filled.push("puntajeTotal")
    } else {
      skippedHadValue.push("puntajeTotal")
    }
  }

  return { filled, skippedHadValue }
}
