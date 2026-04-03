import type { Metadata } from "next"
import { MovilScanClient } from "./MovilScanClient"

export const metadata: Metadata = {
  title: "Captura móvil | LibelIA",
  robots: { index: false, follow: false },
}

type Props = { searchParams: { batch_id?: string } }

/**
 * Paso C: cámara + subida a batch-scans y fila en batch_photo_uploads (student_index / page_index).
 * No incluye motor OMR ni evaluate.
 */
export default function MovilScanPage({ searchParams }: Props) {
  const batchId = String(searchParams?.batch_id ?? "").trim()
  return <MovilScanClient initialBatchId={batchId} />
}
