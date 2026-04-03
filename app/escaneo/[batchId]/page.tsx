import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { EstacionMovilClient } from "./EstacionMovilClient"

/** Pública: validación del lote vía /api/docente/batch-session/public (batch_scan_sessions). */

export const metadata: Metadata = {
  title: "Escaneo móvil | Libelia",
  robots: { index: false, follow: false },
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Props = { params: { batchId: string } }

export default function EscaneoBatchPage({ params }: Props) {
  const batchId = String(params?.batchId ?? "").trim()
  if (!UUID_REGEX.test(batchId)) {
    notFound()
  }
  return <EstacionMovilClient batchId={batchId} />
}
