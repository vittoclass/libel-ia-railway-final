"use client"

import { expectedImagesMeta, type TeacherWizardSessionDraft } from "./sessionStorage"

type Props = {
  open: boolean
  onClose: () => void
  draft: TeacherWizardSessionDraft | null
}

/**
 * Vista solo lectura de la configuración guardada (no edita ni envía datos).
 */
export function WizardSessionViewModal({ open, onClose, draft }: Props) {
  if (!open) return null

  const hasSaved = Boolean(draft?.savedAt)
  const meta =
    hasSaved && draft
      ? expectedImagesMeta(draft.studentCount, draft.imagesPerStudent)
      : null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/25 p-3 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-session-view-title"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-page)] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="wizard-session-view-title" className="text-base font-semibold text-[var(--text)]">
            Configuración de sesión
          </h2>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--border-color)]/40 hover:text-[var(--text)]"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
        {!hasSaved || !draft ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">Aún no hay datos guardados en este dispositivo.</p>
        ) : (
          <ul className="mt-4 list-none space-y-2 text-sm text-[var(--text)]">
            <li>
              <span className="text-[var(--text-muted)]">Curso:</span> {draft.course.trim() || "—"}
            </li>
            <li>
              <span className="text-[var(--text-muted)]">Prueba:</span> {draft.testName.trim() || "—"}
            </li>
            <li>
              <span className="text-[var(--text-muted)]">Profesor:</span> {draft.teacherName.trim() || "—"}
            </li>
            <li className="border-t border-[var(--border-color)] pt-2 font-medium">
              Meta: {draft.studentCount} estudiantes × {draft.imagesPerStudent} imágenes = {meta} esperadas
            </li>
            {draft.sessionSourceExamId?.trim() ? (
              <li className="text-[var(--text-secondary)]">
                <span className="text-[var(--text-muted)]">Referencia local prueba base:</span>{" "}
                {(draft.sessionSourceExamTitle ?? "").trim() || draft.sessionSourceExamId.slice(0, 8)}
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  )
}
