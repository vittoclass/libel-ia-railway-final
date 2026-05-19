"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ANALYSIS_INTERVAL_MS,
  ANALYSIS_MAX_WIDTH,
  ANALYSIS_MAX_WIDTH_SLOW,
  MESSAGE_DEBOUNCE_MS,
} from "@/app/lib/omr-capture/constants"
import { drawVideoFrameToWorkCanvas } from "@/app/lib/omr-capture/markerDetectV1"
import { detectMarkersV2, type MarkerDetectV2Result } from "@/app/lib/omr-capture/markerDetectV2"
import {
  analyzeFrame,
  pickDominantMessageKey,
  resolveTeacherMessage,
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
import type { SheetQuad } from "@/app/lib/omr-capture/markerDetectV1"

export type OmrCaptureDebugInfo = {
  markerCount: number
  strictMarkerCount: number
  relaxedMarkerCount: number
  score: number
  smoothScore: number
  uiState: CaptureUiState
  missingCorners: string[]
  perspectiveError: number
  areaRatio: number
}

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
  debug?: OmrCaptureDebugInfo
}

const INITIAL_SNAPSHOT: OmrCaptureQualitySnapshot = {
  score: 0,
  smoothScore: 0,
  breakdown: null,
  uiState: "searching",
  greenLatched: false,
  messageKey: "find_sheet",
  message: "Encuadra la hoja en la pantalla",
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
  captureDebug?: boolean
  onAutoCapture?: () => void
}

export function useOmrCaptureQuality({
  enabled,
  active,
  videoRef,
  captureDebug = false,
  onAutoCapture,
}: Options) {
  const [snapshot, setSnapshot] = useState<OmrCaptureQualitySnapshot>(INITIAL_SNAPSHOT)
  const temporalRef = useRef(createTemporalFilter())
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastMessageRef = useRef("")
  const lastMessageChangeRef = useRef(0)
  const autoFiredRef = useRef(false)
  const slowModeRef = useRef(false)
  const frameTimesRef = useRef<number[]>([])
  const lastDetectionRef = useRef<MarkerDetectV2Result | null>(null)

  const reset = useCallback(() => {
    resetTemporalFilter(temporalRef.current)
    autoFiredRef.current = false
    lastMessageRef.current = ""
    lastDetectionRef.current = null
    setSnapshot(INITIAL_SNAPSHOT)
  }, [])

  const markCapturing = useCallback(() => {
    setCapturingState(temporalRef.current)
    autoFiredRef.current = true
    setSnapshot((s) => ({
      ...s,
      uiState: "capturing",
      messageKey: "ready_capture",
      message: "Perfecto, ya puedes sacar la foto",
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

      const detection = detectMarkersV2(imageData)
      lastDetectionRef.current = detection
      const temporal = temporalRef.current

      const analyzed = analyzeFrame(
        imageData,
        detection,
        video.videoWidth,
        temporal.stabilityScore10
      )

      const extremelyBlurry = analyzed.metrics.laplacianVariance < 30

      const fullTick = tickTemporalFilter(temporal, {
        rawScore: analyzed.breakdown.total,
        markerCount: detection.markerCount,
        strictMarkerCount: detection.strictMarkerCount,
        now: performance.now(),
        extremelyBlurry,
      })

      const uiState = fullTick.uiState
      let message = resolveTeacherMessage(analyzed.metrics, uiState, detection)

      const now = performance.now()
      if (message !== lastMessageRef.current) {
        if (now - lastMessageChangeRef.current >= MESSAGE_DEBOUNCE_MS) {
          lastMessageRef.current = message
          lastMessageChangeRef.current = now
        } else {
          message = lastMessageRef.current
        }
      } else {
        lastMessageChangeRef.current = now
      }

      const messageKey = pickDominantMessageKey(analyzed.metrics, uiState, detection)

      const shouldAutoCapture = fullTick.shouldAutoCapture && !autoFiredRef.current

      const debug: OmrCaptureDebugInfo | undefined = captureDebug
        ? {
            markerCount: detection.markerCount,
            strictMarkerCount: detection.strictMarkerCount,
            relaxedMarkerCount: detection.relaxedMarkerCount,
            score: analyzed.breakdown.total,
            smoothScore: Math.round(fullTick.smoothScore * 100),
            uiState,
            missingCorners: detection.quadAudit.missingCorners,
            perspectiveError: detection.perspectiveError,
            areaRatio: detection.areaRatio,
          }
        : undefined

      setSnapshot({
        score: analyzed.breakdown.total,
        smoothScore: fullTick.smoothScore,
        breakdown: analyzed.breakdown,
        uiState,
        greenLatched: fullTick.greenLatched,
        messageKey,
        message,
        quad: detection.quad,
        markers: detection.markers,
        workWidth: detection.workWidth,
        workHeight: detection.workHeight,
        shouldAutoCapture,
        debug,
      })

      const elapsed = performance.now() - t0
      frameTimesRef.current.push(elapsed)
      if (frameTimesRef.current.length > 8) frameTimesRef.current.shift()
      const avg =
        frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length
      slowModeRef.current = avg > 95

      if (shouldAutoCapture && onAutoCapture) {
        autoFiredRef.current = true
        onAutoCapture()
      }
    }, ANALYSIS_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, active, videoRef, onAutoCapture, reset, captureDebug])

  useEffect(() => {
    if (!active) reset()
  }, [active, reset])

  return { snapshot, reset, markCapturing }
}
