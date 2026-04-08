/**
 * Fotos por estudiante en la captura móvil (/escaneo/[batchId] vía QR).
 * El servidor acepta hasta 50 (movil-upload); la UI móvil limita opciones para uso en aula.
 * La estación docente puede indicar más vía expected_pages_per_student; si excede esto, el móvil muestra aviso.
 */
export const MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT = 7

export const MOBILE_CAPTURE_PAGE_CHOICES = Array.from(
  { length: MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT },
  (_, i) => i + 1,
) as readonly number[]
