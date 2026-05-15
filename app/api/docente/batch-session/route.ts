import { NextRequest, NextResponse } from "next/server"
import { getSupabaseRouteClientReadOnly } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const TTL_HOURS = 72

type SupabaseErrShape = { message: string | null; code: string | null; details: string | null; hint: string | null }

function supabasePayload(err: { message?: string; code?: string; details?: string; hint?: string } | null): SupabaseErrShape | null {
  if (!err) return null
  return {
    message: err.message ?? null,
    code: err.code ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
  }
}

function logSupabaseError(scope: string, batchId: string, err: { message?: string; code?: string; details?: string; hint?: string }) {
  console.error("[batch-session] Supabase:", JSON.stringify({ scope, batchId, ...supabasePayload(err) }))
}

/** Log estructurado temporal (sin secretos); incluye code/message/details/hint de PostgREST cuando existen. */
function logBatchSessionError(payload: Record<string, unknown>) {
  try {
    console.error("[batch-session][error]", JSON.stringify({ ts: new Date().toISOString(), ...payload }))
  } catch {
    console.error("[batch-session][error]", payload.step, payload.batchId)
  }
}

function httpStatusForPostgrest(err: { code?: string | null } | null): number {
  const c = err?.code ?? ""
  if (c === "42P01" || c === "42501") return 503
  if (c === "23503" || c === "23514" || c === "PGRST116") return 400
  if (c === "42703" || c === "PGRST204") return 503
  return 422
}

function exceptionPayload(e: unknown) {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack ?? null }
  }
  return { raw: String(e) }
}

/**
 * POST /api/docente/batch-session — Registra el lote desde la estación PC (autenticado).
 * En errores, el JSON incluye siempre `supabase: { message, details, hint, code }` cuando aplica (o null).
 */
export async function POST(req: NextRequest) {
  let batchIdForLog = ""
  try {
    /** Solo lectura de cookies: evita intentos de refresh que llamen `cookies().set` en Route Handler (puede tumbar la ruta con 500 sin JSON). */
    let routeClient
    try {
      routeClient = await getSupabaseRouteClientReadOnly()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logBatchSessionError({
        step: "getSupabaseRouteClientReadOnly",
        message: msg,
        exception: exceptionPayload(e),
      })
      return NextResponse.json(
        {
          ok: false,
          error: `Error al inicializar cliente de sesión (solo lectura): ${msg}`,
          supabase: null,
          debug: { step: "getSupabaseRouteClientReadOnly", exception: exceptionPayload(e) },
        },
        { status: 503 },
      )
    }

    const {
      data: { user },
      error: authErr,
    } = await routeClient.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: "No autorizado: sesión no válida o expirada en el PC.",
          supabase: supabasePayload(authErr),
          debug: { step: "auth.getUser", userPresent: !!user, authMessage: authErr?.message ?? null },
        },
        { status: 401 },
      )
    }

    let body: {
      batch_id?: string
      expected_pages_per_student?: number
      source_exam_id?: string | null
      session_context?: string | null
    } = {}
    try {
      body = await req.json()
    } catch (parseErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "JSON inválido en el cuerpo de la petición.",
          supabase: null,
          debug: { step: "parseBody", exception: exceptionPayload(parseErr) },
        },
        { status: 400 },
      )
    }

    const batchId = String(body?.batch_id ?? "").trim()
    batchIdForLog = batchId
    if (!UUID_REGEX.test(batchId)) {
      return NextResponse.json(
        {
          ok: false,
          error: "batch_id inválido: debe ser un UUID v4.",
          supabase: null,
          debug: { step: "validateUuid", received: body?.batch_id ?? null, trimmed: batchId },
        },
        { status: 400 },
      )
    }

    const serviceKeyRaw = process.env.SUPABASE_SERVICE_ROLE_KEY
    const serviceKey = typeof serviceKeyRaw === "string" ? serviceKeyRaw.trim() : ""
    if (!serviceKey) {
      console.error(
        "[batch-session] Variable ausente: SUPABASE_SERVICE_ROLE_KEY",
        JSON.stringify({
          defined: serviceKeyRaw !== undefined,
          emptyOrWhitespace: serviceKeyRaw !== undefined && String(serviceKeyRaw).trim().length === 0,
        }),
      )
      return NextResponse.json(
        {
          ok: false,
          error:
            "Servidor mal configurado: falta SUPABASE_SERVICE_ROLE_KEY en Railway (o está vacía). No se usa ninguna otra variable para el rol de servicio.",
          supabase: null,
          debug: {
            step: "env.SUPABASE_SERVICE_ROLE_KEY",
            defined: serviceKeyRaw !== undefined,
            lengthAfterTrim: serviceKey.length,
          },
        },
        { status: 503 },
      )
    }

    const server = getSupabaseServer()
    if (!server) {
      const urlOk = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
      console.error(
        "[batch-session] getSupabaseServer() null pese a tener key",
        JSON.stringify({ supabaseUrlConfigured: urlOk }),
      )
      return NextResponse.json(
        {
          ok: false,
          error: urlOk
            ? "Cliente servidor Supabase no inicializado (revisar SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL)."
            : "Falta SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL además de SUPABASE_SERVICE_ROLE_KEY.",
          supabase: null,
          debug: { step: "getSupabaseServer", supabaseUrlConfigured: urlOk },
        },
        { status: 503 },
      )
    }

    const sessionContextRaw = typeof body?.session_context === "string" ? body.session_context.trim() : ""
    const sessionContextLogged = sessionContextRaw.length > 400 ? `${sessionContextRaw.slice(0, 400)}…` : sessionContextRaw

    const { data: profile, error: pErr } = await routeClient
      .from("profiles")
      .select("teacher_id, school_id")
      .eq("user_id", user.id)
      .maybeSingle()

    if (pErr) {
      logSupabaseError("profiles.select", batchId, pErr)
      logBatchSessionError({
        step: "profiles.select",
        batchId,
        userId: user.id,
        supabase: supabasePayload(pErr),
      })
      const st = httpStatusForPostgrest(pErr)
      return NextResponse.json(
        {
          ok: false,
          error: pErr.message || "No se pudo leer el perfil del usuario.",
          error_code: "PROFILE_QUERY",
          supabase: supabasePayload(pErr),
          debug: { step: "profiles.select", batchId, userId: user.id },
        },
        { status: st },
      )
    }

    const teacherId = String((profile as { teacher_id?: string | null } | null)?.teacher_id ?? "").trim()
    const schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
    if (!teacherId || !schoolId) {
      logBatchSessionError({
        step: "profile.teacher_school",
        batchId,
        teacherIdPresent: !!teacherId,
        schoolIdPresent: !!schoolId,
      })
      return NextResponse.json(
        {
          ok: false,
          error:
            "Perfil incompleto: asigne teacher_id y school_id al usuario en Supabase (tabla profiles) antes de usar el QR móvil.",
          error_code: "PROFILE_INCOMPLETE",
          supabase: null,
          debug: {
            step: "profile.teacher_school",
            batchId,
            teacherIdPresent: !!teacherId,
            schoolIdPresent: !!schoolId,
            profileSnippet: profile ? { teacher_id: teacherId || null, school_id: schoolId || null } : null,
          },
        },
        { status: 400 },
      )
    }

    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + TTL_HOURS)

    const rawPages = Number(body?.expected_pages_per_student)
    const expectedPages =
      Number.isFinite(rawPages) && rawPages >= 1 ? Math.min(50, Math.floor(rawPages)) : 2

    let sourceExamId: string | null = null
    const sex = body?.source_exam_id
    if (typeof sex === "string" && UUID_REGEX.test(sex.trim())) {
      sourceExamId = sex.trim()
    }

    const row: Record<string, unknown> = {
      batch_id: batchId,
      teacher_id: teacherId,
      school_id: schoolId,
      created_by: user.id,
      expires_at: expiresAt.toISOString(),
      expected_pages_per_student: expectedPages,
      source_exam_id: sourceExamId,
    }

    let upErr: { message: string; code?: string; details?: string; hint?: string } | null = null
    try {
      const res = await server.from("batch_scan_sessions").upsert(row, {
        onConflict: "batch_id",
      })
      upErr = res.error
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logBatchSessionError({
        step: "batch_scan_sessions.upsert.throw",
        batchId,
        message: msg,
        exception: exceptionPayload(e),
      })
      console.error("[batch-session] Excepción en upsert (no PostgREST):", batchId, msg, e)
      return NextResponse.json(
        {
          ok: false,
          error: msg,
          error_code: "BATCH_SCAN_SESSIONS_UPSERT_THROW",
          supabase: null,
          debug: { step: "batch_scan_sessions.upsert.throw", batchId, row, exception: exceptionPayload(e) },
        },
        { status: 503 },
      )
    }

    if (upErr) {
      logSupabaseError("batch_scan_sessions.upsert", batchId, upErr)
      logBatchSessionError({
        step: "batch_scan_sessions.upsert",
        batchId,
        supabase: supabasePayload(upErr),
        session_context: sessionContextLogged || undefined,
      })
      const st = httpStatusForPostgrest(upErr)
      return NextResponse.json(
        {
          ok: false,
          error: upErr.message,
          error_code: "BATCH_SCAN_SESSIONS_UPSERT",
          supabase: supabasePayload(upErr),
          debug: { step: "batch_scan_sessions.upsert", batchId, row },
        },
        { status: st },
      )
    }

    if (sessionContextLogged) {
      console.log("[batch-session] Lote registrado con éxito:", batchId, { session_context: sessionContextLogged })
    } else {
      console.log("[batch-session] Lote registrado con éxito:", batchId)
    }

    return NextResponse.json({ ok: true, expires_at: expiresAt.toISOString() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logBatchSessionError({
      step: "POST.catch",
      batchId: batchIdForLog || undefined,
      message: msg,
      exception: exceptionPayload(e),
    })
    console.error("[batch-session] Error no manejado:", msg, e)
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        error_code: "UNHANDLED",
        supabase: null,
        debug: { step: "POST.catch", exception: exceptionPayload(e), raw: String(e) },
      },
      { status: 500 },
    )
  }
}
