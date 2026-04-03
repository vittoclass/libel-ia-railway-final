import { NextRequest, NextResponse } from "next/server"
import QRCode from "qrcode"
import { getAuthUser } from "@/app/lib/supabase-route"

export const dynamic = "force-dynamic"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Orígenes que el navegador puede usar (p. ej. Railway detrás de proxy: req.nextUrl.origin ≠ URL pública). */
function collectAllowedOrigins(req: NextRequest): Set<string> {
  const origins = new Set<string>()
  const add = (base: string) => {
    const s = base.replace(/\/$/, "")
    if (!s) return
    try {
      origins.add(new URL(s).origin)
    } catch {
      /* noop */
    }
  }

  add(req.nextUrl.origin)

  const xfHost = req.headers.get("x-forwarded-host")
  const xfProtoRaw = req.headers.get("x-forwarded-proto") ?? "https"
  const xfProto = xfProtoRaw.split(",")[0]?.trim() || "https"
  if (xfHost) {
    const host = xfHost.split(",")[0]?.trim()
    if (host) {
      add(`${xfProto}://${host}`)
      if (xfProto !== "http") add(`http://${host}`)
    }
  }

  const hostHeader = req.headers.get("host")
  if (hostHeader && !xfHost) {
    add(`https://${hostHeader}`)
    add(`http://${hostHeader}`)
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")
  if (site) add(site)

  const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN ?? "").trim()
  if (railwayDomain) {
    add(`https://${railwayDomain}`)
    add(`http://${railwayDomain}`)
  }

  const vercel = (process.env.VERCEL_URL ?? "").trim()
  if (vercel) add(`https://${vercel}`)

  return origins
}

function batchIdFromMobileUrl(url: URL): string | null {
  if (url.pathname === "/docente/movil-scan") {
    const id = String(url.searchParams.get("batch_id") ?? "").trim()
    return UUID_REGEX.test(id) ? id : null
  }
  const mEscaneo = /^\/escaneo\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(
    url.pathname,
  )
  if (mEscaneo) return mEscaneo[1]
  return null
}

/**
 * GET ?u= — PNG QR del enlace móvil (/escaneo/[uuid] o legado movil-scan?batch_id=).
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

  const allowed = collectAllowedOrigins(req)
  if (!allowed.has(url.origin)) {
    console.warn("[station-qr] Origen rechazado", {
      urlOrigin: url.origin,
      allowed: [...allowed],
    })
    return NextResponse.json({ error: "Origen no permitido" }, { status: 400 })
  }

  const batchId = batchIdFromMobileUrl(url)
  if (!batchId) {
    return NextResponse.json({ error: "URL móvil no permitida o batch_id inválido" }, { status: 400 })
  }

  try {
    const png = await QRCode.toBuffer(url.toString(), {
      type: "png",
      width: 256,
      margin: 2,
      errorCorrectionLevel: "M",
    })
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
