import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isAsyncEvaluationServerEnabled } from "@/app/lib/async-evaluation-flags"
import { isUuid } from "@/app/lib/evaluation-job-contract"
import {
  enqueueEvaluationJob,
  PayloadTooLargeError,
  RedisUnavailableError,
} from "@/app/api/evaluate/jobStore"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/evaluate/start
 * Auth por cookies. Idempotencia Redis. No motor, no créditos, no persistencia.
 * Requiere ASYNC_EVALUATION_WRAPPER_ENABLED=true|1 (server-only). Default: off → 404.
 */
export async function POST(request: NextRequest) {
  if (!isAsyncEvaluationServerEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: "Evaluación asíncrona deshabilitada",
        code: "ASYNC_WRAPPER_DISABLED",
      },
      { status: 404 },
    )
  }

  try {
    const user = await getAuthUser()
    if (!user?.id) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: "Cuerpo de solicitud inválido (JSON)" },
        { status: 400 },
      )
    }

    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
    const clientRequestId =
      typeof record.client_request_id === "string"
        ? record.client_request_id.trim()
        : typeof record.clientRequestId === "string"
          ? record.clientRequestId.trim()
          : ""

    if (!isUuid(clientRequestId)) {
      return NextResponse.json(
        { success: false, error: "client_request_id UUID requerido" },
        { status: 400 },
      )
    }

    // Payload de evaluación: mismo body que /api/evaluate, sin confiar user_id del cliente.
    const { client_request_id: _a, clientRequestId: _b, user_id: _u, userId: _u2, ...payloadRest } =
      record
    const payload = Object.keys(payloadRest).length > 0 ? payloadRest : record

    // Ignorar cualquier identidad enviada por el cliente
    if (payload && typeof payload === "object") {
      delete (payload as Record<string, unknown>).user_id
      delete (payload as Record<string, unknown>).userId
      delete (payload as Record<string, unknown>).teacher_id
      delete (payload as Record<string, unknown>).school_id
    }

    const { job, reused_existing_job } = await enqueueEvaluationJob({
      ownerUserId: user.id,
      clientRequestId,
      payload,
    })

    return NextResponse.json(
      {
        success: true,
        job_id: job.job_id,
        client_request_id: job.client_request_id,
        status: job.status,
        reused_existing_job,
      },
      { status: 202 },
    )
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: "PAYLOAD_TOO_LARGE",
          byteLength: error.byteLength,
          limit: error.limit,
        },
        { status: 413 },
      )
    }
    if (error instanceof RedisUnavailableError) {
      return NextResponse.json(
        { success: false, error: error.message, code: "REDIS_UNAVAILABLE" },
        { status: 503 },
      )
    }
    console.error("[evaluate/start] error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json(
      { success: false, error: "Error al iniciar evaluación asíncrona" },
      { status: 500 },
    )
  }
}
