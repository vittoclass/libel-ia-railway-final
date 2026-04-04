import { NextRequest, NextResponse } from "next/server"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET ?path= — URL firmada corta para una ruta en batch-scans del docente autenticado.
 * Evita enviar data URLs gigantes a /api/evaluate cuando la imagen ya está en Storage.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const path = String(req.nextUrl.searchParams.get("path") ?? "").trim()
  if (!path || path.includes("..") || path.startsWith("/")) {
    return NextResponse.json({ error: "path inválido" }, { status: 400 })
  }

  const server = getSupabaseServer()
  if (!server) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile, error: pErr } = await server
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  const teacherId = (profile as { teacher_id?: string | null } | null)?.teacher_id ?? null
  if (!teacherId) return NextResponse.json({ error: "Perfil sin teacher_id" }, { status: 400 })

  const prefix = `${String(teacherId).trim()}/`
  if (!path.startsWith(prefix)) {
    return NextResponse.json({ error: "La ruta no pertenece a tu espacio de docente" }, { status: 403 })
  }

  const { data: signed, error: sErr } = await server.storage.from(BATCH_SCANS_BUCKET).createSignedUrl(path, 900)
  if (sErr || !signed?.signedUrl) {
    return NextResponse.json({ error: sErr?.message ?? "No se pudo firmar la URL" }, { status: 500 })
  }

  return NextResponse.json({ signed_url: signed.signedUrl })
}
