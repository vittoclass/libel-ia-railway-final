/**
 * GET: devuelve el provider OMR configurado para que el frontend sepa si usar LEADTOOLS o no.
 * NO toca compare, scoring ni persistencia.
 */

import { NextResponse } from "next/server"
import { getOMRProvider } from "@/app/lib/omr-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const provider = getOMRProvider()
  return NextResponse.json({ provider })
}
