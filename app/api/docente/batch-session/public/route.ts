import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function supabasePayload(err: { message?: string; code?: string; details?: string; hint?: string } | null) {
  if (!err) return null
  return {
    message: err.message ?? null,
    code: err.code ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
  }
}

/**
 * GET /api/docente/batch-session/public?batch_id= — Sin auth.
 * Errores: JSON crudo con `supabase` completo y `debug` para diagnóstico en el celular.
 */
export async function GET(req: NextRequest) {
  const batchId = String(req.nextUrl.searchParams.get("batch_id") ?? "").trim()
  if (!UUID_REGEX.test(batchId)) {
    return NextResponse.json(
      {
        ok: false,
        error: "batch_id inválido",
        supabase: null,
        debug: { step: "validateUuid", batch_id_param: req.nextUrl.searchParams.get("batch_id"), trimmed: batchId },
      },
      { status: 400 },
    )
  }

  console.log("[batch-session/public] Buscando Lote:", batchId)

  const supabase = getSupabaseServer()
  if (!supabase) {
    const keyPresent = !!(process.env.SUPABASE_SERVICE_ROLE_KEY && String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim())
    return NextResponse.json(
      {
        ok: false,
        error: "Servidor no configurado: sin cliente Supabase (SUPABASE_SERVICE_ROLE_KEY o URL).",
        supabase: null,
        debug: {
          step: "getSupabaseServer",
          SUPABASE_SERVICE_ROLE_KEY_present: keyPresent,
          SUPABASE_URL_present: !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
        },
      },
      { status: 503 },
    )
  }

  const { data, error } = await supabase
    .from("batch_scan_sessions")
    .select("batch_id, expires_at, expected_pages_per_student, source_exam_id")
    .eq("batch_id", batchId)
    .maybeSingle()

  if (error) {
    console.error("[batch-session/public] Supabase select error:", JSON.stringify(supabasePayload(error)))
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        supabase: supabasePayload(error),
        debug: { step: "batch_scan_sessions.select", batchId },
      },
      { status: error.code === "42P01" ? 503 : 500 },
    )
  }

  if (!data) {
    console.warn("[batch-session/public] Lote no encontrado en BD:", batchId)
    return NextResponse.json(
      {
        ok: false,
        error: "Lote no registrado. Actualice el QR desde la estación PC.",
        supabase: null,
        debug: {
          step: "batch_scan_sessions.select.no_row",
          batchId,
          explanation: "SELECT devolvió 0 filas para este batch_id (no insertado o UUID distinto al del PC).",
        },
      },
      { status: 404 },
    )
  }

  const exp = new Date(String((data as { expires_at: string }).expires_at))
  if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Este código QR expiró. Genere uno nuevo en el PC.",
        supabase: null,
        debug: {
          step: "expires_at",
          batchId,
          expires_at: (data as { expires_at: string }).expires_at,
          now: new Date().toISOString(),
        },
      },
      { status: 410 },
    )
  }

  const row = data as {
    expected_pages_per_student?: number | null
    source_exam_id?: string | null
  }

  return NextResponse.json({
    ok: true,
    batch_id: batchId,
    expected_pages_per_student:
      row.expected_pages_per_student != null && Number.isFinite(Number(row.expected_pages_per_student))
        ? Math.max(1, Math.min(50, Math.floor(Number(row.expected_pages_per_student))))
        : 2,
    source_exam_id: row.source_exam_id ?? null,
  })
}
