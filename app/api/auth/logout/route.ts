// app/api/auth/logout/route.ts
// Cierra sesión en el servidor (limpia cookies de Supabase Auth).
import { NextRequest, NextResponse } from "next/server"
import { getSupabaseRouteClient } from "@/app/lib/supabase-route"
import { envOriginHosts, logAuthDiag, safeRequestUrl } from "@/app/lib/auth-redirect-diag"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  logAuthDiag({
    tag: "auth/logout:post",
    requestUrlSafe: safeRequestUrl(request.url),
    host: request.headers.get("host"),
    xForwardedHost: request.headers.get("x-forwarded-host"),
    xForwardedProto: request.headers.get("x-forwarded-proto"),
    nextUrlOrigin: request.nextUrl.origin,
    nextParam: null,
    ...envOriginHosts(),
  })
  try {
    const supabase = await getSupabaseRouteClient()
    await supabase.auth.signOut()
  } catch (e) {
    console.warn("[auth/logout]", e)
  }
  return NextResponse.json({ ok: true })
}
