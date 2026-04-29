import { Suspense } from "react"
import { DocenteDashboardClient } from "./docente-dashboard-client"

export default function DocenteDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Cargando panel docente…
        </div>
      }
    >
      <DocenteDashboardClient />
    </Suspense>
  )
}
