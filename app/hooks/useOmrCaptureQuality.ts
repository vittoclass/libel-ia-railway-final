"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ANALYSIS_INTERVAL_MS,
  ANALYSIS_MAX_WIDTH,
  ANALYSIS_MAX_WIDTH_SLOW,
  MESSAGE_DEBOUNCE_MS,
} from "@/app/lib/omr-capture/constants"
import {
  detectBlackSquareMarkers,
  drawVideoFrameToWorkCanvas,
  type SheetQuad,
} from "@/app/lib/omr-capture/markerDetectV1"
import {
  analyzeFrame,
  messageForKey,
  pickDominantMessageKey,
  type DominantMessageKey,
  type QualityBreakdown,
} from "@/app/lib/omr-capture/omrCaptureQuality"
import {
  createTemporalFilter,
  resetTemporalFilter,
  setCapturingState,
  tickTemporalFilter,
  type CaptureUiState,
} from "@/app/lib/omr-capture/temporalFilter"

export type OmrCaptureQualitySnapshot = {
  score: number
  smoothScore: number
  breakdown: QualityBreakdown | null
  uiState: CaptureUiState
  greenLatched: boolean
  messageKey: DominantMessageKey
  message: string
  quad: SheetQuad | null
  markers: { x: number; y: number }[]
  workWidth: number
  workHeight: number
  shouldAutoCapture: boolean
}

const INITIAL_SNAPSHOT: OmrCaptureQualitySnapshot = {
  score: 0,
  smoothScore: 0,
  breakdown: null,
  uiState: "searching",
  greenLatched: false,
  messageKey: "find_markers",
  message: messageForKey("find_markers"),
  quad: null,
  markers: [],
  workWidth: 0,
  workHeight: 0,
  shouldAutoCapture: false,
}

type Options = {
  enabled: boolean
  active: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  onAutoCapture?: () => void
}

export function useOmrCaptureQuality({
  enabled,
  active,
  videoRef,
  onAutoCapture,
}: Options) {
  const [snapshot, setSnapshot] = useState<OmrCaptureQualitySnapshot>(INITIAL_SNAPSHOT)
  const temporalRef = useRef(createTemporalFilter())
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastMessageKeyRef = useRef<DominantMessageKey>("find_markers")
  const lastMessageChangeRef = useRef(0)
  const autoFiredRef = useRef(false)
  const slowModeRef = useRef(false)
  const frameTimesRef = useRef<number[]>([])

  const reset = useCallback(() => {
    resetTemporalFilter(temporalRef.current)
    autoFiredRef.current = false
    lastMessageKeyRef.current = "find_markers"
    setSnapshot(INITIAL_SNAPSHOT)
  }, [])

  const markCapturing = useCallback(() => {
    setCapturingState(temporalRef.current)
    autoFiredRef.current = true
    setSnapshot((s) => ({
      ...s,
      uiState: "capturing",
      messageKey: "ready_capture",
      message: messageForKey("ready_capture"),
      shouldAutoCapture: false,
    }))
  }, [])

  useEffect(() => {
    if (!enabled || !active) {
      reset()
      return
    }
    if (!workCanvasRef.current) {
      workCanvasRef.current = document.createElement("canvas")
    }

    let cancelled = false
    const timer = setInterval(() => {
      if (cancelled) return
      if (typeof document !== "undefined" && document.hidden) return

      const video = videoRef.current
      const work = workCanvasRef.current
      if (!video || !work || video.readyState < 2) return

      const t0 = performance.now()
      const maxW = slowModeRef.current ? ANALYSIS_MAX_WIDTH_SLOW : ANALYSIS_MAX_WIDTH
      const imageData = drawVideoFrameToWorkCanvas(video, work, maxW)
      if (!imageData) return

      const detection = detectBlackSquareMarkers(imageData)
      const temporal = temporalRef.current

      const analyzed = analyzeFrame(
        imageData,
        detection,
        video.videoWidth,
        temporal.stabilityScore10
      )

      const fullTick = tickTemporalFilter(temporal, {
        rawScore: analyzed.breakdown.total,
        markerCount: detection.markerCount,
        now: performance.now(),
      })

      const uiState = fullTick.uiState
      let messageKey = pickDominantMessageKey(analyzed.metrics, uiState)
      const now = performance.now()
      if (messageKey !== lastMessageKeyRef.current) {
        if (now - lastMessageChangeRef.current >= MESSAGE_DEBOUNCE_MS) {
          lastMessageKeyRef.current = messageKey
          lastMessageChangeRef.current = now
        } else {
          messageKey = lastMessageKeyRef.current
        }
      } else {
        lastMessageChangeRef.current = now
      }

      const shouldAutoCapture =
        fullTick.shouldAutoCapture && !autoFiredRef.current

      setSnapshot({
        score: analyzed.breakdown.total,
        smoothScore: fullTick.smoothScore,
        breakdown: analyzed.breakdown,
        uiState,
        greenLatched: fullTick.greenLatched,
        messageKey,
        message: messageForKey(messageKey),
        quad: detection.quad,
        markers: detection.markers,
        workWidth: detection.workWidth,
        workHeight: detection.workHeight,
        shouldAutoCapture,
      })

      const elapsed = performance.now() - t0
      frameTimesRef.current.push(elapsed)
      if (frameTimesRef.current.length > 8) frameTimesRef.current.shift()
      const avg =
        frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length
      slowModeRef.current = avg > 90

      if (shouldAutoCapture && onAutoCapture) {
        autoFiredRef.current = true
        onAutoCapture()
      }
    }, ANALYSIS_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, active, videoRef, onAutoCapture, reset])

  useEffect(() => {
    if (!active) reset()
  }, [active, reset])

  return { snapshot, reset, markCapturing }
}
