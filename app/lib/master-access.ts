/**
 * Correos con acceso total (creador Libelia): middleware + APIs dashboard + UI home.
 * Comparación case-insensitive; funciona en localhost y Railway sin variables de entorno.
 */
export const MASTER_EMAILS = ["vittoclass@gmail.com"] as const

export function isMasterEmail(email: string | undefined | null): boolean {
  const e = String(email ?? "").trim().toLowerCase()
  return (MASTER_EMAILS as readonly string[]).some((m) => m.toLowerCase() === e)
}
