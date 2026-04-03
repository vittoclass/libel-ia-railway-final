"use client"

/**
 * Captura por QR en /escaneo/[batchId]: batchId + GET /api/docente/batch-session/public.
 * Cámara solo tras gesto del usuario (getUserMedia).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Camera, Loader2, CheckCircle2, AlertCircle } from "lucide-react"

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
  const [uploading, setUploading] = useState(false)
  const [lastOk, setLastOk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraActivationError, setCameraActivationError] = useState<string | null>(null)
  const [activatingCamera, setActivatingCamera] = useState(false)

  const batchOk = UUID_REGEX.test(batchId.trim())

  const stopStream = useCallback(() => {
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
      const body = parsed as { ok?: boolean; error?: string }
      if (!res.ok || !body?.ok) {
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
    } catch (e) {
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
      if (n < 1 || n > 3) return
      stopStream()
      setImagesPerStudent(n)
      setPageIndex(1)
      setPhase("scanner")
      setError(null)
      setLastOk(null)
      setCameraActivationError(null)
    },
    [stopStream],
  )

  const activateScanner = useCallback(async () => {
    setCameraActivationError(null)
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraActivationError("Error: Este navegador no permite acceso a la cámara desde aquí.")
      return
    }
    setActivatingCamera(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        video.playsInline = true
        video.muted = true
        await video.play()
      }
      setScannerActive(true)
    } catch (e) {
      setCameraActivationError(formatCameraError(e))
    } finally {
      setActivatingCamera(false)
    }
  }, [])

  const uploadFile = useCallback(
    async (file: File) => {
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
          return
        }

        setLastOk(`Alumno ${studentIndex} · Foto ${pageIndex} de ${imagesPerStudent}`)

        if (pageIndex < imagesPerStudent) {
          setPageIndex((p) => p + 1)
        } else {
          setStudentIndex((s) => s + 1)
          setPageIndex(1)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al subir")
      } finally {
        setUploading(false)
      }
    },
    [batchId, studentIndex, pageIndex, imagesPerStudent],
  )

  const captureAndUpload = useCallback(async () => {
    const video = videoRef.current
    if (!video || !batchOk || batchGateOk !== true) return
    const w = video.videoWidth
    const h = video.videoHeight
    if (w < 2 || h < 2) {
      setError("La cámara aún no tiene imagen. Espere un segundo e intente de nuevo.")
      return
    }

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

    const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" })
    await uploadFile(file)
  }, [batchOk, batchGateOk, uploadFile])

  const backToPages = useCallback(() => {
    stopStream()
    setPhase("pages")
    setCameraActivationError(null)
    setError(null)
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
            <p className="text-center text-sm font-medium text-slate-200">Paso 1: Elige 1, 2 o 3 páginas.</p>
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={imagesPerStudent === n ? "default" : "secondary"}
                  className="h-16 text-xl font-semibold"
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
                {cameraActivationError ? (
                  <p className="text-center text-xs text-red-400 px-1" role="alert">
                    {cameraActivationError}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-center text-sm font-medium text-indigo-200">Paso 3: Dispara la foto.</p>
                <div className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-black aspect-[3/4] max-h-[55vh]">
                  <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
                </div>
                <Button
                  type="button"
                  size="lg"
                  className="w-full h-14 text-lg gap-2 bg-indigo-600 hover:bg-indigo-500"
                  disabled={uploading}
                  onClick={() => void captureAndUpload()}
                >
                  {uploading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Camera className="h-6 w-6" aria-hidden />}
                  {uploading ? "Subiendo…" : "Disparar foto"}
                </Button>
              </>
            )}

            <Button type="button" variant="ghost" size="sm" className="text-slate-500" onClick={backToPages}>
              Cambiar número de páginas
            </Button>

            {lastOk ? (
              <div className="flex items-center justify-center gap-2 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                {lastOk}
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
