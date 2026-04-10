import * as React from "react"
import "./utp-print.css"

/**
 * Layout exclusivo UTP: carga CSS de impresión sin afectar otras rutas del dashboard.
 */
export default function UtpDashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
