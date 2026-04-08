// app/api/evaluate/batch/route.ts
// Evaluación masiva: invoca la lógica de /api/evaluate en proceso (sin fetch interno), un estudiante a la vez, NDJSON.
import { NextRequest } from "next/server"
import { executeEvaluatePostBody } from "../evaluation-logic"
import type { EvaluateBatchNdjsonDone, EvaluateBatchNdjsonMeta } from "@/app/lib/evaluate-batch-ndjson"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Un resultado por estudiante; batchSize en meta = 1 para barra de progreso en cliente. */
const SEQUENTIAL_META_BATCH_SIZE = 1

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
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  const itemsToProcess = items
  const totalBatches = itemsToProcess.length

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log("[evaluate/batch] Stream start (secuencial, sin HTTP interno)", {
          totalItems: itemsToProcess.length,
          totalBatches,
          batchSize: SEQUENTIAL_META_BATCH_SIZE,
        })

        const metaLine: EvaluateBatchNdjsonMeta = {
          type: "meta",
          totalItems: itemsToProcess.length,
          totalBatches,
          batchSize: SEQUENTIAL_META_BATCH_SIZE,
        }
        controller.enqueue(encoder.encode(JSON.stringify(metaLine) + "\n"))
        console.log("[evaluate/batch] DESPUÉS enqueue meta NDJSON")

        let completedCount = 0

        for (const item of itemsToProcess) {
          const groupId = item.groupId
          let payload: unknown = item.payload
          console.log("[evaluate/batch] ANTES executeEvaluatePostBody", { groupId })

          try {
            const response = await executeEvaluatePostBody(payload)
            console.log("[evaluate/batch] DESPUÉS executeEvaluatePostBody", {
              groupId,
              ok: response.ok,
              status: response.status,
            })

            console.log("[evaluate/batch] ANTES NextResponse.json()", { groupId })
            const data = await response.json()
            console.log("[evaluate/batch] DESPUÉS NextResponse.json()", {
              groupId,
              success: !!(data as { success?: boolean }).success,
            })

            const result =
              (data as { success?: boolean }).success === true
                ? {
                    type: "result" as const,
                    groupId,
                    success: true as const,
                    data,
                  }
                : {
                    type: "result" as const,
                    groupId,
                    success: false as const,
                    error: (data as { error?: string }).error || "Error en evaluación",
                  }

            completedCount++
            controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"))
          } catch (error: unknown) {
            console.error("[evaluate/batch] catch item", {
              groupId,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
            })
            completedCount++
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "result",
                  groupId,
                  success: false,
                  error: error instanceof Error ? error.message : "Error al evaluar",
                }) + "\n",
              ),
            )
          } finally {
            try {
              item.payload = null
            } catch {
              /* ignore */
            }
            payload = null
          }

          console.log("[evaluate/batch] liberado payload en memoria (hint GC)", { groupId, completedCount })
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
