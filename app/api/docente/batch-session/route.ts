import { NextRequest, NextResponse } from "next/server"
import { getAuthUser, getSupabaseRouteClient } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const TTL_HOURS = 72

/** Serializa error de PostgREST / Supabase para logs (sin datos sensibles). */
function logSupabaseError(scope: string, batchId: string, err: { message?: string; code?: string; details?: string; hint?: string }) {
  const payload = {
    scope,
    batchId,
    message: err.message ?? "(sin mensaje)",
    code: err.code ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
  }
  console.error("[batch-session] Supabase:", JSON.stringify(payload))
}

/**
 * POST /api/docente/batch-session — Registra el lote desde la estación PC (autenticado).
 * Upsert en batch_scan_sessions con cliente service role (solo process.env.SUPABASE_SERVICE_ROLE_KEY).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: "No autorizado: sesión no válida o expirada en el PC." }, { status: 401 })
    }

    let body: { batch_id?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "JSON inválido en el cuerpo de la petición." }, { status: 400 })
    }

    const batchId = String(body?.batch_id ?? "").trim()
    if (!UUID_REGEX.test(batchId)) {
      return NextResponse.json({ error: "batch_id inválido: debe ser un UUID v4." }, { status: 400 })
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
          error:
            "Servidor mal configurado: falta SUPABASE_SERVICE_ROLE_KEY en Railway (o está vacía). No se usa ninguna otra variable para el rol de servicio.",
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
          error:
            urlOk
              ? "Cliente servidor Supabase no inicializado (revisar SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL)."
              : "Falta SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL además de SUPABASE_SERVICE_ROLE_KEY.",
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
      return NextResponse.json({ error: `Error interno al crear cliente de sesión: ${msg}` }, { status: 500 })
    }

    const { data: profile, error: pErr } = await routeClient
      .from("profiles")
      .select("teacher_id, school_id")
      .eq("user_id", user.id)
      .maybeSingle()

    if (pErr) {
      logSupabaseError("profiles.select", batchId, pErr)
      return NextResponse.json(
        { error: `Error al leer perfil: ${pErr.message}${pErr.hint ? ` (${pErr.hint})` : ""}` },
        { status: 500 },
      )
    }

    const teacherId = String((profile as { teacher_id?: string | null } | null)?.teacher_id ?? "").trim()
    const schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
    if (!teacherId || !schoolId) {
      return NextResponse.json(
        {
          error:
            "Perfil incompleto: asigne teacher_id y school_id al usuario en Supabase (tabla profiles) antes de usar el QR móvil.",
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
      return NextResponse.json({ error: `Fallo al registrar lote: ${msg}` }, { status: 500 })
    }

    if (upErr) {
      logSupabaseError("batch_scan_sessions.upsert", batchId, upErr)

      if (upErr.message?.includes("does not exist") || upErr.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Tabla batch_scan_sessions no existe en la base de datos. Aplique la migración 20260421120000_batch_scan_sessions.sql en Supabase.",
          },
          { status: 503 },
        )
      }

      if (upErr.code === "42703" || upErr.message?.toLowerCase().includes("column")) {
        return NextResponse.json(
          {
            error: `Columna o esquema incompatible: ${upErr.message}${upErr.hint ? ` — ${upErr.hint}` : ""}`,
          },
          { status: 500 },
        )
      }

      if (upErr.code === "42501" || upErr.message?.toLowerCase().includes("permission denied")) {
        return NextResponse.json(
          {
            error: `Permiso denegado en Supabase: ${upErr.message}. Compruebe que SUPABASE_SERVICE_ROLE_KEY sea la clave «service_role» del proyecto.`,
          },
          { status: 503 },
        )
      }

      const parts = [upErr.message, upErr.details, upErr.hint].filter(Boolean).join(" — ")
      return NextResponse.json({ error: parts || "Error desconocido al guardar el lote en Supabase." }, { status: 500 })
    }

    console.log("[batch-session] Lote registrado con éxito:", batchId)

    return NextResponse.json({ ok: true, expires_at: expiresAt.toISOString() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[batch-session] Error no manejado:", msg, e)
    return NextResponse.json({ error: `Error interno del servidor: ${msg}` }, { status: 500 })
  }
}
