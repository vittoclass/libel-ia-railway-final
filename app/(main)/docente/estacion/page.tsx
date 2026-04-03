import type { Metadata } from "next"
import { DocenteEstacionClient } from "./DocenteEstacionClient"

export const metadata: Metadata = {
  title: "Estación docente | LibelIA",
  description: "Centro de mando: carga horaria, QR móvil y cola de fotos (Paso B).",
}

export default function DocenteEstacionPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <DocenteEstacionClient />
    </div>
  )
}
