/**
 * Cliente Supabase para Route Handlers (API routes) con sesión de Auth.
 * Usa cookies para leer la sesión establecida por createClientComponentClient en el cliente.
 */
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"

type CookieStore = Awaited<ReturnType<typeof cookies>>

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

/** Obtiene el usuario actual desde la sesión Supabase Auth. Devuelve null si no hay sesión. */
export async function getAuthUser() {
  const supabase = await getSupabaseRouteClientReadOnly()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
