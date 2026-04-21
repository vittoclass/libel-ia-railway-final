/**
 * Activa paneles de diagnóstico / admin en cliente solo si el entorno lo permite.
 * Por defecto desactivado en producción (sin variable explícita).
 */
export const INTERNAL_SUPPORT_UI: boolean =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_INTERNAL_SUPPORT_UI === "true" ||
    process.env.NEXT_PUBLIC_INTERNAL_SUPPORT_UI === "1")
