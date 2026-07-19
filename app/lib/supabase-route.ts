/**
 * Cliente Supabase para Route Handlers (API routes) con sesión de Auth.
 * Usa cookies para leer la sesión establecida por createClientComponentClient en el cliente.
 *
 * Contexto interno (worker async): AsyncLocalStorage server-only.
 * Nunca aceptar user_id/teacher_id/school_id desde body ni headers públicos.
 */
import { AsyncLocalStorage } from "async_hooks"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import type { User } from "@supabase/supabase-js"
import { cookies } from "next/headers"

type CookieStore = Awaited<ReturnType<typeof cookies>>

type InternalAuthContext = {
  userId: string
}

/**
 * Store por-ejecución (no global mutable compartido entre jobs).
 * Solo se establece vía runWithInternalAuthUser.
 */
const internalAuthStorage = new AsyncLocalStorage<InternalAuthContext>()

function assertServerOnlyModule(): void {
  if (typeof window !== "undefined") {
    throw new Error("supabase-route: módulo server-only")
  }
}

assertServerOnlyModule()

/**
 * Proxy de cookies sin escritura: evita cookies().set durante getUser() cuando la ruta corre
 * en contextos donde Next.js prohíbe mutar cookies (p. ej. sub-request desde ReadableStream en /api/evaluate/batch).
 * El refresh de sesión debe ocurrir en el cliente; aquí solo leemos el JWT existente.
 */
function readOnlyCookieStore(real: CookieStore): CookieStore {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "set") return () => undefined
      if (prop === "delete") return () => undefined
      const value = Reflect.get(target, prop, receiver)
      if (typeof value === "function") return (value as (...a: unknown[]) => unknown).bind(target)
      return value
    },
  }) as CookieStore
}

export async function getSupabaseRouteClient() {
  const cookieStore = await cookies()
  return createRouteHandlerClient({ cookies: () => cookieStore })
}

/** Misma sesión que getSupabaseRouteClient pero sin persistir ni refrescar vía cookies en el servidor. */
export async function getSupabaseRouteClientReadOnly() {
  const cookieStore = await cookies()
  const store = readOnlyCookieStore(cookieStore)
  return createRouteHandlerClient({ cookies: () => store })
}

/**
 * Ejecuta `fn` con identidad interna confiable (p. ej. worker Railway).
 * El userId debe provenir de auth real capturada en /api/evaluate/start (cookies),
 * nunca del body del cliente.
 */
export async function runWithInternalAuthUser<T>(
  context: { userId: string },
  fn: () => Promise<T>,
): Promise<T> {
  assertServerOnlyModule()
  const userId = typeof context?.userId === "string" ? context.userId.trim() : ""
  if (!userId) {
    throw new Error("runWithInternalAuthUser: userId requerido")
  }
  return internalAuthStorage.run({ userId }, fn)
}

/** Solo para pruebas de aislamiento; no exponer por HTTP. */
export function peekInternalAuthUserIdForTests(): string | null {
  return internalAuthStorage.getStore()?.userId ?? null
}

/**
 * Obtiene el usuario actual.
 * 1) Si hay contexto interno (worker): retorna usuario con id del store (server-side).
 * 2) Si no: camino HTTP actual vía cookies() — idéntico al histórico.
 */
export async function getAuthUser(): Promise<User | null> {
  const internal = internalAuthStorage.getStore()
  if (internal?.userId) {
    // Identidad fijada por el servidor al encolar; no lee body ni headers.
    return {
      id: internal.userId,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "",
    } as User
  }

  const supabase = await getSupabaseRouteClientReadOnly()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
