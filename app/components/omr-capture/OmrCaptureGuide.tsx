"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import type { OmrCaptureQualitySnapshot } from "@/app/hooks/useOmrCaptureQuality"
import type { CaptureUiState } from "@/app/lib/omr-capture/temporalFilter"

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  snapshot: OmrCaptureQualitySnapshot
  onCaptureAnyway: () => void
  captureDisabled?: boolean
}

function strokeColor(state: CaptureUiState, greenLatched: boolean): string {
  if (state === "ready" && greenLatched) return "rgba(34, 197, 94, 0.95)"
  if (state === "almost") return "rgba(234, 179, 8, 0.92)"
  return "rgba(248, 113, 113, 0.88)"
}

function mapWorkToDisplay(
  x: number,
  y: number,
  workW: number,
  workH: number,
  displayW: number,
  displayH: number,
  videoW: number,
  videoH: number
): { x: number; y: number } {
  const videoAspect = videoW / videoH
  const displayAspect = displayW / displayH
  let contentW: number
  let contentH: number
  let offsetX: number
  let offsetY: number
  if (videoAspect >= displayAspect) {
    contentW = displayW
    contentH = displayW / videoAspect
    offsetX = 0
    offsetY = (displayH - contentH) / 2
  } else {
    contentH = displayH
    contentW = displayH * videoAspect
    offsetX = (displayW - contentW) / 2
    offsetY = 0
  }
  const scaleX = contentW / workW
  const scaleY = contentH / workH
  return { x: offsetX + x * scaleX, y: offsetY + y * scaleY }
}

export function OmrCaptureGuide({
  videoRef,
  snapshot,
  onCaptureAnyway,
  captureDisabled,
}: Props) {
  const overlayRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let rafId = 0
    const draw = () => {
      const video = videoRef.current
      const canvas = overlayRef.current
      if (!video || !canvas) return
      const displayW = video.clientWidth
      const displayH = video.clientHeight
      if (displayW < 2 || displayH < 2) return
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (vw < 2 || vh < 2) return

      canvas.width = displayW
      canvas.height = displayH
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.clearRect(0, 0, displayW, displayH)

      const { workWidth: ww, workHeight: wh, quad, markers } = snapshot
      if (!quad || ww < 1 || wh < 1) return

      const color = strokeColor(snapshot.uiState, snapshot.greenLatched)
      const mapped = quad.map((p) =>
        mapWorkToDisplay(p.x, p.y, ww, wh, displayW, displayH, vw, vh)
      )

      ctx.beginPath()
      ctx.moveTo(mapped[0].x, mapped[0].y)
      for (let i = 1; i < mapped.length; i++) {
        ctx.lineTo(mapped[i].x, mapped[i].y)
      }
      ctx.closePath()
      ctx.fillStyle =
        snapshot.uiState === "ready" && snapshot.greenLatched
          ? "rgba(34, 197, 94, 0.1)"
          : snapshot.uiState === "almost"
            ? "rgba(234, 179, 8, 0.08)"
            : "rgba(248, 113, 113, 0.07)"
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      ctx.stroke()

      for (const m of markers) {
        const pt = mapWorkToDisplay(m.x, m.y, ww, wh, displayW, displayH, vw, vh)
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = "rgba(255,255,255,0.9)"
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    const loop = () => {
      draw()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [videoRef, snapshot])

  const barPct = Math.round(Math.min(100, Math.max(0, snapshot.smoothScore * 100)))
  const debug = snapshot.debug

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col">
      <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" aria-hidden />

      {debug ? (
        <div
          className="absolute top-2 left-2 z-10 max-w-[90%] rounded bg-black/75 px-2 py-1 text-[10px] font-mono text-emerald-200"
          aria-hidden
        >
          {debug.strictMarkerCount}/{debug.markerCount} · score {debug.score} · {debug.uiState}
          {debug.missingCorners.length > 0 ? ` · falta ${debug.missingCorners.join(",")}` : ""}
        </div>
      ) : null}

      <div className="mt-auto w-full space-y-2 px-3 pb-3 pt-8 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
            style={{ width: `${barPct}%` }}
          />
        </div>
        <p className="text-center text-sm font-medium text-white drop-shadow-md" aria-live="polite">
          {snapshot.message}
        </p>
      </div>

      <div className="absolute bottom-20 left-0 right-0 flex justify-center px-3 pointer-events-auto">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="bg-black/70 text-white border-white/20 hover:bg-black/85"
          disabled={captureDisabled}
          onClick={onCaptureAnyway}
        >
          Tomar igual
        </Button>
      </div>
    </div>
  )
}
