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
  console.log("[evaluate/batch] ANTES req.json()")
  const { items } = await req.json() as { items: BatchItem[] }
  console.log("[evaluate/batch] DESPUÉS req.json()", { itemCount: Array.isArray(items) ? items.length : 0 })

  if (!items || items.length === 0) {
    return new Response(
      JSON.stringify({ type: "error", error: "No se proporcionaron items para evaluar" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  // Regla de oro: /api/evaluate obtiene user y profile desde cookies; NO inyectar teacher_id/school_id en el body.
  // Solo reenviar las cookies para que cada item se guarde con el mismo user_id y profile.teacher_id.
  // getAuthUser() usa cliente read-only (supabase-route) para no llamar cookies().set dentro del stream.
  const itemsToProcess = items
  const totalBatches = Math.ceil(itemsToProcess.length / BATCH_SIZE)

  // Crear stream para respuestas NDJSON
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
      console.log("[evaluate/batch] Stream start", {
        totalItems: itemsToProcess.length,
        totalBatches,
        batchSize: BATCH_SIZE,
        nota: "Mistral / Supabase / imágenes ocurren dentro de cada POST /api/evaluate",
      })
      // Enviar metadata inicial
      const metaLine: EvaluateBatchNdjsonMeta = {
        type: "meta",
        totalItems: itemsToProcess.length,
        totalBatches,
        batchSize: BATCH_SIZE,
      }
      controller.enqueue(encoder.encode(JSON.stringify(metaLine) + "\n"))
      console.log("[evaluate/batch] DESPUÉS enqueue meta NDJSON")

      let completedCount = 0

      // Procesar en batches
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * BATCH_SIZE
        const batchEnd = Math.min(batchStart + BATCH_SIZE, itemsToProcess.length)
        const currentBatch = itemsToProcess.slice(batchStart, batchEnd)
        console.log("[evaluate/batch] ANTES lote paralelo", {
          batchIndex: batchIndex + 1,
          totalBatches,
          slice: [batchStart, batchEnd],
          groupIds: currentBatch.map((i) => i.groupId),
        })

        // Procesar batch en paralelo
        const promises = currentBatch.map(async (item) => {
          try {
            const cookieHeader = req.headers.get("cookie") || ""
            const evaluateUrl = new URL("/api/evaluate", req.url).toString()
            console.log("[evaluate/batch] ANTES fetch /api/evaluate", { groupId: item.groupId, evaluateUrl })
            const response = await fetch(new URL("/api/evaluate", req.url), {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
              body: JSON.stringify(item.payload),
            })
            console.log("[evaluate/batch] DESPUÉS fetch /api/evaluate", {
              groupId: item.groupId,
              ok: response.ok,
              status: response.status,
            })

            console.log("[evaluate/batch] ANTES response.json()", { groupId: item.groupId })
            const data = await response.json()
            console.log("[evaluate/batch] DESPUÉS response.json()", {
              groupId: item.groupId,
              success: !!(data as { success?: boolean }).success,
            })

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
            console.error("[evaluate/batch] catch item fetch/json", {
              groupId: item.groupId,
              message: error?.message,
              stack: typeof error?.stack === "string" ? error.stack.slice(0, 500) : undefined,
            })
            return {
              type: "result",
              groupId: item.groupId,
              success: false,
              error: error?.message || "Error de red",
            }
          }
        })

        // Esperar resultados del batch actual
        console.log("[evaluate/batch] ANTES Promise.all(lote)", { batchIndex: batchIndex + 1 })
        const results = await Promise.all(promises)
        console.log("[evaluate/batch] DESPUÉS Promise.all(lote)", { batchIndex: batchIndex + 1, n: results.length })

        // Enviar cada resultado al stream
        for (const result of results) {
          completedCount++
          controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"))
        }
        console.log("[evaluate/batch] DESPUÉS enqueue resultados lote", {
          batchIndex: batchIndex + 1,
          completedCount,
        })
      }

      const doneLine: EvaluateBatchNdjsonDone = { type: "done", completedCount }
      controller.enqueue(encoder.encode(JSON.stringify(doneLine) + "\n"))
      console.log("[evaluate/batch] Stream cerrado OK", { completedCount })

      controller.close()
      } catch (streamErr) {
        console.error("[evaluate/batch] FATAL en stream start()", {
          message: streamErr instanceof Error ? streamErr.message : String(streamErr),
          stack: streamErr instanceof Error ? streamErr.stack?.slice(0, 800) : undefined,
        })
        try {
          controller.error(streamErr instanceof Error ? streamErr : new Error(String(streamErr)))
        } catch {
          try {
            controller.close()
          } catch {
            /* ignore */
          }
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
    },
  })
}
