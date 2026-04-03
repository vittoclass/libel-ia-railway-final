import { NextRequest, NextResponse } from "next/server"
import { getAuthUser, getSupabaseRouteClient } from "@/app/lib/supabase-route"
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
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: "No autorizado: sesión no válida o expirada en el PC.",
          supabase: null,
          debug: { step: "getAuthUser", userPresent: false },
        },
        { status: 401 },
      )
    }

    let body: { batch_id?: string }
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

    let routeClient
    try {
      routeClient = await getSupabaseRouteClient()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[batch-session] getSupabaseRouteClient falló:", msg)
      return NextResponse.json(
        {
          ok: false,
          error: `Error interno al crear cliente de sesión: ${msg}`,
          supabase: null,
          debug: { step: "getSupabaseRouteClient", exception: exceptionPayload(e) },
        },
        { status: 500 },
      )
    }

    const { data: profile, error: pErr } = await routeClient
      .from("profiles")
      .select("teacher_id, school_id")
      .eq("user_id", user.id)
      .maybeSingle()

    if (pErr) {
      logSupabaseError("profiles.select", batchId, pErr)
      return NextResponse.json(
        {
          ok: false,
          error: pErr.message,
          supabase: supabasePayload(pErr),
          debug: { step: "profiles.select", batchId, userId: user.id },
        },
        { status: 500 },
      )
    }

    const teacherId = String((profile as { teacher_id?: string | null } | null)?.teacher_id ?? "").trim()
    const schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
    if (!teacherId || !schoolId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Perfil incompleto: asigne teacher_id y school_id al usuario en Supabase (tabla profiles) antes de usar el QR móvil.",
          supabase: null,
          debug: {
            step: "profile.teacher_school",
            batchId,
            teacherIdPresent: !!teacherId,
            schoolIdPresent: !!schoolId,
            profileRow: profile ?? null,
          },
        },
        { status: 400 },
      )
    }

    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + TTL_HOURS)

    const row = {
      batch_id: batchId,
      teacher_id: teacherId,
      school_id: schoolId,
      created_by: user.id,
      expires_at: expiresAt.toISOString(),
    }

    let upErr: { message: string; code?: string; details?: string; hint?: string } | null = null
    try {
      const res = await server.from("batch_scan_sessions").upsert(row, {
        onConflict: "batch_id",
      })
      upErr = res.error
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[batch-session] Excepción en upsert (no PostgREST):", batchId, msg, e)
      return NextResponse.json(
        {
          ok: false,
          error: msg,
          supabase: null,
          debug: { step: "batch_scan_sessions.upsert.throw", batchId, row, exception: exceptionPayload(e) },
        },
        { status: 500 },
      )
    }

    if (upErr) {
      logSupabaseError("batch_scan_sessions.upsert", batchId, upErr)
      return NextResponse.json(
        {
          ok: false,
          error: upErr.message,
          supabase: supabasePayload(upErr),
          debug: { step: "batch_scan_sessions.upsert", batchId, row },
        },
        { status: upErr.code === "42P01" ? 503 : upErr.code === "42501" ? 503 : 500 },
      )
    }

    console.log("[batch-session] Lote registrado con éxito:", batchId)

    return NextResponse.json({ ok: true, expires_at: expiresAt.toISOString() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[batch-session] Error no manejado:", msg, e)
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        supabase: null,
        debug: { step: "POST.catch", exception: exceptionPayload(e), raw: String(e) },
      },
      { status: 500 },
    )
  }
}
