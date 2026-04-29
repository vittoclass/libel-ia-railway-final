"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

type NavItem = { href: string; label: string; subtitle: string }

const ITEMS: NavItem[] = [
  { href: "/dashboard/docente", label: "Panel Docente", subtitle: "Cursos, evaluaciones e informes" },
  { href: "/dashboard/institucion", label: "Panel Institución", subtitle: "Vista colegio" },
  { href: "/dashboard/utp", label: "Panel UTP", subtitle: "Seguimiento institucional" },
  { href: "/dashboard/direccion", label: "Panel Dirección", subtitle: "Gestión y resultados" },
]

function normalizeDashboardNavRole(raw: string): string {
  const r = String(raw ?? "").trim().toUpperCase()
  if (r === "DOCENTE" || r === "TEACHER") return "TEACHER"
  return r
}

/** Misma regla que en dashboard/layout.tsx (solo UX). */
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

export function DashboardSidebarNav({ navRole }: { navRole: string }) {
  const pathname = usePathname() ?? ""
  const visibleItems = ITEMS.filter((item) => showDashboardShellLink(navRole, item.href))

  return (
    <nav className="space-y-1" aria-label="Módulos del panel">
      {visibleItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "block rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-950 shadow-sm"
                : "block rounded-md border border-transparent px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
            }
          >
            <span className="block">{item.label}</span>
            <span className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">{item.subtitle}</span>
          </Link>
        )
      })}
    </nav>
  )
}
