"use client"

import type { ReactNode } from "react"
import { useEffect } from "react"

type Props = {
  open: boolean
  /** ms; por defecto 4500 */
  autoHideMs?: number
  onDismiss: () => void
  title?: string
  children: ReactNode
  /** CTA opcional (p. ej. enlace a escaneo) */
  footer?: ReactNode
}

/**
 * Panel contextual no modal: fondo suave, compacto, no bloquea el resto de la página.
 */
export function WizardContextualNudge({
  open,
  autoHideMs = 4500,
  onDismiss,
  title,
  children,
  footer,
}: Props) {
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => onDismiss(), autoHideMs)
    return () => window.clearTimeout(t)
  }, [open, autoHideMs, onDismiss])

  if (!open) return null

  return (
    <div className="border-b border-sky-500/20 bg-gradient-to-r from-sky-500/10 via-sky-500/5 to-transparent px-3 py-2.5 sm:px-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 text-sm text-[var(--text)]">
          {title ? <p className="font-medium text-[var(--text)]">{title}</p> : null}
          <div className="mt-0.5 text-[var(--text-muted)] [&>p]:text-[var(--text)]">{children}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {footer}
          <button
            type="button"
            className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-3 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--border-color)]/30 sm:text-sm"
            onClick={onDismiss}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
