// middleware.ts - Protecciones de sesión y RBAC para rutas críticas.
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"

const DEV_MASTER_EMAIL = (process.env.DEV_MASTER_EMAIL ?? "[TU CORREO AQUI]").trim().toLowerCase()

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()
  const path = req.nextUrl.pathname

  if (!session && path === "/evaluar") {
    const url = new URL("/login", req.url)
    url.searchParams.set("next", "/evaluar")
    url.searchParams.set("message", "Debes iniciar sesión para usar LibelIA")
    return NextResponse.redirect(url)
  }

  // Estación docente + captura móvil (Paso C): sesión obligatoria; `next` incluye query (?batch_id=) para el QR.
  if (!session && path.startsWith("/docente")) {
    const url = new URL("/login", req.url)
    const nextPath = `${req.nextUrl.pathname}${req.nextUrl.search}`
    url.searchParams.set("next", nextPath)
    url.searchParams.set("message", "Inicia sesión para la estación o captura móvil")
    return NextResponse.redirect(url)
  }

  if (process.env.NODE_ENV === "development" && session && path.startsWith("/dashboard/")) {
    const sessionEmail = String(session.user.email ?? "").trim().toLowerCase()
    const isMasterByEmail = !!DEV_MASTER_EMAIL && sessionEmail === DEV_MASTER_EMAIL
    if (isMasterByEmail) return res
  }

  // PHASE_5_INSTITUTIONAL_V1 — /dashboard/utp y /dashboard/direccion
  if (path.startsWith("/dashboard/utp") || path.startsWith("/dashboard/direccion")) {
    if (!session) return NextResponse.redirect(new URL("/", req.url))
    // Paso libre en dev o con DEV_DASHBOARD_RELAX=1 (reversible; no exige rol UTP/Dirección).
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
    const normalizedRole = String(role ?? "").trim().toUpperCase()
    const allowedForUtp =
      normalizedRole === "UTP" ||
      normalizedRole === "DIRECCION" ||
      normalizedRole === "ADMIN_INSTITUCION" ||
      normalizedRole === "ADMIN"
    const allowedForDireccion =
      normalizedRole === "DIRECCION" ||
      normalizedRole === "ADMIN_INSTITUCION" ||
      normalizedRole === "ADMIN" ||
      normalizedRole === "UTP"
    if (path.startsWith("/dashboard/utp") && !allowedForUtp) {
      return NextResponse.redirect(new URL("/", req.url))
    }
    if (path.startsWith("/dashboard/direccion") && !allowedForDireccion) {
      return NextResponse.redirect(new URL("/", req.url))
    }
  }

  return res
}

export const config = {
  matcher: ["/evaluar", "/dashboard/:path*", "/docente/:path*"],
}
