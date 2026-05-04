"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { ENABLE_WIZARD } from "./constants"
import { WizardContextualNudge } from "./WizardContextualNudge"
import { WizardSessionViewModal } from "./WizardSessionViewModal"
import type { TeacherWizardStep } from "./getWizardStepFromPathname"
import { getWizardStepFromPathname } from "./getWizardStepFromPathname"
import { expectedImagesMeta, readWizardSession, type TeacherWizardSessionDraft } from "./sessionStorage"
import { SessionConfigPanel } from "./SessionConfigPanel"
import { WIZARD_STEP_HINT } from "./wizard-copy"
import { hasSeenStepNudge, markStepNudgeSeen } from "./wizardUxSession"
import { WizardProgressBar } from "./WizardProgressBar"

type Props = { children: ReactNode }

type NudgeState =
  | { type: "step"; step: TeacherWizardStep }
  | { type: "post-save" }
  | { type: "station"; draft: TeacherWizardSessionDraft }

/**
 * Envoltorio solo visual: barra de pasos + hint. No altera children ni datos de evaluación.
 */
export function TeacherWizardShell({ children }: Props) {
  const pathname = usePathname() ?? ""
  const [sessionDraft, setSessionDraft] = useState<TeacherWizardSessionDraft | null>(null)
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false)
  const [viewConfigOpen, setViewConfigOpen] = useState(false)
  const [nudge, setNudge] = useState<NudgeState | null>(null)

  const prevPathRef = useRef("")
  const prevStepRef = useRef<TeacherWizardStep | null>(null)

  const refreshSession = useCallback(() => {
    setSessionDraft(readWizardSession())
  }, [])

  useEffect(() => {
    refreshSession()
  }, [pathname, refreshSession])

  const dismissNudge = useCallback(() => {
    setNudge((current) => {
      if (current?.type === "step") {
        markStepNudgeSeen(current.step)
      }
      return null
    })
  }, [])

  const handleSessionSaved = useCallback(() => {
    refreshSession()
    setNudge({ type: "post-save" })
  }, [refreshSession])

  const step = ENABLE_WIZARD ? getWizardStepFromPathname(pathname) : null

  /* Primera visita a cada paso (en /docente/estacion el nudge “station” sustituye el del paso 3). */
  useEffect(() => {
    if (!ENABLE_WIZARD || step === null) return
    const isEstacion = pathname.startsWith("/docente/estacion")
    if (step === 3 && isEstacion) {
      prevStepRef.current = step
      return
    }
    if (hasSeenStepNudge(step)) {
      prevStepRef.current = step
      return
    }
    if (prevStepRef.current === step) return
    prevStepRef.current = step
    setNudge({ type: "step", step })
  }, [step, pathname])

  /* Al entrar a /docente/estacion desde otra ruta, con sesión guardada */
  useEffect(() => {
    if (!ENABLE_WIZARD) return
    const prev = prevPathRef.current
    prevPathRef.current = pathname
    const nowEst = pathname.startsWith("/docente/estacion")
    const wasEst = prev.startsWith("/docente/estacion")
    if (!nowEst || wasEst) return
    const draft = readWizardSession()
    if (!draft?.savedAt) return
    markStepNudgeSeen(3)
    setNudge({ type: "station", draft })
  }, [pathname])

  if (!ENABLE_WIZARD) {
    return <>{children}</>
  }

  if (step === null) {
    return <>{children}</>
  }

  const showSessionButton = step !== 4
  const hasSavedSession = Boolean(sessionDraft?.savedAt)

  return (
    <>
      <div className="sticky top-14 z-40 border-b border-[var(--border-color)] bg-[var(--bg-page)]/95 px-3 py-2 shadow-sm backdrop-blur-sm sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <WizardProgressBar currentStep={step} />
          <div className="flex max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1">
            <span
              className={[
                "inline-flex max-w-[220px] items-center gap-1 truncate text-xs sm:max-w-none sm:text-sm",
                hasSavedSession
                  ? "font-medium text-emerald-800 dark:text-emerald-200"
                  : "font-medium text-amber-800 dark:text-amber-200",
              ].join(" ")}
              title={
                hasSavedSession ? "Sesión configurada en este dispositivo" : "Configura curso y meta para orientarte"
              }
            >
              {hasSavedSession ? "✓ Sesión configurada" : "⚠ Falta configurar sesión"}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--border-color)]/35 hover:text-[var(--text)] sm:text-sm"
              onClick={() => setViewConfigOpen(true)}
            >
              Ver configuración
            </button>
            {showSessionButton ? (
              <button
                type="button"
                className="shrink-0 rounded-md border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-500/25 dark:text-sky-100 sm:text-sm"
                onClick={() => setSessionPanelOpen(true)}
              >
                Configurar sesión
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-1.5 line-clamp-1 text-xs text-[var(--text-muted)] sm:text-sm">{WIZARD_STEP_HINT[step]}</p>
      </div>

      {nudge?.type === "step" ? (
        <WizardContextualNudge key={`step-${nudge.step}`} open onDismiss={dismissNudge}>
          <p>{WIZARD_STEP_HINT[nudge.step]}</p>
        </WizardContextualNudge>
      ) : null}

      {nudge?.type === "post-save" ? (
        <WizardContextualNudge key="post-save" open onDismiss={dismissNudge} title="Sesión guardada">
          <p>Los datos quedaron en este dispositivo. Puedes continuar el flujo cuando quieras.</p>
        </WizardContextualNudge>
      ) : null}

      {nudge?.type === "station" ? (
        <WizardContextualNudge key="station" open onDismiss={dismissNudge} title="Estás listo para escanear">
          <p>
            Curso: {nudge.draft.course.trim() || "—"}
            <br />
            Meta: {expectedImagesMeta(nudge.draft.studentCount, nudge.draft.imagesPerStudent)} imágenes
          </p>
        </WizardContextualNudge>
      ) : null}

      <SessionConfigPanel
        open={sessionPanelOpen}
        onClose={() => setSessionPanelOpen(false)}
        onSaved={handleSessionSaved}
      />
      <WizardSessionViewModal
        open={viewConfigOpen}
        onClose={() => setViewConfigOpen(false)}
        draft={sessionDraft}
      />
      {children}
    </>
  )
}
