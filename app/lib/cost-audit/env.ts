/** Auditoría shadow de costos/tokens IA: apagada por defecto; no altera evaluación ni scoring. */
export function isCostAuditShadowEnabled(): boolean {
  const v = String(process.env.COST_AUDIT_SHADOW_ENABLED ?? "").trim().toLowerCase()
  return v === "true" || v === "1"
}
