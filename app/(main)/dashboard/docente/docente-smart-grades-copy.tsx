"use client"

/**
 * Copiado inteligente de notas — vista curso / prueba aplicada.
 * Agrupa por batch_id (lote = misma prueba, un evaluation_id por estudiante) dentro del curso;
 * sin lote, cada evaluación es un grupo de un alumno.
 * Datos: GET /api/evaluations/by-batch (si hay lote) + GET /api/evaluations/[id] por fila.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, ClipboardCopy, Loader2 } from "lucide-react"
import { normalizeCourseLabel } from "@/app/lib/course-utils"
import { formatStudentDisplayName } from "@/app/lib/format-student-name"
import { approxGradeChileFromLogroPct, resolveStudentDisplayName } from "@/app/lib/student-display-name"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Filas alineadas con el payload del panel docente (solo lectura). */
export type DashboardEvalForCopy = {
  id: string
  title: string | null
  course_key: string
  course_label: string
  evaluated_at: string | null
  batch_id?: string | null
  primary_student_label: string
  resolved_grade?: number | null
  logro_pct?: number | null
  student_count?: number
}

type CourseOption = {
  course_key: string
  course_label: string
}

export type CopyFormatMode = "grades_only" | "name_tab_grade" | "name_tab_grade_logro" | "csv"

type ApiItem = {
  score_obtained?: number | null
  score_max?: number | null
}

type ApiStudent = {
  student_name?: string | null
}

type ApiSummarySlice = {
  grade_chile?: unknown
  student_name_raw?: string | null
  raw?: unknown
}

type ApiDetailJson = {
  evaluation?: {
    student_name?: string | null
    title?: string | null
    evaluated_at?: string | null
  }
  summary?: ApiSummarySlice | null
  summaries?: ApiSummarySlice[] | null
  students?: ApiStudent[]
  items?: ApiItem[]
}

export type SmartGradesRow = {
  name: string
  gradeLabel: string
  logroPct: number | null
}

export type SmartGradesCourseRow = SmartGradesRow & {
  evaluationTitle: string
  evaluatedAtLabel: string
}

type ByBatchRow = {
  id: string
  title: string | null
  course_id: string | null
  course_label: string | null
  evaluated_at: string | null
  first_student_name?: string | null
}

type AppliedGroup = {
  key: string
  kind: "batch" | "single"
  batchId?: string
  label: string
  /** Muestra del panel para etiqueta y respaldo. */
  dashboardMembers: DashboardEvalForCopy[]
}

/** Palabras muy comunes en apellidos compuestos; no cuentan solas para “≥2 tokens”. */
const EXTERNAL_NAME_STOPWORDS = new Set(["de", "del", "la", "las", "los", "y"])

/**
 * Normalización para comparar con lista externa (libro digital):
 * minúsculas, sin tildes, puntuación suave → espacio, espacios colapsados.
 */
function normalizeExternalNameRaw(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Tokens “importantes”: longitud ≥ 2 y no stopword (evita falsos positivos débiles). */
function importantTokensForExternalMatch(s: string): string[] {
  const norm = normalizeExternalNameRaw(s)
  const parts = norm.split(/\s+/).filter(Boolean)
  return parts.filter((t) => t.length >= 2 && !EXTERNAL_NAME_STOPWORDS.has(t))
}

function tokenBagKey(tokens: string[]): string {
  return [...tokens].sort().join(" ")
}

export type ExternalMatchStatus = "encontrado" | "no_encontrado" | "ambiguo"

export type ExternalMatchRow = {
  externalLine: string
  libelName: string | null
  grade: string
  status: ExternalMatchStatus
}

/**
 * Empareja cada línea externa (orden preservado) con filas LibelIA sin reutilizar alumno.
 * Prioridad: igualdad normalizada completa → misma bolsa de tokens → intersección ≥2 tokens;
 * si hay más de un candidato en un paso → ambiguo (no asignar nota).
 */
function matchExternalListToRows(externalLines: string[], rows: SmartGradesCourseRow[]): ExternalMatchRow[] {
  const used = new Set<number>()
  const results: ExternalMatchRow[] = []

  for (const rawLine of externalLines) {
    const externalLine = rawLine.trimEnd().replace(/^\uFEFF/, "")
    const trimmed = externalLine.trim()
    if (!trimmed) {
      results.push({
        externalLine: rawLine,
        libelName: null,
        grade: "",
        status: "no_encontrado",
      })
      continue
    }

    const unusedIndices = rows.map((_, i) => i).filter((i) => !used.has(i))
    const extNorm = normalizeExternalNameRaw(trimmed)
    const extTokens = importantTokensForExternalMatch(trimmed)
    const extBagKey = tokenBagKey(extTokens)

    let pick: number | null = null
    let decidedAmbiguous = false

    let c = unusedIndices.filter((i) => normalizeExternalNameRaw(rows[i]!.name) === extNorm)
    if (c.length === 1) pick = c[0]!
    else if (c.length > 1) decidedAmbiguous = true

    if (pick == null && !decidedAmbiguous && extBagKey.length > 0) {
      c = unusedIndices.filter((i) => tokenBagKey(importantTokensForExternalMatch(rows[i]!.name)) === extBagKey)
      if (c.length === 1) pick = c[0]!
      else if (c.length > 1) decidedAmbiguous = true
    }

    if (pick == null && !decidedAmbiguous) {
      if (extTokens.length >= 2) {
        const extSet = new Set(extTokens)
        c = unusedIndices.filter((i) => {
          let overlap = 0
          for (const t of importantTokensForExternalMatch(rows[i]!.name)) {
            if (extSet.has(t)) overlap++
          }
          return overlap >= 2
        })
        if (c.length === 1) pick = c[0]!
        else if (c.length > 1) decidedAmbiguous = true
      } else if (extTokens.length === 1) {
        const only = extTokens[0]!
        c = unusedIndices.filter((i) => importantTokensForExternalMatch(rows[i]!.name).includes(only))
        if (c.length === 1) pick = c[0]!
        else if (c.length > 1) decidedAmbiguous = true
      }
    }

    if (pick != null) {
      used.add(pick)
      const r = rows[pick]!
      results.push({
        externalLine: trimmed,
        libelName: r.name,
        grade: r.gradeLabel,
        status: "encontrado",
      })
    } else {
      results.push({
        externalLine: trimmed,
        libelName: null,
        grade: "—",
        status: decidedAmbiguous ? "ambiguo" : "no_encontrado",
      })
    }
  }

  return results
}

function buildExternalOrderedCopyText(
  matches: ExternalMatchRow[],
  mode: "grades_only" | "name_tab_grade",
  useEmptyForMissing: boolean,
): string {
  const missing = useEmptyForMissing ? "" : "—"
  const gradeCell = (m: ExternalMatchRow) => {
    if (!m.externalLine.trim()) return ""
    if (m.status !== "encontrado") return missing
    return m.grade
  }
  if (mode === "grades_only") {
    return matches.map(gradeCell).join("\n")
  }
  return matches.map((m) => `${m.externalLine}\t${gradeCell(m)}`).join("\n")
}

function logroFromItems(items: ApiItem[] | undefined): number | null {
  if (!Array.isArray(items) || items.length === 0) return null
  let o = 0
  let m = 0
  for (const it of items) {
    o += Number(it.score_obtained) || 0
    m += Number(it.score_max) || 0
  }
  if (m <= 0) return null
  return Math.round((o / m) * 10000) / 100
}

function formatGradeChile(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return String(Math.round(n * 10) / 10)
}

function foldNameKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function notaFromRaw(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const n = (raw as Record<string, unknown>).nota
  if (typeof n === "number" && Number.isFinite(n)) return n
  if (n != null && String(n).trim() !== "") {
    const x = Number(n)
    return Number.isFinite(x) ? x : null
  }
  return null
}

function logroPctFromRaw(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const p = (raw as Record<string, unknown>).puntaje
  if (typeof p === "string" && p.includes("/")) {
    const parts = p.split("/").map((x) => parseFloat(String(x).trim()))
    const a = parts[0]!
    const b = parts[1]!
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) return Math.round((a / b) * 10000) / 100
  }
  return null
}

function displayNameFromStudentRow(row: ApiStudent): string {
  const raw = resolveStudentDisplayName({
    student_name: row.student_name ?? null,
    student_name_raw: null,
    raw: null,
  }).trim()
  return formatStudentDisplayName(raw || null) || "Alumno sin identificar"
}

function summaryStudentLabel(s: ApiSummarySlice): string {
  const t = resolveStudentDisplayName({
    student_name: null,
    student_name_raw: s.student_name_raw ?? null,
    raw: s.raw,
  }).trim()
  return formatStudentDisplayName(t || null) || ""
}

function gradeLabelFromSummarySlice(s: ApiSummarySlice | undefined): string {
  if (!s) return "—"
  const g = formatGradeChile(s.grade_chile ?? null)
  if (g !== "—") return g
  const n = notaFromRaw(s.raw)
  return n != null ? formatGradeChile(n) : "—"
}

function buildSummaryList(j: ApiDetailJson): ApiSummarySlice[] {
  if (Array.isArray(j.summaries) && j.summaries.length > 0) return j.summaries
  if (j.summary) return [j.summary]
  return []
}

function buildRowsFromApiDetail(j: ApiDetailJson): SmartGradesRow[] {
  const items = j.items
  const globalLogro = logroFromItems(items)
  const approxFromItems =
    globalLogro != null ? approxGradeChileFromLogroPct(globalLogro) : null
  const summaryList = buildSummaryList(j)
  const students = Array.isArray(j.students) ? j.students : []
  const evalSn = j.evaluation?.student_name
  const summaryCompat = j.summary ?? (summaryList.length > 0 ? summaryList[summaryList.length - 1] : null)

  const gradeFromItemsLabel =
    approxFromItems != null && Number.isFinite(approxFromItems) ? formatGradeChile(approxFromItems) : "—"

  const rows: SmartGradesRow[] = []

  const pushRow = (name: string, gradeLabel: string, logroPct: number | null) => {
    rows.push({ name, gradeLabel, logroPct })
  }

  if (students.length > 0) {
    type Draft = { name: string; st: ApiStudent; matchedSummaryIdx: number | null }
    const drafts: Draft[] = students.map((st) => ({
      name: displayNameFromStudentRow(st),
      st,
      matchedSummaryIdx: null as number | null,
    }))

    const usedSummary = new Set<number>()

    for (const d of drafts) {
      const nk = foldNameKey(d.name)
      for (let i = 0; i < summaryList.length; i++) {
        if (usedSummary.has(i)) continue
        const lab = summaryStudentLabel(summaryList[i]!)
        const sk = foldNameKey(lab)
        if (sk.length > 0 && sk === nk) {
          d.matchedSummaryIdx = i
          usedSummary.add(i)
          break
        }
      }
    }

    const unmatchedDrafts = drafts.filter((d) => d.matchedSummaryIdx == null)
    const unmatchedSummaryIdx = [...summaryList.keys()].filter((i) => !usedSummary.has(i))

    if (
      unmatchedDrafts.length > 0 &&
      unmatchedSummaryIdx.length === unmatchedDrafts.length &&
      unmatchedDrafts.length > 0
    ) {
      const ordD = [...unmatchedDrafts].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))
      const ordI = [...unmatchedSummaryIdx].sort((i, j) => {
        const ai = summaryStudentLabel(summaryList[i]!)
        const aj = summaryStudentLabel(summaryList[j]!)
        return ai.localeCompare(aj, "es", { sensitivity: "base" })
      })
      for (let k = 0; k < ordD.length; k++) {
        ordD[k]!.matchedSummaryIdx = ordI[k]!
      }
    }

    for (const d of drafts) {
      let gradeLabel = "—"
      let logroPct: number | null = null

      if (d.matchedSummaryIdx != null) {
        const sm = summaryList[d.matchedSummaryIdx]!
        gradeLabel = gradeLabelFromSummarySlice(sm)
        logroPct = logroPctFromRaw(sm.raw)
      } else if (summaryList.length === 1) {
        const sm = summaryList[0]!
        gradeLabel = gradeLabelFromSummarySlice(sm)
        logroPct = logroPctFromRaw(sm.raw)
      }

      if (gradeLabel === "—" && drafts.length === 1) {
        gradeLabel = gradeLabelFromSummarySlice(summaryCompat ?? undefined)
        if (gradeLabel === "—") gradeLabel = gradeFromItemsLabel
        if (logroPct == null) logroPct = globalLogro
      }

      if (logroPct == null && d.matchedSummaryIdx != null) {
        logroPct = logroPctFromRaw(summaryList[d.matchedSummaryIdx]!.raw)
      }
      if (logroPct == null && drafts.length === 1) logroPct = globalLogro

      pushRow(d.name, gradeLabel, logroPct)
    }
  } else {
    const n = formatStudentDisplayName(
      resolveStudentDisplayName({
        student_name: evalSn ?? null,
        student_name_raw: summaryCompat?.student_name_raw ?? null,
        raw: summaryCompat?.raw,
      }).trim() || null,
    )
    let gradeLabel = gradeLabelFromSummarySlice(summaryCompat ?? undefined)
    if (gradeLabel === "—") gradeLabel = gradeFromItemsLabel
    const logroPct = logroPctFromRaw(summaryCompat?.raw) ?? globalLogro
    pushRow(n || "Alumno sin identificar", gradeLabel, logroPct)
  }

  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))
}

function buildCourseRowsFromDetail(j: ApiDetailJson): SmartGradesCourseRow[] {
  const ev = j.evaluation
  const title = ev?.title?.trim() ? ev.title.trim() : "Sin título"
  const at = ev?.evaluated_at ?? null
  const evaluatedAtLabel = at ? new Date(at).toLocaleDateString("es-CL") : "—"
  return buildRowsFromApiDetail(j).map((r) => ({
    ...r,
    evaluationTitle: title,
    evaluatedAtLabel,
  }))
}

function batchRowMatchesCourseKey(row: ByBatchRow, courseKey: string): boolean {
  const cid = row.course_id != null && String(row.course_id).trim() !== "" ? String(row.course_id).trim() : ""
  if (cid && cid === courseKey) return true
  const lbl = String(row.course_label ?? "").trim()
  if (lbl && normalizeCourseLabel(lbl) === courseKey) return true
  return false
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("es-CL")
  } catch {
    return "—"
  }
}

function buildAppliedGroups(evals: DashboardEvalForCopy[], courseKey: string): AppliedGroup[] {
  const inCourse = evals.filter((e) => e.course_key === courseKey)
  const batchMap = new Map<string, DashboardEvalForCopy[]>()
  const singles: DashboardEvalForCopy[] = []

  for (const e of inCourse) {
    const bid = e.batch_id != null ? String(e.batch_id).trim() : ""
    if (UUID_RE.test(bid)) {
      if (!batchMap.has(bid)) batchMap.set(bid, [])
      batchMap.get(bid)!.push(e)
    } else {
      singles.push(e)
    }
  }

  const groups: AppliedGroup[] = []

  for (const [batchId, members] of batchMap) {
    const sorted = [...members].sort((a, b) => {
      const ta = a.evaluated_at ? new Date(a.evaluated_at).getTime() : 0
      const tb = b.evaluated_at ? new Date(b.evaluated_at).getTime() : 0
      if (ta !== tb) return ta - tb
      return (a.primary_student_label || "").localeCompare(b.primary_student_label || "", "es")
    })
    const title = sorted[sorted.length - 1]?.title?.trim() || sorted[0]?.title?.trim() || "Prueba / lote"
    const lastAt = sorted[sorted.length - 1]?.evaluated_at ?? sorted[0]?.evaluated_at
    const n = sorted.length
    groups.push({
      key: `batch:${batchId}`,
      kind: "batch",
      batchId,
      dashboardMembers: sorted,
      label: `Lote · ${n} estudiante${n === 1 ? "" : "s"} · ${title} · ${formatShortDate(lastAt)}`,
    })
  }

  for (const e of singles) {
    const title = e.title?.trim() || "Evaluación"
    const nameHint = e.primary_student_label?.trim() ? ` · ${e.primary_student_label.trim()}` : ""
    groups.push({
      key: `single:${e.id}`,
      kind: "single",
      dashboardMembers: [e],
      label: `${title}${nameHint} · ${formatShortDate(e.evaluated_at)}`,
    })
  }

  return groups.sort((a, b) => {
    const ta = a.dashboardMembers[a.dashboardMembers.length - 1]?.evaluated_at
    const tb = b.dashboardMembers[b.dashboardMembers.length - 1]?.evaluated_at
    const da = ta ? new Date(ta).getTime() : 0
    const db = tb ? new Date(tb).getTime() : 0
    if (db !== da) return db - da
    return a.label.localeCompare(b.label, "es")
  })
}

async function fetchEvaluationDetail(id: string): Promise<ApiDetailJson | null> {
  const res = await fetch(`/api/evaluations/${encodeURIComponent(id)}`, {
    credentials: "include",
    cache: "no-store",
  })
  const j = (await res.json()) as ApiDetailJson & { error?: string }
  if (!res.ok) return null
  return j
}

async function fetchBatchEvalIdsForCourse(batchId: string, courseKey: string): Promise<ByBatchRow[]> {
  const res = await fetch(`/api/evaluations/by-batch?batch_id=${encodeURIComponent(batchId)}`, {
    credentials: "include",
    cache: "no-store",
  })
  const j = (await res.json()) as { evaluations?: ByBatchRow[]; error?: string }
  if (!res.ok || !Array.isArray(j.evaluations)) return []
  return j.evaluations.filter((r) => r.id && batchRowMatchesCourseKey(r, courseKey))
}

async function mapInChunks<T, R>(items: T[], chunkSize: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    const part = await Promise.all(chunk.map(fn))
    out.push(...part)
  }
  return out
}

function logroLabel(pct: number | null): string {
  return pct != null && Number.isFinite(pct) ? `${pct}%` : "—"
}

function buildCopyText(rows: SmartGradesCourseRow[], mode: CopyFormatMode): string {
  if (mode === "grades_only") {
    return rows.map((r) => r.gradeLabel).join("\n")
  }
  if (mode === "name_tab_grade") {
    return rows.map((r) => `${r.name}\t${r.gradeLabel}`).join("\n")
  }
  if (mode === "name_tab_grade_logro") {
    return rows.map((r) => `${r.name}\t${r.gradeLabel}\t${logroLabel(r.logroPct)}`).join("\n")
  }
  const lines = rows.map((r) => {
    const nameEsc =
      r.name.includes(",") || r.name.includes('"') || r.name.includes("\n")
        ? `"${r.name.replace(/"/g, '""')}"`
        : r.name
    return `${nameEsc},${r.gradeLabel},${logroLabel(r.logroPct)}`
  })
  return lines.join("\n")
}

type Props = {
  evaluations: DashboardEvalForCopy[]
  courses: CourseOption[]
  initialCourseKey?: string
}

export function DocenteSmartGradesCopy({ evaluations, courses, initialCourseKey }: Props) {
  const courseKeysWithEval = useMemo(() => {
    const s = new Set(evaluations.map((e) => e.course_key))
    return [...s]
  }, [evaluations])

  const courseChoices = useMemo(() => {
    const byKey = new Map(courses.map((c) => [c.course_key, c.course_label]))
    return courseKeysWithEval
      .map((ck) => ({
        course_key: ck,
        course_label: byKey.get(ck) ?? evaluations.find((e) => e.course_key === ck)?.course_label ?? ck,
      }))
      .sort((a, b) => a.course_label.localeCompare(b.course_label, "es", { sensitivity: "base" }))
  }, [courseKeysWithEval, courses, evaluations])

  const [courseKey, setCourseKey] = useState<string>("")
  const [groupKey, setGroupKey] = useState<string>("")
  const [formatMode, setFormatMode] = useState<CopyFormatMode>("name_tab_grade")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [rows, setRows] = useState<SmartGradesCourseRow[]>([])
  const [copied, setCopied] = useState(false)

  const [externalPaste, setExternalPaste] = useState("")
  const [externalMatches, setExternalMatches] = useState<ExternalMatchRow[] | null>(null)
  const [externalCopyMode, setExternalCopyMode] = useState<"grades_only" | "name_tab_grade">("grades_only")
  const [externalUseEmptyForMissing, setExternalUseEmptyForMissing] = useState(false)
  const [externalCopied, setExternalCopied] = useState(false)
  const [externalMatchWarn, setExternalMatchWarn] = useState<string | null>(null)

  useEffect(() => {
    setExternalMatches(null)
    setExternalMatchWarn(null)
  }, [rows])

  useEffect(() => {
    if (courseChoices.length === 0) return
    const preferred =
      (initialCourseKey && courseChoices.some((c) => c.course_key === initialCourseKey) ? initialCourseKey : null) ??
      courseChoices[0]!.course_key
    setCourseKey((prev) => (prev && courseChoices.some((c) => c.course_key === prev) ? prev : preferred))
  }, [courseChoices, initialCourseKey])

  const appliedGroups = useMemo(() => buildAppliedGroups(evaluations, courseKey), [evaluations, courseKey])

  useEffect(() => {
    if (appliedGroups.length === 0) {
      setGroupKey("")
      return
    }
    setGroupKey((prev) => (prev && appliedGroups.some((g) => g.key === prev) ? prev : appliedGroups[0]!.key))
  }, [appliedGroups])

  const selectedGroup = useMemo(
    () => appliedGroups.find((g) => g.key === groupKey) ?? null,
    [appliedGroups, groupKey],
  )

  const loadGroup = useCallback(
    async (group: AppliedGroup | null, ck: string) => {
      if (!group) {
        setRows([])
        setWarn(null)
        return
      }
      setLoading(true)
      setError(null)
      setWarn(null)
      try {
        let idRows: ByBatchRow[] = []
        if (group.kind === "batch" && group.batchId) {
          idRows = await fetchBatchEvalIdsForCourse(group.batchId, ck)
          if (idRows.length === 0) {
            idRows = group.dashboardMembers.map((m) => ({
              id: m.id,
              title: m.title,
              course_id: UUID_RE.test(ck) ? ck : null,
              course_label: m.course_label ?? null,
              evaluated_at: m.evaluated_at,
              first_student_name: m.primary_student_label || null,
            }))
            setWarn(
              "No se pudo cargar el lote completo desde el servidor; se muestran solo las evaluaciones visibles en tu panel.",
            )
          } else if (idRows.length < group.dashboardMembers.length) {
            setWarn("El listado del lote tiene menos filas que en el panel; revisa alcance o sincronización.")
          }
        } else {
          const m = group.dashboardMembers[0]!
          idRows = [
            {
              id: m.id,
              title: m.title,
              course_id: UUID_RE.test(ck) ? ck : null,
              course_label: m.course_label,
              evaluated_at: m.evaluated_at,
              first_student_name: m.primary_student_label || null,
            },
          ]
        }

        const uniqueIds = [...new Set(idRows.map((r) => r.id).filter((id) => UUID_RE.test(id)))]

        const detailResults = await mapInChunks(uniqueIds, 6, async (evaluationId) => {
          const j = await fetchEvaluationDetail(evaluationId)
          const meta = idRows.find((r) => r.id === evaluationId)
          if (!j) {
            const nameRaw = meta?.first_student_name?.trim() || "Alumno sin identificar"
            const name = formatStudentDisplayName(nameRaw) || nameRaw
            const dashEv = group.dashboardMembers.find((d) => d.id === evaluationId)
            return [
              {
                name,
                gradeLabel: "—",
                logroPct: null,
                evaluationTitle: meta?.title?.trim() || dashEv?.title?.trim() || "Sin título",
                evaluatedAtLabel: formatShortDate(meta?.evaluated_at ?? dashEv?.evaluated_at),
              } satisfies SmartGradesCourseRow,
            ]
          }
          const built = buildCourseRowsFromDetail(j)
          if (built.length > 0) return built
          const nameRaw = meta?.first_student_name?.trim() || j.evaluation?.student_name?.trim() || "Alumno sin identificar"
          const name = formatStudentDisplayName(nameRaw) || nameRaw
          return [
            {
              name,
              gradeLabel: "—",
              logroPct: null,
              evaluationTitle: j.evaluation?.title?.trim() || meta?.title?.trim() || "Sin título",
              evaluatedAtLabel: formatShortDate(j.evaluation?.evaluated_at ?? meta?.evaluated_at),
            },
          ]
        })

        const flat = detailResults.flat()
        flat.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))

        const missingGrades = flat.filter((r) => r.gradeLabel === "—").length
        if (missingGrades > 0) {
          setWarn(
            (w) =>
              w
                ? `${w} Hay ${missingGrades} fila(s) sin nota (—).`
                : `Hay ${missingGrades} fila(s) sin nota (—).`,
          )
        }

        setRows(flat)
      } catch {
        setError("Error de red al cargar las evaluaciones del grupo.")
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void loadGroup(selectedGroup, courseKey)
  }, [selectedGroup, courseKey, loadGroup])

  const copyText = useMemo(() => buildCopyText(rows, formatMode), [rows, formatMode])

  const handleCopy = useCallback(async () => {
    if (!copyText.trim()) return
    try {
      setError(null)
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setError("No se pudo copiar al portapapeles (permiso del navegador o contexto inseguro).")
    }
  }, [copyText])

  const externalOrderedCopyText = useMemo(() => {
    if (!externalMatches || externalMatches.length === 0) return ""
    return buildExternalOrderedCopyText(externalMatches, externalCopyMode, externalUseEmptyForMissing)
  }, [externalMatches, externalCopyMode, externalUseEmptyForMissing])

  const externalStats = useMemo(() => {
    if (!externalMatches) return null
    const ok = externalMatches.filter((x) => x.status === "encontrado").length
    const nf = externalMatches.filter((x) => x.status === "no_encontrado" && x.externalLine.trim()).length
    const am = externalMatches.filter((x) => x.status === "ambiguo").length
    return { ok, nf, am, total: externalMatches.length }
  }, [externalMatches])

  const handleGenerateExternalOrder = useCallback(() => {
    const lines = externalPaste.split(/\n/)
    const hasContent = lines.some((l) => l.trim().length > 0)
    if (!hasContent) {
      setExternalMatchWarn("Pega la lista de nombres del libro digital (una por línea).")
      setExternalMatches(null)
      return
    }
    if (rows.length === 0) {
      setExternalMatchWarn("Primero debe cargarse la tabla de notas (elige curso y prueba).")
      setExternalMatches(null)
      return
    }
    const m = matchExternalListToRows(lines, rows)
    setExternalMatches(m)
    const nf = m.filter((x) => x.status === "no_encontrado" && x.externalLine.trim()).length
    const am = m.filter((x) => x.status === "ambiguo").length
    if (nf > 0 || am > 0) {
      setExternalMatchWarn(
        `Antes de pegar en el libro: ${nf} no encontrado(s), ${am} ambiguo(s). Comprueba la tabla y la opción de celda vacía / —.`,
      )
    } else {
      setExternalMatchWarn(null)
    }
  }, [externalPaste, rows])

  const handleCopyExternalOrder = useCallback(async () => {
    if (!externalMatches?.length) return
    const text = buildExternalOrderedCopyText(externalMatches, externalCopyMode, externalUseEmptyForMissing)
    try {
      setError(null)
      await navigator.clipboard.writeText(text)
      setExternalCopied(true)
      window.setTimeout(() => setExternalCopied(false), 2200)
    } catch {
      setError("No se pudo copiar al portapapeles (permiso del navegador o contexto inseguro).")
    }
  }, [externalMatches, externalCopyMode, externalUseEmptyForMissing])

  if (courseChoices.length === 0) return null

  return (
    <section
      className="rounded-xl border border-indigo-200/80 bg-gradient-to-b from-indigo-50/90 to-white shadow-sm overflow-hidden"
      aria-label="Copiado inteligente de notas"
    >
      <div className="border-b border-indigo-100 bg-indigo-50/80 px-4 py-3">
        <h3 className="text-sm font-semibold text-indigo-950">Copiado inteligente de notas</h3>
        <p className="mt-1 text-xs text-indigo-900/80">
          Elige el curso y la <strong className="font-medium">prueba aplicada</strong> (por lote, todas las correcciones
          del mismo escaneo, o una evaluación suelta). Las notas salen de cada{" "}
          <code className="text-[11px] bg-indigo-100/80 px-1 rounded">GET /api/evaluations/[id]</code>. Formato TSV
          recomendado para Excel, Google Sheets y libros digitales.
        </p>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs font-medium text-slate-700">
            Curso
            <select
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"
              value={courseKey}
              onChange={(e) => setCourseKey(e.target.value)}
            >
              {courseChoices.map((c) => (
                <option key={c.course_key} value={c.course_key}>
                  {c.course_label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
            Prueba aplicada / lote / evaluación
            <select
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"
              value={groupKey}
              onChange={(e) => setGroupKey(e.target.value)}
              disabled={appliedGroups.length === 0}
            >
              {appliedGroups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Formato al copiar
            <select
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"
              value={formatMode}
              onChange={(e) => setFormatMode(e.target.value as CopyFormatMode)}
            >
              <option value="grades_only">Solo notas (una por línea)</option>
              <option value="name_tab_grade">Nombre + tab + nota (TSV)</option>
              <option value="name_tab_grade_logro">Nombre + tab + nota + tab + logro % (TSV)</option>
              <option value="csv">CSV (nombre, nota, logro %)</option>
            </select>
          </label>
        </div>

        {warn ? <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{warn}</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vista previa</span>
            {loading ? (
              <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Cargando…
              </span>
            ) : (
              <span className="text-xs text-slate-500">{rows.length} fila{rows.length === 1 ? "" : "s"}</span>
            )}
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Estudiante</th>
                  <th className="px-3 py-2 font-semibold text-right tabular-nums">Nota</th>
                  <th className="px-3 py-2 font-semibold text-right tabular-nums">Logro %</th>
                  <th className="px-3 py-2 font-semibold">Evaluación</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500 text-xs">
                      Sin filas para mostrar.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={`${r.name}-${r.evaluationTitle}-${i}`}>
                      <td className="px-3 py-2 text-slate-900">{r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">{r.gradeLabel}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {r.logroPct != null ? `${r.logroPct}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-700 text-xs max-w-[200px] truncate" title={r.evaluationTitle}>
                        {r.evaluationTitle}
                      </td>
                      <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap">{r.evaluatedAtLabel}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={loading || rows.length === 0 || !copyText.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <ClipboardCopy className="h-4 w-4" aria-hidden />}
            {copied ? "Copiado ✓" : "Copiar"}
          </button>
          <span className="text-xs text-slate-500">
            Lotes agrupados por <strong className="font-medium">batch_id</strong> en el curso; filas ordenadas alfabéticamente.
          </span>
        </div>

        <div className="mt-6 border-t border-indigo-100 pt-5 space-y-3 rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm">
          <h4 className="text-sm font-semibold text-slate-900">Ordenar según lista externa</h4>
          <p className="text-xs text-slate-600">
            Copia desde WebClass, Ciscor, Lirmi u otro libro la columna de nombres (orden del curso allí) y pégala abajo.
            LibelIA empareja con la tabla cargada y genera <strong className="font-medium">solo notas</strong> en ese mismo
            orden para pegar en la columna de notas del libro. Si hay duda entre dos alumnos, la fila queda{" "}
            <strong className="font-medium">ambiguo</strong> y no se asigna nota automáticamente.
          </p>

          <label className="block text-xs font-medium text-slate-700">
            Pega aquí la lista de estudiantes del libro digital
            <textarea
              className="mt-1 w-full min-h-[120px] rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 font-mono"
              placeholder={"Un nombre por línea, mismo orden que en el libro…"}
              value={externalPaste}
              onChange={(e) => setExternalPaste(e.target.value)}
              disabled={loading}
              spellCheck={false}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleGenerateExternalOrder()}
              disabled={loading || rows.length === 0}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generar notas en ese orden
            </button>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={externalUseEmptyForMissing}
                onChange={(e) => setExternalUseEmptyForMissing(e.target.checked)}
                className="rounded border-slate-300"
              />
              Celdas vacías en faltantes (si no, se usa —)
            </label>
            <label className="text-xs font-medium text-slate-700">
              Salida
              <select
                className="ml-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900"
                value={externalCopyMode}
                onChange={(e) => setExternalCopyMode(e.target.value as "grades_only" | "name_tab_grade")}
              >
                <option value="grades_only">Solo notas (una por línea)</option>
                <option value="name_tab_grade">Nombre externo + tab + nota</option>
              </select>
            </label>
          </div>

          {externalMatchWarn ? (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{externalMatchWarn}</p>
          ) : null}

          {externalStats ? (
            <p className="text-xs text-slate-600">
              Coincidencias: <strong className="text-emerald-800">{externalStats.ok} encontrados</strong>
              {" · "}
              <strong className="text-rose-800">{externalStats.nf} no encontrados</strong>
              {" · "}
              <strong className="text-amber-900">{externalStats.am} ambiguos</strong>
              {" · "}
              {externalStats.total} líneas
            </p>
          ) : null}

          {externalMatches && externalMatches.length > 0 ? (
            <>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vista previa para copiar</span>
                <textarea
                  readOnly
                  className="mt-1 w-full min-h-[100px] rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-mono text-slate-900"
                  value={externalOrderedCopyText}
                  aria-label="Notas ordenadas según lista externa"
                />
              </div>

              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Detalle de coincidencias
                </div>
                <div className="max-h-56 overflow-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Nombre (libro)</th>
                        <th className="px-3 py-2 font-semibold">Estudiante LibelIA</th>
                        <th className="px-3 py-2 font-semibold text-right tabular-nums">Nota</th>
                        <th className="px-3 py-2 font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {externalMatches.map((m, i) => {
                        const rowBg =
                          m.status === "encontrado"
                            ? ""
                            : m.status === "ambiguo"
                              ? "bg-amber-50/90"
                              : m.externalLine.trim()
                                ? "bg-rose-50/80"
                                : ""
                        const estadoLabel =
                          m.status === "encontrado"
                            ? "Encontrado"
                            : m.status === "ambiguo"
                              ? "Ambiguo"
                              : m.externalLine.trim()
                                ? "No encontrado"
                                : "Línea vacía"
                        return (
                          <tr key={`ext-${i}-${m.externalLine}`} className={rowBg}>
                            <td className="px-3 py-2 text-slate-900 align-top">{m.externalLine || "·"}</td>
                            <td className="px-3 py-2 text-slate-700 align-top">{m.libelName ?? "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-800 align-top">
                              {m.status === "encontrado" ? m.grade : externalUseEmptyForMissing ? "" : "—"}
                            </td>
                            <td className="px-3 py-2 text-xs font-medium align-top text-slate-700">{estadoLabel}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleCopyExternalOrder()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-800"
              >
                {externalCopied ? <Check className="h-4 w-4" aria-hidden /> : <ClipboardCopy className="h-4 w-4" aria-hidden />}
                {externalCopied ? "Copiado ✓" : "Copiar solo notas ordenadas"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
