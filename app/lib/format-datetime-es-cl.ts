/**
 * Formato fecha/hora Chile para dashboards institucionales.
 * Usa zona explícita para coherencia; en fechas fijas (ISO) SSR y cliente suelen coincidir.
 * Para "ahora" en componentes cliente, preferir setState tras mount (evita mismatch de motor ICU).
 */

const ES_CL_DT: Intl.DateTimeFormatOptions = {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "America/Santiago",
}

export function formatDateTimeEsCl(isoOrDate: string | Date | null | undefined): string {
  if (isoOrDate == null || isoOrDate === "") return "—"
  const d = typeof isoOrDate === "string" || typeof isoOrDate === "number" ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("es-CL", ES_CL_DT).format(d)
}
