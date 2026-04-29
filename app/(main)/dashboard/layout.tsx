import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { DashboardSidebarNav } from "./dashboard-sidebar-nav"

export const dynamic = "force-dynamic"
const DEV_MASTER_EMAIL = (process.env.DEV_MASTER_EMAIL ?? "").trim().toLowerCase()

/** Rol estable para RBAC de navegación (alineado con middleware). */
function normalizeDashboardNavRole(raw: string): string {
  const r = String(raw ?? "").trim().toUpperCase()
  if (r === "DOCENTE" || r === "TEACHER") return "TEACHER"
  return r
}

/** Visibilidad de enlaces del shell del dashboard (solo UX; middleware + APIs son la fuente de verdad). */
function showDashboardShellLink(navRole: string, href: string): boolean {
  const r = normalizeDashboardNavRole(navRole)
  if (r === "ADMIN" || r === "ADMIN_INSTITUCION") return true
  if (r === "TEACHER") {
    return href === "/dashboard/docente" || href === "/dashboard/institucion"
  }
  if (r === "UTP") {
    return href === "/dashboard/docente" || href === "/dashboard/institucion" || href === "/dashboard/utp"
  }
  if (r === "DIRECCION") {
    return href === "/dashboard/direccion" || href === "/dashboard/institucion"
  }
  return href === "/dashboard/docente" || href === "/dashboard/institucion"
}

async function getOrganizationBranding() {
  try {
    const user = await getAuthUser()
    if (!user) return { name: "Colegio Oscar Salinas", logo_url: null as string | null }
    const supabase = getSupabaseServer()
    if (!supabase) return { name: "Colegio Oscar Salinas", logo_url: null as string | null }
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .maybeSingle()
    const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null
    const baseRole = String((profile as { role?: string | null } | null)?.role ?? "TEACHER")
      .trim()
      .toUpperCase()
    let effectiveRole = normalizeDashboardNavRole(baseRole)
    if (isMasterEmail(user.email)) {
      effectiveRole = "ADMIN_INSTITUCION"
    }
    if (process.env.NODE_ENV === "development") {
      const sessionEmail = String(user.email ?? "").trim().toLowerCase()
      if (DEV_MASTER_EMAIL && sessionEmail === DEV_MASTER_EMAIL) {
        effectiveRole = "ADMIN_INSTITUCION"
      }
      const cookieStore = await cookies()
      const enabled = cookieStore.get("dev_override_enabled")?.value === "1"
      const devRole = String(cookieStore.get("dev_role_override")?.value ?? "").trim().toUpperCase()
      if (enabled && (devRole === "TEACHER" || devRole === "UTP" || devRole === "DIRECCION" || devRole === "ADMIN")) {
        effectiveRole = devRole
      }
    }
    if (!orgId) return { name: "Colegio Oscar Salinas", logo_url: null as string | null, role: effectiveRole }
    const { data: org } = await supabase
      .from("organizations")
      .select("name, logo_url")
      .eq("id", orgId)
      .maybeSingle()
    return {
      name: org?.name ?? "Colegio Oscar Salinas",
      logo_url: org?.logo_url ?? null,
      role: effectiveRole,
    }
  } catch {
    return { name: "Colegio Oscar Salinas", logo_url: null as string | null, role: "TEACHER" }
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const branding = await getOrganizationBranding()
  const role = normalizeDashboardNavRole(String(branding.role ?? "TEACHER"))
  return (
    <div className="min-h-screen bg-[var(--bg-default)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-color)] bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex flex-col items-center justify-center gap-2 text-center">
            <Image
              src={branding.logo_url || "/logo-colegio.png"}
              alt={branding.name}
              width={96}
              height={96}
              className="h-24 w-auto object-contain"
            />
            <div>
              <h1 className="font-semibold">{branding.name}</h1>
              <p className="text-xs text-[var(--text-muted)]">Panel institucional Libel-IA</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm" aria-label="Acceso rápido a módulos">
            {showDashboardShellLink(role, "/dashboard/docente") ? (
              <Link href="/dashboard/docente" className="font-medium text-slate-900 hover:underline">
                Panel Docente
              </Link>
            ) : null}
            {showDashboardShellLink(role, "/dashboard/institucion") ? (
              <Link href="/dashboard/institucion" className="font-medium text-slate-900 hover:underline">
                Institución
              </Link>
            ) : null}
            {showDashboardShellLink(role, "/dashboard/utp") ? (
              <Link href="/dashboard/utp" className="font-medium text-slate-900 hover:underline">
                UTP
              </Link>
            ) : null}
            {showDashboardShellLink(role, "/dashboard/direccion") ? (
              <Link href="/dashboard/direccion" className="font-medium text-slate-900 hover:underline">
                Dirección
              </Link>
            ) : null}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-[var(--text-muted)]">
              Rol: {role}
            </span>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6 grid gap-4 md:grid-cols-[220px,1fr]">
        <aside className="rounded-xl border border-[var(--border-color)] bg-white p-3 h-fit">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Módulos</p>
          <p className="text-[11px] text-[var(--text-muted)] mb-3 leading-snug">
            Los módulos visibles dependen de tu rol; el acceso real lo validan el servidor y las APIs.
          </p>
          <DashboardSidebarNav navRole={role} />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  )
}
