// middleware.ts - Redirige /evaluar a /login si no hay sesión Supabase.
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs"

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  if (!session && req.nextUrl.pathname === "/evaluar") {
    const url = new URL("/login", req.url)
    url.searchParams.set("next", "/evaluar")
    url.searchParams.set("message", "Debes iniciar sesión para usar LibelIA")
    return NextResponse.redirect(url)
  }

  return res
}

export const config = {
  matcher: ["/evaluar"],
}
