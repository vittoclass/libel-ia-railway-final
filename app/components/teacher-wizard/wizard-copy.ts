import type { TeacherWizardStep } from "./getWizardStepFromPathname"

export const WIZARD_STEP_HINT: Record<TeacherWizardStep, string> = {
  1: "Sube y valida la prueba base",
  2: "Configura curso y escaneo",
  3: "Escanea las pruebas de tus estudiantes",
  4: "Revisa y evalúa automáticamente",
}

export const WIZARD_STEPS_UI: { step: TeacherWizardStep; label: string }[] = [
  { step: 1, label: "Prueba Base" },
  { step: 2, label: "QR" },
  { step: 3, label: "Escaneo" },
  { step: 4, label: "Evaluar" },
]
