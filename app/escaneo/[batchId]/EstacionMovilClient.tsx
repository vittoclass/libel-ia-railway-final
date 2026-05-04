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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Phase = "pages" | "scanner"

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
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<Phase>("pages")
  const [scannerActive, setScannerActive] = useState(false)
  const [imagesPerStudent, setImagesPerStudent] = useState(2)
  const [studentIndex, setStudentIndex] = useState(1)
  const [pageIndex, setPageIndex] = useState(1)

  const [batchGateOk, setBatchGateOk] = useState<boolean | null>(null)
  const [batchGateError, setBatchGateError] = useState<string | null>(null)
  /** Respuesta cruda de GET /public para depuración en pantalla. */
  const [publicApiDebug, setPublicApiDebug] = useState<unknown>(null)
  /** Valor que envió la estación PC (batch_scan_sessions.expected_pages_per_student), si viene en GET /public. */
  const [pcExpectedPages, setPcExpectedPages] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [lastOk, setLastOk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraActivationError, setCameraActivationError] = useState<string | null>(null)
  /** Nombre DOM del error (NotAllowedError, OverconstrainedError, …) en rojo grande. */
  const [cameraErrorName, setCameraErrorName] = useState<string | null>(null)
  const [activatingCamera, setActivatingCamera] = useState(false)
  /** Stream activo: estado para enlazar <video> tras montar (el ref es null antes de scannerActive). */
  const [boundStream, setBoundStream] = useState<MediaStream | null>(null)
  /** Foto tomada aún no enviada: solo estado local (misma `File` que recibirá `uploadFile`). */
  const [pendingPreview, setPendingPreview] = useState<{ url: string; file: File } | null>(null)
  /** Evita doble disparo del obturador justo después de capturar (UI). */
  const [shutterCooldown, setShutterCooldown] = useState(false)

  const batchOk = UUID_REGEX.test(batchId.trim())

  const stopStream = useCallback(() => {
    setBoundStream(null)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const v = videoRef.current
    if (v) {
      v.srcObject = null
    }
    setScannerActive(false)
  }, [])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  /** El <video> solo existe con scannerActive=true; aquí enlazamos boundStream cuando ya está en el DOM. */
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
      setImagesPerStudent(Math.min(MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT, ep))
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
      setImagesPerStudent(n)
      setPageIndex(1)
      setPhase("scanner")
      setError(null)
      setLastOk(null)
      setCameraActivationError(null)
      setCameraErrorName(null)
    },
    [stopStream],
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
      try {
        const fd = new FormData()
        fd.set("batch_id", batchId)
        fd.set("student_index", String(studentIndex))
        fd.set("page_index", String(pageIndex))
        fd.set("file", file)

        const res = await fetch("/api/docente/movil-upload", { method: "POST", body: fd })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof j?.error === "string" ? j.error : "Error al subir")
          return false
        }

        setLastOk("Foto capturada correctamente. Ahora puedes pasar a la siguiente imagen.")

        if (pageIndex < imagesPerStudent) {
          setPageIndex((p) => p + 1)
        } else {
          setStudentIndex((s) => s + 1)
          setPageIndex(1)
        }
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al subir")
        return false
      } finally {
        setUploading(false)
      }
    },
    [batchId, studentIndex, pageIndex, imagesPerStudent],
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
  }, [uploading, revokePreview])

  const captureToPreview = useCallback(async () => {
    const video = videoRef.current
    if (!video || !batchOk || batchGateOk !== true || shutterCooldown) return
    const w = video.videoWidth
    const h = video.videoHeight
    if (w < 2 || h < 2) {
      setError("La cámara aún no tiene imagen. Espere un segundo e intente de nuevo.")
      return
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

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
    })
    if (!blob) {
      setError("No se pudo generar la foto.")
      return
    }

    setShutterCooldown(true)
    window.setTimeout(() => setShutterCooldown(false), 1000)

    const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" })
    const url = URL.createObjectURL(blob)
    setPendingPreview((prev) => {
      if (prev?.url) revokePreview(prev.url)
      return { url, file }
    })
  }, [batchOk, batchGateOk, shutterCooldown, revokePreview])

  const submitPendingPreview = useCallback(async () => {
    if (!pendingPreview) return
    const { file, url } = pendingPreview
    const ok = await uploadFile(file)
    if (ok) {
      revokePreview(url)
      setPendingPreview(null)
    }
  }, [pendingPreview, uploadFile, revokePreview])

  useEffect(() => {
    if (!lastOk) return
    const t = window.setTimeout(() => setLastOk(null), 2600)
    return () => window.clearTimeout(t)
  }, [lastOk])

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
  }, [stopStream])

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

  return (
    <main className="min-h-screen flex flex-col bg-slate-950 text-slate-100 p-4 pb-12">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col gap-6 pt-6">
        {phase === "pages" ? (
          <div className="space-y-6 flex-1 flex flex-col justify-center">
            <p className="text-center text-sm font-medium text-slate-200">
              Paso 1: ¿Cuántas fotos por alumno? (hasta {MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT})
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
            <p className="text-center text-xs text-slate-500">
              {imagesPerStudent} foto{imagesPerStudent !== 1 ? "s" : ""} por estudiante · Alumno {studentIndex} · Captura{" "}
              {pageIndex}/{imagesPerStudent}
            </p>

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
                  {pendingPreview
                    ? "Revisa la foto. Enviála o descartala con la X."
                    : "Paso 3: Dispara la foto."}
                </p>
                <div className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-black aspect-[3/4] max-h-[55vh]">
                  {pendingPreview ? (
                    <div className="relative h-full w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL local de previsualización */}
                      <img src={pendingPreview.url} alt="" className="h-full w-full object-cover" />
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
                    /* playsInline + muted + autoPlay: iOS/Android suelen bloquear reproducción sin esto */
                    <video
                      ref={videoRef}
                      className="h-full w-full object-cover"
                      playsInline
                      muted
                      autoPlay
                    />
                  )}
                </div>
                <Button
                  type="button"
                  size="lg"
                  className="w-full h-14 text-lg gap-2 bg-indigo-600 hover:bg-indigo-500"
                  disabled={uploading || (!pendingPreview && shutterCooldown)}
                  onClick={() => void (pendingPreview ? submitPendingPreview() : captureToPreview())}
                >
                  {uploading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Camera className="h-6 w-6" aria-hidden />}
                  {uploading ? "Subiendo…" : pendingPreview ? "Enviar foto" : "Disparar foto"}
                </Button>
              </>
            )}

            <Button type="button" variant="ghost" size="sm" className="text-slate-500" onClick={backToPages}>
              Cambiar número de páginas
            </Button>

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
              <div className="rounded-lg border border-rose-900 bg-rose-950/60 px-3 py-2 text-sm text-rose-100 flex gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                {error}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  )
}
