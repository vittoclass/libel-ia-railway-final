import { ENABLE_WIZARD } from "./constants"

/**
 * El resumen de sesión pasó al shell del wizard (panel contextual + “Ver configuración”).
 * Este componente se mantiene como no-op para no tocar las páginas que lo importan.
 */
export function GuidedSessionStationSummary() {
  if (!ENABLE_WIZARD) return null
  return null
}
