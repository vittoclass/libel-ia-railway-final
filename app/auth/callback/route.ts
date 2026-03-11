// app/auth/callback/route.ts
// Maneja el callback de OAuth (Google, etc.) y establece la sesión en cookies.
import { NextRequest, NextResponse } from "next/server"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/evaluar"
  const origin = request.nextUrl.origin

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
    return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : `/${next}`}`)
  } catch (e) {
    console.error("[auth/callback]", e)
    return NextResponse.redirect(
      `${origin}/login?message=${encodeURIComponent("Error inesperado al completar el inicio de sesión")}`
    )
  }
}
