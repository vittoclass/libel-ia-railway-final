import type { TeacherWizardStep } from "./getWizardStepFromPathname"
import { WIZARD_STEPS_UI } from "./wizard-copy"

type Props = {
  currentStep: TeacherWizardStep
}

export function WizardProgressBar({ currentStep }: Props) {
  return (
    <nav aria-label="Progreso del flujo docente" className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      {WIZARD_STEPS_UI.map(({ step, label }, idx) => {
        const done = step < currentStep
        const active = step === currentStep
        return (
          <span key={step} className="flex items-center gap-1.5 sm:gap-2">
            {idx > 0 ? (
              <span className="text-[var(--text-muted)] opacity-60" aria-hidden>
                →
              </span>
            ) : null}
            <span
              className={[
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors sm:text-sm",
                done
                  ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                  : active
                    ? "bg-sky-500/30 text-sky-950 ring-2 ring-sky-500/50 dark:bg-sky-500/25 dark:text-sky-50 dark:ring-sky-400/60"
                    : "bg-[var(--bg-page)]/80 text-[var(--text-muted)]",
              ].join(" ")}
              aria-current={active ? "step" : undefined}
            >
              <span className="tabular-nums opacity-80">[{step}]</span>
              {label}
            </span>
          </span>
        )
      })}
    </nav>
  )
}
