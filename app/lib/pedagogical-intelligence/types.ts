// PHASE_1_METRICS_V1
export interface CourseStudentMetricInput {
  student_id: string
  total_score: number
  max_score: number
  total_logro_pct: number | null
  by_item: Array<{
    item_number: number
    is_correct: boolean | null
  }>
}

// PHASE_1_METRICS_V1
export interface StudentStatsRow {
  student_id: string
  total_logro_pct: number | null
  mean_logro_pct: number | null
  std_dev_sample: number | null
  z_score: number | null
}

// PHASE_1_METRICS_V1
export interface ItemDiscriminationRow {
  item_number: number
  upper_correct_rate: number
  lower_correct_rate: number
  d_index: number
  upper_group_size: number
  lower_group_size: number
}

// PHASE_1_METRICS_V1
export interface CourseQualityMetricsSnapshot {
  student_stats: StudentStatsRow[]
  item_discrimination: ItemDiscriminationRow[]
}
