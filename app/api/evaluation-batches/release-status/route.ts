import { NextRequest, NextResponse } from "next/server"
import { getBatchReleaseStatus } from "@/app/lib/evaluation-batch-release"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * GET ?batch_id= — Estado de liberación del lote (docente dueño del batch).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const batchId = String(req.nextUrl.searchParams.get("batch_id") ?? "").trim()
  if (!batchId) return NextResponse.json({ error: "batch_id requerido" }, { status: 400 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const teacherId = String((profile as { teacher_id?: string | null } | null)?.teacher_id ?? "").trim()
  if (!teacherId) return NextResponse.json({ error: "Perfil sin teacher_id" }, { status: 403 })

  const { data: owners } = await supabase.from("evaluations").select("teacher_id").eq("batch_id", batchId).limit(50)

  const tids = new Set((owners ?? []).map((r: { teacher_id?: string | null }) => String(r.teacher_id ?? "").trim()).filter(Boolean))
  if (tids.size === 0) return NextResponse.json({ error: "Lote vacío o inexistente" }, { status: 404 })
  if (tids.size > 1 || !tids.has(teacherId)) {
    return NextResponse.json({ error: "No eres el dueño de este lote" }, { status: 403 })
  }

  const status = await getBatchReleaseStatus(supabase, batchId)
  const { data: rel } = await supabase
    .from("evaluation_batch_institutional_release")
    .select("utp_observations, submitted_at, reviewed_at")
    .eq("batch_id", batchId)
    .maybeSingle()

  const row = rel as { utp_observations?: string | null; submitted_at?: string | null; reviewed_at?: string | null } | null

  return NextResponse.json({
    batch_id: batchId,
    status,
    utp_observations: row?.utp_observations ?? null,
    submitted_at: row?.submitted_at ?? null,
    reviewed_at: row?.reviewed_at ?? null,
  })
}
