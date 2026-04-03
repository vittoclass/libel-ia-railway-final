import type { SupabaseClient } from "@supabase/supabase-js"

export type ProjectionSourceLabel = "OFICIAL" | "REFERENCIAL"

type ParameterType = "AGENCY_LEVEL_CUTS" | "DEMRE_PAES_TABLE" | "SIMCE_PROJECTION_RULE"

type PedagogicalParameterRow = {
  id: string
  organization_id: string | null
  parameter_type: ParameterType
  parameter_key: string
  year: number
  grade_level: string | null
  subject: string | null
  exam_name: string | null
  application: string | null
  parameter_payload: Record<string, unknown>
  source_org: string
  source_url: string
  source_version: string | null
  is_active: boolean
}

export type AgencyLevelLabel = "INSUFICIENTE" | "ELEMENTAL" | "ADECUADO" | "NO_PARAMETRIZADO"

export type AgencyCut = {
  label: Exclude<AgencyLevelLabel, "NO_PARAMETRIZADO">
  min: number
  max: number
}

export type DemreRow = {
  correctas: number
  score: number
}

type FindParameterInput = {
  supabase: SupabaseClient
  organizationId: string | null
  parameterType: ParameterType
  year: number
  gradeLevel?: string | null
  subject?: string | null
  examName?: string | null
  application?: string | null
}

export async function getScopeOrganizationId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("organization_id, school_id, teacher_id")
    .eq("user_id", userId)
    .maybeSingle()

  const row = data as { organization_id?: string | null; school_id?: string | null; teacher_id?: string | null } | null
  return row?.organization_id ?? row?.school_id ?? row?.teacher_id ?? null
}

async function findParameterWithFallback(input: FindParameterInput): Promise<{
  row: PedagogicalParameterRow | null
  source: ProjectionSourceLabel
  usedYear: number | null
}> {
  const yearsToTry = [input.year, input.year - 1]
  for (const y of yearsToTry) {
    const { data, error } = await input.supabase
      .from("pedagogical_parameters")
      .select(
        "id, organization_id, parameter_type, parameter_key, year, grade_level, subject, exam_name, application, parameter_payload, source_org, source_url, source_version, is_active"
      )
      .eq("parameter_type", input.parameterType)
      .eq("is_active", true)
      .eq("year", y)
      .or(
        input.organizationId
          ? `organization_id.eq.${input.organizationId},organization_id.is.null`
          : "organization_id.is.null"
      )
      .order("organization_id", { ascending: false })
      .limit(20)

    if (error || !data || data.length === 0) continue

    const filtered = data.filter((row) => {
      const r = row as PedagogicalParameterRow
      if (input.gradeLevel && r.grade_level && r.grade_level !== input.gradeLevel) return false
      if (input.subject && r.subject && r.subject !== input.subject) return false
      if (input.examName && r.exam_name && r.exam_name !== input.examName) return false
      if (input.application && r.application && r.application !== input.application) return false
      return true
    }) as PedagogicalParameterRow[]

    const picked = filtered[0] ?? (data[0] as unknown as PedagogicalParameterRow)
    return {
      row: picked ?? null,
      source: y === input.year ? "OFICIAL" : "REFERENCIAL",
      usedYear: y,
    }
  }

  return { row: null, source: "REFERENCIAL", usedYear: null }
}

export async function getAgencyCuts(input: {
  supabase: SupabaseClient
  organizationId: string | null
  year: number
  gradeLevel: string
  subject?: string | null
}): Promise<{
  cuts: AgencyCut[]
  source: ProjectionSourceLabel
  parameterKey: string | null
  yearUsed: number | null
}> {
  const found = await findParameterWithFallback({
    supabase: input.supabase,
    organizationId: input.organizationId,
    parameterType: "AGENCY_LEVEL_CUTS",
    year: input.year,
    gradeLevel: input.gradeLevel,
    subject: input.subject ?? null,
    examName: "SIMCE",
  })

  const rawCuts = (found.row?.parameter_payload?.cuts as unknown[]) ?? []
  const cuts = rawCuts
    .map((c) => c as Partial<AgencyCut>)
    .filter((c) => typeof c?.label === "string" && Number.isFinite(c?.min) && Number.isFinite(c?.max))
    .map((c) => ({
      label: String(c.label).toUpperCase() as AgencyCut["label"],
      min: Number(c.min),
      max: Number(c.max),
    }))

  return {
    cuts,
    source: found.source,
    parameterKey: found.row?.parameter_key ?? null,
    yearUsed: found.usedYear,
  }
}

export function agencyLevelFromPct(logroPct: number, cuts: AgencyCut[]): AgencyLevelLabel {
  const value = Number.isFinite(logroPct) ? Math.max(0, Math.min(100, logroPct)) : NaN
  if (!Number.isFinite(value) || cuts.length === 0) return "NO_PARAMETRIZADO"
  const hit = cuts.find((c) => value >= c.min && value <= c.max)
  if (!hit) return "NO_PARAMETRIZADO"
  return hit.label
}

export async function getDemreTable(input: {
  supabase: SupabaseClient
  organizationId: string | null
  year: number
  application: "REGULAR" | "INVIERNO"
  subject: string
}): Promise<{
  rows: DemreRow[]
  source: ProjectionSourceLabel
  parameterKey: string | null
  yearUsed: number | null
}> {
  const found = await findParameterWithFallback({
    supabase: input.supabase,
    organizationId: input.organizationId,
    parameterType: "DEMRE_PAES_TABLE",
    year: input.year,
    examName: "PAES",
    application: input.application,
    subject: input.subject,
  })

  const rowsRaw = (found.row?.parameter_payload?.rows as unknown[]) ?? []
  const rows = rowsRaw
    .map((r) => r as Partial<DemreRow>)
    .filter((r) => Number.isFinite(r?.correctas) && Number.isFinite(r?.score))
    .map((r) => ({ correctas: Number(r.correctas), score: Math.round(Number(r.score)) }))
    .sort((a, b) => a.correctas - b.correctas)

  return {
    rows,
    source: found.source,
    parameterKey: found.row?.parameter_key ?? null,
    yearUsed: found.usedYear,
  }
}

export function paesFromCorrectas(correctas: number, rows: DemreRow[]): number | null {
  if (!Number.isFinite(correctas) || rows.length === 0) return null
  const c = Math.round(correctas)
  const exact = rows.find((r) => r.correctas === c)
  if (exact) return exact.score
  const lower = [...rows].reverse().find((r) => r.correctas <= c)
  const upper = rows.find((r) => r.correctas >= c)
  if (!lower && !upper) return null
  if (!upper) return lower!.score
  if (!lower) return upper.score
  if (upper.correctas === lower.correctas) return lower.score
  const t = (c - lower.correctas) / (upper.correctas - lower.correctas)
  return Math.round(lower.score + t * (upper.score - lower.score))
}
