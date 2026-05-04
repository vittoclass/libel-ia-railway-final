import type { TeacherWizardSessionDraft } from "./sessionStorage"

export type GuidedEvaluatorFormField = "curso" | "nombrePrueba" | "nombreProfesor"

export type ApplyGuidedWizardSessionResult = {
  filled: GuidedEvaluatorFormField[]
  skippedHadValue: GuidedEvaluatorFormField[]
}

/**
 * Rellena solo campos del evaluador que estén vacíos, usando el borrador local del wizard.
 * No backend; no OMR; reversible (el usuario puede editar después).
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
  ]

  for (const { field, fromWizard } of pairs) {
    if (!fromWizard) continue
    const current = String(getField(field) ?? "").trim()
    if (current) {
      skippedHadValue.push(field)
      continue
    }
    setField(field, fromWizard)
    filled.push(field)
  }

  return { filled, skippedHadValue }
}
