import { NextRequest, NextResponse } from "next/server"
import QRCode from "qrcode"
import { getAuthUser } from "@/app/lib/supabase-route"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function allowedOrigin(candidate: string, reqOrigin: string): boolean {
  const env = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")
  const candidates = [reqOrigin.replace(/\/$/, ""), env].filter(Boolean)
  try {
    const u = new URL(candidate)
    return candidates.some((c) => {
      try {
        return new URL(c).origin === u.origin
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

/**
 * GET ?u= — PNG QR del enlace móvil (solo URLs de esta app, path /docente/movil-scan + batch_id UUID).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const raw = String(req.nextUrl.searchParams.get("u") ?? "").trim()
  if (!raw) return NextResponse.json({ error: "Parámetro u requerido" }, { status: 400 })

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 })
  }

  const reqOrigin = req.nextUrl.origin
  if (!allowedOrigin(url.origin, reqOrigin)) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 400 })
  }

  if (url.pathname !== "/docente/movil-scan") {
    return NextResponse.json({ error: "Solo se permite /docente/movil-scan" }, { status: 400 })
  }

  const batchId = String(url.searchParams.get("batch_id") ?? "").trim()
  if (!UUID_REGEX.test(batchId)) {
    return NextResponse.json({ error: "batch_id inválido en URL" }, { status: 400 })
  }

  try {
    const png = await QRCode.toBuffer(url.toString(), { type: "png", width: 240, margin: 2, errorCorrectionLevel: "M" })
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
