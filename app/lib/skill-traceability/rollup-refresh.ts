/**
 * Refresco de tablas skill_rollup_* (read-model). Aislado de OMR y persist-evaluation.
 * Solo lotes con release institucional `validated` generan filas visibles para Dirección.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { isBatchValidatedForInstitutionalRollup } from "@/app/lib/evaluation-batch-release"
import { semesterUtcRange } from "@/app/lib/skill-traceability/semester"

export async function refreshSkillRollupForBatch(supabase: SupabaseClient, batchId: string): Promise<void> {
  const validated = await isBatchValidatedForInstitutionalRollup(supabase, batchId)
  if (!validated) {
    await supabase.from("skill_rollup_by_batch").delete().eq("batch_id", batchId)
    return
  }

  const { data: evs, error: e1 } = await supabase
    .from("evaluations")
    .select("id, school_id, subject")
    .eq("batch_id", batchId)
    .limit(500)

  if (e1 || !evs?.length) {
    await supabase.from("skill_rollup_by_batch").delete().eq("batch_id", batchId)
    return
  }

  const schoolId = String((evs[0] as { school_id?: string | null }).school_id ?? "")
  const subject = String((evs[0] as { subject?: string | null }).subject ?? "")
  if (!schoolId) {
    await supabase.from("skill_rollup_by_batch").delete().eq("batch_id", batchId)
    return
  }

  const evalIds = (evs as { id: string }[]).map((e) => e.id)
  const chunk = 200
  const allRows: Array<{
    student_profile_id?: string | null
    skill_id?: string | null
    axis_id?: string | null
    accuracy?: number | null
  }> = []

  for (let i = 0; i < evalIds.length; i += chunk) {
    const slice = evalIds.slice(i, i + chunk)
    const { data: rows } = await supabase
      .from("evaluation_skill_results")
      .select("student_profile_id, skill_id, axis_id, accuracy")
      .in("evaluation_id", slice)
    for (const r of rows ?? []) allRows.push(r as (typeof allRows)[0])
  }

  const groups = new Map<string, { acc: number[]; students: Set<string> }>()
  for (const r of allRows) {
    const skillId = String(r.skill_id ?? "").trim()
    if (!skillId) continue
    const axisId = r.axis_id != null ? String(r.axis_id).trim() : ""
    const acc = r.accuracy
    if (acc == null) continue
    const key = `${skillId}\t${axisId}`
    if (!groups.has(key)) groups.set(key, { acc: [], students: new Set() })
    const g = groups.get(key)!
    g.acc.push(Number(acc))
    const sp = String(r.student_profile_id ?? "").trim()
    if (sp) g.students.add(sp)
  }

  await supabase.from("skill_rollup_by_batch").delete().eq("batch_id", batchId)

  const inserts: Record<string, unknown>[] = []
  for (const [key, g] of groups) {
    const [skill_id, axisRaw] = key.split("\t")
    if (g.acc.length === 0) continue
    const avgRatio = g.acc.reduce((a, b) => a + b, 0) / g.acc.length
    const accuracy_avg_pct = avgRatio <= 1 ? avgRatio * 100 : avgRatio
    inserts.push({
      school_id: schoolId,
      batch_id: batchId,
      subject,
      skill_id,
      axis_id: axisRaw === "" ? null : axisRaw,
      accuracy_avg_pct: Math.round(accuracy_avg_pct * 1000) / 1000,
      student_count: g.students.size || g.acc.length,
      evaluation_count: evalIds.length,
    })
  }

  if (inserts.length > 0) {
    const { error: insErr } = await supabase.from("skill_rollup_by_batch").insert(inserts)
    if (insErr && process.env.NODE_ENV === "development") console.warn("[skill-rollup] batch insert", insErr.message)
  }
}

export async function refreshSkillRollupSchoolSemester(
  supabase: SupabaseClient,
  schoolId: string,
  subject: string,
  semesterKey: string,
): Promise<void> {
  const { start, end } = semesterUtcRange(semesterKey)

  const { data: evs } = await supabase
    .from("evaluations")
    .select("batch_id")
    .eq("school_id", schoolId)
    .eq("subject", subject)
    .not("batch_id", "is", null)
    .gte("evaluated_at", start)
    .lte("evaluated_at", end)
    .limit(2000)

  const batchSet = new Set<string>()
  for (const e of evs ?? []) {
    const b = String((e as { batch_id?: string | null }).batch_id ?? "").trim()
    if (b) batchSet.add(b)
  }

  const bids = [...batchSet]
  for (const bid of bids) {
    await refreshSkillRollupForBatch(supabase, bid)
  }

  await supabase
    .from("skill_rollup_school_semester")
    .delete()
    .eq("school_id", schoolId)
    .eq("subject", subject)
    .eq("semester_key", semesterKey)

  if (bids.length === 0) return

  const { data: roll } = await supabase
    .from("skill_rollup_by_batch")
    .select("skill_id, axis_id, accuracy_avg_pct, student_count, batch_id")
    .eq("school_id", schoolId)
    .eq("subject", subject)
    .in("batch_id", bids)

  const bySkill = new Map<
    string,
    { batchAcc: number[]; batches: Set<string>; students: number }
  >()

  for (const r of roll ?? []) {
    const row = r as {
      skill_id: string
      axis_id?: string | null
      accuracy_avg_pct?: number | null
      student_count?: number | null
      batch_id?: string | null
    }
    const sk = String(row.skill_id ?? "")
    if (!sk) continue
    const ax = row.axis_id != null ? String(row.axis_id) : ""
    const key = `${sk}\t${ax}`
    if (!bySkill.has(key)) bySkill.set(key, { batchAcc: [], batches: new Set(), students: 0 })
    const g = bySkill.get(key)!
    const pct = Number(row.accuracy_avg_pct)
    if (Number.isFinite(pct)) g.batchAcc.push(pct)
    const bid = String(row.batch_id ?? "")
    if (bid) g.batches.add(bid)
    g.students += Number(row.student_count) || 0
  }

  const schoolInserts: Record<string, unknown>[] = []
  for (const [key, g] of bySkill) {
    if (g.batchAcc.length === 0) continue
    const [skill_id, axisRaw] = key.split("\t")
    const accuracy_avg_pct = g.batchAcc.reduce((a, b) => a + b, 0) / g.batchAcc.length
    schoolInserts.push({
      school_id: schoolId,
      subject,
      semester_key: semesterKey,
      skill_id,
      axis_id: axisRaw === "" ? null : axisRaw,
      accuracy_avg_pct: Math.round(accuracy_avg_pct * 1000) / 1000,
      batch_count: g.batches.size,
      student_count: g.students,
    })
  }

  if (schoolInserts.length > 0) {
    await supabase.from("skill_rollup_school_semester").insert(schoolInserts)
  }
}
