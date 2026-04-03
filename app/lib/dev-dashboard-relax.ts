/**
 * Bypass temporal RBAC para /dashboard/utp y /dashboard/direccion (solo desarrollo u opt-in).
 * REVERTIR: eliminar este archivo y referencias; o dejar DEV_DASHBOARD_RELAX sin definir en producción.
 */
export function isDashboardInstitutionalRelaxEnabled(): boolean {
  if (process.env.NODE_ENV === "development") return true
  return process.env.DEV_DASHBOARD_RELAX === "1"
}
