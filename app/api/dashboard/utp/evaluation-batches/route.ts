import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled as isDashboardRelax } from "@/app/lib/dev-dashboard-relax"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

type EvaluationBatchMember = {
  id: string
  student_name: string | null
  evaluated_at: string | null
}

type EvaluationBatchGroup = {
  batch_id: string
  title: string
  course_label: string
  evaluated_at: string | null
  student_count: number
  evaluation_ids: string[]
  members: EvaluationBatchMember[]
  suggest_annex_to_batch_id: string | null
}

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function isAllowedRole(role: string): boolean {
  if (isDashboardRelax()) return true
  return role === "UTP" || role === "DIRECCION" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

function normKey(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

/**
 * GET — Agrupa evaluaciones por batch_id para Panel UTP (read-only agregación).
 */
export async function GET(_req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ groups: [], orphans: [] }, { status: 200 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ groups: [], orphans: [] }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id, school_id, teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  if (!isAllowedRole(role)) return NextResponse.json({ groups: [], orphans: [] }, { status: 200 })

  const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null
  const schoolId = (profile as { school_id?: string | null } | null)?.school_id ?? null
  const relax = isDashboardRelax()

  let query = supabase
    .from("evaluations")
    .select("id, title, course_label, evaluated_at, batch_id")
    .order("evaluated_at", { ascending: false, nullsFirst: false })
    .limit(400)

  if (schoolId) {
    query = query.eq("school_id", schoolId)
  } else if (orgId) {
    const { data: peers } = await supabase
      .from("profiles")
      .select("teacher_id")
      .eq("organization_id", orgId)
      .not("teacher_id", "is", null)
    const tids = [...new Set((peers ?? []).map((p: { teacher_id?: string | null }) => p.teacher_id).filter(Boolean))] as string[]
    if (tids.length === 0 && !relax) return NextResponse.json({ groups: [], orphans: [] })
    if (tids.length > 0) query = query.in("teacher_id", tids)
  } else if (!relax) {
    return NextResponse.json({ groups: [], orphans: [] })
  }

  const { data: evs, error } = await query
  if (error) {
    return NextResponse.json({ groups: [], orphans: [], warning: error.message }, { status: 200 })
  }

  const evalRows = (evs ?? []) as Array<{
    id: string
    title: string | null
    course_label: string | null
    evaluated_at: string | null
    batch_id: string | null
  }>

  const ids = evalRows.map((e) => e.id)
  const nameByEval = new Map<string, string | null>()
  if (ids.length > 0) {
    const { data: sums } = await supabase.from("evaluation_summaries").select("evaluation_id, student_name_raw").in("evaluation_id", ids)
    for (const s of sums ?? []) {
      const row = s as { evaluation_id: string; student_name_raw?: string | null }
      if (!nameByEval.has(row.evaluation_id)) {
        nameByEval.set(row.evaluation_id, row.student_name_raw != null ? String(row.student_name_raw) : null)
      }
    }
  }

  const batchMap = new Map<string, typeof evalRows>()
  const orphanRows: typeof evalRows = []

  for (const e of evalRows) {
    if (e.batch_id && String(e.batch_id).trim()) {
      const k = String(e.batch_id).trim()
      const arr = batchMap.get(k) ?? []
      arr.push(e)
      batchMap.set(k, arr)
    } else {
      orphanRows.push(e)
    }
  }

  const titleCourseToBatchId = new Map<string, string>()
  for (const [bid, rows] of batchMap) {
    const t0 = rows[0]
    if (!t0) continue
    titleCourseToBatchId.set(`${normKey(t0.title ?? "")}||${normKey(t0.course_label ?? "")}`, bid)
  }

  const groups: EvaluationBatchGroup[] = []

  for (const [batch_id, rows] of batchMap) {
    const sorted = [...rows].sort((a, b) => String(b.evaluated_at ?? "").localeCompare(String(a.evaluated_at ?? "")))
    const title = String(sorted[0]?.title ?? "Sin título")
    const course_label = String(sorted[0]?.course_label ?? "Sin curso")
    const evaluated_at = sorted[0]?.evaluated_at ?? null
    const members: EvaluationBatchMember[] = sorted.map((r) => ({
      id: r.id,
      student_name: nameByEval.get(r.id) ?? null,
      evaluated_at: r.evaluated_at,
    }))
    groups.push({
      batch_id,
      title,
      course_label,
      evaluated_at,
      student_count: members.length,
      evaluation_ids: sorted.map((r) => r.id),
      members,
      suggest_annex_to_batch_id: null,
    })
  }

  groups.sort((a, b) => String(b.evaluated_at ?? "").localeCompare(String(a.evaluated_at ?? "")))

  const orphans: Array<EvaluationBatchMember & { title: string; course_label: string; suggest_annex_to_batch_id: string | null }> =
    []

  for (const r of orphanRows) {
    const k = `${normKey(r.title ?? "")}||${normKey(r.course_label ?? "")}`
    const suggest = titleCourseToBatchId.get(k) ?? null
    orphans.push({
      id: r.id,
      student_name: nameByEval.get(r.id) ?? null,
      evaluated_at: r.evaluated_at,
      title: String(r.title ?? "Sin título"),
      course_label: String(r.course_label ?? "Sin curso"),
      suggest_annex_to_batch_id: suggest,
    })
  }

  return NextResponse.json({ groups, orphans })
}
