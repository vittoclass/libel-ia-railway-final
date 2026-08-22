/**
 * Feature flag local de contextos de curso (S3).
 * Default OFF: el evaluador se comporta como un solo curso (PRE≡POST).
 * ON local: NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED=true|1|yes|on
 * No agrega variable Railway. No toca motores.
 */

export const COURSE_CONTEXTS_FLAG_ENV = "NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED"

/** Constante de desarrollo. Debe permanecer false en S3. */
export const COURSE_CONTEXTS_ENABLED_DEFAULT = false

export function isCourseContextsEnabled(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  if (COURSE_CONTEXTS_ENABLED_DEFAULT) return true
  // Literal NEXT_PUBLIC_*: Next.js 14 solo inlinea este acceso estático en el bundle cliente.
  const fromProcess = process.env.NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED
  const raw = env !== undefined ? env[COURSE_CONTEXTS_FLAG_ENV] : fromProcess
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

export function shouldMountCourseContextSwitcher(enabled: boolean): boolean {
  return enabled === true
}
