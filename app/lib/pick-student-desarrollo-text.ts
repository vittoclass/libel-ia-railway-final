/**
 * Elige el mejor texto visible del estudiante entre campos habituales del JSON de desarrollo.
 * Evita quedarse con "Sin respuesta" / vacío si otro campo trae cita real.
 */

const PLACEHOLDER_EXACT = new Set(
  [
    "sin respuesta",
    "sin respuesta.",
    "no respondió",
    "no respondio",
    "no contestó",
    "no contesto",
    "no hay respuesta",
    "sin texto",
    "n/a",
    "na",
    "—",
    "-",
    "...",
    "vacío",
    "vacio",
  ].map((s) => s.toLowerCase()),
)

export function isPlaceholderStudentDesarrolloText(s: string): boolean {
  const t = s.trim().toLowerCase()
  if (!t) return true
  return PLACEHOLDER_EXACT.has(t)
}

/** Convierte un valor de campo a texto plano; nunca devuelve "[object Object]". */
export function coercePlainStudentField(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.trim()
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim()
  if (Array.isArray(v)) {
    const parts = v.map((x) => coercePlainStudentField(x)).filter(Boolean)
    return parts.join(" ").trim()
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    const nestedKeys = [
      "texto",
      "cita",
      "contenido",
      "value",
      "mensaje",
      "respuesta",
      "transcripcion",
      "descripcion",
      "literal",
      "body",
    ] as const
    for (const k of nestedKeys) {
      const inner = o[k]
      if (typeof inner === "string" && inner.trim()) return inner.trim()
      if (typeof inner === "number" || typeof inner === "boolean") return String(inner).trim()
    }
    return ""
  }
  return ""
}

/**
 * 1) Entre cita_estudiante y texto_estudiante: gana la cadena usable más larga (misma prioridad de fuente literal).
 * 2) Si ninguna es usable, otros campos en orden; de nuevo la usable más larga por grupo.
 * 3) Si solo hay placeholders, se devuelve el primer no vacío (comportamiento previo).
 */
export function pickStudentDesarrolloVisibleText(item: Record<string, unknown> | null | undefined): string {
  if (!item || typeof item !== "object") return ""

  const asStr = (v: unknown) => coercePlainStudentField(v)

  const bestUsableIn = (keys: readonly string[]): string => {
    let best = ""
    for (const k of keys) {
      const s = asStr(item[k])
      if (!s || isPlaceholderStudentDesarrolloText(s)) continue
      if (s.length > best.length) best = s
    }
    return best
  }

  const primary = bestUsableIn(["cita_estudiante", "texto_estudiante"])
  if (primary) return primary

  const secondary = bestUsableIn([
    "respuesta_estudiante",
    "respuesta",
    "cita",
    "transcripcion_estudiante",
    "texto",
  ])
  if (secondary) return secondary

  const fallbackOrder = [
    "cita_estudiante",
    "texto_estudiante",
    "respuesta_estudiante",
    "respuesta",
    "cita",
    "transcripcion_estudiante",
    "texto",
  ] as const
  for (const k of fallbackOrder) {
    const s = asStr(item[k])
    if (s) return s
  }
  return ""
}
