/**
 * TEMP DIAG: public hostnames only (no secrets).
 * GET /api/debug/auth-redirect-diag
 */
import { NextRequest, NextResponse } from "next/server"
import { envOriginHosts, hostnameOf, safeRequestUrl } from "@/app/lib/auth-redirect-diag"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    requestUrlSafe: safeRequestUrl(request.url),
    host: request.headers.get("host"),
    xForwardedHost: request.headers.get("x-forwarded-host"),
    xForwardedProto: request.headers.get("x-forwarded-proto"),
    nextUrlOrigin: request.nextUrl.origin,
    NEXT_PUBLIC_SUPABASE_URL_host: hostnameOf(process.env.NEXT_PUBLIC_SUPABASE_URL),
    ...envOriginHosts(),
  })
}
