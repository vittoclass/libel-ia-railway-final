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
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (COURSE_CONTEXTS_ENABLED_DEFAULT) return true
  const v = String(env?.[COURSE_CONTEXTS_FLAG_ENV] ?? "")
    .trim()
    .toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

export function shouldMountCourseContextSwitcher(enabled: boolean): boolean {
  return enabled === true
}
