/**
 * Cliente Supabase para Route Handlers (API routes) con sesión de Auth.
 * Usa cookies para leer la sesión establecida por createClientComponentClient en el cliente.
 */
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"

export async function getSupabaseRouteClient() {
  const cookieStore = await cookies()
  return createRouteHandlerClient({ cookies: () => cookieStore })
}

/** Obtiene el usuario actual desde la sesión Supabase Auth. Devuelve null si no hay sesión. */
export async function getAuthUser() {
  const supabase = await getSupabaseRouteClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
