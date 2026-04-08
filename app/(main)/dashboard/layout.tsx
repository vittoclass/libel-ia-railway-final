import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"
const DEV_MASTER_EMAIL = (process.env.DEV_MASTER_EMAIL ?? "").trim().toLowerCase()

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
    let effectiveRole = baseRole
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
  const role = String(branding.role ?? "TEACHER").toUpperCase()
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
              <p className="text-xs text-[var(--text-muted)]">Panel Institucional</p>
            </div>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/dashboard/institucion" className="hover:underline">Institución</Link>
            <Link href="/dashboard/utp" className="hover:underline">UTP</Link>
            <Link href="/dashboard/direccion" className="hover:underline">Dirección</Link>
            <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-[var(--text-muted)]">
              Rol: {role}
            </span>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6 grid gap-4 md:grid-cols-[220px,1fr]">
        <aside className="rounded-xl border border-[var(--border-color)] bg-white p-3 h-fit">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">Sidebar</p>
          <nav className="space-y-1">
            <Link href="/dashboard/institucion" className="block rounded-md px-3 py-2 text-sm hover:bg-slate-50">
              Panel Institución
            </Link>
            <Link href="/dashboard/utp" className="block rounded-md px-3 py-2 text-sm hover:bg-slate-50">
              Panel UTP
            </Link>
            <Link href="/dashboard/direccion" className="block rounded-md px-3 py-2 text-sm hover:bg-slate-50">
              Panel Dirección
            </Link>
          </nav>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  )
}
