/**
 * Semestre calendario Chile (H1 ene–jun, H2 jul–dic). Solo utilitario; no toca evaluación ni OMR.
 */

export function semesterKeyFromDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const half = m <= 6 ? "H1" : "H2"
  return `${y}-${half}`
}

export function previousSemesterKey(key: string): string {
  const [y, h] = key.split("-")
  const year = parseInt(y, 10)
  if (!Number.isFinite(year)) return semesterKeyFromDate(new Date())
  if (h === "H2") return `${year}-H1`
  return `${year - 1}-H2`
}

export function semesterUtcRange(semesterKey: string): { start: string; end: string } {
  const [y, h] = semesterKey.split("-")
  const year = parseInt(y, 10)
  if (!Number.isFinite(year)) {
    const now = new Date()
    return semesterUtcRange(semesterKeyFromDate(now))
  }
  if (h === "H1") {
    return {
      start: `${year}-01-01T00:00:00.000Z`,
      end: `${year}-06-30T23:59:59.999Z`,
    }
  }
  return {
    start: `${year}-07-01T00:00:00.000Z`,
    end: `${year}-12-31T23:59:59.999Z`,
  }
}
