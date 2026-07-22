"use client"

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useEffect, Suspense } from "react"
import { TestOriginBanner } from "@/app/components/TestOriginBanner"

const BAD_HOST_RE = /(localhost|127\.0\.0\.1|0\.0\.0\.0|cd16|ec30)/i

function getSupabaseHostname(): string {
  if (typeof window === "undefined") return ""
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return "(no configurada)"
  try {
    return new URL(url).hostname
  } catch {
    return "(URL inválida)"
  }
}

function auditStorageKeys(store: Storage, label: string) {
  const hits: Array<{ key: string; hasBadHost: boolean; sampleHost: string | null }> = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (!key) continue
    let value = ""
    try {
      value = store.getItem(key) || ""
    } catch {
      continue
    }
    const keyInteresting =
      /next|returnTo|redirect|lastPath|baseUrl|siteUrl|origin|url|callback/i.test(key) || BAD_HOST_RE.test(key)
    const hasBadHost = BAD_HOST_RE.test(value) || BAD_HOST_RE.test(key)
    if (!keyInteresting && !hasBadHost) continue
    let sampleHost: string | null = null
    const m = value.match(/https?:\/\/([^/\s"'\\]+)/i)
    if (m) sampleHost = m[1]
    hits.push({ key, hasBadHost, sampleHost })
  }
  console.info(`[AUTH_REDIRECT_DIAG] client:${label}`, JSON.stringify({ host: window.location.host, hits }))
  return hits
}

/** Mapea errores de Supabase Auth a mensajes claros para el usuario */
function getAuthErrorMessage(code: string, message: string): string {
  if (code === "invalid_credentials" || message?.toLowerCase().includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos. Si acabas de registrarte, confirma el correo antes de iniciar sesión."
  }
  if (code === "email_not_confirmed" || message?.toLowerCase().includes("email not confirmed")) {
    return "Debes confirmar el correo. Revisa tu bandeja (y spam) o en desarrollo desactiva 'Confirm email' en Supabase → Authentication → Providers."
  }
  if (message?.toLowerCase().includes("user not found") || message?.toLowerCase().includes("invalid_credentials")) {
    return "No existe una cuenta con este correo. Crea una cuenta primero."
  }
  if (code === "validation_failed" || message?.toLowerCase().includes("unsupported provider") || message?.toLowerCase().includes("provider is not enabled")) {
    return "UNSUPPORTED_PROVIDER"
  }
  return message || "Error al iniciar sesión"
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-page)]">
          <div className="max-w-sm w-full text-center text-[var(--text-muted)]">Cargando...</div>
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSignUp, setIsSignUp] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [storageHits, setStorageHits] = useState<
    Array<{ source: string; key: string; hasBadHost: boolean; sampleHost: string | null }>
  >([])
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClientComponentClient()

  // Mensaje desde URL (ej. redirect desde /evaluar sin sesión)
  useEffect(() => {
    const message = searchParams.get("message")
    if (message) setMsg(decodeURIComponent(message))
  }, [searchParams])

  // Modo "Crear cuenta" si viene ?signup=1
  useEffect(() => {
    if (searchParams.get("signup") === "1") setIsSignUp(true)
  }, [searchParams])

  useEffect(() => {
    const host = getSupabaseHostname()
    if (host && host !== "(no configurada)") {
      console.info("[auth] Supabase host (cliente):", host)
    }
    const nextParam = searchParams.get("next")
    console.info(
      "[AUTH_REDIRECT_DIAG]",
      JSON.stringify({
        tag: "login:mount",
        host: window.location.host,
        origin: window.location.origin,
        hrefSafe: window.location.href.replace(
          /([?&](?:code|token|access_token|refresh_token)=)[^&]*/gi,
          "$1[redacted]"
        ),
        nextParam,
        NEXT_PUBLIC_BASE_URL_host: (() => {
          try {
            const v = process.env.NEXT_PUBLIC_BASE_URL
            return v ? new URL(v).hostname : "(empty)"
          } catch {
            return "(invalid)"
          }
        })(),
        NEXT_PUBLIC_SUPABASE_URL_host: host,
      })
    )
    const ls = auditStorageKeys(window.localStorage, "localStorage")
    const ss = auditStorageKeys(window.sessionStorage, "sessionStorage")
    setStorageHits([
      ...ls.map((h) => ({ source: "localStorage", ...h })),
      ...ss.map((h) => ({ source: "sessionStorage", ...h })),
    ])
  }, [searchParams])

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    setMsg(null)
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      const next = searchParams.get("next") || "/evaluar"
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`
      console.info(
        "[AUTH_REDIRECT_DIAG]",
        JSON.stringify({
          tag: "login:google:before",
          host: window.location.host,
          origin,
          nextParam: next,
          redirectTo,
        })
      )
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      })
      if (error) {
        console.info(
          "[AUTH_REDIRECT_DIAG]",
          JSON.stringify({
            tag: "login:google:error",
            errorName: error.name,
            errorMessage: String(error.message || "").slice(0, 200),
          })
        )
        const friendly = getAuthErrorMessage(error.message, error.message)
        const isUnsupportedProvider =
          friendly === "UNSUPPORTED_PROVIDER" ||
          (typeof error.message === "string" &&
            (error.message.toLowerCase().includes("unsupported provider") ||
              error.message.toLowerCase().includes("provider is not enabled")))
        if (isUnsupportedProvider) {
          setMsg("UNSUPPORTED_PROVIDER")
        } else {
          setMsg(friendly)
        }
        return
      }
      if (data?.url) {
        let authorizeRedirectTo: string | null = null
        try {
          authorizeRedirectTo = new URL(data.url).searchParams.get("redirect_to")
        } catch {
          authorizeRedirectTo = null
        }
        console.info(
          "[AUTH_REDIRECT_DIAG]",
          JSON.stringify({
            tag: "login:google:authorize-url",
            authorizeHost: (() => {
              try {
                return new URL(data.url).hostname
              } catch {
                return "(invalid)"
              }
            })(),
            redirect_to: authorizeRedirectTo,
          })
        )
        window.location.href = data.url
        return
      }
      setMsg("No se pudo iniciar sesión con Google. Intenta de nuevo.")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al iniciar sesión con Google"
      const isUnsupported =
        typeof message === "string" &&
        (message.toLowerCase().includes("unsupported provider") ||
          message.toLowerCase().includes("provider is not enabled"))
      setMsg(isUnsupported ? "UNSUPPORTED_PROVIDER" : message)
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMsg(null)
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) {
          const friendly = getAuthErrorMessage(error.message, error.message)
          setMsg(friendly)
          console.error("[auth] signUp error:", error.message)
          return
        }
        if (data?.user && !data.session) {
          setMsg("Revisa tu correo para confirmar la cuenta. Luego podrás iniciar sesión.")
          return
        }
        if (data?.session) {
          const nextUrl = searchParams.get("next") || "/evaluar"
          console.info(
            "[AUTH_REDIRECT_DIAG]",
            JSON.stringify({ tag: "login:password:signup-ok", nextParam: nextUrl, routerPush: nextUrl })
          )
          router.push(nextUrl.startsWith("/") ? nextUrl : `/${nextUrl}`)
          router.refresh()
          return
        }
        setMsg("Cuenta creada. Revisa tu correo para confirmar o inicia sesión si ya está verificada.")
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          const friendly = getAuthErrorMessage(error.message, error.message)
          setMsg(friendly)
          console.error("[auth] signIn error:", error.message)
          return
        }
        if (data?.session) {
          const nextUrl = searchParams.get("next") || "/evaluar"
          console.info(
            "[AUTH_REDIRECT_DIAG]",
            JSON.stringify({ tag: "login:password:ok", nextParam: nextUrl, routerPush: nextUrl })
          )
          router.push(nextUrl.startsWith("/") ? nextUrl : `/${nextUrl}`)
          router.refresh()
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al iniciar sesión"
      setMsg(message)
      console.error("[auth] Error:", message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <TestOriginBanner />
      <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-page)]">
        <div className="max-w-sm w-full space-y-6">
          <h1 className="text-2xl font-bold text-center text-[var(--text-accent)]">Libel-IA</h1>
          <p className="text-center text-sm text-[var(--text-muted)]">Inicia sesión para evaluar y guardar tu historial</p>

          {storageHits.some((h) => h.hasBadHost) ? (
            <div
              data-testid="storage-bad-host-audit"
              className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-900 dark:text-red-200"
            >
              <p className="font-semibold mb-1">TEMP DIAG — storage con host sospechoso (no borrado):</p>
              <ul className="space-y-1 font-mono">
                {storageHits
                  .filter((h) => h.hasBadHost)
                  .map((h) => (
                    <li key={`${h.source}:${h.key}`}>
                      {h.source}:{h.key}
                      {h.sampleHost ? ` → ${h.sampleHost}` : ""}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-white dark:bg-[var(--bg-card)] px-4 py-3 text-[var(--text)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
          >
            {googleLoading ? (
              <span>Conectando...</span>
            ) : (
              <>
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continuar con Google
              </>
            )}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[var(--border-color)]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[var(--bg-page)] px-2 text-[var(--text-muted)]">o con correo</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--text-accent)] mb-1">
                Correo
              </label>
              <input
                id="email"
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-[var(--border-color)] rounded px-3 py-2 bg-[var(--bg-card)] text-[var(--text)]"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--text-accent)] mb-1">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-[var(--border-color)] rounded px-3 py-2 bg-[var(--bg-card)] text-[var(--text)]"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--accent)] text-white py-2 rounded font-medium disabled:opacity-50"
            >
              {loading ? "Espera..." : isSignUp ? "Crear cuenta" : "Iniciar sesión"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setIsSignUp((v) => !v)
              setMsg(null)
            }}
            className="w-full text-sm text-[var(--text-muted)] hover:underline"
          >
            {isSignUp ? "Ya tengo cuenta, iniciar sesión" : "No tengo cuenta, crear cuenta"}
          </button>

          {msg && msg === "UNSUPPORTED_PROVIDER" && (
            <div className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
              <p className="font-medium">Google no está habilitado en este proyecto Supabase.</p>
              <p className="text-sm">
                Ve a Supabase → Authentication → Providers → Google y actívalo. Verifica que tu{" "}
                <code className="rounded bg-black/10 px-1">NEXT_PUBLIC_SUPABASE_URL</code> apunta al proyecto
                correcto.
              </p>
              <a
                href="/api/debug/auth/providers"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium underline"
              >
                Ver diagnóstico
              </a>
            </div>
          )}
          {msg && msg !== "UNSUPPORTED_PROVIDER" && (
            <p className="text-sm text-center text-amber-600 dark:text-amber-400">{msg}</p>
          )}

          <p className="text-xs text-center text-[var(--text-muted)]">
            Necesitas iniciar sesión para guardar evaluaciones y ver tu historial en LibelIA.
          </p>
        </div>
      </main>
    </>
  )
}
