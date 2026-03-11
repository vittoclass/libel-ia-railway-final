import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * GET /api/auth/config — Verificación de configuración (solo hostname, sin keys).
 * Útil para confirmar que el servidor usa la misma Supabase que el cliente.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  let hostname = ""
  if (url) {
    try {
      hostname = new URL(url).hostname
    } catch {
      hostname = "(URL inválida)"
    }
    console.info("[auth] Supabase host (servidor):", hostname)
  } else {
    console.warn("[auth] SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL no definida")
  }
  return NextResponse.json({
    supabaseHost: hostname || "(no configurada)",
    hasAnonKey: !!(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  })
}
