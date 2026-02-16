import { type NextRequest, NextResponse } from "next/server"

/**
 * POST /api/evaluate/batch
 * 
 * Recibe un array de payloads de evaluación y los procesa en paralelo.
 * Soporta hasta 3 lotes de 45 evaluaciones simultáneas (135 total).
 * 
 * Cada evaluación individual se envía internamente a /api/evaluate.
 * Los resultados se transmiten via streaming (NDJSON) para que el cliente
 * pueda actualizar el progreso en tiempo real.
 */

const BATCH_SIZE = 45      // Máximo de evaluaciones por lote
const MAX_CONCURRENT_BATCHES = 3 // Máximo de lotes simultáneos
const MAX_TOTAL = BATCH_SIZE * MAX_CONCURRENT_BATCHES // 135 evaluaciones máximas

interface BatchItem {
  groupId: string
  payload: Record<string, unknown>
}

interface BatchResult {
  groupId: string
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

export const maxDuration = 300 // 5 minutos de timeout para batches grandes

export async function POST(req: NextRequest) {
  try {
    const { items } = (await req.json()) as { items: BatchItem[] }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "No se proporcionaron evaluaciones para procesar." },
        { status: 400 },
      )
    }

    if (items.length > MAX_TOTAL) {
      return NextResponse.json(
        { success: false, error: `Máximo ${MAX_TOTAL} evaluaciones por batch (${MAX_CONCURRENT_BATCHES} lotes x ${BATCH_SIZE}).` },
        { status: 400 },
      )
    }

    // Dividir los items en lotes de hasta BATCH_SIZE
    const batches: BatchItem[][] = []
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE))
    }

    // Construir la URL base para llamar a /api/evaluate internamente
    const protocol = req.headers.get("x-forwarded-proto") || "https"
    const host = req.headers.get("host") || "localhost:3000"
    const evaluateUrl = `${protocol}://${host}/api/evaluate`

    // Streaming NDJSON response para progreso en tiempo real
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        // Enviar metadata inicial
        const meta = {
          type: "meta",
          totalItems: items.length,
          totalBatches: batches.length,
          batchSize: BATCH_SIZE,
          maxConcurrent: MAX_CONCURRENT_BATCHES,
        }
        controller.enqueue(encoder.encode(JSON.stringify(meta) + "\n"))

        // Procesar lotes con concurrencia limitada a MAX_CONCURRENT_BATCHES
        const processBatch = async (batch: BatchItem[], batchIndex: number) => {
          // Dentro de cada lote, procesamos TODAS las evaluaciones en paralelo
          const promises = batch.map(async (item) => {
            const result: BatchResult = { groupId: item.groupId, success: false }
            try {
              const response = await fetch(evaluateUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(item.payload),
              })

              const data = await response.json()
              
              if (response.ok && data.success) {
                result.success = true
                result.data = data
              } else {
                result.success = false
                result.error = data.error || `Error HTTP ${response.status}`
              }
            } catch (err) {
              result.success = false
              result.error = err instanceof Error ? err.message : "Error desconocido en evaluación"
            }

            // Enviar resultado individual al stream
            const progressItem = {
              type: "result",
              batchIndex,
              groupId: result.groupId,
              success: result.success,
              data: result.data,
              error: result.error,
            }
            controller.enqueue(encoder.encode(JSON.stringify(progressItem) + "\n"))
            
            return result
          })

          return Promise.all(promises)
        }

        // Ejecutar lotes con concurrencia controlada
        // Procesamos MAX_CONCURRENT_BATCHES lotes a la vez
        for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
          const concurrentBatches = batches.slice(i, i + MAX_CONCURRENT_BATCHES)
          const batchPromises = concurrentBatches.map((batch, idx) => 
            processBatch(batch, i + idx)
          )
          await Promise.all(batchPromises)
        }

        // Enviar señal de finalización
        const done = { type: "done" }
        controller.enqueue(encoder.encode(JSON.stringify(done) + "\n"))
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache, no-store",
        "Transfer-Encoding": "chunked",
      },
    })
  } catch (error) {
    console.error("Error en /api/evaluate/batch:", error)
    return NextResponse.json(
      { success: false, error: "Error interno del servidor en procesamiento batch." },
      { status: 500 },
    )
  }
}
