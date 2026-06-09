"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  cropImageFileFromUrl,
  defaultCropRect,
  isCustomCropRect,
  normalizeCropRect,
  type NormalizedCropRect,
} from "@/app/lib/development-crop/cropImageRegion"
import { emitDevelopmentCropDebug } from "@/app/lib/development-crop/flags"
import { Check, Crop, X } from "lucide-react"

type Props = {
  imageUrl: string
  open: boolean
  onConfirm: (file: File, rect: NormalizedCropRect, pixelSize: { width: number; height: number }) => void
  /** Omitir recorte: conserva imagen completa. */
  onSkip: () => void
}

type Point = { x: number; y: number }

function pointerToNormalized(
  clientX: number,
  clientY: number,
  container: DOMRect,
  displayW: number,
  displayH: number,
): Point {
  const x = (clientX - container.left) / displayW
  const y = (clientY - container.top) / displayH
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  }
}

/**
 * Overlay manual aislado para recorte de respuestas de desarrollo.
 * No comparte estado ni lógica con OMR.
 */
export function DevelopmentCropOverlay({ imageUrl, open, onConfirm, onSkip }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [cropRect, setCropRect] = useState<NormalizedCropRect | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<Point | null>(null)
  const [busy, setBusy] = useState(false)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!open) {
      setCropRect(null)
      setDragging(false)
      dragStartRef.current = null
      setBusy(false)
    }
  }, [open, imageUrl])

  const measureDisplay = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const img = wrap.querySelector("img")
    if (!img) return
    setDisplaySize({ w: img.clientWidth, h: img.clientHeight })
  }, [])

  useEffect(() => {
    if (!open) return
    measureDisplay()
    const onResize = () => measureDisplay()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open, imageUrl, measureDisplay])

  const onPointerDown = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current
      if (!wrap || displaySize.w < 1 || displaySize.h < 1) return
      const rect = wrap.getBoundingClientRect()
      const start = pointerToNormalized(clientX, clientY, rect, displaySize.w, displaySize.h)
      dragStartRef.current = start
      setDragging(true)
      setCropRect({ x: start.x, y: start.y, w: 0, h: 0 })
    },
    [displaySize.h, displaySize.w],
  )

  const onPointerMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragging || !dragStartRef.current) return
      const wrap = wrapRef.current
      if (!wrap || displaySize.w < 1 || displaySize.h < 1) return
      const rect = wrap.getBoundingClientRect()
      const cur = pointerToNormalized(clientX, clientY, rect, displaySize.w, displaySize.h)
      const s = dragStartRef.current
      const x1 = Math.min(s.x, cur.x)
      const y1 = Math.min(s.y, cur.y)
      const x2 = Math.max(s.x, cur.x)
      const y2 = Math.max(s.y, cur.y)
      setCropRect(normalizeCropRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }))
    },
    [dragging, displaySize.h, displaySize.w],
  )

  const onPointerUp = useCallback(() => {
    setDragging(false)
    setCropRect((prev) => {
      if (!prev || prev.w < 0.03 || prev.h < 0.03) return defaultCropRect()
      return prev
    })
  }, [])

  const handleConfirm = useCallback(async () => {
    const rect = normalizeCropRect(cropRect ?? defaultCropRect())
    setBusy(true)
    try {
      const result = await cropImageFileFromUrl(imageUrl, rect, `desarrollo-crop-${Date.now()}.jpg`)
      if (!result) return
      const custom = isCustomCropRect(rect)
      emitDevelopmentCropDebug("development_crop_confirmed", { custom })
      emitDevelopmentCropDebug("development_crop_dimensions", {
        normalized: rect,
        pixels: { width: result.width, height: result.height },
      })
      if (custom) emitDevelopmentCropDebug("development_crop_used", { rect })
      onConfirm(result.file, rect, { width: result.width, height: result.height })
    } finally {
      setBusy(false)
    }
  }, [cropRect, imageUrl, onConfirm])

  const handleSkip = useCallback(() => {
    emitDevelopmentCropDebug("development_crop_cancelled", { reason: "skip_full_image" })
    onSkip()
  }, [onSkip])

  if (!open) return null

  const boxStyle =
    cropRect && displaySize.w > 0 && displaySize.h > 0
      ? {
          left: `${cropRect.x * displaySize.w}px`,
          top: `${cropRect.y * displaySize.h}px`,
          width: `${cropRect.w * displaySize.w}px`,
          height: `${cropRect.h * displaySize.h}px`,
        }
      : undefined

  return (
    <div className="space-y-3 rounded-lg border border-violet-500/40 bg-violet-950/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-violet-100">
        <Crop className="h-4 w-4 shrink-0" aria-hidden />
        Recorte asistido de respuesta
      </div>
      <p className="text-xs text-violet-200/90">
        Arrastra un recuadro sobre la respuesta del estudiante. Solo se subirá el recorte confirmado.
      </p>

      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-md border border-slate-600 bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL local */}
        <img
          src={imageUrl}
          alt="Vista para recorte manual"
          className="block max-h-[45vh] w-full object-contain mx-auto"
          onLoad={measureDisplay}
        />
        <div
          className="absolute inset-0 touch-none cursor-crosshair"
          aria-label="Área de recorte manual"
          onMouseDown={(e) => {
            e.preventDefault()
            onPointerDown(e.clientX, e.clientY)
          }}
          onMouseMove={(e) => onPointerMove(e.clientX, e.clientY)}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          onTouchStart={(e) => {
            const t = e.touches[0]
            if (!t) return
            e.preventDefault()
            onPointerDown(t.clientX, t.clientY)
          }}
          onTouchMove={(e) => {
            const t = e.touches[0]
            if (!t) return
            e.preventDefault()
            onPointerMove(t.clientX, t.clientY)
          }}
          onTouchEnd={onPointerUp}
        >
          {boxStyle ? (
            <div
              className="pointer-events-none absolute border-2 border-violet-400 bg-violet-400/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
              style={boxStyle}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          className="flex-1 gap-2 bg-violet-600 hover:bg-violet-500 sm:min-w-[10rem]"
          disabled={busy || !cropRect}
          onClick={() => void handleConfirm()}
        >
          {busy ? (
            "Recortando…"
          ) : (
            <>
              <Check className="h-4 w-4" aria-hidden />
              Confirmar recorte
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="flex-1 gap-2 sm:min-w-[10rem]"
          disabled={busy}
          onClick={() => {
            setCropRect(null)
            dragStartRef.current = null
            setDragging(false)
          }}
        >
          Repetir recorte
        </Button>
        <Button type="button" variant="secondary" className="flex-1 gap-2 sm:min-w-[10rem]" disabled={busy} onClick={handleSkip}>
          <X className="h-4 w-4" aria-hidden />
          Omitir (imagen completa)
        </Button>
      </div>
    </div>
  )
}
