/**
 * Ajustes de escala por bloque vertical (sin tocar el pipeline clásico).
 * Escala el umbral de emparejamiento izq/der cuando la banda es baja.
 */

/** Altura normalizada (0–1) de la banda; mínimo epsilon para evitar división por cero. */
export function bandVerticalSpan(yMin: number, yMax: number): number {
  return Math.max(1e-6, yMax - yMin)
}

/**
 * Umbral Y para emparejar filas izquierda/derecha dentro de un bloque.
 * Tope global por defecto 0.0255: solo afecta cuando h·0.25 lo supera (bandas altas); bandas bajas siguen limitadas por h·0.25.
 */
export function effectivePairingYThreshold(bandHeight: number, globalThreshold = 0.0255): number {
  return Math.min(globalThreshold, bandHeight * 0.25)
}
