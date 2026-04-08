import { NextRequest, NextResponse } from "next/server"
import {
  type FlatAssessmentType,
  isPaesFamilyFlat,
  isSimceFamilyFlat,
  mergeFlatAssessmentType,
  parseAssessmentTypeToFlat,
} from "@/app/lib/assessment-category"
import { getAuthUser } from "@/app/lib/supabase-route"
import { isDashboardInstitutionalRelaxEnabled } from "@/app/lib/dev-dashboard-relax"
import { isMasterEmail } from "@/app/lib/master-access"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { approxGradeChileFromLogroPct, resolveStudentDisplayName } from "@/app/lib/student-display-name"
import { projectPaesFromLogroPct, projectSimceFromLogroPct } from "@/app/lib/standard-scale-converters"

export const dynamic = "force-dynamic"
export const revalidate = 0

function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase()
}

function classifyAgenciaNota(g: number): "insuficiente" | "elemental" | "adecuado" | null {
  if (!Number.isFinite(g)) return null
  if (g < 4.0) return "insuficiente"
  if (g < 5.5) return "elemental"
  return "adecuado"
}

function jsonNoStore(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, {
    status: init?.status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  })
}

function normText(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

type NationalExamIntent = "SIMCE" | "PAES" | "UNKNOWN"

function detectIntentFromBatchTitles(titles: Array<string | null | undefined>): NationalExamIntent {
  const text = titles.map((t) => normText(t)).join(" | ")
  if (!text) return "UNKNOWN"
  const paesTokens = ["paes", " m1", " m2", "pdt", "demre"]
  const simceTokens = ["simce", "agencia"]
  const hasPaes = paesTokens.some((k) => text.includes(k))
  const hasSimce = simceTokens.some((k) => text.includes(k))
  if (hasPaes && !hasSimce) return "PAES"
  if (hasSimce && !hasPaes) return "SIMCE"
  return "UNKNOWN"
}

// PHASE_5_INSTITUTIONAL_V1 — Fuente: evaluation_summaries + evaluation_items (OMR). Sin student_projections.
export async function GET(_req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return jsonNoStore({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return jsonNoStore({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, teacher_id, organization_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = normalizeRole((profile as { role?: string | null } | null)?.role)
  const relax = isDashboardInstitutionalRelaxEnabled()
  const allowedProd =
    role === "DIRECCION" ||
    role === "ADMIN_INSTITUCION" ||
    role === "ADMIN" ||
    role === "UTP"
  if (!relax && !isMasterEmail(user.email) && !allowedProd) {
    return jsonNoStore({ error: "Prohibido" }, { status: 403 })
  }

  const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null
  const schoolId = (profile as { school_id?: string | null } | null)?.school_id ?? null
  const profileTeacherId = (profile as { teacher_id?: string | null } | null)?.teacher_id ?? null

  const emptyPayload = {
    kpis: {
      promedio_logro_institucional: 0,
      total_evaluaciones_mes: 0,
      simce_proyectado_promedio: 0,
      paes_proyectado_promedio: 0,
    },
    semaforo: { insuficiente: 0, elemental: 0, adecuado: 0, total: 0 },
    risk_distribution: { critico: 0, alto: 0, medio: 0, bajo: 0 },
    aggregates: {
      evaluations_in_scope: 0,
      summaries_count: 0,
      items_rows: 0,
      avg_grade_chile: null as number | null,
      avg_logro_pct: null as number | null,
    },
    samples: [] as unknown[],
    recent_evaluations_preview: [] as unknown[],
    critical_students: [] as unknown[],
    global_alert: null as string | null,
    source_mode: "no_scope",
    warning: null as string | null,
    linked_evaluations_count: 0,
    last_batch_id: null as string | null,
  }

  try {
    let linkedEvalIds: string[] = []
    const evalTypeMap = new Map<string, FlatAssessmentType>()
    if (orgId) {
      const { data: uploads } = await supabase
        .from("utp_instrument_uploads")
        .select("id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(300)
      const uploadIds = (uploads ?? []).map((u: { id: string }) => String(u.id))
      if (uploadIds.length > 0) {
        const { data: reports } = await supabase
          .from("utp_audit_reports")
          .select("id, upload_id, content")
          .in("upload_id", uploadIds)
        const allIds = new Set<string>()
        for (const r of reports ?? []) {
          const raw = (r as { content?: unknown }).content
          let content: Record<string, unknown> = {}
          if (raw && typeof raw === "object" && !Array.isArray(raw)) content = raw as Record<string, unknown>
          else if (typeof raw === "string") {
            try {
              const p = JSON.parse(raw)
              if (p && typeof p === "object" && !Array.isArray(p)) content = p as Record<string, unknown>
            } catch {
              /* ignore */
            }
          }
          const link = content.student_outcomes_link
          if (link && typeof link === "object" && !Array.isArray(link)) {
            const lk = link as { evaluation_ids?: unknown; assessment_type?: unknown }
            const ids = lk.evaluation_ids
            const flat = parseAssessmentTypeToFlat(String(lk.assessment_type ?? "")) ?? "MENSUAL"
            if (Array.isArray(ids)) {
              ids.forEach((id) => {
                const eid = String(id)
                allIds.add(eid)
                evalTypeMap.set(eid, mergeFlatAssessmentType(evalTypeMap.get(eid), flat))
              })
            }
          }
        }
        linkedEvalIds = [...allIds].filter(Boolean)
      }
    }

    let scopeEvalIds: string[] = []
    let source_mode: string = "utp_linked_outcomes"
    let warning: string | null = null

    if (linkedEvalIds.length > 0) {
      scopeEvalIds = linkedEvalIds.slice(0, 1000)
    } else {
      source_mode = "recent_evaluations_omr"
      const picked: string[] = []

      if (schoolId) {
        // Sin vínculo UTP validado: priorizar universo SIMCE del colegio por filas individuales.
        const { data: evs } = await supabase
          .from("evaluations")
          .select("id, assessment_category, exam_type")
          .eq("is_archived", false)
          .eq("school_id", schoolId)
          .order("evaluated_at", { ascending: false })
          .limit(1000)
        const simceRows = (evs ?? []).filter((e) => {
          const row = e as { assessment_category?: string | null; exam_type?: string | null }
          const fromCategory = parseAssessmentTypeToFlat(String(row.assessment_category ?? ""))
          const fromExamType = parseAssessmentTypeToFlat(String(row.exam_type ?? ""))
          return fromCategory === "ENSAYO_SIMCE" || fromExamType === "ENSAYO_SIMCE"
        })
        for (const e of simceRows) picked.push(String((e as { id: string }).id))
        if (simceRows.length > 0) source_mode = "school_simce_no_link"
      } else if (profileTeacherId) {
        const { data: evs } = await supabase
          .from("evaluations")
          .select("id")
          .eq("is_archived", false)
          .eq("teacher_id", profileTeacherId)
          .order("evaluated_at", { ascending: false })
          .limit(3)
        for (const e of evs ?? []) picked.push(String((e as { id: string }).id))
      } else if (orgId) {
        const { data: peers } = await supabase
          .from("profiles")
          .select("teacher_id")
          .eq("organization_id", orgId)
          .not("teacher_id", "is", null)
        const tids = [...new Set((peers ?? []).map((p: { teacher_id?: string | null }) => p.teacher_id).filter(Boolean))] as string[]
        if (tids.length > 0) {
          const { data: evs } = await supabase
            .from("evaluations")
            .select("id")
            .eq("is_archived", false)
            .in("teacher_id", tids)
            .order("evaluated_at", { ascending: false })
            .limit(3)
          for (const e of evs ?? []) picked.push(String((e as { id: string }).id))
        }
      }

      scopeEvalIds = [...new Set(picked)].filter(Boolean)
      if (scopeEvalIds.length === 0) {
        warning =
          "No hay evaluaciones vinculadas por UTP ni evaluaciones recientes en alcance (school_id / teacher_id / organización). Vincule pruebas en Panel UTP o complete el perfil institucional."
        return jsonNoStore({ ...emptyPayload, warning })
      }
    }

    /** Último lote (batch_id) en alcance institucional: prioridad para velocímetros SIMCE/PAES. */
    let lastBatchId: string | null = null
    let batchEvalIds: string[] = []
    {
      type ScopeKind = "school" | "org_teachers" | "single_teacher" | "none"
      let scopeKind: ScopeKind = "none"
      let orgTeacherIds: string[] = []
      if (schoolId) scopeKind = "school"
      else if (orgId) {
        const { data: peers } = await supabase
          .from("profiles")
          .select("teacher_id")
          .eq("organization_id", orgId)
          .not("teacher_id", "is", null)
        orgTeacherIds = [
          ...new Set(
            (peers ?? [])
              .map((p: { teacher_id?: string | null }) => p.teacher_id)
              .filter(Boolean) as string[],
          ),
        ]
        scopeKind = orgTeacherIds.length > 0 ? "org_teachers" : "none"
      } else if (profileTeacherId) scopeKind = "single_teacher"

      if (scopeKind !== "none") {
        // Cable F: fuente maestra de lotes = batch_scan_sessions (no depende de release).
        let latestSessionQ = supabase
          .from("batch_scan_sessions")
          .select("batch_id, teacher_id, school_id, created_at")
          .eq("is_archived", false)
        if (scopeKind === "school") latestSessionQ = latestSessionQ.eq("school_id", schoolId as string)
        else if (scopeKind === "org_teachers") latestSessionQ = latestSessionQ.in("teacher_id", orgTeacherIds)
        else latestSessionQ = latestSessionQ.eq("teacher_id", profileTeacherId as string)

        const { data: latestSession } = await latestSessionQ
          .order("created_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()

        const bid = (latestSession as { batch_id?: string | null } | null)?.batch_id
        if (bid) {
          lastBatchId = String(bid)
          // JOIN lógico evaluations x batch_scan_sessions por batch_id
          let batchQ = supabase.from("evaluations").select("id").eq("batch_id", lastBatchId)
          batchQ = batchQ.eq("is_archived", false)
          if (scopeKind === "school") batchQ = batchQ.eq("school_id", schoolId as string)
          else if (scopeKind === "org_teachers") batchQ = batchQ.in("teacher_id", orgTeacherIds)
          else batchQ = batchQ.eq("teacher_id", profileTeacherId as string)
          const { data: batchRows } = await batchQ
          batchEvalIds = (batchRows ?? []).map((r: { id: string }) => String(r.id)).filter(Boolean)
        } else {
          // Fallback defensivo si aún no existe sesión, pero sí evaluaciones con batch_id.
          let latestEvalQ = supabase
            .from("evaluations")
            .select("batch_id, evaluated_at")
            .eq("is_archived", false)
            .not("batch_id", "is", null)
          if (scopeKind === "school") latestEvalQ = latestEvalQ.eq("school_id", schoolId as string)
          else if (scopeKind === "org_teachers") latestEvalQ = latestEvalQ.in("teacher_id", orgTeacherIds)
          else latestEvalQ = latestEvalQ.eq("teacher_id", profileTeacherId as string)
          const { data: latestEval } = await latestEvalQ
            .order("evaluated_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle()
          const fallbackBid = (latestEval as { batch_id?: string | null } | null)?.batch_id
          if (fallbackBid) lastBatchId = String(fallbackBid)
        }
      }
    }

    const mergedScope = [...new Set([...scopeEvalIds, ...batchEvalIds])].filter(Boolean).slice(0, 1000)
    const evalIds = mergedScope

    const [evalsRes, itemsRes, sumsRes] = await Promise.all([
      supabase
        .from("evaluations")
        .select("id, evaluated_at, subject, title, course_label, exam_type, assessment_category")
        .eq("is_archived", false)
        .in("id", evalIds),
      supabase.from("evaluation_items").select("evaluation_id, score_obtained, score_max").in("evaluation_id", evalIds),
      supabase
        .from("evaluation_summaries")
        .select("evaluation_id, grade_chile, student_name_raw, raw")
        .in("evaluation_id", evalIds),
    ])

    const evalRows = (evalsRes.data ?? []) as Array<{
      id: string
      evaluated_at?: string | null
      subject?: string | null
      title?: string | null
      course_label?: string | null
      exam_type?: string | null
      assessment_category?: string | null
    }>
    const visibleEvalIdSet = new Set(evalRows.map((e) => String(e.id)))
    for (const e of evalRows) {
      const flatExam = parseAssessmentTypeToFlat(String(e.exam_type ?? ""))
      const flatCat = parseAssessmentTypeToFlat(String(e.assessment_category ?? ""))
      const flats = [flatExam, flatCat].filter(Boolean) as FlatAssessmentType[]
      for (const flat of flats) {
        evalTypeMap.set(String(e.id), mergeFlatAssessmentType(evalTypeMap.get(String(e.id)), flat))
      }
    }
    const itemRows = ((itemsRes.data ?? []) as Array<{ evaluation_id: string; score_obtained?: number | null; score_max?: number | null }>).filter((r) =>
      visibleEvalIdSet.has(String(r.evaluation_id)),
    )
    const sumRows = ((sumsRes.data ?? []) as Array<{
      evaluation_id: string
      grade_chile?: number | null
      student_name_raw?: string | null
      raw?: unknown
    }>).filter((r) => visibleEvalIdSet.has(String(r.evaluation_id)))

    const sumByEval = new Map<string, { grade_chile?: number | null; student_name_raw?: string | null; raw?: unknown }>()
    for (const s of sumRows) {
      const id = String(s.evaluation_id)
      if (!sumByEval.has(id)) sumByEval.set(id, s)
    }
    const { data: stRows } = await supabase
      .from("evaluation_students")
      .select("evaluation_id, student_name, course_label")
      .in("evaluation_id", evalIds)
    const stByEval = new Map<string, { student_name?: string | null; course_label?: string | null }>()
    for (const row of stRows ?? []) {
      const r = row as { evaluation_id: string; student_name?: string | null; course_label?: string | null }
      if (!stByEval.has(r.evaluation_id)) stByEval.set(r.evaluation_id, r)
    }

    const itemByEval = new Map<string, { obtained: number; max: number }>()
    for (const it of itemRows) {
      const key = String(it.evaluation_id)
      const cur = itemByEval.get(key) ?? { obtained: 0, max: 0 }
      cur.obtained += Number(it.score_obtained) || 0
      cur.max += Number(it.score_max) || 0
      itemByEval.set(key, cur)
    }

    const logroPerEval = evalRows.map((e) => {
      const agg = itemByEval.get(String(e.id)) ?? { obtained: 0, max: 0 }
      const logro = agg.max > 0 ? (agg.obtained / agg.max) * 100 : null
      return {
        evaluation_id: String(e.id),
        logro_pct: logro,
        evaluated_at: e.evaluated_at ?? null,
        subject: e.subject ?? null,
        title: e.title ?? null,
      }
    })

    const validLogro = logroPerEval.map((x) => x.logro_pct).filter((x): x is number => Number.isFinite(Number(x)))
    const avgLogro = validLogro.length ? Math.round((validLogro.reduce((a, b) => a + b, 0) / validLogro.length) * 10) / 10 : 0

    const logroByEvalId = new Map<string, number | null>()
    for (const r of logroPerEval) logroByEvalId.set(r.evaluation_id, r.logro_pct)

    function resolvedGradeForEval(eid: string): number | null {
      const sum = sumByEval.get(String(eid))
      const g = Number(sum?.grade_chile)
      if (Number.isFinite(g)) return g
      return approxGradeChileFromLogroPct(logroByEvalId.get(String(eid)) ?? null)
    }

    const gradesFinite = evalRows.map((e) => resolvedGradeForEval(String(e.id))).filter((g): g is number => Number.isFinite(g))
    const avgGradeChile =
      gradesFinite.length > 0 ? Math.round((gradesFinite.reduce((a, b) => a + b, 0) / gradesFinite.length) * 100) / 100 : null

    let totObt = 0
    let totMax = 0
    for (const it of itemRows) {
      totObt += Number(it.score_obtained) || 0
      totMax += Number(it.score_max) || 0
    }
    const avgLogroFromItems = totMax > 0 ? Math.round((totObt / totMax) * 1000) / 10 : null

    const simceTaggedIds = evalIds.filter((id) => {
      const t = evalTypeMap.get(String(id))
      return t != null && isSimceFamilyFlat(t)
    })
    const idsForSemaforoAgencia =
      simceTaggedIds.length > 0 ? simceTaggedIds : evalIds

    let insuficiente = 0
    let elemental = 0
    let adecuado = 0
    const hasValidatedUtpLink = linkedEvalIds.length > 0
    if (!hasValidatedUtpLink && sumRows.length > 0) {
      // Sin informe UTP validado: desglosa por filas individuales de summary (alumno) en vez de promediar por lote.
      for (const s of sumRows) {
        const g = Number(s.grade_chile)
        if (!Number.isFinite(g)) continue
        const band = classifyAgenciaNota(g)
        if (band === "insuficiente") insuficiente++
        else if (band === "elemental") elemental++
        else if (band === "adecuado") adecuado++
      }
    } else {
      for (const eid of idsForSemaforoAgencia) {
        const g = resolvedGradeForEval(String(eid))
        if (g == null || !Number.isFinite(g)) continue
        const band = classifyAgenciaNota(g)
        if (band === "insuficiente") insuficiente++
        else if (band === "elemental") elemental++
        else if (band === "adecuado") adecuado++
      }
    }

    const batchEvalIdSet = new Set(batchEvalIds)
    const hasBatchFocus = batchEvalIds.length > 0

    const evalIdsVisible = evalRows.map((e) => String(e.id))
    const simceAll = evalIdsVisible.filter((id) => {
      const t = evalTypeMap.get(String(id))
      return t != null && isSimceFamilyFlat(t)
    })
    const paesAll = evalIdsVisible.filter((id) => {
      const t = evalTypeMap.get(String(id))
      return t != null && isPaesFamilyFlat(t)
    })
    const simcePool = hasBatchFocus ? simceAll.filter((id) => batchEvalIdSet.has(id)) : []
    const paesPool = hasBatchFocus ? paesAll.filter((id) => batchEvalIdSet.has(id)) : []

    // Prioridad 1: metadata (exam_type/assessment_type ya normalizado en evalTypeMap).
    // Prioridad 2: string matching en nombre de lote (titles de evaluaciones del batch).
    let batchIntent: NationalExamIntent = "UNKNOWN"
    if (hasBatchFocus) {
      if (simcePool.length > 0 && paesPool.length === 0) batchIntent = "SIMCE"
      else if (paesPool.length > 0 && simcePool.length === 0) batchIntent = "PAES"
      else if (simcePool.length > 0 && paesPool.length > 0) batchIntent = "UNKNOWN"
      else {
        const batchTitles = evalRows.filter((e) => batchEvalIdSet.has(String(e.id))).map((e) => e.title)
        batchIntent = detectIntentFromBatchTitles(batchTitles)
      }
    }

    let simceEffective: string[] = []
    let paesEffective: string[] = []
    if (!hasBatchFocus) {
      // Sin lote reciente: usar histórico institucional etiquetado.
      simceEffective = simceAll
      paesEffective = paesAll
    } else if (batchIntent === "SIMCE") {
      // Limpieza de cuerdas: solo mueve SIMCE para este lote.
      simceEffective = simcePool.length > 0 ? simcePool : batchEvalIds
      paesEffective = []
    } else if (batchIntent === "PAES") {
      // Limpieza de cuerdas: solo mueve PAES para este lote.
      simceEffective = []
      paesEffective = paesPool.length > 0 ? paesPool : batchEvalIds
    } else {
      // Estado neutro: no proyectar nacional por lote ambiguo.
      simceEffective = []
      paesEffective = []
    }

    const simceValues: number[] = []
    const paesValues: number[] = []
    for (const eid of simceEffective) {
      const pct = logroByEvalId.get(String(eid))
      if (pct == null || !Number.isFinite(pct)) continue
      simceValues.push(projectSimceFromLogroPct(pct))
    }
    for (const eid of paesEffective) {
      const pct = logroByEvalId.get(String(eid))
      if (pct == null || !Number.isFinite(pct)) continue
      paesValues.push(projectPaesFromLogroPct(pct))
    }
    const simcePromedio = simceValues.length ? Math.round(simceValues.reduce((a, b) => a + b, 0) / simceValues.length) : 0
    const paesPromedio = paesValues.length ? Math.round(paesValues.reduce((a, b) => a + b, 0) / paesValues.length) : 0

    const totalEvaluacionesMes = new Set(
      logroPerEval
        .filter((r) => {
          const d = r.evaluated_at ? new Date(r.evaluated_at) : null
          const now = new Date()
          return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
        })
        .map((r) => r.evaluation_id),
    ).size

    const critico = sumRows.filter((s) => {
      const g = Number(s.grade_chile)
      return Number.isFinite(g) && g < 3.0
    }).length
    const alto = sumRows.filter((s) => {
      const g = Number(s.grade_chile)
      return Number.isFinite(g) && g >= 3.0 && g < 4.0
    }).length
    const medio = sumRows.filter((s) => {
      const g = Number(s.grade_chile)
      return Number.isFinite(g) && g >= 4.0 && g < 5.0
    }).length
    const bajo = sumRows.filter((s) => {
      const g = Number(s.grade_chile)
      return Number.isFinite(g) && g >= 5.0
    }).length

    const hasCritical27or28 = sumRows.some((s) => {
      const g = Number(s.grade_chile)
      return Number.isFinite(g) && (Math.abs(g - 2.7) < 0.01 || Math.abs(g - 2.8) < 0.01)
    })
    const riskCounts = {
      critico: hasCritical27or28 ? Math.max(1, critico) : critico,
      alto,
      medio,
      bajo,
    }

    const critical_students = sumRows
      .filter((s) => {
        const g = Number(s.grade_chile)
        return Number.isFinite(g) && g < 4.0
      })
      .sort((a, b) => Number(a.grade_chile) - Number(b.grade_chile))
      .slice(0, 40)
      .map((s) => {
        const st = stByEval.get(String(s.evaluation_id))
        const sm = sumByEval.get(String(s.evaluation_id))
        const ev = evalRows.find((e) => String(e.id) === String(s.evaluation_id))
        const grade = Number(s.grade_chile)
        const resolved = resolveStudentDisplayName({
          student_name: st?.student_name,
          student_name_raw: sm?.student_name_raw ?? null,
          raw: sm?.raw,
        })
        const rawLabel = sm?.student_name_raw?.trim() || null
        const student_name =
          resolved.trim() ||
          rawLabel ||
          (st?.student_name?.trim() ? st.student_name : null) ||
          `Evaluación ${String(s.evaluation_id).slice(0, 8)}…`
        return {
          evaluation_id: String(s.evaluation_id),
          student_name,
          student_name_raw: rawLabel,
          course_label: String(st?.course_label ?? ev?.course_label ?? "—"),
          grade_chile: Number.isFinite(grade) ? Math.round(grade * 10) / 10 : 0,
          evaluated_at: ev?.evaluated_at ?? null,
        }
      })

    const sortedPreview = [...logroPerEval].sort((a, b) => {
      const ta = a.evaluated_at ? new Date(a.evaluated_at).getTime() : 0
      const tb = b.evaluated_at ? new Date(b.evaluated_at).getTime() : 0
      return tb - ta
    })
    const recent_evaluations_preview = sortedPreview.slice(0, 3).map((r) => ({
      evaluation_id: r.evaluation_id,
      title: r.title,
      subject: r.subject,
      logro_pct: r.logro_pct,
      evaluated_at: r.evaluated_at,
      grade_chile: resolvedGradeForEval(r.evaluation_id),
    }))

    if (linkedEvalIds.length === 0 && simceTaggedIds.length === 0 && evalRows.length > 0) {
      warning =
        (warning ? `${warning} ` : "") +
        "Semáforo y estándar agencia usan todas las evaluaciones en alcance (no hay vínculo UTP tipo ENSAYO_SIMCE). Vincule en UTP para filtrar solo ensayos SIMCE."
    }

    return jsonNoStore({
      kpis: {
        promedio_logro_institucional: avgLogroFromItems ?? avgLogro,
        total_evaluaciones_mes: totalEvaluacionesMes,
        simce_proyectado_promedio: simcePromedio,
        paes_proyectado_promedio: paesPromedio,
      },
      semaforo: {
        insuficiente,
        elemental,
        adecuado,
        total: insuficiente + elemental + adecuado,
      },
      risk_distribution: riskCounts,
      aggregates: {
        evaluations_in_scope: evalRows.length,
        summaries_count: sumRows.length,
        items_rows: itemRows.length,
        avg_grade_chile: avgGradeChile,
        avg_logro_pct: avgLogroFromItems ?? (validLogro.length ? avgLogro : null),
      },
      samples: sortedPreview.slice(0, 8),
      recent_evaluations_preview,
      source_mode,
      linked_evaluations_count: linkedEvalIds.length,
      critical_students,
      global_alert: hasCritical27or28
        ? "Alerta crítica institucional: se detectaron notas 2.7/2.8 en evaluaciones en alcance."
        : null,
      warning,
      semaforo_source: simceTaggedIds.length > 0 ? "ensayo_simce_linked" : "all_in_scope",
      last_batch_id: lastBatchId,
      national_batch_intent: batchIntent,
    })
  } catch (e) {
    return jsonNoStore({
      ...emptyPayload,
      warning: e instanceof Error ? e.message : String(e),
    })
  }
}
