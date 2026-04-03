import { NextResponse } from "next/server"
import { BATCH_RELEASE_PENDING_UTP } from "@/app/lib/evaluation-batch-release"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function canAccess(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "UTP" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

export type PendingBatchReleaseRow = {
  batch_id: string
  school_id: string
  status: string
  submitted_at: string | null
  utp_observations: string | null
  evaluation_count: number
  title: string | null
  course_label: string | null
  subject: string | null
  teacher_id: string | null
}

/**
 * GET — Lotes pendientes de validación UTP (bandeja de entrada calidad).
 */
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  if (!canAccess(role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 })

  const schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
  let q = supabase
    .from("evaluation_batch_institutional_release")
    .select("batch_id, school_id, status, submitted_at, utp_observations")
    .eq("status", BATCH_RELEASE_PENDING_UTP)
    .order("submitted_at", { ascending: true, nullsFirst: false })

  if (schoolId) q = q.eq("school_id", schoolId)

  const { data: pending, error } = await q.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: PendingBatchReleaseRow[] = []
  for (const p of pending ?? []) {
    const pr = p as {
      batch_id: string
      school_id: string
      status: string
      submitted_at: string | null
      utp_observations: string | null
    }
    const bid = String(pr.batch_id ?? "")
    if (!bid) continue

    const { data: evs } = await supabase
      .from("evaluations")
      .select("id, title, course_label, subject, teacher_id")
      .eq("batch_id", bid)
      .order("evaluated_at", { ascending: false, nullsFirst: false })
      .limit(80)

    const list = (evs ?? []) as Array<{
      id: string
      title?: string | null
      course_label?: string | null
      subject?: string | null
      teacher_id?: string | null
    }>
    const first = list[0]
    rows.push({
      batch_id: bid,
      school_id: String(pr.school_id ?? ""),
      status: pr.status,
      submitted_at: pr.submitted_at ?? null,
      utp_observations: pr.utp_observations ?? null,
      evaluation_count: list.length,
      title: first?.title ?? null,
      course_label: first?.course_label ?? null,
      subject: first?.subject ?? null,
      teacher_id: first?.teacher_id ?? null,
    })
  }

  return NextResponse.json({ pending: rows })
}
