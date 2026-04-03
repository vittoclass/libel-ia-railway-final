import type {
  CourseQualityMetricsSnapshot,
  CourseStudentMetricInput,
  ItemDiscriminationRow,
  StudentStatsRow,
} from "@/app/lib/pedagogical-intelligence/types"

// PHASE_1_METRICS_V1
export function mean(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return null
  return finite.reduce((acc, v) => acc + v, 0) / finite.length
}

// PHASE_1_METRICS_V1
export function sampleStdDev(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length < 2) return null
  const m = mean(finite)
  if (m == null) return null
  const variance = finite.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / (finite.length - 1)
  return Math.sqrt(variance)
}

// PHASE_1_METRICS_V1
export function zScore(value: number, m: number | null, sd: number | null): number | null {
  if (!Number.isFinite(value) || m == null || sd == null || sd <= 0) return null
  return (value - m) / sd
}

function sortByTotalScoreDesc(rows: CourseStudentMetricInput[]): CourseStudentMetricInput[] {
  return [...rows].sort((a, b) => {
    const as = Number(a.total_score) || 0
    const bs = Number(b.total_score) || 0
    if (bs !== as) return bs - as
    return a.student_id.localeCompare(b.student_id)
  })
}

// PHASE_1_METRICS_V1
export function computeStudentStats(rows: CourseStudentMetricInput[]): StudentStatsRow[] {
  const logrPctValues = rows
    .map((r) => r.total_logro_pct)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))

  const m = mean(logrPctValues)
  const sd = sampleStdDev(logrPctValues)

  return rows.map((r) => {
    const logrPct = typeof r.total_logro_pct === "number" && Number.isFinite(r.total_logro_pct) ? r.total_logro_pct : null
    const z = logrPct != null ? zScore(logrPct, m, sd) : null
    return {
      student_id: r.student_id,
      total_logro_pct: logrPct,
      mean_logro_pct: m,
      std_dev_sample: sd,
      z_score: z,
    }
  })
}

function safeRate(correctCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0
  return correctCount / totalCount
}

// PHASE_1_METRICS_V1
export function computeItemDiscrimination(rows: CourseStudentMetricInput[]): ItemDiscriminationRow[] {
  if (rows.length === 0) return []
  const sorted = sortByTotalScoreDesc(rows)
  const quartileSize = Math.max(1, Math.floor(sorted.length * 0.25))
  const upper = sorted.slice(0, quartileSize)
  const lower = sorted.slice(-quartileSize)
  const itemSet = new Set<number>()
  for (const s of sorted) {
    for (const item of s.by_item) itemSet.add(item.item_number)
  }

  const result: ItemDiscriminationRow[] = []
  for (const itemNumber of itemSet) {
    const upperCorrect = upper.reduce((acc, s) => {
      const hit = s.by_item.find((x) => x.item_number === itemNumber)
      return acc + (hit?.is_correct === true ? 1 : 0)
    }, 0)
    const lowerCorrect = lower.reduce((acc, s) => {
      const hit = s.by_item.find((x) => x.item_number === itemNumber)
      return acc + (hit?.is_correct === true ? 1 : 0)
    }, 0)
    const pUpper = safeRate(upperCorrect, upper.length)
    const pLower = safeRate(lowerCorrect, lower.length)
    result.push({
      item_number: itemNumber,
      upper_correct_rate: pUpper,
      lower_correct_rate: pLower,
      d_index: pUpper - pLower,
      upper_group_size: upper.length,
      lower_group_size: lower.length,
    })
  }

  return result.sort((a, b) => a.item_number - b.item_number)
}

// PHASE_1_METRICS_V1
export function buildCourseQualityMetrics(rows: CourseStudentMetricInput[]): CourseQualityMetricsSnapshot {
  return {
    student_stats: computeStudentStats(rows),
    item_discrimination: computeItemDiscrimination(rows),
  }
}
