// app/api/evaluate/batch/route.ts
// Endpoint para evaluación masiva: lotes secuenciales (N en paralelo dentro de cada lote), streaming NDJSON
import { NextRequest } from "next/server"
import type { EvaluateBatchNdjsonDone, EvaluateBatchNdjsonMeta } from "@/app/lib/evaluate-batch-ndjson"

export const runtime = "nodejs"
// REFIX_404_RAILWAY: mantener respuesta dinámica en producción Railway
export const dynamic = "force-dynamic"
// REFIX_404_RAILWAY: timeout ampliado para evitar corte en rama serverless
export const maxDuration = 300

/** Paralelismo por lote: completar el lote antes del siguiente (evita timeout 300s y picos de RAM en piloto). */
const BATCH_SIZE = 7

interface BatchItem {
  groupId: string
  payload: any
}

export async function POST(req: NextRequest) {
  const { items } = await req.json() as { items: BatchItem[] }

  if (!items || items.length === 0) {
    return new Response(
      JSON.stringify({ type: "error", error: "No se proporcionaron items para evaluar" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  // Regla de oro: /api/evaluate obtiene user y profile desde cookies; NO inyectar teacher_id/school_id en el body.
  // Solo reenviar las cookies para que cada item se guarde con el mismo user_id y profile.teacher_id.
  const itemsToProcess = items
  const totalBatches = Math.ceil(itemsToProcess.length / BATCH_SIZE)

  // Crear stream para respuestas NDJSON
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Enviar metadata inicial
      const metaLine: EvaluateBatchNdjsonMeta = {
        type: "meta",
        totalItems: itemsToProcess.length,
        totalBatches,
        batchSize: BATCH_SIZE,
      }
      controller.enqueue(encoder.encode(JSON.stringify(metaLine) + "\n"))

      let completedCount = 0

      // Procesar en batches
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * BATCH_SIZE
        const batchEnd = Math.min(batchStart + BATCH_SIZE, itemsToProcess.length)
        const currentBatch = itemsToProcess.slice(batchStart, batchEnd)

        // Procesar batch en paralelo
        const promises = currentBatch.map(async (item) => {
          try {
            const cookieHeader = req.headers.get("cookie") || ""
            const response = await fetch(new URL("/api/evaluate", req.url), {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
              body: JSON.stringify(item.payload),
            })

            const data = await response.json()

            if (data.success) {
              return {
                type: "result",
                groupId: item.groupId,
                success: true,
                data,
              }
            } else {
              return {
                type: "result",
                groupId: item.groupId,
                success: false,
                error: data.error || "Error en evaluación",
              }
            }
          } catch (error: any) {
            return {
              type: "result",
              groupId: item.groupId,
              success: false,
              error: error?.message || "Error de red",
            }
          }
        })

        // Esperar resultados del batch actual
        const results = await Promise.all(promises)

        // Enviar cada resultado al stream
        for (const result of results) {
          completedCount++
          controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"))
        }
      }

      const doneLine: EvaluateBatchNdjsonDone = { type: "done", completedCount }
      controller.enqueue(encoder.encode(JSON.stringify(doneLine) + "\n"))

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  })
}
