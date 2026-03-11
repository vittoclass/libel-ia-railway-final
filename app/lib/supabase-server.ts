/**
 * Cliente Supabase solo para servidor (API routes, Server Components).
 * Usa SUPABASE_SERVICE_ROLE_KEY: NUNCA importar este archivo en el cliente.
 * Para el cliente usar createClientComponentClient o variables NEXT_PUBLIC_*.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let _serverClient: SupabaseClient | null = null

/**
 * Cliente con service role para operaciones con privilegios (insert/update/delete).
 * Solo usar en servidor (getServerSession, API routes, etc.).
 */
export function getSupabaseServer(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseServiceRoleKey) return null
  if (!_serverClient) {
    _serverClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _serverClient
}

/** Comprueba si la persistencia Supabase está configurada (para no intentar insert si no hay credenciales). */
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseServiceRoleKey)
}
