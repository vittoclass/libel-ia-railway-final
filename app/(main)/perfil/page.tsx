"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, CheckCircle, AlertCircle } from "lucide-react"

const REQUEST_TIMEOUT_MS = 5000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      const msg = `Tiempo de espera (${ms / 1000} s) al cargar: ${label}`
      console.warn("[perfil]", msg)
      reject(new Error(msg))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      (e) => {
        clearTimeout(id)
        reject(e)
      },
    )
  })
}

async function fetchProfileWithTimeout(): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => {
    console.warn("[perfil] Abort fetch /api/profile por timeout", REQUEST_TIMEOUT_MS, "ms")
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  try {
    return await fetch("/api/profile", { credentials: "include", signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

type LoadState = "loading" | "ready" | "error" | "guest"

export default function PerfilPage() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profileOnboarded, setProfileOnboarded] = useState<boolean | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [initError, setInitError] = useState<string | null>(null)
  const [fullName, setFullName] = useState("")
  const [schoolName, setSchoolName] = useState("")
  const [department, setDepartment] = useState("")
  const [submitLoading, setSubmitLoading] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const router = useRouter()
  const supabase = createClientComponentClient()
  const loadProfileRef = useRef<() => Promise<void>>(() => Promise.resolve())

  loadProfileRef.current = async () => {
    setInitError(null)
    setLoadState("loading")
    try {
      const {
        data: { user: u },
        error: authErr,
      } = await withTimeout(supabase.auth.getUser(), REQUEST_TIMEOUT_MS, "sesión (auth.getUser)")
      if (authErr) {
        console.error("[perfil] auth.getUser error", authErr)
        setInitError(authErr.message ?? "Error al leer la sesión.")
        setLoadState("error")
        return
      }
      if (!u) {
        setUser(null)
        setProfileOnboarded(null)
        setLoadState("guest")
        return
      }
      setUser({ id: u.id, email: u.email ?? undefined })

      let res: Response
      try {
        res = await fetchProfileWithTimeout()
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === "AbortError"
        const text = aborted
          ? `La petición al servidor tardó más de ${REQUEST_TIMEOUT_MS / 1000} s (perfil). Revisa Railway, Supabase y variables de entorno.`
          : e instanceof Error
            ? e.message
            : "Error de red al cargar el perfil."
        console.error("[perfil] fetch /api/profile failed", e)
        setInitError(text)
        setLoadState("error")
        return
      }

      let data: Record<string, unknown>
      try {
        data = await res.json()
      } catch {
        console.error("[perfil] JSON inválido en respuesta", res.status)
        setInitError(`Respuesta inválida del servidor (HTTP ${res.status}).`)
        setLoadState("error")
        return
      }

      if (!res.ok || res.status >= 400) {
        const errText =
          (typeof data.error === "string" && data.error) ||
          (typeof data.message === "string" && data.message) ||
          `Error del servidor (HTTP ${res.status}).`
        console.error("[perfil] /api/profile HTTP error", res.status, data)
        setInitError(
          res.status >= 500
            ? `Error ${res.status}: ${errText}`
            : `Solicitud rechazada (${res.status}): ${errText}`,
        )
        setLoadState("error")
        return
      }

      const onboarded = Boolean(data.onboarded)
      setProfileOnboarded(onboarded)
      setLoadState("ready")
    } catch (e) {
      const text = e instanceof Error ? e.message : "No se pudo cargar el perfil."
      console.error("[perfil] carga inicial", e)
      setInitError(text)
      setLoadState("error")
    }
  }

  useEffect(() => {
    void loadProfileRef.current()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    setSubmitLoading(true)
    try {
      const controller = new AbortController()
      const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const res = await fetch("/api/profile/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          full_name: fullName,
          school_name: schoolName,
          department: department || undefined,
        }),
        signal: controller.signal,
      })
      clearTimeout(id)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const err =
          (typeof data.error === "string" && data.error) ||
          (res.status >= 500 ? `Error del servidor (${res.status})` : `Error ${res.status}`)
        console.error("[perfil] onboarding POST", res.status, data)
        setMessage({ type: "error", text: err })
        return
      }
      setMessage({ type: "success", text: (data.message as string) ?? "Perfil completado." })
      setProfileOnboarded(true)
      router.refresh()
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError"
      setMessage({
        type: "error",
        text: aborted
          ? `Guardado: tiempo de espera > ${REQUEST_TIMEOUT_MS / 1000} s. Intenta de nuevo.`
          : "Error de conexión.",
      })
      console.error("[perfil] onboarding catch", err)
    } finally {
      setSubmitLoading(false)
    }
  }

  if (loadState === "loading") {
    return (
      <main className="min-h-screen p-6 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">Cargando perfil…</p>
      </main>
    )
  }

  if (loadState === "error" && initError) {
    return (
      <main className="min-h-screen p-6 flex items-center justify-center">
        <Card className="max-w-lg w-full border-red-200 bg-red-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0" />
              No se pudo cargar el perfil
            </CardTitle>
            <CardDescription className="text-red-900/80 whitespace-pre-wrap">{initError}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void loadProfileRef.current()}>
              Reintentar
            </Button>
            <Link href="/">
              <Button type="button" variant="outline">
                Volver al inicio
              </Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (loadState === "guest" || !user) {
    return (
      <main className="min-h-screen p-6">
        <div className="max-w-md mx-auto text-center">
          <p className="text-[var(--text-muted)] mb-4">Debes iniciar sesión para ver tu perfil.</p>
          <Link href="/login?next=/perfil">
            <Button>Iniciar sesión</Button>
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-accent)]">Perfil</h1>
        <p className="text-[var(--text-muted)]">Correo: {user.email}</p>

        {profileOnboarded ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Perfil completado
              </CardTitle>
              <CardDescription>
                Puedes guardar evaluaciones y ver tu historial. Si quieres cambiar colegio o nombre, contacta soporte.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/evaluar">
                <Button>Ir a evaluar</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Completar perfil</CardTitle>
              <CardDescription>
                Para guardar evaluaciones y ver tu historial en LibelIA, completa los siguientes datos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="full_name">Nombre del profesor *</Label>
                  <Input
                    id="full_name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej. Juan Pérez"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="school_name">Colegio / Establecimiento *</Label>
                  <Input
                    id="school_name"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="Ej. Liceo San José"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="department">Departamento (opcional)</Label>
                  <Input
                    id="department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="Ej. Matemática"
                    className="mt-1"
                  />
                </div>
                {message && (
                  <p className={message.type === "success" ? "text-green-600" : "text-red-600"}>
                    {message.text}
                  </p>
                )}
                <Button type="submit" disabled={submitLoading}>
                  {submitLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar perfil"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
