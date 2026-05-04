/**
 * Flags solo UX (cliente) para el wizard docente. No afecta datos de sesión guiada.
 */
const PREFIX = "tw-ux-"

export function getStepNudgeSeenSteps(): Record<string, boolean> {
  if (typeof window === "undefined") return {}
  try {
    const raw = sessionStorage.getItem(`${PREFIX}step-seen`)
    const o = raw ? (JSON.parse(raw) as unknown) : {}
    return typeof o === "object" && o !== null ? (o as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export function markStepNudgeSeen(step: number): void {
  if (typeof window === "undefined") return
  try {
    const cur = getStepNudgeSeenSteps()
    cur[String(step)] = true
    sessionStorage.setItem(`${PREFIX}step-seen`, JSON.stringify(cur))
  } catch {
    /* noop */
  }
}

export function hasSeenStepNudge(step: number): boolean {
  return Boolean(getStepNudgeSeenSteps()[String(step)])
}
