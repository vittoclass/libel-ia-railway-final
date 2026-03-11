// app/api/debug/auth/providers/route.ts
// Solo en desarrollo: diagnóstico de providers (Google debe estar habilitado en Supabase).
import { NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"

export const dynamic = "force-dynamic"

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Solo disponible en desarrollo" }, { status: 404 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
  let supabaseHost = "(no configurada)"
  try {
    if (supabaseUrl) supabaseHost = new URL(supabaseUrl).hostname
  } catch (_) {}

  let hasSession = false
  try {
    const user = await getAuthUser()
    hasSession = !!user
  } catch (_) {}

  return NextResponse.json({
    supabaseHost,
    hint: "Google provider must be enabled in Supabase Dashboard: Authentication → Providers → Google → Enable + Client ID/Secret. Verifica que NEXT_PUBLIC_SUPABASE_URL apunta al proyecto donde habilitaste Google.",
    hasSession,
  })
}
