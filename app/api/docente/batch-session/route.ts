import { NextRequest, NextResponse } from "next/server"
import { getAuthUser, getSupabaseRouteClient } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const TTL_HOURS = 72

/**
 * POST /api/docente/batch-session — Registra el lote actual desde la estación PC (autenticado).
 * Habilita la URL pública /escaneo/[batchId] hasta expires_at.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  let body: { batch_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const batchId = String(body?.batch_id ?? "").trim()
  if (!UUID_REGEX.test(batchId)) {
    return NextResponse.json({ error: "batch_id inválido" }, { status: 400 })
  }

  const routeClient = await getSupabaseRouteClient()
  const { data: profile, error: pErr } = await routeClient
    .from("profiles")
    .select("teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 })
  }

  const teacherId = String((profile as { teacher_id?: string | null } | null)?.teacher_id ?? "").trim()
  const schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
  if (!teacherId || !schoolId) {
    return NextResponse.json(
      { error: "Complete su perfil (teacher_id y school_id) en la estación PC antes de usar el QR móvil." },
      { status: 400 },
    )
  }

  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + TTL_HOURS)

  /** Service role evita fallos silenciosos por RLS en upsert; ya validamos usuario y perfil arriba. */
  const server = getSupabaseServer()
  if (!server) {
    return NextResponse.json({ error: "Servidor sin service role (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 })
  }

  const { error: upErr } = await server.from("batch_scan_sessions").upsert(
    {
      batch_id: batchId,
      teacher_id: teacherId,
      school_id: schoolId,
      created_by: user.id,
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: "batch_id" },
  )

  if (upErr) {
    console.error("[batch-session] Error upsert batch_scan_sessions", batchId, upErr.message)
    if (upErr.message.includes("does not exist") || upErr.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Tabla batch_scan_sessions no existe. Ejecute la migración 20260421120000_batch_scan_sessions.sql en Supabase.",
        },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  console.log("[batch-session] Lote registrado con éxito:", batchId)

  return NextResponse.json({ ok: true, expires_at: expiresAt.toISOString() })
}
