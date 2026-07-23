// app/auth/callback/route.ts
// Maneja el callback de OAuth (Google, etc.) y establece la sesión en cookies.
import { NextRequest, NextResponse } from "next/server"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

/** Origen público para redirects (Railway: nextUrl.origin puede ser https://0.0.0.0:PORT). */
function resolvePublicOrigin(request: NextRequest): string {
  const fromEnv = (process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_BASE_URL || "").replace(/\/$/, "")
  if (/^https?:\/\//i.test(fromEnv)) {
    try {
      return new URL(fromEnv).origin
    } catch {
      /* fall through */
    }
  }

  const xfHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const xfProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"
  const xfHostname = xfHost?.split(":")[0] ?? ""
  if (xfHost && !/^(0\.0\.0\.0|127\.0\.0\.1|localhost)$/i.test(xfHostname)) {
    return `${xfProto}://${xfHost}`
  }

  const railway = (process.env.RAILWAY_PUBLIC_DOMAIN || "").trim().replace(/^https?:\/\//, "")
  if (railway) return `https://${railway}`

  return request.nextUrl.origin
}

/** Solo rutas internas que empiezan con `/` (bloquea open redirect). */
function sanitizeNextPath(next: string | null): string {
  const raw = next ?? "/evaluar"
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw
  return "/evaluar"
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const next = sanitizeNextPath(searchParams.get("next"))
  const origin = resolvePublicOrigin(request)

  if (!code) {
    return NextResponse.redirect(`${origin}/login?message=${encodeURIComponent("No se pudo completar el inicio de sesión")}`)
  }

  try {
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error("[auth/callback] exchangeCodeForSession:", error.message)
      return NextResponse.redirect(
        `${origin}/login?message=${encodeURIComponent("Error al iniciar sesión. Intenta de nuevo.")}`
      )
    }
    return NextResponse.redirect(`${origin}${next}`)
  } catch (e) {
    console.error("[auth/callback]", e)
    return NextResponse.redirect(
      `${origin}/login?message=${encodeURIComponent("Error inesperado al completar el inicio de sesión")}`
    )
  }
}
