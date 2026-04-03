// PHASE_2_SCALES_V1
export type NationalScaleAnchor = {
  logro_pct: number
  score: number
}

// PHASE_2_SCALES_V1
// MVP por deciles (0..100) para interpolacion lineal.
export const NATIONAL_SCALE_TABLE_2026: {
  simce: NationalScaleAnchor[]
  paes: NationalScaleAnchor[]
} = {
  simce: [
    { logro_pct: 0, score: 0 },
    { logro_pct: 10, score: 40 },
    { logro_pct: 20, score: 80 },
    { logro_pct: 30, score: 120 },
    { logro_pct: 40, score: 160 },
    { logro_pct: 50, score: 200 },
    { logro_pct: 60, score: 240 },
    { logro_pct: 70, score: 280 },
    { logro_pct: 80, score: 320 },
    { logro_pct: 90, score: 360 },
    { logro_pct: 100, score: 400 },
  ],
  paes: [
    { logro_pct: 0, score: 100 },
    { logro_pct: 10, score: 190 },
    { logro_pct: 20, score: 280 },
    { logro_pct: 30, score: 370 },
    { logro_pct: 40, score: 460 },
    { logro_pct: 50, score: 550 },
    { logro_pct: 60, score: 640 },
    { logro_pct: 70, score: 730 },
    { logro_pct: 80, score: 820 },
    { logro_pct: 90, score: 910 },
    { logro_pct: 100, score: 1000 },
  ],
}
