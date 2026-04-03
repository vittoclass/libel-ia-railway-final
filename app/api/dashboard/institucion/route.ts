import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

// PHASE_5_INSTITUTIONAL_V1
export async function GET(_req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .maybeSingle()

    const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null
    if (!orgId) {
      return NextResponse.json({
        organization: {
          id: null,
          name: "Colegio Oscar Salinas",
          logo_url: null,
          primary_color: null,
        },
      })
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, logo_url, primary_color")
      .eq("id", orgId)
      .maybeSingle()

    return NextResponse.json({
      organization: {
        id: org?.id ?? orgId,
        name: org?.name ?? "Colegio Oscar Salinas",
        logo_url: org?.logo_url ?? null,
        primary_color: org?.primary_color ?? null,
      },
    })
  } catch {
    return NextResponse.json({
      organization: {
        id: null,
        name: "Colegio Oscar Salinas",
        logo_url: null,
        primary_color: null,
      },
    })
  }
}
