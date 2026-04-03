// PHASE_4_MEMORY_IDENTITY_V1
const RUT_ALLOWED = /[0-9kK]/g

// PHASE_4_MEMORY_IDENTITY_V1
export function normalizeRutCanonical(input: string | null | undefined): string | null {
  if (input == null) return null
  const raw = String(input).trim()
  if (!raw) return null
  const pieces = raw.match(RUT_ALLOWED)
  if (!pieces || pieces.length < 2) return null
  const compact = pieces.join("").toLowerCase()
  const body = compact.slice(0, -1).replace(/^0+/, "")
  const dv = compact.slice(-1)
  if (!/^\d+$/.test(body) || !/^[0-9k]$/.test(dv)) return null
  return `${body}${dv}`
}

// PHASE_4_MEMORY_IDENTITY_V1
export function looksLikeRut(input: string | null | undefined): boolean {
  return normalizeRutCanonical(input) != null
}
