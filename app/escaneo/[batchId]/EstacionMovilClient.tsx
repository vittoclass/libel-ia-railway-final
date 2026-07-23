"use client"

/**
 * Captura por QR en /escaneo/[batchId]: batchId + GET /api/docente/batch-session/public.
 * Cámara solo tras gesto del usuario (getUserMedia).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Camera, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react"
import {
  MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT,
  MOBILE_CAPTURE_PAGE_CHOICES,
} from "@/app/lib/docente/mobile-scan-constants"
import { OmrCaptureGuide } from "@/app/components/omr-capture/OmrCaptureGuide"
import { useOmrCaptureQuality } from "@/app/hooks/useOmrCaptureQuality"
import {
  AUTO_CAPTURE_DELAY_MS,
  SCORE_AUTO_CAPTURE,
  SCORE_WARN_SEND,
} from "@/app/lib/omr-capture/constants"
import { dataUrlToJpegFile, validatePostCapture } from "@/app/lib/omr-capture/postCapture"
import { DevelopmentCropOverlay } from "@/app/components/development-crop/DevelopmentCropOverlay"
import {
  emitDevelopmentCropDebug,
  parseTipoPruebaFromQuery,
  shouldOfferDevelopmentManualCrop,
  type DevelopmentTipoPrueba,
} from "@/app/lib/development-crop/flags"
import {
  collaborativeMobileCursorStorageKey,
  collaborativeSlotDisplayName,
  parseCollaborativeLabelFromSearchParams,
  parseCollaborativeSlotFromSearchParams,
  type CollaborativeSlotLabel,
} from "@/app/lib/docente/collaborative-capture"
import { isCustomCropRect, type NormalizedCropRect } from "@/app/lib/development-crop/cropImageRegion"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const OMR_CAPTURE_GUIDE_ENABLED = process.env.NEXT_PUBLIC_OMR_CAPTURE_GUIDE === "1"

const MOBILE_CURSOR_KEY_PREFIX = "libelia_mobile_capture_cursor_v1:"
const MOBILE_CAPTURE_DEV = process.env.NODE_ENV === "development"
/** Marcador local: este QR colaborativo ya envió todas sus fotos. */
const COLLAB_SLOT_DONE_PREFIX = "libelia_mobile_collab_slot_done_v1:"

type MobileCaptureCursor = {
  batchId: string
  studentIndex: number
  pageIndex: number
  imagesPerStudent: number
  updatedAt: string
}

function mobileCursorStorageKey(batchId: string, lockedSlot: number | null): string {
  if (lockedSlot != null) return collaborativeMobileCursorStorageKey(batchId, lockedSlot)
  return `${MOBILE_CURSOR_KEY_PREFIX}${batchId}`
}

function collabSlotDoneKey(batchId: string, slot: number): string {
  return `${COLLAB_SLOT_DONE_PREFIX}${batchId}:s${slot}`
}

function readCollabSlotDone(batchId: string, slot: number): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(collabSlotDoneKey(batchId, slot)) === "1"
  } catch {
    return false
  }
}

function writeCollabSlotDone(batchId: string, slot: number): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(collabSlotDoneKey(batchId, slot), "1")
  } catch {
    /* ignore */
  }
}

function clearCollabSlotDone(batchId: string, slot: number): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(collabSlotDoneKey(batchId, slot))
  } catch {
    /* ignore */
  }
}

function readMobileCaptureCursor(batchId: string, lockedSlot: number | null): MobileCaptureCursor | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(mobileCursorStorageKey(batchId, lockedSlot))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MobileCaptureCursor>
    const studentIndex =
      typeof parsed.studentIndex === "number" ? Math.floor(parsed.studentIndex) : Number.NaN
    const pageIndex = typeof parsed.pageIndex === "number" ? Math.floor(parsed.pageIndex) : Number.NaN
    const imagesPerStudent =
      typeof parsed.imagesPerStudent === "number" ? Math.floor(parsed.imagesPerStudent) : Number.NaN
    if (studentIndex < 1 || pageIndex < 1 || imagesPerStudent < 1) return null
    return {
      batchId,
      studentIndex,
      pageIndex,
      imagesPerStudent,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function writeMobileCaptureCursor(cursor: MobileCaptureCursor, lockedSlot: number | null): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(mobileCursorStorageKey(cursor.batchId, lockedSlot), JSON.stringify(cursor))
    if (MOBILE_CAPTURE_DEV) {
      console.log("[mobile-capture] saved cursor", cursor, { lockedSlot })
    }
  } catch {
    // quota / private mode
  }
}

function clearMobileCaptureCursor(batchId: string, lockedSlot: number | null): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(mobileCursorStorageKey(batchId, lockedSlot))
    if (MOBILE_CAPTURE_DEV) {
      console.log("[mobile-capture] reset local cursor", { batchId, lockedSlot })
    }
  } catch {
    // ignore
  }
}

type Phase = "pages" | "scanner" | "slot_done"

type Props = {
  batchId: string
}

function formatCameraError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError") return "Error: Permiso denegado"
    if (e.name === "NotFoundError") return "Error: No se encontró ninguna cámara"
    if (e.name === "NotReadableError") return "Error: La cámara está en uso por otra aplicación"
    if (e.name === "OverconstrainedError") return "Error: La cámara no cumple los requisitos pedidos"
    return `Error: ${e.message || e.name}`
  }
  if (e instanceof Error) return `Error: ${e.message}`
  return `Error: ${String(e)}`
}

export function EstacionMovilClient({ batchId }: Props) {
  const [captureDebug, setCaptureDebug] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const autoCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [phase, setPhase] = useState<Phase>("pages")
  const [captureSessionActive, setCaptureSessionActive] = useState(false)
  const [scannerActive, setScannerActive] = useState(false)
  const [imagesPerStudent, setImagesPerStudent] = useState(2)
  const [studentIndex, setStudentIndex] = useState(1)
  const [pageIndex, setPageIndex] = useState(1)
  const persistedCursorRef = useRef(false)
  /** Slot fijado por QR colaborativo (?s=N). null = flujo tradicional. */
  const [lockedSlot, setLockedSlot] = useState<number | null>(null)
  const [slotLabel, setSlotLabel] = useState<CollaborativeSlotLabel>("profesor")
  const [urlParamsReady, setUrlParamsReady] = useState(false)

  const [batchGateOk, setBatchGateOk] = useState<boolean | null>(null)
  const [batchGateError, setBatchGateError] = useState<string | null>(null)
  const [publicApiDebug, setPublicApiDebug] = useState<unknown>(null)
  const [pcExpectedPages, setPcExpectedPages] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [lastOk, setLastOk] = useState<string | null>(null)
  const [photosSentCount, setPhotosSentCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cameraActivationError, setCameraActivationError] = useState<string | null>(null)
  const [cameraErrorName, setCameraErrorName] = useState<string | null>(null)
  const [activatingCamera, setActivatingCamera] = useState(false)
  const [boundStream, setBoundStream] = useState<MediaStream | null>(null)
  const [pendingPreview, setPendingPreview] = useState<{ url: string; file: File } | null>(null)
  const [shutterCooldown, setShutterCooldown] = useState(false)
  const [postCaptureScore, setPostCaptureScore] = useState<number | null>(null)
  const [postCaptureMessage, setPostCaptureMessage] = useState<string | null>(null)
  const [validatingCapture, setValidatingCapture] = useState(false)
  const [tipoPrueba, setTipoPrueba] = useState<DevelopmentTipoPrueba | null>(null)
  const [developmentCropStepOpen, setDevelopmentCropStepOpen] = useState(false)
  const [developmentCropStepDone, setDevelopmentCropStepDone] = useState(false)
  const [developmentCropUsed, setDevelopmentCropUsed] = useState(false)
  /** Imagen completa capturada; permite repetir recorte tras confirmar un subrecorte. */
  const [developmentCropSourcePreview, setDevelopmentCropSourcePreview] = useState<{ url: string; file: File } | null>(
    null,
  )

  const batchOk = UUID_REGEX.test(batchId.trim())
  const developmentManualCropActive = shouldOfferDevelopmentManualCrop(tipoPrueba)

  const clearPostCapture = useCallback(() => {
    setPostCaptureScore(null)
    setPostCaptureMessage(null)
    setValidatingCapture(false)
  }, [])

  const stopStream = useCallback(() => {
    setBoundStream(null)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const v = videoRef.current
    if (v) {
      v.srcObject = null
    }
    setScannerActive(false)
    if (autoCaptureTimerRef.current) {
      clearTimeout(autoCaptureTimerRef.current)
      autoCaptureTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (autoCaptureTimerRef.current) clearTimeout(autoCaptureTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    setCaptureDebug(params.get("captureDebug") === "1")
    setTipoPrueba(parseTipoPruebaFromQuery(params.get("tipo")))
    setLockedSlot(parseCollaborativeSlotFromSearchParams(params))
    setSlotLabel(parseCollaborativeLabelFromSearchParams(params))
    setUrlParamsReady(true)
  }, [])

  useEffect(() => {
    if (!urlParamsReady) return
    persistedCursorRef.current = false
    setCaptureSessionActive(false)

    const slot = lockedSlot
    if (slot != null && readCollabSlotDone(batchId, slot)) {
      setStudentIndex(slot)
      setPageIndex(1)
      setImagesPerStudent(2)
      setPhase("slot_done")
      setCaptureSessionActive(false)
      return
    }

    const cursor = readMobileCaptureCursor(batchId, slot)
    if (cursor) {
      const restoredIndex = slot != null ? slot : cursor.studentIndex
      setStudentIndex(restoredIndex)
      setPageIndex(cursor.pageIndex)
      setImagesPerStudent(cursor.imagesPerStudent)
      setPhase("scanner")
      setCaptureSessionActive(true)
      persistedCursorRef.current = true
      if (MOBILE_CAPTURE_DEV) {
        console.log("[mobile-capture] restored cursor", cursor, { lockedSlot: slot })
      }
    } else {
      setStudentIndex(slot != null ? slot : 1)
      setPageIndex(1)
      setImagesPerStudent(2)
      setPhase("pages")
    }
  }, [batchId, lockedSlot, urlParamsReady])

  useEffect(() => {
    if (!batchOk || !captureSessionActive) return
    if (phase === "slot_done") return
    writeMobileCaptureCursor(
      {
        batchId,
        studentIndex: lockedSlot != null ? lockedSlot : studentIndex,
        pageIndex,
        imagesPerStudent,
        updatedAt: new Date().toISOString(),
      },
      lockedSlot,
    )
  }, [batchId, batchOk, captureSessionActive, studentIndex, pageIndex, imagesPerStudent, lockedSlot, phase])

  useEffect(() => {
    if (developmentManualCropActive) {
      emitDevelopmentCropDebug("development_crop_enabled", { tipoPrueba })
    }
  }, [developmentManualCropActive, tipoPrueba])

  useEffect(() => {
    if (!scannerActive || !boundStream) return
    const el = videoRef.current
    if (!el) return

    el.srcObject = boundStream
    el.muted = true
    el.setAttribute("playsinline", "")
    el.setAttribute("webkit-playsinline", "true")

    const tryPlay = () => {
      void el.play().catch(() => {})
    }

    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      tryPlay()
    } else {
      el.addEventListener("loadedmetadata", tryPlay, { once: true })
    }

    return () => {
      el.removeEventListener("loadedmetadata", tryPlay)
    }
  }, [scannerActive, boundStream, pendingPreview])

  const validateBatchGate = useCallback(async () => {
    if (!batchOk) {
      setBatchGateOk(false)
      setBatchGateError("Enlace no válido.")
      setPublicApiDebug({
        source: "EstacionMovilClient",
        step: "uuid_regex",
        batchId,
        message: "El batchId de la URL no pasó la validación UUID en el cliente.",
      })
      return
    }
    setBatchGateError(null)
    setPublicApiDebug(null)
    const url = `/api/docente/batch-session/public?batch_id=${encodeURIComponent(batchId)}`
    try {
      const res = await fetch(url, { cache: "no-store" })
      const text = await res.text()
      let parsed: unknown
      try {
        parsed = text ? JSON.parse(text) : {}
      } catch {
        parsed = { _parseError: true, rawBody: text }
      }
      const body = parsed as { ok?: boolean; error?: string; expected_pages_per_student?: number }
      if (!res.ok || !body?.ok) {
        setPcExpectedPages(null)
        setBatchGateOk(false)
        setBatchGateError(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`)
        setPublicApiDebug({
          source: "EstacionMovilClient",
          endpoint: "GET /api/docente/batch-session/public",
          httpStatus: res.status,
          requestUrl: url,
          batchId,
          body: parsed,
        })
        return
      }
      setBatchGateOk(true)
      setPublicApiDebug(null)
      const rawEp = body.expected_pages_per_student
      const ep =
        typeof rawEp === "number" && Number.isFinite(rawEp)
          ? Math.max(1, Math.min(50, Math.floor(rawEp)))
          : 2
      setPcExpectedPages(ep)
      if (!persistedCursorRef.current) {
        setImagesPerStudent(Math.min(MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT, ep))
      }
    } catch (e) {
      setPcExpectedPages(null)
      setBatchGateOk(false)
      setBatchGateError("Sin conexión. Intente de nuevo.")
      setPublicApiDebug({
        source: "EstacionMovilClient",
        endpoint: "GET /api/docente/batch-session/public",
        networkOrFetch: true,
        batchId,
        requestUrl: url,
        exception: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
      })
    }
  }, [batchId, batchOk])

  useEffect(() => {
    void validateBatchGate()
  }, [validateBatchGate])

  const goToScanner = useCallback(
    (n: number) => {
      if (n < 1 || n > MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT) return
      stopStream()
      setPendingPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url)
        return null
      })
      clearPostCapture()
      setCaptureSessionActive(true)
      setImagesPerStudent(n)
      setPageIndex(1)
      if (lockedSlot != null) setStudentIndex(lockedSlot)
      setPhase("scanner")
      setError(null)
      setLastOk(null)
      setCameraActivationError(null)
      setCameraErrorName(null)
    },
    [stopStream, clearPostCapture, lockedSlot],
  )

  const activateScanner = useCallback(async () => {
    setCameraActivationError(null)
    setCameraErrorName(null)
    stopStream()

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraErrorName("getUserMediaMissing")
      setCameraActivationError("Este navegador no expone getUserMedia (requiere HTTPS o localhost).")
      return
    }

    setActivatingCamera(true)
    let stream: MediaStream | null = null
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        })
      }

      streamRef.current = stream
      setBoundStream(stream)
      setScannerActive(true)
    } catch (e) {
      const name =
        e instanceof DOMException ? e.name : e instanceof Error ? e.name : typeof e === "object" && e && "name" in e ? String((e as { name: string }).name) : "Error"
      setCameraErrorName(name)
      setCameraActivationError(formatCameraError(e))
    } finally {
      setActivatingCamera(false)
    }
  }, [stopStream])

  const uploadFile = useCallback(
    async (file: File): Promise<boolean> => {
      setUploading(true)
      setError(null)
      setLastOk(null)
      const maxAttempts = 3
      const retryableStatus = (status: number) => status >= 500 || status === 408 || status === 429
      const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) await sleep(800)
          try {
            const fd = new FormData()
            fd.set("batch_id", batchId)
            fd.set("student_index", String(lockedSlot != null ? lockedSlot : studentIndex))
            fd.set("page_index", String(pageIndex))
            fd.set("file", file)

            const res = await fetch("/api/docente/movil-upload", { method: "POST", body: fd })
            const j = await res.json().catch(() => ({}))
            if (!res.ok) {
              const msg = typeof j?.error === "string" ? j.error : "Error al subir"
              if (retryableStatus(res.status) && attempt < maxAttempts - 1) {
                continue
              }
              setError(msg)
              return false
            }

            setPhotosSentCount((c) => {
              const next = c + 1
              setLastOk(`Foto subida correctamente. Foto ${next} enviada.`)
              return next
            })

            if (pageIndex < imagesPerStudent) {
              setPageIndex((p) => p + 1)
            } else if (lockedSlot != null) {
              // Captura colaborativa: este QR termina aquí. NO avanzar al siguiente alumno.
              writeCollabSlotDone(batchId, lockedSlot)
              clearMobileCaptureCursor(batchId, lockedSlot)
              setCaptureSessionActive(false)
              stopStream()
              setPhase("slot_done")
              setLastOk("✔ Captura recibida. Este QR ya terminó.")
            } else {
              setStudentIndex((s) => s + 1)
              setPageIndex(1)
            }
            return true
          } catch (err) {
            if (attempt < maxAttempts - 1) continue
            setError(err instanceof Error ? err.message : "Error al subir")
            return false
          }
        }
        setError("No se pudo subir tras varios intentos.")
        return false
      } finally {
        setUploading(false)
      }
    },
    [batchId, studentIndex, pageIndex, imagesPerStudent, lockedSlot, stopStream],
  )

  const revokePreview = useCallback((url: string | undefined) => {
    if (url) URL.revokeObjectURL(url)
  }, [])

  const discardPendingPreview = useCallback(() => {
    if (uploading) {
      const ok = window.confirm(
        "La foto se está subiendo. Esto no cancela el envío al servidor. ¿Ocultar solo la previsualización?",
      )
      if (!ok) return
    }
    setPendingPreview((prev) => {
      if (prev?.url) revokePreview(prev.url)
      return null
    })
    setDevelopmentCropStepOpen(false)
    setDevelopmentCropStepDone(false)
    setDevelopmentCropUsed(false)
    setDevelopmentCropSourcePreview((prev) => {
      if (prev?.url) revokePreview(prev.url)
      return null
    })
    clearPostCapture()
  }, [uploading, revokePreview, clearPostCapture])

  const captureToPreviewRef = useRef<(mode?: "auto" | "manual") => Promise<void>>(async () => {})

  const { snapshot, reset: resetQuality, markCapturing } = useOmrCaptureQuality({
    enabled: OMR_CAPTURE_GUIDE_ENABLED,
    active: scannerActive && !pendingPreview && phase === "scanner",
    videoRef,
    captureDebug,
    onAutoCapture: () => {
      if (autoCaptureTimerRef.current) return
      markCapturing()
      autoCaptureTimerRef.current = setTimeout(() => {
        autoCaptureTimerRef.current = null
        void captureToPreviewRef.current("auto")
      }, AUTO_CAPTURE_DELAY_MS)
    },
  })

  const captureToPreview = useCallback(
    async (mode: "auto" | "manual" = "manual") => {
      const video = videoRef.current
      if (!video || !batchOk || batchGateOk !== true || shutterCooldown) return
      const w = video.videoWidth
      const h = video.videoHeight
      if (w < 2 || h < 2) {
        setError("La cámara aún no tiene imagen. Espere un segundo e intente de nuevo.")
        return
      }

      if (OMR_CAPTURE_GUIDE_ENABLED) {
        markCapturing()
      }

      setError(null)

      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        setError("No se pudo preparar la captura.")
        return
      }
      ctx.drawImage(video, 0, 0)

      const dataUrl = canvas.toDataURL("image/jpeg", 0.92)

      setShutterCooldown(true)
      window.setTimeout(() => setShutterCooldown(false), 1000)

      let file: File
      let url: string
      let previewMessage: string | null = null
      let previewScore: number | null = null

      if (OMR_CAPTURE_GUIDE_ENABLED) {
        setValidatingCapture(true)
        try {
          const validation = await validatePostCapture(dataUrl, w)
          previewScore = validation.score
          previewMessage = validation.message
          const uploadDataUrl =
            validation.warpedDataUrl && validation.score >= SCORE_WARN_SEND
              ? validation.warpedDataUrl
              : dataUrl
          const warpedFile = await dataUrlToJpegFile(uploadDataUrl, `capture-${Date.now()}.jpg`)
          if (warpedFile) {
            file = warpedFile
            url = URL.createObjectURL(warpedFile)
          } else {
            const blob = await (await fetch(dataUrl)).blob()
            file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" })
            url = URL.createObjectURL(blob)
          }
        } finally {
          setValidatingCapture(false)
        }
      } else {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
        })
        if (!blob) {
          setError("No se pudo generar la foto.")
          return
        }
        file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" })
        url = URL.createObjectURL(blob)
      }

      setPostCaptureScore(previewScore)
      setPostCaptureMessage(previewMessage)
      resetQuality()

      setDevelopmentCropStepDone(false)
      setDevelopmentCropUsed(false)
      setDevelopmentCropStepOpen(developmentManualCropActive)
      setDevelopmentCropSourcePreview((prev) => {
        if (prev?.url) revokePreview(prev.url)
        return developmentManualCropActive ? { url, file } : null
      })

      setPendingPreview((prev) => {
        if (prev?.url) revokePreview(prev.url)
        return { url, file }
      })
    },
    [
      batchOk,
      batchGateOk,
      shutterCooldown,
      revokePreview,
      markCapturing,
      resetQuality,
      developmentManualCropActive,
    ],
  )

  captureToPreviewRef.current = captureToPreview

  const submitPendingPreview = useCallback(async () => {
    if (!pendingPreview) return
    if (developmentManualCropActive && developmentCropStepOpen && !developmentCropStepDone) return

    const { file, url } = pendingPreview
    const ok = await uploadFile(file)
    if (ok) {
      if (developmentCropUsed) {
        emitDevelopmentCropDebug("development_crop_sent_to_ocr", {
          note: "subimagen subida vía movil-upload; OCR posterior en evaluate sin cambios de ruta",
        })
      }
      revokePreview(url)
      setPendingPreview(null)
      setDevelopmentCropStepOpen(false)
      setDevelopmentCropStepDone(false)
      setDevelopmentCropUsed(false)
      setDevelopmentCropSourcePreview((prev) => {
        if (prev?.url) revokePreview(prev.url)
        return null
      })
      clearPostCapture()
    }
  }, [
    pendingPreview,
    uploadFile,
    revokePreview,
    clearPostCapture,
    developmentManualCropActive,
    developmentCropStepOpen,
    developmentCropStepDone,
    developmentCropUsed,
  ])

  const handleDevelopmentCropConfirm = useCallback(
    (croppedFile: File, rect: NormalizedCropRect, pixelSize: { width: number; height: number }) => {
      setPendingPreview((prev) => {
        if (!prev) return prev
        if (prev.url) revokePreview(prev.url)
        const url = URL.createObjectURL(croppedFile)
        return { url, file: croppedFile }
      })
      setDevelopmentCropStepOpen(false)
      setDevelopmentCropStepDone(true)
      setDevelopmentCropUsed(isCustomCropRect(rect))
      emitDevelopmentCropDebug("development_crop_dimensions", {
        normalized: rect,
        pixels: pixelSize,
        phase: "confirm_replace_preview",
      })
    },
    [revokePreview],
  )

  const handleDevelopmentCropSkip = useCallback(() => {
    setDevelopmentCropStepOpen(false)
    setDevelopmentCropStepDone(true)
    setDevelopmentCropUsed(false)
  }, [])

  const handleDevelopmentCropRedo = useCallback(() => {
    const source = developmentCropSourcePreview
    if (!source) return
    setPendingPreview((prev) => {
      if (prev?.url && prev.url !== source.url) revokePreview(prev.url)
      return { url: source.url, file: source.file }
    })
    setDevelopmentCropStepOpen(true)
    setDevelopmentCropStepDone(false)
    setDevelopmentCropUsed(false)
  }, [developmentCropSourcePreview, revokePreview])

  useEffect(() => {
    setPhotosSentCount(0)
  }, [batchId])

  useEffect(() => {
    if (!lastOk) return
    const t = window.setTimeout(() => setLastOk(null), 4500)
    return () => window.clearTimeout(t)
  }, [lastOk])

  const resetLocalCaptureCursor = useCallback(() => {
    const ok = window.confirm(
      lockedSlot != null
        ? "¿Reiniciar este código?\n\nEsto solo reinicia el contador de este celular. No borra fotos ya subidas."
        : "¿Reiniciar captura de este lote?\n\nEsto solo reinicia el contador de este celular. No borra fotos ya subidas.",
    )
    if (!ok) return
    clearMobileCaptureCursor(batchId, lockedSlot)
    if (lockedSlot != null) clearCollabSlotDone(batchId, lockedSlot)
    persistedCursorRef.current = false
    setStudentIndex(lockedSlot != null ? lockedSlot : 1)
    setPageIndex(1)
    setCaptureSessionActive(false)
    setPhase("pages")
    setLastOk(null)
    setError(null)
  }, [batchId, lockedSlot])

  const backToPages = useCallback(() => {
    stopStream()
    setPhase("pages")
    setCameraActivationError(null)
    setCameraErrorName(null)
    setError(null)
    setPendingPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return null
    })
    setDevelopmentCropStepOpen(false)
    setDevelopmentCropStepDone(false)
    setDevelopmentCropUsed(false)
    setDevelopmentCropSourcePreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return null
    })
    clearPostCapture()
    resetQuality()
  }, [stopStream, clearPostCapture, resetQuality])

  if (!batchOk) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-slate-100">
        <p className="text-sm text-amber-200 text-center">Este enlace no es válido. Escanee el código desde la estación PC.</p>
      </main>
    )
  }

  if (batchGateOk === null) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-6 text-slate-100 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" aria-hidden />
        <p className="text-sm text-slate-400">Comprobando lote…</p>
      </main>
    )
  }

  if (batchGateOk === false) {
    return (
      <main className="min-h-screen flex flex-col bg-slate-950 p-4 text-slate-100 gap-4">
        {publicApiDebug != null ? (
          <div
            className="rounded-lg border-4 border-black bg-red-600 p-4 text-white shadow-2xl shrink-0"
            style={{ fontFamily: "ui-monospace, monospace" }}
          >
            <div className="text-xl font-black uppercase tracking-wide mb-2">DEBUG GET /public — sin filtros</div>
            <pre className="text-xs sm:text-sm whitespace-pre-wrap break-all overflow-x-auto max-h-[55vh] overflow-y-auto">
              {JSON.stringify(publicApiDebug, null, 2)}
            </pre>
          </div>
        ) : null}
        <div className="flex flex-col items-center justify-center gap-3 flex-1 px-2">
          <AlertCircle className="h-10 w-10 text-amber-400" aria-hidden />
          <p className="text-sm text-center text-amber-100 max-w-sm font-medium">{batchGateError ?? "Lote no disponible."}</p>
          <Button type="button" variant="secondary" className="mt-2" onClick={() => void validateBatchGate()}>
            Reintentar
          </Button>
        </div>
      </main>
    )
  }

  const guideActive = OMR_CAPTURE_GUIDE_ENABLED && scannerActive && !pendingPreview
  const displaySlotName =
    lockedSlot != null ? collaborativeSlotDisplayName(lockedSlot, slotLabel) : null

  if (phase === "slot_done" && lockedSlot != null) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-6 text-slate-100 gap-5">
        <CheckCircle2 className="h-16 w-16 text-emerald-400" aria-hidden />
        <div className="text-center space-y-2 max-w-sm">
          <p className="text-2xl font-bold text-emerald-200">✔ Captura recibida</p>
          <p className="text-lg font-semibold text-slate-100">{displaySlotName}</p>
          <p className="text-sm text-slate-400">Este QR ya terminó. No escanee otro código desde aquí.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="text-slate-500" onClick={resetLocalCaptureCursor}>
          Reiniciar este código
        </Button>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col bg-slate-950 text-slate-100 p-4 pb-12">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col gap-6 pt-6">
        {phase === "pages" ? (
          <div className="space-y-6 flex-1 flex flex-col justify-center">
            {displaySlotName ? (
              <p className="text-center text-2xl font-bold text-indigo-200">{displaySlotName}</p>
            ) : null}
            <p className="text-center text-sm font-medium text-slate-200">
              {lockedSlot != null
                ? `Cantidad de fotos (hasta ${MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT})`
                : `Paso 1: ¿Cuántas fotos por alumno? (hasta ${MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT})`}
            </p>
            {pcExpectedPages != null && pcExpectedPages > MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT ? (
              <p className="text-center text-xs text-amber-300/95 px-1">
                La estación PC indica <strong>{pcExpectedPages}</strong> foto{pcExpectedPages !== 1 ? "s" : ""} por alumno;
                aquí puede elegir como máximo {MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT}. Ajuste el número en la estación o
                reparta en más de un lote.
              </p>
            ) : pcExpectedPages != null ? (
              <p className="text-center text-xs text-slate-500 px-1">
                Sugerido según estación PC: <strong>{pcExpectedPages}</strong> (puede cambiar antes de capturar).
              </p>
            ) : null}
            <div className="grid grid-cols-4 gap-2 sm:gap-3 sm:grid-cols-7">
              {MOBILE_CAPTURE_PAGE_CHOICES.map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={imagesPerStudent === n ? "default" : "secondary"}
                  className="h-14 sm:h-16 text-lg sm:text-xl font-semibold min-w-0 px-1"
                  onClick={() => goToScanner(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 flex-1 flex flex-col">
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2.5 text-center space-y-0.5">
              <p className="text-sm font-semibold text-slate-100">
                {lockedSlot != null ? (
                  <span className="text-indigo-300 text-lg">{displaySlotName}</span>
                ) : (
                  <>
                    Alumno actual: <span className="text-indigo-300">{studentIndex}</span>
                  </>
                )}
              </p>
              <p className="text-sm text-slate-300">
                Página actual:{" "}
                <span className="font-medium text-indigo-200">
                  {pageIndex} de {imagesPerStudent}
                </span>
              </p>
            </div>

            {!scannerActive ? (
              <>
                <p className="text-center text-sm font-medium text-slate-200">Paso 2: Presiona &quot;Activar escáner&quot;.</p>
                <Button
                  type="button"
                  size="lg"
                  className="w-full min-h-[4.5rem] text-lg font-bold gap-2 bg-indigo-600 hover:bg-indigo-500 px-4 py-6 h-auto whitespace-normal leading-tight"
                  disabled={activatingCamera}
                  onClick={() => void activateScanner()}
                >
                  {activatingCamera ? (
                    <>
                      <Loader2 className="h-7 w-7 shrink-0 animate-spin" aria-hidden />
                      Abriendo cámara…
                    </>
                  ) : (
                    <>📷 ACTIVAR ESCÁNER</>
                  )}
                </Button>
                {cameraErrorName ? (
                  <p
                    className="text-center text-3xl sm:text-4xl font-black text-red-500 px-2 leading-tight tracking-tight"
                    role="alert"
                  >
                    {cameraErrorName}
                  </p>
                ) : null}
                {cameraActivationError ? (
                  <p className="text-center text-sm text-red-400 px-2" role="alert">
                    {cameraActivationError}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-center text-sm font-medium text-indigo-200">
                  {validatingCapture
                    ? "Validando foto…"
                    : pendingPreview
                      ? "Revisa la foto. Enviála o descartala con la X."
                      : OMR_CAPTURE_GUIDE_ENABLED
                        ? "Encuadra la hoja. La guía te indicará cuándo capturar."
                        : "Paso 3: Dispara la foto."}
                </p>
                <div className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-black aspect-[3/4] max-h-[55vh]">
                  {pendingPreview ? (
                    <div className="relative h-full w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL local */}
                      <img src={pendingPreview.url} alt="" className="h-full w-full object-contain" />
                      <button
                        type="button"
                        className="absolute top-2 right-2 z-10 flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/75 text-white shadow-lg ring-1 ring-white/25 active:bg-black/90"
                        onClick={discardPendingPreview}
                        aria-label="Descartar foto"
                      >
                        <X className="h-6 w-6" strokeWidth={2.5} aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        className={
                          OMR_CAPTURE_GUIDE_ENABLED
                            ? "h-full w-full object-contain"
                            : "h-full w-full object-cover"
                        }
                        playsInline
                        muted
                        autoPlay
                      />
                      {guideActive ? (
                        <OmrCaptureGuide
                          videoRef={videoRef}
                          snapshot={snapshot}
                          captureDisabled={shutterCooldown || validatingCapture}
                          onCaptureAnyway={() => void captureToPreview("manual")}
                        />
                      ) : null}
                    </>
                  )}
                </div>

                {pendingPreview && developmentCropStepOpen ? (
                  <DevelopmentCropOverlay
                    imageUrl={pendingPreview.url}
                    open={developmentCropStepOpen}
                    onConfirm={handleDevelopmentCropConfirm}
                    onSkip={handleDevelopmentCropSkip}
                  />
                ) : null}

                {pendingPreview &&
                developmentManualCropActive &&
                developmentCropStepDone &&
                !developmentCropStepOpen &&
                developmentCropSourcePreview ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={uploading}
                    onClick={handleDevelopmentCropRedo}
                  >
                    Repetir recorte
                  </Button>
                ) : null}

                {pendingPreview && postCaptureMessage ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      postCaptureScore != null && postCaptureScore >= SCORE_AUTO_CAPTURE
                        ? "border-emerald-600/50 bg-emerald-950/50 text-emerald-100"
                        : postCaptureScore != null && postCaptureScore >= SCORE_WARN_SEND
                          ? "border-amber-600/50 bg-amber-950/40 text-amber-100"
                          : "border-rose-800/60 bg-rose-950/50 text-rose-100"
                    }`}
                    role="status"
                  >
                    {postCaptureMessage}
                    {captureDebug && postCaptureScore != null ? (
                      <span className="block text-xs opacity-80 mt-1 font-mono">
                        score {postCaptureScore}/100
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    size="lg"
                    className="w-full h-14 text-lg gap-2 bg-indigo-600 hover:bg-indigo-500"
                    disabled={
                      uploading ||
                      validatingCapture ||
                      (!pendingPreview && shutterCooldown) ||
                      (pendingPreview != null && developmentCropStepOpen)
                    }
                    onClick={() => void (pendingPreview ? submitPendingPreview() : captureToPreview("manual"))}
                  >
                    {uploading || validatingCapture ? (
                      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                    ) : (
                      <Camera className="h-6 w-6" aria-hidden />
                    )}
                    {uploading
                      ? "Subiendo…"
                      : validatingCapture
                        ? "Validando…"
                        : pendingPreview && developmentCropStepOpen
                          ? "Confirma el recorte arriba"
                          : pendingPreview
                            ? developmentCropUsed
                              ? "Enviar recorte"
                              : "Enviar foto"
                            : OMR_CAPTURE_GUIDE_ENABLED
                              ? "Tomar foto"
                              : "Disparar foto"}
                  </Button>
                </div>
              </>
            )}

            <div className="flex flex-col gap-1">
              <Button type="button" variant="ghost" size="sm" className="text-slate-500" onClick={backToPages}>
                Cambiar número de páginas
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-slate-600 hover:text-amber-400/90 text-xs"
                onClick={resetLocalCaptureCursor}
              >
                {lockedSlot != null ? "Reiniciar este código" : "Reiniciar captura de este lote"}
              </Button>
            </div>

            {lastOk ? (
              <div
                className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/35 bg-emerald-950/45 px-3 py-3 text-sm text-emerald-200 shadow-sm"
                role="status"
                aria-live="polite"
              >
                <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" aria-hidden />
                <span className="text-center font-medium leading-snug">{lastOk}</span>
              </div>
            ) : null}

            {error ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-rose-900 bg-rose-950/60 px-3 py-2 text-sm text-rose-100 flex gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  {error}
                </div>
                {pendingPreview ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={uploading}
                    onClick={() => void submitPendingPreview()}
                  >
                    Reintentar subida
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  )
}
