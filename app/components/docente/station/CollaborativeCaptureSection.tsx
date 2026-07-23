"use client"

/**
 * Sección aislada de captura colaborativa: registra el mismo batch_session
 * que el flujo tradicional y muestra la proyección de QR.
 * No reemplaza BatchMobileSyncPanel.
 */

import { useEffect, useState } from "react"
import {
  CollaborativeQrProjectionGrid,
} from "@/app/components/docente/station/CollaborativeQrProjectionGrid"
import type { BatchSessionStatusPayload } from "@/app/components/docente/station/BatchMobileSyncPanel"
import type { CollaborativeSlotLabel } from "@/app/lib/docente/collaborative-capture"

type Props = {
  batchId: string
  slotCount: number
  label: CollaborativeSlotLabel
  expectedPagesPerStudent?: number
  sourceExamId?: string | null
  sessionContext?: string | null
  onBatchSessionStatus?: (payload: BatchSessionStatusPayload) => void
  onChangeMode?: () => void
}

export function CollaborativeCaptureSection({
  batchId,
  slotCount,
  label,
  expectedPagesPerStudent = 2,
  sourceExamId = null,
  sessionContext = null,
  onBatchSessionStatus,
  onChangeMode,
}: Props) {
  const [batchSessionOk, setBatchSessionOk] = useState<boolean | null>(null)

  useEffect(() => {
    if (!batchId) return
    let cancelled = false
    void (async () => {
      const requestPayload: Record<string, unknown> = {
        batch_id: batchId,
        expected_pages_per_student: expectedPagesPerStudent,
        source_exam_id: sourceExamId ?? null,
      }
      const ctx = typeof sessionContext === "string" ? sessionContext.trim() : ""
      if (ctx) requestPayload.session_context = ctx

      const emitStatus = (p: BatchSessionStatusPayload) => {
        onBatchSessionStatus?.(p)
      }

      try {
        const res = await fetch("/api/docente/batch-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(requestPayload),
        })
        const text = await res.text()
        let responseJson: unknown = {}
        let rawTextSnippet: string | undefined
        try {
          responseJson = text && text.length > 0 ? JSON.parse(text) : {}
        } catch {
          rawTextSnippet = text.slice(0, 500)
          responseJson = {
            ok: false,
            error: "La respuesta del servidor no es JSON (posible error HTML o vacío).",
            rawTextSnippet,
          }
        }
        if (cancelled) return
        const j = responseJson as { ok?: boolean; error?: string }
        const ok = res.ok && j?.ok === true
        setBatchSessionOk(ok)
        if (ok) {
          emitStatus({
            ok: true,
            httpStatus: res.status,
            message: "ok",
            requestPayload,
            responseJson,
          })
        } else {
          const msg =
            typeof j?.error === "string" && j.error.length > 0 ? j.error : `Error HTTP ${res.status}`
          emitStatus({
            ok: false,
            httpStatus: res.status,
            message: msg,
            requestPayload,
            responseJson,
            rawTextSnippet,
          })
        }
      } catch (e) {
        if (cancelled) return
        setBatchSessionOk(false)
        const ex = e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e)
        emitStatus({
          ok: false,
          httpStatus: 0,
          message: "No se pudo contactar al servidor para registrar el lote.",
          requestPayload,
          responseJson: { networkOrParse: true, exception: ex },
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [batchId, expectedPagesPerStudent, sourceExamId, sessionContext, onBatchSessionStatus])

  return (
    <div className="space-y-3">
      {batchSessionOk === false ? (
        <p className="text-xs text-rose-800 bg-rose-50 border border-rose-100 rounded-md px-2 py-1.5">
          No se pudo registrar el lote en el servidor. Los códigos pueden mostrarse, pero el móvil podría
          rechazar subidas hasta que la sesión se registre.
        </p>
      ) : null}
      <CollaborativeQrProjectionGrid
        batchId={batchId}
        slotCount={slotCount}
        label={label}
        expectedPagesPerStudent={expectedPagesPerStudent}
        onChangeMode={onChangeMode}
      />
    </div>
  )
}
