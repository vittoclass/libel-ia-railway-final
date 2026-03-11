// app/api/debug/supabase-env/route.ts
// Solo desarrollo: verificar que cliente y servidor usan el mismo proyecto Supabase (sin exponer keys).
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Solo disponible en desarrollo" }, { status: 404 })
  }

  const urlPublic = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const urlServer = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""

  let supabaseHostPublic = "(no configurada)"
  let supabaseHostServer = "(no configurada)"
  try {
    if (urlPublic) supabaseHostPublic = new URL(urlPublic).hostname
    if (urlServer) supabaseHostServer = new URL(urlServer).hostname
  } catch (_) {}

  const hasAnonKey = !!(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    (process.env as Record<string, string>)["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  )
  const hasServiceRole = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY)

  return NextResponse.json({
    supabaseHostPublic,
    supabaseHostServer,
    hasAnonKey,
    hasServiceRole,
    hostsMatch: supabaseHostPublic === supabaseHostServer,
    hint: "Si los host difieren, guardado y lectura pueden usar proyectos distintos => 'guardó pero no verifica'.",
  })
}
