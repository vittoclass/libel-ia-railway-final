import { NextRequest, NextResponse } from "next/server"
import {
  BATCH_RELEASE_VALIDATED,
  isBatchValidatedForInstitutionalRollup,
  mapBatchIdsToReleaseStatus,
} from "@/app/lib/evaluation-batch-release"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { previousSemesterKey, semesterKeyFromDate, semesterUtcRange } from "@/app/lib/skill-traceability/semester"
import { refreshSkillRollupSchoolSemester } from "@/app/lib/skill-traceability/rollup-refresh"
import { buildTraceabilityInsight, classifyTrendDelta, type TrendVerdict } from "@/app/lib/skill-traceability/trends"

export const dynamic = "force-dynamic"

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function canAccess(role: string): boolean {
  if (isDashboardInstitutionalRelaxEnabled()) return true
  return role === "DIRECCION" || role === "UTP" || role === "ADMIN_INSTITUCION" || role === "ADMIN"
}

const STALE_MS = 12 * 60 * 1000

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, school_id, organization_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  if (!isMasterEmail(user.email) && !canAccess(role))
    return NextResponse.json({ error: "Prohibido" }, { status: 403 })

  let schoolId = String((profile as { school_id?: string | null } | null)?.school_id ?? "").trim()
  const relax = isDashboardInstitutionalRelaxEnabled()
  if (!schoolId && relax) {
    const { data: anyEval } = await supabase.from("evaluations").select("school_id").not("school_id", "is", null).limit(1).maybeSingle()
    schoolId = String((anyEval as { school_id?: string } | null)?.school_id ?? "")
  }
  if (!schoolId) {
    return NextResponse.json(
      {
        error: "Sin school_id en perfil; complete perfil institucional o use entorno de relajación.",
        meta: { delta_definition: "percentage_points_between_semester_school_means_one_vote_per_batch" },
      },
      { status: 400 },
    )
  }

  const sp = req.nextUrl.searchParams
  const skillId = String(sp.get("skill_id") ?? "").trim()
  const subject = String(sp.get("subject") ?? "Lenguaje").trim() || "Lenguaje"
  const semesterKey = String(sp.get("semester_key") ?? semesterKeyFromDate(new Date())).trim()
  const axisIdFilter = String(sp.get("axis_id") ?? "").trim() || null
  const studentProfileId = String(sp.get("student_profile_id") ?? "").trim() || null
  const focusBatchId = String(sp.get("batch_id") ?? "").trim() || null
  const forceRefresh = sp.get("refresh") === "1"

  if (!skillId) {
    return NextResponse.json({ error: "skill_id es requerido" }, { status: 400 })
  }

  const prevKey = previousSemesterKey(semesterKey)
  const { start, end } = semesterUtcRange(semesterKey)

  const axisMatch = (axisId: string | null) => {
    if (!axisIdFilter) return true
    const a = axisId != null ? String(axisId) : ""
    return a === axisIdFilter
  }

  try {
    const { data: freshRow } = await supabase
      .from("skill_rollup_school_semester")
      .select("computed_at")
      .eq("school_id", schoolId)
      .eq("subject", subject)
      .eq("semester_key", semesterKey)
      .eq("skill_id", skillId)
      .maybeSingle()

    const computedAt = freshRow ? new Date(String((freshRow as { computed_at: string }).computed_at)).getTime() : 0
    const stale = !computedAt || Date.now() - computedAt > STALE_MS
    if (forceRefresh || stale) {
      await refreshSkillRollupSchoolSemester(supabase, schoolId, subject, semesterKey)
    }

    const { data: prevRows } = await supabase
      .from("skill_rollup_school_semester")
      .select("computed_at")
      .eq("school_id", schoolId)
      .eq("subject", subject)
      .eq("semester_key", prevKey)
      .eq("skill_id", skillId)
      .limit(1)

    if (!(prevRows ?? []).length || forceRefresh) {
      await refreshSkillRollupSchoolSemester(supabase, schoolId, subject, prevKey)
    }

    const { data: curSchool } = await supabase
      .from("skill_rollup_school_semester")
      .select("accuracy_avg_pct, batch_count, student_count, axis_id")
      .eq("school_id", schoolId)
      .eq("subject", subject)
      .eq("semester_key", semesterKey)
      .eq("skill_id", skillId)

    const curRow = (curSchool ?? []).find((r) => axisMatch((r as { axis_id?: string | null }).axis_id ?? null))
    const { data: prevSchool } = await supabase
      .from("skill_rollup_school_semester")
      .select("accuracy_avg_pct, batch_count, student_count, axis_id")
      .eq("school_id", schoolId)
      .eq("subject", subject)
      .eq("semester_key", prevKey)
      .eq("skill_id", skillId)

    const prevRow = (prevSchool ?? []).find((r) => axisMatch((r as { axis_id?: string | null }).axis_id ?? null))

    const currentPct = curRow != null ? Number((curRow as { accuracy_avg_pct: number }).accuracy_avg_pct) : null
    const previousPct = prevRow != null ? Number((prevRow as { accuracy_avg_pct: number }).accuracy_avg_pct) : null
    const deltaPp =
      currentPct != null && previousPct != null ? Math.round((currentPct - previousPct) * 1000) / 1000 : null

    const verdict: TrendVerdict = deltaPp != null ? classifyTrendDelta(deltaPp) : "estable"

    const { data: skillMeta } = await supabase.from("pedagogy_skills").select("id, name, axis_id").eq("id", skillId).maybeSingle()
    const axisIdMeta = (skillMeta as { axis_id?: string | null } | null)?.axis_id ?? null
    const { data: axisMeta } = axisIdMeta
      ? await supabase.from("pedagogy_axes").select("name").eq("id", axisIdMeta).maybeSingle()
      : { data: null }

    const skillLabel = String((skillMeta as { name?: string } | null)?.name ?? "Habilidad")
    const axisLabel = String((axisMeta as { name?: string } | null)?.name ?? "")

    const insight = buildTraceabilityInsight({
      axisLabel,
      skillLabel,
      subject,
      levelLabel: "Colegio",
      currentPct,
      previousPct,
      deltaPp,
      verdict,
      semesterCurrent: semesterKey,
      semesterPrevious: prevKey,
    })

    const { data: evBatches } = await supabase
      .from("evaluations")
      .select("batch_id, course_label, evaluated_at")
      .eq("school_id", schoolId)
      .eq("subject", subject)
      .not("batch_id", "is", null)
      .gte("evaluated_at", start)
      .lte("evaluated_at", end)
      .limit(500)

    const batchMeta = new Map<string, { course_label: string | null; evaluated_at: string | null }>()
    for (const e of evBatches ?? []) {
      const row = e as { batch_id?: string; course_label?: string | null; evaluated_at?: string | null }
      const bid = String(row.batch_id ?? "")
      if (!bid) continue
      const prev = batchMeta.get(bid)
      const t = row.evaluated_at ?? null
      if (!prev || (t && (!prev.evaluated_at || t > prev.evaluated_at))) {
        batchMeta.set(bid, { course_label: row.course_label ?? null, evaluated_at: t })
      }
    }

    const batchIdsAll = [...batchMeta.keys()]
    const releaseByBatch = await mapBatchIdsToReleaseStatus(supabase, batchIdsAll)
    const batchIds = batchIdsAll.filter((bid) => releaseByBatch.get(bid) === BATCH_RELEASE_VALIDATED)
    let drill_batches: Array<{
      batch_id: string
      course_label: string | null
      evaluated_at: string | null
      accuracy_avg_pct: number | null
      student_count: number | null
      focused: boolean
    }> = []

    if (batchIds.length > 0) {
      let q = supabase
        .from("skill_rollup_by_batch")
        .select("batch_id, accuracy_avg_pct, student_count, axis_id")
        .eq("school_id", schoolId)
        .eq("subject", subject)
        .eq("skill_id", skillId)
        .in("batch_id", batchIds.slice(0, 100))

      const { data: batchRoll } = await q
      const byBatch = new Map<string, { accuracy_avg_pct: number; student_count: number; axis_id: string | null }>()
      for (const r of batchRoll ?? []) {
        const row = r as {
          batch_id: string
          accuracy_avg_pct: number
          student_count: number
          axis_id?: string | null
        }
        if (!axisMatch(row.axis_id ?? null)) continue
        byBatch.set(row.batch_id, {
          accuracy_avg_pct: row.accuracy_avg_pct,
          student_count: row.student_count,
          axis_id: row.axis_id ?? null,
        })
      }

      drill_batches = batchIds.map((bid) => {
        const roll = byBatch.get(bid)
        const meta = batchMeta.get(bid)
        return {
          batch_id: bid,
          course_label: meta?.course_label ?? null,
          evaluated_at: meta?.evaluated_at ?? null,
          accuracy_avg_pct: roll != null ? roll.accuracy_avg_pct : null,
          student_count: roll != null ? roll.student_count : null,
          focused: focusBatchId === bid,
        }
      })
      drill_batches.sort((a, b) => String(b.evaluated_at ?? "").localeCompare(String(a.evaluated_at ?? "")))
    }

    let student_timeline: Array<{
      evaluation_id: string
      evaluated_at: string | null
      accuracy_pct: number | null
      batch_id: string | null
      title: string | null
    }> = []

    if (studentProfileId) {
      const { data: esr } = await supabase
        .from("evaluation_skill_results")
        .select("evaluation_id, accuracy")
        .eq("student_profile_id", studentProfileId)
        .eq("skill_id", skillId)

      const evalIds = [...new Set((esr ?? []).map((r: { evaluation_id: string }) => r.evaluation_id))]
      if (evalIds.length > 0) {
        const { data: evs } = await supabase
          .from("evaluations")
          .select("id, evaluated_at, batch_id, title")
          .in("id", evalIds.slice(0, 100))
          .eq("school_id", schoolId)
          .order("evaluated_at", { ascending: true })

        const evList = (evs ?? []) as Array<{
          id: string
          evaluated_at?: string | null
          batch_id?: string | null
          title?: string | null
        }>
        const timelineBatchIds = [...new Set(evList.map((e) => String(e.batch_id ?? "").trim()).filter(Boolean))]
        const timelineRelease = await mapBatchIdsToReleaseStatus(supabase, timelineBatchIds)

        const accByEval = new Map<string, number | null>()
        for (const r of esr ?? []) {
          const row = r as { evaluation_id: string; accuracy?: number | null }
          const a = row.accuracy
          accByEval.set(row.evaluation_id, a != null ? (Number(a) <= 1 ? Number(a) * 100 : Number(a)) : null)
        }

        student_timeline = evList
          .filter((e) => {
            const b = String(e.batch_id ?? "").trim()
            if (!b) return false
            return timelineRelease.get(b) === BATCH_RELEASE_VALIDATED
          })
          .map((e) => ({
            evaluation_id: e.id,
            evaluated_at: e.evaluated_at ?? null,
            accuracy_pct: accByEval.get(e.id) ?? null,
            batch_id: e.batch_id ?? null,
            title: e.title ?? null,
          }))
      }
    }

    let course_detail: {
      batch_id: string
      accuracy_avg_pct: number | null
      student_count: number | null
      students: Array<{ student_profile_id: string; accuracy_pct: number | null }>
    } | null = null

    if (focusBatchId && (await isBatchValidatedForInstitutionalRollup(supabase, focusBatchId))) {
      const roll = drill_batches.find((d) => d.batch_id === focusBatchId)
      const { data: evIds } = await supabase.from("evaluations").select("id").eq("batch_id", focusBatchId).limit(200)
      const ids = (evIds ?? []).map((x: { id: string }) => x.id)
      const { data: rows2 } = await supabase
        .from("evaluation_skill_results")
        .select("student_profile_id, accuracy")
        .eq("skill_id", skillId)
        .in("evaluation_id", ids)

      const byStudent = new Map<string, number[]>()
      for (const r of rows2 ?? []) {
        const row = r as { student_profile_id?: string; accuracy?: number | null }
        const sp = String(row.student_profile_id ?? "")
        if (!sp) continue
        const a = row.accuracy
        if (a == null) continue
        const pct = Number(a) <= 1 ? Number(a) * 100 : Number(a)
        if (!byStudent.has(sp)) byStudent.set(sp, [])
        byStudent.get(sp)!.push(pct)
      }

      const students = [...byStudent.entries()].map(([student_profile_id, arr]) => ({
        student_profile_id,
        accuracy_pct: Math.round((arr.reduce((x, y) => x + y, 0) / arr.length) * 1000) / 1000,
      }))

      course_detail = {
        batch_id: focusBatchId,
        accuracy_avg_pct: roll?.accuracy_avg_pct ?? null,
        student_count: roll?.student_count ?? students.length,
        students,
      }
    }

    return NextResponse.json({
      meta: {
        skill_id: skillId,
        skill_label: skillLabel,
        axis_label: axisLabel,
        subject,
        semester_key: semesterKey,
        semester_previous: prevKey,
        school_id: schoolId,
        axis_id_filter: axisIdFilter,
        delta_definition:
          "delta_pp = media_colegio_actual − media_colegio_anterior; cada media es promedio simple de accuracy % por lote (batch) con la misma habilidad; umbral ±5 pp sobre delta_pp.",
        institutional_visibility:
          "Solo lotes con evaluation_batch_institutional_release.status = validated (visto bueno UTP) entran en rollups y en esta vista.",
      },
      school: {
        level: "colegio",
        accuracy_avg_pct: currentPct,
        batch_count: curRow != null ? Number((curRow as { batch_count?: number }).batch_count) : 0,
        student_count: curRow != null ? Number((curRow as { student_count?: number }).student_count) : 0,
        verdict,
        trend_label:
          verdict === "incremento_inteligencia"
            ? "Incremento de Inteligencia"
            : verdict === "alerta_retroceso"
              ? "Alerta de Retroceso"
              : "Estable",
      },
      comparison_previous_semester: {
        semester_key: prevKey,
        accuracy_avg_pct: previousPct,
        delta_pp: deltaPp,
      },
      insight,
      drill_batches,
      student_timeline,
      course_detail,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("skill_rollup") || msg.includes("does not exist")) {
      return NextResponse.json(
        {
          error: "Tablas de rollup no aplicadas. Ejecute la migración skill_traceability_rollup en Supabase.",
          hint: msg,
        },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
