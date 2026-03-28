/**
 * Fuente única de desarrollo en UI: si existe detalle_desarrollo, correccion_detallada no debe repetir ítems de desarrollo.
 * Solo conserva filas cuya `sección` coincide exactamente (normalizada) con `pregunta` en alternativas estructuradas.
 * Sin regex sobre narrativa: whitelist desde retroalimentacion_alternativas / alternativas_corregidas.
 */
export function sanitizeRetroalimentacionCorreccionDetallada(
  retro: Record<string, unknown> | null | undefined,
  detalleDesarrollo: Record<string, unknown> | null | undefined,
  alternativasFuente: unknown[] | undefined,
): Record<string, unknown> | null | undefined {
  if (!retro || typeof retro !== "object") return retro
  const tieneDev =
    detalleDesarrollo != null &&
    typeof detalleDesarrollo === "object" &&
    Object.keys(detalleDesarrollo).some((k) => String(k).trim())
  if (!tieneDev) return retro

  const cd = retro.correccion_detallada
  if (!Array.isArray(cd)) return retro

  const altsRaw = (retro.retroalimentacion_alternativas as unknown[]) ?? alternativasFuente ?? []
  const alts = Array.isArray(altsRaw) ? altsRaw : []
  const permitidas = new Set(
    alts
      .map((a) => String((a as { pregunta?: string })?.pregunta ?? "").trim().toUpperCase())
      .filter(Boolean),
  )
  const filtrada =
    permitidas.size === 0
      ? []
      : cd.filter((row: unknown) => {
          const sec = String((row as { seccion?: string })?.seccion ?? "").trim().toUpperCase()
          return sec !== "" && permitidas.has(sec)
        })

  return { ...retro, correccion_detallada: filtrada }
}
