"use client"

import { Button } from "@/components/ui/button"
import type { GuidedEvaluatorFormField } from "./applyGuidedWizardSessionToEvaluatorForm"
import { ENABLE_WIZARD } from "./constants"
import { expectedImagesMeta, readWizardSession } from "./sessionStorage"

export type GuidedSessionEvaluatorContextBannerProps = {
  onApplyGuided: () => void
  wizardFilledFieldKeys: GuidedEvaluatorFormField[]
  onUndoWizardApply: () => void
  evaluatorSourceExamListLoaded: boolean
  evaluatorSourceExamListLoading: boolean
  rememberedSourceExamMissingFromList: boolean
  onUseRememberedSourceExam: () => void
  /** Id de prueba base ya elegida en el evaluador (oculta el CTA si coincide con la del QR). */
  evaluatorSelectedSourceExamId?: string
}

/** Solo lectura local + acciones de guiado; no OMR ni backend de evaluación. */
export function GuidedSessionEvaluatorContextBanner({
  onApplyGuided,
  wizardFilledFieldKeys,
  onUndoWizardApply,
  evaluatorSourceExamListLoaded,
  evaluatorSourceExamListLoading,
  rememberedSourceExamMissingFromList,
  onUseRememberedSourceExam,
  evaluatorSelectedSourceExamId = "",
}: GuidedSessionEvaluatorContextBannerProps) {
  if (!ENABLE_WIZARD) return null
  const guided = readWizardSession()
  if (!guided?.savedAt) return null

  const metaTotal = expectedImagesMeta(guided.studentCount, guided.imagesPerStudent)
  const rememberedId = guided.sessionSourceExamId?.trim() ?? ""
  const selectedTrim = (evaluatorSelectedSourceExamId ?? "").trim()
  const listReady = evaluatorSourceExamListLoaded && !evaluatorSourceExamListLoading
  const showUseRememberedButton =
    Boolean(rememberedId) && listReady && !rememberedSourceExamMissingFromList && selectedTrim !== rememberedId
  const showMissingRemembered = Boolean(rememberedId) && listReady && rememberedSourceExamMissingFromList
  const showGenericBaseReminder =
    listReady && !rememberedId && Boolean(guided.course.trim() || guided.testName.trim() || guided.teacherName.trim())

  const appliedWizard = wizardFilledFieldKeys.length > 0

  return (
    <div className="w-full rounded-lg border border-sky-200/80 bg-sky-50/60 p-4 space-y-3 dark:border-sky-800 dark:bg-sky-950/30">
      <p className="text-sm font-semibold text-sky-900 dark:text-sky-100">Contexto desde configuración guiada</p>
      <ul className="text-xs sm:text-sm text-[var(--text-secondary)] space-y-1 list-none">
        <li>
          <span className="text-[var(--text-muted)]">Curso:</span> {guided.course.trim() || "—"}
        </li>
        <li>
          <span className="text-[var(--text-muted)]">Prueba:</span> {guided.testName.trim() || "—"}
        </li>
        <li>
          <span className="text-[var(--text-muted)]">Profesor:</span> {guided.teacherName.trim() || "—"}
        </li>
        {(guided.departmentName ?? "").trim() ? (
          <li>
            <span className="text-[var(--text-muted)]">Departamento:</span> {(guided.departmentName ?? "").trim()}
          </li>
        ) : null}
        {(guided.subjectName ?? "").trim() ? (
          <li>
            <span className="text-[var(--text-muted)]">Asignatura:</span> {(guided.subjectName ?? "").trim()}
          </li>
        ) : null}
        {guided.tipoPrueba ? (
          <li>
            <span className="text-[var(--text-muted)]">Tipo de prueba:</span>{" "}
            {guided.tipoPrueba === "solo_alternativas"
              ? "Solo alternativas"
              : guided.tipoPrueba === "solo_desarrollo"
                ? "Solo desarrollo"
                : "Mixta"}
          </li>
        ) : null}
        <li className="pt-1 font-medium text-[var(--text-primary)]">
          Meta: {guided.studentCount} estudiantes × {guided.imagesPerStudent} imágenes = {metaTotal} imágenes esperadas
        </li>
        {rememberedId ? (
          <li className="text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)]">Prueba base (referencia local):</span>{" "}
            {(guided.sessionSourceExamTitle ?? "").trim() || rememberedId.slice(0, 8)}
          </li>
        ) : null}
      </ul>
      <p className="text-[11px] text-[var(--text-muted)] leading-snug">
        Meta según configuración del profesor. No modifica el escaneo real.
      </p>

      {appliedWizard ? (
        <div className="rounded-md border border-emerald-200/90 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/40 space-y-2">
          <p className="text-sm font-medium text-emerald-950 dark:text-emerald-50">
            Configuración guiada aplicada. Puedes extraer nombres y evaluar.
          </p>
          <div className="text-sm text-emerald-900/95 dark:text-emerald-100/95">
            <p className="font-medium">Paso final:</p>
            <ol className="mt-1 list-decimal pl-5 space-y-0.5">
              <li>Extrae nombres</li>
              <li>Evalúa</li>
            </ol>
          </div>
          <Button type="button" variant="outline" size="sm" className="border-emerald-700/40" onClick={onUndoWizardApply}>
            Deshacer configuración aplicada
          </Button>
        </div>
      ) : null}

      {showUseRememberedButton ? (
        <div className="rounded-lg border-2 border-amber-400/80 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/50 space-y-2">
          <p className="text-sm font-semibold text-amber-950 dark:text-amber-50">Prueba base desde QR</p>
          <p className="text-sm text-amber-900 dark:text-amber-100">
            <span className="text-[var(--text-muted)] dark:text-amber-200/90">Nombre:</span>{" "}
            {(guided.sessionSourceExamTitle ?? "").trim() || rememberedId.slice(0, 8)}
          </p>
          <Button
            type="button"
            size="lg"
            className="w-full sm:w-auto font-semibold bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
            onClick={onUseRememberedSourceExam}
          >
            Usar prueba base configurada en QR
          </Button>
          <p className="text-[11px] text-[var(--text-muted)] dark:text-amber-200/80 leading-snug">
            Mismo handler que el selector de prueba base del evaluador. Un clic carga ítems y pauta.
          </p>
        </div>
      ) : null}

      {showMissingRemembered ? (
        <p className="text-xs font-medium text-amber-800 dark:text-amber-200 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          Selecciona la misma prueba base antes de evaluar (no aparece en el listado o cambió el servidor).
        </p>
      ) : null}

      {showGenericBaseReminder ? (
        <p className="text-xs text-[var(--text-muted)] leading-snug rounded-md border border-dashed border-[var(--border-color)] px-2 py-1.5">
          Si corresponde, selecciona aquí la misma prueba base que usarás antes de evaluar.
        </p>
      ) : null}

      <Button type="button" variant="secondary" size="sm" onClick={onApplyGuided}>
        Usar configuración guiada
      </Button>
    </div>
  )
}
