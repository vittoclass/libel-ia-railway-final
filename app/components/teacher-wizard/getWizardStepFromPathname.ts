/**
 * Determina el paso del wizard usando únicamente el pathname (App Router).
 * Rutas fuera del flujo docente operativo → null (no mostrar barra).
 */
export function isTeacherWizardPath(pathname: string): boolean {
  const p = pathname || ""
  if (p === "/evaluaciones" || p.startsWith("/evaluaciones/")) return true
  if (p === "/evaluar-paywall" || p.startsWith("/evaluar-paywall/")) return true
  if (p === "/evaluar" || p.startsWith("/evaluar/")) return true
  if (p === "/docente/estacion" || p.startsWith("/docente/estacion/")) return true
  if (p === "/docente/movil-scan" || p.startsWith("/docente/movil-scan/")) return true
  return false
}

export type TeacherWizardStep = 1 | 2 | 3 | 4

/** Mapeo solo por pathname (sin query). El paso 2 no tiene ruta dedicada en el App Router actual. */
export function getWizardStepFromPathname(pathname: string): TeacherWizardStep | null {
  if (!isTeacherWizardPath(pathname)) return null
  const p = pathname || ""

  if (p === "/evaluaciones" || p.startsWith("/evaluaciones/")) return 4
  if (p === "/docente/estacion" || p.startsWith("/docente/estacion/")) return 3
  if (p === "/docente/movil-scan" || p.startsWith("/docente/movil-scan/")) return 3

  if (p === "/evaluar-paywall" || p.startsWith("/evaluar-paywall/")) return 1
  if (p === "/evaluar" || p.startsWith("/evaluar/")) return 1

  return null
}
