// app/api/auth/logout/route.ts
// Cierra sesión en el servidor (limpia cookies de Supabase Auth).
import { NextResponse } from "next/server"
import { getSupabaseRouteClient } from "@/app/lib/supabase-route"

export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const supabase = await getSupabaseRouteClient()
    await supabase.auth.signOut()
  } catch (e) {
    console.warn("[auth/logout]", e)
  }
  return NextResponse.json({ ok: true })
}
