/**
 * Cuenta de opciones OMR desde templateKey productivo (`…_4` → A–D).
 * No inferir desde letras únicas de la clave docente: un subset A/B/C
 * no implica hoja de 3 burbujas.
 */
export function omrExpectedOptionCountFromTemplateKey(templateKey: string): number {
  const m = /_(\d+)$/.exec(String(templateKey ?? "").trim())
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n >= 2 && n <= 8) return Math.round(n)
  }
  return 4
}

/**
 * Inferencia legacy (incorrecta para clásico): tamaño del set de letras
 * presentes en respuestas correctas. Conservada solo para rama intercalada
 * hasta auditoría propia.
 */
export function omrExpectedOptionCountFromTeacherKeyUniqueLetters(
  teacherAnswerKey: Array<{ respuestaCorrecta?: string }>,
): number {
  return Math.max(
    2,
    new Set(
      teacherAnswerKey
        .map((r) => String(r?.respuestaCorrecta ?? "").trim().toUpperCase())
        .filter((v) => /^[A-Z]$/.test(v)),
    ).size || 4,
  )
}
