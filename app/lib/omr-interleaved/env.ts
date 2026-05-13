/** Feature flag acordado: sin activar en producción no hay rama intercalada. */
export function isOmrInterleavedFeatureEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OMR_INTERLEAVED === "1"
}

/**
 * Diagnóstico visual/JSON solo para el pipeline interleaved.
 * Requiere además `NEXT_PUBLIC_OMR_INTERLEAVED=1`; si no, no tiene efecto.
 */
export function isOmrInterleavedDebugEnabled(): boolean {
  return isOmrInterleavedFeatureEnabled() && process.env.NEXT_PUBLIC_OMR_INTERLEAVED_DEBUG === "1"
}

/**
 * Si es `"true"` o `"1"`, no se aplica la auto-selección odd_even vs sequential_dual_column
 * (`detect-dual-column-variant`): se usa solo la variante pedida al pipeline.
 */
export function isInterleavedAutoVariantDisabled(): boolean {
  const v = String(process.env.INTERLEAVED_DISABLE_AUTO_VARIANT ?? "").trim().toLowerCase()
  return v === "true" || v === "1"
}

/**
 * Desactiva la resolución por margen mínimo top-2 (comportamiento anterior al cambio).
 * Reversible: INTERLEAVED_TIGHT_WINNER_MARGIN_DISABLE=1
 */
export function isInterleavedTightWinnerMarginDisabled(): boolean {
  const v = String(process.env.INTERLEAVED_TIGHT_WINNER_MARGIN_DISABLE ?? "").trim().toLowerCase()
  return v === "true" || v === "1"
}

/**
 * Umbral en espacio de score compuesto: secondBestScore - bestScore (menor score = mejor).
 * Por defecto 0.07. Valores no finitos o ≤0 desactivan el chequeo (mismo efecto que DISABLE).
 */
export function getInterleavedTightWinnerMarginMinGap(): number {
  if (isInterleavedTightWinnerMarginDisabled()) return Number.POSITIVE_INFINITY
  const raw = String(process.env.INTERLEAVED_TIGHT_WINNER_MARGIN_MIN_GAP ?? "").trim()
  if (!raw) return 0.07
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return Number.POSITIVE_INFINITY
  return n
}

/**
 * Si true (default), ante margen bajo se intenta sustituir con una pasada de azure_layout_family (API existente).
 * Si false, solo BLANK + telemetría (sin segunda llamada Azure).
 */
export function isInterleavedTightWinnerMarginClassicBridgeEnabled(): boolean {
  if (isInterleavedTightWinnerMarginDisabled()) return false
  const v = String(process.env.INTERLEAVED_TIGHT_WINNER_MARGIN_CLASSIC_BRIDGE ?? "true").trim().toLowerCase()
  return v !== "false" && v !== "0"
}

/**
 * Realineación estructural post-zip (híbrido intercalado). Rollback automático si falla validación física.
 * Desactivar: INTERLEAVED_STRUCTURAL_REALIGN_DISABLE=1 o INTERLEAVED_STRUCTURAL_REALIGN=0
 */
export function isInterleavedStructuralRealignmentEnabled(): boolean {
  const disable = String(process.env.INTERLEAVED_STRUCTURAL_REALIGN_DISABLE ?? "").trim().toLowerCase()
  if (disable === "true" || disable === "1") return false
  const v = String(process.env.INTERLEAVED_STRUCTURAL_REALIGN ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Reasignación geométrica global marca→fila dentro del panel (pipeline interleaved).
 * Desactivar: INTERLEAVED_DETECTION_GEOMETRY_REFINE_DISABLE=1 o INTERLEAVED_DETECTION_GEOMETRY_REFINE=0
 */
export function isInterleavedDetectionGeometryRefineEnabled(): boolean {
  const disable = String(process.env.INTERLEAVED_DETECTION_GEOMETRY_REFINE_DISABLE ?? "").trim().toLowerCase()
  if (disable === "true" || disable === "1") return false
  const v = String(process.env.INTERLEAVED_DETECTION_GEOMETRY_REFINE ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Protección conservadora: el refinamiento geométrico solo actúa sobre
 * preguntas ambiguas o sospechosas; las confiables se preservan intactas.
 * Activado por defecto. Desactivar: INTERLEAVED_DETECTION_GEOMETRY_REFINE_CONSERVATIVE=0
 */
export function isInterleavedDetectionGeometryRefineConservativeEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_DETECTION_GEOMETRY_REFINE_CONSERVATIVE ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Guarda geométrica canónica: valida que el orden Y de filas dentro de cada
 * panel coincida con el orden por physicalIndex de los OMR slots asignados.
 * Corrige mapeos fila→canonicalId físicamente imposibles (pipeline interleaved).
 * Desactivar: INTERLEAVED_CANONICAL_GEOMETRY_GUARD=0
 */
export function isInterleavedCanonicalGeometryGuardEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_CANONICAL_GEOMETRY_GUARD ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Validación geométrica columna↔letra: verifica que la letra final
 * (selectedAnswer) coincida con la columna geométrica más cercana a la
 * marca realmente seleccionada. Corrige mismatches detectados.
 * Desactivar: INTERLEAVED_COLUMN_GEOMETRY_VALIDATION=0
 */
export function isInterleavedColumnGeometryValidationEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_COLUMN_GEOMETRY_VALIDATION ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Mapeo final definitivo: filas físicas ordenadas visualmente → closedQuestionIds
 * en orden oficial del inventario cerrado. Corrige cualquier desfase fila→canonical
 * introducido por pasos intermedios (rebuild, realignment, geometry refine, etc.).
 *
 * Activo por defecto (INTERLEAVED_CLOSED_INVENTORY_FINAL_MAP=1).
 * Desactivar: INTERLEAVED_CLOSED_INVENTORY_FINAL_MAP=0
 * Rollback automático si closedQuestionIds.length !== filas cerradas detectadas.
 */
export function isInterleavedClosedInventoryFinalMapEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_CLOSED_INVENTORY_FINAL_MAP ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Mapeo universal multi-estrategia: evalúa panel_then_y y y_then_panel,
 * elige la mejor estrategia con evidencia estructural (geometría, OCR, panel balance).
 * Se aplica dentro de applyClosedInventoryFinalMapping cuando está activo.
 *
 * Activo por defecto (INTERLEAVED_UNIVERSAL_PHYSICAL_MAP=1).
 * Desactivar: INTERLEAVED_UNIVERSAL_PHYSICAL_MAP=0
 * Requiere además INTERLEAVED_CLOSED_INVENTORY_FINAL_MAP=1.
 */
export function isInterleavedUniversalPhysicalMapEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_UNIVERSAL_PHYSICAL_MAP ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Override de orden físico por tolerancia de banda horizontal.
 * Cuando activo, sortDecodedForRebuild en modo y_then_panel trata filas
 * con |ΔY| ≤ tolerancia como misma banda, ordenando por panel (izq primero).
 * Esto previene inversiones L↔R dentro de una banda por ruido de scan/skew.
 *
 * Activo por defecto (INTERLEAVED_GEOMETRY_ORDER_OVERRIDE=1).
 * Desactivar: INTERLEAVED_GEOMETRY_ORDER_OVERRIDE=0
 */
export function isInterleavedGeometryOrderOverrideEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_GEOMETRY_ORDER_OVERRIDE ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Tolerancia Y para considerar dos filas como misma banda horizontal.
 * Solo aplica cuando INTERLEAVED_GEOMETRY_ORDER_OVERRIDE=1.
 * Default: 0.012 (en coordenadas normalizadas 0..1).
 */
export function getInterleavedGeometryBandTolerance(): number {
  if (!isInterleavedGeometryOrderOverrideEnabled()) return 0
  const raw = String(process.env.INTERLEAVED_GEOMETRY_BAND_TOLERANCE ?? "").trim()
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0.012
}

/**
 * Hard guard: bloquea sustituciones del bridge clásico que no tienen evidencia
 * física real (assignedDetectionIndices vacío, sin margen fuerte verificable).
 *
 * Activo por defecto (protección ON). Para restaurar el comportamiento anterior
 * (bridge clásico con override libre): INTERLEAVED_DISABLE_UNSAFE_CLASSIC_BRIDGE=0
 *
 * Reversibilidad total: INTERLEAVED_DISABLE_UNSAFE_CLASSIC_BRIDGE=1 (default)
 * activa la protección; =0 la desactiva y restaura el bridge sin guardia.
 */
export function isInterleavedUnsafeClassicBridgeGuardEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_DISABLE_UNSAFE_CLASSIC_BRIDGE ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Umbral mínimo de confianza del bridge clásico para permitir override
 * cuando la guardia está activa. Solo se acepta override si el bridge aporta
 * evidencia con confianza >= este umbral.
 * Default: 0.75. Requiere INTERLEAVED_DISABLE_UNSAFE_CLASSIC_BRIDGE=1.
 */
export function getInterleavedClassicBridgeMinConfidence(): number {
  const raw = String(process.env.INTERLEAVED_CLASSIC_BRIDGE_MIN_CONFIDENCE ?? "").trim()
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n <= 1) return n
  }
  return 0.75
}

/**
 * Guardia final de evidencia física: tras todos los bridges/refines/remaps,
 * fuerza que la respuesta final de cada fila cerrada provenga de evidencia
 * física directa (assignedDetectionIndices + geometría de marca). Las filas
 * sin evidencia física real quedan en BLANK con revisión recomendada.
 *
 * Activo por defecto (INTERLEAVED_PHYSICAL_ANSWER_FINAL_GUARD=1).
 * Desactivar: INTERLEAVED_PHYSICAL_ANSWER_FINAL_GUARD=0
 * Reversibilidad total: =0 restaura el comportamiento anterior (bridge/heurística puede decidir).
 */
export function isInterleavedPhysicalAnswerFinalGuardEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_PHYSICAL_ANSWER_FINAL_GUARD ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Guardia de evidencia física ampliada: previene falsos BLANK verificando
 * evidencia en campos directos de la fila Y dentro de
 * interleavedColumnGeometryDiagnostic. Complementa al guard final.
 *
 * Activo por defecto (INTERLEAVED_PHYSICAL_EVIDENCE_GUARD=1).
 * Desactivar: INTERLEAVED_PHYSICAL_EVIDENCE_GUARD=0
 */
export function isInterleavedPhysicalEvidenceGuardEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_PHYSICAL_EVIDENCE_GUARD ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Guard de unicidad física de detectionIndex: garantiza que ningún
 * assignedDetectionIndex se comparta entre dos filas/preguntas distintas.
 * Si un mismo índice aparece en 2+ filas, se conserva solo en la fila con
 * mejor match geométrico local y las demás quedan BLANK + revisión.
 *
 * Activo por defecto (INTERLEAVED_DETECTION_INDEX_UNIQUENESS_GUARD=1).
 * Desactivar: INTERLEAVED_DETECTION_INDEX_UNIQUENESS_GUARD=0
 * Reversibilidad total: =0 restaura el comportamiento anterior.
 */
export function isInterleavedDetectionIndexUniquenessGuardEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_DETECTION_INDEX_UNIQUENESS_GUARD ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Mapeo físico preservado: cuando la hoja OMR tiene filas numeradas 1..N
 * (incluyendo posiciones de preguntas de desarrollo), el mapeo usa el número
 * físico real de cada fila en vez de compactar cerradas sobre filas consecutivas.
 *
 * Activo por defecto (INTERLEAVED_PHYSICAL_NUMBER_PRESERVED_MAP=1).
 * Desactivar: INTERLEAVED_PHYSICAL_NUMBER_PRESERVED_MAP=0
 * Reversibilidad total: =0 restaura el comportamiento compacto anterior.
 */
export function isInterleavedPhysicalNumberPreservedMapEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_PHYSICAL_NUMBER_PRESERVED_MAP ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Preservación de filas físicas esperadas: antes del mapeo final, garantiza que
 * cada pregunta cerrada esperada tenga una fila física trazable. Si una fila
 * no fue detectada durante el clustering/decode (evidencia débil, zona inferior),
 * busca marcas Azure cercanas al Y esperado y crea una fila preservada.
 *
 * Activo por defecto (INTERLEAVED_EXPECTED_PHYSICAL_ROW_PRESERVATION=1).
 * Desactivar: INTERLEAVED_EXPECTED_PHYSICAL_ROW_PRESERVATION=0
 * Reversibilidad total: =0 restaura el comportamiento anterior (filas faltantes
 * se pierden antes del mapeo final y terminan como physicalNumberPreservedPaddedBlank).
 */
export function isInterleavedExpectedPhysicalRowPreservationEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_EXPECTED_PHYSICAL_ROW_PRESERVATION ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Reconciliación canónica por diagnóstico de geometría de columna:
 * cuando interleavedColumnGeometryDiagnostic.canonicalId difiere del
 * canonicalId asignado por el mapeo physical-number-preserved, y el
 * diagnostic tiene selectedAnswer válido (A-D) + assignedDetectionIndices
 * no vacío, reasigna la fila al canonicalId del diagnostic.
 *
 * Previene el bug donde filas con detección física real terminan con
 * canonicalId incorrecto (ej. C25 en vez de C27) y luego el canonical
 * correcto se crea como paddedBlank.
 *
 * DESACTIVADO por defecto (INTERLEAVED_DIAGNOSTIC_CANONICAL_RECONCILIATION=0).
 * El último intento activo causó regresión: recuperó C27/C29 pero blanqueó C18/C19.
 * Activar solo con guardia anti-orphan validada: INTERLEAVED_DIAGNOSTIC_CANONICAL_RECONCILIATION=1
 * Reversibilidad total: =0 restaura el comportamiento estable anterior.
 */
export function isInterleavedDiagnosticCanonicalReconciliationEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_DIAGNOSTIC_CANONICAL_RECONCILIATION ?? "0").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Mapeo físico basado en descriptores híbridos: usa hybridSlotDescriptors
 * como fuente de verdad para determinar qué fila física corresponde a qué
 * pregunta cerrada, en vez de computar physicalRowNumber por fórmula
 * (panelIndex * rowsPerPanel + rowIndex + 1).
 *
 * Corrige la causa raíz del bug donde hojas híbridas con P2, P17, P28, P30
 * intercaladas producían mapeos incorrectos porque la fórmula asumía que
 * rowIndexWithinPanel cuenta TODAS las filas, pero el pipeline solo detecta
 * las cerradas.
 *
 * Activo por defecto (INTERLEAVED_DESCRIPTOR_PHYSICAL_MAPPING=1).
 * Desactivar: INTERLEAVED_DESCRIPTOR_PHYSICAL_MAPPING=0
 * Reversibilidad total: =0 restaura el comportamiento anterior (fórmula).
 */
export function isInterleavedDescriptorPhysicalMappingEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_DESCRIPTOR_PHYSICAL_MAPPING ?? "1").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Guardia post-mapeo: no crear filas `physicalNumberPreservedPaddedBlank` si ya
 * hay evidencia física interleaved (respuesta A–D + assignedDetectionIndices) para
 * el mismo slot cerrado del inventario (fila física / canónico / diagnóstico).
 *
 * Desactivado por defecto (INTERLEAVED_PADDED_BLANK_PHYSICAL_GUARD=0): el guard
 * global anterior mostró regresiones (BLANK colaterales). Activar: =1.
 * Reversibilidad total: =0 restaura el comportamiento sin ese guard.
 */
export function isInterleavedPaddedBlankPhysicalEvidenceGuardEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_PADDED_BLANK_PHYSICAL_GUARD ?? "0").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off") return false
  return true
}

/**
 * Recuperación final solo para filas cerradas BLANK con evidencia física ya
 * registrada en interleavedColumnGeometryDiagnostic (mismo canonical o mismo
 * physicalIndex). No inventa respuestas; reversible.
 *
 * Defecto: INTERLEAVED_FINAL_BLANK_RECOVERY_FROM_PHYSICAL_EVIDENCE=0.
 * Activar: =1. Umbral opcional: INTERLEAVED_FINAL_BLANK_RECOVERY_MIN_CONFIDENCE
 * (número; -1 o ausente = no exigir confianza en confidencesByColumn).
 */
export function isInterleavedFinalBlankRecoveryFromPhysicalEvidenceEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_FINAL_BLANK_RECOVERY_FROM_PHYSICAL_EVIDENCE ?? "0")
    .trim()
    .toLowerCase()
  return v === "1" || v === "true" || v === "on"
}

export function getInterleavedFinalBlankRecoveryMinConfidence(): number {
  const raw = process.env.INTERLEAVED_FINAL_BLANK_RECOVERY_MIN_CONFIDENCE
  if (raw == null || String(raw).trim() === "") return -1
  const n = Number(String(raw).trim())
  return Number.isFinite(n) ? n : -1
}

/**
 * Auditoría focal C30/C31 (JSON en consola y en payload bajo `interleavedC30C31Audit`).
 * Defecto: INTERLEAVED_C30_C31_AUDIT=0. Reversible.
 */
export function isInterleavedC30C31AuditEnabled(): boolean {
  const v = String(process.env.INTERLEAVED_C30_C31_AUDIT ?? "0").trim().toLowerCase()
  return v === "1" || v === "true" || v === "on"
}
