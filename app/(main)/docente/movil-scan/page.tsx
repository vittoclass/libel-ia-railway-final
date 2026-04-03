import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { MovilScanClient } from "./MovilScanClient"

export const metadata: Metadata = {
  title: "Captura móvil | LibelIA",
  robots: { index: false, follow: false },
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Props = { searchParams: { batch_id?: string } }

/**
 * Redirige al flujo público /escaneo/[batchId] cuando hay batch_id válido.
 */
export default function MovilScanPage({ searchParams }: Props) {
  const batchId = String(searchParams?.batch_id ?? "").trim()
  if (UUID_REGEX.test(batchId)) {
    redirect(`/escaneo/${batchId}`)
  }
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <MovilScanClient initialBatchId={batchId} />
    </div>
  )
}
