import type { SupabaseClient } from "@supabase/supabase-js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Profesor ancla del piloto: su fila en `teachers` aporta el `school_id` del colegio. */
const PILOT_ANCHOR_TEACHER_NAME = "Oscar Salinas"

function parseUuid(raw: string | undefined | null): string | null {
  if (raw == null || String(raw).trim() === "") return null
  const s = String(raw).trim()
  return UUID_RE.test(s) ? s : null
}

/**
 * Colegio fijo del piloto. Orden: `PILOT_DEFAULT_SCHOOL_ID` (UUID válido) → escuela de
 * la fila del profesor "Oscar Salinas" en `teachers` → `PILOT_DEFAULT_SCHOOL_NAME` (ilike en schools).
 */
export async function resolvePilotSchool(
  supabase: SupabaseClient
): Promise<{ id: string; name: string } | null> {
  const fromEnv = parseUuid(process.env.PILOT_DEFAULT_SCHOOL_ID)
  if (fromEnv) {
    const { data: school, error } = await supabase
      .from("schools")
      .select("id, name")
      .eq("id", fromEnv)
      .maybeSingle()
    if (!error && school?.id) {
      return { id: String(school.id), name: String((school as { name?: string }).name ?? "") || "Colegio piloto" }
    }
  }

  const { data: anchor } = await supabase
    .from("teachers")
    .select("school_id")
    .ilike("name", PILOT_ANCHOR_TEACHER_NAME)
    .not("school_id", "is", null)
    .limit(1)
    .maybeSingle()

  const anchorSchoolId = anchor?.school_id != null ? String(anchor.school_id) : null
  if (anchorSchoolId && UUID_RE.test(anchorSchoolId)) {
    const { data: school } = await supabase
      .from("schools")
      .select("id, name")
      .eq("id", anchorSchoolId)
      .maybeSingle()
    if (school?.id) {
      return { id: String(school.id), name: String((school as { name?: string }).name ?? "") || "Colegio piloto" }
    }
  }

  const nameHint =
    typeof process.env.PILOT_DEFAULT_SCHOOL_NAME === "string" && process.env.PILOT_DEFAULT_SCHOOL_NAME.trim() !== ""
      ? process.env.PILOT_DEFAULT_SCHOOL_NAME.trim()
      : null
  if (nameHint) {
    const { data: byName } = await supabase
      .from("schools")
      .select("id, name")
      .ilike("name", nameHint)
      .limit(1)
      .maybeSingle()
    if (byName?.id) {
      return { id: String(byName.id), name: String((byName as { name?: string }).name ?? nameHint) }
    }
  }

  return null
}
