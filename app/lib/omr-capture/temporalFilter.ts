/**
 * Suavizado temporal e histéresis para evitar parpadeo verde/rojo.
 */

import {
  SMOOTH_ENTER_GREEN,
  SMOOTH_EXIT_GREEN,
  STABLE_ENTER_MS,
  STABLE_EXIT_MS,
} from "./constants"

export type CaptureUiState =
  | "searching"
  | "adjusting"
  | "almost"
  | "ready"
  | "capturing"
  | "review"

const EMA_ALPHA = 0.25

export type TemporalFilterState = {
  smoothScore: number
  uiState: CaptureUiState
  greenLatched: boolean
  readySince: number | null
  belowSince: number | null
  stabilityScore10: number
  recentRawGood: number
}

export function createTemporalFilter(): TemporalFilterState {
  return {
    smoothScore: 0,
    uiState: "searching",
    greenLatched: false,
    readySince: null,
    belowSince: null,
    stabilityScore10: 0,
    recentRawGood: 0,
  }
}

export function resetTemporalFilter(state: TemporalFilterState): void {
  state.smoothScore = 0
  state.uiState = "searching"
  state.greenLatched = false
  state.readySince = null
  state.belowSince = null
  state.stabilityScore10 = 0
  state.recentRawGood = 0
}

export type TickInput = {
  rawScore: number
  markerCount: number
  strictMarkerCount: number
  now: number
  frozen?: boolean
  extremelyBlurry?: boolean
}

export type TickOutput = {
  smoothScore: number
  uiState: CaptureUiState
  greenLatched: boolean
  shouldAutoCapture: boolean
  stabilityScore10: number
}

export function tickTemporalFilter(
  state: TemporalFilterState,
  input: TickInput
): TickOutput {
  if (input.frozen) {
    return {
      smoothScore: state.smoothScore,
      uiState: state.uiState,
      greenLatched: state.greenLatched,
      shouldAutoCapture: false,
      stabilityScore10: state.stabilityScore10,
    }
  }

  const rawNorm = input.rawScore / 100
  state.smoothScore = EMA_ALPHA * rawNorm + (1 - EMA_ALPHA) * state.smoothScore

  if (rawNorm >= 0.8 && input.strictMarkerCount === 4) {
    state.recentRawGood = Math.min(12, state.recentRawGood + 1)
  } else {
    state.recentRawGood = Math.max(0, state.recentRawGood - 1)
  }
  state.stabilityScore10 = Math.round((state.recentRawGood / 10) * 10)

  const { now } = input

  if (!state.greenLatched) {
    if (state.smoothScore >= SMOOTH_ENTER_GREEN && input.strictMarkerCount === 4) {
      if (state.readySince == null) state.readySince = now
      if (now - (state.readySince ?? now) >= STABLE_ENTER_MS) {
        state.greenLatched = true
        state.belowSince = null
      }
    } else {
      state.readySince = null
    }
  } else {
    if (state.smoothScore < SMOOTH_EXIT_GREEN || input.strictMarkerCount < 4) {
      if (state.belowSince == null) state.belowSince = now
      if (now - (state.belowSince ?? now) >= STABLE_EXIT_MS) {
        state.greenLatched = false
        state.readySince = null
      }
    } else {
      state.belowSince = null
    }
  }

  let uiState: CaptureUiState = "searching"

  if (input.extremelyBlurry && input.markerCount < 3) {
    uiState = "searching"
  } else if (input.markerCount < 2) {
    uiState = "searching"
  } else if (input.markerCount === 2) {
    uiState = "searching"
  } else if (state.greenLatched && input.strictMarkerCount === 4) {
    uiState = "ready"
  } else if (input.markerCount >= 3) {
    uiState = "almost"
  } else {
    uiState = "adjusting"
  }

  state.uiState = uiState

  const shouldAutoCapture =
    state.greenLatched &&
    uiState === "ready" &&
    input.strictMarkerCount === 4 &&
    rawNorm >= 0.88 &&
    state.stabilityScore10 >= 7

  return {
    smoothScore: state.smoothScore,
    uiState,
    greenLatched: state.greenLatched,
    shouldAutoCapture,
    stabilityScore10: state.stabilityScore10,
  }
}

export function setCapturingState(state: TemporalFilterState): void {
  state.uiState = "capturing"
}

export function setReviewState(state: TemporalFilterState): void {
  state.uiState = "review"
  state.greenLatched = false
  state.readySince = null
  state.belowSince = null
}
