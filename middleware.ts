// middleware.ts - Protecciones de sesión y RBAC para rutas críticas.
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { envOriginHosts, logAuthDiag, safeRequestUrl } from "@/app/lib/auth-redirect-diag"

function isPublicMobilePath(pathname: string): boolean {
  return pathname.startsWith("/escaneo/")
}

function isLocalHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? ""
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".local")
}

function logMwRedirect(req: NextRequest, tag: string, locationFinal: string, nextParam: string | null) {
  logAuthDiag({
    tag,
    requestUrlSafe: safeRequestUrl(req.url),
    host: req.headers.get("host"),
    xForwardedHost: req.headers.get("x-forwarded-host"),
    xForwardedProto: req.headers.get("x-forwarded-proto"),
    nextUrlOrigin: req.nextUrl.origin,
    nextParam,
    locationFinal,
    ...envOriginHosts(),
  })
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  // TEMP DIAG: log-only for auth surfaces (no session side-effects).
  if (pathname === "/auth/callback" || pathname === "/login") {
    logAuthDiag({
      tag: `middleware:passthrough:${pathname}`,
      requestUrlSafe: safeRequestUrl(req.url),
      host: req.headers.get("host"),
      xForwardedHost: req.headers.get("x-forwarded-host"),
      xForwardedProto: req.headers.get("x-forwarded-proto"),
      nextUrlOrigin: req.nextUrl.origin,
      nextParam: req.nextUrl.searchParams.get("next"),
      ...envOriginHosts(),
    })
    return NextResponse.next()
  }

  // Captura móvil por QR: sin Supabase en middleware; normalizar HTTPS para proxy / cookies.
  if (isPublicMobilePath(pathname)) {
    const host = req.headers.get("host") ?? ""
    if (!isLocalHost(host)) {
      const xfRaw = req.headers.get("x-forwarded-proto")
      const xf = xfRaw?.split(",")[0]?.trim().toLowerCase()
      if (xf === "http") {
        const u = req.nextUrl.clone()
        u.protocol = "https:"
        return NextResponse.redirect(u, 308)
      }
    }
    const requestHeaders = new Headers(req.headers)
    if (!isLocalHost(host)) {
      requestHeaders.set("x-forwarded-proto", "https")
      requestHeaders.set("x-forwarded-ssl", "on")
    }
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const path = req.nextUrl.pathname

  if (!session && path === "/evaluar") {
    const url = new URL("/login", req.url)
    url.searchParams.set("next", "/evaluar")
    url.searchParams.set("message", "Debes iniciar sesión para usar LibelIA")
    logMwRedirect(req, "middleware:redirect:evaluar→login", url.toString(), "/evaluar")
    return NextResponse.redirect(url)
  }

  if (!session && path === "/perfil") {
    const url = new URL("/login", req.url)
    url.searchParams.set("next", "/perfil")
    url.searchParams.set("message", "Inicia sesión para ver tu perfil")
    logMwRedirect(req, "middleware:redirect:perfil→login", url.toString(), "/perfil")
    return NextResponse.redirect(url)
  }

  if (!session && path.startsWith("/docente")) {
    const url = new URL("/login", req.url)
    const nextPath = `${req.nextUrl.pathname}${req.nextUrl.search}`
    url.searchParams.set("next", nextPath)
    url.searchParams.set("message", "Inicia sesión para la estación o captura móvil")
    logMwRedirect(req, "middleware:redirect:docente→login", url.toString(), nextPath)
    return NextResponse.redirect(url)
  }

  if (
    session &&
    isMasterEmail(session.user.email) &&
    (path.startsWith("/dashboard/utp") ||
      path.startsWith("/dashboard/direccion") ||
      path.startsWith("/docente"))
  ) {
    return res
  }

  if (path.startsWith("/dashboard/utp") || path.startsWith("/dashboard/direccion")) {
    if (!session) return NextResponse.redirect(new URL("/", req.url))
    if (isDashboardInstitutionalRelaxEnabled()) {
      return res
    }
    const isDev = process.env.NODE_ENV === "development"

    let role: string | null = null
    try {
      const roleRes = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", session.user.id)
        .maybeSingle()
      role = (roleRes.data as { role?: string | null } | null)?.role ?? null
      if (roleRes.error) {
        const fallback = await supabase
          .from("profiles")
          .select("teacher_id")
          .eq("user_id", session.user.id)
          .maybeSingle()
        if ((fallback.data as { teacher_id?: string | null } | null)?.teacher_id) role = "TEACHER"
      }
    } catch {
      role = "TEACHER"
    }
    const devOverrideEnabled = isDev && req.cookies.get("dev_override_enabled")?.value === "1"
    const devOverrideRoleRaw = isDev && devOverrideEnabled ? req.cookies.get("dev_role_override")?.value : null
    const devOverrideRole = String(devOverrideRoleRaw ?? "").trim().toUpperCase()
    if (
      devOverrideRole === "TEACHER" ||
      devOverrideRole === "UTP" ||
      devOverrideRole === "DIRECCION" ||
      devOverrideRole === "ADMIN" ||
      devOverrideRole === "ADMIN_INSTITUCION"
    ) {
      role = devOverrideRole
    }
    let normalizedRole = String(role ?? "").trim().toUpperCase()
    if (normalizedRole === "DOCENTE" || normalizedRole === "TEACHER") {
      normalizedRole = "TEACHER"
    }
    // TEMP (pre-push): /dashboard/utp accesible con cualquier sesión para probar UI (p. ej. PDF). REVERTIR: restaurar RBAC.
    const allowedForDireccion =
      normalizedRole === "DIRECCION" ||
      normalizedRole === "ADMIN_INSTITUCION" ||
      normalizedRole === "ADMIN" ||
      normalizedRole === "UTP"
    if (path.startsWith("/dashboard/direccion") && !allowedForDireccion) {
      return NextResponse.redirect(new URL("/", req.url))
    }
  }

  return res
}

export const config = {
  // TEMP DIAG: include /login and /auth/callback for origin tracing only.
  matcher: ["/evaluar", "/perfil", "/dashboard/:path*", "/docente/:path*", "/escaneo/:path*", "/login", "/auth/callback"],
}
