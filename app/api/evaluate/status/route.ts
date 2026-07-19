import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isAsyncEvaluationServerEnabled } from "@/app/lib/async-evaluation-flags"
import { toClientStatusView } from "@/app/lib/evaluation-job-contract"
import { readJob, RedisUnavailableError } from "@/app/api/evaluate/jobStore"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/evaluate/status?job_id=...
 * Auth + ownership. completed → result exacto. Sin payload ni owner_user_id.
 * Requiere ASYNC_EVALUATION_WRAPPER_ENABLED=true|1 (server-only). Default: off → 404.
 */
export async function GET(request: NextRequest) {
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

    const jobId =
      request.nextUrl.searchParams.get("job_id")?.trim() ||
      request.nextUrl.searchParams.get("jobId")?.trim() ||
      ""

    if (!jobId) {
      return NextResponse.json({ success: false, error: "job_id requerido" }, { status: 400 })
    }

    const job = await readJob(jobId)
    if (!job) {
      return NextResponse.json({ success: false, error: "Trabajo no encontrado" }, { status: 404 })
    }

    if (job.owner_user_id !== user.id) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(toClientStatusView(job))
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      return NextResponse.json(
        { success: false, error: error.message, code: "REDIS_UNAVAILABLE" },
        { status: 503 },
      )
    }
    console.error("[evaluate/status] error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json(
      { success: false, error: "Error al consultar estado de evaluación" },
      { status: 500 },
    )
  }
}
